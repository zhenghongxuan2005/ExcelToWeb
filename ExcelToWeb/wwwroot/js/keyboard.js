// ================================================================
// Excel 式键盘导航
// ----------------------------------------------------------------
// 只作用在「可编辑单元格」上，不影响页面其它输入框：
//   Enter / Shift+Enter     下移 / 上移
//   Tab / Shift+Tab         右移 / 左移（到行尾自动换行，与 Excel 一致）
//   方向键上下               移动单元格
//   方向键左右               光标先在单元格内移动，到首/尾才跳到相邻单元格
//   Ctrl+Home / Ctrl+End    跳到首格 / 末格
//   Esc                     取消编辑（失焦）
// 越过当前页边界时会自动翻页，落在目标行上。
// 依赖：state.js、view.js（getVisibleHeaders / buildDisplayRows / getTotalPages / gotoPage）、
//       render.js（renderTable）。findreplace.js 复用这里的 isCellInput / findCellInRow。
// ================================================================

function isCellInput(el) {
    return !!el && el.classList && el.classList.contains('cell-input');
}

/** 在给定行里按列名找输入框（不用属性选择器，避免列名含引号时破坏选择器） */
function findCellInRow(tr, key) {
    if (!tr) return null;
    const inputs = tr.querySelectorAll('.cell-input');
    for (const inp of inputs) {
        if (inp.dataset.key === key) return inp;
    }
    return null;
}

/** 当前聚焦单元格在「当前页 + 可见列」里的坐标 */
function currentCellPosition() {
    const el = document.activeElement;
    if (!isCellInput(el)) return null;

    const table = el.closest('table');
    const tr = el.closest('tr');
    if (!table || !tr) return null;

    const trs = Array.from(table.querySelectorAll('tbody tr'));
    const rowPos = trs.indexOf(tr);
    const keys = getVisibleHeaders();
    const colPos = keys.indexOf(el.dataset.key);
    if (rowPos < 0 || colPos < 0) return null;

    return { table, trs, rowPos, colPos, colCount: keys.length };
}

/** 取当前表格元素 */
function currentTableEl() {
    const container = document.getElementById('tableContainer');
    return container ? container.querySelector('table') : null;
}

/** 聚焦到第 rowPos 行、第 colPos 列（光标落在末尾，方便直接续写） */
function focusCellAt(table, rowPos, colPos) {
    if (!table) return false;

    const tr = table.querySelectorAll('tbody tr')[rowPos];
    const key = getVisibleHeaders()[colPos];
    if (!tr || key === undefined) return false;

    const input = findCellInRow(tr, key);
    if (!input) return false;

    input.focus();
    try {
        input.setSelectionRange(input.value.length, input.value.length);
    } catch (e) { /* 个别输入类型不支持选区，忽略即可 */ }
    return true;
}

/**
 * 移动当前单元格。
 * @param {number} dRow 行偏移
 * @param {number} dCol 列偏移（非 0 时越界会换行）
 * @returns {boolean} 是否发生了移动
 */
function moveCell(dRow, dCol) {
    const pos = currentCellPosition();
    if (!pos) return false;

    let rowPos = pos.rowPos + dRow;
    let colPos = pos.colPos + dCol;

    if (dCol !== 0) {
        if (colPos < 0) {
            colPos = pos.colCount - 1;
            rowPos -= 1;
        } else if (colPos >= pos.colCount) {
            colPos = 0;
            rowPos += 1;
        }
    }

    if (rowPos >= 0 && rowPos < pos.trs.length) {
        return focusCellAt(pos.table, rowPos, colPos);
    }

    // 不分页时已到表格边界，停住而不是跳到不存在的行
    if (pageSize <= 0) return false;

    const totalPages = getTotalPages(buildDisplayRows().length);

    // 往下越过末行 → 翻到下一页的第一行
    if (rowPos >= pos.trs.length && currentPage < totalPages) {
        currentPage++;
        renderTable();
        return focusCellAt(currentTableEl(), 0, colPos);
    }

    // 往上越过首行 → 翻到上一页的最后一行
    if (rowPos < 0 && currentPage > 1) {
        currentPage--;
        renderTable();
        const table = currentTableEl();
        const trs = table ? table.querySelectorAll('tbody tr') : [];
        return focusCellAt(table, trs.length - 1, colPos);
    }

    return false;
}

function handleCellKeydown(e) {
    // 只接管可编辑单元格；弹窗、搜索框等一概不碰
    if (!isCellInput(e.target)) return;
    if (e.altKey || e.metaKey) return;

    if (e.key === 'Enter') {
        e.preventDefault();
        moveCell(e.shiftKey ? -1 : 1, 0);
        return;
    }

    if (e.key === 'Tab' && !e.ctrlKey) {
        e.preventDefault();
        moveCell(0, e.shiftKey ? -1 : 1);
        return;
    }

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveCell(1, 0);
        return;
    }

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveCell(-1, 0);
        return;
    }

    // 左右方向键优先移动光标，只有光标已在首 / 尾（且无选区）时才移动单元格
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const inp = e.target;
        const value = inp.value || '';
        const start = inp.selectionStart;
        const end = inp.selectionEnd;
        if (start === null || start !== end) return;

        if (e.key === 'ArrowLeft' && start === 0) {
            e.preventDefault();
            moveCell(0, -1);
        } else if (e.key === 'ArrowRight' && start === value.length) {
            e.preventDefault();
            moveCell(0, 1);
        }
        return;
    }

    if (e.ctrlKey && e.key === 'Home') {
        e.preventDefault();
        focusCellAt(currentTableEl(), 0, 0);
        return;
    }

    if (e.ctrlKey && e.key === 'End') {
        e.preventDefault();
        const table = currentTableEl();
        const trs = table ? table.querySelectorAll('tbody tr') : [];
        focusCellAt(table, trs.length - 1, getVisibleHeaders().length - 1);
        return;
    }

    // Esc 取消编辑；不 stopPropagation，让 app.js 的「关闭弹窗」逻辑照常执行
    if (e.key === 'Escape') {
        e.target.blur();
    }
}

document.addEventListener('keydown', handleCellKeydown);
