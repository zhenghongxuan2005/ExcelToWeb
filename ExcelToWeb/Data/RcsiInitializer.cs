using Microsoft.Data.SqlClient;

namespace ExcelToWeb.Data;

/// <summary>
/// 启动期尝试为业务库开启 READ_COMMITTED_SNAPSHOT（行版本读）。
///
/// 为什么需要：默认的 READ COMMITTED 下，写事务在改过的行/页上持锁，读请求必须等它提交。
/// 本项目的「保存」是整表替换（删 N 行再插 N 行），一次保存期间针对同一张表的所有
/// 读请求都要排队；表越大排队越久。用户看到的就是「点保存后页面一直转圈，
/// 顺手切到别的页面也加载不出来」，极端时读请求等满 30 秒命令超时，
/// 抛 Microsoft.Data.SqlClient.SqlException「执行超时已过期」。
///
/// 开启后读走 tempdb 里的行版本，不再等写锁。代价是 tempdb 多一点版本存储，
/// 这是 EF Core 对「读写混合」场景的标准推荐配置。
///
/// 为什么放启动期而不是迁移：这是库级运维开关而非表结构变更，而且改它需要独占连接，
/// 而 EF 迁移跑在事务里，硬塞进去会把迁移事务自己顶掉。
/// 失败只警告不阻断——云上托管实例常不给 ALTER DATABASE 权限，那种情况下应用照常工作，
/// 只是退回到「读等写」的原始行为。
/// </summary>
internal static class RcsiInitializer
{
    public static async Task TryEnableAsync(string connectionString, ILogger logger)
    {
        try
        {
            var csb = new SqlConnectionStringBuilder(connectionString)
            {
                // 独立连接、不进池：否则池里那些空闲的物理连接会让 ALTER 等不到独占，
                // 白白耗到命令超时才失败（看起来像「开启失败」，其实是自己挡自己）
                Pooling = false
            };

            if (string.IsNullOrWhiteSpace(csb.InitialCatalog))
                return;

            // 清掉 EF 迁移期间留下的空闲物理连接，一并让开独占位
            SqlConnection.ClearAllPools();

            await using var conn = new SqlConnection(csb.ConnectionString);
            await conn.OpenAsync();

            await using (var check = new SqlCommand(
                "SELECT is_read_committed_snapshot_on FROM sys.databases WHERE name = DB_NAME()", conn))
            {
                if (await check.ExecuteScalarAsync() is true)
                    return;   // 已经是开启状态，什么都不做
            }

            // 库名走 QUOTENAME，避免名字里带 ] 之类把语句拼坏
            await using var alter = new SqlCommand(
                """
                DECLARE @sql nvarchar(max) =
                    N'ALTER DATABASE ' + QUOTENAME(DB_NAME()) + N' SET READ_COMMITTED_SNAPSHOT ON';
                EXEC (@sql);
                """, conn)
            {
                CommandTimeout = 15
            };
            await alter.ExecuteNonQueryAsync();

            logger.LogInformation("已开启 READ_COMMITTED_SNAPSHOT：读请求不再被整表保存的写锁阻塞");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "开启 READ_COMMITTED_SNAPSHOT 失败，读仍会被写阻塞。需要时手工执行：" +
                "ALTER DATABASE <库名> SET READ_COMMITTED_SNAPSHOT ON");
        }
    }
}
