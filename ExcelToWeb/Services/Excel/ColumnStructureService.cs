using System.Text.Json;
using ExcelToWeb.Data;
using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 列结构维护（增 / 删 / 改 / 移）。
/// 一次请求完成：
///   headers  - 最终列名（顺序即新顺序）
///   renames  - 把数据从 oldName 拷到 newName（避免 drop+add 丢数据）
/// 服务端做集合差推出 dropped/added：
///   dropped 出现在旧表但不在新表  -> 从 Headers 移除，并清掉每行 DataJson 的该键
///   added   出现在新表但不在旧表  -> 追加到 Headers，并在每行 DataJson 补空串
/// 颜色规则 / 校验规则中引用了 dropped 列的会一并删除；引用了 renamed 列的会改名跟随。
/// 整个过程包在一个事务里，任一环节失败都会回滚，避免「半截结构」。
/// </summary>
public class ColumnStructureService
{
    private readonly AppDbContext _db;
    private readonly TableRepository _repository;
    private readonly RuleService _rules;

    public ColumnStructureService(AppDbContext db, TableRepository repository, RuleService rules)
    {
        _db = db;
        _repository = repository;
        _rules = rules;
    }

    public async Task<ApiResponse> UpdateHeadersAsync(int tableId, int userId, UpdateHeadersRequest request)
    {
        if (request == null) return ApiResponse.Fail("请求为空");
        if (request.Headers == null || request.Headers.Count == 0)
            return ApiResponse.Fail("列名不能为空");
        if (request.Headers.Count > 200)
            return ApiResponse.Fail("列数不能超过 200");

        // 1) 规范化最终列名 + 校验
        var newHeaders = new List<string>(request.Headers.Count);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var h in request.Headers)
        {
            var t = (h ?? string.Empty).Trim();
            if (t.Length == 0) return ApiResponse.Fail("列名不能为空或纯空白");
            if (t.Length > 100) return ApiResponse.Fail($"列名 \"{t}\" 超过 100 字符");
            if (!seen.Add(t)) return ApiResponse.Fail($"列名 \"{t}\" 重复");
            newHeaders.Add(t);
        }

        // 2) 校验 renames
        var renames = new List<ColumnRenameItem>();
        if (request.Renames != null)
        {
            foreach (var r in request.Renames)
            {
                if (string.IsNullOrWhiteSpace(r.OldName) || string.IsNullOrWhiteSpace(r.NewName))
                    return ApiResponse.Fail("重命名的源列名与目标列名都不能为空");
                if (r.OldName == r.NewName)
                    return ApiResponse.Fail($"重命名不能前后同名：{r.OldName}");
                renames.Add(new ColumnRenameItem { OldName = r.OldName.Trim(), NewName = r.NewName.Trim() });
            }
        }

        var table = await _repository.FindTableAsync(tableId, userId);
        if (table == null) return ApiResponse.Fail("表格不存在");

        var oldHeaders = table.Headers ?? new List<string>();

        // 3) renames 必须存在且不能与最终列表冲突
        foreach (var r in renames)
        {
            if (!oldHeaders.Contains(r.OldName))
                return ApiResponse.Fail($"重命名源列 \"{r.OldName}\" 不存在");
            if (!newHeaders.Contains(r.NewName))
                return ApiResponse.Fail($"重命名目标 \"{r.NewName}\" 必须出现在最终列名列表中");
            if (newHeaders.Contains(r.OldName))
                return ApiResponse.Fail($"重命名源列 \"{r.OldName}\" 仍出现在最终列表里——既然要改名为 \"{r.NewName}\"，请从列表里移除源列");
        }

        // 4) 计算集合差
        var oldSet = new HashSet<string>(oldHeaders, StringComparer.Ordinal);
        var newSet = new HashSet<string>(newHeaders, StringComparer.Ordinal);
        var dropped = oldSet.Except(newSet).ToList();
        var added = newSet.Except(oldSet).ToList();

        // 5) 事务：表头 + 行 + 规则一次提交
        await using var tx = await _db.Database.BeginTransactionAsync();
        try
        {
            // 改每行 DataJson
            var rows = await _repository.LoadRawRowsAsync(tableId);
            foreach (var row in rows)
            {
                var dict = JsonSerializer.Deserialize<Dictionary<string, object>>(row.DataJson)
                           ?? new Dictionary<string, object>();

                // 重命名：把数据从 old 拷到 new
                foreach (var r in renames)
                {
                    if (dict.TryGetValue(r.OldName, out var v))
                    {
                        dict.Remove(r.OldName);
                        dict[r.NewName] = v;
                    }
                }
                // 删除
                foreach (var d in dropped) dict.Remove(d);
                // 新增：空串占位（保持「每个键都有值」的一致性）
                foreach (var a in added)
                {
                    if (!dict.ContainsKey(a)) dict[a] = string.Empty;
                }

                row.DataJson = JsonSerializer.Serialize(dict);
            }
            await _db.SaveChangesAsync();

            // 更新 Headers，并同步修剪列元数据（rename 迁键、dropped 删键）。
            // 传完整的 dropped（含 rename 源列）：PruneForColumns 内部先迁后删，
            // 这样改名的列能保住列宽/隐藏状态。
            table.Headers = newHeaders;
            table.UpdatedAt = DateTime.Now;

            var prunedMeta = ColumnMetaService.PruneForColumns(
                ColumnMetaService.Parse(table.ColumnMetaJson), renames, dropped);
            table.ColumnMetaJson = prunedMeta.Count == 0 ? null : JsonSerializer.Serialize(prunedMeta);

            await _db.SaveChangesAsync();

            // 同步清理 / 改名 规则。
            // 注意：rename 源列必然出现在 dropped（旧名不在新列表）里，
            // 必须先剔除，否则迁移第一步会把它当「被删列」清掉，第二步改名时就找不到规则了。
            var renameSources = new HashSet<string>(renames.Select(r => r.OldName), StringComparer.Ordinal);
            var droppedForRules = dropped.Where(d => !renameSources.Contains(d)).ToList();
            await _rules.MigrateForColumnsAsync(userId, tableId, renames, droppedForRules);

            await tx.CommitAsync();

            return ApiResponse.Ok(
                $"列结构已更新：新增 {added.Count} 列，删除 {dropped.Count} 列，重命名 {renames.Count} 列");
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            // 异常细节不返回给客户端：回滚后交给门面记录日志并给出友好提示
            throw new ColumnUpdateException(tableId, ex);
        }
    }
}

/// <summary>列结构更新失败的内部信号，携带表 ID 供门面记录日志</summary>
public class ColumnUpdateException : Exception
{
    public int TableId { get; }

    public ColumnUpdateException(int tableId, Exception inner)
        : base($"更新表格 {tableId} 列结构失败", inner)
    {
        TableId = tableId;
    }
}
