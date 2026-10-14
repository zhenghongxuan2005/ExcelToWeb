using System.Security.Cryptography;
using ExcelToWeb.Data;
using ExcelToWeb.Models;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Services;

/// <summary>刷新结果分类：控制器据此返回不同的 401 文案，日志按风险分级</summary>
public enum RefreshResultKind
{
    Success,
    /// <summary>指纹不存在（伪造 / 已被清理）</summary>
    Invalid,
    /// <summary>令牌自然过期</summary>
    Expired,
    /// <summary>已吊销令牌被再次使用 —— 疑似被盗，整族已吊销</summary>
    ReuseDetected
}

/// <summary>
/// 刷新令牌的签发 / 轮换 / 吊销。
/// 核心安全策略（RFC 6819 推荐）：
///   1. 轮换 —— 每次 refresh 都吊销旧令牌、签发新对，令牌被偷也只会存活一个周期；
///   2. 重用检测 —— 已吊销的令牌再次出现 = 会话可能被盗，立即吊销整族让攻击者与受害者同时下线。
/// 服务端只存 SHA256 指纹，原文仅在签发时返回一次。
/// </summary>
public class RefreshTokenService
{
    private readonly AppDbContext _db;
    private readonly ITokenService _tokenService;
    private readonly ILogger<RefreshTokenService> _logger;

    /// <summary>刷新令牌有效期（天）—— 远长于 access token，但可随时吊销</summary>
    private const int RefreshExpireDays = 7;

    public RefreshTokenService(AppDbContext db, ITokenService tokenService, ILogger<RefreshTokenService> logger)
    {
        _db = db;
        _tokenService = tokenService;
        _logger = logger;
    }

    /// <summary>登录成功后签发：开启一条新的会话族</summary>
    public async Task<(string RawToken, RefreshToken Entity)> IssueAsync(int userId, string ip)
    {
        var (raw, hash) = NewToken();
        var entity = new RefreshToken
        {
            UserId = userId,
            FamilyId = Guid.NewGuid().ToString("N"),
            TokenHash = hash,
            ExpiresAt = DateTime.UtcNow.AddDays(RefreshExpireDays),
            CreatedByIp = ip
        };
        _db.RefreshTokens.Add(entity);
        await _db.SaveChangesAsync();
        return (raw, entity);
    }

    /// <summary>
    /// 轮换：验证旧令牌 → 吊销 → 签发新 access + 新 refresh（同族）。
    /// 检测到重用时整族吊销并返回 ReuseDetected。
    /// FamilyId 随新对下发，前端用于在会话列表里标记「当前会话」。
    /// </summary>
    public async Task<(RefreshResultKind Kind, string? AccessToken, string? NewRefreshToken, string? FamilyId)> RotateAsync(string rawToken, string ip)
    {
        var stored = await _db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == Hash(rawToken));
        if (stored == null)
            return (RefreshResultKind.Invalid, null, null, null);

        if (stored.RevokedAt != null)
        {
            // 重用检测：整族一起吊销。攻击者与受害者共享同一族，任何一方再刷新都会触发到这里
            await _db.RefreshTokens
                .Where(t => t.FamilyId == stored.FamilyId && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow));
            _logger.LogWarning("检测到刷新令牌重用（用户 {UserId}，族 {FamilyId}），整族会话已吊销",
                stored.UserId, stored.FamilyId);
            return (RefreshResultKind.ReuseDetected, null, null, null);
        }

        if (stored.ExpiresAt <= DateTime.UtcNow)
            return (RefreshResultKind.Expired, null, null, null);

        var username = await _db.Users
            .Where(u => u.Id == stored.UserId)
            .Select(u => u.Username)
            .FirstOrDefaultAsync();
        if (username == null)
            return (RefreshResultKind.Invalid, null, null, null);

        // 并发兜底：吊销带上 RevokedAt IS NULL 条件，抢到的那个请求才允许轮换。
        // 影响 0 行 = 同一令牌已被并发请求抢先吊销，语义等同「已吊销令牌被使用」，按重用检测整族吊销。
        var revoked = await _db.RefreshTokens
            .Where(t => t.Id == stored.Id && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow));
        if (revoked == 0)
        {
            await _db.RefreshTokens
                .Where(t => t.FamilyId == stored.FamilyId && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow));
            _logger.LogWarning("刷新令牌并发轮换冲突（用户 {UserId}，族 {FamilyId}），按重用处理：整族已吊销",
                stored.UserId, stored.FamilyId);
            return (RefreshResultKind.ReuseDetected, null, null, null);
        }

        var (newRaw, newHash) = NewToken();
        var fresh = new RefreshToken
        {
            UserId = stored.UserId,
            FamilyId = stored.FamilyId,
            TokenHash = newHash,
            ExpiresAt = DateTime.UtcNow.AddDays(RefreshExpireDays),
            CreatedByIp = ip
        };
        _db.RefreshTokens.Add(fresh);
        await _db.SaveChangesAsync();

        return (RefreshResultKind.Success, _tokenService.GenerateToken(stored.UserId, username), newRaw, fresh.FamilyId);
    }

    /// <summary>注销指定会话（只能注销自己的）：吊销该会话所属整族。找不到或不属于该用户返回 false</summary>
    public async Task<bool> RevokeByIdAsync(int sessionId, int userId)
    {
        var stored = await _db.RefreshTokens
            .FirstOrDefaultAsync(t => t.Id == sessionId && t.UserId == userId);
        if (stored == null) return false;

        await _db.RefreshTokens
            .Where(t => t.FamilyId == stored.FamilyId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow));
        _logger.LogInformation("用户 {UserId} 注销会话 #{SessionId}（族 {FamilyId}）", userId, sessionId, stored.FamilyId);
        return true;
    }

    /// <summary>注销：吊销该令牌所属整族（= 结束这条会话链上的全部活跃令牌）</summary>
    public async Task RevokeFamilyAsync(string rawToken)
    {
        var stored = await _db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == Hash(rawToken));
        if (stored == null) return;

        await _db.RefreshTokens
            .Where(t => t.FamilyId == stored.FamilyId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTime.UtcNow));
        _logger.LogInformation("用户 {UserId} 注销会话（族 {FamilyId}）", stored.UserId, stored.FamilyId);
    }

    /// <summary>会话管理页：该用户当前仍活跃（未吊销且未过期）的令牌，按签发时间倒序</summary>
    public Task<List<RefreshToken>> GetActiveSessionsAsync(int userId) =>
        _db.RefreshTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null && t.ExpiresAt > DateTime.UtcNow)
            .OrderByDescending(t => t.CreatedAt)
            .ToListAsync();

    /// <summary>
    /// 会话列表用：族的真实登录时间（族内最早一条记录的创建时间）。
    /// 静默刷新轮换会不断新建记录，最新记录的 CreatedAt 只是「最近一次轮换时间」，
    /// 族首条记录才是用户真正点下「登录」的那一刻。
    /// </summary>
    public Task<Dictionary<string, DateTime>> GetFamilyLoginTimesAsync(int userId) =>
        _db.RefreshTokens
            .Where(t => t.UserId == userId)
            .GroupBy(t => t.FamilyId)
            .Select(g => new { g.Key, StartedAt = g.Min(t => t.CreatedAt) })
            .ToDictionaryAsync(g => g.Key, g => g.StartedAt);

    /// <summary>生成新令牌：32 字节随机数转 64 字符 Hex。返回原文与指纹，原文只下发一次</summary>
    private static (string Raw, string Hash) NewToken()
    {
        var raw = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        return (raw, Hash(raw));
    }

    private static string Hash(string raw) =>
        Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(raw)));
}
