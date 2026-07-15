using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Identity;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MetaEngine.Infrastructure.Persistence.Configurations;

internal sealed class IdentityAccountConfiguration : IEntityTypeConfiguration<IdentityAccount>
{
    public void Configure(EntityTypeBuilder<IdentityAccount> builder)
    {
        builder.ToTable("user_credentials");
        builder.HasIndex(account => account.NormalizedEmail).IsUnique();

        builder
            .HasOne<UserAccount>()
            .WithOne()
            .HasForeignKey<IdentityAccount>(account => account.Id)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class DataProtectionKeyConfiguration : IEntityTypeConfiguration<DataProtectionKey>
{
    public void Configure(EntityTypeBuilder<DataProtectionKey> builder) =>
        builder.ToTable("data_protection_keys");
}

internal sealed class IdentityUserClaimConfiguration : IEntityTypeConfiguration<IdentityUserClaim<Guid>>
{
    public void Configure(EntityTypeBuilder<IdentityUserClaim<Guid>> builder) =>
        builder.ToTable("user_claims");
}

internal sealed class IdentityUserLoginConfiguration : IEntityTypeConfiguration<IdentityUserLogin<Guid>>
{
    public void Configure(EntityTypeBuilder<IdentityUserLogin<Guid>> builder) =>
        builder.ToTable("user_logins");
}

internal sealed class IdentityUserTokenConfiguration : IEntityTypeConfiguration<IdentityUserToken<Guid>>
{
    public void Configure(EntityTypeBuilder<IdentityUserToken<Guid>> builder) =>
        builder.ToTable("user_tokens");
}
