// ================================================================
// 数据校验规则
// 依赖：state.js（currentTableId 等）、utils.js、api.js
// ================================================================

function openValidationModal() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
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
                        allowedValues: ''
                    });
                }
            }
            renderValidationRuleList();
            document.getElementById('validationModal').style.display = 'flex';
        })
        .catch(err => showToast('❌ 加载校验规则失败：' + err.message, 'error'));
}

function closeValidationModal() {
    document.getElementById('validationModal').style.display = 'none';
}

function renderValidationRuleList() {
    const container = document.getElementById('validationRuleList');
    if (!container) return;

    let html = '<table class="rule-table"><thead><tr>';
    html += '<th>列名</th>';
    html += '<th style="text-align:center; width:60px;">必填</th>';
    html += '<th style="width:100px;">类型</th>';
    html += '<th>限制</th>';
    html += '</tr></thead><tbody>';

    currentValidationRules.forEach((rule, i) => {
        html += '<tr>';
        html += `<td><strong>${escapeHtml(rule.columnName)}</strong></td>`;
        html += `<td class="cell-center"><input type="checkbox" class="rule-required" data-index="${i}" ${rule.required ? 'checked' : ''} /></td>`;
        html += `<td><select class="select-sm rule-datatype" style="width:100%;" data-index="${i}">`;
        html += `<option value="text"${rule.dataType === 'text' ? ' selected' : ''}>文本</option>`;
        html += `<option value="number"${rule.dataType === 'number' ? ' selected' : ''}>数字</option>`;
        html += `<option value="date"${rule.dataType === 'date' ? ' selected' : ''}>日期</option>`;
        html += `<option value="email"${rule.dataType === 'email' ? ' selected' : ''}>邮箱</option>`;
        html += '</select></td>';
        html += '<td><div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">';
        html += `<input type="number" class="input-sm rule-min" style="width:70px;" placeholder="最小值" value="${rule.minValue || ''}" data-index="${i}" />`;
        html += '<span style="color:var(--text-3);">~</span>';
        html += `<input type="number" class="input-sm rule-max" style="width:70px;" placeholder="最大值" value="${rule.maxValue || ''}" data-index="${i}" />`;
        html += `<input type="text" class="input-sm rule-allowed" style="flex:1; min-width:120px; width:auto;" placeholder="允许值(逗号分隔)" value="${rule.allowedValues || ''}" data-index="${i}" />`;
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
}

function addValidationRule() {
    currentValidationRules.push({
        tableId: currentTableId,
        columnName: '新列_' + (currentValidationRules.length + 1),
        required: false,
        dataType: 'text',
        minValue: null,
        maxValue: null,
        maxLength: null,
        allowedValues: ''
    });
    renderValidationRuleList();
}

function saveValidationRules() {
    document.querySelectorAll('.rule-required').forEach((input, i) => {
        currentValidationRules[i].required = input.checked;
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

    saveValidationRulesApi(currentValidationRules)
        .then(result => {
            showToast('✅ ' + (result.message || '保存成功'), 'success');
            closeValidationModal();
        })
        .catch(err => showToast('❌ 保存失败：' + err.message, 'error'));
}
