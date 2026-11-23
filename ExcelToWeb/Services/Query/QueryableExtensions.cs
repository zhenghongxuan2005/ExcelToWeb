using Microsoft.EntityFrameworkCore;

namespace ExcelToWeb.Services.Query;

/// <summary>
/// 把 <see cref="QuerySpec"/> 落到 EF Core 查询上。分页逻辑只在这里实现一次：
/// 每个接口自己写 Skip/Take 迟早会漏掉 Count，或者把 (page - 1) 写成 page。
/// </summary>
public static class QueryableExtensions
{
    /// <summary>
    /// 取一页并返回总数。
    ///
    /// 调用位置：在 <c>Select</c> 投影之后、<c>ToListAsync</c> 之前。
    /// 这样取数据只取当前页的列，不会为了数数把整表实体物化一遍
    /// —— <c>CountAsync</c> 本身只发 <c>COUNT(*)</c>，不构造对象。
    ///
    /// 先数再取：两次查询之间若有插入，Total 与 Items 会有轻微偏差。分页场景下
    /// 这是可接受的（下一页自然会看到），比「先取后数」更符合直觉。
    /// </summary>
    public static async Task<PagedResult<T>> ToPagedAsync<T>(
        this IQueryable<T> query, QuerySpec spec, CancellationToken ct = default)
    {
        var total = await query.CountAsync(ct);
        var items = await query.Skip(spec.Skip).Take(spec.PageSize).ToListAsync(ct);

        return new PagedResult<T>
        {
            Items = items,
            Total = total,
            Page = spec.Page,
            PageSize = spec.PageSize
        };
    }
}
