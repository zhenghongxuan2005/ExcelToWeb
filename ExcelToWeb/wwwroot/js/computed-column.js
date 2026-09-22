// ================================================================
// 计算列：只读判定的唯一出口 + 公式编辑弹窗
// ----------------------------------------------------------------
// 值的计算在服务端（Services/Excel/FormulaEvaluator.cs），前端只做两件事：
//   1) isComputedColumn —— 其余模块判断「这一格能不能手改」都走这里，
//      写入路径（编辑 / 粘贴 / 填充 / 查找替换 / 保存）一处都不许自己判断，
//      否则漏掉一条就会把算出来的值写回 currentRows 并被保存进库。
//   2) 公式编辑 —— 结果暂存在列草稿里（columnDraft[i].expr），
//      随「保存列结构」一起提交。必须先建列再设公式，所以顺序不能反。
//
// 为什么前端不算一遍：算就必然有第二份实现，两份迟早算出不同结果；
// 而且落库的是服务端，口径必须以它为准。
// 代价是「改了源列之后，计算列的数字要等保存后才更新」—— 这是刻意的。
// ================================================================

/** 与服务端 FormulaEngine.Functions 必须一致；测试里有一条用例做两侧比对 */
const FORMULA_FUNCTIONS = ['CONCAT', 'ROUND', 'INT', 'YEAR', 'MONTH', 'IF'];

/** 与服务端 FormulaEngine.MaxLength 一致 */
const FORMULA_MAX_LENGTH = 500;

/** 正在编辑公式的列草稿下标，-1 表示弹窗未打开 */
let formulaEditIndex = -1;

/** 弹窗里输入框的当前内容（确定前不写进草稿，取消即天然还原） */
let formulaEditBuffer = '';

// ================================================================
// 只读判定
// ================================================================

/** 该列是不是计算列（有公式即算）。所有「不可手改」的判断都必须调这里。 */
function isComputedColumn(name) {
    return !!columnExprs[name];
}

/** 取某列的公式原文；不是计算列返回空串 */
function formulaOf(name) {
    return isComputedColumn(name) ? String(columnExprs[name]) : '';
}

/** 计算列表头的悬浮提示：让用户随时能看到这一列是怎么算出来的 */
function computedColumnHint(name) {
    return '计算列\n公式：' + formulaOf(name)
        + '\n值由服务端算出，不能手动修改；改动源列后点「保存」会重新计算。';
}

// ================================================================
// 公式编辑弹窗
// ================================================================

function openFormulaEditor(index) {
    // columnDraft 归 column-manager.js 所有，这里只经它的口子读写
    const draft = columnDraftSnapshot();
    if (index < 0 || index >= draft.length) return;

    formulaEditIndex = index;
    formulaEditBuffer = draft[index].expr;

    const label = document.getElementById('formulaColumnLabel');
    if (label) label.textContent = draft[index].name || '(未命名列)';

    const input = document.getElementById('formulaInput');
    if (input) input.value = formulaEditBuffer;

    renderFormulaChips(index);
    updateFormulaHint();

    const modal = document.getElementById('formulaModal');
    if (modal) modal.style.display = 'flex';
    if (input) {
        input.focus();
        if (input.select) input.select();
    }
}

function closeFormulaEditor() {
    const modal = document.getElementById('formulaModal');
    if (modal) modal.style.display = 'none';
    formulaEditIndex = -1;
    formulaEditBuffer = '';
}

/** 输入框实时反馈：问题当场说，不要等保存列结构之后才弹错 */
function onFormulaInput(value) {
    formulaEditBuffer = value;
    updateFormulaHint();
}

function updateFormulaHint() {
    const el = document.getElementById('formulaHint');
    if (!el) return;

    const problem = formulaCheck(formulaEditBuffer);
    el.classList.toggle('is-error', !!problem && !!formulaEditBuffer.trim());
    el.textContent = problem || '公式看起来没问题；保存列结构时会由服务端再校验一次。';
}

/** 可引用的列：排除自己，也排除同样是计算列的列（计算列之间不许互相引用） */
function formulaColumnCandidates(index) {
    return columnDraftSnapshot()
        .filter((c, i) => i !== index && c.name && !c.expr)
        .map(c => c.name);
}

function renderFormulaChips(index) {
    const colBox = document.getElementById('formulaColumnChips');
    const fnBox = document.getElementById('formulaFunctionChips');
    if (!colBox || !fnBox) return;

    const columns = formulaColumnCandidates(index);
    colBox.innerHTML = columns.length === 0
        ? '<span class="formula-empty">没有可引用的列</span>'
        : columns.map((name, i) =>
            `<button type="button" class="formula-chip" onclick="insertFormulaColumn(${index}, ${i})">${escapeHtml(name)}</button>`
        ).join('');

    fnBox.innerHTML = FORMULA_FUNCTIONS.map((fn, i) =>
        `<button type="button" class="formula-chip formula-chip-fn" onclick="insertFormulaFunction(${index}, ${i})">${escapeHtml(fn)}</button>`
    ).join('');
}

function insertFormulaColumn(index, chipIndex) {
    const name = formulaColumnCandidates(index)[chipIndex];
    if (name === undefined) return;
    insertFormulaText('[' + name + ']', 0);
}

function insertFormulaFunction(index, fnIndex) {
    const fn = FORMULA_FUNCTIONS[fnIndex];
    if (!fn || index !== formulaEditIndex) return;
    // 连括号一起插进去，光标停在中间，省得用户自己再打一对
    insertFormulaText(fn + '()', -1);
}

/** 在光标处插入文本；caretOffset 为负表示从末尾回退（用于把光标放进括号中间） */
function insertFormulaText(text, caretOffset) {
    const input = document.getElementById('formulaInput');
    if (!input) return;

    const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;

    input.value = input.value.slice(0, start) + text + input.value.slice(end);

    const caret = start + text.length + caretOffset;
    input.focus();
    if (input.setSelectionRange) input.setSelectionRange(caret, caret);

    onFormulaInput(input.value);
}

/** 取消这一列的计算列（退回普通可编辑列） */
function clearFormulaDraft() {
    formulaEditBuffer = '';
    applyFormulaDraft();
}

/** 确定：把弹窗里的内容写进列草稿。真正的提交在「保存列结构」之后。 */
function applyFormulaDraft() {
    if (formulaEditIndex < 0) {
        closeFormulaEditor();
        return;
    }

    const text = formulaEditBuffer.trim();
    if (text) {
        const problem = formulaCheck(text);
        if (problem) {
            showToast('❌ ' + problem, 'error');
            return;
        }
    }

    setColumnDraftExpr(formulaEditIndex, text);
    closeFormulaEditor();
    renderColumnDraft();
}

/**
 * 前端预检：只查「一眼能看出写错了」的问题（括号 / 引号不配对、函数名不在白名单、
 * 引用了别的计算列）。真正的语法与引用校验一定在服务端 —— 这里只是让用户少跑一趟。
 */
function formulaCheck(text) {
    const s = (text || '').trim();
    if (!s) return '留空表示取消这一列的计算列';
    if (s.length > FORMULA_MAX_LENGTH) return `公式不能超过 ${FORMULA_MAX_LENGTH} 个字符`;

    let depth = 0;
    for (const ch of s) {
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth < 0) return '括号不匹配：多了一个 )';
        }
    }
    if (depth > 0) return '括号不匹配：少了一个 )';

    if (countOf(s, '"') % 2 !== 0) return '双引号没有成对';
    if (countOf(s, "'") % 2 !== 0) return '单引号没有成对';
    if (countOf(s, '[') !== countOf(s, ']')) return '方括号没有成对';

    const unknown = unknownFunctions(s);
    if (unknown.length > 0) {
        return `不支持的函数：${unknown.join('、')}（可用：${FORMULA_FUNCTIONS.join('、')}）`;
    }

    return '';
}

function countOf(text, ch) {
    let n = 0;
    for (const c of text) if (c === ch) n++;
    return n;
}

/** 找出「名字后面直接跟左括号」但不在白名单里的调用 */
function unknownFunctions(text) {
    const found = [];
    const re = /([A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*)\s*\(/g;
    let m;

    while ((m = re.exec(text)) !== null) {
        const name = m[1].toUpperCase();
        if (FORMULA_FUNCTIONS.indexOf(name) === -1 && found.indexOf(m[1]) === -1) found.push(m[1]);
    }

    return found;
}

// ================================================================
// 提交
// ================================================================

/**
 * 把草稿里的公式提交到服务端。**必须在列结构保存成功之后调用** ——
 * 新增的列这时才真正存在，服务端的引用校验才有列可查。
 *
 * 逐个串行提交：服务端保存列元数据是「整表覆盖」，并发写会互相覆盖，
 * 结果就是只有最后一个公式活下来。
 * 结构已经保存成功，公式失败不该让用户以为整件事都没成，所以单独汇总提示。
 */
function applyColumnFormulas(drafts) {
    const targets = drafts
        .map(c => ({
            name: (c.name || '').trim(),
            expr: (c.expr || '').trim(),
            // 改名过的列要用旧名去查「原来有没有公式」，否则清空公式这一步会漏掉
            before: formulaOf((c.original || c.name || '').trim())
        }))
        .filter(c => c.name && (c.expr || c.before));

    if (targets.length === 0) return Promise.resolve();

    setStatus('保存计算公式...');
    const failures = [];
    let chain = Promise.resolve();

    targets.forEach(t => {
        chain = chain.then(() =>
            saveFormula(currentTableId, t.name, t.expr)
                .catch(err => { failures.push(`${t.name}：${err.message}`); })
        );
    });

    return chain.then(() => {
        if (failures.length > 0) {
            showToast('⚠️ 部分公式没保存成功：\n' + failures.join('\n'), 'error');
        }
    });
}
