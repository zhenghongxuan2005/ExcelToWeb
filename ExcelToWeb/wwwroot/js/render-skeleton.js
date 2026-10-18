// ================================================================
// 表格骨架屏：数据加载中的占位（从 render.js 拆出，见 CODE_STANDARDS.md §2）
// ----------------------------------------------------------------
// 依赖：utils.js 的 clearSelectionStats 由 selection.js 提供
// 使用方：tables.js / dnd.js / upload-validated.js（加载与上传两条路径）
// 说明：延迟 120ms 再出现 —— 接口很快返回时不会「闪一下」，慢请求才看得到加载态。
// ================================================================

let _skeletonTimer = null;

/**
 * 显示表格骨架屏。
 * @param {number} colCount 预估列数，让占位宽度更接近真实表格
 */
function showTableSkeleton(colCount) {
    const container = document.getElementById('tableContainer');
    if (!container) return;
    const cols = Math.max(3, Math.min(parseInt(colCount) || 6, 12));

    if (_skeletonTimer) clearTimeout(_skeletonTimer);
    _skeletonTimer = setTimeout(() => {
        _skeletonTimer = null;
        let html = '<div class="skeleton-table" aria-hidden="true">';
        for (let r = 0; r < 8; r++) {
            html += '<div class="skeleton-row">';
            for (let c = 0; c < cols; c++) {
                html += '<div class="skeleton-cell' + (c === 0 ? ' skeleton-narrow' : '') + '"></div>';
            }
            html += '</div>';
        }
        html += '</div>';
        container.innerHTML = html;
        clearSelectionStats();
    }, 120);
}

/**
 * 取消尚未显示的骨架屏。数据就绪（成功或失败）时必须调用，
 * 否则延迟到点的骨架屏会覆盖刚渲染好的真实表格。
 */
function hideTableSkeleton() {
    if (_skeletonTimer) {
        clearTimeout(_skeletonTimer);
        _skeletonTimer = null;
    }
}
