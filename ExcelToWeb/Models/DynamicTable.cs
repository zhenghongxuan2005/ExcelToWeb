namespace ExcelToWeb.Models;

public class DynamicTable
{
    public int Id { get; set; }
    public string TableName { get; set; } = string.Empty;
    public List<string> Headers { get; set; } = new();
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
