// ================================================================
// 分页条（公共组件）
// ----------------------------------------------------------------
// 审计中心和表格管理页原本各写了一份翻页条，代码几乎一样，差异只有三处：
// 左侧文案、只有一页时是否隐藏、换页后做什么。抽出来之后，新增列表页不必再抄第三份。
//
// 换页回调存在容器元素上而不是拼进 onclick —— 内联处理器只能调到全局函数，
// 而各页面的回调是局部逻辑（要么闭包、要么依赖页面自己的状态）。
// ================================================================

/**
 * 渲染分页条。参数里的 page 由调用方保证已收敛在 [1, totalPages] 内 ——
 * 这里不做夹取：越界是一种应该暴露的 bug，静默夹到末页会让人以为数据还在。
 *
 * @param {string} containerId 容器元素 id
 * @param {object} opts
 * @param {number}   opts.total      总条数
 * @param {number}   opts.page       当前页（从 1 开始）
 * @param {number}   opts.pageSize   每页条数
 * @param {string}   opts.infoText   左侧文案，由调用方用 tt() 拼好
 * @param {function} opts.onChange   换页回调，参数是目标页码
 * @param {boolean}  [opts.hideWhenSingle=true] 只有一页时是否整个隐藏
 */
function renderPager(containerId, opts) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const total = opts.total || 0;
    const pageSize = opts.pageSize || 0;
    const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    const page = opts.page || 1;

    // 只有一页时是否隐藏：审计页愿意在 0 条时也显示「共 0 条记录」，
    // 表格页则不希望一页装得下还占一条横条
    if (opts.hideWhenSingle !== false && total <= pageSize) {
        el.hidden = true;
        el.innerHTML = '';
        el.__pagerGo = null;
        return;
    }

    el.hidden = false;
    el.__pagerGo = typeof opts.onChange === 'function' ? opts.onChange : null;
    el.__pagerTotalPages = totalPages;

    // infoText 由页面拼好（可能含用户数据），一律转义
    let html = `<span class="pager-info">${escapeHtml(opts.infoText || '')}</span>`;
    html += `<button class="pager-btn" onclick="pagerGo('${containerId}', ${page - 1})"`
        + (page <= 1 ? ' disabled' : '') + `>${tt('上一页')}</button>`;
    html += `<span class="pager-current">${tt('第 {page} / {total} 页', { page: page, total: totalPages })}</span>`;
    html += `<button class="pager-btn" onclick="pagerGo('${containerId}', ${page + 1})"`
        + (page >= totalPages ? ' disabled' : '') + `>${tt('下一页')}</button>`;
    el.innerHTML = html;
}

/**
 * 内联按钮的转发器：从容器上取回调用方传进来的回调。
 * 越界在这里再挡一次 —— 按钮的 disabled 只防点击，防不住键盘回车或脚本直接调。
 */
function pagerGo(containerId, page) {
    const el = document.getElementById(containerId);
    if (!el || typeof el.__pagerGo !== 'function') return;
    if (page < 1 || page > (el.__pagerTotalPages || 1)) return;
    el.__pagerGo(page);
}
