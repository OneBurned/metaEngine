using System.Diagnostics;
using System.Text.Json;
using MetaEngine.Application.Calculations;
using MetaEngine.Application.Optimizations;
using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Processing;
using MetaEngine.Infrastructure.Persistence;
using MetaEngine.Strategies.Abstractions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace MetaEngine.Infrastructure.Optimizations;

internal sealed class OptimizationJobService(
    MetaEngineDbContext dbContext,
    ILogger<OptimizationJobService> logger,
    JobProcessingPolicy jobProcessingPolicy,
    ICalculationRunService calculationRunService,
    IEnumerable<IStrategyModule> strategyModules) : IOptimizationJobService, IOptimizationJobProcessor
{
    private const string MissingDataRule = "zero_diff";
    private readonly IReadOnlyDictionary<string, IStrategyModule> strategyModules = strategyModules
        .ToDictionary(module => module.Descriptor.StrategyType, StringComparer.Ordinal);

    public async Task<OptimizationJobSummary> QueueAsync(
        QueueOptimizationJobCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        ValidateCommand(command);
        var module = GetOptimizationModule(command.StrategyType);

        using var searchSpaceDocument = ParseSearchSpace(command.SearchSpaceJson);
        var searchSpace = searchSpaceDocument.RootElement.Clone();
        var validation = module.ValidateSearchSpace(searchSpace);
        if (!validation.IsValid)
        {
            throw new OptimizationJobValidationException(
                "invalid_optimization_search_space",
                string.Join(" ", validation.Errors.Select(error => $"{error.Path}: {error.Message}")));
        }

        var totalCandidates = module.EstimateCandidateCount(searchSpace);
        if (totalCandidates is 0)
        {
            throw new OptimizationJobValidationException(
                "empty_optimization_search_space",
                "Optimization search space does not contain any candidates.");
        }

        var sourceRun = await dbContext.CalculationRuns
            .AsNoTracking()
            .Include(run => run.Artifacts)
            .SingleOrDefaultAsync(run =>
                run.Id == command.SourceCalculationRunId &&
                run.WorkspaceId == command.WorkspaceId,
                cancellationToken)
            ?? throw new OptimizationJobValidationException(
                "source_run_not_found", "Base calculation run does not exist in this workspace.");
        if (sourceRun.Kind != CalculationRunKind.Base || sourceRun.Status != JobStatus.Completed ||
            sourceRun.Artifacts.All(artifact => artifact.Kind != RunArtifactKind.BaseResult))
        {
            throw new OptimizationJobValidationException(
                "source_run_not_completed", "A completed base calculation run is required for optimization.");
        }

        var job = new OptimizationJob
        {
            WorkspaceId = command.WorkspaceId,
            SourceCalculationRunId = sourceRun.Id,
            InputType = sourceRun.InputType,
            PortfolioId = sourceRun.PortfolioId,
            PresetId = sourceRun.PresetId,
            StrategyType = module.Descriptor.StrategyType,
            StrategySchemaVersion = module.Descriptor.SchemaVersion,
            SearchSpaceJson = JsonSerializer.Serialize(new StoredJobSettings(searchSpace, command.Filters)),
            PeriodStart = sourceRun.PeriodStart,
            PeriodEnd = sourceRun.PeriodEnd,
            Timeframe = sourceRun.Timeframe,
            MissingDataRule = MissingDataRule,
            EngineVersion = $"strategy-{module.Descriptor.StrategyType}-optimizer-v1",
            SampleCount = command.SampleCount,
            Seed = command.Seed,
            TopCount = command.TopCount,
            TotalCandidates = totalCandidates,
            Status = JobStatus.Queued,
            CreatedByUserId = command.UserId
        };
        dbContext.OptimizationJobs.Add(job);
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = command.WorkspaceId,
            UserId = command.UserId,
            Action = "optimization_queued",
            EntityType = "optimization_job",
            EntityId = job.Id,
            DetailsJson = JsonSerializer.Serialize(new
            {
                job.SourceCalculationRunId,
                job.StrategyType,
                job.StrategySchemaVersion,
                job.SampleCount,
                job.TotalCandidates,
                job.TopCount,
                job.EngineVersion
            })
        });
        await dbContext.SaveChangesAsync(cancellationToken);
        return ToSummary(job);
    }

    public async Task<IReadOnlyList<OptimizationJobSummary>> ListAsync(
        Guid workspaceId,
        CancellationToken cancellationToken) =>
        await dbContext.OptimizationJobs
            .AsNoTracking()
            .Where(job => job.WorkspaceId == workspaceId)
            .OrderByDescending(job => job.CreatedAt)
            .Select(job => new OptimizationJobSummary(
                job.Id,
                job.SourceCalculationRunId,
                job.InputType,
                job.PortfolioId,
                job.PresetId,
                job.StrategyType,
                job.StrategySchemaVersion,
                job.PeriodStart,
                job.PeriodEnd,
                job.Timeframe,
                job.SampleCount,
                job.Seed,
                job.TopCount,
                job.TotalCandidates,
                job.ProcessedCandidates,
                job.Status,
                job.AttemptCount,
                job.RetryNotBefore,
                job.LastHeartbeatAt,
                job.StopRequestedAt,
                job.ErrorCode,
                job.CreatedAt,
                job.StartedAt,
                job.CompletedAt))
            .ToArrayAsync(cancellationToken);

    public async Task<OptimizationJobDetails?> FindAsync(
        Guid workspaceId,
        Guid jobId,
        CancellationToken cancellationToken)
    {
        var job = await dbContext.OptimizationJobs
            .AsNoTracking()
            .Include(candidate => candidate.Results)
            .SingleOrDefaultAsync(candidate =>
                candidate.Id == jobId && candidate.WorkspaceId == workspaceId,
                cancellationToken);
        return job is null
            ? null
            : new OptimizationJobDetails(
                ToSummary(job),
                ParseSettings(job.SearchSpaceJson).Filters,
                job.Results
                    .OrderBy(result => result.Rank)
                    .Select(ToSummary)
                    .ToArray());
    }

    public async Task<OptimizationJobSummary?> RequestStopAsync(
        Guid workspaceId,
        Guid userId,
        Guid jobId,
        CancellationToken cancellationToken)
    {
        var job = await dbContext.OptimizationJobs
            .Include(candidate => candidate.Results)
            .SingleOrDefaultAsync(candidate =>
                candidate.Id == jobId && candidate.WorkspaceId == workspaceId,
                cancellationToken);
        if (job is null)
        {
            return null;
        }

        var now = DateTimeOffset.UtcNow;
        var action = string.Empty;
        if (job.Status == JobStatus.Queued)
        {
            job.Status = JobStatus.Stopped;
            job.StopRequestedAt = now;
            job.CompletedAt = now;
            action = "optimization_stopped";
        }
        else if (job.Status == JobStatus.Running)
        {
            job.Status = JobStatus.Stopping;
            job.StopRequestedAt = now;
            action = "optimization_stop_requested";
        }

        if (!string.IsNullOrEmpty(action))
        {
            dbContext.AuditEvents.Add(new AuditEvent
            {
                WorkspaceId = workspaceId,
                UserId = userId,
                Action = action,
                EntityType = "optimization_job",
                EntityId = job.Id,
                DetailsJson = JsonSerializer.Serialize(new { job.ProcessedCandidates })
            });
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return ToSummary(job);
    }

    public async Task<OptimizationJobSummary?> RequestRetryAsync(
        Guid workspaceId,
        Guid userId,
        Guid jobId,
        CancellationToken cancellationToken)
    {
        var job = await dbContext.OptimizationJobs.SingleOrDefaultAsync(candidate =>
            candidate.Id == jobId && candidate.WorkspaceId == workspaceId,
            cancellationToken);
        if (job is null)
        {
            return null;
        }
        if (job.Status is not (JobStatus.Failed or JobStatus.Interrupted))
        {
            throw new OptimizationJobValidationException(
                "optimization_retry_not_available", "Only failed or interrupted optimizations can be retried.");
        }

        var previousErrorCode = job.ErrorCode;
        job.Status = JobStatus.Queued;
        job.AttemptCount = 0;
        job.LeaseId = null;
        job.LastHeartbeatAt = null;
        job.RetryNotBefore = null;
        job.StartedAt = null;
        job.StopRequestedAt = null;
        job.CompletedAt = null;
        job.ErrorCode = null;
        job.ProcessedCandidates = 0;
        if (job.Results.Count > 0)
        {
            dbContext.OptimizationResults.RemoveRange(job.Results);
        }
        dbContext.AuditEvents.Add(CreateAuditEvent(job, "optimization_retry_requested", new { previousErrorCode }));
        await dbContext.SaveChangesAsync(cancellationToken);
        return ToSummary(job);
    }

    public async Task<CalculationRunSummary> QueueStrategyRunAsync(
        Guid workspaceId,
        Guid userId,
        Guid jobId,
        Guid resultId,
        CancellationToken cancellationToken)
    {
        var candidate = await dbContext.OptimizationResults
            .AsNoTracking()
            .Where(result =>
                result.Id == resultId &&
                result.OptimizationJobId == jobId &&
                result.OptimizationJob.WorkspaceId == workspaceId)
            .Select(result => new
            {
                result.Id,
                result.ParametersJson,
                result.OptimizationJob.StrategyType,
                result.OptimizationJob.SourceCalculationRunId,
                result.OptimizationJob.Status
            })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new OptimizationJobValidationException(
                "optimization_result_not_found", "Optimization result does not exist in this workspace.");
        if (candidate.Status is not (JobStatus.Completed or JobStatus.Stopped) || candidate.SourceCalculationRunId is null)
        {
            throw new OptimizationJobValidationException(
                "optimization_not_completed", "Optimization results are available only after the job stops or completes.");
        }

        return await calculationRunService.QueueStrategyAsync(
            new QueueStrategyCalculationCommand(
                workspaceId,
                userId,
                candidate.SourceCalculationRunId.Value,
                candidate.StrategyType,
                candidate.ParametersJson,
                candidate.Id),
            cancellationToken);
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
            await ProcessClaimedAsync(claim.Value, cancellationToken);
            return true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return true;
        }
        catch (OptimizationJobValidationException exception)
        {
            await MarkFailedAsync(claim.Value, exception.Code, cancellationToken);
            return true;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Optimization job {OptimizationJobId} failed unexpectedly.", claim.Value.Id);
            if (JobProcessingPolicy.IsTransientDatabaseFailure(exception))
            {
                await ScheduleRetryAsync(claim.Value, "transient_database_error", cancellationToken);
            }
            else
            {
                await MarkFailedAsync(claim.Value, "optimization_failed", cancellationToken);
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
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var lockedJobs = await dbContext.OptimizationJobs
                .FromSqlInterpolated($"""
                    SELECT *
                    FROM optimization_jobs
                    WHERE status IN ('Running', 'Stopping')
                      AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= {cutoff})
                    ORDER BY last_heartbeat_at NULLS FIRST, created_at
                    FOR UPDATE SKIP LOCKED
                    """)
                .ToArrayAsync(cancellationToken);
            RecoverJobs(lockedJobs, now);
            if (lockedJobs.Length > 0)
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        var jobs = await dbContext.OptimizationJobs
            .Where(job =>
                (job.Status == JobStatus.Running || job.Status == JobStatus.Stopping) &&
                (job.LastHeartbeatAt == null || job.LastHeartbeatAt <= cutoff))
            .ToArrayAsync(cancellationToken);
        RecoverJobs(jobs, now);
        if (jobs.Length > 0)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task ProcessClaimedAsync(ClaimedJob claim, CancellationToken cancellationToken)
    {
        var job = await dbContext.OptimizationJobs
            .AsNoTracking()
            .SingleOrDefaultAsync(candidate =>
                candidate.Id == claim.Id &&
                candidate.LeaseId == claim.LeaseId &&
                (candidate.Status == JobStatus.Running || candidate.Status == JobStatus.Stopping),
                cancellationToken)
            ?? throw new OptimizationJobValidationException("optimization_not_found", "Claimed optimization job was not found.");
        if (job.SourceCalculationRunId is not Guid sourceRunId)
        {
            throw new OptimizationJobValidationException("optimization_source_not_found", "Optimization source calculation is missing.");
        }
        if (!strategyModules.TryGetValue(job.StrategyType, out var module) ||
            !module.Descriptor.IsProductionOptimizationAvailable)
        {
            throw new OptimizationJobValidationException("strategy_optimization_not_available", "Strategy optimization is not available.");
        }

        var settings = ParseSettings(job.SearchSpaceJson);
        var source = await LoadSourceAsync(sourceRunId, cancellationToken);
        var samples = SplitSamples(source, job.SampleCount);
        var preparedSamples = new IStrategyPreparedData[samples.Count];
        for (var index = 0; index < samples.Count; index++)
        {
            preparedSamples[index] = await module.PrepareAsync(samples[index], cancellationToken);
        }

        var best = new List<CandidateEvaluation>(job.TopCount);
        var processed = 0L;
        var stopped = await IsStopRequestedAsync(claim, cancellationToken);
        var progressTimer = Stopwatch.StartNew();
        await foreach (var parameters in module.GenerateCandidatesAsync(settings.Parameters, job.Seed, cancellationToken))
        {
            if (stopped)
            {
                break;
            }

            var evaluation = await EvaluateAsync(module, preparedSamples, samples, parameters, cancellationToken);
            processed++;
            if (PassesFilters(evaluation, settings.Filters))
            {
                KeepBest(best, evaluation, job.TopCount);
            }

            stopped = await IsStopRequestedAsync(claim, cancellationToken);
            if (processed % 25 == 0 || progressTimer.Elapsed >= TimeSpan.FromSeconds(1) || stopped)
            {
                if (!await UpdateProgressAsync(claim, processed, cancellationToken))
                {
                    return;
                }
                progressTimer.Restart();
            }
        }

        await CompleteAsync(claim, processed, best, stopped, cancellationToken);
    }

    private async Task<ClaimedJob?> ClaimNextAsync(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var leaseId = Guid.CreateVersion7();
        if (IsPostgreSql)
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var lockedJob = await dbContext.OptimizationJobs
                .FromSqlInterpolated($"""
                    SELECT *
                    FROM optimization_jobs
                    WHERE status = 'Queued'
                      AND (retry_not_before IS NULL OR retry_not_before <= {now})
                    ORDER BY created_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                    """)
                .SingleOrDefaultAsync(cancellationToken);
            if (lockedJob is null)
            {
                await transaction.CommitAsync(cancellationToken);
                return null;
            }

            AssignLease(lockedJob, leaseId, now);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            dbContext.ChangeTracker.Clear();
            return new ClaimedJob(lockedJob.Id, leaseId);
        }

        var job = await dbContext.OptimizationJobs.SingleOrDefaultAsync(candidate =>
            candidate.Status == JobStatus.Queued &&
            (candidate.RetryNotBefore == null || candidate.RetryNotBefore <= now),
            cancellationToken);
        if (job is null)
        {
            return null;
        }

        AssignLease(job, leaseId, now);
        await dbContext.SaveChangesAsync(cancellationToken);
        return new ClaimedJob(job.Id, leaseId);
    }

    private async Task<IReadOnlyList<StrategySourcePoint>> LoadSourceAsync(
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
            throw new OptimizationJobValidationException(
                "optimization_source_artifact_not_found", "Optimization source result is not available.");
        }

        return await dbContext.RunArtifactPoints
            .AsNoTracking()
            .Where(point => point.RunArtifactId == artifactId.Value)
            .OrderBy(point => point.Timestamp)
            .Select(point => new StrategySourcePoint(point.Timestamp.ToUnixTimeMilliseconds(), point.Diff))
            .ToArrayAsync(cancellationToken);
    }

    private static IReadOnlyList<IReadOnlyList<StrategySourcePoint>> SplitSamples(
        IReadOnlyList<StrategySourcePoint> source,
        int sampleCount)
    {
        if (source.Count < sampleCount)
        {
            throw new OptimizationJobValidationException(
                "optimization_sample_count_too_large", "Sample count cannot exceed source point count.");
        }

        var samples = new IReadOnlyList<StrategySourcePoint>[sampleCount];
        var baseLength = source.Count / sampleCount;
        var remainder = source.Count % sampleCount;
        var offset = 0;
        for (var index = 0; index < sampleCount; index++)
        {
            var length = baseLength + (index < remainder ? 1 : 0);
            samples[index] = source.Skip(offset).Take(length).ToArray();
            offset += length;
        }
        return samples;
    }

    private static async Task<CandidateEvaluation> EvaluateAsync(
        IStrategyModule module,
        IReadOnlyList<IStrategyPreparedData> preparedSamples,
        IReadOnlyList<IReadOnlyList<StrategySourcePoint>> samples,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        var metrics = new List<OptimizationSampleMetric>(samples.Count);
        var compounded = 1d;
        var tradeCount = 0;
        for (var index = 0; index < samples.Count; index++)
        {
            var summary = await module.CalculateSummaryAsync(preparedSamples[index], parameters, cancellationToken);
            compounded *= 1 + summary.FinalAccum;
            var trades = summary.BuyCount + summary.SellCount;
            tradeCount += trades;
            metrics.Add(new OptimizationSampleMetric(
                index + 1,
                DateTimeOffset.FromUnixTimeMilliseconds(samples[index][0].Timestamp),
                DateTimeOffset.FromUnixTimeMilliseconds(samples[index][^1].Timestamp),
                summary.FinalAccum,
                summary.MaxDrawdown,
                trades,
                CalculateRecoveryScore(summary.FinalAccum, summary.MaxDrawdown)));
        }

        var compoundedAccum = compounded - 1;
        var averageAccum = metrics.Average(metric => metric.FinalAccum);
        var worstAccum = metrics.Min(metric => metric.FinalAccum);
        var worstMdd = metrics.Min(metric => metric.MaxDrawdown);
        return new CandidateEvaluation(
            parameters.GetRawText(),
            CalculateRecoveryScore(compoundedAccum, worstMdd),
            compoundedAccum,
            averageAccum,
            worstAccum,
            worstMdd,
            tradeCount,
            metrics.Count(metric => metric.FinalAccum > 0),
            metrics);
    }

    private static bool PassesFilters(CandidateEvaluation result, OptimizationFilters filters) =>
        (filters.MaximumDrawdownMagnitude is not double maximumDrawdown ||
            Math.Abs(result.WorstMaxDrawdown) <= maximumDrawdown) &&
        (filters.MinimumTradeCount is not int minimumTradeCount || result.TradeCount >= minimumTradeCount) &&
        (filters.MinimumProfitableSampleCount is not int minimumProfitableSampleCount ||
            result.ProfitableSampleCount >= minimumProfitableSampleCount);

    private static void KeepBest(List<CandidateEvaluation> best, CandidateEvaluation candidate, int topCount)
    {
        best.Add(candidate);
        best.Sort(CompareCandidates);
        if (best.Count > topCount)
        {
            best.RemoveAt(best.Count - 1);
        }
    }

    private static int CompareCandidates(CandidateEvaluation left, CandidateEvaluation right)
    {
        var byScore = right.Score.CompareTo(left.Score);
        if (byScore != 0) return byScore;
        var byAccum = right.CompoundedAccum.CompareTo(left.CompoundedAccum);
        if (byAccum != 0) return byAccum;
        var byMdd = right.WorstMaxDrawdown.CompareTo(left.WorstMaxDrawdown);
        return byMdd != 0 ? byMdd : string.CompareOrdinal(left.ParametersJson, right.ParametersJson);
    }

    private async Task<bool> IsStopRequestedAsync(ClaimedJob claim, CancellationToken cancellationToken) =>
        await dbContext.OptimizationJobs
            .AsNoTracking()
            .Where(job => job.Id == claim.Id)
            .Select(job => job.LeaseId != claim.LeaseId ||
                job.Status == JobStatus.Stopping ||
                job.Status == JobStatus.Stopped)
            .SingleOrDefaultAsync(cancellationToken);

    private async Task<bool> UpdateProgressAsync(ClaimedJob claim, long processed, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        if (dbContext.Database.IsRelational())
        {
            var updated = await dbContext.OptimizationJobs
                .Where(job =>
                    job.Id == claim.Id &&
                    job.LeaseId == claim.LeaseId &&
                    (job.Status == JobStatus.Running || job.Status == JobStatus.Stopping))
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(job => job.ProcessedCandidates, processed)
                        .SetProperty(job => job.LastHeartbeatAt, now),
                    cancellationToken);
            return updated == 1;
        }

        dbContext.ChangeTracker.Clear();
        var job = await dbContext.OptimizationJobs.SingleOrDefaultAsync(job =>
            job.Id == claim.Id &&
            job.LeaseId == claim.LeaseId &&
            (job.Status == JobStatus.Running || job.Status == JobStatus.Stopping),
            cancellationToken);
        if (job is null)
        {
            return false;
        }
        job.ProcessedCandidates = processed;
        job.LastHeartbeatAt = now;
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private async Task CompleteAsync(
        ClaimedJob claim,
        long processed,
        IReadOnlyList<CandidateEvaluation> best,
        bool stopped,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var job = await dbContext.OptimizationJobs
            .Include(candidate => candidate.Results)
            .SingleOrDefaultAsync(candidate =>
                candidate.Id == claim.Id &&
                candidate.LeaseId == claim.LeaseId &&
                (candidate.Status == JobStatus.Running || candidate.Status == JobStatus.Stopping),
                cancellationToken);
        if (job is null)
        {
            logger.LogWarning("Optimization job {OptimizationJobId} lease was lost before completion.", claim.Id);
            return;
        }
        var isStopped = stopped || job.Status is JobStatus.Stopping or JobStatus.Stopped;
        if (job.Results.Count > 0)
        {
            dbContext.OptimizationResults.RemoveRange(job.Results);
        }
        for (var index = 0; index < best.Count; index++)
        {
            var result = best[index];
            dbContext.OptimizationResults.Add(new OptimizationResult
            {
                OptimizationJobId = job.Id,
                Rank = index + 1,
                ParametersJson = result.ParametersJson,
                Score = result.Score,
                CompoundedAccum = result.CompoundedAccum,
                AverageAccum = result.AverageAccum,
                WorstAccum = result.WorstAccum,
                WorstMaxDrawdown = result.WorstMaxDrawdown,
                TradeCount = result.TradeCount,
                ProfitableSampleCount = result.ProfitableSampleCount,
                SampleMetricsJson = JsonSerializer.Serialize(result.Samples)
            });
        }
        job.ProcessedCandidates = processed;
        job.Status = isStopped ? JobStatus.Stopped : JobStatus.Completed;
        job.LeaseId = null;
        job.LastHeartbeatAt = DateTimeOffset.UtcNow;
        job.RetryNotBefore = null;
        job.CompletedAt = job.LastHeartbeatAt;
        job.ErrorCode = null;
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = job.WorkspaceId,
            UserId = job.CreatedByUserId,
            Action = isStopped ? "optimization_stopped" : "optimization_completed",
            EntityType = "optimization_job",
            EntityId = job.Id,
            DetailsJson = JsonSerializer.Serialize(new
            {
                job.ProcessedCandidates,
                ResultCount = best.Count,
                job.TotalCandidates
            })
        });
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task ScheduleRetryAsync(
        ClaimedJob claim,
        string errorCode,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var job = await dbContext.OptimizationJobs.SingleOrDefaultAsync(candidate =>
            candidate.Id == claim.Id &&
            candidate.LeaseId == claim.LeaseId &&
            (candidate.Status == JobStatus.Running || candidate.Status == JobStatus.Stopping),
            cancellationToken);
        if (job is null)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        if (job.Status == JobStatus.Stopping)
        {
            MarkStopped(job, now);
            dbContext.AuditEvents.Add(CreateAuditEvent(job, "optimization_stopped", new { job.ProcessedCandidates }));
        }
        else if (jobProcessingPolicy.CanRetryAutomatically(job.AttemptCount))
        {
            RequeueForRetry(job, now, errorCode);
            dbContext.AuditEvents.Add(CreateAuditEvent(job, "optimization_retry_scheduled", new
            {
                errorCode,
                job.AttemptCount,
                job.RetryNotBefore
            }));
        }
        else
        {
            MarkInterrupted(job, now, errorCode);
            dbContext.AuditEvents.Add(CreateAuditEvent(job, "optimization_interrupted", new { errorCode, job.AttemptCount }));
        }
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task MarkFailedAsync(
        ClaimedJob claim,
        string errorCode,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var job = await dbContext.OptimizationJobs.SingleOrDefaultAsync(candidate =>
            candidate.Id == claim.Id &&
            candidate.LeaseId == claim.LeaseId &&
            (candidate.Status == JobStatus.Running || candidate.Status == JobStatus.Stopping),
            cancellationToken);
        if (job is null)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        if (job.Status == JobStatus.Stopping)
        {
            MarkStopped(job, now);
            dbContext.AuditEvents.Add(CreateAuditEvent(job, "optimization_stopped", new { job.ProcessedCandidates }));
        }
        else
        {
            job.Status = JobStatus.Failed;
            job.LeaseId = null;
            job.LastHeartbeatAt = now;
            job.RetryNotBefore = null;
            job.ErrorCode = errorCode;
            job.CompletedAt = now;
            dbContext.AuditEvents.Add(CreateAuditEvent(job, "optimization_failed", new { errorCode, job.ProcessedCandidates, job.AttemptCount }));
        }
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private void RecoverJobs(IReadOnlyList<OptimizationJob> jobs, DateTimeOffset now)
    {
        foreach (var job in jobs)
        {
            if (job.Status == JobStatus.Stopping)
            {
                MarkStopped(job, now);
                dbContext.AuditEvents.Add(CreateAuditEvent(job, "optimization_stopped", new { job.ProcessedCandidates }));
            }
            else if (jobProcessingPolicy.CanRetryAutomatically(job.AttemptCount))
            {
                RequeueForRetry(job, now, "worker_lease_expired");
                dbContext.AuditEvents.Add(CreateAuditEvent(job, "optimization_recovered", new
                {
                    job.AttemptCount,
                    job.RetryNotBefore
                }));
            }
            else
            {
                MarkInterrupted(job, now, "worker_lease_expired");
                dbContext.AuditEvents.Add(CreateAuditEvent(job, "optimization_interrupted", new { job.AttemptCount }));
            }
        }
    }

    private void RequeueForRetry(OptimizationJob job, DateTimeOffset now, string errorCode)
    {
        job.Status = JobStatus.Queued;
        job.LeaseId = null;
        job.LastHeartbeatAt = now;
        job.RetryNotBefore = jobProcessingPolicy.GetRetryNotBefore(now, job.AttemptCount);
        job.ErrorCode = errorCode;
        job.CompletedAt = null;
        job.ProcessedCandidates = 0;
    }

    private static void MarkStopped(OptimizationJob job, DateTimeOffset now)
    {
        job.Status = JobStatus.Stopped;
        job.LeaseId = null;
        job.LastHeartbeatAt = now;
        job.RetryNotBefore = null;
        job.ErrorCode = null;
        job.CompletedAt = now;
    }

    private static void MarkInterrupted(OptimizationJob job, DateTimeOffset now, string errorCode)
    {
        job.Status = JobStatus.Interrupted;
        job.LeaseId = null;
        job.LastHeartbeatAt = now;
        job.RetryNotBefore = null;
        job.ErrorCode = errorCode;
        job.CompletedAt = now;
    }

    private static void AssignLease(OptimizationJob job, Guid leaseId, DateTimeOffset now)
    {
        job.Status = JobStatus.Running;
        job.AttemptCount++;
        job.LeaseId = leaseId;
        job.LastHeartbeatAt = now;
        job.RetryNotBefore = null;
        job.ErrorCode = null;
        job.StartedAt = now;
        job.CompletedAt = null;
        job.ProcessedCandidates = 0;
    }

    private static AuditEvent CreateAuditEvent(OptimizationJob job, string action, object details) => new()
    {
        WorkspaceId = job.WorkspaceId,
        UserId = job.CreatedByUserId,
        Action = action,
        EntityType = "optimization_job",
        EntityId = job.Id,
        DetailsJson = JsonSerializer.Serialize(details)
    };

    private bool IsPostgreSql =>
        string.Equals(dbContext.Database.ProviderName, "Npgsql.EntityFrameworkCore.PostgreSQL", StringComparison.Ordinal);

    private IStrategyModule GetOptimizationModule(string strategyType)
    {
        if (string.IsNullOrWhiteSpace(strategyType) || !strategyModules.TryGetValue(strategyType, out var module))
        {
            throw new OptimizationJobValidationException("strategy_type_not_found", "Strategy type is not registered.");
        }
        if (!module.Descriptor.Optimization.Supported || !module.Descriptor.IsProductionOptimizationAvailable)
        {
            throw new OptimizationJobValidationException(
                "strategy_optimization_not_available", "Strategy optimization is not available in production.");
        }
        return module;
    }

    private static void ValidateCommand(QueueOptimizationJobCommand command)
    {
        if (command.SampleCount < 1)
        {
            throw new OptimizationJobValidationException("invalid_sample_count", "Sample count must be at least one.");
        }
        if (command.Seed < 0)
        {
            throw new OptimizationJobValidationException("invalid_seed", "Seed must be non-negative.");
        }
        if (command.TopCount is < 1 or > OptimizationJobLimits.MaxTopResultCount)
        {
            throw new OptimizationJobValidationException(
                "invalid_top_count",
                $"Top result count must be between 1 and {OptimizationJobLimits.MaxTopResultCount}.");
        }
        ValidateFilters(command.Filters, command.SampleCount);
    }

    private static void ValidateFilters(OptimizationFilters filters, int sampleCount)
    {
        if (filters.MaximumDrawdownMagnitude is double maximumDrawdown &&
            (!double.IsFinite(maximumDrawdown) || maximumDrawdown < 0 || maximumDrawdown > 1))
        {
            throw new OptimizationJobValidationException(
                "invalid_maximum_drawdown", "Maximum drawdown magnitude must be between 0 and 1.");
        }
        if (filters.MinimumTradeCount is int minimumTradeCount && minimumTradeCount < 0)
        {
            throw new OptimizationJobValidationException(
                "invalid_minimum_trade_count", "Minimum trade count must be non-negative.");
        }
        if (filters.MinimumProfitableSampleCount is int minimumProfitableSampleCount &&
            (minimumProfitableSampleCount < 0 || minimumProfitableSampleCount > sampleCount))
        {
            throw new OptimizationJobValidationException(
                "invalid_minimum_profitable_samples", "Minimum profitable sample count must fit within sample count.");
        }
    }

    private static JsonDocument ParseSearchSpace(string json)
    {
        try
        {
            var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                document.Dispose();
                throw new OptimizationJobValidationException(
                    "invalid_optimization_search_space", "Optimization search space must be an object.");
            }
            return document;
        }
        catch (JsonException)
        {
            throw new OptimizationJobValidationException(
                "invalid_optimization_search_space", "Optimization search space must be valid JSON.");
        }
    }

    private static StoredJobSettings ParseSettings(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<StoredJobSettings>(json)
                ?? throw new OptimizationJobValidationException(
                    "invalid_optimization_search_space", "Stored optimization settings are invalid.");
        }
        catch (JsonException)
        {
            throw new OptimizationJobValidationException(
                "invalid_optimization_search_space", "Stored optimization settings are invalid.");
        }
    }

    private static double CalculateRecoveryScore(double accum, double maxDrawdown)
    {
        var denominator = Math.Max(Math.Abs(maxDrawdown), 1e-9);
        return accum / denominator;
    }

    private static OptimizationJobSummary ToSummary(OptimizationJob job) => new(
        job.Id,
        job.SourceCalculationRunId,
        job.InputType,
        job.PortfolioId,
        job.PresetId,
        job.StrategyType,
        job.StrategySchemaVersion,
        job.PeriodStart,
        job.PeriodEnd,
        job.Timeframe,
        job.SampleCount,
        job.Seed,
        job.TopCount,
        job.TotalCandidates,
        job.ProcessedCandidates,
        job.Status,
        job.AttemptCount,
        job.RetryNotBefore,
        job.LastHeartbeatAt,
        job.StopRequestedAt,
        job.ErrorCode,
        job.CreatedAt,
        job.StartedAt,
        job.CompletedAt);

    private static OptimizationResultSummary ToSummary(OptimizationResult result) => new(
        result.Id,
        result.Rank,
        result.ParametersJson,
        result.Score,
        result.CompoundedAccum,
        result.AverageAccum,
        result.WorstAccum,
        result.WorstMaxDrawdown,
        result.TradeCount,
        result.ProfitableSampleCount,
        DeserializeSamples(result.SampleMetricsJson),
        result.CreatedAt);

    private static IReadOnlyList<OptimizationSampleMetric> DeserializeSamples(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<OptimizationSampleMetric>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private sealed record StoredJobSettings(JsonElement Parameters, OptimizationFilters Filters);

    private sealed record CandidateEvaluation(
        string ParametersJson,
        double Score,
        double CompoundedAccum,
        double AverageAccum,
        double WorstAccum,
        double WorstMaxDrawdown,
        int TradeCount,
        int ProfitableSampleCount,
        IReadOnlyList<OptimizationSampleMetric> Samples);
}
