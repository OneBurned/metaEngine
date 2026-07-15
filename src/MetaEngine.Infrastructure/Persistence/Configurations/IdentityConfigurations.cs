using MetaEngine.Domain.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MetaEngine.Infrastructure.Persistence.Configurations;

internal sealed class UserAccountConfiguration : IEntityTypeConfiguration<UserAccount>
{
    public void Configure(EntityTypeBuilder<UserAccount> builder)
    {
        builder.ToTable("users");
        builder.HasKey(user => user.Id);
        builder.Property(user => user.Email).HasMaxLength(320);
        builder.Property(user => user.DisplayName).HasMaxLength(200);
        builder.Property(user => user.Status).HasConversion<string>().HasMaxLength(32);
        builder.HasIndex(user => user.Email).IsUnique();
    }
}

internal sealed class WorkspaceConfiguration : IEntityTypeConfiguration<Workspace>
{
    public void Configure(EntityTypeBuilder<Workspace> builder)
    {
        builder.ToTable("workspaces");
        builder.HasKey(workspace => workspace.Id);
        builder.Property(workspace => workspace.Name).HasMaxLength(200);
    }
}

internal sealed class WorkspaceMemberConfiguration : IEntityTypeConfiguration<WorkspaceMember>
{
    public void Configure(EntityTypeBuilder<WorkspaceMember> builder)
    {
        builder.ToTable("workspace_members");
        builder.HasKey(member => new { member.WorkspaceId, member.UserId });
        builder.Property(member => member.Role).HasConversion<string>().HasMaxLength(32);

        builder
            .HasOne(member => member.Workspace)
            .WithMany(workspace => workspace.Members)
            .HasForeignKey(member => member.WorkspaceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder
            .HasOne(member => member.User)
            .WithMany(user => user.WorkspaceMemberships)
            .HasForeignKey(member => member.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
