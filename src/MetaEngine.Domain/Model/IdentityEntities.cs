namespace MetaEngine.Domain.Model;

public sealed class UserAccount
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public string Email { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public UserAccessStatus Status { get; set; } = UserAccessStatus.Active;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public ICollection<WorkspaceMember> WorkspaceMemberships { get; set; } = [];
}

public sealed class Workspace
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public string Name { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public ICollection<WorkspaceMember> Members { get; set; } = [];
}

public sealed class WorkspaceMember
{
    public Guid WorkspaceId { get; set; }

    public Workspace Workspace { get; set; } = null!;

    public Guid UserId { get; set; }

    public UserAccount User { get; set; } = null!;

    public WorkspaceRole Role { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
