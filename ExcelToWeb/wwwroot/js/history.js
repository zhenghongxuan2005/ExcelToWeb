// ================================================================
// 撤销 / 重做（双快照栈）
// ----------------------------------------------------------------
// 语义约定：pushHistory() 表示「记住这次修改之前的样子」，必须在修改动作
//           之前调用。undo() 把当前状态转存到重做栈，再回到上一个撤销点。
//
// 为什么不用「单栈 + 下标」：
//   旧实现用 undoHistory[historyIndex] 表示当前位置，首次 pushHistory 之后
//   historyIndex 恰好等于 0，而 undo() 的守卫是 `historyIndex <= 0`，
//   于是「只做过一次修改」时永远撤不回来（最少要改两次才能撤一次）。
//   双栈写法里 undo/redo 各自判空，不再有「下标 0 既合法又被拦截」的歧义。
//
// 换了数据源（加载 / 切换 / 刷新 / 重新导入）必须调 resetHistory()，
// 否则撤销会把上一个表格的快照覆盖到当前表格上 —— 那会写错数据。
// 依赖：state.js（undoHistory / redoHistory / currentRows / currentHeaders）
//       utils.js（showToast）、render.js（renderTable）
// ================================================================

/** 深拷贝当前数据，作为一次快照 */
function snapshotState() {
    return {
        rows: JSON.parse(JSON.stringify(currentRows)),
        headers: JSON.parse(JSON.stringify(currentHeaders))
    };
}

/**
 * 清空撤销 / 重做记录。换了数据源时必须调用，避免 A 表的快照覆盖到 B 表。
 */
function resetHistory() {
    undoHistory = [];
    redoHistory = [];
    updateUndoButtons();
}

/**
 * 压入一个撤销点（记录「修改前」的状态）。
 * 必须在修改 currentRows / currentHeaders 之前调用。
 */
function pushHistory() {
    undoHistory.push(snapshotState());
    if (undoHistory.length > MAX_HISTORY) undoHistory.shift();
    redoHistory = [];       // 产生了新分支，旧的重做路径作废
    updateUndoButtons();
}

/** 撤销：先把当前状态压入重做栈，再回到上一个撤销点 */
function undo() {
    if (undoHistory.length === 0) {
        showToast('没有可撤销的操作', 'info');
        return;
    }
    redoHistory.push(snapshotState());
    restoreState(undoHistory.pop());
    showToast('↩️ 已撤销', 'success');
    updateUndoButtons();
}

/** 重做：撤销的反向操作 */
function redo() {
    if (redoHistory.length === 0) {
        showToast('没有可重做的操作', 'info');
        return;
    }
    undoHistory.push(snapshotState());
    restoreState(redoHistory.pop());
    showToast('↪️ 已重做', 'success');
    updateUndoButtons();
}

function restoreState(state) {
    currentRows = JSON.parse(JSON.stringify(state.rows));
    currentHeaders = JSON.parse(JSON.stringify(state.headers));
    renderTable();
}

function updateUndoButtons() {
    const statusText = document.getElementById('statusText');
    if (statusText) {
        const currentStatus = statusText.textContent.split(' | ')[0] || '就绪';
        statusText.textContent = `${currentStatus} | 撤销: ${undoHistory.length} | 重做: ${redoHistory.length}`;
    }
}
