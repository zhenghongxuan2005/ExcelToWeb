using System.Text.Json;
using ExcelToWeb.Data;
using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using ExcelToWeb.Services.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Services;

/// <summary>
/// 表格业务的门面（Facade）：对外只暴露 <see cref="IExcelService"/> 这一套契约，
/// 内部把「解析文件 / 导出 / 校验 / 持久化」分别委托给 Services/Excel 下的专职协作类。
/// 控制器与依赖注入无需任何改动。
/// </summary>
public class ExcelService : IExcelService
{
    /// <summary>用于识别「哪一列是日期列」的候选列名，供按日期筛选使用</summary>
    private static readonly string[] DateColumnCandidates =
        { "日期", "成交日期", "创建时间", "更新时间", "Date", "date" };

    private readonly AppDbContext _db;
    private readonly ILogger<ExcelService> _logger;
    private readonly ExcelSheetReader _reader;
    private readonly ExcelExportService _exporter;
    private readonly RowValidator _validator;
    private readonly TableRepository _repository;

    public ExcelService(
        AppDbContext db,
        ILogger<ExcelService> logger,
        ExcelSheetReader reader,
        ExcelExportService exporter,
        RowValidator validator,
        TableRepository repository)
    {
        _db = db;
        _logger = logger;
        _reader = reader;
        _exporter = exporter;
        _validator = validator;
        _repository = repository;
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
            var sheet = await _reader.ReadAsync(file);

            if (sheet.SourceRowCount < 2)
                return ApiResponse<UploadResult>.Fail("Excel 文件没有数据行");

            if (sheet.Rows.Count == 0)
                return ApiResponse<UploadResult>.Fail("没有找到有效数据");

            var table = new DynamicTable
            {
                TableName = Path.GetFileNameWithoutExtension(file.FileName),
                Headers = sheet.Headers,
                UserId = userId,
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now
            };
            await _repository.AddTableAsync(table);
            await _repository.BulkInsertRowsAsync(table.Id, sheet.Rows);

            _logger.LogInformation("用户 {UserId} 上传表格 {TableName}，共 {RowCount} 行",
                userId, table.TableName, sheet.Rows.Count);

            return ApiResponse<UploadResult>.Ok(new UploadResult
            {
                TableId = table.Id,
                TableName = table.TableName,
                Headers = sheet.Headers,
                Rows = sheet.Rows
            }, $"成功导入 {sheet.Rows.Count} 条数据");
        }
        catch (ExcelReadException ex)
        {
            // 这类提示是面向用户的，可以安全返回
            return ApiResponse<UploadResult>.Fail(ex.Message);
        }
        catch (Exception ex)
        {
            // 其它异常明细只进日志，避免把内部实现细节暴露给客户端
            _logger.LogError(ex, "上传 Excel 失败：用户 {UserId}", userId);
            return ApiResponse<UploadResult>.Fail("文件解析失败，请确认上传的是有效的 .xlsx / .xls 文件");
        }
    }

    // ================================================================
    // 查询数据
    // ================================================================
    public async Task<ApiResponse<TableDataDto>> GetTableDataAsync(int tableId, int userId, string? date = null)
    {
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null)
            return ApiResponse<TableDataDto>.Fail("表格不存在");

        var dataRows = await _repository.GetRowDataAsync(tableId);

        if (!string.IsNullOrEmpty(date))
        {
            dataRows = dataRows.Where(row => MatchesDate(row, date)).ToList();
        }

        return ApiResponse<TableDataDto>.Ok(new TableDataDto
        {
            TableId = table.Id,
            TableName = table.TableName,
            Headers = table.Headers,
            Rows = dataRows
        });
    }

    private static bool MatchesDate(Dictionary<string, object> row, string date)
    {
        foreach (var key in DateColumnCandidates)
        {
            if (!row.ContainsKey(key)) continue;
            var value = row[key]?.ToString() ?? string.Empty;
            return value.StartsWith(date, StringComparison.Ordinal);
        }
        return false;
    }

    // ================================================================
    // 保存数据（整表替换）
    // ================================================================
    public async Task<ApiResponse> SaveTableDataAsync(int tableId, int userId, List<Dictionary<string, object>> rows)
    {
        try
        {
            var table = await _repository.FindTableAsync(tableId, userId);
            if (table == null)
                return ApiResponse.Fail("表格不存在");

            await _repository.ReplaceRowsAsync(table, rows);

            _logger.LogInformation("用户 {UserId} 保存表格 {TableId}，共 {RowCount} 行", userId, tableId, rows.Count);
            return ApiResponse.Ok($"成功保存 {rows.Count} 条数据");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "保存表格数据失败：表 {TableId}，用户 {UserId}", tableId, userId);
            return ApiResponse.Fail("保存失败，请稍后重试");
        }
    }

    // ================================================================
    // 删除表格
    // ================================================================
    public async Task<ApiResponse> DeleteTableAsync(int tableId, int userId)
    {
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null)
            return ApiResponse.Fail("表格不存在");

        await _repository.DeleteTableAsync(table);

        _logger.LogInformation("用户 {UserId} 删除表格 {TableId}", userId, tableId);
        return ApiResponse.Ok("表格已删除");
    }

    // ================================================================
    // 导出（委托给 ExcelExportService）
    // ================================================================
    public Task<byte[]?> ExportExcelAsync(int tableId, int userId) =>
        _exporter.ExportExcelAsync(tableId, userId);

    public Task<byte[]?> ExportCsvAsync(int tableId, int userId) =>
        _exporter.ExportCsvAsync(tableId, userId);

    public Task<byte[]?> DownloadTemplateAsync(int tableId, int userId) =>
        _exporter.DownloadTemplateAsync(tableId, userId);

    // ================================================================
    // 获取表格列表
    // ================================================================
    public Task<List<TableInfoDto>> GetTablesAsync(int userId) => _repository.GetTableInfosAsync(userId);

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
        {
            // 传空数组表示「清空该列规则」，但原实现会直接返回成功而不删除任何东西，
            // 这里保持同样的对外语义（列名无从得知时无法定位要清空哪一列）。
            return ApiResponse.Ok("规则已清空");
        }

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
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return new List<ValidationRule>();

        return await _db.ValidationRules
            .Where(r => r.TableId == tableId)
            .ToListAsync();
    }

    public async Task<ApiResponse> SaveValidationRulesAsync(int tableId, int userId, List<ValidationRule> rules)
    {
        if (rules.Count == 0)
            return ApiResponse.Fail("规则不能为空");

        var table = await _repository.FindTableAsync(tableId, userId);
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
            var table = await _repository.FindTableAsync(tableId, userId);
            if (table == null)
                return ApiResponse<ValidationResult>.Fail("表格不存在");

            var sheet = await _reader.ReadAsync(file);
            var rules = await GetValidationRulesAsync(tableId, userId);

            var result = new ValidationResult();
            var validRows = new List<Dictionary<string, object>>();

            // 未配置规则时，全部数据视为通过
            if (rules.Count == 0)
            {
                result.SuccessRows = sheet.Rows.Count;
                result.TotalRows = result.SuccessRows;
                result.ValidRows = sheet.Rows;
                return ApiResponse<ValidationResult>.Ok(result, $"规则为空，导入 {result.SuccessRows} 行");
            }

            for (int i = 0; i < sheet.Rows.Count; i++)
            {
                var row = sheet.Rows[i];
                var rowErrors = _validator.ValidateRow(row, rules);

                if (rowErrors.Count == 0)
                {
                    validRows.Add(row);
                    result.SuccessRows++;
                    continue;
                }

                result.ErrorRows++;
                // 用工作表真实行号报错，方便用户直接定位到文件里的第几行
                result.Errors.Add($"第 {sheet.RowNumbers[i]} 行：{string.Join("；", rowErrors)}");
            }

            result.TotalRows = result.SuccessRows + result.ErrorRows;
            result.ValidRows = validRows;

            return ApiResponse<ValidationResult>.Ok(result);
        }
        catch (ExcelReadException ex)
        {
            return ApiResponse<ValidationResult>.Fail(ex.Message);
        }
        catch (Exception ex)
        {
            // 这里原先完全没有异常保护：上传一个损坏的 xlsx 会直接抛到中间件变成 500
            _logger.LogError(ex, "带校验上传失败：表 {TableId}，用户 {UserId}", tableId, userId);
            return ApiResponse<ValidationResult>.Fail("文件解析失败，请确认上传的是有效的 .xlsx / .xls 文件");
        }
    }
}
