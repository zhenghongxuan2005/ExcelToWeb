// ================================================================
// 入口文件 - 初始化和启动
// ================================================================

document.addEventListener('DOMContentLoaded', () => {
    // 文件上传监听（导入流程统一走 dnd.js 的 uploadFile，避免两条路径行为不一致）
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            uploadFile(file);
            e.target.value = '';
        });
    }

    // 拖拽上传
    initDragAndDrop();

    // 单元格区域选择 + 复制 / 粘贴
    initRangeSelection();

    // 列显示 / 列宽菜单
    renderColumnMenu();

    // 应用「设置」页保存的偏好（默认每页行数、字号）
    applySavedPreferences();

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
        // Ctrl+F 聚焦到全表搜索框
        if (e.ctrlKey && e.key === 'f') {
            const search = document.getElementById('globalSearch');
            if (search) {
                e.preventDefault();
                search.focus();
                search.select();
            }
        }
        // Esc 关闭所有弹窗
        if (e.key === 'Escape') {
            closeRuleModal();
            closeValidationModal();
            closeFilter();
            closeBatchModal();
            closeColumnModal();
            closeFindModal();
        }
    });
});

// ================================================================
// 应用「设置」页保存的偏好
// ================================================================
function applySavedPreferences() {
    // 默认每页行数
    const savedSize = localStorage.getItem('prefPageSize');
    if (savedSize !== null) {
        const n = parseInt(savedSize);
        pageSize = isNaN(n) ? 0 : n;
        const sel = document.getElementById('pageSizeSelect');
        if (sel) sel.value = String(pageSize);
    }

    // 表格字号
    if (localStorage.getItem('prefTextSize') === 'large') {
        document.documentElement.setAttribute('data-text-size', 'large');
    }
}

// ================================================================
// 暴露全局函数给 HTML onclick 调用
// ================================================================
Object.assign(window, {
    addRow, deleteSelectedRows, batchEdit, confirmBatchEdit, closeBatchModal,
    // 行结构操作
    insertRowsAbove, moveSelectedRows,
    clearAll, sortBy, applyDateFilter, clearDateFilter,
    openFilter, closeFilter, applyFilter, clearFilter,
    openRuleModal, closeRuleModal, addRuleRow, removeRule, moveRuleUp, moveRuleDown, saveRules,
    openValidationModal, closeValidationModal, addValidationRule, saveValidationRules,
    uploadWithValidation, toggleAllCheckboxes,
    exportExcel, exportCsv, exportViewCsv, downloadTemplate,
    refreshData, saveData, switchTable, deleteCurrentTable, handleLogout,
    undo, redo,
    // 查找 / 替换
    openFindModal, closeFindModal, findNext, replaceCurrent, replaceAll, updateFindStatus,
    // 列管理（增删改移）
    openColumnModal, closeColumnModal, addColumnRow, removeColumnRow, moveColumnRow,
    onColumnDraftInput, saveColumnStructure,
    // 单元格选区（复制 / 粘贴 / 清空）
    copyRangeSelection, clearRangeContent, clearRange,
    // 汇总行
    setAggregateMode, toggleAggregateRow,
    // 视图：搜索 / 分页 / 列
    onSearchInput, clearSearch, gotoPage, setPageSize,
    toggleColumn, setColumnWidth, showAllColumns,
    updateSelectionStats
});
