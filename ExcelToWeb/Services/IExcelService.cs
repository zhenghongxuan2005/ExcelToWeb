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

    // 颜色规则
    Task<List<ColorRule>> GetColorRulesAsync(int userId, string? columnName = null);
    Task<ApiResponse> SaveColorRulesAsync(int userId, List<ColorRule> rules);

    // 校验规则
    Task<List<ValidationRule>> GetValidationRulesAsync(int tableId, int userId);
    Task<ApiResponse> SaveValidationRulesAsync(int tableId, int userId, List<ValidationRule> rules);

    // 带校验的上传
    Task<ApiResponse<ValidationResult>> UploadWithValidationAsync(IFormFile file, int tableId, int userId);
}
