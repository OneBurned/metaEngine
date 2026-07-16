using MetaEngine.Domain.Model;

namespace MetaEngine.Application.Presets;

public sealed record PresetItemInput(
    PresetItemSourceType SourceType,
    Guid SourceId,
    double Weight,
    DateTimeOffset StartsAt,
    DateTimeOffset? EndsAt);

public sealed record CreatePresetCommand(
    Guid WorkspaceId,
    Guid UserId,
    string Name,
    Guid? PresetKey,
    IReadOnlyList<PresetItemInput> Items);

public sealed record PresetSummary(
    Guid Id,
    Guid PresetKey,
    int Version,
    string Name,
    int ItemCount,
    DateTimeOffset CreatedAt,
    Guid? CreatedByUserId);

public sealed record PresetItemSummary(
    Guid Id,
    int SortOrder,
    PresetItemSourceType SourceType,
    Guid SourceId,
    string SourceName,
    string SourceTimeframe,
    DateTimeOffset SourcePeriodStart,
    DateTimeOffset SourcePeriodEnd,
    double Weight,
    DateTimeOffset StartsAt,
    DateTimeOffset? EndsAt);

public sealed record PresetDetails(
    PresetSummary Preset,
    IReadOnlyList<PresetItemSummary> Items);

public interface IPresetService
{
    Task<PresetDetails> CreateAsync(
        CreatePresetCommand command,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<PresetSummary>> ListAsync(
        Guid workspaceId,
        CancellationToken cancellationToken);

    Task<PresetDetails?> FindAsync(
        Guid workspaceId,
        Guid presetId,
        CancellationToken cancellationToken);
}

public sealed class PresetValidationException(string code, string message)
    : Exception(message)
{
    public string Code { get; } = code;
}
