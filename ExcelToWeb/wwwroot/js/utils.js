// ================================================================
// 通用工具函数：提示、状态栏、列类型判断、时间格式化、HTML 转义
// 依赖：state.js（读取 currentRows 等全局状态）
// 说明：本文件被所有页面共用，必须早于 view.js / render.js / rules.js 加载。
// ================================================================

/** HTML 转义，防止 XSS（所有拼接进 innerHTML 的用户数据都必须先过一遍） */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** 取（或创建）消息提示的容器，使多条提示纵向排列而不是互相重叠 */
function getToastHost() {
    let host = document.getElementById('toastHost');
    if (!host) {
        host = document.createElement('div');
        host.id = 'toastHost';
        host.className = 'toast-host';
        // 让屏幕阅读器能播报提示内容
        host.setAttribute('aria-live', 'polite');
        host.setAttribute('aria-atomic', 'false');
        document.body.appendChild(host);
    }
    return host;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    // 错误提示用 alert 角色，立即被读到；其余用 status，避免打断用户
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    // 包含校验明细的错误提示内容较长，给更长的阅读时间，并支持点击关闭
    const duration = type === 'error' ? 8000 : 3200;

    let timer = null;
    const dismiss = () => {
        clearTimeout(timer);
        toast.classList.add('toast-out');
        // 等淡出动画结束再移除；animationend 兜底防止事件未触发导致节点残留
        const remove = () => toast.remove();
        toast.addEventListener('transitionend', remove, { once: true });
        setTimeout(remove, 400);
    };

    toast.addEventListener('click', dismiss);
    getToastHost().appendChild(toast);
    timer = setTimeout(dismiss, duration);
}

function setStatus(text) {
    const el = document.getElementById('statusText');
    if (el) el.textContent = text;
}

function isDateColumnName(name) {
    if (!name) return false;
    const keywords = ['日期', '时间', '日', 'date', 'time', '创建', '更新', '成交', '出生', '入职'];
    return keywords.some(k => name.indexOf(k) !== -1);
}

/** 判定某列是否为数值列：抽样非空值必须全部可解析为数字（用于颜色规则选列、统计栏） */
function isNumericColumn(name) {
    if (!name || currentRows.length === 0) return false;
    let checked = 0;
    const sample = currentRows.slice(0, 50);
    for (const row of sample) {
        const raw = row[name];
        if (raw === undefined || raw === null) continue;
        const val = String(raw).trim();
        if (val === '') continue;
        checked++;
        if (isNaN(Number(val))) return false;
    }
    return checked > 0;
}

function formatTime(dateStr) {
    if (!dateStr) return '未知时间';
    try {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch {
        return dateStr;
    }
}

// ================================================================
// 表格外观偏好（挂在文档根元素上，样式统一由 CSS 控制）
// 放在 utils.js 是因为「表格编辑」与「设置」两个页面都要用到。
// ================================================================

/**
 * 表格密度：compact 紧凑 / comfortable 舒适（默认）/ spacious 宽松。
 * 传其它值一律回落到 comfortable，避免脏数据把表格样式弄坏。
 */
function applyDensity(mode) {
    const allowed = ['compact', 'comfortable', 'spacious'];
    const value = allowed.indexOf(mode) !== -1 ? mode : 'comfortable';
    if (value === 'comfortable') {
        document.documentElement.removeAttribute('data-density');
    } else {
        document.documentElement.setAttribute('data-density', value);
    }
}

/** 网格线开关：关闭时移除行分隔线，让表格更接近「无边框」的看板观感 */
function applyGridLines(on) {
    if (on) {
        document.documentElement.removeAttribute('data-grid');
    } else {
        document.documentElement.setAttribute('data-grid', 'off');
    }
}
