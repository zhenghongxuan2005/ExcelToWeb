namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 计算列的「受限表达式」引擎：对外只有解析、取名、改名三个入口，求值在 FormulaEvaluator。
///
/// 为什么不用脚本引擎：表达式来自用户输入，会作用在服务端进程里。这里的做法是
/// 「自己分词（FormulaLexer）→ 自己建树（FormulaParser）→ 在白名单函数上递归下降」，
/// 全程只有自己的代码在跑，不存在把用户输入当代码执行的可能。
/// 表达式文本永不落进 C# 的编译路径，也不落任何脚本引擎。
///
/// 支持的语法（刻意保持小而非全，够用即可）：
///   · 数值、字符串（"a" 或 'a'；"a""b" 表示 a"b"）
///   · 列引用：裸名（单价）或方括号（[含空格的列名]）
///   · 运算：+ - * / &amp; 与比较 = &lt;&gt; != &lt; &lt;= &gt; &gt;=
///   · 函数：见 <see cref="Functions"/>
/// </summary>
public static class FormulaEngine
{
    /// <summary>表达式原文长度上限，防止有人往里灌一篇小说</summary>
    public const int MaxLength = 500;

    /// <summary>可用函数白名单。不在这里的一律拒绝，不做任何「自动透传」。</summary>
    public static readonly string[] Functions = { "CONCAT", "ROUND", "INT", "YEAR", "MONTH", "IF" };

    /// <summary>AST 节点数上限，挡住 a+a+a+… 的爆炸式表达式</summary>
    internal const int MaxNodes = 256;

    /// <summary>AST 嵌套深度上限</summary>
    internal const int MaxDepth = 32;

    /// <summary>函数参数个数上限</summary>
    internal const int MaxArgs = 8;

    // ================================================================
    // AST
    // ================================================================
    public enum NodeKind { Number, Text, Column, Unary, Binary, Call }

    /// <summary>表达式语法树节点。不可变，建好之后只读。</summary>
    public sealed class Node
    {
        public NodeKind Kind { get; }
        /// <summary>列名 / 文本常量 / 运算符 / 函数名，随 Kind 变化</summary>
        public string Text { get; }
        public decimal Number { get; }
        public List<Node> Args { get; }

        private Node(NodeKind kind, string text, decimal number, List<Node> args)
        {
            Kind = kind;
            Text = text;
            Number = number;
            Args = args;
        }

        public static Node OfNumber(decimal value) => new(NodeKind.Number, string.Empty, value, new List<Node>());
        public static Node OfText(string value) => new(NodeKind.Text, value, 0, new List<Node>());
        public static Node OfColumn(string name) => new(NodeKind.Column, name, 0, new List<Node>());
        public static Node OfUnary(string op, Node operand) =>
            new(NodeKind.Unary, op, 0, new List<Node> { operand });
        public static Node OfBinary(string op, Node left, Node right) =>
            new(NodeKind.Binary, op, 0, new List<Node> { left, right });
        public static Node OfCall(string name, List<Node> args) => new(NodeKind.Call, name, 0, args);
    }

    // ================================================================
    // 对外入口
    // ================================================================

    /// <summary>
    /// 解析表达式。失败时 <paramref name="error"/> 是可以直接给用户看的中文说明
    /// （这不是异常细节 —— 语法错误本来就该告诉用户哪里写错了）。
    /// </summary>
    public static bool TryParse(string source, out Node? node, out string error)
    {
        node = null;
        error = string.Empty;

        if (string.IsNullOrWhiteSpace(source))
        {
            error = "表达式不能为空";
            return false;
        }

        var text = source.Trim();
        if (text.Length > MaxLength)
        {
            error = $"表达式不能超过 {MaxLength} 个字符";
            return false;
        }

        var tokens = FormulaLexer.Tokenize(text, out error);
        if (tokens == null) return false;

        var parser = new FormulaParser(tokens);
        var root = parser.ParseExpression(0);
        if (root == null)
        {
            error = parser.Error;
            return false;
        }

        if (parser.Current.Kind != FormulaLexer.TokKind.End)
        {
            error = $"「{parser.Current.Raw}」后面多出了内容";
            return false;
        }

        node = root;
        return true;
    }

    /// <summary>收集表达式引用到的所有列名（顺序稳定、去重）</summary>
    public static List<string> CollectColumns(Node node)
    {
        var list = new List<string>();
        Walk(node, list);
        return list;
    }

    private static void Walk(Node node, List<string> into)
    {
        if (node.Kind == NodeKind.Column)
        {
            if (!into.Contains(node.Text, StringComparer.Ordinal)) into.Add(node.Text);
            return;
        }

        foreach (var arg in node.Args) Walk(arg, into);
    }

    /// <summary>
    /// 列结构变更后改写表达式里的列名：rename 换名，引用了被删列则整条公式作废。
    /// 返回 false 表示「这条公式已经无意义了」，调用方应当清掉它。
    ///
    /// 做法是记号级替换（而不是字符串替换）：只动列名记号，其余部分原样保留，
    /// 所以不会出现「列名恰好是另一个列名子串」被误改的情况。
    /// 词法失败说明存进来的东西已经不是本引擎认识的语法（只可能是我改了语法），
    /// 此时返回 true 且原样保留，宁可留着也不悄悄清空用户的东西。
    /// </summary>
    public static bool TryRenameColumns(
        string source,
        IReadOnlyDictionary<string, string> renames,
        IReadOnlyCollection<string> dropped,
        out string result)
    {
        result = source;

        var tokens = FormulaLexer.Tokenize(source, out _);
        if (tokens == null) return true;

        var sb = new System.Text.StringBuilder();
        var cursor = 0;

        for (var i = 0; i < tokens.Count; i++)
        {
            var token = tokens[i];
            if (token.Kind == FormulaLexer.TokKind.End) break;

            sb.Append(source, cursor, token.Start - cursor);
            cursor = token.Start + token.Raw.Length;

            var name = ColumnNameOf(tokens, i);
            if (name == null)
            {
                sb.Append(token.Raw);
                continue;
            }

            // 先判改名再判删除：「改名源列」必然同时出现在 dropped 里（旧名不在新列表中），
            // 顺序反了的话改名会被当成删除，公式直接作废
            if (renames.TryGetValue(name, out var renamed))
            {
                sb.Append(FormatColumnRef(renamed));
                continue;
            }

            if (dropped.Contains(name)) return false;

            sb.Append(token.Raw);
        }

        if (cursor < source.Length) sb.Append(source, cursor, source.Length - cursor);

        result = sb.ToString();
        return true;
    }

    /// <summary>把列名包成「最省字符又能被解析回来」的写法</summary>
    private static string FormatColumnRef(string name)
    {
        var bare = name.Length > 0 && FormulaLexer.IsIdentStart(name[0]) && name.All(FormulaLexer.IsIdentPart);
        // 裸名恰好和函数同名时必须加方括号，否则会被当成函数调用
        if (bare && Array.IndexOf(Functions, name.ToUpperInvariant()) < 0) return name;
        return "[" + name.Replace("]", "]]") + "]";
    }

    /// <summary>取第 i 个记号所引用的列名；不是列引用（如函数名）时返回 null</summary>
    private static string? ColumnNameOf(List<FormulaLexer.Token> tokens, int i)
    {
        var token = tokens[i];
        if (token.Kind == FormulaLexer.TokKind.Column) return token.Text;
        if (token.Kind != FormulaLexer.TokKind.Name) return null;

        var next = i + 1 < tokens.Count ? tokens[i + 1] : null;
        return next != null && next.Kind == FormulaLexer.TokKind.LParen ? null : token.Text;
    }
}
