using System.Text.Json;
using MetaEngine.Domain;
using MetaEngine.Domain.Calculations;

namespace MetaEngine.DomainTests;

public sealed class PresetCalculationEngineTests
{
    private readonly PresetCalculationEngine engine = new();

    [Fact]
    public void Preset_calculation_matches_the_shared_golden_contract()
    {
        using var fixture = LoadFixture();
        var root = fixture.RootElement;
        var input = root.GetProperty("input");
        var request = new PresetCalculationRequest(
            input.GetProperty("items")
                .EnumerateArray()
                .Select(ToItem)
                .ToArray(),
            input.GetProperty("periodStart").GetInt64(),
            input.GetProperty("periodEnd").GetInt64(),
            input.GetProperty("targetTimeframe").GetString()!);

        var result = engine.Calculate(request);
        var expected = root.GetProperty("expected");
        var tolerance = root.GetProperty("absoluteTolerance").GetDouble();

        var expectedRows = expected.GetProperty("rows").EnumerateArray().ToArray();
        Assert.Equal(expectedRows.Length, result.Rows.Count);
        for (var index = 0; index < expectedRows.Length; index++)
        {
            var actual = result.Rows[index];
            var expectedRow = expectedRows[index];
            Assert.Equal(expectedRow.GetProperty("timestamp").GetInt64(), actual.Timestamp);
            AssertClose(expectedRow.GetProperty("diff").GetDouble(), actual.Diff, tolerance);
            AssertClose(expectedRow.GetProperty("accum").GetDouble(), actual.Accum, tolerance);
            AssertClose(expectedRow.GetProperty("hwm").GetDouble(), actual.HighWaterMark, tolerance);
            AssertClose(expectedRow.GetProperty("dd").GetDouble(), actual.Drawdown, tolerance);
            AssertClose(expectedRow.GetProperty("mdd").GetDouble(), actual.MaxDrawdown, tolerance);
        }

        var expectedSummary = expected.GetProperty("summary");
        Assert.Equal(expectedSummary.GetProperty("points").GetInt32(), result.Summary.PointCount);
        AssertClose(expectedSummary.GetProperty("finalAccum").GetDouble(), result.Summary.FinalAccum, tolerance);
        AssertClose(expectedSummary.GetProperty("hwm").GetDouble(), result.Summary.HighWaterMark, tolerance);
        AssertClose(expectedSummary.GetProperty("maxDrawdown").GetDouble(), result.Summary.MaxDrawdown, tolerance);
        Assert.Equal(expected.GetProperty("sourceTimeframe").GetString(), result.SourceTimeframe);
        Assert.Equal(expected.GetProperty("timeframe").GetString(), result.Timeframe);
        Assert.Equal(expected.GetProperty("sourceStepMilliseconds").GetInt64(), result.SourceStepMilliseconds);
        Assert.Equal(expected.GetProperty("missingPointCount").GetInt64(), result.MissingPointCount);
        Assert.Equal(expected.GetProperty("warningsTruncated").GetBoolean(), result.WarningsTruncated);
        var warning = Assert.Single(result.Warnings);
        Assert.Equal("missing_diff_zero", warning.Code);
        Assert.Equal(1_704_074_400_000L, warning.Timestamp);
    }

    [Fact]
    public void Preset_allows_leveraged_total_weight()
    {
        var start = Timestamp(2024, 1, 1);
        var result = engine.Calculate(new PresetCalculationRequest(
        [
            new PresetCalculationItem(
                Guid.CreateVersion7(),
                [new ReturnPoint(start, 0), new ReturnPoint(start + Hour, 0.01)],
                CalculationTimeframes.OneHour,
                2.5,
                start,
                null)
        ],
        start,
        start + Hour,
        CalculationTimeframes.OneHour));

        AssertClose(0.025, result.Rows[1].Diff, 1e-12);
    }

    [Fact]
    public void Same_portfolio_periods_must_not_overlap()
    {
        var start = Timestamp(2024, 1, 1);
        var portfolioId = Guid.CreateVersion7();
        var exception = Assert.Throws<CalculationValidationException>(() =>
            engine.Calculate(new PresetCalculationRequest(
            [
                new PresetCalculationItem(
                    portfolioId,
                    [new ReturnPoint(start, 0)],
                    CalculationTimeframes.OneHour,
                    0.5,
                    start,
                    start + 2 * Hour),
                new PresetCalculationItem(
                    portfolioId,
                    [new ReturnPoint(start + Hour, 0)],
                    CalculationTimeframes.OneHour,
                    0.5,
                    start + Hour,
                    null)
            ],
            start,
            start + 2 * Hour,
            CalculationTimeframes.OneHour)));

        Assert.Equal("overlapping_portfolio_periods", exception.Code);
    }

    [Fact]
    public void Coarser_source_only_reports_missing_points_on_its_own_grid()
    {
        var start = Timestamp(2024, 1, 1);
        var result = engine.Calculate(new PresetCalculationRequest(
        [
            new PresetCalculationItem(
                Guid.CreateVersion7(),
                [new ReturnPoint(start, 0), new ReturnPoint(start + Hour, 0.02)],
                CalculationTimeframes.OneHour,
                1,
                start,
                null),
            new PresetCalculationItem(
                Guid.CreateVersion7(),
                Enumerable.Range(0, 13)
                    .Where(index => index != 6)
                    .Select(index => new ReturnPoint(start + index * FiveMinutes, 0))
                    .ToArray(),
                CalculationTimeframes.FiveMinutes,
                1,
                start,
                null)
        ],
        start,
        start + Hour,
        CalculationTimeframes.FiveMinutes));

        Assert.Equal(1, result.MissingPointCount);
        Assert.Single(result.Warnings);
        Assert.Equal(start + 30 * 60_000, result.Warnings[0].Timestamp);
        AssertClose(0.02, result.Rows[^1].Diff, 1e-12);
    }

    private static PresetCalculationItem ToItem(JsonElement item)
    {
        var timestamps = item.GetProperty("timestamps").EnumerateArray().ToArray();
        var diffs = item.GetProperty("diffs").EnumerateArray().ToArray();
        return new PresetCalculationItem(
            Guid.Parse(item.GetProperty("portfolioId").GetString()!),
            timestamps
                .Select((timestamp, index) => new ReturnPoint(timestamp.GetInt64(), diffs[index].GetDouble()))
                .ToArray(),
            item.GetProperty("sourceTimeframe").GetString()!,
            item.GetProperty("weight").GetDouble(),
            item.GetProperty("startsAt").GetInt64(),
            item.GetProperty("endsAt").ValueKind == JsonValueKind.Null
                ? null
                : item.GetProperty("endsAt").GetInt64());
    }

    private static JsonDocument LoadFixture()
    {
        var file = Path.Combine(AppContext.BaseDirectory, "Fixtures", "Golden", "preset_calculation.json");
        return JsonDocument.Parse(File.ReadAllText(file));
    }

    private static void AssertClose(double expected, double actual, double tolerance) =>
        Assert.InRange(actual, expected - tolerance, expected + tolerance);

    private const long Hour = 60 * 60_000;
    private const long FiveMinutes = 5 * 60_000;

    private static long Timestamp(int year, int month, int day) =>
        new DateTimeOffset(year, month, day, 0, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();
}
