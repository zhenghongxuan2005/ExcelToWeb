// ================================================================
// 数据校验规则
// 依赖：state.js（currentTableId 等）、utils.js、api.js
// ================================================================

function openValidationModal() {
    if (!currentTableId) {
        showToast(tt('请先上传一个 Excel 文件'), 'error');
        return;
    }

    fetchValidationRules(currentTableId)
        .then(rules => {
            currentValidationRules = rules || [];
            if (currentValidationRules.length === 0) {
                for (const h of currentHeaders) {
                    currentValidationRules.push({
                        tableId: currentTableId,
                        columnName: h,
                        required: false,
                        dataType: 'text',
                        minValue: null,
                        maxValue: null,
                        maxLength: null,
                        allowedValues: '',
                        unique: false,
                        refTableId: null,
                        refColumnName: ''
                    });
                }
            }
            renderValidationRuleList();
            document.getElementById('validationModal').style.display = 'flex';
        })
        .catch(err => showToast('❌ ' + tt('加载校验规则失败：{msg}', { msg: err.message }), 'error'));
}

function closeValidationModal() {
    document.getElementById('validationModal').style.display = 'none';
}

function renderValidationRuleList() {
    const container = document.getElementById('validationRuleList');
    if (!container) return;

    let html = '<table class="rule-table"><thead><tr>';
    html += '<th>' + tt('列名') + '</th>';
    html += '<th style="text-align:center; width:48px;">' + tt('必填') + '</th>';
    html += '<th style="text-align:center; width:48px;">' + tt('唯一') + '</th>';
    html += '<th style="width:88px;">' + tt('类型') + '</th>';
    html += '<th>' + tt('限制') + '</th>';
    html += '<th style="width:210px;">' + tt('引用来源') + '</th>';
    html += '</tr></thead><tbody>';

    currentValidationRules.forEach((rule, i) => {
        html += '<tr>';
        html += `<td><strong>${escapeHtml(rule.columnName)}</strong></td>`;
        html += `<td class="cell-center"><input type="checkbox" class="rule-required" data-index="${i}" ${rule.required ? 'checked' : ''} /></td>`;
        html += `<td class="cell-center"><input type="checkbox" class="rule-unique" data-index="${i}" ${rule.unique ? 'checked' : ''} title="${tt('该列取值在整张表内不允许重复')}" /></td>`;
        html += `<td><select class="select-sm rule-datatype" style="width:100%;" data-index="${i}">`;
        html += `<option value="text"${rule.dataType === 'text' ? ' selected' : ''}>${tt('文本')}</option>`;
        html += `<option value="number"${rule.dataType === 'number' ? ' selected' : ''}>${tt('数字')}</option>`;
        html += `<option value="date"${rule.dataType === 'date' ? ' selected' : ''}>${tt('日期')}</option>`;
        html += `<option value="email"${rule.dataType === 'email' ? ' selected' : ''}>${tt('邮箱')}</option>`;
        html += '</select></td>';
        html += '<td><div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">';
        html += `<input type="number" class="input-sm rule-min" style="width:70px;" placeholder="${tt('最小值')}" value="${rule.minValue ?? ''}" data-index="${i}" />`;
        html += '<span style="color:var(--text-3);">~</span>';
        html += `<input type="number" class="input-sm rule-max" style="width:70px;" placeholder="${tt('最大值')}" value="${rule.maxValue ?? ''}" data-index="${i}" />`;
        html += `<input type="text" class="input-sm rule-allowed" style="flex:1; min-width:110px; width:auto;" placeholder="${tt('允许值(逗号分隔)')}" value="${rule.allowedValues || ''}" data-index="${i}" />`;
        html += '</div></td>';

        // 引用来源：表 + 列（取自 allTables，表信息里带 headers）
        html += '<td><div style="display:flex; gap:4px;">';
        html += `<select class="select-sm rule-ref-table" style="width:50%;" data-index="${i}">`;
        html += '<option value="">' + tt('不引用') + '</option>';
        (allTables || []).forEach(t => {
            const sel = rule.refTableId === t.id ? ' selected' : '';
            html += `<option value="${t.id}"${sel}>${escapeHtml(t.tableName)}</option>`;
        });
        html += '</select>';
        html += `<select class="select-sm rule-ref-column" style="width:50%;" data-index="${i}">`;
        html += '<option value="">' + tt('选择列') + '</option>';
        const refTable = (allTables || []).find(t => t.id === rule.refTableId);
        if (refTable && refTable.headers) {
            refTable.headers.forEach(h => {
                const sel = rule.refColumnName === h ? ' selected' : '';
                html += `<option value="${escapeHtml(h)}"${sel}>${escapeHtml(h)}</option>`;
            });
        }
        html += '</select>';
        html += '</div></td></tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    container.querySelectorAll('.rule-required').forEach(input => {
        input.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            currentValidationRules[idx].required = e.target.checked;
        });
    });
    container.querySelectorAll('.rule-unique').forEach(input => {
        input.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            currentValidationRules[idx].unique = e.target.checked;
        });
    });
    container.querySelectorAll('.rule-datatype').forEach(select => {
        select.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            currentValidationRules[idx].dataType = e.target.value;
        });
    });
    container.querySelectorAll('.rule-min').forEach(input => {
        input.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            currentValidationRules[idx].minValue = parseFloat(e.target.value) || null;
        });
    });
    container.querySelectorAll('.rule-max').forEach(input => {
        input.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            currentValidationRules[idx].maxValue = parseFloat(e.target.value) || null;
        });
    });
    container.querySelectorAll('.rule-allowed').forEach(input => {
        input.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            currentValidationRules[idx].allowedValues = e.target.value;
        });
    });
    container.querySelectorAll('.rule-ref-table').forEach(select => {
        select.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            const val = e.target.value;
            currentValidationRules[idx].refTableId = val ? parseInt(val) : null;
            currentValidationRules[idx].refColumnName = '';   // 换表后列选择失效，重渲染让用户重选
            renderValidationRuleList();
        });
    });
    container.querySelectorAll('.rule-ref-column').forEach(select => {
        select.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            currentValidationRules[idx].refColumnName = e.target.value;
        });
    });
}

function addValidationRule() {
    currentValidationRules.push({
        tableId: currentTableId,
        columnName: tt('新列_{n}', { n: currentValidationRules.length + 1 }),
        required: false,
        dataType: 'text',
        minValue: null,
        maxValue: null,
        maxLength: null,
        allowedValues: '',
        unique: false,
        refTableId: null,
        refColumnName: ''
    });
    renderValidationRuleList();
}

function saveValidationRules() {
    document.querySelectorAll('.rule-required').forEach((input, i) => {
        currentValidationRules[i].required = input.checked;
    });
    document.querySelectorAll('.rule-unique').forEach((input, i) => {
        currentValidationRules[i].unique = input.checked;
    });
    document.querySelectorAll('.rule-datatype').forEach((select, i) => {
        currentValidationRules[i].dataType = select.value;
    });
    document.querySelectorAll('.rule-min').forEach((input, i) => {
        currentValidationRules[i].minValue = parseFloat(input.value) || null;
    });
    document.querySelectorAll('.rule-max').forEach((input, i) => {
        currentValidationRules[i].maxValue = parseFloat(input.value) || null;
    });
    document.querySelectorAll('.rule-allowed').forEach((input, i) => {
        currentValidationRules[i].allowedValues = input.value;
    });
    currentValidationRules.forEach(r => r.tableId = currentTableId);

    // 引用了表但没选列的规则没有意义，保存前拦截
    const badRef = currentValidationRules.find(r => r.refTableId && !r.refColumnName);
    if (badRef) {
        showToast(tt('列「{col}」选择了引用表，但还没选引用列', { col: badRef.columnName }), 'error');
        return;
    }

    saveValidationRulesApi(currentValidationRules)
        .then(result => {
            showToast('✅ ' + (result.message || tt('保存成功')), 'success');
            closeValidationModal();
            // 引用下拉的数据源已变化，重取引用值并刷新表格建议列表
            if (typeof loadRefValues === 'function') loadRefValues().then(() => renderTable());
        })
        .catch(err => showToast('❌ ' + tt('保存失败：{msg}', { msg: err.message }), 'error'));
}
