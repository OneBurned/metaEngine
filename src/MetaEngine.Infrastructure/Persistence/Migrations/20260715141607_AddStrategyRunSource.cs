using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MetaEngine.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddStrategyRunSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_calculation_runs_strategy",
                table: "calculation_runs");

            migrationBuilder.AddColumn<Guid>(
                name: "source_calculation_run_id",
                table: "calculation_runs",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_calculation_runs_source_calculation_run_id",
                table: "calculation_runs",
                column: "source_calculation_run_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_calculation_runs_strategy",
                table: "calculation_runs",
                sql: "(kind = 'Base' AND source_calculation_run_id IS NULL AND strategy_type IS NULL AND strategy_schema_version IS NULL AND strategy_parameters_json IS NULL) OR (kind = 'Strategy' AND source_calculation_run_id IS NOT NULL AND strategy_type IS NOT NULL AND strategy_schema_version IS NOT NULL AND strategy_parameters_json IS NOT NULL)");

            migrationBuilder.AddForeignKey(
                name: "fk_calculation_runs_calculation_runs_source_calculation_run_id",
                table: "calculation_runs",
                column: "source_calculation_run_id",
                principalTable: "calculation_runs",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_calculation_runs_calculation_runs_source_calculation_run_id",
                table: "calculation_runs");

            migrationBuilder.DropIndex(
                name: "ix_calculation_runs_source_calculation_run_id",
                table: "calculation_runs");

            migrationBuilder.DropCheckConstraint(
                name: "ck_calculation_runs_strategy",
                table: "calculation_runs");

            migrationBuilder.DropColumn(
                name: "source_calculation_run_id",
                table: "calculation_runs");

            migrationBuilder.AddCheckConstraint(
                name: "ck_calculation_runs_strategy",
                table: "calculation_runs",
                sql: "(kind = 'Base' AND strategy_type IS NULL AND strategy_schema_version IS NULL AND strategy_parameters_json IS NULL) OR (kind = 'Strategy' AND strategy_type IS NOT NULL AND strategy_schema_version IS NOT NULL AND strategy_parameters_json IS NOT NULL)");
        }
    }
}
