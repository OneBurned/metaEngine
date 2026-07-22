using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MetaEngine.Application.Calculations;
using MetaEngine.Domain;
using MetaEngine.Domain.Calculations;
using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Processing;
using MetaEngine.Infrastructure.Persistence;
using MetaEngine.Strategies.Abstractions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace MetaEngine.Infrastructure.Calculations;

internal sealed class CalculationRunService(
    MetaEngineDbContext dbContext,
    ILogger<CalculationRunService> logger,
    JobProcessingPolicy jobProcessingPolicy,
    IEnumerable<IStrategyModule> strategyModules) : ICalculationRunService, ICalculationRunProcessor
{
    private const string EngineVersion = "base-calculation-v1";
    private const string MissingDataRule = "zero_diff";
    private readonly IReadOnlyDictionary<string, IStrategyModule> strategyModules = strategyModules
        .ToDictionary(module => module.Descriptor.StrategyType, StringComparer.Ordinal);

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

    public async Task<CalculationRunSummary> QueueStrategyAsync(
        QueueStrategyCalculationCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (string.IsNullOrWhiteSpace(command.StrategyType) || !strategyModules.TryGetValue(command.StrategyType, out var module))
        {
            throw new CalculationRunValidationException("strategy_type_not_found", "Strategy type is not registered.");
        }

        using var parametersDocument = JsonDocument.Parse(command.ParametersJson);
        var validation = module.ValidateParameters(parametersDocument.RootElement);
        if (!validation.IsValid)
        {
            throw new CalculationRunValidationException(
                "invalid_strategy_parameters",
                string.Join(" ", validation.Errors.Select(error => $"{error.Path}: {error.Message}")));
        }

        var sourceRun = await dbContext.CalculationRuns
            .AsNoTracking()
            .SingleOrDefaultAsync(run =>
                run.Id == command.SourceCalculationRunId &&
                run.WorkspaceId == command.WorkspaceId,
                cancellationToken)
            ?? throw new CalculationRunValidationException("source_run_not_found", "Base calculation run does not exist in this workspace.");
        if (sourceRun.Kind != CalculationRunKind.Base || sourceRun.Status != JobStatus.Completed)
        {
            throw new CalculationRunValidationException(
                "source_run_not_completed",
                "A completed base calculation run is required for a strategy.");
        }

        var run = new CalculationRun
        {
            WorkspaceId = command.WorkspaceId,
            Kind = CalculationRunKind.Strategy,
            InputType = sourceRun.InputType,
            PortfolioId = sourceRun.PortfolioId,
            PresetId = sourceRun.PresetId,
            SourceCalculationRunId = sourceRun.Id,
            StrategyType = module.Descriptor.StrategyType,
            StrategySchemaVersion = module.Descriptor.SchemaVersion,
            StrategyParametersJson = command.ParametersJson,
            OptimizationResultId = command.OptimizationResultId,
            PeriodStart = sourceRun.PeriodStart,
            PeriodEnd = sourceRun.PeriodEnd,
            Timeframe = sourceRun.Timeframe,
            MissingDataRule = MissingDataRule,
            EngineVersion = $"strategy-{module.Descriptor.StrategyType}-v1",
            Status = JobStatus.Queued,
            CreatedByUserId = command.UserId
        };
        dbContext.CalculationRuns.Add(run);
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = command.WorkspaceId,
            UserId = command.UserId,
            Action = "strategy_calculation_queued",
            EntityType = "calculation_run",
            EntityId = run.Id,
            DetailsJson = JsonSerializer.Serialize(new
            {
                run.SourceCalculationRunId,
                run.StrategyType,
                run.StrategySchemaVersion,
                run.OptimizationResultId,
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
                run.SourceCalculationRunId,
                run.StrategyType,
                run.StrategySchemaVersion,
                run.StrategyParametersJson,
                run.PeriodStart,
                run.PeriodEnd,
                run.Timeframe,
                run.Status,
                run.AttemptCount,
                run.RetryNotBefore,
                run.LastHeartbeatAt,
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

    public async Task<CalculationRunSummary?> RequestRetryAsync(
        Guid workspaceId,
        Guid userId,
        Guid runId,
        CancellationToken cancellationToken)
    {
        var run = await dbContext.CalculationRuns.SingleOrDefaultAsync(candidate =>
            candidate.Id == runId && candidate.WorkspaceId == workspaceId,
            cancellationToken);
        if (run is null)
        {
            return null;
        }
        if (run.Status is not (JobStatus.Failed or JobStatus.Interrupted))
        {
            throw new CalculationRunValidationException(
                "calculation_retry_not_available", "Only failed or interrupted calculations can be retried.");
        }

        var previousErrorCode = run.ErrorCode;
        run.Status = JobStatus.Queued;
        run.AttemptCount = 0;
        run.LeaseId = null;
        run.LastHeartbeatAt = null;
        run.RetryNotBefore = null;
        run.StartedAt = null;
        run.CompletedAt = null;
        run.ErrorCode = null;
        run.PointCount = 0;
        run.TradeCount = 0;
        run.FinalAccum = null;
        run.HighWaterMark = null;
        run.MaxDrawdown = null;
        run.WarningsJson = "[]";
        dbContext.AuditEvents.Add(CreateAuditEvent(run, "calculation_retry_requested", new { previousErrorCode }));
        await dbContext.SaveChangesAsync(cancellationToken);
        return ToSummary(run);
    }

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

        var artifactKind = run.Kind == CalculationRunKind.Base ? RunArtifactKind.BaseResult : RunArtifactKind.StrategyResult;
        var artifact = run.Artifacts.SingleOrDefault(candidate => candidate.Kind == artifactKind);
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
                artifact.CalculationRun.WorkspaceId == workspaceId)
            .Select(artifact => new { artifact.Id, artifact.PointCount })
            .SingleOrDefaultAsync(cancellationToken);
        if (artifact is null)
        {
            return null;
        }

        var rawItems = await dbContext.RunArtifactPoints
            .AsNoTracking()
            .Where(point => point.RunArtifactId == artifact.Id)
            .OrderBy(point => point.Timestamp)
            .Skip(offset)
            .Take(limit)
            .Select(point => new { point.Timestamp, point.Diff, point.FieldsJson })
            .ToArrayAsync(cancellationToken);
        var items = rawItems
            .Select(point => new CalculationResultPoint(point.Timestamp, point.Diff, DeserializePointFields(point.FieldsJson)))
            .ToArray();
        return new CalculationResultPage(offset, limit, artifact.PointCount, items);
    }

    public async Task<bool> ProcessNextAsync(CancellationToken cancellationToken)
    {
        var claim = await ClaimNextAsync(cancellationToken);
        if (claim is null)
        {
            return false;
        }

        try
        {
            var run = await LoadClaimedRunAsync(claim.Value, cancellationToken);
            var result = await CalculateAsync(run, cancellationToken);
            await CompleteAsync(claim.Value, result, cancellationToken);
            return true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return true;
        }
        catch (CalculationValidationException exception)
        {
            await MarkFailedAsync(claim.Value, exception.Code, cancellationToken);
            return true;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Calculation run {CalculationRunId} failed unexpectedly.", claim.Value.Id);
            if (JobProcessingPolicy.IsTransientDatabaseFailure(exception))
            {
                await ScheduleRetryAsync(claim.Value, "transient_database_error", cancellationToken);
            }
            else
            {
                await MarkFailedAsync(claim.Value, "calculation_failed", cancellationToken);
            }
            return true;
        }
    }

    public async Task RecoverExpiredLeasesAsync(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var cutoff = now - jobProcessingPolicy.LeaseDuration;
        if (IsPostgreSql)
        {
            await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                dbContext.ChangeTracker.Clear();
                await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                var lockedRuns = await dbContext.CalculationRuns
                    .FromSqlInterpolated($"""
                        SELECT *
                        FROM calculation_runs
                        WHERE status = 'Running'
                          AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= {cutoff})
                        ORDER BY last_heartbeat_at NULLS FIRST, created_at
                        FOR UPDATE SKIP LOCKED
                        """)
                    .ToArrayAsync(cancellationToken);
                RecoverRuns(lockedRuns, now);
                if (lockedRuns.Length > 0)
                {
                    await dbContext.SaveChangesAsync(cancellationToken);
                }
                await transaction.CommitAsync(cancellationToken);
            });
            return;
        }

        var runs = await dbContext.CalculationRuns
            .Where(run => run.Status == JobStatus.Running &&
                (run.LastHeartbeatAt == null || run.LastHeartbeatAt <= cutoff))
            .ToArrayAsync(cancellationToken);
        RecoverRuns(runs, now);
        if (runs.Length > 0)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task<ClaimedJob?> ClaimNextAsync(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var leaseId = Guid.CreateVersion7();
        if (IsPostgreSql)
        {
            return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                dbContext.ChangeTracker.Clear();
                await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                var run = await dbContext.CalculationRuns
                    .FromSqlInterpolated($"""
                        SELECT *
                        FROM calculation_runs
                        WHERE status = 'Queued'
                          AND (retry_not_before IS NULL OR retry_not_before <= {now})
                        ORDER BY created_at
                        FOR UPDATE SKIP LOCKED
                        LIMIT 1
                        """)
                    .SingleOrDefaultAsync(cancellationToken);
                if (run is null)
                {
                    await transaction.CommitAsync(cancellationToken);
                    return (ClaimedJob?)null;
                }

                AssignLease(run, leaseId, now);
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                dbContext.ChangeTracker.Clear();
                return new ClaimedJob(run.Id, leaseId);
            });
        }

        var runInMemory = await dbContext.CalculationRuns
            .Where(run => run.Status == JobStatus.Queued &&
                (run.RetryNotBefore == null || run.RetryNotBefore <= now))
            .OrderBy(run => run.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (runInMemory is null)
        {
            return null;
        }

        AssignLease(runInMemory, leaseId, now);
        await dbContext.SaveChangesAsync(cancellationToken);
        return new ClaimedJob(runInMemory.Id, leaseId);
    }

    private async Task<CalculationRun> LoadClaimedRunAsync(ClaimedJob claim, CancellationToken cancellationToken)
    {
        var run = await dbContext.CalculationRuns
            .SingleOrDefaultAsync(
                candidate => candidate.Id == claim.Id &&
                    candidate.Status == JobStatus.Running &&
                    candidate.LeaseId == claim.LeaseId,
                cancellationToken);
        if (run is null)
        {
            throw new InvalidOperationException("Claimed calculation run was not found.");
        }

        if (run.Kind != CalculationRunKind.Base)
        {
            return run;
        }

        return run.InputType switch
        {
            CalculationInputType.Portfolio => await dbContext.CalculationRuns
                .Include(candidate => candidate.Portfolio)
                .ThenInclude(portfolio => portfolio!.Points)
                .SingleAsync(
                    candidate => candidate.Id == claim.Id &&
                        candidate.Status == JobStatus.Running &&
                        candidate.LeaseId == claim.LeaseId,
                    cancellationToken),
            CalculationInputType.Preset => await dbContext.CalculationRuns
                .Include(candidate => candidate.Preset)
                .ThenInclude(preset => preset!.Items)
                .AsSplitQuery()
                .SingleAsync(
                    candidate => candidate.Id == claim.Id &&
                        candidate.Status == JobStatus.Running &&
                        candidate.LeaseId == claim.LeaseId,
                    cancellationToken),
            _ => throw new CalculationValidationException(
                "unsupported_input_type", "Calculation input type is not supported.")
        };
    }

    private async Task CompleteAsync(
        ClaimedJob claim,
        CalculatedRunOutput result,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var run = await dbContext.CalculationRuns.SingleOrDefaultAsync(candidate =>
            candidate.Id == claim.Id &&
            candidate.Status == JobStatus.Running &&
            candidate.LeaseId == claim.LeaseId,
            cancellationToken);
        if (run is null)
        {
            logger.LogWarning("Calculation run {CalculationRunId} lease was lost before completion.", claim.Id);
            return;
        }

        var artifact = new RunArtifact
        {
            CalculationRunId = run.Id,
            Kind = run.Kind == CalculationRunKind.Base ? RunArtifactKind.BaseResult : RunArtifactKind.StrategyResult,
            PointCount = result.Rows.Count,
            SeriesChecksum = CalculateSeriesChecksum(result.Rows)
        };
        foreach (var row in result.Rows)
        {
            artifact.Points.Add(new RunArtifactPoint
            {
                Timestamp = DateTimeOffset.FromUnixTimeMilliseconds(row.Timestamp),
                Diff = row.Diff,
                FieldsJson = SerializePointFields(row.Fields)
            });
        }

        var now = DateTimeOffset.UtcNow;
        dbContext.RunArtifacts.Add(artifact);
        run.Status = JobStatus.Completed;
        run.LeaseId = null;
        run.LastHeartbeatAt = now;
        run.RetryNotBefore = null;
        run.PointCount = result.Rows.Count;
        run.TradeCount = result.TradeCount;
        run.FinalAccum = result.Summary.FinalAccum;
        run.HighWaterMark = result.Summary.HighWaterMark;
        run.MaxDrawdown = result.Summary.MaxDrawdown;
        run.WarningsJson = JsonSerializer.Serialize(result.Warnings);
        run.ErrorCode = null;
        run.CompletedAt = now;
        dbContext.AuditEvents.Add(CreateAuditEvent(
            run,
            run.Kind == CalculationRunKind.Base ? "calculation_completed" : "strategy_calculation_completed",
            new
            {
                run.PointCount,
                run.FinalAccum,
                run.HighWaterMark,
                run.MaxDrawdown,
                artifact.SeriesChecksum
            }));
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task<CalculatedRunOutput> CalculateAsync(CalculationRun run, CancellationToken cancellationToken) => run.Kind switch
    {
        CalculationRunKind.Base => run.InputType switch
        {
            CalculationInputType.Portfolio => CalculatePortfolio(run),
            CalculationInputType.Preset => await CalculatePresetAsync(run, cancellationToken),
            _ => throw new CalculationValidationException("unsupported_input_type", "Calculation input type is not supported.")
        },
        CalculationRunKind.Strategy => await CalculateStrategyAsync(run, cancellationToken),
        _ => throw new CalculationValidationException("unsupported_calculation_kind", "Calculation kind is not supported.")
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
        return new CalculatedRunOutput(
            result.Rows.Select(row => new CalculatedRunPoint(row.Timestamp, row.Diff, new Dictionary<string, JsonElement>())).ToArray(),
            result.Summary,
            result.Warnings,
            0);
    }

    private async Task<CalculatedRunOutput> CalculatePresetAsync(
        CalculationRun run,
        CancellationToken cancellationToken)
    {
        var preset = run.Preset ?? throw new CalculationValidationException(
            "preset_not_found",
            "Preset source is not available for this calculation run.");
        var items = await LoadPresetCalculationItemsAsync(run.WorkspaceId, preset, cancellationToken);

        var result = new PresetCalculationEngine().Calculate(new PresetCalculationRequest(
            items,
            run.PeriodStart.ToUnixTimeMilliseconds(),
            run.PeriodEnd.ToUnixTimeMilliseconds(),
            run.Timeframe));
        return new CalculatedRunOutput(
            result.Rows.Select(row => new CalculatedRunPoint(row.Timestamp, row.Diff, new Dictionary<string, JsonElement>())).ToArray(),
            result.Summary,
            result.Warnings,
            0);
    }

    private async Task<IReadOnlyList<PresetCalculationItem>> LoadPresetCalculationItemsAsync(
        Guid workspaceId,
        PresetVersion preset,
        CancellationToken cancellationToken)
    {
        var portfolioIds = preset.Items
            .Where(item => item.SourceType == PresetItemSourceType.Portfolio)
            .Select(item => item.PortfolioId)
            .OfType<Guid>()
            .Distinct()
            .ToArray();
        var portfolios = await dbContext.Portfolios
            .AsNoTracking()
            .Where(portfolio => portfolio.WorkspaceId == workspaceId && portfolioIds.Contains(portfolio.Id))
            .Select(portfolio => new PortfolioPresetSource(portfolio.Id, portfolio.Timeframe))
            .ToArrayAsync(cancellationToken);
        if (portfolios.Length != portfolioIds.Length)
        {
            throw new CalculationValidationException(
                "preset_source_not_found", "A portfolio source in this preset is not available.");
        }

        var portfolioPoints = await dbContext.PortfolioPoints
            .AsNoTracking()
            .Where(point => portfolioIds.Contains(point.PortfolioId))
            .OrderBy(point => point.Timestamp)
            .Select(point => new SourcePoint(point.PortfolioId, point.Timestamp, point.Diff))
            .ToArrayAsync(cancellationToken);
        var portfolioPointsById = portfolioPoints
            .GroupBy(point => point.SourceId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<ReturnPoint>)group
                    .Select(point => new ReturnPoint(point.Timestamp.ToUnixTimeMilliseconds(), point.Diff))
                    .ToArray());
        var portfoliosById = portfolios.ToDictionary(portfolio => portfolio.Id);

        var strategyIds = preset.Items
            .Where(item => item.SourceType == PresetItemSourceType.Strategy)
            .Select(item => item.StrategyId)
            .OfType<Guid>()
            .Distinct()
            .ToArray();
        var strategies = await dbContext.Strategies
            .AsNoTracking()
            .Where(strategy =>
                strategy.WorkspaceId == workspaceId &&
                strategyIds.Contains(strategy.Id) &&
                strategy.ResultArtifact.Kind == RunArtifactKind.StrategyResult)
            .Select(strategy => new StrategyPresetSource(
                strategy.Id,
                strategy.ResultArtifactId,
                strategy.ResultArtifact.CalculationRun.Timeframe))
            .ToArrayAsync(cancellationToken);
        if (strategies.Length != strategyIds.Length)
        {
            throw new CalculationValidationException(
                "preset_source_not_found", "A saved strategy source in this preset is not available.");
        }

        var strategyArtifactIds = strategies.Select(strategy => strategy.ResultArtifactId).ToArray();
        var strategyPoints = await dbContext.RunArtifactPoints
            .AsNoTracking()
            .Where(point => strategyArtifactIds.Contains(point.RunArtifactId))
            .OrderBy(point => point.Timestamp)
            .Select(point => new SourcePoint(point.RunArtifactId, point.Timestamp, point.Diff))
            .ToArrayAsync(cancellationToken);
        var strategyPointsByArtifactId = strategyPoints
            .GroupBy(point => point.SourceId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<ReturnPoint>)group
                    .Select(point => new ReturnPoint(point.Timestamp.ToUnixTimeMilliseconds(), point.Diff))
                    .ToArray());
        var strategiesById = strategies.ToDictionary(strategy => strategy.Id);

        return preset.Items
            .OrderBy(item => item.SortOrder)
            .Select(item => item.SourceType switch
            {
                PresetItemSourceType.Portfolio when item.PortfolioId is Guid portfolioId &&
                    portfoliosById.TryGetValue(portfolioId, out var portfolio) => new PresetCalculationItem(
                    portfolioId,
                    portfolioPointsById.GetValueOrDefault(portfolioId, []),
                    portfolio.Timeframe,
                    item.Weight,
                    item.StartsAt.ToUnixTimeMilliseconds(),
                    item.EndsAt?.ToUnixTimeMilliseconds()),
                PresetItemSourceType.Strategy when item.StrategyId is Guid strategyId &&
                    strategiesById.TryGetValue(strategyId, out var strategy) => new PresetCalculationItem(
                    strategyId,
                    strategyPointsByArtifactId.GetValueOrDefault(strategy.ResultArtifactId, []),
                    strategy.Timeframe,
                    item.Weight,
                    item.StartsAt.ToUnixTimeMilliseconds(),
                    item.EndsAt?.ToUnixTimeMilliseconds()),
                _ => throw new CalculationValidationException(
                    "preset_source_not_found", "A preset source is not available.")
            })
            .ToArray();
    }

    private async Task<CalculatedRunOutput> CalculateStrategyAsync(CalculationRun run, CancellationToken cancellationToken)
    {
        if (run.SourceCalculationRunId is not Guid sourceRunId)
        {
            throw new CalculationValidationException(
                "source_run_not_found", "Strategy source calculation is not available.");
        }
        if (run.StrategyType is null || !strategyModules.TryGetValue(run.StrategyType, out var module))
        {
            throw new CalculationValidationException("strategy_type_not_found", "Strategy type is not registered.");
        }
        if (run.StrategyParametersJson is null)
        {
            throw new CalculationValidationException("invalid_strategy_parameters", "Strategy parameters are missing.");
        }

        using var parametersDocument = JsonDocument.Parse(run.StrategyParametersJson);
        var validation = module.ValidateParameters(parametersDocument.RootElement);
        if (!validation.IsValid)
        {
            throw new CalculationValidationException("invalid_strategy_parameters", "Stored strategy parameters are invalid.");
        }

        var source = await LoadStrategySourceAsync(sourceRunId, cancellationToken);
        var prepared = await module.PrepareAsync(source, cancellationToken);
        var result = await module.CalculateAsync(prepared, parametersDocument.RootElement, cancellationToken);
        var summary = new CalculationSummary(
            result.Rows.Count == 0 ? null : result.Rows[0].Timestamp,
            result.Rows.Count == 0 ? null : result.Rows[^1].Timestamp,
            result.Rows.Count,
            result.Summary.FinalAccum,
            result.Summary.HighWaterMark,
            result.Summary.MaxDrawdown);
        return new CalculatedRunOutput(
            result.Rows.Select(row => new CalculatedRunPoint(row.Timestamp, row.Diff, row.Fields)).ToArray(),
            summary,
            [],
            result.Summary.BuyCount + result.Summary.SellCount);
    }

    private async Task<IReadOnlyList<StrategySourcePoint>> LoadStrategySourceAsync(
        Guid sourceRunId,
        CancellationToken cancellationToken)
    {
        var artifactId = await dbContext.RunArtifacts
            .AsNoTracking()
            .Where(artifact =>
                artifact.CalculationRunId == sourceRunId &&
                artifact.Kind == RunArtifactKind.BaseResult)
            .Select(artifact => (Guid?)artifact.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (artifactId is null)
        {
            throw new CalculationValidationException(
                "source_run_artifact_not_found", "Strategy source result is not available.");
        }

        return await dbContext.RunArtifactPoints
            .AsNoTracking()
            .Where(point => point.RunArtifactId == artifactId.Value)
            .OrderBy(point => point.Timestamp)
            .Select(point => new StrategySourcePoint(point.Timestamp.ToUnixTimeMilliseconds(), point.Diff))
            .ToArrayAsync(cancellationToken);
    }

    private static IReadOnlyList<ReturnPoint> ToReturnPoints(PortfolioVersion portfolio) =>
        portfolio.Points
            .OrderBy(point => point.Timestamp)
            .Select(point => new ReturnPoint(point.Timestamp.ToUnixTimeMilliseconds(), point.Diff))
            .ToArray();

    private sealed record SourcePoint(Guid SourceId, DateTimeOffset Timestamp, double Diff);

    private sealed record PortfolioPresetSource(Guid Id, string Timeframe);

    private sealed record StrategyPresetSource(Guid Id, Guid ResultArtifactId, string Timeframe);

    private async Task ScheduleRetryAsync(
        ClaimedJob claim,
        string errorCode,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var run = await dbContext.CalculationRuns.SingleOrDefaultAsync(
            candidate => candidate.Id == claim.Id &&
                candidate.Status == JobStatus.Running &&
                candidate.LeaseId == claim.LeaseId,
            cancellationToken);
        if (run is null)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        if (jobProcessingPolicy.CanRetryAutomatically(run.AttemptCount))
        {
            RequeueForRetry(run, now, errorCode);
            dbContext.AuditEvents.Add(CreateAuditEvent(run, "calculation_retry_scheduled", new
            {
                errorCode,
                run.AttemptCount,
                run.RetryNotBefore
            }));
        }
        else
        {
            MarkInterrupted(run, now, errorCode);
            dbContext.AuditEvents.Add(CreateAuditEvent(run, "calculation_interrupted", new { errorCode, run.AttemptCount }));
        }
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task MarkFailedAsync(
        ClaimedJob claim,
        string errorCode,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var run = await dbContext.CalculationRuns.SingleOrDefaultAsync(
            candidate => candidate.Id == claim.Id &&
                candidate.Status == JobStatus.Running &&
                candidate.LeaseId == claim.LeaseId,
            cancellationToken);
        if (run is null)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        run.Status = JobStatus.Failed;
        run.LeaseId = null;
        run.LastHeartbeatAt = now;
        run.RetryNotBefore = null;
        run.ErrorCode = errorCode;
        run.CompletedAt = now;
        dbContext.AuditEvents.Add(CreateAuditEvent(
            run,
            run.Kind == CalculationRunKind.Base ? "calculation_failed" : "strategy_calculation_failed",
            new { errorCode, run.AttemptCount }));
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private void RecoverRuns(IReadOnlyList<CalculationRun> runs, DateTimeOffset now)
    {
        foreach (var run in runs)
        {
            if (jobProcessingPolicy.CanRetryAutomatically(run.AttemptCount))
            {
                RequeueForRetry(run, now, "worker_lease_expired");
                dbContext.AuditEvents.Add(CreateAuditEvent(run, "calculation_recovered", new
                {
                    run.AttemptCount,
                    run.RetryNotBefore
                }));
            }
            else
            {
                MarkInterrupted(run, now, "worker_lease_expired");
                dbContext.AuditEvents.Add(CreateAuditEvent(run, "calculation_interrupted", new { run.AttemptCount }));
            }
        }
    }

    private void RequeueForRetry(CalculationRun run, DateTimeOffset now, string errorCode)
    {
        run.Status = JobStatus.Queued;
        run.LeaseId = null;
        run.LastHeartbeatAt = now;
        run.RetryNotBefore = jobProcessingPolicy.GetRetryNotBefore(now, run.AttemptCount);
        run.ErrorCode = errorCode;
        run.CompletedAt = null;
    }

    private static void MarkInterrupted(CalculationRun run, DateTimeOffset now, string errorCode)
    {
        run.Status = JobStatus.Interrupted;
        run.LeaseId = null;
        run.LastHeartbeatAt = now;
        run.RetryNotBefore = null;
        run.ErrorCode = errorCode;
        run.CompletedAt = now;
    }

    private static void AssignLease(CalculationRun run, Guid leaseId, DateTimeOffset now)
    {
        run.Status = JobStatus.Running;
        run.AttemptCount++;
        run.LeaseId = leaseId;
        run.LastHeartbeatAt = now;
        run.RetryNotBefore = null;
        run.ErrorCode = null;
        run.StartedAt = now;
        run.CompletedAt = null;
    }

    private static AuditEvent CreateAuditEvent(CalculationRun run, string action, object details) => new()
    {
        WorkspaceId = run.WorkspaceId,
        UserId = run.CreatedByUserId,
        Action = action,
        EntityType = "calculation_run",
        EntityId = run.Id,
        DetailsJson = JsonSerializer.Serialize(details)
    };

    private bool IsPostgreSql =>
        string.Equals(dbContext.Database.ProviderName, "Npgsql.EntityFrameworkCore.PostgreSQL", StringComparison.Ordinal);

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
            run.SourceCalculationRunId,
            run.StrategyType,
            run.StrategySchemaVersion,
            run.StrategyParametersJson,
            run.PeriodStart,
            run.PeriodEnd,
            run.Timeframe,
            run.Status,
            run.AttemptCount,
            run.RetryNotBefore,
            run.LastHeartbeatAt,
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

    private static string SerializePointFields(IReadOnlyDictionary<string, JsonElement> fields) =>
        fields.Count == 0 ? "{}" : JsonSerializer.Serialize(fields);

    private static IReadOnlyDictionary<string, JsonElement> DeserializePointFields(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json) ?? [];
        }
        catch (JsonException)
        {
            return new Dictionary<string, JsonElement>();
        }
    }

    private static string CalculateSeriesChecksum(IReadOnlyList<CalculatedRunPoint> rows)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var row in rows)
        {
            var line = $"{row.Timestamp},{row.Diff.ToString("R", CultureInfo.InvariantCulture)}\n";
            hash.AppendData(Encoding.UTF8.GetBytes(line));
        }

        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }

    private sealed record CalculatedRunPoint(
        long Timestamp,
        double Diff,
        IReadOnlyDictionary<string, JsonElement> Fields);

    private sealed record CalculatedRunOutput(
        IReadOnlyList<CalculatedRunPoint> Rows,
        CalculationSummary Summary,
        IReadOnlyList<CalculationWarning> Warnings,
        int TradeCount);
}
