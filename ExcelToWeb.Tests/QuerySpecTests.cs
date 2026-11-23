using ExcelToWeb.Services.Query;
using Xunit;

namespace ExcelToWeb.Tests;

/// <summary>
/// 分页契约测试。三处最容易出错的地方都锁住了：
/// 边界收敛（漏了会返回空列表而不是报错）、Skip 计算（页码从 1 开始，
/// 容易写成 page * size）、TotalPages 取整（整除会让最后一页凭空消失）。
/// </summary>
public class QuerySpecTests
{
    [Theory]
    [InlineData(0, 0, 1, 50)]        // 全零：回落到第 1 页 + 默认页大小
    [InlineData(-5, -1, 1, 50)]      // 负数同样回落，不抛异常
    [InlineData(3, 20, 3, 20)]       // 合法值原样保留
    [InlineData(2, 100, 2, 100)]     // 恰好等于上限
    [InlineData(1, 101, 1, 100)]     // 超过上限被截断
    [InlineData(1, 9999, 1, 100)]    // 远大于上限同样截断
    public void Clamp_把非法值收敛到合法区间(int page, int size, int expPage, int expSize)
    {
        var spec = QuerySpec.Clamp(page, size);
        Assert.Equal(expPage, spec.Page);
        Assert.Equal(expSize, spec.PageSize);
    }

    [Theory]
    [InlineData(1, 50, 0)]      // 第 1 页不跳过任何行
    [InlineData(2, 50, 50)]
    [InlineData(3, 20, 40)]
    [InlineData(1, 100, 0)]
    public void Skip_是页减一乘以页大小(int page, int size, int expected)
        => Assert.Equal(expected, new QuerySpec(page, size).Skip);

    [Fact]
    public void TotalPages_空结果返回零页而不是一页()
    {
        // 返回 1 的话前端会画出一个「第 1 页」，点了什么都没有；0 才是正确的空状态
        var r = new PagedResult<string> { Total = 0, PageSize = 50 };
        Assert.Equal(0, r.TotalPages);
    }

    [Theory]
    [InlineData(1, 50, 1)]      // 1 条也占 1 页
    [InlineData(50, 50, 1)]     // 恰好整页
    [InlineData(51, 50, 2)]     // 多 1 条要第 2 页：整除会算成 1，最后一页就丢了
    [InlineData(100, 50, 2)]
    [InlineData(101, 50, 3)]
    public void TotalPages_向上取整(int total, int size, int expected)
        => Assert.Equal(expected, new PagedResult<string> { Total = total, PageSize = size }.TotalPages);

    [Fact]
    public void TotalPages_页大小为零时返回零而不是抛除零异常()
        => Assert.Equal(0, new PagedResult<string> { Total = 100, PageSize = 0 }.TotalPages);

    [Fact]
    public void PagedResult_默认Items是空列表而不是null()
    {
        // 前端直接遍历 Items，null 会让它抛异常
        var r = new PagedResult<int>();
        Assert.NotNull(r.Items);
        Assert.Empty(r.Items);
    }
}
