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

    public DateTime CreatedAt { get; set; } = DateTime.Now;

    /// <summary>最后登录时间</summary>
    public DateTime? LastLoginAt { get; set; }
}
