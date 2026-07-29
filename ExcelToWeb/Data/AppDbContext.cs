using Microsoft.EntityFrameworkCore;
using ExcelToWeb.Models;

namespace ExcelToWeb.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }
        public DbSet<DynamicTable> DynamicTables { get; set; }
        public DbSet<DynamicRow> DynamicRows { get; set; }
        public DbSet<ColorRule> ColorRules { get; set; }
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<DynamicTable>()
                .Property(t => t.Headers)
                .HasColumnType("nvarchar(max)");

            modelBuilder.Entity<DynamicRow>()
                .Property(r => r.DataJson)
                .HasColumnType("nvarchar(max)");
        }
    }
}