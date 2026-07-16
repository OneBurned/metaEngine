using System.Text.Json;
using MetaEngine.Api.Contracts;
using MetaEngine.Api.Security;
using MetaEngine.Application.Calculations;
using MetaEngine.Application.Security;
using MetaEngine.Domain.Model;

namespace MetaEngine.Api.Endpoints;

public static class CalculationRunEndpoints
{
    public static RouteGroupBuilder MapCalculationRunEndpoints(this RouteGroupBuilder workspaces)
    {
        workspaces.MapPost("/{workspaceId:guid}/calculation-runs", QueueAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapPost("/{workspaceId:guid}/calculation-runs/{sourceRunId:guid}/strategies", QueueStrategyAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapGet("/{workspaceId:guid}/calculation-runs", ListAsync);
        workspaces.MapGet("/{workspaceId:guid}/calculation-runs/{runId:guid}", FindAsync);
        workspaces.MapGet("/{workspaceId:guid}/calculation-runs/{runId:guid}/result", GetResultAsync);
        return workspaces;
    }

    private static async Task<IResult> QueueAsync(
        Guid workspaceId,
        QueueCalculationRequest request,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        ICalculationRunService calculationRunService,
        CancellationToken cancellationToken)
    {
        if (!httpContext.User.TryGetUserId(out var userId))
        {
            return Results.Unauthorized();
        }

        var access = await workspaceAccessService.FindForUserAsync(userId, workspaceId, cancellationToken);
        if (access is null)
        {
            return Results.NotFound();
        }

        if (!access.CanWrite)
        {
            return Results.Forbid();
        }

        if (!TryGetInput(request, out var inputType, out var inputId, out var validationResult))
        {
            return validationResult!;
        }

        try
        {
            var run = await calculationRunService.QueueAsync(
                new QueueBaseCalculationCommand(
                    workspaceId,
                    userId,
                    inputType,
                    inputId,
                    request.PeriodStart,
                    request.PeriodEnd,
                    request.Timeframe ?? string.Empty),
                cancellationToken);
            return Results.Accepted(
                $"/api/v1/workspaces/{workspaceId}/calculation-runs/{run.Id}",
                run);
        }
        catch (CalculationRunValidationException exception)
        {
            return ValidationError(exception.Code, exception.Message);
        }
    }

    private static async Task<IResult> ListAsync(
        Guid workspaceId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        ICalculationRunService calculationRunService,
        CancellationToken cancellationToken)
    {
        var access = await FindAccessAsync(httpContext, workspaceAccessService, workspaceId, cancellationToken);
        if (access.Result is not null)
        {
            return access.Result;
        }

        var items = await calculationRunService.ListAsync(workspaceId, cancellationToken);
        return Results.Ok(new { items });
    }

    private static async Task<IResult> QueueStrategyAsync(
        Guid workspaceId,
        Guid sourceRunId,
        QueueStrategyCalculationRequest request,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        ICalculationRunService calculationRunService,
        CancellationToken cancellationToken)
    {
        if (!httpContext.User.TryGetUserId(out var userId))
        {
            return Results.Unauthorized();
        }

        var access = await workspaceAccessService.FindForUserAsync(userId, workspaceId, cancellationToken);
        if (access is null)
        {
            return Results.NotFound();
        }
        if (!access.CanWrite)
        {
            return Results.Forbid();
        }
        if (request.Parameters.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        {
            return ValidationError("invalid_strategy_parameters", "Strategy parameters are required.");
        }

        try
        {
            var run = await calculationRunService.QueueStrategyAsync(
                new QueueStrategyCalculationCommand(
                    workspaceId,
                    userId,
                    sourceRunId,
                    request.StrategyType,
                    request.Parameters.GetRawText()),
                cancellationToken);
            return Results.Accepted(
                $"/api/v1/workspaces/{workspaceId}/calculation-runs/{run.Id}",
                run);
        }
        catch (CalculationRunValidationException exception)
        {
            return ValidationError(exception.Code, exception.Message);
        }
    }

    private static async Task<IResult> FindAsync(
        Guid workspaceId,
        Guid runId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        ICalculationRunService calculationRunService,
        CancellationToken cancellationToken)
    {
        var access = await FindAccessAsync(httpContext, workspaceAccessService, workspaceId, cancellationToken);
        if (access.Result is not null)
        {
            return access.Result;
        }

        var run = await calculationRunService.FindAsync(workspaceId, runId, cancellationToken);
        return run is null ? Results.NotFound() : Results.Ok(run);
    }

    private static async Task<IResult> GetResultAsync(
        Guid workspaceId,
        Guid runId,
        int? offset,
        int? limit,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        ICalculationRunService calculationRunService,
        CancellationToken cancellationToken)
    {
        var access = await FindAccessAsync(httpContext, workspaceAccessService, workspaceId, cancellationToken);
        if (access.Result is not null)
        {
            return access.Result;
        }

        var pageOffset = offset ?? 0;
        var pageLimit = limit ?? 1_000;
        if (pageOffset < 0 || pageLimit < 1 || pageLimit > CalculationRunLimits.MaxResultPointPageSize)
        {
            return ValidationError(
                "invalid_pagination",
                $"Offset must be non-negative and limit must be between 1 and {CalculationRunLimits.MaxResultPointPageSize}.");
        }

        var run = await calculationRunService.FindAsync(workspaceId, runId, cancellationToken);
        if (run is null)
        {
            return Results.NotFound();
        }

        if (run.Run.Status != JobStatus.Completed)
        {
            return Results.Conflict(new
            {
                code = "calculation_not_completed",
                message = "Calculation result is not available until the run completes."
            });
        }

        var page = await calculationRunService.GetResultPageAsync(
            workspaceId,
            runId,
            pageOffset,
            pageLimit,
            cancellationToken);
        return page is null ? Results.NotFound() : Results.Ok(page);
    }

    private static bool TryGetInput(
        QueueCalculationRequest request,
        out CalculationInputType inputType,
        out Guid inputId,
        out IResult? validationResult)
    {
        if (request.PortfolioId is Guid portfolioId && request.PresetId is null)
        {
            inputType = CalculationInputType.Portfolio;
            inputId = portfolioId;
            validationResult = null;
            return true;
        }

        if (request.PresetId is Guid presetId && request.PortfolioId is null)
        {
            inputType = CalculationInputType.Preset;
            inputId = presetId;
            validationResult = null;
            return true;
        }

        inputType = default;
        inputId = default;
        validationResult = ValidationError(
            "calculation_input_required",
            "Exactly one of portfolioId or presetId is required.");
        return false;
    }

    private static async Task<(WorkspaceAccess? Access, IResult? Result)> FindAccessAsync(
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        Guid workspaceId,
        CancellationToken cancellationToken)
    {
        if (!httpContext.User.TryGetUserId(out var userId))
        {
            return (null, Results.Unauthorized());
        }

        var access = await workspaceAccessService.FindForUserAsync(userId, workspaceId, cancellationToken);
        return access is null ? (null, Results.NotFound()) : (access, null);
    }

    private static IResult ValidationError(string code, string message) =>
        Results.BadRequest(new { code, message });
}
