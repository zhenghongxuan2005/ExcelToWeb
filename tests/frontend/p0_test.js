// P0「向 Excel 靠拢」专项冒烟测试
// 在同一个全局词法作用域里求值全部前端脚本，然后直接驱动新加的纯逻辑：
//   汇总行（aggregate.js）/ 查找替换（findreplace.js）/ 行操作（edit.js）/ 键盘导航（keyboard.js）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra) : '')); }
}

// ---------- 可编程的 DOM 桩 ----------
const els = {};      // getElementById 的返回值
const nodes = {};    // querySelectorAll 的返回值（按选择器）

function makeEl() {
    return {
        style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', checked: false, files: [],
        firstChild: null, parentNode: null, selectionStart: 0, selectionEnd: 0,
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild(c) { return c; }, removeChild(c) { return c; }, remove() {},
        insertBefore(c) { return c; }, replaceChild(c) { return c; },
        setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
        addEventListener() {}, removeEventListener() {},
        querySelectorAll() { return []; }, querySelector() { return null; },
        matches() { return false; }, closest() { return null; },
        focus() {}, blur() {}, click() {}, insertAdjacentHTML() {}, scrollIntoView() {}, select() {},
        setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    };
}

const document = {
    addEventListener() {}, removeEventListener() {},
    activeElement: null,
    getElementById: id => els[id] || null,
    querySelectorAll: sel => nodes[sel] || [],
    querySelector: () => null,
    createElement: () => makeEl(), createElementNS: () => makeEl(),
    createTextNode: t => ({ textContent: t }),
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

const bundle = order.map(src => '\n/* ==== ' + src + ' ==== */\n' + fs.readFileSync(path.join(ROOT, src), 'utf8')).join('\n;\n');
const ctx = vm.createContext(sandbox);
vm.runInContext(bundle, ctx, { filename: 'bundle.js' });

const setVar = expr => vm.runInContext(expr, ctx);
const setRows = rows => setVar('currentRows = ' + JSON.stringify(rows));
const getRows = () => vm.runInContext('currentRows', ctx);
const names = () => getRows().map(r => r.name !== undefined ? r.name : Object.values(r)[0]);

// ================================================================
console.log('\n=== A. 汇总行（aggregate.js） ===');
// ================================================================
setVar("currentHeaders = ['name','amount','code']");
setVar('hiddenColumns = []');
setVar('searchKeyword = ""');
setVar('sortKeys = []');
setRows([
    { name: 'apple', amount: '10', code: '1' },
    { name: 'banana', amount: '20', code: '2' },
    { name: 'cherry', amount: '30', code: 'x' },
    { name: 'avocado', amount: '40', code: '4' }
]);

setVar('aggregateMode = "sum"');
check('求和 = 100', vm.runInContext('computeColumnAggregate("amount", buildDisplayRows())', ctx) === 100);
setVar('aggregateMode = "avg"');
check('平均 = 25', vm.runInContext('computeColumnAggregate("amount", buildDisplayRows())', ctx) === 25);
setVar('aggregateMode = "count"');
check('计数 = 4', vm.runInContext('computeColumnAggregate("amount", buildDisplayRows())', ctx) === 4);
check('计数可用于文本列（name 列 = 4）', vm.runInContext('computeColumnAggregate("name", buildDisplayRows())', ctx) === 4);
setVar('aggregateMode = "max"');
check('最大值 = 40', vm.runInContext('computeColumnAggregate("amount", buildDisplayRows())', ctx) === 40);
setVar('aggregateMode = "min"');
check('最小值 = 10', vm.runInContext('computeColumnAggregate("amount", buildDisplayRows())', ctx) === 10);

setVar('aggregateMode = "sum"');
check('文本列不参与求和（返回 null）', vm.runInContext('computeColumnAggregate("name", buildDisplayRows())', ctx) === null);
check('混入非数字的列不参与求和（code 列 → null）', vm.runInContext('computeColumnAggregate("code", buildDisplayRows())', ctx) === null);

// SUBTOTAL 语义：随全局搜索联动，而不是统计全量
setVar('searchKeyword = "a"');
const searched = vm.runInContext('buildDisplayRows().length', ctx);
check('搜索 "a" 命中 3 行', searched === 3, searched);
check('求和随搜索联动 = 70（10+20+40）', vm.runInContext('computeColumnAggregate("amount", buildDisplayRows())', ctx) === 70);
setVar('searchKeyword = ""');

setVar('aggregateMode = "off"');
check('关闭时汇总行 HTML 为空串', vm.runInContext('buildAggregateRowHtml(["name","amount"])', ctx) === '');
setVar('aggregateMode = "sum"');
const aggHtml = vm.runInContext('buildAggregateRowHtml(["name","amount"])', ctx);
check('开启时生成 tfoot.aggregate-row', aggHtml.indexOf('<tfoot>') === 0 && aggHtml.indexOf('aggregate-row') !== -1, aggHtml.slice(0, 60));
check('汇总行含汇总方式下拉与冻结列占位', aggHtml.indexOf('aggregate-select') !== -1 && aggHtml.indexOf('col-pin-1') !== -1);
check('汇总行渲染出两列数值单元格', (aggHtml.match(/aggregate-cell/g) || []).length >= 2);
setVar('aggregateMode = "off"');

// ================================================================
console.log('\n=== B. 查找替换（findreplace.js） ===');
// ================================================================
check('替换：忽略大小写替换全部', vm.runInContext('replaceInText("abcABC","abc","X")', ctx) === 'XX');
setVar('findCaseSensitive = true');
check('替换：区分大小写只换命中项', vm.runInContext('replaceInText("abcABC","abc","X")', ctx) === 'XABC');
setVar('findCaseSensitive = false');
check('替换：正则特殊字符按字面处理', vm.runInContext('replaceInText("a.b aXb","a.b","Z")', ctx) === 'Z aXb');
check('替换：空查找词原样返回', vm.runInContext('replaceInText("abc","","X")', ctx) === 'abc');

setVar("currentHeaders = ['name','amount']");
setRows([
    { name: 'foo', amount: '1' },
    { name: 'foobar', amount: '2' },
    { name: 'baz', amount: '3' }
]);
check('查找命中计数 = 2（foo / foobar）', vm.runInContext('collectFindMatches("foo").length', ctx) === 2);
check('查找命中计数 = 0 时返回空数组', vm.runInContext('collectFindMatches("zzz").length', ctx) === 0);

// 驱动 replaceAll：需要把输入框塞进 getElementById
els.findKeyword = { value: 'foo' };
els.findReplace = { value: 'X' };
els.findCaseSensitive = { checked: false };
const histBefore = vm.runInContext('undoHistory.length', ctx);
vm.runInContext('replaceAll()', ctx);
const afterRows = getRows();
check('全部替换：2 处都被替换', afterRows[0].name === 'X' && afterRows[1].name === 'Xbar', afterRows.map(r => r.name));
check('全部替换：未命中行不受影响', afterRows[2].name === 'baz');
check('全部替换：可撤销（压入一条历史快照）', vm.runInContext('undoHistory.length', ctx) === histBefore + 1);
vm.runInContext('undo()', ctx);
check('仅一次操作也能撤销（pushHistory 在修改前调用，记录了原状态）', getRows()[0].name === 'foo', getRows()[0].name);
vm.runInContext('redo()', ctx);
check('redo() 可重做回替换后的状态', getRows()[0].name === 'X', getRows()[0].name);

// 空关键词不应产生替换
els.findKeyword = { value: '' };
const beforeEmpty = JSON.stringify(getRows());
vm.runInContext('replaceAll()', ctx);
check('空查找词：不执行替换', JSON.stringify(getRows()) === beforeEmpty);

// ================================================================
console.log('\n=== E. 撤销 / 重做（history.js 双栈语义） ===');
// ================================================================
// 关注 history.js 本身的行为契约，不依赖任何具体调用方。
setVar("currentHeaders = ['name']");
vm.runInContext('resetHistory()', ctx);
check('resetHistory：两栈清空',
    vm.runInContext('undoHistory.length + redoHistory.length', ctx) === 0);

// 一次操作：pushHistory（记录原状态）-> 改数据
setRows([{ name: 'A' }]);
vm.runInContext('pushHistory()', ctx);
setRows([{ name: 'A' }, { name: 'B' }]);
vm.runInContext('undo()', ctx);
check('仅一次操作也可撤销：回到 1 行',
    getRows().length === 1, getRows().length);
vm.runInContext('undo()', ctx);
check('撤销栈空：数据不变', getRows().length === 1);
vm.runInContext('redo()', ctx);
check('重做：回到 2 行', getRows().length === 2, getRows().length);
vm.runInContext('redo()', ctx);
check('重做栈空：数据不变', getRows().length === 2);

// 连续操作逐步回退
vm.runInContext('resetHistory()', ctx);
setRows([{ name: 'A' }]);
vm.runInContext('pushHistory()', ctx); setRows([{ name: 'AB' }]);
vm.runInContext('pushHistory()', ctx); setRows([{ name: 'ABC' }]);
vm.runInContext('undo()', ctx);
check('回退一步 -> AB', names().join('') === 'AB', names());
vm.runInContext('undo()', ctx);
check('回退两步 -> A', names().join('') === 'A', names());
vm.runInContext('redo()', ctx);
check('前进一步 -> AB', names().join('') === 'AB', names());

// 新分支清空重做栈
vm.runInContext('pushHistory()', ctx); setRows([{ name: 'X' }]);
check('新操作清空重做栈',
    vm.runInContext('redoHistory.length', ctx) === 0,
    vm.runInContext('redoHistory.length', ctx));

// 撤销栈封顶 MAX_HISTORY（50）
vm.runInContext('resetHistory()', ctx);
for (let i = 0; i < 60; i++) vm.runInContext('pushHistory()', ctx);
check('撤销栈封顶 MAX_HISTORY(50)',
    vm.runInContext('undoHistory.length', ctx) === 50,
    vm.runInContext('undoHistory.length', ctx));

// 切换表格/刷新必须重置撤销栈（直接调用 resetHistory 模拟）
vm.runInContext('undo()', ctx);   // 撤销一次，把当前状态压入 redoHistory
check('撤销一次后 redoStack 非空',
    vm.runInContext('redoHistory.length', ctx) > 0,
    vm.runInContext('redoHistory.length', ctx));
vm.runInContext('resetHistory()', ctx);
check('resetHistory 同时清空 redoStack',
    vm.runInContext('undoHistory.length + redoHistory.length', ctx) === 0);

// ================================================================
console.log('\n=== C. 行操作（edit.js） ===');
// ================================================================
function selectRows(indexes) {
    nodes['.row-checkbox'] = indexes.map(i => ({ checked: true, dataset: { index: String(i) } }));
}
setVar('currentTableId = 1');
setVar("currentHeaders = ['name']");
setVar('pageSize = 0');
setVar('currentPage = 1');
setVar('searchKeyword = ""');
setVar('sortKeys = []');
setRows([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }]);

selectRows([2]);
vm.runInContext('insertRowsAbove()', ctx);
check('插入行：长度 5 -> 6', getRows().length === 6, getRows().length);
check('插入行：插入到第 3 行位置且为空行', getRows()[2].name === '' && getRows()[3].name === 'C', names());
check('插入行：后续行顺序不变', getRows().map(r => r.name).join('') === 'AB__CDE'.replace('__', ''), names());

setRows([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }]);
selectRows([1, 3]);
vm.runInContext('insertRowsAbove()', ctx);
check('插入行：多选 2 行则插入 2 行', getRows().length === 7, getRows().length);

setRows([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }]);
selectRows([2, 3]);
vm.runInContext('moveSelectedRows(1)', ctx);
check('下移相邻块 [C,D] -> A,B,E,C,D', names().join('') === 'ABECD', names());

setRows([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }]);
selectRows([2, 3]);
vm.runInContext('moveSelectedRows(-1)', ctx);
check('上移相邻块 [C,D] -> A,C,D,B,E', names().join('') === 'ACDBE', names());

setRows([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
selectRows([2]);
vm.runInContext('moveSelectedRows(1)', ctx);
check('末行下移：不变化', names().join('') === 'ABC', names());

setRows([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
selectRows([0]);
vm.runInContext('moveSelectedRows(-1)', ctx);
check('首行上移：不变化', names().join('') === 'ABC', names());

setRows([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
selectRows([0, 1, 2]);
vm.runInContext('moveSelectedRows(1)', ctx);
check('全选下移：不变化（无落脚点）', names().join('') === 'ABC', names());

// ================================================================
console.log('\n=== D. 键盘导航（keyboard.js） ===');
// ================================================================
setVar("currentHeaders = ['A','B']");
setVar('hiddenColumns = []');
setVar('pageSize = 0');
setVar('currentPage = 1');
setRows([{ name: 'r0', A: '', B: '' }, { name: 'r1', A: '', B: '' }]);

function makeInput(key, index) {
    const inp = makeEl();
    inp.dataset = { key: key, index: String(index) };
    inp.value = '';
    inp.selectionStart = 0;
    inp.selectionEnd = 0;
    inp.classList = { add() {}, remove() {}, toggle() {}, contains: c => c === 'cell-input' };
    inp.focus = () => { document.activeElement = inp; };
    inp.closest = sel => (sel === 'tr' ? inp._tr : (sel === 'table' ? inp._table : null));
    return inp;
}

const t0 = makeInput('A', 0), t1 = makeInput('B', 0);
const u0 = makeInput('A', 1), u1 = makeInput('B', 1);
const table = { querySelectorAll: sel => (sel === 'tbody tr' ? [tr0, tr1] : []) };
const tr0 = { querySelectorAll: sel => (sel === '.cell-input' ? [t0, t1] : []) };
const tr1 = { querySelectorAll: sel => (sel === '.cell-input' ? [u0, u1] : []) };
[t0, t1].forEach(i => { i._tr = tr0; i._table = table; });
[u0, u1].forEach(i => { i._tr = tr1; i._table = table; });
els.tableContainer = { querySelector: sel => (sel === 'table' ? table : null) };

function press(key, opts) {
    const o = opts || {};
    const ev = {
        key: key, target: document.activeElement,
        shiftKey: !!o.shift, ctrlKey: !!o.ctrl, altKey: !!o.alt, metaKey: !!o.meta,
        defaultPrevented: false,
        preventDefault() { ev.defaultPrevented = true; }
    };
    vm.runInContext('handleCellKeydown', ctx)(ev);
    return ev;
}

document.activeElement = t0;
press('Enter');
check('Enter 下移：A 列 row0 -> row1', document.activeElement === u0, document.activeElement === u0 ? 'ok' : 'moved elsewhere');

document.activeElement = t0;
press('Tab');
check('Tab 右移：A -> B（同一行）', document.activeElement === t1);

document.activeElement = t1;
press('Tab');
check('Tab 在行末：换行到下一行首列', document.activeElement === u0);

document.activeElement = u0;
press('Tab', { shift: true });
check('Shift+Tab：回到上一行末列', document.activeElement === t1);

document.activeElement = u0;
press('ArrowUp');
check('ArrowUp：上移一行', document.activeElement === t0);

document.activeElement = u0;
press('ArrowDown');
check('ArrowDown 在末行且不分页：停住不越界', document.activeElement === u0);

document.activeElement = t0;
press('Enter', { shift: true });
check('Shift+Enter 在首行：停住不越界', document.activeElement === t0);

document.activeElement = t0;
const evLeft = press('ArrowLeft');
check('ArrowLeft 光标已在首位：移动到上一格（行首则停住）', document.activeElement === t0 || document.activeElement === t1, evLeft.defaultPrevented);

document.activeElement = t1;
t1.selectionStart = 1; t1.selectionEnd = 1; t1.value = 'abc';
press('ArrowLeft');
check('ArrowLeft 光标不在首位：交给浏览器移动光标，不跳格', document.activeElement === t1);

document.activeElement = null;
const evNone = press('Enter');
check('焦点不在单元格时：完全不拦截', evNone.defaultPrevented === false);

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exitCode = fail === 0 ? 0 : 1;
