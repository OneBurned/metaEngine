using MetaEngine.Application.Portfolios;
using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace MetaEngine.Infrastructure.Portfolios;

internal sealed class PortfolioService(
    MetaEngineDbContext dbContext,
    PortfolioCsvNormalizer normalizer) : IPortfolioService
{
    private const string NormalizationVersion = "portfolio-diff-v2";

    public async Task<PortfolioImportResult> ImportAsync(
        ImportPortfolioCommand command,
        CancellationToken cancellationToken)
    {
        var name = ValidateName(command.Name);
        var sourceFileName = Path.GetFileName(command.SourceFileName);
        if (sourceFileName.Length > 512)
        {
            throw new PortfolioImportValidationException(
                "source_file_name_too_long",
                "Source file name cannot exceed 512 characters.");
        }

        var normalized = await normalizer.NormalizeAsync(command.Content, command.SourceValueType, cancellationToken);
        var duplicate = await FindDuplicateAsync(
            command.WorkspaceId,
            normalized.SourceChecksum,
            normalized.SeriesChecksum,
            cancellationToken);
        if (duplicate is not null)
        {
            return BuildResult(created: false, duplicate, normalized);
        }

        var (portfolioKey, version) = await ResolveVersionAsync(
            command.WorkspaceId,
            command.PortfolioKey,
            cancellationToken);
        var portfolio = new PortfolioVersion
        {
            WorkspaceId = command.WorkspaceId,
            PortfolioKey = portfolioKey,
            Version = version,
            Name = name,
            SourceFileName = sourceFileName,
            ValueType = command.SourceValueType,
            ValueScale = PortfolioValueScale.Decimal,
            Timeframe = normalized.Timeframe,
            NormalizationVersion = NormalizationVersion,
            SourceChecksum = normalized.SourceChecksum,
            SeriesChecksum = normalized.SeriesChecksum,
            PointCount = normalized.Points.Count,
            CreatedByUserId = command.UserId
        };
        foreach (var point in normalized.Points)
        {
            portfolio.Points.Add(new PortfolioPoint
            {
                Timestamp = point.Timestamp,
                Diff = point.Diff
            });
        }

        dbContext.Portfolios.Add(portfolio);
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = command.WorkspaceId,
            UserId = command.UserId,
            Action = "portfolio_imported",
            EntityType = "portfolio",
            EntityId = portfolio.Id,
            DetailsJson = JsonSerializer.Serialize(new
            {
                portfolio.PortfolioKey,
                portfolio.Version,
                portfolio.PointCount,
                portfolio.SourceChecksum,
                portfolio.SeriesChecksum
            })
        });
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            dbContext.ChangeTracker.Clear();
            duplicate = await FindDuplicateAsync(
                command.WorkspaceId,
                normalized.SourceChecksum,
                normalized.SeriesChecksum,
                cancellationToken);
            if (duplicate is null)
            {
                throw;
            }

            return BuildResult(created: false, duplicate, normalized);
        }

        return BuildResult(created: true, portfolio, normalized);
    }

    public async Task<IReadOnlyList<PortfolioSummary>> ListAsync(
        Guid workspaceId,
        CancellationToken cancellationToken) =>
        await dbContext.Portfolios
            .AsNoTracking()
            .Where(portfolio => portfolio.WorkspaceId == workspaceId)
            .OrderBy(portfolio => portfolio.Name)
            .ThenBy(portfolio => portfolio.PortfolioKey)
            .ThenByDescending(portfolio => portfolio.Version)
            .Select(portfolio => new PortfolioSummary(
                portfolio.Id,
                portfolio.PortfolioKey,
                portfolio.Version,
                portfolio.Name,
                portfolio.SourceFileName,
                portfolio.ValueType,
                portfolio.ValueScale,
                portfolio.Timeframe,
                portfolio.SourceChecksum,
                portfolio.SeriesChecksum,
                portfolio.PointCount,
                portfolio.Points.Min(point => point.Timestamp),
                portfolio.Points.Max(point => point.Timestamp),
                portfolio.CreatedAt,
                portfolio.CreatedByUserId))
            .ToArrayAsync(cancellationToken);

    public Task<PortfolioSummary?> FindAsync(
        Guid workspaceId,
        Guid portfolioId,
        CancellationToken cancellationToken) =>
        dbContext.Portfolios
            .AsNoTracking()
            .Where(portfolio => portfolio.WorkspaceId == workspaceId && portfolio.Id == portfolioId)
            .Select(portfolio => new PortfolioSummary(
                portfolio.Id,
                portfolio.PortfolioKey,
                portfolio.Version,
                portfolio.Name,
                portfolio.SourceFileName,
                portfolio.ValueType,
                portfolio.ValueScale,
                portfolio.Timeframe,
                portfolio.SourceChecksum,
                portfolio.SeriesChecksum,
                portfolio.PointCount,
                portfolio.Points.Min(point => point.Timestamp),
                portfolio.Points.Max(point => point.Timestamp),
                portfolio.CreatedAt,
                portfolio.CreatedByUserId))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<PortfolioPointPage?> GetPointsAsync(
        Guid workspaceId,
        Guid portfolioId,
        int offset,
        int limit,
        CancellationToken cancellationToken)
    {
        var total = await dbContext.Portfolios
            .AsNoTracking()
            .Where(portfolio => portfolio.WorkspaceId == workspaceId && portfolio.Id == portfolioId)
            .Select(portfolio => (int?)portfolio.PointCount)
            .SingleOrDefaultAsync(cancellationToken);
        if (total is null)
        {
            return null;
        }

        var items = await dbContext.PortfolioPoints
            .AsNoTracking()
            .Where(point => point.PortfolioId == portfolioId)
            .OrderBy(point => point.Timestamp)
            .Skip(offset)
            .Take(limit)
            .Select(point => new PortfolioPointItem(point.Timestamp, point.Diff))
            .ToArrayAsync(cancellationToken);
        return new PortfolioPointPage(offset, limit, total.Value, items);
    }

    public async Task<bool> DeleteAsync(
        Guid workspaceId,
        Guid userId,
        Guid portfolioId,
        CancellationToken cancellationToken)
    {
        var portfolio = await dbContext.Portfolios
            .SingleOrDefaultAsync(candidate => candidate.Id == portfolioId && candidate.WorkspaceId == workspaceId, cancellationToken);
        if (portfolio is null)
        {
            return false;
        }

        if (await HasPortfolioDependenciesAsync(workspaceId, portfolioId, cancellationToken))
        {
            throw new PortfolioImportValidationException(
                "portfolio_in_use",
                "This portfolio is used by calculations, presets, optimizations, or saved strategies and cannot be deleted.");
        }

        dbContext.Portfolios.Remove(portfolio);
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = workspaceId,
            UserId = userId,
            Action = "portfolio_deleted",
            EntityType = "portfolio",
            EntityId = portfolio.Id,
            DetailsJson = JsonSerializer.Serialize(new
            {
                portfolio.PortfolioKey,
                portfolio.Version,
                portfolio.PointCount,
                portfolio.SourceChecksum,
                portfolio.SeriesChecksum
            })
        });
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private async Task<bool> HasPortfolioDependenciesAsync(
        Guid workspaceId,
        Guid portfolioId,
        CancellationToken cancellationToken) =>
        await dbContext.CalculationRuns.AnyAsync(run =>
            run.WorkspaceId == workspaceId &&
            (run.PortfolioId == portfolioId || run.SourcePortfolioId == portfolioId), cancellationToken) ||
        await dbContext.OptimizationJobs.AnyAsync(job =>
            job.WorkspaceId == workspaceId &&
            (job.PortfolioId == portfolioId || job.SourcePortfolioId == portfolioId), cancellationToken) ||
        await dbContext.PresetItems.AnyAsync(item => item.PortfolioId == portfolioId, cancellationToken) ||
        await dbContext.Strategies.AnyAsync(strategy =>
            strategy.WorkspaceId == workspaceId && strategy.SourcePortfolioId == portfolioId, cancellationToken);

    private async Task<PortfolioVersion?> FindDuplicateAsync(
        Guid workspaceId,
        string sourceChecksum,
        string seriesChecksum,
        CancellationToken cancellationToken) =>
        await dbContext.Portfolios
            .AsNoTracking()
            .Where(portfolio =>
                portfolio.WorkspaceId == workspaceId &&
                (portfolio.SourceChecksum == sourceChecksum || portfolio.SeriesChecksum == seriesChecksum))
            .OrderBy(portfolio => portfolio.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

    private async Task<(Guid PortfolioKey, int Version)> ResolveVersionAsync(
        Guid workspaceId,
        Guid? requestedPortfolioKey,
        CancellationToken cancellationToken)
    {
        if (requestedPortfolioKey is null)
        {
            return (Guid.CreateVersion7(), 1);
        }

        var latestVersion = await dbContext.Portfolios
            .AsNoTracking()
            .Where(portfolio =>
                portfolio.WorkspaceId == workspaceId &&
                portfolio.PortfolioKey == requestedPortfolioKey.Value)
            .MaxAsync(portfolio => (int?)portfolio.Version, cancellationToken);
        if (latestVersion is null)
        {
            throw new PortfolioImportValidationException(
                "portfolio_key_not_found",
                "Portfolio key does not exist in this workspace.");
        }

        return (requestedPortfolioKey.Value, checked(latestVersion.Value + 1));
    }

    private static string ValidateName(string value)
    {
        var name = value.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new PortfolioImportValidationException("name_required", "Portfolio name is required.");
        }

        if (name.Length > 200)
        {
            throw new PortfolioImportValidationException(
                "name_too_long",
                "Portfolio name cannot exceed 200 characters.");
        }

        return name;
    }

    private static PortfolioImportResult BuildResult(
        bool created,
        PortfolioVersion portfolio,
        NormalizedPortfolioSeries normalized) =>
        new(
            created,
            ToSummary(portfolio, normalized.Points[0].Timestamp, normalized.Points[^1].Timestamp),
            new PortfolioImportReport(
                normalized.Points.Count,
                normalized.Timeframe,
                normalized.Points[0].Timestamp,
                normalized.Points[^1].Timestamp,
                normalized.GapCount,
                normalized.Warnings,
                normalized.WarningsTruncated));

    private static PortfolioSummary ToSummary(
        PortfolioVersion portfolio,
        DateTimeOffset startsAt,
        DateTimeOffset endsAt) =>
        new(
            portfolio.Id,
            portfolio.PortfolioKey,
            portfolio.Version,
            portfolio.Name,
            portfolio.SourceFileName,
            portfolio.ValueType,
            portfolio.ValueScale,
            portfolio.Timeframe,
            portfolio.SourceChecksum,
            portfolio.SeriesChecksum,
            portfolio.PointCount,
            startsAt,
            endsAt,
            portfolio.CreatedAt,
            portfolio.CreatedByUserId);
}
