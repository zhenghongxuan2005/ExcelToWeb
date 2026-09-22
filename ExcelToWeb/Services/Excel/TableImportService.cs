using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using Microsoft.AspNetCore.Http;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 「Excel 文件 → 建表 / 校验导入」的编排。
///
/// 从 ExcelService 抽出来：上传与带校验上传共用同一条「解析 → 建表 → 批插」链路，
/// 后续「多工作表导入」要在这条链上继续加东西（枚举工作表、按 sheet 读取、表名拼接），
/// 单独成类后不必再动门面 —— 门面只留一行委托，IExcelService 契约不变。
/// 校验规则的读写仍归 RuleService，这里只负责编排。
/// </summary>
public class TableImportService
{
    private readonly ILogger<TableImportService> _logger;
    private readonly ExcelSheetReader _reader;
    private readonly RowValidator _validator;
    private readonly TableRepository _repository;
    private readonly RuleService _rules;

    public TableImportService(
        ILogger<TableImportService> logger,
        ExcelSheetReader reader,
        RowValidator validator,
        TableRepository repository,
        RuleService rules)
    {
        _logger = logger;
        _reader = reader;
        _validator = validator;
        _repository = repository;
        _rules = rules;
    }

    /// <summary>上传 Excel：解析第一个工作表，建表并批量写入数据行</summary>
    public async Task<ApiResponse<UploadResult>> ImportAsync(IFormFile file, int userId)
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

    /// <summary>
    /// 带校验上传：按该表已配置的校验规则逐行校验，只把通过的行交给调用方。
    /// 不在此落库 —— 由调用方决定怎么用这些通过的行。
    /// </summary>
    public async Task<ApiResponse<ValidationResult>> ImportWithValidationAsync(IFormFile file, int tableId, int userId)
    {
        if (file == null || file.Length == 0)
            return ApiResponse<ValidationResult>.Fail("请选择文件");

        try
        {
            var table = await _repository.FindTableAsync(tableId, userId);
            if (table == null)
                return ApiResponse<ValidationResult>.Fail("表格不存在");

            var sheet = await _reader.ReadAsync(file);

            // 归属已在上方校验过，这里直接取规则，不必再查一次表
            var rules = await _rules.GetValidationRulesAsync(tableId);

            var result = new ValidationResult();

            // 未配置规则时，全部数据视为通过
            if (rules.Count == 0)
            {
                result.SuccessRows = sheet.Rows.Count;
                result.TotalRows = result.SuccessRows;
                result.ValidRows = sheet.Rows;
                return ApiResponse<ValidationResult>.Ok(result, $"规则为空，导入 {result.SuccessRows} 行");
            }

            // 1) 逐行校验（必填 / 类型 / 范围 / 允许值）
            var perRowErrors = new List<string>[sheet.Rows.Count];
            for (int i = 0; i < sheet.Rows.Count; i++)
                perRowErrors[i] = _validator.ValidateRow(sheet.Rows[i], rules);

            // 2) 唯一性（跨行校验，错误归并到对应行）
            _validator.ValidateUniqueness(sheet.Rows, rules, sheet.RowNumbers, perRowErrors);

            // 3) 跨表引用：取值必须落在引用表某列的去重值集合内
            foreach (var rule in rules.Where(r => r.RefTableId.HasValue && !string.IsNullOrEmpty(r.RefColumnName)))
            {
                var refValues = new HashSet<string>(
                    await _repository.GetDistinctColumnValuesAsync(rule.RefTableId!.Value, rule.RefColumnName),
                    StringComparer.Ordinal);
                if (refValues.Count == 0) continue;   // 引用表为空时不阻断导入（由用户自行判断）

                for (int i = 0; i < sheet.Rows.Count; i++)
                {
                    if (!sheet.Rows[i].TryGetValue(rule.ColumnName, out var raw)) continue;
                    var value = raw?.ToString() ?? string.Empty;
                    if (value.Length > 0 && !refValues.Contains(value))
                        perRowErrors[i].Add($"{rule.ColumnName} 的值「{value}」不在引用表中");
                }
            }

            // 4) 汇总：无错误的行进 validRows，有错误的行带行号进 Errors
            var validRows = new List<Dictionary<string, object>>();
            for (int i = 0; i < sheet.Rows.Count; i++)
            {
                if (perRowErrors[i].Count == 0)
                {
                    validRows.Add(sheet.Rows[i]);
                    result.SuccessRows++;
                    continue;
                }

                result.ErrorRows++;
                // 用工作表真实行号报错，方便用户直接定位到文件里的第几行
                result.Errors.Add($"第 {sheet.RowNumbers[i]} 行：{string.Join("；", perRowErrors[i])}");
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
