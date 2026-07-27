// ================================================================
// 全局状态
// ================================================================
var currentTableId = null;
var currentHeaders = [];
var currentRows = [];
var sortField = null;
var sortOrder = 1;

function showToast(message, type) {
    type = type || 'info';
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3000);
}

function setStatus(text) {
    document.getElementById('statusText').textContent = text;
}

// ================================================================
// 上传 Excel
// ================================================================
document.getElementById('fileInput').addEventListener('change', function (e) {
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
                renderTable();
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

// ================================================================
// 渲染表格
// ================================================================
function renderTable() {
    var container = document.getElementById('tableContainer');
    if (!container) return;

    if (currentHeaders.length === 0 || currentRows.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>暂无数据，请上传 Excel 文件</p></div>';
        return;
    }

    var displayRows = currentRows.slice();
    if (sortField) {
        displayRows.sort(function (a, b) {
            var va = a[sortField] || '';
            var vb = b[sortField] || '';
            if (typeof va === 'number' && typeof vb === 'number') {
                return (va - vb) * sortOrder;
            }
            return String(va).localeCompare(String(vb)) * sortOrder;
        });
    }

    var html = '<table><thead><tr>';
    html += '<th style="width:44px; min-width:44px; cursor:default;">#</th>';
    for (var i = 0; i < currentHeaders.length; i++) {
        var h = currentHeaders[i];
        var arrow = (sortField === h) ? (sortOrder === 1 ? ' ▲' : ' ▼') : ' ⇅';
        html += '<th onclick="sortBy(\'' + h + '\')">' + h + arrow + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (var r = 0; r < displayRows.length; r++) {
        var row = displayRows[r];
        html += '<tr>';
        html += '<td style="text-align:center; font-weight:500; color:#6b7b93;">' + (r + 1) + '</td>';
        for (var c = 0; c < currentHeaders.length; c++) {
            var key = currentHeaders[c];
            var val = row[key] !== undefined && row[key] !== null ? row[key] : '';
            html += '<td><input class="cell-input" type="text" value="' + val + '" data-row="' + r + '" data-key="' + key + '" /></td>';
        }
        html += '</tr>';
    }

    html += '</tbody></table>';
    html += '<div class="stats-bar">';
    html += '<span>📊 共 <strong>' + displayRows.length + '</strong> 行</span>';
    html += '<span>📋 <strong>' + currentHeaders.length + '</strong> 列</span>';
    html += '<span style="color:#6b7b93;">💡 点击表头排序，编辑后点击"保存"</span>';
    html += '</div>';

    container.innerHTML = html;

    var inputs = container.querySelectorAll('.cell-input');
    for (var j = 0; j < inputs.length; j++) {
        inputs[j].addEventListener('input', function () {
            var rowIdx = parseInt(this.dataset.row);
            var key = this.dataset.key;
            if (!isNaN(rowIdx) && currentRows[rowIdx]) {
                currentRows[rowIdx][key] = this.value;
            }
        });
    }
}

// ================================================================
// 排序功能
// ================================================================
function sortBy(field) {
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
        var rowIdx = parseInt(inputs[i].dataset.row);
        var key = inputs[i].dataset.key;
        if (!isNaN(rowIdx) && currentRows[rowIdx]) {
            currentRows[rowIdx][key] = inputs[i].value;
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
                renderTable();
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
    renderTable();
    showToast('已清空', 'info');
    setStatus('已清空');
}