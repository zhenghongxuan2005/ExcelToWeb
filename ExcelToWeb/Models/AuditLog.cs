namespace ExcelToWeb.Models
{
    /// <summary>
    /// 变更历史（审计日志）：每次「保存」时由服务端对整表做前后 diff 落库。
    /// RowIndex 是「保存时」的行号（从 1 开始），行被删除 / 插入后旧日志的行号不再对齐，
    /// 属于可接受的近似定位（界面已注明）。
    /// </summary>
    public class AuditLog
    {
        public int Id { get; set; }
        public int TableId { get; set; }
        /// <summary>动作：edit（单元格修改）/ add-row / delete-row / bulk（大批量变更折叠）</summary>
        public string Action { get; set; } = string.Empty;
        /// <summary>行号（从 1 开始）；整表动作（bulk）为 0</summary>
        public int RowIndex { get; set; }
        public string ColumnName { get; set; } = string.Empty;
        public string OldValue { get; set; } = string.Empty;
        public string NewValue { get; set; } = string.Empty;
        public string UserName { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.Now;
    }
}
