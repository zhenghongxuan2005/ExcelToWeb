using ExcelToWeb.DTOs;
using ExcelToWeb.Models;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 透视汇总的**唯一一份**计算：按行字段分组、列字段展开、对值字段聚合。
/// 页面上的预览与导出的 xlsx 都来自这里 —— 两份实现迟早会在某天算出不同数字，
/// 而「预览和导出对不上」是最伤信任的一类问题，所以宁可只留一份。
///
/// 口径：
///   · 空单元格不参与分组、也不计入 count（与 Excel 一致：空白不生成「空白」那一组）
///   · sum / avg / max / min 要求值字段整列都可数值化（判定走 ExcelNumber，与导出写
///     单元格同一套）；出现一个非数字就整列拒绝 —— 静默丢掉一部分数字比直接报错糟得多
///   · count 只数非空，不做数值判定
///   · 行 / 列的不同取值数上限 200，超了直接拒绝而不是默默截断
///     （截断意味着导出文件缺数据，而用户看不出来）
///   · 某个组合没有数据时返回空串而不是 0 ——「没数据」和「结果是 0」不是一回事
/// </summary>
public class PivotService
{
    /// <summary>行 / 列维度的不同取值数上限</summary>
    public const int MaxKeys = 200;

    /// <summary>分组键的行列分隔符。列名可以是任意字符，所以不用逗号这类常见符号</summary>
    private const string Separator = "\u0001";

    private static readonly string[] Aggs = { "sum", "count", "avg", "max", "min" };

    private readonly TableRepository _repository;

    public PivotService(TableRepository repository) => _repository = repository;

    /// <summary>聚合方式的展示文案（表头与提示用）</summary>
    public static string LabelOf(string agg) => agg switch
    {
        "sum" => "求和",
        "count" => "计数",
        "avg" => "平均",
        "max" => "最大值",
        "min" => "最小值",
        _ => "汇总"
    };

    public async Task<ApiResponse<PivotResultDto>> BuildAsync(int tableId, int userId, PivotRequest? request)
    {
        if (request == null) return ApiResponse<PivotResultDto>.Fail("请求为空");

        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return ApiResponse<PivotResultDto>.Fail("表格不存在");

        var headers = table.Headers ?? new List<string>();
        var valueField = (request.ValueField ?? string.Empty).Trim();
        var rowField = (request.RowField ?? string.Empty).Trim();
        var colField = (request.ColField ?? string.Empty).Trim();
        var agg = (request.Agg ?? "sum").Trim().ToLowerInvariant();

        var invalid = Validate(headers, valueField, rowField, colField, agg);
        if (invalid != null) return ApiResponse<PivotResultDto>.Fail(invalid);

        var data = await _repository.GetRowDataAsync(tableId);

        // 计算列的值不落库，透视必须现算，否则按计算列汇总会得到一整片空
        ComputedColumnService.Apply(headers, ColumnMetaService.Parse(table.ColumnMetaJson), data);

        if (agg != "count")
        {
            var broken = FirstNonNumeric(data, valueField);
            if (broken != null)
            {
                return ApiResponse<PivotResultDto>.Fail(
                    $"「{valueField}」里有不是数字的内容（例如「{broken}」），无法{LabelOf(agg)}。"
                    + "可以改用「计数」，或先把这一列整理成数字");
            }
        }

        var rowKeys = CollectKeys(data, rowField, out var rowOverflow);
        var colKeys = CollectKeys(data, colField, out var colOverflow);
        if (rowOverflow != null) return ApiResponse<PivotResultDto>.Fail(TooManyMessage(rowField, rowOverflow));
        if (colOverflow != null) return ApiResponse<PivotResultDto>.Fail(TooManyMessage(colField, colOverflow));

        // 建立索引：cells 按「行键+列键」，行 / 列合计各按一个维度
        var cells = new Dictionary<string, List<Dictionary<string, object>>>(StringComparer.Ordinal);
        var byRow = new Dictionary<string, List<Dictionary<string, object>>>(StringComparer.Ordinal);
        var byCol = new Dictionary<string, List<Dictionary<string, object>>>(StringComparer.Ordinal);
        var participating = new List<Dictionary<string, object>>();

        foreach (var row in data)
        {
            var rk = KeyOf(row, rowField);
            var ck = KeyOf(row, colField);
            // 两个维度都留空时 rk / ck 都是空串，逻辑同样成立（退化成只有一格的总计）
            if (rowField.Length > 0 && rk.Length == 0) continue;
            if (colField.Length > 0 && ck.Length == 0) continue;

            participating.Add(row);
            Bucket(cells, rk + Separator + ck).Add(row);
            Bucket(byRow, rk).Add(row);
            Bucket(byCol, ck).Add(row);
        }

        var rowAxis = rowField.Length == 0 ? new List<string> { string.Empty } : rowKeys;
        var colAxis = colField.Length == 0 ? new List<string> { string.Empty } : colKeys;

        var result = new PivotResultDto
        {
            // RowKeys / ColKeys 就是 Cells 的坐标轴本身，两者必须严格对齐：
            //   RowKeys.Count == Cells.Count，ColKeys.Count == Cells[i].Count。
            // 「不分组」用一条空标签代替 —— 显示成「合计」还是别的，由渲染方按请求字段决定。
            // 早先把「不分组」留成空数组、Cells 却仍有一行，导出时就会少写一行数据。
            RowKeys = rowAxis,
            ColKeys = colAxis,
            SourceRows = data.Count,
            ValueLabel = $"{LabelOf(agg)}({valueField})"
        };

        foreach (var rk in rowAxis)
        {
            var line = new List<string>();
            foreach (var ck in colAxis)
                line.Add(PivotService.Format(At(cells, rk + Separator + ck), valueField, agg));

            result.Cells.Add(line);
            result.RowTotals.Add(PivotService.Format(At(byRow, rk), valueField, agg));
        }

        foreach (var ck in colAxis)
            result.ColTotals.Add(PivotService.Format(At(byCol, ck), valueField, agg));

        result.GrandTotal = PivotService.Format(participating, valueField, agg);

        return ApiResponse<PivotResultDto>.Ok(result);
    }

    // ================================================================
    // 校验
    // ================================================================
    private static string? Validate(
        List<string> headers, string valueField, string rowField, string colField, string agg)
    {
        if (valueField.Length == 0 || !headers.Contains(valueField))
            return "请选择要汇总的数值列";
        if (Array.IndexOf(Aggs, agg) < 0)
            return "不支持的汇总方式";
        if (rowField.Length > 0 && !headers.Contains(rowField))
            return $"行字段「{rowField}」不存在，请刷新后重试";
        if (colField.Length > 0 && !headers.Contains(colField))
            return $"列字段「{colField}」不存在，请刷新后重试";
        if (rowField.Length > 0 && rowField == colField)
            return "行字段与列字段不能是同一列";

        return null;
    }

    // ================================================================
    // 内部
    // ================================================================

    private static List<Dictionary<string, object>> Bucket(
        Dictionary<string, List<Dictionary<string, object>>> map, string key)
    {
        if (!map.TryGetValue(key, out var bucket))
        {
            bucket = new List<Dictionary<string, object>>();
            map[key] = bucket;
        }
        return bucket;
    }

    private static List<Dictionary<string, object>> At(
        Dictionary<string, List<Dictionary<string, object>>> map, string key) =>
        map.TryGetValue(key, out var bucket) ? bucket : new List<Dictionary<string, object>>();

    private static string KeyOf(Dictionary<string, object> row, string field)
    {
        if (field.Length == 0) return string.Empty;
        return row.TryGetValue(field, out var v) ? (v?.ToString() ?? string.Empty).Trim() : string.Empty;
    }

    /// <summary>
    /// 收集某维度的不同取值并排序。
    /// 排序规则固定为「全是数字就按数值，否则按序数比较」—— 顺序必须确定，
    /// 否则同一份数据每次刷新行列顺序都可能变，用户会以为数据在动。
    /// </summary>
    private static List<string> CollectKeys(
        List<Dictionary<string, object>> data, string field, out string? overflowValue)
    {
        overflowValue = null;
        var keys = new List<string>();
        if (field.Length == 0) return keys;

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in data)
        {
            var key = KeyOf(row, field);
            if (key.Length == 0) continue;
            if (!seen.Add(key)) continue;

            keys.Add(key);
            if (keys.Count > MaxKeys)
            {
                overflowValue = key;
                return keys;
            }
        }

        if (keys.All(k => ExcelNumber.TryParseNumber(k, out _)))
        {
            keys.Sort((a, b) =>
            {
                ExcelNumber.TryParseNumber(a, out var x);
                ExcelNumber.TryParseNumber(b, out var y);
                return x.CompareTo(y);
            });
        }
        else
        {
            keys.Sort(StringComparer.Ordinal);
        }

        return keys;
    }

    private static string TooManyMessage(string field, string sample) =>
        $"「{field}」的不同取值超过 {MaxKeys} 个（例如「{sample}」），透视表放不下。"
        + "请换一个取值更少的行 / 列字段，或先另建一张按这个字段汇总的表";

    /// <summary>值字段里第一个不是数字的非空内容；没有则返回 null</summary>
    private static string? FirstNonNumeric(List<Dictionary<string, object>> rows, string field)
    {
        foreach (var row in rows)
        {
            if (!row.TryGetValue(field, out var v)) continue;
            var text = (v?.ToString() ?? string.Empty).Trim();
            if (text.Length == 0) continue;
            if (!ExcelNumber.TryParseNumber(text, out _)) return text;
        }
        return null;
    }

    /// <summary>
    /// 一个分组（或一行 / 一列 / 全体）的聚合值。返回可直接展示的字符串。
    /// 供透视导出复用，所以是 public static —— 导出只负责排版，数字必须来自这里。
    /// </summary>
    public static string Format(List<Dictionary<string, object>> rows, string valueField, string agg)
    {
        if (rows.Count == 0) return string.Empty;

        if (agg == "count")
        {
            var n = rows.Count(row =>
                row.TryGetValue(valueField, out var v) && !string.IsNullOrWhiteSpace(v?.ToString()));
            return n == 0 ? string.Empty : n.ToString();
        }

        var numbers = new List<decimal>();
        foreach (var row in rows)
        {
            if (!row.TryGetValue(valueField, out var v)) continue;
            var text = (v?.ToString() ?? string.Empty).Trim();
            if (text.Length == 0) continue;
            if (ExcelNumber.TryParseNumber(text, out var number)) numbers.Add(number);
        }

        if (numbers.Count == 0) return string.Empty;

        var value = agg switch
        {
            "sum" => numbers.Sum(),
            "avg" => numbers.Sum() / numbers.Count,
            "max" => numbers.Max(),
            "min" => numbers.Min(),
            _ => 0m
        };

        return ExcelNumber.Format(value);
    }
}
