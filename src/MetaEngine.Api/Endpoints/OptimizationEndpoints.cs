using System.Text.Json;
using MetaEngine.Api.Contracts;
using MetaEngine.Api.Security;
using MetaEngine.Application.Optimizations;
using MetaEngine.Application.Security;

namespace MetaEngine.Api.Endpoints;

public static class OptimizationEndpoints
{
    public static RouteGroupBuilder MapOptimizationEndpoints(this RouteGroupBuilder workspaces)
    {
        workspaces.MapPost("/{workspaceId:guid}/calculation-runs/{sourceRunId:guid}/optimizations", QueueAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapGet("/{workspaceId:guid}/optimization-jobs", ListAsync);
        workspaces.MapGet("/{workspaceId:guid}/optimization-jobs/{jobId:guid}", FindAsync);
        workspaces.MapPost("/{workspaceId:guid}/optimization-jobs/{jobId:guid}/stop", RequestStopAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapPost(
                "/{workspaceId:guid}/optimization-jobs/{jobId:guid}/results/{resultId:guid}/strategy-runs",
                QueueStrategyRunAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        return workspaces;
    }

    private static async Task<IResult> QueueAsync(
        Guid workspaceId,
        Guid sourceRunId,
        QueueOptimizationRequest request,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IOptimizationJobService optimizationJobService,
        CancellationToken cancellationToken)
    {
        var access = await FindWriteAccessAsync(httpContext, workspaceAccessService, workspaceId, cancellationToken);
        if (access.Result is not null) return access.Result;
        if (request.SearchSpace.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        {
            return ValidationError("invalid_optimization_search_space", "Optimization search space is required.");
        }

        try
        {
            var job = await optimizationJobService.QueueAsync(
                new QueueOptimizationJobCommand(
                    workspaceId,
                    access.UserId!.Value,
                    sourceRunId,
                    request.StrategyType,
                    request.SearchSpace.GetRawText(),
                    request.SampleCount,
                    request.Seed,
                    request.TopCount,
                    new OptimizationFilters(
                        request.MaximumDrawdownMagnitude,
                        request.MinimumTradeCount,
                        request.MinimumProfitableSampleCount)),
                cancellationToken);
            return Results.Accepted($"/api/v1/workspaces/{workspaceId}/optimization-jobs/{job.Id}", job);
        }
        catch (OptimizationJobValidationException exception)
        {
            return ValidationError(exception.Code, exception.Message);
        }
    }

    private static async Task<IResult> ListAsync(
        Guid workspaceId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IOptimizationJobService optimizationJobService,
        CancellationToken cancellationToken)
    {
        var access = await FindReadAccessAsync(httpContext, workspaceAccessService, workspaceId, cancellationToken);
        if (access.Result is not null) return access.Result;
        return Results.Ok(new { items = await optimizationJobService.ListAsync(workspaceId, cancellationToken) });
    }

    private static async Task<IResult> FindAsync(
        Guid workspaceId,
        Guid jobId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IOptimizationJobService optimizationJobService,
        CancellationToken cancellationToken)
    {
        var access = await FindReadAccessAsync(httpContext, workspaceAccessService, workspaceId, cancellationToken);
        if (access.Result is not null) return access.Result;
        var job = await optimizationJobService.FindAsync(workspaceId, jobId, cancellationToken);
        return job is null ? Results.NotFound() : Results.Ok(job);
    }

    private static async Task<IResult> RequestStopAsync(
        Guid workspaceId,
        Guid jobId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IOptimizationJobService optimizationJobService,
        CancellationToken cancellationToken)
    {
        var access = await FindWriteAccessAsync(httpContext, workspaceAccessService, workspaceId, cancellationToken);
        if (access.Result is not null) return access.Result;
        var job = await optimizationJobService.RequestStopAsync(
            workspaceId,
            access.UserId!.Value,
            jobId,
            cancellationToken);
        return job is null ? Results.NotFound() : Results.Ok(job);
    }

    private static async Task<IResult> QueueStrategyRunAsync(
        Guid workspaceId,
        Guid jobId,
        Guid resultId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IOptimizationJobService optimizationJobService,
        CancellationToken cancellationToken)
    {
        var access = await FindWriteAccessAsync(httpContext, workspaceAccessService, workspaceId, cancellationToken);
        if (access.Result is not null) return access.Result;
        try
        {
            var run = await optimizationJobService.QueueStrategyRunAsync(
                workspaceId,
                access.UserId!.Value,
                jobId,
                resultId,
                cancellationToken);
            return Results.Accepted($"/api/v1/workspaces/{workspaceId}/calculation-runs/{run.Id}", run);
        }
        catch (OptimizationJobValidationException exception)
        {
            return ValidationError(exception.Code, exception.Message);
        }
    }

    private static async Task<(Guid? UserId, IResult? Result)> FindReadAccessAsync(
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        Guid workspaceId,
        CancellationToken cancellationToken)
    {
        if (!httpContext.User.TryGetUserId(out var userId)) return (null, Results.Unauthorized());
        var access = await workspaceAccessService.FindForUserAsync(userId, workspaceId, cancellationToken);
        return access is null ? (null, Results.NotFound()) : (userId, null);
    }

    private static async Task<(Guid? UserId, IResult? Result)> FindWriteAccessAsync(
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        Guid workspaceId,
        CancellationToken cancellationToken)
    {
        if (!httpContext.User.TryGetUserId(out var userId)) return (null, Results.Unauthorized());
        var access = await workspaceAccessService.FindForUserAsync(userId, workspaceId, cancellationToken);
        if (access is null) return (null, Results.NotFound());
        return access.CanWrite ? (userId, null) : (null, Results.Forbid());
    }

    private static IResult ValidationError(string code, string message) => Results.BadRequest(new { code, message });
}
