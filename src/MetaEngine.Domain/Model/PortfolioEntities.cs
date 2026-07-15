namespace MetaEngine.Domain.Model;

public sealed class PortfolioVersion
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public Guid PortfolioKey { get; set; } = Guid.CreateVersion7();

    public int Version { get; set; } = 1;

    public string Name { get; set; } = string.Empty;

    public string? SourceFileName { get; set; }

    public PortfolioValueType ValueType { get; set; }

    public PortfolioValueScale ValueScale { get; set; }

    public string Timeframe { get; set; } = string.Empty;

    public string NormalizationVersion { get; set; } = string.Empty;

    public string SourceChecksum { get; set; } = string.Empty;

    public string SeriesChecksum { get; set; } = string.Empty;

    public int PointCount { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Guid? CreatedByUserId { get; set; }

    public UserAccount? CreatedByUser { get; set; }

    public ICollection<PortfolioPoint> Points { get; set; } = [];
}

public sealed class PortfolioPoint
{
    public Guid PortfolioId { get; set; }

    public PortfolioVersion Portfolio { get; set; } = null!;

    public DateTimeOffset Timestamp { get; set; }

    public double Diff { get; set; }
}

public sealed class PresetVersion
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public Guid PresetKey { get; set; } = Guid.CreateVersion7();

    public int Version { get; set; } = 1;

    public string Name { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Guid? CreatedByUserId { get; set; }

    public UserAccount? CreatedByUser { get; set; }

    public ICollection<PresetItem> Items { get; set; } = [];
}

public sealed class PresetItem
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid PresetId { get; set; }

    public PresetVersion Preset { get; set; } = null!;

    public int SortOrder { get; set; }

    public PresetItemSourceType SourceType { get; set; }

    public Guid? PortfolioId { get; set; }

    public PortfolioVersion? Portfolio { get; set; }

    public Guid? StrategyId { get; set; }

    public SavedStrategyVersion? Strategy { get; set; }

    public double Weight { get; set; }

    public DateTimeOffset StartsAt { get; set; }

    public DateTimeOffset? EndsAt { get; set; }
}
