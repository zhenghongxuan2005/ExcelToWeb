// ================================================================
// 选中行统计：计数 / 求和 / 平均（仅对数值列）
// 依赖：state.js（currentRows / currentHeaders）、utils.js、view.js
// ================================================================

/** 收集当前被勾选的行在 currentRows 中的下标 */
function getSelectedIndexes() {
    const indexes = [];
    document.querySelectorAll('.row-checkbox').forEach(cb => {
        if (!cb.checked) return;
        const idx = parseInt(cb.dataset.index);
        if (!isNaN(idx)) indexes.push(idx);
    });
    return indexes;
}

/** 取选中行 + 选中列宽度内的统计面板 HTML */
function buildSelectionStatsHtml() {
    const indexes = getSelectedIndexes();
    if (indexes.length === 0) return '';

    const rows = indexes
        .map(i => currentRows[i])
        .filter(r => r !== undefined && r !== null);
    if (rows.length === 0) return '';

    let html = '<div class="selection-bar">';
    html += `<span class="selection-title"><svg class="icon icon-sm"><use href="#i-check"/></svg>已选 <strong>${rows.length}</strong> 行</span>`;

    // 只对「确实全是数字」的可见列做求和 / 平均，避免把日期、编号算进去
    for (const key of getVisibleHeaders()) {
        const nums = [];
        for (const row of rows) {
            const raw = row[key];
            if (raw === undefined || raw === null) continue;
            const s = String(raw).trim();
            if (s === '') continue;
            const n = Number(s);
            if (isNaN(n)) { nums.length = 0; break; }
            nums.push(n);
        }
        if (nums.length === 0 || nums.length < rows.length) continue;

        const sum = nums.reduce((a, b) => a + b, 0);
        const avg = sum / nums.length;
        html += '<span class="selection-stat">';
        html += `<span class="selection-col">${escapeHtml(key)}</span>`;
        html += `<span class="selection-sum">Σ ${formatNumber(sum)}</span>`;
        html += `<span class="selection-avg">x̄ ${formatNumber(avg)}</span>`;
        html += '</span>';
    }

    html += '</div>';
    return html;
}

/** 数字格式化：最多保留 2 位小数，去掉多余的 0 */
function formatNumber(n) {
    if (!isFinite(n)) return '-';
    return String(Math.round(n * 100) / 100);
}

/** 刷新选中统计面板（由勾选框变化触发） */
function updateSelectionStats() {
    const host = document.getElementById('selectionStats');
    if (!host) return;
    host.innerHTML = buildSelectionStatsHtml();
}

/** 清空选中统计面板 */
function clearSelectionStats() {
    const host = document.getElementById('selectionStats');
    if (host) host.innerHTML = '';
}
