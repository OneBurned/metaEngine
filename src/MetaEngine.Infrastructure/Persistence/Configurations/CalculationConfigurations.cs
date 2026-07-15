using MetaEngine.Domain.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MetaEngine.Infrastructure.Persistence.Configurations;

internal sealed class SavedStrategyVersionConfiguration : IEntityTypeConfiguration<SavedStrategyVersion>
{
    public void Configure(EntityTypeBuilder<SavedStrategyVersion> builder)
    {
        builder.ToTable("strategies", table =>
        {
            table.HasCheckConstraint("ck_strategies_version", "version > 0");
            table.HasCheckConstraint("ck_strategies_schema_version", "schema_version > 0");
            table.HasCheckConstraint(
                "ck_strategies_source",
                "(source_type = 'Portfolio' AND source_portfolio_id IS NOT NULL AND source_preset_id IS NULL) OR " +
                "(source_type = 'Preset' AND source_preset_id IS NOT NULL AND source_portfolio_id IS NULL)");
        });
        builder.HasKey(strategy => strategy.Id);
        builder.Property(strategy => strategy.Name).HasMaxLength(200);
        builder.Property(strategy => strategy.StrategyType).HasMaxLength(100);
        builder.Property(strategy => strategy.ParametersJson).HasColumnType("jsonb");
        builder.Property(strategy => strategy.SourceType).HasConversion<string>().HasMaxLength(16);
        builder.HasIndex(strategy => new { strategy.WorkspaceId, strategy.StrategyKey, strategy.Version }).IsUnique();
        builder.HasIndex(strategy => strategy.ResultArtifactId).IsUnique();

        builder
            .HasOne(strategy => strategy.Workspace)
            .WithMany()
            .HasForeignKey(strategy => strategy.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(strategy => strategy.SourcePortfolio)
            .WithMany()
            .HasForeignKey(strategy => strategy.SourcePortfolioId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(strategy => strategy.SourcePreset)
            .WithMany()
            .HasForeignKey(strategy => strategy.SourcePresetId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(strategy => strategy.ResultArtifact)
            .WithOne()
            .HasForeignKey<SavedStrategyVersion>(strategy => strategy.ResultArtifactId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(strategy => strategy.OptimizationResult)
            .WithMany()
            .HasForeignKey(strategy => strategy.OptimizationResultId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(strategy => strategy.CreatedByUser)
            .WithMany()
            .HasForeignKey(strategy => strategy.CreatedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class CalculationRunConfiguration : IEntityTypeConfiguration<CalculationRun>
{
    public void Configure(EntityTypeBuilder<CalculationRun> builder)
    {
        builder.ToTable("calculation_runs", table =>
        {
            table.HasCheckConstraint(
                "ck_calculation_runs_input",
                "(input_type = 'Portfolio' AND portfolio_id IS NOT NULL AND preset_id IS NULL) OR " +
                "(input_type = 'Preset' AND preset_id IS NOT NULL AND portfolio_id IS NULL)");
            table.HasCheckConstraint(
                "ck_calculation_runs_strategy",
                "(kind = 'Base' AND source_calculation_run_id IS NULL AND strategy_type IS NULL AND strategy_schema_version IS NULL AND strategy_parameters_json IS NULL) OR " +
                "(kind = 'Strategy' AND source_calculation_run_id IS NOT NULL AND strategy_type IS NOT NULL AND strategy_schema_version IS NOT NULL AND strategy_parameters_json IS NOT NULL)");
            table.HasCheckConstraint("ck_calculation_runs_period", "period_end >= period_start");
            table.HasCheckConstraint("ck_calculation_runs_counts", "point_count >= 0 AND trade_count >= 0");
        });
        builder.HasKey(run => run.Id);
        builder.Property(run => run.Kind).HasConversion<string>().HasMaxLength(16);
        builder.Property(run => run.InputType).HasConversion<string>().HasMaxLength(16);
        builder.Property(run => run.StrategyType).HasMaxLength(100);
        builder.Property(run => run.StrategyParametersJson).HasColumnType("jsonb");
        builder.Property(run => run.Timeframe).HasMaxLength(16);
        builder.Property(run => run.MissingDataRule).HasMaxLength(64);
        builder.Property(run => run.EngineVersion).HasMaxLength(64);
        builder.Property(run => run.Status).HasConversion<string>().HasMaxLength(32);
        builder.Property(run => run.FinalAccum).HasColumnType("double precision");
        builder.Property(run => run.HighWaterMark).HasColumnType("double precision");
        builder.Property(run => run.MaxDrawdown).HasColumnType("double precision");
        builder.Property(run => run.WarningsJson).HasColumnType("jsonb");
        builder.Property(run => run.ErrorCode).HasMaxLength(100);
        builder.HasIndex(run => new { run.WorkspaceId, run.CreatedAt });
        builder.HasIndex(run => new { run.Status, run.CreatedAt });
        builder.HasIndex(run => run.SourceCalculationRunId);

        builder
            .HasOne(run => run.Workspace)
            .WithMany()
            .HasForeignKey(run => run.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(run => run.Portfolio)
            .WithMany()
            .HasForeignKey(run => run.PortfolioId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(run => run.Preset)
            .WithMany()
            .HasForeignKey(run => run.PresetId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(run => run.SourceCalculationRun)
            .WithMany()
            .HasForeignKey(run => run.SourceCalculationRunId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(run => run.CreatedByUser)
            .WithMany()
            .HasForeignKey(run => run.CreatedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class OptimizationJobConfiguration : IEntityTypeConfiguration<OptimizationJob>
{
    public void Configure(EntityTypeBuilder<OptimizationJob> builder)
    {
        builder.ToTable("optimization_jobs", table =>
        {
            table.HasCheckConstraint(
                "ck_optimization_jobs_input",
                "(input_type = 'Portfolio' AND portfolio_id IS NOT NULL AND preset_id IS NULL) OR " +
                "(input_type = 'Preset' AND preset_id IS NOT NULL AND portfolio_id IS NULL)");
            table.HasCheckConstraint("ck_optimization_jobs_schema_version", "strategy_schema_version > 0");
            table.HasCheckConstraint("ck_optimization_jobs_sample_count", "sample_count > 0");
            table.HasCheckConstraint("ck_optimization_jobs_top_count", "top_count > 0");
            table.HasCheckConstraint("ck_optimization_jobs_seed", "seed >= 0");
            table.HasCheckConstraint("ck_optimization_jobs_period", "period_end >= period_start");
            table.HasCheckConstraint("ck_optimization_jobs_progress", "processed_candidates >= 0 AND (total_candidates IS NULL OR total_candidates >= processed_candidates)");
        });
        builder.HasKey(job => job.Id);
        builder.Property(job => job.InputType).HasConversion<string>().HasMaxLength(16);
        builder.Property(job => job.StrategyType).HasMaxLength(100);
        builder.Property(job => job.SearchSpaceJson).HasColumnType("jsonb");
        builder.Property(job => job.Timeframe).HasMaxLength(16);
        builder.Property(job => job.MissingDataRule).HasMaxLength(64);
        builder.Property(job => job.EngineVersion).HasMaxLength(64);
        builder.Property(job => job.Status).HasConversion<string>().HasMaxLength(32);
        builder.Property(job => job.ErrorCode).HasMaxLength(100);
        builder.HasIndex(job => new { job.WorkspaceId, job.CreatedAt });
        builder.HasIndex(job => new { job.Status, job.CreatedAt });

        builder
            .HasOne(job => job.Workspace)
            .WithMany()
            .HasForeignKey(job => job.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(job => job.Portfolio)
            .WithMany()
            .HasForeignKey(job => job.PortfolioId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(job => job.Preset)
            .WithMany()
            .HasForeignKey(job => job.PresetId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(job => job.CreatedByUser)
            .WithMany()
            .HasForeignKey(job => job.CreatedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class OptimizationResultConfiguration : IEntityTypeConfiguration<OptimizationResult>
{
    public void Configure(EntityTypeBuilder<OptimizationResult> builder)
    {
        builder.ToTable("optimization_results", table =>
        {
            table.HasCheckConstraint("ck_optimization_results_rank", "rank > 0");
            table.HasCheckConstraint("ck_optimization_results_counts", "trade_count >= 0 AND profitable_sample_count >= 0");
        });
        builder.HasKey(result => result.Id);
        builder.Property(result => result.ParametersJson).HasColumnType("jsonb");
        builder.Property(result => result.Score).HasColumnType("double precision");
        builder.Property(result => result.CompoundedAccum).HasColumnType("double precision");
        builder.Property(result => result.AverageAccum).HasColumnType("double precision");
        builder.Property(result => result.WorstAccum).HasColumnType("double precision");
        builder.Property(result => result.WorstMaxDrawdown).HasColumnType("double precision");
        builder.Property(result => result.SampleMetricsJson).HasColumnType("jsonb");
        builder.HasIndex(result => new { result.OptimizationJobId, result.Rank }).IsUnique();

        builder
            .HasOne(result => result.OptimizationJob)
            .WithMany(job => job.Results)
            .HasForeignKey(result => result.OptimizationJobId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class RunArtifactConfiguration : IEntityTypeConfiguration<RunArtifact>
{
    public void Configure(EntityTypeBuilder<RunArtifact> builder)
    {
        builder.ToTable("run_artifacts", table =>
            table.HasCheckConstraint("ck_run_artifacts_point_count", "point_count >= 0"));
        builder.HasKey(artifact => artifact.Id);
        builder.Property(artifact => artifact.Kind).HasConversion<string>().HasMaxLength(32);
        builder.Property(artifact => artifact.SeriesChecksum).HasMaxLength(64);
        builder.HasIndex(artifact => new { artifact.CalculationRunId, artifact.Kind }).IsUnique();

        builder
            .HasOne(artifact => artifact.CalculationRun)
            .WithMany(run => run.Artifacts)
            .HasForeignKey(artifact => artifact.CalculationRunId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class RunArtifactPointConfiguration : IEntityTypeConfiguration<RunArtifactPoint>
{
    public void Configure(EntityTypeBuilder<RunArtifactPoint> builder)
    {
        builder.ToTable("run_artifact_points");
        builder.HasKey(point => new { point.RunArtifactId, point.Timestamp });
        builder.Property(point => point.Diff).HasColumnType("double precision");

        builder
            .HasOne(point => point.RunArtifact)
            .WithMany(artifact => artifact.Points)
            .HasForeignKey(point => point.RunArtifactId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class AuditEventConfiguration : IEntityTypeConfiguration<AuditEvent>
{
    public void Configure(EntityTypeBuilder<AuditEvent> builder)
    {
        builder.ToTable("audit_events");
        builder.HasKey(auditEvent => auditEvent.Id);
        builder.Property(auditEvent => auditEvent.Action).HasMaxLength(100);
        builder.Property(auditEvent => auditEvent.EntityType).HasMaxLength(100);
        builder.Property(auditEvent => auditEvent.DetailsJson).HasColumnType("jsonb");
        builder.HasIndex(auditEvent => new { auditEvent.WorkspaceId, auditEvent.CreatedAt });

        builder
            .HasOne(auditEvent => auditEvent.Workspace)
            .WithMany()
            .HasForeignKey(auditEvent => auditEvent.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(auditEvent => auditEvent.User)
            .WithMany()
            .HasForeignKey(auditEvent => auditEvent.UserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
