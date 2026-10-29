using Microsoft.EntityFrameworkCore;
using ExcelToWeb.Models;

namespace ExcelToWeb.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<DynamicTable> DynamicTables => Set<DynamicTable>();
    public DbSet<DynamicRow> DynamicRows => Set<DynamicRow>();
    public DbSet<User> Users => Set<User>();
    public DbSet<ColorRule> ColorRules => Set<ColorRule>();
    public DbSet<ValidationRule> ValidationRules => Set<ValidationRule>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<ExportSnapshot> ExportSnapshots => Set<ExportSnapshot>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // DynamicRow
        modelBuilder.Entity<DynamicRow>()
            .Property(r => r.DataJson)
            .HasColumnType("nvarchar(max)");

        modelBuilder.Entity<DynamicRow>()
            .HasOne(r => r.Table)
            .WithMany(t => t.Rows)
            .HasForeignKey(r => r.TableId)
            .OnDelete(DeleteBehavior.Cascade);

        // DynamicTable
        modelBuilder.Entity<DynamicTable>()
            .Property(t => t.Headers)
            .HasColumnType("nvarchar(max)");

        // 列视图元数据（列名 -> 列宽 / 是否隐藏），可空：未调整过列的表格为 null
        modelBuilder.Entity<DynamicTable>()
            .Property(t => t.ColumnMetaJson)
            .HasColumnType("nvarchar(max)");

        // 导入时记录的合并区域，可空：文件里没有合并的表格为 null
        modelBuilder.Entity<DynamicTable>()
            .Property(t => t.MergeRangesJson)
            .HasColumnType("nvarchar(max)");

        modelBuilder.Entity<DynamicTable>()
            .HasIndex(t => t.UserId);

        // User
        modelBuilder.Entity<User>()
            .HasIndex(u => u.Username)
            .IsUnique();
        // 角色存字符串（Admin / Editor / Viewer）：库表可读，加角色也不会错位
        modelBuilder.Entity<User>()
            .Property(u => u.Role)
            .HasConversion<string>()
            .HasMaxLength(16);

        // ColorRule
        modelBuilder.Entity<ColorRule>()
            .Property(r => r.MinValue)
            .HasPrecision(18, 2);
        modelBuilder.Entity<ColorRule>()
            .Property(r => r.MaxValue)
            .HasPrecision(18, 2);
        modelBuilder.Entity<ColorRule>()
            .HasIndex(r => new { r.UserId, r.ColumnName });

        // ValidationRule
        modelBuilder.Entity<ValidationRule>()
            .Property(r => r.MinValue)
            .HasPrecision(18, 2);
        modelBuilder.Entity<ValidationRule>()
            .Property(r => r.MaxValue)
            .HasPrecision(18, 2);
        modelBuilder.Entity<ValidationRule>()
            .HasIndex(r => r.TableId);

        // AuditLog：按表 + 时间倒序查询是主路径
        modelBuilder.Entity<AuditLog>()
            .HasIndex(a => new { a.TableId, a.CreatedAt });

        // 导出快照：按「用户 + 时间倒序」列列表是主路径；表被彻底删除时连带删掉快照
        modelBuilder.Entity<ExportSnapshot>()
            .HasOne(s => s.Table)
            .WithMany()
            .HasForeignKey(s => s.TableId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<ExportSnapshot>()
            .HasIndex(s => new { s.UserId, s.CreatedAt });
        modelBuilder.Entity<ExportSnapshot>()
            .HasIndex(s => s.TableId);
        modelBuilder.Entity<ExportSnapshot>()
            .Property(s => s.TableName)
            .HasMaxLength(200);
        modelBuilder.Entity<ExportSnapshot>()
            .Property(s => s.FileName)
            .HasMaxLength(260);
        modelBuilder.Entity<ExportSnapshot>()
            .Property(s => s.RelativePath)
            .HasMaxLength(400);

        // RefreshToken：按指纹精确查找是主路径；整族吊销与会话列表各用一条索引
        modelBuilder.Entity<RefreshToken>()
            .HasIndex(r => r.TokenHash)
            .IsUnique();
        modelBuilder.Entity<RefreshToken>()
            .HasIndex(r => r.FamilyId);
        modelBuilder.Entity<RefreshToken>()
            .HasIndex(r => r.UserId);
        // UA 只做展示，限长防止异常请求头把行撑大
        modelBuilder.Entity<RefreshToken>()
            .Property(r => r.CreatedByUserAgent)
            .HasMaxLength(300);
    }
}
