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

    // ================================================================
    // 工具方法
    // ================================================================
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

    private string GetSampleValue(string columnName)
    {
        if (string.IsNullOrEmpty(columnName)) return "";
        if (columnName.Contains("姓名") || columnName.Contains("名称") || columnName.Contains("名字"))
            return "示例名称";
        if (columnName.Contains("日期") || columnName.Contains("时间"))
            return "2026-08-09";
        if (columnName.Contains("金额") || columnName.Contains("价格") || columnName.Contains("单价") || columnName.Contains("总价"))
            return "100.00";
        if (columnName.Contains("数量") || columnName.Contains("个数"))
            return "10";
        if (columnName.Contains("是否") || columnName.Contains("完成") || columnName.Contains("状态"))
            return "是";
        if (columnName.Contains("编号") || columnName.Contains("序号") || columnName.Contains("ID"))
            return "001";
        return "示例数据";
    }

    private string EscapeCsvValue(string value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (value.Contains(",") || value.Contains("\"") || value.Contains("\n") || value.Contains("\r"))
        {
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        }
        return value;
    }

    // ================================================================
    // 上传 Excel
    // ================================================================
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

    // ================================================================
    // 查询数据
    // ================================================================
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

    // ================================================================
    // 保存数据
    // ================================================================
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

    // ================================================================
    // 导出 Excel
    // ================================================================
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
    // 获取颜色规则
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
    // 保存颜色规则
    // ================================================================
    [HttpPost("rules")]
    public async Task<IActionResult> SaveRules([FromBody] List<ColorRule> rules)
    {
        try
        {
            if (rules.Count > 0)
            {
                var columnName = rules[0].ColumnName;
                var oldRules = await _db.ColorRules.Where(r => r.ColumnName == columnName).ToListAsync();
                _db.ColorRules.RemoveRange(oldRules);
            }

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

            using var memoryStream = new MemoryStream();
            using var writer = new StreamWriter(memoryStream, Encoding.UTF8);

            var preamble = Encoding.UTF8.GetPreamble();
            memoryStream.Write(preamble, 0, preamble.Length);

            for (int c = 0; c < table.Headers.Count; c++)
            {
                writer.Write(EscapeCsvValue(table.Headers[c]));
                if (c < table.Headers.Count - 1)
                    writer.Write(",");
            }
            writer.WriteLine();

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

    // ================================================================
    // 下载模板
    // ================================================================
    [HttpGet("template")]
    public async Task<IActionResult> DownloadTemplate(int tableId)
    {
        try
        {
            var table = await _db.DynamicTables
                .FirstOrDefaultAsync(t => t.Id == tableId);

            if (table == null)
                return BadRequest(new { success = false, message = "表格不存在" });

            using var package = new ExcelPackage();
            var worksheet = package.Workbook.Worksheets.Add("模板");

            for (int c = 0; c < table.Headers.Count; c++)
            {
                worksheet.Cells[1, c + 1].Value = table.Headers[c];
                worksheet.Cells[1, c + 1].Style.Font.Bold = true;
                worksheet.Cells[1, c + 1].Style.Fill.PatternType = OfficeOpenXml.Style.ExcelFillStyle.Solid;
                worksheet.Cells[1, c + 1].Style.Fill.BackgroundColor.SetColor(System.Drawing.Color.LightGray);
            }

            var sampleRow = 2;
            for (int c = 0; c < table.Headers.Count; c++)
            {
                var colName = table.Headers[c];
                var sampleValue = GetSampleValue(colName);
                worksheet.Cells[sampleRow, c + 1].Value = sampleValue;
                worksheet.Cells[sampleRow, c + 1].Style.Font.Italic = true;
                worksheet.Cells[sampleRow, c + 1].Style.Font.Color.SetColor(System.Drawing.Color.Gray);
            }

            worksheet.Cells[3, 1].Value = "请从第4行开始填写数据，删除示例数据行";
            worksheet.Cells[3, 1].Style.Font.Color.SetColor(System.Drawing.Color.Red);
            worksheet.Cells[3, 1].Style.Font.Size = 10;
            worksheet.Cells[3, 1, 3, table.Headers.Count].Merge = true;
            worksheet.Cells[3, 1, 3, table.Headers.Count].Style.HorizontalAlignment = OfficeOpenXml.Style.ExcelHorizontalAlignment.Center;

            worksheet.Cells.AutoFitColumns();

            var bytes = package.GetAsByteArray();
            return File(
                bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"模板_{table.TableName}_{DateTime.Now:yyyyMMdd}.xlsx"
            );
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = $"下载模板失败：{ex.Message}" });
        }
    }

    // ================================================================
    // 获取校验规则
    // ================================================================
    [HttpGet("validation-rules")]
    public async Task<IActionResult> GetValidationRules(int tableId)
    {
        var rules = await _db.ValidationRules
            .Where(r => r.TableId == tableId)
            .ToListAsync();
        return Ok(rules);
    }

    // ================================================================
    // 保存校验规则
    // ================================================================
    [HttpPost("validation-rules")]
    public async Task<IActionResult> SaveValidationRules([FromBody] List<ValidationRule> rules)
    {
        try
        {
            if (rules.Count == 0)
                return BadRequest(new { success = false, message = "规则不能为空" });

            var tableId = rules[0].TableId;
            var oldRules = await _db.ValidationRules.Where(r => r.TableId == tableId).ToListAsync();
            _db.ValidationRules.RemoveRange(oldRules);

            foreach (var rule in rules)
            {
                rule.CreatedAt = DateTime.Now;
                rule.UpdatedAt = DateTime.Now;
                await _db.ValidationRules.AddAsync(rule);
            }
            await _db.SaveChangesAsync();

            return Ok(new { success = true, message = $"成功保存 {rules.Count} 条校验规则" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = $"保存失败：{ex.Message}" });
        }
    }

    // ================================================================
    // 带校验的上传
    // ================================================================
    [HttpPost("upload-with-validation")]
    public async Task<IActionResult> UploadWithValidation(IFormFile file, int tableId)
    {
        try
        {
            if (file == null || file.Length == 0)
                return Ok(new { success = false, message = "请选择文件" });

            using var stream = new MemoryStream();
            await file.CopyToAsync(stream);
            using var package = new ExcelPackage(stream);

            var worksheet = package.Workbook.Worksheets[0];
            if (worksheet == null || worksheet.Dimension == null)
                return Ok(new { success = false, message = "无法读取 Excel 文件" });

            var rules = await _db.ValidationRules
                .Where(r => r.TableId == tableId)
                .ToListAsync();

            var rowCount = worksheet.Dimension.Rows;
            var colCount = worksheet.Dimension.Columns;

            var headers = new List<string>();
            for (int c = 1; c <= colCount; c++)
            {
                var h = worksheet.Cells[1, c]?.Text?.Trim();
                headers.Add(string.IsNullOrEmpty(h) ? $"列{c}" : h);
            }

            var result = new ValidationResult();
            var validRows = new List<Dictionary<string, object>>();

            // ===== 如果规则为空，直接返回所有数据 =====
            if (rules.Count == 0)
            {
                for (int r = 2; r <= rowCount; r++)
                {
                    var row = new Dictionary<string, object>();
                    var hasData = false;
                    for (int c = 1; c <= colCount; c++)
                    {
                        var cellValue = worksheet.Cells[r, c]?.Text?.Trim() ?? "";
                        var colName = headers[c - 1];
                        if (!string.IsNullOrEmpty(cellValue)) hasData = true;
                        row[colName] = cellValue;
                    }
                    if (hasData)
                    {
                        validRows.Add(row);
                        result.SuccessRows++;
                    }
                }
                result.TotalRows = result.SuccessRows;

                return Ok(new
                {
                    success = true,
                    validationResult = result,
                    data = validRows,
                    message = $"规则为空，导入 {result.SuccessRows} 行"
                });
            }

            // ===== 遍历每一行 =====
            for (int r = 2; r <= rowCount; r++)
            {
                var row = new Dictionary<string, object>();
                var rowErrors = new List<string>();
                var hasData = false;

                for (int c = 1; c <= colCount; c++)
                {
                    var cellValue = worksheet.Cells[r, c]?.Text?.Trim() ?? "";
                    var colName = headers[c - 1];
                    if (!string.IsNullOrEmpty(cellValue)) hasData = true;
                    row[colName] = cellValue;
                }

                if (!hasData) continue;

                bool rowValid = true;

                // ===== 对每条规则进行校验 =====
                foreach (var rule in rules)
                {
                    var colName = rule.ColumnName;
                    if (!row.ContainsKey(colName)) continue;

                    var value = row[colName]?.ToString() ?? "";

                    // 必填校验
                    if (rule.Required && string.IsNullOrEmpty(value))
                    {
                        rowErrors.Add($"{colName} 不能为空");
                        rowValid = false;
                        continue;
                    }

                    if (string.IsNullOrEmpty(value)) continue;

                    // 数字校验
                    if (rule.DataType == "number")
                    {
                        if (!decimal.TryParse(value, out decimal numValue))
                        {
                            rowErrors.Add($"{colName} 必须是数字");
                            rowValid = false;
                            continue;
                        }
                        if (rule.MinValue.HasValue && numValue < rule.MinValue.Value)
                        {
                            rowErrors.Add($"{colName} 不能小于 {rule.MinValue.Value}");
                            rowValid = false;
                        }
                        if (rule.MaxValue.HasValue && numValue > rule.MaxValue.Value)
                        {
                            rowErrors.Add($"{colName} 不能大于 {rule.MaxValue.Value}");
                            rowValid = false;
                        }
                    }
                    // 日期校验
                    else if (rule.DataType == "date")
                    {
                        if (!DateTime.TryParse(value, out _))
                        {
                            rowErrors.Add($"{colName} 必须是日期格式");
                            rowValid = false;
                            continue;
                        }
                    }
                    // 邮箱校验
                    else if (rule.DataType == "email")
                    {
                        if (!value.Contains("@") || !value.Contains("."))
                        {
                            rowErrors.Add($"{colName} 必须是邮箱格式");
                            rowValid = false;
                            continue;
                        }
                    }
                    // 长度校验
                    else if (rule.MaxLength.HasValue && value.Length > rule.MaxLength.Value)
                    {
                        rowErrors.Add($"{colName} 长度不能超过 {rule.MaxLength.Value} 个字符");
                        rowValid = false;
                        continue;
                    }
                    // 允许值校验
                    else if (!string.IsNullOrEmpty(rule.AllowedValues))
                    {
                        var allowed = rule.AllowedValues.Split(',').Select(s => s.Trim()).ToList();
                        if (!allowed.Contains(value))
                        {
                            rowErrors.Add($"{colName} 必须是以下值之一：{string.Join(", ", allowed)}");
                            rowValid = false;
                            continue;
                        }
                    }
                }

                if (rowValid)
                {
                    validRows.Add(row);
                    result.SuccessRows++;
                }
                else
                {
                    result.ErrorRows++;
                    result.Errors.Add($"第 {r} 行：{string.Join("；", rowErrors)}");
                }
            }

            result.TotalRows = result.SuccessRows + result.ErrorRows;
            result.ValidRows = validRows;

            return Ok(new
            {
                success = true,
                validationResult = result,
                data = validRows
            });
        }
        catch (Exception ex)
        {
            return Ok(new
            {
                success = false,
                message = $"处理失败：{ex.Message}"
            });
        }
    }
}

public class SaveRequest
{
    public int TableId { get; set; }
    public List<Dictionary<string, object>> Rows { get; set; } = new();
}