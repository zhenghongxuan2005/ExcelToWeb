using System.ComponentModel.DataAnnotations;

namespace ExcelToWeb.Models;

public class DynamicTable
{
    public int Id { get; set; }
    public string TableName { get; set; } = string.Empty;
    public List<string> Headers { get; set; } = new();

    /// <summary>
    /// 列视图元数据（JSON）：列名 -> { width, hidden }。
    /// 只保存用户显式调整过的偏好；列的数据类型在导出时按数据实时推断，不落库，
    /// 避免「元数据写着 number、实际数据却是文字」这类漂移。
    /// </summary>
    public string? ColumnMetaJson { get; set; }

    /// <summary>
    /// 导入时记录下来的合并区域（JSON）：[{r1,c1,r2,c2,cols,rowCount}]。
    /// 数据是按各区域左上角的值铺平后入库的，这里只保留「原来是怎么合并的」，导出时按
    /// 当前列序还原；列名对不上或行数与导入时不一致就丢弃该区域。null 表示没有合并信息。
    /// </summary>
    public string? MergeRangesJson { get; set; }

    public int UserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// 是否开启每日定时导出（Hangfire 的 daily-export 任务据此挑表）。
    /// 默认关闭而不是默认开启：绝大多数表不需要每天存一份快照，
    /// 全开会变成「每张表每天一个 xlsx」，磁盘涨得比价值快。
    /// </summary>
    public bool AutoExportEnabled { get; set; }

    /// <summary>
    /// 软删除时间（UPGRADE_PLAN 功能 9 回收站）：null = 活表；
    /// 非 null = 已进回收站（保留期内可恢复，过期由 Hangfire 的 recycle-bin-cleanup 任务物理删除）。
    /// 保留天数见 Services/RetentionPolicy.cs（唯一真源，前端通过 /api/excel/trash/policy 取）。
    /// 可空列不会污染唯一约束 / 索引，这是软删除方案里代价最小的形态。
    /// </summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>
    /// 并发令牌（SQL Server ROWVERSION）。整表替换保存时 EF 会把它带进 UPDATE 的 WHERE 条件，
    /// 若期间已被其他人或另一个标签页改过则更新 0 行，触发 DbUpdateConcurrencyException，
    /// 从而阻止「后保存者静默覆盖先保存者」。
    /// </summary>
    [Timestamp]
    public byte[]? RowVersion { get; set; }

    public List<DynamicRow> Rows { get; set; } = new();
}

public class DynamicRow
{
    public int Id { get; set; }
    public int TableId { get; set; }
    public string DataJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DynamicTable Table { get; set; } = null!;
}
