using System.Security.Claims;
using ExcelToWeb.Caching;
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
/// 对方带着旧令牌还能继续写一整天——权限收回必须是立即的。
///
/// 代价是每个请求都要拿一次角色，所以叠了两层缓存：
///  ① <c>HttpContext.Items</c>：同一请求内命中多个授权要求时不重复查（进程内，零成本）；
///  ② <see cref="AppCache"/>：跨请求、跨副本的角色缓存，写角色时主动失效（见 UsersController）。
/// 也就是说「降级立即生效」靠的是**主动失效**而不是短 TTL：管理员点完保存，
/// 下一次请求就已经按新角色判定；TTL（5 分钟）只在这一步漏掉时兜底。
/// </summary>
public sealed class PermissionHandler : AuthorizationHandler<PermissionRequirement>
{
    /// <summary>同一请求内复用角色查询结果（一个请求可能命中多个授权要求）</summary>
    private const string RequestCacheKey = "rbac:role";

    private readonly AppDbContext _db;
    private readonly AppCache _cache;

    public PermissionHandler(AppDbContext db, AppCache cache)
    {
        _db = db;
        _cache = cache;
    }

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
        if (http != null && http.Items[RequestCacheKey] is UserRole perRequest)
            return perRequest;

        var cacheKey = CacheKeys.UserRole(userId);
        var cached = await _cache.GetAsync<CachedRole>(cacheKey);
        if (cached != null)
        {
            if (http != null) http.Items[RequestCacheKey] = cached.Role;
            return cached.Role;
        }

        // 投影成可空：查不到行时返回 null，不会和「默认角色」混淆
        var role = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => (UserRole?)u.Role)
            .FirstOrDefaultAsync();

        if (role == null)
            return null;   // 用户不存在：不写缓存，避免把「已删除」这个状态固化下来

        await _cache.SetAsync(cacheKey, new CachedRole { Role = role.Value }, CacheTtl.UserRole);

        if (http != null)
            http.Items[RequestCacheKey] = role.Value;

        return role;
    }
}
