// ================================================================
// 权限（RBAC）：把服务端下发的权限码翻译成「界面能不能用」
// ----------------------------------------------------------------
// 服务端是唯一的安全边界：每个写接口都挂了授权策略，越权直接 403。
// 这里只负责体验——把用不了的入口藏起来，而不是让用户点完再报错。
// 权限码与「角色 → 权限」的映射只在服务端（Auth/Rbac.cs）维护一份，
// 前端不重新定义，避免两边各写一套字符串、日久对不上。
// ================================================================

const AUTHZ_PERM_KEY = 'permissions';
const AUTHZ_ROLE_KEY = 'role';

function storedPermissions() {
    try {
        const raw = localStorage.getItem(AUTHZ_PERM_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

/**
 * 是否拥有某项权限。
 * 权限列表为空时按「允许」处理：还没登录、或换账号前的旧登录态没有这个键，
 * 此时把整个界面藏空比让用户点一下拿到 403 更糟。安全由服务端保证。
 */
function can(permission) {
    const list = storedPermissions();
    if (list.length === 0) return true;
    return list.indexOf(permission) >= 0;
}

function currentRole() {
    return localStorage.getItem(AUTHZ_ROLE_KEY) || '';
}

/** 角色名统一由 shell.js 提供（每页都先加载它，设置页与成员卡共用同一套文案） */
function roleText(role) {
    const key = role || currentRole();
    if (typeof Shell !== 'undefined' && Shell.roleText) return Shell.roleText(key);
    return key || '只读';
}

/** 按 data-perm 隐藏无权使用的元素（hidden 属性，不影响布局规则） */
function applyPermissions(root) {
    const scope = root || document;
    if (!scope.querySelectorAll) return;
    scope.querySelectorAll('[data-perm]').forEach(el => {
        el.hidden = !can(el.getAttribute('data-perm'));
    });
}

/** 保存服务端下发的角色与权限并立即生效（登录成功、/auth/me、被改角色之后） */
function saveAuthz(data) {
    if (!data) return;
    if (data.role) localStorage.setItem(AUTHZ_ROLE_KEY, data.role);
    if (Array.isArray(data.permissions)) {
        localStorage.setItem(AUTHZ_PERM_KEY, JSON.stringify(data.permissions));
    }
    applyPermissions();
    if (typeof Shell !== 'undefined' && Shell.paintRole) Shell.paintRole();
}

/** 从服务端校准一次：本地缓存可能是旧角色（被管理员刚改过） */
function refreshAuthz() {
    if (typeof getCurrentUser !== 'function' || !localStorage.getItem('token')) {
        return Promise.resolve();
    }
    return getCurrentUser().then(data => {
        saveAuthz(data);
        return data;
    }).catch(() => null);   // 失败就用本地缓存，不阻断页面
}

document.addEventListener('DOMContentLoaded', () => {
    applyPermissions();
    refreshAuthz();
});

// 切语言后重新套一遍：data-perm 只是显隐，不受语言影响，
// 但成员卡等 JS 渲染的内容要自己重绘（见 members.js）
document.addEventListener('i18n:change', () => {
    applyPermissions();
});

window.Authz = {
    can: can,
    apply: applyPermissions,
    refresh: refreshAuthz,
    save: saveAuthz,
    role: currentRole,
    roleText: roleText
};
