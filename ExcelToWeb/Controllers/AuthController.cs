using System.Text.RegularExpressions;
using ExcelToWeb.Data;
using ExcelToWeb.DTOs;
using ExcelToWeb.Helpers;
using ExcelToWeb.Models;
using ExcelToWeb.Services;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ITokenService _tokenService;
    private readonly ILogger<AuthController> _logger;

    public AuthController(AppDbContext db, ITokenService tokenService, ILogger<AuthController> logger)
    {
        _db = db;
        _tokenService = tokenService;
        _logger = logger;
    }

    /// <summary>注册</summary>
    [HttpPost("register")]
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
            CreatedAt = DateTime.Now
        };

        await _db.Users.AddAsync(user);
        await _db.SaveChangesAsync();

        _logger.LogInformation("新用户注册: {Username}", request.Username);
        return Ok(ApiResponse.Ok("注册成功，请登录"));
    }

    /// <summary>登录</summary>
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(ApiResponse.Fail("用户名和密码不能为空"));

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == request.Username);
        if (user == null || !PasswordHelper.VerifyPassword(request.Password, user.PasswordHash))
            return BadRequest(ApiResponse.Fail("用户名或密码错误"));

        user.LastLoginAt = DateTime.Now;
        await _db.SaveChangesAsync();

        var token = _tokenService.GenerateToken(user.Id, user.Username);

        _logger.LogInformation("用户登录: {Username}", user.Username);
        return Ok(ApiResponse<AuthResponse>.Ok(new AuthResponse
        {
            Id = user.Id,
            Username = user.Username,
            Token = token
        }, "登录成功"));
    }

    /// <summary>Windows 集成身份验证登录（浏览器自动协商 NTLM/Kerberos，无需输入账号密码）</summary>
    [HttpGet("windows")]
    [Authorize(AuthenticationSchemes = NegotiateDefaults.AuthenticationScheme)]
    public async Task<IActionResult> WindowsLogin()
    {
        // 形如 "DOMAIN\zhangsan" 或 "PC01\zhangsan"
        var windowsName = User.Identity?.Name;
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
                CreatedAt = DateTime.Now
            };
            await _db.Users.AddAsync(user);
            _logger.LogInformation("Windows 用户自动建档: {Username}", windowsName);
        }

        user.LastLoginAt = DateTime.Now;
        await _db.SaveChangesAsync();

        var token = _tokenService.GenerateToken(user.Id, user.Username);

        _logger.LogInformation("Windows 用户登录: {Username}", windowsName);
        return Ok(ApiResponse<AuthResponse>.Ok(new AuthResponse
        {
            Id = user.Id,
            Username = windowsName.Split('\\').Last(),
            Token = token
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
            Username = user.Username
        }));
    }
}
