// ================================================================
// 渲染表格（带建议列表 + 颜色规则 + XSS 防护）
// 说明：escapeHtml 已上移到 utils.js，供各页面共用
// ================================================================

// 骨架屏延迟显示的定时器（避免接口很快返回时闪一下）
let _skeletonTimer = null;

/**
 * 显示表格骨架屏（数据加载中的占位）。
 * 加一小段延迟再出现：接口很快返回时不会「闪一下」，慢请求才看得到加载态。
 * @param {number} colCount 预估列数，让占位宽度更接近真实表格
 */
function showTableSkeleton(colCount) {
    const container = document.getElementById('tableContainer');
    if (!container) return;
    const cols = Math.max(3, Math.min(parseInt(colCount) || 6, 12));

    if (_skeletonTimer) clearTimeout(_skeletonTimer);
    _skeletonTimer = setTimeout(() => {
        _skeletonTimer = null;
        let html = '<div class="skeleton-table" aria-hidden="true">';
        for (let r = 0; r < 8; r++) {
            html += '<div class="skeleton-row">';
            for (let c = 0; c < cols; c++) {
                html += '<div class="skeleton-cell' + (c === 0 ? ' skeleton-narrow' : '') + '"></div>';
            }
            html += '</div>';
        }
        html += '</div>';
        container.innerHTML = html;
        clearSelectionStats();
    }, 120);
}

/**
 * 取消尚未显示的骨架屏。数据就绪（成功或失败）时必须调用，
 * 否则延迟到点的骨架屏会覆盖刚渲染好的真实表格。
 */
function hideTableSkeleton() {
    if (_skeletonTimer) {
        clearTimeout(_skeletonTimer);
        _skeletonTimer = null;
    }
}

function renderTable() {
    const container = document.getElementById('tableContainer');
    if (!container) return;

    // 空状态
    if (currentHeaders.length === 0 || currentRows.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="icon"><use href="#i-inbox"/></svg></div><p>暂无数据，请上传 Excel 文件</p></div>';
        clearSelectionStats();
        updateUndoButtons();
        return;
    }

    // 提取每列去重值作为建议列表（基于全量数据，搜索不应改变候选值）
    const suggestionsMap = {};
    for (const colName of currentHeaders) {
        const uniqueValues = {};
        for (const row of currentRows) {
            const val = row[colName];
            if (val !== undefined && val !== null && val !== '') {
                uniqueValues[String(val)] = true;
            }
        }
        const keys = Object.keys(uniqueValues);
        if (keys.length > 0 && keys.length <= 100) {
            suggestionsMap[colName] = keys.sort();
        }
    }

    // 搜索 + 排序 -> 分页，得到这一屏真正要渲染的行
    const displayRows = buildDisplayRows();
    const visibleHeaders = getVisibleHeaders();
    const pageRows = getPagedRows(displayRows);

    // 搜索把数据全部过滤掉了：给出与「无数据」不同的提示，避免用户以为文件丢了
    if (displayRows.length === 0) {
        container.innerHTML = '<div class="empty-state">'
            + '<div class="empty-icon"><svg class="icon"><use href="#i-search"/></svg></div>'
            + `<p>没有匹配「${escapeHtml(searchKeyword)}」的数据</p>`
            + '<p class="empty-sub">换个关键词，或点搜索框右侧的 ✕ 清除</p>'
            + '</div>';
        clearSelectionStats();
        updateUndoButtons();
        return;
    }

    // 生成表格 HTML
    let html = '<table><thead><tr>';
    html += '<th class="cell-center" style="width:36px; min-width:36px;"><input type="checkbox" id="selectAll" onchange="toggleAllCheckboxes()" /></th>';
    html += '<th class="cell-center" style="width:44px; min-width:44px;">#</th>';
    for (const h of visibleHeaders) {
        const arrow = sortField === h ? (sortOrder === 1 ? ' ▲' : ' ▼') : ' ⇅';
        html += `<th${columnWidthStyle(h)}>`;
        html += '<div class="th-inner">';
        html += `<span class="th-sort" onclick="sortBy('${escapeHtml(h)}')">${escapeHtml(h)}${arrow}</span>`;
        html += `<button class="th-filter" title="筛选该列" onclick="openFilter('${escapeHtml(h)}')"><svg class="icon icon-sm"><use href="#i-filter"/></svg></button>`;
        html += '</div></th>';
    }
    html += '</tr></thead><tbody>';

    // 数据行
    // 预计算「行对象 → 原始下标」映射，避免逐行 indexOf 造成 O(n²) 卡顿；
    // 下标必须指向 currentRows，这样编辑/删除始终作用在真实数据上（与分页、搜索无关）
    const rowIndexMap = new Map();
    for (let i = 0; i < currentRows.length; i++) rowIndexMap.set(currentRows[i], i);

    for (let r = 0; r < pageRows.length; r++) {
        const row = pageRows[r];
        const actualIndex = rowIndexMap.get(row);
        html += '<tr>';
        html += `<td class="cell-center"><input type="checkbox" class="row-checkbox" data-index="${actualIndex}" onchange="updateSelectionStats()" /></td>`;
        html += `<td class="cell-center row-index">${(currentPage - 1) * (pageSize > 0 ? pageSize : 0) + r + 1}</td>`;
        for (const key of visibleHeaders) {
            const val = row[key] !== undefined && row[key] !== null ? row[key] : '';
            const suggestions = suggestionsMap[key] || [];
            const bgColor = getColorForValue(key, val);
            const highlight = cellMatchesSearch(key, val) ? ' search-hit' : '';
            const style = bgColor ? ` style="background-color:${bgColor};"` : '';
            html += `<td class="editable-cell${highlight}"${style}>`;
            html += `<input class="cell-input" type="text" value="${escapeHtml(val)}" data-index="${actualIndex}" data-key="${escapeHtml(key)}" autocomplete="off" />`;
            if (suggestions.length > 0) {
                html += '<div class="suggest-list" style="display:none;">';
                for (const s of suggestions) {
                    html += `<div class="suggest-item" data-value="${escapeHtml(s)}">${escapeHtml(s)}</div>`;
                }
                html += '</div>';
            }
            html += '</td>';
        }
        html += '</tr>';
    }
    html += '</tbody></table>';

    // 统计栏：区分「全量」与「搜索后」的行数，避免用户误以为数据变少了
    html += '<div class="stats-bar">';
    if (searchKeyword) {
        html += `<span>筛选出 <strong>${displayRows.length}</strong> 行</span>`;
        html += `<span class="stats-muted">全量 ${currentRows.length} 行</span>`;
    } else {
        html += `<span>共 <strong>${currentRows.length}</strong> 行</span>`;
    }
    html += `<span><strong>${visibleHeaders.length}</strong> 列</span>`;
    html += '<span class="stat-hint">勾选行→删除，点击表头排序，编辑后点击"保存"</span>';
    html += '</div>';

    // 分页条
    html += renderPager(displayRows.length);

    container.innerHTML = html;

    // 选中统计面板挂到表格下方（容器外，避免被 innerHTML 覆盖）
    updateSelectionStats();

    // 绑定事件
    const editOldValue = {};

    container.querySelectorAll('.cell-input').forEach(input => {
        const cell = input.parentElement;
        const suggestList = cell.querySelector('.suggest-list');

        // 聚焦：记录旧值 + 显示建议列表
        input.addEventListener('focus', e => {
            const inp = e.target;
            const idx = parseInt(inp.dataset.index);
            const key = inp.dataset.key;
            if (!isNaN(idx) && currentRows[idx]) {
                editOldValue[idx + '_' + key] = currentRows[idx][key];
            }
            // 显示建议列表
            if (suggestList) {
                suggestList.querySelectorAll('.suggest-item').forEach(item => {
                    item.style.display = 'block';
                });
                if (suggestList.querySelectorAll('.suggest-item').length > 0) {
                    suggestList.style.display = 'block';
                }
            }
        });

        // 输入：实时更新数据 + 筛选建议
        input.addEventListener('input', e => {
            const inp = e.target;
            const list = inp.parentElement.querySelector('.suggest-list');

            const idx = parseInt(inp.dataset.index);
            const key = inp.dataset.key;
            if (!isNaN(idx) && currentRows[idx]) {
                currentRows[idx][key] = inp.value;
            }

            if (list) {
                const keyword = inp.value.trim();
                const items = list.querySelectorAll('.suggest-item');
                let hasMatch = false;

                items.forEach(item => {
                    const itemText = item.getAttribute('data-value') || item.textContent;
                    if (keyword && itemText.indexOf(keyword) !== -1) {
                        item.style.display = 'block';
                        hasMatch = true;
                    } else if (keyword) {
                        item.style.display = 'none';
                    } else {
                        item.style.display = 'block';
                        hasMatch = true;
                    }
                });

                list.style.display = keyword ? 'block' : 'none';
            }
        });

        // 失焦：记录历史 + 隐藏建议
        input.addEventListener('blur', e => {
            const inp = e.target;
            const idx = parseInt(inp.dataset.index);
            const key = inp.dataset.key;
            if (!isNaN(idx) && currentRows[idx]) {
                const keyId = idx + '_' + key;
                const oldVal = editOldValue[keyId];
                if (oldVal !== undefined && oldVal !== inp.value) {
                    pushHistory();
                }
                delete editOldValue[keyId];
            }
            setTimeout(() => {
                const list = inp.parentElement.querySelector('.suggest-list');
                if (list) list.style.display = 'none';
            }, 200);
        });

        // 点击建议项
        if (suggestList) {
            suggestList.querySelectorAll('.suggest-item').forEach(item => {
                item.addEventListener('click', e => {
                    const clicked = e.target;
                    const inp = clicked.parentElement.previousElementSibling;
                    const oldVal = inp.value;
                    inp.value = clicked.getAttribute('data-value') || clicked.textContent;
                    clicked.parentElement.style.display = 'none';

                    const idx = parseInt(inp.dataset.index);
                    const key = inp.dataset.key;
                    if (!isNaN(idx) && currentRows[idx] && oldVal !== inp.value) {
                        editOldValue[idx + '_' + key] = oldVal;
                        inp.dispatchEvent(new Event('blur'));
                    }
                });
            });
        }
    });

    updateUndoButtons();
}
