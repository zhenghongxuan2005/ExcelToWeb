using System.Text.Json;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 合并区域的存取与「解析回当前表」。
///
/// 存进库的是导入当时的坐标 + 列名；导出时列可能已经被改名、移动甚至删除，
/// 行也可能增删过，所以必须逐条校验能不能还原 —— 还原不到原位的区域一律丢弃，
/// 宁可少几个合并框，也不能框错地方。
/// </summary>
public static class MergeRangeCodec
{
    /// <summary>序列化为 MergeRangesJson；没有区域时返回 null（库里保持「无合并」）</summary>
    public static string? Serialize(List<MergeRange>? ranges)
    {
        if (ranges == null || ranges.Count == 0) return null;
        return JsonSerializer.Serialize(ranges);
    }

    /// <summary>解析 MergeRangesJson；内容损坏时当作「无合并」，不让它挡住导出</summary>
    public static List<MergeRange> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<MergeRange>();
        try
        {
            return JsonSerializer.Deserialize<List<MergeRange>>(json) ?? new List<MergeRange>();
        }
        catch (JsonException)
        {
            return new List<MergeRange>();
        }
    }

    /// <summary>
    /// 列结构变化后同步区域里记录的列名：改名的跟着改名，被删掉的列从区域里去掉；
    /// 去掉之后不足 2 列的区域直接丢弃（只剩一列谈不上合并）。
    /// 注意必须「先改名、再按 dropped 判断」—— rename 的源列本身也在被删集合里
    /// （旧名不在新表头中），顺序反了会把改过名的列误判成删除。
    /// </summary>
    public static string? Migrate(
        string? json,
        IEnumerable<(string Old, string New)> renames,
        IEnumerable<string> dropped)
    {
        var ranges = Parse(json);
        if (ranges.Count == 0) return json;

        var renameMap = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (oldName, newName) in renames) renameMap[oldName] = newName;

        var droppedSet = new HashSet<string>(dropped, StringComparer.Ordinal);
        var result = new List<MergeRange>(ranges.Count);

        foreach (var range in ranges)
        {
            var cols = new List<string>(range.Cols.Count);
            foreach (var name in range.Cols)
            {
                var current = renameMap.TryGetValue(name, out var renamed) ? renamed : name;
                if (!droppedSet.Contains(current)) cols.Add(current);
            }

            if (cols.Count < 2) continue;

            range.Cols = cols;
            result.Add(range);
        }

        return Serialize(result);
    }

    /// <summary>
    /// 解析回当前表的列序。以下情况丢弃该区域：
    ///   · 行数与导入时不一致（行增删后行号不再对齐）
    ///   · 某个列名在当前表头里找不到（列被删或被改名）
    ///   · 这些列已经不相邻（被移动过，合并会横跨中间的列）
    ///   · 区域越出当前表范围
    /// </summary>
    /// <param name="rowCount">当前数据行数（不含表头行）</param>
    public static List<MergeArea> Resolve(List<MergeRange>? ranges, List<string> headers, int rowCount)
    {
        var result = new List<MergeArea>();
        if (ranges == null || ranges.Count == 0 || headers.Count == 0) return result;

        var maxRow = rowCount + 1;   // 行 1 是表头

        foreach (var range in ranges)
        {
            if (range == null || range.Cols.Count == 0) continue;
            if (range.RowCount != rowCount) continue;
            if (range.R1 < 1 || range.R2 < range.R1 || range.R2 > maxRow) continue;

            var positions = new List<int>(range.Cols.Count);
            var missing = false;
            foreach (var name in range.Cols)
            {
                var index = headers.IndexOf(name);
                if (index < 0) { missing = true; break; }
                positions.Add(index + 1);
            }
            if (missing) continue;

            var c1 = positions.Min();
            var c2 = positions.Max();
            if (c2 - c1 + 1 != positions.Count) continue;   // 列被移开了，不再相邻

            result.Add(new MergeArea(range.R1, c1, range.R2, c2));
        }

        return result;
    }
}
