using ExcelToWeb.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace ExcelToWeb.Auth;

/// <summary>
/// 把「权限不足」的 403 也收敛成统一的 ApiResponse 结构。
///
/// 默认行为是返回一个空的 403（或 ProblemDetails），前端只能笼统提示「操作失败」；
/// 这里带上「需要哪种权限」，用户才知道是账号被降级了，而不是系统坏了。
/// 只拦截「因权限要求不满足而 403」这一种情况，其余授权结果（401 挑战、
/// 其他策略失败）原样交给默认处理，避免改变既有行为。
/// </summary>
public sealed class PermissionResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _fallback = new();

    public async Task HandleAsync(
        RequestDelegate next,
        HttpContext context,
        AuthorizationPolicy policy,
        PolicyAuthorizationResult authorizeResult)
    {
        var failed = authorizeResult.AuthorizationFailure?.FailedRequirements
            .OfType<PermissionRequirement>()
            .FirstOrDefault();

        if (authorizeResult.Forbidden && failed != null)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(ApiResponse.Fail(
                $"没有权限执行该操作（需要「{Rbac.PermissionLabel(failed.Permission)}」权限）"));
            return;
        }

        await _fallback.HandleAsync(next, context, policy, authorizeResult);
    }
}
