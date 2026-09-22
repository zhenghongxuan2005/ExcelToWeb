using System.Text;
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

    public TableRepository(AppDbContext db) => _db = db;

    /// <summary>按「表格ID + 归属用户」查找，天然完成越权校验</summary>
    public Task<DynamicTable?> FindTableAsync(int tableId, int userId) =>
        _db.DynamicTables.FirstOrDefaultAsync(t => t.Id == tableId && t.UserId == userId);

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

    /// <summary>只返回确实有数据行的表格（与列表接口原有语义一致）</summary>
    public Task<List<TableInfoDto>> GetTableInfosAsync(int userId) =>
        _db.DynamicTables
            .Where(t => t.UserId == userId && _db.DynamicRows.Any(r => r.TableId == t.Id))
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

    /// <summary>取当前用户全部表格名（含空表），用于生成不重名的副本名称</summary>
    public Task<List<string>> GetTableNamesAsync(int userId) =>
        _db.DynamicTables
            .Where(t => t.UserId == userId)
            .Select(t => t.TableName)
            .ToListAsync();

    /// <summary>生成副本名，形如「销售表 - 副本」「销售表 - 副本(2)」，避免与现有表格重名</summary>
    public async Task<string> BuildCopyNameAsync(string sourceName, int userId)
    {
        var existing = await GetTableNamesAsync(userId);

        var baseName = $"{sourceName} - 副本";
        if (!existing.Contains(baseName)) return baseName;

        for (int i = 2; i <= 999; i++)
        {
            var candidate = $"{baseName}({i})";
            if (!existing.Contains(candidate)) return candidate;
        }

        // 极端情况下兜底：加时间戳，保证一定能插入
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
        table.UpdatedAt = DateTime.Now;
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
            CreatedAt = DateTime.Now,
            UpdatedAt = DateTime.Now
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
                CreatedAt = DateTime.Now
            });
            await _db.DynamicRows.AddRangeAsync(newRows);

            table.UpdatedAt = DateTime.Now;
            await _db.SaveChangesAsync();

            await transaction.CommitAsync();
        }
        catch
        {
            // 回滚保证「要么整体替换成功，要么保持原样」
            await transaction.RollbackAsync();
            throw;
        }
    }

    public async Task DeleteTableAsync(DynamicTable table)
    {
        _db.DynamicTables.Remove(table);
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// 保存列视图元数据（JSON，null 表示清空）。
    /// 默认不刷新 UpdatedAt：调列宽/隐藏列是视图偏好，不该让表格在列表里跳到最前。
    /// touchUpdatedAt 只给「有实际语义变化」的写入用（目前是计算列的公式）。
    /// </summary>
    public async Task SaveColumnMetaAsync(DynamicTable table, string? metaJson, bool touchUpdatedAt = false)
    {
        table.ColumnMetaJson = metaJson;
        if (touchUpdatedAt) table.UpdatedAt = DateTime.Now;
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

        for (int offset = 0; offset < rows.Count; offset += batchSize)
        {
            var batch = rows.GetRange(offset, Math.Min(batchSize, rows.Count - offset));

            var insertSql = new StringBuilder();
            insertSql.AppendLine("INSERT INTO DynamicRows (TableId, DataJson, CreatedAt) VALUES");

            var parameters = new List<SqlParameter>();
            int idx = 0;

            foreach (var row in batch)
            {
                parameters.Add(new SqlParameter($"@p{idx}", tableId));
                parameters.Add(new SqlParameter($"@p{idx + 1}", SerializeRow(row)));
                parameters.Add(new SqlParameter($"@p{idx + 2}", DateTime.Now));

                insertSql.AppendLine($"  (@p{idx}, @p{idx + 1}, @p{idx + 2}),");
                idx += 3;
            }

            // 去掉最后一行的逗号与换行
            insertSql.Length -= 3;

            await _db.Database.ExecuteSqlRawAsync(insertSql.ToString(), parameters.ToArray());
        }
    }

    public static string SerializeRow(Dictionary<string, object> row) => JsonSerializer.Serialize(row);

    public static Dictionary<string, object> DeserializeRow(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, object>>(json) ?? new Dictionary<string, object>();

    /// <summary>
    /// 取某列的全部去重值（升序，上限 500 个）——供「跨表引用」校验与前端下拉使用。
    /// JSON 存在 DataJson 里，只能读出后内存去重；500 的上限防止把整列大文本灌给前端。
    /// </summary>
    public async Task<List<string>> GetDistinctColumnValuesAsync(int tableId, string columnName)
    {
        var rows = await GetRowsAsync(tableId);
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
