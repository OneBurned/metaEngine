namespace MetaEngine.Domain.Calculations;

public static class BaseMetricsCalculator
{
    public static CalculationSeries Calculate(IReadOnlyList<ReturnPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);

        if (points.Count == 0)
        {
            return new CalculationSeries(
                [],
                new CalculationSummary(null, null, 0, 0, 0, 0));
        }

        var rows = new CalculationPoint[points.Count];
        var accum = 0d;
        var highWaterMark = 0d;
        var maxDrawdown = 0d;

        for (var index = 0; index < points.Count; index++)
        {
            var point = points[index];
            ValidatePoint(point, index == 0 ? null : points[index - 1]);

            if (index > 0)
            {
                accum = (1 + point.Diff) * (1 + accum) - 1;
                if (!double.IsFinite(accum))
                {
                    throw new CalculationValidationException(
                        "calculation_overflow",
                        $"Accumulated return is not finite at timestamp {point.Timestamp}.");
                }
            }

            highWaterMark = Math.Max(highWaterMark, accum);
            var drawdown = (1 + accum) / (1 + highWaterMark) - 1;
            maxDrawdown = Math.Min(maxDrawdown, drawdown);
            rows[index] = new CalculationPoint(
                point.Timestamp,
                point.Diff,
                accum,
                highWaterMark,
                drawdown,
                maxDrawdown);
        }

        return new CalculationSeries(
            rows,
            new CalculationSummary(
                rows[0].Timestamp,
                rows[^1].Timestamp,
                rows.Length,
                rows[^1].Accum,
                rows[^1].HighWaterMark,
                rows[^1].MaxDrawdown));
    }

    internal static void ValidateDiff(double diff, long timestamp)
    {
        if (!double.IsFinite(diff))
        {
            throw new CalculationValidationException(
                "invalid_diff",
                $"Return must be finite at timestamp {timestamp}.");
        }

        if (diff < -1)
        {
            throw new CalculationValidationException(
                "return_below_minus_one",
                $"Return cannot be less than -100% at timestamp {timestamp}.");
        }
    }

    private static void ValidatePoint(ReturnPoint point, ReturnPoint? previous)
    {
        ValidateDiff(point.Diff, point.Timestamp);
        if (previous is not null && point.Timestamp <= previous.Timestamp)
        {
            throw new CalculationValidationException(
                "timestamps_not_strictly_increasing",
                "Calculation points must have unique timestamps in ascending order.");
        }
    }
}
