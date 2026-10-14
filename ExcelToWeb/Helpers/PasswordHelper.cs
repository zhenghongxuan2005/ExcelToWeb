using System.Security.Cryptography;
using System.Text;

namespace ExcelToWeb.Helpers;

/// <summary>
/// 密码哈希工具（PBKDF2 / RFC2898，兼容旧版 SHA256 格式）
/// 存储格式: 版本标识|盐(Base64)|哈希(Base64)|迭代次数
/// </summary>
public static class PasswordHelper
{
    private const int SaltSize = 16;
    private const int HashSize = 32;
    private const int Iterations = 100_000;
    private const string Pbkdf2Prefix = "pbkdf2";

    public static string HashPassword(string password)
    {
        if (string.IsNullOrWhiteSpace(password))
            throw new ArgumentException("密码不能为空", nameof(password));

        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password),
            salt,
            Iterations,
            HashAlgorithmName.SHA256,
            HashSize);

        return $"{Pbkdf2Prefix}|{Convert.ToBase64String(salt)}|{Convert.ToBase64String(hash)}|{Iterations}";
    }

    /// <summary>
    /// 校验密码。needsRehash 为 true 表示该哈希是旧版 SHA256 格式且校验通过，
    /// 调用方应改用 HashPassword 重新落库，实现「登录即静默升级」。
    /// </summary>
    public static bool VerifyPassword(string password, string storedHash, out bool needsRehash)
    {
        needsRehash = false;
        if (string.IsNullOrEmpty(password) || string.IsNullOrEmpty(storedHash))
            return false;

        // 新版 PBKDF2 格式
        if (storedHash.StartsWith(Pbkdf2Prefix + "|"))
        {
            var parts = storedHash.Split('|');
            if (parts.Length != 4) return false;

            var salt = Convert.FromBase64String(parts[1]);
            var expectedHash = Convert.FromBase64String(parts[2]);
            var iterations = int.TryParse(parts[3], out var iter) ? iter : Iterations;

            var computedHash = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(password),
                salt,
                iterations,
                HashAlgorithmName.SHA256,
                HashSize);

            return CryptographicOperations.FixedTimeEquals(computedHash, expectedHash);
        }

        // 兼容旧版 SHA256 格式: 盐|哈希
        var legacyParts = storedHash.Split('|');
        if (legacyParts.Length == 2)
        {
            try
            {
                var salt = Convert.FromBase64String(legacyParts[0]);
                var expectedHash = Convert.FromBase64String(legacyParts[1]);
                var saltedPassword = Encoding.UTF8.GetBytes(password + legacyParts[0]);
                var computedHash = SHA256.HashData(saltedPassword);
                if (CryptographicOperations.FixedTimeEquals(computedHash, expectedHash))
                {
                    // 旧格式（无迭代次数、易被 GPU 爆破）校验通过，标记待升级
                    needsRehash = true;
                    return true;
                }
                return false;
            }
            catch
            {
                return false;
            }
        }

        return false;
    }
}
