using ExcelToWeb.Services.Excel;
using Xunit;

namespace ExcelToWeb.Tests;

/// <summary>
/// FormulaEvaluator 求值测试。期望值迁移自 tests/backend/formula_test.py 的黑盒断言，
/// 这里在纯函数层直接验证（无需起服务）。
/// </summary>
public class FormulaEvaluatorTests
{
    /// <summary>把「列名 → 单元格原文」字典变成求值环境</summary>
    private static string Eval(string source, Dictionary<string, string>? cells = null)
    {
        Assert.True(FormulaEngine.TryParse(source, out var node, out var error),
            $"表达式应当解析成功：{source}，实际报错：{error}");
        return FormulaEvaluator.Evaluate(node!, name => cells != null && cells.TryGetValue(name, out var v) ? v : null);
    }

    [Theory]
    [InlineData("1+2*3", "7")]
    [InlineData("(1+2)*3", "9")]
    [InlineData("10/4", "2.5")]
    [InlineData("2-3-4", "-5")]          // 左结合
    [InlineData("0.1+0.2", "0.3")]       // decimal 无浮点误差
    public void 四则运算(string source, string expected) => Assert.Equal(expected, Eval(source));

    [Fact]
    public void 除零返回Excel风格的DIV0错误() => Assert.Equal("#DIV/0!", Eval("1/0"));

    [Fact]
    public void 文本连接符()
    {
        Assert.Equal("a1", Eval("\"a\"&1"));
        Assert.Equal("合计100", Eval("\"合计\"&[金额]", new() { ["金额"] = "100" }));
    }

    [Fact]
    public void 数值比较返回1或0()
    {
        Assert.Equal("1", Eval("1<2"));
        Assert.Equal("0", Eval("2<=1"));
        Assert.Equal("1", Eval("3<>4"));
    }

    [Fact]
    public void 文本比较忽略大小写_与Excel一致()
        => Assert.Equal("1", Eval("\"ABC\"=\"abc\""));

    [Fact]
    public void 列引用按ExcelNumber口径解析()
        => Assert.Equal("24", Eval("[单价]*[数量]", new() { ["单价"] = "8", ["数量"] = "3" }));

    [Fact]
    public void 空格子按0参与运算_与Excel一致()
        => Assert.Equal("1", Eval("[空列]+1", new() { ["空列"] = "" }));

    [Fact]
    public void 非数值文本参与四则报VALUE错()
        => Assert.Equal("#VALUE!", Eval("[名称]*2", new() { ["名称"] = "苹果" }));

    [Fact]
    public void 错误在表达式里传播()
        => Assert.Equal("#DIV/0!", Eval("(1/0)+1"));

    [Fact]
    public void IF先算条件再取分支_未命中分支不求值()
    {
        // 若 IF 的两个分支都先求值，10/[数量] 会在数量=0 时先算出 #DIV/0! 带崩整条公式
        Assert.Equal("0", Eval("IF([数量]>0, 10/[数量], 0)", new() { ["数量"] = "0" }));
        Assert.Equal("5", Eval("IF([数量]>0, 10/[数量], 0)", new() { ["数量"] = "2" }));
    }

    [Fact]
    public void IF缺省第三参数_条件为假返回空白()
        => Assert.Equal("", Eval("IF(1>2, \"是\")"));

    [Fact]
    public void INT是向下取整_不是截断()
    {
        Assert.Equal("-2", Eval("INT(-1.5)"));
        Assert.Equal("3", Eval("INT(3.9)"));
    }

    [Fact]
    public void ROUND远离零舍入_可指定小数位()
    {
        Assert.Equal("3", Eval("ROUND(2.5)"));
        Assert.Equal("2.35", Eval("ROUND(2.345, 2)"));
    }

    [Fact]
    public void YEAR与MONTH从日期文本取年份月份()
    {
        var cells = new Dictionary<string, string> { ["日期"] = "2026-03-05" };
        Assert.Equal("2026", Eval("YEAR([日期])", cells));
        Assert.Equal("3", Eval("MONTH([日期])", cells));
    }

    [Fact]
    public void YEAR遇到非日期报VALUE错()
        => Assert.Equal("#VALUE!", Eval("YEAR([名称])", new() { ["名称"] = "苹果" }));

    [Fact]
    public void 求值结果走ExcelNumber统一格式()
        => Assert.Equal("0.3333333333", Eval("1/3"));
}
