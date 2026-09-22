using System.Globalization;
using System.Text;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 表达式求值：在 FormulaEngine 建好的语法树上递归下降。
///
/// 三条设计取舍（都跟「不骗用户」有关）：
///   1) 算不出来就如实写 Excel 风格的错误串（#VALUE! / #DIV/0! 等），
///      而不是悄悄留空 —— 留空看着像「这行本来就没值」，用户永远不会发现公式坏了。
///   2) IF 先把条件算出来再取那一支，未命中分支不参与求值。
///      否则 IF(数量>0, 金额/数量, 0) 在数量=0 时会先算出一个除零错误把整条公式带崩。
///   3) 数值一律走 ExcelNumber 的口径，跟导出写单元格完全一致。
/// </summary>
public static class FormulaEvaluator
{
    /// <summary>算不出来的值：Excel 风格的错误串，一眼能看出是公式问题而不是数据缺失</summary>
    public const string ErrorValue = "#VALUE!";
    public const string ErrorDivideByZero = "#DIV/0!";
    public const string ErrorNumber = "#NUM!";
    public const string ErrorSyntax = "#ERROR!";

    private static readonly string[] CompareOps = { "=", "<>", "<", "<=", ">", ">=" };

    /// <summary>求值并返回可直接写进单元格的文本（空串表示空）</summary>
    public static string Evaluate(FormulaEngine.Node node, Func<string, string?> lookup) =>
        Display(Eval(node, lookup));

    // ================================================================
    // 值
    // ================================================================

    /// <summary>表达式值：空白 / 数值 / 文本 / 错误，四选一。用 struct 避免逐行求值时的堆分配。</summary>
    private readonly record struct Val(decimal Number, string? Text, string? Error, bool Blank)
    {
        public static readonly Val Empty = new(0, null, null, true);

        public static Val Num(decimal n) => new(n, null, null, false);

        /// <summary>空串按「空白」算，否则 CONCAT 与四则运算的口径会不一致</summary>
        public static Val Str(string s) => s.Length == 0 ? Empty : new(0, s, null, false);

        public static Val Err(string e) => new(0, null, e, false);

        public bool IsError => Error != null;
    }

    private static Val Eval(FormulaEngine.Node node, Func<string, string?> lookup)
    {
        return node.Kind switch
        {
            FormulaEngine.NodeKind.Number => Val.Num(node.Number),
            FormulaEngine.NodeKind.Text => Val.Str(node.Text),
            FormulaEngine.NodeKind.Column => FromRaw(lookup(node.Text)),
            FormulaEngine.NodeKind.Unary => EvalUnary(node, lookup),
            FormulaEngine.NodeKind.Binary => EvalBinary(node, lookup),
            FormulaEngine.NodeKind.Call => EvalCall(node, lookup),
            _ => Val.Err(ErrorSyntax)
        };
    }

    /// <summary>单元格原文 → 表达式值。数值判定与导出写单元格共用 ExcelNumber，两边不会打架。</summary>
    private static Val FromRaw(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return Val.Empty;
        if (ExcelNumber.TryParseNumber(raw, out var number)) return Val.Num(number);
        return Val.Str(raw.Trim());
    }

    private static Val EvalUnary(FormulaEngine.Node node, Func<string, string?> lookup)
    {
        var operand = Eval(node.Args[0], lookup);
        if (operand.IsError) return operand;
        if (!TryAsNumber(operand, out var number, out var error)) return Val.Err(error!);
        return Val.Num(node.Text == "-" ? -number : number);
    }

    private static Val EvalBinary(FormulaEngine.Node node, Func<string, string?> lookup)
    {
        var left = Eval(node.Args[0], lookup);
        if (left.IsError) return left;

        var right = Eval(node.Args[1], lookup);
        if (right.IsError) return right;

        var op = node.Text;

        // & 是 Excel 的文本连接符，比 CONCAT 写起来顺手
        if (op == "&") return Val.Str(Display(left) + Display(right));

        if (Array.IndexOf(CompareOps, op) >= 0) return Val.Num(Compare(left, right, op) ? 1 : 0);

        if (!TryAsNumber(left, out var a, out var error)) return Val.Err(error!);
        if (!TryAsNumber(right, out var b, out error)) return Val.Err(error!);

        try
        {
            return op switch
            {
                "+" => Val.Num(a + b),
                "-" => Val.Num(a - b),
                "*" => Val.Num(a * b),
                // 除零在 decimal 上会抛异常，先判掉；报 #DIV/0! 与 Excel 一致
                "/" => b == 0 ? Val.Err(ErrorDivideByZero) : Val.Num(a / b),
                _ => Val.Err(ErrorSyntax)
            };
        }
        catch (OverflowException)
        {
            // decimal 溢出：宁可报 #NUM! 也不要让一个坏数静默变成别的值
            return Val.Err(ErrorNumber);
        }
    }

    private static Val EvalCall(FormulaEngine.Node node, Func<string, string?> lookup)
    {
        // IF 单独走：必须先把条件算出来再取那一支，未命中的分支不参与求值
        if (node.Text == "IF")
        {
            var condition = Eval(node.Args[0], lookup);
            if (condition.IsError) return condition;

            if (Truthy(condition)) return Eval(node.Args[1], lookup);
            return node.Args.Count > 2 ? Eval(node.Args[2], lookup) : Val.Empty;
        }

        var args = new Val[node.Args.Count];
        for (var i = 0; i < args.Length; i++)
        {
            args[i] = Eval(node.Args[i], lookup);
            if (args[i].IsError) return args[i];
        }

        switch (node.Text)
        {
            case "CONCAT":
            {
                var sb = new StringBuilder();
                foreach (var arg in args) sb.Append(Display(arg));
                return Val.Str(sb.ToString());
            }

            case "INT":
            {
                // Excel 的 INT 是向下取整（INT(-1.5) = -2），不是截断
                if (!TryAsNumber(args[0], out var n, out var error)) return Val.Err(error!);
                return TryCompute(() => Math.Floor(n));
            }

            case "ROUND":
            {
                if (!TryAsNumber(args[0], out var n, out var error)) return Val.Err(error!);

                var digits = 0;
                if (args.Length == 2)
                {
                    if (!TryAsNumber(args[1], out var raw, out error)) return Val.Err(error!);
                    // 夹到 0~10：负数位（round to tens）与超精度都会让 decimal 直接抛异常
                    digits = (int)Math.Clamp(decimal.Truncate(raw), 0m, 10m);
                }

                return TryCompute(() => Math.Round(n, digits, MidpointRounding.AwayFromZero));
            }

            case "YEAR":
            case "MONTH":
            {
                var text = Display(args[0]);
                if (!ExcelNumber.TryParseDate(text, out var date)) return Val.Err(ErrorValue);
                return Val.Num(node.Text == "YEAR" ? date.Year : date.Month);
            }

            default:
                return Val.Err(ErrorSyntax);
        }
    }

    private static Val TryCompute(Func<decimal> compute)
    {
        try
        {
            return Val.Num(compute());
        }
        catch (OverflowException)
        {
            return Val.Err(ErrorNumber);
        }
        catch (ArgumentException)
        {
            return Val.Err(ErrorNumber);
        }
    }

    // ================================================================
    // 取值 / 比较
    // ================================================================

    /// <summary>把值当数值用。空格子按 0 算（与 Excel 一致），非数值文本报 #VALUE!</summary>
    private static bool TryAsNumber(Val v, out decimal number, out string? error)
    {
        error = null;
        number = 0;

        if (v.IsError) { error = v.Error; return false; }
        if (v.Blank) return true;
        if (v.Text == null) { number = v.Number; return true; }

        if (ExcelNumber.TryParseNumber(v.Text, out number)) return true;

        error = ErrorValue;
        return false;
    }

    /// <summary>
    /// 比较：两边都是数值就用数值比，否则按文本比（忽略大小写，跟 Excel 一致）。
    /// 返回 1/0，可直接参与后续四则运算。
    /// </summary>
    private static bool Compare(Val left, Val right, string op)
    {
        int cmp;

        if (NumericLike(left) && NumericLike(right))
        {
            TryAsNumber(left, out var a, out _);
            TryAsNumber(right, out var b, out _);
            cmp = a.CompareTo(b);
        }
        else
        {
            cmp = string.Compare(Display(left), Display(right), StringComparison.OrdinalIgnoreCase);
        }

        return op switch
        {
            "=" => cmp == 0,
            "<>" => cmp != 0,
            "<" => cmp < 0,
            "<=" => cmp <= 0,
            ">" => cmp > 0,
            ">=" => cmp >= 0,
            _ => false
        };
    }

    private static bool NumericLike(Val v) => !v.Blank && v.Text == null;

    private static bool Truthy(Val v)
    {
        if (v.Blank) return false;
        return v.Text != null ? v.Text.Length > 0 : v.Number != 0;
    }

    /// <summary>值的展示形态：数值走 ExcelNumber.Format，与导出、页面显示完全一致</summary>
    private static string Display(Val v)
    {
        if (v.IsError) return v.Error!;
        if (v.Blank) return string.Empty;
        return v.Text ?? ExcelNumber.Format(v.Number);
    }
}
