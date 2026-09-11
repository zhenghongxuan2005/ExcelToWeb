// range 系列前端测试共用的装配件：极简 DOM 模型（table/tr/td/input 四层）+ vm 沙箱。
// 放在 helpers/ 子目录，避免被 tests/run.py 的 frontend/*.js 通配当成测试脚本执行。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_ROOT = path.join(__dirname, '..', '..', '..', 'ExcelToWeb', 'wwwroot', 'js');

const STUB_GLOBALS = [
    // history.js / render.js 未加载，用计数器替代，方便断言「压栈了几次」「重绘了几次」
    'globalThis.pushHistory = function () { __hist.count++; };',
    'globalThis.renderTable = function () { __renders++; };',
    'globalThis.showToast = function (m) { __toasts.push(m); };',
    'globalThis.setStatus = function (s) { __status.push(s); };'
];

function makeClassList() {
    const set = new Set();
    return {
        add: c => set.add(c),
        remove: c => set.delete(c),
        contains: c => set.has(c),
        toggle: (c, on) => { if (on) set.add(c); else set.delete(c); },
        _set: set
    };
}

/**
 * 只渲染传入的 headers（调用方负责先滤掉隐藏列），与真实渲染一致 ——
 * 隐藏列在真实页面里根本不产出 td，测试若照渲染会让「按视口列号取 DOM」
 * 这类错位问题被掩盖。
 */
function buildTable(headers, rows, onFocus) {
    const trs = [];
    rows.forEach((rowObj, r) => {
        const cells = [];
        const tr = {
            _cells: cells,
            querySelectorAll(sel) {
                if (sel === '.cell-input') return cells.map(c => c.input);
                if (sel === 'td.editable-cell') return cells.map(c => c.td);
                return [];
            },
            querySelector(sel) {
                if (sel === '.cell-input') return cells.length ? cells[0].input : null;
                return null;
            }
        };
        headers.forEach(h => {
            const input = {
                dataset: { index: String(r), key: h },
                value: rowObj[h] === undefined || rowObj[h] === null ? '' : String(rowObj[h]),
                selectionStart: null,
                selectionEnd: null,
                classList: makeClassList(),
                parentElement: null,
                closest(sel) { return sel === 'tr' ? tr : null; },
                querySelector() { return null; },
                addEventListener() {},
                focus() { onFocus(input); },
                blur() { onFocus(null); },
                setSelectionRange(a, b) { input.selectionStart = a; input.selectionEnd = b; }
            };
            const td = {
                classList: makeClassList(),
                querySelector(sel) { return sel === '.cell-input' ? input : null; }
            };
            // isCellInput() 靠这个类名判断，缺了会让键盘 / 选区的分支全部走偏
            input.classList.add('cell-input');
            td.classList.add('editable-cell');
            input.parentElement = td;
            cells.push({ input: input, td: td });
        });
        trs.push(tr);
    });
    return {
        _trs: trs,
        querySelectorAll(sel) { return sel === 'tbody tr' ? trs : []; },
        querySelector() { return trs[0] || null; }
    };
}

/**
 * @param {{files: string[], api: string[]}} opts
 *   files - 需要按序拼接的 wwwroot/js 模块名
 *   api   - 需要从 bundle 里导出的标识符
 */
function createHarness(opts) {
    let activeEl = null;
    const setActive = el => { activeEl = el; };

    const container = {
        _table: null,
        querySelector(sel) { return sel === 'table' ? container._table : null; },
        querySelectorAll() { return []; },
        contains() { return false; },
        addEventListener() {}
    };

    const rangeInfoHost = { innerHTML: '' };

    const documentStub = {
        addEventListener() {},
        getElementById(id) {
            if (id === 'tableContainer') return container;
            if (id === 'rangeInfo') return rangeInfoHost;
            return null;
        },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        createElement() { return {}; },
        body: { classList: makeClassList() },
        get activeElement() { return activeEl; }
    };

    const sandbox = {
        console, setTimeout, clearTimeout,
        document: documentStub,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        navigator: {},
        __hist: { count: 0 },
        __renders: 0,
        __toasts: [],
        __status: []
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const ctx = vm.createContext(sandbox);
    vm.runInContext(
        opts.files.map(f => '\n/* ' + f + ' */\n' + fs.readFileSync(path.join(JS_ROOT, f), 'utf8')).join('\n;\n')
        + '\n;' + STUB_GLOBALS.join('\n;')
        + '\n;globalThis.__api = { ' + opts.api.join(', ') + ' };',
        ctx, { filename: 'bundle.js' }
    );

    const api = sandbox.__api;
    const read = name => vm.runInContext(name, ctx);

    let pass = 0, fail = 0;
    function check(name, cond, extra) {
        if (cond) { pass++; console.log('  PASS ' + name); }
        else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
    }

    /**
     * 重置表格 + 全局状态；DOM 的 data-index 与 currentRows 下标一一对应。
     * @param {string[]} [hidden] 隐藏列（DOM 里不渲染，与真实页面一致）
     */
    function setTable(headers, rows, hidden) {
        const hiddenList = (hidden || []).slice();
        container._table = buildTable(headers.filter(h => hiddenList.indexOf(h) === -1), rows, setActive);
        setActive(null);
        sandbox.__rows = rows.map(r => Object.assign({}, r));
        sandbox.__headers = headers;
        sandbox.__hidden = hiddenList;
        vm.runInContext(`
            currentRows = __rows;
            currentHeaders = __headers;
            currentTableId = 1;
            searchKeyword = '';
            pageSize = 0;
            currentPage = 1;
            hiddenColumns = __hidden;
            columnWidths = {};
            sortField = null;
            sortOrder = 1;
            rangeAnchor = null;
            rangeFocus = null;
            _rangeSig = null;
            __hist.count = 0;
            __renders = 0;
            __toasts.length = 0;
            __status.length = 0;
        `, ctx);
    }

    /** 直接改某个输入框的值（模拟用户手输，DOM 与 currentRows 脱钩） */
    function domValue(rowPos, colPos, v) {
        container._table._trs[rowPos]._cells[colPos].input.value = v;
    }

    function focusCell(rowPos, colPos) {
        const input = container._table._trs[rowPos]._cells[colPos].input;
        setActive(input);
        input.selectionStart = 0;
        input.selectionEnd = 0;
    }

    function summary() {
        console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
        process.exit(fail === 0 ? 0 : 1);
    }

    return {
        api, ctx, sandbox, container, rangeInfoHost,
        read, check, setTable, domValue, focusCell, setActive, summary, makeClassList
    };
}

module.exports = { createHarness, makeClassList };

module.exports.HEADERS = ['日期', '数量', '销售员'];
module.exports.ROWS = [
    { '日期': '2026-01-05', '数量': '10', '销售员': '张三' },
    { '日期': '2026-01-06', '数量': '3', '销售员': '李四' },
    { '日期': '2026-02-11', '数量': '8', '销售员': '王五' },
    { '日期': '2026-02-12', '数量': '25', '销售员': '张三' }
];
