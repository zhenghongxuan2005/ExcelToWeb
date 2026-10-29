using System.Text;
using System.Threading.RateLimiting;
using ExcelToWeb.Auth;
using ExcelToWeb.Caching;
using ExcelToWeb.Data;
using ExcelToWeb.Helpers;
using ExcelToWeb.HealthChecks;
using ExcelToWeb.Jobs;
using ExcelToWeb.Middleware;
using ExcelToWeb.Services;
using ExcelToWeb.Services.Excel;
using Hangfire;
using Hangfire.Dashboard;
using Hangfire.SqlServer;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using OfficeOpenXml;
using Serilog;
using Serilog.Events;
using Serilog.Formatting.Compact;
using StackExchange.Redis;

// EPPlus 许可证（非商业用途）。
// EPPlus 7+ 移除了 ExcelPackage.LicenseContext，改为在 ExcelPackage.License 上显式声明；
// 本项为本科毕业设计，属非商业个人使用，与 LICENSE 中的 MIT + Polyform Noncommercial 说明一致。
ExcelPackage.License.SetNonCommercialPersonal("郑鸿煊");

var builder = WebApplication.CreateBuilder(args);

// 端口兜底：仅在「本地开发且平台未注入监听地址」时监听 5185。
// 生产环境（Azure 容器 / Container Apps）通过 ASPNETCORE_URLS 指定端口，
// 无条件 UseUrls 会覆盖它，导致平台探活打不通、应用被判为启动失败。
if (builder.Environment.IsDevelopment()
    && string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    builder.WebHost.UseUrls("http://localhost:5185");
}

// ===== 结构化日志（Serilog，UPGRADE_PLAN 功能 7） =====
// Development 输出控制台便于本地观察；生产输出 JSON 文件（按天滚动、保留 14 天），
// 字段名与值都是结构化的，可直接被日志采集器 / Application Insights 摄取、按属性检索。
// Microsoft 命名空间压到 Warning：EF Core 的连接池、路由匹配等框架噪声不淹没业务埋点，
// 仅保留「应用启动/停止」这条运维最关心的框架日志。
builder.Host.UseSerilog((context, config) =>
{
    config
        .MinimumLevel.Information()
        .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
        .MinimumLevel.Override("Microsoft.Hosting.Lifetime", LogEventLevel.Information)
        .Enrich.WithProperty("Application", "ExcelToWeb");

    if (context.HostingEnvironment.IsDevelopment())
    {
        config.WriteTo.Console();
    }
    else
    {
        config.WriteTo.File(
            new CompactJsonFormatter(),
            Path.Combine("logs", "app-.json"),
            rollingInterval: RollingInterval.Day,
            retainedFileCountLimit: 14);
    }
});

// ===== 数据库 =====
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlServer(connectionString));

// ===== 分布式缓存 =====
// 默认走进程内内存实现：本地开发、单机部署、自动化测试都不需要额外装 Redis。
// 配 Cache:Provider=redis 时切到 Redis（Cache:Redis:Connection 必填）。
// 业务代码只依赖 IDistributedCache 抽象，切换后端不需要改任何一行业务逻辑。
//
// 为什么接口选 IDistributedCache 而不是 IMemoryCache：
// 一旦按容器多副本部署，内存缓存是「每副本一份」。改完角色后主动失效只打到一个副本，
// 其余副本还拿着旧角色继续放行——这不叫缓存不一致，这叫权限漏洞。
// 直接上分布式抽象，单机时它会退化成进程内字典，没有额外成本。
var cacheProvider = builder.Configuration["Cache:Provider"] ?? "memory";
if (cacheProvider.Equals("redis", StringComparison.OrdinalIgnoreCase))
{
    var redisConnection = builder.Configuration["Cache:Redis:Connection"];
    if (string.IsNullOrWhiteSpace(redisConnection))
    {
        throw new InvalidOperationException(
            "Cache:Provider=redis 时必须通过 Cache:Redis:Connection（或环境变量 Cache__Redis__Connection）提供连接串");
    }

    builder.Services.AddStackExchangeRedisCache(options =>
    {
        var redisOptions = ConfigurationOptions.Parse(redisConnection);
        // 启动时连不上不要抛：多副本滚动更新、Redis 比应用晚起来都属于正常情况，
        // 缓存不可用应该降级成「直接走数据库」，而不是让整个应用起不来。
        redisOptions.AbortOnConnectFail = false;
        // 超时压到 1 秒：默认 5 秒会让「Redis 不可达」时每个请求都额外等好几秒，
        // 比不用缓存还慢（实测未调之前一个请求能拖到 25 秒）。AppCache 还有熔断兜底。
        redisOptions.ConnectTimeout = 1000;
        redisOptions.SyncTimeout = 1000;
        redisOptions.ConnectRetry = 1;

        options.ConfigurationOptions = redisOptions;
        // 实例前缀让「同一个 Redis 被多个应用共用」时键不打架，也方便按前缀整体清理
        options.InstanceName = builder.Configuration["Cache:Redis:InstanceName"] ?? "exceltoweb:";
    });
}
else
{
    builder.Services.AddDistributedMemoryCache();
}
builder.Services.AddSingleton<AppCache>();

// ===== 后台任务调度（Hangfire）=====
// 换掉原来的「手写 BackgroundService + Task.Delay(24h)」循环，理由见 Jobs/RecycleBinCleanupJob.cs：
// 执行记录可查、不因进程重启丢掉一整轮、多副本下靠存储里的锁保证只跑一次。
//
// 任务状态存在业务库里（HangFire.* 表，由 Hangfire 自己建，不走 EF 迁移）：
// 换来的是「不额外引入一套中间件」；代价是业务库与任务调度耦合，库里锁表时任务也会卡。
// 真到那一步再把它换到独立的库/Redis 存储即可，代码不用动。
var hangfireEnabled = builder.Configuration.GetValue<bool>("Hangfire:Enabled");
if (hangfireEnabled)
{
    builder.Services.AddHangfire(config => config
        .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
        .UseSimpleAssemblyNameTypeSerializer()
        .UseRecommendedSerializerSettings()
        .UseSqlServerStorage(connectionString, new SqlServerStorageOptions
        {
            CommandBatchMaxTimeout = TimeSpan.FromMinutes(5),
            // 滑动可见性超时 + 关掉全局锁：这两个是 Hangfire 在 SQL Server 上的官方推荐配置，
            // 前者避免长任务被误判为「worker 已死」而被重复执行，后者减少跨实例的锁竞争
            SlidingInvisibilityTimeout = TimeSpan.FromMinutes(5),
            QueuePollInterval = TimeSpan.Zero,
            UseRecommendedIsolationLevel = true,
            DisableGlobalLocks = true
        }));

    // WorkerCount 给 2 而不是默认的 20：本项目只有两条轻量任务，
    // 开一堆空闲 worker 只会让它们对着 SQL Server 空轮询。
    builder.Services.AddHangfireServer(options => options.WorkerCount = 2);
}

// ===== JWT 认证 =====
// 密钥不进仓库：本地开发用 dotnet user-secrets（Jwt:Key），生产环境用环境变量 Jwt__Key。
// 生产环境额外拒绝占位串与过短密钥——原来的 `?? throw` 只在键缺失时生效，
// 占位串是非空合法值，守卫会哑火，公开仓库里的字符串就成了真实签名密钥。
var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("Jwt:Key 未配置");
if (!builder.Environment.IsDevelopment() &&
    (jwtKey.StartsWith("CHANGE_ME") || jwtKey.Length < 32))
{
    throw new InvalidOperationException(
        "生产环境必须通过环境变量 Jwt__Key 提供 ≥32 字符的独立密钥");
}

// Windows 集成身份验证开关：只在启用时注册 Negotiate scheme。
// Azure 等无域环境下必须保持关闭，否则 /api/auth/windows 会暴露一个必然失败的端点。
// 默认 false；本地开发在 appsettings.Development.json 里置为 true。
var enableWindowsAuth = builder.Configuration.GetValue<bool>("Auth:EnableWindows");

var authBuilder = builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = builder.Configuration["Jwt:Issuer"],
        ValidAudience = builder.Configuration["Jwt:Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        ClockSkew = TimeSpan.Zero
    };
});

// Windows 集成身份验证（NTLM/Kerberos），仅 /api/auth/windows 端点使用
if (enableWindowsAuth)
{
    authBuilder.AddNegotiate();
}

// ===== 授权（RBAC 三档角色）=====
// 每个权限码注册成一条策略，控制器上直接写 [Authorize(Policy = Permission.TableWrite)]：
// 策略名与权限码同串，接口层不需要再造一套命名。
// 判定逻辑在 PermissionHandler（角色从库里读，不信令牌里的快照）。
builder.Services.AddAuthorization(options =>
{
    foreach (var permission in Rbac.All)
    {
        // RequireAuthenticatedUser：未登录要返回 401 挑战，而不是「权限不足」的 403。
        // 少了这一条，匿名请求会走到权限判定、判定失败后返回 403，前端就分不清
        // 「该重新登录」和「账号被降级」了
        options.AddPolicy(permission, policy => policy
            .RequireAuthenticatedUser()
            .AddRequirements(new PermissionRequirement(permission)));
    }
});
builder.Services.AddScoped<IAuthorizationHandler, PermissionHandler>();
// 403 也返回统一 ApiResponse（带「需要哪种权限」），前端才能给出可读提示
builder.Services.AddSingleton<IAuthorizationMiddlewareResultHandler, PermissionResultHandler>();

// ===== 服务注册 =====
// 无状态的读表 / 校验工具，注册为单例即可
builder.Services.AddSingleton<ExcelSheetReader>();
builder.Services.AddSingleton<CsvSheetReader>();
builder.Services.AddSingleton<RowValidator>();
// 依赖 AppDbContext（Scoped），生命周期保持一致
builder.Services.AddScoped<TableRepository>();
builder.Services.AddScoped<RuleService>();
builder.Services.AddScoped<ColumnStructureService>();
builder.Services.AddScoped<ColumnMetaService>();
builder.Services.AddScoped<ComputedColumnService>();
builder.Services.AddScoped<ExcelExportService>();
// 透视：PivotService 是唯一一份计算，PivotExportService 只做排版（依赖上者 + ExcelExportService）
builder.Services.AddScoped<PivotService>();
builder.Services.AddScoped<PivotExportService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<TableImportService>();

builder.Services.AddScoped<IExcelService, ExcelService>();
builder.Services.AddScoped<ITokenService, TokenService>();
builder.Services.AddScoped<RefreshTokenService>();
// 回收站（功能 9）：接口层直接注入 TrashService；过期清理由 Hangfire 的 recycle-bin-cleanup 任务执行
builder.Services.AddScoped<TrashService>();
// 定时导出的产物服务：控制器查/下载它，后台任务写它，两边共用一套目录与命名规则
builder.Services.AddScoped<ExportSnapshotService>();
// Hangfire 任务类。Hangfire 通过 DI 创建任务实例，这里必须注册，
// 否则调度到点会报「无法解析类型」。用 Scoped：任务里各自开 scope 取 DbContext
builder.Services.AddScoped<RecycleBinCleanupJob>();
builder.Services.AddScoped<DailyExportJob>();
// ExcelService 的演示账号只读拦截需要读当前 HTTP 请求的 JWT claims
builder.Services.AddHttpContextAccessor();

// ===== RFC 7807 ProblemDetails（UPGRADE_PLAN 功能 10） =====
// 统一错误出口：未捕获异常由 ExceptionMiddleware 以 application/problem+json 返回，
// [ApiController] 的参数校验 400 也自动使用同一格式 —— 客户端只需处理一种错误结构。
builder.Services.AddProblemDetails();

// ===== 健康检查 =====
// /health 存活探针不含 SQL 检查（数据库闪断不应导致容器被反复重启），
// /health/ready 就绪探针才检查数据库连通性，靠 tag 区分。
builder.Services.AddHealthChecks()
    .AddCheck<DatabaseHealthCheck>("sqlserver", tags: ["ready"]);

// ===== 控制器 + Swagger =====
// 输出时间统一按 UTC（带 Z）序列化，见 UtcDateTimeJsonConverter
builder.Services.AddControllers()
    .AddJsonOptions(options =>
        options.JsonSerializerOptions.Converters.Add(new UtcDateTimeJsonConverter()));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "ExcelToWeb API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Authorization header. 格式: Bearer {token}",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
});

// ===== CORS =====
// 前端静态文件由本应用同源托管，正常访问无需跨域。
// 开发环境放开，方便 file:// 或独立前端 dev server 调试；
// 生产环境只放行 Cors:AllowedOrigins 中显式配置的来源，未配置则不启用跨域。
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (builder.Environment.IsDevelopment())
        {
            policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
        }
        else if (allowedOrigins.Length > 0)
        {
            policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod();
        }
    });
});

// ===== 限流 =====
// 登录 / 注册按「客户端 IP」分区限流（每个 IP 独立配额），防止公网上无限次爆破密码
// （PBKDF2 只提高单次成本，挡不住次数）。超限返回 429。
// 用分区而不是全局配额：全局配额会让 NAT 后的整间办公室、或恶意喷洒把所有人的登录一起锁死。
// 配额走配置：开发环境（含自动化测试，后端用例会密集登录）在
// appsettings.Development.json 里放宽，生产保持默认 10 次/分钟。
// 注意：部署在反向代理（App Service 等）后面时，需让应用取到真实客户端 IP
// （容器设 ASPNETCORE_FORWARDEDHEADERS_ENABLED=true），否则会全部算作代理 IP、退化成全局配额。
var authPermitLimit = builder.Configuration.GetValue<int?>("RateLimit:AuthPermitLimit") ?? 10;
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("auth", httpContext =>
    {
        var ip = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(ip, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = authPermitLimit,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        });
    });

    // 限流拒绝是安全事件（大概率是密码爆破尝试）：记 Warning 带来源 IP，
    // 部署后可在日志平台按 IP 聚合、确认是否需要拉黑（UPGRADE_PLAN 功能 7 埋点）。
    options.OnRejected = (context, _) =>
    {
        var logger = context.HttpContext.RequestServices.GetRequiredService<ILogger<Program>>();
        logger.LogWarning("限流拒绝：{Path} 来自 {RemoteIp}",
            context.HttpContext.Request.Path,
            context.HttpContext.Connection.RemoteIpAddress);
        return ValueTask.CompletedTask;
    };
});

var app = builder.Build();

// ===== 自动迁移数据库（含老库平滑过渡） =====
// 三种启动场景：
//   1. 全新部署（库不存在）：Migrate() 自己会先建库再应用迁移，这里不能提前打开
//      业务库连接——登录时打不开不存在的初始目录会直接报 4060。
//   2. 老库（EnsureCreated 时代建的）：表结构已与当前模型一致，但没有迁移历史表，
//      直接 Migrate() 会试图重建已有表。检测到「业务表在、历史表不在」时，补建
//      历史表并把 Baseline 标记为已应用，之后的增量迁移走标准流程。
//   3. 正常迁移过的库：什么检测都不用做，Migrate() 幂等。
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var csb = new SqlConnectionStringBuilder(db.Database.GetConnectionString());

    // 业务库名先取出来：ExistsIn 会改写 csb.InitialCatalog（连接 master 时被改成 "master"），
    // 若这里直接用 csb.InitialCatalog 当参数，调用 DatabaseExists() 之后取到的已是 "master"，
    // TableExistsInBusinessDb 就会去 master 里找业务表 → 永远 false → 过渡块被静默跳过
    var businessDb = csb.InitialCatalog;

    bool ExistsIn(string catalog, string sql, string name)
    {
        csb.InitialCatalog = catalog;
        using var conn = new SqlConnection(csb.ConnectionString);
        conn.Open();
        using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@name", name);
        return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
    }

    bool DatabaseExists() => ExistsIn("master",
        "SELECT COUNT(*) FROM sys.databases WHERE name = @name", businessDb);
    bool TableExistsInBusinessDb(string table) => ExistsIn(businessDb,
        "SELECT COUNT(*) FROM sys.tables WHERE name = @name", table);

    if (DatabaseExists() && TableExistsInBusinessDb("Users") && !TableExistsInBusinessDb("__EFMigrationsHistory"))
    {
        // 历史表结构与 EF Core SqlServer 约定一致（MigrationId nvarchar(150) + ProductVersion nvarchar(32)）
        // 标记的一定是第一个迁移（Baseline）：老库结构在打 Baseline 时与模型一致，
        // 之后的增量迁移（如软删除列）必须照常执行，标成最新迁移会把增量跳过去
        var baselineId = db.Database.GetMigrations().First();
        await db.Database.ExecuteSqlAsync($"""
            -- RowVersion 列在 P1 轮是手写 DDL 补的，只覆盖了当时跑过新代码的库；
            -- 若有更老的库直接过渡到这里，缺列会让保存必炸，标记 Baseline 前先补齐
            IF COL_LENGTH('DynamicTables', 'RowVersion') IS NULL
                ALTER TABLE [DynamicTables] ADD [RowVersion] rowversion;
            CREATE TABLE [__EFMigrationsHistory] (
                [MigrationId] nvarchar(150) NOT NULL,
                [ProductVersion] nvarchar(32) NOT NULL,
                CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId]));
            INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
            VALUES ({baselineId}, N'10.0.10');
            """);
    }

    await db.Database.MigrateAsync();

    // ===== 演示账号 + 样例数据（幂等：已有则跳过） =====
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    var repository = scope.ServiceProvider.GetRequiredService<TableRepository>();
    await DemoSeeder.SeedAsync(db, repository, logger);
}

// ===== 注册重复任务（Hangfire recurring jobs）=====
// AddOrUpdate 是幂等的：每次启动都用代码里的 cron 覆盖存储里的定义，
// 所以「改调度时间」只需要改这里的两个字面量并重启。
// 反过来也是约束：**不要在 Dashboard 上手工改 cron**，下次重启会被覆盖回代码里的值。
if (hangfireEnabled)
{
    using var jobScope = app.Services.CreateScope();
    var recurring = jobScope.ServiceProvider.GetRequiredService<IRecurringJobManager>();

    // 用服务器本地时区而不是 UTC：这两条任务的名字里就写着「每天几点」，
    // 运维看日志时也该看到本地时间。容器部署时记得把 TZ 设成 Asia/Shanghai。
    var timeZone = TimeZoneInfo.Local;

    // 回收站清理：每天 03:00，物理删除超过保留期的表格 + 过期/吊销的刷新令牌
    recurring.AddOrUpdate<RecycleBinCleanupJob>(
        "recycle-bin-cleanup",
        job => job.RunAsync(),
        "0 3 * * *",
        new RecurringJobOptions { TimeZone = timeZone });

    // 每日报表：每天 02:00，为所有开启「自动导出」的表格生成 xlsx 快照
    recurring.AddOrUpdate<DailyExportJob>(
        "daily-export",
        job => job.RunAsync(),
        "0 2 * * *",
        new RecurringJobOptions { TimeZone = timeZone });

    // 启动即补跑一次清理：进程可能整天没起来，或刚部署完还不到下次调度时间。
    // 清理是幂等的（只删「该删的」），多跑一次没有副作用；
    // 不补跑反而会出现「过期表一直躺在回收站里」——旧的手写循环原本也是启动先清一次。
    recurring.Trigger("recycle-bin-cleanup");
}

// ===== 中间件管道 =====
app.UseMiddleware<ExceptionMiddleware>();

// HTTP 请求访问日志：方法、路径、状态码、耗时一行打全（默认只记 Information 以上，
// 与上面 Microsoft 压 Warning 的 override 互不影响——本中间件走 Serilog 自己的类别）
app.UseSerilogRequestLogging();

// 生产环境启用 HTTPS 重定向与 HSTS。App Service 在网关层终结 TLS 时这两步无副作用，
// 但能覆盖「裸 Kestrel」场景，避免明文传输凭据。
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
    app.UseHsts();
}

// 开发环境启用 Swagger
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseDefaultFiles();
// 静态资源用协商缓存（no-cache + ETag）：浏览器每次校验、未变则 304，
// 前端文件更新后刷新页面立即生效，不会卡在旧版本 JS/CSS 上
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
        ctx.Context.Response.Headers["Cache-Control"] = "no-cache"
});

app.UseAuthentication();
app.UseAuthorization();

app.UseRateLimiter();

app.MapControllers();

// ===== 健康检查端点 =====
// 存活探针：不执行任何检查，进程活着即 200（liveness 只反映进程自身健康）。
// 就绪探针：只跑带 ready 标签的检查（SQL 连通性），数据库不可用时返回 503。
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = r => r.Tags.Contains("ready") });

// ===== Hangfire Dashboard（默认仅开发环境）=====
// Dashboard 默认对**任何能访问到它的人**开放：里面能看到任务名、参数、异常栈，
// 还能手动触发 / 删除任务——暴露在公网上等于把调度权交出去。
// 又因为本项目前端用 JWT（存 localStorage），浏览器直接访问 /hangfire 带不上 Authorization 头，
// 做不成「登录后按角色放行」，所以退一步：只开给本机 + 生产环境默认关闭（Hangfire:DashboardEnabled）。
// 需要远程看的时候走 SSH 隧道 / 内网访问，不要把开关打开到公网。
if (hangfireEnabled && app.Configuration.GetValue<bool>("Hangfire:DashboardEnabled"))
{
    app.MapHangfireDashboard("/hangfire", new DashboardOptions
    {
        Authorization = [new LocalRequestsOnlyAuthorizationFilter()]
    });
}

app.Run();
