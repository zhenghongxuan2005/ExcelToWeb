using ExcelToWeb.Data;
using ExcelToWeb.Services.Excel;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 回收站过期清理（功能 9）：物理删除进回收站超过 30 天的表格；
/// 顺带清掉过期/吊销超过 7 天的刷新令牌——这两类记录永不复用，留着只会让表无限膨胀。
/// 用 BackgroundService 定时扫一遍就够了——按 UPGRADE_PLAN 的取舍，不为此引入 Hangfire。
/// 注意 BackgroundService 是单例，不能直接注入 Scoped 的 TableRepository / AppDbContext，
/// 所以每次清理都新开一个 DI scope，用完即弃。
/// </summary>
public class RecycleBinCleanupService : BackgroundService
{
    /// <summary>回收站保留期（天）</summary>
    private const int RetentionDays = 30;

    /// <summary>清理周期：启动时先清一次，之后每 24 小时一轮</summary>
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<RecycleBinCleanupService> _logger;

    public RecycleBinCleanupService(
        IServiceScopeFactory scopeFactory,
        ILogger<RecycleBinCleanupService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await CleanOnceAsync(stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    throw;   // 停机信号，交给外层统一处理
                }
                catch (Exception ex)
                {
                    // 单轮失败只记日志：清理是周期性的，这轮失败下一轮还会再试
                    _logger.LogError(ex, "回收站过期清理执行失败");
                }

                await Task.Delay(Interval, stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // 应用停机：正常退出路径，不需要处理
        }
    }

    /// <summary>清一轮：物理删除 DeletedAt 早于保留期截止点的表格 + 过期/吊销超 7 天的刷新令牌</summary>
    private async Task CleanOnceAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<TableRepository>();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var cutoff = DateTime.UtcNow.AddDays(-RetentionDays);
        var purged = await repository.PurgeExpiredAsync(cutoff);

        if (purged > 0)
            _logger.LogInformation("回收站过期清理完成：物理删除 {Count} 张超过 {Days} 天的表格",
                purged, RetentionDays);

        // 刷新令牌只增不清的兜底（demo 每次登录还会开新族）：
        // 过期超 7 天、或已吊销超 7 天的记录不可能再对应活跃会话，直接删。
        var tokenCutoff = DateTime.UtcNow.AddDays(-7);
        var removedTokens = await db.RefreshTokens
            .Where(t => t.ExpiresAt < tokenCutoff || (t.RevokedAt != null && t.RevokedAt < tokenCutoff))
            .ExecuteDeleteAsync(ct);

        if (removedTokens > 0)
            _logger.LogInformation("刷新令牌清理完成：删除过期/已吊销记录 {Count} 条", removedTokens);
    }
}
