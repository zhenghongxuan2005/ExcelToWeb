using ExcelToWeb.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace ExcelToWeb.HealthChecks;

// 就绪探针用：只验证数据库连通性（SELECT 1）。
// 手写而不引 AspNetCore.HealthChecks.SqlServer 社区包——后者依赖的 SqlClient 5.x
// 与 EF Core 10 内置的 SqlClient 6.x 有版本冲突风险，20 行零依赖更划算。
public class DatabaseHealthCheck(AppDbContext db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await db.Database.ExecuteSqlRawAsync("SELECT 1;", cancellationToken);
            return HealthCheckResult.Healthy("数据库连接正常");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("数据库连接失败", ex);
        }
    }
}
