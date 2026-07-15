using MetaEngine.Domain.Model;

namespace MetaEngine.Application.Security;

public sealed record WorkspaceAccess(
    Guid WorkspaceId,
    string WorkspaceName,
    WorkspaceRole Role)
{
    public bool CanWrite => Role is WorkspaceRole.Admin or WorkspaceRole.Researcher;

    public bool CanAdminister => Role is WorkspaceRole.Admin;
}

public interface IWorkspaceAccessService
{
    Task<IReadOnlyList<WorkspaceAccess>> ListForUserAsync(
        Guid userId,
        CancellationToken cancellationToken);

    Task<WorkspaceAccess?> FindForUserAsync(
        Guid userId,
        Guid workspaceId,
        CancellationToken cancellationToken);
}
