using MetaEngine.Domain.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MetaEngine.Infrastructure.Persistence.Configurations;

internal sealed class PortfolioVersionConfiguration : IEntityTypeConfiguration<PortfolioVersion>
{
    public void Configure(EntityTypeBuilder<PortfolioVersion> builder)
    {
        builder.ToTable("portfolios", table =>
        {
            table.HasCheckConstraint("ck_portfolios_version", "version > 0");
            table.HasCheckConstraint("ck_portfolios_point_count", "point_count >= 0");
        });
        builder.HasKey(portfolio => portfolio.Id);
        builder.Property(portfolio => portfolio.Name).HasMaxLength(200);
        builder.Property(portfolio => portfolio.SourceFileName).HasMaxLength(512);
        builder.Property(portfolio => portfolio.ValueType).HasConversion<string>().HasMaxLength(16);
        builder.Property(portfolio => portfolio.ValueScale).HasConversion<string>().HasMaxLength(16);
        builder.Property(portfolio => portfolio.Timeframe).HasMaxLength(16);
        builder.Property(portfolio => portfolio.NormalizationVersion).HasMaxLength(64);
        builder.Property(portfolio => portfolio.SourceChecksum).HasMaxLength(64);
        builder.Property(portfolio => portfolio.SeriesChecksum).HasMaxLength(64);
        builder.HasIndex(portfolio => new { portfolio.WorkspaceId, portfolio.PortfolioKey, portfolio.Version }).IsUnique();

        builder
            .HasOne(portfolio => portfolio.Workspace)
            .WithMany()
            .HasForeignKey(portfolio => portfolio.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(portfolio => portfolio.CreatedByUser)
            .WithMany()
            .HasForeignKey(portfolio => portfolio.CreatedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class PortfolioPointConfiguration : IEntityTypeConfiguration<PortfolioPoint>
{
    public void Configure(EntityTypeBuilder<PortfolioPoint> builder)
    {
        builder.ToTable("portfolio_points");
        builder.HasKey(point => new { point.PortfolioId, point.Timestamp });
        builder.Property(point => point.Diff).HasColumnType("double precision");

        builder
            .HasOne(point => point.Portfolio)
            .WithMany(portfolio => portfolio.Points)
            .HasForeignKey(point => point.PortfolioId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class PresetVersionConfiguration : IEntityTypeConfiguration<PresetVersion>
{
    public void Configure(EntityTypeBuilder<PresetVersion> builder)
    {
        builder.ToTable("presets", table =>
            table.HasCheckConstraint("ck_presets_version", "version > 0"));
        builder.HasKey(preset => preset.Id);
        builder.Property(preset => preset.Name).HasMaxLength(200);
        builder.HasIndex(preset => new { preset.WorkspaceId, preset.PresetKey, preset.Version }).IsUnique();

        builder
            .HasOne(preset => preset.Workspace)
            .WithMany()
            .HasForeignKey(preset => preset.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(preset => preset.CreatedByUser)
            .WithMany()
            .HasForeignKey(preset => preset.CreatedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class PresetItemConfiguration : IEntityTypeConfiguration<PresetItem>
{
    public void Configure(EntityTypeBuilder<PresetItem> builder)
    {
        builder.ToTable("preset_items", table =>
        {
            table.HasCheckConstraint(
                "ck_preset_items_source",
                "(source_type = 'Portfolio' AND portfolio_id IS NOT NULL AND strategy_id IS NULL) OR " +
                "(source_type = 'Strategy' AND strategy_id IS NOT NULL AND portfolio_id IS NULL)");
            table.HasCheckConstraint("ck_preset_items_weight", "weight >= 0");
            table.HasCheckConstraint("ck_preset_items_period", "ends_at IS NULL OR ends_at >= starts_at");
        });
        builder.HasKey(item => item.Id);
        builder.Property(item => item.SourceType).HasConversion<string>().HasMaxLength(16);
        builder.Property(item => item.Weight).HasColumnType("double precision");
        builder.HasIndex(item => new { item.PresetId, item.SortOrder }).IsUnique();

        builder
            .HasOne(item => item.Preset)
            .WithMany(preset => preset.Items)
            .HasForeignKey(item => item.PresetId)
            .OnDelete(DeleteBehavior.Cascade);

        builder
            .HasOne(item => item.Portfolio)
            .WithMany()
            .HasForeignKey(item => item.PortfolioId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(item => item.Strategy)
            .WithMany()
            .HasForeignKey(item => item.StrategyId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
