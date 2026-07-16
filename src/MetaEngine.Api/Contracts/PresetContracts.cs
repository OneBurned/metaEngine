using MetaEngine.Domain.Model;

namespace MetaEngine.Api.Contracts;

public sealed record CreatePresetRequest(
    string? Name,
    Guid? PresetKey,
    IReadOnlyList<CreatePresetItemRequest>? Items);

public sealed record CreatePresetItemRequest(
    PresetItemSourceType SourceType,
    Guid SourceId,
    double Weight,
    DateTimeOffset StartsAt,
    DateTimeOffset? EndsAt);
