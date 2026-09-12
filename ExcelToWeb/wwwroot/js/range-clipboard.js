// ================================================================
// 单元格选区 · 剪贴板（TSV 与 Excel 互通）
// ----------------------------------------------------------------
// 选区的几何 / 状态 / 绘制在 range.js，本文件只负责「把选区变成文本」和
// 「把文本写回表格」：
//   Ctrl+C / 「复制选区」按钮   -> 选区内容序列化成 TSV
//   Ctrl+V / 粘贴事件           -> TSV 解析后写进以选区左上角为起点的区域
//   Delete / 「清空内容」按钮   -> 清空选区内容（保留行列结构）
// 用 TSV 而不是 CSV：制表符是 Excel / WPS / 在线表格之间复制粘贴的事实标准，
// 用户可以把这片区域直接粘进 Excel，也能把 Excel 的一片区域粘回来。
//
// 两条复制路径的分工：
//   Ctrl+C 走 copy 事件（不依赖剪贴板权限，兼容性最好，是主路径）；
//   「复制选区」按钮走 navigator.clipboard（给没有键盘的场合兜底）。
// 依赖：range.js（rangeBounds / rangeRowEls / rangeColKeys / rangeAnchor / rangeFocus）、
//       state.js、history.js（pushHistory）、render.js（renderTable）
// ================================================================

// ================================================================
// TSV 互转
// ================================================================

/** 单元格值 -> TSV 字段（含制表符 / 换行 / 引号时才加引号，规则同 CSV） */
function tsvCell(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (s.indexOf('\t') === -1 && s.indexOf('\n') === -1 &&
        s.indexOf('\r') === -1 && s.indexOf('"') === -1) {
        return s;
    }
    return '"' + s.replace(/"/g, '""') + '"';
}

/** TSV 文本 -> 二维数组（支持双引号包裹的含制表符 / 多行字段） */
function parseTsv(text) {
    const s = String(text === null || text === undefined ? '' : text)
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inQuotes) {
            if (ch === '"') {
                if (s[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === '\t') {
            row.push(field); field = '';
        } else if (ch === '\n') {
            row.push(field); field = '';
            rows.push(row); row = [];
        } else {
            field += ch;
        }
    }
    row.push(field);
    rows.push(row);

    // 剪贴板里常见的尾随换行会多出一个空行，去掉
    while (rows.length > 0) {
        const last = rows[rows.length - 1];
        if (last.length === 1 && last[0] === '') rows.pop();
        else break;
    }
    return rows;
}

/** 选区内的值按行拼成 TSV（直接读输入框，保证与「所见」一致） */
function buildRangeTsv() {
    const b = rangeBounds();
    if (!b) return '';
    const rows = rangeRowEls();
    const keys = rangeColKeys();
    const lines = [];
    for (let r = b.r1; r <= b.r2 && r < rows.length; r++) {
        const inputs = rows[r].querySelectorAll('.cell-input');
        const cells = [];
        for (let c = b.c1; c <= b.c2 && c < keys.length; c++) {
            const input = inputs[c];
            cells.push(tsvCell(input ? input.value : ''));
        }
        lines.push(cells.join('\t'));
    }
    return lines.join('\n');
}

// ================================================================
// 复制
// ================================================================

/** 「复制选区」按钮：写入系统剪贴板（Ctrl+C 走下面的 copy 事件，兼容性更好） */
function copyRangeSelection() {
    if (!isRangeActive()) {
        showToast('请先选择单元格区域', 'info');
        return false;
    }
    const tsv = buildRangeTsv();
    if (!tsv) return false;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsv)
            .then(() => {
                showToast('✅ 已复制选区，可直接粘贴到 Excel', 'success');
                setStatus('已复制选区');
            })
            .catch(() => showToast('复制失败，请改用 Ctrl+C', 'error'));
        return true;
    }
    showToast('当前环境不支持直接复制，请按 Ctrl+C', 'info');
    return false;
}

/**
 * 焦点是否落在「非单元格的文本输入控件」里。
 * 选区是常驻的，但用户随时可能去搜索框 / 弹窗输入框里复制粘贴 ——
 * 那种场合必须让浏览器按原意处理，不能被选区劫持。
 */
function clipboardYieldsToFocus(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT') return true;
    return el.isContentEditable === true;
}

/** Ctrl+C：拦截 copy 事件塞入 TSV，不依赖剪贴板权限 */
function onRangeCopy(e) {
    if (!isRangeActive() || !e.clipboardData) return;

    const active = document.activeElement;
    if (isCellInput(active)) {
        // 正在单元格里选中一段文字 → 按用户本意复制文字
        if (active.selectionStart !== active.selectionEnd) return;
    } else if (clipboardYieldsToFocus(active)) {
        return;
    }

    const tsv = buildRangeTsv();
    if (!tsv) return;
    e.clipboardData.setData('text/plain', tsv);
    e.preventDefault();
    setStatus('已复制选区');
}

// ================================================================
// 粘贴
// ================================================================

function onRangePaste(e) {
    if (!isRangeActive() || !e.clipboardData) return;

    const active = document.activeElement;
    if (!isCellInput(active) && clipboardYieldsToFocus(active)) return;

    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    pasteTsv(text);
}

/**
 * 把 TSV 写进以选区左上角为起点的区域。
 * 行不够时自动补空行（Excel 行为）；列超出可见列时裁剪并明确提示，
 * 避免「悄悄少粘了几列」这种最容易被忽略的数据丢失。
 * @returns {boolean} 是否真的写入了数据
 */
function pasteTsv(text) {
    const grid = parseTsv(text).filter(r => r.some(v => v !== ''));
    if (grid.length === 0) return false;

    const b = rangeBounds();
    const rows = rangeRowEls();
    const keys = rangeColKeys();
    if (!b || rows.length === 0 || keys.length === 0) return false;

    const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
    const availCols = keys.length - b.c1;
    const cols = Math.min(width, availCols);
    const clippedCols = width - cols;

    // 超出表格底部 → 补空行；否则粘贴只能落在现有行上，用户会以为丢了数据
    const baseLen = currentRows.length;
    const extraRows = Math.max(0, (b.r1 + grid.length) - rows.length);

    pushHistory();

    for (let i = 0; i < extraRows; i++) {
        const blank = {};
        for (const h of currentHeaders) blank[h] = '';
        currentRows.push(blank);
    }

    let cells = 0;
    for (let i = 0; i < grid.length; i++) {
        const rowPos = b.r1 + i;
        let dataIdx;
        if (rowPos < rows.length) {
            const input = rows[rowPos].querySelector('.cell-input');
            dataIdx = input ? parseInt(input.dataset.index) : NaN;
        } else {
            dataIdx = baseLen + (rowPos - rows.length);
        }
        if (isNaN(dataIdx) || !currentRows[dataIdx]) continue;

        for (let j = 0; j < cols; j++) {
            const key = keys[b.c1 + j];
            if (key === undefined) continue;
            currentRows[dataIdx][key] = grid[i][j] !== undefined ? grid[i][j] : '';
            cells++;
        }
    }

    // 补了行就得取消排序：否则新行会被排到中间，刚算好的选区随之错位
    if (extraRows > 0) resetSort();

    // 选区扩到「刚粘贴的区域」并保持选中
    rangeAnchor = { rowPos: b.r1, colPos: b.c1 };
    rangeFocus = { rowPos: b.r1 + grid.length - 1, colPos: b.c1 + cols - 1 };
    // 状态此时已定稿，先把签名对齐，免得 renderTable 把它判成「视图变化」清掉
    _rangeSig = rangeSignature();
    renderTable();

    let msg = `已粘贴 ${grid.length} 行 × ${cols} 列，共 ${cells} 个单元格`;
    if (clippedCols > 0) msg += `；右侧 ${clippedCols} 列超出表格宽度，已忽略`;
    showToast('✅ ' + msg, clippedCols > 0 ? 'info' : 'success');
    setStatus('已粘贴 ' + cells + ' 个单元格');
    return true;
}

// ================================================================
// 清空
// ================================================================

/** 清空选区内容（保留行列结构） */
function clearRangeContent() {
    if (!isRangeActive()) return false;

    const b = rangeBounds();
    const rows = rangeRowEls();
    const keys = rangeColKeys();
    if (!b || rows.length === 0 || keys.length === 0) return false;

    pushHistory();
    let cells = 0;
    for (let r = b.r1; r <= b.r2 && r < rows.length; r++) {
        const inputs = rows[r].querySelectorAll('.cell-input');
        for (let c = b.c1; c <= b.c2 && c < keys.length; c++) {
            const input = inputs[c];
            if (!input) continue;
            const idx = parseInt(input.dataset.index);
            if (isNaN(idx) || !currentRows[idx]) continue;
            currentRows[idx][input.dataset.key] = '';
            cells++;
        }
    }
    if (cells === 0) return false;

    renderTable();
    showToast(`已清空 ${cells} 个单元格`, 'info');
    setStatus('已清空选区');
    return true;
}
