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

    resetSort();
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

    resetSort();
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
    resetSort();
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

// ================================================================
// 行结构操作（插入 / 上移 / 下移）
// ----------------------------------------------------------------
// 作用对象：优先取勾选的行；没有勾选时取当前聚焦单元格所在的行，
// 这样「点一下某行再插入」也能直接工作，符合 Excel 的操作直觉。
// 所有操作只改前端 currentRows，点击「保存」后才落库，且都可用 Ctrl+Z 撤销。
// ================================================================

/** 取本次要操作的行下标（已排序）。没有目标时返回空数组 */
function resolveTargetIndexes() {
    const selected = getSelectedIndexes();
    if (selected.length > 0) return selected.sort((a, b) => a - b);

    const el = document.activeElement;
    if (isCellInput(el)) {
        const idx = parseInt(el.dataset.index);
        if (!isNaN(idx) && currentRows[idx]) return [idx];
    }
    return [];
}

/** 在选中行上方插入与选中行数相同的空行（Excel 的「在上方插入行」） */
function insertRowsAbove() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }

    const indexes = resolveTargetIndexes();
    if (indexes.length === 0) {
        showToast('请先勾选一行，或点一下作为插入位置的单元格', 'info');
        return;
    }

    const at = indexes[0];
    const blanks = [];
    for (let n = 0; n < indexes.length; n++) {
        const blank = {};
        for (const h of currentHeaders) blank[h] = '';
        blanks.push(blank);
    }

    pushHistory();
    currentRows.splice(at, 0, ...blanks);

    resetSort();
    renderTable();

    showToast(`✅ 已在第 ${at + 1} 行上方插入 ${blanks.length} 行`, 'success');
    setStatus(`已插入 ${blanks.length} 行`);
}

/**
 * 上移 / 下移选中行。
 * 实现方式：把选中的行整体取出、把未选中的行按原顺序重组，
 * 再把整块插到新位置 —— 这样相邻多行选中时会作为一整块移动，
 * 不会出现块内互相交换导致顺序错乱。
 * @param {number} dir -1 上移，1 下移
 */
function moveSelectedRows(dir) {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }

    const indexes = resolveTargetIndexes();
    if (indexes.length === 0) {
        showToast('请先勾选要移动的行', 'info');
        return;
    }

    if (dir < 0 && indexes[0] === 0) {
        showToast('已经是第一行，无法上移', 'info');
        return;
    }
    if (dir > 0 && indexes[indexes.length - 1] === currentRows.length - 1) {
        showToast('已经是最后一行，无法下移', 'info');
        return;
    }

    const selected = new Set(indexes);
    const group = indexes.map(i => currentRows[i]);
    const rest = currentRows.filter((_, i) => !selected.has(i));

    // 选中块之前有多少「未选中」的行，即它在 rest 里的落点基准。
    // 下移时整块要跨过紧邻下方那一行，因此在 rest 里的落点是 before + 1；
    // 上移时跨过上方那一行，落点是 before - 1。
    let before = 0;
    for (let i = 0; i < indexes[0]; i++) {
        if (!selected.has(i)) before++;
    }

    const at = before + (dir < 0 ? -1 : 1);
    // at === rest.length 表示插到末尾，这是合法的（等价于整体下沉到底）
    if (at < 0 || at > rest.length) return;

    pushHistory();
    rest.splice(at, 0, ...group);
    currentRows = rest;

    resetSort();
    renderTable();

    showToast(dir < 0 ? `✅ 已上移 ${group.length} 行` : `✅ 已下移 ${group.length} 行`, 'success');
    setStatus(dir < 0 ? `上移 ${group.length} 行` : `下移 ${group.length} 行`);
}
