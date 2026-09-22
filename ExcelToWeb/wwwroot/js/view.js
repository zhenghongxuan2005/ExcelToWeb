// ================================================================
// 视图管线：全局搜索 / 列显示隐藏 / 分页
// ----------------------------------------------------------------
// 职责：根据 currentRows 与用户当前的视图设置，算出「这一屏到底显示哪些行、哪些列、第几页」。
// 说明：currentRows 始终是唯一的数据源（保存/编辑都基于它），
//       本文件只做「显示层」的裁剪，不修改数据。
// 依赖：state.js（currentRows / currentHeaders / sortKeys）
// ================================================================

/** 某行是否命中搜索关键词（跨所有列，大小写不敏感） */
function rowMatchesKeyword(row, kwLower) {
    for (const h of currentHeaders) {
        const v = row[h];
        if (v === undefined || v === null) continue;
        if (String(v).toLowerCase().indexOf(kwLower) !== -1) return true;
    }
    return false;
}

// ================================================================
// 列筛选
// ----------------------------------------------------------------
// 只裁剪「显示」，绝不改 currentRows —— saveData() 保存的是整个 currentRows，
// 一旦这里把 currentRows 换成筛选结果，「筛选后点保存」就会永久删掉被筛掉的行。
// 视图状态（filterColumn / filterMode / filterValues / filterCondition / filterKeyword）
// 声明在 state.js，交互在 filter.js。
// ================================================================

/** 当前是否有生效的列筛选（值清单模式下 null 表示不筛选、[] 表示结果为空集） */
function isFilterActive() {
    if (!filterColumn) return false;
    if (filterMode === 'values') return Array.isArray(filterValues);
    return !!filterKeyword;
}

/** 某一行的筛选列是否通过筛选 */
function rowPassesColumnFilter(row) {
    if (!isFilterActive()) return true;

    const raw = row[filterColumn];
    const val = raw === undefined || raw === null ? '' : String(raw);

    if (filterMode === 'values') {
        return filterValues.indexOf(val) !== -1;
    }

    const v = val.toLowerCase();
    const k = filterKeyword.toLowerCase();
    switch (filterCondition) {
        case 'contains': return v.indexOf(k) !== -1;
        case 'notContains': return v.indexOf(k) === -1;
        case 'equals': return v === k;
        case 'startsWith': return v.indexOf(k) === 0;
        case 'endsWith': return v.lastIndexOf(k) === v.length - k.length;
        default: return true;
    }
}

/** 全局搜索 + 列筛选之后的行集合（纯视图裁剪，currentRows 原样不动） */
function getFilteredRows() {
    let rows = currentRows;
    if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        rows = rows.filter(row => rowMatchesKeyword(row, kw));
    }
    if (isFilterActive()) {
        rows = rows.filter(rowPassesColumnFilter);
    }
    return rows;
}

/** 单个单元格是否命中搜索——用于高亮 */
function cellMatchesSearch(key, value) {
    if (!searchKeyword || value === undefined || value === null) return false;
    return String(value).toLowerCase().indexOf(searchKeyword.toLowerCase()) !== -1;
}

/** 可见列：剔除被用户隐藏的列；不允许把列全部隐藏，否则表格会没有任何内容 */
function getVisibleHeaders() {
    if (hiddenColumns.length === 0) return currentHeaders;
    const hidden = new Set(hiddenColumns);
    const visible = currentHeaders.filter(h => !hidden.has(h));
    return visible.length > 0 ? visible : currentHeaders;
}

/** 单列比较：数值优先，其次按中文语序。只返回方向，升降由排序键决定 */
function compareValues(va, vb) {
    const a = va === undefined || va === null ? '' : va;
    const b = vb === undefined || vb === null ? '' : vb;
    // 与导出口径一致：parseFloat("1,000") 得到 1，会把 1,000 排到 999 前面
    const na = parseSafeNumber(a);
    const nb = parseSafeNumber(b);
    if (na !== null && nb !== null) return na === nb ? 0 : (na < nb ? -1 : 1);
    return String(a).localeCompare(String(b), 'zh-CN');
}

/**
 * 按排序键数组依次比较：前一个键分出胜负就结束，全相等再比下一个 ——
 * 这就是「多列排序」的全部实现，数组顺序即优先级。
 */
function compareByKeys(a, b, keys) {
    for (const k of keys) {
        const r = compareValues(a[k.field], b[k.field]);
        if (r !== 0) return r * k.order;
    }
    return 0;
}

/** 当前要展示的全部行（搜索 + 列筛选 + 多列排序，尚未分页） */
function buildDisplayRows() {
    const rows = getFilteredRows().slice();
    if (sortKeys.length > 0) rows.sort((a, b) => compareByKeys(a, b, sortKeys));
    return rows;
}

/** 清空排序。纯视图状态，不碰 currentRows（换了数据源 / 增删行时调用） */
function resetSort() {
    sortKeys = [];
}

/** 某列的排序方向：1 升序 / -1 降序 / 0 表示该列未参与排序 */
function sortOrderOf(field) {
    const k = sortKeys.find(x => x.field === field);
    return k ? k.order : 0;
}

/** 排序状态的可读摘要：数量 ↓ → 销售员 ↑ */
function sortSummaryText() {
    return sortKeys.map(k => `${k.field} ${k.order === 1 ? '↑' : '↓'}`).join(' → ');
}

/** 总页数（pageSize <= 0 表示不分页） */
function getTotalPages(rowCount) {
    if (pageSize <= 0) return 1;
    return Math.max(1, Math.ceil(rowCount / pageSize));
}

/** 当前页的行切片，同时把 currentPage 夹在合法范围内 */
function getPagedRows(rows) {
    if (pageSize <= 0) return rows;
    const totalPages = getTotalPages(rows.length);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
}

// ================================================================
// 交互动作（供 HTML onclick 调用）
// ================================================================

/** 搜索框输入：更新关键词并回到第 1 页 */
function onSearchInput(value) {
    searchKeyword = (value || '').trim();
    currentPage = 1;

    const clearBtn = document.getElementById('searchClear');
    if (clearBtn) clearBtn.style.display = searchKeyword ? 'flex' : 'none';

    renderTable();
    updateSearchCount();
}

/** 清空搜索 */
function clearSearch() {
    const input = document.getElementById('globalSearch');
    if (input) input.value = '';
    onSearchInput('');
}

/** 搜索命中提示：告知命中了多少行 */
function updateSearchCount() {
    const el = document.getElementById('searchCount');
    if (!el) return;
    if (!searchKeyword) {
        el.textContent = '';
        return;
    }
    const matched = getFilteredRows().length;
    el.textContent = matched > 0
        ? `命中 ${matched} 行`
        : '无匹配';
    el.classList.toggle('is-empty', matched === 0);
}

/** 切换页码 */
function gotoPage(page) {
    const total = getTotalPages(buildDisplayRows().length);
    const target = Math.min(Math.max(1, parseInt(page) || 1), total);
    if (target === currentPage) return;
    currentPage = target;
    renderTable();
}

/** 切换每页行数（0 = 全部） */
function setPageSize(size) {
    pageSize = parseInt(size) || 0;
    currentPage = 1;
    renderTable();
}

/** 生成分页条 HTML */
function renderPager(rowCount) {
    if (pageSize <= 0 || rowCount === 0) return '';

    const totalPages = getTotalPages(rowCount);
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, rowCount);

    let html = '<div class="pager">';
    html += `<span class="pager-info">第 ${start}-${end} 行 / 共 ${rowCount} 行</span>`;
    html += `<button class="pager-btn" onclick="gotoPage(1)" ${currentPage === 1 ? 'disabled' : ''}>首页</button>`;
    html += `<button class="pager-btn" onclick="gotoPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
    html += `<span class="pager-current">${currentPage} / ${totalPages}</span>`;
    html += `<button class="pager-btn" onclick="gotoPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`;
    html += `<button class="pager-btn" onclick="gotoPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''}>末页</button>`;
    html += '</div>';
    return html;
}

// ================================================================
// 列显示 / 隐藏
// ================================================================

/** 构建「列」下拉菜单内容：勾选框 + 列宽输入 */
function renderColumnMenu() {
    const menu = document.getElementById('columnMenu');
    if (!menu) return;

    if (currentHeaders.length === 0) {
        menu.innerHTML = '<div class="dropdown-empty">请先加载数据</div>';
        return;
    }

    const hidden = new Set(hiddenColumns);
    let html = '<div class="dropdown-title">显示列</div>';
    for (const h of currentHeaders) {
        const checked = hidden.has(h) ? '' : ' checked';
        const width = columnWidths[h] || '';
        html += '<div class="column-row">';
        html += `<label class="column-check"><input type="checkbox"${checked} onchange="toggleColumn('${escapeHtml(h)}')"> ${escapeHtml(h)}</label>`;
        html += `<input type="number" class="column-width" min="60" max="600" step="10" placeholder="宽" value="${width}" `
            + `title="列宽（px，留空为自动）" onchange="setColumnWidth('${escapeHtml(h)}', this.value)">`;
        html += '</div>';
    }
    html += '<div class="dropdown-footer"><button class="dropdown-item" onclick="showAllColumns()">全部显示</button></div>';
    menu.innerHTML = html;
}

/** 显示 / 隐藏某一列 */
function toggleColumn(name) {
    const i = hiddenColumns.indexOf(name);
    if (i === -1) hiddenColumns.push(name);
    else hiddenColumns.splice(i, 1);
    renderColumnMenu();
    renderTable();
    scheduleMetaSave();
}

/** 全部列恢复显示 */
function showAllColumns() {
    hiddenColumns = [];
    renderColumnMenu();
    renderTable();
    scheduleMetaSave();
}

/** 设置列宽（60~600 之间，留空表示自动） */
function setColumnWidth(name, px) {
    const n = parseInt(px);
    if (!px || isNaN(n)) {
        delete columnWidths[name];
    } else {
        columnWidths[name] = Math.min(600, Math.max(60, n));
    }
    renderTable();
    scheduleMetaSave();
}

/** 取某列的宽度样式（无设置时返回空串，保持原样） */
function columnWidthStyle(name) {
    const w = columnWidths[name];
    return w ? ` style="width:${w}px; min-width:${w}px;"` : '';
}
