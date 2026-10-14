using ExcelToWeb.Data;
using ExcelToWeb.Helpers;
using ExcelToWeb.Models;
using ExcelToWeb.Services.Excel;
using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Services;

/// <summary>
/// 演示账号的约定：用户名固定为 demo，密码直接公开在登录页上——演示账号本来就是给
/// recruiter / 试用者一键进入用的，不构成凭据泄露。
/// 服务端判定只读的依据就是「用户名 == demo」（见 ExcelService 的 IsDemoReadOnly），
/// 只在前端置灰按钮拦不住直接调 API 的人，所以拦截必须在门面层。
/// </summary>
public static class DemoAccount
{
    public const string Username = "demo";
    public const string Password = "demo1234";
}

/// <summary>
/// 启动时幂等 seed：没有 demo 用户则创建（PBKDF2 正常哈希），该用户名下没有样例表则
/// 建两张有看点的示例表（销售数据、项目排期）。重复启动、已有数据都不会重复插入。
/// 样例数据走 TableRepository 的正常落库路径（BulkInsertRowsAsync），与导入产生的表结构完全一致。
/// </summary>
public static class DemoSeeder
{
    public static async Task SeedAsync(AppDbContext db, TableRepository repository, ILogger logger)
    {
        var demo = await db.Users.FirstOrDefaultAsync(u => u.Username == DemoAccount.Username);
        if (demo == null)
        {
            demo = new User
            {
                Username = DemoAccount.Username,
                PasswordHash = PasswordHelper.HashPassword(DemoAccount.Password),
                CreatedAt = DateTime.UtcNow
            };
            await db.Users.AddAsync(demo);
            await db.SaveChangesAsync();
            logger.LogInformation("已创建演示账号 {Username}", DemoAccount.Username);
        }
        else
        {
            // 自愈：demo 密码公开在登录页，挡不住有人登录后调改密接口把密码改掉
            //（改密接口已拦截 demo，但历史上改掉的、或绕过拦截面产生的改动，都在这里兜底）。
            // 校验公开约定密码的哈希，不匹配就重置回去，重启即恢复演示入口。
            if (!PasswordHelper.VerifyPassword(DemoAccount.Password, demo.PasswordHash, out _))
            {
                demo.PasswordHash = PasswordHelper.HashPassword(DemoAccount.Password);
                await db.SaveChangesAsync();
                logger.LogWarning("演示账号密码被改动过，已重置回公开约定值 {Username}", DemoAccount.Username);
            }
        }

        var existing = await repository.GetTableNamesAsync(demo.Id);
        await SeedTableAsync(repository, demo.Id, existing, "示例 · 月度销售数据",
            SalesHeaders, SalesRows, logger);
        await SeedTableAsync(repository, demo.Id, existing, "示例 · 项目排期",
            ScheduleHeaders, ScheduleRows, logger);
    }

    private static async Task SeedTableAsync(
        TableRepository repository, int userId, List<string> existingNames,
        string tableName, string[] headers, string[][] rows, ILogger logger)
    {
        if (existingNames.Contains(tableName)) return;

        var table = new DynamicTable
        {
            TableName = tableName,
            Headers = new List<string>(headers),
            UserId = userId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        await repository.AddTableAsync(table);

        var data = rows.Select(r =>
        {
            var dict = new Dictionary<string, object>(r.Length);
            for (int i = 0; i < headers.Length; i++) dict[headers[i]] = r[i];
            return dict;
        }).ToList();
        await repository.BulkInsertRowsAsync(table.Id, data);

        logger.LogInformation("已创建演示样例表 {TableName}（{RowCount} 行）", tableName, data.Count);
    }

    // ------------------------------------------------------------------
    // 样例数据：数值列给区间感（条件配色/看板有东西可展示），日期列用 yyyy-MM-dd
    // （与导入时 Excel 日期序列号的转换结果一致），文本列贴近真实业务。
    // ------------------------------------------------------------------
    private static readonly string[] SalesHeaders = { "月份", "产品线", "销售额", "销量", "毛利率", "区域" };

    private static readonly string[][] SalesRows =
    {
        new[] { "2026-01", "办公套装", "128500", "420", "0.32", "华东" },
        new[] { "2026-01", "云端订阅", "96300", "310", "0.58", "华南" },
        new[] { "2026-02", "办公套装", "143200", "465", "0.33", "华东" },
        new[] { "2026-02", "云端订阅", "112800", "352", "0.61", "华北" },
        new[] { "2026-03", "办公套装", "157600", "510", "0.30", "华东" },
        new[] { "2026-03", "云端订阅", "134500", "401", "0.59", "西南" },
        new[] { "2026-04", "办公套装", "139800", "447", "0.31", "华南" },
        new[] { "2026-04", "云端订阅", "152100", "458", "0.62", "华东" },
        new[] { "2026-05", "办公套装", "168900", "538", "0.34", "华北" },
        new[] { "2026-05", "云端订阅", "171400", "492", "0.60", "华东" },
        new[] { "2026-06", "办公套装", "185200", "589", "0.35", "华东" },
        new[] { "2026-06", "云端订阅", "196700", "541", "0.63", "华南" },
    };

    private static readonly string[] ScheduleHeaders = { "任务名称", "负责人", "开始日期", "截止日期", "状态", "完成度" };

    private static readonly string[][] ScheduleRows =
    {
        new[] { "需求评审", "张伟", "2026-09-01", "2026-09-05", "已完成", "100%" },
        new[] { "数据库设计", "李娜", "2026-09-08", "2026-09-19", "已完成", "100%" },
        new[] { "后端接口开发", "王强", "2026-09-22", "2026-10-24", "进行中", "65%" },
        new[] { "前端页面开发", "赵敏", "2026-10-06", "2026-11-06", "进行中", "40%" },
        new[] { "联调测试", "陈杰", "2026-11-09", "2026-11-27", "未开始", "0%" },
        new[] { "性能压测", "孙丽", "2026-11-30", "2026-12-11", "未开始", "0%" },
        new[] { "部署上线", "周涛", "2026-12-14", "2026-12-18", "未开始", "0%" },
        new[] { "文档交付", "吴静", "2026-12-14", "2026-12-25", "未开始", "0%" },
    };
}
