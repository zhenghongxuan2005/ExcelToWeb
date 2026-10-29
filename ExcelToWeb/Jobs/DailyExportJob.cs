using ExcelToWeb.Services;
using ExcelToWeb.Services.Excel;
using Hangfire;

namespace ExcelToWeb.Jobs;

/// <summary>
/// Hangfire 定时任务：为开启了「每日自动导出」的表格生成 xlsx 快照。
///
/// 产物是**快照**而不是「发给谁的邮件」：先落盘 + 落库，用户想要时自己去下载。
/// 这样任务不需要知道收件人，也不会因为某个邮箱挂了而整批失败；
/// 想接邮件通知时，只要在这个任务的末尾加一步「把今天的快照发出去」即可。
///
/// 失败处理是「逐表隔离 + 记失败数」而不是「一有异常整批中断」：
/// 一张表导出失败不该连累后面几十张正常的表，Hangfire 的执行记录里能看到失败原因。
/// </summary>
public class DailyExportJob
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<DailyExportJob> _logger;

    public DailyExportJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<DailyExportJob> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// 每天跑一轮。
    /// 失败重试压到 2 次：Hangfire 默认重试 10 次、间隔按指数拉长，
    /// 对「某张表结构坏了导致导出必然失败」这种确定性错误，重试 10 次只是把噪声拖长到几个小时。
    /// 重试 2 次足够吸收数据库瞬时抖动这类偶发问题。
    /// </summary>
    [AutomaticRetry(Attempts = 2)]
    public async Task RunAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var provider = scope.ServiceProvider;
        var repository = provider.GetRequiredService<TableRepository>();
        var exportService = provider.GetRequiredService<ExcelExportService>();
        var snapshots = provider.GetRequiredService<ExportSnapshotService>();

        // ① 先清过期产物：磁盘是有限资源，导出任务自己制造的文件自己收拾，
        //    不要指望运维记得手工删。清理放在导出之前，避免「边加边漏」。
        var retentionDays = RetentionPolicy.ExportDays(_configuration);
        var removed = await snapshots.PurgeExpiredAsync(DateTime.UtcNow.AddDays(-retentionDays));
        // 表格被彻底删除时快照行会级联消失，但磁盘文件不会——顺手把孤儿文件扫掉
        var orphans = await snapshots.PruneOrphanFilesAsync();
        snapshots.RemoveEmptyUserFolders();
        if (removed > 0)
        {
            _logger.LogInformation("导出快照清理完成：删除超过 {Days} 天的记录 {Count} 条",
                retentionDays, removed);
        }
        if (orphans > 0)
        {
            _logger.LogInformation("导出快照自愈清理：删除已无对应记录的孤儿文件 {Count} 个", orphans);
        }

        // ② 逐表导出
        var tables = await repository.GetAutoExportTablesAsync();
        if (tables.Count == 0)
        {
            _logger.LogInformation("定时导出：没有开启自动导出的表格，本轮跳过");
            return;
        }

        var succeeded = 0;
        var failed = 0;

        foreach (var table in tables)
        {
            try
            {
                // 导出服务内部会再按 (tableId, userId) 校验一次归属：
                // 后台任务用的是库里的 UserId，不经过任何客户端输入，这一步是防止数据错位的最后一道
                var content = await exportService.ExportExcelAsync(table.Id, table.UserId);
                if (content == null || content.Length == 0)
                {
                    failed++;
                    _logger.LogWarning("定时导出：表 {TableId}「{TableName}」导出结果为空，跳过",
                        table.Id, table.TableName);
                    continue;
                }

                var rowCount = await repository.CountRowsAsync(table.Id);
                var snapshot = await snapshots.CreateAsync(table, content, rowCount);
                if (snapshot == null) failed++;
                else succeeded++;
            }
            catch (Exception ex)
            {
                // 单表失败不影响其余表格；异常交给 Hangfire 记录（计入失败数）
                failed++;
                _logger.LogError(ex, "定时导出：表 {TableId}「{TableName}」导出失败",
                    table.Id, table.TableName);
            }
        }

        _logger.LogInformation("定时导出完成：成功 {Succeeded} 张，失败 {Failed} 张（共 {Total} 张开启自动导出）",
            succeeded, failed, tables.Count);

        // ③ 只要有失败就让 Hangfire 记成「部分失败」，避免日志里一片绿、实际少了一半报表
        if (failed > 0)
        {
            throw new InvalidOperationException(
                $"定时导出有 {failed} 张表失败（成功 {succeeded} 张），详情见应用日志");
        }
    }
}
