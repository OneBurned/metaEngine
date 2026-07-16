namespace MetaEngine.Domain.Calculations;

public sealed record CalculationPoint(
    long Timestamp,
    double Diff,
    double Accum,
    double HighWaterMark,
    double Drawdown,
    double MaxDrawdown);

public sealed record CalculationSummary(
    long? StartTimestamp,
    long? EndTimestamp,
    int PointCount,
    double FinalAccum,
    double HighWaterMark,
    double MaxDrawdown);

public sealed record CalculationSeries(
    IReadOnlyList<CalculationPoint> Rows,
    CalculationSummary Summary);

public sealed record PortfolioCalculationRequest(
    IReadOnlyList<ReturnPoint> Points,
    long PeriodStart,
    long PeriodEnd,
    string SourceTimeframe,
    string TargetTimeframe);

public sealed record CalculationWarning(
    string Code,
    long Timestamp,
    string Message);

public sealed record PortfolioCalculationResult(
    IReadOnlyList<CalculationPoint> Rows,
    CalculationSummary Summary,
    string SourceTimeframe,
    string Timeframe,
    long SourceStepMilliseconds,
    long MissingPointCount,
    IReadOnlyList<CalculationWarning> Warnings,
    bool WarningsTruncated);

public sealed record PresetCalculationItem(
    Guid SourceId,
    IReadOnlyList<ReturnPoint> Points,
    string SourceTimeframe,
    double Weight,
    long StartsAt,
    long? EndsAt);

public sealed record PresetCalculationRequest(
    IReadOnlyList<PresetCalculationItem> Items,
    long PeriodStart,
    long PeriodEnd,
    string TargetTimeframe);

public sealed record PresetCalculationResult(
    IReadOnlyList<CalculationPoint> Rows,
    CalculationSummary Summary,
    string SourceTimeframe,
    string Timeframe,
    long SourceStepMilliseconds,
    long MissingPointCount,
    IReadOnlyList<CalculationWarning> Warnings,
    bool WarningsTruncated);

public sealed class CalculationValidationException(string code, string message)
    : Exception(message)
{
    public string Code { get; } = code;
}
