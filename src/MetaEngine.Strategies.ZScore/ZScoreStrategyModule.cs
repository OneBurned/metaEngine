using System.Text.Json;
using MetaEngine.Domain;
using MetaEngine.Domain.Calculations;
using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Strategies.ZScore;

public sealed class ZScoreStrategyModule : IStrategyModule
{
    private const int DefaultRollingWindow = 240;

    public StrategyDescriptor Descriptor { get; } = new ZScoreStrategyModuleDescriptor().Descriptor;

    public StrategyValidationResult ValidateParameters(JsonElement parameters)
        => ValidateParametersCore(parameters);

    public ValueTask<IStrategyPreparedData> PrepareAsync(
        IReadOnlyList<StrategySourcePoint> source,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var points = source.Select(point => new ReturnPoint(point.Timestamp, point.Diff)).ToArray();
        return ValueTask.FromResult<IStrategyPreparedData>(new PreparedData(source, BaseMetricsCalculator.Calculate(points)));
    }


    public async IAsyncEnumerable<JsonElement> GenerateCandidatesAsync(
        JsonElement searchSpace,
        int seed,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        await Task.CompletedTask;
        cancellationToken.ThrowIfCancellationRequested();
        yield break;
    }

    public ValueTask<StrategyCalculationResult> CalculateAsync(
        IStrategyPreparedData preparedData,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var prepared = GetPrepared(preparedData);
        var config = ReadValidatedParameters(parameters);
        var rows = new StrategyResultPoint[prepared.Source.Count];
        var summary = CalculateSummary(prepared, config, rows, cancellationToken);
        return ValueTask.FromResult(new StrategyCalculationResult(rows, summary));
    }

    public ValueTask<StrategyRunSummary> CalculateSummaryAsync(
        IStrategyPreparedData preparedData,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var prepared = GetPrepared(preparedData);
        var config = ReadValidatedParameters(parameters);
        return ValueTask.FromResult(CalculateSummary(prepared, config, null, cancellationToken));
    }

    private static PreparedData GetPrepared(IStrategyPreparedData preparedData) =>
        preparedData as PreparedData
        ?? throw new InvalidOperationException("Z-Score was given incompatible prepared data.");

    private static StrategyValidationResult ValidateParametersCore(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            return new StrategyValidationResult([new("parameters", "Parameters must be an object.")]);
        }

        var errors = new List<StrategyValidationError>();
        var rollingWindow = ReadInt(parameters, "rollingWindow", DefaultRollingWindow);
        if (rollingWindow < 2)
        {
            errors.Add(new("rollingWindow", "Rolling window must be at least 2."));
        }

        var deals = ReadDeals(parameters, errors);
        if (deals.Count == 0)
        {
            errors.Add(new("deals", "At least one Z-Score deal is required."));
        }
        return errors.Count == 0 ? StrategyValidationResult.Valid : new StrategyValidationResult(errors);
    }

    private static Config ReadValidatedParameters(JsonElement parameters)
    {
        var validation = ValidateParametersCore(parameters);
        if (!validation.IsValid)
        {
            throw new StrategyParameterException(validation.Errors);
        }

        return new Config(
            Math.Max(2, ReadInt(parameters, "rollingWindow", DefaultRollingWindow)),
            ReadDeals(parameters, []).OrderByDescending(deal => deal.EntryZScore).ToArray());
    }

    private static StrategyRunSummary CalculateSummary(
        PreparedData prepared,
        Config config,
        StrategyResultPoint[]? rows,
        CancellationToken cancellationToken)
    {
        var states = config.Deals.Select(deal => new DealState(deal)).ToArray();
        var sourceStats = BuildSourceStats(prepared, config.RollingWindow);
        var pendingEvents = new List<PendingEvent>();
        var strategyDrawdowns = new List<double>(prepared.Source.Count);
        var buyCount = 0;
        var sellCount = 0;
        var maxRealizedWeight = 0d;
        var maxConfigWeight = config.Deals.Sum(deal => deal.Weight);
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
                    executions.Add($"opened deal {pending.DealIndex + 1} +{FormatPercent(state.Deal.Weight)}");
                }
                else if (pending.Kind == PendingEventKind.Close && state.IsActive)
                {
                    state.IsActive = false;
                    state.SourceHwmStartEquity = null;
                    state.StrategyHwmStartEquity = null;
                    sellCount++;
                    executions.Add($"closed deal {pending.DealIndex + 1} -{FormatPercent(state.Deal.Weight)}");
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
            strategyDrawdowns.Add(strategyDrawdown);
            var strategyStats = CalculateRollingStats(strategyDrawdowns, index, config.RollingWindow);

            var source = sourceStats[index];
            if (source.Drawdown >= 0)
            {
                foreach (var state in states)
                {
                    state.OpenedInCycle = false;
                }
            }

            var signals = new List<string>();
            for (var dealIndex = 0; dealIndex < states.Length; dealIndex++)
            {
                var state = states[dealIndex];
                if (!state.IsActive && !state.OpenedInCycle && source.ZScore <= state.Deal.EntryZScore)
                {
                    state.OpenedInCycle = true;
                    pendingEvents.Add(new(PendingEventKind.Open, dealIndex));
                    signals.Add($"entry deal {dealIndex + 1} +{FormatPercent(state.Deal.Weight)}");
                }
            }

            for (var dealIndex = 0; dealIndex < states.Length; dealIndex++)
            {
                var state = states[dealIndex];
                if (!state.IsActive || pendingEvents.Any(item => item.Kind == PendingEventKind.Close && item.DealIndex == dealIndex))
                {
                    continue;
                }

                if (ShouldClose(state, source.ZScore, source.Equity, strategyStats.ZScore, 1 + accum, source.Drawdown, strategyDrawdown))
                {
                    pendingEvents.Add(new(PendingEventKind.Close, dealIndex));
                    signals.Add($"exit deal {dealIndex + 1} -{FormatPercent(state.Deal.Weight)}");
                }
            }

            if (rows is not null)
            {
                rows[index] = new StrategyResultPoint(
                    prepared.Source[index].Timestamp,
                    diff,
                    new Dictionary<string, JsonElement>
                    {
                        ["source_diff"] = JsonSerializer.SerializeToElement(prepared.Source[index].Diff),
                        ["source_accum"] = JsonSerializer.SerializeToElement(source.Accum),
                        ["source_dd"] = JsonSerializer.SerializeToElement(source.Drawdown),
                        ["source_dd_mean"] = JsonSerializer.SerializeToElement(source.Mean),
                        ["source_dd_std"] = JsonSerializer.SerializeToElement(source.StandardDeviation),
                        ["source_z"] = JsonSerializer.SerializeToElement(source.ZScore),
                        ["strategy_dd_mean"] = JsonSerializer.SerializeToElement(strategyStats.Mean),
                        ["strategy_dd_std"] = JsonSerializer.SerializeToElement(strategyStats.StandardDeviation),
                        ["strategy_z"] = JsonSerializer.SerializeToElement(strategyStats.ZScore),
                        ["signal"] = JsonSerializer.SerializeToElement(string.Join("; ", signals)),
                        ["execution"] = JsonSerializer.SerializeToElement(string.Join("; ", executions)),
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

    private static SourceStat[] BuildSourceStats(PreparedData prepared, int rollingWindow)
    {
        var drawdowns = new List<double>(prepared.Source.Count);
        var stats = new SourceStat[prepared.Source.Count];
        for (var index = 0; index < prepared.Source.Count; index++)
        {
            var baseRow = prepared.BaseMetrics.Rows[index];
            var equity = 1 + baseRow.Accum;
            var hwmEquity = 1 + baseRow.HighWaterMark;
            var drawdown = hwmEquity == 0 ? 0 : (equity / hwmEquity) - 1;
            drawdowns.Add(drawdown);
            var rolling = CalculateRollingStats(drawdowns, index, rollingWindow);
            stats[index] = new SourceStat(prepared.Source[index].Diff, baseRow.Accum, equity, drawdown, rolling.Mean, rolling.StandardDeviation, rolling.ZScore);
        }
        return stats;
    }

    private static RollingStat CalculateRollingStats(IReadOnlyList<double> values, int index, int rollingWindow)
    {
        if (index < rollingWindow)
        {
            return new RollingStat(null, null, 0);
        }

        var start = index - rollingWindow + 1;
        var sum = 0d;
        for (var itemIndex = start; itemIndex <= index; itemIndex++)
        {
            sum += values[itemIndex];
        }
        var mean = sum / rollingWindow;
        var squaredSum = 0d;
        for (var itemIndex = start; itemIndex <= index; itemIndex++)
        {
            var delta = values[itemIndex] - mean;
            squaredSum += delta * delta;
        }
        var standardDeviation = Math.Sqrt(squaredSum / (rollingWindow - 1));
        var zScore = standardDeviation <= 0 ? 0 : (values[index] - mean) / standardDeviation;
        return new RollingStat(mean, standardDeviation, zScore);
    }

    private static bool ShouldClose(
        DealState state,
        double sourceZScore,
        double sourceEquity,
        double strategyZScore,
        double strategyEquity,
        double sourceDrawdown,
        double strategyDrawdown)
    {
        return state.Deal.ExitType switch
        {
            ExitType.SourceZScore => sourceZScore >= state.Deal.ExitValue,
            ExitType.StrategyZScore => strategyZScore >= state.Deal.ExitValue,
            ExitType.SourceHighWaterMark => HasReachedHwmExit(state, true, sourceDrawdown, sourceEquity),
            ExitType.StrategyHighWaterMark => HasReachedHwmExit(state, false, strategyDrawdown, strategyEquity),
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

    private static List<Deal> ReadDeals(JsonElement parameters, List<StrategyValidationError> errors)
    {
        if (!parameters.TryGetProperty("deals", out var rawDeals) || rawDeals.ValueKind != JsonValueKind.Array)
        {
            errors.Add(new("deals", "Deals must be an array."));
            return [];
        }

        var deals = new List<Deal>();
        var seenZScores = new HashSet<double>();
        foreach (var rawDeal in rawDeals.EnumerateArray())
        {
            if (rawDeal.ValueKind != JsonValueKind.Object)
            {
                errors.Add(new("deals", "Each deal must be an object."));
                continue;
            }

            var entryZScore = ReadDouble(rawDeal, "entryZScore", ReadDouble(rawDeal, "entryDrawdown", double.NaN));
            var weight = ReadDouble(rawDeal, "weight", double.NaN);
            var exitTypeValue = ReadString(rawDeal, "exitType", "source_z");
            var exitValue = ReadDouble(rawDeal, "exitValue", 0);
            if (!double.IsFinite(entryZScore) || entryZScore >= 0)
            {
                errors.Add(new("deals.entryZScore", "Entry Z-score must be negative."));
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
                errors.Add(new("deals.exitType", "Exit type must be source_z, strategy_z, source_hwm, or strategy_hwm."));
                continue;
            }
            if ((exitType is ExitType.SourceHighWaterMark or ExitType.StrategyHighWaterMark) && exitValue < 0)
            {
                errors.Add(new("deals.exitValue", "HWM exit value must be non-negative."));
                continue;
            }
            if (!seenZScores.Add(entryZScore))
            {
                errors.Add(new("deals.entryZScore", "Entry Z-score levels must be unique."));
                continue;
            }
            deals.Add(new(entryZScore, weight, exitType, exitValue));
        }
        return deals;
    }

    private static bool TryReadExitType(string value, out ExitType exitType)
    {
        exitType = value switch
        {
            "source_z" => ExitType.SourceZScore,
            "strategy_z" => ExitType.StrategyZScore,
            "source_hwm" => ExitType.SourceHighWaterMark,
            "strategy_hwm" => ExitType.StrategyHighWaterMark,
            _ => default
        };
        return value is "source_z" or "strategy_z" or "source_hwm" or "strategy_hwm";
    }

    private static string FormatPercent(double value) => $"{value:P0}";

    private static int ReadInt(JsonElement parameters, string name, int fallback) =>
        parameters.TryGetProperty(name, out var property) && property.TryGetInt32(out var value) ? value : fallback;

    private static double ReadDouble(JsonElement parameters, string name, double fallback) =>
        parameters.TryGetProperty(name, out var property) && property.TryGetDouble(out var value) ? value : fallback;

    private static string ReadString(JsonElement parameters, string name, string fallback) =>
        parameters.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString() ?? fallback
            : fallback;

    private enum ExitType { SourceZScore, StrategyZScore, SourceHighWaterMark, StrategyHighWaterMark }

    private enum PendingEventKind { Open, Close }

    private sealed record Config(int RollingWindow, IReadOnlyList<Deal> Deals);

    private sealed record Deal(double EntryZScore, double Weight, ExitType ExitType, double ExitValue);

    private sealed record PendingEvent(PendingEventKind Kind, int DealIndex);

    private sealed record RollingStat(double? Mean, double? StandardDeviation, double ZScore);

    private sealed record SourceStat(double Diff, double Accum, double Equity, double Drawdown, double? Mean, double? StandardDeviation, double ZScore);

    private sealed class DealState(Deal deal)
    {
        public Deal Deal { get; } = deal;
        public bool IsActive { get; set; }
        public bool OpenedInCycle { get; set; }
        public double? SourceHwmStartEquity { get; set; }
        public double? StrategyHwmStartEquity { get; set; }
    }

    private sealed record PreparedData(IReadOnlyList<StrategySourcePoint> Source, CalculationSeries BaseMetrics) : IStrategyPreparedData;
}
