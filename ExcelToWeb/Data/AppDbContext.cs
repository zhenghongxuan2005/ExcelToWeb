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

        modelBuilder.Entity<DynamicTable>()
            .HasIndex(t => t.UserId);

        // User
        modelBuilder.Entity<User>()
            .HasIndex(u => u.Username)
            .IsUnique();

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
    }
}
