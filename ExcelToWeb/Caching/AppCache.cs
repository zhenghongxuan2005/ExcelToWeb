using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Distributed;

namespace ExcelToWeb.Caching;

/// <summary>
/// 分布式缓存的统一门面。上层只依赖 <see cref="IDistributedCache"/> 这一层抽象，
/// 具体是 Redis（<c>Cache:Provider=redis</c>）还是进程内内存（默认），由配置决定，
/// 业务代码一行都不用改 —— 这也是选分布式缓存接口而不是 <c>IMemoryCache</c> 的原因：
/// 后者只在单进程内有效，一旦按容器多副本部署，每个副本各存一份，改角色后
/// 只有处理这次请求的那个副本知道要失效，其余副本继续拿旧角色放行。
///
/// **缓存失败必须不影响主流程**：Redis 挂掉、网络抖动、序列化异常，
/// 一律降级成「未命中」并记录，让请求回落到数据库。
/// 缓存是为了快，不是为了正确；把它做成「强依赖」等于用可用性换吞吐。
///
/// 但光 try/catch 还不够 —— 这是踩过的坑：Redis 不可达时，每次缓存调用都要等
/// 连接超时，一个普通请求叠了三次缓存访问就慢到 25 秒，比不用缓存还糟。
/// 所以这里再加一层**熔断**：连续失败若干次后直接跳过缓存一段时间，
/// 让请求立刻走数据库，而不是每个请求都去把同一个超时再等一遍。
/// </summary>
public class AppCache
{
    /// <summary>枚举写成字符串（"Viewer"）而不是数字：Redis 里肉眼可读，改枚举值也不会错位</summary>
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }
    };

    /// <summary>
    /// 连续失败多少次后熔断。取 2 而不是更大的值：一次业务请求通常就要读一次、写一次缓存，
    /// 阈值 3 意味着「前两个请求仍然各自付出一次连接超时」，用户能感知到卡顿；
    /// 阈值 2 让第一个请求之后立刻熔断。冷却期只有 30 秒，误判代价很小。
    /// </summary>
    private const int FailureThreshold = 2;

    /// <summary>熔断持续时间：期间完全不碰缓存，等于「本段时间内退化成无缓存」</summary>
    private static readonly TimeSpan CircuitCooldown = TimeSpan.FromSeconds(30);

    private readonly IDistributedCache _cache;
    private readonly ILogger<AppCache> _logger;

    private int _consecutiveFailures;
    private long _circuitOpenUntilMs;

    public AppCache(IDistributedCache cache, ILogger<AppCache> logger)
    {
        _cache = cache;
        _logger = logger;
    }

    /// <summary>熔断中：跳过一切缓存操作，直接回落数据库</summary>
    private bool CircuitOpen => Environment.TickCount64 < Volatile.Read(ref _circuitOpenUntilMs);

    /// <summary>读缓存。不存在、内容损坏、后端故障、熔断中都返回 null（等同未命中）。</summary>
    public async Task<T?> GetAsync<T>(string key, CancellationToken ct = default) where T : class
    {
        if (CircuitOpen) return null;

        try
        {
            var json = await _cache.GetStringAsync(key, ct);
            ReportSuccess();
            if (string.IsNullOrEmpty(json)) return null;
            return JsonSerializer.Deserialize<T>(json, JsonOptions);
        }
        catch (Exception ex)
        {
            // 内容损坏（线上改了数据结构、旧缓存还在）也会走到这里：
            // 当成未命中重算一次，比抛给上层健康得多
            ReportFailure("读", key, ex);
            return null;
        }
    }

    /// <summary>写缓存（覆盖）。失败只记录。</summary>
    public async Task SetAsync<T>(string key, T value, TimeSpan ttl, CancellationToken ct = default)
        where T : class
    {
        if (CircuitOpen) return;

        try
        {
            var json = JsonSerializer.Serialize(value, JsonOptions);
            await _cache.SetStringAsync(key, json, new DistributedCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = ttl
            }, ct);
            ReportSuccess();
        }
        catch (Exception ex)
        {
            ReportFailure("写", key, ex);
        }
    }

    /// <summary>主动失效。写操作之后必须调用它，这是保证一致性的主策略。</summary>
    public async Task RemoveAsync(string key, CancellationToken ct = default)
    {
        if (CircuitOpen) return;

        try
        {
            await _cache.RemoveAsync(key, ct);
            ReportSuccess();
        }
        catch (Exception ex)
        {
            // 删不掉比读不到更值得关注：意味着接下来一段时间会读到旧值，
            // 只能靠 TTL 兜底，所以这里带键名，便于排查
            ReportFailure("删", key, ex);
        }
    }

    /// <summary>先查缓存，未命中则执行工厂并回填。熔断期间直接执行工厂。</summary>
    public async Task<T> GetOrCreateAsync<T>(
        string key, Func<CancellationToken, Task<T>> factory, TimeSpan ttl, CancellationToken ct = default)
        where T : class
    {
        var hit = await GetAsync<T>(key, ct);
        if (hit != null) return hit;

        var value = await factory(ct);
        if (value != null) await SetAsync(key, value, ttl, ct);
        return value!;
    }

    private void ReportSuccess() => Interlocked.Exchange(ref _consecutiveFailures, 0);

    private void ReportFailure(string operation, string key, Exception ex)
    {
        var failures = Interlocked.Increment(ref _consecutiveFailures);
        if (failures < FailureThreshold)
        {
            _logger.LogWarning(ex, "缓存{Op}失败，按未命中处理：{CacheKey}", operation, key);
            return;
        }

        Volatile.Write(ref _circuitOpenUntilMs,
            Environment.TickCount64 + (long)CircuitCooldown.TotalMilliseconds);
        Interlocked.Exchange(ref _consecutiveFailures, 0);
        _logger.LogError(ex,
            "缓存连续失败 {Count} 次，已熔断 {Seconds} 秒：期间跳过缓存直接走数据库（最后失败：{Op} {CacheKey}）",
            FailureThreshold, CircuitCooldown.TotalSeconds, operation, key);
    }
}
