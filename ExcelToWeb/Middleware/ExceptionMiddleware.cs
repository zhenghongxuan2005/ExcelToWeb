using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace ExcelToWeb.Middleware;

/// <summary>
/// 全局异常处理中间件：未捕获的异常统一以 RFC 7807 ProblemDetails（application/problem+json）返回。
/// 开发环境回传异常明细便于排查；生产环境只返回通用提示 + 追踪号，细节仅记日志。
/// 注意分工：业务接口的 4xx 仍走各 Controller 的 ApiResponse { success, message } 契约
/// （Python 测试依赖这个结构），本中间件只接管 500 这一层。
/// </summary>
public class ExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionMiddleware> _logger;
    private readonly IWebHostEnvironment _env;
    private readonly IProblemDetailsService _problemDetails;

    public ExceptionMiddleware(RequestDelegate next, ILogger<ExceptionMiddleware> logger,
        IWebHostEnvironment env, IProblemDetailsService problemDetails)
    {
        _next = next;
        _logger = logger;
        _env = env;
        _problemDetails = problemDetails;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            var traceId = context.TraceIdentifier;
            _logger.LogError(ex, "未处理的异常 [{TraceId}]: {Message}", traceId, ex.Message);
            await HandleExceptionAsync(context, ex, traceId);
        }
    }

    private async Task HandleExceptionAsync(HttpContext context, Exception ex, string traceId)
    {
        // 响应已开始写出时无法再改状态码与响应体，只能记录日志
        if (context.Response.HasStarted)
        {
            _logger.LogWarning("响应已开始，无法写入异常响应 [{TraceId}]", traceId);
            return;
        }

        // RFC 7807：type 指向规范中 500 的定义；detail 按环境区分敏感度
        var detail = _env.IsDevelopment()
            ? $"服务器内部错误: {ex.Message}"
            : $"服务器内部错误，请稍后重试（追踪号：{traceId}）";

        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status500InternalServerError,
            Title = "Internal Server Error",
            Type = "https://tools.ietf.org/html/rfc9110#section-15.6.1",
            Instance = context.Request.Path,
            Detail = detail
        };
        problem.Extensions["traceId"] = traceId;
        // 扩展字段带上 message：前端 api.js 的统一解析读的是 result.message，
        // 不带它 500 的提示会退化成笼统的「请求失败」。RFC 7807 允许扩展成员。
        problem.Extensions["message"] = detail;

        if (!await _problemDetails.TryWriteAsync(new ProblemDetailsContext
            {
                HttpContext = context,
                ProblemDetails = problem
            }))
        {
            // 兜底：ProblemDetails 服务不可用时退回普通 JSON，保证客户端总能拿到结构化响应
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/json; charset=utf-8";
            await context.Response.WriteAsync(JsonSerializer.Serialize(
                new { success = false, message = detail },
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
        }
    }
}
