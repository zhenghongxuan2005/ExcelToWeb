// ================================================================
// 列管理面板：列的增 / 删 / 改名 / 移动（一次保存，服务端事务完成）
// ----------------------------------------------------------------
// 数据模型：columnDraft = [{ name: 当前名, original: 打开面板时的旧名 }]
//   original === ''  表示本次新增的列
//   name !== original 且 original 非空  => 保存时生成一条 rename
//   draft 里不存在而 original 里存在的列 => 删除（含数据与相关规则）
// 依赖：state.js、api.js（updateHeaders）、history.js（resetHistory）、
//       tables.js（refreshData）、utils.js（showToast / escapeHtml）
// ================================================================

let columnDraft = [];

function openColumnModal() {
    if (!currentTableId) {
        showToast('请先选择一个表格', 'error');
        return;
    }
    if (currentHeaders.length === 0) {
        showToast('当前表格没有列', 'info');
        return;
    }
    columnDraft = currentHeaders.map(h => ({ name: h, original: h, expr: formulaOf(h) }));
    renderColumnDraft();
    document.getElementById('columnModal').style.display = 'flex';
}

function closeColumnModal() {
    document.getElementById('columnModal').style.display = 'none';
}

function renderColumnDraft() {
    const list = document.getElementById('columnDraftList');
    if (!list) return;
    if (columnDraft.length === 0) {
        list.innerHTML = '<p class="modal-sub">暂无列，点击下方「添加列」开始</p>';
        return;
    }
    list.innerHTML = columnDraft.map((c, i) => {
        const isNew = !c.original;
        const renamed = c.original && c.name !== c.original;
        const tag = isNew ? '<span class="col-tag col-tag-new">新</span>'
            : renamed ? `<span class="col-tag col-tag-rename" title="${escapeHtml(c.original)}">${escapeHtml(c.original)}</span>`
            : '';
        // 有公式的列在列名后标一个 fx，并把公式原文显示出来 ——
        // 否则用户只会看到一列怎么改都改不动的格子，不知道是被公式接管了
        const fxTag = (c.expr || '').trim()
            ? `<span class="col-tag col-tag-fx" title="公式：${escapeHtml(c.expr)}">fx</span>`
            : '';
        return `<div class="col-draft-row">
            <span class="col-draft-index">${i + 1}</span>
            <input type="text" class="col-draft-input" value="${escapeHtml(c.name)}"
                   placeholder="列名" oninput="onColumnDraftInput(${i}, this.value)">
            ${tag}${fxTag}
            <span class="col-draft-ops">
                <button type="button" class="col-op-btn" title="设置计算列公式" onclick="openFormulaEditor(${i})">fx</button>
                <button type="button" class="col-op-btn" title="上移" onclick="moveColumnRow(${i}, -1)">↑</button>
                <button type="button" class="col-op-btn" title="下移" onclick="moveColumnRow(${i}, 1)">↓</button>
                <button type="button" class="col-op-btn col-op-del" title="删除列" onclick="removeColumnRow(${i})">×</button>
            </span>
        </div>`;
    }).join('');
}

function onColumnDraftInput(i, value) {
    if (columnDraft[i]) columnDraft[i].name = value.trim();
}

// ----- 列草稿的对外读写口子 -----
// 公式编辑弹窗住在 computed-column.js，它不该直接摸 columnDraft 这个内部数组
// （CODE_STANDARDS §1：不许直接改他模块的内部变量），一律从这几个函数进出。

/** 列草稿的只读快照（公式编辑器用它列出可引用的列） */
function columnDraftSnapshot() {
    return columnDraft.map(c => ({ name: (c.name || '').trim(), expr: (c.expr || '').trim() }));
}

function columnDraftName(i) {
    const c = columnDraft[i];
    return c ? (c.name || '').trim() : '';
}

function setColumnDraftExpr(i, expr) {
    const c = columnDraft[i];
    if (c) c.expr = (expr || '').trim();
}

function addColumnRow() {
    columnDraft.push({ name: '', original: '', expr: '' });
    renderColumnDraft();
    // 聚焦新输入框，方便直接输入
    const inputs = document.querySelectorAll('#columnDraftList .col-draft-input');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
}

function removeColumnRow(i) {
    const c = columnDraft[i];
    if (!c) return;
    if (c.original && !confirm(`删除列「${c.original}」将同时删除该列的所有数据和相关规则，确定吗？`)) return;
    columnDraft.splice(i, 1);
    renderColumnDraft();
}

function moveColumnRow(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= columnDraft.length) return;
    const tmp = columnDraft[i];
    columnDraft[i] = columnDraft[j];
    columnDraft[j] = tmp;
    renderColumnDraft();
}

/**
 * 保存列结构：
 * 1) 前端先做基础校验（空名 / 重名）；
 * 2) 计算 renames（旧名 -> 新名），新增列直接进 headers；
 * 3) 服务端 PUT /excel/headers 在事务里完成数据迁移与规则清理；
 * 4) 成功后清理视图缓存（隐藏列 / 列宽里失效的键）并 refreshData。
 */
function saveColumnStructure() {
    // 收集输入框中的最新值（防止 oninput 未触发）
    document.querySelectorAll('#columnDraftList .col-draft-input').forEach((input, i) => {
        if (columnDraft[i]) columnDraft[i].name = input.value.trim();
    });

    if (columnDraft.length === 0) {
        showToast('至少保留一列', 'error');
        return;
    }

    const names = [];
    for (const c of columnDraft) {
        c.name = (c.name || '').trim();
        if (!c.name) {
            showToast('列名不能为空', 'error');
            return;
        }
        if (c.name.length > 100) {
            showToast(`列名「${c.name}」超过 100 字符`, 'error');
            return;
        }
        if (names.includes(c.name)) {
            showToast(`列名「${c.name}」重复`, 'error');
            return;
        }
        names.push(c.name);
    }

    const renames = columnDraft
        .filter(c => c.original && c.name !== c.original)
        .map(c => ({ oldName: c.original, newName: c.name }));

    const added = columnDraft.filter(c => !c.original).length;
    const dropped = currentHeaders.filter(h => !columnDraft.some(c => c.original === h)).length;
    const formulaChanged = columnDraft.some(c => (c.expr || '').trim() !== formulaOf(c.original || c.name));

    if (added === 0 && dropped === 0 && renames.length === 0 && !formulaChanged &&
        columnDraft.length === currentHeaders.length &&
        columnDraft.every((c, i) => c.name === currentHeaders[i])) {
        showToast('列结构没有变化', 'info');
        return;
    }

    const warnParts = [];
    if (added) warnParts.push(`新增 ${added} 列`);
    if (dropped) warnParts.push(`删除 ${dropped} 列（数据与规则一并清除）`);
    if (renames.length) warnParts.push(`重命名 ${renames.length} 列`);
    if (formulaChanged) warnParts.push('更新计算列公式');
    if (dropped > 0 && !confirm(`确认执行：${warnParts.join('，')}？`)) return;

    setStatus('更新列结构中...');
    updateHeaders(currentTableId, names, renames)
        .then(result => {
            // 公式必须等列结构落地之后再提交：新增的列这时才在服务端存在，
            // 公式的引用校验才有列可查（消息里补一句，避免用户以为公式没被处理）
            return applyColumnFormulas(columnDraft).then(() => result);
        })
        .then(result => {
            closeColumnModal();
            showToast('✅ ' + (result.message || '列结构已更新'), 'success');
            // 隐藏列 / 列宽里已失效的键清理掉
            const nameSet = new Set(names);
            hiddenColumns = hiddenColumns.filter(h => nameSet.has(h));
            for (const k of Object.keys(columnWidths)) {
                if (!nameSet.has(k)) delete columnWidths[k];
            }
            refreshData();
        })
        .catch(err => showToast('❌ 更新失败：' + err.message, 'error'));
}
