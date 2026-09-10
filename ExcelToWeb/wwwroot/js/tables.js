// ================================================================
// 表格列表管理：加载列表、切换、删除、刷新
// 依赖：state.js（allTables / currentTableId 等全局状态）、utils.js、render.js、api.js
//       history.js（刷新时清空撤销栈）
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
                loadColorRules().then(() => renderTable());
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
                loadColorRules().then(() => renderTable());
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
