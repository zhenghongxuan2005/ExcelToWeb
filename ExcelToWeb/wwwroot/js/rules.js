// ================================================================
// 条件格式规则与数据校验规则
// ================================================================

// ===== 条件格式规则 =====

function openRuleModal() {
    const select = document.getElementById('ruleColumnSelect');
    if (select) ruleColumnName = select.value;

    fetchColorRules(ruleColumnName)
        .then(rules => {
            currentRules = rules || [];
            renderRuleList();
            document.getElementById('ruleModal').style.display = 'flex';
        })
        .catch(err => {
            showToast('❌ 加载规则失败：' + err.message, 'error');
            currentRules = [];
            renderRuleList();
            document.getElementById('ruleModal').style.display = 'flex';
        });
}

function closeRuleModal() {
    document.getElementById('ruleModal').style.display = 'none';
}

function renderRuleList() {
    const container = document.getElementById('ruleList');
    if (!container) return;

    if (currentRules.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px 0; color:#9aabbf; font-size:14px;">📋 暂无规则，点击下方 "添加规则" 开始设置</div>';
        return;
    }

    let html = '<table class="rule-table"><thead><tr>';
    html += '<th style="padding:8px 12px; text-align:left;">优先级</th>';
    html += '<th style="padding:8px 12px; text-align:left;">最小值</th>';
    html += '<th style="padding:8px 12px; text-align:left;">最大值</th>';
    html += '<th style="padding:8px 12px; text-align:left;">颜色</th>';
    html += '<th style="padding:8px 12px; text-align:center;">上移/下移</th>';
    html += '<th style="padding:8px 12px; text-align:center; width:40px;"></th>';
    html += '</tr></thead><tbody>';

    currentRules.forEach((rule, i) => {
        html += '<tr>';
        html += `<td style="padding:6px 8px; text-align:center; color:#6b7b93; font-weight:500;">${i + 1}</td>`;
        html += `<td style="padding:6px 8px;"><input type="number" class="rule-min" value="${rule.minValue}" data-index="${i}" style="width:80px; padding:4px 8px; border:1px solid #dce3ed; border-radius:4px; font-size:13px;" /></td>`;
        html += `<td style="padding:6px 8px;"><input type="number" class="rule-max" value="${rule.maxValue !== null && rule.maxValue !== undefined ? rule.maxValue : ''}" data-index="${i}" style="width:80px; padding:4px 8px; border:1px solid #dce3ed; border-radius:4px; font-size:13px;" /></td>`;
        html += `<td style="padding:6px 8px;"><input type="color" class="rule-color" value="${rule.colorCode}" data-index="${i}" style="width:40px; height:32px; border:none; cursor:pointer;" /></td>`;
        html += '<td style="padding:6px 8px; text-align:center;">';
        if (i > 0) html += `<button onclick="moveRuleUp(${i})" style="border:none; background:transparent; cursor:pointer; color:#3b82f6; font-size:16px;">↑</button>`;
        if (i < currentRules.length - 1) html += `<button onclick="moveRuleDown(${i})" style="border:none; background:transparent; cursor:pointer; color:#3b82f6; font-size:16px;">↓</button>`;
        html += '</td>';
        html += `<td style="padding:6px 8px; text-align:center;"><button onclick="removeRule(${i})" style="border:none; background:transparent; color:#dc2626; cursor:pointer; font-size:16px;">✕</button></td>`;
        html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    container.querySelectorAll('.rule-min').forEach(input => {
        input.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            currentRules[idx].minValue = parseFloat(e.target.value) || 0;
        });
    });
    container.querySelectorAll('.rule-max').forEach(input => {
        input.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            const val = parseFloat(e.target.value);
            currentRules[idx].maxValue = isNaN(val) ? null : val;
        });
    });
    container.querySelectorAll('.rule-color').forEach(input => {
        input.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            currentRules[idx].colorCode = e.target.value;
        });
    });
}

function moveRuleUp(index) {
    if (index <= 0) return;
    [currentRules[index - 1], currentRules[index]] = [currentRules[index], currentRules[index - 1]];
    renderRuleList();
}

function moveRuleDown(index) {
    if (index >= currentRules.length - 1) return;
    [currentRules[index + 1], currentRules[index]] = [currentRules[index], currentRules[index + 1]];
    renderRuleList();
}

function addRuleRow() {
    currentRules.push({
        columnName: ruleColumnName,
        minValue: 0,
        maxValue: null,
        colorCode: '#000000'
    });
    renderRuleList();
}

function removeRule(index) {
    currentRules.splice(index, 1);
    renderRuleList();
}

function saveRules() {
    document.querySelectorAll('.rule-min').forEach((input, i) => {
        currentRules[i].minValue = parseFloat(input.value) || 0;
    });
    document.querySelectorAll('.rule-max').forEach((input, i) => {
        const val = parseFloat(input.value);
        currentRules[i].maxValue = isNaN(val) ? null : val;
    });
    document.querySelectorAll('.rule-color').forEach((input, i) => {
        currentRules[i].colorCode = input.value;
    });
    currentRules.forEach(r => r.columnName = ruleColumnName);

    saveColorRules(currentRules)
        .then(result => {
            showToast('✅ ' + (result.message || '保存成功'), 'success');
            closeRuleModal();
            colorRulesCache = currentRules.slice();
            renderTable();
        })
        .catch(err => showToast('❌ 保存失败：' + err.message, 'error'));
}

// ===== 数据校验规则 =====

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
    html += '<th style="padding:8px 12px; text-align:left;">列名</th>';
    html += '<th style="padding:8px 12px; text-align:center; width:60px;">必填</th>';
    html += '<th style="padding:8px 12px; text-align:left; width:100px;">类型</th>';
    html += '<th style="padding:8px 12px; text-align:left;">限制</th>';
    html += '</tr></thead><tbody>';

    currentValidationRules.forEach((rule, i) => {
        html += '<tr>';
        html += `<td style="padding:6px 8px;"><strong>${escapeHtml(rule.columnName)}</strong></td>`;
        html += `<td style="padding:6px 8px; text-align:center;"><input type="checkbox" class="rule-required" data-index="${i}" ${rule.required ? 'checked' : ''} /></td>`;
        html += `<td style="padding:6px 8px;"><select class="rule-datatype" data-index="${i}" style="width:100%; padding:4px 6px; border:1px solid #dce3ed; border-radius:4px; font-size:13px;">`;
        html += `<option value="text"${rule.dataType === 'text' ? ' selected' : ''}>文本</option>`;
        html += `<option value="number"${rule.dataType === 'number' ? ' selected' : ''}>数字</option>`;
        html += `<option value="date"${rule.dataType === 'date' ? ' selected' : ''}>日期</option>`;
        html += `<option value="email"${rule.dataType === 'email' ? ' selected' : ''}>邮箱</option>`;
        html += '</select></td>';
        html += '<td style="padding:6px 8px;"><div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">';
        html += `<input type="number" class="rule-min" placeholder="最小值" value="${rule.minValue || ''}" data-index="${i}" style="width:70px; padding:4px 6px; border:1px solid #dce3ed; border-radius:4px; font-size:12px;" />`;
        html += '<span style="color:#6b7b93;">~</span>';
        html += `<input type="number" class="rule-max" placeholder="最大值" value="${rule.maxValue || ''}" data-index="${i}" style="width:70px; padding:4px 6px; border:1px solid #dce3ed; border-radius:4px; font-size:12px;" />`;
        html += `<input type="text" class="rule-allowed" placeholder="允许值(逗号分隔)" value="${rule.allowedValues || ''}" data-index="${i}" style="flex:1; min-width:120px; padding:4px 6px; border:1px solid #dce3ed; border-radius:4px; font-size:12px;" />`;
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

// ===== 带校验的上传 =====

function uploadWithValidation() {
    const fileInput = document.getElementById('fileInputValidate');
    if (!fileInput) {
        showToast('请先选择文件', 'info');
        return;
    }
    const file = fileInput.files[0];
    if (!file) {
        showToast('请选择文件', 'info');
        return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
        showToast('请上传 .xlsx 或 .xls 格式的文件', 'error');
        fileInput.value = '';
        return;
    }

    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件或选择一个表格', 'error');
        fileInput.value = '';
        return;
    }

    setStatus('校验并上传中...');
    uploadWithValidationApi(file, currentTableId)
        .then(vr => {
            const msg = `校验完成：总行数 ${vr.totalRows}，成功 ${vr.successRows} 行，错误 ${vr.errorRows} 行`;
            if (vr.errorRows > 0) {
                showToast('⚠️ ' + msg + '\n\n错误详情：\n' + vr.errors.join('\n'), 'error');
            } else {
                showToast('✅ ' + msg, 'success');
                currentRows = vr.validRows;
                renderTable();
                setStatus(`已加载: ${currentTableId} (${currentRows.length}行)`);
            }
            fileInput.value = '';
        })
        .catch(err => {
            showToast('❌ 上传失败：' + err.message, 'error');
            setStatus('上传失败');
            fileInput.value = '';
            console.error('上传错误:', err);
        });
}
