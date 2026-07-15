namespace MetaEngine.Api.Contracts;

public sealed record CreatePresetRequest(
    string? Name,
    Guid? PresetKey,
    IReadOnlyList<CreatePresetItemRequest>? Items);

public sealed record CreatePresetItemRequest(
    Guid PortfolioId,
    double Weight,
    DateTimeOffset StartsAt,
    DateTimeOffset? EndsAt);
