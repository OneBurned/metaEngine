using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Identity;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace MetaEngine.Infrastructure.Persistence;

public sealed class MetaEngineDbContext(DbContextOptions<MetaEngineDbContext> options)
    : IdentityUserContext<IdentityAccount, Guid>(options), IDataProtectionKeyContext
{
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    public DbSet<UserAccount> UserAccounts => Set<UserAccount>();

    public DbSet<Workspace> Workspaces => Set<Workspace>();

    public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();

    public DbSet<PortfolioVersion> Portfolios => Set<PortfolioVersion>();

    public DbSet<PortfolioPoint> PortfolioPoints => Set<PortfolioPoint>();

    public DbSet<PresetVersion> Presets => Set<PresetVersion>();

    public DbSet<PresetItem> PresetItems => Set<PresetItem>();

    public DbSet<SavedStrategyVersion> Strategies => Set<SavedStrategyVersion>();

    public DbSet<CalculationRun> CalculationRuns => Set<CalculationRun>();

    public DbSet<OptimizationJob> OptimizationJobs => Set<OptimizationJob>();

    public DbSet<OptimizationResult> OptimizationResults => Set<OptimizationResult>();

    public DbSet<RunArtifact> RunArtifacts => Set<RunArtifact>();

    public DbSet<RunArtifactPoint> RunArtifactPoints => Set<RunArtifactPoint>();

    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(MetaEngineDbContext).Assembly);
    }
}
