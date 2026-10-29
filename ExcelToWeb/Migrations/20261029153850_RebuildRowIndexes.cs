using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ExcelToWeb.Migrations
{
    /// <summary>
    /// 重建数据行与表格的索引结构。
    ///
    /// 背景：业务库最初是「EnsureCreated + 手写 DDL」建的，EF 模型快照里记录的
    /// 两个索引（DynamicRows 的外键自动索引 IX_DynamicRows_TableId、
    /// DynamicTables 的 IX_DynamicTables_UserId）**实际都不在库里**，
    /// 主键名也是自动生成的 PK__DynamicR__xxxx 而不是模型里的 PK_DynamicRows。
    ///
    /// 结果是每一次 `WHERE TableId = @id` 都在扫全表——实测查 6 行要读 3135 个页；
    /// 回收站列表那种「每张表统计一行数」的查询更是把上百张表各扫一遍。
    ///
    /// 所以这个迁移不能按 EF 生成的脚本走（它会在 DropIndex 上直接报「索引不存在」），
    /// 全部改成 IF EXISTS / 动态取主键名的原生 SQL，让「有索引的库」和「没索引的库」
    /// 都能跑到同一个终态。
    /// </summary>
    public partial class RebuildRowIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                -- 1. 清掉可能存在也可能不存在的旧索引
                IF EXISTS (SELECT 1 FROM sys.indexes
                           WHERE name = 'IX_DynamicRows_TableId' AND object_id = OBJECT_ID('DynamicRows'))
                    DROP INDEX IX_DynamicRows_TableId ON DynamicRows;

                IF EXISTS (SELECT 1 FROM sys.indexes
                           WHERE name = 'IX_DynamicTables_UserId' AND object_id = OBJECT_ID('DynamicTables'))
                    DROP INDEX IX_DynamicTables_UserId ON DynamicTables;

                -- 2. 主键从聚集改成非聚集，腾出聚集索引的位置。
                --    主键名必须在运行时查：老库是自动生成的 PK__DynamicR__xxxx，
                --    新库才是 PK_DynamicRows，写死任何一个都会在另一类库上失败。
                DECLARE @pkRows sysname = (
                    SELECT name FROM sys.indexes
                    WHERE object_id = OBJECT_ID('DynamicRows') AND is_primary_key = 1);

                IF @pkRows IS NOT NULL
                   AND EXISTS (SELECT 1 FROM sys.indexes
                               WHERE object_id = OBJECT_ID('DynamicRows')
                                 AND is_primary_key = 1 AND type = 1)          -- type=1 表示聚集
                BEGIN
                    -- EXEC(...) 里只能拼字符串与变量，不能直接调用函数，
                    -- 所以先把 QUOTENAME 的结果落到变量里
                    DECLARE @quotedPk nvarchar(300) = QUOTENAME(@pkRows);
                    EXEC ('ALTER TABLE DynamicRows DROP CONSTRAINT ' + @quotedPk);
                    ALTER TABLE DynamicRows ADD CONSTRAINT PK_DynamicRows PRIMARY KEY NONCLUSTERED (Id);
                END

                -- 3. 新的聚集索引：(TableId, Id)。
                --    一张表的所有行物理相邻，一次范围扫描取完整张表；
                --    这比「TableId 上建普通索引 + 逐行回表取 DataJson」快一个数量级。
                IF NOT EXISTS (SELECT 1 FROM sys.indexes
                               WHERE name = 'IX_DynamicRows_TableId_Id'
                                 AND object_id = OBJECT_ID('DynamicRows'))
                    CREATE CLUSTERED INDEX IX_DynamicRows_TableId_Id ON DynamicRows (TableId, Id);

                -- 4. 表格侧：列表查询（UserId + 未删除 + 按更新倒序）一条索引吃全
                IF NOT EXISTS (SELECT 1 FROM sys.indexes
                               WHERE name = 'IX_DynamicTables_UserId_DeletedAt_UpdatedAt'
                                 AND object_id = OBJECT_ID('DynamicTables'))
                    CREATE NONCLUSTERED INDEX IX_DynamicTables_UserId_DeletedAt_UpdatedAt
                        ON DynamicTables (UserId, DeletedAt, UpdatedAt DESC);

                -- 5. 表格侧：回收站过期清理与每日自动导出都先用 DeletedAt 收窄
                IF NOT EXISTS (SELECT 1 FROM sys.indexes
                               WHERE name = 'IX_DynamicTables_DeletedAt_AutoExportEnabled'
                                 AND object_id = OBJECT_ID('DynamicTables'))
                    CREATE NONCLUSTERED INDEX IX_DynamicTables_DeletedAt_AutoExportEnabled
                        ON DynamicTables (DeletedAt, AutoExportEnabled);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM sys.indexes
                           WHERE name = 'IX_DynamicTables_DeletedAt_AutoExportEnabled'
                             AND object_id = OBJECT_ID('DynamicTables'))
                    DROP INDEX IX_DynamicTables_DeletedAt_AutoExportEnabled ON DynamicTables;

                IF EXISTS (SELECT 1 FROM sys.indexes
                           WHERE name = 'IX_DynamicTables_UserId_DeletedAt_UpdatedAt'
                             AND object_id = OBJECT_ID('DynamicTables'))
                    DROP INDEX IX_DynamicTables_UserId_DeletedAt_UpdatedAt ON DynamicTables;

                IF EXISTS (SELECT 1 FROM sys.indexes
                           WHERE name = 'IX_DynamicRows_TableId_Id'
                             AND object_id = OBJECT_ID('DynamicRows'))
                    DROP INDEX IX_DynamicRows_TableId_Id ON DynamicRows;

                -- 主键恢复成聚集，并补回模型约定名的两个索引
                DECLARE @pkRows sysname = (
                    SELECT name FROM sys.indexes
                    WHERE object_id = OBJECT_ID('DynamicRows') AND is_primary_key = 1);

                IF @pkRows IS NOT NULL
                   AND EXISTS (SELECT 1 FROM sys.indexes
                               WHERE object_id = OBJECT_ID('DynamicRows')
                                 AND is_primary_key = 1 AND type = 2)          -- 当前是非聚集
                BEGIN
                    -- EXEC(...) 里只能拼字符串与变量，不能直接调用函数，
                    -- 所以先把 QUOTENAME 的结果落到变量里
                    DECLARE @quotedPk nvarchar(300) = QUOTENAME(@pkRows);
                    EXEC ('ALTER TABLE DynamicRows DROP CONSTRAINT ' + @quotedPk);
                    ALTER TABLE DynamicRows ADD CONSTRAINT PK_DynamicRows PRIMARY KEY CLUSTERED (Id);
                END

                IF NOT EXISTS (SELECT 1 FROM sys.indexes
                               WHERE name = 'IX_DynamicRows_TableId' AND object_id = OBJECT_ID('DynamicRows'))
                    CREATE NONCLUSTERED INDEX IX_DynamicRows_TableId ON DynamicRows (TableId);

                IF NOT EXISTS (SELECT 1 FROM sys.indexes
                               WHERE name = 'IX_DynamicTables_UserId' AND object_id = OBJECT_ID('DynamicTables'))
                    CREATE NONCLUSTERED INDEX IX_DynamicTables_UserId ON DynamicTables (UserId);
                """);
        }
    }
}
