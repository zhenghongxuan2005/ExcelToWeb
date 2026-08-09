using System;
using System.Collections.Generic;

namespace ExcelToWeb.Models
{
    public class ValidationResult
    {
        public int TotalRows { get; set; }
        public int SuccessRows { get; set; }
        public int ErrorRows { get; set; }
        public List<string> Errors { get; set; } = new List<string>();
        public List<Dictionary<string, object>> ValidRows { get; set; } = new List<Dictionary<string, object>>();
        public bool HasErrors => ErrorRows > 0;
    }
}