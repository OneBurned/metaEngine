namespace MetaEngine.Domain.Calculations;

public static class CalculationTimeframes
{
    public const string OneMinute = "1m";
    public const string FiveMinutes = "5m";
    public const string FifteenMinutes = "15m";
    public const string OneHour = "1h";
    public const string OneDay = "1d";
    public const string OneMonth = "1M";
    public const string OneYear = "1Y";

    internal const int MaxGridPoints = 1_000_000;

    private static readonly IReadOnlyDictionary<string, Definition> Definitions =
        new Dictionary<string, Definition>(StringComparer.Ordinal)
        {
            [OneMinute] = new(1, 60_000),
            [FiveMinutes] = new(5, 5 * 60_000),
            [FifteenMinutes] = new(15, 15 * 60_000),
            [OneHour] = new(60, 60 * 60_000),
            [OneDay] = new(1_440, 24 * 60 * 60_000),
            [OneMonth] = new(44_640, null),
            [OneYear] = new(525_600, null)
        };

    public static IReadOnlyList<string> Supported { get; } =
        [OneMinute, FiveMinutes, FifteenMinutes, OneHour, OneDay, OneMonth, OneYear];

    public static IReadOnlyList<long> BuildBoundaries(
        long periodStart,
        long periodEnd,
        string timeframe)
    {
        ValidatePeriod(periodStart, periodEnd);
        var definition = GetRequired(timeframe);
        return definition.FixedMilliseconds is long fixedMilliseconds
            ? BuildFixedBoundaries(periodStart, periodEnd, fixedMilliseconds)
            : BuildCalendarBoundaries(periodStart, periodEnd, timeframe);
    }

    internal static Definition GetRequired(string timeframe)
    {
        if (string.IsNullOrWhiteSpace(timeframe) ||
            !Definitions.TryGetValue(timeframe, out var definition))
        {
            throw new CalculationValidationException(
                "unknown_timeframe",
                $"Timeframe '{timeframe}' is not supported.");
        }

        return definition;
    }

    internal static void ValidatePeriod(long periodStart, long periodEnd)
    {
        if (periodStart > periodEnd)
        {
            throw new CalculationValidationException(
                "invalid_period",
                "Calculation period start must not be after its end.");
        }

        try
        {
            _ = DateTimeOffset.FromUnixTimeMilliseconds(periodStart);
            _ = DateTimeOffset.FromUnixTimeMilliseconds(periodEnd);
        }
        catch (ArgumentOutOfRangeException)
        {
            throw new CalculationValidationException(
                "invalid_period",
                "Calculation period is outside the supported timestamp range.");
        }
    }

    internal static IReadOnlyList<long> BuildSourceGrid(
        long periodStart,
        long periodEnd,
        long stepMilliseconds)
    {
        var pointCount = checked((periodEnd - periodStart) / stepMilliseconds + 1);
        EnsureGridSize(pointCount);

        var grid = new long[(int)pointCount];
        for (var index = 0; index < grid.Length; index++)
        {
            grid[index] = checked(periodStart + index * stepMilliseconds);
        }

        return grid;
    }

    private static IReadOnlyList<long> BuildFixedBoundaries(
        long periodStart,
        long periodEnd,
        long stepMilliseconds)
    {
        var first = checked((long)(Math.Ceiling((decimal)periodStart / stepMilliseconds) * stepMilliseconds));
        var last = checked((long)(Math.Floor((decimal)periodEnd / stepMilliseconds) * stepMilliseconds));
        return first > last ? [] : BuildSourceGrid(first, last, stepMilliseconds);
    }

    private static IReadOnlyList<long> BuildCalendarBoundaries(
        long periodStart,
        long periodEnd,
        string timeframe)
    {
        var start = DateTimeOffset.FromUnixTimeMilliseconds(periodStart).UtcDateTime;
        var end = DateTimeOffset.FromUnixTimeMilliseconds(periodEnd).UtcDateTime;
        var current = timeframe == OneMonth
            ? new DateTime(start.Year, start.Month, 1, 0, 0, 0, DateTimeKind.Utc)
            : new DateTime(start.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        if (current < start)
        {
            if (!TryGetNextBoundary(current, timeframe, out current))
            {
                return [];
            }
        }

        var boundaries = new List<long>();
        while (current <= end)
        {
            if (boundaries.Count >= MaxGridPoints)
            {
                throw GridTooLarge();
            }

            boundaries.Add(new DateTimeOffset(current).ToUnixTimeMilliseconds());
            if (!TryGetNextBoundary(current, timeframe, out current))
            {
                break;
            }
        }

        return boundaries;
    }

    private static bool TryGetNextBoundary(
        DateTime current,
        string timeframe,
        out DateTime next)
    {
        if ((timeframe == OneMonth && current.Year == 9999 && current.Month == 12) ||
            (timeframe == OneYear && current.Year == 9999))
        {
            next = default;
            return false;
        }

        next = timeframe == OneMonth ? current.AddMonths(1) : current.AddYears(1);
        return true;
    }

    private static void EnsureGridSize(long pointCount)
    {
        if (pointCount > MaxGridPoints)
        {
            throw GridTooLarge();
        }
    }

    private static CalculationValidationException GridTooLarge() =>
        new(
            "calculation_grid_too_large",
            $"Calculation grid cannot exceed {MaxGridPoints} points.");

    internal sealed record Definition(int Rank, long? FixedMilliseconds);
}
