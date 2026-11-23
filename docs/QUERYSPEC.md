# 列表查询契约（QuerySpec）设计

> 状态：设计稿，待确认后实施
> 日期：2026-11-23

## 一、为什么要做，以及明确不做什么

先把现状摆出来：14 个 GET 接口里，**只有审计中心有分页**。

| 接口 | 数据量级 | 现状 |
| --- | --- | --- |
| 审计中心 `/excel/audit-center` | 数百 ~ 数万 | 已有分页（page / pageSize，默认 50，上限 100） |
| 表格列表 `/excel/tables` | 数十 | 全量返回 |
| 成员列表 `/users` | 数十 | 全量 |
| 会话列表 `/auth/sessions` | 个位数 | 全量 |
| 回收站 `/excel/trash` | 数十 | 全量 |

真实结论：**需要分页的只有审计中心，其次是表格列表**（用户表攒到几百张时会慢）。
其余列表的数据量级根本用不上分页。

### 非目标（三条，都是刻意的）

**1. 不做通用筛选 DSL**

不做 `?filter=role:Admin,age>18` 这种。每个接口的筛选语义都不一样——审计按
「表格 / 操作类型 / 时间区间」，表格列表按「名字包含」，成员按「角色」。硬凑一个
统一语法，最后会变成「字段名魔法」：写的人要靠记忆，读的人要靠猜，而消费者只有两个。

用普通查询参数（`?tableId=&actionType=&from=&to=`）已经够清楚，不需要再抽象一层。

**2. 不做 JSON blob 的分页**

`DynamicRows` 的列值存在 `DataJson` 里（JSON-per-row）。SQL 层无法按「某一列」筛选
或排序，只能在应用内存里做——这意味着**分页前必须全量加载**，等于白做。

这就是上一轮「只读分页」评估被否掉的核心原因。QuerySpec 只服务于**结构化表**
（AuditLogs / DynamicTables / Users / RefreshTokens 这些有真实列的）。

**3. 不做游标分页**

当前数据量下 `OFFSET / FETCH` 完全够用。什么时候需要升级写在第六节，不提前做。

---

## 二、目标

1. **分页逻辑只实现一次**：`Count` + `Skip/Take` 集中在扩展方法里，一处可测
2. **统一分页响应形状**：`{ items, total, page, pageSize }`
3. **保持现有接口的外部契约不变**——审计中心前端不改也能继续跑
4. 排序**默认不做**（少一个攻击面）；要做就必须走白名单

---

## 三、设计

### 3.1 两个类型

```csharp
// Services/Query/QuerySpec.cs
public readonly record struct QuerySpec(int Page, int PageSize)
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 100;

    /// 把外部传进来的乱值收敛到合法区间：页码 ≥ 1，页大小 ∈ [1, MaxPageSize]
    public static QuerySpec Clamp(int page, int pageSize)
        => new(page < 1 ? 1 : page,
               pageSize < 1 ? DefaultPageSize : Math.Min(pageSize, MaxPageSize));

    public int Skip => (Page - 1) * PageSize;
}

// Services/Query/PagedResult.cs
public sealed class PagedResult<T>
{
    public List<T> Items { get; init; } = [];
    public int Total { get; init; }
    public int Page { get; init; }
    public int PageSize { get; init; }
    public int TotalPages => PageSize > 0 ? (int)Math.Ceiling(Total / (double)PageSize) : 0;
}
```

`Clamp` 放在类型里而不是散在调用点：现在 `AuditService` 手写的那三行边界处理
（`page < 1` / `pageSize < 1` / `pageSize > 100`）在新接口上很容易漏抄一遍。

### 3.2 一个扩展方法

```csharp
// Services/Query/QueryableExtensions.cs
public static async Task<PagedResult<T>> ToPagedAsync<T>(
    this IQueryable<T> query, QuerySpec spec, CancellationToken ct = default)
{
    var total = await query.CountAsync(ct);
    var items = await query.Skip(spec.Skip).Take(spec.PageSize).ToListAsync(ct);
    return new PagedResult<T> { Items = items, Total = total, Page = spec.Page, PageSize = spec.PageSize };
}
```

注意调用顺序：**投影（`Select`）之后、`ToListAsync` 之前**调用它，让 Count 走
`SELECT COUNT(*)` 而不是把整行业务数据拉回来。

### 3.3 排序：白名单，或者不做

EF Core 无法参数化列名，`OrderBy` 的字段只能落到字符串拼接上——那就是注入面。

期 1 **不做排序参数**：审计日志固定按 `CreatedAt` 倒序，这本来就是它唯一合理的顺序。

以后真要做，做法是每个调用点自己声明可用字段：

```csharp
private static readonly Dictionary<string, Func<IQueryable<AuditLog>, IOrderedQueryable<AuditLog>>> Sorts = new()
{
    ["createdAt"] = q => q.OrderByDescending(x => x.CreatedAt),
    ["action"]    = q => q.OrderBy(x => x.Action),
};
// 查不到就直接用默认顺序，绝不把用户传的字符串拼进 SQL
```

---

## 四、分期（总计约 1 天，不是 2~3 天）

> 我一开始估 2~3 天，是把「通用筛选 DSL + 前端公共组件 + 多接口改造」都算进去了。
> 砍掉非目标之后，实际只需要一天。

### 期 1：后端契约（约半天）

- 新增 `Services/Query/` 下三个文件（`QuerySpec` / `PagedResult` / `QueryableExtensions`）
- `AuditService.SearchAsync` 改用 `ToPagedAsync`，**响应字段保持 `{ logs, total }` 不变**
- 单元测试：`Clamp` 的边界（0、负数、超大）、`Skip` 计算、`TotalPages` 向上取整

验收：`status_code_test.py` 第 7 节全过、前端审计页翻页正常、总数与列表长度对得上。

### 期 2：表格列表接入（约半天）

- `GET /api/excel/tables?page=&pageSize=`，**不传参 = 全量**（旧行为不变，前端可以慢慢接）
- 前端表格管理页在「超过 50 张」时显示分页条，否则维持现状
- 测试：不传参数时返回的行数与改造前一致

验收：库里造 120 张表，翻页正确，旧调用（不带参数）不受影响。

### 期 3（可选）：前端翻页条复用

把审计中心的翻页条抽成公共组件给表格管理页用。纯前端，不阻塞前两期。

---

## 五、风险与应对

| 风险 | 应对 |
| --- | --- |
| 改审计中心引入回归 | 期 1 不动外部响应形状；有第 7 节 5 项用例 + 前端 audit 用例兜底 |
| 排序白名单写错导致注入 | 期 1 不做排序；以后必须走字典，代码评审时盯死「不拼列名字符串」 |
| 表格列表加分页后前端漏改 | 后端不传 `page` 时返回全量，旧代码零改动 |
| `Count` 拖慢查询 | 现在数据量下可忽略；表大时再加索引或改近似值 |

---

## 六、什么时候该升级到游标分页

`OFFSET` 分页有两个硬伤，但都还没到：

1. **深页慢**：`OFFSET 100000` 仍要扫描并丢弃前 10 万行，越翻越慢
2. **翻页期间插入会导致重复/跳漏**：翻到第 2 页时，若期间新增了记录，
   第 2 页开头会重复第 1 页末尾的几条

**触发条件**（满足任一才动手）：

- 审计日志单表超过 10 万行（按当前写入频率，大约一年后）
- 或实际有人在翻页时看到重复记录

届时方案：按 `(CreatedAt, Id)` 做 keyset，`WHERE (CreatedAt, Id) < (@lastAt, @lastId)`。
代价是不能跳页，只能「上一页 / 下一页」——这也是为什么不该提前做：
大多数用户根本翻不到第 100 页。

---

## 七、这个重构的真实收益（说清楚，避免自我感动）

**收益**：
- 分页逻辑从「每个接口抄一遍」变成一处实现，边界值不会漏
- 表格列表能分页了（目前唯一有真实压力的非审计列表）
- 以后加子列表（比如导出记录分页）有现成模式

**收益有限的地方**：
- 只有两个消费者，谈不上「通用框架」
- 真正的查询瓶颈（JSON blob 无法索引）它解决不了，也不打算解决

如果目标是「练架构能力」，这一天的性价比是高的；如果目标是「加功能」，
它加不了任何用户可见的功能。这一点先摆明白，再决定做不做。
