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

/**
 * 单元格文本 → 数字；不能安全数值化时返回 null。
 *
 * 注意这是「能否安全地当成数值」而不是「是不是数字」：前导零的编号（"007"）也是数字，
 * 但它不该被写成 Excel 数值（零会丢），所以这里按 null 处理。
 *
 * 口径逐条对齐后端 ExcelExportService.TryParseNumber —— 那里决定导出时写成数值还是
 * 文本，这里决定界面上算不算一个数（汇总行 / 选中统计 / 填充柄 / 排序 / 数值列判定）。
 * 两边一旦不一致，就会出现「界面上算得出数、导出的 Excel 里却是文本」这种自相矛盾。
 * 样例表在 tests/backend/number_export_test.py 与 tests/frontend/number_test.js，需同步维护。
 *
 * 与 Number() / parseFloat() 的差别（都是真会踩到的）：
 *   "007"   → null   前导零是编号 / 区号，数值化会丢零（后端同样拒绝）
 *   "1,000" → 1000   后端认千分位，而 Number("1,000") 是 NaN
 *   "1e3"   → null   后端不认科学计数法，而 Number("1e3") 是 1000
 *   "0x10"  → null   而 Number("0x10") 是 16
 *   18 位身份证号 → null   超过 Excel 的 15 位有效数字，会被写成科学计数法
 */
function parseSafeNumber(text) {
    if (text === null || text === undefined) return null;
    const s = String(text).trim();
    if (s === '') return null;

    // 可选符号 + 十进制数字（可带千分位）+ 小数点；不接受指数 / 十六进制 / Infinity
    if (!/^[+-]?(?:\.\d+|\d+(?:\.\d*)?|\d{1,3}(?:,\d{3})+(?:\.\d*)?)$/.test(s)) return null;

    const digits = s.replace(/^[+-]/, '');
    // 前导零："007" / "00.5"（第二位是小数点时才算正常小数，如 "0.5"）
    if (digits.length > 1 && digits[0] === '0' && digits[1] !== '.') return null;
    // Excel 只有 15 位有效数字，更长的整数会被写成科学计数法
    if (digits.split('.')[0].replace(/,/g, '').length > 15) return null;

    const n = Number(s.replace(/,/g, ''));
    return isFinite(n) ? n : null;
}

/** 该值能否安全地当成数字（判定细节见 parseSafeNumber） */
function isSafeNumber(text) {
    return parseSafeNumber(text) !== null;
}

/** 判定某列是否为数值列：抽样非空值必须全部可安全数值化（用于颜色规则选列、统计栏） */
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
        if (!isSafeNumber(val)) return false;
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
