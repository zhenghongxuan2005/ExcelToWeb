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
