using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using Microsoft.AspNetCore.Http;

namespace ExcelToWeb.Services;

public interface IExcelService
{
    Task<ApiResponse<UploadResult>> UploadExcelAsync(IFormFile file, int userId);
    Task<ApiResponse<TableDataDto>> GetTableDataAsync(int tableId, int userId, string? date = null);
    Task<ApiResponse> SaveTableDataAsync(int tableId, int userId, List<Dictionary<string, object>> rows);
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
}
