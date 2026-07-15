namespace MetaEngine.Domain.Model;

public enum UserAccessStatus
{
    Active,
    Disabled
}

public enum WorkspaceRole
{
    Admin,
    Researcher,
    Viewer
}

public enum PortfolioValueType
{
    Diff,
    Accum
}

public enum PortfolioValueScale
{
    Decimal,
    Percent
}

public enum PresetItemSourceType
{
    Portfolio,
    Strategy
}

public enum CalculationRunKind
{
    Base,
    Strategy
}

public enum CalculationInputType
{
    Portfolio,
    Preset
}

public enum JobStatus
{
    Queued,
    Running,
    Completed,
    Stopping,
    Stopped,
    Failed,
    Interrupted
}

public enum RunArtifactKind
{
    BaseResult,
    StrategyResult
}
