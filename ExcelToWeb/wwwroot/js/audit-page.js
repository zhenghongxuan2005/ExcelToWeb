// ================================================================
// 审计中心（audit.html）：跨表审计时间线 + 筛选 + 分页
// ----------------------------------------------------------------
// 依赖：api.js（request / fetchTableList）、utils.js（escapeHtml / formatTime / showToast）
// 说明：单表「变更历史」弹窗在表格编辑页（js/audit.js），本文件只负责审计中心页。
//       时间线样式复用 history.css 的 history-item / history-badge。
//       「查看表格」走 localStorage.openTableId 一次性深链，tables.js 加载时消费。
// ================================================================

const AUDIT_PAGE_SIZE = 50;   // 与服务端上限（100）之内取一个舒适值
let auditPage = 1;
let auditTotal = 0;

// ----- 初始化（脚本在 body 末尾加载，DOM 已就绪） -----
(function initAuditPage() {
    'use strict';

    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    const username = localStorage.getItem('username');
    const userInfoEl = document.getElementById('userInfo');
    if (userInfoEl && username) userInfoEl.textContent = username;

    loadAuditTableOptions();
    loadAuditCenter();

    // 语言切换后日期格式、分页文案都变了，重新取一次最省事（数据量 50 条/页，代价可忽略）
    document.addEventListener('i18n:change', () => loadAuditCenter());
})();

/** 拉取当前用户的表格清单填进筛选下拉；拉不到只影响筛选项，不阻塞时间线 */
function loadAuditTableOptions() {
    return fetchTableList()
        .then(tables => {
            const select = document.getElementById('auditTableSelect');
            if (!select || !tables) return;
            select.innerHTML = '<option value="">全部表格</option>' + tables.map(t =>
                `<option value="${t.id}">${escapeHtml(t.tableName)}</option>`).join('');
        })
        .catch(() => { /* 保持「全部表格」单项即可 */ });
}

/** 读取筛选条件发起查询。from/to 转本地 0 点的 UTC ISO（审计时间统一按 UTC 存取比较） */
function loadAuditCenter() {
    const host = document.getElementById('auditTimeline');
    const pagerEl = document.getElementById('auditPager');
    if (!host) return;

    host.innerHTML = '<div class="skeleton-block" style="height:16px; width:60%;"></div>'
        + '<div class="skeleton-block" style="height:16px; width:85%; margin-top:12px;"></div>'
        + '<div class="skeleton-block" style="height:16px; width:72%; margin-top:12px;"></div>';
    pagerEl.innerHTML = '';

    const params = new URLSearchParams();
    const tableId = document.getElementById('auditTableSelect').value;
    const actionType = document.getElementById('auditActionSelect').value;
    const from = localDateToUtcIso(document.getElementById('auditDateFrom').value);
    const to = localDateToUtcIso(document.getElementById('auditDateTo').value);
    if (tableId) params.set('tableId', tableId);
    if (actionType) params.set('actionType', actionType);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('page', auditPage);
    params.set('pageSize', AUDIT_PAGE_SIZE);

    request('/excel/audit-center?' + params.toString())
        .then(data => {
            auditTotal = (data && data.total) || 0;
            renderAuditTimeline((data && data.logs) || []);
        })
        .catch(err => {
            host.innerHTML = `<p class="muted-center">${escapeHtml(tt('加载失败：{msg}', { msg: err.message }))}</p>`;
        });
}

/** date input 的 "YYYY-MM-DD" → 本地当天 0 点的 UTC ISO；空/非法返回 null */
function localDateToUtcIso(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d.toISOString();
}

/** 时间线渲染。结构与表格编辑页的变更历史弹窗保持一致，仅多了所属表格标识 */
function renderAuditTimeline(logs) {
    const host = document.getElementById('auditTimeline');
    const pagerEl = document.getElementById('auditPager');

    if (logs.length === 0) {
        pagerEl.innerHTML = '';
        host.innerHTML = '<div class="empty-state">'
            + '<div class="empty-icon"><svg class="icon"><use href="#i-inbox"/></svg></div>'
            + '<p>' + tt('没有符合条件的变更记录') + '</p>'
            + '<p class="empty-sub">' + tt('编辑表格数据后这里会出现时间线') + '</p>'
            + '</div>';
        return;
    }

    let html = '';
    for (const log of logs) {
        html += '<div class="history-item">';
        html += `<span class="history-badge history-badge-${escapeHtml(log.action)}"></span>`;
        html += '<div class="history-body">';
        html += `<span class="audit-table-chip" title="${tt('跳转到该表格')}" onclick="gotoTable(${log.tableId})">${escapeHtml(log.tableName)}</span>`;

        if (log.action === 'edit') {
            html += `<div class="history-summary">${tt('第 {n} 行 · {col}：', { n: log.rowIndex, col: '<strong>' + escapeHtml(log.columnName) + '</strong>' })}</div>`
                + '<div class="history-change">'
                + `<span class="history-old" title="${tt('旧值')}">${escapeHtml(log.oldValue) || '&lt;' + tt('空') + '&gt;'}</span>`
                + '<svg class="icon icon-sm"><use href="#i-chevron-right"/></svg>'
                + `<span class="history-new" title="${tt('新值')}">${escapeHtml(log.newValue) || '&lt;' + tt('空') + '&gt;'}</span>`
                + '</div>';
        } else if (log.action === 'add-row') {
            html += `<div class="history-summary">${tt('新增了第 {n} 行', { n: log.rowIndex })}</div>`;
        } else if (log.action === 'delete-row') {
            html += `<div class="history-summary">${tt('删除了第 {n} 行', { n: log.rowIndex })}</div>`;
        } else {
            html += `<div class="history-summary">${tt('批量变更（{v}）', { v: escapeHtml(log.newValue) })}</div>`;
        }

        html += `<div class="history-meta">${escapeHtml(log.userName)} · ${formatTime(log.createdAt)}</div>`;
        html += '</div></div>';
    }
    host.innerHTML = html;
    renderAuditPager();
}

/** 分页条：共 N 条 / 上一页 / 第 x 页 / 下一页 */
function renderAuditPager() {
    const pagerEl = document.getElementById('auditPager');
    const totalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));
    let html = `<span class="pager-info">${tt('共 {n} 条记录', { n: auditTotal })}</span>`;
    html += `<button class="pager-btn" onclick="onAuditPageChange(-1)" ${auditPage <= 1 ? 'disabled' : ''}>${tt('上一页')}</button>`;
    html += `<span class="pager-current">${tt('第 {page} / {total} 页', { page: auditPage, total: totalPages })}</span>`;
    html += `<button class="pager-btn" onclick="onAuditPageChange(1)" ${auditPage >= totalPages ? 'disabled' : ''}>${tt('下一页')}</button>`;
    pagerEl.innerHTML = html;
}

function onAuditPageChange(delta) {
    const totalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));
    const next = auditPage + delta;
    if (next < 1 || next > totalPages) return;
    auditPage = next;
    loadAuditCenter();
}

/** 查询：任何条件变化都从第 1 页重新开始 */
function onAuditSearch() {
    auditPage = 1;
    loadAuditCenter();
}

/** 重置全部筛选条件并重新查询 */
function onAuditReset() {
    document.getElementById('auditTableSelect').value = '';
    document.getElementById('auditActionSelect').value = '';
    document.getElementById('auditDateFrom').value = '';
    document.getElementById('auditDateTo').value = '';
    onAuditSearch();
}

/** 跳回表格编辑页并定位到该表（tables.js 消费 localStorage.openTableId 一次性深链） */
function gotoTable(tableId) {
    localStorage.setItem('openTableId', String(tableId));
    window.location.href = '/';
}
