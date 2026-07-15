using System.Globalization;
using System.Text.Json;
using MetaEngine.Domain;
using MetaEngine.Domain.Calculations;

namespace MetaEngine.DomainTests;

public sealed class BaseMetricsCalculatorTests
{
    [Fact]
    public void Base_calculation_matches_the_shared_golden_contract()
    {
        var fixturePath = Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "Golden",
            "base_metrics.json");
        using var document = JsonDocument.Parse(File.ReadAllText(fixturePath));
        var root = document.RootElement;
        var timestamps = root.GetProperty("input").GetProperty("timestamps")
            .EnumerateArray()
            .Select(value => value.GetInt64())
            .ToArray();
        var diffs = root.GetProperty("input").GetProperty("diffs")
            .EnumerateArray()
            .Select(value => value.GetDouble())
            .ToArray();
        var input = timestamps
            .Select((timestamp, index) => new ReturnPoint(timestamp, diffs[index]))
            .ToArray();

        var actual = BaseMetricsCalculator.Calculate(input);
        var expectedRows = root.GetProperty("expected").GetProperty("rows").EnumerateArray().ToArray();
        var tolerance = root.GetProperty("absoluteTolerance").GetDouble();

        Assert.Equal(expectedRows.Length, actual.Rows.Count);
        for (var index = 0; index < expectedRows.Length; index++)
        {
            var expected = expectedRows[index];
            var row = actual.Rows[index];
            Assert.Equal(expected.GetProperty("timestamp").GetInt64(), row.Timestamp);
            AssertClose(expected.GetProperty("diff").GetDouble(), row.Diff, tolerance);
            AssertClose(expected.GetProperty("accum").GetDouble(), row.Accum, tolerance);
            AssertClose(expected.GetProperty("hwm").GetDouble(), row.HighWaterMark, tolerance);
            AssertClose(expected.GetProperty("dd").GetDouble(), row.Drawdown, tolerance);
            AssertClose(expected.GetProperty("mdd").GetDouble(), row.MaxDrawdown, tolerance);
        }

        var expectedSummary = root.GetProperty("expected").GetProperty("summary");
        Assert.Equal(expectedSummary.GetProperty("start").GetString(), Format(actual.Summary.StartTimestamp));
        Assert.Equal(expectedSummary.GetProperty("end").GetString(), Format(actual.Summary.EndTimestamp));
        Assert.Equal(expectedSummary.GetProperty("points").GetInt32(), actual.Summary.PointCount);
        AssertClose(expectedSummary.GetProperty("finalAccum").GetDouble(), actual.Summary.FinalAccum, tolerance);
        AssertClose(expectedSummary.GetProperty("hwm").GetDouble(), actual.Summary.HighWaterMark, tolerance);
        AssertClose(expectedSummary.GetProperty("maxDrawdown").GetDouble(), actual.Summary.MaxDrawdown, tolerance);
    }

    [Fact]
    public void Return_below_minus_one_is_rejected()
    {
        var exception = Assert.Throws<CalculationValidationException>(() =>
            BaseMetricsCalculator.Calculate(
            [
                new ReturnPoint(0, 0),
                new ReturnPoint(1, -1.0001)
            ]));

        Assert.Equal("return_below_minus_one", exception.Code);
    }

    [Fact]
    public void Total_loss_keeps_equity_at_zero()
    {
        var result = BaseMetricsCalculator.Calculate(
        [
            new ReturnPoint(0, 0),
            new ReturnPoint(1, -1),
            new ReturnPoint(2, 0.5)
        ]);

        Assert.Equal([0d, -1d, -1d], result.Rows.Select(row => row.Accum));
        Assert.Equal(-1, result.Summary.FinalAccum);
        Assert.Equal(-1, result.Summary.MaxDrawdown);
    }

    private static void AssertClose(double expected, double actual, double tolerance) =>
        Assert.InRange(actual, expected - tolerance, expected + tolerance);

    private static string? Format(long? timestamp) =>
        timestamp is null
            ? null
            : DateTimeOffset.FromUnixTimeMilliseconds(timestamp.Value)
                .ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
}
