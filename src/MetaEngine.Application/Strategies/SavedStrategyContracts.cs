using MetaEngine.Domain.Model;

namespace MetaEngine.Application.Strategies;

public sealed record SaveStrategyCommand(
    Guid WorkspaceId,
    Guid UserId,
    Guid StrategyRunId,
    string Name,
    Guid? StrategyKey);

public sealed record SavedStrategySummary(
    Guid Id,
    Guid StrategyKey,
    int Version,
    string Name,
    string StrategyType,
    int SchemaVersion,
    string ParametersJson,
    CalculationInputType SourceType,
    Guid? SourcePortfolioId,
    Guid? SourcePresetId,
    Guid ResultArtifactId,
    DateTimeOffset CreatedAt);

public interface ISavedStrategyService
{
    Task<SavedStrategySummary> SaveAsync(SaveStrategyCommand command, CancellationToken cancellationToken);

    Task<IReadOnlyList<SavedStrategySummary>> ListAsync(Guid workspaceId, CancellationToken cancellationToken);
}

public sealed class SavedStrategyValidationException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
