using System.Globalization;
using System.Text;
using ExcelToWeb.DTOs;
using ExcelToWeb.Helpers;
using ExcelToWeb.Models;
using OfficeOpenXml;
using OfficeOpenXml.Style;
using DrawingColor = System.Drawing.Color;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 导出相关：xlsx 导出、CSV 导出、导入模板下载。
/// 原先这三段各占 30~50 行，与导入、规则逻辑挤在同一个类里。
/// </summary>
public class ExcelExportService
{
    /// <summary>列的数据类型。导出时按数据实时推断，不落库，避免元数据与实际数据漂移</summary>
    private enum ColumnKind { Text, Number, Date }

    /// <summary>
    /// 能被识别为日期的写法白名单。
    /// 刻意用精确匹配而不是宽松解析：宽松解析会把 "3/4" 这类编号当日期，静默改掉用户数据。
    /// </summary>
    private static readonly string[] DateFormats =
    {
        "yyyy-MM-dd", "yyyy/M/d", "yyyy-MM-dd HH:mm:ss", "yyyy/M/d HH:mm:ss",
        "yyyy-MM-ddTHH:mm:ss", "yyyy年M月d日"
    };

    /// <summary>Excel 单列宽度上限（字符数），防止长文本列被撑到没法看</summary>
    private const double MaxColumnWidth = 50;

    private readonly TableRepository _repository;
    private readonly RuleService _rules;

    public ExcelExportService(TableRepository repository, RuleService rules)
    {
        _repository = repository;
        _rules = rules;
    }

    /// <summary>
    /// 导出为 xlsx（带格式）：表头加粗冻结、数字列写真数值（Excel 里可直接求和）、
    /// 日期列写成日期格式、列宽与隐藏列跟随用户偏好、条件格式规则落色。
    /// 表格不存在返回 null。
    /// </summary>
    public async Task<byte[]?> ExportExcelAsync(int tableId, int userId)
    {
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return null;

        var rows = await _repository.GetRowsAsync(tableId);
        var headers = table.Headers ?? new List<string>();
        var meta = ColumnMetaService.Parse(table.ColumnMetaJson);
        var colorRules = await _rules.GetColorRulesAsync(userId, null);

        // 只反序列化一次：类型推断与写单元格共用同一份数据
        var data = rows.Select(r => TableRepository.DeserializeRow(r.DataJson)).ToList();
        var kinds = headers.Select(h => InferColumnKind(data, h)).ToList();

        using var package = new ExcelPackage();
        var worksheet = package.Workbook.Worksheets.Add(
            string.IsNullOrEmpty(table.TableName) ? "数据" : table.TableName);

        for (int c = 0; c < headers.Count; c++)
        {
            var cell = worksheet.Cells[1, c + 1];
            cell.Value = headers[c];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.PatternType = ExcelFillStyle.Solid;
            cell.Style.Fill.BackgroundColor.SetColor(DrawingColor.FromArgb(0xF0, 0xF2, 0xF5));
            cell.Style.HorizontalAlignment = ExcelHorizontalAlignment.Center;
        }

        for (int r = 0; r < data.Count; r++)
        {
            for (int c = 0; c < headers.Count; c++)
            {
                var key = headers[c];
                var raw = data[r].TryGetValue(key, out var v) ? v?.ToString() ?? string.Empty : string.Empty;
                var cell = worksheet.Cells[r + 2, c + 1];

                WriteCell(cell, raw, kinds[c]);
                ApplyRuleColor(cell, colorRules, key, raw);
            }
        }

        ApplyColumnLayout(worksheet, headers, meta);

        // 冻结首行：长表格滚动时表头始终可见
        worksheet.View.FreezePanes(2, 1);

        return package.GetAsByteArray();
    }

    /// <summary>导出为带 UTF-8 BOM 的 CSV（保证 Excel 打开中文不乱码）</summary>
    public async Task<byte[]?> ExportCsvAsync(int tableId, int userId)
    {
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return null;

        var rows = await _repository.GetRowsAsync(tableId);

        using var memoryStream = new MemoryStream();
        await memoryStream.WriteAsync(Encoding.UTF8.GetPreamble());

        await using var writer = new StreamWriter(memoryStream, Encoding.UTF8, leaveOpen: true);

        await writer.WriteAsync(string.Join(",", table.Headers.Select(ExcelHelper.EscapeCsvValue)));
        await writer.WriteLineAsync();

        foreach (var row in rows)
        {
            var rowData = TableRepository.DeserializeRow(row.DataJson);
            var values = table.Headers.Select(h =>
                ExcelHelper.EscapeCsvValue(rowData.ContainsKey(h) ? rowData[h]?.ToString() ?? string.Empty : string.Empty));
            await writer.WriteAsync(string.Join(",", values));
            await writer.WriteLineAsync();
        }

        await writer.FlushAsync();
        return memoryStream.ToArray();
    }

    /// <summary>按表结构生成导入模板：表头加粗、一行示例值、一行填写提示</summary>
    public async Task<byte[]?> DownloadTemplateAsync(int tableId, int userId)
    {
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return null;

        using var package = new ExcelPackage();
        var worksheet = package.Workbook.Worksheets.Add("模板");

        for (int c = 0; c < table.Headers.Count; c++)
        {
            var cell = worksheet.Cells[1, c + 1];
            cell.Value = table.Headers[c];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.PatternType = ExcelFillStyle.Solid;
            cell.Style.Fill.BackgroundColor.SetColor(DrawingColor.LightGray);
        }

        for (int c = 0; c < table.Headers.Count; c++)
        {
            var cell = worksheet.Cells[2, c + 1];
            cell.Value = ExcelHelper.GetSampleValue(table.Headers[c]);
            cell.Style.Font.Italic = true;
            cell.Style.Font.Color.SetColor(DrawingColor.Gray);
        }

        worksheet.Cells[3, 1].Value = "请从第4行开始填写数据，删除示例数据行";
        worksheet.Cells[3, 1].Style.Font.Color.SetColor(DrawingColor.Red);
        worksheet.Cells[3, 1].Style.Font.Size = 10;
        worksheet.Cells[3, 1, 3, table.Headers.Count].Merge = true;
        worksheet.Cells[3, 1, 3, table.Headers.Count].Style.HorizontalAlignment =
            ExcelHorizontalAlignment.Center;

        worksheet.Cells.AutoFitColumns();
        return package.GetAsByteArray();
    }

    // ================================================================
    // 导出格式化的内部实现
    // ================================================================

    /// <summary>
    /// 把一个值写进单元格。数字列写数值、日期列写日期（都带上格式串），
    /// 其余一律按文本写 —— 文本可以承载前导零与超长数字，写数值则会静默损坏。
    /// </summary>
    private static void WriteCell(ExcelRange cell, string raw, ColumnKind kind)
    {
        if (string.IsNullOrEmpty(raw))
        {
            cell.Value = null;
            return;
        }

        if (kind == ColumnKind.Number && TryParseNumber(raw, out var number))
        {
            cell.Value = number;
            // 去掉无意义的尾随零，同时保留小数位
            cell.Style.Numberformat.Format = "#,##0.##########";
            return;
        }

        if (kind == ColumnKind.Date && TryParseDate(raw, out var date))
        {
            cell.Value = date;
            cell.Style.Numberformat.Format =
                date.TimeOfDay == TimeSpan.Zero ? "yyyy-mm-dd" : "yyyy-mm-dd hh:mm:ss";
            return;
        }

        cell.Value = raw;
    }

    /// <summary>命中条件格式规则时给单元格上底色；规则里的颜色非法就跳过，绝不让导出整体失败</summary>
    private static void ApplyRuleColor(ExcelRange cell, List<ColorRule> rules, string column, string raw)
    {
        if (rules.Count == 0 || string.IsNullOrEmpty(raw)) return;
        if (!TryParseNumber(raw, out var value)) return;

        foreach (var rule in rules)
        {
            if (!string.Equals(rule.ColumnName, column, StringComparison.Ordinal)) continue;

            var hit = rule.MaxValue.HasValue
                ? value >= rule.MinValue && value <= rule.MaxValue.Value
                : value >= rule.MinValue;
            if (!hit) continue;

            var color = ParseHexColor(rule.ColorCode);
            if (color == null) return;

            cell.Style.Fill.PatternType = ExcelFillStyle.Solid;
            cell.Style.Fill.BackgroundColor.SetColor(color.Value);
            return;
        }
    }

    /// <summary>列宽按用户偏好设置（px -> Excel 字符数），隐藏列一并隐藏；未设置的列按内容自适应</summary>
    private static void ApplyColumnLayout(
        ExcelWorksheet worksheet, List<string> headers, Dictionary<string, ColumnMetaDto> meta)
    {
        for (int c = 0; c < headers.Count; c++)
        {
            var column = worksheet.Column(c + 1);
            meta.TryGetValue(headers[c], out var setting);

            if (setting?.Width != null)
            {
                // 前端存的是 px，Excel 列宽单位是「字符数」，按 7px ≈ 1 字符换算
                column.Width = Math.Max(6, Math.Round(setting.Width.Value / 7.0, 2));
            }
            else
            {
                column.AutoFit(8, MaxColumnWidth);
            }

            if (setting?.Hidden == true) column.Hidden = true;
        }
    }

    /// <summary>
    /// 推断一列的类型：整列所有非空值都能识别成日期 / 数字才算该类型，
    /// 出现一个例外就整列退回文本。
    /// </summary>
    private static ColumnKind InferColumnKind(List<Dictionary<string, object>> data, string column)
    {
        var total = 0;
        var dates = 0;
        var numbers = 0;

        foreach (var row in data)
        {
            var raw = row.TryGetValue(column, out var v) ? v?.ToString() : null;
            if (string.IsNullOrWhiteSpace(raw)) continue;

            total++;
            if (TryParseDate(raw, out _)) { dates++; continue; }
            if (TryParseNumber(raw, out _)) { numbers++; continue; }

            return ColumnKind.Text;
        }

        if (total == 0) return ColumnKind.Text;
        if (dates == total) return ColumnKind.Date;
        if (numbers == total) return ColumnKind.Number;
        return ColumnKind.Text;
    }

    /// <summary>精确匹配白名单里的日期写法（不用宽松解析，避免把编号误判成日期）</summary>
    private static bool TryParseDate(string raw, out DateTime value) =>
        DateTime.TryParseExact(raw.Trim(), DateFormats, CultureInfo.InvariantCulture,
            DateTimeStyles.None, out value);

    /// <summary>
    /// 判断能否安全地写成数值。两类值必须排除，否则导出即损坏：
    ///   1) 前导零（"007"、"0912"）—— 数值化后零就没了，这是编号 / 区号
    ///   2) 整数部分超过 15 位 —— Excel 只有 15 位有效数字，18 位身份证号会变成科学计数法
    /// </summary>
    private static bool TryParseNumber(string raw, out decimal value)
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

    /// <summary>解析 "#rrggbb" / "rrggbb"，非法返回 null</summary>
    private static DrawingColor? ParseHexColor(string? hex)
    {
        if (string.IsNullOrWhiteSpace(hex)) return null;

        var text = hex.Trim().TrimStart('#');
        if (text.Length != 6) return null;

        if (!int.TryParse(text.AsSpan(0, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var r) ||
            !int.TryParse(text.AsSpan(2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var g) ||
            !int.TryParse(text.AsSpan(4, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var b))
            return null;

        return DrawingColor.FromArgb(r, g, b);
    }
}
