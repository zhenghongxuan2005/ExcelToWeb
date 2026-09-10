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

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    toast.addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);
    // 包含校验明细的错误提示内容较长，给更长的阅读时间，并支持点击关闭
    const duration = type === 'error' ? 8000 : 3200;
    setTimeout(() => toast.remove(), duration);
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
