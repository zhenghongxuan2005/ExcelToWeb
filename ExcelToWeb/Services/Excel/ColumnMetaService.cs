using System.Text.Json;
using ExcelToWeb.DTOs;
using ExcelToWeb.Models;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 列视图元数据（列宽 / 是否隐藏）的读写。
/// 存在 DynamicTables.ColumnMetaJson 里，按列名索引 —— 列增删改时只需同步键名，
/// 与 ColumnStructureService 的 renames / dropped 一一对应。
/// 项目没有 EF Migrations，补列语句见 Program.cs（幂等）。
/// </summary>
public class ColumnMetaService
{
    /// <summary>列宽允许范围（px），与前端 setColumnWidth 的 60~600 同一量纲，留一点余量</summary>
    private const int MinWidth = 40;
    private const int MaxWidth = 600;

    /// <summary>最多保存多少列的元数据，与列数上限（200）一致</summary>
    private const int MaxEntries = 200;

    private readonly TableRepository _repository;

    public ColumnMetaService(TableRepository repository) => _repository = repository;

    /// <summary>读取某表的列元数据；表不存在或从未调整过列时返回空字典</summary>
    public async Task<Dictionary<string, ColumnMetaDto>> GetAsync(int tableId, int userId)
    {
        var table = await _repository.FindTableAsync(tableId, userId);
        return table == null
            ? new Dictionary<string, ColumnMetaDto>()
            : Parse(table.ColumnMetaJson);
    }

    /// <summary>
    /// 保存列视图偏好，语义是「整表覆盖」：
    ///   - 只接受当前表头里存在的列名（列已删、前端还拿着旧列表时不会写入垃圾键）
    ///   - 列宽夹到 [MinWidth, MaxWidth]
    ///   - 全默认（无宽度、不隐藏、无公式）的列不写，避免 JSON 随列数无意义膨胀
    ///   - 所有列都是默认值时存 null
    /// 注意不更新 UpdatedAt：调列宽属于视图偏好，不该让表格在列表里跳到最前。
    ///
    /// 公式（Expr）**只认库里的那份**，请求里的 Expr 一律忽略：
    /// 本接口只负责列宽与隐藏，公式有专门的接口（ComputedColumnService.SaveFormulaAsync）
    /// 会做语法与引用校验。前端送来的元数据里不含公式，若在这里整表覆盖，一次调列宽
    /// 就能把用户的公式抹掉。
    /// </summary>
    public async Task<ApiResponse> SaveAsync(int tableId, int userId, SaveColumnMetaRequest? request)
    {
        if (request == null) return ApiResponse.Fail("请求为空");

        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return ApiResponse.Fail("表格不存在");

        var headers = new HashSet<string>(table.Headers ?? new List<string>(), StringComparer.Ordinal);
        var stored = Parse(table.ColumnMetaJson);
        var clean = new Dictionary<string, ColumnMetaDto>(StringComparer.Ordinal);

        foreach (var pair in request.Meta ?? new Dictionary<string, ColumnMetaDto>())
        {
            if (clean.Count >= MaxEntries) break;

            var name = pair.Key;
            var meta = pair.Value;
            if (string.IsNullOrEmpty(name) || !headers.Contains(name)) continue;

            int? width = meta?.Width;
            if (width.HasValue) width = Math.Clamp(width.Value, MinWidth, MaxWidth);
            var hidden = meta?.Hidden ?? false;

            stored.TryGetValue(name, out var existing);
            var expr = existing?.Expr;

            if (!width.HasValue && !hidden && string.IsNullOrEmpty(expr)) continue;
            clean[name] = new ColumnMetaDto { Width = width, Hidden = hidden, Expr = expr };
        }

        // 计算列即使没调过列宽也不会出现在请求里，必须补回来 ——
        // 否则「点开列设置再保存一次」这种动作就会顺手删掉用户的公式
        foreach (var pair in stored)
        {
            if (clean.Count >= MaxEntries) break;
            if (clean.ContainsKey(pair.Key)) continue;
            if (string.IsNullOrEmpty(pair.Value?.Expr)) continue;
            if (!headers.Contains(pair.Key)) continue;

            clean[pair.Key] = new ColumnMetaDto { Expr = pair.Value.Expr };
        }

        await _repository.SaveColumnMetaAsync(table, Serialize(clean));
        return ApiResponse.Ok("列设置已保存");
    }

    /// <summary>序列化列元数据；没有任何要保存的内容时返回 null（存 null 而不是 "{}"）</summary>
    public static string? Serialize(Dictionary<string, ColumnMetaDto> meta) =>
        meta.Count == 0 ? null : JsonSerializer.Serialize(meta);

    /// <summary>反序列化列元数据；内容损坏时退化成空字典，不让一段脏 JSON 挡住整表加载</summary>
    public static Dictionary<string, ColumnMetaDto> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new Dictionary<string, ColumnMetaDto>();

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, ColumnMetaDto>>(json)
                   ?? new Dictionary<string, ColumnMetaDto>();
        }
        catch (JsonException)
        {
            return new Dictionary<string, ColumnMetaDto>();
        }
    }

    /// <summary>
    /// 列结构变更后同步修剪元数据：rename 迁键、dropped 删键。
    /// 顺序不能反 —— rename 的源列同时也在 dropped 里（旧名不在新列表），
    /// 必须先把元数据搬到新名下再按 dropped 删，否则一改名就丢掉该列的列宽。
    /// （与 RuleService.MigrateForColumnsAsync 是同一类交叉问题，改这里时请一起看。）
    ///
    /// 之后还要修公式里引用的列名：公式写的是列名，列改名 / 被删了公式得跟着走。
    /// 公式引用了被删列时整条公式作废（置 null，该列退回普通可编辑列）——
    /// 留着一个引用不存在列的公式，只会得到一列永远算不出来的 #REF!，
    /// 而且它还是只读的，用户除了再删一次列没有别的出路。
    /// </summary>
    public static Dictionary<string, ColumnMetaDto> PruneForColumns(
        Dictionary<string, ColumnMetaDto> meta,
        IEnumerable<ColumnRenameItem> renames,
        IEnumerable<string> dropped)
    {
        var result = new Dictionary<string, ColumnMetaDto>(meta, StringComparer.Ordinal);

        var renameList = renames.ToList();
        var droppedList = dropped.ToList();

        foreach (var r in renameList)
        {
            if (result.TryGetValue(r.OldName, out var moved))
            {
                result.Remove(r.OldName);
                result[r.NewName] = moved;
            }
        }

        foreach (var d in droppedList) result.Remove(d);

        var renameMap = renameList
            .GroupBy(r => r.OldName, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First().NewName, StringComparer.Ordinal);

        foreach (var name in result.Keys.ToList())
        {
            var item = result[name];
            if (string.IsNullOrEmpty(item?.Expr)) continue;

            item.Expr = FormulaEngine.TryRenameColumns(item.Expr!, renameMap, droppedList, out var updated)
                ? updated
                : null;
        }

        // 公式被清掉后可能变成「全默认」条目，顺手删掉，别在 JSON 里留垃圾键
        foreach (var name in result.Keys.ToList())
        {
            var item = result[name];
            if (item == null || item.Width != null || item.Hidden || !string.IsNullOrEmpty(item.Expr)) continue;
            result.Remove(name);
        }

        return result;
    }
}
