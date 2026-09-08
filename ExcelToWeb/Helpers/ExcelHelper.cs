using System.Text.RegularExpressions;

namespace ExcelToWeb.Helpers;

/// <summary>
/// Excel 处理相关的公共工具方法
/// </summary>
public static class ExcelHelper
{
    private static readonly Regex ControlCharsRegex =
        new(@"[\x00-\x08\x0B\x0C\x0E-\x1F]", RegexOptions.Compiled);

    private static readonly string[] DateKeywords =
        { "日期", "时间", "date", "time" };

    /// <summary>
    /// 清除字符串中的控制字符
    /// </summary>
    public static string CleanString(string? input)
    {
        if (string.IsNullOrEmpty(input)) return input ?? string.Empty;
        return ControlCharsRegex.Replace(input, "");
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

        if (columnName.Contains("姓名", StringComparison.Ordinal) || columnName.Contains("名称", StringComparison.Ordinal) || columnName.Contains("名字", StringComparison.Ordinal))
            return "示例名称";
        if (columnName.Contains("日期", StringComparison.Ordinal) || columnName.Contains("时间", StringComparison.Ordinal))
            return "2026-08-09";
        if (columnName.Contains("金额", StringComparison.Ordinal) || columnName.Contains("价格", StringComparison.Ordinal) || columnName.Contains("单价", StringComparison.Ordinal) || columnName.Contains("总价", StringComparison.Ordinal))
            return "100.00";
        if (columnName.Contains("数量", StringComparison.Ordinal) || columnName.Contains("个数", StringComparison.Ordinal))
            return "10";
        if (columnName.Contains("是否", StringComparison.Ordinal) || columnName.Contains("完成", StringComparison.Ordinal) || columnName.Contains("状态", StringComparison.Ordinal))
            return "是";
        if (columnName.Contains("编号", StringComparison.Ordinal) || columnName.Contains("序号", StringComparison.Ordinal) || columnName.Contains("ID", StringComparison.Ordinal))
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
            return $"\"{value.Replace("\"", "\"\"")}\"";
        }
        return value;
    }
}
