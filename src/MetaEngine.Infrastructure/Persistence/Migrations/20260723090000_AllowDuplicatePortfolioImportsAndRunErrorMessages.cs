using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MetaEngine.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AllowDuplicatePortfolioImportsAndRunErrorMessages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_portfolios_workspace_id_series_checksum",
                table: "portfolios");

            migrationBuilder.DropIndex(
                name: "ix_portfolios_workspace_id_source_checksum",
                table: "portfolios");

            migrationBuilder.AddColumn<string>(
                name: "error_message",
                table: "calculation_runs",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_portfolios_workspace_id_series_checksum",
                table: "portfolios",
                columns: new[] { "workspace_id", "series_checksum" });

            migrationBuilder.CreateIndex(
                name: "ix_portfolios_workspace_id_source_checksum",
                table: "portfolios",
                columns: new[] { "workspace_id", "source_checksum" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_portfolios_workspace_id_series_checksum",
                table: "portfolios");

            migrationBuilder.DropIndex(
                name: "ix_portfolios_workspace_id_source_checksum",
                table: "portfolios");

            migrationBuilder.DropColumn(
                name: "error_message",
                table: "calculation_runs");

            migrationBuilder.CreateIndex(
                name: "ix_portfolios_workspace_id_series_checksum",
                table: "portfolios",
                columns: new[] { "workspace_id", "series_checksum" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_portfolios_workspace_id_source_checksum",
                table: "portfolios",
                columns: new[] { "workspace_id", "source_checksum" },
                unique: true);
        }
    }
}
