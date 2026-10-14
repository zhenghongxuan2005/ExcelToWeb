using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;
using ExcelToWeb.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace ExcelToWeb.Tests;

/// <summary>
/// TokenService JWT 签发与 claims 测试。用内存配置构造，不起 Host。
/// </summary>
public class TokenServiceTests
{
    private static TokenService CreateService(int expireMinutes = 60)
        => new(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "unit-test-signing-key-0123456789abcdef",
                ["Jwt:Issuer"] = "ExcelToWeb",
                ["Jwt:Audience"] = "ExcelToWebClient",
                ["Jwt:ExpireMinutes"] = expireMinutes.ToString()
            })
            .Build());

    [Fact]
    public void 生成的JWT可解析且claims正确()
    {
        var token = CreateService().GenerateToken(42, "alice");
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal("42", jwt.Claims.First(c => c.Type == ClaimTypes.NameIdentifier).Value);
        Assert.Equal("alice", jwt.Claims.First(c => c.Type == ClaimTypes.Name).Value);
        Assert.False(string.IsNullOrEmpty(jwt.Claims.First(c => c.Type == JwtRegisteredClaimNames.Jti).Value));
        Assert.Equal("ExcelToWeb", jwt.Issuer);
        Assert.Equal("ExcelToWebClient", jwt.Audiences.Single());
    }

    [Fact]
    public void 过期时间取自配置()
    {
        var token = CreateService(expireMinutes: 60).GenerateToken(1, "bob");
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        var minutes = (jwt.ValidTo - DateTime.UtcNow).TotalMinutes;
        Assert.InRange(minutes, 58, 62);   // 留出签发耗时的容差
    }

    [Fact]
    public void 签名可用配置密钥验证()
    {
        const string key = "unit-test-signing-key-0123456789abcdef";
        var token = new TokenService(new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["Jwt:Key"] = key, ["Jwt:Issuer"] = "ExcelToWeb", ["Jwt:Audience"] = "ExcelToWebClient"
            }).Build()).GenerateToken(1, "bob");

        var principal = new JwtSecurityTokenHandler().ValidateToken(token, new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(key)),
            ValidIssuer = "ExcelToWeb",
            ValidAudience = "ExcelToWebClient",
            ValidateIssuer = true,
            ValidateAudience = true
        }, out _);

        Assert.Equal("1", principal.FindFirst(ClaimTypes.NameIdentifier)!.Value);
    }

    [Fact]
    public void 错误密钥验证失败()
    {
        var token = CreateService().GenerateToken(1, "bob");
        var handler = new JwtSecurityTokenHandler();

        Assert.ThrowsAny<Exception>(() => handler.ValidateToken(token, new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes("another-key-entirely-0123456789")),
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = false
        }, out _));
    }

    [Fact]
    public void GetUserId从主体取回用户编号()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, "42")
        }));

        Assert.Equal(42, CreateService().GetUserId(principal));
    }

    [Fact]
    public void 缺少编号claim时返回null()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity());
        Assert.Null(CreateService().GetUserId(principal));
    }

    [Fact]
    public void 编号claim不是数字时返回null()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, "not-a-number")
        }));

        Assert.Null(CreateService().GetUserId(principal));
    }
}
