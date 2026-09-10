// ================================================================
// 数据读写与导出：保存（含前端校验）、导出 Excel/CSV、下载模板、全选
// 依赖：state.js（全局状态）、utils.js、api.js、tables.js（refreshData）
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
// 导出「当前视图」：把搜索结果 / 排序 / 隐藏列之后的表格导出为 CSV
// 纯前端生成，不新增后端接口；导出的是全部筛选结果（不受分页限制）
// ================================================================
function exportViewCsv() {
    if (currentRows.length === 0) {
        showToast('没有可导出的数据', 'info');
        return;
    }

    const headers = getVisibleHeaders();
    const rows = buildDisplayRows();

    if (rows.length === 0) {
        showToast('当前筛选结果为空，无可导出内容', 'info');
        return;
    }

    const lines = [headers.map(csvCell).join(',')];
    for (const row of rows) {
        lines.push(headers.map(h => csvCell(row[h])).join(','));
    }

    // 前置 UTF-8 BOM，否则 Excel 打开中文会乱码
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const suffix = searchKeyword ? '_筛选结果' : '';
    downloadBlob(blob, `数据${suffix}_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast(`✅ 已导出当前视图（${rows.length} 行）`, 'success');
}

/** CSV 单元格转义：含逗号/引号/换行的值必须用双引号包裹 */
function csvCell(value) {
    const s = value === undefined || value === null ? '' : String(value);
    if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
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
    // 勾选状态是代码改的，不会触发 change 事件，需手动刷新统计
    updateSelectionStats();
}
