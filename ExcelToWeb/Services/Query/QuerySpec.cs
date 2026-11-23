namespace ExcelToWeb.Services.Query;

/// <summary>
/// 列表查询的分页参数：只描述「第几页、每页多少」，不含筛选条件。
///
/// 刻意不把筛选也塞进来 —— 各接口的筛选语义根本不同（审计按表格 / 操作 / 时间，
/// 表格按名字，成员按角色），硬凑一套统一语法只会变成「字段名魔法」：
/// 写的人靠记忆，读的人靠猜。而真正需要分页的接口只有两个。
/// </summary>
public readonly record struct QuerySpec(int Page, int PageSize)
{
    /// <summary>不指定页大小时的默认值，与审计中心改造前的行为保持一致</summary>
    public const int DefaultPageSize = 50;

    /// <summary>
    /// 页大小上限。分页的意义就是不一次拉走整张表，所以这里必须有天花板。
    /// </summary>
    public const int MaxPageSize = 100;

    /// <summary>
    /// 把外部传进来的值收敛到合法区间：页码至少 1，页大小落在 [1, MaxPageSize]。
    ///
    /// 这三行判断原本手写在 AuditService 里。加第二个分页接口时极容易漏抄 ——
    /// 一旦漏了，传入 pageSize=0 会让 Take(0) 返回空列表，接口看起来像「没有数据」，
    /// 而不是报错。收敛逻辑放在类型里，就不会有第二个地方忘记。
    /// </summary>
    public static QuerySpec Clamp(int page, int pageSize)
        => new(
            page < 1 ? 1 : page,
            pageSize < 1 ? DefaultPageSize : Math.Min(pageSize, MaxPageSize));

    /// <summary>跳过的行数。页码从 1 开始，所以是 (page - 1) * pageSize</summary>
    public int Skip => (Page - 1) * PageSize;
}
