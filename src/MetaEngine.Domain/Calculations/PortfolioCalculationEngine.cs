namespace MetaEngine.Domain.Calculations;

public sealed class PortfolioCalculationEngine
{
    public const int MaxReportedWarnings = 100;

    public PortfolioCalculationResult Calculate(PortfolioCalculationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Points);
        CalculationTimeframes.ValidatePeriod(request.PeriodStart, request.PeriodEnd);

        var sourceDefinition = CalculationTimeframes.GetRequired(request.SourceTimeframe);
        var targetDefinition = CalculationTimeframes.GetRequired(request.TargetTimeframe);
        if (sourceDefinition.FixedMilliseconds is not long sourceStep)
        {
            throw new CalculationValidationException(
                "unsupported_source_timeframe",
                "Portfolio source timeframe must have a fixed duration.");
        }

        if (targetDefinition.Rank < sourceDefinition.Rank)
        {
            throw new CalculationValidationException(
                "target_timeframe_too_small",
                $"Cannot build {request.TargetTimeframe} from {request.SourceTimeframe}.");
        }

        var pointsByTimestamp = BuildPointLookup(request.Points);
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
            if (!pointsByTimestamp.TryGetValue(timestamp, out var diff))
            {
                diff = 0;
                missingPointCount++;
                if (warnings.Count < MaxReportedWarnings)
                {
                    warnings.Add(new CalculationWarning(
                        "missing_diff_zero",
                        timestamp,
                        "Portfolio point is missing; calculation used diff = 0."));
                }
            }

            sourcePoints[index] = new ReturnPoint(timestamp, diff);
        }

        var sourceSeries = BaseMetricsCalculator.Calculate(sourcePoints);
        var targetSeries = ConvertToTimeframe(
            sourceSeries,
            request.PeriodStart,
            request.PeriodEnd,
            request.TargetTimeframe);
        return new PortfolioCalculationResult(
            targetSeries.Rows,
            targetSeries.Summary,
            request.SourceTimeframe,
            request.TargetTimeframe,
            sourceStep,
            missingPointCount,
            warnings,
            missingPointCount > warnings.Count);
    }

    private static IReadOnlyDictionary<long, double> BuildPointLookup(
        IReadOnlyList<ReturnPoint> points)
    {
        var lookup = new Dictionary<long, double>(points.Count);
        foreach (var point in points)
        {
            BaseMetricsCalculator.ValidateDiff(point.Diff, point.Timestamp);
            if (!lookup.TryAdd(point.Timestamp, point.Diff))
            {
                throw new CalculationValidationException(
                    "duplicate_timestamp",
                    $"Timestamp {point.Timestamp} is duplicated.");
            }
        }

        return lookup;
    }

    private static CalculationSeries ConvertToTimeframe(
        CalculationSeries source,
        long periodStart,
        long periodEnd,
        string targetTimeframe)
    {
        var boundaries = CalculationTimeframes.BuildBoundaries(
            periodStart,
            periodEnd,
            targetTimeframe);
        if (boundaries.Count == 0)
        {
            return BaseMetricsCalculator.Calculate([]);
        }

        var sourceByTimestamp = source.Rows.ToDictionary(row => row.Timestamp);
        var targetPoints = new ReturnPoint[boundaries.Count];
        for (var index = 0; index < boundaries.Count; index++)
        {
            var timestamp = boundaries[index];
            if (!sourceByTimestamp.TryGetValue(timestamp, out var current))
            {
                throw new CalculationValidationException(
                    "period_not_aligned",
                    "Calculation period is not aligned with the source timeframe.");
            }

            var diff = 0d;
            if (index > 0)
            {
                var previous = sourceByTimestamp[boundaries[index - 1]];
                var previousEquity = 1 + previous.Accum;
                diff = previousEquity == 0
                    ? 0
                    : (1 + current.Accum) / previousEquity - 1;
            }

            targetPoints[index] = new ReturnPoint(timestamp, diff);
        }

        return BaseMetricsCalculator.Calculate(targetPoints);
    }
}
