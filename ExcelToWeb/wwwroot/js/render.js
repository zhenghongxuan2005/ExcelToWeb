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

/* 短状态值 → 标签色。只用于视觉呈现，不改变取值、不改变可编辑性。
   命中率应当极低：只有值恰好等于这些词的单元格才会变成胶囊。 */
const STATUS_TAGS = {
    '已完成': 'success', '已通过': 'success', '正常': 'success', '有效': 'success',
    '启用': 'success', '已启用': 'success', '在售': 'success',
    '进行中': 'warning', '处理中': 'warning', '待审核': 'warning',
    '未完成': 'muted', '未开始': 'muted', '待处理': 'muted', '未启用': 'muted',
    '停用': 'muted', '已停用': 'muted', '无效': 'muted', '已关闭': 'muted'
};

/** 返回值对应的标签类名片段（无命中时返回空串，不影响原有单元格样式） */
function statusTagClass(value) {
    const key = String(value === null || value === undefined ? '' : value).trim();
    const tone = STATUS_TAGS[key];
    return tone ? ' cell-tag cell-tag-' + tone : '';
}

/**
 * 刷新页头的「数据来源 + 行/列统计」。
 * 表格加载、切换、增删行都会经过 renderTable，因此在这里统一同步，
 * 用户不用回头去看下拉框也能知道当前看的是哪张表。
 */
function updatePageMeta() {
    const sub = document.getElementById('pageSub');
    const meta = document.getElementById('tableMeta');
    const table = (typeof allTables !== 'undefined' && allTables)
        ? allTables.find(t => t.id === currentTableId)
        : null;

    if (sub) {
        sub.textContent = table
            ? `${table.tableName} · 最后保存 ${formatTime(table.updatedAt || table.createdAt)}`
            : '尚未选择表格 · 上传 Excel 或从上方下拉框选择';
    }
    if (meta) {
        meta.textContent = `${currentRows.length} 行 · ${currentHeaders.length} 列`;
    }
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

    updatePageMeta();

    // 空状态
    if (currentHeaders.length === 0 || currentRows.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="icon"><use href="#i-inbox"/></svg></div><p>暂无数据，请上传 Excel 文件</p></div>';
        clearSelectionStats();
        // 表格已被替换成占位内容，旧选区失去意义（range.js 未接线时跳过）
        if (typeof clearRange === 'function') clearRange();
        updateUndoButtons();
        return;
    }

    // 提取每列去重值作为建议列表（基于全量数据，搜索不应改变候选值）；
    // 配置了「跨表引用」的列例外：建议列表直接取自引用表该列的去重值
    const suggestionsMap = {};
    for (const colName of currentHeaders) {
        const refList = refValueMap[colName];
        if (refList && refList.length > 0) {
            suggestionsMap[colName] = refList;
            continue;
        }
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

    // 搜索把数据全部过滤掉了 / 列筛选筛空了：给出与「无数据」不同的提示，避免用户以为文件丢了
    if (displayRows.length === 0) {
        const emptyMsg = searchKeyword
            ? `没有匹配「${escapeHtml(searchKeyword)}」的数据`
            : '当前筛选条件下没有数据';
        const emptySub = searchKeyword
            ? '换个关键词，或点搜索框右侧的 ✕ 清除'
            : '点下方统计栏里的筛选标签 ✕ 可清除筛选';
        container.innerHTML = '<div class="empty-state">'
            + '<div class="empty-icon"><svg class="icon"><use href="#i-search"/></svg></div>'
            + `<p>${emptyMsg}</p>`
            + `<p class="empty-sub">${emptySub}</p>`
            + '</div>';
        clearSelectionStats();
        // 表格已被替换成占位内容，旧选区失去意义（range.js 未接线时跳过）
        if (typeof clearRange === 'function') clearRange();
        updateUndoButtons();
        return;
    }

    // 生成表格 HTML
    // col-pin / col-pin-1 / col-pin-2 用于冻结「勾选列 + 序号列」（样式见 table.css）
    let html = '<table><thead><tr>';
    html += '<th class="cell-center col-pin col-pin-1" style="width:36px; min-width:36px;"><input type="checkbox" id="selectAll" onchange="toggleAllCheckboxes()" /></th>';
    html += '<th class="cell-center col-pin col-pin-2" style="width:44px; min-width:44px;">序号</th>';
    for (const h of visibleHeaders) {
        const order = sortOrderOf(h);
        // 排序指示器平时隐藏（悬停该列才出现），只有真正参与排序的列常显 ——
        // 否则每一列都顶着一个小箭头，表头会显得很吵
        const arrow = order === 1 ? '<span class="th-arrow is-on">▲</span>'
            : (order === -1 ? '<span class="th-arrow is-on">▼</span>'
                : '<span class="th-arrow">⇅</span>');
        // 多列排序时给参与排序的列标出优先级序号（1 = 主排序键）
        const rank = (order !== 0 && sortKeys.length > 1)
            ? `<span class="th-sort-rank">${sortKeys.findIndex(k => k.field === h) + 1}</span>`
            : '';
        // 计算列：表头挂一个 fx 角标并把公式放进 title —— 用户必须能随时看到
        // 「这一列的值是怎么来的」，尤其是它不受手改影响的时候
        const computed = isComputedColumn(h);
        const fxAttr = computed
            ? ` class="th-computed" title="${escapeHtml(computedColumnHint(h))}"`
            : '';
        html += `<th${fxAttr}${columnWidthStyle(h)}>`;
        html += '<div class="th-inner">';
        html += `<span class="th-sort" title="点击排序：升序 → 降序 → 取消；按住 Shift 点击可追加为次级排序键" `
            + `onclick="sortBy('${escapeHtml(h)}', event.shiftKey)">${escapeHtml(h)}${arrow}${rank}</span>`;
        if (computed) html += '<span class="th-fx" title="计算列">fx</span>';
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
        html += `<td class="cell-center row-index">${(currentPage - 1) * (pageSize > 0 ? pageSize : 0) + r + 1}`
            + `<button type="button" class="row-hist-btn" title="本行变更历史" onclick="openRowHistory(${actualIndex}, event)"><svg class="icon icon-sm"><use href="#i-clock"/></svg></button></td>`;
        for (const key of visibleHeaders) {
            const val = row[key] !== undefined && row[key] !== null ? row[key] : '';
            const bgColor = getColorForValue(key, val);
            const highlight = cellMatchesSearch(key, val) ? ' search-hit' : '';
            const style = bgColor ? ` style="background-color:${bgColor};"` : '';
            const computed = isComputedColumn(key);
            // 命中颜色规则时以规则色为准，不再叠加状态标签（两者都是底色，会互相打架）
            const tag = bgColor ? '' : statusTagClass(val);

            html += `<td class="editable-cell${highlight}${computed ? ' cell-computed' : ''}${tag}"${style}>`;

            // 计算列仍然渲染成 .cell-input —— 一批模块（选区 / 填充柄 / 键盘导航 /
            // 粘贴）是按「每列一个 .cell-input」的位置关系定位的，少渲染一个就会整列错位。
            // 用 readonly 表达不可编辑，既不破坏位置关系，也仍然可以选中与复制。
            if (computed) {
                html += `<input class="cell-input cell-input-locked" type="text" value="${escapeHtml(val)}" `
                    + `data-index="${actualIndex}" data-key="${escapeHtml(key)}" title="${escapeHtml(computedColumnHint(key))}" readonly />`;
                html += '</td>';
                continue;
            }

            html += `<input class="cell-input" type="text" value="${escapeHtml(val)}" data-index="${actualIndex}" data-key="${escapeHtml(key)}" autocomplete="off" />`;
            const suggestions = suggestionsMap[key] || [];
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
    html += '</tbody>';
    // 汇总行（Excel 式总计行）：贴在表底部，只统计当前可见的数据；关闭时返回空串
    html += buildAggregateRowHtml(visibleHeaders);
    html += '</table>';

    // 表格底部的「添加一行」：与 Excel 的「在末尾追加」直觉一致，
    // 比每次回到工具栏点「新增行」更顺手（仍然复用同一个 addRow）
    html += '<div class="ghost-row">'
        + '<button type="button" onclick="addRow()">'
        + '<svg class="icon icon-sm"><use href="#i-plus"/></svg>添加一行</button></div>';

    // 统计栏：区分「全量」与「被视图裁剪后」的行数，避免用户误以为数据变少了；
    // 生效中的筛选必须一直看得见（筛选是隐形状态，看不见就会以为数据丢了）
    const viewFiltered = !!searchKeyword || (typeof isFilterActive === 'function' && isFilterActive());
    html += '<div class="stats-bar">';
    if (viewFiltered) {
        html += `<span>筛选出 <strong>${displayRows.length}</strong> 行</span>`;
        html += `<span class="stats-muted">全量 ${currentRows.length} 行</span>`;
    } else {
        html += `<span>共 <strong>${currentRows.length}</strong> 行 · <strong>${visibleHeaders.length}</strong> 列</span>`;
    }
    if (typeof isFilterActive === 'function' && isFilterActive()) {
        html += '<span class="filter-chip">';
        html += `<span>筛选：${escapeHtml(filterSummaryText())}</span>`;
        html += '<button class="filter-chip-x" title="清除筛选" onclick="clearFilter()"><svg class="icon icon-sm"><use href="#i-x"/></svg></button>';
        html += '</span>';
    }
    // 排序同样是「隐形」的视图状态：有排序时必须看得见，否则用户会以为行序莫名变了
    if (sortKeys.length > 0) {
        html += '<span class="filter-chip sort-chip">';
        html += `<span>排序：${escapeHtml(sortSummaryText())}</span>`;
        html += '<button class="filter-chip-x" title="清除排序" onclick="clearSort()"><svg class="icon icon-sm"><use href="#i-x"/></svg></button>';
        html += '</span>';
    }
    if (viewFiltered) html += `<span><strong>${visibleHeaders.length}</strong> 列</span>`;
    html += '<span class="stat-hint">拖拽 / Shift+方向键选区 · 表头点击排序（Shift+点击多列）· Ctrl+C·V 与 Excel 互通 · 编辑后点击"保存"</span>';
    html += '</div>';

    // 分页条
    html += renderPager(displayRows.length);

    container.innerHTML = html;

    // 选中统计面板挂到表格下方（容器外，避免被 innerHTML 覆盖）
    updateSelectionStats();

    // 表格刚重建，把 range.js 的单元格选区重画到新 DOM 上
    if (typeof paintSelection === 'function') paintSelection();

    // 绑定事件
    const editOldValue = {};

    container.querySelectorAll('.cell-input').forEach(input => {
        // 计算列的格子只读：不挂编辑监听，也不进撤销栈 ——
        // 它的值来自服务端，改完也没地方存，进历史栈只会让撤销按出一堆假动作
        if (isComputedColumn(input.dataset.key)) return;

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
                if (oldVal !== undefined && String(oldVal) !== inp.value) {
                    // pushHistory() 记录的是「修改前」的状态，而 input 事件已经
                    // 把新值写进 currentRows 了，所以这里先把旧值临时放回去再快照。
                    const cur = currentRows[idx][key];
                    currentRows[idx][key] = oldVal;
                    try {
                        pushHistory();
                    } finally {
                        currentRows[idx][key] = cur;
                    }
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
                        // 与手动输入保持一致：数据源同步更新，避免重渲染后回到旧值
                        currentRows[idx][key] = inp.value;
                        inp.dispatchEvent(new Event('blur'));
                    }
                });
            });
        }
    });

    updateUndoButtons();
}
