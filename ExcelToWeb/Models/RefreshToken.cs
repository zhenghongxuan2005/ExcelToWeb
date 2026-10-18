namespace ExcelToWeb.Models;

/// <summary>
/// 刷新令牌（落库、可吊销）。只存 SHA256 指纹，数据库泄漏也无法还原 token 本体。
/// </summary>
public class RefreshToken
{
    public int Id { get; set; }

    public int UserId { get; set; }

    /// <summary>
    /// 会话族标识：同一次登录后的整条轮换链共享同一 FamilyId。
    /// 检测到已吊销 token 被重用时按此整族吊销（RFC 6819 的 reuse detection）。
    /// </summary>
    public string FamilyId { get; set; } = string.Empty;

    /// <summary>token 的 SHA256 指纹（Hex），不存原文</summary>
    public string TokenHash { get; set; } = string.Empty;

    public DateTime ExpiresAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>签发时的客户端 IP（会话管理页展示用，也便于排查异常登录）</summary>
    public string CreatedByIp { get; set; } = string.Empty;

    /// <summary>
    /// 签发时的浏览器 UA（会话管理页显示「Chrome 155 · Windows」）。
    /// 轮换时沿用族内第一条的值，保证同一条会话链上的设备标识不漂移。
    /// </summary>
    public string CreatedByUserAgent { get; set; } = string.Empty;

    /// <summary>吊销时间；null 表示仍在使用中</summary>
    public DateTime? RevokedAt { get; set; }
}
