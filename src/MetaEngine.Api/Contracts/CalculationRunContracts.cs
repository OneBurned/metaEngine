namespace MetaEngine.Api.Contracts;

using System.Text.Json;

public sealed record QueueCalculationRequest(
    Guid? PortfolioId,
    Guid? PresetId,
    DateTimeOffset PeriodStart,
    DateTimeOffset PeriodEnd,
    string? Timeframe);

public sealed record QueueStrategyCalculationRequest(
    string StrategyType,
    JsonElement Parameters);
