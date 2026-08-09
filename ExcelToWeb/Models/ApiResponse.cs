namespace ExcelToWeb.Models;

/// <summary>
/// 统一 API 响应模型
/// </summary>
public class ApiResponse
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;

    public static ApiResponse Ok(string message = "操作成功") => new() { Success = true, Message = message };
    public static ApiResponse Fail(string message) => new() { Success = false, Message = message };
}

public class ApiResponse<T> : ApiResponse
{
    public T? Data { get; set; }

    public static ApiResponse<T> Ok(T data, string message = "操作成功") => new() { Success = true, Message = message, Data = data };
    public new static ApiResponse<T> Fail(string message) => new() { Success = false, Message = message };
}
