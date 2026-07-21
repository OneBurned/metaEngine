using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MetaEngine.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRunArtifactPointFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "fields_json",
                table: "run_artifact_points",
                type: "jsonb",
                nullable: false,
                defaultValue: "{}");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "fields_json",
                table: "run_artifact_points");
        }
    }
}
