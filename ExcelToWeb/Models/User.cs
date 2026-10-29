using ExcelToWeb.Auth;

namespace ExcelToWeb.Models;

/// <summary>
/// 用户实体
/// </summary>
public class User
{
    public int Id { get; set; }

    /// <summary>用户名（唯一，仅字母+数字）</summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>加密后的密码</summary>
    public string PasswordHash { get; set; } = string.Empty;

    /// <summary>
    /// 账号角色（RBAC 三档，见 <see cref="Auth.Rbac"/>）。
    /// 存字符串而不是数字：库表直接可读，插入新角色时也不会因枚举值重排而错位。
    /// </summary>
    public UserRole Role { get; set; } = UserRole.Admin;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>最后登录时间</summary>
    public DateTime? LastLoginAt { get; set; }
}
