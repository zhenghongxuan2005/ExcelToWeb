using ExcelToWeb.Data;
using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 规则的数据访问与替换写入：颜色规则（按用户 + 列）与校验规则（按表格）。
/// 归属校验由门面负责（先确认表属于当前用户），这里只处理「读写规则」本身。
/// </summary>
public class RuleService
{
    private readonly AppDbContext _db;

    public RuleService(AppDbContext db) => _db = db;

    // ================================================================
    // 颜色规则
    // ================================================================
    public async Task<List<ColorRule>> GetColorRulesAsync(int userId, string? columnName = null)
    {
        var query = _db.ColorRules.Where(r => r.UserId == userId);
        if (!string.IsNullOrEmpty(columnName))
            query = query.Where(r => r.ColumnName == columnName);

        return await query.OrderBy(r => r.MinValue).ToListAsync();
    }

    /// <summary>
    /// 替换某一列的颜色规则（先删后写），返回写入条数。
    /// 返回条数而不是 void，便于门面生成「成功保存 N 条」的提示。
    /// </summary>
    public async Task<int> ReplaceColorRulesAsync(int userId, List<ColorRule> rules)
    {
        if (rules.Count == 0) return 0;

        // 以第一条的列名为准——一个请求只处理同一列的规则
        var columnName = rules[0].ColumnName;
        var oldRules = await _db.ColorRules
            .Where(r => r.UserId == userId && r.ColumnName == columnName)
            .ToListAsync();
        _db.ColorRules.RemoveRange(oldRules);

        foreach (var rule in rules)
        {
            rule.UserId = userId;
            rule.CreatedAt = DateTime.Now;
            rule.UpdatedAt = DateTime.Now;
            await _db.ColorRules.AddAsync(rule);
        }
        await _db.SaveChangesAsync();

        return rules.Count;
    }

    // ================================================================
    // 校验规则
    // ================================================================
    public Task<List<ValidationRule>> GetValidationRulesAsync(int tableId) =>
        _db.ValidationRules
            .Where(r => r.TableId == tableId)
            .ToListAsync();

    /// <summary>替换某表格的全部校验规则（先删后写），返回写入条数</summary>
    public async Task<int> ReplaceValidationRulesAsync(int tableId, List<ValidationRule> rules)
    {
        if (rules.Count == 0) return 0;

        var oldRules = await _db.ValidationRules.Where(r => r.TableId == tableId).ToListAsync();
        _db.ValidationRules.RemoveRange(oldRules);

        foreach (var rule in rules)
        {
            rule.TableId = tableId;
            rule.CreatedAt = DateTime.Now;
            rule.UpdatedAt = DateTime.Now;
            await _db.ValidationRules.AddAsync(rule);
        }
        await _db.SaveChangesAsync();

        return rules.Count;
    }

    /// <summary>
    /// 列结构变动时的规则迁移：删除引用了 dropped 列的规则，把引用了 renamed 列的规则改名跟随。
    /// 调用方应包在事务里；本方法内部也会 SaveChangesAsync，但只要在同一 DbContext 里就会一起提交。
    /// </summary>
    public async Task<int> MigrateForColumnsAsync(int userId, int tableId,
        IEnumerable<ColumnRenameItem> renames, IEnumerable<string> dropped)
    {
        var droppedList = dropped?.ToList() ?? new List<string>();
        var renameList = renames?.ToList() ?? new List<ColumnRenameItem>();
        var deleted = 0;

        // 1) 删除引用了 dropped 列的规则
        if (droppedList.Count > 0)
        {
            var droppedSet = new HashSet<string>(droppedList, StringComparer.Ordinal);

            var oldColor = await _db.ColorRules
                .Where(r => r.UserId == userId && droppedSet.Contains(r.ColumnName))
                .ToListAsync();
            _db.ColorRules.RemoveRange(oldColor);
            deleted += oldColor.Count;

            var oldVal = await _db.ValidationRules
                .Where(r => r.TableId == tableId && droppedSet.Contains(r.ColumnName))
                .ToListAsync();
            _db.ValidationRules.RemoveRange(oldVal);
            deleted += oldVal.Count;
        }

        // 2) 引用了 renamed 列的规则改名跟随
        foreach (var item in renameList)
        {
            var renameColor = await _db.ColorRules
                .Where(r => r.UserId == userId && r.ColumnName == item.OldName)
                .ToListAsync();
            foreach (var r in renameColor) r.ColumnName = item.NewName;

            var renameVal = await _db.ValidationRules
                .Where(r => r.TableId == tableId && r.ColumnName == item.OldName)
                .ToListAsync();
            foreach (var r in renameVal) r.ColumnName = item.NewName;
        }

        if (deleted > 0 || renameList.Count > 0)
            await _db.SaveChangesAsync();

        return deleted;
    }
}
