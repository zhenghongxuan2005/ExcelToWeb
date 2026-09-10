using System.Text;
using System.Text.Json;
using ExcelToWeb.Data;
using ExcelToWeb.DTOs;
using ExcelToWeb.Helpers;
using ExcelToWeb.Models;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using OfficeOpenXml;

namespace ExcelToWeb.Services;

public class ExcelService : IExcelService
{
    private readonly AppDbContext _db;
    private readonly ILogger<ExcelService> _logger;

    public ExcelService(AppDbContext db, ILogger<ExcelService> logger)
    {
        _db = db;
        _logger = logger;
    }

    // ================================================================
    // 上传 Excel
    // ================================================================
    public async Task<ApiResponse<UploadResult>> UploadExcelAsync(IFormFile file, int userId)
    {
        if (file == null || file.Length == 0)
            return ApiResponse<UploadResult>.Fail("请选择文件");

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".xlsx" && ext != ".xls")
            return ApiResponse<UploadResult>.Fail("请上传 .xlsx 或 .xls 格式的文件");

        try
        {
            using var stream = new MemoryStream();
            await file.CopyToAsync(stream);
            using var package = new ExcelPackage(stream);

            var worksheet = package.Workbook.Worksheets[0];
            if (worksheet == null || worksheet.Dimension == null)
                return ApiResponse<UploadResult>.Fail("无法读取 Excel 文件");

            var rowCount = worksheet.Dimension.Rows;
            var colCount = worksheet.Dimension.Columns;

            if (rowCount < 2)
                return ApiResponse<UploadResult>.Fail("Excel 文件没有数据行");

            // 读取表头
            var headers = new List<string>(colCount);
            for (int c = 1; c <= colCount; c++)
            {
                var h = worksheet.Cells[1, c]?.Text?.Trim();
                headers.Add(string.IsNullOrEmpty(h) ? $"列{c}" : ExcelHelper.CleanString(h));
            }

            // 读取数据行
            var rows = new List<Dictionary<string, object>>();
            for (int r = 2; r <= rowCount; r++)
            {
                var row = new Dictionary<string, object>();
                var hasData = false;
                for (int c = 1; c <= colCount; c++)
                {
                    var cell = worksheet.Cells[r, c];
                    var v = cell?.Text?.Trim() ?? string.Empty;

                    if (!string.IsNullOrEmpty(v))
                    {
                        hasData = true;
                        if (ExcelHelper.IsDateColumn(headers[c - 1]) &&
                            double.TryParse(v, out var dateValue) && dateValue > 0)
                        {
                            try
                            {
                                row[headers[c - 1]] = DateTime.FromOADate(dateValue).ToString("yyyy-MM-dd");
                            }
                            catch
                            {
                                row[headers[c - 1]] = ExcelHelper.CleanString(v);
                            }
                        }
                        else
                        {
                            row[headers[c - 1]] = ExcelHelper.CleanString(v);
                        }
                    }
                    else
                    {
                        row[headers[c - 1]] = string.Empty;
                    }
                }
                if (hasData) rows.Add(row);
            }

            if (rows.Count == 0)
                return ApiResponse<UploadResult>.Fail("没有找到有效数据");

            // 创建表记录
            var table = new DynamicTable
            {
                TableName = Path.GetFileNameWithoutExtension(file.FileName),
                Headers = headers,
                UserId = userId,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now
            };
            await _db.DynamicTables.AddAsync(table);
            await _db.SaveChangesAsync();

            // 批量插入数据行（原生 SQL）
            await BulkInsertRowsAsync(table.Id, rows);

            _logger.LogInformation("用户 {UserId} 上传表格 {TableName}，共 {RowCount} 行", userId, table.TableName, rows.Count);

            return ApiResponse<UploadResult>.Ok(
                new UploadResult
                {
                    TableId = table.Id,
                    TableName = table.TableName,
                    Headers = headers,
                    Rows = rows
                },
                $"成功导入 {rows.Count} 条数据");
        }
        catch (Exception ex)
        {
            // 异常明细只进日志，避免把内部异常信息暴露给客户端
            _logger.LogError(ex, "上传 Excel 失败：用户 {UserId}", userId);
            return ApiResponse<UploadResult>.Fail("文件解析失败，请确认上传的是有效的 .xlsx / .xls 文件");
        }
    }

    // ================================================================
    // 查询数据
    // ================================================================
    public async Task<ApiResponse<TableDataDto>> GetTableDataAsync(int tableId, int userId, string? date = null)
    {
        var table = await _db.DynamicTables
            .FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId);

        if (table == null)
            return ApiResponse<TableDataDto>.Fail("表格不存在");

        var rows = await _db.DynamicRows
            .Where(r => r.TableId == tableId)
            .ToListAsync();

        var dataRows = rows
            .Select(r => JsonSerializer.Deserialize<Dictionary<string, object>>(r.DataJson) ?? new Dictionary<string, object>())
            .ToList();

        if (!string.IsNullOrEmpty(date))
        {
            var dateKeys = new[] { "日期", "成交日期", "创建时间", "更新时间", "Date", "date" };
            dataRows = dataRows.Where(r =>
            {
                foreach (var key in dateKeys)
                {
                    if (r.ContainsKey(key))
                    {
                        var val = r[key]?.ToString() ?? string.Empty;
                        return val.StartsWith(date, StringComparison.Ordinal);
                    }
                }
                return false;
            }).ToList();
        }

        return ApiResponse<TableDataDto>.Ok(new TableDataDto
        {
            TableId = table.Id,
            TableName = table.TableName,
            Headers = table.Headers,
            Rows = dataRows
        });
    }

    // ================================================================
    // 保存数据（替换旧数据）
    // ================================================================
    public async Task<ApiResponse> SaveTableDataAsync(int tableId, int userId, List<Dictionary<string, object>> rows)
    {
        // 本接口是「整表替换」语义（先删后插），必须放在同一个事务里：
        // 否则插入阶段一旦失败，旧数据已经被 RemoveRange 删掉、新数据又没写进去，会造成数据丢失。
        await using var transaction = await _db.Database.BeginTransactionAsync();
        try
        {
            var table = await _db.DynamicTables
                .FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId);

            if (table == null)
                return ApiResponse.Fail("表格不存在");

            var oldRows = await _db.DynamicRows.Where(r => r.TableId == tableId).ToListAsync();
            _db.DynamicRows.RemoveRange(oldRows);

            var newRows = rows.Select(r => new DynamicRow
            {
                TableId = tableId,
                DataJson = JsonSerializer.Serialize(r),
                CreatedAt = DateTime.Now
            });
            await _db.DynamicRows.AddRangeAsync(newRows);
            table.UpdatedAt = DateTime.Now;
            await _db.SaveChangesAsync();

            await transaction.CommitAsync();

            _logger.LogInformation("用户 {UserId} 保存表格 {TableId}，共 {RowCount} 行", userId, tableId, rows.Count);
            return ApiResponse.Ok($"成功保存 {rows.Count} 条数据");
        }
        catch (Exception ex)
        {
            // 回滚保证「要么全部替换成功，要么保持原样」
            await transaction.RollbackAsync();
            // 异常明细只进服务端日志，不返回给客户端
            _logger.LogError(ex, "保存表格数据失败：表 {TableId}，用户 {UserId}", tableId, userId);
            return ApiResponse.Fail("保存失败，请稍后重试");
        }
    }

    // ================================================================
    // 删除表格
    // ================================================================
    public async Task<ApiResponse> DeleteTableAsync(int tableId, int userId)
    {
        var table = await _db.DynamicTables
            .FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId);

        if (table == null)
            return ApiResponse.Fail("表格不存在");

        _db.DynamicTables.Remove(table);
        await _db.SaveChangesAsync();

        _logger.LogInformation("用户 {UserId} 删除表格 {TableId}", userId, tableId);
        return ApiResponse.Ok("表格已删除");
    }

    // ================================================================
    // 导出 Excel
    // ================================================================
    public async Task<byte[]?> ExportExcelAsync(int tableId, int userId)
    {
        var table = await _db.DynamicTables
            .FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId);

        if (table == null) return null;

        var rows = await _db.DynamicRows
            .Where(r => r.TableId == tableId)
            .ToListAsync();

        using var package = new ExcelPackage();
        var worksheet = package.Workbook.Worksheets.Add(table.TableName ?? "数据");

        for (int c = 0; c < table.Headers.Count; c++)
            worksheet.Cells[1, c + 1].Value = table.Headers[c];

        for (int r = 0; r < rows.Count; r++)
        {
            var rowData = JsonSerializer.Deserialize<Dictionary<string, object>>(rows[r].DataJson) ?? new Dictionary<string, object>();
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

    // ================================================================
    // 导出 CSV
    // ================================================================
    public async Task<byte[]?> ExportCsvAsync(int tableId, int userId)
    {
        var table = await _db.DynamicTables
            .FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId);

        if (table == null) return null;

        var rows = await _db.DynamicRows
            .Where(r => r.TableId == tableId)
            .ToListAsync();

        using var memoryStream = new MemoryStream();
        var preamble = Encoding.UTF8.GetPreamble();
        await memoryStream.WriteAsync(preamble);

        await using var writer = new StreamWriter(memoryStream, Encoding.UTF8, leaveOpen: true);

        // 表头
        await writer.WriteAsync(string.Join(",", table.Headers.Select(ExcelHelper.EscapeCsvValue)));
        await writer.WriteLineAsync();

        // 数据行
        foreach (var row in rows)
        {
            var rowData = JsonSerializer.Deserialize<Dictionary<string, object>>(row.DataJson) ?? new Dictionary<string, object>();
            var values = table.Headers.Select(h =>
                ExcelHelper.EscapeCsvValue(rowData.ContainsKey(h) ? rowData[h]?.ToString() ?? string.Empty : string.Empty));
            await writer.WriteAsync(string.Join(",", values));
            await writer.WriteLineAsync();
        }

        await writer.FlushAsync();
        return memoryStream.ToArray();
    }

    // ================================================================
    // 下载模板
    // ================================================================
    public async Task<byte[]?> DownloadTemplateAsync(int tableId, int userId)
    {
        var table = await _db.DynamicTables
            .FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId);

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

        // 示例行
        for (int c = 0; c < table.Headers.Count; c++)
        {
            var cell = worksheet.Cells[2, c + 1];
            cell.Value = ExcelHelper.GetSampleValue(table.Headers[c]);
            cell.Style.Font.Italic = true;
            cell.Style.Font.Color.SetColor(System.Drawing.Color.Gray);
        }

        // 提示行
        worksheet.Cells[3, 1].Value = "请从第4行开始填写数据，删除示例数据行";
        worksheet.Cells[3, 1].Style.Font.Color.SetColor(System.Drawing.Color.Red);
        worksheet.Cells[3, 1].Style.Font.Size = 10;
        worksheet.Cells[3, 1, 3, table.Headers.Count].Merge = true;
        worksheet.Cells[3, 1, 3, table.Headers.Count].Style.HorizontalAlignment = OfficeOpenXml.Style.ExcelHorizontalAlignment.Center;

        worksheet.Cells.AutoFitColumns();
        return package.GetAsByteArray();
    }

    // ================================================================
    // 获取表格列表
    // ================================================================
    public async Task<List<TableInfoDto>> GetTablesAsync(int userId)
    {
        var tables = await _db.DynamicTables
            .Where(t => t.UserId == userId && _db.DynamicRows.Any(r => r.TableId == t.Id))
            .OrderByDescending(t => t.UpdatedAt)
            .Select(t => new TableInfoDto
            {
                Id = t.Id,
                TableName = t.TableName,
                Headers = t.Headers,
                CreatedAt = t.CreatedAt,
                UpdatedAt = t.UpdatedAt
            })
            .ToListAsync();

        return tables;
    }

    // ================================================================
    // 颜色规则
    // ================================================================
    public async Task<List<ColorRule>> GetColorRulesAsync(int userId, string? columnName = null)
    {
        var query = _db.ColorRules.Where(r => r.UserId == userId);
        if (!string.IsNullOrEmpty(columnName))
            query = query.Where(r => r.ColumnName == columnName);

        return await query.OrderBy(r => r.MinValue).ToListAsync();
    }

    public async Task<ApiResponse> SaveColorRulesAsync(int userId, List<ColorRule> rules)
    {
        if (rules.Count == 0)
            return ApiResponse.Ok("规则已清空");

        var columnName = rules[0].ColumnName;
        var oldRules = await _db.ColorRules
            .Where(r => r.UserId == userId && r.ColumnName == columnName)
            .ToListAsync();
        _db.ColorRules.RemoveRange(oldRules);

        foreach (var rule in rules)
        {
            rule.UserId = userId;
            rule.CreatedAt = DateTime.Now;
            rule.UpdatedAt = DateTime.Now;
            await _db.ColorRules.AddAsync(rule);
        }
        await _db.SaveChangesAsync();

        return ApiResponse.Ok($"成功保存 {rules.Count} 条规则");
    }

    // ================================================================
    // 校验规则
    // ================================================================
    public async Task<List<ValidationRule>> GetValidationRulesAsync(int tableId, int userId)
    {
        var table = await _db.DynamicTables
            .FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId);

        if (table == null) return new List<ValidationRule>();

        return await _db.ValidationRules
            .Where(r => r.TableId == tableId)
            .ToListAsync();
    }

    public async Task<ApiResponse> SaveValidationRulesAsync(int tableId, int userId, List<ValidationRule> rules)
    {
        if (rules.Count == 0)
            return ApiResponse.Fail("规则不能为空");

        var table = await _db.DynamicTables
            .FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId);

        if (table == null)
            return ApiResponse.Fail("表格不存在");

        var oldRules = await _db.ValidationRules.Where(r => r.TableId == tableId).ToListAsync();
        _db.ValidationRules.RemoveRange(oldRules);

        foreach (var rule in rules)
        {
            rule.TableId = tableId;
            rule.CreatedAt = DateTime.Now;
            rule.UpdatedAt = DateTime.Now;
            await _db.ValidationRules.AddAsync(rule);
        }
        await _db.SaveChangesAsync();

        return ApiResponse.Ok($"成功保存 {rules.Count} 条校验规则");
    }

    // ================================================================
    // 带校验的上传
    // ================================================================
    public async Task<ApiResponse<ValidationResult>> UploadWithValidationAsync(IFormFile file, int tableId, int userId)
    {
        if (file == null || file.Length == 0)
            return ApiResponse<ValidationResult>.Fail("请选择文件");

        try
        {
            return await ValidateAndImportAsync(file, tableId, userId);
        }
        catch (Exception ex)
        {
            // 这里原先完全没有异常保护：上传一个损坏的 xlsx 会直接抛到中间件变成 500
            _logger.LogError(ex, "带校验上传失败：表 {TableId}，用户 {UserId}", tableId, userId);
            return ApiResponse<ValidationResult>.Fail("文件解析失败，请确认上传的是有效的 .xlsx / .xls 文件");
        }
    }

    /// <summary>读取上传文件，按该表已配置的校验规则逐行校验，返回合法行与错误明细</summary>
    private async Task<ApiResponse<ValidationResult>> ValidateAndImportAsync(IFormFile file, int tableId, int userId)
    {
        var table = await _db.DynamicTables
            .FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId);

        if (table == null)
            return ApiResponse<ValidationResult>.Fail("表格不存在");

        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        using var package = new ExcelPackage(stream);

        var worksheet = package.Workbook.Worksheets[0];
        if (worksheet == null || worksheet.Dimension == null)
            return ApiResponse<ValidationResult>.Fail("无法读取 Excel 文件");

        var rules = await _db.ValidationRules
            .Where(r => r.TableId == tableId)
            .ToListAsync();

        var rowCount = worksheet.Dimension.Rows;
        var colCount = worksheet.Dimension.Columns;

        var headers = new List<string>(colCount);
        for (int c = 1; c <= colCount; c++)
        {
            var h = worksheet.Cells[1, c]?.Text?.Trim();
            headers.Add(string.IsNullOrEmpty(h) ? $"列{c}" : h);
        }

        var result = new ValidationResult();
        var validRows = new List<Dictionary<string, object>>();

        // 规则为空时直接返回所有数据
        if (rules.Count == 0)
        {
            for (int r = 2; r <= rowCount; r++)
            {
                var row = new Dictionary<string, object>();
                var hasData = false;
                for (int c = 1; c <= colCount; c++)
                {
                    var cellValue = worksheet.Cells[r, c]?.Text?.Trim() ?? string.Empty;
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
            result.ValidRows = validRows;
            return ApiResponse<ValidationResult>.Ok(result, $"规则为空，导入 {result.SuccessRows} 行");
        }

        // 逐行校验
        for (int r = 2; r <= rowCount; r++)
        {
            var row = new Dictionary<string, object>();
            var rowErrors = new List<string>();
            var hasData = false;

            for (int c = 1; c <= colCount; c++)
            {
                var cellValue = worksheet.Cells[r, c]?.Text?.Trim() ?? string.Empty;
                var colName = headers[c - 1];
                if (!string.IsNullOrEmpty(cellValue)) hasData = true;
                row[colName] = cellValue;
            }

            if (!hasData) continue;

            var rowValid = true;

            foreach (var rule in rules)
            {
                var colName = rule.ColumnName;
                if (!row.ContainsKey(colName)) continue;

                var value = row[colName]?.ToString() ?? string.Empty;

                // 必填校验
                if (rule.Required && string.IsNullOrEmpty(value))
                {
                    rowErrors.Add($"{colName} 不能为空");
                    rowValid = false;
                    continue;
                }

                if (string.IsNullOrEmpty(value)) continue;

                switch (rule.DataType)
                {
                    case "number":
                        if (!decimal.TryParse(value, out var numValue))
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
                        break;

                    case "date":
                        if (!DateTime.TryParse(value, out _))
                        {
                            rowErrors.Add($"{colName} 必须是日期格式");
                            rowValid = false;
                        }
                        break;

                    case "email":
                        if (!value.Contains('@') || !value.Contains('.'))
                        {
                            rowErrors.Add($"{colName} 必须是邮箱格式");
                            rowValid = false;
                        }
                        break;

                    default:
                        if (rule.MaxLength.HasValue && value.Length > rule.MaxLength.Value)
                        {
                            rowErrors.Add($"{colName} 长度不能超过 {rule.MaxLength.Value} 个字符");
                            rowValid = false;
                        }
                        else if (!string.IsNullOrEmpty(rule.AllowedValues))
                        {
                            var allowed = rule.AllowedValues.Split(',').Select(s => s.Trim()).ToList();
                            if (!allowed.Contains(value))
                            {
                                rowErrors.Add($"{colName} 必须是以下值之一：{string.Join(", ", allowed)}");
                                rowValid = false;
                            }
                        }
                        break;
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

        return ApiResponse<ValidationResult>.Ok(result);
    }

    // ================================================================
    // 私有：批量插入数据行
    // ================================================================
    private async Task BulkInsertRowsAsync(int tableId, List<Dictionary<string, object>> rows)
    {
        if (rows.Count == 0) return;

        var insertSql = new StringBuilder();
        insertSql.AppendLine("INSERT INTO DynamicRows (TableId, DataJson, CreatedAt) VALUES");

        var parameters = new List<SqlParameter>();
        int idx = 0;

        foreach (var row in rows)
        {
            var json = JsonSerializer.Serialize(row);
            parameters.Add(new SqlParameter($"@p{idx}", tableId));
            parameters.Add(new SqlParameter($"@p{idx + 1}", json));
            parameters.Add(new SqlParameter($"@p{idx + 2}", DateTime.Now));

            insertSql.AppendLine($"  (@p{idx}, @p{idx + 1}, @p{idx + 2}),");
            idx += 3;
        }

        // 移除最后一个逗号和换行
        insertSql.Length -= 3;

        await _db.Database.ExecuteSqlRawAsync(insertSql.ToString(), parameters.ToArray());
    }
}
