// ================================================================
// 渲染表格（带建议列表 + 颜色规则 + XSS 防护）
// ================================================================

/** HTML 转义，防止 XSS */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderTable() {
    const container = document.getElementById('tableContainer');
    if (!container) return;

    // 空状态
    if (currentHeaders.length === 0 || currentRows.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>暂无数据，请上传 Excel 文件</p></div>';
        updateUndoButtons();
        return;
    }

    // 提取每列去重值作为建议列表
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

    // 排序
    const displayRows = currentRows.slice();
    if (sortField) {
        displayRows.sort((a, b) => {
            const va = a[sortField] !== undefined ? a[sortField] : '';
            const vb = b[sortField] !== undefined ? b[sortField] : '';
            const na = parseFloat(va);
            const nb = parseFloat(vb);
            if (!isNaN(na) && !isNaN(nb)) return (na - nb) * sortOrder;
            return String(va).localeCompare(String(vb), 'zh-CN') * sortOrder;
        });
    }

    // 生成表格 HTML
    let html = '<table><thead><tr>';
    html += '<th style="width:36px; min-width:36px;"><input type="checkbox" id="selectAll" onchange="toggleAllCheckboxes()" /></th>';
    html += '<th style="width:44px; min-width:44px;">#</th>';
    for (const h of currentHeaders) {
        const arrow = sortField === h ? (sortOrder === 1 ? ' ▲' : ' ▼') : ' ⇅';
        html += '<th style="position:relative;">';
        html += '<div style="display:flex; align-items:center; gap:4px;">';
        html += `<span onclick="sortBy('${escapeHtml(h)}')" style="cursor:pointer; user-select:none;">${escapeHtml(h)}${arrow}</span>`;
        html += `<span onclick="openFilter('${escapeHtml(h)}')" style="cursor:pointer; font-size:12px; color:#6b7b93;">🔽</span>`;
        html += '</div></th>';
    }
    html += '</tr></thead><tbody>';

    // 数据行
    for (let r = 0; r < displayRows.length; r++) {
        const row = displayRows[r];
        const actualIndex = currentRows.indexOf(row);
        html += '<tr>';
        html += `<td style="text-align:center;"><input type="checkbox" class="row-checkbox" data-index="${actualIndex}" /></td>`;
        html += `<td style="text-align:center; font-weight:500; color:#6b7b93;">${r + 1}</td>`;
        for (const key of currentHeaders) {
            const val = row[key] !== undefined && row[key] !== null ? row[key] : '';
            const suggestions = suggestionsMap[key] || [];
            const bgColor = getColorForValue(key, val);
            const style = bgColor ? ` style="background-color:${bgColor};"` : '';
            html += `<td class="editable-cell"${style}>`;
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

    // 统计栏
    html += '<div class="stats-bar">';
    html += `<span>📊 共 <strong>${displayRows.length}</strong> 行</span>`;
    html += `<span>📋 <strong>${currentHeaders.length}</strong> 列</span>`;
    html += '<span style="color:#6b7b93;">💡 勾选行→删除，点击表头排序，编辑后点击"保存"</span>';
    html += '</div>';

    container.innerHTML = html;

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
