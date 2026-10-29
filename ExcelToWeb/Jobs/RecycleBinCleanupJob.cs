using ExcelToWeb.Data;
using ExcelToWeb.Services;
using ExcelToWeb.Services.Excel;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Jobs;

/// <summary>
/// Hangfire 定时任务：回收站过期清理。
///
/// 原来是一段手写 <c>BackgroundService</c> + <c>Task.Delay(24h)</c> 的循环，改成 Hangfire 的
/// 重复任务（recurring job）后，换来三件手写循环给不了的东西：
///  ① **执行记录可查**：每次跑的起止时间、耗时、异常栈都在 Hangfire 里，出问题不用翻应用日志猜；
///  ② **不会因为进程重启而丢一整天**：手写循环的间隔活在内存里，容器滚动更新一次，
///     「下次清理」就从启动时刻重新数 24 小时；
///  ③ **多副本不重复执行**：Hangfire 靠存储里的分布式锁保证同一时刻只有一个副本在跑这条任务，
///     而手写 BackgroundService 在每个副本上都会各跑一遍（清理是幂等的所以没出事，但那是运气）。
///
/// 任务本身仍保持幂等：重复执行只是多删一次已删的东西，不会造成破坏。
/// </summary>
public class RecycleBinCleanupJob
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<RecycleBinCleanupJob> _logger;

    public RecycleBinCleanupJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<RecycleBinCleanupJob> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// 清一轮：物理删除进回收站超过保留期的表格，顺带清掉过期/吊销超过 7 天的刷新令牌。
    ///
    /// 无参是刻意的：Hangfire 会把参数序列化进任务记录，带 <c>CancellationToken</c> 之类的参数
    /// 虽然能被替换，但任务历史里会出现看不懂的参数列。任务不长，直接跑完即可。
    /// </summary>
    public async Task RunAsync()
    {
        // 任务类由 Hangfire 从根容器解析，拿不到请求作用域：自己开一个，用完即弃，
        // 否则 Scoped 的 DbContext 会被跨任务复用（那是「内存一直涨 + 偶尔读到别人数据」的经典来源）
        using var scope = _scopeFactory.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<TableRepository>();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var retentionDays = RetentionPolicy.TrashDays(_configuration);
        var cutoff = DateTime.UtcNow.AddDays(-retentionDays);

        var purged = await repository.PurgeExpiredAsync(cutoff);
        if (purged > 0)
        {
            _logger.LogInformation("回收站过期清理完成：物理删除 {Count} 张超过 {Days} 天的表格",
                purged, retentionDays);
        }

        // 刷新令牌只增不清的兜底（demo 每次登录还会开新族）：
        // 过期超 7 天、或已吊销超 7 天的记录不可能再对应活跃会话，直接删。
        var tokenCutoff = DateTime.UtcNow.AddDays(-7);
        var removedTokens = await db.RefreshTokens
            .Where(t => t.ExpiresAt < tokenCutoff || (t.RevokedAt != null && t.RevokedAt < tokenCutoff))
            .ExecuteDeleteAsync();

        if (removedTokens > 0)
        {
            _logger.LogInformation("刷新令牌清理完成：删除过期/已吊销记录 {Count} 条", removedTokens);
        }
    }
}
