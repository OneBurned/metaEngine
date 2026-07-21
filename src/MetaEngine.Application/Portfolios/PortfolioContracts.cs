using MetaEngine.Domain.Model;

namespace MetaEngine.Application.Portfolios;

public static class PortfolioImportLimits
{
    public const long MaxSourceBytes = 25L * 1024 * 1024;
    public const int MaxPoints = 250_000;
    public const int MaxReportedWarnings = 100;
    public const int MaxPointPageSize = 5_000;
}

public sealed record ImportPortfolioCommand(
    Guid WorkspaceId,
    Guid UserId,
    string Name,
    string SourceFileName,
    Guid? PortfolioKey,
    Stream Content,
    PortfolioValueType SourceValueType = PortfolioValueType.Diff);

public sealed record PortfolioSummary(
    Guid Id,
    Guid PortfolioKey,
    int Version,
    string Name,
    string? SourceFileName,
    PortfolioValueType ValueType,
    PortfolioValueScale ValueScale,
    string Timeframe,
    string SourceChecksum,
    string SeriesChecksum,
    int PointCount,
    DateTimeOffset StartsAt,
    DateTimeOffset EndsAt,
    DateTimeOffset CreatedAt,
    Guid? CreatedByUserId);

public sealed record PortfolioImportWarning(
    string Code,
    DateTimeOffset Timestamp,
    string Message);

public sealed record PortfolioImportReport(
    int PointCount,
    string Timeframe,
    DateTimeOffset StartsAt,
    DateTimeOffset EndsAt,
    long GapCount,
    IReadOnlyList<PortfolioImportWarning> Warnings,
    bool WarningsTruncated);

public sealed record PortfolioImportResult(
    bool Created,
    PortfolioSummary Portfolio,
    PortfolioImportReport Report);

public sealed record PortfolioPointItem(
    DateTimeOffset Timestamp,
    double Diff);

public sealed record PortfolioPointPage(
    int Offset,
    int Limit,
    int Total,
    IReadOnlyList<PortfolioPointItem> Items);

public interface IPortfolioService
{
    Task<PortfolioImportResult> ImportAsync(
        ImportPortfolioCommand command,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<PortfolioSummary>> ListAsync(
        Guid workspaceId,
        CancellationToken cancellationToken);

    Task<PortfolioSummary?> FindAsync(
        Guid workspaceId,
        Guid portfolioId,
        CancellationToken cancellationToken);

    Task<PortfolioPointPage?> GetPointsAsync(
        Guid workspaceId,
        Guid portfolioId,
        int offset,
        int limit,
        CancellationToken cancellationToken);
}

public sealed class PortfolioImportValidationException(string code, string message)
    : Exception(message)
{
    public string Code { get; } = code;
}
