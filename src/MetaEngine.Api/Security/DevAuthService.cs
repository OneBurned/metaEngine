using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Identity;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace MetaEngine.Api.Security;

public sealed class DevAuthService(
    MetaEngineDbContext dbContext,
    UserManager<IdentityAccount> userManager,
    IOptions<DevAuthOptions> options)
{
    public bool IsEnabled(IHostEnvironment environment) =>
        environment.IsDevelopment() && options.Value.Enabled;

    public bool MatchesCredentials(string login, string password) =>
        string.Equals(login.Trim(), options.Value.Login, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(password, options.Value.Password, StringComparison.Ordinal);

    public async Task<UserAccount> EnsureAdminAsync(CancellationToken cancellationToken)
    {
        var email = options.Value.Email.Trim();
        var existingUser = await dbContext.UserAccounts
            .SingleOrDefaultAsync(user => user.Email == email, cancellationToken);
        if (existingUser is not null)
        {
            await EnsureAdminWorkspaceAsync(existingUser.Id, cancellationToken);
            return existingUser;
        }

        var userId = Guid.CreateVersion7();
        var user = new UserAccount
        {
            Id = userId,
            Email = email,
            DisplayName = options.Value.DisplayName.Trim(),
            Status = UserAccessStatus.Active
        };
        dbContext.UserAccounts.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);

        var identity = new IdentityAccount
        {
            Id = userId,
            UserName = email,
            Email = email,
            EmailConfirmed = true
        };
        var createResult = await userManager.CreateAsync(identity);
        if (!createResult.Succeeded)
        {
            var errors = string.Join("; ", createResult.Errors.Select(error => error.Description));
            throw new InvalidOperationException($"Development admin creation failed: {errors}");
        }

        await EnsureAdminWorkspaceAsync(userId, cancellationToken);
        return user;
    }

    public async Task<IdentityAccount> EnsureIdentityAsync(UserAccount user, CancellationToken cancellationToken)
    {
        var identity = await userManager.FindByIdAsync(user.Id.ToString());
        if (identity is not null)
        {
            return identity;
        }

        identity = new IdentityAccount
        {
            Id = user.Id,
            UserName = user.Email,
            Email = user.Email,
            EmailConfirmed = true
        };
        var createResult = await userManager.CreateAsync(identity);
        if (!createResult.Succeeded)
        {
            var errors = string.Join("; ", createResult.Errors.Select(error => error.Description));
            throw new InvalidOperationException($"Development admin credentials creation failed: {errors}");
        }

        return identity;
    }

    private async Task EnsureAdminWorkspaceAsync(Guid userId, CancellationToken cancellationToken)
    {
        var hasAdminWorkspace = await dbContext.WorkspaceMembers
            .AnyAsync(member => member.UserId == userId && member.Role == WorkspaceRole.Admin, cancellationToken);
        if (hasAdminWorkspace)
        {
            return;
        }

        var workspaceId = Guid.CreateVersion7();
        var workspace = new Workspace
        {
            Id = workspaceId,
            Name = options.Value.WorkspaceName.Trim()
        };
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
            Action = "dev_admin_bootstrap",
            EntityType = "workspace",
            EntityId = workspaceId
        });
        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
