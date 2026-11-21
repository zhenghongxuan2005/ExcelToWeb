using ExcelToWeb.Auth;
using ExcelToWeb.Caching;
using ExcelToWeb.Data;
using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using ExcelToWeb.Services;
using ExcelToWeb.Services.Excel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Controllers;

/// <summary>
/// 成员管理（RBAC）：列出账号、调整角色。
/// 整个控制器只对「管理成员」权限开放——这是权限体系里唯一能改别人权限的入口，
/// 因此也是最需要收敛的入口。
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = Permission.MemberManage)]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ITokenService _tokenService;
    private readonly AppCache _cache;
    private readonly ILogger<UsersController> _logger;

    public UsersController(
        AppDbContext db,
        ITokenService tokenService,
        AppCache cache,
        ILogger<UsersController> logger)
    {
        _db = db;
        _tokenService = tokenService;
        _cache = cache;
        _logger = logger;
    }

    /// <summary>全部账号（按注册顺序）。IsSelf 用于前端禁用「改自己角色」</summary>
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var selfId = _tokenService.GetUserId(User) ?? 0;
        var users = await _db.Users.AsNoTracking().OrderBy(u => u.Id).ToListAsync();

        var items = users.Select(u => new MemberDto
        {
            Id = u.Id,
            Username = u.Username,
            Role = u.Role.ToString(),
            RoleLabel = Rbac.Label(u.Role),
            CreatedAt = u.CreatedAt,
            LastLoginAt = u.LastLoginAt,
            IsSelf = u.Id == selfId
        }).ToList();

        return Ok(ApiResponse<List<MemberDto>>.Ok(items));
    }

    /// <summary>修改成员角色。三条硬约束：不许改自己、不许降级最后一个管理员、角色名必须合法</summary>
    [HttpPut("{id:int}/role")]
    public async Task<IActionResult> UpdateRole(int id, [FromBody] UpdateRoleRequest request)
    {
        // demo 账号的密码公开在登录页，即使被误设为管理员也不许改别人权限
        if (DemoWriteGuard.IsDemo(HttpContext))
            return BadRequest(ApiResponse.Fail(DemoWriteGuard.ReadOnlyMessage));

        if (!Rbac.TryParse(request.Role, out var next))
            return BadRequest(ApiResponse.Fail("角色不合法"));

        // 改自己等于给自己降级/提权：前者容易把唯一管理员锁在门外，后者是越权
        var selfId = _tokenService.GetUserId(User) ?? 0;
        if (id == selfId)
            return BadRequest(ApiResponse.Fail("不能修改自己的角色"));

        var user = await _db.Users.FindAsync(id);
        if (user == null)
            return NotFound(ApiResponse.Fail("成员不存在"));

        if (user.Role == next)
            return Ok(ApiResponse.Ok("角色未变化"));

        // 不变量：系统里始终至少有一名管理员。
        // 由上面「不能改自己」保证——能改别人角色的调用者本身就是管理员，
        // 而管理员不可能把自己降级，所以最后一个管理员既降不了自己、也不会被别人降
        // （否则那个「别人」也得是管理员，矛盾）。这里不再加「统计剩余管理员」的分支：
        // 那个分支永远走不到，留着只会让人误以为有额外保护。

        var previous = user.Role;
        user.Role = next;
        await _db.SaveChangesAsync();

        // 缓存失效是「降级立即生效」的真正关键：库里改了、缓存不删，接下来最多 5 分钟
        // 仍按旧角色放行。顺序也不能反——必须先提交数据库再删缓存，
        // 反过来的话删完到提交之间如果有人命中缓存，会把旧角色又写回去。
        await _cache.RemoveAsync(CacheKeys.UserRole(user.Id));

        // 权限变更属于安全事件：留一条日志，事后可追溯是谁把谁降了级
        _logger.LogInformation("成员角色变更：{UserId}（{Username}）{From} → {To}，操作人 {OperatorId}",
            user.Id, user.Username, Rbac.Label(previous), Rbac.Label(next), selfId);

        return Ok(ApiResponse.Ok($"已将 {user.Username} 设为{Rbac.Label(next)}"));
    }

    /// <summary>
    /// 预置授权账号：只建 Windows 账号（PasswordHash 留空 = 不能走密码登录），
    /// 密码账号由使用者自己注册。名单之外的人无法通过 Windows 集成认证进入系统。
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateMemberRequest request)
    {
        // demo 账号的密码公开在登录页，不允许它往授权名单里塞人
        if (DemoWriteGuard.IsDemo(HttpContext))
            return BadRequest(ApiResponse.Fail(DemoWriteGuard.ReadOnlyMessage));

        var username = (request.Username ?? string.Empty).Trim();
        if (username.Length == 0)
            return BadRequest(ApiResponse.Fail("请填写 Windows 账号"));

        if (username.Length > 128)
            return BadRequest(ApiResponse.Fail("账号名过长（最多 128 个字符）"));

        // Windows 身份形如 DOMAIN\user。不强制要求带反斜杠——单机部署、本地账号
        // 场景下 Identity.Name 可能只有用户名。但要挡住明显录错的形式：
        // 首尾反斜杠或连续反斜杠，那样的名字永远匹配不上任何身份。
        if (username.StartsWith('\\') || username.EndsWith('\\') || username.Contains(@"\\"))
            return BadRequest(ApiResponse.Fail(@"账号名格式不正确，应形如 DOMAIN\user"));

        if (!Rbac.TryParse(request.Role, out var role))
            return BadRequest(ApiResponse.Fail("角色不合法"));

        // SQL Server 默认排序规则不区分大小写，这里同样按不敏感比对，
        // 免得 DOMAIN\Zhang 和 DOMAIN\zhang 被当成两个账号分别授权
        if (await _db.Users.AnyAsync(u => u.Username == username))
            return BadRequest(ApiResponse.Fail($"账号「{username}」已存在"));

        var user = new User
        {
            Username = username,
            // 空哈希是「Windows 账号」的标记：密码校验对空哈希必然失败，
            // 所以这类账号只能由 Negotiate 带入身份，无法走密码登录
            PasswordHash = string.Empty,
            Role = role,
            CreatedAt = DateTime.UtcNow
        };
        await _db.Users.AddAsync(user);
        await _db.SaveChangesAsync();

        _logger.LogInformation("预置成员：{Username}（{Role}），操作人 {OperatorId}",
            user.Username, Rbac.Label(role), _tokenService.GetUserId(User) ?? 0);

        var dto = new MemberDto
        {
            Id = user.Id,
            Username = user.Username,
            Role = user.Role.ToString(),
            RoleLabel = Rbac.Label(user.Role),
            CreatedAt = user.CreatedAt,
            LastLoginAt = null,
            IsSelf = false
        };
        return Ok(ApiResponse<MemberDto>.Ok(dto, $"已添加「{user.Username}」"));
    }
}
