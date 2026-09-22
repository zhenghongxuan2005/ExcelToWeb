// ================================================================
// 填充柄（选区右下角拖拽 → 复制 / 延续序列）
// ----------------------------------------------------------------
// Excel 的填充柄：选中一片区域后右下角会出现一个小方块，把它往下（或往右）
// 拖，就会按源区域的规律把值填进拖过的单元格里。
//
// 规律判定（逐列 / 逐行各自独立判断）：
//   单个值                -> 重复该值
//   多个纯数字且相邻差一致   -> 延续等差数列（与 Excel 一致）
//   其余情况              -> 循环重复源区域的值
// 用「纯数字 + 差一致」而不是「列名像数字列」：填充依据的是用户手上那几格的
// 实际内容，整列的类型在这里没有参考价值。
//
// 方向：按拖拽位移较大的那个轴决定纵向还是横向填充，另一轴保持源区域范围。
//      （Excel 允许同时向右下扩展；这里先支持单方向，行为更容易预期。）
//
// 数据安全：
//   - 写入的是 currentRows（唯一数据模型），写前 pushHistory() 记录修改前状态；
//   - 坐标沿用以「视口坐标」建模的选区模型，落数据时用 DOM 反查
//     data-index + 列名，保证排序 / 分页 / 隐藏列下不会写错行；
//   - 只改值、不增删行，因此不需要像粘贴那样取消排序；同时直接写 DOM input、
//     不整表重绘，避免行被重新排序导致选区跳位（与「直接编辑单元格」一致）。
// 依赖：state.js、view.js（getVisibleHeaders / rangeSignature 所在文件）、
//       range.js（rangeBounds / rangeRowEls / rangeColKeys / rangePosOfInput /
//       paintSelection）、history.js（pushHistory）、utils.js（showToast / setStatus）
// ================================================================

let _fillDrag = null;   // 拖拽填充中的临时状态 { source, target }

// ================================================================
// 规律计算（纯函数，便于单测）
// ================================================================

/** 数字归一：空串 / 非数字返回 null，其余返回 Number */
function fillNumber(v) {
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (s === '') return null;
    // 与导出口径一致：Number("1,000") 得到 NaN，会让千分位数列白白退化成文本循环
    return parseSafeNumber(s);
}

/** 去掉浮点误差，避免填出 0.30000000000000004 这种值 */
function tidyNumber(n) {
    return String(Math.round(n * 1e10) / 1e10);
}

/**
 * 依据源序列生成 count 个后续值。
 * @param {string[]} src 源序列，按填充方向排列（向下 / 向右为正序）
 * @param {number} count 需要续写的个数
 * @returns {string[]}
 */
function fillSeries(src, count) {
    const n = src.length;
    if (n === 0 || count <= 0) return [];
    if (n === 1) return new Array(count).fill(String(src[0]));

    const nums = src.map(fillNumber);
    if (nums.every(x => x !== null)) {
        const step = nums[1] - nums[0];
        let sameStep = true;
        for (let i = 2; i < n; i++) {
            if (Math.abs((nums[i] - nums[i - 1]) - step) > 1e-9) { sameStep = false; break; }
        }
        if (sameStep) {
            const out = [];
            for (let i = 0; i < count; i++) out.push(tidyNumber(nums[n - 1] + step * (i + 1)));
            return out;
        }
    }

    // 非等差数列：循环重复源序列
    const out = [];
    for (let i = 0; i < count; i++) out.push(String(src[i % n]));
    return out;
}

/**
 * 由源选区 + 拖拽落点算出填充目标矩形（视口坐标）。
 * 纵向填充时列范围固定为源列范围，横向填充时行范围固定为源行范围。
 * @param {{r1:number,r2:number,c1:number,c2:number}} bounds 源选区边界
 * @param {{rowPos:number,colPos:number}} pos 拖拽落点
 * @returns {{r1:number,r2:number,c1:number,c2:number,vert:boolean}|null}
 *          返回 null 表示拖回了源区域内部（没有可填充的新格子）
 */
function computeFillTarget(bounds, pos) {
    if (!bounds || !pos) return null;

    const dRow = pos.rowPos < bounds.r1 ? bounds.r1 - pos.rowPos
        : (pos.rowPos > bounds.r2 ? pos.rowPos - bounds.r2 : 0);
    const dCol = pos.colPos < bounds.c1 ? bounds.c1 - pos.colPos
        : (pos.colPos > bounds.c2 ? pos.colPos - bounds.c2 : 0);
    if (dRow === 0 && dCol === 0) return null;

    if (dRow >= dCol) {
        return {
            r1: Math.min(bounds.r1, pos.rowPos),
            r2: Math.max(bounds.r2, pos.rowPos),
            c1: bounds.c1,
            c2: bounds.c2,
            vert: true
        };
    }
    return {
        r1: bounds.r1,
        r2: bounds.r2,
        c1: Math.min(bounds.c1, pos.colPos),
        c2: Math.max(bounds.c2, pos.colPos),
        vert: false
    };
}

// ================================================================
// 视口坐标 <-> 数据
// ================================================================

/** 视口行号 -> currentRows 下标（取自真实 DOM，排序 / 分页 / 隐藏列下依然正确） */
function rowDataIndex(rows, rowPos) {
    if (rowPos < 0 || rowPos >= rows.length) return null;
    const input = rows[rowPos].querySelector('.cell-input');
    const idx = input ? parseInt(input.dataset.index) : NaN;
    return isNaN(idx) ? null : idx;
}

/** 读源区域某一段列（纵向填充用） */
function readColValues(rows, colPos, r1, r2) {
    const out = [];
    for (let r = r1; r <= r2; r++) {
        const inputs = rows[r] ? rows[r].querySelectorAll('.cell-input') : [];
        out.push(inputs[colPos] ? inputs[colPos].value : '');
    }
    return out;
}

/** 读源区域某一行的一段（横向填充用） */
function readRowValues(rows, rowPos, c1, c2) {
    const out = [];
    const inputs = rows[rowPos] ? rows[rowPos].querySelectorAll('.cell-input') : [];
    for (let c = c1; c <= c2; c++) {
        out.push(inputs[c] ? inputs[c].value : '');
    }
    return out;
}

// ================================================================
// 落数据
// ================================================================

/**
 * 把填充结果写进 currentRows 与 DOM。
 * @param {{r1,r2,c1,c2,vert:boolean}} target 目标矩形（含源区域）
 * @param {{r1,r2,c1,c2}} [source] 源选区；不传则取当前拖拽中的源（便于单测直接调用）
 * @returns {{cells:number,rows:number,cols:number}|null} null = 没写入任何格子
 */
function applyFill(target, source) {
    if (!source && _fillDrag) source = _fillDrag.source;
    if (!target || !source) return null;

    const rows = rangeRowEls();
    const keys = rangeColKeys();
    if (rows.length === 0 || keys.length === 0) return null;

    const writes = [];   // [{ rowPos, colPos, value }]

    if (target.vert) {
        for (let c = source.c1; c <= source.c2; c++) {
            const srcVals = readColValues(rows, c, source.r1, source.r2);
            const below = target.r2 - source.r2;
            const above = source.r1 - target.r1;
            if (below > 0) {
                const vals = fillSeries(srcVals, below);
                for (let i = 0; i < below; i++) {
                    writes.push({ rowPos: source.r2 + 1 + i, colPos: c, value: vals[i] });
                }
            }
            if (above > 0) {
                // 向上填充：把源序列倒过来续写再倒回去，得到「越往上越小」的等差数列
                const vals = fillSeries(srcVals.slice().reverse(), above).reverse();
                for (let i = 0; i < above; i++) {
                    writes.push({ rowPos: target.r1 + i, colPos: c, value: vals[i] });
                }
            }
        }
    } else {
        for (let r = source.r1; r <= source.r2; r++) {
            const srcVals = readRowValues(rows, r, source.c1, source.c2);
            const right = target.c2 - source.c2;
            const left = source.c1 - target.c1;
            if (right > 0) {
                const vals = fillSeries(srcVals, right);
                for (let i = 0; i < right; i++) {
                    writes.push({ rowPos: r, colPos: source.c2 + 1 + i, value: vals[i] });
                }
            }
            if (left > 0) {
                const vals = fillSeries(srcVals.slice().reverse(), left).reverse();
                for (let i = 0; i < left; i++) {
                    writes.push({ rowPos: r, colPos: target.c1 + i, value: vals[i] });
                }
            }
        }
    }

    if (writes.length === 0) return null;

    pushHistory();

    let cells = 0;
    for (const w of writes) {
        const idx = rowDataIndex(rows, w.rowPos);
        const key = keys[w.colPos];
        if (idx === null || key === undefined || !currentRows[idx]) continue;
        // 计算列不参与填充：拖出来的值既不会被保存（服务端只认公式），
        // 也会在下次读取时被算回去，白改一场还会让用户以为改成功了
        if (isComputedColumn(key)) continue;
        currentRows[idx][key] = w.value;
        const inputs = rows[w.rowPos].querySelectorAll('.cell-input');
        if (inputs[w.colPos]) inputs[w.colPos].value = w.value;
        cells++;
    }
    if (cells === 0) return null;

    // 填充后选区扩为整个目标区（Excel 的行为），签名先对齐避免被判成视图变化
    rangeAnchor = { rowPos: target.r1, colPos: target.c1 };
    rangeFocus = { rowPos: target.r2, colPos: target.c2 };
    _rangeSig = rangeSignature();
    paintSelection();

    return { cells: cells, rows: target.r2 - target.r1 + 1, cols: target.c2 - target.c1 + 1 };
}

// ================================================================
// 填充柄 DOM
// ================================================================

/** 在选区右下角挂一个填充柄。由 range.js 的 updateRangeHint() 在每次重绘选区后调用，幂等。 */
function updateFillHandle() {
    const old = document.querySelector('.range-fill-handle');
    if (old && old.remove) old.remove();

    if (!isRangeActive()) return;

    const b = rangeBounds();
    const rows = rangeRowEls();
    const keys = rangeColKeys();
    if (!b || b.r2 >= rows.length || b.c2 >= keys.length) return;

    const inputs = rows[b.r2].querySelectorAll('.cell-input');
    const td = inputs[b.c2] ? inputs[b.c2].parentElement : null;
    if (!td || !td.appendChild) return;

    const handle = document.createElement('div');
    handle.className = 'range-fill-handle';
    handle.title = '拖拽填充：复制单元格，或按等差数列延续序列';
    td.appendChild(handle);
    if (handle.addEventListener) handle.addEventListener('mousedown', onFillHandleMouseDown);
}

/** 高亮「将被写入」的目标区域 */
function clearFillTarget() {
    const container = document.getElementById('tableContainer');
    if (!container) return;
    container.querySelectorAll('td.is-fill-target').forEach(td => td.classList.remove('is-fill-target'));
}

function paintFillTarget(target) {
    clearFillTarget();
    if (!target) return;

    const rows = rangeRowEls();
    const keys = rangeColKeys();
    for (let r = target.r1; r <= target.r2 && r < rows.length; r++) {
        const inputs = rows[r].querySelectorAll('.cell-input');
        for (let c = target.c1; c <= target.c2 && c < keys.length; c++) {
            const td = inputs[c] ? inputs[c].parentElement : null;
            if (td) td.classList.add('is-fill-target');
        }
    }
}

// ================================================================
// 拖拽
// ================================================================

function onFillHandleMouseDown(e) {
    if (e.button !== 0) return;
    const source = rangeBounds();
    if (!source) return;

    e.preventDefault();
    e.stopPropagation();          // 不要再触发 range.js 的选区拖拽 / 点击取消选区

    _fillDrag = { source: source, target: null };
    document.body.classList.add('is-fill-dragging');
    setStatus('拖拽填充中…松开鼠标完成');
}

function onFillHandleMouseMove(e) {
    if (!_fillDrag) return;
    e.preventDefault();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const input = el && el.closest ? el.closest('.cell-input') : null;
    const pos = input ? rangePosOfInput(input) : null;

    _fillDrag.target = pos ? computeFillTarget(_fillDrag.source, pos) : null;
    paintFillTarget(_fillDrag.target);
}

function onFillHandleMouseUp() {
    if (!_fillDrag) return;

    const drag = _fillDrag;
    _fillDrag = null;
    document.body.classList.remove('is-fill-dragging');
    clearFillTarget();

    if (!drag.target) return;

    const result = applyFill(drag.target, drag.source);
    if (!result) return;

    showToast(`✅ 已填充 ${result.cells} 个单元格`, 'success');
    setStatus(`已填充 ${result.cells} 个单元格`);
}

/** 接线（app.js 在 range.js 之后调用一次） */
function initFillHandle() {
    document.addEventListener('mousemove', onFillHandleMouseMove);
    document.addEventListener('mouseup', onFillHandleMouseUp);
}
