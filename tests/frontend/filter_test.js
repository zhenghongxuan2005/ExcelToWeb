// 列筛选（视图层）单测
// ----------------------------------------------------------------
// 核心回归：筛选只裁剪「显示」，绝不改写 currentRows。
// 历史实现把 currentRows 换成筛选结果，于是「筛选后点保存」会永久删掉
// 被筛掉的行 —— 这是会真实丢数据的缺陷，必须一直有用例守着。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot', 'js');
const FILES = ['state.js', 'utils.js', 'view.js', 'filter.js'];

// ================================================================
// 可编程 DOM 桩：只提供筛选真正会碰的两处
//   #filterDate        日期筛选输入框
//   #filterValueList   值清单（勾选状态由 fakeValueItems 驱动）
// ================================================================
let dateInputValue = '';
let fakeValueItems = [];

// 日期输入框必须是「同一个对象」，否则 resetFilter 写入的 .value = '' 会丢在临时对象上
const filterDateInput = {
    get value() { return dateInputValue; },
    set value(v) { dateInputValue = v; }
};

const documentStub = {
    addEventListener() {},
    getElementById(id) {
        if (id === 'filterDate') return filterDateInput;
        return null;
    },
    querySelectorAll(sel) {
        if (sel === '#filterValueList .filter-value-item') {
            return fakeValueItems.map(it => ({
                getAttribute: () => it.value,
                querySelector: () => ({ checked: it.checked })
            }));
        }
        return [];
    },
    querySelector() { return null; },
    createElement() { return {}; },
    body: {}
};

const sandbox = {
    console, setTimeout, clearTimeout,
    document: documentStub,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    __renders: 0,
    __toasts: [],
    __status: []
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
vm.runInContext(
    FILES.map(f => '\n/* ' + f + ' */\n' + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
    + '\n;globalThis.renderTable = function () { __renders++; };'
    + '\n;globalThis.showToast = function (m) { __toasts.push(m); };'
    + '\n;globalThis.setStatus = function (s) { __status.push(s); };'
    + '\n;globalThis.__api = { isFilterActive, rowPassesColumnFilter, getFilteredRows, buildDisplayRows,'
    + ' filterDistinctValues, filterSummaryText, resetFilter, guessDateColumn,'
    + ' applyFilter, clearFilter, applyDateFilter, setFilterMode, sortBy };',
    ctx, { filename: 'bundle.js' }
);
const api = sandbox.__api;

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}
const read = name => vm.runInContext(name, ctx);

const HEADERS = ['日期', '数量', '销售员'];
const ROWS = [
    { '日期': '2026-01-05', '数量': '10', '销售员': '张三' },
    { '日期': '2026-01-06', '数量': '3', '销售员': '李四' },
    { '日期': '2026-02-11', '数量': '8', '销售员': '王五' },
    { '日期': '2026-02-12', '数量': '25', '销售员': '张三' },
    { '日期': '2026-03-01', '数量': '12', '销售员': '赵六' }
];

function setState(rows, headers, extra) {
    sandbox.__rows = rows;
    sandbox.__headers = headers;
    sandbox.__extra = extra || {};
    vm.runInContext(`
        currentRows = __rows;
        currentHeaders = __headers;
        currentTableId = 1;
        searchKeyword = '';
        pageSize = 0;
        currentPage = 1;
        hiddenColumns = [];
        columnWidths = {};
        sortField = null;
        sortOrder = 1;
        filterColumn = null;
        filterMode = 'values';
        filterValues = null;
        filterCondition = 'contains';
        filterKeyword = '';
        __renders = 0;
        __toasts.length = 0;
        __status.length = 0;
    `, ctx);
    Object.keys(extra || {}).forEach(k => {
        vm.runInContext(`${k} = __extra[${JSON.stringify(k)}];`, ctx);
    });
}

const set = code => vm.runInContext(code, ctx);

console.log('[1] 值清单筛选');
setState(ROWS, HEADERS);
check('无筛选时不生效', api.isFilterActive() === false);
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: ['张三'] });
check('值筛选生效', api.isFilterActive() === true);
check('只保留勾选值', api.getFilteredRows().length === 2, api.getFilteredRows().length);
check('结果内容正确', api.getFilteredRows().every(r => r['销售员'] === '张三'));
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: ['张三', '李四'] });
check('多选值', api.getFilteredRows().length === 3, api.getFilteredRows().length);
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: [] });
check('空数组 = 结果为空集（不是「不筛选」）', api.isFilterActive() === true && api.getFilteredRows().length === 0);
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: null });
check('null = 不筛选', api.isFilterActive() === false && api.getFilteredRows().length === 5);

console.log('\n[2] 条件筛选（五种条件）');
const cond = (c, k) => {
    setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'condition', filterCondition: c, filterKeyword: k });
    return api.getFilteredRows().length;
};
check('包含「张」', cond('contains', '张') === 2, cond('contains', '张'));
check('不包含「张」', cond('notContains', '张') === 3, cond('notContains', '张'));
check('等于「张三」', cond('equals', '张三') === 2, cond('equals', '张三'));
check('开头是「赵」', cond('startsWith', '赵') === 1, cond('startsWith', '赵'));
check('结尾是「四」', cond('endsWith', '四') === 1, cond('endsWith', '四'));
check('关键词为空时不筛选', cond('contains', '') === 5);
setState([{ '销售员': 'ABC' }], ['销售员'],
    { filterColumn: '销售员', filterMode: 'condition', filterCondition: 'contains', filterKeyword: 'abc' });
check('条件筛选大小写不敏感', api.getFilteredRows().length === 1, api.getFilteredRows().length);

console.log('\n[3] 筛选不污染 currentRows（数据安全核心回归）');
setState(ROWS, HEADERS);
let snapshot = JSON.stringify(read('currentRows'));
set("filterColumn = '销售员'; filterMode = 'values'; filterValues = ['张三'];");
api.getFilteredRows();
api.buildDisplayRows();
check('读取筛选结果后 currentRows 一字未改', JSON.stringify(read('currentRows')) === snapshot);
check('currentRows 行数仍是 5', read('currentRows').length === 5, read('currentRows').length);
setState(ROWS, HEADERS);
api.setFilterMode('values');
set("filterColumn = '数量';");
fakeValueItems = [
    { value: '10', checked: true }, { value: '3', checked: false },
    { value: '8', checked: false }, { value: '25', checked: false }, { value: '12', checked: false }
];
api.applyFilter();
check('applyFilter 生效', api.isFilterActive() === true && api.buildDisplayRows().length === 1);
check('applyFilter 之后 currentRows 仍是 5 行（保存不会丢行）', read('currentRows').length === 5, read('currentRows').length);
check('applyFilter 触发重绘', sandbox.__renders >= 1);

console.log('\n[4] applyFilter 的三种勾选状态');
setState(ROWS, HEADERS);
api.setFilterMode('values');
set("filterColumn = '销售员';");
fakeValueItems = [
    { value: '张三', checked: true }, { value: '李四', checked: true },
    { value: '王五', checked: true }, { value: '赵六', checked: true }
];
api.applyFilter();
check('全部勾选 = 不筛选（等同清除）', api.isFilterActive() === false && api.buildDisplayRows().length === 5);

fakeValueItems = [
    { value: '张三', checked: true }, { value: '李四', checked: false },
    { value: '王五', checked: false }, { value: '赵六', checked: false }
];
api.applyFilter();
check('部分勾选 -> 只显示勾选值', api.buildDisplayRows().length === 2, api.buildDisplayRows().length);

fakeValueItems = [
    { value: '张三', checked: false }, { value: '李四', checked: false },
    { value: '王五', checked: false }, { value: '赵六', checked: false }
];
api.applyFilter();
check('一个都不勾 -> 空集（0 行），而非误显示全部', api.buildDisplayRows().length === 0);
check('空集也提示了结果为空', sandbox.__toasts.some(t => t.indexOf('没有勾选任何值') !== -1), JSON.stringify(sandbox.__toasts));

console.log('\n[5] 与全局搜索叠加（与关系）');
setState(ROWS, HEADERS, { filterColumn: '数量', filterMode: 'values', filterValues: ['3'], searchKeyword: '李四' });
check('同时满足搜索与筛选 -> 1 行', api.getFilteredRows().length === 1);
setState(ROWS, HEADERS, { filterColumn: '数量', filterMode: 'values', filterValues: ['3'], searchKeyword: '王五' });
check('只满足其一时为空', api.getFilteredRows().length === 0);

console.log('\n[6] 与排序叠加');
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: ['张三'], sortField: '数量', sortOrder: 1 });
check('先筛选后排序', api.buildDisplayRows().map(r => r['数量']).join(',') === '10,25',
    api.buildDisplayRows().map(r => r['数量']).join(','));
set("sortOrder = -1;");
check('降序', api.buildDisplayRows().map(r => r['数量']).join(',') === '25,10');

console.log('\n[7] resetFilter / 清除筛选');
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: ['张三'] });
dateInputValue = '2026-01-05';
api.resetFilter();
check('resetFilter 清掉列筛选', api.isFilterActive() === false);
check('resetFilter 一并清掉日期输入框', dateInputValue === '', JSON.stringify(dateInputValue));
check('resetFilter 后恢复全量', api.buildDisplayRows().length === 5);
check('resetFilter 后 filterSummaryText 为空', api.filterSummaryText() === '');
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: ['张三'] });
api.clearFilter();
check('clearFilter 清掉筛选并重绘', api.isFilterActive() === false);
check('clearFilter 触发重绘', sandbox.__renders >= 1);

console.log('\n[8] 筛选提示文案');
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: ['张三'] });
check('单值文案', api.filterSummaryText() === '销售员 = 张三', api.filterSummaryText());
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: ['张三', '李四'] });
check('双值文案', api.filterSummaryText() === '销售员 = 张三 / 李四', api.filterSummaryText());
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: ['张三', '李四', '王五'] });
check('多值文案折叠为个数', api.filterSummaryText() === '销售员 ∈ 3 个值', api.filterSummaryText());
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'values', filterValues: [] });
check('空集文案', api.filterSummaryText().indexOf('未勾选') !== -1, api.filterSummaryText());
setState(ROWS, HEADERS, { filterColumn: '销售员', filterMode: 'condition', filterCondition: 'startsWith', filterKeyword: '张' });
check('条件文案', api.filterSummaryText() === '销售员 开头是 张', api.filterSummaryText());

console.log('\n[9] 值清单去重统计');
setState(ROWS, HEADERS);
set("filterColumn = '销售员';");
const distinct = api.filterDistinctValues();
// 按 zh-CN 语序（拼音）：li / wang / zhang / zhao
check('去重并按中文语序排序', distinct.map(d => d.value).join(',') === '李四,王五,张三,赵六',
    distinct.map(d => d.value).join(','));
check('计数正确', distinct.find(d => d.value === '张三').count === 2);
setState(ROWS, HEADERS);
set("filterColumn = '日期';");
check('全不重复的列每项计数为 1', api.filterDistinctValues().every(d => d.count === 1));

console.log('\n[10] 日期列识别 + 日期筛选（视图层）');
setState(ROWS, HEADERS);
check('按列名识别日期列', api.guessDateColumn() === '日期', api.guessDateColumn());
setState([{ 'A': '2026-01-05' }, { 'A': '2026-01-06' }, { 'A': '2026-01-07' }], ['A', 'B', 'C']);
check('列名无线索时按取值形态识别', api.guessDateColumn() === 'A', api.guessDateColumn());
setState([{ '甲': 'x' }, { '乙': 'y' }], ['甲', '乙']);
check('都不是日期列时返回 null', api.guessDateColumn() === null, api.guessDateColumn());

setState(ROWS, HEADERS);
dateInputValue = '2026-01-05';
api.applyDateFilter();
check('日期筛选落在日期列上', read('filterColumn') === '日期');
check('日期筛选显示 1 行', api.buildDisplayRows().length === 1, api.buildDisplayRows().length);
check('日期筛选不改 currentRows', read('currentRows').length === 5, read('currentRows').length);

setState(ROWS, HEADERS);
dateInputValue = '';
api.applyDateFilter();
check('未选日期时不筛选', api.isFilterActive() === false);

setState([{ '甲': 'x' }], ['甲']);
dateInputValue = '2026-01-05';
api.applyDateFilter();
check('没有日期列时给出提示', sandbox.__toasts.some(t => t.indexOf('没有找到可用于日期筛选的列') !== -1),
    JSON.stringify(sandbox.__toasts));

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail === 0 ? 0 : 1);
