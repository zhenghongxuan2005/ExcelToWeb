// ================================================================
// 数据读写与导出：保存（含前端校验）、导出 Excel/CSV、下载模板、全选
// 依赖：state.js（全局状态）、utils.js、api.js、tables.js（refreshData）
// ================================================================

/**
 * 保存成功后用服务端回传的行替换本地数据。
 *
 * 服务端已经把「保存后的行」带回来了（新的行主键 + 重算过的计算列），
 * 用它替换就不必再 GET 一次整表 —— 大表上那是第二次全量往返。
 *
 * 行主键必须换成新的：整表替换重新分配了 identity，旧主键全部作废。
 * 不换的话下一次保存按主键匹配不到旧行，计算列的历史原值又会丢。
 *
 * 回传里没有 rows（老服务端，或服务端发现库内行数对不上）时退回整表重取。
 */
function applySavedRows(result, tableId) {
    const rows = result && result.rows;
    if (!Array.isArray(rows)) {
        refreshData({ keepView: true, silent: true });
        return false;
    }

    currentRows = rows;
    // 数据基线已变：旧撤销快照里的行主键作废，撤回去再保存会匹配不到旧行
    resetHistory();
    renderTable();
    if (typeof updatePageMeta === 'function') updatePageMeta();

    // 页头副标题的「最后保存」读的是列表里那张表，同步一下才不是旧时间
    if (result.updatedAt && typeof allTables !== 'undefined' && allTables) {
        const table = allTables.find(t => String(t.id) === String(tableId));
        if (table) table.updatedAt = result.updatedAt;
    }
    return true;
}

function saveData() {
    if (!currentTableId) {
        showToast(tt('请先上传一个 Excel 文件'), 'error');
        return;
    }
    // 收集输入框中的最新值（计算列的值由服务端算，收集回去只会污染 currentRows）
    document.querySelectorAll('.cell-input').forEach(input => {
        const idx = parseInt(input.dataset.index);
        const key = input.dataset.key;
        if (isComputedColumn(key)) return;
        if (!isNaN(idx) && currentRows[idx]) {
            currentRows[idx][key] = input.value;
        }
    });

    // 保存是整表替换：手里一行都没有时按「保存」等于清空整张表。
    // 取数失败 / 渲染异常都可能让 currentRows 变空，所以这里必须问一次
    // （服务端同样默认拒绝空数组，两道闸各管一段）
    if (currentRows.length === 0 && !confirm(tt('当前表格没有任何行，保存会清空整张表的数据。确定继续吗？'))) {
        return;
    }

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
                            rowErrors.push(tt('{col} 不能为空', { col: colName }));
                            rowValid = false;
                            continue;
                        }
                        if (!value) continue;
                        if (rule.dataType === 'number') {
                            const num = parseFloat(value);
                            if (isNaN(num)) {
                                rowErrors.push(tt('{col} 必须是数字', { col: colName }));
                                rowValid = false;
                                continue;
                            }
                            if (rule.minValue !== null && num < rule.minValue) {
                                rowErrors.push(tt('{col} 不能小于 {min}', { col: colName, min: rule.minValue }));
                                rowValid = false;
                            }
                            if (rule.maxValue !== null && num > rule.maxValue) {
                                rowErrors.push(tt('{col} 不能大于 {max}', { col: colName, max: rule.maxValue }));
                                rowValid = false;
                            }
                        }
                    }
                    if (rowValid) validRows.push(row);
                    else errors.push(tt('第 {row} 行：{msg}', { row: r + 1, msg: rowErrors.join(tt('；')) }));
                });

                // 唯一性（跨行）：启用「唯一」的列不允许出现重复值
                for (const rule of rules) {
                    if (!rule.unique) continue;
                    const seen = {};
                    currentRows.forEach((row, r) => {
                        const v = row[rule.columnName] !== undefined ? String(row[rule.columnName]) : '';
                        if (!v) return;
                        if (seen[v] !== undefined) {
                            errors.push(tt('第 {row} 行：{col} 的值「{v}」与第 {other} 行重复', {
                                row: r + 1, col: rule.columnName, v: v, other: seen[v] + 1
                            }));
                        } else {
                            seen[v] = r;
                        }
                    });
                }

                // 跨表引用：取值必须来自引用列（引用值列表由 loadRefValues 预取）
                for (const rule of rules) {
                    if (!rule.refTableId || !rule.refColumnName) continue;
                    const refList = refValueMap[rule.columnName] || [];
                    if (refList.length === 0) continue;   // 引用表为空时不阻断保存
                    const allowed = new Set(refList);
                    currentRows.forEach((row, r) => {
                        const v = row[rule.columnName] !== undefined ? String(row[rule.columnName]) : '';
                        if (v && !allowed.has(v)) {
                            errors.push(tt('第 {row} 行：{col} 的值「{v}」不在引用表「{table}」的 {ref} 列中', {
                                row: r + 1, col: rule.columnName, v: v,
                                table: getTableName(rule.refTableId), ref: rule.refColumnName
                            }));
                        }
                    });
                }
            } else {
                validRows.push(...currentRows);
            }

            if (errors.length > 0) {
                showToast('⚠️ ' + tt('校验失败：') + '\n' + errors.join('\n'), 'error');
                return;
            }

            setStatus(tt('保存中...'));
            return saveTableData(currentTableId, validRows, currentRows.length === 0)
                .then(result => {
                    // 服务端回传了「保存后的行」就直接替换（含新行主键与重算的计算列），
                    // 省掉一次整表往返；回传缺行时才退回重取。
                    // 这里不做 resetFilter/resetSort：排序与筛选是视图状态，与这次保存无关。
                    applySavedRows(result, currentTableId);
                    showToast('✅ ' + tt('保存成功'), 'success');
                    setStatus(tt('已保存'));
                });
        })
        .catch(err => showToast('❌ ' + tt('保存失败：{msg}', { msg: err.message }), 'error'));
}

// ================================================================
// 导出功能（使用 fetch + blob，修复原 window.location.href 不传 token 的 bug）
// ================================================================
function exportExcel() {
    if (!currentTableId) {
        showToast(tt('请先上传一个 Excel 文件'), 'error');
        return;
    }
    // Excel / CSV 导出都由后端读库里已保存的数据生成，屏幕上的未保存修改不在其中。
    // 不提示的话，用户会对着导出文件找那几处刚改的值 —— 然后以为是自己改丢了。
    // （「导出当前视图」是纯前端生成、导出所见内容，那条路径不需要问）
    if (hasUnsavedChanges()
        && !confirm(tt('当前有未保存的修改，导出的是上次保存的数据。继续导出吗？'))) {
        return;
    }
    setStatus(tt('导出中...'));
    exportExcelBlob(currentTableId)
        .then(blob => {
            downloadBlob(blob, `${isEnglish() ? 'data' : '数据'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
            setStatus(tt('已导出'));
            showToast('✅ ' + tt('Excel 导出成功'), 'success');
        })
        .catch(err => {
            showToast('❌ ' + tt('导出失败：{msg}', { msg: err.message }), 'error');
            setStatus(tt('导出失败'));
        });
}

function exportCsv() {
    if (!currentTableId) {
        showToast(tt('请先上传一个 Excel 文件'), 'error');
        return;
    }
    // 与 exportExcel 同一口径：后端读库生成，未保存修改不在其中
    if (hasUnsavedChanges()
        && !confirm(tt('当前有未保存的修改，导出的是上次保存的数据。继续导出吗？'))) {
        return;
    }
    setStatus(tt('导出中...'));
    exportCsvBlob(currentTableId)
        .then(blob => {
            downloadBlob(blob, `${isEnglish() ? 'data' : '数据'}_${new Date().toISOString().slice(0, 10)}.csv`);
            setStatus(tt('已导出'));
            showToast('✅ ' + tt('CSV 导出成功'), 'success');
        })
        .catch(err => {
            showToast('❌ ' + tt('导出失败：{msg}', { msg: err.message }), 'error');
            setStatus(tt('导出失败'));
        });
}

function downloadTemplate() {
    if (!currentTableId) {
        showToast(tt('请先上传一个 Excel 文件或选择一个表格'), 'error');
        return;
    }
    setStatus(tt('下载模板中...'));
    downloadTemplateBlob(currentTableId)
        .then(blob => {
            downloadBlob(blob, `${isEnglish() ? 'template' : '模板'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
            setStatus(tt('已下载'));
            showToast('✅ ' + tt('模板下载成功'), 'success');
        })
        .catch(err => {
            showToast('❌ ' + tt('下载失败：{msg}', { msg: err.message }), 'error');
            setStatus(tt('下载失败'));
        });
}

// ================================================================
// 导出「当前视图」：把搜索结果 / 排序 / 隐藏列之后的表格导出为 CSV
// 纯前端生成，不新增后端接口；导出的是全部筛选结果（不受分页限制）
// ================================================================
function exportViewCsv() {
    if (currentRows.length === 0) {
        showToast(tt('没有可导出的数据'), 'info');
        return;
    }

    const headers = getVisibleHeaders();
    const rows = buildDisplayRows();

    if (rows.length === 0) {
        showToast(tt('当前筛选结果为空，无可导出内容'), 'info');
        return;
    }

    const lines = [headers.map(csvCell).join(',')];
    for (const row of rows) {
        lines.push(headers.map(h => csvCell(row[h])).join(','));
    }

    // 前置 UTF-8 BOM，否则 Excel 打开中文会乱码
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const suffix = searchKeyword ? (isEnglish() ? '_filtered' : '_筛选结果') : '';
    downloadBlob(blob, `${isEnglish() ? 'data' : '数据'}${suffix}_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast('✅ ' + tt('已导出当前视图（{n} 行）', { n: rows.length }), 'success');
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
