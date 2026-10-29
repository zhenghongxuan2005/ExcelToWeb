namespace ExcelToWeb.Auth;

/// <summary>
/// 账号角色（固定三档）。
/// 存的是「角色」而不是逐条勾选的权限：本系统的权限只有五个维度，
/// 角色-权限表在这里是静态映射，没必要为此多两张表、多一套管理界面。
/// 将来真要自定义角色，把 <see cref="Rbac.ForRole"/> 换成查库即可，接口层不受影响。
/// </summary>
public enum UserRole
{
    /// <summary>只读：能看表、看板、审计与回收站列表，不能改任何数据</summary>
    Viewer = 1,

    /// <summary>编辑：在只读之上，可导入、保存、改列结构、写规则，不能删表</summary>
    Editor = 2,

    /// <summary>管理员：全量权限，并且是唯一能改别人角色的一档</summary>
    Admin = 3
}

/// <summary>
/// 权限码。写成「域:动作」的形式，接口层直接拿它当授权策略名，
/// 前端也拿同一串判断按钮显隐——两边共用一份定义，避免各写一套字符串。
/// </summary>
public static class Permission
{
    public const string TableRead = "table:read";
    public const string TableWrite = "table:write";
    public const string TableDelete = "table:delete";
    public const string TrashManage = "trash:manage";
    public const string MemberManage = "member:manage";
}

/// <summary>角色 → 权限的静态映射，以及给用户看的名称</summary>
public static class Rbac
{
    /// <summary>全部权限码，用于启动时批量注册授权策略</summary>
    public static readonly string[] All =
    [
        Permission.TableRead,
        Permission.TableWrite,
        Permission.TableDelete,
        Permission.TrashManage,
        Permission.MemberManage
    ];

    // 只读是所有人的底座：没有它连表格列表都打不开，等于账号不可用。
    // 因此每个角色都包含 TableRead，差异只在写、删、管理与成员四档上。
    private static readonly Dictionary<UserRole, string[]> Map = new()
    {
        [UserRole.Viewer] = [Permission.TableRead],
        [UserRole.Editor] = [Permission.TableRead, Permission.TableWrite],
        [UserRole.Admin] = All
    };

    public static string[] ForRole(UserRole role) =>
        Map.TryGetValue(role, out var permissions) ? permissions : [];

    public static bool Has(UserRole role, string permission) =>
        ForRole(role).Contains(permission);

    /// <summary>解析前端传来的角色名（大小写不敏感），非法值一律失败</summary>
    public static bool TryParse(string? value, out UserRole role) =>
        Enum.TryParse(value, ignoreCase: true, out role) && Enum.IsDefined(role);

    public static string Label(UserRole role) => role switch
    {
        UserRole.Admin => "管理员",
        UserRole.Editor => "编辑",
        UserRole.Viewer => "只读",
        _ => "未知"
    };

    /// <summary>权限码的中文名，用在 403 提示里（“需要「删除表格」权限”）</summary>
    public static string PermissionLabel(string code) => code switch
    {
        Permission.TableRead => "查看表格",
        Permission.TableWrite => "编辑表格",
        Permission.TableDelete => "删除表格",
        Permission.TrashManage => "管理回收站",
        Permission.MemberManage => "管理成员",
        _ => code
    };
}
