using System.Text;
using ExcelToWeb.Data;
using ExcelToWeb.Middleware;
using ExcelToWeb.Services;
using ExcelToWeb.Services.Excel;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using OfficeOpenXml;

// EPPlus 许可证（非商业用途）。
// EPPlus 7+ 移除了 ExcelPackage.LicenseContext，改为在 ExcelPackage.License 上显式声明；
// 本项为本科毕业设计，属非商业个人使用，与 LICENSE 中的 MIT + Polyform Noncommercial 说明一致。
ExcelPackage.License.SetNonCommercialPersonal("郑鸿煊");

var builder = WebApplication.CreateBuilder(args);

// 默认端口兜底：launchSettings 未生效（如直接运行 exe）时监听 5185。
// 注意：此处 UseUrls 的优先级高于 ASPNETCORE_URLS 环境变量（实测不生效）；
// 但 dotnet run 时 launchSettings 的 applicationUrl 以命令行参数注入，可覆盖此设置。
builder.WebHost.UseUrls("http://localhost:5185");

// ===== 数据库 =====
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// ===== JWT 认证 =====
var jwtKey = builder.Configuration["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key 未配置");
builder.Services.AddAuthentication(options =>
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
})
// Windows 集成身份验证（NTLM/Kerberos），仅 /api/auth/windows 端点使用
.AddNegotiate();

// ===== 服务注册 =====
// 无状态的读表 / 校验工具，注册为单例即可
builder.Services.AddSingleton<ExcelSheetReader>();
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

// ===== 控制器 + Swagger =====
builder.Services.AddControllers();
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

var app = builder.Build();

// ===== 自动创建数据库和缺失的表 =====
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();

    // EnsureCreated 对已存在的数据库不会补建缺失的表，这里手动补建
    db.Database.ExecuteSqlRaw(@"
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ColorRules' AND xtype='U')
        CREATE TABLE ColorRules (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            UserId INT NOT NULL,
            ColumnName NVARCHAR(MAX) NOT NULL,
            MinValue DECIMAL(18,2) NOT NULL,
            MaxValue DECIMAL(18,2) NULL,
            ColorCode NVARCHAR(MAX) NOT NULL,
            CreatedAt DATETIME2 NOT NULL,
            UpdatedAt DATETIME2 NOT NULL
        );

        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ValidationRules' AND xtype='U')
        CREATE TABLE ValidationRules (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            TableId INT NOT NULL,
            ColumnName NVARCHAR(MAX) NOT NULL,
            Required BIT NOT NULL,
            DataType NVARCHAR(MAX) NOT NULL,
            MinValue DECIMAL(18,2) NULL,
            MaxValue DECIMAL(18,2) NULL,
            MaxLength INT NULL,
            AllowedValues NVARCHAR(MAX) NOT NULL,
            CreatedAt DATETIME2 NOT NULL,
            UpdatedAt DATETIME2 NOT NULL
        );

        -- DynamicTables.ColumnMetaJson（列宽 / 隐藏列的视图偏好）。
        -- EnsureCreated 只建缺失的表，不会给已存在的表补列，所以这里手动幂等补上；
        -- SQL Server 没有 ADD COLUMN IF NOT EXISTS，用 COL_LENGTH 判断。
        IF COL_LENGTH('DynamicTables', 'ColumnMetaJson') IS NULL
            ALTER TABLE DynamicTables ADD ColumnMetaJson NVARCHAR(MAX) NULL;

        -- DynamicTables.MergeRangesJson（导入时记录的合并区域，导出时按原样还原）
        IF COL_LENGTH('DynamicTables', 'MergeRangesJson') IS NULL
            ALTER TABLE DynamicTables ADD MergeRangesJson NVARCHAR(MAX) NULL;

        -- ValidationRules 增强：唯一性约束 + 跨表引用（表 + 列）
        IF COL_LENGTH('ValidationRules', 'Unique') IS NULL
            ALTER TABLE ValidationRules ADD [Unique] BIT NOT NULL CONSTRAINT DF_ValidationRules_Unique DEFAULT 0;
        IF COL_LENGTH('ValidationRules', 'RefTableId') IS NULL
            ALTER TABLE ValidationRules ADD RefTableId INT NULL;
        IF COL_LENGTH('ValidationRules', 'RefColumnName') IS NULL
            ALTER TABLE ValidationRules ADD RefColumnName NVARCHAR(MAX) NOT NULL CONSTRAINT DF_ValidationRules_RefColumnName DEFAULT N'';

        -- 变更历史（审计日志）：保存时服务端 diff 落库
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AuditLogs' AND xtype='U')
        CREATE TABLE AuditLogs (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            TableId INT NOT NULL,
            Action NVARCHAR(20) NOT NULL,
            RowIndex INT NOT NULL,
            ColumnName NVARCHAR(MAX) NOT NULL,
            OldValue NVARCHAR(MAX) NOT NULL,
            NewValue NVARCHAR(MAX) NOT NULL,
            UserName NVARCHAR(100) NOT NULL,
            CreatedAt DATETIME2 NOT NULL
        );
    ");
}

// ===== 中间件管道 =====
app.UseMiddleware<ExceptionMiddleware>();

// 开发环境启用 Swagger
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
