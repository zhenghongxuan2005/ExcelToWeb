using System.Globalization;
using System.Text;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 表达式分词（词法层）。只把字符串切成记号，不管语法对不对。
///
/// 记号里额外记了 Raw 与 Start（在原文里的位置）—— 列改名要用它们做「记号级替换」：
/// 只替换列名那一段，其余原样拼回去，所以不会出现「列名恰好是另一个列名子串」被误改。
/// </summary>
internal static class FormulaLexer
{
    internal enum TokKind { Number, Text, Column, Name, Op, LParen, RParen, Comma, End }

    internal sealed class Token
    {
        public TokKind Kind;
        /// <summary>在原文中的切片，改名重建时原样保留</summary>
        public string Raw = string.Empty;
        /// <summary>列名 / 函数名 / 运算符 / 文本值，随 Kind 变化</summary>
        public string Text = string.Empty;
        public decimal Number;
        public int Start;
    }

    /// <summary>返回 null 表示词法有错（说明在 error 里）</summary>
    internal static List<Token>? Tokenize(string source, out string error)
    {
        error = string.Empty;
        var list = new List<Token>();
        var i = 0;

        while (i < source.Length)
        {
            var c = source[i];
            if (char.IsWhiteSpace(c)) { i++; continue; }

            var start = i;

            // 数字：允许 "3" ".5" "3.14"；不接受科学计数法（它在这类表格里几乎总是笔误）
            if (char.IsDigit(c) || (c == '.' && i + 1 < source.Length && char.IsDigit(source[i + 1])))
            {
                while (i < source.Length && (char.IsDigit(source[i]) || source[i] == '.')) i++;
                var raw = source.Substring(start, i - start);
                if (!decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var value))
                {
                    error = $"「{raw}」不是合法数字";
                    return null;
                }
                list.Add(new Token { Kind = TokKind.Number, Raw = raw, Number = value, Start = start });
                continue;
            }

            if (c == '"' || c == '\'')
            {
                var text = ReadQuoted(source, ref i, c, out var closed);
                if (!closed) { error = "字符串缺少收尾引号"; return null; }
                list.Add(new Token
                {
                    Kind = TokKind.Text,
                    Raw = source.Substring(start, i - start),
                    Text = text,
                    Start = start
                });
                continue;
            }

            if (c == '[')
            {
                var name = ReadBracket(source, ref i, out var closed);
                if (!closed) { error = "列名缺少收尾的 ]"; return null; }
                if (name.Length == 0) { error = "[] 里的列名不能为空"; return null; }
                list.Add(new Token
                {
                    Kind = TokKind.Column,
                    Raw = source.Substring(start, i - start),
                    Text = name,
                    Start = start
                });
                continue;
            }

            if (IsIdentStart(c))
            {
                while (i < source.Length && IsIdentPart(source[i])) i++;
                var name = source.Substring(start, i - start);
                list.Add(new Token { Kind = TokKind.Name, Raw = name, Text = name, Start = start });
                continue;
            }

            var two = i + 1 < source.Length ? source.Substring(i, 2) : string.Empty;
            if (two is "<=" or ">=" or "<>" or "!=")
            {
                i += 2;
                list.Add(new Token
                {
                    Kind = TokKind.Op,
                    Raw = two,
                    Text = two == "!=" ? "<>" : two,   // != 归一成 <>
                    Start = start
                });
                continue;
            }

            if ("+-*/&=<>".IndexOf(c) >= 0)
            {
                i++;
                list.Add(new Token { Kind = TokKind.Op, Raw = c.ToString(), Text = c.ToString(), Start = start });
                continue;
            }

            if (c == '(') { i++; list.Add(new Token { Kind = TokKind.LParen, Raw = "(", Start = start }); continue; }
            if (c == ')') { i++; list.Add(new Token { Kind = TokKind.RParen, Raw = ")", Start = start }); continue; }

            // 全角逗号也接受：中文输入法下极容易打出来
            if (c == ',' || c == '，')
            {
                i++;
                list.Add(new Token { Kind = TokKind.Comma, Raw = c.ToString(), Start = start });
                continue;
            }

            error = $"表达式里有不认识的符号「{c}」";
            return null;
        }

        list.Add(new Token { Kind = TokKind.End, Start = source.Length });
        return list;
    }

    internal static bool IsIdentStart(char c) => char.IsLetter(c) || c == '_';

    internal static bool IsIdentPart(char c) => char.IsLetterOrDigit(c) || c == '_';

    private static string ReadQuoted(string s, ref int i, char quote, out bool closed)
    {
        closed = false;
        var sb = new StringBuilder();
        i++;

        while (i < s.Length)
        {
            var c = s[i];
            if (c == quote)
            {
                // 连写两个引号表示一个引号本身（Excel 的习惯）
                if (i + 1 < s.Length && s[i + 1] == quote) { sb.Append(quote); i += 2; continue; }
                i++;
                closed = true;
                return sb.ToString();
            }
            sb.Append(c);
            i++;
        }

        return string.Empty;
    }

    private static string ReadBracket(string s, ref int i, out bool closed)
    {
        closed = false;
        var sb = new StringBuilder();
        i++;

        while (i < s.Length)
        {
            var c = s[i];
            if (c == ']')
            {
                if (i + 1 < s.Length && s[i + 1] == ']') { sb.Append(']'); i += 2; continue; }
                i++;
                closed = true;
                return sb.ToString().Trim();
            }
            sb.Append(c);
            i++;
        }

        return string.Empty;
    }
}
