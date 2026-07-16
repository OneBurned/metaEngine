using System.Text.Json;
using MetaEngine.Application.Presets;
using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MetaEngine.Infrastructure.Presets;

internal sealed class PresetService(MetaEngineDbContext dbContext) : IPresetService
{
    public async Task<PresetDetails> CreateAsync(
        CreatePresetCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(command.Items);

        var name = ValidateName(command.Name);
        ValidateItems(command.Items);
        var sourcesByKey = await LoadSourcesAsync(
            command.WorkspaceId,
            command.Items,
            cancellationToken);
        var (presetKey, version) = await ResolveVersionAsync(
            command.WorkspaceId,
            command.PresetKey,
            cancellationToken);
        var preset = new PresetVersion
        {
            WorkspaceId = command.WorkspaceId,
            PresetKey = presetKey,
            Version = version,
            Name = name,
            CreatedByUserId = command.UserId
        };

        foreach (var (item, index) in command.Items.Select((value, index) => (value, index)))
        {
            preset.Items.Add(new PresetItem
            {
                SortOrder = index,
                SourceType = item.SourceType,
                PortfolioId = item.SourceType == PresetItemSourceType.Portfolio ? item.SourceId : null,
                StrategyId = item.SourceType == PresetItemSourceType.Strategy ? item.SourceId : null,
                Weight = item.Weight,
                StartsAt = item.StartsAt.ToUniversalTime(),
                EndsAt = item.EndsAt?.ToUniversalTime()
            });
        }

        dbContext.Presets.Add(preset);
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = command.WorkspaceId,
            UserId = command.UserId,
            Action = "preset_created",
            EntityType = "preset",
            EntityId = preset.Id,
            DetailsJson = JsonSerializer.Serialize(new
            {
                preset.PresetKey,
                preset.Version,
                ItemCount = command.Items.Count,
                Sources = command.Items
                    .Select(item => new { item.SourceType, item.SourceId })
                    .Distinct()
                    .ToArray()
            })
        });
        await dbContext.SaveChangesAsync(cancellationToken);

        return ToDetails(preset, sourcesByKey);
    }

    public async Task<IReadOnlyList<PresetSummary>> ListAsync(
        Guid workspaceId,
        CancellationToken cancellationToken) =>
        await dbContext.Presets
            .AsNoTracking()
            .Where(preset => preset.WorkspaceId == workspaceId)
            .OrderBy(preset => preset.Name)
            .ThenBy(preset => preset.PresetKey)
            .ThenByDescending(preset => preset.Version)
            .Select(preset => ToSummary(preset))
            .ToArrayAsync(cancellationToken);

    public async Task<PresetDetails?> FindAsync(
        Guid workspaceId,
        Guid presetId,
        CancellationToken cancellationToken)
    {
        var preset = await dbContext.Presets
            .AsNoTracking()
            .Include(candidate => candidate.Items)
            .SingleOrDefaultAsync(
                candidate => candidate.WorkspaceId == workspaceId && candidate.Id == presetId,
                cancellationToken);
        if (preset is null)
        {
            return null;
        }

        var sourcesByKey = await LoadSourcesAsync(
            workspaceId,
            preset.Items.Select(ToInput).ToArray(),
            cancellationToken);
        return ToDetails(preset, sourcesByKey);
    }

    private async Task<IReadOnlyDictionary<PresetSourceKey, PresetSource>> LoadSourcesAsync(
        Guid workspaceId,
        IReadOnlyList<PresetItemInput> items,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<PresetSourceKey, PresetSource>();
        var portfolioIds = items
            .Where(item => item.SourceType == PresetItemSourceType.Portfolio)
            .Select(item => item.SourceId)
            .Distinct()
            .ToArray();
        var portfolios = await dbContext.Portfolios
            .AsNoTracking()
            .Where(portfolio =>
                portfolio.WorkspaceId == workspaceId &&
                portfolioIds.Contains(portfolio.Id))
            .Select(portfolio => new PresetSource(
                new PresetSourceKey(PresetItemSourceType.Portfolio, portfolio.Id),
                portfolio.Name,
                portfolio.Timeframe,
                portfolio.Points.Min(point => point.Timestamp),
                portfolio.Points.Max(point => point.Timestamp)))
            .ToArrayAsync(cancellationToken);
        if (portfolios.Length != portfolioIds.Length)
        {
            throw new PresetValidationException(
                "portfolio_not_found",
                "Each preset item must reference a portfolio version in this workspace.");
        }

        foreach (var portfolio in portfolios)
        {
            result.Add(portfolio.Key, portfolio);
        }

        var strategyIds = items
            .Where(item => item.SourceType == PresetItemSourceType.Strategy)
            .Select(item => item.SourceId)
            .Distinct()
            .ToArray();
        var strategies = await dbContext.Strategies
            .AsNoTracking()
            .Where(strategy =>
                strategy.WorkspaceId == workspaceId &&
                strategyIds.Contains(strategy.Id) &&
                strategy.ResultArtifact.Kind == RunArtifactKind.StrategyResult)
            .Select(strategy => new PresetSource(
                new PresetSourceKey(PresetItemSourceType.Strategy, strategy.Id),
                strategy.Name,
                strategy.ResultArtifact.CalculationRun.Timeframe,
                strategy.ResultArtifact.CalculationRun.PeriodStart,
                strategy.ResultArtifact.CalculationRun.PeriodEnd))
            .ToArrayAsync(cancellationToken);
        if (strategies.Length != strategyIds.Length)
        {
            throw new PresetValidationException(
                "strategy_not_found",
                "Each preset strategy item must reference a saved strategy in this workspace.");
        }

        foreach (var strategy in strategies)
        {
            result.Add(strategy.Key, strategy);
        }

        return result;
    }

    private async Task<(Guid PresetKey, int Version)> ResolveVersionAsync(
        Guid workspaceId,
        Guid? requestedPresetKey,
        CancellationToken cancellationToken)
    {
        if (requestedPresetKey is null)
        {
            return (Guid.CreateVersion7(), 1);
        }

        var latestVersion = await dbContext.Presets
            .AsNoTracking()
            .Where(preset =>
                preset.WorkspaceId == workspaceId &&
                preset.PresetKey == requestedPresetKey.Value)
            .MaxAsync(preset => (int?)preset.Version, cancellationToken);
        if (latestVersion is null)
        {
            throw new PresetValidationException(
                "preset_key_not_found",
                "Preset key does not exist in this workspace.");
        }

        return (requestedPresetKey.Value, checked(latestVersion.Value + 1));
    }

    private static void ValidateItems(IReadOnlyList<PresetItemInput> items)
    {
        if (items.Count == 0)
        {
            throw new PresetValidationException(
                "preset_items_required",
                "Preset must contain at least one portfolio item.");
        }

        foreach (var item in items)
        {
            if (item.SourceType is not (PresetItemSourceType.Portfolio or PresetItemSourceType.Strategy) ||
                item.SourceId == Guid.Empty)
            {
                throw new PresetValidationException(
                    "invalid_preset_source",
                    "Preset item must reference a portfolio or saved strategy.");
            }

            if (!double.IsFinite(item.Weight) || item.Weight < 0)
            {
                throw new PresetValidationException(
                    "invalid_preset_weight",
                    "Preset item weight must be a finite value greater than or equal to zero.");
            }

            if (item.EndsAt is not null && item.EndsAt.Value <= item.StartsAt)
            {
                throw new PresetValidationException(
                    "invalid_preset_item_period",
                    "Preset item end must be after its start.");
            }
        }

        foreach (var sourceItems in items.GroupBy(item => new PresetSourceKey(item.SourceType, item.SourceId)))
        {
            var sorted = sourceItems
                .OrderBy(item => item.StartsAt)
                .ThenBy(item => item.EndsAt ?? DateTimeOffset.MaxValue)
                .ToArray();
            for (var index = 1; index < sorted.Length; index++)
            {
                var previousEnd = sorted[index - 1].EndsAt ?? DateTimeOffset.MaxValue;
                if (sorted[index].StartsAt < previousEnd)
                {
                    throw new PresetValidationException(
                        "overlapping_preset_source_periods",
                        "The same preset source cannot have overlapping periods in one preset.");
                }
            }
        }
    }

    private static string ValidateName(string value)
    {
        var name = value.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new PresetValidationException("name_required", "Preset name is required.");
        }

        if (name.Length > 200)
        {
            throw new PresetValidationException(
                "name_too_long",
                "Preset name cannot exceed 200 characters.");
        }

        return name;
    }

    private static PresetSummary ToSummary(PresetVersion preset) =>
        new(
            preset.Id,
            preset.PresetKey,
            preset.Version,
            preset.Name,
            preset.Items.Count,
            preset.CreatedAt,
            preset.CreatedByUserId);

    private static PresetDetails ToDetails(
        PresetVersion preset,
        IReadOnlyDictionary<PresetSourceKey, PresetSource> sourcesByKey)
    {
        var items = preset.Items
            .OrderBy(item => item.SortOrder)
            .Select(item => ToItemSummary(item, sourcesByKey))
            .ToArray();
        return new PresetDetails(ToSummary(preset), items);
    }

    private static PresetItemSummary ToItemSummary(
        PresetItem item,
        IReadOnlyDictionary<PresetSourceKey, PresetSource> sourcesByKey)
    {
        var sourceId = item.SourceType switch
        {
            PresetItemSourceType.Portfolio when item.PortfolioId is Guid portfolioId => portfolioId,
            PresetItemSourceType.Strategy when item.StrategyId is Guid strategyId => strategyId,
            _ => throw new InvalidOperationException("Preset source is not available.")
        };
        var source = sourcesByKey.TryGetValue(new PresetSourceKey(item.SourceType, sourceId), out var value)
            ? value
            : throw new InvalidOperationException("Preset source is not available.");
        return new PresetItemSummary(
            item.Id,
            item.SortOrder,
            item.SourceType,
            sourceId,
            source.Name,
            source.Timeframe,
            source.PeriodStart,
            source.PeriodEnd,
            item.Weight,
            item.StartsAt,
            item.EndsAt);
    }

    private static PresetItemInput ToInput(PresetItem item) => new(
        item.SourceType,
        item.SourceType == PresetItemSourceType.Portfolio
            ? item.PortfolioId ?? Guid.Empty
            : item.StrategyId ?? Guid.Empty,
        item.Weight,
        item.StartsAt,
        item.EndsAt);

    private readonly record struct PresetSourceKey(PresetItemSourceType Type, Guid Id);

    private sealed record PresetSource(
        PresetSourceKey Key,
        string Name,
        string Timeframe,
        DateTimeOffset PeriodStart,
        DateTimeOffset PeriodEnd);
}
