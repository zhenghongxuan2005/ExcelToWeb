using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ExcelToWeb.Data;
using ExcelToWeb.Models;
using OfficeOpenXml;
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
                        // 检测是否为日期列
                        if (IsDateColumn(headers[c - 1]))
                        {
                            // 尝试将 Excel 日期序列号转换为日期
                            if (double.TryParse(v, out double dateValue) && dateValue > 0)
                            {
                                try
                                {
                                    row[headers[c - 1]] = DateTime.FromOADate(dateValue).ToString("yyyy-MM-dd");
                                }
                                catch
                                {
                                    row[headers[c - 1]] = v;
                                }
                            }
                            else
                            {
                                row[headers[c - 1]] = v;
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
            {
                errorMsg += " | 内部错误: " + ex.InnerException.Message;
            }
            return BadRequest(new { success = false, message = errorMsg });
        }
    }

    [HttpGet("query")]
    public async Task<IActionResult> Query(int tableId)
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
            {
                errorMsg += " | 内部错误: " + ex.InnerException.Message;
            }
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
            {
                errorMsg += " | 内部错误: " + ex.InnerException.Message;
            }
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
            {
                errorMsg += " | 内部错误: " + ex.InnerException.Message;
            }
            return BadRequest(new { success = false, message = errorMsg });
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