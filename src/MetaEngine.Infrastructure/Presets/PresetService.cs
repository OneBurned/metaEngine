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
        var portfoliosById = await LoadPortfoliosAsync(
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
                SourceType = PresetItemSourceType.Portfolio,
                PortfolioId = item.PortfolioId,
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
                PortfolioIds = command.Items.Select(item => item.PortfolioId).Distinct().ToArray()
            })
        });
        await dbContext.SaveChangesAsync(cancellationToken);

        return ToDetails(preset, portfoliosById);
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
            .ThenInclude(item => item.Portfolio)
            .SingleOrDefaultAsync(
                candidate => candidate.WorkspaceId == workspaceId && candidate.Id == presetId,
                cancellationToken);
        return preset is null ? null : ToDetails(preset, null);
    }

    private async Task<IReadOnlyDictionary<Guid, PortfolioVersion>> LoadPortfoliosAsync(
        Guid workspaceId,
        IReadOnlyList<PresetPortfolioItemInput> items,
        CancellationToken cancellationToken)
    {
        var portfolioIds = items.Select(item => item.PortfolioId).Distinct().ToArray();
        var portfolios = await dbContext.Portfolios
            .AsNoTracking()
            .Where(portfolio =>
                portfolio.WorkspaceId == workspaceId &&
                portfolioIds.Contains(portfolio.Id))
            .ToDictionaryAsync(portfolio => portfolio.Id, cancellationToken);
        if (portfolios.Count != portfolioIds.Length)
        {
            throw new PresetValidationException(
                "portfolio_not_found",
                "Each preset item must reference a portfolio version in this workspace.");
        }

        return portfolios;
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

    private static void ValidateItems(IReadOnlyList<PresetPortfolioItemInput> items)
    {
        if (items.Count == 0)
        {
            throw new PresetValidationException(
                "preset_items_required",
                "Preset must contain at least one portfolio item.");
        }

        foreach (var item in items)
        {
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

        foreach (var portfolioItems in items.GroupBy(item => item.PortfolioId))
        {
            var sorted = portfolioItems
                .OrderBy(item => item.StartsAt)
                .ThenBy(item => item.EndsAt ?? DateTimeOffset.MaxValue)
                .ToArray();
            for (var index = 1; index < sorted.Length; index++)
            {
                var previousEnd = sorted[index - 1].EndsAt ?? DateTimeOffset.MaxValue;
                if (sorted[index].StartsAt < previousEnd)
                {
                    throw new PresetValidationException(
                        "overlapping_portfolio_periods",
                        "The same portfolio version cannot have overlapping periods in one preset.");
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
        IReadOnlyDictionary<Guid, PortfolioVersion>? portfoliosById)
    {
        var items = preset.Items
            .OrderBy(item => item.SortOrder)
            .Select(item => ToItemSummary(item, portfoliosById))
            .ToArray();
        return new PresetDetails(ToSummary(preset), items);
    }

    private static PresetItemSummary ToItemSummary(
        PresetItem item,
        IReadOnlyDictionary<Guid, PortfolioVersion>? portfoliosById)
    {
        var portfolio = item.Portfolio ??
            (item.PortfolioId is Guid portfolioId && portfoliosById is not null
                ? portfoliosById[portfolioId]
                : throw new InvalidOperationException("Preset portfolio source is not available."));
        return new PresetItemSummary(
            item.Id,
            item.SortOrder,
            portfolio.Id,
            portfolio.PortfolioKey,
            portfolio.Version,
            portfolio.Name,
            portfolio.Timeframe,
            item.Weight,
            item.StartsAt,
            item.EndsAt);
    }
}
