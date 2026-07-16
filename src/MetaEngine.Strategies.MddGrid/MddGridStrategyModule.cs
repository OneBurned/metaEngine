using System.Text.Json;
using MetaEngine.Domain;
using MetaEngine.Domain.Calculations;
using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Strategies.MddGrid;

public sealed class MddGridStrategyModule : IStrategyModule
{
    private const double ComparisonTolerance = 1e-12;

    public StrategyDescriptor Descriptor { get; } = new MddGridStrategyModuleDescriptor().Descriptor;

    public StrategyValidationResult ValidateParameters(JsonElement parameters) =>
        ValidateParametersCore(parameters);

    public ValueTask<IStrategyPreparedData> PrepareAsync(
        IReadOnlyList<StrategySourcePoint> source,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var points = source.Select(point => new ReturnPoint(point.Timestamp, point.Diff)).ToArray();
        return ValueTask.FromResult<IStrategyPreparedData>(new PreparedData(source, BaseMetricsCalculator.Calculate(points)));
    }

    public StrategyValidationResult ValidateSearchSpace(JsonElement searchSpace) =>
        new([new("searchSpace", "MDDGrid optimization is not available yet.")]);

    public long? EstimateCandidateCount(JsonElement searchSpace) => null;

    public async IAsyncEnumerable<JsonElement> GenerateCandidatesAsync(
        JsonElement searchSpace,
        int seed,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        await Task.CompletedTask;
        cancellationToken.ThrowIfCancellationRequested();
        if (searchSpace.ValueKind == JsonValueKind.Undefined)
        {
            yield break;
        }
        throw new NotSupportedException("MDDGrid optimization is not available yet.");
    }

    public ValueTask<StrategyCalculationResult> CalculateAsync(
        IStrategyPreparedData preparedData,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var prepared = GetPrepared(preparedData);
        var configuration = ReadValidatedParameters(parameters);
        var rows = new StrategyResultPoint[prepared.Source.Count];
        var summary = Calculate(prepared, configuration, rows, cancellationToken);
        return ValueTask.FromResult(new StrategyCalculationResult(rows, summary));
    }

    public ValueTask<StrategyRunSummary> CalculateSummaryAsync(
        IStrategyPreparedData preparedData,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var prepared = GetPrepared(preparedData);
        var configuration = ReadValidatedParameters(parameters);
        return ValueTask.FromResult(Calculate(prepared, configuration, null, cancellationToken));
    }

    private static PreparedData GetPrepared(IStrategyPreparedData preparedData) =>
        preparedData as PreparedData
        ?? throw new InvalidOperationException("MDDGrid was given incompatible prepared data.");

    private static StrategyValidationResult ValidateParametersCore(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            return new StrategyValidationResult([new("parameters", "Parameters must be an object.")]);
        }

        var errors = new List<StrategyValidationError>();
        var maxTotalWeight = ReadDouble(parameters, "maxTotalWeight", 1d);
        if (!double.IsFinite(maxTotalWeight) || maxTotalWeight <= 0)
        {
            errors.Add(new("maxTotalWeight", "Maximum total weight must be positive."));
        }

        var levels = ReadLevels(parameters, errors);
        if (levels.Count is < 1 or > 10)
        {
            errors.Add(new("levels", "MDDGrid requires between one and ten levels."));
        }
        else if (double.IsFinite(maxTotalWeight) && maxTotalWeight > 0 &&
                 levels.Sum(level => level.Weight) > maxTotalWeight + ComparisonTolerance)
        {
            errors.Add(new("levels.weight", "The sum of entry weights cannot exceed the maximum total weight."));
        }

        return errors.Count == 0 ? StrategyValidationResult.Valid : new StrategyValidationResult(errors);
    }

    private static Configuration ReadValidatedParameters(JsonElement parameters)
    {
        var validation = ValidateParametersCore(parameters);
        if (!validation.IsValid)
        {
            throw new StrategyParameterException(validation.Errors);
        }

        return new Configuration(ReadLevels(parameters, []), ReadDouble(parameters, "maxTotalWeight", 1d));
    }

    private static StrategyRunSummary Calculate(
        PreparedData prepared,
        Configuration configuration,
        StrategyResultPoint[]? rows,
        CancellationToken cancellationToken)
    {
        var lots = configuration.Levels.Select(_ => new LotState()).ToArray();
        var previousSourceDrawdown = 0d;
        var accum = 0d;
        var highWaterMark = 0d;
        var maxDrawdown = 0d;
        var buyCount = 0;
        var sellCount = 0;

        for (var index = 0; index < prepared.Source.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var executions = ApplyPendingExecutions(lots);
            var position = ActiveWeight(configuration.Levels, lots);
            var diff = prepared.Source[index].Diff * position;
            if (index > 0)
            {
                accum = (1 + diff) * (1 + accum) - 1;
            }
            highWaterMark = Math.Max(highWaterMark, accum);
            var strategyDrawdown = (1 + accum) / (1 + highWaterMark) - 1;
            maxDrawdown = Math.Min(maxDrawdown, strategyDrawdown);

            var sourceRow = prepared.BaseMetrics.Rows[index];
            var sourceDrawdown = sourceRow.Drawdown;
            var metrics = new MetricValues(
                sourceDrawdown,
                sourceRow.HighWaterMark,
                strategyDrawdown,
                highWaterMark);

            var signals = new List<string>();
            for (var levelIndex = 0; levelIndex < configuration.Levels.Count; levelIndex++)
            {
                var level = configuration.Levels[levelIndex];
                var lot = lots[levelIndex];
                if (lot.IsActive)
                {
                    if (!lot.IsClosePending && HasReachedTakeProfit(
                            lot.EntryMetric,
                            ReadMetric(level.ExitMetric, metrics),
                            level.TakeProfit))
                    {
                        lot.IsClosePending = true;
                        signals.Add($"sell:{levelIndex + 1}");
                        sellCount++;
                    }
                    continue;
                }

                if (!lot.IsOpenPending &&
                    previousSourceDrawdown > level.Drawdown &&
                    sourceDrawdown <= level.Drawdown)
                {
                    lot.IsOpenPending = true;
                    lot.EntryMetric = ReadMetric(level.ExitMetric, metrics);
                    signals.Add($"buy:{levelIndex + 1}");
                    buyCount++;
                }
            }

            if (rows is not null)
            {
                rows[index] = new StrategyResultPoint(
                    prepared.Source[index].Timestamp,
                    diff,
                    new Dictionary<string, JsonElement>
                    {
                        ["source_dd"] = JsonSerializer.SerializeToElement(sourceDrawdown),
                        ["source_hwm"] = JsonSerializer.SerializeToElement(sourceRow.HighWaterMark),
                        ["strategy_dd"] = JsonSerializer.SerializeToElement(strategyDrawdown),
                        ["strategy_hwm"] = JsonSerializer.SerializeToElement(highWaterMark),
                        ["signal"] = JsonSerializer.SerializeToElement(string.Join(',', signals)),
                        ["execution"] = JsonSerializer.SerializeToElement(string.Join(',', executions)),
                        ["position"] = JsonSerializer.SerializeToElement(position)
                    });
            }

            previousSourceDrawdown = sourceDrawdown;
        }

        return new StrategyRunSummary(accum, highWaterMark, maxDrawdown, buyCount, sellCount);
    }

    private static IReadOnlyList<string> ApplyPendingExecutions(IReadOnlyList<LotState> lots)
    {
        var executions = new List<string>();
        for (var index = 0; index < lots.Count; index++)
        {
            var lot = lots[index];
            if (lot.IsClosePending)
            {
                lot.IsActive = false;
                lot.IsClosePending = false;
                lot.EntryMetric = 0;
                executions.Add($"sell:{index + 1}");
            }
            if (lot.IsOpenPending)
            {
                lot.IsActive = true;
                lot.IsOpenPending = false;
                executions.Add($"buy:{index + 1}");
            }
        }
        return executions;
    }

    private static double ActiveWeight(IReadOnlyList<Level> levels, IReadOnlyList<LotState> lots) =>
        levels.Where((_, index) => lots[index].IsActive).Sum(level => level.Weight);

    private static bool HasReachedTakeProfit(double entryMetric, double currentMetric, double takeProfit) =>
        currentMetric + ComparisonTolerance >= entryMetric + takeProfit;

    private static double ReadMetric(string exitMetric, MetricValues metrics) => exitMetric switch
    {
        "source_dd" => metrics.SourceDrawdown,
        "strategy_dd" => metrics.StrategyDrawdown,
        "source_hwm" => metrics.SourceHighWaterMark,
        "strategy_hwm" => metrics.StrategyHighWaterMark,
        _ => throw new InvalidOperationException($"Unsupported MDDGrid exit metric '{exitMetric}'.")
    };

    private static List<Level> ReadLevels(JsonElement parameters, List<StrategyValidationError> errors)
    {
        var levels = new List<Level>();
        if (!parameters.TryGetProperty("levels", out var rawLevels) || rawLevels.ValueKind != JsonValueKind.Array)
        {
            errors.Add(new("levels", "Levels must be an array."));
            return levels;
        }

        var previousDrawdown = 0d;
        var previousWeight = double.NegativeInfinity;
        var index = 0;
        foreach (var rawLevel in rawLevels.EnumerateArray())
        {
            var path = $"levels.{index}";
            var drawdown = ReadDouble(rawLevel, "drawdown", double.NaN);
            var weight = ReadDouble(rawLevel, "weight", double.NaN);
            var exitMetric = ReadString(rawLevel, "exitMetric", string.Empty);
            var takeProfit = ReadDouble(rawLevel, "takeProfit", double.NaN);
            var isValid = true;

            if (!double.IsFinite(drawdown) || drawdown >= 0 || drawdown < -1)
            {
                errors.Add(new($"{path}.drawdown", "Drawdown must be between -100% and 0%."));
                isValid = false;
            }
            else if (drawdown >= previousDrawdown)
            {
                errors.Add(new($"{path}.drawdown", "Drawdown levels must become strictly deeper."));
                isValid = false;
            }

            if (!double.IsFinite(weight) || weight < 0)
            {
                errors.Add(new($"{path}.weight", "Entry weight must be non-negative."));
                isValid = false;
            }
            else if (weight + ComparisonTolerance < previousWeight)
            {
                errors.Add(new($"{path}.weight", "Entry weights must be nondecreasing."));
                isValid = false;
            }

            if (exitMetric is not ("source_dd" or "strategy_dd" or "source_hwm" or "strategy_hwm"))
            {
                errors.Add(new($"{path}.exitMetric", "Exit metric is not supported."));
                isValid = false;
            }
            if (!double.IsFinite(takeProfit) || takeProfit < 0)
            {
                errors.Add(new($"{path}.takeProfit", "Take profit must be non-negative."));
                isValid = false;
            }

            if (isValid)
            {
                levels.Add(new Level(drawdown, weight, exitMetric, takeProfit));
                previousDrawdown = drawdown;
                previousWeight = weight;
            }
            index++;
        }

        return levels;
    }

    private static double ReadDouble(JsonElement owner, string name, double fallback) =>
        owner.TryGetProperty(name, out var property) && property.TryGetDouble(out var value) ? value : fallback;

    private static string ReadString(JsonElement owner, string name, string fallback) =>
        owner.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString() ?? fallback
            : fallback;

    private sealed record Configuration(IReadOnlyList<Level> Levels, double MaxTotalWeight);

    private sealed record Level(double Drawdown, double Weight, string ExitMetric, double TakeProfit);

    private sealed record MetricValues(
        double SourceDrawdown,
        double SourceHighWaterMark,
        double StrategyDrawdown,
        double StrategyHighWaterMark);

    private sealed class LotState
    {
        public bool IsActive { get; set; }

        public bool IsOpenPending { get; set; }

        public bool IsClosePending { get; set; }

        public double EntryMetric { get; set; }
    }

    private sealed record PreparedData(IReadOnlyList<StrategySourcePoint> Source, CalculationSeries BaseMetrics) : IStrategyPreparedData;
}
