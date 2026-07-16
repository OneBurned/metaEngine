namespace MetaEngine.Domain.Model;

public sealed class SavedStrategyVersion
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public Guid StrategyKey { get; set; } = Guid.CreateVersion7();

    public int Version { get; set; } = 1;

    public string Name { get; set; } = string.Empty;

    public string StrategyType { get; set; } = string.Empty;

    public int SchemaVersion { get; set; }

    public string ParametersJson { get; set; } = "{}";

    public CalculationInputType SourceType { get; set; }

    public Guid? SourcePortfolioId { get; set; }

    public PortfolioVersion? SourcePortfolio { get; set; }

    public Guid? SourcePresetId { get; set; }

    public PresetVersion? SourcePreset { get; set; }

    public Guid ResultArtifactId { get; set; }

    public RunArtifact ResultArtifact { get; set; } = null!;

    public Guid? OptimizationResultId { get; set; }

    public OptimizationResult? OptimizationResult { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Guid? CreatedByUserId { get; set; }

    public UserAccount? CreatedByUser { get; set; }
}

public sealed class CalculationRun
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public CalculationRunKind Kind { get; set; }

    public CalculationInputType InputType { get; set; }

    public Guid? PortfolioId { get; set; }

    public PortfolioVersion? Portfolio { get; set; }

    public Guid? PresetId { get; set; }

    public PresetVersion? Preset { get; set; }

    public Guid? SourceCalculationRunId { get; set; }

    public CalculationRun? SourceCalculationRun { get; set; }

    public string? StrategyType { get; set; }

    public int? StrategySchemaVersion { get; set; }

    public string? StrategyParametersJson { get; set; }

    public Guid? OptimizationResultId { get; set; }

    public OptimizationResult? OptimizationResult { get; set; }

    public DateTimeOffset PeriodStart { get; set; }

    public DateTimeOffset PeriodEnd { get; set; }

    public string Timeframe { get; set; } = string.Empty;

    public string MissingDataRule { get; set; } = "zero_diff";

    public string EngineVersion { get; set; } = string.Empty;

    public JobStatus Status { get; set; } = JobStatus.Queued;

    public int AttemptCount { get; set; }

    public Guid? LeaseId { get; set; }

    public DateTimeOffset? LastHeartbeatAt { get; set; }

    public DateTimeOffset? RetryNotBefore { get; set; }

    public int PointCount { get; set; }

    public int TradeCount { get; set; }

    public double? FinalAccum { get; set; }

    public double? HighWaterMark { get; set; }

    public double? MaxDrawdown { get; set; }

    public string WarningsJson { get; set; } = "[]";

    public string? ErrorCode { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public Guid? CreatedByUserId { get; set; }

    public UserAccount? CreatedByUser { get; set; }

    public ICollection<RunArtifact> Artifacts { get; set; } = [];
}

public sealed class OptimizationJob
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public Guid? SourceCalculationRunId { get; set; }

    public CalculationRun? SourceCalculationRun { get; set; }

    public CalculationInputType InputType { get; set; }

    public Guid? PortfolioId { get; set; }

    public PortfolioVersion? Portfolio { get; set; }

    public Guid? PresetId { get; set; }

    public PresetVersion? Preset { get; set; }

    public string StrategyType { get; set; } = string.Empty;

    public int StrategySchemaVersion { get; set; }

    public string SearchSpaceJson { get; set; } = "{}";

    public DateTimeOffset PeriodStart { get; set; }

    public DateTimeOffset PeriodEnd { get; set; }

    public string Timeframe { get; set; } = string.Empty;

    public string MissingDataRule { get; set; } = "zero_diff";

    public string EngineVersion { get; set; } = string.Empty;

    public int SampleCount { get; set; } = 1;

    public int Seed { get; set; }

    public int TopCount { get; set; }

    public long? TotalCandidates { get; set; }

    public long ProcessedCandidates { get; set; }

    public JobStatus Status { get; set; } = JobStatus.Queued;

    public int AttemptCount { get; set; }

    public Guid? LeaseId { get; set; }

    public DateTimeOffset? LastHeartbeatAt { get; set; }

    public DateTimeOffset? RetryNotBefore { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? StopRequestedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public string? ErrorCode { get; set; }

    public Guid? CreatedByUserId { get; set; }

    public UserAccount? CreatedByUser { get; set; }

    public ICollection<OptimizationResult> Results { get; set; } = [];
}

public sealed class OptimizationResult
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid OptimizationJobId { get; set; }

    public OptimizationJob OptimizationJob { get; set; } = null!;

    public int Rank { get; set; }

    public string ParametersJson { get; set; } = "{}";

    public double Score { get; set; }

    public double CompoundedAccum { get; set; }

    public double AverageAccum { get; set; }

    public double WorstAccum { get; set; }

    public double WorstMaxDrawdown { get; set; }

    public int TradeCount { get; set; }

    public int ProfitableSampleCount { get; set; }

    public string SampleMetricsJson { get; set; } = "[]";

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class RunArtifact
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid CalculationRunId { get; set; }

    public CalculationRun CalculationRun { get; set; } = null!;

    public RunArtifactKind Kind { get; set; }

    public int PointCount { get; set; }

    public string SeriesChecksum { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public ICollection<RunArtifactPoint> Points { get; set; } = [];
}

public sealed class RunArtifactPoint
{
    public Guid RunArtifactId { get; set; }

    public RunArtifact RunArtifact { get; set; } = null!;

    public DateTimeOffset Timestamp { get; set; }

    public double Diff { get; set; }
}

public sealed class AuditEvent
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public Guid? UserId { get; set; }

    public UserAccount? User { get; set; }

    public string Action { get; set; } = string.Empty;

    public string EntityType { get; set; } = string.Empty;

    public Guid? EntityId { get; set; }

    public string DetailsJson { get; set; } = "{}";

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
