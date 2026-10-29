using System.Text;
using ExcelToWeb.Data;
using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Services.Excel;

/// <summary>
/// 定时导出产物（<see cref="ExportSnapshot"/>）的落盘与查询。
///
/// 文件存 <c>{ContentRoot}/App_Data/exports/{userId}/</c>，库里存相对路径。
/// 不写进 wwwroot：那是公开静态目录，等于把「报表」变成知道 URL 就能下的文件；
/// 下载必须走带鉴权的接口，由服务端核对归属后再取文件。
///
/// 这类「临时产物目录」的坑在于两边会不同步（库有行文件没了、文件在行没了），
/// 所以清理一律以库为准，并对丢失的文件容错：文件缺失时只删行不报错。
/// </summary>
public class ExportSnapshotService
{
    /// <summary>对外下载的目录名（相对内容根）</summary>
    private const string FolderName = "App_Data/exports";

    private readonly AppDbContext _db;
    private readonly IHostEnvironment _env;
    private readonly ILogger<ExportSnapshotService> _logger;

    public ExportSnapshotService(AppDbContext db, IHostEnvironment env, ILogger<ExportSnapshotService> logger)
    {
        _db = db;
        _env = env;
        _logger = logger;
    }

    /// <summary>快照目录的绝对路径</summary>
    public string RootPath => Path.Combine(_env.ContentRootPath, FolderName);
    // Path.Combine 已按平台处理分隔符；这里把相对路径统一存成正斜杠，换平台也不影响解析
    private static string ToRelative(string path) => path.Replace('\\', '/');

    /// <summary>
    /// 把导出字节写成快照文件并登记一行。返回 null 表示写文件失败（不抛，交给调用方决定要不要继续）。
    ///
    /// 同一天重复执行**覆盖同一行、同一个文件**，而不是每次都插一行：
    /// 文件名是按日期生成的，同一天的第二份本来就是覆盖写；若每次都插新行，
    /// 就会有多行指向同一个路径，等其中一行过期被清理时文件被删掉，
    /// 剩下的行还活着却下载不到——那是最难查的那类 404。
    /// </summary>
    public async Task<ExportSnapshot?> CreateAsync(DynamicTable table, byte[] content, int rowCount)
    {
        var stamp = DateTime.UtcNow.ToString("yyyyMMdd");
        var fileName = $"{stamp}_{Sanitize(table.TableName)}.xlsx";
        var dir = Path.Combine(RootPath, table.UserId.ToString());

        try
        {
            Directory.CreateDirectory(dir);
            var full = Path.Combine(dir, fileName);
            await File.WriteAllBytesAsync(full, content);

            var today = DateTime.UtcNow.Date;
            var snapshot = await _db.ExportSnapshots
                .FirstOrDefaultAsync(s => s.TableId == table.Id && s.CreatedAt >= today);

            if (snapshot == null)
            {
                snapshot = new ExportSnapshot { TableId = table.Id, UserId = table.UserId };
                _db.ExportSnapshots.Add(snapshot);
            }

            // 表名/文件名一起刷新：表格改名后当天的报表要跟着用新名字
            snapshot.TableName = table.TableName;
            snapshot.FileName = fileName;
            snapshot.RelativePath = ToRelative(Path.Combine(FolderName, table.UserId.ToString(), fileName));
            snapshot.SizeBytes = content.LongLength;
            snapshot.RowCount = rowCount;
            snapshot.CreatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();
            return snapshot;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "写导出快照失败：表 {TableId}「{TableName}」", table.Id, table.TableName);
            return null;
        }
    }

    /// <summary>某用户的快照列表（新的在前）</summary>
    public Task<List<ExportSnapshotDto>> ListAsync(int userId, int limit = 50) =>
        _db.ExportSnapshots
            .AsNoTracking()
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CreatedAt)
            .Take(limit)
            .Select(s => new ExportSnapshotDto
            {
                Id = s.Id,
                TableId = s.TableId,
                TableName = s.TableName,
                FileName = s.FileName,
                SizeBytes = s.SizeBytes,
                RowCount = s.RowCount,
                CreatedAt = s.CreatedAt
            })
            .ToListAsync();

    /// <summary>按 id 取快照的绝对路径（已校验归属），文件不存在时返回 null</summary>
    public async Task<(string FullPath, string FileName)?> ResolveAsync(int snapshotId, int userId)
    {
        var snapshot = await _db.ExportSnapshots
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == snapshotId && s.UserId == userId);
        if (snapshot == null) return null;

        var full = Path.Combine(_env.ContentRootPath, snapshot.RelativePath.Replace('/', Path.DirectorySeparatorChar));
        return File.Exists(full) ? (full, snapshot.FileName) : null;
    }

    /// <summary>
    /// 删除早于 cutoff 的快照：先删库行，再尽力删文件。
    /// 顺序是刻意的——库行删掉后这份快照就永远不会再被下载到，
    /// 文件删失败最多留个孤儿文件，反过来则会「文件没了但列表还在」，用户点到必 404。
    /// </summary>
    public async Task<int> PurgeExpiredAsync(DateTime cutoff)
    {
        var expired = await _db.ExportSnapshots.Where(s => s.CreatedAt < cutoff).ToListAsync();
        if (expired.Count == 0) return 0;

        _db.ExportSnapshots.RemoveRange(expired);
        await _db.SaveChangesAsync();

        foreach (var snapshot in expired)
        {
            try
            {
                var full = Path.Combine(_env.ContentRootPath,
                    snapshot.RelativePath.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(full)) File.Delete(full);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "删除过期快照文件失败（不影响记录已清除）：{Path}", snapshot.RelativePath);
            }
        }

        return expired.Count;
    }

    /// <summary>清理空目录（某用户所有快照都过期后，目录会留下来），失败忽略</summary>
    public void RemoveEmptyUserFolders()
    {
        if (!Directory.Exists(RootPath)) return;

        foreach (var dir in Directory.GetDirectories(RootPath))
        {
            try
            {
                if (Directory.GetFiles(dir).Length == 0 && Directory.GetDirectories(dir).Length == 0)
                    Directory.Delete(dir);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "清理空目录失败：{Dir}", dir);
            }
        }
    }

    /// <summary>
    /// 自愈：删掉「库中没有对应记录」的孤儿文件。
    ///
    /// 为什么需要它：表格被彻底删除时，快照行靠外键级联一起没了，但磁盘上的 xlsx 不会自己消失
    /// （清库和删文件不在同一个事务里，也不可能在）。不处理的话，这些文件会永久占着磁盘，
    /// 而且列表里看不到、用户也删不掉。
    ///
    /// 方向是「以库为准删文件」，绝不能反过来「以文件为准补记录」——
    /// 那份 xlsx 已经没有任何用户能访问到，补回记录等于凭空造出一份报表。
    /// </summary>
    public async Task<int> PruneOrphanFilesAsync()
    {
        if (!Directory.Exists(RootPath)) return 0;

        var known = await _db.ExportSnapshots
            .AsNoTracking()
            .Select(s => s.RelativePath)
            .ToListAsync();
        var knownSet = new HashSet<string>(known, StringComparer.OrdinalIgnoreCase);

        var removed = 0;
        foreach (var file in Directory.GetFiles(RootPath, "*", SearchOption.AllDirectories))
        {
            var rel = ToRelative(Path.GetRelativePath(_env.ContentRootPath, file));
            if (knownSet.Contains(rel)) continue;

            try
            {
                File.Delete(file);
                removed++;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "删除孤儿快照文件失败：{Path}", rel);
            }
        }

        return removed;
    }

    /// <summary>去掉文件名里不能落盘 / 会被当成路径的字符，并限制长度</summary>
    private static string Sanitize(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var builder = new StringBuilder(name.Length);
        foreach (var ch in name)
            builder.Append(Array.IndexOf(invalid, ch) >= 0 ? '_' : ch);

        var clean = builder.ToString().Trim().TrimEnd('.');
        if (clean.Length == 0) clean = "table";
        return clean.Length > 60 ? clean[..60] : clean;
    }
}
