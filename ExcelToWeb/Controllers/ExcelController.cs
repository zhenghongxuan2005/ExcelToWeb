using ExcelToWeb.Data;
using ExcelToWeb.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OfficeOpenXml;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ExcelToWeb.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ExcelController : ControllerBase
{
    private readonly AppDbContext _db;

    public ExcelController(AppDbContext db)
    {
        _db = db;
    }

    [HttpPost("upload")]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        try
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, message = "请选择文件" });

            var ext = Path.GetExtension(file.FileName).ToLower();
            if (ext != ".xlsx" && ext != ".xls")
                return BadRequest(new { success = false, message = "请上传 .xlsx 或 .xls 格式的文件" });

            using var stream = new MemoryStream();
            await file.CopyToAsync(stream);
            using var package = new ExcelPackage(stream);

            var worksheet = package.Workbook.Worksheets[0];
            if (worksheet == null || worksheet.Dimension == null)
                return BadRequest(new { success = false, message = "无法读取 Excel 文件" });

            var rowCount = worksheet.Dimension.Rows;
            var colCount = worksheet.Dimension.Columns;

            if (rowCount < 2)
                return BadRequest(new { success = false, message = "Excel 文件没有数据行" });

            var headers = new List<string>();
            for (int c = 1; c <= colCount; c++)
            {
                var h = worksheet.Cells[1, c]?.Text?.Trim();
                headers.Add(string.IsNullOrEmpty(h) ? $"列{c}" : CleanString(h));
            }

            var rows = new List<Dictionary<string, object>>();
            for (int r = 2; r <= rowCount; r++)
            {
                var row = new Dictionary<string, object>();
                var hasData = false;
                for (int c = 1; c <= colCount; c++)
                {
                    var cell = worksheet.Cells[r, c];
                    var v = cell?.Text?.Trim() ?? "";

                    if (!string.IsNullOrEmpty(v))
                    {
                        hasData = true;
                        // 日期列自动转换
                        if (IsDateColumn(headers[c - 1]) && double.TryParse(v, out double dateValue) && dateValue > 0)
                        {
                            try
                            {
                                row[headers[c - 1]] = DateTime.FromOADate(dateValue).ToString("yyyy-MM-dd");
                            }
                            catch
                            {
                                row[headers[c - 1]] = CleanString(v);
                            }
                        }
                        else
                        {
                            row[headers[c - 1]] = CleanString(v);
                        }
                    }
                    else
                    {
                        row[headers[c - 1]] = "";
                    }
                }
                if (hasData) rows.Add(row);
            }

            if (rows.Count == 0)
                return BadRequest(new { success = false, message = "没有找到有效数据" });

            var table = new DynamicTable
            {
                TableName = Path.GetFileNameWithoutExtension(file.FileName),
                Headers = headers,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now
            };
            await _db.DynamicTables.AddAsync(table);
            await _db.SaveChangesAsync();

            foreach (var row in rows)
            {
                _db.DynamicRows.Add(new DynamicRow
                {
                    TableId = table.Id,
                    DataJson = JsonSerializer.Serialize(row),
                    CreatedAt = DateTime.Now
                });
            }
            await _db.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"成功导入 {rows.Count} 条数据",
                tableId = table.Id,
                tableName = table.TableName,
                headers = headers,
                rows = rows
            });
        }
        catch (Exception ex)
        {
            var errorMsg = ex.Message;
            if (ex.InnerException != null)
                errorMsg += " | 内部错误: " + ex.InnerException.Message;
            return BadRequest(new { success = false, message = errorMsg });
        }
    }

    [HttpGet("query")]
    public async Task<IActionResult> Query(int tableId, string? date = null)
    {
        try
        {
            var table = await _db.DynamicTables
                .FirstOrDefaultAsync(t => t.Id == tableId);

            if (table == null)
                return NotFound(new { success = false, message = "表格不存在" });

            var rows = await _db.DynamicRows
                .Where(r => r.TableId == tableId)
                .ToListAsync();

            var dataRows = rows.Select(r => JsonSerializer.Deserialize<Dictionary<string, object>>(r.DataJson) ?? new Dictionary<string, object>()).ToList();

            // 按日期筛选
            if (!string.IsNullOrEmpty(date))
            {
                dataRows = dataRows.Where(r =>
                {
                    var dateKeys = new[] { "日期", "成交日期", "创建时间", "更新时间", "Date", "date" };
                    foreach (var key in dateKeys)
                    {
                        if (r.ContainsKey(key))
                        {
                            var val = r[key]?.ToString() ?? "";
                            return val.StartsWith(date);
                        }
                    }
                    return false;
                }).ToList();
            }

            return Ok(new
            {
                tableId = table.Id,
                tableName = table.TableName,
                headers = table.Headers,
                rows = dataRows
            });
        }
        catch (Exception ex)
        {
            var errorMsg = ex.Message;
            if (ex.InnerException != null)
                errorMsg += " | 内部错误: " + ex.InnerException.Message;
            return BadRequest(new { success = false, message = errorMsg });
        }
    }

    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] SaveRequest request)
    {
        try
        {
            var table = await _db.DynamicTables
                .FirstOrDefaultAsync(t => t.Id == request.TableId);

            if (table == null)
                return BadRequest(new { success = false, message = "表格不存在" });

            var oldRows = await _db.DynamicRows.Where(r => r.TableId == request.TableId).ToListAsync();
            _db.DynamicRows.RemoveRange(oldRows);

            var newRows = request.Rows.Select(r => new DynamicRow
            {
                TableId = request.TableId,
                DataJson = JsonSerializer.Serialize(r),
                CreatedAt = DateTime.Now
            });
            await _db.DynamicRows.AddRangeAsync(newRows);
            table.UpdatedAt = DateTime.Now;
            await _db.SaveChangesAsync();

            return Ok(new { success = true, message = $"成功保存 {request.Rows.Count} 条数据" });
        }
        catch (Exception ex)
        {
            var errorMsg = ex.Message;
            if (ex.InnerException != null)
                errorMsg += " | 内部错误: " + ex.InnerException.Message;
            return BadRequest(new { success = false, message = errorMsg });
        }
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export(int tableId)
    {
        try
        {
            var table = await _db.DynamicTables
                .FirstOrDefaultAsync(t => t.Id == tableId);

            if (table == null)
                return BadRequest(new { success = false, message = "表格不存在" });

            var rows = await _db.DynamicRows
                .Where(r => r.TableId == tableId)
                .ToListAsync();

            using var package = new ExcelPackage();
            var worksheet = package.Workbook.Worksheets.Add(table.TableName ?? "数据");

            for (int c = 0; c < table.Headers.Count; c++)
            {
                worksheet.Cells[1, c + 1].Value = table.Headers[c];
            }

            for (int r = 0; r < rows.Count; r++)
            {
                var rowData = JsonSerializer.Deserialize<Dictionary<string, object>>(rows[r].DataJson) ?? new Dictionary<string, object>();
                for (int c = 0; c < table.Headers.Count; c++)
                {
                    var key = table.Headers[c];
                    var value = rowData.ContainsKey(key) ? rowData[key] : "";
                    worksheet.Cells[r + 2, c + 1].Value = value?.ToString();
                }
            }

            worksheet.Cells.AutoFitColumns();
            var bytes = package.GetAsByteArray();

            return File(
                bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"{table.TableName}_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx"
            );
        }
        catch (Exception ex)
        {
            var errorMsg = ex.Message;
            if (ex.InnerException != null)
                errorMsg += " | 内部错误: " + ex.InnerException.Message;
            return BadRequest(new { success = false, message = errorMsg });
        }
    }

    // ================================================================
    // 导出 CSV
    // ================================================================
    [HttpGet("export-csv")]
    public async Task<IActionResult> ExportCsv(int tableId)
    {
        try
        {
            var table = await _db.DynamicTables
                .FirstOrDefaultAsync(t => t.Id == tableId);

            if (table == null)
                return BadRequest(new { success = false, message = "表格不存在" });

            var rows = await _db.DynamicRows
                .Where(r => r.TableId == tableId)
                .ToListAsync();

            // 构建 CSV 内容
            using var memoryStream = new MemoryStream();
            using var writer = new StreamWriter(memoryStream, Encoding.UTF8);

            // 写入表头
            for (int c = 0; c < table.Headers.Count; c++)
            {
                writer.Write(EscapeCsvValue(table.Headers[c]));
                if (c < table.Headers.Count - 1)
                    writer.Write(",");
            }
            writer.WriteLine();

            // 写入数据
            foreach (var row in rows)
            {
                var rowData = JsonSerializer.Deserialize<Dictionary<string, object>>(row.DataJson) ?? new Dictionary<string, object>();
                for (int c = 0; c < table.Headers.Count; c++)
                {
                    var key = table.Headers[c];
                    var value = rowData.ContainsKey(key) ? rowData[key]?.ToString() ?? "" : "";
                    writer.Write(EscapeCsvValue(value));
                    if (c < table.Headers.Count - 1)
                        writer.Write(",");
                }
                writer.WriteLine();
            }

            await writer.FlushAsync();
            var bytes = memoryStream.ToArray();

            return File(
                bytes,
                "text/csv; charset=utf-8",
                $"{table.TableName}_{DateTime.Now:yyyyMMdd_HHmmss}.csv"
            );
        }
        catch (Exception ex)
        {
            var errorMsg = ex.Message;
            if (ex.InnerException != null)
                errorMsg += " | 内部错误: " + ex.InnerException.Message;
            return BadRequest(new { success = false, message = errorMsg });
        }
    }

    // CSV 值转义
    private string EscapeCsvValue(string value)
    {
        if (string.IsNullOrEmpty(value))
            return "";

        // 如果包含逗号、双引号或换行符，需要用双引号包裹
        if (value.Contains(",") || value.Contains("\"") || value.Contains("\n") || value.Contains("\r"))
        {
            // 双引号转义为两个双引号
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        }
        return value;
    }

    // ================================================================
    // 获取所有表格列表
    // ================================================================
    [HttpGet("tables")]
    public async Task<IActionResult> GetTables()
    {
        var tables = await _db.DynamicTables
            .OrderByDescending(t => t.UpdatedAt)
            .Select(t => new { t.Id, t.TableName, t.Headers, t.CreatedAt, t.UpdatedAt })
            .ToListAsync();
        return Ok(tables);
    }

    // ================================================================
    // 获取所有颜色规则
    // ================================================================
    [HttpGet("rules")]
    public async Task<IActionResult> GetRules(string? columnName = null)
    {
        var query = _db.ColorRules.AsQueryable();
        if (!string.IsNullOrEmpty(columnName))
        {
            query = query.Where(r => r.ColumnName == columnName);
        }
        var rules = await query.OrderBy(r => r.MinValue).ToListAsync();
        return Ok(rules);
    }

    // ================================================================
    // 保存颜色规则（新增或更新）
    // ================================================================
    [HttpPost("rules")]
    public async Task<IActionResult> SaveRules([FromBody] List<ColorRule> rules)
    {
        try
        {
            // 删除该列的旧规则
            if (rules.Count > 0)
            {
                var columnName = rules[0].ColumnName;
                var oldRules = await _db.ColorRules.Where(r => r.ColumnName == columnName).ToListAsync();
                _db.ColorRules.RemoveRange(oldRules);
            }

            // 添加新规则
            foreach (var rule in rules)
            {
                rule.CreatedAt = DateTime.Now;
                rule.UpdatedAt = DateTime.Now;
                await _db.ColorRules.AddAsync(rule);
            }
            await _db.SaveChangesAsync();

            return Ok(new { success = true, message = $"成功保存 {rules.Count} 条规则" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = $"保存失败：{ex.Message}" });
        }
    }
    private string CleanString(string input)
    {
        if (string.IsNullOrEmpty(input)) return input;
        return Regex.Replace(input, @"[\x00-\x08\x0B\x0C\x0E-\x1F]", "");
    }

    private bool IsDateColumn(string header)
    {
        if (string.IsNullOrEmpty(header)) return false;
        var keywords = new[] { "日期", "时间", "成交日期", "创建时间", "更新时间", "日", "date", "time", "Date", "Time" };
        return keywords.Any(k => header.Contains(k, StringComparison.OrdinalIgnoreCase));
    }
}

public class SaveRequest
{
    public int TableId { get; set; }
    public List<Dictionary<string, object>> Rows { get; set; } = new();
}