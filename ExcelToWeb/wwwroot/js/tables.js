// ================================================================
// 表格列表管理：加载列表、切换、删除、刷新
// 依赖：state.js（allTables / currentTableId 等全局状态）、utils.js、render.js、api.js
//       history.js（resetHistory / undo / redo）
// 说明：换了数据源的地方都必须调用 resetHistory()，否则 A 表的快照会被
//       撤销到 B 表上 —— 那是会写错数据的。
// ================================================================

function renderTableSelector() {
    const selector = document.getElementById('tableSelector');
    if (!selector) return;
    let html = '<option value="">-- 请选择表格 --</option>';
    for (const t of allTables) {
        const selected = t.id === currentTableId ? ' selected' : '';
        const timeStr = formatTime(t.updatedAt || t.createdAt);
        html += `<option value="${t.id}"${selected}>${escapeHtml(t.tableName)} (${timeStr})</option>`;
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
                resetHistory();
                renderTable();
                setStatus('无表格，请上传 Excel');
                return;
            }

            // 从「表格管理」页跳转过来时，优先打开它指定的表格（一次性消费）
            const pending = localStorage.getItem('openTableId');
            if (pending) {
                localStorage.removeItem('openTableId');
                const pid = parseInt(pending);
                if (allTables.some(t => t.id === pid)) {
                    currentTableId = pid;
                    const sel = document.getElementById('tableSelector');
                    if (sel) sel.value = pid;
                    loadTableData(pid);
                    return;
                }
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
    showTableSkeleton(currentHeaders.length);
    queryTableData(tableId)
        .then(data => {
            hideTableSkeleton();
            if (data && data.headers && data.rows) {
                currentHeaders = data.headers;
                currentRows = data.rows;
                sortField = null;
                sortOrder = 1;
                // 加载新数据源，旧表格的撤销快照必须作废
                resetHistory();
                loadColorRules().then(() => renderTable());
                setStatus(`已加载: ${getTableName(tableId)} (${currentRows.length}行)`);
                showToast('✅ 已切换到: ' + getTableName(tableId), 'success');
            } else {
                currentHeaders = [];
                currentRows = [];
                resetHistory();
                renderTable();
                setStatus('该表格没有数据');
            }
        })
        .catch(err => {
            hideTableSkeleton();
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
        resetHistory();
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
            resetHistory();
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
    // 列筛选是纯视图状态，刷新时先清掉（撤销栈由下面的 resetHistory 一并清）
    if (typeof resetFilter === 'function') resetFilter();
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    setStatus('刷新中...');
    showTableSkeleton(currentHeaders.length);
    // 从服务端重取数据，撤销栈随之作废
    resetHistory();
    queryTableData(currentTableId)
        .then(data => {
            hideTableSkeleton();
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
            hideTableSkeleton();
            showToast('❌ 刷新失败：' + err.message, 'error');
            setStatus('刷新失败');
            console.error(err);
        });
}