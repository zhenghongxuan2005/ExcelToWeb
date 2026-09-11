// 针对新增「视图管线」的纯逻辑单测：搜索 / 分页 / 列可见性 / CSV 转义
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot', 'js');
const FILES = ['state.js', 'utils.js', 'view.js', 'selection.js', 'io.js'];

function makeEl() {
    return {
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        children: [], value: '', textContent: '', innerHTML: '', checked: false,
        appendChild(c) { return c; }, removeChild(c) { return c; }, remove() {},
        setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
        querySelectorAll() { return []; }, querySelector() { return null; },
        focus() {}, blur() {}, click() {}
    };
}
const document = {
    addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; },
    querySelector() { return null; }, createElement() { return makeEl(); }, body: makeEl()
};
const sandbox = { console, setTimeout, clearTimeout, document, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, window: {} };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
vm.runInContext(
    FILES.map(f => '\n/* ' + f + ' */\n' + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
    // 渲染依赖 DOM，这里只需验证数据管线，直接打桩
    + '\n;function renderTable() {}'
    + '\n;globalThis.__api = { getSearchedRows, buildDisplayRows, getPagedRows, getTotalPages, getVisibleHeaders, cellMatchesSearch, csvCell, formatNumber, columnWidthStyle };',
    ctx, { filename: 'bundle.js' }
);
const api = sandbox.__api;

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
// 注意：state.js 里的 let 声明进入的是「全局词法环境」，不是 sandbox 对象属性，
// 所以必须用 runInContext 在同一作用域内赋值/读取，直接 sandbox.xxx = ... 是无效的。
function setState(rows, headers, extra) {
    sandbox.__rows = rows;
    sandbox.__headers = headers;
    sandbox.__extra = extra || {};
    vm.runInContext(`
        currentRows = __rows;
        currentHeaders = __headers;
        searchKeyword = '';
        pageSize = 0;
        currentPage = 1;
        hiddenColumns = [];
        columnWidths = {};
        sortField = null;
        sortOrder = 1;
    `, ctx);
    // 用显式赋值逐项覆盖，避免拼错变量名被静默忽略
    Object.keys(extra || {}).forEach(k => {
        vm.runInContext(`${k} = __extra[${JSON.stringify(k)}];`, ctx);
    });
}
const read = name => vm.runInContext(name, ctx);

const HEADERS = ['日期', '数量', '销售员'];
const ROWS = [
    { '日期': '2026-01-05', '数量': '10', '销售员': '张三' },
    { '日期': '2026-01-06', '数量': '3', '销售员': '李四' },
    { '日期': '2026-02-11', '数量': '8', '销售员': '王五' },
    { '日期': '2026-02-12', '数量': '25', '销售员': '张三' }
];

console.log('[1] 全局搜索');
setState(ROWS, HEADERS);
check('无关键词时返回全部行', api.getSearchedRows().length === 4);
setState(ROWS, HEADERS, { searchKeyword: '张三' });
check('跨列命中（销售员列）', api.getSearchedRows().length === 2, api.getSearchedRows().length);
setState(ROWS, HEADERS, { searchKeyword: '2026-02' });
check('跨列命中（日期列）', api.getSearchedRows().length === 2);
setState(ROWS, HEADERS, { searchKeyword: '王五' });
check('命中 1 行', api.getSearchedRows().length === 1);
setState(ROWS, HEADERS, { searchKeyword: '不存在的东西' });
check('无命中返回空数组', api.getSearchedRows().length === 0);
setState(ROWS, HEADERS, { searchKeyword: 'zhang' });
check('英文大小写不敏感（应无命中）', api.getSearchedRows().length === 0);

console.log('[2] 搜索高亮判定');
setState(ROWS, HEADERS, { searchKeyword: '张' });
check('单元格命中', api.cellMatchesSearch('销售员', '张三') === true);
check('单元格未命中', api.cellMatchesSearch('销售员', '李四') === false);
setState(ROWS, HEADERS);
check('无关键词时不高亮', api.cellMatchesSearch('销售员', '张三') === false);
check('空值不高亮', api.cellMatchesSearch('销售员', null) === false);

console.log('[3] 排序 + 搜索组合');
setState(ROWS, HEADERS, { sortField: '数量', sortOrder: 1 });
const asc = api.buildDisplayRows().map(r => r['数量']);
check('数值升序', asc.join(',') === '3,8,10,25', asc.join(','));
setState(ROWS, HEADERS, { sortField: '数量', sortOrder: -1 });
const desc = api.buildDisplayRows().map(r => r['数量']);
check('数值降序', desc.join(',') === '25,10,8,3', desc.join(','));
setState(ROWS, HEADERS, { sortField: '数量', sortOrder: 1, searchKeyword: '张三' });
const both = api.buildDisplayRows();
check('先搜索后排序：只含命中行且有序', both.length === 2 && both[0]['数量'] === '10' && both[1]['数量'] === '25',
    JSON.stringify(both.map(r => r['数量'])));

console.log('[4] 分页');
setState(ROWS, HEADERS, { pageSize: 2, currentPage: 1 });
check('第 1 页取 2 行', api.getPagedRows(api.buildDisplayRows()).length === 2);
check('总页数 = 2', api.getTotalPages(4) === 2);
vm.runInContext('currentPage = 2;', ctx);
check('第 2 页取剩余 2 行', api.getPagedRows(api.buildDisplayRows()).length === 2);
vm.runInContext('currentPage = 99;', ctx);
const clamped = api.getPagedRows(api.buildDisplayRows());
check('页码越界自动夹到末页', clamped.length === 2 && read('currentPage') === 2, 'currentPage=' + read('currentPage'));
vm.runInContext('currentPage = 0;', ctx);
api.getPagedRows(api.buildDisplayRows());
check('页码 <1 自动夹到 1', read('currentPage') === 1);
setState(ROWS, HEADERS, { pageSize: 0 });
check('pageSize=0（全部）不分页', api.getPagedRows(api.buildDisplayRows()).length === 4);
check('pageSize=0 时总页数为 1', api.getTotalPages(4) === 1);

console.log('[5] 列显示 / 隐藏');
setState(ROWS, HEADERS);
check('默认显示所有列', api.getVisibleHeaders().join(',') === '日期,数量,销售员');
setState(ROWS, HEADERS, { hiddenColumns: ['数量'] });
check('隐藏一列', api.getVisibleHeaders().join(',') === '日期,销售员');
setState(ROWS, HEADERS, { hiddenColumns: ['日期', '数量', '销售员'] });
check('全部隐藏时兜底为全部可见（避免空表格）', api.getVisibleHeaders().length === 3);
setState(ROWS, HEADERS, { columnWidths: { '数量': 120 } });
check('有列宽设置时输出内联样式', api.columnWidthStyle('数量').indexOf('120px') !== -1);
check('无列宽设置时不输出样式', api.columnWidthStyle('日期') === '');

console.log('[6] CSV 转义 / 数字格式化');
check('普通值不加引号', api.csvCell('张三') === '张三');
check('含逗号加引号', api.csvCell('a,b') === '"a,b"');
check('含双引号转义为两个双引号', api.csvCell('说"你好"') === '"说""你好"""');
check('含换行加引号', api.csvCell('a\nb') === '"a\nb"');
check('null -> 空串', api.csvCell(null) === '');
check('undefined -> 空串', api.csvCell(undefined) === '');
check('求和保留 2 位小数', api.formatNumber(10.126) === '10.13', api.formatNumber(10.126));
check('整数不带小数点', api.formatNumber(25) === '25');
check('非有限数返回 -', api.formatNumber(NaN) === '-');

console.log('\n================ ' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exitCode = fail === 0 ? 0 : 1;
