namespace ExcelToWeb.Models;

/// <summary>
/// 失败原因的分类。控制器据此决定 HTTP 状态码，前端也能按类型分支处理，
/// 不必去猜中文文案。
///
/// 存在的理由：原先所有失败一律 400（查询类接口又是 404），于是「少了 tableId」
/// 和「这张表真的不存在」返回同一个码、同一句「表格不存在」——
/// 排障时按文案判断方向会直接跑偏，客户端也无法区分「该提示用户刷新」还是
/// 「该提示重新登录/找管理员」。
/// </summary>
public enum ApiErrorKind
{
    None = 0,

    /// <summary>参数缺失 / 格式不对 / 业务校验没过 —— 400</summary>
    Invalid = 1,

    /// <summary>目标资源不存在，或不属于当前用户（对外不区分，避免探测他人数据）—— 404</summary>
    NotFound = 2,

    /// <summary>有身份但没权限 —— 403</summary>
    Forbidden = 3
}

/// <summary>
/// 统一 API 响应模型
/// </summary>
public class ApiResponse
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;

    /// <summary>失败类型；成功时恒为 <see cref="ApiErrorKind.None"/></summary>
    public ApiErrorKind Error { get; set; } = ApiErrorKind.None;

    public static ApiResponse Ok(string message = "操作成功") => new() { Success = true, Message = message };

    public static ApiResponse Fail(string message, ApiErrorKind kind = ApiErrorKind.Invalid)
        => new() { Success = false, Message = message, Error = kind };

    /// <summary>资源不存在（表格不存在 / 不属于当前用户 / 已被删除）</summary>
    public static ApiResponse NotFound(string message) => Fail(message, ApiErrorKind.NotFound);
}

public class ApiResponse<T> : ApiResponse
{
    public T? Data { get; set; }

    public static ApiResponse<T> Ok(T data, string message = "操作成功")
        => new() { Success = true, Message = message, Data = data };

    public new static ApiResponse<T> Fail(string message, ApiErrorKind kind = ApiErrorKind.Invalid)
        => new() { Success = false, Message = message, Error = kind };

    public new static ApiResponse<T> NotFound(string message)
        => Fail(message, ApiErrorKind.NotFound);
}
