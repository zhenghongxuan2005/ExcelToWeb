using System.Security.Claims;
using ExcelToWeb.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Auth;

/// <summary>一条授权要求：当前账号必须具备指定权限码</summary>
public sealed class PermissionRequirement(string permission) : IAuthorizationRequirement
{
    public string Permission { get; } = permission;
}

/// <summary>
/// 权限判定：按「当前登录用户 → 库里的角色 → 角色拥有的权限」三步判断。
///
/// 关键取舍：**权限以库为准，不读 JWT 里的角色快照**。
/// access token 默认 24 小时有效，若把角色写进令牌，管理员把某人降为只读后，
/// 对方带着旧令牌还能继续写一整天——权限收回必须是立即的，代价只是每个请求
/// 一次主键查询，且同一请求内命中 HttpContext.Items 缓存，不会重复查。
/// </summary>
public sealed class PermissionHandler : AuthorizationHandler<PermissionRequirement>
{
    /// <summary>同一请求内复用角色查询结果（一个请求可能命中多个授权要求）</summary>
    private const string CacheKey = "rbac:role";

    private readonly AppDbContext _db;

    public PermissionHandler(AppDbContext db) => _db = db;

    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        var claim = context.User.FindFirst(ClaimTypes.NameIdentifier);
        if (claim == null || !int.TryParse(claim.Value, out var userId))
            return;   // 未登录：交给 [Authorize] 的常规挑战，不在这里改结果

        var role = await ResolveRoleAsync(context.Resource as HttpContext, userId);
        if (role == null)
            return;   // 令牌里的用户已被删除：按无权限处理

        if (Rbac.Has(role.Value, requirement.Permission))
            context.Succeed(requirement);
    }

    private async Task<UserRole?> ResolveRoleAsync(HttpContext? http, int userId)
    {
        if (http != null && http.Items[CacheKey] is UserRole cached)
            return cached;

        // 投影成可空：查不到行时返回 null，不会和「默认角色」混淆
        var role = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => (UserRole?)u.Role)
            .FirstOrDefaultAsync();

        if (role != null && http != null)
            http.Items[CacheKey] = role.Value;

        return role;
    }
}
