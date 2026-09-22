using ExcelToWeb.DTOs;
using OfficeOpenXml;
using OfficeOpenXml.Style;
using DrawingColor = System.Drawing.Color;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 透视导出：在原数据工作表之外，再加一张「透视」工作表写汇总结果。
///
/// 为什么要连原始数据一起导出：拿到透视表的人第一件事通常是核对某个格子是怎么来的，
/// 只给一张汇总表等于把核对的路堵死了。
/// 数字全部来自 PivotService（预览用的也是它），这里只负责排版。
/// </summary>
public class PivotExportService
{
    /// <summary>透视工作表的默认名字</summary>
    private const string SheetName = "透视";

    /// <summary>汇总结果的数字格式，与数据表的数值格式保持一致</summary>
    private const string NumberFormat = "#,##0.##########";

    private readonly ExcelExportService _exporter;

    public PivotExportService(ExcelExportService exporter) => _exporter = exporter;

    /// <summary>把透视结果写成 xlsx（数据表 + 透视表两张工作表）；表格不存在返回 null</summary>
    public async Task<byte[]?> RenderAsync(int tableId, int userId, PivotResultDto pivot, PivotRequest request)
    {
        var baseBytes = await _exporter.ExportExcelAsync(tableId, userId);
        if (baseBytes == null) return null;

        using var package = new ExcelPackage(new MemoryStream(baseBytes));
        var worksheet = package.Workbook.Worksheets.Add(UniqueName(package));

        // 列轴：不分组时那一列写值标签，避免出现一整列没有表头。
        // 注意判据是「请求里有没有列字段」而不是 ColKeys 是否为空 ——
        // 后者在「选了列字段但那列恰好全空」时也为空，那时就真的不该有数据列。
        var colLabels = string.IsNullOrEmpty(request.ColField)
            ? new List<string> { pivot.ValueLabel }
            : pivot.ColKeys;

        var noRowField = string.IsNullOrEmpty(request.RowField);
        var rowLabel = noRowField ? "合计" : request.RowField;

        var lastColumn = 1 + colLabels.Count + 1;
        WriteTitle(worksheet, lastColumn, pivot, request);
        WriteHeader(worksheet, rowLabel, colLabels);
        WriteBody(worksheet, pivot, colLabels.Count, noRowField);

        // 没有行分组时，唯一那一行本身就是总计，再补一行「合计」只是把同一组数字重复一遍
        if (!noRowField) WriteTotalsRow(worksheet, pivot, colLabels.Count);

        // 冻结「行标签列 + 表头」：透视表通常又宽又长
        worksheet.View.FreezePanes(4, 2);
        worksheet.Cells.AutoFitColumns(8, 30);

        return package.GetAsByteArray();
    }

    private static string UniqueName(ExcelPackage package)
    {
        if (!package.Workbook.Worksheets.Any(w => w.Name == SheetName)) return SheetName;

        for (var i = 2; i < 100; i++)
        {
            var candidate = SheetName + i;
            if (!package.Workbook.Worksheets.Any(w => w.Name == candidate)) return candidate;
        }

        return SheetName + Guid.NewGuid().ToString("N")[..4];
    }

    /// <summary>第 1 行标题 + 第 2 行口径说明：导出的文件自己说清「这是什么、怎么算的」</summary>
    private static void WriteTitle(ExcelWorksheet ws, int lastColumn, PivotResultDto pivot, PivotRequest request)
    {
        ws.Cells[1, 1].Value = "透视汇总：" + pivot.ValueLabel;
        ws.Cells[1, 1, 1, lastColumn].Merge = true;
        ws.Cells[1, 1].Style.Font.Bold = true;
        ws.Cells[1, 1].Style.Font.Size = 13;

        var rowPart = string.IsNullOrEmpty(request.RowField) ? "不分组" : $"行：{request.RowField}";
        var colPart = string.IsNullOrEmpty(request.ColField) ? "不分组" : $"列：{request.ColField}";
        ws.Cells[2, 1].Value = $"基于全部 {pivot.SourceRows} 行数据 · {rowPart} · {colPart}";
        ws.Cells[2, 1, 2, lastColumn].Merge = true;
        ws.Cells[2, 1].Style.Font.Size = 9;
        ws.Cells[2, 1].Style.Font.Color.SetColor(DrawingColor.Gray);
    }

    /// <summary>
    /// 第 3 行表头。行 / 列键里不会出现空串 —— 空单元格根本不参与分组
    /// （见 PivotService 的口径），所以这里不用操心「空白」怎么显示。
    /// </summary>
    private static void WriteHeader(ExcelWorksheet ws, string rowLabel, List<string> colLabels)
    {
        var header = ws.Cells[3, 1];
        header.Value = rowLabel;
        ApplyHeaderStyle(header);

        for (var i = 0; i < colLabels.Count; i++)
        {
            var cell = ws.Cells[3, i + 2];
            cell.Value = colLabels[i];
            ApplyHeaderStyle(cell);
        }

        var total = ws.Cells[3, colLabels.Count + 2];
        total.Value = "合计";
        ApplyHeaderStyle(total);
    }

    private static void WriteBody(ExcelWorksheet ws, PivotResultDto pivot, int colCount, bool noRowField)
    {
        for (var r = 0; r < pivot.RowKeys.Count; r++)
        {
            var excelRow = r + 4;
            // 不分组时唯一那一行的名字没有来源，用「合计」——它统计的就是整张表
            ws.Cells[excelRow, 1].Value = noRowField ? "合计" : pivot.RowKeys[r];
            ws.Cells[excelRow, 1].Style.Font.Bold = true;

            var line = r < pivot.Cells.Count ? pivot.Cells[r] : new List<string>();
            for (var c = 0; c < colCount; c++)
                WriteValue(ws.Cells[excelRow, c + 2], c < line.Count ? line[c] : string.Empty);

            WriteTotal(ws.Cells[excelRow, colCount + 2], r < pivot.RowTotals.Count ? pivot.RowTotals[r] : string.Empty);
        }
    }

    private static void WriteTotalsRow(ExcelWorksheet ws, PivotResultDto pivot, int colCount)
    {
        var excelRow = pivot.RowKeys.Count + 4;

        ws.Cells[excelRow, 1].Value = "合计";
        ApplyHeaderStyle(ws.Cells[excelRow, 1]);

        for (var c = 0; c < colCount; c++)
        {
            var cell = ws.Cells[excelRow, c + 2];
            WriteValue(cell, c < pivot.ColTotals.Count ? pivot.ColTotals[c] : string.Empty);
            cell.Style.Font.Bold = true;
            cell.Style.Fill.PatternType = ExcelFillStyle.Solid;
            cell.Style.Fill.BackgroundColor.SetColor(DrawingColor.FromArgb(0xF7, 0xF9, 0xFB));
        }

        var grand = ws.Cells[excelRow, colCount + 2];
        WriteTotal(grand, pivot.GrandTotal);
        grand.Style.Fill.PatternType = ExcelFillStyle.Solid;
        grand.Style.Fill.BackgroundColor.SetColor(DrawingColor.FromArgb(0xE8, 0xEE, 0xF6));
    }

    /// <summary>能安全数值化就写成真数值（拿到文件的人可以直接继续算），否则按文本写</summary>
    private static void WriteValue(ExcelRange cell, string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            cell.Value = null;
            return;
        }

        if (ExcelNumber.TryParseNumber(text, out var number))
        {
            cell.Value = number;
            cell.Style.Numberformat.Format = NumberFormat;
            cell.Style.HorizontalAlignment = ExcelHorizontalAlignment.Right;
            return;
        }

        cell.Value = text;
    }

    private static void WriteTotal(ExcelRange cell, string text)
    {
        WriteValue(cell, text);
        cell.Style.Font.Bold = true;
    }

    private static void ApplyHeaderStyle(ExcelRange cell)
    {
        cell.Style.Font.Bold = true;
        cell.Style.Fill.PatternType = ExcelFillStyle.Solid;
        cell.Style.Fill.BackgroundColor.SetColor(DrawingColor.FromArgb(0xF0, 0xF2, 0xF5));
        cell.Style.HorizontalAlignment = ExcelHorizontalAlignment.Center;
    }
}
