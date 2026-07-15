using MetaEngine.Domain.Model;

namespace MetaEngine.Api.Contracts;

public sealed record LoginRequest(string Email, string Password, bool RememberMe = false);

public sealed record CsrfTokenResponse(string Token);

public sealed record WorkspaceAccessResponse(
    Guid Id,
    string Name,
    WorkspaceRole Role,
    bool CanWrite,
    bool CanAdminister);

public sealed record CurrentUserResponse(
    Guid Id,
    string Email,
    string DisplayName,
    IReadOnlyList<WorkspaceAccessResponse> Workspaces);
