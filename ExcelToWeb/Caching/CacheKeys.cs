namespace ExcelToWeb.Caching;

/// <summary>
/// 缓存键的唯一来源。集中在一处的原因：
/// ① 键名散落在各处一定会拼错，而拼错的后果是「查不到缓存」这种**静默失效**，
///    跑起来一切正常、只是永远不命中，很难被发现；
/// ② 后端提供 Redis 时，这些键会出现在 Redis 里，统一的命名前缀让运维能一眼看出
///    哪些键属于哪个域、能不能整体清掉。
/// 命名约定：<c>域:对象:标识</c>，与 Rbac 的权限码（<c>table:read</c>）风格保持一致。
/// </summary>
public static class CacheKeys
{
    /// <summary>用户当前角色（RBAC 判定用）。标识是 userId。</summary>
    public static string UserRole(int userId) => "rbac:role:" + userId;

    /// <summary>表格的列元数据（列宽 / 隐藏 / 公式，解析后的字典）。标识是 tableId。</summary>
    public static string ColumnMeta(int tableId) => "table:colmeta:" + tableId;
}

/// <summary>
/// 各类缓存的存活时间。TTL 的定位是**兜底**而不是主策略：
/// 真正保证一致性的是「写操作主动失效」，TTL 只负责在「某条失效路径漏了」
/// 的最后关头把陈旧数据放掉，把最长不一致时间封顶在一个可接受的值。
///
/// 为什么两个值不一样：
///  - 角色是权限判断的依据，错一次就是越权或误拦，给短 TTL（5 分钟）并把失效做全；
///  - 列元数据只是视图偏好（列宽/隐藏），陈旧的最坏后果是列宽没生效，
///    用户再点一次列设置就会写穿缓存，所以可以给长一些（10 分钟）减少反序列化。
/// </summary>
public static class CacheTtl
{
    public static readonly TimeSpan UserRole = TimeSpan.FromMinutes(5);

    public static readonly TimeSpan ColumnMeta = TimeSpan.FromMinutes(10);
}

/// <summary>角色缓存的外壳。存对象而不是裸字符串，后续要加「缓存写入时间」之类的字段不用改键。</summary>
public sealed class CachedRole
{
    public Auth.UserRole Role { get; set; }
}
