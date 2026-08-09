// ================================================================
// 排序和筛选
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

function applyDateFilter() {
    const dateInput = document.getElementById('filterDate');
    const date = dateInput.value;
    if (!date) {
        showToast('请选择日期', 'info');
        return;
    }
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }

    setStatus('筛选...');
    queryTableData(currentTableId, date)
        .then(data => {
            if (data && data.headers && data.rows) {
                currentHeaders = data.headers;
                currentRows = data.rows;
                sortField = null;
                sortOrder = 1;
                loadColorRules(ruleColumnName).then(() => renderTable());
                showToast(`✅ 已筛选 ${data.rows.length} 条数据`, 'success');
                setStatus(`已筛选: ${date} (${data.rows.length}行)`);
            } else {
                currentRows = [];
                renderTable();
                showToast('该日期没有数据', 'info');
                setStatus('无数据');
            }
        })
        .catch(err => {
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
// 列筛选
// ================================================================

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

    const keyword = document.getElementById('filterKeyword').value.trim();
    const condition = document.getElementById('filterCondition').value;

    if (!keyword) {
        showToast('请输入筛选关键词', 'info');
        return;
    }

    if (originalRows.length === 0) {
        originalRows = currentRows.slice();
    }

    const filtered = originalRows.filter(row => {
        const val = row[filterColumn] !== undefined ? String(row[filterColumn]) : '';
        const lowerVal = val.toLowerCase();
        const lowerKeyword = keyword.toLowerCase();

        switch (condition) {
            case 'contains': return lowerVal.indexOf(lowerKeyword) !== -1;
            case 'notContains': return lowerVal.indexOf(lowerKeyword) === -1;
            case 'equals': return lowerVal === lowerKeyword;
            case 'startsWith': return lowerVal.indexOf(lowerKeyword) === 0;
            case 'endsWith': return lowerVal.lastIndexOf(lowerKeyword) === lowerVal.length - lowerKeyword.length;
            default: return true;
        }
    });

    currentRows = filtered;
    renderTable();
    closeFilter();

    showToast(`✅ 筛选完成，显示 ${filtered.length} 行（共 ${originalRows.length} 行）`, 'success');
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
