using System.Security.Claims;
using ExcelToWeb.Models;
using Microsoft.AspNetCore.Http;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 演示账号写拦截的判定逻辑，由 ExcelService 的每个写操作调用。
/// demo 用户是给 recruiter 一键体验用的（密码公开在登录页，是产品设计不是泄露）。
/// 拦截必须放在服务端门面层：只在前端置灰按钮，拦不住直接调 API 的人。
/// 判定依据是 JWT 里的用户名 claim 而不是查库——每个写请求省一次往返且无状态。
/// </summary>
public static class DemoWriteGuard
{
    public const string ReadOnlyMessage = "演示账号为只读，注册一个账号即可体验完整功能";

    public static bool IsDemo(HttpContext? httpContext) =>
        string.Equals(
            httpContext?.User.FindFirst(ClaimTypes.Name)?.Value,
            DemoAccount.Username,
            StringComparison.Ordinal);

    public static ApiResponse<T> Fail<T>() => ApiResponse<T>.Fail(ReadOnlyMessage);
}
