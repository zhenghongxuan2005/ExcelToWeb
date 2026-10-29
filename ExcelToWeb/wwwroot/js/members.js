// ================================================================
// 设置页「成员」分区（RBAC）
// ----------------------------------------------------------------
// 只有拥有 member:manage 的账号才渲染——没有权限时整块由 authz.js 按
// data-perm 隐藏，这里再加一道判断，省掉一次必然 403 的请求。
// 角色修改是即时生效的：服务端授权每次都读库，不依赖令牌里的快照，
// 所以不需要让对方重新登录。
// ================================================================

let memberCache = [];

function initMembers() {
    const host = document.getElementById('memberList');
    if (!host) return;
    if (typeof Authz !== 'undefined' && !Authz.can('member:manage')) return;
    loadMembers();
}

function loadMembers() {
    const host = document.getElementById('memberList');
    if (!host) return;

    fetchMembers()
        .then(rows => {
            memberCache = rows || [];
            renderMembers();
        })
        .catch(err => {
            host.innerHTML = '<p class="panel-hint">'
                + tt('成员列表加载失败：{msg}', { msg: escapeHtml(err.message) }) + '</p>';
        });
}

function renderMembers() {
    const host = document.getElementById('memberList');
    if (!host) return;

    const countEl = document.getElementById('memberCount');
    if (countEl) countEl.textContent = tt('{n} 名成员', { n: memberCache.length });

    if (memberCache.length === 0) {
        host.innerHTML = '<p class="panel-hint">' + tt('还没有其他账号。') + '</p>';
        return;
    }

    // 角色下拉直接列三档：管理员 / 编辑 / 只读。
    // 自己的那一行禁用——改自己等于给自己降权，容易把唯一管理员锁在门外。
    const roles = ['Admin', 'Editor', 'Viewer'];
    host.innerHTML = memberCache.map(m => {
        const options = roles.map(r =>
            '<option value="' + r + '"' + (r === m.role ? ' selected' : '') + '>'
            + escapeHtml(Authz.roleText(r)) + '</option>').join('');
        return '<div class="member-row">'
            + '<span class="member-avatar" aria-hidden="true">'
            + escapeHtml(String(m.username).slice(0, 1).toUpperCase()) + '</span>'
            + '<div class="member-meta">'
            + '<span class="member-name">' + escapeHtml(m.username)
            + (m.isSelf ? ' <span class="member-badge">' + tt('当前账号') + '</span>' : '') + '</span>'
            + '<span class="member-since">'
            + escapeHtml(m.lastLoginAt
                ? tt('最后登录 {time}', { time: formatTime(m.lastLoginAt) })
                : tt('从未登录')) + '</span>'
            + '</div>'
            + '<select class="table-select member-role" aria-label="' + escapeHtml(tt('成员角色')) + '"'
            + ' data-role-for="' + m.id + '"'
            + (m.isSelf ? ' disabled' : '')
            + ' onchange="onMemberRoleChange(' + m.id + ', this.value)">'
            + options + '</select>'
            + '</div>';
    }).join('');
}

/** 改角色：确认后提交；失败把下拉恢复成原值（否则界面会显示一个并未生效的角色） */
function onMemberRoleChange(userId, nextRole) {
    const member = memberCache.find(m => m.id === userId);
    const name = member ? member.username : String(userId);
    const ask = tt('把「{name}」设为{role}？权限变更立即生效。', {
        name: name,
        role: Authz.roleText(nextRole)
    });

    if (!confirm(ask)) {
        renderMembers();   // 取消：下拉回到库里的真实角色
        return;
    }

    updateMemberRole(userId, nextRole)
        .then(msg => {
            const text = (msg && msg.message) || tt('角色已更新');
            showToast('✅ ' + tt(text), 'success');
            loadMembers();
        })
        .catch(err => {
            showToast('❌ ' + err.message, 'error');
            renderMembers();
        });
}

// 切语言后角色名与「最后登录」都要重绘（这些是 JS 拼出来的，遍历翻不到）
document.addEventListener('i18n:change', () => {
    if (memberCache.length > 0) renderMembers();
});

document.addEventListener('DOMContentLoaded', initMembers);
