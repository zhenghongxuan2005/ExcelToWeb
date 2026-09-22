using ExcelToWeb.DTOs;
using ExcelToWeb.Models;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 计算列：列的值**不落库**，每次读取时按公式实时算出来。
///
/// 为什么是「实时算」而不是「保存时算好写进 DataJson」：
///   · 写进去就有两份数据，改了源列却忘了重算，页面上就会长期显示过期数字
///   · 实时算只有一个真源（源列），永远不可能对不上
/// 代价是每次读取多花一点 CPU（每行每列一次树遍历），换来的是「不可能漂移」。
///
/// 由此推出两条必须遵守的规则：
///   · 读取时 Apply —— 查询数据、导出 xlsx / CSV 都要算
///   · 保存时 Strip —— 客户端回传的行里带着算出来的值，落库前必须抹掉，
///     否则计算列的值会顺着「保存」混进 DataJson，上面说的漂移就又回来了
/// </summary>
public class ComputedColumnService
{
    /// <summary>一张表最多多少个计算列。纯粹防呆：加满公式会把每次读取拖慢。</summary>
    public const int MaxComputedColumns = 20;

    private readonly TableRepository _repository;

    public ComputedColumnService(TableRepository repository) => _repository = repository;

    // ================================================================
    // 读取时计算
    // ================================================================

    /// <summary>
    /// 把计算列的值填进每一行（只改内存里的字典，不落库）。
    /// 某个公式解析不了时该列写 #ERROR!：宁可在页面上明晃晃地报错，
    /// 也不要留一片空白让人以为「这列本来就没数据」。
    /// </summary>
    public static void Apply(
        IReadOnlyList<string> headers,
        Dictionary<string, ColumnMetaDto>? meta,
        List<Dictionary<string, object>>? rows)
    {
        if (rows == null || rows.Count == 0) return;

        var plans = Compile(headers, meta);
        if (plans.Count == 0) return;

        foreach (var row in rows)
        {
            // 每行只建一个取值闭包，而不是每个计算列各建一个
            string? Lookup(string column) => row.TryGetValue(column, out var v) ? v?.ToString() : null;

            foreach (var plan in plans) row[plan.Name] = plan.Run(Lookup);
        }
    }

    /// <summary>落库前抹掉计算列：它们的值是按公式算出来的，不该进 DataJson。</summary>
    public static void Strip(
        Dictionary<string, ColumnMetaDto>? meta,
        List<Dictionary<string, object>>? rows)
    {
        if (rows == null || rows.Count == 0) return;

        var computed = ComputedNames(meta);
        if (computed.Count == 0) return;

        foreach (var row in rows)
        {
            foreach (var name in computed) row.Remove(name);
        }
    }

    /// <summary>列名是否是计算列（有公式即算）</summary>
    public static bool IsComputed(Dictionary<string, ColumnMetaDto>? meta, string column) =>
        meta != null && meta.TryGetValue(column, out var item) && !string.IsNullOrEmpty(item?.Expr);

    /// <summary>取某列的公式原文；不是计算列返回 null</summary>
    public static string? FormulaOf(Dictionary<string, ColumnMetaDto>? meta, string column) =>
        IsComputed(meta, column) ? meta![column].Expr : null;

    /// <summary>全表计算列的列名（顺序稳定：按元数据里的书写顺序）</summary>
    public static List<string> ComputedNames(Dictionary<string, ColumnMetaDto>? meta)
    {
        if (meta == null) return new List<string>();

        return meta.Where(p => !string.IsNullOrEmpty(p.Value?.Expr))
                   .Select(p => p.Key)
                   .ToList();
    }

    private static List<Plan> Compile(IReadOnlyList<string> headers, Dictionary<string, ColumnMetaDto>? meta)
    {
        var plans = new List<Plan>();
        if (meta == null) return plans;

        var known = new HashSet<string>(headers, StringComparer.Ordinal);

        foreach (var pair in meta)
        {
            if (string.IsNullOrEmpty(pair.Value?.Expr)) continue;
            if (!known.Contains(pair.Key)) continue;   // 元数据里残留的已删列，跳过

            FormulaEngine.TryParse(pair.Value!.Expr!, out var node, out _);
            plans.Add(new Plan(pair.Key, node));
        }

        return plans;
    }

    private sealed record Plan(string Name, FormulaEngine.Node? Node)
    {
        public string Run(Func<string, string?> lookup) =>
            Node == null ? FormulaEvaluator.ErrorSyntax : FormulaEvaluator.Evaluate(Node, lookup);
    }

    // ================================================================
    // 设置 / 清空公式
    // ================================================================

    /// <summary>
    /// 设置某列的计算公式（<c>formula</c> 传空表示退回普通可编辑列）。
    /// 校验全在这里做完，存进去的一定是「能算且只引用存在的普通列」的公式。
    /// </summary>
    public async Task<ApiResponse> SaveFormulaAsync(int tableId, int userId, SaveFormulaRequest? request)
    {
        if (request == null) return ApiResponse.Fail("请求为空");

        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return ApiResponse.Fail("表格不存在");

        var column = (request.ColumnName ?? string.Empty).Trim();
        var headers = table.Headers ?? new List<string>();
        if (column.Length == 0 || !headers.Contains(column))
            return ApiResponse.Fail("列不存在，请刷新后重试");

        var meta = ColumnMetaService.Parse(table.ColumnMetaJson);
        var formula = (request.Formula ?? string.Empty).Trim();

        if (formula.Length == 0)
        {
            if (!SetFormula(meta, column, null)) return ApiResponse.Ok("该列本来就不是计算列");
            await PersistAsync(table, meta);
            return ApiResponse.Ok($"列「{column}」已取消计算列，现在可以手动填值");
        }

        if (!FormulaEngine.TryParse(formula, out var node, out var parseError))
            return ApiResponse.Fail("公式有误：" + parseError);

        var referenceError = ValidateReferences(node!, column, headers, meta);
        if (referenceError != null) return ApiResponse.Fail(referenceError);

        // 只在「从普通列变成计算列」时计上限：改写已有计算列的公式不该被上限挡住
        if (!IsComputed(meta, column) && CountComputed(meta) >= MaxComputedColumns)
            return ApiResponse.Fail($"一张表最多 {MaxComputedColumns} 个计算列");

        if (!SetFormula(meta, column, formula))
            return ApiResponse.Ok($"列「{column}」的公式没有变化");

        await PersistAsync(table, meta);
        return ApiResponse.Ok($"列「{column}」已设为计算列：{formula}");
    }

    /// <summary>检查公式引用的列；返回错误说明，合法返回 null</summary>
    private static string? ValidateReferences(
        FormulaEngine.Node node, string column, IReadOnlyList<string> headers, Dictionary<string, ColumnMetaDto> meta)
    {
        var computed = ComputedNames(meta);

        foreach (var used in FormulaEngine.CollectColumns(node!))
        {
            if (string.Equals(used, column, StringComparison.Ordinal))
                return "公式不能引用自己";

            if (!headers.Contains(used))
                return $"公式引用了不存在的列「{used}」";

            // 计算列不能互相引用：一刀切掉之后就不存在环，不必再做图上的环检测
            if (computed.Contains(used, StringComparer.Ordinal))
                return $"「{used}」本身是计算列，计算列之间不能互相引用";
        }

        return null;
    }

    private static int CountComputed(Dictionary<string, ColumnMetaDto> meta) => ComputedNames(meta).Count;

    /// <summary>写入 / 清空公式。返回是否真的有变化（避免无意义的落库）。</summary>
    private static bool SetFormula(Dictionary<string, ColumnMetaDto> meta, string column, string? formula)
    {
        meta.TryGetValue(column, out var item);

        if (formula == null)
        {
            if (item == null || string.IsNullOrEmpty(item.Expr)) return false;
            item.Expr = null;
            // 全默认的条目不留，与 ColumnMetaService「不写无意义条目」的取舍保持一致
            if (item.Width == null && !item.Hidden) meta.Remove(column);
            return true;
        }

        if (item != null && string.Equals(item.Expr, formula, StringComparison.Ordinal)) return false;

        if (item == null)
        {
            item = new ColumnMetaDto();
            meta[column] = item;
        }

        item.Expr = formula;
        return true;
    }

    /// <summary>
    /// 公式改变的是「这一列显示什么」，不是视图偏好，所以照常刷新 UpdatedAt，
    /// 让表格在列表里排到前面 —— 用户会期待「刚改过公式的表」被当成最近改过。
    /// </summary>
    private Task PersistAsync(DynamicTable table, Dictionary<string, ColumnMetaDto> meta) =>
        _repository.SaveColumnMetaAsync(table, ColumnMetaService.Serialize(meta), touchUpdatedAt: true);
}
