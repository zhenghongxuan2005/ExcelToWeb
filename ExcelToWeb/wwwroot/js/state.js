// ================================================================
// 全局状态 + 认证 + 表格管理 + 撤销重做
// ================================================================

// ----- 状态 -----
let allTables = [];
let currentTableId = null;
let currentHeaders = [];
let currentRows = [];
let sortField = null;
let sortOrder = 1;

let colorRulesCache = [];
let ruleColumnName = '数量';

let undoHistory = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

let filterColumn = null;
let originalRows = [];

let currentValidationRules = [];
let currentRules = [];

// ================================================================
// 工具函数
// ================================================================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function setStatus(text) {
    const el = document.getElementById('statusText');
    if (el) el.textContent = text;
}

function isDateColumnName(name) {
    if (!name) return false;
    const keywords = ['日期', '时间', '日', 'date', 'time', '创建', '更新', '成交', '出生', '入职'];
    return keywords.some(k => name.indexOf(k) !== -1);
}

function isNumericColumn(name) {
    if (!name || currentRows.length === 0) return false;
    let numericCount = 0;
    const sample = currentRows.slice(0, 10);
    for (const row of sample) {
        const val = row[name];
        if (val !== undefined && val !== null && val !== '') {
            if (!isNaN(parseFloat(val))) numericCount++;
        }
    }
    return numericCount > 0;
}

function formatTime(dateStr) {
    if (!dateStr) return '未知时间';
    try {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch {
        return dateStr;
    }
}

// ================================================================
// 认证（JWT）
// ================================================================
function checkLogin() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    const username = localStorage.getItem('username');
    const userInfoEl = document.getElementById('userInfo');
    if (userInfoEl && username) {
        userInfoEl.textContent = '👤 ' + username;
    }
    getCurrentUser()
        .then(() => loadTableList())
        .catch(() => {
            localStorage.removeItem('token');
            localStorage.removeItem('username');
            window.location.href = '/login.html';
        });
}

function handleLogout() {
    if (!confirm('确定要退出登录吗？')) return;
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    window.location.href = '/login.html';
}

// ================================================================
// 撤销/重做
// ================================================================
function pushHistory() {
    if (historyIndex < undoHistory.length - 1) {
        undoHistory = undoHistory.slice(0, historyIndex + 1);
    }
    undoHistory.push({
        rows: JSON.parse(JSON.stringify(currentRows)),
        headers: JSON.parse(JSON.stringify(currentHeaders))
    });
    if (undoHistory.length > MAX_HISTORY) undoHistory.shift();
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
    const statusText = document.getElementById('statusText');
    if (statusText) {
        const undoCount = historyIndex;
        const redoCount = undoHistory.length - historyIndex - 1;
        const currentStatus = statusText.textContent.split(' | ')[0] || '就绪';
        statusText.textContent = `${currentStatus} | 撤销: ${undoCount} | 重做: ${redoCount}`;
    }
}

// ================================================================
// 颜色规则
// ================================================================
function loadColorRules(columnName) {
    return fetchColorRules(columnName)
        .then(rules => {
            colorRulesCache = rules || [];
            return colorRulesCache;
        })
        .catch(() => {
            colorRulesCache = [];
            return [];
        });
}

function getColorForValue(columnName, value) {
    if (!value || colorRulesCache.length === 0) return null;
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return null;
    for (const rule of colorRulesCache) {
        if (rule.columnName !== columnName) continue;
        const { minValue: min, maxValue: max } = rule;
        const isMatch = (max === null || max === undefined)
            ? numValue >= min
            : numValue >= min && numValue <= max;
        if (isMatch) return rule.colorCode;
    }
    return null;
}

// ================================================================
// 表格列表管理
// ================================================================
function renderTableSelector() {
    const selector = document.getElementById('tableSelector');
    if (!selector) return;
    let html = '<option value="">-- 请选择表格 --</option>';
    for (const t of allTables) {
        const selected = t.id === currentTableId ? ' selected' : '';
        const timeStr = formatTime(t.updatedAt || t.createdAt);
        html += `<option value="${t.id}"${selected}>${t.tableName} (${timeStr})</option>`;
    }
    selector.innerHTML = html;
}

function loadTableList() {
    fetchTableList()
        .then(tables => {
            allTables = tables || [];
            renderTableSelector();
            if (allTables.length === 0) {
                currentTableId = null;
                currentHeaders = [];
                currentRows = [];
                renderTable();
                setStatus('无表格，请上传 Excel');
                return;
            }
            if (!currentTableId) {
                currentTableId = allTables[0].id;
                document.getElementById('tableSelector').value = currentTableId;
                loadTableData(currentTableId);
            }
        })
        .catch(err => console.error('加载表格列表失败:', err));
}

function getTableName(tableId) {
    const t = allTables.find(t => t.id === tableId);
    return t ? t.tableName : '未知表格';
}

function loadTableData(tableId) {
    setStatus('加载中...');
    queryTableData(tableId)
        .then(data => {
            if (data && data.headers && data.rows) {
                currentHeaders = data.headers;
                currentRows = data.rows;
                sortField = null;
                sortOrder = 1;
                loadColorRules(ruleColumnName).then(() => renderTable());
                setStatus(`已加载: ${getTableName(tableId)} (${currentRows.length}行)`);
                showToast('✅ 已切换到: ' + getTableName(tableId), 'success');
            } else {
                currentHeaders = [];
                currentRows = [];
                renderTable();
                setStatus('该表格没有数据');
            }
        })
        .catch(err => {
            showToast('❌ 加载失败：' + err.message, 'error');
            setStatus('加载失败');
            console.error(err);
        });
}

function switchTable() {
    const selector = document.getElementById('tableSelector');
    const tableId = parseInt(selector.value);
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

function deleteCurrentTable() {
    if (!currentTableId) {
        showToast('请先选择一个表格', 'info');
        return;
    }
    if (!confirm('确定要删除当前表格及其所有数据吗？此操作不可恢复。')) return;

    deleteTable(currentTableId)
        .then(() => {
            showToast('✅ 表格已删除', 'success');
            allTables = allTables.filter(t => t.id !== currentTableId);
            currentTableId = null;
            currentHeaders = [];
            currentRows = [];
            renderTableSelector();
            renderTable();
            setStatus('已删除');
            if (allTables.length > 0) {
                currentTableId = allTables[0].id;
                document.getElementById('tableSelector').value = currentTableId;
                loadTableData(currentTableId);
            }
        })
        .catch(err => showToast('❌ 删除失败：' + err.message, 'error'));
}

function refreshData() {
    originalRows = [];
    filterColumn = null;
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    setStatus('刷新中...');
    queryTableData(currentTableId)
        .then(data => {
            if (data && data.headers && data.rows) {
                currentHeaders = data.headers;
                currentRows = data.rows;
                sortField = null;
                sortOrder = 1;
                loadColorRules(ruleColumnName).then(() => renderTable());
                showToast('✅ 已刷新', 'success');
                setStatus(`已刷新 (${data.rows.length}行)`);
            }
        })
        .catch(err => {
            showToast('❌ 刷新失败：' + err.message, 'error');
            setStatus('刷新失败');
            console.error(err);
        });
    undoHistory = [];
    historyIndex = -1;
    updateUndoButtons();
}

// ================================================================
// 保存数据（含前端校验）
// ================================================================
function saveData() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    // 收集输入框中的最新值
    document.querySelectorAll('.cell-input').forEach(input => {
        const idx = parseInt(input.dataset.index);
        const key = input.dataset.key;
        if (!isNaN(idx) && currentRows[idx]) {
            currentRows[idx][key] = input.value;
        }
    });

    fetchValidationRules(currentTableId)
        .then(rules => {
            const errors = [];
            const validRows = [];
            if (rules && rules.length > 0) {
                currentRows.forEach((row, r) => {
                    const rowErrors = [];
                    let rowValid = true;
                    for (const rule of rules) {
                        const colName = rule.columnName;
                        const value = row[colName] !== undefined ? String(row[colName]) : '';
                        if (rule.required && !value) {
                            rowErrors.push(colName + ' 不能为空');
                            rowValid = false;
                            continue;
                        }
                        if (!value) continue;
                        if (rule.dataType === 'number') {
                            const num = parseFloat(value);
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
                    if (rowValid) validRows.push(row);
                    else errors.push(`第 ${r + 1} 行：${rowErrors.join('；')}`);
                });
            } else {
                validRows.push(...currentRows);
            }

            if (errors.length > 0) {
                showToast('⚠️ 校验失败：\n' + errors.join('\n'), 'error');
                return;
            }

            setStatus('保存中...');
            return saveTableData(currentTableId, validRows)
                .then(result => {
                    showToast('✅ ' + (result.message || '保存成功'), 'success');
                    setStatus('已保存');
                    refreshData();
                });
        })
        .catch(err => showToast('❌ 保存失败：' + err.message, 'error'));
}

// ================================================================
// 导出功能（使用 fetch + blob，修复原 window.location.href 不传 token 的 bug）
// ================================================================
function exportExcel() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    setStatus('导出中...');
    exportExcelBlob(currentTableId)
        .then(blob => {
            downloadBlob(blob, `数据_${new Date().toISOString().slice(0, 10)}.xlsx`);
            setStatus('已导出');
            showToast('✅ Excel 导出成功', 'success');
        })
        .catch(err => {
            showToast('❌ 导出失败：' + err.message, 'error');
            setStatus('导出失败');
        });
}

function exportCsv() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    setStatus('导出中...');
    exportCsvBlob(currentTableId)
        .then(blob => {
            downloadBlob(blob, `数据_${new Date().toISOString().slice(0, 10)}.csv`);
            setStatus('已导出');
            showToast('✅ CSV 导出成功', 'success');
        })
        .catch(err => {
            showToast('❌ 导出失败：' + err.message, 'error');
            setStatus('导出失败');
        });
}

function downloadTemplate() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件或选择一个表格', 'error');
        return;
    }
    setStatus('下载模板中...');
    downloadTemplateBlob(currentTableId)
        .then(blob => {
            downloadBlob(blob, `模板_${new Date().toISOString().slice(0, 10)}.xlsx`);
            setStatus('已下载');
            showToast('✅ 模板下载成功', 'success');
        })
        .catch(err => {
            showToast('❌ 下载失败：' + err.message, 'error');
            setStatus('下载失败');
        });
}

// ================================================================
// 全选/取消全选
// ================================================================
function toggleAllCheckboxes() {
    const selectAll = document.getElementById('selectAll');
    if (!selectAll) return;
    document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.checked = selectAll.checked;
    });
}
