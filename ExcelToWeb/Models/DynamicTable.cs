using System;
using System.Collections.Generic;

namespace ExcelToWeb.Models
{
    public class DynamicTable
    {
        public int Id { get; set; }
        public string TableName { get; set; } = string.Empty;
        public List<string> Headers { get; set; } = new List<string>();
        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;
        // 移除 Rows 导航属性
    }

    public class DynamicRow
    {
        public int Id { get; set; }
        public int TableId { get; set; }
        public string DataJson { get; set; } = "{}";  // 改为 string
        public DateTime CreatedAt { get; set; } = DateTime.Now;
    }
}