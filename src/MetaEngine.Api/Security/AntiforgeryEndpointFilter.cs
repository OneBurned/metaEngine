using Microsoft.AspNetCore.Antiforgery;

namespace MetaEngine.Api.Security;

public sealed class AntiforgeryEndpointFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var antiforgery = context.HttpContext.RequestServices.GetRequiredService<IAntiforgery>();
        try
        {
            await antiforgery.ValidateRequestAsync(context.HttpContext);
        }
        catch (AntiforgeryValidationException)
        {
            return Results.BadRequest(new
            {
                code = "invalid_csrf_token",
                message = "A valid CSRF token is required."
            });
        }

        return await next(context);
    }
}
