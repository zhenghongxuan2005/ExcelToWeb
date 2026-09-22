// pivot_test.js 的装配件：极简 DOM（带真实 select 语义）+ 可手工回应的 fetch 桩 + vm 沙箱。
// 放在 helpers/ 子目录，避免被 tests/run.py 的 frontend/*.js 通配当成用例执行。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_ROOT = path.join(__dirname, '..', '..', '..', 'ExcelToWeb', 'wwwroot', 'js');

function makeClassList() {
    const set = new Set();
    return {
        add: c => set.add(c),
        remove: c => set.delete(c),
        toggle: (c, on) => { if (on) set.add(c); else set.delete(c); },
        contains: c => set.has(c)
    };
}

function makeBox(id) {
    return {
        id, style: {}, value: '', textContent: '', innerHTML: '',
        classList: makeClassList(),
        appendChild(c) { return c; },
        removeChild(c) { return c; },
        remove() {}, setAttribute() {}, addEventListener() {}
    };
}

/**
 * select 的最小实现：innerHTML 里解析出 option，value 未显式赋值时回落到第一个 option
 * —— 浏览器的实际行为就是这样，不模拟的话「默认选中第一个数值列」这条根本测不出来。
 */
function makeSelect(id) {
    return {
        id,
        _value: null,
        _options: [],
        get value() {
            if (this._value !== null && this._options.some(o => o.value === this._value)) return this._value;
            return this._options.length ? this._options[0].value : '';
        },
        set value(v) { this._value = (v === null || v === undefined) ? null : String(v); },
        get innerHTML() { return this._html || ''; },
        set innerHTML(html) {
            this._html = String(html);
            this._options = [...this._html.matchAll(/<option value="([^"]*)"/g)].map(m => ({ value: m[1] }));
        }
    };
}

const SELECT_IDS = ['pivotRowField', 'pivotColField', 'pivotValueField', 'pivotAgg'];

/**
 * @param {{files: string[], api: string[]}} opts
 *   files - 按序拼接的 wwwroot/js 模块名（通常 state.js / utils.js / api.js / pivot.js）
 *   api   - 需要从 bundle 里取出来的标识符
 */
function createPivotHarness(opts) {
    const els = {};
    function getEl(id) {
        if (!els[id]) els[id] = SELECT_IDS.indexOf(id) !== -1 ? makeSelect(id) : makeBox(id);
        return els[id];
    }

    const documentStub = {
        addEventListener() {},
        getElementById: id => getEl(id),
        createElement: () => makeBox('created'),
        querySelectorAll() { return []; },
        querySelector() { return null; },
        body: { appendChild(c) { return c; }, removeChild(c) { return c; } }
    };

    // fetch 桩：只记录请求，由用例决定何时、以什么内容回应 —— 这样才能模拟
    // 「先发的请求后回来」和「400 里带着能看懂的 message」这两种真实情况。
    const fetchCalls = [];
    const pending = [];
    function fetchStub(url, options) {
        fetchCalls.push({ url, opts: options || {} });
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        pending.push({ resolve, url });
        return promise;
    }

    const sandbox = {
        console, setTimeout, clearTimeout, document: documentStub, fetch: fetchStub,
        localStorage: { getItem: k => (k === 'token' ? 'T' : null), setItem() {}, removeItem() {} },
        location: { href: '' },
        URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
        navigator: {}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const ctx = vm.createContext(sandbox);
    vm.runInContext(
        opts.files.map(f => '\n/* ' + f + ' */\n' + fs.readFileSync(path.join(JS_ROOT, f), 'utf8')).join('\n;\n')
        // showToast / setStatus / downloadBlob 全换成记录器：用例关心的是「提示了什么、
        // 下载了什么文件」，而不是 Toast 的 DOM 长什么样
        + '\n;globalThis.__toasts = []; globalThis.__status = []; globalThis.__downloads = [];'
        + '\n;function showToast(msg, type) { __toasts.push(msg + (type ? "|" + type : "")); }'
        + '\n;function setStatus(s) { __status.push(s); }'
        + '\n;function downloadBlob(blob, filename) { __downloads.push({ blob, filename }); }'
        + '\n;globalThis.__api = { ' + opts.api.join(', ') + ' };',
        ctx, { filename: 'bundle.js' }
    );

    const run = code => vm.runInContext(code, ctx);
    const read = expr => vm.runInContext(expr, ctx);

    return {
        api: sandbox.__api,
        ctx, getEl, run, read,
        toasts: () => read('__toasts'),
        downloads: () => read('__downloads'),
        status: () => read('__status'),
        resetLogs: () => run('__toasts.length = 0; __status.length = 0;'),
        fetchCalls,
        /** 回应第 i 个请求（fetchCalls 与 pending 一一对应，下标就是请求序号） */
        respond(i, status, body) {
            pending[i].resolve({
                ok: status >= 200 && status < 300,
                status,
                json: () => Promise.resolve(body),
                blob: () => Promise.resolve({ _blob: true })
            });
        },
        lastCall: () => fetchCalls[fetchCalls.length - 1],
        /** 冲掉微任务队列，让已 resolve 的 promise 链跑完 */
        flush: () => new Promise(r => setImmediate(r))
    };
}

module.exports = { createPivotHarness };
