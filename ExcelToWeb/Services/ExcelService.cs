using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using ExcelToWeb.Services.Excel;
using Microsoft.AspNetCore.Http;

namespace ExcelToWeb.Services;

/// <summary>
/// 表格业务的门面（Facade）：对外只暴露 <see cref="IExcelService"/> 这一套契约，
/// 内部把「解析文件 / 导出 / 校验 / 持久化」分别委托给 Services/Excel 下的专职协作类。
/// 控制器与依赖注入无需任何改动。
/// </summary>
public class ExcelService : IExcelService
{
    private readonly ILogger<ExcelService> _logger;
    private readonly TableImportService _imports;
    private readonly ExcelExportService _exporter;
    private readonly TableRepository _repository;
    private readonly RuleService _rules;
    private readonly ColumnStructureService _columns;
    private readonly ColumnMetaService _columnMeta;
    private readonly AuditService _audit;

    public ExcelService(
        ILogger<ExcelService> logger,
        TableImportService imports,
        ExcelExportService exporter,
        TableRepository repository,
        RuleService rules,
        ColumnStructureService columns,
        ColumnMetaService columnMeta,
        AuditService audit)
    {
        _logger = logger;
        _imports = imports;
        _exporter = exporter;
        _repository = repository;
        _rules = rules;
        _columns = columns;
        _columnMeta = columnMeta;
        _audit = audit;
    }

    // ================================================================
    // 上传 Excel（编排见 Services/Excel/TableImportService.cs）
    // ================================================================
    public Task<ApiResponse<UploadResult>> UploadExcelAsync(IFormFile file, int userId) =>
        _imports.ImportAsync(file, userId);

    // ================================================================
    // 查询数据
    // ================================================================
    public async Task<ApiResponse<TableDataDto>> GetTableDataAsync(int tableId, int userId, string? date = null)
    {
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null)
            return ApiResponse<TableDataDto>.Fail("表格不存在");

        var dataRows = await _repository.GetRowDataAsync(tableId);

        // 按日期过滤（日期列的识别与匹配见 RowDateFilter）
        if (!string.IsNullOrEmpty(date))
        {
            dataRows = dataRows.Where(row => RowDateFilter.Matches(row, date)).ToList();
        }

        return ApiResponse<TableDataDto>.Ok(new TableDataDto
        {
            TableId = table.Id,
            TableName = table.TableName,
            Headers = table.Headers,
            Rows = dataRows,
            // 列视图偏好随数据一起下发，前端不必再多发一次请求
            ColumnMeta = ColumnMetaService.Parse(table.ColumnMetaJson)
        });
    }

    // ================================================================
    // 保存数据（整表替换）
    // ================================================================
    public async Task<ApiResponse> SaveTableDataAsync(int tableId, int userId, List<Dictionary<string, object>> rows, string? userName = null)
    {
        try
        {
            var table = await _repository.FindTableAsync(tableId, userId);
            if (table == null)
                return ApiResponse.Fail("表格不存在");

            // 保存前取旧数据，用于审计 diff（读取失败不应阻断保存，故放在 try 内但由 AuditService 自身兜底）
            var oldRows = await _repository.GetRowDataAsync(tableId);

            await _repository.ReplaceRowsAsync(table, rows);

            // 变更历史：异步落库，失败只记日志（见 AuditService）
            await _audit.RecordSaveAsync(tableId, userName ?? "未知用户", oldRows, rows, table.Headers);

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
    // 重命名 / 复制表格
    // ================================================================
    public async Task<ApiResponse> RenameTableAsync(int tableId, int userId, string newName)
    {
        var name = (newName ?? string.Empty).Trim();
        if (name.Length == 0)
            return ApiResponse.Fail("表格名称不能为空");
        if (name.Length > 100)
            return ApiResponse.Fail("表格名称不能超过 100 个字符");

        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null)
            return ApiResponse.Fail("表格不存在");

        await _repository.RenameAsync(table, name);

        _logger.LogInformation("用户 {UserId} 重命名表格 {TableId} -> {NewName}", userId, tableId, name);
        return ApiResponse.Ok("重命名成功");
    }

    public async Task<ApiResponse<UploadResult>> DuplicateTableAsync(int tableId, int userId)
    {
        try
        {
            var table = await _repository.FindTableAsync(tableId, userId);
            if (table == null)
                return ApiResponse<UploadResult>.Fail("表格不存在");

            var rows = await _repository.GetRowDataAsync(tableId);

            var copyName = await _repository.BuildCopyNameAsync(table.TableName, userId);
            var copy = await _repository.CloneTableAsync(table, copyName);
            await _repository.BulkInsertRowsAsync(copy.Id, rows);

            _logger.LogInformation("用户 {UserId} 复制表格 {SourceId} -> {NewId}，共 {RowCount} 行",
                userId, tableId, copy.Id, rows.Count);

            return ApiResponse<UploadResult>.Ok(new UploadResult
            {
                TableId = copy.Id,
                TableName = copy.TableName,
                Headers = copy.Headers,
                Rows = rows
            }, $"复制成功，共 {rows.Count} 行");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "复制表格失败：源表 {TableId}，用户 {UserId}", tableId, userId);
            return ApiResponse<UploadResult>.Fail("复制失败，请稍后重试");
        }
    }

    // ================================================================
    // 列结构维护（增 / 删 / 改 / 移）+ 列视图元数据
    // ----------------------------------------------------------------
    // 实现分别在 Services/Excel/ColumnStructureService.cs 与 ColumnMetaService.cs。
    // 读取列元数据不走这里 —— GetTableDataAsync 已把 meta 随数据一起下发，
    // 省掉一次往返；GetColumnMetaAsync 只供需要单独刷新的场景使用。
    // ================================================================
    public async Task<ApiResponse> UpdateHeadersAsync(int tableId, int userId, UpdateHeadersRequest request)
    {
        try
        {
            return await _columns.UpdateHeadersAsync(tableId, userId, request);
        }
        catch (ColumnUpdateException ex)
        {
            _logger.LogError(ex.InnerException, "更新表格 {TableId} 列结构失败", ex.TableId);
            return ApiResponse.Fail("更新列结构失败，请稍后重试");
        }
    }

    public Task<Dictionary<string, ColumnMetaDto>> GetColumnMetaAsync(int tableId, int userId) =>
        _columnMeta.GetAsync(tableId, userId);

    public async Task<ApiResponse> SaveColumnMetaAsync(int tableId, int userId, SaveColumnMetaRequest request)
    {
        try
        {
            return await _columnMeta.SaveAsync(tableId, userId, request);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "保存表格 {TableId} 列元数据失败", tableId);
            return ApiResponse.Fail("保存列设置失败，请稍后重试");
        }
    }

    // ================================================================
    // 获取表格列表
    // ================================================================
    public Task<List<TableInfoDto>> GetTablesAsync(int userId) => _repository.GetTableInfosAsync(userId);

    // ================================================================
    // 颜色规则（委托给 RuleService，此处只做对外语义包装）
    // ================================================================
    public Task<List<ColorRule>> GetColorRulesAsync(int userId, string? columnName = null) =>
        _rules.GetColorRulesAsync(userId, columnName);

    public async Task<ApiResponse> SaveColorRulesAsync(int userId, List<ColorRule> rules)
    {
        if (rules.Count == 0)
        {
            // 传空数组表示「清空该列规则」，但原实现会直接返回成功而不删除任何东西，
            // 这里保持同样的对外语义（列名无从得知时无法定位要清空哪一列）。
            return ApiResponse.Ok("规则已清空");
        }

        var count = await _rules.ReplaceColorRulesAsync(userId, rules);
        return ApiResponse.Ok($"成功保存 {count} 条规则");
    }

    // ================================================================
    // 校验规则（归属校验留在门面，规则读写交给 RuleService）
    // ================================================================
    public async Task<List<ValidationRule>> GetValidationRulesAsync(int tableId, int userId)
    {
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return new List<ValidationRule>();

        return await _rules.GetValidationRulesAsync(tableId);
    }

    public async Task<ApiResponse> SaveValidationRulesAsync(int tableId, int userId, List<ValidationRule> rules)
    {
        if (rules.Count == 0)
            return ApiResponse.Fail("规则不能为空");

        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null)
            return ApiResponse.Fail("表格不存在");

        var count = await _rules.ReplaceValidationRulesAsync(tableId, rules);
        return ApiResponse.Ok($"成功保存 {count} 条校验规则");
    }

    // ================================================================
    // 列去重值（跨表引用下拉 / 校验）+ 变更历史查询
    // ================================================================
    public async Task<List<string>> GetColumnValuesAsync(int tableId, int userId, string columnName)
    {
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null || string.IsNullOrEmpty(columnName)) return new List<string>();

        return await _repository.GetDistinctColumnValuesAsync(tableId, columnName);
    }

    public async Task<List<AuditLog>> GetAuditLogsAsync(int tableId, int userId, int? rowIndex)
    {
        // 归属校验：只能看自己表的日志
        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return new List<AuditLog>();

        return await _audit.GetLogsAsync(tableId, rowIndex);
    }

    // ================================================================
    // 带校验的上传（编排见 Services/Excel/TableImportService.cs）
    // ================================================================
    public Task<ApiResponse<ValidationResult>> UploadWithValidationAsync(IFormFile file, int tableId, int userId) =>
        _imports.ImportWithValidationAsync(file, tableId, userId);
}
