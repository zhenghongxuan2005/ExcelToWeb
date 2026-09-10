// ================================================================
// 条件格式规则（颜色规则）
// 依赖：state.js（currentHeaders / colorRulesCache 等）、utils.js、api.js、render.js
// ================================================================

// ===== 条件格式规则 =====

/** 可选列：优先只列出数值列（颜色规则只对数值有意义），没有数值列时退回全部列 */
function getColorRuleColumns() {
    const numeric = currentHeaders.filter(isNumericColumn);
    return numeric.length > 0 ? numeric : currentHeaders;
}

/** 用当前表格的真实列名重建下拉，取代原先写死的「数量 / 单价(元)」 */
function populateRuleColumnSelect() {
    const select = document.getElementById('ruleColumnSelect');
    if (!select) return;

    const columns = getColorRuleColumns();
    if (columns.length === 0) {
        select.innerHTML = '';
        return;
    }
    if (!columns.includes(ruleColumnName)) ruleColumnName = columns[0];

    let html = '';
    for (const column of columns) {
        const selected = column === ruleColumnName ? ' selected' : '';
        html += `<option value="${escapeHtml(column)}"${selected}>${escapeHtml(column)}</option>`;
    }
    select.innerHTML = html;
}

/** 把后端返回的规则规整成前端统一结构，避免 null / 字符串参与比较 */
function normalizeRules(rules) {
    return (rules || []).map(rule => ({
        columnName: rule.columnName,
        minValue: rule.minValue === null || rule.minValue === undefined ? 0 : Number(rule.minValue),
        maxValue: rule.maxValue === null || rule.maxValue === undefined ? null : Number(rule.maxValue),
        colorCode: rule.colorCode || '#1a5cff'
    }));
}

function loadRulesForColumn(columnName) {
    return fetchColorRules(columnName)
        .then(rules => {
            currentRules = normalizeRules(rules);
            return currentRules;
        })
        .catch(err => {
            showToast('❌ 加载规则失败：' + err.message, 'error');
            currentRules = [];
            return currentRules;
        });
}

function openRuleModal() {
    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }
    if (getColorRuleColumns().length === 0) {
        showToast('当前表格没有可用的列', 'error');
        return;
    }

    populateRuleColumnSelect();
    const select = document.getElementById('ruleColumnSelect');
    if (select && select.value) ruleColumnName = select.value;

    setStatus('加载规则中...');
    loadRulesForColumn(ruleColumnName).then(() => {
        renderRuleList();
        document.getElementById('ruleModal').style.display = 'flex';
        setStatus('就绪');
    });
}

/** 切换「应用列」时按新列重新拉取规则，修正原先切换后仍显示旧列规则的问题 */
function handleRuleColumnChange() {
    const select = document.getElementById('ruleColumnSelect');
    if (!select) return;
    ruleColumnName = select.value;
    loadRulesForColumn(ruleColumnName).then(renderRuleList);
}

function closeRuleModal() {
    document.getElementById('ruleModal').style.display = 'none';
}

function renderRuleList() {
    const container = document.getElementById('ruleList');
    if (!container) return;

    if (currentRules.length === 0) {
        container.innerHTML = '<div class="muted-center">暂无规则，点击下方"添加规则"开始设置</div>';
        return;
    }

    let html = '<table class="rule-table"><thead><tr>';
    html += '<th>优先级</th>';
    html += '<th>最小值</th>';
    html += '<th>最大值</th>';
    html += '<th>颜色</th>';
    html += '<th style="text-align:center;">上移/下移</th>';
    html += '<th style="text-align:center; width:40px;"></th>';
    html += '</tr></thead><tbody>';

    currentRules.forEach((rule, i) => {
        const maxValue = rule.maxValue !== null && rule.maxValue !== undefined ? rule.maxValue : '';
        html += '<tr>';
        html += `<td class="cell-center row-index">${i + 1}</td>`;
        html += `<td><input type="number" step="any" class="input-sm rule-min" value="${rule.minValue}" data-index="${i}" /></td>`;
        html += `<td><input type="number" step="any" class="input-sm rule-max" value="${maxValue}" placeholder="以上" data-index="${i}" /></td>`;
        html += `<td><input type="color" class="color-input rule-color" value="${escapeHtml(rule.colorCode)}" data-index="${i}" /></td>`;
        html += '<td class="cell-center">';
        if (i > 0) html += `<button class="icon-btn" title="上移" onclick="moveRuleUp(${i})">↑</button>`;
        if (i < currentRules.length - 1) html += `<button class="icon-btn" title="下移" onclick="moveRuleDown(${i})">↓</button>`;
        html += '</td>';
        html += `<td class="cell-center"><button class="icon-btn icon-btn-danger" title="删除规则" onclick="removeRule(${i})">✕</button></td>`;
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

/** 把弹窗里输入框的当前值同步回 currentRules（之前 class 不匹配导致这些值永远读不到） */
function collectRulesFromInputs() {
    document.querySelectorAll('.rule-min').forEach((input, i) => {
        if (!currentRules[i]) return;
        const val = parseFloat(input.value);
        currentRules[i].minValue = isNaN(val) ? 0 : val;
    });
    document.querySelectorAll('.rule-max').forEach((input, i) => {
        if (!currentRules[i]) return;
        const val = parseFloat(input.value);
        currentRules[i].maxValue = isNaN(val) ? null : val;
    });
    document.querySelectorAll('.rule-color').forEach((input, i) => {
        if (!currentRules[i]) return;
        currentRules[i].colorCode = input.value;
    });
    currentRules.forEach(rule => { rule.columnName = ruleColumnName; });
    return currentRules;
}

function saveRules() {
    const rules = collectRulesFromInputs();

    const invalid = rules.find(r => r.maxValue !== null && r.maxValue < r.minValue);
    if (invalid) {
        showToast(`⚠️ 区间不合法：${invalid.minValue} ~ ${invalid.maxValue}（最大值不能小于最小值）`, 'error');
        return;
    }

    saveColorRules(rules)
        .then(result => {
            showToast('✅ ' + (result.message || '保存成功'), 'success');
            closeRuleModal();
            colorRulesCache = rules.slice();
            renderTable();
        })
        .catch(err => showToast('❌ 保存失败：' + err.message, 'error'));
}
