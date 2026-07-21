using MetaEngine.Api.Contracts;
using MetaEngine.Api.Security;
using MetaEngine.Application.Security;
using MetaEngine.Application.Strategies;

namespace MetaEngine.Api.Endpoints;

public static class StrategyEndpoints
{
    public static RouteGroupBuilder MapStrategyEndpoints(this RouteGroupBuilder workspaces)
    {
        workspaces.MapPost("/{workspaceId:guid}/strategies", SaveAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapPost("/{workspaceId:guid}/strategies/{strategyId:guid}/delete", DeleteAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapPost("/{workspaceId:guid}/cleanup/strategies/{strategyId:guid}", DeleteAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapDelete("/{workspaceId:guid}/strategies/{strategyId:guid}", DeleteAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapGet("/{workspaceId:guid}/strategies", ListAsync);
        return workspaces;
    }

    private static async Task<IResult> SaveAsync(
        Guid workspaceId,
        SaveStrategyRequest request,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        ISavedStrategyService savedStrategyService,
        CancellationToken cancellationToken)
    {
        if (!httpContext.User.TryGetUserId(out var userId)) return Results.Unauthorized();
        var access = await workspaceAccessService.FindForUserAsync(userId, workspaceId, cancellationToken);
        if (access is null) return Results.NotFound();
        if (!access.CanWrite) return Results.Forbid();
        try
        {
            var strategy = await savedStrategyService.SaveAsync(
                new SaveStrategyCommand(workspaceId, userId, request.StrategyRunId, request.Name, request.StrategyKey),
                cancellationToken);
            return Results.Created($"/api/v1/workspaces/{workspaceId}/strategies/{strategy.Id}", strategy);
        }
        catch (SavedStrategyValidationException exception)
        {
            return Results.BadRequest(new { code = exception.Code, message = exception.Message });
        }
    }

    private static async Task<IResult> DeleteAsync(
        Guid workspaceId,
        Guid strategyId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        ISavedStrategyService savedStrategyService,
        CancellationToken cancellationToken)
    {
        if (!httpContext.User.TryGetUserId(out var userId)) return Results.Unauthorized();
        var access = await workspaceAccessService.FindForUserAsync(userId, workspaceId, cancellationToken);
        if (access is null) return Results.NotFound();
        if (!access.CanWrite) return Results.Forbid();
        try
        {
            return await savedStrategyService.DeleteAsync(workspaceId, userId, strategyId, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        }
        catch (SavedStrategyValidationException exception)
        {
            return Results.BadRequest(new { code = exception.Code, message = exception.Message });
        }
    }

    private static async Task<IResult> ListAsync(
        Guid workspaceId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        ISavedStrategyService savedStrategyService,
        CancellationToken cancellationToken)
    {
        if (!httpContext.User.TryGetUserId(out var userId)) return Results.Unauthorized();
        var access = await workspaceAccessService.FindForUserAsync(userId, workspaceId, cancellationToken);
        if (access is null) return Results.NotFound();
        return Results.Ok(new { items = await savedStrategyService.ListAsync(workspaceId, cancellationToken) });
    }
}
