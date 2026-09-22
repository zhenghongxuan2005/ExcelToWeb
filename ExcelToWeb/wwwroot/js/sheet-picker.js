// ================================================================
// 多工作表导入：一个 Excel 里有多个工作表时，先让用户选一张再导入
// ----------------------------------------------------------------
// 流程：startImport(file) 先问后端「这个文件里有哪些工作表」
//   · 只有一张 → 直接 uploadFile(file) 照旧导入，不给绝大多数单表文件平白加一次往返
//   · 多张     → 弹出选择框，选好后带 sheetIndex 重新上传同一个 File
// 分工：本模块决定「用哪张工作表」，dnd.js 的 uploadFile 负责「真正导入」。
// 依赖：api.js（listSheets）、dnd.js（uploadFile / isAcceptedExcelFile）、utils.js
// ================================================================

/** 等待用户挑选工作表的文件。选定后要重新上传，所以必须留着同一个 File 对象 */
let pendingSheetFile = null;

/** 请求序号：用户连续拖入多个文件时，只认最后一次的结果 */
let sheetProbeToken = 0;

/**
 * 导入入口（点击上传 / 拖拽都走这里）。
 * @param {File} file
 */
function startImport(file) {
    if (!file) return;

    if (!isAcceptedExcelFile(file)) {
        showToast('请上传 .xlsx 或 .xls 格式的文件', 'error');
        return;
    }

    const token = ++sheetProbeToken;
    setStatus('正在读取工作表...');

    listSheets(file)
        .then(sheets => {
            if (token !== sheetProbeToken) return;   // 期间又选了别的文件，丢弃这次结果
            setStatus('');

            if (!sheets || sheets.length === 0) {
                showToast('文件里没有工作表', 'error');
                return;
            }
            if (sheets.length === 1) {
                uploadFile(file);
                return;
            }
            openSheetPicker(file, sheets);
        })
        .catch(err => {
            if (token !== sheetProbeToken) return;
            setStatus('');
            showToast('❌ 读取工作表失败：' + err.message, 'error');
        });
}

/** 弹出工作表选择框；弹窗缺失时退回直接导入，不让整个导入功能跟着不可用 */
function openSheetPicker(file, sheets) {
    const modal = document.getElementById('sheetPickerModal');
    const list = document.getElementById('sheetPickerList');
    if (!modal || !list) {
        uploadFile(file);
        return;
    }

    pendingSheetFile = file;
    list.innerHTML = sheets.map(item => {
        const meta = item.hasData
            ? `${item.rowCount - 1} 行数据 · ${item.columnCount} 列`
            : '没有数据行，无法导入';
        return `<button type="button" class="sheet-item${item.hasData ? '' : ' is-empty'}" `
            + `onclick="pickSheet(${item.index})">`
            + `<span class="sheet-name">${escapeHtml(item.name)}</span>`
            + `<span class="sheet-meta">${meta}</span>`
            + '</button>';
    }).join('');

    modal.classList.add('show');
}

/** 选定某张工作表后导入 */
function pickSheet(index) {
    const file = pendingSheetFile;
    closeSheetPicker();
    if (file) uploadFile(file, index);
}

function closeSheetPicker() {
    const modal = document.getElementById('sheetPickerModal');
    if (modal) modal.classList.remove('show');
    pendingSheetFile = null;
}
