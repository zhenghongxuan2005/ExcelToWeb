using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ExcelToWeb.Migrations
{
    /// <inheritdoc />
    public partial class AddExportSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AutoExportEnabled",
                table: "DynamicTables",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "ExportSnapshots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    TableId = table.Column<int>(type: "int", nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    TableName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(260)", maxLength: 260, nullable: false),
                    RelativePath = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    RowCount = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExportSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExportSnapshots_DynamicTables_TableId",
                        column: x => x.TableId,
                        principalTable: "DynamicTables",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ExportSnapshots_TableId",
                table: "ExportSnapshots",
                column: "TableId");

            migrationBuilder.CreateIndex(
                name: "IX_ExportSnapshots_UserId_CreatedAt",
                table: "ExportSnapshots",
                columns: new[] { "UserId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExportSnapshots");

            migrationBuilder.DropColumn(
                name: "AutoExportEnabled",
                table: "DynamicTables");
        }
    }
}
