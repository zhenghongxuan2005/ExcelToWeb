namespace ExcelToWeb.Models
{
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
        /// <summary>唯一性约束：本列取值在整张表内不允许重复（保存与导入时校验）</summary>
        public bool Unique { get; set; }
        /// <summary>跨表引用：本列取值必须来自另一张表的某列；null 表示不启用</summary>
        public int? RefTableId { get; set; }
        public string RefColumnName { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;
    }
}