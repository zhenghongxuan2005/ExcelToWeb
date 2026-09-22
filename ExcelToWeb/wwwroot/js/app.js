// ================================================================
// 入口文件 - 初始化和启动
// ================================================================

document.addEventListener('DOMContentLoaded', () => {
    // 文件上传监听（导入统一走 sheet-picker.js 的 startImport：由它决定用哪张工作表，
    // 再调 dnd.js 的 uploadFile 真正导入，两条路径行为一致）
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            startImport(file);
            e.target.value = '';
        });
    }

    // 拖拽上传
    initDragAndDrop();

    // 单元格区域选择 + 复制 / 粘贴
    initRangeSelection();

    // 选区填充柄（拖拽复制 / 延续序列）
    initFillHandle();

    // 列显示 / 列宽菜单
    renderColumnMenu();

    // 应用「设置」页保存的偏好（默认每页行数、字号）
    applySavedPreferences();

    // 恢复上次的汇总行方式（只改状态不渲染，首屏渲染时自然带上）
    initAggregatePref();

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
            closeFormulaEditor();
            closeFindModal();
            closeHistoryModal();
            closeSheetPicker();
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
    clearAll, sortBy, removeSortKey, clearSort, applyDateFilter, clearDateFilter,
    openFilter, closeFilter, applyFilter, clearFilter,
    // 列筛选：值清单 / 模式切换
    setFilterMode, filterSelectAll, onFilterValueSearch, updateFilterValueCount,
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
    // 计算列（公式编辑）
    openFormulaEditor, closeFormulaEditor, onFormulaInput, applyFormulaDraft,
    clearFormulaDraft, insertFormulaColumn, insertFormulaFunction,
    // 单元格选区（复制 / 粘贴 / 清空）
    copyRangeSelection, clearRangeContent, clearRange,
    // 汇总行
    setAggregateMode, toggleAggregateRow,
    // 多工作表导入（选择框里的每个工作表按钮）
    pickSheet, closeSheetPicker,
    // 视图：搜索 / 分页 / 列
    onSearchInput, clearSearch, gotoPage, setPageSize,
    toggleColumn, setColumnWidth, showAllColumns,
    // 列视图偏好（列宽 / 隐藏列）的持久化
    applyColumnMeta, collectColumnMeta, scheduleMetaSave, flushColumnMeta, resetColumnMeta,
    updateSelectionStats,
    // 变更历史
    openHistoryModal, closeHistoryModal, openRowHistory, clearHistoryFilter
});
