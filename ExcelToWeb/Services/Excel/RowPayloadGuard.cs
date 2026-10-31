using ExcelToWeb.DTOs;

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
}
