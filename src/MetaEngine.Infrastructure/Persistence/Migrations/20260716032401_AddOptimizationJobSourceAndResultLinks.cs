using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MetaEngine.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOptimizationJobSourceAndResultLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "source_calculation_run_id",
                table: "optimization_jobs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "optimization_result_id",
                table: "calculation_runs",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_optimization_jobs_source_calculation_run_id",
                table: "optimization_jobs",
                column: "source_calculation_run_id");

            migrationBuilder.CreateIndex(
                name: "ix_calculation_runs_optimization_result_id",
                table: "calculation_runs",
                column: "optimization_result_id");

            migrationBuilder.AddForeignKey(
                name: "fk_calculation_runs_optimization_results_optimization_result_id",
                table: "calculation_runs",
                column: "optimization_result_id",
                principalTable: "optimization_results",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_optimization_jobs_calculation_runs_source_calculation_run_id",
                table: "optimization_jobs",
                column: "source_calculation_run_id",
                principalTable: "calculation_runs",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_calculation_runs_optimization_results_optimization_result_id",
                table: "calculation_runs");

            migrationBuilder.DropForeignKey(
                name: "fk_optimization_jobs_calculation_runs_source_calculation_run_id",
                table: "optimization_jobs");

            migrationBuilder.DropIndex(
                name: "ix_optimization_jobs_source_calculation_run_id",
                table: "optimization_jobs");

            migrationBuilder.DropIndex(
                name: "ix_calculation_runs_optimization_result_id",
                table: "calculation_runs");

            migrationBuilder.DropColumn(
                name: "source_calculation_run_id",
                table: "optimization_jobs");

            migrationBuilder.DropColumn(
                name: "optimization_result_id",
                table: "calculation_runs");
        }
    }
}
