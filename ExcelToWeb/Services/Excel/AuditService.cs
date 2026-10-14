using ExcelToWeb.Data;
using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 变更历史（审计日志）：在「保存」时对比新旧整表数据生成 diff 并落库，供前端时间线查询。
/// 设计上只做「记录 + 查询」，不参与业务主流程——记录失败只写日志，绝不让保存本身失败。
/// </summary>
public class AuditService
{
    private readonly AppDbContext _db;
    private readonly ILogger<AuditService> _logger;

    /// <summary>单次保存最多落库的明细条数；超过则折叠为一条 bulk 摘要，防止全表重写刷爆日志表</summary>
    private const int MaxDetailEntries = 300;

    public AuditService(AppDbContext db, ILogger<AuditService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// 对比保存前后的整表数据并记录差异。oldRows / newRows 按行号对齐（行号从 1 开始）。
    /// </summary>
    public async Task RecordSaveAsync(int tableId, string userName,
        List<Dictionary<string, object>> oldRows, List<Dictionary<string, object>> newRows,
        IReadOnlyList<string> headers)
    {
        try
        {
            var entries = new List<AuditLog>();
            int max = Math.Max(oldRows.Count, newRows.Count);

            for (int i = 0; i < max; i++)
            {
                // 行号从 1 开始，与前端表格里显示的序号一致
                if (i >= oldRows.Count)
                {
                    entries.Add(new AuditLog { TableId = tableId, Action = "add-row", RowIndex = i + 1, UserName = userName });
                    continue;
                }
                if (i >= newRows.Count)
                {
                    entries.Add(new AuditLog { TableId = tableId, Action = "delete-row", RowIndex = i + 1, UserName = userName });
                    continue;
                }

                foreach (var col in headers)
                {
                    var oldVal = CellText(oldRows[i], col);
                    var newVal = CellText(newRows[i], col);
                    if (oldVal != newVal)
                    {
                        entries.Add(new AuditLog
                        {
                            TableId = tableId,
                            Action = "edit",
                            RowIndex = i + 1,
                            ColumnName = col,
                            OldValue = oldVal,
                            NewValue = newVal,
                            UserName = userName
                        });
                    }
                }
            }

            if (entries.Count == 0) return;

            // 变更量过大（如整表重导）时折叠成一条摘要，明细反而淹没关键信息
            if (entries.Count > MaxDetailEntries)
            {
                entries = new List<AuditLog>
                {
                    new AuditLog
                    {
                        TableId = tableId,
                        Action = "bulk",
                        RowIndex = 0,
                        NewValue = $"共 {entries.Count} 处变更",
                        UserName = userName
                    }
                };
            }

            await _db.AuditLogs.AddRangeAsync(entries);
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // 审计失败不影响保存结果
            _logger.LogWarning(ex, "记录表格 {TableId} 的变更历史失败", tableId);
        }
    }

    /// <summary>查询某表的变更历史（按时间倒序）；rowIndex 传值时只看该行的历史</summary>
    public Task<List<AuditLog>> GetLogsAsync(int tableId, int? rowIndex, int take = 100)
    {
        var query = _db.AuditLogs.Where(a => a.TableId == tableId);
        if (rowIndex.HasValue)
            query = query.Where(a => a.RowIndex == rowIndex.Value);
        return query.OrderByDescending(a => a.CreatedAt).Take(take).ToListAsync();
    }

    /// <summary>
    /// 审计中心：跨该用户全部表格的审计时间线，支持表格 / 操作类型 / 时间范围筛选与分页。
    /// AuditLogs 本身没有 UserId，归属校验靠与 DynamicTables 的 join 完成——
    /// 这也是「删表必须事务性清掉审计日志」的另一个原因：孤儿日志会永远留在 join 结果之外。
    /// to 参数按「当天含边界」处理（下探到 to 当天 24 点前）。
    /// </summary>
    public async Task<(List<AuditLogItemDto> Logs, int Total)> SearchAsync(
        int userId, int? tableId, string? actionType, DateTime? from, DateTime? to,
        int page, int pageSize)
    {
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 50;
        if (pageSize > 100) pageSize = 100;

        var query = from log in _db.AuditLogs
                    join table in _db.DynamicTables on log.TableId equals table.Id
                    where table.UserId == userId && table.DeletedAt == null
                    select new { log, table.TableName };

        if (tableId.HasValue)
            query = query.Where(x => x.log.TableId == tableId.Value);
        if (!string.IsNullOrEmpty(actionType))
            query = query.Where(x => x.log.Action == actionType);
        if (from.HasValue)
            query = query.Where(x => x.log.CreatedAt >= from.Value);
        if (to.HasValue)
            query = query.Where(x => x.log.CreatedAt < to.Value.AddDays(1));

        var total = await query.CountAsync();
        var logs = await query
            .OrderByDescending(x => x.log.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new AuditLogItemDto
            {
                Id = x.log.Id,
                TableId = x.log.TableId,
                TableName = x.TableName,
                Action = x.log.Action,
                RowIndex = x.log.RowIndex,
                ColumnName = x.log.ColumnName,
                OldValue = x.log.OldValue,
                NewValue = x.log.NewValue,
                UserName = x.log.UserName,
                CreatedAt = x.log.CreatedAt
            })
            .ToListAsync();

        return (logs, total);
    }

    /// <summary>取单元格文本。值经 System.Text.Json 反序列化后是 JsonElement，ToString 即原始文本</summary>
    private static string CellText(Dictionary<string, object> row, string column) =>
        row.TryGetValue(column, out var v) ? v?.ToString() ?? string.Empty : string.Empty;
}
