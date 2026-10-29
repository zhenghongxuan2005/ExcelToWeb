using ExcelToWeb.Auth;
using ExcelToWeb.DTOs;
using ExcelToWeb.Jobs;
using ExcelToWeb.Models;
using ExcelToWeb.Services;
using ExcelToWeb.Services.Excel;
using Hangfire;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ExcelToWeb.Controllers;

/// <summary>
/// 定时导出的产物查询与下载。
///
/// 只做「看」和「取」，不提供「立即生成」——那是后台任务的职责，
/// 想立刻要一份当前数据的用户直接用表格页的导出按钮即可，不需要经过这里。
/// 这样可以避免接口在无意中变成「同步跑一次完整导出」的慢请求。
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ExportsController : ControllerBase
{
    private const string XlsxContentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private readonly ExportSnapshotService _snapshots;
    private readonly ITokenService _tokenService;

    public ExportsController(ExportSnapshotService snapshots, ITokenService tokenService)
    {
        _snapshots = snapshots;
        _tokenService = tokenService;
    }

    private int GetUserId() => _tokenService.GetUserId(User) ?? 0;

    /// <summary>当前用户最近 50 份定时导出报表（新的在前）</summary>
    [HttpGet]
    [Authorize(Policy = Permission.TableRead)]
    public async Task<IActionResult> List()
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var items = await _snapshots.ListAsync(userId);
        return Ok(ApiResponse<List<ExportSnapshotDto>>.Ok(items));
    }

    /// <summary>
    /// 下载某份报表。归属校验在服务层按 (id, userId) 一起查，
    /// 传别人的 id 只会得到 404 —— 不区分「不存在」和「不是你的」，避免探测存在性。
    /// </summary>
    [HttpGet("{id:int}/download")]
    [Authorize(Policy = Permission.TableRead)]
    public async Task<IActionResult> Download(int id)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized(ApiResponse.Fail("未登录"));

        var resolved = await _snapshots.ResolveAsync(id, userId);
        if (resolved == null)
            return NotFound(ApiResponse.Fail("报表不存在或已被清理"));

        var (fullPath, fileName) = resolved.Value;
        return PhysicalFile(fullPath, XlsxContentType, fileName);
    }

    /// <summary>
    /// 立即执行一次定时导出（**仅开发环境**，答辩演示与联调排障用）。
    ///
    /// 走 Hangfire 队列而不是同步 await：接口只负责「把任务排进去」立即返回，
    /// 生成过程在后台 worker 上跑。这样即使有几十张表要导，请求也不会挂住等几分钟。
    /// 生产环境直接 404 —— 这个入口的唯一价值是「不用等到凌晨两点」。
    /// </summary>
    [HttpPost("run-now")]
    [Authorize(Policy = Permission.MemberManage)]
    public IActionResult RunNow([FromServices] IWebHostEnvironment env)
    {
        if (!env.IsDevelopment())
            return NotFound(ApiResponse.Fail("该入口仅在开发环境可用"));

        // 延迟解析：Hangfire:Enabled=false 时容器里没有 IBackgroundJobClient，
        // 直接构造注入会让整个控制器在启动时就解析失败
        var jobs = HttpContext.RequestServices.GetService<IBackgroundJobClient>();
        if (jobs == null)
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                ApiResponse.Fail("后台任务未启用（Hangfire:Enabled=false）"));

        var jobId = jobs.Enqueue<DailyExportJob>(job => job.RunAsync());
        return Ok(ApiResponse.Ok($"已排入队列，任务号 {jobId}"));
    }
}
