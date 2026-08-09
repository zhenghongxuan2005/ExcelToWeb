// ================================================================
// 全局状态
// ================================================================
var allTables = [];           // 所有表格列表
var currentTableId = null;
var currentHeaders = [];
var currentRows = [];
var sortField = null;
var sortOrder = 1;

// 颜色规则缓存（按用户设定的顺序存储，优先级从高到低）
var colorRulesCache = [];
var ruleColumnName = '数量';

// ================================================================
// 撤销/重做
// ================================================================
var undoHistory = [];
var historyIndex = -1;
var MAX_HISTORY = 50;

function pushHistory() {
    if (historyIndex < undoHistory.length - 1) {
        undoHistory = undoHistory.slice(0, historyIndex + 1);
    }

    var snapshot = {
        rows: JSON.parse(JSON.stringify(currentRows)),
        headers: JSON.parse(JSON.stringify(currentHeaders))
    };
    undoHistory.push(snapshot);

    if (undoHistory.length > MAX_HISTORY) {
        undoHistory.shift();
    }

    historyIndex = undoHistory.length - 1;
    updateUndoButtons();
}

function undo() {
    if (historyIndex <= 0) {
        showToast('没有可撤销的操作', 'info');
        return;
    }

    historyIndex--;
    restoreState(undoHistory[historyIndex]);
    showToast('↩️ 已撤销', 'success');
    updateUndoButtons();
}

function redo() {
    if (historyIndex >= undoHistory.length - 1) {
        showToast('没有可重做的操作', 'info');
        return;
    }

    historyIndex++;
    restoreState(undoHistory[historyIndex]);
    showToast('↪️ 已重做', 'success');
    updateUndoButtons();
}

function restoreState(state) {
    currentRows = JSON.parse(JSON.stringify(state.rows));
    currentHeaders = JSON.parse(JSON.stringify(state.headers));
    renderTable();
}

function updateUndoButtons() {
    var statusText = document.getElementById('statusText');
    if (statusText) {
        var undoCount = historyIndex;
        var redoCount = undoHistory.length - historyIndex - 1;
        var text = '撤销: ' + undoCount + ' | 重做: ' + redoCount;
        var currentStatus = statusText.textContent.split(' | ')[0] || '就绪';
        statusText.textContent = currentStatus + ' | ' + text;
    }
}

// ================================================================
// Toast 提示
// ================================================================
function showToast(message, type) {
    type = type || 'info';
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3000);
}

function setStatus(text) {
    var el = document.getElementById('statusText');
    if (el) el.textContent = text;
}

// ================================================================
// 辅助函数
// ================================================================
function isDateColumnName(name) {
    if (!name) return false;
    var keywords = ['日期', '时间', '日', 'date', 'time', '创建', '更新', '成交', '出生', '入职'];
    for (var i = 0; i < keywords.length; i++) {
        if (name.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
}

function isNumericColumn(name) {
    if (!name || currentRows.length === 0) return false;
    var numericCount = 0;
    for (var i = 0; i < Math.min(currentRows.length, 10); i++) {
        var val = currentRows[i][name];
        if (val !== undefined && val !== null && val !== '') {
            var num = parseFloat(val);
            if (!isNaN(num)) numericCount++;
        }
    }
    return numericCount > 0;
}

// ================================================================
// 加载颜色规则（保持用户设定的顺序，不自动排序）
// ================================================================
function loadColorRules(columnName) {
    return fetch('/api/excel/rules?columnName=' + encodeURIComponent(columnName))
        .then(function (res) { return res.json(); })
        .then(function (rules) {
            // 保持数据库返回的顺序（按 Priority 排序，或按添加顺序）
            colorRulesCache = rules || [];
            return colorRulesCache;
        })
        .catch(function () {
            colorRulesCache = [];
            return [];
        });
}

// ================================================================
// 获取颜色：按列表顺序匹配，匹配即停止（Stop If True）
// ================================================================
function getColorForValue(columnName, value) {
    if (!value || colorRulesCache.length === 0) return null;
    var numValue = parseFloat(value);
    if (isNaN(numValue)) return null;

    // 直接按顺序匹配（用户设定的优先级顺序）
    for (var i = 0; i < colorRulesCache.length; i++) {
        var rule = colorRulesCache[i];
        if (rule.columnName !== columnName) continue;
        var min = rule.minValue;
        var max = rule.maxValue;

        var isMatch = false;
        if (max === null || max === undefined) {
            isMatch = (numValue >= min);
        } else {
            isMatch = (numValue >= min && numValue <= max);
        }

        if (isMatch) {
            return rule.colorCode;
        }
    }
    return null;
}

// ================================================================
// 上传 Excel
// ================================================================
var fileInput = document.getElementById('fileInput');
if (fileInput) {
    fileInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;

        var ext = file.name.split('.').pop().toLowerCase();
        if (ext !== 'xlsx' && ext !== 'xls') {
            showToast('请上传 .xlsx 或 .xls 格式的文件', 'error');
            this.value = '';
            return;
        }

        setStatus('上传中...');
        var formData = new FormData();
        formData.append('file', file);

        fetch('/api/excel/upload', {
            method: 'POST',
            body: formData
        })
            .then(function (res) { return res.json(); })
            .then(function (result) {
                if (result.success) {
                    currentTableId = result.tableId;
                    currentHeaders = result.headers;
                    currentRows = result.rows;
                    sortField = null;
                    sortOrder = 1;
                    loadColorRules(ruleColumnName).then(function () {
                        renderTable();
                    });
                    showToast('✅ ' + result.message, 'success');
                    setStatus('已加载: ' + result.tableName + ' (' + result.rows.length + '行)');
                    loadTableList();  // 刷新表格列表
                } else {
                    showToast('❌ ' + result.message, 'error');
                    setStatus('上传失败');
                }
            })
            .catch(function (err) {
                showToast('❌ 上传失败：' + err.message, 'error');
                setStatus('上传失败');
                console.error(err);
            });

        this.value = '';
    });
}

// ================================================================
// 渲染表格（带建议列表 + 颜色规则）
// ================================================================
function renderTable() {
    var container = document.getElementById('tableContainer');
    if (!container) return;

    // ===== 空状态 =====
    if (currentHeaders.length === 0 || currentRows.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>暂无数据，请上传 Excel 文件</p></div>';
        return;
    }

    // ===== 提取每一列的去重值作为建议列表 =====
    var suggestionsMap = {};
    for (var h = 0; h < currentHeaders.length; h++) {
        var colName = currentHeaders[h];
        var uniqueValues = {};
        for (var r = 0; r < currentRows.length; r++) {
            var val = currentRows[r][colName];
            if (val !== undefined && val !== null && val !== '') {
                uniqueValues[String(val)] = true;
            }
        }
        var keys = Object.keys(uniqueValues);
        if (keys.length > 0 && keys.length <= 100) {
            suggestionsMap[colName] = keys.sort();
        }
    }

    // ===== 排序 =====
    var displayRows = currentRows.slice();
    if (sortField) {
        displayRows.sort(function (a, b) {
            var va = a[sortField] !== undefined ? a[sortField] : '';
            var vb = b[sortField] !== undefined ? b[sortField] : '';
            var na = parseFloat(va);
            var nb = parseFloat(vb);
            if (!isNaN(na) && !isNaN(nb)) return (na - nb) * sortOrder;
            return String(va).localeCompare(String(vb), 'zh-CN') * sortOrder;
        });
    }

    // ===== 生成表格 =====
    var html = '<table><thead><tr>';
    html += '<th style="width:36px; min-width:36px;"><input type="checkbox" id="selectAll" onchange="toggleAllCheckboxes()" /></th>';
    html += '<th style="width:44px; min-width:44px;">#</th>';
    for (var i = 0; i < currentHeaders.length; i++) {
        var h = currentHeaders[i];
        var arrow = (sortField === h) ? (sortOrder === 1 ? ' ▲' : ' ▼') : ' ⇅';
        html += '<th style="position:relative;">';
        html += '<div style="display:flex; align-items:center; gap:4px;">';
        html += '<span onclick="sortBy(\'' + h + '\')" style="cursor:pointer; user-select:none;">' + h + arrow + '</span>';
        html += '<span onclick="openFilter(\'' + h + '\')" style="cursor:pointer; font-size:12px; color:#6b7b93;">🔽</span>';
        html += '</div>';
        html += '</th>';
    }
    html += '</tr></thead><tbody>';

    for (var r = 0; r < displayRows.length; r++) {
        var row = displayRows[r];
        var actualIndex = currentRows.indexOf(row);
        html += '<tr>';
        html += '<td style="text-align:center;"><input type="checkbox" class="row-checkbox" data-index="' + actualIndex + '" /></td>';
        html += '<td style="text-align:center; font-weight:500; color:#6b7b93;">' + (r + 1) + '</td>';
        for (var c = 0; c < currentHeaders.length; c++) {
            var key = currentHeaders[c];
            var val = row[key] !== undefined && row[key] !== null ? row[key] : '';
            var suggestions = suggestionsMap[key] || [];

            var bgColor = getColorForValue(key, val);
            var style = bgColor ? ' style="background-color:' + bgColor + ';"' : '';

            html += '<td class="editable-cell"' + style + '>';
            html += '<input class="cell-input" type="text" value="' + val + '" data-index="' + actualIndex + '" data-key="' + key + '" autocomplete="off" />';
            if (suggestions.length > 0) {
                html += '<div class="suggest-list" style="display:none;">';
                for (var s = 0; s < suggestions.length; s++) {
                    html += '<div class="suggest-item" data-value="' + suggestions[s] + '">' + suggestions[s] + '</div>';
                }
                html += '</div>';
            }
            html += '</td>';
        }
        html += '</tr>';
    }

    html += '</tbody></table>';
    html += '<div class="stats-bar">';
    html += '<span>📊 共 <strong>' + displayRows.length + '</strong> 行</span>';
    html += '<span>📋 <strong>' + currentHeaders.length + '</strong> 列</span>';
    html += '<span style="color:#6b7b93;">💡 勾选行→删除，点击表头排序，编辑后点击"保存"</span>';
    html += '</div>';

    container.innerHTML = html;

    // ===== 绑定事件 =====
    // 用于记录编辑前的旧值
    var editOldValue = {};

    var inputs = container.querySelectorAll('.cell-input');
    for (var j = 0; j < inputs.length; j++) {
        var input = inputs[j];
        var cell = input.parentElement;
        var suggestList = cell.querySelector('.suggest-list');

        // ----- 聚焦：记录旧值 -----
        input.addEventListener('focus', function (e) {
            var inp = e.target;
            var idx = parseInt(inp.dataset.index);
            var key = inp.dataset.key;
            if (!isNaN(idx) && currentRows[idx]) {
                var keyId = idx + '_' + key;
                editOldValue[keyId] = currentRows[idx][key];
            }
        });

        // ----- 输入：实时更新数据 + 筛选建议列表 -----
        input.addEventListener('input', function (e) {
            var inp = e.target;
            var list = inp.parentElement.querySelector('.suggest-list');

            // 更新数据
            var idx = parseInt(inp.dataset.index);
            var key = inp.dataset.key;
            if (!isNaN(idx) && currentRows[idx]) {
                currentRows[idx][key] = inp.value;
            }

            // 更新建议列表
            if (list) {
                var keyword = inp.value.trim();
                var items = list.querySelectorAll('.suggest-item');
                var hasMatch = false;

                if (keyword) {
                    for (var k = 0; k < items.length; k++) {
                        var itemText = items[k].getAttribute('data-value') || items[k].textContent;
                        if (itemText.indexOf(keyword) !== -1) {
                            items[k].style.display = 'block';
                            hasMatch = true;
                        } else {
                            items[k].style.display = 'none';
                        }
                    }
                } else {
                    for (var m = 0; m < items.length; m++) {
                        items[m].style.display = 'block';
                        hasMatch = true;
                    }
                }

                list.style.display = (hasMatch && keyword) ? 'block' : (keyword ? 'block' : 'none');
            }
        });

        // ----- 失去焦点：检查值是否变化，记录历史 -----
        input.addEventListener('blur', function (e) {
            var inp = e.target;
            var idx = parseInt(inp.dataset.index);
            var key = inp.dataset.key;
            if (!isNaN(idx) && currentRows[idx]) {
                var keyId = idx + '_' + key;
                var oldVal = editOldValue[keyId];
                var newVal = inp.value;
                if (oldVal !== undefined && oldVal !== newVal) {
                    // 数据变化了，记录历史
                    pushHistory();
                }
                delete editOldValue[keyId];
            }

            // 隐藏建议列表
            setTimeout(function () {
                var list = inp.parentElement.querySelector('.suggest-list');
                if (list) list.style.display = 'none';
            }, 200);
        });

        // ----- 点击建议项 -----
        if (suggestList) {
            var items = suggestList.querySelectorAll('.suggest-item');
            for (var n = 0; n < items.length; n++) {
                items[n].addEventListener('click', function (e) {
                    var item = e.target;
                    var inp = item.parentElement.previousElementSibling;
                    var oldVal = inp.value;
                    inp.value = item.getAttribute('data-value') || item.textContent;
                    item.parentElement.style.display = 'none';

                    // 触发 blur 逻辑，记录历史
                    var idx = parseInt(inp.dataset.index);
                    var key = inp.dataset.key;
                    if (!isNaN(idx) && currentRows[idx]) {
                        if (oldVal !== inp.value) {
                            var keyId = idx + '_' + key;
                            editOldValue[keyId] = oldVal;
                            // 手动触发 blur 来记录历史
                            inp.dispatchEvent(new Event('blur'));
                        }
                    }
                });
            }
        }

        // ----- 获得焦点：显示建议列表 -----
        input.addEventListener('focus', function (e) {
            var inp = e.target;
            var list = inp.parentElement.querySelector('.suggest-list');
            if (list) {
                var items = list.querySelectorAll('.suggest-item');
                for (var l = 0; l < items.length; l++) {
                    items[l].style.display = 'block';
                }
                if (items.length > 0) {
                    list.style.display = 'block';
                }
            }
        });
    }

// ===== 更新撤销/重做按钮状态 =====
    updateUndoButtons();
}

// ================================================================
// 全选/取消全选
// ================================================================
function toggleAllCheckboxes() {
    var selectAll = document.getElementById('selectAll');
    if (!selectAll) return;
    var checkboxes = document.querySelectorAll('.row-checkbox');
    for (var i = 0; i < checkboxes.length; i++) {
        checkboxes[i].checked = selectAll.checked;
    }
}

// ================================================================
// 新增行
// ================================================================
function addRow() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    pushHistory(); // 记录操作前状态
    var newRow = {};
    for (var i = 0; i < currentHeaders.length; i++) {
        newRow[currentHeaders[i]] = '';
    }
    currentRows.push(newRow);
    sortField = null;
    sortOrder = 1;
    renderTable();
    var container = document.getElementById('tableContainer');
    if (container) container.scrollIntoView({ behavior: 'smooth', block: 'end' });
    showToast('✅ 已新增一行，请填写数据后点击保存', 'success');
    setStatus('已新增一行');
}

// ================================================================
// 删除选中行
// ================================================================
function deleteSelectedRows() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    var checkboxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('请先勾选要删除的行', 'info');
        return;
    }
    if (!confirm('确定要删除选中的 ' + checkboxes.length + ' 行吗？')) return;

    // 🔴 记录操作前状态（新增这一行）
    pushHistory();

    var indices = [];
    for (var i = 0; i < checkboxes.length; i++) {
        indices.push(parseInt(checkboxes[i].dataset.index));
    }
    indices.sort(function (a, b) { return b - a; });

    for (var j = 0; j < indices.length; j++) {
        currentRows.splice(indices[j], 1);
    }
    sortField = null;
    sortOrder = 1;
    renderTable();
    showToast('✅ 已删除 ' + indices.length + ' 行', 'success');
    setStatus('已删除 ' + indices.length + ' 行');
}

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
// 保存数据
// ================================================================
function saveData() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }

    // 1. 同步输入框数据
    var inputs = document.querySelectorAll('.cell-input');
    for (var i = 0; i < inputs.length; i++) {
        var idx = parseInt(inputs[i].dataset.index);
        var key = inputs[i].dataset.key;
        if (!isNaN(idx) && currentRows[idx]) {
            currentRows[idx][key] = inputs[i].value;
        }
    }

    // 2. 获取校验规则
    fetch('/api/excel/validation-rules?tableId=' + currentTableId)
        .then(function (res) { return res.json(); })
        .then(function (rules) {
            // 2.1 执行校验
            var errors = [];
            var validRows = [];

            if (rules && rules.length > 0) {
                for (var r = 0; r < currentRows.length; r++) {
                    var row = currentRows[r];
                    var rowErrors = [];
                    var rowValid = true;

                    for (var i = 0; i < rules.length; i++) {
                        var rule = rules[i];
                        var colName = rule.columnName;
                        var value = row[colName] !== undefined ? String(row[colName]) : '';

                        if (rule.required && !value) {
                            rowErrors.push(colName + ' 不能为空');
                            rowValid = false;
                            continue;
                        }

                        if (!value) continue;

                        if (rule.dataType === 'number') {
                            var num = parseFloat(value);
                            if (isNaN(num)) {
                                rowErrors.push(colName + ' 必须是数字');
                                rowValid = false;
                                continue;
                            }
                            if (rule.minValue !== null && num < rule.minValue) {
                                rowErrors.push(colName + ' 不能小于 ' + rule.minValue);
                                rowValid = false;
                            }
                            if (rule.maxValue !== null && num > rule.maxValue) {
                                rowErrors.push(colName + ' 不能大于 ' + rule.maxValue);
                                rowValid = false;
                            }
                        }
                    }

                    if (rowValid) {
                        validRows.push(row);
                    } else {
                        errors.push('第 ' + (r + 1) + ' 行：' + rowErrors.join('；'));
                    }
                }
            } else {
                validRows = currentRows;
            }

            // 2.2 如果有错误，提示并阻止保存
            if (errors.length > 0) {
                showToast('⚠️ 校验失败：\n' + errors.join('\n'), 'error');
                return;
            }

            // 2.3 保存有效数据
            var payload = { tableId: currentTableId, rows: validRows };
            setStatus('保存中...');
            fetch('/api/excel/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function (res) { return res.json(); })
                .then(function (result) {
                    if (result.success) {
                        showToast('✅ ' + result.message, 'success');
                        setStatus('已保存');
                        refreshData();
                    } else {
                        showToast('❌ ' + result.message, 'error');
                        setStatus('保存失败');
                    }
                })
                .catch(function (err) {
                    showToast('❌ 保存失败：' + err.message, 'error');
                    setStatus('保存失败');
                    console.error(err);
                });
        })
        .catch(function (err) {
            showToast('❌ 加载校验规则失败：' + err.message, 'error');
        });
}

// ================================================================
// 导出 Excel
// ================================================================
function exportExcel() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    window.location.href = '/api/excel/export?tableId=' + currentTableId;
}

// ================================================================
// 导出 CSV（前端手动下载）
// ================================================================
function exportCsv() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }

    setStatus('导出中...');
    fetch('/api/excel/export-csv?tableId=' + currentTableId)
        .then(function (res) {
            if (!res.ok) {
                throw new Error('导出失败：' + res.status);
            }
            return res.blob();
        })
        .then(function (blob) {
            var url = window.URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = '数据_' + new Date().toISOString().slice(0, 10) + '.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            setStatus('已导出');
            showToast('✅ CSV 导出成功', 'success');
        })
        .catch(function (err) {
            showToast('❌ 导出失败：' + err.message, 'error');
            setStatus('导出失败');
            console.error(err);
        });
}

// ================================================================
// 刷新数据
// ================================================================
function refreshData() {
    originalRows = [];
    filterColumn = null;

    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    setStatus('刷新中...');
    fetch('/api/excel/query?tableId=' + currentTableId)
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data && data.headers && data.rows) {
                currentHeaders = data.headers;
                currentRows = data.rows;
                sortField = null;
                sortOrder = 1;
                loadColorRules(ruleColumnName).then(function () {
                    renderTable();
                });
                showToast('✅ 已刷新', 'success');
                setStatus('已刷新 (' + data.rows.length + '行)');
            }
        })
        .catch(function (err) {
            showToast('❌ 刷新失败：' + err.message, 'error');
            setStatus('刷新失败');
            console.error(err);
        });
    // 刷新后重置历史
    undoHistory = [];
    historyIndex = -1;
    updateUndoButtons();
}

// ================================================================
// 清空数据
// ================================================================
function clearAll() {
    if (!currentTableId) {
        showToast('没有数据可清空', 'info');
        return;
    }
    if (!confirm('确定要清空当前表格数据吗？（不会删除数据库中的记录）')) return;
    pushHistory(); // 记录操作前状态
    currentRows = [];
    sortField = null;
    sortOrder = 1;
    renderTable();
    showToast('已清空', 'info');
    setStatus('已清空');
}

// ================================================================
// 按日期筛选
// ================================================================
function applyDateFilter() {
    var dateInput = document.getElementById('filterDate');
    var date = dateInput.value;
    if (!date) {
        showToast('请选择日期', 'info');
        return;
    }
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    setStatus('筛选...');
    fetch('/api/excel/query?tableId=' + currentTableId + '&date=' + date)
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data && data.headers && data.rows) {
                currentHeaders = data.headers;
                currentRows = data.rows;
                sortField = null;
                sortOrder = 1;
                loadColorRules(ruleColumnName).then(function () {
                    renderTable();
                });
                showToast('✅ 已筛选 ' + data.rows.length + ' 条数据', 'success');
                setStatus('已筛选: ' + date + ' (' + data.rows.length + '行)');
            } else {
                currentRows = [];
                renderTable();
                showToast('该日期没有数据', 'info');
                setStatus('无数据');
            }
        })
        .catch(function (err) {
            showToast('❌ 筛选失败：' + err.message, 'error');
            setStatus('筛选失败');
            console.error(err);
        });
}

function clearDateFilter() {
    document.getElementById('filterDate').value = '';
    refreshData();
}

// ================================================================
// ================================================================
// 规则设置弹窗（按顺序匹配 + 上移/下移调整优先级）
// ================================================================
var currentRules = [];

function openRuleModal() {
    var select = document.getElementById('ruleColumnSelect');
    if (select) {
        ruleColumnName = select.value;
    }
    fetch('/api/excel/rules?columnName=' + encodeURIComponent(ruleColumnName))
        .then(function (res) { return res.json(); })
        .then(function (rules) {
            currentRules = rules || [];
            renderRuleList();
            document.getElementById('ruleModal').style.display = 'flex';
        })
        .catch(function (err) {
            showToast('❌ 加载规则失败：' + err.message, 'error');
            currentRules = [];
            renderRuleList();
            document.getElementById('ruleModal').style.display = 'flex';
        });
}

function closeRuleModal() {
    document.getElementById('ruleModal').style.display = 'none';
}

function renderRuleList() {
    var container = document.getElementById('ruleList');
    if (!container) return;

    if (currentRules.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px 0; color:#9aabbf; font-size:14px;">📋 暂无规则，点击下方 "添加规则" 开始设置</div>';
        return;
    }

    var html = '<table style="width:100%; font-size:13px; border-collapse:collapse;">';
    html += '<thead><tr style="background:#f8faff;">';
    html += '<th style="padding:8px 12px; text-align:left;">优先级</th>';
    html += '<th style="padding:8px 12px; text-align:left;">最小值</th>';
    html += '<th style="padding:8px 12px; text-align:left;">最大值</th>';
    html += '<th style="padding:8px 12px; text-align:left;">颜色</th>';
    html += '<th style="padding:8px 12px; text-align:center;">上移/下移</th>';
    html += '<th style="padding:8px 12px; text-align:center; width:40px;"></th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < currentRules.length; i++) {
        var rule = currentRules[i];
        html += '<tr>';
        html += '<td style="padding:6px 8px; text-align:center; color:#6b7b93; font-weight:500;">' + (i + 1) + '</td>';
        html += '<td style="padding:6px 8px;"><input type="number" class="rule-min" value="' + rule.minValue + '" data-index="' + i + '" style="width:80px; padding:4px 8px; border:1px solid #d1d5db; border-radius:4px;" /></td>';
        html += '<td style="padding:6px 8px;"><input type="number" class="rule-max" value="' + (rule.maxValue !== null && rule.maxValue !== undefined ? rule.maxValue : '') + '" data-index="' + i + '" style="width:80px; padding:4px 8px; border:1px solid #d1d5db; border-radius:4px;" /></td>';
        html += '<td style="padding:6px 8px;"><input type="color" class="rule-color" value="' + rule.colorCode + '" data-index="' + i + '" style="width:40px; height:32px; border:none; cursor:pointer;" /></td>';
        html += '<td style="padding:6px 8px; text-align:center;">';
        if (i > 0) {
            html += '<button onclick="moveRuleUp(' + i + ')" style="border:none; background:transparent; cursor:pointer; color:#3b82f6;">↑</button>';
        }
        if (i < currentRules.length - 1) {
            html += '<button onclick="moveRuleDown(' + i + ')" style="border:none; background:transparent; cursor:pointer; color:#3b82f6;">↓</button>';
        }
        html += '</td>';
        html += '<td style="padding:6px 8px; text-align:center;"><button onclick="removeRule(' + i + ')" style="border:none; background:transparent; color:#dc2626; cursor:pointer; font-size:16px;">✕</button></td>';
        html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // 绑定事件
    var minInputs = container.querySelectorAll('.rule-min');
    for (var j = 0; j < minInputs.length; j++) {
        minInputs[j].addEventListener('change', function (e) {
            var idx = parseInt(this.dataset.index);
            currentRules[idx].minValue = parseFloat(this.value) || 0;
        });
    }

    var maxInputs = container.querySelectorAll('.rule-max');
    for (var k = 0; k < maxInputs.length; k++) {
        maxInputs[k].addEventListener('change', function (e) {
            var idx = parseInt(this.dataset.index);
            var val = parseFloat(this.value);
            currentRules[idx].maxValue = isNaN(val) ? null : val;
        });
    }

    var colorInputs = container.querySelectorAll('.rule-color');
    for (var l = 0; l < colorInputs.length; l++) {
        colorInputs[l].addEventListener('change', function (e) {
            var idx = parseInt(this.dataset.index);
            currentRules[idx].colorCode = this.value;
        });
    }
}

function moveRuleUp(index) {
    if (index <= 0) return;
    var temp = currentRules[index];
    currentRules[index] = currentRules[index - 1];
    currentRules[index - 1] = temp;
    renderRuleList();
}

function moveRuleDown(index) {
    if (index >= currentRules.length - 1) return;
    var temp = currentRules[index];
    currentRules[index] = currentRules[index + 1];
    currentRules[index + 1] = temp;
    renderRuleList();
}

function addRuleRow() {
    currentRules.push({ columnName: ruleColumnName, minValue: 0, maxValue: null, colorCode: '#000000' });
    renderRuleList();
}

function removeRule(index) {
    currentRules.splice(index, 1);
    renderRuleList();
}

function saveRules() {
    // 收集当前数据
    var minInputs = document.querySelectorAll('.rule-min');
    var maxInputs = document.querySelectorAll('.rule-max');
    var colorInputs = document.querySelectorAll('.rule-color');

    for (var i = 0; i < minInputs.length; i++) {
        var minVal = parseFloat(minInputs[i].value);
        var maxVal = parseFloat(maxInputs[i].value);
        currentRules[i].minValue = isNaN(minVal) ? 0 : minVal;
        currentRules[i].maxValue = isNaN(maxVal) ? null : maxVal;
        currentRules[i].colorCode = colorInputs[i].value;
        currentRules[i].columnName = ruleColumnName;
    }

    // 保持当前顺序（不排序）
    fetch('/api/excel/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentRules)
    })
        .then(function (res) { return res.json(); })
        .then(function (result) {
            if (result.success) {
                showToast('✅ ' + result.message, 'success');
                closeRuleModal();
                // 更新缓存并重新渲染
                colorRulesCache = currentRules.slice();
                renderTable();
            } else {
                showToast('❌ ' + result.message, 'error');
            }
        })
        .catch(function (err) {
            showToast('❌ 保存失败：' + err.message, 'error');
        });
}

// ================================================================
// 加载表格列表
// ================================================================
function loadTableList() {
    fetch('/api/excel/tables')
        .then(function (res) { return res.json(); })
        .then(function (tables) {
            allTables = tables || [];
            renderTableSelector();
            if (allTables.length > 0 && !currentTableId) {
                // 默认选中第一个
                currentTableId = allTables[0].id;
                document.getElementById('tableSelector').value = currentTableId;
                loadTableData(currentTableId);
            } else if (allTables.length === 0) {
                currentTableId = null;
                currentHeaders = [];
                currentRows = [];
                renderTable();
                setStatus('无表格，请上传 Excel');
            }
        })
        .catch(function (err) {
            console.error('加载表格列表失败:', err);
        });
}

// ================================================================
// 渲染表格下拉框（带时间戳，按时间排序）
// ================================================================
function renderTableSelector() {
    var selector = document.getElementById('tableSelector');
    if (!selector) return;

    var html = '<option value="">-- 请选择表格 --</option>';
    for (var i = 0; i < allTables.length; i++) {
        var t = allTables[i];
        var selected = (t.id === currentTableId) ? ' selected' : '';
        // 格式化时间：显示为 2026-07-31 14:30
        var timeStr = formatTime(t.updatedAt || t.createdAt);
        html += '<option value="' + t.id + '"' + selected + '>' + t.tableName + ' (' + timeStr + ')</option>';
    }
    selector.innerHTML = html;
}

// ================================================================
// 格式化时间
// ================================================================
function formatTime(dateStr) {
    if (!dateStr) return '未知时间';
    try {
        var date = new Date(dateStr);
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        var hours = String(date.getHours()).padStart(2, '0');
        var minutes = String(date.getMinutes()).padStart(2, '0');
        return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes;
    } catch (e) {
        return dateStr;
    }
}

// ================================================================
// 切换表格
// ================================================================
function switchTable() {
    var selector = document.getElementById('tableSelector');
    var tableId = parseInt(selector.value);
    if (!tableId) {
        currentTableId = null;
        currentHeaders = [];
        currentRows = [];
        renderTable();
        setStatus('请选择表格');
        return;
    }
    currentTableId = tableId;
    loadTableData(tableId);
}

// ================================================================
// 加载表格数据
// ================================================================
function loadTableData(tableId) {
    setStatus('加载中...');
    fetch('/api/excel/query?tableId=' + tableId)
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data && data.headers && data.rows) {
                currentHeaders = data.headers;
                currentRows = data.rows;
                sortField = null;
                sortOrder = 1;
                loadColorRules(ruleColumnName).then(function () {
                    renderTable();
                });
                var tableName = getTableName(tableId);
                setStatus('已加载: ' + tableName + ' (' + currentRows.length + '行)');
                showToast('✅ 已切换到: ' + tableName, 'success');
            } else {
                currentHeaders = [];
                currentRows = [];
                renderTable();
                setStatus('该表格没有数据');
            }
        })
        .catch(function (err) {
            showToast('❌ 加载失败：' + err.message, 'error');
            setStatus('加载失败');
            console.error(err);
        });
}

// ================================================================
// 获取表格名称
// ================================================================
function getTableName(tableId) {
    for (var i = 0; i < allTables.length; i++) {
        if (allTables[i].id === tableId) {
            return allTables[i].tableName;
        }
    }
    return '未知表格';
}

// ================================================================
// 删除当前表格（仅前端删除，数据库保留）
// ================================================================
function deleteCurrentTable() {
    if (!currentTableId) {
        showToast('请先选择一个表格', 'info');
        return;
    }
    if (!confirm('确定要删除当前表格吗？（不会删除数据库中的记录）')) return;

    // 从列表中移除
    var newTables = [];
    for (var i = 0; i < allTables.length; i++) {
        if (allTables[i].id !== currentTableId) {
            newTables.push(allTables[i]);
        }
    }
    allTables = newTables;

    // 清空当前数据
    currentTableId = null;
    currentHeaders = [];
    currentRows = [];
    renderTableSelector();
    renderTable();
    setStatus('已删除');
    showToast('✅ 已删除当前表格', 'success');

    // 如果还有表格，自动选中第一个
    if (allTables.length > 0) {
        currentTableId = allTables[0].id;
        document.getElementById('tableSelector').value = currentTableId;
        loadTableData(currentTableId);
    }
}

// ================================================================
// 筛选功能
// ================================================================
var filterColumn = null;
var originalRows = [];

function openFilter(columnName) {
    filterColumn = columnName;
    document.getElementById('filterColumnName').textContent = columnName;
    document.getElementById('filterKeyword').value = '';
    document.getElementById('filterCondition').value = 'contains';
    document.getElementById('filterModal').style.display = 'flex';
}

function closeFilter() {
    document.getElementById('filterModal').style.display = 'none';
    filterColumn = null;
}

function applyFilter() {
    if (!filterColumn) return;

    var keyword = document.getElementById('filterKeyword').value.trim();
    var condition = document.getElementById('filterCondition').value;

    if (!keyword) {
        showToast('请输入筛选关键词', 'info');
        return;
    }

    // 保存原始数据（如果还没保存）
    if (originalRows.length === 0) {
        originalRows = currentRows.slice();
    }

    // 筛选
    var filtered = originalRows.filter(function (row) {
        var val = row[filterColumn] !== undefined ? String(row[filterColumn]) : '';
        var lowerVal = val.toLowerCase();
        var lowerKeyword = keyword.toLowerCase();

        switch (condition) {
            case 'contains':
                return lowerVal.indexOf(lowerKeyword) !== -1;
            case 'notContains':
                return lowerVal.indexOf(lowerKeyword) === -1;
            case 'equals':
                return lowerVal === lowerKeyword;
            case 'startsWith':
                return lowerVal.indexOf(lowerKeyword) === 0;
            case 'endsWith':
                return lowerVal.lastIndexOf(lowerKeyword) === lowerVal.length - lowerKeyword.length;
            default:
                return true;
        }
    });

    currentRows = filtered;
    renderTable();
    closeFilter();
    showToast('✅ 筛选完成，显示 ' + filtered.length + ' 行（共 ' + originalRows.length + ' 行）', 'success');
}

function clearFilter() {
    if (originalRows.length > 0) {
        currentRows = originalRows.slice();
        originalRows = [];
        renderTable();
    }
    closeFilter();
    showToast('✅ 已清除筛选', 'success');
}

// 在刷新数据时重置筛选状态
function refreshData() {
    originalRows = [];
    filterColumn = null;
    // ... 原有 refreshData 逻辑 ...
}

// ================================================================
// 键盘快捷键
// ================================================================
document.addEventListener('keydown', function (e) {
    // Ctrl+Z 撤销
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
    }
    // Ctrl+Y 重做
    if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
    }
});

// ================================================================
// 批量编辑功能
// ================================================================

// 打开批量编辑弹窗
function batchEdit() {
    // 1. 检查是否有选中行
    var checkboxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('请先勾选要修改的行', 'info');
        return;
    }

    // 2. 填充列下拉框
    var select = document.getElementById('batchColumnSelect');
    select.innerHTML = ''; // 清空旧选项
    for (var i = 0; i < currentHeaders.length; i++) {
        var option = document.createElement('option');
        option.value = currentHeaders[i];
        option.textContent = currentHeaders[i];
        select.appendChild(option);
    }

    // 3. 清空输入框
    document.getElementById('batchValueInput').value = '';

    // 4. 显示弹窗
    document.getElementById('batchModal').style.display = 'flex';
}

// 关闭批量编辑弹窗
function closeBatchModal() {
    document.getElementById('batchModal').style.display = 'none';
}

// 确认批量编辑
function confirmBatchEdit() {
    // 1. 获取选中的列和新值
    var column = document.getElementById('batchColumnSelect').value;
    var newValue = document.getElementById('batchValueInput').value.trim();

    // 2. 校验新值是否为空
    if (newValue === '') {
        showToast('请输入新值', 'info');
        return;
    }

    // 3. 获取所有被选中的行
    var checkboxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('没有选中任何行', 'info');
        closeBatchModal();
        return;
    }

    // 4. 记录修改前的状态
    pushHistory();

    // 5. 执行批量修改
    var indices = [];
    for (var i = 0; i < checkboxes.length; i++) {
        var index = parseInt(checkboxes[i].dataset.index);
        indices.push(index);
        // 修改该行指定列的数据
        currentRows[index][column] = newValue;
    }

    // 6. 取消所有选中状态
    var allCheckboxes = document.querySelectorAll('.row-checkbox');
    for (var j = 0; j < allCheckboxes.length; j++) {
        allCheckboxes[j].checked = false;
    }
    var selectAll = document.getElementById('selectAll');
    if (selectAll) selectAll.checked = false;

    // 7. 关闭弹窗
    closeBatchModal();

    // 8. 重新渲染表格，显示更新后的数据
    renderTable();

// 9. 提示操作成功
    showToast('✅ 已成功修改 ' + indices.length + ' 行的 "' + column + '" 列', 'success');
}

// ================================================================
// 下载模板
// ================================================================
function downloadTemplate() {
    console.log('downloadTemplate 被调用了');
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件或选择一个表格', 'error');
        return;
    }

    setStatus('下载模板中...');
    window.location.href = '/api/excel/template?tableId=' + currentTableId;
}

// ================================================================
// 数据校验规则设置
// ================================================================
var currentValidationRules = [];

function openValidationModal() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }

    fetch('/api/excel/validation-rules?tableId=' + currentTableId)
        .then(function (res) { return res.json(); })
        .then(function (rules) {
            currentValidationRules = rules || [];
            // 如果没有规则，为每一列创建默认规则
            if (currentValidationRules.length === 0) {
                for (var i = 0; i < currentHeaders.length; i++) {
                    currentValidationRules.push({
                        tableId: currentTableId,
                        columnName: currentHeaders[i],
                        required: false,
                        dataType: 'text',
                        minValue: null,
                        maxValue: null,
                        maxLength: null,
                        allowedValues: ''
                    });
                }
            }
            renderValidationRuleList();
            document.getElementById('validationModal').style.display = 'flex';
        })
        .catch(function (err) {
            showToast('❌ 加载校验规则失败：' + err.message, 'error');
        });
}

function closeValidationModal() {
    document.getElementById('validationModal').style.display = 'none';
}

function renderValidationRuleList() {
    var container = document.getElementById('validationRuleList');
    if (!container) return;

    var html = '<table style="width:100%; font-size:13px; border-collapse:collapse;">';
    html += '<thead><tr style="background:#f8faff;">';
    html += '<th style="padding:8px 12px; text-align:left;">列名</th>';
    html += '<th style="padding:8px 12px; text-align:center; width:60px;">必填</th>';
    html += '<th style="padding:8px 12px; text-align:left; width:100px;">类型</th>';
    html += '<th style="padding:8px 12px; text-align:left;">限制</th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < currentValidationRules.length; i++) {
        var rule = currentValidationRules[i];
        html += '<tr>';
        html += '<td style="padding:6px 8px;"><strong>' + rule.columnName + '</strong></td>';
        html += '<td style="padding:6px 8px; text-align:center;">';
        html += '<input type="checkbox" class="rule-required" data-index="' + i + '" ' + (rule.required ? 'checked' : '') + ' />';
        html += '</td>';
        html += '<td style="padding:6px 8px;">';
        html += '<select class="rule-datatype" data-index="' + i + '" style="width:100%; padding:4px 6px; border:1px solid #dce3ed; border-radius:4px; font-size:13px;">';
        html += '<option value="text"' + (rule.dataType === 'text' ? ' selected' : '') + '>文本</option>';
        html += '<option value="number"' + (rule.dataType === 'number' ? ' selected' : '') + '>数字</option>';
        html += '<option value="date"' + (rule.dataType === 'date' ? ' selected' : '') + '>日期</option>';
        html += '<option value="email"' + (rule.dataType === 'email' ? ' selected' : '') + '>邮箱</option>';
        html += '</select>';
        html += '</td>';
        html += '<td style="padding:6px 8px;">';
        html += '<div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">';
        html += '<input type="number" class="rule-min" placeholder="最小值" value="' + (rule.minValue || '') + '" data-index="' + i + '" style="width:70px; padding:4px 6px; border:1px solid #dce3ed; border-radius:4px; font-size:12px;" />';
        html += '<span style="color:#6b7b93;">~</span>';
        html += '<input type="number" class="rule-max" placeholder="最大值" value="' + (rule.maxValue || '') + '" data-index="' + i + '" style="width:70px; padding:4px 6px; border:1px solid #dce3ed; border-radius:4px; font-size:12px;" />';
        html += '<input type="text" class="rule-allowed" placeholder="允许值(逗号分隔)" value="' + (rule.allowedValues || '') + '" data-index="' + i + '" style="flex:1; min-width:120px; padding:4px 6px; border:1px solid #dce3ed; border-radius:4px; font-size:12px;" />';
        html += '</div>';
        html += '</td>';
        html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // 绑定事件
    var requiredInputs = container.querySelectorAll('.rule-required');
    for (var j = 0; j < requiredInputs.length; j++) {
        requiredInputs[j].addEventListener('change', function (e) {
            var idx = parseInt(this.dataset.index);
            currentValidationRules[idx].required = this.checked;
        });
    }

    var datatypeSelects = container.querySelectorAll('.rule-datatype');
    for (var k = 0; k < datatypeSelects.length; k++) {
        datatypeSelects[k].addEventListener('change', function (e) {
            var idx = parseInt(this.dataset.index);
            currentValidationRules[idx].dataType = this.value;
        });
    }

    var minInputs = container.querySelectorAll('.rule-min');
    for (var l = 0; l < minInputs.length; l++) {
        minInputs[l].addEventListener('change', function (e) {
            var idx = parseInt(this.dataset.index);
            currentValidationRules[idx].minValue = parseFloat(this.value) || null;
        });
    }

    var maxInputs = container.querySelectorAll('.rule-max');
    for (var m = 0; m < maxInputs.length; m++) {
        maxInputs[m].addEventListener('change', function (e) {
            var idx = parseInt(this.dataset.index);
            currentValidationRules[idx].maxValue = parseFloat(this.value) || null;
        });
    }

    var allowedInputs = container.querySelectorAll('.rule-allowed');
    for (var n = 0; n < allowedInputs.length; n++) {
        allowedInputs[n].addEventListener('change', function (e) {
            var idx = parseInt(this.dataset.index);
            currentValidationRules[idx].allowedValues = this.value;
        });
    }
}

function addValidationRule() {
    currentValidationRules.push({
        tableId: currentTableId,
        columnName: '新列_' + (currentValidationRules.length + 1),
        required: false,
        dataType: 'text',
        minValue: null,
        maxValue: null,
        maxLength: null,
        allowedValues: ''
    });
    renderValidationRuleList();
}

function saveValidationRules() {
    // 收集数据
    var requiredInputs = document.querySelectorAll('.rule-required');
    var datatypeSelects = document.querySelectorAll('.rule-datatype');
    var minInputs = document.querySelectorAll('.rule-min');
    var maxInputs = document.querySelectorAll('.rule-max');
    var allowedInputs = document.querySelectorAll('.rule-allowed');

    for (var i = 0; i < requiredInputs.length; i++) {
        currentValidationRules[i].required = requiredInputs[i].checked;
        currentValidationRules[i].dataType = datatypeSelects[i].value;
        currentValidationRules[i].minValue = parseFloat(minInputs[i].value) || null;
        currentValidationRules[i].maxValue = parseFloat(maxInputs[i].value) || null;
        currentValidationRules[i].allowedValues = allowedInputs[i].value;
        currentValidationRules[i].tableId = currentTableId;
    }

    fetch('/api/excel/validation-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentValidationRules)
    })
        .then(function (res) { return res.json(); })
        .then(function (result) {
            if (result.success) {
                showToast('✅ ' + result.message, 'success');
                closeValidationModal();
            } else {
                showToast('❌ ' + result.message, 'error');
            }
        })
        .catch(function (err) {
            showToast('❌ 保存失败：' + err.message, 'error');
        });
}

// ================================================================
// 带校验的上传
// ================================================================
function uploadWithValidation() {
    var fileInput = document.getElementById('fileInputValidate');
    var file = fileInput.files[0];
    if (!file) {
        showToast('请选择文件', 'info');
        return;
    }

    var ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
        showToast('请上传 .xlsx 或 .xls 格式的文件', 'error');
        fileInput.value = '';
        return;
    }

    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件或选择一个表格', 'error');
        fileInput.value = '';
        return;
    }

    var formData = new FormData();
    formData.append('file', file);
    formData.append('tableId', currentTableId);

    setStatus('校验并上传中...');

    // 关键：必须指定 method: 'POST'
    fetch('/api/excel/upload-with-validation', {
        method: 'POST',
        body: formData
    })
        .then(function (res) {
            return res.json();
        })
        .then(function (result) {
            if (result.success && result.validationResult) {
                var vr = result.validationResult;
                var msg = '校验完成：总行数 ' + vr.totalRows + '，成功 ' + vr.successRows + ' 行，错误 ' + vr.errorRows + ' 行';
                if (vr.errorRows > 0) {
                    msg += '\n\n错误详情：\n' + vr.errors.join('\n');
                    showToast('⚠️ ' + msg, 'error');
                } else {
                    showToast('✅ ' + msg, 'success');
                    currentRows = vr.validRows;
                    renderTable();
                    setStatus('已加载: ' + currentTableId + ' (' + currentRows.length + '行)');
                }
            } else {
                showToast('❌ ' + (result.message || '上传失败'), 'error');
            }
            fileInput.value = '';
        })
        .catch(function (err) {
            showToast('❌ 上传失败：' + err.message, 'error');
            setStatus('上传失败');
            fileInput.value = '';
            console.error('上传错误:', err);
        });
}