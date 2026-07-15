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
    private const string NormalizationVersion = "portfolio-diff-v1";

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

        var normalized = await normalizer.NormalizeAsync(command.Content, cancellationToken);
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
            ValueType = PortfolioValueType.Diff,
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
            .Select(portfolio => ToSummary(portfolio))
            .ToArrayAsync(cancellationToken);

    public Task<PortfolioSummary?> FindAsync(
        Guid workspaceId,
        Guid portfolioId,
        CancellationToken cancellationToken) =>
        dbContext.Portfolios
            .AsNoTracking()
            .Where(portfolio => portfolio.WorkspaceId == workspaceId && portfolio.Id == portfolioId)
            .Select(portfolio => ToSummary(portfolio))
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
            ToSummary(portfolio),
            new PortfolioImportReport(
                normalized.Points.Count,
                normalized.Timeframe,
                normalized.Points[0].Timestamp,
                normalized.Points[^1].Timestamp,
                normalized.GapCount,
                normalized.Warnings,
                normalized.WarningsTruncated));

    private static PortfolioSummary ToSummary(PortfolioVersion portfolio) =>
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
            portfolio.CreatedAt,
            portfolio.CreatedByUserId);
}
