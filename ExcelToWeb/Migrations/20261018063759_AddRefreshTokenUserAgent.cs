using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ExcelToWeb.Migrations
{
    /// <inheritdoc />
    public partial class AddRefreshTokenUserAgent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CreatedByUserAgent",
                table: "RefreshTokens",
                type: "nvarchar(300)",
                maxLength: 300,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreatedByUserAgent",
                table: "RefreshTokens");
        }
    }
}
