using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using ExcelToWeb.Services;
using ExcelToWeb.Services.Excel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ExcelToWeb.Controllers;

/// <summary>
/// 回收站接口（功能 9）。与审计中心同款取舍：直接注入 TrashService 而不走 ExcelService 门面，
/// 归属校验在仓储查询里完成（FindTrashedAsync 带 userId），也为门面省出行数预算。
/// </summary>
[ApiController]
[Route("api/excel/trash")]
[Authorize]
public class TrashController : ControllerBase
{
    private readonly TrashService _trash;
    private readonly ITokenService _tokenService;

    public TrashController(TrashService trash, ITokenService tokenService)
    {
        _trash = trash;
        _tokenService = tokenService;
    }

    private int GetUserId() => _tokenService.GetUserId(User) ?? 0;

    /// <summary>回收站列表：已删除的表格（删除时间 + 行数）</summary>
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var items = await _trash.ListAsync(userId);
        return Ok(ApiResponse<List<TrashItemDto>>.Ok(items));
    }

    /// <summary>恢复：把表格移回表格列表，数据原样保留</summary>
    [HttpPost("{tableId}/restore")]
    public async Task<IActionResult> Restore(int tableId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _trash.RestoreAsync(tableId, userId);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    /// <summary>彻底删除：物理删表并清掉关联的审计日志 / 校验规则，不可恢复</summary>
    [HttpDelete("{tableId}")]
    public async Task<IActionResult> Purge(int tableId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _trash.PurgeAsync(tableId, userId);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }
}
