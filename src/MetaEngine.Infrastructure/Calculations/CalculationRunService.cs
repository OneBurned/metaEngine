using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MetaEngine.Application.Calculations;
using MetaEngine.Domain;
using MetaEngine.Domain.Calculations;
using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace MetaEngine.Infrastructure.Calculations;

internal sealed class CalculationRunService(
    MetaEngineDbContext dbContext,
    ILogger<CalculationRunService> logger) : ICalculationRunService, ICalculationRunProcessor
{
    private const string EngineVersion = "base-calculation-v1";
    private const string MissingDataRule = "zero_diff";

    public async Task<CalculationRunSummary> QueueAsync(
        QueueBaseCalculationCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        ValidateQueueCommand(command);
        await EnsureInputExistsAsync(command, cancellationToken);

        var run = new CalculationRun
        {
            WorkspaceId = command.WorkspaceId,
            Kind = CalculationRunKind.Base,
            InputType = command.InputType,
            PortfolioId = command.InputType == CalculationInputType.Portfolio ? command.InputId : null,
            PresetId = command.InputType == CalculationInputType.Preset ? command.InputId : null,
            PeriodStart = command.PeriodStart.ToUniversalTime(),
            PeriodEnd = command.PeriodEnd.ToUniversalTime(),
            Timeframe = command.Timeframe,
            MissingDataRule = MissingDataRule,
            EngineVersion = EngineVersion,
            Status = JobStatus.Queued,
            CreatedByUserId = command.UserId
        };
        dbContext.CalculationRuns.Add(run);
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = command.WorkspaceId,
            UserId = command.UserId,
            Action = "calculation_queued",
            EntityType = "calculation_run",
            EntityId = run.Id,
            DetailsJson = JsonSerializer.Serialize(new
            {
                run.Kind,
                run.InputType,
                run.PortfolioId,
                run.PresetId,
                run.PeriodStart,
                run.PeriodEnd,
                run.Timeframe,
                run.EngineVersion
            })
        });
        await dbContext.SaveChangesAsync(cancellationToken);
        return ToSummary(run);
    }

    public async Task<IReadOnlyList<CalculationRunSummary>> ListAsync(
        Guid workspaceId,
        CancellationToken cancellationToken) =>
        await dbContext.CalculationRuns
            .AsNoTracking()
            .Where(run => run.WorkspaceId == workspaceId)
            .OrderByDescending(run => run.CreatedAt)
            .Select(run => new CalculationRunSummary(
                run.Id,
                run.Kind,
                run.InputType,
                run.PortfolioId,
                run.PresetId,
                run.PeriodStart,
                run.PeriodEnd,
                run.Timeframe,
                run.Status,
                run.PointCount,
                run.TradeCount,
                run.FinalAccum,
                run.HighWaterMark,
                run.MaxDrawdown,
                run.ErrorCode,
                run.CreatedAt,
                run.StartedAt,
                run.CompletedAt,
                run.CreatedByUserId))
            .ToArrayAsync(cancellationToken);

    public async Task<CalculationRunDetails?> FindAsync(
        Guid workspaceId,
        Guid runId,
        CancellationToken cancellationToken)
    {
        var run = await dbContext.CalculationRuns
            .AsNoTracking()
            .Include(candidate => candidate.Artifacts)
            .SingleOrDefaultAsync(
                candidate => candidate.WorkspaceId == workspaceId && candidate.Id == runId,
                cancellationToken);
        if (run is null)
        {
            return null;
        }

        var artifact = run.Artifacts.SingleOrDefault(candidate => candidate.Kind == RunArtifactKind.BaseResult);
        return new CalculationRunDetails(
            ToSummary(run),
            artifact is null
                ? null
                : new CalculationArtifactSummary(
                    artifact.Id,
                    artifact.PointCount,
                    artifact.SeriesChecksum,
                    artifact.CreatedAt),
            DeserializeWarnings(run.WarningsJson));
    }

    public async Task<CalculationResultPage?> GetResultPageAsync(
        Guid workspaceId,
        Guid runId,
        int offset,
        int limit,
        CancellationToken cancellationToken)
    {
        var artifact = await dbContext.RunArtifacts
            .AsNoTracking()
            .Where(artifact =>
                artifact.CalculationRunId == runId &&
                artifact.Kind == RunArtifactKind.BaseResult &&
                artifact.CalculationRun.WorkspaceId == workspaceId)
            .Select(artifact => new { artifact.Id, artifact.PointCount })
            .SingleOrDefaultAsync(cancellationToken);
        if (artifact is null)
        {
            return null;
        }

        var items = await dbContext.RunArtifactPoints
            .AsNoTracking()
            .Where(point => point.RunArtifactId == artifact.Id)
            .OrderBy(point => point.Timestamp)
            .Skip(offset)
            .Take(limit)
            .Select(point => new CalculationResultPoint(point.Timestamp, point.Diff))
            .ToArrayAsync(cancellationToken);
        return new CalculationResultPage(offset, limit, artifact.PointCount, items);
    }

    public async Task<bool> ProcessNextAsync(CancellationToken cancellationToken)
    {
        var runId = await ClaimNextAsync(cancellationToken);
        if (runId is null)
        {
            return false;
        }

        try
        {
            var run = await LoadClaimedRunAsync(runId.Value, cancellationToken);
            var result = Calculate(run);
            var artifact = new RunArtifact
            {
                CalculationRunId = run.Id,
                Kind = RunArtifactKind.BaseResult,
                PointCount = result.Rows.Count,
                SeriesChecksum = CalculateSeriesChecksum(result.Rows)
            };
            foreach (var row in result.Rows)
            {
                artifact.Points.Add(new RunArtifactPoint
                {
                    Timestamp = DateTimeOffset.FromUnixTimeMilliseconds(row.Timestamp),
                    Diff = row.Diff
                });
            }

            dbContext.RunArtifacts.Add(artifact);
            run.Status = JobStatus.Completed;
            run.PointCount = result.Rows.Count;
            run.TradeCount = 0;
            run.FinalAccum = result.Summary.FinalAccum;
            run.HighWaterMark = result.Summary.HighWaterMark;
            run.MaxDrawdown = result.Summary.MaxDrawdown;
            run.WarningsJson = JsonSerializer.Serialize(result.Warnings);
            run.ErrorCode = null;
            run.CompletedAt = DateTimeOffset.UtcNow;
            dbContext.AuditEvents.Add(new AuditEvent
            {
                WorkspaceId = run.WorkspaceId,
                UserId = run.CreatedByUserId,
                Action = "calculation_completed",
                EntityType = "calculation_run",
                EntityId = run.Id,
                DetailsJson = JsonSerializer.Serialize(new
                {
                    run.PointCount,
                    run.FinalAccum,
                    run.HighWaterMark,
                    run.MaxDrawdown,
                    artifact.SeriesChecksum
                })
            });
            await dbContext.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (CalculationValidationException exception)
        {
            await MarkFailedAsync(runId.Value, exception.Code, cancellationToken);
            return true;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Calculation run {CalculationRunId} failed unexpectedly.", runId.Value);
            await MarkFailedAsync(runId.Value, "calculation_failed", cancellationToken);
            return true;
        }
    }

    private async Task<Guid?> ClaimNextAsync(CancellationToken cancellationToken)
    {
        var candidateId = await dbContext.CalculationRuns
            .AsNoTracking()
            .Where(run => run.Status == JobStatus.Queued && run.Kind == CalculationRunKind.Base)
            .OrderBy(run => run.CreatedAt)
            .Select(run => (Guid?)run.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (candidateId is null)
        {
            return null;
        }

        var now = DateTimeOffset.UtcNow;
        if (dbContext.Database.IsRelational())
        {
            var claimed = await dbContext.CalculationRuns
                .Where(run => run.Id == candidateId.Value && run.Status == JobStatus.Queued)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(run => run.Status, JobStatus.Running)
                        .SetProperty(run => run.StartedAt, now),
                    cancellationToken);
            return claimed == 1 ? candidateId : null;
        }

        var inMemoryRun = await dbContext.CalculationRuns
            .SingleOrDefaultAsync(
                run => run.Id == candidateId.Value && run.Status == JobStatus.Queued,
                cancellationToken);
        if (inMemoryRun is null)
        {
            return null;
        }

        inMemoryRun.Status = JobStatus.Running;
        inMemoryRun.StartedAt = now;
        await dbContext.SaveChangesAsync(cancellationToken);
        return candidateId;
    }

    private async Task<CalculationRun> LoadClaimedRunAsync(Guid runId, CancellationToken cancellationToken)
    {
        var run = await dbContext.CalculationRuns
            .Include(candidate => candidate.Portfolio)
            .ThenInclude(portfolio => portfolio!.Points)
            .Include(candidate => candidate.Preset)
            .ThenInclude(preset => preset!.Items)
            .ThenInclude(item => item.Portfolio)
            .ThenInclude(portfolio => portfolio!.Points)
            .SingleOrDefaultAsync(
                candidate => candidate.Id == runId && candidate.Status == JobStatus.Running,
                cancellationToken);
        return run ?? throw new InvalidOperationException("Claimed calculation run was not found.");
    }

    private static CalculatedRunOutput Calculate(CalculationRun run) => run.InputType switch
    {
        CalculationInputType.Portfolio => CalculatePortfolio(run),
        CalculationInputType.Preset => CalculatePreset(run),
        _ => throw new CalculationValidationException("unsupported_input_type", "Calculation input type is not supported.")
    };

    private static CalculatedRunOutput CalculatePortfolio(CalculationRun run)
    {
        var portfolio = run.Portfolio ?? throw new CalculationValidationException(
            "portfolio_not_found",
            "Portfolio source is not available for this calculation run.");
        var result = new PortfolioCalculationEngine().Calculate(new PortfolioCalculationRequest(
            ToReturnPoints(portfolio),
            run.PeriodStart.ToUnixTimeMilliseconds(),
            run.PeriodEnd.ToUnixTimeMilliseconds(),
            portfolio.Timeframe,
            run.Timeframe));
        return new CalculatedRunOutput(result.Rows, result.Summary, result.Warnings);
    }

    private static CalculatedRunOutput CalculatePreset(CalculationRun run)
    {
        var preset = run.Preset ?? throw new CalculationValidationException(
            "preset_not_found",
            "Preset source is not available for this calculation run.");
        var items = new List<PresetCalculationItem>(preset.Items.Count);
        foreach (var item in preset.Items.OrderBy(item => item.SortOrder))
        {
            if (item.SourceType != PresetItemSourceType.Portfolio || item.Portfolio is null)
            {
                throw new CalculationValidationException(
                    "unsupported_preset_source",
                    "This preset contains a source type that is not available for production calculation yet.");
            }

            items.Add(new PresetCalculationItem(
                item.Portfolio.Id,
                ToReturnPoints(item.Portfolio),
                item.Portfolio.Timeframe,
                item.Weight,
                item.StartsAt.ToUnixTimeMilliseconds(),
                item.EndsAt?.ToUnixTimeMilliseconds()));
        }

        var result = new PresetCalculationEngine().Calculate(new PresetCalculationRequest(
            items,
            run.PeriodStart.ToUnixTimeMilliseconds(),
            run.PeriodEnd.ToUnixTimeMilliseconds(),
            run.Timeframe));
        return new CalculatedRunOutput(result.Rows, result.Summary, result.Warnings);
    }

    private static IReadOnlyList<ReturnPoint> ToReturnPoints(PortfolioVersion portfolio) =>
        portfolio.Points
            .OrderBy(point => point.Timestamp)
            .Select(point => new ReturnPoint(point.Timestamp.ToUnixTimeMilliseconds(), point.Diff))
            .ToArray();

    private async Task MarkFailedAsync(Guid runId, string errorCode, CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var run = await dbContext.CalculationRuns.SingleOrDefaultAsync(
            candidate => candidate.Id == runId,
            cancellationToken);
        if (run is null)
        {
            return;
        }

        run.Status = JobStatus.Failed;
        run.ErrorCode = errorCode;
        run.CompletedAt = DateTimeOffset.UtcNow;
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = run.WorkspaceId,
            UserId = run.CreatedByUserId,
            Action = "calculation_failed",
            EntityType = "calculation_run",
            EntityId = run.Id,
            DetailsJson = JsonSerializer.Serialize(new { errorCode })
        });
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureInputExistsAsync(
        QueueBaseCalculationCommand command,
        CancellationToken cancellationToken)
    {
        var exists = command.InputType switch
        {
            CalculationInputType.Portfolio => await dbContext.Portfolios.AnyAsync(
                portfolio => portfolio.WorkspaceId == command.WorkspaceId && portfolio.Id == command.InputId,
                cancellationToken),
            CalculationInputType.Preset => await dbContext.Presets.AnyAsync(
                preset => preset.WorkspaceId == command.WorkspaceId && preset.Id == command.InputId,
                cancellationToken),
            _ => false
        };
        if (!exists)
        {
            throw new CalculationRunValidationException(
                command.InputType == CalculationInputType.Portfolio ? "portfolio_not_found" : "preset_not_found",
                "Calculation input does not exist in this workspace.");
        }
    }

    private static void ValidateQueueCommand(QueueBaseCalculationCommand command)
    {
        if (command.PeriodEnd < command.PeriodStart)
        {
            throw new CalculationRunValidationException(
                "invalid_period",
                "Calculation period end must not be before its start.");
        }

        if (!CalculationTimeframes.Supported.Contains(command.Timeframe, StringComparer.Ordinal))
        {
            throw new CalculationRunValidationException(
                "unknown_timeframe",
                $"Timeframe '{command.Timeframe}' is not supported.");
        }
    }

    private static CalculationRunSummary ToSummary(CalculationRun run) =>
        new(
            run.Id,
            run.Kind,
            run.InputType,
            run.PortfolioId,
            run.PresetId,
            run.PeriodStart,
            run.PeriodEnd,
            run.Timeframe,
            run.Status,
            run.PointCount,
            run.TradeCount,
            run.FinalAccum,
            run.HighWaterMark,
            run.MaxDrawdown,
            run.ErrorCode,
            run.CreatedAt,
            run.StartedAt,
            run.CompletedAt,
            run.CreatedByUserId);

    private static IReadOnlyList<CalculationWarningItem> DeserializeWarnings(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<CalculationWarning>>(json)
                ?.Select(warning => new CalculationWarningItem(
                    warning.Code,
                    DateTimeOffset.FromUnixTimeMilliseconds(warning.Timestamp),
                    warning.Message))
                .ToArray() ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string CalculateSeriesChecksum(IReadOnlyList<CalculationPoint> rows)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var row in rows)
        {
            var line = $"{row.Timestamp},{row.Diff.ToString("R", CultureInfo.InvariantCulture)}\n";
            hash.AppendData(Encoding.UTF8.GetBytes(line));
        }

        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }

    private sealed record CalculatedRunOutput(
        IReadOnlyList<CalculationPoint> Rows,
        CalculationSummary Summary,
        IReadOnlyList<CalculationWarning> Warnings);
}
