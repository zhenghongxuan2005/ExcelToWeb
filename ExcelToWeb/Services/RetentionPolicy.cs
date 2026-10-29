namespace ExcelToWeb.Services;

/// <summary>
/// 保留期策略的唯一真源。
///
/// 之前「回收站保留 30 天」这个数字同时出现在三处：后台清理服务的常量、
/// 前端 <c>TRASH_RETENTION_DAYS</c>、文案里的「30 天内可恢复」。
/// 三份手抄的数字迟早会漂——改了清理逻辑而忘了改文案，用户就会看到
/// 「还有 3 天自动清除」但表已经没了。现在收敛成「配置 → 服务端算 → 前端展示」。
/// </summary>
public static class RetentionPolicy
{
    /// <summary>回收站默认保留天数</summary>
    public const int DefaultTrashDays = 30;

    /// <summary>导出快照默认保留天数（比回收站短：它是可重建的产物，不是用户数据）</summary>
    public const int DefaultExportDays = 14;

    /// <summary>回收站保留天数（天）。配置见 appsettings 的 Trash:RetentionDays，非法值回落到默认值</summary>
    public static int TrashDays(IConfiguration configuration) =>
        Math.Max(1, configuration.GetValue<int?>("Trash:RetentionDays") ?? DefaultTrashDays);

    /// <summary>导出快照保留天数（天）。配置见 appsettings 的 Export:RetentionDays</summary>
    public static int ExportDays(IConfiguration configuration) =>
        Math.Max(1, configuration.GetValue<int?>("Export:RetentionDays") ?? DefaultExportDays);
}
