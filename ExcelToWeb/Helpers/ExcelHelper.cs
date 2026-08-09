using System.Text.RegularExpressions;

namespace ExcelToWeb.Helpers;

/// <summary>
/// Excel 处理相关的公共工具方法
/// </summary>
public static class ExcelHelper
{
    private static readonly HashSet<string> DateKeywords = new(StringComparer.OrdinalIgnoreCase)
    {
        "日期", "时间", "成交日期", "创建时间", "更新时间", "日", "date", "time"
    };

    /// <summary>
    /// 清除字符串中的控制字符
    /// </summary>
    public static string CleanString(string? input)
    {
        if (string.IsNullOrEmpty(input)) return input ?? string.Empty;
        return Regex.Replace(input, @"[\x00-\x08\x0B\x0C\x0E-\x1F]", "");
    }

    /// <summary>
    /// 判断列名是否为日期类列
    /// </summary>
    public static bool IsDateColumn(string? header)
    {
        if (string.IsNullOrEmpty(header)) return false;
        return DateKeywords.Any(k => header.Contains(k, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// 根据列名生成示例值（用于模板下载）
    /// </summary>
    public static string GetSampleValue(string? columnName)
    {
        if (string.IsNullOrEmpty(columnName)) return string.Empty;

        if (columnName.Contains("姓名") || columnName.Contains("名称") || columnName.Contains("名字"))
            return "示例名称";
        if (columnName.Contains("日期") || columnName.Contains("时间"))
            return "2026-08-09";
        if (columnName.Contains("金额") || columnName.Contains("价格") || columnName.Contains("单价") || columnName.Contains("总价"))
            return "100.00";
        if (columnName.Contains("数量") || columnName.Contains("个数"))
            return "10";
        if (columnName.Contains("是否") || columnName.Contains("完成") || columnName.Contains("状态"))
            return "是";
        if (columnName.Contains("编号") || columnName.Contains("序号") || columnName.Contains("ID", StringComparison.Ordinal))
            return "001";
        return "示例数据";
    }

    /// <summary>
    /// CSV 值转义
    /// </summary>
    public static string EscapeCsvValue(string? value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r'))
        {
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}
