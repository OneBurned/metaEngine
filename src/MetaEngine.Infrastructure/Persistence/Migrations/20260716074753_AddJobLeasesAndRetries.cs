using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MetaEngine.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddJobLeasesAndRetries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "attempt_count",
                table: "optimization_jobs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "last_heartbeat_at",
                table: "optimization_jobs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "lease_id",
                table: "optimization_jobs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "retry_not_before",
                table: "optimization_jobs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "attempt_count",
                table: "calculation_runs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "last_heartbeat_at",
                table: "calculation_runs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "lease_id",
                table: "calculation_runs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "retry_not_before",
                table: "calculation_runs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_optimization_jobs_status_last_heartbeat_at",
                table: "optimization_jobs",
                columns: new[] { "status", "last_heartbeat_at" });

            migrationBuilder.CreateIndex(
                name: "ix_optimization_jobs_status_retry_not_before_created_at",
                table: "optimization_jobs",
                columns: new[] { "status", "retry_not_before", "created_at" });

            migrationBuilder.AddCheckConstraint(
                name: "ck_optimization_jobs_attempt_count",
                table: "optimization_jobs",
                sql: "attempt_count >= 0");

            migrationBuilder.CreateIndex(
                name: "ix_calculation_runs_status_last_heartbeat_at",
                table: "calculation_runs",
                columns: new[] { "status", "last_heartbeat_at" });

            migrationBuilder.CreateIndex(
                name: "ix_calculation_runs_status_retry_not_before_created_at",
                table: "calculation_runs",
                columns: new[] { "status", "retry_not_before", "created_at" });

            migrationBuilder.AddCheckConstraint(
                name: "ck_calculation_runs_attempt_count",
                table: "calculation_runs",
                sql: "attempt_count >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_optimization_jobs_status_last_heartbeat_at",
                table: "optimization_jobs");

            migrationBuilder.DropIndex(
                name: "ix_optimization_jobs_status_retry_not_before_created_at",
                table: "optimization_jobs");

            migrationBuilder.DropCheckConstraint(
                name: "ck_optimization_jobs_attempt_count",
                table: "optimization_jobs");

            migrationBuilder.DropIndex(
                name: "ix_calculation_runs_status_last_heartbeat_at",
                table: "calculation_runs");

            migrationBuilder.DropIndex(
                name: "ix_calculation_runs_status_retry_not_before_created_at",
                table: "calculation_runs");

            migrationBuilder.DropCheckConstraint(
                name: "ck_calculation_runs_attempt_count",
                table: "calculation_runs");

            migrationBuilder.DropColumn(
                name: "attempt_count",
                table: "optimization_jobs");

            migrationBuilder.DropColumn(
                name: "last_heartbeat_at",
                table: "optimization_jobs");

            migrationBuilder.DropColumn(
                name: "lease_id",
                table: "optimization_jobs");

            migrationBuilder.DropColumn(
                name: "retry_not_before",
                table: "optimization_jobs");

            migrationBuilder.DropColumn(
                name: "attempt_count",
                table: "calculation_runs");

            migrationBuilder.DropColumn(
                name: "last_heartbeat_at",
                table: "calculation_runs");

            migrationBuilder.DropColumn(
                name: "lease_id",
                table: "calculation_runs");

            migrationBuilder.DropColumn(
                name: "retry_not_before",
                table: "calculation_runs");
        }
    }
}
