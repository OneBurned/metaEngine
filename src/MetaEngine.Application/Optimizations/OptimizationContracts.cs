using MetaEngine.Application.Calculations;
using MetaEngine.Domain.Model;

namespace MetaEngine.Application.Optimizations;

public static class OptimizationJobLimits
{
    public const int MaxTopResultCount = 1_000;
}

public sealed record OptimizationFilters(
    double? MaximumDrawdownMagnitude,
    int? MinimumTradeCount,
    int? MinimumProfitableSampleCount);

public sealed record QueueOptimizationJobCommand(
    Guid WorkspaceId,
    Guid UserId,
    Guid SourceCalculationRunId,
    string StrategyType,
    string SearchSpaceJson,
    int SampleCount,
    int Seed,
    int TopCount,
    OptimizationFilters Filters);

public sealed record OptimizationJobSummary(
    Guid Id,
    Guid? SourceCalculationRunId,
    CalculationInputType InputType,
    Guid? PortfolioId,
    Guid? PresetId,
    string StrategyType,
    int StrategySchemaVersion,
    DateTimeOffset PeriodStart,
    DateTimeOffset PeriodEnd,
    string Timeframe,
    int SampleCount,
    int Seed,
    int TopCount,
    long? TotalCandidates,
    long ProcessedCandidates,
    JobStatus Status,
    DateTimeOffset? StopRequestedAt,
    string? ErrorCode,
    DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt);

public sealed record OptimizationSampleMetric(
    int Sample,
    DateTimeOffset PeriodStart,
    DateTimeOffset PeriodEnd,
    double FinalAccum,
    double MaxDrawdown,
    int TradeCount,
    double Score);

public sealed record OptimizationResultSummary(
    Guid Id,
    int Rank,
    string ParametersJson,
    double Score,
    double CompoundedAccum,
    double AverageAccum,
    double WorstAccum,
    double WorstMaxDrawdown,
    int TradeCount,
    int ProfitableSampleCount,
    IReadOnlyList<OptimizationSampleMetric> Samples,
    DateTimeOffset CreatedAt);

public sealed record OptimizationJobDetails(
    OptimizationJobSummary Job,
    OptimizationFilters Filters,
    IReadOnlyList<OptimizationResultSummary> Results);

public interface IOptimizationJobService
{
    Task<OptimizationJobSummary> QueueAsync(
        QueueOptimizationJobCommand command,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<OptimizationJobSummary>> ListAsync(
        Guid workspaceId,
        CancellationToken cancellationToken);

    Task<OptimizationJobDetails?> FindAsync(
        Guid workspaceId,
        Guid jobId,
        CancellationToken cancellationToken);

    Task<OptimizationJobSummary?> RequestStopAsync(
        Guid workspaceId,
        Guid userId,
        Guid jobId,
        CancellationToken cancellationToken);

    Task<CalculationRunSummary> QueueStrategyRunAsync(
        Guid workspaceId,
        Guid userId,
        Guid jobId,
        Guid resultId,
        CancellationToken cancellationToken);
}

public interface IOptimizationJobProcessor
{
    Task<bool> ProcessNextAsync(CancellationToken cancellationToken);
}

public sealed class OptimizationJobValidationException(string code, string message)
    : Exception(message)
{
    public string Code { get; } = code;
}
