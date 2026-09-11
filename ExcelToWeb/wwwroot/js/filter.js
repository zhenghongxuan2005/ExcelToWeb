// ================================================================
// 排序 + 筛选
// ----------------------------------------------------------------
// 全部是「视图层」操作：只决定显示哪些行，绝不改写 currentRows。
// 这一条是硬约束 —— saveData() 保存的是整个 currentRows，历史实现曾把
// currentRows 换成筛选结果，导致「筛选后点保存」永久删掉被筛掉的行。
// 判定逻辑在 view.js（isFilterActive / rowPassesColumnFilter / getFilteredRows），
// 本文件只负责交互与视图状态。
//
// 列筛选支持两种模式（单选切换）：
//   values    值清单：勾选该列的去重值，最贴近 Excel 的筛选体验
//   condition 按条件：包含 / 不包含 / 等于 / 开头是 / 结尾是
// 两种模式共用 filterColumn，同一时刻只有一个列筛选生效。
// filterValues 的三态：null = 不筛选，[] = 一个值都没勾（结果为空集），
// [...] = 只保留这些值。必须区分 null 与 []，否则「一个都不勾」会被
// 当成「不筛选」而显示全部行。
// 依赖：state.js、view.js、render.js（renderTable）、utils.js（showToast / setStatus）
// ================================================================

// ================================================================
// 排序
// ================================================================

function sortBy(field) {
    if (!field) return;
    if (sortField === field) {
        sortOrder = -sortOrder;
    } else {
        sortField = field;
        sortOrder = 1;
    }
    renderTable();
}

// ================================================================
// 视图状态的统一入口
// ================================================================

/** 清空全部列筛选状态（不触发重绘，由调用方决定何时重绘） */
function resetFilter() {
    filterColumn = null;
    filterMode = 'values';
    filterValues = null;
    filterCondition = 'contains';
    filterKeyword = '';
    const dateInput = document.getElementById('filterDate');
    if (dateInput) dateInput.value = '';
}

/** 提示条上显示的筛选说明 */
function filterSummaryText() {
    if (!isFilterActive()) return '';
    const col = filterColumn;
    if (filterMode === 'values') {
        const n = filterValues.length;
        if (n === 0) return `${col}：未勾选任何值`;
        if (n <= 2) return `${col} = ${filterValues.join(' / ')}`;
        return `${col} ∈ ${n} 个值`;
    }
    const op = {
        contains: '包含', notContains: '不包含', equals: '等于',
        startsWith: '开头是', endsWith: '结尾是'
    }[filterCondition] || filterCondition;
    return `${col} ${op} ${filterKeyword}`;
}

// ================================================================
// 按日期筛选（视图层）
// ----------------------------------------------------------------
// 以前这里会调后端 queryTableData(id, date) 再把返回结果塞进 currentRows，
// 和列筛选一样存在「筛选后保存丢数据」的问题；改成在已加载的全量数据上做
// 视图筛选后，既没有丢数据的风险，也省掉一次网络往返。
// ================================================================

/** 猜一个可用于日期筛选的列：先看列名，再按取值形态判断 */
function guessDateColumn() {
    const byName = currentHeaders.find(h => /日期|时间|date|time/i.test(h));
    if (byName) return byName;

    for (const h of currentHeaders) {
        let total = 0;
        let dateLike = 0;
        for (const row of currentRows) {
            const v = row[h];
            if (v === undefined || v === null || String(v).trim() === '') continue;
            total++;
            if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(String(v).trim())) dateLike++;
        }
        if (total > 0 && dateLike / total >= 0.8) return h;
    }
    return null;
}

function applyDateFilter() {
    const dateInput = document.getElementById('filterDate');
    const date = dateInput ? dateInput.value : '';
    if (!date) {
        showToast('请选择日期', 'info');
        return;
    }
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }

    const col = guessDateColumn();
    if (!col) {
        showToast('没有找到可用于日期筛选的列', 'error');
        return;
    }

    filterColumn = col;
    filterMode = 'condition';
    filterCondition = 'startsWith';
    filterKeyword = date;
    filterValues = null;
    currentPage = 1;
    renderTable();

    const shown = buildDisplayRows().length;
    showToast(`✅ 已按「${col}」筛选 ${date}：${shown} 行（共 ${currentRows.length} 行）`,
        shown > 0 ? 'success' : 'info');
    setStatus(`已筛选 ${date}（${shown} 行）`);
}

function clearDateFilter() {
    resetFilter();
    currentPage = 1;
    renderTable();
    showToast('✅ 已清除筛选', 'success');
}

// ================================================================
// 列筛选：打开 / 关闭
// ================================================================

function openFilter(columnName) {
    filterColumn = columnName;
    const nameEl = document.getElementById('filterColumnName');
    if (nameEl) nameEl.textContent = columnName;

    // 该列已有生效的筛选就回填，否则恢复默认（全部勾选）
    const sameColumn = isFilterActive() && filterColumn === columnName;
    const mode = sameColumn ? filterMode : 'values';
    setFilterMode(mode, true);

    const kwInput = document.getElementById('filterKeyword');
    if (kwInput) kwInput.value = sameColumn && filterMode === 'condition' ? filterKeyword : '';
    const condSelect = document.getElementById('filterCondition');
    if (condSelect) condSelect.value = sameColumn && filterMode === 'condition' ? filterCondition : 'contains';

    renderFilterValueList();
    const search = document.getElementById('filterValueSearch');
    if (search) search.value = '';

    const modal = document.getElementById('filterModal');
    if (modal) modal.style.display = 'flex';
}

/** 只关弹窗，不改变已生效的筛选（「取消」语义） */
function closeFilter() {
    const modal = document.getElementById('filterModal');
    if (modal) modal.style.display = 'none';
}

// ================================================================
// 列筛选：值清单
// ================================================================

/** 取当前筛选列的去重值 + 出现次数（基于全量 currentRows，不受搜索影响） */
function filterDistinctValues() {
    const counts = new Map();
    for (const row of currentRows) {
        const raw = row[filterColumn];
        const val = raw === undefined || raw === null ? '' : String(raw);
        counts.set(val, (counts.get(val) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([value, count]) => ({ value: value, count: count }))
        .sort((a, b) => a.value.localeCompare(b.value, 'zh-CN'));
}

/** 渲染值清单（一次渲染，搜索时只切换 display，避免勾选状态被重绘冲掉） */
function renderFilterValueList() {
    const host = document.getElementById('filterValueList');
    if (!host) return;

    const all = filterDistinctValues();
    const limit = 500;
    const shown = all.slice(0, limit);
    const preselected = new Set(Array.isArray(filterValues) ? filterValues : []);
    // 没有已生效的值筛选时默认全选 —— 与 Excel 打开筛选面板的状态一致
    const usePreselect = preselected.size > 0;

    let html = '';
    for (const item of shown) {
        const checked = usePreselect ? (preselected.has(item.value) ? ' checked' : '') : ' checked';
        const label = item.value === '' ? '（空白）' : item.value;
        html += '<label class="filter-value-item" data-value="' + escapeHtml(item.value) + '">';
        html += `<input type="checkbox"${checked} onchange="updateFilterValueCount()">`;
        html += `<span class="filter-value-text">${escapeHtml(label)}</span>`;
        html += `<span class="filter-value-n">${item.count}</span>`;
        html += '</label>';
    }
    if (all.length > limit) {
        html += `<p class="filter-value-more">值过多，仅列出前 ${limit} 个（共 ${all.length} 个），请用上方搜索框缩小范围</p>`;
    }
    if (all.length === 0) {
        html += '<p class="filter-value-more">该列没有可筛选的值</p>';
    }
    host.innerHTML = html;
    updateFilterValueCount();
}

/** 值清单搜索：只隐藏不匹配项，不动勾选状态 */
function onFilterValueSearch(keyword) {
    const kw = (keyword || '').trim().toLowerCase();
    const items = document.querySelectorAll('#filterValueList .filter-value-item');
    items.forEach(item => {
        const v = item.getAttribute('data-value') || '';
        item.style.display = (!kw || v.toLowerCase().indexOf(kw) !== -1) ? '' : 'none';
    });
    updateFilterValueCount();
}

/** 全选 / 全不选（只作用于当前可见项，方便「搜索后一键只选这些」） */
function filterSelectAll(checked) {
    document.querySelectorAll('#filterValueList .filter-value-item').forEach(item => {
        if (item.style.display === 'none') return;
        const cb = item.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = !!checked;
    });
    updateFilterValueCount();
}

/** 已选计数（同时反映搜索范围） */
function updateFilterValueCount() {
    const el = document.getElementById('filterValueCount');
    if (!el) return;
    let total = 0;
    let checked = 0;
    document.querySelectorAll('#filterValueList .filter-value-item').forEach(item => {
        if (item.style.display === 'none') return;
        total++;
        const cb = item.querySelector('input[type="checkbox"]');
        if (cb && cb.checked) checked++;
    });
    el.textContent = `已选 ${checked} / ${total}`;
}

/** 切换「按值 / 按条件」两个面板 */
function setFilterMode(mode, silent) {
    filterMode = mode === 'condition' ? 'condition' : 'values';

    document.querySelectorAll('input[name="filterMode"]').forEach(r => {
        r.checked = (r.value === filterMode);
    });

    const valuesPane = document.getElementById('filterValuesPane');
    const condPane = document.getElementById('filterConditionPane');
    if (valuesPane) valuesPane.style.display = filterMode === 'values' ? '' : 'none';
    if (condPane) condPane.style.display = filterMode === 'condition' ? '' : 'none';

    if (!silent) setStatus(filterMode === 'values' ? '按值筛选' : '按条件筛选');
}

// ================================================================
// 列筛选：应用 / 清除
// ================================================================

function applyFilter() {
    if (!filterColumn) {
        showToast('请先选择要筛选的列', 'info');
        return;
    }

    if (filterMode === 'values') {
        const checked = [];
        document.querySelectorAll('#filterValueList .filter-value-item').forEach(item => {
            const cb = item.querySelector('input[type="checkbox"]');
            if (cb && cb.checked) checked.push(item.getAttribute('data-value') || '');
        });
        // 全选等于不筛选（null），避免出现「勾了全部却显示为已筛选」的困惑状态；
        // 一个都没勾则是「空集」而不是「不筛选」—— 用 [] 表达，结果为 0 行。
        const all = filterDistinctValues().length;
        filterValues = checked.length === all ? null : checked;
        if (checked.length === 0) {
            showToast('没有勾选任何值，筛选结果将为空', 'info');
        }
    } else {
        const kwInput = document.getElementById('filterKeyword');
        filterKeyword = kwInput ? kwInput.value.trim() : '';
        const condSelect = document.getElementById('filterCondition');
        if (condSelect) filterCondition = condSelect.value;
        if (!filterKeyword) {
            showToast('请输入筛选关键词', 'info');
            return;
        }
    }

    currentPage = 1;
    closeFilter();
    renderTable();

    const shown = buildDisplayRows().length;
    showToast(`✅ 筛选完成：显示 ${shown} 行（共 ${currentRows.length} 行）`,
        shown > 0 ? 'success' : 'info');
    setStatus(`已筛选（${shown} 行）`);
}

function clearFilter() {
    resetFilter();
    currentPage = 1;
    closeFilter();
    renderTable();
    showToast('✅ 已清除筛选', 'success');
    setStatus('已清除筛选');
}
