using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace MetaEngine.Infrastructure.Identity;

public sealed record AdminBootstrapRequest(
    string Email,
    string Password,
    string DisplayName,
    string WorkspaceName);

public sealed record AdminBootstrapResult(
    bool Created,
    Guid UserId,
    Guid WorkspaceId);

public sealed class AdminBootstrapper(
    MetaEngineDbContext dbContext,
    UserManager<IdentityAccount> userManager)
{
    public async Task<AdminBootstrapResult> BootstrapAsync(
        AdminBootstrapRequest request,
        CancellationToken cancellationToken)
    {
        var email = request.Email.Trim();
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.Password);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.DisplayName);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.WorkspaceName);

        var existingIdentity = await userManager.FindByEmailAsync(email);
        if (existingIdentity is not null)
        {
            var existingWorkspaceId = await dbContext.WorkspaceMembers
                .Where(member => member.UserId == existingIdentity.Id && member.Role == WorkspaceRole.Admin)
                .Select(member => member.WorkspaceId)
                .FirstOrDefaultAsync(cancellationToken);

            if (existingWorkspaceId == Guid.Empty)
            {
                throw new InvalidOperationException("The bootstrap account exists without an admin workspace.");
            }

            return new AdminBootstrapResult(false, existingIdentity.Id, existingWorkspaceId);
        }

        if (await dbContext.UserAccounts.AnyAsync(cancellationToken))
        {
            throw new InvalidOperationException("Admin bootstrap is disabled after the first user is created.");
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var userId = Guid.CreateVersion7();
        var workspaceId = Guid.CreateVersion7();
        var user = new UserAccount
        {
            Id = userId,
            Email = email,
            DisplayName = request.DisplayName.Trim(),
            Status = UserAccessStatus.Active
        };
        var workspace = new Workspace
        {
            Id = workspaceId,
            Name = request.WorkspaceName.Trim()
        };

        dbContext.UserAccounts.Add(user);
        dbContext.Workspaces.Add(workspace);
        dbContext.WorkspaceMembers.Add(new WorkspaceMember
        {
            UserId = userId,
            WorkspaceId = workspaceId,
            Role = WorkspaceRole.Admin
        });
        dbContext.AuditEvents.Add(new AuditEvent
        {
            WorkspaceId = workspaceId,
            UserId = userId,
            Action = "admin_bootstrap",
            EntityType = "workspace",
            EntityId = workspaceId
        });
        await dbContext.SaveChangesAsync(cancellationToken);

        var identity = new IdentityAccount
        {
            Id = userId,
            UserName = email,
            Email = email,
            EmailConfirmed = true
        };
        var createResult = await userManager.CreateAsync(identity, request.Password);
        if (!createResult.Succeeded)
        {
            var errors = string.Join(
                "; ",
                createResult.Errors.Select(error => $"{error.Code}: {error.Description}"));
            throw new InvalidOperationException($"Admin bootstrap failed: {errors}");
        }

        await transaction.CommitAsync(cancellationToken);
        return new AdminBootstrapResult(true, userId, workspaceId);
    }
}
