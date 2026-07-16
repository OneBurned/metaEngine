using System.Text.Json;
using MetaEngine.Domain;
using MetaEngine.Domain.Calculations;
using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Strategies.MddMeanReversion;

public sealed class MddMeanReversionStrategyModule : IStrategyModule
{
    public StrategyDescriptor Descriptor { get; } = new MddMeanReversionStrategyModuleDescriptor().Descriptor;

    public StrategyValidationResult ValidateParameters(JsonElement parameters)
        => ValidateParametersCore(parameters);

    private static StrategyValidationResult ValidateParametersCore(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            return new StrategyValidationResult([new("parameters", "Parameters must be an object.")]);
        }

        var errors = new List<StrategyValidationError>();
        var takeProfit = ReadDouble(parameters, "takeProfit", 0.01);
        if (!double.IsFinite(takeProfit) || takeProfit < 0)
        {
            errors.Add(new("takeProfit", "Take profit must be a non-negative number."));
        }

        var levels = ReadLevels(parameters, errors);
        if (levels.Count == 0)
        {
            errors.Add(new("levels", "At least one drawdown level is required."));
        }
        return errors.Count == 0 ? StrategyValidationResult.Valid : new StrategyValidationResult(errors);
    }

    public ValueTask<IStrategyPreparedData> PrepareAsync(
        IReadOnlyList<StrategySourcePoint> source,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var points = source.Select(point => new ReturnPoint(point.Timestamp, point.Diff)).ToArray();
        return ValueTask.FromResult<IStrategyPreparedData>(new PreparedData(source, BaseMetricsCalculator.Calculate(points)));
    }

    public StrategyValidationResult ValidateSearchSpace(JsonElement searchSpace)
    {
        if (searchSpace.ValueKind != JsonValueKind.Object)
        {
            return new StrategyValidationResult([new("searchSpace", "Search space must be an object.")]);
        }

        var errors = new List<StrategyValidationError>();
        var parameterMode = ReadString(searchSpace, "parameterMode", string.Empty);
        if (parameterMode is not ("simple" or "detailed"))
        {
            errors.Add(new("parameterMode", "Parameter mode must be simple or detailed."));
        }

        var levelCount = ReadInt(searchSpace, "levelCount", 0);
        if (levelCount is < 1 or > 10)
        {
            errors.Add(new("levelCount", "Level count must be between 1 and 10."));
        }

        var minEntryDelta = ReadDouble(searchSpace, "minEntryDelta", double.NaN);
        if (!double.IsFinite(minEntryDelta) || minEntryDelta < 0)
        {
            errors.Add(new("minEntryDelta", "Minimum entry delta must be non-negative."));
        }

        var maxTotalWeight = ReadDouble(searchSpace, "maxTotalWeight", double.NaN);
        if (!double.IsFinite(maxTotalWeight) || maxTotalWeight <= 0)
        {
            errors.Add(new("maxTotalWeight", "Maximum total weight must be positive."));
        }

        ValidateRange(searchSpace, "takeProfit", 0, null, errors);

        var searchMode = ReadString(searchSpace, "searchMode", string.Empty);
        if (searchMode is not ("random" or "full"))
        {
            errors.Add(new("searchMode", "Search mode must be random or full."));
        }

        var maxCandidates = ReadInt(searchSpace, "maxCandidates", 0);
        if (maxCandidates < 1)
        {
            errors.Add(new("maxCandidates", "Maximum candidate count must be at least one."));
        }

        if (parameterMode == "simple")
        {
            ValidateRange(searchSpace, "drawdown", double.Epsilon, 100, errors);
            ValidateRange(searchSpace, "weight", 0, null, errors);
        }
        else if (parameterMode == "detailed")
        {
            ValidateDetailedLevels(searchSpace, levelCount, errors);
        }

        if (errors.Count > 0)
        {
            return new StrategyValidationResult(errors);
        }

        var config = ReadSearchConfig(searchSpace);
        if (!HasFeasibleSequence(config.Levels.Select(level => level.Drawdowns).ToArray(), config.MinEntryDelta, requireStrictIncrease: true))
        {
            errors.Add(new("drawdown", "The selected drawdown ranges cannot satisfy the level count and minimum entry delta."));
        }
        if (!HasFeasibleSequence(config.Levels.Select(level => level.Weights).ToArray(), 0))
        {
            errors.Add(new("weight", "The selected weight ranges cannot produce nondecreasing target weights within the maximum total weight."));
        }

        return errors.Count == 0 ? StrategyValidationResult.Valid : new StrategyValidationResult(errors);
    }

    public long? EstimateCandidateCount(JsonElement searchSpace)
    {
        var validation = ValidateSearchSpace(searchSpace);
        if (!validation.IsValid)
        {
            return null;
        }

        var config = ReadSearchConfig(searchSpace);
        return config.SearchMode == "random" ? config.MaxCandidates : null;
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

        var config = ReadSearchConfig(searchSpace);
        if (config.SearchMode == "random")
        {
            var random = new Random(seed);
            for (var index = 0; index < config.MaxCandidates; index++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!TryBuildRandomSequence(config.Levels.Select(level => level.Drawdowns).ToArray(), config.MinEntryDelta, requireStrictIncrease: true, random, out var drawdowns) ||
                    !TryBuildRandomSequence(config.Levels.Select(level => level.Weights).ToArray(), 0, requireStrictIncrease: false, random, out var weights))
                {
                    throw new StrategyParameterException([new("searchSpace", "The selected MDD ranges cannot produce a valid candidate.")]);
                }

                var levels = drawdowns
                    .Select((drawdown, levelIndex) => new CandidateLevel(drawdown, weights[levelIndex]))
                    .ToArray();
                var takeProfit = config.TakeProfits[random.Next(config.TakeProfits.Length)];
                yield return ToParameters(levels, takeProfit);
            }
            yield break;
        }

        foreach (var levels in GenerateFullLevelSets(config, cancellationToken))
        {
            foreach (var takeProfit in config.TakeProfits)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return ToParameters(levels, takeProfit);
            }
        }
    }

    public ValueTask<StrategyCalculationResult> CalculateAsync(
        IStrategyPreparedData preparedData,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var prepared = GetPrepared(preparedData);
        var (levels, takeProfit) = ReadValidatedParameters(parameters);
        var rows = new StrategyResultPoint[prepared.Source.Count];
        var summary = CalculateSummary(prepared, levels, takeProfit, rows, cancellationToken);
        return ValueTask.FromResult(new StrategyCalculationResult(rows, summary));
    }

    public ValueTask<StrategyRunSummary> CalculateSummaryAsync(
        IStrategyPreparedData preparedData,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var prepared = GetPrepared(preparedData);
        var (levels, takeProfit) = ReadValidatedParameters(parameters);
        return ValueTask.FromResult(CalculateSummary(prepared, levels, takeProfit, null, cancellationToken));
    }

    private static PreparedData GetPrepared(IStrategyPreparedData preparedData) =>
        preparedData as PreparedData
        ?? throw new InvalidOperationException("MDD Mean Reversion was given incompatible prepared data.");

    private static (Level[] Levels, double TakeProfit) ReadValidatedParameters(JsonElement parameters)
    {
        var validation = ValidateParametersCore(parameters);
        if (!validation.IsValid)
        {
            throw new StrategyParameterException(validation.Errors);
        }

        return (ReadLevels(parameters, []).OrderByDescending(level => level.Drawdown).ToArray(), ReadDouble(parameters, "takeProfit", 0.01));
    }

    private static StrategyRunSummary CalculateSummary(
        PreparedData prepared,
        IReadOnlyList<Level> levels,
        double takeProfit,
        StrategyResultPoint[]? rows,
        CancellationToken cancellationToken)
    {
        var position = 0d;
        double? pendingPosition = null;
        var waitingTakeProfit = false;
        double? takeProfitStartEquity = null;
        var buyCount = 0;
        var sellCount = 0;
        var localMinEquity = prepared.BaseMetrics.Rows.Count > 0 ? 1 + prepared.BaseMetrics.Rows[0].Accum : 1;
        var accum = 0d;
        var highWaterMark = 0d;
        var maxDrawdown = 0d;

        for (var index = 0; index < prepared.Source.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (pendingPosition is double nextPosition)
            {
                position = nextPosition;
                pendingPosition = null;
            }

            var diff = prepared.Source[index].Diff * position;
            var baseRow = prepared.BaseMetrics.Rows[index];
            var equity = 1 + baseRow.Accum;
            var hwmEquity = 1 + baseRow.HighWaterMark;
            var dd = hwmEquity == 0 ? 0 : (equity / hwmEquity) - 1;
            if (dd >= 0) localMinEquity = equity;
            else localMinEquity = Math.Min(localMinEquity, equity);
            var localMdd = dd >= 0 ? 0 : (localMinEquity / hwmEquity) - 1;

            if (waitingTakeProfit && dd < 0)
            {
                waitingTakeProfit = false;
                takeProfitStartEquity = null;
            }

            if (waitingTakeProfit && takeProfitStartEquity is double startEquity)
            {
                if (equity >= startEquity * (1 + takeProfit) && position > 0)
                {
                    pendingPosition = 0;
                    waitingTakeProfit = false;
                    takeProfitStartEquity = null;
                    sellCount++;
                }
            }
            else if (dd >= 0 && position > 0)
            {
                if (takeProfit == 0)
                {
                    pendingPosition = 0;
                    sellCount++;
                }
                else
                {
                    waitingTakeProfit = true;
                    takeProfitStartEquity = equity;
                }
            }
            else if (dd < 0)
            {
                var target = levels.LastOrDefault(level => localMdd <= level.Drawdown);
                if (target is not null && target.Weight > position)
                {
                    pendingPosition = target.Weight;
                    buyCount++;
                }
            }

            if (index > 0)
            {
                accum = (1 + diff) * (1 + accum) - 1;
            }
            highWaterMark = Math.Max(highWaterMark, accum);
            var strategyDrawdown = (1 + accum) / (1 + highWaterMark) - 1;
            maxDrawdown = Math.Min(maxDrawdown, strategyDrawdown);

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

    private static void ValidateDetailedLevels(
        JsonElement searchSpace,
        int levelCount,
        List<StrategyValidationError> errors)
    {
        if (!searchSpace.TryGetProperty("levels", out var levels) || levels.ValueKind != JsonValueKind.Array)
        {
            errors.Add(new("levels", "Detailed mode requires a levels array."));
            return;
        }

        if (levels.GetArrayLength() != levelCount)
        {
            errors.Add(new("levels", "Detailed mode must contain one range group per entry level."));
            return;
        }

        var index = 0;
        foreach (var level in levels.EnumerateArray())
        {
            if (level.ValueKind != JsonValueKind.Object)
            {
                errors.Add(new($"levels.{index}", "Each detailed level must be an object."));
            }
            else
            {
                ValidateRange(level, "drawdown", double.Epsilon, 100, errors, $"levels.{index}.drawdown");
                ValidateRange(level, "weight", 0, null, errors, $"levels.{index}.weight");
            }
            index++;
        }
    }

    private static void ValidateRange(
        JsonElement owner,
        string name,
        double minimum,
        double? maximum,
        List<StrategyValidationError> errors,
        string? errorPath = null)
    {
        if (!owner.TryGetProperty(name, out var range) || range.ValueKind != JsonValueKind.Object ||
            !range.TryGetProperty("from", out var fromProperty) || !fromProperty.TryGetDecimal(out var from) ||
            !range.TryGetProperty("to", out var toProperty) || !toProperty.TryGetDecimal(out var to) ||
            !range.TryGetProperty("step", out var stepProperty) || !stepProperty.TryGetDecimal(out var step))
        {
            errors.Add(new(errorPath ?? name, "A range with from, to, and step is required."));
            return;
        }

        var fromDouble = (double)from;
        var toDouble = (double)to;
        var stepDouble = (double)step;
        if (!double.IsFinite(fromDouble) || !double.IsFinite(toDouble) || !double.IsFinite(stepDouble) ||
            fromDouble < minimum || toDouble < minimum || (maximum is double max && toDouble > max) ||
            from > to || step <= 0)
        {
            var maximumText = maximum is double value ? $" and {value}" : string.Empty;
            errors.Add(new(errorPath ?? name, $"Range must be at least {minimum}{maximumText} with a positive step."));
        }
    }

    private static SearchConfig ReadSearchConfig(JsonElement searchSpace)
    {
        var parameterMode = ReadString(searchSpace, "parameterMode", "simple");
        var levelCount = ReadInt(searchSpace, "levelCount", 1);
        var maxTotalWeight = ReadDouble(searchSpace, "maxTotalWeight", 100);
        SearchLevelSpace[] levels;
        if (parameterMode == "detailed")
        {
            levels = searchSpace.GetProperty("levels")
                .EnumerateArray()
                .Select(level => new SearchLevelSpace(
                    ReadRangeValues(level, "drawdown"),
                    ReadRangeValues(level, "weight").Where(weight => weight <= maxTotalWeight).ToArray()))
                .ToArray();
        }
        else
        {
            var drawdowns = ReadRangeValues(searchSpace, "drawdown");
            var weights = ReadRangeValues(searchSpace, "weight").Where(weight => weight <= maxTotalWeight).ToArray();
            levels = Enumerable.Range(0, levelCount)
                .Select(_ => new SearchLevelSpace(drawdowns, weights))
                .ToArray();
        }

        return new SearchConfig(
            levels,
            ReadRangeValues(searchSpace, "takeProfit"),
            ReadDouble(searchSpace, "minEntryDelta", 0),
            ReadString(searchSpace, "searchMode", "random"),
            ReadInt(searchSpace, "maxCandidates", 1));
    }

    private static double[] ReadRangeValues(JsonElement owner, string name)
    {
        var range = owner.GetProperty(name);
        var from = range.GetProperty("from").GetDecimal();
        var to = range.GetProperty("to").GetDecimal();
        var step = range.GetProperty("step").GetDecimal();
        var values = new List<double>();
        for (var value = from; value <= to; value += step)
        {
            values.Add((double)value);
        }
        return values.ToArray();
    }

    private static bool HasFeasibleSequence(
        IReadOnlyList<double[]> choices,
        double minimumDelta,
        bool requireStrictIncrease = false)
    {
        if (choices.Any(values => values.Length == 0))
        {
            return false;
        }

        return CanComplete(0, 0, false);

        bool CanComplete(int levelIndex, double previous, bool hasPrevious)
        {
            if (levelIndex == choices.Count)
            {
                return true;
            }

            foreach (var candidate in choices[levelIndex])
            {
                if ((!hasPrevious || (candidate >= previous + minimumDelta &&
                    (!requireStrictIncrease || candidate > previous))) &&
                    CanComplete(levelIndex + 1, candidate, true))
                {
                    return true;
                }
            }
            return false;
        }
    }

    private static bool TryBuildRandomSequence(
        IReadOnlyList<double[]> choices,
        double minimumDelta,
        bool requireStrictIncrease,
        Random random,
        out double[] sequence)
    {
        var values = new double[choices.Count];
        var success = Build(0, 0, false);
        sequence = values;
        return success;

        bool Build(int levelIndex, double previous, bool hasPrevious)
        {
            if (levelIndex == choices.Count)
            {
                return true;
            }

            var candidates = choices[levelIndex];
            var startIndex = random.Next(candidates.Length);
            for (var offset = 0; offset < candidates.Length; offset++)
            {
                var candidate = candidates[(startIndex + offset) % candidates.Length];
                if (hasPrevious && (candidate < previous + minimumDelta ||
                    (requireStrictIncrease && candidate <= previous)))
                {
                    continue;
                }
                values[levelIndex] = candidate;
                if (Build(levelIndex + 1, candidate, true))
                {
                    return true;
                }
            }
            return false;
        }
    }

    private static IEnumerable<CandidateLevel[]> GenerateFullLevelSets(
        SearchConfig config,
        CancellationToken cancellationToken)
    {
        var drawdowns = new double[config.Levels.Count];
        var weights = new double[config.Levels.Count];
        return Traverse(0, 0, 0, false);

        IEnumerable<CandidateLevel[]> Traverse(
            int levelIndex,
            double previousDrawdown,
            double previousWeight,
            bool hasPrevious)
        {
            if (levelIndex == config.Levels.Count)
            {
                yield return drawdowns
                    .Select((drawdown, index) => new CandidateLevel(drawdown, weights[index]))
                    .ToArray();
                yield break;
            }

            foreach (var drawdown in config.Levels[levelIndex].Drawdowns)
            {
                if (hasPrevious && (drawdown < previousDrawdown + config.MinEntryDelta || drawdown <= previousDrawdown))
                {
                    continue;
                }

                foreach (var weight in config.Levels[levelIndex].Weights)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (hasPrevious && weight < previousWeight)
                    {
                        continue;
                    }

                    drawdowns[levelIndex] = drawdown;
                    weights[levelIndex] = weight;
                    foreach (var result in Traverse(levelIndex + 1, drawdown, weight, true))
                    {
                        yield return result;
                    }
                }
            }
        }
    }

    private static JsonElement ToParameters(IReadOnlyList<CandidateLevel> levels, double takeProfit) =>
        JsonSerializer.SerializeToElement(new
        {
            levels = levels.Select(level => new
            {
                drawdown = -level.DrawdownPercent / 100d,
                weight = level.WeightPercent / 100d
            }).ToArray(),
            takeProfit = takeProfit / 100d
        });

    private static List<Level> ReadLevels(JsonElement parameters, List<StrategyValidationError> errors)
    {
        var levels = new List<Level>();
        if (!parameters.TryGetProperty("levels", out var rawLevels) || rawLevels.ValueKind != JsonValueKind.Array)
        {
            errors.Add(new("levels", "Levels must be an array."));
            return levels;
        }

        var previousWeight = double.NegativeInfinity;
        var drawdowns = new HashSet<double>();
        foreach (var rawLevel in rawLevels.EnumerateArray())
        {
            var drawdown = ReadDouble(rawLevel, "drawdown", double.NaN);
            var weight = ReadDouble(rawLevel, "weight", double.NaN);
            if (!double.IsFinite(drawdown) || drawdown >= 0)
            {
                errors.Add(new("levels.drawdown", "Drawdown level must be negative."));
                continue;
            }
            if (!double.IsFinite(weight) || weight < 0)
            {
                errors.Add(new("levels.weight", "Target weight must be non-negative."));
                continue;
            }
            if (!drawdowns.Add(drawdown))
            {
                errors.Add(new("levels.drawdown", "Drawdown levels must be unique."));
                continue;
            }
            if (weight < previousWeight)
            {
                errors.Add(new("levels.weight", "Target weights must be nondecreasing."));
                continue;
            }
            previousWeight = weight;
            levels.Add(new Level(drawdown, weight));
        }
        return levels;
    }

    private static int ReadInt(JsonElement parameters, string name, int fallback) =>
        parameters.TryGetProperty(name, out var property) && property.TryGetInt32(out var value) ? value : fallback;

    private static double ReadDouble(JsonElement parameters, string name, double fallback) =>
        parameters.TryGetProperty(name, out var property) && property.TryGetDouble(out var value) ? value : fallback;

    private static string ReadString(JsonElement parameters, string name, string fallback) =>
        parameters.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString() ?? fallback
            : fallback;

    private sealed record Level(double Drawdown, double Weight);

    private sealed record CandidateLevel(double DrawdownPercent, double WeightPercent);

    private sealed record SearchLevelSpace(double[] Drawdowns, double[] Weights);

    private sealed record SearchConfig(
        IReadOnlyList<SearchLevelSpace> Levels,
        double[] TakeProfits,
        double MinEntryDelta,
        string SearchMode,
        int MaxCandidates);

    private sealed record PreparedData(IReadOnlyList<StrategySourcePoint> Source, CalculationSeries BaseMetrics) : IStrategyPreparedData;
}
