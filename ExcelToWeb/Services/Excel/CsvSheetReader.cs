using System.Text;
using ExcelToWeb.Helpers;
using Microsoft.AspNetCore.Http;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// CSV 文件解析器：输出与 ExcelSheetReader 完全一致的 <see cref="SheetData"/>，
/// 导入编排（TableImportService）只按扩展名分流，不感知两者差异。
/// 编码识别：带 UTF-8 BOM 按 UTF-8；否则先用「严格 UTF-8」试解——中文按 UTF-8 保存时
/// 字节序合法、按 GBK 保存时必然解出非法字节，借此区分两种编码（中文 Excel 导出的
/// CSV 常是 GBK）。分隔符按首行出现最多的候选（逗号 / 分号 / 制表符）确定。
/// </summary>
public class CsvSheetReader
{
    /// <summary>数据行上限，与 ExcelSheetReader 保持一致</summary>
    private const int MaxRows = 50_000;

    /// <summary>列数上限，与 ExcelSheetReader 保持一致</summary>
    private const int MaxColumns = 200;

    /// <summary>列名长度上限，与 ExcelSheetReader 保持一致</summary>
    private const int MaxHeaderLength = 100;

    public async Task<SheetData> ReadAsync(IFormFile file)
    {
        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        var text = Decode(stream.ToArray());

        var lines = SplitLines(text);
        if (lines.Count == 0)
            throw new ExcelReadException("文件是空的，没有可导入的数据");

        var delimiter = DetectDelimiter(lines[0]);

        // 第 1 行是表头；限制检查与 Excel 路径一致（rowCount 含表头行）
        if (lines.Count - 1 > MaxRows)
            throw new ExcelReadException($"数据行超过上限 {MaxRows} 行");

        var headers = ReadHeaders(SplitLine(lines[0], delimiter));

        var rows = new List<Dictionary<string, object>>();
        var rowNumbers = new List<int>();
        // 注意：不支持「带引号字段内含换行」的写法——该写法在表格类 CSV 里极少见，
        // 按行拆分能让解析保持一眼能看懂的程度
        for (int i = 1; i < lines.Count; i++)
        {
            var cells = SplitLine(lines[i], delimiter);
            if (cells.Count > MaxColumns)
                throw new ExcelReadException($"列数超过上限 {MaxColumns} 列");

            var row = new Dictionary<string, object>();
            var hasData = false;
            for (int c = 0; c < headers.Count; c++)
            {
                var value = c < cells.Count ? ExcelHelper.CleanString(cells[c].Trim()) : string.Empty;
                if (value.Length > 0) hasData = true;
                row[headers[c]] = value;
            }

            // 整行为空的行不计入结果，与 Excel 路径一致
            if (!hasData) continue;

            rows.Add(row);
            rowNumbers.Add(i + 1);   // 文件里的真实行号（1 基，含表头行）
        }

        return new SheetData
        {
            Headers = headers,
            Rows = rows,
            RowNumbers = rowNumbers,
            SourceRowCount = lines.Count,
            SourceColumnCount = headers.Count,
            SheetName = string.Empty,       // 表名由编排层按文件名生成（单工作表语义）
            SheetCount = 1,
            MergedRanges = new()             // CSV 没有合并单元格概念
        };
    }

    /// <summary>
    /// 编码嗅探：BOM 优先，其次严格 UTF-8，最后回退 GBK（码页 936）。
    /// GBK 编码器在部分平台需注册 CodePages 提供器才有；取不到时退回 UTF-8，
    /// 最坏情况是乱码字符进错误提示，不会让程序崩。
    /// </summary>
    private static string Decode(byte[] bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
            return new UTF8Encoding(false).GetString(bytes, 3, bytes.Length - 3);

        try
        {
            // throwOnInvalidBytes = true：不是合法 UTF-8 就抛异常，交给 GBK 分支
            return new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            try
            {
                Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
                return Encoding.GetEncoding(936).GetString(bytes);
            }
            catch (ArgumentException)
            {
                return Encoding.UTF8.GetString(bytes);
            }
        }
    }

    /// <summary>按 \r\n 或 \n 拆行（BOM 已在解码层处理，这里不用再管）</summary>
    private static List<string> SplitLines(string text)
    {
        var result = new List<string>();
        foreach (var raw in text.Split('\n'))
            result.Add(raw.TrimEnd('\r'));

        // 去掉文件末尾换行产生的空串
        if (result.Count > 0 && result[^1].Length == 0) result.RemoveAt(result.Count - 1);
        return result;
    }

    /// <summary>取首行中出现最多的候选分隔符（逗号 / 分号 / 制表符），都没有就用逗号</summary>
    private static char DetectDelimiter(string headerLine)
    {
        char[] candidates = { ',', ';', '\t' };
        char best = ',';
        int bestCount = 0;
        foreach (var c in candidates)
        {
            var count = headerLine.Count(ch => ch == c);
            if (count > bestCount)
            {
                best = c;
                bestCount = count;
            }
        }
        return best;
    }

    /// <summary>
    /// 表头：去控制字符、空表头补「列N」、重名追加 _2/_3…（与 Excel 路径的语义一致）。
    /// </summary>
    private static List<string> ReadHeaders(List<string> cells)
    {
        if (cells.Count > MaxColumns)
            throw new ExcelReadException($"列数超过上限 {MaxColumns} 列");

        var headers = new List<string>(cells.Count);
        var used = new HashSet<string>(StringComparer.Ordinal);

        for (int c = 0; c < cells.Count; c++)
        {
            var raw = ExcelHelper.CleanString(cells[c].Trim());
            var name = raw.Length == 0 ? $"列{c + 1}" : raw;
            if (name.Length > MaxHeaderLength) name = name.Substring(0, MaxHeaderLength);

            var candidate = name;
            var suffix = 2;
            while (!used.Add(candidate))
                candidate = name + "_" + suffix++;
            headers.Add(candidate);
        }
        return headers;
    }

    /// <summary>
    /// 单行拆字段：支持双引号包裹（字段里可含分隔符 / 转义的 "" ）。
    /// </summary>
    private static List<string> SplitLine(string line, char delimiter)
    {
        var fields = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;

        for (int i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (inQuotes)
            {
                if (ch == '"')
                {
                    // 两个连续引号 = 字段里的一个引号
                    if (i + 1 < line.Length && line[i + 1] == '"')
                    {
                        current.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    current.Append(ch);
                }
            }
            else if (ch == '"' && current.Length == 0)
            {
                inQuotes = true;                     // 字段以引号开头才视为引号包裹
            }
            else if (ch == delimiter)
            {
                fields.Add(current.ToString());
                current.Clear();
            }
            else
            {
                current.Append(ch);
            }
        }
        fields.Add(current.ToString());
        return fields;
    }
}
