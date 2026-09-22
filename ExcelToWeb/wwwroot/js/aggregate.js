// ================================================================
// 汇总行（Excel 式「总计行」）
// ----------------------------------------------------------------
// 贴在表格底部的一行，对每个可见列给出聚合值，随全局搜索 / 排序 / 列筛选联动
// （即 Excel 的 SUBTOTAL 语义：只统计当前「看得到」的数据，不受分页影响）。
// 依赖：state.js、utils.js（escapeHtml）、view.js（buildDisplayRows / getVisibleHeaders）、
//       selection.js（formatNumber）、render.js 调用 buildAggregateRowHtml()
// ================================================================

/** 可选的汇总方式 */
const AGG_MODES = {
    sum: { label: '求和', unit: 'Σ' },
    avg: { label: '平均', unit: 'x̄' },
    count: { label: '计数', unit: 'n' },
    max: { label: '最大值', unit: '↑' },
    min: { label: '最小值', unit: '↓' }
};

const AGG_PREF_KEY = 'prefAggregate';

// 当前汇总方式 aggregateMode 声明在 state.js（与其余视图状态同归口）

/** 读取本地偏好（不触发渲染，供页面初始化时调用） */
function initAggregatePref() {
    const saved = localStorage.getItem(AGG_PREF_KEY);
    aggregateMode = (saved && (saved === 'off' || AGG_MODES[saved])) ? saved : 'off';
}

/**
 * 取某列在给定行集合里的数值数组。
 * 只要出现一个非数字（且非空）的值，就认为该列不是纯数值列，返回 null。
 */
function collectNumericValues(key, rows) {
    const nums = [];
    for (const row of rows) {
        const raw = row ? row[key] : undefined;
        if (raw === undefined || raw === null) continue;
        const s = String(raw).trim();
        if (s === '') continue;
        const n = Number(s);
        if (isNaN(n)) return null;
        nums.push(n);
    }
    return nums;
}

/** 非空单元格计数（不要求是数字） */
function countNonEmpty(key, rows) {
    let n = 0;
    for (const row of rows) {
        const raw = row ? row[key] : undefined;
        if (raw === undefined || raw === null) continue;
        if (String(raw).trim() === '') continue;
        n++;
    }
    return n;
}

/**
 * 计算单列的汇总值。
 * @returns {number|null} null 表示该列不适用（非数值列，或没有可汇总的数据）
 */
function computeColumnAggregate(key, rows) {
    if (aggregateMode === 'count') {
        const n = countNonEmpty(key, rows);
        return n > 0 ? n : null;
    }

    const nums = collectNumericValues(key, rows);
    if (!nums || nums.length === 0) return null;

    switch (aggregateMode) {
        case 'sum': return nums.reduce((a, b) => a + b, 0);
        case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
        case 'max': return Math.max.apply(null, nums);
        case 'min': return Math.min.apply(null, nums);
        default: return null;
    }
}

/** 汇总方式下拉框 */
function buildAggregateSelectHtml() {
    let html = '<select class="aggregate-select" aria-label="汇总方式" onchange="setAggregateMode(this.value)">';
    for (const mode of Object.keys(AGG_MODES)) {
        const selected = aggregateMode === mode ? ' selected' : '';
        html += `<option value="${mode}"${selected}>${AGG_MODES[mode].label}</option>`;
    }
    html += `<option value="off"${aggregateMode === 'off' ? ' selected' : ''}>关闭汇总</option>`;
    html += '</select>';
    return html;
}

/** 汇总行的各列数值单元格 */
function buildAggregateCellsHtml(headers) {
    const rows = buildDisplayRows();
    const unit = AGG_MODES[aggregateMode] ? AGG_MODES[aggregateMode].unit : '';

    let html = '';
    for (const h of headers) {
        const value = computeColumnAggregate(h, rows);
        if (value === null) {
            html += '<td class="aggregate-cell is-empty" title="该列没有可汇总的数值">—</td>';
        } else {
            html += `<td class="aggregate-cell"><span class="aggregate-unit">${unit}</span>${escapeHtml(formatNumber(value))}</td>`;
        }
    }
    return html;
}

/** 汇总行整体 HTML（被 render.js 拼进表格） */
function buildAggregateRowHtml(headers) {
    if (aggregateMode === 'off') return '';

    let html = '<tfoot><tr class="aggregate-row" id="aggregateRow">';
    html += '<td class="col-pin col-pin-1"></td>';
    html += `<td class="col-pin col-pin-2 aggregate-label">${buildAggregateSelectHtml()}</td>`;
    html += buildAggregateCellsHtml(headers);
    html += '</tr></tfoot>';
    return html;
}

/**
 * 只刷新汇总行本身，不重建整张表。
 * 切换汇总方式时用它，避免丢掉滚动位置与当前编辑焦点。
 */
function refreshAggregateRow() {
    const row = document.getElementById('aggregateRow');
    if (!row) return;
    row.innerHTML = '<td class="col-pin col-pin-1"></td>'
        + `<td class="col-pin col-pin-2 aggregate-label">${buildAggregateSelectHtml()}</td>`
        + buildAggregateCellsHtml(getVisibleHeaders());
}

/** 切换汇总方式（下拉框 onchange） */
function setAggregateMode(mode) {
    if (mode !== 'off' && !AGG_MODES[mode]) return;
    const wasOff = aggregateMode === 'off';
    aggregateMode = mode;
    localStorage.setItem(AGG_PREF_KEY, mode);

    // 由「关闭」切到某种汇总方式时，整行都不存在，需要整表重绘
    if (wasOff && mode !== 'off') {
        renderTable();
    } else if (mode === 'off') {
        renderTable();
    } else {
        refreshAggregateRow();
    }

    if (mode === 'off') setStatus('已关闭汇总行');
    else setStatus(`汇总方式：${AGG_MODES[mode].label}`);
}

/** 工具栏入口：显示 / 隐藏汇总行 */
function toggleAggregateRow() {
    setAggregateMode(aggregateMode === 'off' ? 'sum' : 'off');
    showToast(aggregateMode === 'off' ? '已关闭汇总行' : `✅ 汇总行：${AGG_MODES[aggregateMode].label}`, 'info');
}
