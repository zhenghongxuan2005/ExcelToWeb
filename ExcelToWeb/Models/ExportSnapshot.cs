namespace ExcelToWeb.Models;

/// <summary>
/// 定时导出的产物记录（Hangfire 每日任务写的 xlsx 快照）。
///
/// 为什么要有这张表：文件落在磁盘上，但「谁的表、什么时候导的、多大、还在不在」
/// 这些信息必须能查——否则用户点了下载却拿到 404 时，运维只能去翻目录猜。
/// 库里的行是快照的**唯一事实来源**，磁盘文件只是它的正文；
/// 两者不一致时以后台任务的自愈清理为准（见 <c>DailyExportJob</c>）。
/// </summary>
public class ExportSnapshot
{
    public int Id { get; set; }

    /// <summary>所属表格。表被彻底删除时级联删掉它的全部快照</summary>
    public int TableId { get; set; }

    /// <summary>冗余一份归属用户：列表接口要按用户过滤，避免每次都 join 回 DynamicTables</summary>
    public int UserId { get; set; }

    /// <summary>导出时的表名快照。表格后来改名了，历史报表仍应显示当时的名字</summary>
    public string TableName { get; set; } = string.Empty;

    /// <summary>下载时呈现给用户的文件名（含 .xlsx）</summary>
    public string FileName { get; set; } = string.Empty;

    /// <summary>
    /// 相对内容根的存放路径（如 App_Data/exports/12/20261029_示例表.xlsx）。
    /// 存相对路径而不是绝对路径：换个部署目录、装进容器，库里的记录都不用改。
    /// </summary>
    public string RelativePath { get; set; } = string.Empty;

    public long SizeBytes { get; set; }

    /// <summary>导出时的数据行数，用来核对「报表是不是空表」</summary>
    public int RowCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DynamicTable? Table { get; set; }
}
