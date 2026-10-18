using System.Text.RegularExpressions;
using ExcelToWeb.Data;
using ExcelToWeb.DTOs;
using ExcelToWeb.Helpers;
using ExcelToWeb.Models;
using ExcelToWeb.Services;
using ExcelToWeb.Services.Excel;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ITokenService _tokenService;
    private readonly RefreshTokenService _refreshTokens;
    private readonly ILogger<AuthController> _logger;
    private readonly bool _enableWindows;

    public AuthController(AppDbContext db, ITokenService tokenService,
        RefreshTokenService refreshTokens, ILogger<AuthController> logger, IConfiguration configuration)
    {
        _db = db;
        _tokenService = tokenService;
        _refreshTokens = refreshTokens;
        _logger = logger;
        _enableWindows = configuration.GetValue<bool>("Auth:EnableWindows");
    }

    /// <summary>客户端 IP（刷新令牌审计字段与会话管理页展示用）</summary>
    private string ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    /// <summary>
    /// 客户端 UA（会话管理页显示「Chrome 155 · Windows」）。
    /// 只用于展示，Service 侧会按列宽截断；请求头缺失时为空串，前端回落到「未知设备」。
    /// </summary>
    private string ClientUserAgent => Request.Headers.UserAgent.ToString();

    /// <summary>注册</summary>
    [HttpPost("register")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username))
            return BadRequest(ApiResponse.Fail("用户名不能为空"));

        if (request.Username.Length is < 3 or > 20)
            return BadRequest(ApiResponse.Fail("用户名长度必须为3-20位"));

        if (!Regex.IsMatch(request.Username, @"^[a-zA-Z0-9]+$"))
            return BadRequest(ApiResponse.Fail("用户名只能包含字母和数字"));

        if (string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(ApiResponse.Fail("密码不能为空"));

        if (request.Password.Length < 6)
            return BadRequest(ApiResponse.Fail("密码至少6位"));

        if (request.Password != request.ConfirmPassword)
            return BadRequest(ApiResponse.Fail("两次密码输入不一致"));

        var existing = await _db.Users.FirstOrDefaultAsync(u => u.Username == request.Username);
        if (existing != null)
            return BadRequest(ApiResponse.Fail("用户名已被占用"));

        var user = new User
        {
            Username = request.Username,
            PasswordHash = PasswordHelper.HashPassword(request.Password),
            CreatedAt = DateTime.UtcNow
        };

        await _db.Users.AddAsync(user);
        await _db.SaveChangesAsync();

        _logger.LogInformation("新用户注册: {Username}", request.Username);
        return Ok(ApiResponse.Ok("注册成功，请登录"));
    }

    /// <summary>登录</summary>
    [HttpPost("login")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(ApiResponse.Fail("用户名和密码不能为空"));

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == request.Username);
        var needsRehash = false;
        if (user == null || !PasswordHelper.VerifyPassword(request.Password, user.PasswordHash, out needsRehash))
            return BadRequest(ApiResponse.Fail("用户名或密码错误"));

        user.LastLoginAt = DateTime.UtcNow;

        // 旧版 SHA256 哈希校验通过后，顺手升级为 PBKDF2，用户无感知
        if (needsRehash)
        {
            user.PasswordHash = PasswordHelper.HashPassword(request.Password);
            _logger.LogInformation("已将用户 {UserId} 的密码哈希升级为 PBKDF2", user.Id);
        }

        await _db.SaveChangesAsync();

        var token = _tokenService.GenerateToken(user.Id, user.Username);
        var (refreshToken, refreshEntity) = await _refreshTokens.IssueAsync(user.Id, ClientIp, ClientUserAgent);

        _logger.LogInformation("用户登录: {Username}", user.Username);
        return Ok(ApiResponse<AuthResponse>.Ok(new AuthResponse
        {
            Id = user.Id,
            Username = user.Username,
            Token = token,
            RefreshToken = refreshToken,
            FamilyId = refreshEntity.FamilyId,
            AuthType = "local",
            HasPassword = true
        }, "登录成功"));
    }

    /// <summary>Windows 集成身份验证登录（浏览器自动协商 NTLM/Kerberos，无需输入账号密码）</summary>
    [HttpGet("windows")]
    public async Task<IActionResult> WindowsLogin()
    {
        // 未启用 Negotiate 时直接返回 404，避免在无域环境下暴露一个必然失败的端点
        if (!_enableWindows)
            return NotFound(ApiResponse.Fail("Windows 集成身份验证未启用"));

        // 手动触发协商（等价于 [Authorize(AuthenticationSchemes = Negotiate)]）：
        // 首次访问无凭据时 Challenge 返回 401，浏览器自动带 Windows 凭据重试。
        var authResult = await HttpContext.AuthenticateAsync(NegotiateDefaults.AuthenticationScheme);
        if (!authResult.Succeeded)
            return Challenge(NegotiateDefaults.AuthenticationScheme);

        // 形如 "DOMAIN\zhangsan" 或 "PC01\zhangsan"
        var windowsName = authResult.Principal?.Identity?.Name;
        if (string.IsNullOrEmpty(windowsName))
            return Unauthorized(ApiResponse.Fail("无法获取 Windows 身份"));

        // 首次访问自动建档（PasswordHash 置空，禁止走密码登录）
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == windowsName);
        if (user == null)
        {
            user = new User
            {
                Username = windowsName,
                PasswordHash = string.Empty,
                CreatedAt = DateTime.UtcNow
            };
            await _db.Users.AddAsync(user);
            _logger.LogInformation("Windows 用户自动建档: {Username}", windowsName);
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        var token = _tokenService.GenerateToken(user.Id, user.Username);
        var (refreshToken, refreshEntity) = await _refreshTokens.IssueAsync(user.Id, ClientIp, ClientUserAgent);

        _logger.LogInformation("Windows 用户登录: {Username}", windowsName);
        return Ok(ApiResponse<AuthResponse>.Ok(new AuthResponse
        {
            Id = user.Id,
            Username = windowsName.Split('\\').Last(),
            Token = token,
            RefreshToken = refreshToken,
            FamilyId = refreshEntity.FamilyId,
            AuthType = "windows",
            HasPassword = false
        }, "Windows 登录成功"));
    }

    /// <summary>获取当前用户信息</summary>
    [HttpGet("me")]
    public async Task<IActionResult> GetCurrentUser()
    {
        var userId = _tokenService.GetUserId(User);
        if (userId == null)
            return Unauthorized(ApiResponse.Fail("未登录"));

        var user = await _db.Users.FindAsync(userId.Value);
        if (user == null)
            return Unauthorized(ApiResponse.Fail("用户不存在"));

        return Ok(ApiResponse<AuthResponse>.Ok(new AuthResponse
        {
            Id = user.Id,
            Username = user.Username,
            // 设置页据此区分「本地账号密码 / Windows 集成身份验证」，空哈希即 Windows 自动建档
            AuthType = string.IsNullOrEmpty(user.PasswordHash) ? "windows" : "local",
            HasPassword = !string.IsNullOrEmpty(user.PasswordHash)
        }));
    }

    /// <summary>修改当前用户密码（需登录并校验原密码）</summary>
    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
    {
        var userId = _tokenService.GetUserId(User);
        if (userId == null)
            return Unauthorized(ApiResponse.Fail("未登录"));

        // demo 密码公开在登录页，谁都能登录它——改密接口必须拦截，否则任何人都能把
        // demo 密码改掉，演示入口（recruiter 门面）就永久失效了。
        if (DemoWriteGuard.IsDemo(HttpContext))
            return BadRequest(ApiResponse.Fail(DemoWriteGuard.ReadOnlyMessage));

        var user = await _db.Users.FindAsync(userId.Value);
        if (user == null)
            return Unauthorized(ApiResponse.Fail("用户不存在"));

        // Windows 集成身份验证自动建档的用户没有本地密码，禁止借此接口设置密码，
        // 否则等于绕过了域认证这条唯一的凭据来源。
        if (string.IsNullOrEmpty(user.PasswordHash))
            return BadRequest(ApiResponse.Fail("该账号使用 Windows 集成身份验证，不支持修改密码"));

        if (string.IsNullOrWhiteSpace(request.OldPassword))
            return BadRequest(ApiResponse.Fail("请输入原密码"));

        // 这里只做校验：无论旧哈希是什么格式，下面都会写入全新的 PBKDF2 哈希，故忽略 needsRehash
        if (!PasswordHelper.VerifyPassword(request.OldPassword, user.PasswordHash, out _))
        {
            _logger.LogWarning("修改密码失败（原密码不正确）：用户 {UserId}", user.Id);
            // 不区分「原密码错误」与其它情况之外的细节，避免提供额外信息
            return BadRequest(ApiResponse.Fail("原密码不正确"));
        }

        if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 6)
            return BadRequest(ApiResponse.Fail("新密码至少6位"));

        if (request.NewPassword != request.ConfirmPassword)
            return BadRequest(ApiResponse.Fail("两次输入的新密码不一致"));

        if (request.NewPassword == request.OldPassword)
            return BadRequest(ApiResponse.Fail("新密码不能与原密码相同"));

        user.PasswordHash = PasswordHelper.HashPassword(request.NewPassword);
        await _db.SaveChangesAsync();

        _logger.LogInformation("用户修改密码成功: {UserId}", user.Id);
        return Ok(ApiResponse.Ok("密码修改成功"));
    }

    /// <summary>
    /// 刷新令牌：access token 过期后凭 refresh token 换新对（轮换）。
    /// 匿名可访问 —— 调用方正是因为 access token 失效才来的。
    /// 已吊销令牌被重用时整族吊销（reuse detection），返回 401 需重新登录。
    /// </summary>
    [HttpPost("refresh")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Refresh([FromBody] RefreshTokenRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
            return BadRequest(ApiResponse.Fail("缺少刷新令牌"));

        var (kind, accessToken, newRefreshToken, familyId) = await _refreshTokens.RotateAsync(request.RefreshToken, ClientIp, ClientUserAgent);
        if (kind != RefreshResultKind.Success || accessToken == null || newRefreshToken == null)
        {
            // 重用与伪造同等对待：一律 401，不给攻击者试探空间；差异只体现在日志里
            return Unauthorized(ApiResponse.Fail("登录状态已失效，请重新登录"));
        }

        return Ok(ApiResponse<AuthResponse>.Ok(new AuthResponse
        {
            Token = accessToken,
            RefreshToken = newRefreshToken,
            FamilyId = familyId ?? string.Empty
        }, "刷新成功"));
    }

    /// <summary>注销：吊销当前刷新令牌所属会话族。即使前端没调，access token 短效 + 可吊销也兜底</summary>
    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout([FromBody] RefreshTokenRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.RefreshToken))
            await _refreshTokens.RevokeFamilyAsync(request.RefreshToken);

        return Ok(ApiResponse.Ok("已注销"));
    }

    /// <summary>活跃会话列表（settings 页会话管理分区）：当前未吊销且未过期的刷新令牌</summary>
    [HttpGet("sessions")]
    [Authorize]
    public async Task<IActionResult> GetSessions()
    {
        var userId = _tokenService.GetUserId(User);
        if (userId == null)
            return Unauthorized(ApiResponse.Fail("未登录"));

        var sessions = await _refreshTokens.GetActiveSessionsAsync(userId.Value);
        var loginTimes = await _refreshTokens.GetFamilyLoginTimesAsync(userId.Value);
        var items = sessions.Select(t => new
        {
            t.Id,
            t.FamilyId,
            // 「登录于」用族的真实登录时间：静默刷新会新建记录，t.CreatedAt 只是最近一次轮换时间
            CreatedAt = loginTimes.GetValueOrDefault(t.FamilyId, t.CreatedAt),
            t.ExpiresAt,
            t.CreatedByIp,
            t.CreatedByUserAgent
        });
        return Ok(ApiResponse<object>.Ok(items));
    }

    /// <summary>注销指定会话（只能注销自己的）：吊销该会话所属整族，该浏览器链上的令牌全部失效</summary>
    [HttpDelete("sessions/{id:int}")]
    [Authorize]
    public async Task<IActionResult> RevokeSession(int id)
    {
        var userId = _tokenService.GetUserId(User);
        if (userId == null)
            return Unauthorized(ApiResponse.Fail("未登录"));

        var ok = await _refreshTokens.RevokeByIdAsync(id, userId.Value);
        if (!ok)
            return NotFound(ApiResponse.Fail("会话不存在"));

        return Ok(ApiResponse.Ok("会话已注销"));
    }
}
