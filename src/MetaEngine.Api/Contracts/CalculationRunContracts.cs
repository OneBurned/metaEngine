namespace MetaEngine.Api.Contracts;

public sealed record QueueCalculationRequest(
    Guid? PortfolioId,
    Guid? PresetId,
    DateTimeOffset PeriodStart,
    DateTimeOffset PeriodEnd,
    string? Timeframe);
