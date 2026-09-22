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

// 排序键（唯一真源）：[{ field, order }]，order: 1 升序 / -1 降序。
// 数组顺序即优先级 —— 第 1 个键是主排序，其后依次为次级排序。
// 与筛选一样只影响显示（buildDisplayRows），绝不改写 currentRows。
let sortKeys = [];

let colorRulesCache = [];
let ruleColumnName = '数量';

let undoHistory = [];   // 撤销栈：存「修改前」的快照
let redoHistory = [];   // 重做栈：撤销时把当前状态转存到这里
const MAX_HISTORY = 50;

// ----- 列筛选（纯视图裁剪：只影响显示，绝不改 currentRows） -----
// 为什么死守这条：saveData() 保存的是整个 currentRows。一旦筛选时把
// currentRows 换成筛选结果，用户「筛选后点保存」就会永久删掉被筛掉的行。
let filterColumn = null;         // 参与筛选的列名，null 表示没有列筛选
let filterMode = 'values';       // 'values' 按值清单 | 'condition' 按条件
// 值清单模式下：null = 不筛选；[] = 一个值都没勾（结果为空集）；[...] = 只保留这些值。
// 必须区分 null 与 []，否则「一个都不勾」会被当成「不筛选」而显示全部行。
let filterValues = null;
let filterCondition = 'contains';
let filterKeyword = '';

let currentValidationRules = [];
let currentRules = [];

// 跨表引用的取值字典：列名 -> 引用表该列的去重值数组。
// 由 tables.js 在加载表格时随校验规则一起拉取；render.js 用它替换单元格建议列表。
let refValueMap = {};

// ----- 视图设置（只影响显示，不改动 currentRows） -----
let searchKeyword = '';      // 全局搜索关键词
let pageSize = 0;            // 每页行数，0 表示「全部」（不分页）
let currentPage = 1;
let hiddenColumns = [];      // 被隐藏的列名
let columnWidths = {};       // 列名 -> 列宽(px)

// 计算列：列名 -> 公式原文（没有公式的列不出现在这里）。
// 与 hiddenColumns / columnWidths 同属「随列元数据下发的列状态」，由 column-meta.js 填充。
// 判定「这格能不能手改」一律走 computed-column.js 的 isComputedColumn()，不要各处自己查。
let columnExprs = {};

// 汇总行方式：'off' 表示不显示；其余取值见 aggregate.js 的 AGG_MODES。
// 与其余视图状态同归口放这里，aggregate.js 只负责计算与交互。
let aggregateMode = 'off';

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
    const numValue = parseSafeNumber(value);
    if (numValue === null) return null;
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
