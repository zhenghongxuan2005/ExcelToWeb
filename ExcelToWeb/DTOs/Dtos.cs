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

    /// <summary>数据来源的工作表名（多工作表文件导入时告知用户用的是哪张）</summary>
    public string SheetName { get; set; } = string.Empty;
}

/// <summary>工作表概要，供「多工作表时选一张导入」的弹窗展示</summary>
public class SheetInfoDto
{
    /// <summary>0 基序号，导入时原样回传</summary>
    public int Index { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>工作表实际行数（含表头行）</summary>
    public int RowCount { get; set; }

    public int ColumnCount { get; set; }

    /// <summary>是否有可导入的数据（至少 1 行表头 + 1 行数据）</summary>
    public bool HasData { get; set; }
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

    /// <summary>列视图元数据（列名 -> { width, hidden }），随数据一起返回，前端少一次请求</summary>
    public Dictionary<string, ColumnMetaDto> ColumnMeta { get; set; } = new();
}

/// <summary>
/// 单列的视图元数据。只保存用户显式调整过的偏好（列宽 / 是否隐藏）。
/// 列的数据类型（数字 / 日期 / 文本）在导出时按数据实时推断，不落库。
/// </summary>
public class ColumnMetaDto
{
    /// <summary>列宽（px）。null 表示自动</summary>
    public int? Width { get; set; }

    /// <summary>是否隐藏该列</summary>
    public bool Hidden { get; set; }
}

/// <summary>整表列元数据保存请求：列名 -> 元数据</summary>
public class SaveColumnMetaRequest
{
    public int TableId { get; set; }
    public Dictionary<string, ColumnMetaDto> Meta { get; set; } = new();
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
