using ExcelToWeb.Helpers;
using Xunit;

namespace ExcelToWeb.Tests;

/// <summary>
/// PasswordHelper 密码哈希测试：PBKDF2 存储格式、校验、以及旧版 SHA256 哈希的
/// 「登录即静默升级」标记（needsRehash）。
/// </summary>
public class PasswordHelperTests
{
    [Fact]
    public void 哈希格式为版本_盐_哈希_迭代次数()
    {
        var stored = PasswordHelper.HashPassword("passw0rd");
        var parts = stored.Split('|');
        Assert.Equal(4, parts.Length);
        Assert.Equal("pbkdf2", parts[0]);
        Assert.Equal("100000", parts[3]);
    }

    [Fact]
    public void 同一密码两次哈希产生不同盐()
    {
        // 盐随机 ⇒ 两次结果不同，但都能通过校验
        var a = PasswordHelper.HashPassword("passw0rd");
        var b = PasswordHelper.HashPassword("passw0rd");
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void 正确密码校验通过且无需升级()
    {
        var stored = PasswordHelper.HashPassword("passw0rd");
        Assert.True(PasswordHelper.VerifyPassword("passw0rd", stored, out var needsRehash));
        Assert.False(needsRehash);
    }

    [Fact]
    public void 错误密码校验失败()
        => Assert.False(PasswordHelper.VerifyPassword("wrong", PasswordHelper.HashPassword("passw0rd"), out _));

    [Fact]
    public void 空密码拒绝哈希()
        => Assert.Throws<ArgumentException>(() => PasswordHelper.HashPassword(""));

    [Fact]
    public void 旧版SHA256哈希校验通过并标记待升级()
    {
        // 按旧版格式构造：盐Base64|SHA256(密码+盐Base64原文)
        var salt = Convert.ToBase64String(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 });
        var expected = Convert.ToBase64String(
            System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("oldpass" + salt)));
        var legacy = $"{salt}|{expected}";

        Assert.True(PasswordHelper.VerifyPassword("oldpass", legacy, out var needsRehash));
        Assert.True(needsRehash, "旧格式校验通过后应标记 needsRehash，由调用方重新落库升级为 PBKDF2");
    }

    [Fact]
    public void 旧版哈希错误密码不标记升级()
    {
        var salt = Convert.ToBase64String(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 });
        var expected = Convert.ToBase64String(
            System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("oldpass" + salt)));
        var legacy = $"{salt}|{expected}";

        Assert.False(PasswordHelper.VerifyPassword("nope", legacy, out var needsRehash));
        Assert.False(needsRehash);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-hash")]
    [InlineData("pbkdf2|只写了一半")]
    public void 存量数据损坏时校验失败而不抛异常(string stored)
        => Assert.False(PasswordHelper.VerifyPassword("passw0rd", stored, out _));
}
