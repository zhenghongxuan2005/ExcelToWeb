// ================================================================
// 入口文件 - 初始化和启动
// ================================================================

document.addEventListener('DOMContentLoaded', () => {
    // 文件上传监听
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;

            const ext = file.name.split('.').pop().toLowerCase();
            if (ext !== 'xlsx' && ext !== 'xls') {
                showToast('请上传 .xlsx 或 .xls 格式的文件', 'error');
                e.target.value = '';
                return;
            }

            setStatus('上传中...');
            uploadExcel(file)
                .then(data => {
                    currentTableId = data.tableId;
                    currentHeaders = data.headers;
                    currentRows = data.rows;
                    sortField = null;
                    sortOrder = 1;
                    renderTable();
                    showToast('✅ 成功导入 ' + data.rows.length + ' 条数据', 'success');
                    setStatus(`已加载: ${data.tableName} (${data.rows.length}行)`);
                    loadTableList();
                })
                .catch(err => {
                    showToast('❌ 上传失败：' + err.message, 'error');
                    setStatus('上传失败');
                    console.error(err);
                });

            e.target.value = '';
        });
    }

    // 检查登录状态
    checkLogin();

    // 键盘快捷键
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
        }
        if (e.ctrlKey && e.key === 'y') {
            e.preventDefault();
            redo();
        }
    });
});

// ================================================================
// 暴露全局函数给 HTML onclick 调用
// ================================================================
Object.assign(window, {
    addRow, deleteSelectedRows, batchEdit, confirmBatchEdit, closeBatchModal,
    clearAll, sortBy, applyDateFilter, clearDateFilter,
    openFilter, closeFilter, applyFilter, clearFilter,
    openRuleModal, closeRuleModal, addRuleRow, removeRule, moveRuleUp, moveRuleDown, saveRules,
    openValidationModal, closeValidationModal, addValidationRule, saveValidationRules,
    uploadWithValidation, toggleAllCheckboxes,
    exportExcel, exportCsv, downloadTemplate,
    refreshData, saveData, switchTable, deleteCurrentTable, handleLogout,
    undo, redo
});
