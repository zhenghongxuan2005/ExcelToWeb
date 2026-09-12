using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using ExcelToWeb.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ExcelToWeb.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ExcelController : ControllerBase
{
    private readonly IExcelService _service;
    private readonly ITokenService _tokenService;
    private readonly ILogger<ExcelController> _logger;

    public ExcelController(IExcelService service, ITokenService tokenService, ILogger<ExcelController> logger)
    {
        _service = service;
        _tokenService = tokenService;
        _logger = logger;
    }

    private int GetUserId() => _tokenService.GetUserId(User) ?? 0;

    // ================================================================
    // 表格核心接口
    // ================================================================

    [HttpPost("upload")]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _service.UploadExcelAsync(file, userId);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    [HttpGet("query")]
    public async Task<IActionResult> Query(int tableId, string? date = null)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _service.GetTableDataAsync(tableId, userId, date);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] SaveRequest request)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _service.SaveTableDataAsync(request.TableId, userId, request.Rows);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    [HttpDelete("delete")]
    public async Task<IActionResult> Delete(int tableId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _service.DeleteTableAsync(tableId, userId);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    /// <summary>重命名表格</summary>
    [HttpPut("rename")]
    public async Task<IActionResult> Rename([FromBody] RenameTableRequest request)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _service.RenameTableAsync(request.TableId, userId, request.TableName);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    /// <summary>复制表格（表结构 + 全部数据行），源表保持不变</summary>
    [HttpPost("duplicate")]
    public async Task<IActionResult> Duplicate([FromBody] DuplicateTableRequest request)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _service.DuplicateTableAsync(request.TableId, userId);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    /// <summary>
    /// 列结构维护（增 / 删 / 改 / 移）。一次请求完成：
    /// 请求里给最终列名与可选的重命名映射，服务端推出 dropped/added，
    /// 同步修改每行 DataJson 与 ColorRule / ValidationRule，整个过程在一个事务里。
    /// </summary>
    [HttpPut("headers")]
    public async Task<IActionResult> UpdateHeaders([FromBody] UpdateHeadersRequest request)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _service.UpdateHeadersAsync(request.TableId, userId, request);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    /// <summary>
    /// 列视图元数据（列宽 / 是否隐藏）。GET 单表读取；PUT 整表覆盖保存，
    /// 只接受当前表头里存在的列名，未知列名静默丢弃（列可能刚被删掉）。
    /// </summary>
    [HttpGet("column-meta")]
    public async Task<IActionResult> GetColumnMeta(int tableId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var meta = await _service.GetColumnMetaAsync(tableId, userId);
        return Ok(ApiResponse<Dictionary<string, ColumnMetaDto>>.Ok(meta));
    }

    [HttpPut("column-meta")]
    public async Task<IActionResult> SaveColumnMeta([FromBody] SaveColumnMetaRequest request)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _service.SaveColumnMetaAsync(request.TableId, userId, request);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    // ================================================================
    // 导出 Excel
    // ================================================================
    [HttpGet("export")]
    public async Task<IActionResult> Export(int tableId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var bytes = await _service.ExportExcelAsync(tableId, userId);
        if (bytes == null) return BadRequest(ApiResponse.Fail("表格不存在"));

        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"数据_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx");
    }

    [HttpGet("export-csv")]
    public async Task<IActionResult> ExportCsv(int tableId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var bytes = await _service.ExportCsvAsync(tableId, userId);
        if (bytes == null) return BadRequest(ApiResponse.Fail("表格不存在"));

        return File(bytes, "text/csv; charset=utf-8", $"数据_{DateTime.Now:yyyyMMdd_HHmmss}.csv");
    }

    [HttpGet("template")]
    public async Task<IActionResult> DownloadTemplate(int tableId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var bytes = await _service.DownloadTemplateAsync(tableId, userId);
        if (bytes == null) return BadRequest(ApiResponse.Fail("表格不存在"));

        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"模板_{DateTime.Now:yyyyMMdd}.xlsx");
    }

    [HttpGet("tables")]
    public async Task<IActionResult> GetTables()
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var tables = await _service.GetTablesAsync(userId);
        return Ok(ApiResponse<List<TableInfoDto>>.Ok(tables));
    }

    // ================================================================
    // 颜色规则
    // ================================================================

    [HttpGet("rules")]
    public async Task<IActionResult> GetRules(string? columnName = null)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var rules = await _service.GetColorRulesAsync(userId, columnName);
        return Ok(ApiResponse<List<ColorRule>>.Ok(rules));
    }

    [HttpPost("rules")]
    public async Task<IActionResult> SaveRules([FromBody] List<ColorRule> rules)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _service.SaveColorRulesAsync(userId, rules);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    // ================================================================
    // 校验规则
    // ================================================================

    [HttpGet("validation-rules")]
    public async Task<IActionResult> GetValidationRules(int tableId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var rules = await _service.GetValidationRulesAsync(tableId, userId);
        return Ok(ApiResponse<List<ValidationRule>>.Ok(rules));
    }

    [HttpPost("validation-rules")]
    public async Task<IActionResult> SaveValidationRules([FromBody] List<ValidationRule> rules)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        if (rules.Count == 0)
            return BadRequest(ApiResponse.Fail("规则不能为空"));

        var result = await _service.SaveValidationRulesAsync(rules[0].TableId, userId, rules);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    // ================================================================
    // 带校验的上传
    // ================================================================

    [HttpPost("upload-with-validation")]
    public async Task<IActionResult> UploadWithValidation(IFormFile file, int tableId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _service.UploadWithValidationAsync(file, tableId, userId);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }
}
