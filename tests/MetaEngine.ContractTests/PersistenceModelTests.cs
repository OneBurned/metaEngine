using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace MetaEngine.ContractTests;

public sealed class PersistenceModelTests
{
    private static MetaEngineDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<MetaEngineDbContext>()
            .UseNpgsql(
                "Host=localhost;Database=metaengine_contract;Username=metaengine;Password=unused",
                npgsql => npgsql.MigrationsAssembly(typeof(MetaEngineDbContext).Assembly.FullName))
            .UseSnakeCaseNamingConvention()
            .Options;

        return new MetaEngineDbContext(options);
    }

    [Fact]
    public void Production_model_contains_the_expected_platform_tables()
    {
        using var dbContext = CreateDbContext();

        var tables = dbContext.Model
            .GetEntityTypes()
            .Select(entity => entity.GetTableName())
            .OfType<string>()
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
        [
            "audit_events",
            "calculation_runs",
            "data_protection_keys",
            "optimization_jobs",
            "optimization_results",
            "portfolio_points",
            "portfolios",
            "preset_items",
            "presets",
            "run_artifact_points",
            "run_artifacts",
            "strategies",
            "user_claims",
            "user_credentials",
            "user_logins",
            "user_tokens",
            "users",
            "workspace_members",
            "workspaces"
        ],
            tables);
    }

    [Fact]
    public void Canonical_result_artifact_stores_only_timestamp_and_diff_per_point()
    {
        using var dbContext = CreateDbContext();
        var point = dbContext.Model.FindEntityType(typeof(RunArtifactPoint));

        Assert.NotNull(point);
        Assert.Equal(
            [nameof(RunArtifactPoint.Diff), nameof(RunArtifactPoint.RunArtifactId), nameof(RunArtifactPoint.Timestamp)],
            point.GetProperties().Select(property => property.Name).Order(StringComparer.Ordinal));
        Assert.Equal("double precision", point.FindProperty(nameof(RunArtifactPoint.Diff))?.GetColumnType());
    }

    [Fact]
    public void Saved_strategy_is_versioned_and_can_be_used_as_a_preset_source()
    {
        using var dbContext = CreateDbContext();
        var strategy = dbContext.Model.FindEntityType(typeof(SavedStrategyVersion));
        var presetItem = dbContext.Model.FindEntityType(typeof(PresetItem));

        Assert.NotNull(strategy);
        Assert.NotNull(presetItem);
        Assert.Contains(
            strategy.GetIndexes(),
            index => index.IsUnique &&
                index.Properties.Select(property => property.Name).SequenceEqual(
                    [
                        nameof(SavedStrategyVersion.WorkspaceId),
                        nameof(SavedStrategyVersion.StrategyKey),
                        nameof(SavedStrategyVersion.Version)
                    ]));
        Assert.Contains(
            strategy.GetForeignKeys(),
            foreignKey => foreignKey.PrincipalEntityType.ClrType == typeof(RunArtifact) && foreignKey.IsRequired);
        Assert.Contains(
            presetItem.GetForeignKeys(),
            foreignKey => foreignKey.PrincipalEntityType.ClrType == typeof(SavedStrategyVersion));
    }

    [Fact]
    public void Portfolio_checksums_are_unique_inside_a_workspace()
    {
        using var dbContext = CreateDbContext();
        var portfolio = dbContext.Model.FindEntityType(typeof(PortfolioVersion));

        Assert.NotNull(portfolio);
        Assert.Contains(
            portfolio.GetIndexes(),
            index => index.IsUnique &&
                index.Properties.Select(property => property.Name).SequenceEqual(
                    [nameof(PortfolioVersion.WorkspaceId), nameof(PortfolioVersion.SourceChecksum)]));
        Assert.Contains(
            portfolio.GetIndexes(),
            index => index.IsUnique &&
                index.Properties.Select(property => property.Name).SequenceEqual(
                    [nameof(PortfolioVersion.WorkspaceId), nameof(PortfolioVersion.SeriesChecksum)]));
    }

    [Fact]
    public void Platform_migrations_are_registered_for_the_current_context()
    {
        using var dbContext = CreateDbContext();

        var migrations = dbContext.Database.GetMigrations().ToArray();

        Assert.Equal(3, migrations.Length);
        Assert.Contains(migrations, migration => migration.EndsWith("_InitialProductionSchema"));
        Assert.Contains(migrations, migration => migration.EndsWith("_AddIdentityAndWorkspaceSecurity"));
        Assert.Contains(migrations, migration => migration.EndsWith("_AddPortfolioImportChecksums"));
    }
}
