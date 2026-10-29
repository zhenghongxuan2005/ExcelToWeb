using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ExcelToWeb.Migrations
{
    /// <inheritdoc />
    public partial class AddUserRole : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 默认值必须是合法角色名：EF 默认给的是空串，而 Role 用字符串存枚举，
            // 空串在读出来时无法解析（会把老账号全部变成「坏数据」）。
            // 存量账号在加这一列之前拥有全部功能，因此统一补成 Admin，行为不回退。
            migrationBuilder.AddColumn<string>(
                name: "Role",
                table: "Users",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Admin");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Role",
                table: "Users");
        }
    }
}
