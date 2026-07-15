using MetaEngine.Api.Security;
using MetaEngine.Application.Portfolios;
using MetaEngine.Application.Security;

namespace MetaEngine.Api.Endpoints;

public static class PortfolioEndpoints
{
    public static RouteGroupBuilder MapPortfolioEndpoints(this RouteGroupBuilder workspaces)
    {
        workspaces.MapPost("/{workspaceId:guid}/portfolios/import", ImportAsync)
            .AddEndpointFilter<AntiforgeryEndpointFilter>();
        workspaces.MapGet("/{workspaceId:guid}/portfolios", ListAsync);
        workspaces.MapGet("/{workspaceId:guid}/portfolios/{portfolioId:guid}", FindAsync);
        workspaces.MapGet("/{workspaceId:guid}/portfolios/{portfolioId:guid}/points", GetPointsAsync);
        return workspaces;
    }

    private static async Task<IResult> ImportAsync(
        Guid workspaceId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IPortfolioService portfolioService,
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

        if (!httpContext.Request.HasFormContentType)
        {
            return ValidationError("multipart_required", "Request must use multipart/form-data.");
        }

        try
        {
            var form = await httpContext.Request.ReadFormAsync(cancellationToken);
            var file = form.Files.GetFile("file");
            if (file is null || file.Length == 0)
            {
                return ValidationError("file_required", "A non-empty CSV file is required.");
            }

            if (file.Length > PortfolioImportLimits.MaxSourceBytes)
            {
                return ValidationError(
                    "file_too_large",
                    $"CSV file exceeds {PortfolioImportLimits.MaxSourceBytes} bytes.");
            }

            var requestedName = form["name"].FirstOrDefault();
            var name = string.IsNullOrWhiteSpace(requestedName)
                ? Path.GetFileNameWithoutExtension(file.FileName)
                : requestedName;
            Guid? portfolioKey = null;
            var portfolioKeyValue = form["portfolioKey"].FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(portfolioKeyValue))
            {
                if (!Guid.TryParse(portfolioKeyValue, out var parsedPortfolioKey))
                {
                    return ValidationError("invalid_portfolio_key", "Portfolio key must be a UUID.");
                }

                portfolioKey = parsedPortfolioKey;
            }

            await using var content = file.OpenReadStream();
            var result = await portfolioService.ImportAsync(
                new ImportPortfolioCommand(
                    workspaceId,
                    userId,
                    name ?? string.Empty,
                    Path.GetFileName(file.FileName),
                    portfolioKey,
                    content),
                cancellationToken);
            return result.Created
                ? Results.Created(
                    $"/api/v1/workspaces/{workspaceId}/portfolios/{result.Portfolio.Id}",
                    result)
                : Results.Ok(result);
        }
        catch (PortfolioImportValidationException exception)
        {
            return ValidationError(exception.Code, exception.Message);
        }
        catch (InvalidDataException)
        {
            return ValidationError("invalid_multipart", "Multipart request is invalid.");
        }
    }

    private static async Task<IResult> ListAsync(
        Guid workspaceId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IPortfolioService portfolioService,
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

        var items = await portfolioService.ListAsync(workspaceId, cancellationToken);
        return Results.Ok(new { items });
    }

    private static async Task<IResult> FindAsync(
        Guid workspaceId,
        Guid portfolioId,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IPortfolioService portfolioService,
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

        var portfolio = await portfolioService.FindAsync(workspaceId, portfolioId, cancellationToken);
        return portfolio is null ? Results.NotFound() : Results.Ok(portfolio);
    }

    private static async Task<IResult> GetPointsAsync(
        Guid workspaceId,
        Guid portfolioId,
        int? offset,
        int? limit,
        HttpContext httpContext,
        IWorkspaceAccessService workspaceAccessService,
        IPortfolioService portfolioService,
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

        var pageOffset = offset ?? 0;
        var pageLimit = limit ?? 1_000;
        if (pageOffset < 0 || pageLimit < 1 || pageLimit > PortfolioImportLimits.MaxPointPageSize)
        {
            return ValidationError(
                "invalid_pagination",
                $"Offset must be non-negative and limit must be between 1 and {PortfolioImportLimits.MaxPointPageSize}.");
        }

        var page = await portfolioService.GetPointsAsync(
            workspaceId,
            portfolioId,
            pageOffset,
            pageLimit,
            cancellationToken);
        return page is null ? Results.NotFound() : Results.Ok(page);
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
