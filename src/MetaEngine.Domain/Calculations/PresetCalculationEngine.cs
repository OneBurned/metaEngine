using MetaEngine.Domain;

namespace MetaEngine.Domain.Calculations;

public sealed class PresetCalculationEngine
{
    public const int MaxReportedWarnings = 100;

    public PresetCalculationResult Calculate(PresetCalculationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Items);
        CalculationTimeframes.ValidatePeriod(request.PeriodStart, request.PeriodEnd);
        if (request.Items.Count == 0)
        {
            throw new CalculationValidationException(
                "preset_items_required",
                "Preset calculation requires at least one portfolio item.");
        }

        var items = request.Items
            .Select(PrepareItem)
            .ToArray();
        ValidatePeriodsDoNotOverlap(items);

        var sourceItem = items
            .OrderBy(item => item.SourceDefinition.Rank)
            .First();
        var sourceDefinition = sourceItem.SourceDefinition;
        if (sourceDefinition.FixedMilliseconds is not long sourceStep)
        {
            throw new CalculationValidationException(
                "unsupported_source_timeframe",
                "Preset source timeframe must have a fixed duration.");
        }

        var sourceGrid = CalculationTimeframes.BuildSourceGrid(
            request.PeriodStart,
            request.PeriodEnd,
            sourceStep);
        var sourcePoints = new ReturnPoint[sourceGrid.Count];
        var warnings = new List<CalculationWarning>();
        long missingPointCount = 0;

        for (var index = 0; index < sourceGrid.Count; index++)
        {
            var timestamp = sourceGrid[index];
            var totalDiff = 0d;

            foreach (var item in items)
            {
                if (timestamp < item.StartsAt ||
                    (item.EndsAt is not null && timestamp >= item.EndsAt.Value))
                {
                    continue;
                }

                if (!item.IsSourceTimestamp(timestamp))
                {
                    continue;
                }

                if (!item.PointsByTimestamp.TryGetValue(timestamp, out var diff))
                {
                    missingPointCount++;
                    diff = 0;
                    if (warnings.Count < MaxReportedWarnings)
                    {
                        warnings.Add(new CalculationWarning(
                            "missing_diff_zero",
                            timestamp,
                            $"Portfolio {item.PortfolioId} point is missing; calculation used diff = 0."));
                    }
                }

                totalDiff += diff * item.Weight;
            }

            sourcePoints[index] = new ReturnPoint(timestamp, totalDiff);
        }

        var sourceSeries = BaseMetricsCalculator.Calculate(sourcePoints);
        var targetSeries = CalculationTimeframeConverter.Convert(
            sourceSeries,
            request.PeriodStart,
            request.PeriodEnd,
            sourceItem.SourceTimeframe,
            request.TargetTimeframe);
        return new PresetCalculationResult(
            targetSeries.Rows,
            targetSeries.Summary,
            sourceItem.SourceTimeframe,
            request.TargetTimeframe,
            sourceStep,
            missingPointCount,
            warnings,
            missingPointCount > warnings.Count);
    }

    private static PreparedItem PrepareItem(PresetCalculationItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(item.Points);
        if (!double.IsFinite(item.Weight) || item.Weight < 0)
        {
            throw new CalculationValidationException(
                "invalid_preset_weight",
                "Preset item weight must be a finite value greater than or equal to zero.");
        }

        if (item.EndsAt is not null && item.EndsAt.Value <= item.StartsAt)
        {
            throw new CalculationValidationException(
                "invalid_preset_item_period",
                "Preset item end must be after its start.");
        }

        var sourceDefinition = CalculationTimeframes.GetRequired(item.SourceTimeframe);
        if (sourceDefinition.FixedMilliseconds is null)
        {
            throw new CalculationValidationException(
                "unsupported_source_timeframe",
                "Preset source timeframe must have a fixed duration.");
        }

        var pointsByTimestamp = PortfolioCalculationEngine.BuildPointLookup(item.Points);
        var sourceStep = sourceDefinition.FixedMilliseconds.Value;
        var sourcePhase = pointsByTimestamp.Count == 0
            ? 0
            : Modulo(pointsByTimestamp.Keys.Min(), sourceStep);
        return new PreparedItem(
            item.PortfolioId,
            pointsByTimestamp,
            sourceDefinition,
            item.SourceTimeframe,
            sourceStep,
            sourcePhase,
            item.Weight,
            item.StartsAt,
            item.EndsAt);
    }

    private static void ValidatePeriodsDoNotOverlap(IReadOnlyList<PreparedItem> items)
    {
        foreach (var portfolioItems in items.GroupBy(item => item.PortfolioId))
        {
            var sorted = portfolioItems
                .OrderBy(item => item.StartsAt)
                .ThenBy(item => item.EndsAt ?? long.MaxValue)
                .ToArray();
            for (var index = 1; index < sorted.Length; index++)
            {
                var previousEnd = sorted[index - 1].EndsAt ?? long.MaxValue;
                if (sorted[index].StartsAt < previousEnd)
                {
                    throw new CalculationValidationException(
                        "overlapping_portfolio_periods",
                        $"Portfolio {portfolioItems.Key} has overlapping preset item periods.");
                }
            }
        }
    }

    private static long Modulo(long value, long divisor)
    {
        var remainder = value % divisor;
        return remainder < 0 ? remainder + divisor : remainder;
    }

    private sealed record PreparedItem(
        Guid PortfolioId,
        IReadOnlyDictionary<long, double> PointsByTimestamp,
        CalculationTimeframes.Definition SourceDefinition,
        string SourceTimeframe,
        long SourceStep,
        long SourcePhase,
        double Weight,
        long StartsAt,
        long? EndsAt)
    {
        public bool IsSourceTimestamp(long timestamp) =>
            Modulo(timestamp, SourceStep) == SourcePhase;
    }
}
