using ExcelToWeb.Auth;
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
    private readonly IConfiguration _configuration;

    public TrashController(TrashService trash, ITokenService tokenService, IConfiguration configuration)
    {
        _trash = trash;
        _tokenService = tokenService;
        _configuration = configuration;
    }

    private int GetUserId() => _tokenService.GetUserId(User) ?? 0;

    /// <summary>
    /// 保留策略：前端拿它渲染「N 天后自动清除」和空状态里的「N 天内可恢复」。
    /// 这些文案以前在前端硬编码 30 天，与后台清理服务的常量各写一份——
    /// 两处一旦不同步，用户看到的期限就是错的。现在只有一个真源（配置 → 这里 → 前端）。
    /// </summary>
    [HttpGet("policy")]
    [Authorize(Policy = Permission.TableRead)]
    public IActionResult Policy() =>
        Ok(ApiResponse<TrashPolicyDto>.Ok(new TrashPolicyDto
        {
            RetentionDays = RetentionPolicy.TrashDays(_configuration)
        }));

    /// <summary>回收站列表：已删除的表格（删除时间 + 行数）</summary>
    [HttpGet]
    [Authorize(Policy = Permission.TableRead)]
    public async Task<IActionResult> List()
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var items = await _trash.ListAsync(userId);
        return Ok(ApiResponse<List<TrashItemDto>>.Ok(items));
    }

    /// <summary>恢复：把表格移回表格列表，数据原样保留</summary>
    [HttpPost("{tableId}/restore")]
    [Authorize(Policy = Permission.TrashManage)]
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
    [Authorize(Policy = Permission.TrashManage)]
    public async Task<IActionResult> Purge(int tableId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var result = await _trash.PurgeAsync(tableId, userId);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }
}
