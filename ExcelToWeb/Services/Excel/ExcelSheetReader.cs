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

    /// <summary>工作表名（多工作表文件导入时用于拼接表名）</summary>
    public string SheetName { get; init; } = string.Empty;

    /// <summary>工作簿内工作表总数（大于 1 时表名要带上工作表名，否则列表里分不清来自哪张表）</summary>
    public int SheetCount { get; init; }

    /// <summary>
    /// 工作表里的合并区域（已按左上角值铺平），留待导出时还原。
    /// 数据本身是铺平后才入库的，所以这里丢掉的只是「怎么合并」这一层排版信息。
    /// </summary>
    public List<MergeRange> MergedRanges { get; init; } = new();
}

/// <summary>一张工作表的概要，供「多工作表时选一张导入」展示</summary>
public sealed class SheetInfo
{
    /// <summary>0 基序号，读取时原样传回</summary>
    public int Index { get; init; }

    public string Name { get; init; } = string.Empty;

    /// <summary>工作表实际行数（含表头行）</summary>
    public int RowCount { get; init; }

    public int ColumnCount { get; init; }

    /// <summary>是否有可导入的数据（至少 1 行表头 + 1 行数据）</summary>
    public bool HasData { get; init; }
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
    /// <summary>读取上传文件的工作表（默认第一张）</summary>
    public async Task<SheetData> ReadAsync(IFormFile file, int sheetIndex = 0)
    {
        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        stream.Position = 0;
        return Read(stream, sheetIndex);
    }

    /// <summary>列出上传文件里的全部工作表（只读结构，不解数据行）</summary>
    public async Task<List<SheetInfo>> ListSheetsAsync(IFormFile file)
    {
        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        stream.Position = 0;
        return ListSheets(stream);
    }

    /// <summary>列出流里的全部工作表</summary>
    public List<SheetInfo> ListSheets(Stream stream)
    {
        using var package = new ExcelPackage(stream);
        return DescribeSheets(package);
    }

    /// <summary>从流中读取指定序号的工作表</summary>
    public SheetData Read(Stream stream, int sheetIndex = 0)
    {
        using var package = new ExcelPackage(stream);
        var sheets = package.Workbook.Worksheets;

        if (sheets.Count == 0)
            throw new ExcelReadException("无法读取 Excel 文件");
        if (sheetIndex < 0 || sheetIndex >= sheets.Count)
            throw new ExcelReadException($"工作表序号 {sheetIndex + 1} 超出范围（文件里共 {sheets.Count} 张工作表）");

        var worksheet = sheets[sheetIndex];
        if (worksheet.Dimension == null)
            throw new ExcelReadException($"工作表「{worksheet.Name}」是空的，没有可导入的数据");

        var rowCount = worksheet.Dimension.Rows;
        var colCount = worksheet.Dimension.Columns;

        // 先取值矩阵并按合并区域铺平 —— 必须在读表头之前：A1:B1 合并成「销售额」大标题时
        // B1 本身是空的，不铺值表头就会退化成「列2」。
        var (grid, areas) = SheetGrid.Build(worksheet, rowCount, colCount);

        var headers = ReadHeaders(grid, colCount);
        var rows = new List<Dictionary<string, object>>();
        var rowNumbers = new List<int>();
        ReadRows(grid, rowCount, colCount, headers, rows, rowNumbers);

        return new SheetData
        {
            Headers = headers,
            Rows = rows,
            RowNumbers = rowNumbers,
            SourceRowCount = rowCount,
            SourceColumnCount = colCount,
            SheetName = worksheet.Name,
            SheetCount = sheets.Count,
            MergedRanges = BuildMergeRanges(areas, headers, rows.Count)
        };
    }

    /// <summary>
    /// 把生效的合并区域转成可持久化的记录：列存「列名」而不是下标（用户之后可能改名 /
    /// 移列），行数记的是实际入库的数据行数 —— 空行会被跳过，与工作表行数并不相等。
    /// </summary>
    private static List<MergeRange> BuildMergeRanges(List<MergeArea> areas, List<string> headers, int dataRowCount)
    {
        var result = new List<MergeRange>(areas.Count);

        foreach (var area in areas)
        {
            var cols = new List<string>(area.C2 - area.C1 + 1);
            for (int c = area.C1; c <= area.C2; c++) cols.Add(headers[c - 1]);

            result.Add(new MergeRange
            {
                R1 = area.R1,
                C1 = area.C1,
                R2 = area.R2,
                C2 = area.C2,
                Cols = cols,
                RowCount = dataRowCount
            });
        }

        return result;
    }

    /// <summary>工作表名 + 维度，不触碰单元格数据</summary>
    private static List<SheetInfo> DescribeSheets(ExcelPackage package)
    {
        var result = new List<SheetInfo>();
        var sheets = package.Workbook.Worksheets;

        for (int i = 0; i < sheets.Count; i++)
        {
            var sheet = sheets[i];
            var dimension = sheet.Dimension;
            var rows = dimension?.Rows ?? 0;
            var cols = dimension?.Columns ?? 0;

            result.Add(new SheetInfo
            {
                Index = i,
                Name = sheet.Name,
                RowCount = rows,
                ColumnCount = cols,
                // 第 1 行是表头，至少要再有一行数据才值得导入
                HasData = rows >= 2 && cols >= 1
            });
        }
        return result;
    }

    /// <summary>列名长度上限，与 ColumnStructureService 的校验保持一致</summary>
    private const int MaxHeaderLength = 100;

    private static List<string> ReadHeaders(string[,] grid, int colCount)
    {
        var headers = new List<string>(colCount);
        var used = new HashSet<string>(StringComparer.Ordinal);

        for (int c = 1; c <= colCount; c++)
        {
            var raw = grid[0, c - 1]?.Trim();
            var name = string.IsNullOrEmpty(raw) ? $"列{c}" : ExcelHelper.CleanString(raw);
            headers.Add(TakeUniqueName(name, used));
        }
        return headers;
    }

    /// <summary>
    /// 取一个当前未被占用的列名：先按 100 字符上限截断，重名时追加 _2 / _3 …
    /// 后缀按「去掉尾部数字的基名」累加，因此 A / A / A_2 得到 A / A_2 / A_3，
    /// 而不是 A / A_2 / A_2_2。加后缀前先把基名截短，保证结果仍不超长。
    /// </summary>
    private static string TakeUniqueName(string name, HashSet<string> used)
    {
        var trimmed = Truncate(name, MaxHeaderLength);
        if (used.Add(trimmed)) return trimmed;

        var baseName = StripNumericSuffix(trimmed);
        for (int i = 2; ; i++)
        {
            var suffix = "_" + i;
            var candidate = Truncate(baseName, MaxHeaderLength - suffix.Length) + suffix;
            if (used.Add(candidate)) return candidate;
        }
    }

    private static string Truncate(string text, int max) =>
        text.Length <= max ? text : text.Substring(0, max);

    /// <summary>去掉形如 _2 / _13 的尾部序号（_02 这类前导零不算，避免误改普通列名）</summary>
    private static string StripNumericSuffix(string name)
    {
        var idx = name.LastIndexOf('_');
        if (idx <= 0 || idx == name.Length - 1) return name;

        var tail = name.Substring(idx + 1);
        if (tail[0] == '0') return name;
        foreach (var ch in tail)
            if (ch < '0' || ch > '9') return name;

        return name.Substring(0, idx);
    }

    private static void ReadRows(
        string[,] grid,
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
                var value = grid[r - 1, c - 1]?.Trim() ?? string.Empty;

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
