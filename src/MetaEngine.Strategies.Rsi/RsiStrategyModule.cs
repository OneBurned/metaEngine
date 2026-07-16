using System.Text.Json;
using MetaEngine.Domain;
using MetaEngine.Domain.Calculations;
using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Strategies.Rsi;

public sealed class RsiStrategyModule : IStrategyModule
{
    public StrategyDescriptor Descriptor { get; } = new RsiStrategyModuleDescriptor().Descriptor;

    public StrategyValidationResult ValidateParameters(JsonElement parameters)
    {
        var errors = new List<StrategyValidationError>();
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            return new StrategyValidationResult([new("parameters", "Parameters must be an object.")]);
        }

        var period = ReadInt(parameters, "rsiPeriod", 14);
        var buy = ReadDouble(parameters, "buyLevel", 30);
        var sell = ReadDouble(parameters, "sellLevel", 70);
        if (period is < 1 or > 1000)
        {
            errors.Add(new("rsiPeriod", "RSI period must be between 1 and 1000."));
        }
        if (!double.IsFinite(buy) || buy < 0 || buy > 100)
        {
            errors.Add(new("buyLevel", "Buy level must be between 0 and 100."));
        }
        if (!double.IsFinite(sell) || sell < 0 || sell > 100)
        {
            errors.Add(new("sellLevel", "Sell level must be between 0 and 100."));
        }
        return errors.Count == 0 ? StrategyValidationResult.Valid : new StrategyValidationResult(errors);
    }

    public ValueTask<IStrategyPreparedData> PrepareAsync(
        IReadOnlyList<StrategySourcePoint> source,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var points = source.Select(point => new ReturnPoint(point.Timestamp, point.Diff)).ToArray();
        var metrics = BaseMetricsCalculator.Calculate(points);
        return ValueTask.FromResult<IStrategyPreparedData>(new PreparedData(source, metrics));
    }

    public StrategyValidationResult ValidateSearchSpace(JsonElement searchSpace)
    {
        var errors = new List<StrategyValidationError>();
        if (searchSpace.ValueKind != JsonValueKind.Object)
        {
            return new StrategyValidationResult([new("searchSpace", "Search space must be an object.")]);
        }

        ValidateRange(searchSpace, "rsiPeriod", integer: true, minimum: 1, maximum: 1000, errors);
        ValidateRange(searchSpace, "buyLevel", integer: false, minimum: 0, maximum: 100, errors);
        ValidateRange(searchSpace, "sellLevel", integer: false, minimum: 0, maximum: 100, errors);
        return errors.Count == 0 ? StrategyValidationResult.Valid : new StrategyValidationResult(errors);
    }

    public long? EstimateCandidateCount(JsonElement searchSpace)
    {
        var validation = ValidateSearchSpace(searchSpace);
        if (!validation.IsValid)
        {
            return null;
        }

        try
        {
            checked
            {
                return CountValues(searchSpace, "rsiPeriod") *
                    CountValues(searchSpace, "buyLevel") *
                    CountValues(searchSpace, "sellLevel");
            }
        }
        catch (OverflowException)
        {
            return null;
        }
    }

    public async IAsyncEnumerable<JsonElement> GenerateCandidatesAsync(
        JsonElement searchSpace,
        int seed,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        await Task.CompletedTask;
        var validation = ValidateSearchSpace(searchSpace);
        if (!validation.IsValid)
        {
            throw new StrategyParameterException(validation.Errors);
        }

        foreach (var rsiPeriod in ExpandRange(searchSpace, "rsiPeriod", integer: true))
        {
            foreach (var buyLevel in ExpandRange(searchSpace, "buyLevel", integer: false))
            {
                foreach (var sellLevel in ExpandRange(searchSpace, "sellLevel", integer: false))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    yield return JsonSerializer.SerializeToElement(new
                    {
                        rsiPeriod = (int)rsiPeriod,
                        buyLevel,
                        sellLevel
                    });
                }
            }
        }
    }

    public ValueTask<StrategyCalculationResult> CalculateAsync(
        IStrategyPreparedData preparedData,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var prepared = preparedData as PreparedData
            ?? throw new InvalidOperationException("RSI was given incompatible prepared data.");
        var validation = ValidateParameters(parameters);
        if (!validation.IsValid)
        {
            throw new StrategyParameterException(validation.Errors);
        }

        var period = ReadInt(parameters, "rsiPeriod", 14);
        var buyLevel = ReadDouble(parameters, "buyLevel", 30);
        var sellLevel = ReadDouble(parameters, "sellLevel", 70);
        var rows = new StrategyResultPoint[prepared.Source.Count];
        var summary = CalculateSummary(prepared, period, buyLevel, sellLevel, rows, cancellationToken);

        return ValueTask.FromResult(new StrategyCalculationResult(rows, summary));
    }

    public ValueTask<StrategyRunSummary> CalculateSummaryAsync(
        IStrategyPreparedData preparedData,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var prepared = preparedData as PreparedData
            ?? throw new InvalidOperationException("RSI was given incompatible prepared data.");
        var validation = ValidateParameters(parameters);
        if (!validation.IsValid)
        {
            throw new StrategyParameterException(validation.Errors);
        }

        var period = ReadInt(parameters, "rsiPeriod", 14);
        var buyLevel = ReadDouble(parameters, "buyLevel", 30);
        var sellLevel = ReadDouble(parameters, "sellLevel", 70);
        return ValueTask.FromResult(CalculateSummary(prepared, period, buyLevel, sellLevel, null, cancellationToken));
    }

    private static StrategyRunSummary CalculateSummary(
        PreparedData prepared,
        int period,
        double buyLevel,
        double sellLevel,
        StrategyResultPoint[]? rows,
        CancellationToken cancellationToken)
    {
        var rsi = prepared.GetRsi(period);
        var position = 0d;
        var pendingExecution = string.Empty;
        var buyCount = 0;
        var sellCount = 0;
        var accum = 0d;
        var highWaterMark = 0d;
        var maxDrawdown = 0d;

        for (var index = 0; index < prepared.Source.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var execution = pendingExecution;
            pendingExecution = string.Empty;
            if (execution == "buy") position = 1;
            if (execution == "sell") position = 0;
            var diff = position > 0 ? prepared.Source[index].Diff : 0;

            if (index > 0 && rsi[index - 1] is double previous && rsi[index] is double current)
            {
                if (previous > buyLevel && current <= buyLevel && position == 0)
                {
                    pendingExecution = "buy";
                    buyCount++;
                }
                else if (previous < sellLevel && current >= sellLevel && position > 0)
                {
                    pendingExecution = "sell";
                    sellCount++;
                }
            }

            if (index > 0)
            {
                accum = (1 + diff) * (1 + accum) - 1;
            }
            highWaterMark = Math.Max(highWaterMark, accum);
            var drawdown = (1 + accum) / (1 + highWaterMark) - 1;
            maxDrawdown = Math.Min(maxDrawdown, drawdown);

            if (rows is not null)
            {
                rows[index] = new StrategyResultPoint(
                    prepared.Source[index].Timestamp,
                    diff,
                    new Dictionary<string, JsonElement>());
            }
        }

        return new StrategyRunSummary(accum, highWaterMark, maxDrawdown, buyCount, sellCount);
    }

    private static double?[] CalculateRsi(IReadOnlyList<CalculationPoint> rows, int period)
    {
        var values = new double?[rows.Count];
        if (rows.Count <= period)
        {
            return values;
        }

        var gainSum = 0d;
        var lossSum = 0d;
        for (var index = 1; index <= period; index++)
        {
            var delta = rows[index].Accum - rows[index - 1].Accum;
            if (delta >= 0) gainSum += delta;
            else lossSum -= delta;
        }

        var averageGain = gainSum / period;
        var averageLoss = lossSum / period;
        values[period] = ToRsi(averageGain, averageLoss);
        for (var index = period + 1; index < rows.Count; index++)
        {
            var delta = rows[index].Accum - rows[index - 1].Accum;
            var gain = Math.Max(delta, 0);
            var loss = Math.Max(-delta, 0);
            averageGain = ((averageGain * (period - 1)) + gain) / period;
            averageLoss = ((averageLoss * (period - 1)) + loss) / period;
            values[index] = ToRsi(averageGain, averageLoss);
        }
        return values;
    }

    private static double ToRsi(double averageGain, double averageLoss) =>
        averageLoss == 0 && averageGain == 0 ? 50 :
        averageLoss == 0 ? 100 :
        100 - (100 / (1 + (averageGain / averageLoss)));

    private static int ReadInt(JsonElement parameters, string name, int fallback) =>
        parameters.TryGetProperty(name, out var property) && property.TryGetInt32(out var value) ? value : fallback;

    private static double ReadDouble(JsonElement parameters, string name, double fallback) =>
        parameters.TryGetProperty(name, out var property) && property.TryGetDouble(out var value) ? value : fallback;

    private static void ValidateRange(
        JsonElement searchSpace,
        string name,
        bool integer,
        double minimum,
        double maximum,
        List<StrategyValidationError> errors)
    {
        if (!searchSpace.TryGetProperty(name, out var range) || range.ValueKind != JsonValueKind.Object ||
            !range.TryGetProperty("from", out var fromProperty) || !fromProperty.TryGetDouble(out var from) ||
            !range.TryGetProperty("to", out var toProperty) || !toProperty.TryGetDouble(out var to) ||
            !range.TryGetProperty("step", out var stepProperty) || !stepProperty.TryGetDouble(out var step))
        {
            errors.Add(new(name, "A range with from, to, and step is required."));
            return;
        }

        if (!double.IsFinite(from) || !double.IsFinite(to) || !double.IsFinite(step) ||
            from < minimum || to > maximum || from > to || step <= 0 ||
            (integer && (from != Math.Truncate(from) || to != Math.Truncate(to) || step != Math.Truncate(step))))
        {
            errors.Add(new(name, $"Range must stay between {minimum} and {maximum} with a positive step."));
        }
    }

    private static long CountValues(JsonElement searchSpace, string name)
    {
        var range = searchSpace.GetProperty(name);
        var from = range.GetProperty("from").GetDecimal();
        var to = range.GetProperty("to").GetDecimal();
        var step = range.GetProperty("step").GetDecimal();
        return checked((long)decimal.Floor((to - from) / step) + 1);
    }

    private static IEnumerable<double> ExpandRange(JsonElement searchSpace, string name, bool integer)
    {
        var range = searchSpace.GetProperty(name);
        var from = range.GetProperty("from").GetDecimal();
        var to = range.GetProperty("to").GetDecimal();
        var step = range.GetProperty("step").GetDecimal();
        for (var value = from; value <= to; value += step)
        {
            yield return integer ? (double)(int)value : (double)value;
        }
    }

    private sealed class PreparedData(
        IReadOnlyList<StrategySourcePoint> source,
        CalculationSeries baseMetrics) : IStrategyPreparedData
    {
        private int cachedRsiPeriod = -1;
        private double?[]? cachedRsi;

        public IReadOnlyList<StrategySourcePoint> Source { get; } = source;
        public CalculationSeries BaseMetrics { get; } = baseMetrics;

        public double?[] GetRsi(int period)
        {
            if (cachedRsiPeriod != period)
            {
                cachedRsi = CalculateRsi(BaseMetrics.Rows, period);
                cachedRsiPeriod = period;
            }

            return cachedRsi!;
        }
    }
}
