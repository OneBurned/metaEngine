namespace MetaEngine.Api.Contracts;

public sealed record SaveStrategyRequest(string Name, Guid StrategyRunId, Guid? StrategyKey);
