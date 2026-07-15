using System.Security.Claims;

namespace MetaEngine.Api.Security;

public static class PrincipalExtensions
{
    public static bool TryGetUserId(this ClaimsPrincipal principal, out Guid userId) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out userId);
}
