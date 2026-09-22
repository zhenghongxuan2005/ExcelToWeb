using System.Globalization;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 全站统一的「一个字符串算不算数值 / 日期」的口径。
///
/// 为什么要单独成文件：导出（写单元格）与计算列（求值）必须用同一套判定，
/// 否则会出现「导出把 007 当文本、计算列却把 007 当 7」这类对不上的行为。
/// 前端的 parseSafeNumber 是本文件口径的镜像，改这里请同步改 utils.js。
/// </summary>
public static class ExcelNumber
{
    /// <summary>
    /// 能被识别为日期的写法白名单。
    /// 刻意用精确匹配而不是宽松解析：宽松解析会把 "3/4" 这类编号当日期，静默改掉用户数据。
    /// </summary>
    public static readonly string[] DateFormats =
    {
        "yyyy-MM-dd", "yyyy/M/d", "yyyy-MM-dd HH:mm:ss", "yyyy/M/d HH:mm:ss",
        "yyyy-MM-ddTHH:mm:ss", "yyyy年M月d日"
    };

    /// <summary>数值输出格式：最多 10 位小数，且不写无意义的尾随零</summary>
    private const string NumberFormat = "0.##########";

    /// <summary>精确匹配白名单里的日期写法（不用宽松解析，避免把编号误判成日期）</summary>
    public static bool TryParseDate(string raw, out DateTime value) =>
        DateTime.TryParseExact(raw.Trim(), DateFormats, CultureInfo.InvariantCulture,
            DateTimeStyles.None, out value);

    /// <summary>
    /// 判断能否安全地当成数值用。两类值必须排除，否则一旦写进 Excel 即损坏：
    ///   1) 前导零（"007"、"0912"）—— 数值化后零就没了，这是编号 / 区号
    ///   2) 整数部分超过 15 位 —— Excel 只有 15 位有效数字，18 位身份证号会变成科学计数法
    /// </summary>
    public static bool TryParseNumber(string raw, out decimal value)
    {
        value = 0;

        var text = raw.Trim();
        if (text.Length == 0) return false;
        if (!decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out value))
            return false;

        var digits = text.TrimStart('-', '+');
        if (digits.Length > 1 && digits[0] == '0' && digits[1] != '.') return false;

        var integerPart = digits.Split('.')[0].Replace(",", string.Empty);
        if (integerPart.Length > 15) return false;

        return true;
    }

    /// <summary>
    /// 把 decimal 格式化成展示 / 落库用的字符串：最多 10 位小数、无科学计数法。
    /// 10 位与导出用的 "#,##0.##########" 对齐，避免「页面上 3.3333333333、导出却更长」。
    /// </summary>
    public static string Format(decimal value)
    {
        var rounded = Math.Round(value, 10, MidpointRounding.AwayFromZero);
        return rounded.ToString(NumberFormat, CultureInfo.InvariantCulture);
    }

    /// <summary>按「像数值就像数值」的口径把文本转成 decimal，失败返回 null（不抛异常）</summary>
    public static decimal? AsNumber(string? raw) =>
        raw != null && TryParseNumber(raw, out var v) ? v : null;
}
