using MetaEngine.Domain;
using MetaEngine.Domain.Calculations;

namespace MetaEngine.DomainTests;

public sealed class PortfolioCalculationEngineTests
{
    private readonly PortfolioCalculationEngine engine = new();

    [Fact]
    public void Missing_points_use_zero_diff_and_are_reported()
    {
        var start = Timestamp(2024, 1, 1);
        var result = engine.Calculate(new PortfolioCalculationRequest(
        [
            new ReturnPoint(start, 0.5),
            new ReturnPoint(start + 2 * Hour, 0.1),
            new ReturnPoint(start + 3 * Hour, -0.05)
        ],
        start,
        start + 3 * Hour,
        CalculationTimeframes.OneHour,
        CalculationTimeframes.OneHour));

        AssertClose([0d, 0d, 0.1d, -0.05d], result.Rows.Select(row => row.Diff));
        Assert.Equal(1, result.MissingPointCount);
        Assert.Single(result.Warnings);
        Assert.Equal("missing_diff_zero", result.Warnings[0].Code);
        Assert.Equal(start + Hour, result.Warnings[0].Timestamp);
    }

    [Fact]
    public void Hourly_total_loss_converts_to_finite_daily_returns()
    {
        var start = Timestamp(2024, 1, 1);
        var points = Enumerable.Range(0, 49)
            .Select(index => new ReturnPoint(
                start + index * Hour,
                index == 1 ? -1 : index > 1 ? 0.5 : 0))
            .ToArray();

        var result = engine.Calculate(new PortfolioCalculationRequest(
            points,
            start,
            start + 48 * Hour,
            CalculationTimeframes.OneHour,
            CalculationTimeframes.OneDay));

        Assert.Equal([0d, -1d, 0d], result.Rows.Select(row => row.Diff));
        Assert.Equal([0d, -1d, -1d], result.Rows.Select(row => row.Accum));
        Assert.All(result.Rows, row => Assert.True(double.IsFinite(row.Diff)));
    }

    [Fact]
    public void Target_timeframe_cannot_be_smaller_than_source()
    {
        var start = Timestamp(2024, 1, 1);
        var exception = Assert.Throws<CalculationValidationException>(() =>
            engine.Calculate(new PortfolioCalculationRequest(
                [new ReturnPoint(start, 0)],
                start,
                start,
                CalculationTimeframes.OneHour,
                CalculationTimeframes.FifteenMinutes)));

        Assert.Equal("target_timeframe_too_small", exception.Code);
    }

    [Fact]
    public void Calendar_boundaries_are_strictly_inside_the_period()
    {
        var boundaries = CalculationTimeframes.BuildBoundaries(
            Timestamp(2024, 1, 10, 13),
            Timestamp(2024, 3, 20, 18),
            CalculationTimeframes.OneMonth);

        Assert.Equal(
            [Timestamp(2024, 2, 1), Timestamp(2024, 3, 1)],
            boundaries);
    }

    [Fact]
    public void Warning_details_are_bounded_but_full_missing_count_is_preserved()
    {
        var start = Timestamp(2024, 1, 1);
        var result = engine.Calculate(new PortfolioCalculationRequest(
            [],
            start,
            start + 101 * Hour,
            CalculationTimeframes.OneHour,
            CalculationTimeframes.OneHour));

        Assert.Equal(102, result.MissingPointCount);
        Assert.Equal(PortfolioCalculationEngine.MaxReportedWarnings, result.Warnings.Count);
        Assert.True(result.WarningsTruncated);
    }

    [Fact]
    public void Oversized_grid_is_rejected_before_allocation()
    {
        var start = Timestamp(2024, 1, 1);
        var exception = Assert.Throws<CalculationValidationException>(() =>
            engine.Calculate(new PortfolioCalculationRequest(
                [],
                start,
                start + 1_000_000L * Minute,
                CalculationTimeframes.OneMinute,
                CalculationTimeframes.OneMinute)));

        Assert.Equal("calculation_grid_too_large", exception.Code);
    }

    [Fact]
    public void Unknown_timeframe_has_a_stable_validation_code()
    {
        var start = Timestamp(2024, 1, 1);
        var exception = Assert.Throws<CalculationValidationException>(() =>
            engine.Calculate(new PortfolioCalculationRequest(
                [],
                start,
                start,
                "2h",
                CalculationTimeframes.OneDay)));

        Assert.Equal("unknown_timeframe", exception.Code);
    }

    private const long Hour = 60 * 60_000;
    private const long Minute = 60_000;

    private static void AssertClose(IReadOnlyList<double> expected, IEnumerable<double> actualValues)
    {
        var actual = actualValues.ToArray();
        Assert.Equal(expected.Count, actual.Length);
        for (var index = 0; index < expected.Count; index++)
        {
            Assert.InRange(actual[index], expected[index] - 1e-12, expected[index] + 1e-12);
        }
    }

    private static long Timestamp(int year, int month, int day, int hour = 0) =>
        new DateTimeOffset(year, month, day, hour, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();
}
