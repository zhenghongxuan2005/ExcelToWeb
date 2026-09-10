using System.Net;
using System.Text.Json;
using ExcelToWeb.Models;

namespace ExcelToWeb.Middleware;

/// <summary>
/// 全局异常处理中间件
/// 开发环境回传异常明细便于排查；生产环境只返回通用提示 + 追踪号，细节仅记日志。
/// </summary>
public class ExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionMiddleware> _logger;
    private readonly IWebHostEnvironment _env;

    /// <summary>
    /// 与 MVC 默认序列化保持一致（camelCase），
    /// 否则前端拿到的是 PascalCase，读不到 result.success / result.message
    /// </summary>
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public ExceptionMiddleware(RequestDelegate next, ILogger<ExceptionMiddleware> logger, IWebHostEnvironment env)
    {
        _next = next;
        _logger = logger;
        _env = env;
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

        var message = _env.IsDevelopment()
            ? $"服务器内部错误: {ex.Message}"
            : $"服务器内部错误，请稍后重试（追踪号：{traceId}）";

        var response = ApiResponse.Fail(message);
        var json = JsonSerializer.Serialize(response, JsonOptions);

        context.Response.Clear();
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.StatusCode = (int)HttpStatusCode.InternalServerError;
        await context.Response.WriteAsync(json);
    }
}
