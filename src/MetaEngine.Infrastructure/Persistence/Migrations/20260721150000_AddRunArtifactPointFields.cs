using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MetaEngine.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    [Migration("20260721150000_AddRunArtifactPointFields")]
    public partial class AddRunArtifactPointFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE run_artifact_points
                ADD COLUMN IF NOT EXISTS fields_json jsonb NOT NULL DEFAULT '{}';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE run_artifact_points
                DROP COLUMN IF EXISTS fields_json;
                """);
        }
    }
}
