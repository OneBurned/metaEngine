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
        var deals = ReadDeals(parameters, errors);
        if (deals.Count == 0)
        {
            errors.Add(new("deals", "At least one MDD deal is required."));
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

        ValidateRange(searchSpace, searchSpace.TryGetProperty("exitValue", out _) ? "exitValue" : "takeProfit", 0, null, errors);

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
        if (config.Levels.Any(level => level.Weights.Length == 0))
        {
            errors.Add(new("weight", "The selected weight ranges must contain at least one weight."));
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
                if (!TryBuildRandomSequence(config.Levels.Select(level => level.Drawdowns).ToArray(), config.MinEntryDelta, requireStrictIncrease: true, random, out var drawdowns))
                {
                    throw new StrategyParameterException([new("searchSpace", "The selected MDD ranges cannot produce a valid candidate.")]);
                }
                var weights = config.Levels.Select(level => level.Weights[random.Next(level.Weights.Length)]).ToArray();

                var levels = drawdowns
                    .Select((drawdown, levelIndex) => new CandidateLevel(drawdown, weights[levelIndex]))
                    .ToArray();
                var exitValue = config.ExitValues[random.Next(config.ExitValues.Length)];
                yield return ToParameters(levels, exitValue);
            }
            yield break;
        }

        foreach (var levels in GenerateFullLevelSets(config, cancellationToken))
        {
            foreach (var exitValue in config.ExitValues)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return ToParameters(levels, exitValue);
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
        var deals = ReadValidatedParameters(parameters);
        var rows = new StrategyResultPoint[prepared.Source.Count];
        var summary = CalculateSummary(prepared, deals, rows, cancellationToken);
        return ValueTask.FromResult(new StrategyCalculationResult(rows, summary));
    }

    public ValueTask<StrategyRunSummary> CalculateSummaryAsync(
        IStrategyPreparedData preparedData,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var prepared = GetPrepared(preparedData);
        var deals = ReadValidatedParameters(parameters);
        return ValueTask.FromResult(CalculateSummary(prepared, deals, null, cancellationToken));
    }

    private static PreparedData GetPrepared(IStrategyPreparedData preparedData) =>
        preparedData as PreparedData
        ?? throw new InvalidOperationException("MDD Mean Reversion was given incompatible prepared data.");

    private static Deal[] ReadValidatedParameters(JsonElement parameters)
    {
        var validation = ValidateParametersCore(parameters);
        if (!validation.IsValid)
        {
            throw new StrategyParameterException(validation.Errors);
        }

        return ReadDeals(parameters, []).OrderByDescending(deal => deal.EntryDrawdown).ToArray();
    }

    private static StrategyRunSummary CalculateSummary(
        PreparedData prepared,
        IReadOnlyList<Deal> deals,
        StrategyResultPoint[]? rows,
        CancellationToken cancellationToken)
    {
        var states = deals.Select(deal => new DealState(deal)).ToArray();
        var pendingEvents = new List<PendingEvent>();
        var buyCount = 0;
        var sellCount = 0;
        var maxRealizedWeight = 0d;
        var maxConfigWeight = deals.Sum(deal => deal.Weight);
        var localMinEquity = prepared.BaseMetrics.Rows.Count > 0 ? 1 + prepared.BaseMetrics.Rows[0].Accum : 1;
        var accum = 0d;
        var highWaterMark = 0d;
        var maxDrawdown = 0d;

        for (var index = 0; index < prepared.Source.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var executions = new List<string>();
            foreach (var pending in pendingEvents)
            {
                var state = states[pending.DealIndex];
                if (pending.Kind == PendingEventKind.Open && !state.IsActive)
                {
                    state.IsActive = true;
                    state.SourceHwmStartEquity = null;
                    state.StrategyHwmStartEquity = null;
                    buyCount++;
                    executions.Add($"OPEN #{pending.DealIndex + 1} +{FormatPercent(state.Deal.Weight)}");
                }
                else if (pending.Kind == PendingEventKind.Close && state.IsActive)
                {
                    state.IsActive = false;
                    state.SourceHwmStartEquity = null;
                    state.StrategyHwmStartEquity = null;
                    sellCount++;
                    executions.Add($"CLOSE #{pending.DealIndex + 1} -{FormatPercent(state.Deal.Weight)}");
                }
            }
            pendingEvents.Clear();

            var activeWeight = states.Where(state => state.IsActive).Sum(state => state.Deal.Weight);
            maxRealizedWeight = Math.Max(maxRealizedWeight, activeWeight);
            var diff = prepared.Source[index].Diff * activeWeight;
            if (index > 0)
            {
                accum = (1 + diff) * (1 + accum) - 1;
            }
            highWaterMark = Math.Max(highWaterMark, accum);
            var strategyDrawdown = (1 + accum) / (1 + highWaterMark) - 1;
            maxDrawdown = Math.Min(maxDrawdown, strategyDrawdown);

            var baseRow = prepared.BaseMetrics.Rows[index];
            var equity = 1 + baseRow.Accum;
            var hwmEquity = 1 + baseRow.HighWaterMark;
            var dd = hwmEquity == 0 ? 0 : (equity / hwmEquity) - 1;
            if (dd >= 0)
            {
                localMinEquity = equity;
                foreach (var state in states)
                {
                    state.OpenedInCycle = false;
                }
            }
            else
            {
                localMinEquity = Math.Min(localMinEquity, equity);
            }
            var localMdd = dd >= 0 ? 0 : (localMinEquity / hwmEquity) - 1;

            var signals = new List<string>();
            for (var dealIndex = 0; dealIndex < states.Length; dealIndex++)
            {
                var state = states[dealIndex];
                if (!state.IsActive && !state.OpenedInCycle && localMdd <= state.Deal.EntryDrawdown)
                {
                    state.OpenedInCycle = true;
                    pendingEvents.Add(new(PendingEventKind.Open, dealIndex));
                    signals.Add($"IN #{dealIndex + 1} +{FormatPercent(state.Deal.Weight)}");
                }
            }

            for (var dealIndex = 0; dealIndex < states.Length; dealIndex++)
            {
                var state = states[dealIndex];
                if (!state.IsActive || pendingEvents.Any(item => item.Kind == PendingEventKind.Close && item.DealIndex == dealIndex))
                {
                    continue;
                }

                if (ShouldClose(state, dd, equity, strategyDrawdown, 1 + accum))
                {
                    pendingEvents.Add(new(PendingEventKind.Close, dealIndex));
                    signals.Add($"EXIT #{dealIndex + 1}");
                }
            }

            if (rows is not null)
            {
                rows[index] = new StrategyResultPoint(
                    prepared.Source[index].Timestamp,
                    diff,
                    new Dictionary<string, JsonElement>
                    {
                        ["base_dd"] = JsonSerializer.SerializeToElement(dd),
                        ["local_mdd"] = JsonSerializer.SerializeToElement(localMdd),
                        ["signal"] = JsonSerializer.SerializeToElement(string.Join(" - ", signals)),
                        ["execution"] = JsonSerializer.SerializeToElement(string.Join(" - ", executions)),
                        ["position"] = JsonSerializer.SerializeToElement(activeWeight),
                        ["active_deals"] = JsonSerializer.SerializeToElement(string.Join(", ", states.Select((state, stateIndex) => state.IsActive ? (stateIndex + 1).ToString() : string.Empty).Where(value => value.Length > 0))),
                        ["max_config_weight"] = JsonSerializer.SerializeToElement(maxConfigWeight),
                        ["max_realized_weight"] = JsonSerializer.SerializeToElement(maxRealizedWeight),
                        ["strategy_accum"] = JsonSerializer.SerializeToElement(accum),
                        ["strategy_hwm"] = JsonSerializer.SerializeToElement(highWaterMark),
                        ["strategy_dd"] = JsonSerializer.SerializeToElement(strategyDrawdown),
                        ["strategy_mdd"] = JsonSerializer.SerializeToElement(maxDrawdown)
                    });
            }
        }

        return new StrategyRunSummary(accum, highWaterMark, maxDrawdown, buyCount, sellCount);
    }

    private static bool ShouldClose(DealState state, double sourceDd, double sourceEquity, double strategyDd, double strategyEquity)
    {
        return state.Deal.ExitType switch
        {
            ExitType.SourceDrawdown => sourceDd >= state.Deal.ExitValue,
            ExitType.StrategyDrawdown => strategyDd >= state.Deal.ExitValue,
            ExitType.SourceHighWaterMark => HasReachedHwmExit(state, true, sourceDd, sourceEquity),
            ExitType.StrategyHighWaterMark => HasReachedHwmExit(state, false, strategyDd, strategyEquity),
            _ => false
        };
    }

    private static bool HasReachedHwmExit(DealState state, bool source, double drawdown, double equity)
    {
        var startEquity = source ? state.SourceHwmStartEquity : state.StrategyHwmStartEquity;
        if (drawdown < 0)
        {
            if (source) state.SourceHwmStartEquity = null;
            else state.StrategyHwmStartEquity = null;
            return false;
        }
        if (startEquity is null)
        {
            startEquity = equity;
            if (source) state.SourceHwmStartEquity = startEquity;
            else state.StrategyHwmStartEquity = startEquity;
        }
        return equity >= startEquity.Value * (1 + state.Deal.ExitValue);
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
        SearchLevelSpace[] levels;
        if (parameterMode == "detailed")
        {
            levels = searchSpace.GetProperty("levels")
                .EnumerateArray()
                .Select(level => new SearchLevelSpace(
                    ReadRangeValues(level, "drawdown"),
                    ReadRangeValues(level, "weight").ToArray()))
                .ToArray();
        }
        else
        {
            var drawdowns = ReadRangeValues(searchSpace, "drawdown");
            var weights = ReadRangeValues(searchSpace, "weight").ToArray();
            levels = Enumerable.Range(0, levelCount)
                .Select(_ => new SearchLevelSpace(drawdowns, weights))
                .ToArray();
        }

        return new SearchConfig(
            levels,
            ReadRangeValues(searchSpace, searchSpace.TryGetProperty("exitValue", out _) ? "exitValue" : "takeProfit"),
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
        return Traverse(0, 0, false);

        IEnumerable<CandidateLevel[]> Traverse(
            int levelIndex,
            double previousDrawdown,
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
                    drawdowns[levelIndex] = drawdown;
                    weights[levelIndex] = weight;
                    foreach (var result in Traverse(levelIndex + 1, drawdown, true))
                    {
                        yield return result;
                    }
                }
            }
        }
    }

    private static JsonElement ToParameters(IReadOnlyList<CandidateLevel> levels, double exitValue) =>
        JsonSerializer.SerializeToElement(new
        {
            deals = levels
                .OrderBy(level => level.DrawdownPercent)
                .Select(level => new
                {
                    entryDrawdown = -level.DrawdownPercent / 100d,
                    weight = level.WeightPercent / 100d,
                    exitType = "source_dd",
                    exitValue = exitValue / 100d
                }).ToArray()
        });

    private static List<Deal> ReadDeals(JsonElement parameters, List<StrategyValidationError> errors)
    {
        if (parameters.TryGetProperty("deals", out var rawDeals) && rawDeals.ValueKind == JsonValueKind.Array)
        {
            return ReadDealArray(rawDeals, errors);
        }

        if (parameters.TryGetProperty("levels", out var rawLevels) && rawLevels.ValueKind == JsonValueKind.Array)
        {
            var legacy = new List<Deal>();
            var seenLegacyDrawdowns = new HashSet<double>();
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
                    errors.Add(new("levels.weight", "Weight must be non-negative."));
                    continue;
                }
                if (!seenLegacyDrawdowns.Add(drawdown))
                {
                    errors.Add(new("levels.drawdown", "Drawdown levels must be unique."));
                    continue;
                }
                legacy.Add(new(drawdown, weight, ExitType.SourceDrawdown, 0));
            }
            return legacy;
        }

        errors.Add(new("deals", "Deals must be an array."));
        return [];
    }

    private static List<Deal> ReadDealArray(JsonElement rawDeals, List<StrategyValidationError> errors)
    {
        var deals = new List<Deal>();
        var seenDrawdowns = new HashSet<double>();
        foreach (var rawDeal in rawDeals.EnumerateArray())
        {
            if (rawDeal.ValueKind != JsonValueKind.Object)
            {
                errors.Add(new("deals", "Each deal must be an object."));
                continue;
            }

            var entryDrawdown = ReadDouble(rawDeal, "entryDrawdown", double.NaN);
            var weight = ReadDouble(rawDeal, "weight", double.NaN);
            var exitTypeValue = ReadString(rawDeal, "exitType", "source_dd");
            var exitValue = ReadDouble(rawDeal, "exitValue", 0);
            if (!double.IsFinite(entryDrawdown) || entryDrawdown >= 0)
            {
                errors.Add(new("deals.entryDrawdown", "Entry drawdown must be negative."));
                continue;
            }
            if (!double.IsFinite(weight) || weight < 0)
            {
                errors.Add(new("deals.weight", "Deal weight must be non-negative."));
                continue;
            }
            if (!double.IsFinite(exitValue))
            {
                errors.Add(new("deals.exitValue", "Exit value must be a finite number."));
                continue;
            }
            if (!TryReadExitType(exitTypeValue, out var exitType))
            {
                errors.Add(new("deals.exitType", "Exit type must be source_dd, strategy_dd, source_hwm, or strategy_hwm."));
                continue;
            }
            if ((exitType is ExitType.SourceHighWaterMark or ExitType.StrategyHighWaterMark) && exitValue < 0)
            {
                errors.Add(new("deals.exitValue", "HWM exit value must be non-negative."));
                continue;
            }
            if (!seenDrawdowns.Add(entryDrawdown))
            {
                errors.Add(new("deals.entryDrawdown", "Entry drawdown levels must be unique."));
                continue;
            }
            deals.Add(new(entryDrawdown, weight, exitType, exitValue));
        }
        return deals;
    }

    private static bool TryReadExitType(string value, out ExitType exitType)
    {
        exitType = value switch
        {
            "source_dd" => ExitType.SourceDrawdown,
            "strategy_dd" => ExitType.StrategyDrawdown,
            "source_hwm" => ExitType.SourceHighWaterMark,
            "strategy_hwm" => ExitType.StrategyHighWaterMark,
            _ => default
        };
        return value is "source_dd" or "strategy_dd" or "source_hwm" or "strategy_hwm";
    }

    private static string FormatPercent(double value) => FormattableString.Invariant($"{value * 100:0.########}%");

    private static int ReadInt(JsonElement parameters, string name, int fallback) =>
        parameters.TryGetProperty(name, out var property) && property.TryGetInt32(out var value) ? value : fallback;

    private static double ReadDouble(JsonElement parameters, string name, double fallback) =>
        parameters.TryGetProperty(name, out var property) && property.TryGetDouble(out var value) ? value : fallback;

    private static string ReadString(JsonElement parameters, string name, string fallback) =>
        parameters.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString() ?? fallback
            : fallback;

    private enum ExitType { SourceDrawdown, StrategyDrawdown, SourceHighWaterMark, StrategyHighWaterMark }

    private enum PendingEventKind { Open, Close }

    private sealed record Deal(double EntryDrawdown, double Weight, ExitType ExitType, double ExitValue);

    private sealed record PendingEvent(PendingEventKind Kind, int DealIndex);

    private sealed class DealState(Deal deal)
    {
        public Deal Deal { get; } = deal;
        public bool IsActive { get; set; }
        public bool OpenedInCycle { get; set; }
        public double? SourceHwmStartEquity { get; set; }
        public double? StrategyHwmStartEquity { get; set; }
    }

    private sealed record CandidateLevel(double DrawdownPercent, double WeightPercent);

    private sealed record SearchLevelSpace(double[] Drawdowns, double[] Weights);

    private sealed record SearchConfig(
        IReadOnlyList<SearchLevelSpace> Levels,
        double[] ExitValues,
        double MinEntryDelta,
        string SearchMode,
        int MaxCandidates);

    private sealed record PreparedData(IReadOnlyList<StrategySourcePoint> Source, CalculationSeries BaseMetrics) : IStrategyPreparedData;
}
