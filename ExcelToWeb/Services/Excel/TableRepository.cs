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

    public async Task AddTableAsync(DynamicTable table)
    {
        await _db.DynamicTables.AddAsync(table);
        await _db.SaveChangesAsync();
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
    /// 用原生 SQL 一次性插入多行，避免逐行 SaveChanges 带来的往返开销。
    /// </summary>
    public async Task BulkInsertRowsAsync(int tableId, List<Dictionary<string, object>> rows)
    {
        if (rows.Count == 0) return;

        var insertSql = new StringBuilder();
        insertSql.AppendLine("INSERT INTO DynamicRows (TableId, DataJson, CreatedAt) VALUES");

        var parameters = new List<SqlParameter>();
        int idx = 0;

        foreach (var row in rows)
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

    public static string SerializeRow(Dictionary<string, object> row) => JsonSerializer.Serialize(row);

    public static Dictionary<string, object> DeserializeRow(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, object>>(json) ?? new Dictionary<string, object>();
}
