using System.Diagnostics;
using System.Text.Json;
using ExcelToWeb.Data;
using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 动态表格与数据行的数据访问层：EF 查询、整表替换事务、原生 SQL 批量插入等持久化细节集中在这里。
/// </summary>
public class TableRepository
{
    private readonly AppDbContext _db;
    private readonly ILogger<TableRepository> _logger;

    public TableRepository(AppDbContext db, ILogger<TableRepository> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// 按「表格ID + 归属用户」查找，天然完成越权校验。
    /// 只返回活表：回收站里的表（DeletedAt 非 null）对常规查询不可见，
    /// 恢复 / 彻底删除走 FindTrashedAsync。
    /// </summary>
    public Task<DynamicTable?> FindTableAsync(int tableId, int userId) =>
        _db.DynamicTables.FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId && t.DeletedAt == null);

    /// <summary>按「表格ID + 归属用户」查找回收站里的表（与 FindTableAsync 互补）</summary>
    public Task<DynamicTable?> FindTrashedAsync(int tableId, int userId) =>
        _db.DynamicTables.FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId && t.DeletedAt != null);

    public Task<List<DynamicRow>> GetRowsAsync(int tableId) =>
        _db.DynamicRows.Where(r => r.TableId == tableId).ToListAsync();

    /// <summary>
    /// 取出表的全部数据行（实体），供门面在事务里直接改 DataJson 字段。
    /// 与 GetRowDataAsync（反序列化到字典）不同，这里返回 EF 实体，调用方修改后 SaveChanges 即可落库。
    /// </summary>
    public Task<List<DynamicRow>> LoadRawRowsAsync(int tableId) => GetRowsAsync(tableId);

    /// <summary>读取并反序列化某表的全部数据行</summary>
    public async Task<List<Dictionary<string, object>>> GetRowDataAsync(int tableId)
    {
        var rows = await GetRowsAsync(tableId);
        return rows.Select(r => DeserializeRow(r.DataJson)).ToList();
    }

    /// <summary>返回当前用户的全部表格（含暂无数据行的空表；不含回收站里的表）</summary>
    public Task<List<TableInfoDto>> GetTableInfosAsync(int userId) =>
        _db.DynamicTables
            // 不过滤空表：用户可能把表清空后还没保存，或删光了行——
            // 若此时列表把表藏起来，用户就再也找不到它、也无法删除，成为幽灵数据。
            .Where(t => t.UserId == userId && t.DeletedAt == null)
            .OrderByDescending(t => t.UpdatedAt)
            .Select(t => new TableInfoDto
            {
                Id = t.Id,
                TableName = t.TableName,
                Headers = t.Headers,
                CreatedAt = t.CreatedAt,
                UpdatedAt = t.UpdatedAt
            })
            .ToListAsync();

    /// <summary>取当前用户全部表格名（含空表；不含回收站里的表——那里的表名视为可复用）</summary>
    public Task<List<string>> GetTableNamesAsync(int userId) =>
        _db.DynamicTables
            .Where(t => t.UserId == userId && t.DeletedAt == null)
            .Select(t => t.TableName)
            .ToListAsync();

    /// <summary>生成副本名，形如「销售表 - 副本」「销售表 - 副本(2)」，避免与现有表格重名</summary>
    public async Task<string> BuildCopyNameAsync(string sourceName, int userId)
    {
        var existing = await GetTableNamesAsync(userId);
        return UniqueName($"{sourceName} - 副本", existing);
    }

    /// <summary>
    /// 生成恢复名：原名可用则原样返回。删除表格期间用户可能建了同名新表——
    /// 回收站里的表名不占用名字，直接还原会出现两张同名表，恢复前必须先让开。
    /// </summary>
    public async Task<string> BuildRestoreNameAsync(string originalName, int userId)
    {
        var existing = await GetTableNamesAsync(userId);
        return UniqueName(originalName, existing);
    }

    /// <summary>在现有表名之外取唯一名：可用则原样，否则追加「(2)」式后缀，极端时用时间戳兜底</summary>
    private static string UniqueName(string baseName, List<string> existing)
    {
        if (!existing.Contains(baseName)) return baseName;

        for (int i = 2; i <= 999; i++)
        {
            var candidate = $"{baseName}({i})";
            if (!existing.Contains(candidate)) return candidate;
        }

        // 极端情况下兜底：加时间戳，保证一定能插入。
        // 这里是有意用本地时间（显示给用户看的表名），与落库时间统一用 UTC 的约定不冲突。
        return $"{baseName}({DateTime.Now:HHmmss})";
    }

    public async Task AddTableAsync(DynamicTable table)
    {
        await _db.DynamicTables.AddAsync(table);
        await _db.SaveChangesAsync();
    }

    /// <summary>重命名表格（同时刷新 UpdatedAt）</summary>
    public async Task RenameAsync(DynamicTable table, string newName)
    {
        table.TableName = newName;
        table.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    /// <summary>复制表格骨架（表名 + 表头），返回新表实体（数据行由调用方另行复制）</summary>
    public async Task<DynamicTable> CloneTableAsync(DynamicTable source, string newName)
    {
        var copy = new DynamicTable
        {
            TableName = newName,
            Headers = new List<string>(source.Headers),
            // 列宽 / 隐藏列与合并区域都属于「这张表长什么样」，一起复制，
            // 否则复制出来的表和原表长得不一样
            ColumnMetaJson = source.ColumnMetaJson,
            MergeRangesJson = source.MergeRangesJson,
            UserId = source.UserId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        await AddTableAsync(copy);
        return copy;
    }

    /// <summary>
    /// 整表替换（先删后插）。两步必须处在同一事务内：
    /// 否则插入阶段一旦失败，旧数据已被删除、新数据又没写进去，会造成数据丢失。
    /// </summary>
    public async Task ReplaceRowsAsync(DynamicTable table, List<Dictionary<string, object>> rows)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync();
        try
        {
            var oldRows = await GetRowsAsync(table.Id);
            _db.DynamicRows.RemoveRange(oldRows);

            var newRows = rows.Select(r => new DynamicRow
            {
                TableId = table.Id,
                DataJson = SerializeRow(r),
                CreatedAt = DateTime.UtcNow
            });
            await _db.DynamicRows.AddRangeAsync(newRows);

            table.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            await transaction.CommitAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            // 表在本事务开始后被其他人/标签页改过，RowVersion 已变，动态表 UPDATE 影响 0 行。
            // 回滚本次整表替换，换成内部信号上抛，避免静默覆盖对方的修改。
            await transaction.RollbackAsync();
            throw new ConcurrencyConflictException(table.Id);
        }
        catch
        {
            // 回滚保证「要么整体替换成功，要么保持原样」
            await transaction.RollbackAsync();
            throw;
        }
    }

    /// <summary>
    /// 软删除（功能 9 回收站）：只打删除标记，数据行 / 审计 / 校验规则原样保留，
    /// 30 天内可在回收站恢复；过期由 RecycleBinCleanupService 调 PurgeExpiredAsync 物理清除。
    /// </summary>
    public async Task SoftDeleteAsync(DynamicTable table)
    {
        table.DeletedAt = DateTime.UtcNow;
        table.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    /// <summary>恢复回收站里的表：清掉删除标记即可，数据从未离开过</summary>
    public async Task RestoreAsync(DynamicTable table)
    {
        table.DeletedAt = null;
        table.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// 物理删除（彻底删除 / 过期清理）：AuditLogs / ValidationRules 按 TableId 关联，
    /// 但没有外键，删表时不会自动级联，必须一并清理，否则留下「查不到、也删不掉」的孤儿数据。
    /// （DynamicRows 有外键，随表级联删除；ColorRules 按用户+列共享，不属于单张表，不在此删。）
    /// </summary>
    public async Task PurgeTableAsync(DynamicTable table)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync();
        try
        {
            await _db.AuditLogs.Where(a => a.TableId == table.Id).ExecuteDeleteAsync();
            await _db.ValidationRules.Where(r => r.TableId == table.Id).ExecuteDeleteAsync();

            _db.DynamicTables.Remove(table);
            await _db.SaveChangesAsync();

            await transaction.CommitAsync();
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }

    /// <summary>回收站列表：该用户已软删除的表格（按删除时间倒序），行数用子查询统计</summary>
    public Task<List<TrashItemDto>> GetTrashedAsync(int userId) =>
        _db.DynamicTables
            .Where(t => t.UserId == userId && t.DeletedAt != null)
            .OrderByDescending(t => t.DeletedAt)
            .Select(t => new TrashItemDto
            {
                Id = t.Id,
                TableName = t.TableName,
                RowCount = t.Rows.Count(),
                DeletedAt = t.DeletedAt!.Value
            })
            .ToListAsync();

    /// <summary>物理删除回收站里超过保留期（DeletedAt 早于 cutoff）的表格，返回实际清除张数</summary>
    public async Task<int> PurgeExpiredAsync(DateTime utcCutoff)
    {
        var expired = await _db.DynamicTables
            .Where(t => t.DeletedAt != null && t.DeletedAt < utcCutoff)
            .ToListAsync();

        var purged = 0;
        foreach (var table in expired)
        {
            try
            {
                await PurgeTableAsync(table);   // 每张表独立事务，一张失败只跳过它自己
                purged++;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "回收站过期清理：删除表格 {TableId}「{TableName}」失败，本轮跳过",
                    table.Id, table.TableName);
            }
        }

        return purged;
    }

    /// <summary>
    /// 保存列视图元数据（JSON，null 表示清空）。
    /// 默认不刷新 UpdatedAt：调列宽/隐藏列是视图偏好，不该让表格在列表里跳到最前。
    /// touchUpdatedAt 只给「有实际语义变化」的写入用（目前是计算列的公式）。
    /// </summary>
    public async Task SaveColumnMetaAsync(DynamicTable table, string? metaJson, bool touchUpdatedAt = false)
    {
        table.ColumnMetaJson = metaJson;
        if (touchUpdatedAt) table.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// 用原生 SQL 批量插入多行，避免逐行 SaveChanges 带来的往返开销。
    /// 注意：SQL Server 单条语句的参数上限为 2100，本方法每行占用 3 个参数，
    /// 因此必须分批执行——否则行数超过 700 就会抛「参数过多」而整表导入失败。
    /// </summary>
    public async Task BulkInsertRowsAsync(int tableId, List<Dictionary<string, object>> rows)
    {
        if (rows.Count == 0) return;

        // 每批 500 行 = 1500 个参数，留足安全余量
        const int batchSize = 500;

        var totalSw = Stopwatch.StartNew();
        int batchIndex = 1;

        for (int offset = 0; offset < rows.Count; offset += batchSize)
        {
            var batch = rows.GetRange(offset, Math.Min(batchSize, rows.Count - offset));

            var parameters = new List<SqlParameter>();
            var valueRows = new List<string>(batch.Count);
            int idx = 0;

            foreach (var row in batch)
            {
                parameters.Add(new SqlParameter($"@p{idx}", tableId));
                parameters.Add(new SqlParameter($"@p{idx + 1}", SerializeRow(row)));
                parameters.Add(new SqlParameter($"@p{idx + 2}", DateTime.UtcNow));

                valueRows.Add($"  (@p{idx}, @p{idx + 1}, @p{idx + 2})");
                idx += 3;
            }

            // 用 string.Join 拼接，不依赖换行符长度。
            // 不能再用「AppendLine 后 Length -= N」的写法：Windows 换行是 \r\n（2 字符）、
            // Linux 是 \n（1 字符），按固定长度截断会在 Linux 下多截掉字符导致 SQL 语法错误。
            var insertSql = "INSERT INTO DynamicRows (TableId, DataJson, CreatedAt) VALUES\n"
                          + string.Join(",\n", valueRows);

            // 每批单独计时：导入耗时分布是排查「上传慢」的关键埋点（见 UPGRADE_PLAN 功能 7）
            var batchSw = Stopwatch.StartNew();
            await _db.Database.ExecuteSqlRawAsync(insertSql, parameters.ToArray());
            batchSw.Stop();

            _logger.LogInformation("批量导入 表 {TableId} 第 {BatchIndex} 批 {BatchRows} 行，耗时 {ElapsedMs} ms",
                tableId, batchIndex, batch.Count, batchSw.ElapsedMilliseconds);
            batchIndex++;
        }

        totalSw.Stop();
        _logger.LogInformation("批量导入 表 {TableId} 完成，共 {TotalRows} 行 / {BatchCount} 批，总耗时 {ElapsedMs} ms",
            tableId, rows.Count, batchIndex - 1, totalSw.ElapsedMilliseconds);
    }

    public static string SerializeRow(Dictionary<string, object> row) => JsonSerializer.Serialize(row);

    public static Dictionary<string, object> DeserializeRow(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, object>>(json) ?? new Dictionary<string, object>();

    /// <summary>
    /// 取某列的全部去重值（升序，上限 500 个）——供「跨表引用」校验与前端下拉使用。
    /// JSON 存在 DataJson 里，只能读出后内存去重；500 的上限防止把整列大文本灌给前端。
    /// 过滤掉回收站里的表：被引用的表进了回收站就不该再对外提供值。
    /// </summary>
    public async Task<List<string>> GetDistinctColumnValuesAsync(int tableId, string columnName)
    {
        var rows = await _db.DynamicRows
            .Where(r => r.TableId == tableId && r.Table.DeletedAt == null)
            .ToListAsync();
        var values = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var r in rows)
        {
            var row = DeserializeRow(r.DataJson);
            if (!row.TryGetValue(columnName, out var v)) continue;
            var s = v?.ToString() ?? string.Empty;
            if (s.Length > 0) values.Add(s);
            if (values.Count >= 500) break;
        }
        return values.ToList();
    }
}

/// <summary>整表替换保存时检测到并发冲突的内部信号，携带表 ID 供门面定位</summary>
public class ConcurrencyConflictException : Exception
{
    public int TableId { get; }

    public ConcurrencyConflictException(int tableId)
        : base($"表格 {tableId} 已被其他人修改")
    {
        TableId = tableId;
    }
}
