// 验证前端脚本拆分后「加载期」接线是否完整：
//   1) 按 index.html 的顺序拼接所有 JS，在同一个全局作用域内一次求值
//      —— 可捕获重复声明、以及 app.js 中 Object.assign(window, {...}) 的 ReferenceError
//   2) 在打包代码内部直接探针 state.js 的 let 绑定是否真的可见（let 不进全局对象，必须在同作用域内探测）
//   3) 抽取 index.html 内联事件处理器名，确认已挂到 window
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map(m => m[1])
    .filter(s => !/^https?:/.test(s));

console.log('按 HTML 顺序加载：' + order.join(' -> '));

function makeEl() {
    return {
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        children: [], value: '', textContent: '', innerHTML: '', checked: false, files: [],
        firstChild: null, parentNode: null,
        appendChild(c) { return c; }, removeChild(c) { return c; }, remove() {},
        insertBefore(c) { return c; }, replaceChild(c) { return c; },
        setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
        addEventListener() {}, removeEventListener() {},
        querySelectorAll() { return []; }, querySelector() { return null; },
        matches() { return false; }, closest() { return null; },
        focus() {}, blur() {}, click() {}, insertAdjacentHTML() {}, scrollIntoView() {}
    };
}
const document = {
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; },
    createElement() { return makeEl(); }, createElementNS() { return makeEl(); },
    createTextNode(t) { return { textContent: t }; },
    body: makeEl(), head: makeEl(), documentElement: makeEl(),
    readyState: 'complete'
};
const store = {};
const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, document,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { href: 'http://localhost:5185/index.html', origin: 'http://localhost:5185', pathname: '/index.html', search: '', hash: '', reload() {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    confirm: () => true, alert: () => {}, prompt: () => null,
    navigator: { userAgent: 'node' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: cb => setTimeout(cb, 0),
    Element: function () {}, Node: function () {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const STATE_PROBE = ['currentRows', 'currentHeaders', 'allTables', 'undoHistory', 'ruleColumnName',
 'searchKeyword', 'pageSize', 'currentPage', 'hiddenColumns', 'columnWidths', 'rangeAnchor',
 'filterColumn', 'filterMode', 'filterValues', 'sortKeys'];
const EXPOSED = ['addRow','deleteSelectedRows','batchEdit','confirmBatchEdit','closeBatchModal',
 'clearAll','sortBy','removeSortKey','clearSort','applyDateFilter','clearDateFilter',
 'openFilter','closeFilter','applyFilter','clearFilter',
 'setFilterMode','filterSelectAll','onFilterValueSearch','updateFilterValueCount',
 'openRuleModal','closeRuleModal','addRuleRow','removeRule','moveRuleUp','moveRuleDown','saveRules',
 'openValidationModal','closeValidationModal','addValidationRule','saveValidationRules',
 'uploadWithValidation','toggleAllCheckboxes',
 'exportExcel','exportCsv','exportViewCsv','downloadTemplate',
 'refreshData','saveData','switchTable','deleteCurrentTable','handleLogout',
 'undo','redo',
 'onSearchInput','clearSearch','gotoPage','setPageSize',
 'toggleColumn','setColumnWidth','showAllColumns',
 'updateSelectionStats',
 'copyRangeSelection','clearRangeContent','clearRange'];

const bundle = order
    .map(src => '\n/* ==== ' + src + ' ==== */\n' + fs.readFileSync(path.join(ROOT, src), 'utf8'))
    .join('\n;\n')
    // 探针必须与业务代码同处一个全局词法作用域，否则看不到 let 绑定
    + '\n;\nglobalThis.__probe = {\n'
    + '  state: { ' + STATE_PROBE.map(n => n + ': typeof ' + n).join(', ') + ' },\n'
    + '  fn: { ' + EXPOSED.map(n => n + ': typeof ' + n).join(', ') + ' }\n'
    + '};\n';

const ctx = vm.createContext(sandbox);
let loadError = null;
try {
    vm.runInContext(bundle, ctx, { filename: 'bundle.js' });
    console.log('加载期求值：通过（无语法错误 / 无重复声明 / 无 ReferenceError）');
} catch (e) {
    loadError = e;
    console.log('加载期求值：失败 -> ' + e.name + ': ' + e.message);
}

const probe = sandbox.__probe;
if (!probe) {
    console.log('probe 未生成（说明整段脚本没能执行到最后）');
}
const st = (probe && probe.state) || {};
const fn = (probe && probe.fn) || {};
console.log('state.js 绑定实际类型：' + STATE_PROBE.map(n => n + '=' + st[n]).join(', '));
const badState = STATE_PROBE.filter(n => st[n] === undefined);
console.log('state.js 全局绑定探针（' + STATE_PROBE.length + ' 项）：' + (badState.length ? '未定义 -> ' + badState.join(', ') : '全部可见'));
const badFn = EXPOSED.filter(n => fn[n] !== 'function');
console.log('app.js 暴露名单（' + EXPOSED.length + ' 项）：' + (badFn.length ? '缺失 -> ' + badFn.join(', ') : '全部为函数'));

const handlers = new Set();
for (const m of html.matchAll(/\bon(?:click|change|input|keyup|keydown|blur|focus)="\s*([A-Za-z_$][\w$]*)\s*\(/g)) handlers.add(m[1]);
const missing = [...handlers].filter(h => typeof sandbox[h] !== 'function').sort();
console.log('index.html 内联处理器（' + handlers.size + ' 个）：' + (missing.length ? '未挂载 -> ' + missing.join(', ') : '全部已挂载'));

const ok = !loadError && badState.length === 0 && badFn.length === 0 && missing.length === 0;
console.log('\n================ ' + (ok ? '全部通过' : '存在失败项') + ' ================');
process.exitCode = ok ? 0 : 1;
