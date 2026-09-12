namespace ExcelToWeb.Services.Excel;

/// <summary>
/// /api/excel/query 的 date 参数所用的行过滤：在候选「日期列」上做前缀匹配。
/// 前端已改为在已加载数据上做视图筛选，这条路径保留给直接调用 API 的场景。
/// </summary>
public static class RowDateFilter
{
    /// <summary>用于识别「哪一列是日期列」的候选列名</summary>
    private static readonly string[] DateColumnCandidates =
        { "日期", "成交日期", "创建时间", "更新时间", "Date", "date" };

    /// <summary>行内是否存在某个候选列，其值以 date 开头（date 形如 2026-01-05）</summary>
    public static bool Matches(Dictionary<string, object> row, string date)
    {
        foreach (var key in DateColumnCandidates)
        {
            if (!row.ContainsKey(key)) continue;
            var value = row[key]?.ToString() ?? string.Empty;
            return value.StartsWith(date, StringComparison.Ordinal);
        }
        return false;
    }
}
