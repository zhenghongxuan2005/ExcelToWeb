using ExcelToWeb.Models;
using ExcelToWeb.Services.Excel;
using Xunit;

namespace ExcelToWeb.Tests;

/// <summary>
/// RowValidator 单行校验与跨行唯一性测试（无参构造，零依赖）。
/// 错误文案是返回给用户看的，一并断言。
/// </summary>
public class RowValidatorTests
{
    private readonly RowValidator _validator = new();

    private static ValidationRule Rule(string column, string dataType = "text", Action<ValidationRule>? setup = null)
    {
        var rule = new ValidationRule { ColumnName = column, DataType = dataType };
        setup?.Invoke(rule);
        return rule;
    }

    private static Dictionary<string, object> Row(params (string Key, object? Value)[] cells)
    {
        var row = new Dictionary<string, object>();
        foreach (var (key, value) in cells) row[key] = value ?? string.Empty;
        return row;
    }

    /// <summary>单单元格便捷写法：Row("金额", "10")</summary>
    private static Dictionary<string, object> Row(string key, object? value) => Row((key, value));

    // ================================ ValidateRow ================================

    [Fact]
    public void 必填列为空报错()
    {
        var errors = _validator.ValidateRow(Row(("名称", "")), new[] { Rule("名称", setup: r => r.Required = true) });
        Assert.Equal(new[] { "名称 不能为空" }, errors);
    }

    [Fact]
    public void 非必填且为空不再做类型校验()
    {
        var errors = _validator.ValidateRow(Row("备注", ""), new[] { Rule("备注", "number") });
        Assert.Empty(errors);
    }

    [Fact]
    public void 行里没有该列则跳过()
    {
        var errors = _validator.ValidateRow(new Dictionary<string, object>(), new[] { Rule("名称", setup: r => r.Required = true) });
        Assert.Empty(errors);
    }

    [Fact]
    public void number类型非数字报错()
    {
        var errors = _validator.ValidateRow(Row("金额", "abc"), new[] { Rule("金额", "number") });
        Assert.Equal(new[] { "金额 必须是数字" }, errors);
    }

    [Fact]
    public void number类型越界分别报下限与上限()
    {
        var rule = Rule("金额", "number", r => { r.MinValue = 0; r.MaxValue = 100; });

        Assert.Contains("金额 不能小于 0", _validator.ValidateRow(Row("金额", "-1"), new[] { rule }));
        Assert.Contains("金额 不能大于 100", _validator.ValidateRow(Row("金额", "101"), new[] { rule }));
        Assert.Empty(_validator.ValidateRow(Row("金额", "50"), new[] { rule }));
    }

    [Fact]
    public void date类型非日期报错()
    {
        var errors = _validator.ValidateRow(Row("日期", "昨天"), new[] { Rule("日期", "date") });
        Assert.Contains("必须是日期格式", Assert.Single(errors));
        Assert.Empty(_validator.ValidateRow(Row("日期", "2026-03-05"), new[] { Rule("日期", "date") }));
    }

    [Fact]
    public void email类型必须含at与点()
    {
        var errors = _validator.ValidateRow(Row("邮箱", "benexample.com"), new[] { Rule("邮箱", "email") });
        Assert.Contains("邮箱", Assert.Single(errors));
        Assert.Empty(_validator.ValidateRow(Row("邮箱", "ben@example.com"), new[] { Rule("邮箱", "email") }));
    }

    [Fact]
    public void text类型超长报错()
    {
        var rule = Rule("备注", "text", r => r.MaxLength = 3);
        var errors = _validator.ValidateRow(Row("备注", "太长太长太长"), new[] { rule });
        Assert.Contains("长度不能超过 3", Assert.Single(errors));
    }

    [Fact]
    public void 枚举白名单外的值报错()
    {
        var rule = Rule("状态", "text", r => r.AllowedValues = "进行中, 已完成");
        var errors = _validator.ValidateRow(Row("状态", "已取消"), new[] { rule });
        Assert.Contains("必须是以下值之一", Assert.Single(errors));
        Assert.Empty(_validator.ValidateRow(Row("状态", "已完成"), new[] { rule }));
    }

    [Fact]
    public void 多条规则错误全部收集()
    {
        var rules = new[]
        {
            Rule("金额", "number"),
            Rule("邮箱", "email")
        };
        var errors = _validator.ValidateRow(Row(("金额", "abc"), ("邮箱", "bad")), rules);
        Assert.Equal(2, errors.Count);
    }

    // ================================ ValidateUniqueness ================================

    [Fact]
    public void 重复值报在第二次出现的行上并指明首次行号()
    {
        var rows = new List<Dictionary<string, object>>
        {
            Row(("编号", "A001")),
            Row(("编号", "A002")),
            Row(("编号", "A001"))
        };
        var perRow = rows.Select(_ => new List<string>()).ToArray();

        _validator.ValidateUniqueness(rows, new[] { Rule("编号", setup: r => r.Unique = true) },
            new[] { 1, 2, 3 }, perRow);

        Assert.Empty(perRow[0]);
        Assert.Empty(perRow[1]);
        var error = Assert.Single(perRow[2]);
        Assert.Contains("与第 1 行重复", error);
    }

    [Fact]
    public void 空值不参与唯一性比较()
    {
        var rows = new List<Dictionary<string, object>>
        {
            Row(("编号", "")),
            Row(("编号", ""))
        };
        var perRow = rows.Select(_ => new List<string>()).ToArray();

        _validator.ValidateUniqueness(rows, new[] { Rule("编号", setup: r => r.Unique = true) }, null, perRow);

        Assert.All(perRow, e => Assert.Empty(e));
    }

    [Fact]
    public void 未启用Unique的列不做唯一性校验()
    {
        var rows = new List<Dictionary<string, object>>
        {
            Row(("编号", "X")),
            Row(("编号", "X"))
        };
        var perRow = rows.Select(_ => new List<string>()).ToArray();

        _validator.ValidateUniqueness(rows, new[] { Rule("编号", setup: r => r.Unique = false) }, null, perRow);

        Assert.All(perRow, e => Assert.Empty(e));
    }
}
