// ================================================================
// 回收站（trash.html）：已删除表格列表 + 恢复 / 彻底删除
// ----------------------------------------------------------------
// 依赖：api.js（fetchTrash / restoreFromTrash / purgeTableForever）、
//       utils.js（escapeHtml / formatTime / showToast）、shell.js
// 说明：删除走软删除，这里列出的表数据行仍完整保留；恢复只是清掉删除标记。
//       卡片样式复用 table.css 的 table-card，与表格管理页视觉一致。
// ================================================================

// 保留天数的**兜底值**：真实值由 /api/excel/trash/policy 下发（后台清理任务用的是同一份配置）。
// 这里保留一个默认值只是为了「策略接口临时失败时页面还能出来」，不让请求失败变成白屏。
const TRASH_RETENTION_FALLBACK = 30;

let trashRetentionDays = TRASH_RETENTION_FALLBACK;
let trashItems = [];

// ----- 初始化（脚本在 body 末尾加载，DOM 已就绪） -----
(async function initTrashPage() {
    'use strict';

    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    const username = localStorage.getItem('username');
    const userInfoEl = document.getElementById('userInfo');
    if (userInfoEl && username) userInfoEl.textContent = username;

    // 先拿策略再拉列表：列表渲染时就要用「N 天后自动清除」里的 N，
    // 反过来（先渲染再改口径）会让用户看到一次 30 天后跳成别的数字
    await loadRetentionPolicy();
    loadTrashList();
})();

/** 读取保留天数；失败保持兜底值，绝不抛出（它只是文案精度，不是功能依赖） */
async function loadRetentionPolicy() {
    try {
        const policy = await fetchTrashPolicy();
        const days = policy && policy.retentionDays;
        if (typeof days === 'number' && days > 0) trashRetentionDays = days;
    } catch (e) {
        // 服务端没给就用兜底值：宁可文案里的天数不准，也不要整页报错
        trashRetentionDays = TRASH_RETENTION_FALLBACK;
    }
}

/** 拉取回收站列表并渲染 */
function loadTrashList() {
    const host = document.getElementById('trashGrid');
    if (!host) return;

    host.innerHTML = '<div class="skeleton-block" style="height:80px; width:100%;"></div>'
        + '<div class="skeleton-block" style="height:80px; width:100%; margin-top:12px;"></div>';

    fetchTrash()
        .then(items => {
            trashItems = items || [];
            renderTrashList();
        })
        .catch(err => {
            host.innerHTML = '<div class="empty-state">'
                + '<div class="empty-icon"><svg class="icon"><use href="#i-x-circle"/></svg></div>'
                + `<p>${escapeHtml(tt('加载失败：{msg}', { msg: err.message }))}</p>`
                + '</div>';
        });
}

/** 渲染回收站卡片列表 */
function renderTrashList() {
    const host = document.getElementById('trashGrid');
    const countEl = document.getElementById('trashCount');
    if (!host) return;

    if (countEl) {
        countEl.textContent = trashItems.length === 0
            ? ''
            : tt('{n} 个已删除表格', { n: trashItems.length });
    }

    if (trashItems.length === 0) {
        host.innerHTML = '<div class="empty-state">'
            + '<div class="empty-icon"><svg class="icon"><use href="#i-inbox"/></svg></div>'
            + '<p>' + tt('回收站是空的') + '</p>'
            + '<p class="empty-sub">' + tt('删除的表格会出现在这里，{n} 天内可恢复', { n: trashRetentionDays }) + '</p>'
            + '<a class="btn btn-primary" href="/tables.html" style="margin-top:14px;">'
            + '<svg class="icon"><use href="#i-columns"/></svg>' + tt('查看表格管理') + '</a>'
            + '</div>';
        return;
    }

    let html = '';
    for (const t of trashItems) {
        const daysLeft = daysRemaining(t.deletedAt);
        html += '<div class="table-card">';
        html += '<div class="card-head">';
        html += '<div class="card-icon"><svg class="icon"><use href="#i-trash"/></svg></div>';
        html += `<h3 class="card-title" title="${escapeHtml(t.tableName)}">${escapeHtml(t.tableName)}</h3>`;
        html += '</div>';

        html += '<div class="card-meta">';
        html += `<span><svg class="icon icon-sm"><use href="#i-columns"/></svg>${tt('{n} 行数据', { n: t.rowCount })}</span>`;
        html += `<span><svg class="icon icon-sm"><use href="#i-clock"/></svg>${tt('删除于 {time}', { time: escapeHtml(formatTime(t.deletedAt)) })}</span>`;
        html += `<span><svg class="icon icon-sm"><use href="#i-info"/></svg>${tt('{n} 天后自动清除', { n: daysLeft })}</span>`;
        html += '</div>';

        html += '<div class="card-actions">';
        html += `<button class="btn btn-primary btn-sm" data-perm="trash:manage" onclick="doRestore(${t.id})">`
            + '<svg class="icon icon-sm"><use href="#i-refresh"/></svg>' + tt('恢复') + '</button>';
        html += `<button class="btn btn-danger btn-sm" data-perm="trash:manage" onclick="doPurge(${t.id})">`
            + '<svg class="icon icon-sm"><use href="#i-trash"/></svg>' + tt('彻底删除') + '</button>';
        html += '</div>';

        html += '</div>';
    }
    host.innerHTML = html;
    // 新插入的按钮也要按权限过一遍：没有「管理回收站」的账号只看到列表，看不到操作
    if (typeof Authz !== "undefined") Authz.apply(host);
}

/** 删除时间（UTC ISO）→ 剩余保留天数（向上取整，删除当天算满期） */
function daysRemaining(deletedAtIso) {
    const deleted = new Date(deletedAtIso).getTime();
    if (isNaN(deleted)) return trashRetentionDays;
    const elapsed = Date.now() - deleted;
    const left = trashRetentionDays - elapsed / 86400000;
    return Math.max(0, Math.ceil(left));
}

/** 恢复表格（无需二次确认：恢复没有破坏性） */
function doRestore(tableId) {
    restoreFromTrash(tableId)
        .then(msg => {
            showToast('✅ ' + tt(msg || '已恢复'), 'success');
            loadTrashList();
        })
        .catch(err => showToast('❌ ' + tt('恢复失败：{msg}', { msg: err.message }), 'error'));
}

/** 彻底删除（二次确认，含表格名——这一步不可恢复） */
function doPurge(tableId) {
    const t = trashItems.find(x => x.id === tableId);
    const name = t ? t.tableName : tt('该表格');
    if (!confirm(tt('确定要彻底删除「{name}」吗？其全部数据、变更历史与校验规则都将被清除，此操作不可恢复。', { name: name }))) return;

    purgeTableForever(tableId)
        .then(msg => {
            showToast('✅ ' + tt(msg || '已彻底删除'), 'success');
            loadTrashList();
        })
        .catch(err => showToast('❌ ' + tt('彻底删除失败：{msg}', { msg: err.message }), 'error'));
}

// 卡片里的「删除于 {time}」「{n} 天后自动清除」是按当前语言拼出来的，
// 已经写进 DOM 的整串没有可匹配的字典条目 —— 切换语言后只能整块重渲染。
document.addEventListener('i18n:change', () => {
    // 首屏还在骨架屏阶段就跳过：loadTrashList 回来时会按新语言渲染
    if (document.querySelector('#trashGrid .skeleton-block')) return;
    renderTrashList();
});

// 暴露给内联 onclick
Object.assign(window, { doRestore, doPurge });
