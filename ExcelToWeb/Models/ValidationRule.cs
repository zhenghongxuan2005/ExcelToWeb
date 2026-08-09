namespace ExcelToWeb.Models;

public class ValidationRule
{
    public int Id { get; set; }
    public int TableId { get; set; }
    public string ColumnName { get; set; } = string.Empty;
    public bool Required { get; set; }
    public string DataType { get; set; } = "text";
    public decimal? MinValue { get; set; }
    public decimal? MaxValue { get; set; }
    public int? MaxLength { get; set; }
    public string AllowedValues { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}
