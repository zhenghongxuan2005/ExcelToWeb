using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using Microsoft.AspNetCore.Http;

namespace ExcelToWeb.Services;

public interface IExcelService
{
    /// <summary>上传 Excel 导入为新表；sheetIndex 指定用文件里的哪张工作表（0 基）</summary>
    Task<ApiResponse<UploadResult>> UploadExcelAsync(IFormFile file, int userId, int sheetIndex = 0);

    /// <summary>列出文件里的工作表，供「多工作表时选一张导入」使用</summary>
    Task<ApiResponse<List<SheetInfoDto>>> ListSheetsAsync(IFormFile file);
    Task<ApiResponse<TableDataDto>> GetTableDataAsync(int tableId, int userId, string? date = null);
    Task<ApiResponse> SaveTableDataAsync(int tableId, int userId, List<Dictionary<string, object>> rows, string? userName = null);
    Task<byte[]?> ExportExcelAsync(int tableId, int userId);
    Task<byte[]?> ExportCsvAsync(int tableId, int userId);
    Task<byte[]?> DownloadTemplateAsync(int tableId, int userId);
    Task<List<TableInfoDto>> GetTablesAsync(int userId);
    Task<ApiResponse> DeleteTableAsync(int tableId, int userId);
    Task<ApiResponse> RenameTableAsync(int tableId, int userId, string newName);
    Task<ApiResponse<UploadResult>> DuplicateTableAsync(int tableId, int userId);

    /// <summary>列结构维护：增 / 删 / 改 / 移。一次请求完成，重命名保留数据。</summary>
    Task<ApiResponse> UpdateHeadersAsync(int tableId, int userId, UpdateHeadersRequest request);

    /// <summary>读取列视图元数据（列名 -> 列宽 / 是否隐藏）</summary>
    Task<Dictionary<string, ColumnMetaDto>> GetColumnMetaAsync(int tableId, int userId);

    /// <summary>整表保存列视图元数据；只接受当前表头中存在的列名</summary>
    Task<ApiResponse> SaveColumnMetaAsync(int tableId, int userId, SaveColumnMetaRequest request);

    // 颜色规则
    Task<List<ColorRule>> GetColorRulesAsync(int userId, string? columnName = null);
    Task<ApiResponse> SaveColorRulesAsync(int userId, List<ColorRule> rules);

    // 校验规则
    Task<List<ValidationRule>> GetValidationRulesAsync(int tableId, int userId);
    Task<ApiResponse> SaveValidationRulesAsync(int tableId, int userId, List<ValidationRule> rules);

    // 带校验的上传
    Task<ApiResponse<ValidationResult>> UploadWithValidationAsync(IFormFile file, int tableId, int userId);

    /// <summary>取某列的去重值（上限 500），供「跨表引用」下拉与校验使用</summary>
    Task<List<string>> GetColumnValuesAsync(int tableId, int userId, string columnName);

    /// <summary>查询变更历史（按时间倒序，最多 100 条）；rowIndex 传值时只看该行</summary>
    Task<List<AuditLog>> GetAuditLogsAsync(int tableId, int userId, int? rowIndex);
}
