using System.Text;
using ExcelToWeb.Helpers;
using OfficeOpenXml;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 导出相关：xlsx 导出、CSV 导出、导入模板下载。
/// 原先这三段各占 30~50 行，与导入、规则逻辑挤在同一个类里。
/// </summary>
public class ExcelExportService
{
    private readonly TableRepository _repository;

    public ExcelExportService(TableRepository repository) => _repository = repository;

    /// <summary>导出为 xlsx；表格不存在返回 null</summary>
    public async Task<byte[]?> ExportExcelAsync(int tableId, int userId)
    {
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return null;

        var rows = await _repository.GetRowsAsync(tableId);

        using var package = new ExcelPackage();
        var worksheet = package.Workbook.Worksheets.Add(string.IsNullOrEmpty(table.TableName) ? "数据" : table.TableName);

        for (int c = 0; c < table.Headers.Count; c++)
            worksheet.Cells[1, c + 1].Value = table.Headers[c];

        for (int r = 0; r < rows.Count; r++)
        {
            var rowData = TableRepository.DeserializeRow(rows[r].DataJson);
            for (int c = 0; c < table.Headers.Count; c++)
            {
                var key = table.Headers[c];
                var value = rowData.ContainsKey(key) ? rowData[key] : string.Empty;
                worksheet.Cells[r + 2, c + 1].Value = value?.ToString();
            }
        }

        worksheet.Cells.AutoFitColumns();
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
            cell.Style.Fill.PatternType = OfficeOpenXml.Style.ExcelFillStyle.Solid;
            cell.Style.Fill.BackgroundColor.SetColor(System.Drawing.Color.LightGray);
        }

        for (int c = 0; c < table.Headers.Count; c++)
        {
            var cell = worksheet.Cells[2, c + 1];
            cell.Value = ExcelHelper.GetSampleValue(table.Headers[c]);
            cell.Style.Font.Italic = true;
            cell.Style.Font.Color.SetColor(System.Drawing.Color.Gray);
        }

        worksheet.Cells[3, 1].Value = "请从第4行开始填写数据，删除示例数据行";
        worksheet.Cells[3, 1].Style.Font.Color.SetColor(System.Drawing.Color.Red);
        worksheet.Cells[3, 1].Style.Font.Size = 10;
        worksheet.Cells[3, 1, 3, table.Headers.Count].Merge = true;
        worksheet.Cells[3, 1, 3, table.Headers.Count].Style.HorizontalAlignment =
            OfficeOpenXml.Style.ExcelHorizontalAlignment.Center;

        worksheet.Cells.AutoFitColumns();
        return package.GetAsByteArray();
    }
}
