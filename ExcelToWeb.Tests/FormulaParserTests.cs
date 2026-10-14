using ExcelToWeb.Services.Excel;
using Xunit;

namespace ExcelToWeb.Tests;

/// <summary>
/// FormulaParser 递归下降语法分析测试。
/// 走 FormulaEngine.TryParse 公共入口拿语法树，断言树形结构与错误文案。
/// </summary>
public class FormulaParserTests
{
    private static FormulaEngine.Node? Parse(string source, out string error)
    {
        FormulaEngine.TryParse(source, out var node, out error);
        return node;
    }

    private static FormulaEngine.Node Parsed(string source)
    {
        var node = Parse(source, out var error);
        Assert.True(node != null, $"应当解析成功，实际报错：{error}");
        return node!;
    }

    [Fact]
    public void 乘法优先级高于加法_树形是加号套乘号()
    {
        var root = Parsed("1+2*3");
        Assert.Equal(FormulaEngine.NodeKind.Binary, root.Kind);
        Assert.Equal("+", root.Text);
        Assert.Equal("*", root.Args[1].Text);
        Assert.Equal(FormulaEngine.NodeKind.Number, root.Args[1].Args[0].Kind);
    }

    [Fact]
    public void 括号改变优先级()
    {
        var root = Parsed("(1+2)*3");
        Assert.Equal("*", root.Text);
        Assert.Equal("+", root.Args[0].Text);
    }

    [Fact]
    public void 一元负号作用于操作数()
    {
        var root = Parsed("-2*3");
        Assert.Equal("*", root.Text);
        Assert.Equal(FormulaEngine.NodeKind.Unary, root.Args[0].Kind);
        Assert.Equal("-", root.Args[0].Text);
    }

    [Fact]
    public void 比较运算不允许串联_多出的部分报语法错()
    {
        var node = Parse("1<2<3", out var error);
        Assert.Null(node);
        Assert.Contains("多出了内容", error);
    }

    [Fact]
    public void 缺少右括号报错()
    {
        Parse("(1+2", out var error);
        Assert.Contains("右括号", error);
    }

    [Fact]
    public void 表达式末尾多出内容报错()
    {
        Parse("1 2", out var error);
        Assert.Contains("多出了内容", error);
    }

    [Fact]
    public void 不支持的函数被白名单拒绝()
    {
        Parse("FOO(1)", out var error);
        Assert.Contains("不支持的函数", error);
    }

    [Theory]
    [InlineData("IF(1)")]          // IF 需要 2~3 个参数
    [InlineData("INT(1,2)")]       // INT 只要 1 个
    [InlineData("ROUND(1,2,3)")]   // ROUND 要 1~2 个
    public void 函数参数个数不符报错(string source)
    {
        Parse(source, out var error);
        Assert.False(string.IsNullOrEmpty(error));
    }

    [Fact]
    public void 函数参数超过上限报错()
    {
        var source = "CONCAT(" + string.Join(",", Enumerable.Repeat("1", FormulaEngine.MaxArgs + 1)) + ")";
        Parse(source, out var error);
        Assert.Contains("参数太多", error);
    }

    [Fact]
    public void 表达式为空报错()
    {
        Parse("   ", out var error);
        Assert.Equal("表达式不能为空", error);
    }

    [Fact]
    public void 表达式超长报错()
    {
        Parse(new string('1', FormulaEngine.MaxLength + 1), out var error);
        Assert.Contains("不能超过", error);
    }

    [Fact]
    public void 节点数超限报错_挡住爆炸式表达式()
    {
        // 130 个 1 相加 = 129 个二元节点 + 130 个数字节点 > MaxNodes(256)，且总长在 MaxLength 内
        var source = string.Join("+", Enumerable.Repeat("1", 130));
        Parse(source, out var error);
        Assert.Contains("太复杂", error);
    }

    [Fact]
    public void 收集列名_去重且顺序稳定()
    {
        var root = Parsed("[b]+[a]*[b]+IF([c]>0,1,2)");
        var columns = FormulaEngine.CollectColumns(root!);
        Assert.Equal(new[] { "b", "a", "c" }, columns);
    }

    [Fact]
    public void 列改名只替换列名记号_不误伤同名子串()
    {
        // 「单价」是「历史单价」的子串——字符串替换会误改，记号级替换不会
        var ok = FormulaEngine.TryRenameColumns(
            "[历史单价]*[单价]",
            new Dictionary<string, string> { ["单价"] = "price" },
            Array.Empty<string>(),
            out var result);
        Assert.True(ok);
        Assert.Equal("[历史单价]*price", result);
    }

    [Fact]
    public void 引用被删列时整条公式作废()
    {
        var ok = FormulaEngine.TryRenameColumns(
            "[数量]*[单价]",
            new Dictionary<string, string>(),
            new[] { "单价" },
            out _);
        Assert.False(ok);
    }
}
