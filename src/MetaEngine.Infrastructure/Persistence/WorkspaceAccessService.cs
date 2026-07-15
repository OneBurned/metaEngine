using MetaEngine.Application.Security;
using Microsoft.EntityFrameworkCore;

namespace MetaEngine.Infrastructure.Persistence;

public sealed class WorkspaceAccessService(MetaEngineDbContext dbContext) : IWorkspaceAccessService
{
    public async Task<IReadOnlyList<WorkspaceAccess>> ListForUserAsync(
        Guid userId,
        CancellationToken cancellationToken) =>
        await dbContext.WorkspaceMembers
            .AsNoTracking()
            .Where(member => member.UserId == userId)
            .OrderBy(member => member.Workspace.Name)
            .Select(member => new WorkspaceAccess(
                member.WorkspaceId,
                member.Workspace.Name,
                member.Role))
            .ToArrayAsync(cancellationToken);

    public Task<WorkspaceAccess?> FindForUserAsync(
        Guid userId,
        Guid workspaceId,
        CancellationToken cancellationToken) =>
        dbContext.WorkspaceMembers
            .AsNoTracking()
            .Where(member => member.UserId == userId && member.WorkspaceId == workspaceId)
            .Select(member => new WorkspaceAccess(
                member.WorkspaceId,
                member.Workspace.Name,
                member.Role))
            .SingleOrDefaultAsync(cancellationToken);
}
