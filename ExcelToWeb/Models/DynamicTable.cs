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
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
    public List<DynamicRow> Rows { get; set; } = new();
}

public class DynamicRow
{
    public int Id { get; set; }
    public int TableId { get; set; }
    public string DataJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DynamicTable Table { get; set; } = null!;
}
