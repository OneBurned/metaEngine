using MetaEngine.Domain.Model;

namespace MetaEngine.Application.Calculations;

public static class CalculationRunLimits
{
    public const int MaxResultPointPageSize = 5_000;
}

public sealed record QueueBaseCalculationCommand(
    Guid WorkspaceId,
    Guid UserId,
    CalculationInputType InputType,
    Guid InputId,
    DateTimeOffset PeriodStart,
    DateTimeOffset PeriodEnd,
    string Timeframe);

public sealed record QueueStrategyCalculationCommand(
    Guid WorkspaceId,
    Guid UserId,
    Guid SourceCalculationRunId,
    string StrategyType,
    string ParametersJson);

public sealed record CalculationRunSummary(
    Guid Id,
    CalculationRunKind Kind,
    CalculationInputType InputType,
    Guid? PortfolioId,
    Guid? PresetId,
    Guid? SourceCalculationRunId,
    DateTimeOffset PeriodStart,
    DateTimeOffset PeriodEnd,
    string Timeframe,
    JobStatus Status,
    int PointCount,
    int TradeCount,
    double? FinalAccum,
    double? HighWaterMark,
    double? MaxDrawdown,
    string? ErrorCode,
    DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    Guid? CreatedByUserId);

public sealed record CalculationArtifactSummary(
    Guid Id,
    int PointCount,
    string SeriesChecksum,
    DateTimeOffset CreatedAt);

public sealed record CalculationWarningItem(
    string Code,
    DateTimeOffset Timestamp,
    string Message);

public sealed record CalculationRunDetails(
    CalculationRunSummary Run,
    CalculationArtifactSummary? Artifact,
    IReadOnlyList<CalculationWarningItem> Warnings);

public sealed record CalculationResultPoint(
    DateTimeOffset Timestamp,
    double Diff);

public sealed record CalculationResultPage(
    int Offset,
    int Limit,
    int Total,
    IReadOnlyList<CalculationResultPoint> Items);

public interface ICalculationRunService
{
    Task<CalculationRunSummary> QueueAsync(
        QueueBaseCalculationCommand command,
        CancellationToken cancellationToken);

    Task<CalculationRunSummary> QueueStrategyAsync(
        QueueStrategyCalculationCommand command,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<CalculationRunSummary>> ListAsync(
        Guid workspaceId,
        CancellationToken cancellationToken);

    Task<CalculationRunDetails?> FindAsync(
        Guid workspaceId,
        Guid runId,
        CancellationToken cancellationToken);

    Task<CalculationResultPage?> GetResultPageAsync(
        Guid workspaceId,
        Guid runId,
        int offset,
        int limit,
        CancellationToken cancellationToken);
}

public interface ICalculationRunProcessor
{
    Task<bool> ProcessNextAsync(CancellationToken cancellationToken);
}

public sealed class CalculationRunValidationException(string code, string message)
    : Exception(message)
{
    public string Code { get; } = code;
}
