using ExcelToWeb.Helpers;
using OfficeOpenXml;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 一个工作表解析后的结果。
/// </summary>
public sealed class SheetData
{
    /// <summary>表头（已清理控制字符，空表头会补成「列N」）</summary>
    public List<string> Headers { get; init; } = new();

    /// <summary>数据行，键为表头名</summary>
    public List<Dictionary<string, object>> Rows { get; init; } = new();

    /// <summary>与 <see cref="Rows"/> 一一对应的工作表行号（1 基，含表头行），用于给用户报准确的行号</summary>
    public List<int> RowNumbers { get; init; } = new();

    /// <summary>工作表实际行数（含表头行），供调用方做「有没有数据」的判断</summary>
    public int SourceRowCount { get; init; }

    /// <summary>工作表实际列数</summary>
    public int SourceColumnCount { get; init; }
}

/// <summary>
/// Excel 文件解析失败，且原因可以安全地直接展示给用户。
/// 与真正的意外异常区分开，避免把内部异常细节返回给客户端。
/// </summary>
public sealed class ExcelReadException : Exception
{
    public ExcelReadException(string message) : base(message) { }
}

/// <summary>
/// 「Excel 文件 → 表头 + 数据行」的统一解析器。
///
/// 原先「上传导入」和「带校验上传」各自写了一份几乎相同的解析代码，
/// 且两处对表头/单元格的处理并不一致（一处清了控制字符并转换日期序列号，另一处没有），
/// 会导致按列名配置的校验规则匹配不上、日期列显示成数字。这里合并为唯一实现。
/// </summary>
public class ExcelSheetReader
{
    /// <summary>读取上传文件的第一个工作表</summary>
    public async Task<SheetData> ReadAsync(IFormFile file)
    {
        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        stream.Position = 0;
        return Read(stream);
    }

    /// <summary>从流中读取第一个工作表</summary>
    public SheetData Read(Stream stream)
    {
        using var package = new ExcelPackage(stream);
        var worksheet = package.Workbook.Worksheets.Count > 0 ? package.Workbook.Worksheets[0] : null;

        if (worksheet?.Dimension == null)
            throw new ExcelReadException("无法读取 Excel 文件");

        var rowCount = worksheet.Dimension.Rows;
        var colCount = worksheet.Dimension.Columns;

        var headers = ReadHeaders(worksheet, colCount);
        var rows = new List<Dictionary<string, object>>();
        var rowNumbers = new List<int>();
        ReadRows(worksheet, rowCount, colCount, headers, rows, rowNumbers);

        return new SheetData
        {
            Headers = headers,
            Rows = rows,
            RowNumbers = rowNumbers,
            SourceRowCount = rowCount,
            SourceColumnCount = colCount
        };
    }

    private static List<string> ReadHeaders(ExcelWorksheet worksheet, int colCount)
    {
        var headers = new List<string>(colCount);
        for (int c = 1; c <= colCount; c++)
        {
            var raw = worksheet.Cells[1, c]?.Text?.Trim();
            headers.Add(string.IsNullOrEmpty(raw) ? $"列{c}" : ExcelHelper.CleanString(raw));
        }
        return headers;
    }

    private static void ReadRows(
        ExcelWorksheet worksheet,
        int rowCount,
        int colCount,
        List<string> headers,
        List<Dictionary<string, object>> rows,
        List<int> rowNumbers)
    {
        for (int r = 2; r <= rowCount; r++)
        {
            var row = new Dictionary<string, object>();
            var hasData = false;

            for (int c = 1; c <= colCount; c++)
            {
                var columnName = headers[c - 1];
                var value = worksheet.Cells[r, c]?.Text?.Trim() ?? string.Empty;

                if (string.IsNullOrEmpty(value))
                {
                    row[columnName] = string.Empty;
                    continue;
                }

                hasData = true;
                row[columnName] = NormalizeValue(columnName, value);
            }

            // 整行为空的行不计入结果
            if (!hasData) continue;

            rows.Add(row);
            rowNumbers.Add(r);
        }
    }

    /// <summary>日期列的数字序列号（如 46000）转成 yyyy-MM-dd，其余按文本处理</summary>
    private static string NormalizeValue(string columnName, string value)
    {
        if (!ExcelHelper.IsDateColumn(columnName)) return ExcelHelper.CleanString(value);
        if (!double.TryParse(value, out var serial) || serial <= 0) return ExcelHelper.CleanString(value);

        try
        {
            return DateTime.FromOADate(serial).ToString("yyyy-MM-dd");
        }
        catch
        {
            // 超出可表示范围时保留原文
            return ExcelHelper.CleanString(value);
        }
    }
}
