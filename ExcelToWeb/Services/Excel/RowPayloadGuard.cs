using ExcelToWeb.DTOs;
using System.Text.Json;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 整表保存的入参守门：拒绝「没有行的整表覆盖」与「表格里不存在的列」。
///
/// 为什么需要单独守一道：保存接口的语义是**整表替换**（先删光再批量插），
/// 所以任何一次「客户端没准备好」的情况都会变成真实的数据损失，而接口本身
/// 会老老实实返回 200「成功保存 N 条」——事后连「是不是点错了」都判断不出来。
///
/// 两道闸：
///   · 空行集：一个 <c>rows: []</c> 就能把整张表清空。用户在界面上点「清空全部」
///     再保存是合法诉求，所以留了 allowEmpty；除此之外一律拒绝。
///   · 列名白名单：只接受当前 headers（外加计算列——客户端回传时带着它们，
///     落库前会由 ComputedColumnService.Strip 抹掉）。未知列一律拒绝而不是静默丢弃：
///     静默丢弃等于「客户端以为存了、库里没有」，与幽灵数据是同一个后果，
///     而且连报错都没有，排查时只能对着两份数据逐字段比对。
/// </summary>
public static class RowPayloadGuard
{
    /// <summary>错误文案里最多点名几个列：一屏全是不存在的列没有信息量，反而看不清</summary>
    private const int MaxNamedColumns = 3;

    /// <summary>
    /// 行主键在传输层的键名（库里是 <c>DynamicRow.Id</c>，但它不是数据列，不进 DataJson）。
    ///
    /// 为什么要把它带到前端：保存是**整表替换**，服务端必须知道「客户端这一行原来是哪一行」，
    /// 才能把计算列在库里的历史原值补回去。只按行下标对是不行的 —— 前端可以增删行，
    /// 下标一错位就会把 A 行的数据写到 B 行，属于静默错位，比留空更难查。
    ///
    /// 以双下划线开头：Excel 表头里几乎不可能出现，且与用户自己的列名不会撞。
    /// </summary>
    public const string RowIdKey = "__rid";

    /// <summary>
    /// 校验通过返回 null；不通过返回**可以直接展示给用户**的原因。
    /// 文案要能被非程序员看懂，并指向真实原因（列被改名/删除 → 刷新）。
    /// </summary>
    public static string? Validate(
        IReadOnlyList<string> headers,
        Dictionary<string, ColumnMetaDto>? meta,
        List<Dictionary<string, object>>? rows,
        bool allowEmpty)
    {
        if (rows == null || rows.Count == 0)
        {
            return allowEmpty
                ? null
                : "这次请求没有任何数据行。若确实要清空整张表，请在确认后重试";
        }

        var allowed = new HashSet<string>(headers, StringComparer.Ordinal);
        // 行主键是传输层元信息（见 RowIdKey），不是数据列，白名单要放行
        allowed.Add(RowIdKey);
        // 计算列不在 headers 里（值不落库、按公式实时算），但客户端保存时会把
        // 它们算出来的值一起回传，得先放行，Strip 随后再抹掉
        foreach (var name in ComputedColumnService.ComputedNames(meta)) allowed.Add(name);

        var unknown = new List<string>();
        var firstRow = 0;

        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            if (row == null)
                return $"第 {i + 1} 行是空对象，请刷新后重试";

            foreach (var key in row.Keys)
            {
                if (allowed.Contains(key) || unknown.Contains(key)) continue;
                if (unknown.Count == 0) firstRow = i + 1;
                unknown.Add(key);
                // 多收一个就够判断「还有更多」，不必扫完整表
                if (unknown.Count > MaxNamedColumns) break;
            }

            if (unknown.Count > MaxNamedColumns) break;
        }

        return unknown.Count == 0 ? null : Describe(unknown, firstRow);
    }

    private static string Describe(List<string> unknown, int firstRow)
    {
        var shown = string.Join("、", unknown.Take(MaxNamedColumns).Select(name => $"「{name}」"));
        var more = unknown.Count > MaxNamedColumns ? " 等" : string.Empty;
        return $"第 {firstRow} 行有表格里不存在的列 {shown}{more}。" +
               "列结构可能已在其它页面被改名或删除，请刷新后重试";
    }

    /// <summary>
    /// 取某行的行主键；没有（新增行）或格式不对返回 null。
    /// 客户端回传的数字经 JSON 反序列化后可能是 int / long / double / JsonElement，
    /// 前端直接拼出来的也可能是字符串 —— 都要认，否则「偶尔匹配不到」极难排查。
    /// </summary>
    public static int? RowIdOf(Dictionary<string, object> row)
    {
        if (row == null || !row.TryGetValue(RowIdKey, out var value) || value == null) return null;

        switch (value)
        {
            case int i: return i > 0 ? i : null;
            case long l: return l > 0 && l <= int.MaxValue ? (int)l : null;
            case double d: return d > 0 && d <= int.MaxValue ? (int)d : null;
            case JsonElement e when e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var n): return n;
            case string s when int.TryParse(s, out var p): return p;
            default: return null;
        }
    }

    /// <summary>落库前移除行主键：它是保存路径匹配用的元信息，不该写进 DataJson</summary>
    public static void RemoveRowId(List<Dictionary<string, object>>? rows)
    {
        if (rows == null) return;
        foreach (var row in rows) row?.Remove(RowIdKey);
    }

    /// <summary>
    /// 下发数据前的统一收尾：把行主键按顺序写回每一行。
    ///
    /// 顺序来自「按 Id 升序查询」，与刚插入的行数组一致（identity 单调递增）。
    /// 数量对不上就一条都不写 —— 错位的主键比没有主键危险得多：
    /// 没有主键只是「这行没历史原值」，错位主键会把别的行的数据搬过来。
    /// </summary>
    /// <returns>是否真的写回了（数量不一致时返回 false，调用方可以记日志）</returns>
    public static bool AttachRowIds(IReadOnlyList<int>? ids, List<Dictionary<string, object>>? rows)
    {
        if (ids == null || rows == null || ids.Count != rows.Count) return false;

        for (var i = 0; i < rows.Count; i++) rows[i][RowIdKey] = ids[i];
        return true;
    }
}
