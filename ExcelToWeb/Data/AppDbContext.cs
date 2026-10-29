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

        // 聚集索引从 Id 挪到 (TableId, Id)。
        //
        // 原来只有「Id 聚集主键」，TableId 上没有任何索引，于是每一次
        // `WHERE TableId = @id` 都是全表扫描——实测查 6 行要读 3135 个页。
        // 而这张表的主路径**永远**是「按 TableId 取一整张表」（查询、导出、透视、保存），
        // 按单行 Id 取的调用点一个都没有。
        //
        // 改成按 (TableId, Id) 聚集后，一张表的所有行物理相邻，一次范围扫描取完；
        // 若只在 TableId 上建普通非聚集索引，1800 行仍要 1800 次回表取 DataJson，
        // 比全表扫描好得有限（3135 页 → 约 1800 页）。这个差别是 78 倍和 1.7 倍的区别。
        //
        // 代价：Id 的唯一性改由非聚集主键保证，按 Id 单查会多一次 lookup。
        // 这个代价在本项目里不存在，所以值得。
        modelBuilder.Entity<DynamicRow>()
            .HasKey(r => r.Id)
            .IsClustered(false);
        modelBuilder.Entity<DynamicRow>()
            .HasIndex(r => new { r.TableId, r.Id })
            .IsClustered();

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

        // 表格列表的主路径：`WHERE UserId = @u AND DeletedAt IS NULL ORDER BY UpdatedAt DESC`。
        // 原来只有 (UserId) 单列索引，筛选 DeletedAt、排序 UpdatedAt 都要在内存里做。
        // 复合索引把这三件事一次做完，排序也能直接吃索引的有序性（第三列倒序）。
        modelBuilder.Entity<DynamicTable>()
            .HasIndex(t => new { t.UserId, t.DeletedAt, t.UpdatedAt })
            .IsDescending(false, false, true);

        // 回收站过期清理（`DeletedAt IS NOT NULL AND DeletedAt < cutoff`）
        // 与每日导出（`AutoExportEnabled AND DeletedAt IS NULL`）都靠这条：两者都先用 DeletedAt 收窄。
        modelBuilder.Entity<DynamicTable>()
            .HasIndex(t => new { t.DeletedAt, t.AutoExportEnabled });

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
