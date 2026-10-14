using ExcelToWeb.Services.Excel;
using Xunit;

namespace ExcelToWeb.Tests;

/// <summary>
/// PivotService 静态纯函数测试：聚合方式的展示文案与分组聚合值。
/// 实例方法 BuildAsync 依赖 TableRepository（数据库），不在单元测试范围——
/// 其聚合口径正是下面测到的 Format，黑盒行为由 tests/backend/pivot_test.py 守护。
/// </summary>
public class PivotServiceStaticTests
{
    private static List<Dictionary<string, object>> Rows(params Dictionary<string, object>[] rows)
        => rows.ToList();

    [Theory]
    [InlineData("sum", "求和")]
    [InlineData("count", "计数")]
    [InlineData("avg", "平均")]
    [InlineData("max", "最大值")]
    [InlineData("min", "最小值")]
    [InlineData("unknown-agg", "汇总")]   // 未知聚合兜底，不抛异常
    public void LabelOf给出聚合方式的中文文案(string agg, string expected)
        => Assert.Equal(expected, PivotService.LabelOf(agg));

    [Fact]
    public void sum聚合忽略空白与非数值单元格()
    {
        var rows = Rows(
            new Dictionary<string, object> { ["金额"] = "10" },
            new Dictionary<string, object> { ["金额"] = "2.5" },
            new Dictionary<string, object> { ["金额"] = "" },      // 空白跳过
            new Dictionary<string, object> { ["金额"] = "abc" });  // 非数值跳过

        Assert.Equal("12.5", PivotService.Format(rows, "金额", "sum"));
    }

    [Fact]
    public void avg是有效数值的平均_分母不含脏数据()
    {
        var rows = Rows(
            new Dictionary<string, object> { ["金额"] = "10" },
            new Dictionary<string, object> { ["金额"] = "20" },
            new Dictionary<string, object> { ["金额"] = "" });

        Assert.Equal("15", PivotService.Format(rows, "金额", "avg"));
    }

    [Fact]
    public void max与min取极值()
    {
        var rows = Rows(
            new Dictionary<string, object> { ["金额"] = "7" },
            new Dictionary<string, object> { ["金额"] = "3" },
            new Dictionary<string, object> { ["金额"] = "9" });

        Assert.Equal("9", PivotService.Format(rows, "金额", "max"));
        Assert.Equal("3", PivotService.Format(rows, "金额", "min"));
    }

    [Fact]
    public void count只统计该列非空的行数()
    {
        var rows = Rows(
            new Dictionary<string, object> { ["金额"] = "10" },
            new Dictionary<string, object> { ["金额"] = "abc" },   // 非数值也计数（count 不要求可算）
            new Dictionary<string, object> { ["金额"] = "" });

        Assert.Equal("2", PivotService.Format(rows, "金额", "count"));
    }

    [Fact]
    public void 空分组返回空串而不是0()
    {
        var rows = new List<Dictionary<string, object>>();
        Assert.Equal(string.Empty, PivotService.Format(rows, "金额", "sum"));
    }

    [Fact]
    public void 整组数据都不可算时返回空串()
        => Assert.Equal(string.Empty,
            PivotService.Format(Rows(new Dictionary<string, object> { ["金额"] = "abc" }), "金额", "sum"));

    [Fact]
    public void 非法聚合方式尽早暴露而不是静默给0()
    {
        var rows = Rows(new Dictionary<string, object> { ["金额"] = "1" });
        Assert.Throws<ArgumentOutOfRangeException>(() => PivotService.Format(rows, "金额", "median"));
    }

    [Fact]
    public void 输出走ExcelNumber统一格式_最多10位小数()
    {
        var rows = Rows(
            new Dictionary<string, object> { ["金额"] = "1" },
            new Dictionary<string, object> { ["金额"] = "0" });
        Assert.Equal("0.5", PivotService.Format(rows, "金额", "avg"));
    }
}
