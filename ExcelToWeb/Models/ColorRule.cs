using System;

namespace ExcelToWeb.Models
{
    public class ColorRule
    {
        public int Id { get; set; }
        public string ColumnName { get; set; } = string.Empty;
        public decimal MinValue { get; set; }
        public decimal? MaxValue { get; set; }
        public string ColorCode { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;
    }
}