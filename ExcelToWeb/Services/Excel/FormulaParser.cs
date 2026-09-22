namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 表达式语法分析（递归下降）。
///
/// 优先级从低到高：比较 → & → + - → * / → 一元正负 → 基本项。
/// 比较刻意不允许串联（a &lt; b &lt; c 没有明确含义），多出来的一律当语法错报给用户。
/// 节点数与嵌套深度都设了上限，挡住「a+a+a+…」这类把求值拖死的输入。
/// </summary>
internal sealed class FormulaParser
{
    private static readonly string[] CompareOps = { "=", "<>", "<", "<=", ">", ">=" };
    private static readonly string[] ConcatOps = { "&" };
    private static readonly string[] AddOps = { "+", "-" };
    private static readonly string[] MulOps = { "*", "/" };

    private readonly List<FormulaLexer.Token> _tokens;
    private int _pos;
    private int _nodes;

    internal string Error = string.Empty;

    internal FormulaParser(List<FormulaLexer.Token> tokens) => _tokens = tokens;

    /// <summary>当前记号（解析结束后用来看有没有剩余内容）</summary>
    internal FormulaLexer.Token Current => _pos < _tokens.Count ? _tokens[_pos] : _tokens[^1];

    internal FormulaEngine.Node? ParseExpression(int depth)
    {
        if (depth > FormulaEngine.MaxDepth)
        {
            Error = $"表达式嵌套太深（上限 {FormulaEngine.MaxDepth} 层）";
            return null;
        }
        return ParseCompare(depth);
    }

    private bool IsOp(string op) => Current.Kind == FormulaLexer.TokKind.Op && Current.Text == op;

    private FormulaEngine.Node? ParseCompare(int depth)
    {
        var left = ParseConcat(depth);
        if (left == null) return null;

        if (Current.Kind == FormulaLexer.TokKind.Op && Array.IndexOf(CompareOps, Current.Text) >= 0)
        {
            var op = Current.Text;
            _pos++;
            var right = ParseConcat(depth);
            if (right == null) return null;
            return Add(FormulaEngine.Node.OfBinary(op, left, right));
        }

        return left;
    }

    private FormulaEngine.Node? ParseConcat(int depth) => ParseBinaryLevel(depth, ConcatOps, ParseAdd);

    private FormulaEngine.Node? ParseAdd(int depth) => ParseBinaryLevel(depth, AddOps, ParseMul);

    private FormulaEngine.Node? ParseMul(int depth) => ParseBinaryLevel(depth, MulOps, ParseUnary);

    private FormulaEngine.Node? ParseBinaryLevel(
        int depth, string[] ops, Func<int, FormulaEngine.Node?> next)
    {
        var left = next(depth);
        if (left == null) return null;

        while (Current.Kind == FormulaLexer.TokKind.Op && Array.IndexOf(ops, Current.Text) >= 0)
        {
            var op = Current.Text;
            _pos++;

            var right = next(depth);
            if (right == null) return null;

            var combined = Add(FormulaEngine.Node.OfBinary(op, left, right));
            if (combined == null) return null;
            left = combined;
        }

        return left;
    }

    private FormulaEngine.Node? ParseUnary(int depth)
    {
        if (depth > FormulaEngine.MaxDepth)
        {
            Error = $"表达式嵌套太深（上限 {FormulaEngine.MaxDepth} 层）";
            return null;
        }

        if (IsOp("-") || IsOp("+"))
        {
            var op = Current.Text;
            _pos++;
            var operand = ParseUnary(depth + 1);
            if (operand == null) return null;
            return Add(FormulaEngine.Node.OfUnary(op, operand));
        }

        return ParsePrimary(depth);
    }

    private FormulaEngine.Node? ParsePrimary(int depth)
    {
        var token = Current;

        switch (token.Kind)
        {
            case FormulaLexer.TokKind.Number:
                _pos++;
                return Add(FormulaEngine.Node.OfNumber(token.Number));

            case FormulaLexer.TokKind.Text:
                _pos++;
                return Add(FormulaEngine.Node.OfText(token.Text));

            case FormulaLexer.TokKind.Column:
                _pos++;
                return Add(FormulaEngine.Node.OfColumn(token.Text));

            case FormulaLexer.TokKind.Name:
                _pos++;
                return Current.Kind == FormulaLexer.TokKind.LParen
                    ? ParseCall(token.Text, depth)
                    : Add(FormulaEngine.Node.OfColumn(token.Text));

            case FormulaLexer.TokKind.LParen:
            {
                _pos++;
                var inner = ParseExpression(depth + 1);
                if (inner == null) return null;
                if (Current.Kind != FormulaLexer.TokKind.RParen) { Error = "缺少右括号"; return null; }
                _pos++;
                return inner;
            }

            default:
                Error = token.Kind == FormulaLexer.TokKind.End
                    ? "表达式不完整"
                    : $"「{token.Raw}」的位置不对";
                return null;
        }
    }

    private FormulaEngine.Node? ParseCall(string name, int depth)
    {
        var upper = name.ToUpperInvariant();
        if (Array.IndexOf(FormulaEngine.Functions, upper) < 0)
        {
            Error = $"不支持的函数「{name}」，可用：{string.Join("、", FormulaEngine.Functions)}";
            return null;
        }

        _pos++;   // 吃掉 (
        var args = new List<FormulaEngine.Node>();

        if (Current.Kind == FormulaLexer.TokKind.RParen)
        {
            _pos++;
        }
        else
        {
            while (true)
            {
                if (args.Count >= FormulaEngine.MaxArgs)
                {
                    Error = $"{upper} 的参数太多（上限 {FormulaEngine.MaxArgs} 个）";
                    return null;
                }

                var arg = ParseExpression(depth + 1);
                if (arg == null) return null;
                args.Add(arg);

                if (Current.Kind == FormulaLexer.TokKind.Comma) { _pos++; continue; }
                if (Current.Kind == FormulaLexer.TokKind.RParen) { _pos++; break; }

                Error = $"{upper} 的参数之间要用逗号分开，或缺少右括号";
                return null;
            }
        }

        var arityError = ArityError(upper, args.Count);
        if (arityError != null)
        {
            Error = arityError;
            return null;
        }

        return Add(FormulaEngine.Node.OfCall(upper, args));
    }

    /// <summary>节点数超限返回 null（错误已写进 Error），调用方据此中断</summary>
    private FormulaEngine.Node? Add(FormulaEngine.Node node)
    {
        if (++_nodes > FormulaEngine.MaxNodes)
        {
            Error = $"表达式太复杂（最多 {FormulaEngine.MaxNodes} 个运算）";
            return null;
        }
        return node;
    }

    private static string? ArityError(string name, int count) => name switch
    {
        "CONCAT" => count >= 1 ? null : "CONCAT 至少要 1 个参数",
        "ROUND" => count is 1 or 2 ? null : "ROUND 需要 1~2 个参数",
        "INT" => count == 1 ? null : "INT 需要 1 个参数",
        "YEAR" => count == 1 ? null : "YEAR 需要 1 个参数",
        "MONTH" => count == 1 ? null : "MONTH 需要 1 个参数",
        "IF" => count is 2 or 3 ? null : "IF 需要 2~3 个参数",
        _ => null
    };
}
