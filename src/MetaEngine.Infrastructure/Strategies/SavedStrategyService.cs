using System.Text.Json;
using MetaEngine.Application.Strategies;
using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MetaEngine.Infrastructure.Strategies;

internal sealed class SavedStrategyService(MetaEngineDbContext dbContext) : ISavedStrategyService
{
    public async Task<SavedStrategySummary> SaveAsync(SaveStrategyCommand command, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(command.Name) || command.Name.Trim().Length > 200)
        {
            throw new SavedStrategyValidationException("invalid_strategy_name", "Strategy name must contain 1 through 200 characters.");
        }

        var run = await dbContext.CalculationRuns
            .Include(candidate => candidate.Artifacts)
            .SingleOrDefaultAsync(candidate =>
                candidate.Id == command.StrategyRunId && candidate.WorkspaceId == command.WorkspaceId,
                cancellationToken)
            ?? throw new SavedStrategyValidationException("strategy_run_not_found", "Strategy calculation run does not exist in this workspace.");
        if (run.Kind != CalculationRunKind.Strategy || run.Status != JobStatus.Completed || run.StrategyType is null ||
            run.StrategySchemaVersion is null || run.StrategyParametersJson is null)
        {
            throw new SavedStrategyValidationException("strategy_run_not_completed", "A completed strategy calculation run is required.");
        }

        var artifact = run.Artifacts.SingleOrDefault(candidate => candidate.Kind == RunArtifactKind.StrategyResult)
            ?? throw new SavedStrategyValidationException("strategy_result_not_found", "Strategy result artifact is not available.");
        if (await dbContext.Strategies.AnyAsync(strategy => strategy.ResultArtifactId == artifact.Id, cancellationToken))
        {
            throw new SavedStrategyValidationException("strategy_result_already_saved", "This strategy calculation has already been saved.");
        }

        var strategyKey = command.StrategyKey ?? Guid.CreateVersion7();
        var version = await dbContext.Strategies
            .Where(strategy => strategy.WorkspaceId == command.WorkspaceId && strategy.StrategyKey == strategyKey)
            .Select(strategy => (int?)strategy.Version)
            .MaxAsync(cancellationToken) ?? 0;
        var strategy = new SavedStrategyVersion
        {
            WorkspaceId = command.WorkspaceId,
            StrategyKey = strategyKey,
            Version = version + 1,
            Name = command.Name.Trim(),
            StrategyType = run.StrategyType,
            SchemaVersion = run.StrategySchemaVersion.Value,
            ParametersJson = run.StrategyParametersJson,
            SourceType = run.InputType,
            SourcePortfolioId = run.PortfolioId,
            SourcePresetId = run.PresetId,
            ResultArtifactId = artifact.Id,
            OptimizationResultId = run.OptimizationResultId,
            CreatedByUserId = command.UserId
        };
        dbContext.Strategies.Add(strategy);
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = command.WorkspaceId,
            UserId = command.UserId,
            Action = "strategy_saved",
            EntityType = "strategy",
            EntityId = strategy.Id,
            DetailsJson = JsonSerializer.Serialize(new
            {
                strategy.StrategyKey,
                strategy.Version,
                strategy.StrategyType,
                strategy.ResultArtifactId
            })
        });
        await dbContext.SaveChangesAsync(cancellationToken);
        return ToSummary(strategy, run);
    }

    public async Task<IReadOnlyList<SavedStrategySummary>> ListAsync(Guid workspaceId, CancellationToken cancellationToken) =>
        await dbContext.Strategies
            .AsNoTracking()
            .Where(strategy => strategy.WorkspaceId == workspaceId)
            .OrderByDescending(strategy => strategy.CreatedAt)
            .Select(strategy => new SavedStrategySummary(
                strategy.Id,
                strategy.StrategyKey,
                strategy.Version,
                strategy.Name,
                strategy.StrategyType,
                strategy.SchemaVersion,
                strategy.ParametersJson,
                strategy.SourceType,
                strategy.SourcePortfolioId,
                strategy.SourcePresetId,
                strategy.ResultArtifactId,
                strategy.ResultArtifact.CalculationRunId,
                strategy.ResultArtifact.CalculationRun.PeriodStart,
                strategy.ResultArtifact.CalculationRun.PeriodEnd,
                strategy.ResultArtifact.CalculationRun.Timeframe,
                strategy.CreatedAt))
            .ToArrayAsync(cancellationToken);

    public async Task<bool> DeleteAsync(
        Guid workspaceId,
        Guid userId,
        Guid strategyId,
        CancellationToken cancellationToken)
    {
        var strategy = await dbContext.Strategies
            .SingleOrDefaultAsync(candidate => candidate.Id == strategyId && candidate.WorkspaceId == workspaceId, cancellationToken);
        if (strategy is null)
        {
            return false;
        }

        if (await dbContext.PresetItems.AnyAsync(item => item.StrategyId == strategyId, cancellationToken))
        {
            throw new SavedStrategyValidationException(
                "strategy_in_use",
                "This saved strategy is used in a preset and cannot be deleted.");
        }

        dbContext.Strategies.Remove(strategy);
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = workspaceId,
            UserId = userId,
            Action = "strategy_deleted",
            EntityType = "strategy",
            EntityId = strategy.Id,
            DetailsJson = JsonSerializer.Serialize(new
            {
                strategy.StrategyKey,
                strategy.Version,
                strategy.StrategyType,
                strategy.ResultArtifactId
            })
        });
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private static SavedStrategySummary ToSummary(
        SavedStrategyVersion strategy,
        CalculationRun resultRun) => new(
        strategy.Id,
        strategy.StrategyKey,
        strategy.Version,
        strategy.Name,
        strategy.StrategyType,
        strategy.SchemaVersion,
        strategy.ParametersJson,
        strategy.SourceType,
        strategy.SourcePortfolioId,
        strategy.SourcePresetId,
        strategy.ResultArtifactId,
        resultRun.Id,
        resultRun.PeriodStart,
        resultRun.PeriodEnd,
        resultRun.Timeframe,
        strategy.CreatedAt);
}
