// ================================================================
// 查找 / 替换（Ctrl+H）
// ----------------------------------------------------------------
// 语义：查找范围是全表的所有列（与 Excel 的「查找」一致），
//       不受全局搜索与分页影响；「查找下一个」会自动翻到所在页并选中该格。
// 安全性：替换文本一律按纯文本处理（正则片段已转义，不使用 eval）。
// 依赖：state.js、utils.js（showToast / escapeHtml）、history.js（pushHistory）、
//       view.js（buildDisplayRows / getVisibleHeaders）、
//       keyboard.js（isCellInput / findCellInRow）、render.js（renderTable）
// ================================================================

/** 上轮「查找下一个」算出的命中位置：[{ rowIndex, key }] */
let findMatches = [];
let findCursor = -1;
let findCaseSensitive = false;

// ================================================================
// 匹配计算
// ================================================================

function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 读取弹窗里的输入（同时同步「区分大小写」状态） */
function readFindInputs() {
    const kwEl = document.getElementById('findKeyword');
    const repEl = document.getElementById('findReplace');
    const csEl = document.getElementById('findCaseSensitive');
    findCaseSensitive = !!(csEl && csEl.checked);
    return {
        kw: kwEl ? kwEl.value : '',
        rep: repEl ? repEl.value : ''
    };
}

/** 纯文本替换：区分大小写时直接切分，否则用转义后的正则做全局忽略大小写替换 */
function replaceInText(text, kw, rep) {
    if (!kw) return text;
    if (findCaseSensitive) return String(text).split(kw).join(rep);
    return String(text).replace(new RegExp(escapeRegExp(kw), 'gi'), rep);
}

/** 单元格是否命中关键词 */
function cellContains(text, kw) {
    if (text === undefined || text === null) return false;
    const s = String(text);
    if (findCaseSensitive) return s.indexOf(kw) !== -1;
    return s.toLowerCase().indexOf(kw.toLowerCase()) !== -1;
}

/** 扫描全表，收集所有命中单元格 */
function collectFindMatches(kw) {
    const out = [];
    if (!kw) return out;

    for (let i = 0; i < currentRows.length; i++) {
        const row = currentRows[i];
        if (!row) continue;
        for (const key of currentHeaders) {
            if (cellContains(row[key], kw)) out.push({ rowIndex: i, key: key });
        }
    }
    return out;
}

// ================================================================
// 弹窗
// ================================================================

function openFindModal() {
    const modal = document.getElementById('findModal');
    if (!modal) return;

    if (currentTableId === null) {
        showToast('请先上传一个 Excel 文件', 'error');
        return;
    }

    // 若搜索框里已有词，顺手带过来，省一次输入
    const kwEl = document.getElementById('findKeyword');
    if (kwEl && !kwEl.value && searchKeyword) kwEl.value = searchKeyword;

    modal.style.display = 'flex';
    if (kwEl) {
        kwEl.focus();
        kwEl.select();
    }
    findCursor = -1;
    updateFindStatus();
}

function closeFindModal() {
    const modal = document.getElementById('findModal');
    if (modal) modal.style.display = 'none';
}

function updateFindStatus() {
    const el = document.getElementById('findStatus');
    if (!el) return;

    const { kw } = readFindInputs();
    if (!kw) {
        el.textContent = '输入要查找的内容';
        el.classList.remove('is-empty');
        return;
    }

    const matches = collectFindMatches(kw);
    if (matches.length === 0) {
        el.textContent = '未找到匹配项';
        el.classList.add('is-empty');
        return;
    }

    el.classList.remove('is-empty');
    el.textContent = findCursor >= 0 && findCursor < matches.length
        ? `共 ${matches.length} 处，当前第 ${findCursor + 1} 处`
        : `找到 ${matches.length} 处`;
}

// ================================================================
// 定位 / 替换
// ================================================================

/** 标记当前命中的单元格，便于一眼看到落在哪一格 */
function markFindHit(input) {
    document.querySelectorAll('.editable-cell.find-hit').forEach(c => c.classList.remove('find-hit'));
    const cell = input.closest('.editable-cell');
    if (cell) cell.classList.add('find-hit');
}

/** 跳到某个命中位置：先翻到它所在的页，再聚焦并选中该单元格 */
function jumpToMatch(match) {
    const row = currentRows[match.rowIndex];
    const pos = buildDisplayRows().indexOf(row);
    if (pos < 0) return false;   // 被全局搜索或列筛选过滤掉了

    if (pageSize > 0) {
        const page = Math.floor(pos / pageSize) + 1;
        if (page !== currentPage) {
            currentPage = page;
            renderTable();
        }
    }

    const table = currentTableEl();
    if (!table) return false;

    const posInPage = pageSize > 0 ? pos % pageSize : pos;
    const tr = table.querySelectorAll('tbody tr')[posInPage];
    const input = findCellInRow(tr, match.key);
    if (!input) return false;

    input.focus();
    input.select();
    markFindHit(input);
    return true;
}

/** 查找下一个（循环） */
function findNext() {
    const { kw } = readFindInputs();
    if (!kw) {
        showToast('请输入要查找的内容', 'info');
        return;
    }

    findMatches = collectFindMatches(kw);
    if (findMatches.length === 0) {
        findCursor = -1;
        updateFindStatus();
        showToast('未找到匹配项', 'info');
        return;
    }

    findCursor = (findCursor + 1) % findMatches.length;
    const ok = jumpToMatch(findMatches[findCursor]);
    updateFindStatus();

    if (!ok) {
        showToast('该匹配项被当前筛选条件隐藏了', 'info');
    }
}

/** 替换当前定位到的单元格 */
function replaceCurrent() {
    const { kw, rep } = readFindInputs();
    if (!kw) {
        showToast('请输入要查找的内容', 'info');
        return;
    }

    const el = document.activeElement;
    if (!isCellInput(el)) {
        findNext();
        showToast('已定位到第一处，再点一次「替换」即可替换', 'info');
        return;
    }

    const idx = parseInt(el.dataset.index);
    const key = el.dataset.key;
    if (isNaN(idx) || !currentRows[idx] || key === undefined) {
        showToast('请先点「查找下一个」定位到要替换的单元格', 'info');
        return;
    }

    const before = currentRows[idx][key];
    const after = replaceInText(before === undefined || before === null ? '' : before, kw, rep);
    if (String(before) === after) {
        findNext();
        return;
    }

    pushHistory();
    currentRows[idx][key] = after;
    renderTable();
    setStatus('已替换 1 处');
    findNext();
}

/** 全部替换（先确认处数，替换后可用 Ctrl+Z 撤销） */
function replaceAll() {
    const { kw, rep } = readFindInputs();
    if (!kw) {
        showToast('请输入要查找的内容', 'info');
        return;
    }

    const matches = collectFindMatches(kw);
    if (matches.length === 0) {
        showToast('未找到匹配项', 'info');
        return;
    }

    if (!confirm(`将替换 ${matches.length} 处，确定继续吗？`)) return;

    pushHistory();

    let changed = 0;
    for (const row of currentRows) {
        if (!row) continue;
        for (const key of currentHeaders) {
            const before = row[key];
            if (before === undefined || before === null) continue;
            const after = replaceInText(before, kw, rep);
            if (after !== String(before)) {
                row[key] = after;
                changed++;
            }
        }
    }

    findMatches = [];
    findCursor = -1;
    renderTable();
    updateFindStatus();

    showToast(`✅ 已替换 ${changed} 处`, 'success');
    setStatus(`已替换 ${changed} 处`);
}
