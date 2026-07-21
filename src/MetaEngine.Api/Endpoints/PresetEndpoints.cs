using MetaEngine.Api.Contracts;
using MetaEngine.Api.Security;
using MetaEngine.Application.Presets;
using MetaEngine.Application.Security;

namespace MetaEngine.Api.Endpoints;

public static class PresetEndpoints
{
    public static RouteGroupBuilder MapPresetEndpoints(this RouteGroupBuilder workspaces)
    {
        workspaces.MapPost("/{workspaceId:guid}/presets", CreateAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapPost("/{workspaceId:guid}/presets/{presetId:guid}/delete", DeleteAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapDelete("/{workspaceId:guid}/presets/{presetId:guid}", DeleteAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapGet("/{workspaceId:guid}/presets", ListAsync);
        workspaces.MapGet("/{workspaceId:guid}/presets/{presetId:guid}", FindAsync);
        return workspaces;
    }

    private static async Task<IResult> CreateAsync(
        Guid workspaceId,
        CreatePresetRequest request,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IPresetService presetService,
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

        try
        {
            var preset = await presetService.CreateAsync(
                new CreatePresetCommand(
                    workspaceId,
                    userId,
                        request.Name ?? string.Empty,
                        request.PresetKey,
                        (request.Items ?? [])
                        .Select(item => new PresetItemInput(
                            item.SourceType,
                            item.SourceId,
                            item.Weight,
                            item.StartsAt,
                            item.EndsAt))
                        .ToArray()),
                cancellationToken);
            return Results.Created(
                $"/api/v1/workspaces/{workspaceId}/presets/{preset.Preset.Id}",
                preset);
        }
        catch (PresetValidationException exception)
        {
            return ValidationError(exception.Code, exception.Message);
        }
    }

    private static async Task<IResult> DeleteAsync(
        Guid workspaceId,
        Guid presetId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IPresetService presetService,
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

        try
        {
            return await presetService.DeleteAsync(workspaceId, userId, presetId, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        }
        catch (PresetValidationException exception)
        {
            return ValidationError(exception.Code, exception.Message);
        }
    }

    private static async Task<IResult> ListAsync(
        Guid workspaceId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IPresetService presetService,
        CancellationToken cancellationToken)
    {
        var access = await FindAccessAsync(
            httpContext,
            workspaceAccessService,
            workspaceId,
            cancellationToken);
        if (access.Result is not null)
        {
            return access.Result;
        }

        var items = await presetService.ListAsync(workspaceId, cancellationToken);
        return Results.Ok(new { items });
    }

    private static async Task<IResult> FindAsync(
        Guid workspaceId,
        Guid presetId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IPresetService presetService,
        CancellationToken cancellationToken)
    {
        var access = await FindAccessAsync(
            httpContext,
            workspaceAccessService,
            workspaceId,
            cancellationToken);
        if (access.Result is not null)
        {
            return access.Result;
        }

        var preset = await presetService.FindAsync(workspaceId, presetId, cancellationToken);
        return preset is null ? Results.NotFound() : Results.Ok(preset);
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
