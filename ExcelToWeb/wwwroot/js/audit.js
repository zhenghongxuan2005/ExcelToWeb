// ================================================================
// 变更历史（审计日志）：整表时间线 + 行级历史
// 依赖：state.js（currentTableId）、utils.js、api.js（fetchAuditLogs）
// 说明：行号是「保存当时」的行位置（从 1 开始）；行增删后旧记录的行号不再对齐，
//       弹窗文案里已向用户说明这一点。
// ================================================================

let historyRowIndex = null;   // null = 整表历史；数字 = 只看该行（1 起始）

/** 打开变更历史弹窗；rowIndex 可选（1 起始），不传则看整表 */
function openHistoryModal(rowIndex) {
    if (!currentTableId) {
        showToast('请先选择一个表格', 'info');
        return;
    }
    historyRowIndex = rowIndex || null;
    document.getElementById('historyModal').style.display = 'flex';
    loadHistoryList();
}

/** 行号格里的时钟按钮入口：actualIndex 是 currentRows 下标（0 起始），审计行号从 1 开始 */
function openRowHistory(actualIndex, evt) {
    if (evt) evt.stopPropagation();
    openHistoryModal(actualIndex + 1);
}

function closeHistoryModal() {
    document.getElementById('historyModal').style.display = 'none';
}

/** 清掉「只看某行」的过滤，回到整表历史 */
function clearHistoryFilter() {
    historyRowIndex = null;
    loadHistoryList();
}

function loadHistoryList() {
    const host = document.getElementById('historyList');
    if (!host) return;

    const titleEl = document.getElementById('historyTitle');
    if (titleEl) titleEl.textContent = historyRowIndex ? `第 ${historyRowIndex} 行的变更历史` : '变更历史';

    const chip = document.getElementById('historyFilterChip');
    if (chip) {
        chip.style.display = historyRowIndex ? 'inline-flex' : 'none';
        const label = document.getElementById('historyFilterText');
        if (label) label.textContent = `只看第 ${historyRowIndex} 行`;
    }

    // 加载骨架（复用 table.css 的 skeleton-block）
    host.innerHTML = '<div class="skeleton-block" style="height:16px; width:60%;"></div>'
        + '<div class="skeleton-block" style="height:16px; width:85%; margin-top:12px;"></div>'
        + '<div class="skeleton-block" style="height:16px; width:72%; margin-top:12px;"></div>';

    fetchAuditLogs(currentTableId, historyRowIndex)
        .then(logs => renderHistoryList(logs || []))
        .catch(err => {
            host.innerHTML = `<p class="muted-center">加载失败：${escapeHtml(err.message)}</p>`;
        });
}

function renderHistoryList(logs) {
    const host = document.getElementById('historyList');
    if (!host) return;

    if (logs.length === 0) {
        host.innerHTML = '<p class="muted-center">还没有变更记录——保存一次数据后这里会出现时间线</p>';
        return;
    }

    let html = '';
    for (const log of logs) {
        html += '<div class="history-item">';
        html += `<span class="history-badge history-badge-${escapeHtml(log.action)}"></span>`;
        html += '<div class="history-body">';

        if (log.action === 'edit') {
            html += `<div class="history-summary">第 ${log.rowIndex} 行 · <strong>${escapeHtml(log.columnName)}</strong>：</div>`
                + '<div class="history-change">'
                + `<span class="history-old" title="旧值">${escapeHtml(log.oldValue) || '<空>'}</span>`
                + '<svg class="icon icon-sm"><use href="#i-chevron-right"/></svg>'
                + `<span class="history-new" title="新值">${escapeHtml(log.newValue) || '<空>'}</span>`
                + '</div>';
        } else if (log.action === 'add-row') {
            html += `<div class="history-summary">新增了第 ${log.rowIndex} 行</div>`;
        } else if (log.action === 'delete-row') {
            html += `<div class="history-summary">删除了第 ${log.rowIndex} 行</div>`;
        } else {
            html += `<div class="history-summary">批量变更（${escapeHtml(log.newValue)}）</div>`;
        }

        html += `<div class="history-meta">${escapeHtml(log.userName)} · ${formatTime(log.createdAt)}</div>`;
        html += '</div></div>';
    }
    host.innerHTML = html;
}
