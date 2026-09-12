// ================================================================
// 列视图元数据：列宽 / 隐藏列的持久化
// ----------------------------------------------------------------
// 背景：这两项以前只活在内存里，刷新页面就没了。现在跟着表格存到服务端，
// 换浏览器、换设备都还在。
//
// 边界（重要）：
//   只持久化用户「显式」调整过的偏好；列的数据类型在导出时按数据实时推断，
//   不落库 —— 避免「元数据写着 number、实际数据却是文字」这类漂移。
//
// 保存策略：防抖自动保存。调列宽是高频微调，让用户每次去点「保存」不现实；
// 提交失败只提示一次，避免连续弹窗。
// ================================================================

/** 防抖窗口（ms）：列宽是连续微调，攒一下再提交，别每动一格就打一次接口 */
const META_SAVE_DELAY = 600;

let _metaSaveTimer = null;
let _metaSaveFailed = false;

/**
 * 把服务端下发的元数据应用到视图状态（加载表格数据时调用）。
 * 传入 null / undefined 表示该表没有保存过偏好，视图回到默认。
 */
function applyColumnMeta(meta) {
    hiddenColumns = [];
    columnWidths = {};

    if (!meta) return;

    for (const name of Object.keys(meta)) {
        const item = meta[name] || {};
        if (item.hidden) hiddenColumns.push(name);

        const width = parseInt(item.width);
        if (!isNaN(width) && width > 0) columnWidths[name] = width;
    }
}

/**
 * 从当前视图状态收集要保存的元数据。
 * 只含当前表头里存在的列，且跳过全默认的列 —— 否则 JSON 会随列数无意义膨胀。
 */
function collectColumnMeta() {
    const meta = {};

    for (const name of currentHeaders) {
        const hidden = hiddenColumns.indexOf(name) !== -1;
        const width = columnWidths[name];
        if (!hidden && !width) continue;

        meta[name] = {};
        if (width) meta[name].width = width;
        if (hidden) meta[name].hidden = true;
    }

    return meta;
}

/** 防抖后自动提交；失败只提示一次，直到下次成功才恢复提示能力 */
function scheduleMetaSave() {
    if (!currentTableId) return;
    if (_metaSaveTimer) clearTimeout(_metaSaveTimer);
    _metaSaveTimer = setTimeout(flushColumnMeta, META_SAVE_DELAY);
}

/** 立即提交（切换数据源前调用，避免丢掉最后一次改动） */
function flushColumnMeta() {
    if (_metaSaveTimer) {
        clearTimeout(_metaSaveTimer);
        _metaSaveTimer = null;
    }

    const tableId = currentTableId;
    if (!tableId) return Promise.resolve();

    return saveColumnMeta(tableId, collectColumnMeta())
        .then(() => {
            _metaSaveFailed = false;
        })
        .catch(() => {
            if (_metaSaveFailed) return;
            _metaSaveFailed = true;
            showToast('列设置没能保存到服务器，刷新后可能丢失', 'error');
        });
}

/**
 * 换数据源时清空并取消防抖。
 * 必须调用：否则上一张表遗留的定时器会把旧偏好写到新表上。
 */
function resetColumnMeta() {
    if (_metaSaveTimer) {
        clearTimeout(_metaSaveTimer);
        _metaSaveTimer = null;
    }

    hiddenColumns = [];
    columnWidths = {};
    _metaSaveFailed = false;
}
