using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MetaEngine.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    [Migration("20260723090000_AllowDuplicatePortfolioImportsAndRunErrorMessages")]
    public partial class AllowDuplicatePortfolioImportsAndRunErrorMessages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS ix_portfolios_workspace_id_series_checksum;
                DROP INDEX IF EXISTS ix_portfolios_workspace_id_source_checksum;

                ALTER TABLE calculation_runs
                ADD COLUMN IF NOT EXISTS error_message character varying(1000);

                CREATE INDEX IF NOT EXISTS ix_portfolios_workspace_id_series_checksum
                    ON portfolios (workspace_id, series_checksum);
                CREATE INDEX IF NOT EXISTS ix_portfolios_workspace_id_source_checksum
                    ON portfolios (workspace_id, source_checksum);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS ix_portfolios_workspace_id_series_checksum;
                DROP INDEX IF EXISTS ix_portfolios_workspace_id_source_checksum;

                ALTER TABLE calculation_runs
                DROP COLUMN IF EXISTS error_message;

                CREATE UNIQUE INDEX IF NOT EXISTS ix_portfolios_workspace_id_series_checksum
                    ON portfolios (workspace_id, series_checksum);
                CREATE UNIQUE INDEX IF NOT EXISTS ix_portfolios_workspace_id_source_checksum
                    ON portfolios (workspace_id, source_checksum);
                """);
        }
    }
}
