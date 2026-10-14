using ExcelToWeb.Services.Excel;
using Xunit;

namespace ExcelToWeb.Tests;

/// <summary>
/// ExcelNumber 数值/日期口径测试。期望值迁移自 tests/backend/number_export_test.py
/// 与 tests/frontend/number_test.js——三端（求值/导出/前端）共用同一口径，这里是权威源。
/// </summary>
public class ExcelNumberTests
{
    [Theory]
    [InlineData("123", 123)]
    [InlineData("3.14", 3.14)]
    [InlineData(" 42 ", 42)]
    [InlineData("-5", -5)]
    [InlineData("1,234", 1234)]   // 千分位
    [InlineData("0.5", 0.5)]
    public void 常规数字写法可解析(string raw, decimal expected)
    {
        Assert.True(ExcelNumber.TryParseNumber(raw, out var value));
        Assert.Equal(expected, value);
    }

    [Theory]
    [InlineData("007")]        // 前导零是编号/区号，数值化会丢零
    [InlineData("0912")]
    [InlineData("abc")]
    [InlineData("")]
    [InlineData("1.2.3")]
    public void 前导零与文本拒绝数值化(string raw)
        => Assert.False(ExcelNumber.TryParseNumber(raw, out _));

    [Fact]
    public void 整数部分超15位拒绝_保护身份证号不被科学计数法破坏()
        => Assert.False(ExcelNumber.TryParseNumber("12345678901234567", out _));

    [Fact]
    public void 整数15位仍在有效范围内可解析()
        => Assert.True(ExcelNumber.TryParseNumber("123456789012345", out _));

    [Theory]
    [InlineData("2026-03-05")]
    [InlineData("2026/3/5")]
    [InlineData("2026-03-05 14:30:00")]
    [InlineData("2026-03-05T14:30:00")]
    [InlineData("2026年3月5日")]
    public void 白名单内的日期写法可解析(string raw)
    {
        Assert.True(ExcelNumber.TryParseDate(raw, out var value));
        Assert.Equal(new DateTime(2026, 3, 5), value.Date);
    }

    [Theory]
    [InlineData("3/4")]          // 宽松解析会把编号当日期——刻意用精确匹配挡掉
    [InlineData("2026-13-01")]   // 不存在的日期
    [InlineData("昨天")]
    public void 白名单外的写法不当日期(string raw)
        => Assert.False(ExcelNumber.TryParseDate(raw, out _));

    [Fact]
    public void 格式化最多10位小数且不写尾随零()
    {
        Assert.Equal("0.3333333333", ExcelNumber.Format(1m / 3m));
        Assert.Equal("2.5", ExcelNumber.Format(2.50m));
        Assert.Equal("100", ExcelNumber.Format(100m));
        Assert.Equal("0.25", ExcelNumber.Format(0.25m));
    }

    [Fact]
    public void 格式化四舍五入到10位()
        => Assert.Equal("1.2345678901", ExcelNumber.Format(1.23456789005m));

    [Fact]
    public void AsNumber便捷转换_失败返回null()
    {
        Assert.Equal(12.5m, ExcelNumber.AsNumber("12.5"));
        Assert.Null(ExcelNumber.AsNumber("abc"));
        Assert.Null(ExcelNumber.AsNumber(null));
    }
}
