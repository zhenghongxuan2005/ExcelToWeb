// ================================================================
// 编辑操作
// ================================================================

function addRow() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    pushHistory();

    const newRow = {};
    for (const h of currentHeaders) {
        newRow[h] = '';
    }
    currentRows.push(newRow);

    sortField = null;
    sortOrder = 1;
    renderTable();

    const container = document.getElementById('tableContainer');
    if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    showToast('✅ 已新增一行，请填写数据后点击保存', 'success');
    setStatus('已新增一行');
}

function deleteSelectedRows() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }

    const checkboxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('请先勾选要删除的行', 'info');
        return;
    }

    if (!confirm(`确定要删除选中的 ${checkboxes.length} 行吗？`)) return;

    pushHistory();

    const indices = [];
    checkboxes.forEach(cb => indices.push(parseInt(cb.dataset.index)));
    indices.sort((a, b) => b - a);

    for (const idx of indices) {
        currentRows.splice(idx, 1);
    }

    sortField = null;
    sortOrder = 1;
    renderTable();

    showToast(`✅ 已删除 ${indices.length} 行`, 'success');
    setStatus(`已删除 ${indices.length} 行`);
}

function clearAll() {
    if (!currentTableId) {
        showToast('没有数据可清空', 'info');
        return;
    }
    if (!confirm('确定要清空当前表格数据吗？（保存后生效）')) return;

    pushHistory();
    currentRows = [];
    sortField = null;
    sortOrder = 1;
    renderTable();

    showToast('已清空', 'info');
    setStatus('已清空');
}

function batchEdit() {
    const checkboxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('请先勾选要修改的行', 'info');
        return;
    }

    const select = document.getElementById('batchColumnSelect');
    select.innerHTML = '';
    for (const h of currentHeaders) {
        const option = document.createElement('option');
        option.value = h;
        option.textContent = h;
        select.appendChild(option);
    }

    document.getElementById('batchValueInput').value = '';
    document.getElementById('batchModal').style.display = 'flex';
}

function closeBatchModal() {
    document.getElementById('batchModal').style.display = 'none';
}

function confirmBatchEdit() {
    const column = document.getElementById('batchColumnSelect').value;
    const newValue = document.getElementById('batchValueInput').value.trim();

    if (newValue === '') {
        showToast('请输入新值', 'info');
        return;
    }

    const checkboxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('没有选中任何行', 'info');
        closeBatchModal();
        return;
    }

    pushHistory();

    const indices = [];
    checkboxes.forEach(cb => {
        const index = parseInt(cb.dataset.index);
        indices.push(index);
        currentRows[index][column] = newValue;
    });

    document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
    const selectAll = document.getElementById('selectAll');
    if (selectAll) selectAll.checked = false;

    closeBatchModal();
    renderTable();

    showToast(`✅ 已成功修改 ${indices.length} 行的 "${column}" 列`, 'success');
}
