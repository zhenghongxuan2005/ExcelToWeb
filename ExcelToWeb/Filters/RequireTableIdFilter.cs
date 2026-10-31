using ExcelToWeb.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;

namespace ExcelToWeb.Filters;

/// <summary>
/// 全局动作过滤器：查询串 / 路由里的 <c>tableId</c> 缺失或非正数时直接 400。
///
/// 为什么需要：<c>int tableId</c> 是值类型，少传时模型绑定给的是 0，
/// 一路传到仓储层就是「查无此表」，最后返回 404「表格不存在」。
/// 于是「你漏了参数」和「这张表真的没了」表现完全一样，排障时按提示走会走反方向。
///
/// 只在参数名恰好是 <c>tableId</c> 的 action 上生效：
/// POST / PUT 的表 id 在 DTO 里，不经过动作参数，交给服务层的「表格不存在」判断
/// （那种情况 404 是对的——请求形状没错，是资源真的不在）。
///
/// 注意不能只看 <c>ActionArguments</c>：参数完全没传时绑定会失败，
/// 这个键根本不出现在字典里（不是 0），必须回到 ActionDescriptor 的参数清单判断。
/// </summary>
public sealed class RequireTableIdFilter : IActionFilter
{
    /// <summary>提示语集中一处，测试与前端分支都以它为准</summary>
    public const string MissingMessage = "缺少 tableId 参数";

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (context.ActionDescriptor is not ControllerActionDescriptor action) return;
        if (!action.Parameters.Any(p => string.Equals(p.Name, "tableId", StringComparison.OrdinalIgnoreCase)))
            return;

        if (context.ActionArguments.TryGetValue("tableId", out var raw) && raw is int id && id > 0)
            return;

        context.Result = new BadRequestObjectResult(ApiResponse.Fail(MissingMessage));
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
        // 无需处理
    }
}
