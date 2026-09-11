// ================================================================
// 单元格区域选择（选区核心：几何 / 状态 / 绘制 / 鼠标键盘交互）
// ----------------------------------------------------------------
// TSV 复制粘贴在 range-clipboard.js。
//
// 选区模型用「视口坐标」而不是数据数组下标：
//   rangeAnchor / rangeFocus = { rowPos, colPos }
//   rowPos -> 当前页 tbody 的第几行，colPos -> visibleHeaders 的第几列
// 原因：排序 / 分页 / 隐藏列之后，「肉眼看到的矩形」与 currentRows 下标并不
// 连续；按视口坐标记录，选区才与用户所见一致。真正落到数据上时，再用 DOM
// 把 (rowPos, colPos) 反查回 (data-index, 列名)。
//
// 交互：
//   拖拽           建立矩形选区（单击 = 单格选区，不影响原有的编辑聚焦）
//   Shift + 单击   从锚点扩展到点击处
//   Shift + 方向键 从焦点单元格继续扩展（入口在 keyboard.js）
//   Esc            取消选区
// 依赖：state.js、view.js（getVisibleHeaders）、
//       keyboard.js（isCellInput / findCellInRow / focusCellAt / currentTableEl）
// 接线：renderTable() 重建表格后会回调 paintSelection()，把选区画到新 DOM 上。
// ================================================================

let rangeAnchor = null;   // 选区锚点 { rowPos, colPos }
let rangeFocus = null;    // 选区焦点 { rowPos, colPos }
let _rangeSig = null;     // 视图签名：一变就说明行列集合已变，旧选区作废
let _rangeDrag = null;    // 拖拽中的临时状态

const RANGE_DRAG_THRESHOLD = 4;   // 位移超过 4px 才算拖拽，否则仍按普通单击处理

// ================================================================
// 视口坐标 <-> DOM
// ================================================================

/** 视图签名：换表 / 搜索 / 排序 / 翻页 / 改列 / 行数变化都会让它变 */
function rangeSignature() {
    return [
        currentTableId, searchKeyword, sortField, sortOrder,
        currentPage, pageSize, currentRows.length,
        getVisibleHeaders().join('\u0001')
    ].join('\u0002');
}

function rangeRowEls() {
    const table = currentTableEl();
    return table ? Array.from(table.querySelectorAll('tbody tr')) : [];
}

function rangeColKeys() {
    return getVisibleHeaders();
}

/** 单元格输入框 -> 视口坐标 */
function rangePosOfInput(input) {
    if (!input) return null;
    const tr = input.closest ? input.closest('tr') : null;
    if (!tr) return null;
    const rowPos = rangeRowEls().indexOf(tr);
    const colPos = rangeColKeys().indexOf(input.dataset.key);
    if (rowPos < 0 || colPos < 0) return null;
    return { rowPos: rowPos, colPos: colPos };
}

// ================================================================
// 选区状态
// ================================================================

function isRangeActive() {
    return !!(rangeAnchor && rangeFocus);
}

function isMultiCellRange() {
    if (!isRangeActive()) return false;
    return rangeAnchor.rowPos !== rangeFocus.rowPos || rangeAnchor.colPos !== rangeFocus.colPos;
}

/** 选区矩形边界（含首尾） */
function rangeBounds() {
    if (!isRangeActive()) return null;
    return {
        r1: Math.min(rangeAnchor.rowPos, rangeFocus.rowPos),
        r2: Math.max(rangeAnchor.rowPos, rangeFocus.rowPos),
        c1: Math.min(rangeAnchor.colPos, rangeFocus.colPos),
        c2: Math.max(rangeAnchor.colPos, rangeFocus.colPos)
    };
}

function setRange(anchor, focus) {
    rangeAnchor = anchor;
    rangeFocus = focus;
    paintSelection();
}

/** 选区行数 / 列数 */
function rangeSize() {
    const b = rangeBounds();
    return b ? { rows: b.r2 - b.r1 + 1, cols: b.c2 - b.c1 + 1 } : { rows: 0, cols: 0 };
}

function clearRange() {
    rangeAnchor = null;
    rangeFocus = null;
    _rangeDrag = null;
    unhighlightRange();
    updateRangeHint();
}

function unhighlightRange() {
    const container = document.getElementById('tableContainer');
    if (!container) return;
    container.querySelectorAll('td.is-range-selected').forEach(td => {
        td.classList.remove('is-range-selected');
        td.classList.remove('is-range-focus');
    });
}

// ================================================================
// 绘制 / 提示
// ================================================================

/**
 * 把选区画到当前 DOM 上。由 renderTable() 在重建表格后调用。
 * 若视图签名变化（换表 / 搜索 / 排序 / 翻页 / 改列），旧选区自动作废 ——
 * 否则会指向另一批数据，出现「选中的是 A 行、改的是 B 行」。
 */
function paintSelection() {
    const sig = rangeSignature();
    // 只在「签名确实变过」时作废选区：首次绘制时 _rangeSig 还是 null，
    // 若按 sig !== _rangeSig 判断，会把用户刚建立的第一处选区误清掉。
    if (_rangeSig !== null && sig !== _rangeSig) {
        rangeAnchor = null;
        rangeFocus = null;
    }
    _rangeSig = sig;

    const b = rangeBounds();
    if (b) {
        const rows = rangeRowEls();
        const keys = rangeColKeys();
        for (let r = b.r1; r <= b.r2 && r < rows.length; r++) {
            const inputs = rows[r].querySelectorAll('.cell-input');
            for (let c = b.c1; c <= b.c2 && c < keys.length; c++) {
                const td = inputs[c] ? inputs[c].parentElement : null;
                if (!td) continue;
                td.classList.add('is-range-selected');
                if (r === rangeFocus.rowPos && c === rangeFocus.colPos) {
                    td.classList.add('is-range-focus');
                }
            }
        }
    }
    updateRangeHint();
}

/** 选区提示条：告诉用户选了几行几列、能按哪些键 */
function updateRangeHint() {
    const host = document.getElementById('rangeInfo');
    if (!host) return;
    const b = rangeBounds();
    if (!b) { host.innerHTML = ''; return; }

    const size = rangeSize();
    let html = '<div class="range-bar">';
    html += `<span class="range-title">已选 <strong>${size.rows}</strong> 行 × <strong>${size.cols}</strong> 列</span>`;
    html += '<span class="range-keys">Ctrl+C 复制（TSV）· Ctrl+V 粘贴 · Delete 清空 · Shift+方向键 扩展 · Esc 取消</span>';
    html += '<span class="range-actions">';
    html += '<button class="btn btn-outline btn-sm" onclick="copyRangeSelection()">复制选区</button>';
    html += '<button class="btn btn-outline btn-sm" onclick="clearRangeContent()">清空内容</button>';
    html += '</span>';
    html += '</div>';
    host.innerHTML = html;
}

// ================================================================
// 键盘
// ================================================================

/** Shift + 方向键扩展选区（由 keyboard.js 调用，返回是否已处理） */
function extendRangeByKey(key) {
    const seed = rangePosOfInput(document.activeElement);
    if (!seed) return false;

    if (!rangeAnchor) {
        rangeAnchor = seed;
        rangeFocus = seed;
    }

    const rows = rangeRowEls();
    const keys = rangeColKeys();
    let rowPos = rangeFocus.rowPos;
    let colPos = rangeFocus.colPos;
    if (key === 'ArrowUp') rowPos--;
    else if (key === 'ArrowDown') rowPos++;
    else if (key === 'ArrowLeft') colPos--;
    else if (key === 'ArrowRight') colPos++;
    else return false;

    rowPos = Math.max(0, Math.min(rows.length - 1, rowPos));
    colPos = Math.max(0, Math.min(keys.length - 1, colPos));
    rangeFocus = { rowPos: rowPos, colPos: colPos };

    // 焦点跟着落到新单元格，方便连续扩展（锚点保持不变）
    focusCellAt(currentTableEl(), rowPos, colPos);
    paintSelection();
    return true;
}

function onRangeKeydown(e) {
    if (e.altKey || e.metaKey) return;

    if (e.key === 'Escape') {
        if (isRangeActive()) clearRange();
        return;
    }

    if (e.key !== 'Delete' || !isRangeActive()) return;

    const active = document.activeElement;
    if (isCellInput(active)) {
        // 单格选区 + 正在编辑，或输入框里有选中的文字 → 让浏览器只删文字
        if (!isMultiCellRange()) return;
        if (active.selectionStart !== active.selectionEnd) return;
    }
    if (clearRangeContent()) e.preventDefault();
}

// ================================================================
// 鼠标拖拽
// ================================================================

function onRangeMouseDown(e) {
    if (e.button !== 0) return;
    const input = e.target && e.target.closest ? e.target.closest('.cell-input') : null;
    if (!input) return;

    const pos = rangePosOfInput(input);
    if (!pos) return;

    if (e.shiftKey && rangeAnchor) {
        e.preventDefault();
        rangeFocus = pos;
        paintSelection();
        return;
    }
    _rangeDrag = { x: e.clientX, y: e.clientY, pos: pos, moved: false };
}

function onRangeMouseMove(e) {
    if (!_rangeDrag) return;

    if (!_rangeDrag.moved) {
        if (Math.abs(e.clientX - _rangeDrag.x) < RANGE_DRAG_THRESHOLD &&
            Math.abs(e.clientY - _rangeDrag.y) < RANGE_DRAG_THRESHOLD) return;
        _rangeDrag.moved = true;
        document.body.classList.add('is-range-dragging');
        // 拖拽期间不要留着单元格的光标，否则会顺带选中文本
        if (isCellInput(document.activeElement)) document.activeElement.blur();
    }
    e.preventDefault();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const input = el && el.closest ? el.closest('.cell-input') : null;
    if (!input) return;
    const pos = rangePosOfInput(input);
    if (!pos) return;

    if (!rangeAnchor) rangeAnchor = _rangeDrag.pos;
    rangeFocus = pos;
    paintSelection();
}

function onRangeMouseUp() {
    if (!_rangeDrag) return;
    document.body.classList.remove('is-range-dragging');

    const drag = _rangeDrag;
    _rangeDrag = null;
    // 没拖动 = 普通单击：把选区收成单个单元格（不影响点击聚焦编辑）
    if (!drag.moved) setRange(drag.pos, drag.pos);
}

// ================================================================
// 接线
// ================================================================

function initRangeSelection() {
    const container = document.getElementById('tableContainer');
    if (!container) return;

    container.addEventListener('mousedown', onRangeMouseDown);
    document.addEventListener('mousemove', onRangeMouseMove);
    document.addEventListener('mouseup', onRangeMouseUp);
    document.addEventListener('copy', onRangeCopy);
    document.addEventListener('paste', onRangePaste);
    document.addEventListener('keydown', onRangeKeydown);

    // 点表格以外（工具栏 / 弹窗）时取消选区；表格内交给上面的 mousedown 处理
    document.addEventListener('mousedown', e => {
        if (container.contains(e.target)) return;
        if (isRangeActive()) clearRange();
    });
}
