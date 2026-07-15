using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MetaEngine.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialProductionSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "workspaces",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workspaces", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "audit_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    action = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    entity_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    details_json = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_audit_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_audit_events_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_audit_events_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "portfolios",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    portfolio_key = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    source_file_name = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    value_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    value_scale = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    timeframe = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    normalization_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    source_checksum = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    series_checksum = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    point_count = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_portfolios", x => x.id);
                    table.CheckConstraint("ck_portfolios_point_count", "point_count >= 0");
                    table.CheckConstraint("ck_portfolios_version", "version > 0");
                    table.ForeignKey(
                        name: "fk_portfolios_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_portfolios_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "presets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    preset_key = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_presets", x => x.id);
                    table.CheckConstraint("ck_presets_version", "version > 0");
                    table.ForeignKey(
                        name: "fk_presets_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_presets_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "workspace_members",
                columns: table => new
                {
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workspace_members", x => new { x.workspace_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_workspace_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_workspace_members_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "portfolio_points",
                columns: table => new
                {
                    portfolio_id = table.Column<Guid>(type: "uuid", nullable: false),
                    timestamp = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    diff = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_portfolio_points", x => new { x.portfolio_id, x.timestamp });
                    table.ForeignKey(
                        name: "fk_portfolio_points_portfolios_portfolio_id",
                        column: x => x.portfolio_id,
                        principalTable: "portfolios",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "calculation_runs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    input_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    portfolio_id = table.Column<Guid>(type: "uuid", nullable: true),
                    preset_id = table.Column<Guid>(type: "uuid", nullable: true),
                    strategy_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    strategy_schema_version = table.Column<int>(type: "integer", nullable: true),
                    strategy_parameters_json = table.Column<string>(type: "jsonb", nullable: true),
                    period_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    period_end = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    timeframe = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    missing_data_rule = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    engine_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    point_count = table.Column<int>(type: "integer", nullable: false),
                    trade_count = table.Column<int>(type: "integer", nullable: false),
                    final_accum = table.Column<double>(type: "double precision", nullable: true),
                    high_water_mark = table.Column<double>(type: "double precision", nullable: true),
                    max_drawdown = table.Column<double>(type: "double precision", nullable: true),
                    warnings_json = table.Column<string>(type: "jsonb", nullable: false),
                    error_code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_calculation_runs", x => x.id);
                    table.CheckConstraint("ck_calculation_runs_counts", "point_count >= 0 AND trade_count >= 0");
                    table.CheckConstraint("ck_calculation_runs_input", "(input_type = 'Portfolio' AND portfolio_id IS NOT NULL AND preset_id IS NULL) OR (input_type = 'Preset' AND preset_id IS NOT NULL AND portfolio_id IS NULL)");
                    table.CheckConstraint("ck_calculation_runs_period", "period_end >= period_start");
                    table.CheckConstraint("ck_calculation_runs_strategy", "(kind = 'Base' AND strategy_type IS NULL AND strategy_schema_version IS NULL AND strategy_parameters_json IS NULL) OR (kind = 'Strategy' AND strategy_type IS NOT NULL AND strategy_schema_version IS NOT NULL AND strategy_parameters_json IS NOT NULL)");
                    table.ForeignKey(
                        name: "fk_calculation_runs_portfolios_portfolio_id",
                        column: x => x.portfolio_id,
                        principalTable: "portfolios",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_calculation_runs_presets_preset_id",
                        column: x => x.preset_id,
                        principalTable: "presets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_calculation_runs_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_calculation_runs_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "optimization_jobs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    input_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    portfolio_id = table.Column<Guid>(type: "uuid", nullable: true),
                    preset_id = table.Column<Guid>(type: "uuid", nullable: true),
                    strategy_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    strategy_schema_version = table.Column<int>(type: "integer", nullable: false),
                    search_space_json = table.Column<string>(type: "jsonb", nullable: false),
                    period_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    period_end = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    timeframe = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    missing_data_rule = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    engine_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    sample_count = table.Column<int>(type: "integer", nullable: false),
                    seed = table.Column<int>(type: "integer", nullable: false),
                    top_count = table.Column<int>(type: "integer", nullable: false),
                    total_candidates = table.Column<long>(type: "bigint", nullable: true),
                    processed_candidates = table.Column<long>(type: "bigint", nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    stop_requested_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    error_code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_optimization_jobs", x => x.id);
                    table.CheckConstraint("ck_optimization_jobs_input", "(input_type = 'Portfolio' AND portfolio_id IS NOT NULL AND preset_id IS NULL) OR (input_type = 'Preset' AND preset_id IS NOT NULL AND portfolio_id IS NULL)");
                    table.CheckConstraint("ck_optimization_jobs_period", "period_end >= period_start");
                    table.CheckConstraint("ck_optimization_jobs_progress", "processed_candidates >= 0 AND (total_candidates IS NULL OR total_candidates >= processed_candidates)");
                    table.CheckConstraint("ck_optimization_jobs_sample_count", "sample_count > 0");
                    table.CheckConstraint("ck_optimization_jobs_schema_version", "strategy_schema_version > 0");
                    table.CheckConstraint("ck_optimization_jobs_seed", "seed >= 0");
                    table.CheckConstraint("ck_optimization_jobs_top_count", "top_count > 0");
                    table.ForeignKey(
                        name: "fk_optimization_jobs_portfolios_portfolio_id",
                        column: x => x.portfolio_id,
                        principalTable: "portfolios",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_optimization_jobs_presets_preset_id",
                        column: x => x.preset_id,
                        principalTable: "presets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_optimization_jobs_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_optimization_jobs_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "run_artifacts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    calculation_run_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    point_count = table.Column<int>(type: "integer", nullable: false),
                    series_checksum = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_run_artifacts", x => x.id);
                    table.CheckConstraint("ck_run_artifacts_point_count", "point_count >= 0");
                    table.ForeignKey(
                        name: "fk_run_artifacts_calculation_runs_calculation_run_id",
                        column: x => x.calculation_run_id,
                        principalTable: "calculation_runs",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "optimization_results",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    optimization_job_id = table.Column<Guid>(type: "uuid", nullable: false),
                    rank = table.Column<int>(type: "integer", nullable: false),
                    parameters_json = table.Column<string>(type: "jsonb", nullable: false),
                    score = table.Column<double>(type: "double precision", nullable: false),
                    compounded_accum = table.Column<double>(type: "double precision", nullable: false),
                    average_accum = table.Column<double>(type: "double precision", nullable: false),
                    worst_accum = table.Column<double>(type: "double precision", nullable: false),
                    worst_max_drawdown = table.Column<double>(type: "double precision", nullable: false),
                    trade_count = table.Column<int>(type: "integer", nullable: false),
                    profitable_sample_count = table.Column<int>(type: "integer", nullable: false),
                    sample_metrics_json = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_optimization_results", x => x.id);
                    table.CheckConstraint("ck_optimization_results_counts", "trade_count >= 0 AND profitable_sample_count >= 0");
                    table.CheckConstraint("ck_optimization_results_rank", "rank > 0");
                    table.ForeignKey(
                        name: "fk_optimization_results_optimization_jobs_optimization_job_id",
                        column: x => x.optimization_job_id,
                        principalTable: "optimization_jobs",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "run_artifact_points",
                columns: table => new
                {
                    run_artifact_id = table.Column<Guid>(type: "uuid", nullable: false),
                    timestamp = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    diff = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_run_artifact_points", x => new { x.run_artifact_id, x.timestamp });
                    table.ForeignKey(
                        name: "fk_run_artifact_points_run_artifacts_run_artifact_id",
                        column: x => x.run_artifact_id,
                        principalTable: "run_artifacts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "strategies",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    strategy_key = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    strategy_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false),
                    parameters_json = table.Column<string>(type: "jsonb", nullable: false),
                    source_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    source_portfolio_id = table.Column<Guid>(type: "uuid", nullable: true),
                    source_preset_id = table.Column<Guid>(type: "uuid", nullable: true),
                    result_artifact_id = table.Column<Guid>(type: "uuid", nullable: false),
                    optimization_result_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_strategies", x => x.id);
                    table.CheckConstraint("ck_strategies_schema_version", "schema_version > 0");
                    table.CheckConstraint("ck_strategies_source", "(source_type = 'Portfolio' AND source_portfolio_id IS NOT NULL AND source_preset_id IS NULL) OR (source_type = 'Preset' AND source_preset_id IS NOT NULL AND source_portfolio_id IS NULL)");
                    table.CheckConstraint("ck_strategies_version", "version > 0");
                    table.ForeignKey(
                        name: "fk_strategies_optimization_results_optimization_result_id",
                        column: x => x.optimization_result_id,
                        principalTable: "optimization_results",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_strategies_portfolios_source_portfolio_id",
                        column: x => x.source_portfolio_id,
                        principalTable: "portfolios",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_strategies_presets_source_preset_id",
                        column: x => x.source_preset_id,
                        principalTable: "presets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_strategies_run_artifacts_result_artifact_id",
                        column: x => x.result_artifact_id,
                        principalTable: "run_artifacts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_strategies_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_strategies_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "preset_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    preset_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    source_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    portfolio_id = table.Column<Guid>(type: "uuid", nullable: true),
                    strategy_id = table.Column<Guid>(type: "uuid", nullable: true),
                    weight = table.Column<double>(type: "double precision", nullable: false),
                    starts_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ends_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_preset_items", x => x.id);
                    table.CheckConstraint("ck_preset_items_period", "ends_at IS NULL OR ends_at >= starts_at");
                    table.CheckConstraint("ck_preset_items_source", "(source_type = 'Portfolio' AND portfolio_id IS NOT NULL AND strategy_id IS NULL) OR (source_type = 'Strategy' AND strategy_id IS NOT NULL AND portfolio_id IS NULL)");
                    table.CheckConstraint("ck_preset_items_weight", "weight >= 0");
                    table.ForeignKey(
                        name: "fk_preset_items_portfolios_portfolio_id",
                        column: x => x.portfolio_id,
                        principalTable: "portfolios",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_preset_items_presets_preset_id",
                        column: x => x.preset_id,
                        principalTable: "presets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_preset_items_strategies_strategy_id",
                        column: x => x.strategy_id,
                        principalTable: "strategies",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_user_id",
                table: "audit_events",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_audit_events_workspace_id_created_at",
                table: "audit_events",
                columns: new[] { "workspace_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_calculation_runs_created_by_user_id",
                table: "calculation_runs",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_calculation_runs_portfolio_id",
                table: "calculation_runs",
                column: "portfolio_id");

            migrationBuilder.CreateIndex(
                name: "ix_calculation_runs_preset_id",
                table: "calculation_runs",
                column: "preset_id");

            migrationBuilder.CreateIndex(
                name: "ix_calculation_runs_status_created_at",
                table: "calculation_runs",
                columns: new[] { "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_calculation_runs_workspace_id_created_at",
                table: "calculation_runs",
                columns: new[] { "workspace_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_optimization_jobs_created_by_user_id",
                table: "optimization_jobs",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_optimization_jobs_portfolio_id",
                table: "optimization_jobs",
                column: "portfolio_id");

            migrationBuilder.CreateIndex(
                name: "ix_optimization_jobs_preset_id",
                table: "optimization_jobs",
                column: "preset_id");

            migrationBuilder.CreateIndex(
                name: "ix_optimization_jobs_status_created_at",
                table: "optimization_jobs",
                columns: new[] { "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_optimization_jobs_workspace_id_created_at",
                table: "optimization_jobs",
                columns: new[] { "workspace_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_optimization_results_optimization_job_id_rank",
                table: "optimization_results",
                columns: new[] { "optimization_job_id", "rank" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_portfolios_created_by_user_id",
                table: "portfolios",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_portfolios_workspace_id_portfolio_key_version",
                table: "portfolios",
                columns: new[] { "workspace_id", "portfolio_key", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_preset_items_portfolio_id",
                table: "preset_items",
                column: "portfolio_id");

            migrationBuilder.CreateIndex(
                name: "ix_preset_items_preset_id_sort_order",
                table: "preset_items",
                columns: new[] { "preset_id", "sort_order" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_preset_items_strategy_id",
                table: "preset_items",
                column: "strategy_id");

            migrationBuilder.CreateIndex(
                name: "ix_presets_created_by_user_id",
                table: "presets",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_presets_workspace_id_preset_key_version",
                table: "presets",
                columns: new[] { "workspace_id", "preset_key", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_run_artifacts_calculation_run_id_kind",
                table: "run_artifacts",
                columns: new[] { "calculation_run_id", "kind" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_strategies_created_by_user_id",
                table: "strategies",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_strategies_optimization_result_id",
                table: "strategies",
                column: "optimization_result_id");

            migrationBuilder.CreateIndex(
                name: "ix_strategies_result_artifact_id",
                table: "strategies",
                column: "result_artifact_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_strategies_source_portfolio_id",
                table: "strategies",
                column: "source_portfolio_id");

            migrationBuilder.CreateIndex(
                name: "ix_strategies_source_preset_id",
                table: "strategies",
                column: "source_preset_id");

            migrationBuilder.CreateIndex(
                name: "ix_strategies_workspace_id_strategy_key_version",
                table: "strategies",
                columns: new[] { "workspace_id", "strategy_key", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_users_email",
                table: "users",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_workspace_members_user_id",
                table: "workspace_members",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit_events");

            migrationBuilder.DropTable(
                name: "portfolio_points");

            migrationBuilder.DropTable(
                name: "preset_items");

            migrationBuilder.DropTable(
                name: "run_artifact_points");

            migrationBuilder.DropTable(
                name: "workspace_members");

            migrationBuilder.DropTable(
                name: "strategies");

            migrationBuilder.DropTable(
                name: "optimization_results");

            migrationBuilder.DropTable(
                name: "run_artifacts");

            migrationBuilder.DropTable(
                name: "optimization_jobs");

            migrationBuilder.DropTable(
                name: "calculation_runs");

            migrationBuilder.DropTable(
                name: "portfolios");

            migrationBuilder.DropTable(
                name: "presets");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropTable(
                name: "workspaces");
        }
    }
}
