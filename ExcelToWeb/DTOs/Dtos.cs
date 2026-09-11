namespace ExcelToWeb.DTOs;

// ===== 认证相关 DTO =====

public class LoginRequest
{
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class RegisterRequest
{
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string ConfirmPassword { get; set; } = string.Empty;
}

public class AuthResponse
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Token { get; set; } = string.Empty;
}

/// <summary>修改密码请求（需登录，且校验原密码）</summary>
public class ChangePasswordRequest
{
    public string OldPassword { get; set; } = string.Empty;
    public string NewPassword { get; set; } = string.Empty;
    public string ConfirmPassword { get; set; } = string.Empty;
}

// ===== Excel 相关 DTO =====

public class SaveRequest
{
    public int TableId { get; set; }
    public List<Dictionary<string, object>> Rows { get; set; } = new();
}

public class UploadResult
{
    public int TableId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public List<string> Headers { get; set; } = new();
    public List<Dictionary<string, object>> Rows { get; set; } = new();
}

public class TableInfoDto
{
    public int Id { get; set; }
    public string TableName { get; set; } = string.Empty;
    public List<string> Headers { get; set; } = new();
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class TableDataDto
{
    public int TableId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public List<string> Headers { get; set; } = new();
    public List<Dictionary<string, object>> Rows { get; set; } = new();
}

public class RenameTableRequest
{
    public int TableId { get; set; }
    public string TableName { get; set; } = string.Empty;
}

public class DuplicateTableRequest
{
    public int TableId { get; set; }
}

/// <summary>
/// 列结构重命名条目：把指定列在所有数据行里的键改名为新名（保留数据）。
/// </summary>
public class ColumnRenameItem
{
    public string OldName { get; set; } = string.Empty;
    public string NewName { get; set; } = string.Empty;
}

/// <summary>
/// 整列结构更新请求：一次性表达「最终列名顺序 + 重命名 + （隐含的）增/删」。
/// 服务端从「旧的列集合」与「headers」做集合差即可推出 dropped/added，
/// 调用方不必再单传 droppedColumns，避免请求字段太多相互矛盾。
/// </summary>
public class UpdateHeadersRequest
{
    public int TableId { get; set; }

    /// <summary>最终列名（顺序就是新顺序）</summary>
    public List<string> Headers { get; set; } = new();

    /// <summary>可选：把数据从 oldName 复制到 newName（不传视为直接 dropped + added）</summary>
    public List<ColumnRenameItem> Renames { get; set; } = new();
}
