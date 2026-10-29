// ================================================================
// 成员管理接口（RBAC）
// ----------------------------------------------------------------
// 单独成文件而不是塞进 api.js：那边已经到 400 行上限，且成员管理是独立的域，
// 只有设置页会用到。request() / authHeaders() 仍是 api.js 里的公共实现。
// ================================================================

/** 成员列表：id / username / role / roleLabel / createdAt / lastLoginAt / isSelf */
function fetchMembers() {
    return request('/users');
}

/** 修改成员角色：role 取 Admin / Editor / Viewer */
function updateMemberRole(userId, role) {
    return request('/users/' + userId + '/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: role })
    });
}
