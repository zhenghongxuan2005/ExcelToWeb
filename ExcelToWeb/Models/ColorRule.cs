namespace ExcelToWeb.Models;

/// <summary>
/// 条件格式规则（红黄绿规则）
/// </summary>
public class ColorRule
{
    public int Id { get; set; }

    /// <summary>所属用户ID</summary>
    public int UserId { get; set; }

    /// <summary>应用列名（如 "数量"、"单价(元)"）</summary>
    public string ColumnName { get; set; } = string.Empty;

    /// <summary>最小值（包含）</summary>
    public decimal MinValue { get; set; }

    /// <summary>最大值（包含），null 表示"以上"</summary>
    public decimal? MaxValue { get; set; }

    /// <summary>颜色代码（如 "#dc2626" 红色）</summary>
    public string ColorCode { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}
