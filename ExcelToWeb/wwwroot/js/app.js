// ================================================================
// 全局状态
// ================================================================
var currentTableId = null;
var currentHeaders = [];
var currentRows = [];
var sortField = null;
var sortOrder = 1;

// 颜色规则缓存（按用户设定的顺序存储，优先级从高到低）
var colorRulesCache = [];
var ruleColumnName = '数量';

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
        html += '<th onclick="sortBy(\'' + h + '\')" style="cursor:pointer; user-select:none;">' + h + arrow + '</th>';
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

            // 应用颜色规则
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
    var inputs = container.querySelectorAll('.cell-input');
    for (var j = 0; j < inputs.length; j++) {
        var input = inputs[j];
        var cell = input.parentElement;
        var suggestList = cell.querySelector('.suggest-list');

        input.addEventListener('input', function (e) {
            var inp = e.target;
            var list = inp.parentElement.querySelector('.suggest-list');
            if (!list) return;

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

            var idx = parseInt(inp.dataset.index);
            var key = inp.dataset.key;
            if (!isNaN(idx) && currentRows[idx]) {
                currentRows[idx][key] = inp.value;
            }
        });

        if (suggestList) {
            var items = suggestList.querySelectorAll('.suggest-item');
            for (var n = 0; n < items.length; n++) {
                items[n].addEventListener('click', function (e) {
                    var item = e.target;
                    var inp = item.parentElement.previousElementSibling;
                    inp.value = item.getAttribute('data-value') || item.textContent;
                    item.parentElement.style.display = 'none';
                    inp.dispatchEvent(new Event('input'));
                });
            }
        }

        input.addEventListener('blur', function (e) {
            var inp = e.target;
            setTimeout(function () {
                var list = inp.parentElement.querySelector('.suggest-list');
                if (list) list.style.display = 'none';
            }, 200);
        });

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
    var inputs = document.querySelectorAll('.cell-input');
    for (var i = 0; i < inputs.length; i++) {
        var idx = parseInt(inputs[i].dataset.index);
        var key = inputs[i].dataset.key;
        if (!isNaN(idx) && currentRows[idx]) currentRows[idx][key] = inputs[i].value;
    }
    var selects = document.querySelectorAll('.cell-select');
    if (selects) {
        for (var j = 0; j < selects.length; j++) {
            var idx = parseInt(selects[j].dataset.index);
            var key = selects[j].dataset.key;
            if (!isNaN(idx) && currentRows[idx]) currentRows[idx][key] = selects[j].value;
        }
    }
    var payload = { tableId: currentTableId, rows: currentRows };
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
// 刷新数据
// ================================================================
function refreshData() {
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