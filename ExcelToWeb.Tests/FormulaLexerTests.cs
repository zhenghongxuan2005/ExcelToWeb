using ExcelToWeb.Services.Excel;
using Xunit;

namespace ExcelToWeb.Tests;

/// <summary>
/// FormulaLexer 分词单元测试（internal 类，经 InternalsVisibleTo 访问）。
/// 覆盖：数字 / 字符串 / 列引用 / 运算符 / 逗号的识别，以及四类词法错误。
/// </summary>
public class FormulaLexerTests
{
    private static List<FormulaLexer.Token> Ok(string source)
    {
        var tokens = FormulaLexer.Tokenize(source, out var error);
        Assert.True(tokens != null, $"应当分词成功，实际报错：{error}");
        return tokens!;
    }

    private static string Fail(string source)
    {
        var tokens = FormulaLexer.Tokenize(source, out var error);
        Assert.Null(tokens);
        return error;
    }

    [Theory]
    [InlineData("3", 3)]
    [InlineData("3.14", 3.14)]
    [InlineData(".5", 0.5)]
    public void 数字被识别为Number记号(string source, decimal expected)
    {
        var tokens = Ok(source);
        Assert.Equal(FormulaLexer.TokKind.Number, tokens[0].Kind);
        Assert.Equal(expected, tokens[0].Number);
    }

    [Fact]
    public void 双字符运算符被识别且不等于号归一为尖括号()
    {
        var tokens = Ok("a<=b>=c<>d!=e");
        var ops = tokens.Where(t => t.Kind == FormulaLexer.TokKind.Op).ToList();
        Assert.Equal(new[] { "<=", ">=", "<>", "<>" }, ops.Select(o => o.Text));
    }

    [Fact]
    public void 单字符运算符与括号逗号各归各类()
    {
        var tokens = Ok("+-*/&=<>(),，");
        var kinds = tokens.Select(t => t.Kind).ToList();
        Assert.Contains(FormulaLexer.TokKind.LParen, kinds);
        Assert.Contains(FormulaLexer.TokKind.RParen, kinds);
        // 全角逗号（中文输入法）也应识别为 Comma
        Assert.Equal(2, kinds.Count(k => k == FormulaLexer.TokKind.Comma));
    }

    [Fact]
    public void 双引号字符串与引号转义()
    {
        var tokens = Ok("\"a\"\"b\"");
        Assert.Equal(FormulaLexer.TokKind.Text, tokens[0].Kind);
        Assert.Equal("a\"b", tokens[0].Text);
    }

    [Fact]
    public void 方括号列引用保留内部空格并支持右括号转义()
    {
        var tokens = Ok("[单价 总额]");
        Assert.Equal(FormulaLexer.TokKind.Column, tokens[0].Kind);
        Assert.Equal("单价 总额", tokens[0].Text);

        var escaped = Ok("[a]]b]");
        Assert.Equal("a]b", escaped[0].Text);
    }

    [Fact]
    public void 裸标识符识别为Name记号()
    {
        var tokens = Ok("单价_1 *2");
        Assert.Equal(FormulaLexer.TokKind.Name, tokens[0].Kind);
        Assert.Equal("单价_1", tokens[0].Text);
    }

    [Fact]
    public void 分词结束后追加End记号且Start指向原文末尾()
    {
        const string source = "1+1";
        var tokens = Ok(source);
        var end = tokens[^1];
        Assert.Equal(FormulaLexer.TokKind.End, end.Kind);
        Assert.Equal(source.Length, end.Start);
    }

    [Fact]
    public void 记号记录原文起始位置()
    {
        var tokens = Ok(" 12+3");
        Assert.Equal(1, tokens[0].Start);
        Assert.Equal(3, tokens[1].Start);
    }

    [Fact]
    public void 非法字符报错并写明符号()
    {
        var error = Fail("1 + ￥");
        Assert.Contains("￥", error);
    }

    [Fact]
    public void 字符串缺少收尾引号报错() => Assert.Contains("引号", Fail("\"abc"));

    [Fact]
    public void 列名缺少收尾中括号报错() => Assert.Contains("]", Fail("[abc"));

    [Fact]
    public void 空列名报错() => Assert.Contains("不能为空", Fail("[]"));
}
