// ================================================================
// 撤销 / 重做（基于快照栈）
// 依赖：state.js（undoHistory / historyIndex / currentRows / currentHeaders）
//       utils.js（showToast）、render.js（renderTable）
// ================================================================

function pushHistory() {
    if (historyIndex < undoHistory.length - 1) {
        undoHistory = undoHistory.slice(0, historyIndex + 1);
    }
    undoHistory.push({
        rows: JSON.parse(JSON.stringify(currentRows)),
        headers: JSON.parse(JSON.stringify(currentHeaders))
    });
    if (undoHistory.length > MAX_HISTORY) undoHistory.shift();
    historyIndex = undoHistory.length - 1;
    updateUndoButtons();
}

function undo() {
    if (historyIndex <= 0) {
        showToast('没有可撤销的操作', 'info');
        return;
    }
    historyIndex--;
    restoreState(undoHistory[historyIndex]);
    showToast('↩️ 已撤销', 'success');
    updateUndoButtons();
}

function redo() {
    if (historyIndex >= undoHistory.length - 1) {
        showToast('没有可重做的操作', 'info');
        return;
    }
    historyIndex++;
    restoreState(undoHistory[historyIndex]);
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
        const undoCount = historyIndex;
        const redoCount = undoHistory.length - historyIndex - 1;
        const currentStatus = statusText.textContent.split(' | ')[0] || '就绪';
        statusText.textContent = `${currentStatus} | 撤销: ${undoCount} | 重做: ${redoCount}`;
    }
}
