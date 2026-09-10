// ================================================================
// 视图管线：全局搜索 / 列显示隐藏 / 分页
// ----------------------------------------------------------------
// 职责：根据 currentRows 与用户当前的视图设置，算出「这一屏到底显示哪些行、哪些列、第几页」。
// 说明：currentRows 始终是唯一的数据源（保存/编辑都基于它），
//       本文件只做「显示层」的裁剪，不修改数据。
// 依赖：state.js（currentRows / currentHeaders / sortField / sortOrder）
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

/** 应用全局搜索后的行集合 */
function getSearchedRows() {
    if (!searchKeyword) return currentRows;
    const kw = searchKeyword.toLowerCase();
    return currentRows.filter(row => rowMatchesKeyword(row, kw));
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

/** 排序比较器（数值优先，其次按中文语序） */
function compareRows(a, b, field) {
    const va = a[field] !== undefined ? a[field] : '';
    const vb = b[field] !== undefined ? b[field] : '';
    const na = parseFloat(va);
    const nb = parseFloat(vb);
    if (!isNaN(na) && !isNaN(nb)) return (na - nb) * sortOrder;
    return String(va).localeCompare(String(vb), 'zh-CN') * sortOrder;
}

/** 当前要展示的全部行（搜索 + 排序，尚未分页） */
function buildDisplayRows() {
    const rows = getSearchedRows().slice();
    if (sortField) rows.sort((a, b) => compareRows(a, b, sortField));
    return rows;
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
    const matched = getSearchedRows().length;
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
}

/** 全部列恢复显示 */
function showAllColumns() {
    hiddenColumns = [];
    renderColumnMenu();
    renderTable();
}

/** 设置列宽（80~600 之间，留空表示自动） */
function setColumnWidth(name, px) {
    const n = parseInt(px);
    if (!px || isNaN(n)) {
        delete columnWidths[name];
    } else {
        columnWidths[name] = Math.min(600, Math.max(60, n));
    }
    renderTable();
}

/** 取某列的宽度样式（无设置时返回空串，保持原样） */
function columnWidthStyle(name) {
    const w = columnWidths[name];
    return w ? ` style="width:${w}px; min-width:${w}px;"` : '';
}
