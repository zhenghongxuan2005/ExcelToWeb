// ================================================================
// 全局状态 + 认证（JWT）+ 颜色规则
// ----------------------------------------------------------------
// 相关模块：
//   utils.js   通用工具（提示 / 状态栏 / 列类型 / 时间）
//   history.js 撤销重做
//   tables.js  表格列表管理（加载 / 切换 / 删除 / 刷新）
//   io.js      保存、导出、下载模板、全选
// 说明：本文件必须最先加载，它声明了其余模块共用的全局状态。
// ================================================================

// ----- 状态 -----
let allTables = [];
let currentTableId = null;
let currentHeaders = [];
let currentRows = [];
let sortField = null;
let sortOrder = 1;

let colorRulesCache = [];
let ruleColumnName = '数量';

let undoHistory = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

let filterColumn = null;
let originalRows = [];

let currentValidationRules = [];
let currentRules = [];

// ----- 视图设置（只影响显示，不改动 currentRows） -----
let searchKeyword = '';      // 全局搜索关键词
let pageSize = 0;            // 每页行数，0 表示「全部」（不分页）
let currentPage = 1;
let hiddenColumns = [];      // 被隐藏的列名
let columnWidths = {};       // 列名 -> 列宽(px)

// ================================================================
// 认证（JWT）
// ================================================================
function checkLogin() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    const username = localStorage.getItem('username');
    const userInfoEl = document.getElementById('userInfo');
    if (userInfoEl && username) {
        userInfoEl.textContent = username;
    }
    getCurrentUser()
        .then(() => loadTableList())
        .catch(() => {
            localStorage.removeItem('token');
            localStorage.removeItem('username');
            window.location.href = '/login.html';
        });
}

function handleLogout() {
    if (!confirm('确定要退出登录吗？')) return;
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    window.location.href = '/login.html';
}

// ================================================================
// 颜色规则
// ================================================================
/** 一次性加载当前用户的全部颜色规则（不按列过滤），使所有设过规则的列都能正确着色 */
function loadColorRules() {
    return fetchColorRules()
        .then(rules => {
            colorRulesCache = rules || [];
            return colorRulesCache;
        })
        .catch(() => {
            colorRulesCache = [];
            return [];
        });
}

function getColorForValue(columnName, value) {
    if (!value || colorRulesCache.length === 0) return null;
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return null;
    for (const rule of colorRulesCache) {
        if (rule.columnName !== columnName) continue;
        const { minValue: min, maxValue: max } = rule;
        const isMatch = (max === null || max === undefined)
            ? numValue >= min
            : numValue >= min && numValue <= max;
        if (isMatch) return rule.colorCode;
    }
    return null;
}
