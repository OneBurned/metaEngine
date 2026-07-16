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

public sealed record QueueOptimizationRequest(
    string StrategyType,
    JsonElement SearchSpace,
    int SampleCount = 1,
    int Seed = 42,
    int TopCount = 100,
    double? MaximumDrawdownMagnitude = null,
    int? MinimumTradeCount = null,
    int? MinimumProfitableSampleCount = null);
