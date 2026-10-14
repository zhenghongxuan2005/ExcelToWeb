using ExcelToWeb.DTOs;
using ExcelToWeb.Models;
using ExcelToWeb.Services.Excel;

namespace ExcelToWeb.Services;

/// <summary>
/// 回收站业务（功能 9）：列表 / 恢复 / 彻底删除。
/// 单独成类而不是塞进 ExcelService：门面已顶在 400 行预算上，且回收站是独立的子域。
/// 演示账号只读拦截与门面同款（判定见 DemoWriteGuard）—— 只在前端拦不住直接调 API 的人。
/// </summary>
public class TrashService
{
    private readonly ILogger<TrashService> _logger;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly TableRepository _repository;

    public TrashService(
        ILogger<TrashService> logger,
        IHttpContextAccessor httpContextAccessor,
        TableRepository repository)
    {
        _logger = logger;
        _httpContextAccessor = httpContextAccessor;
        _repository = repository;
    }

    private bool IsDemoUser => DemoWriteGuard.IsDemo(_httpContextAccessor.HttpContext);

    /// <summary>回收站列表（读操作，demo 账号可用）</summary>
    public Task<List<TrashItemDto>> ListAsync(int userId) =>
        _repository.GetTrashedAsync(userId);

    /// <summary>恢复：清掉删除标记，数据原样回到表格列表</summary>
    public async Task<ApiResponse> RestoreAsync(int tableId, int userId)
    {
        if (IsDemoUser) return ApiResponse.Fail(DemoWriteGuard.ReadOnlyMessage);

        var table = await _repository.FindTrashedAsync(tableId, userId);
        if (table == null)
            return ApiResponse.Fail("回收站里没有这张表格");

        // 恢复前先把表名让开：删除期间用户可能建了同名新表，直接还原会出现两张同名表
        table.TableName = await _repository.BuildRestoreNameAsync(table.TableName, userId);

        await _repository.RestoreAsync(table);

        _logger.LogInformation("用户 {UserId} 从回收站恢复表格 {TableId}（{TableName}）", userId, tableId, table.TableName);
        return ApiResponse.Ok($"表格「{table.TableName}」已恢复");
    }

    /// <summary>
    /// 彻底删除：物理删表并清掉关联的审计日志 / 校验规则，不可恢复。
    /// </summary>
    public async Task<ApiResponse> PurgeAsync(int tableId, int userId)
    {
        if (IsDemoUser) return ApiResponse.Fail(DemoWriteGuard.ReadOnlyMessage);

        var table = await _repository.FindTrashedAsync(tableId, userId);
        if (table == null)
            return ApiResponse.Fail("回收站里没有这张表格");

        await _repository.PurgeTableAsync(table);

        _logger.LogInformation("用户 {UserId} 彻底删除表格 {TableId}", userId, tableId);
        return ApiResponse.Ok($"表格「{table.TableName}」已彻底删除");
    }
}
