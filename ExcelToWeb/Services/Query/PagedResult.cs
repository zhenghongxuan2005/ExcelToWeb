namespace ExcelToWeb.Services.Query;

/// <summary>
/// 分页结果的标准形状。
///
/// Items 与 Total 都是必需的：前端要靠 Total 画页码和「共 N 条」，
/// 只给 Items 的话就只能做「下一页」按钮，用户不知道后面还有多少。
/// </summary>
public sealed class PagedResult<T>
{
    public List<T> Items { get; init; } = [];

    /// <summary>符合筛选条件的总行数（不是当前页的行数）</summary>
    public int Total { get; init; }

    public int Page { get; init; }

    public int PageSize { get; init; }

    /// <summary>
    /// 总页数。Total = 0 时返回 0 而不是 1 —— 空集合没有「第 1 页」可言，
    /// 前端据此显示空状态，而不是一个点了没反应的页码 1。
    /// </summary>
    public int TotalPages => PageSize > 0 ? (int)Math.Ceiling(Total / (double)PageSize) : 0;
}
