using System.Text;
using ExcelToWeb.Data;
using ExcelToWeb.Middleware;
using ExcelToWeb.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using OfficeOpenXml;

// EPPlus 许可证（非商业用途）
ExcelPackage.LicenseContext = LicenseContext.NonCommercial;

var builder = WebApplication.CreateBuilder(args);

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
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
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
