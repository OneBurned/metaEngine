using System.Text.Json;
using MetaEngine.Domain;
using MetaEngine.Domain.Calculations;
using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Strategies.MddMeanReversion;

public sealed class MddMeanReversionStrategyModule : IStrategyModule
{
    public StrategyDescriptor Descriptor { get; } = new MddMeanReversionStrategyModuleDescriptor().Descriptor;

    public StrategyValidationResult ValidateParameters(JsonElement parameters)
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
        var prepared = preparedData as PreparedData
            ?? throw new InvalidOperationException("MDD Mean Reversion was given incompatible prepared data.");
        var validation = ValidateParameters(parameters);
        if (!validation.IsValid)
        {
            throw new StrategyParameterException(validation.Errors);
        }

        var levels = ReadLevels(parameters, []).OrderByDescending(level => level.Drawdown).ToArray();
        var takeProfit = ReadDouble(parameters, "takeProfit", 0.01);
        var diffs = new double[prepared.Source.Count];
        var rows = new StrategyResultPoint[prepared.Source.Count];
        var position = 0d;
        double? pendingPosition = null;
        var waitingTakeProfit = false;
        double? takeProfitStartEquity = null;
        var buyCount = 0;
        var sellCount = 0;
        var localMinEquity = prepared.BaseMetrics.Rows.Count > 0 ? 1 + prepared.BaseMetrics.Rows[0].Accum : 1;

        for (var index = 0; index < prepared.Source.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (pendingPosition is double nextPosition)
            {
                position = nextPosition;
                pendingPosition = null;
            }
            diffs[index] = prepared.Source[index].Diff * position;

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

            rows[index] = new StrategyResultPoint(
                prepared.Source[index].Timestamp,
                diffs[index],
                new Dictionary<string, JsonElement>());
        }

        var metrics = BaseMetricsCalculator.Calculate(rows.Select(row => new ReturnPoint(row.Timestamp, row.Diff)).ToArray());
        return ValueTask.FromResult(new StrategyCalculationResult(
            rows,
            new StrategyRunSummary(
                metrics.Summary.FinalAccum,
                metrics.Summary.HighWaterMark,
                metrics.Summary.MaxDrawdown,
                buyCount,
                sellCount)));
    }

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

    private static double ReadDouble(JsonElement parameters, string name, double fallback) =>
        parameters.TryGetProperty(name, out var property) && property.TryGetDouble(out var value) ? value : fallback;

    private sealed record Level(double Drawdown, double Weight);

    private sealed record PreparedData(IReadOnlyList<StrategySourcePoint> Source, CalculationSeries BaseMetrics) : IStrategyPreparedData;
}
