// P2 列元数据持久化（前端）单测：应用 / 收集 / 防抖提交 / 失败提示 / 切表重置
// 说明：column-meta.js 不碰 DOM，只改全局状态 + 调 saveColumnMeta + showToast，
// 所以这里用最小 vm 沙箱即可，不需要 DOM 模型。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot', 'js');
const FILES = ['state.js', 'column-meta.js'];

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

// ----- 可控定时器：把 scheduleMetaSave 的防抖摊开来断言 -----
let timers = {};
let timerSeq = 0;

const calls = { saved: [], toasts: [] };
let saveOutcome = 'ok';

const sandbox = {
    console,
    setTimeout: (fn) => { const id = ++timerSeq; timers[id] = fn; return id; },
    clearTimeout: (id) => { delete timers[id]; },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, getElementById: () => null },
    saveColumnMeta: (tableId, meta) => {
        calls.saved.push({ tableId, meta });
        return saveOutcome === 'fail'
            ? Promise.reject(new Error('网络错误'))
            : Promise.resolve({});
    },
    showToast: (msg) => { calls.toasts.push(msg); }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
vm.runInContext(
    FILES.map(f => '\n/* ' + f + ' */\n' + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
    + '\n;globalThis.__api = { applyColumnMeta, collectColumnMeta, scheduleMetaSave,'
    + ' flushColumnMeta, resetColumnMeta };',
    ctx, { filename: 'bundle.js' }
);
const api = sandbox.__api;

const read = name => vm.runInContext(name, ctx);
function setState({ tableId = 1, headers = [], hidden = [], widths = {} } = {}) {
    sandbox.__tableId = tableId;
    sandbox.__headers = headers;
    sandbox.__hidden = hidden;
    sandbox.__widths = widths;
    vm.runInContext('currentTableId = __tableId; currentHeaders = __headers;'
        + ' hiddenColumns = __hidden; columnWidths = __widths;', ctx);
}
const tick = () => new Promise(r => setImmediate(r));
function runTimers() {
    const fns = Object.values(timers);
    timers = {};
    fns.forEach(f => f());
}

(async function main() {
    console.log('[1] applyColumnMeta：服务端 meta -> 视图状态');
    api.applyColumnMeta(null);
    check('null 时不隐藏任何列', read('hiddenColumns').length === 0);
    check('null 时没有任何列宽', Object.keys(read('columnWidths')).length === 0);

    api.applyColumnMeta({ '名称': { width: 200 }, '数量': { hidden: true }, '单价': {} });
    check('列宽被应用', read('columnWidths')['名称'] === 200, JSON.stringify(read('columnWidths')));
    check('隐藏标记被应用', JSON.stringify(read('hiddenColumns')) === '["数量"]', JSON.stringify(read('hiddenColumns')));
    check('全默认的列不进入状态', read('columnWidths')['单价'] === undefined);

    api.applyColumnMeta({ '名称': { width: 200 }, '数量': { hidden: true } });
    api.applyColumnMeta({ '其他': { width: 88 } });
    check('再次应用会整体覆盖而不是叠加', read('hiddenColumns').length === 0 && read('columnWidths')['名称'] === undefined);

    api.applyColumnMeta({ '脏数据': { width: 'abc' }, '负宽': { width: -20 }, '零宽': { width: 0 } });
    check('非数字 / 非正数宽度被忽略',
        Object.keys(read('columnWidths')).length === 0, JSON.stringify(read('columnWidths')));

    console.log('\n[2] collectColumnMeta：视图状态 -> 请求体');
    setState({ headers: ['名称', '数量', '单价'], hidden: ['数量'], widths: { '名称': 180 } });
    let meta = api.collectColumnMeta();
    check('只收集有改动的列', Object.keys(meta).join(',') === '名称,数量', JSON.stringify(meta));
    check('列宽写入 width', meta['名称'].width === 180);
    check('隐藏列写入 hidden', meta['数量'].hidden === true);
    check('全默认的列被跳过', meta['单价'] === undefined);

    setState({ headers: ['A'], hidden: ['不存在的列'], widths: { '不存在的列': 120 } });
    check('不在 currentHeaders 里的键不会被提交', Object.keys(api.collectColumnMeta()).length === 0,
        JSON.stringify(api.collectColumnMeta()));

    console.log('\n[3] scheduleMetaSave：防抖');
    calls.saved.length = 0;
    timers = {};
    setState({ tableId: 7, headers: ['名称'], widths: { '名称': 150 } });
    api.scheduleMetaSave();
    api.scheduleMetaSave();
    api.scheduleMetaSave();
    check('连续三次改动只留一个待执行定时器', Object.keys(timers).length === 1, Object.keys(timers).length);
    runTimers();
    await tick();
    check('防抖到期后只提交一次', calls.saved.length === 1, calls.saved.length);
    check('提交的 tableId 正确', calls.saved[0].tableId === 7, JSON.stringify(calls.saved[0]));
    check('提交的 meta 正确', calls.saved[0].meta['名称'].width === 150, JSON.stringify(calls.saved[0].meta));

    setState({ tableId: null, headers: ['名称'], widths: { '名称': 150 } });
    timers = {};
    api.scheduleMetaSave();
    check('没有当前表格时不注册定时器', Object.keys(timers).length === 0);

    console.log('\n[4] flushColumnMeta：立即提交与失败提示');
    calls.saved.length = 0;
    calls.toasts.length = 0;
    timers = {};
    saveOutcome = 'ok';
    setState({ tableId: 9, headers: ['名称'], widths: { '名称': 120 } });
    api.scheduleMetaSave();
    await api.flushColumnMeta();
    check('flush 会立刻提交', calls.saved.length === 1, calls.saved.length);
    check('flush 后不再有残留定时器', Object.keys(timers).length === 0);
    check('成功时不提示', calls.toasts.length === 0, JSON.stringify(calls.toasts));

    calls.toasts.length = 0;
    saveOutcome = 'fail';
    setState({ tableId: 9, headers: ['名称'], widths: { '名称': 120 } });
    await api.flushColumnMeta();
    check('失败时提示一次', calls.toasts.length === 1, JSON.stringify(calls.toasts));
    await api.flushColumnMeta();
    check('连续失败不重复提示（避免弹窗刷屏）', calls.toasts.length === 1, JSON.stringify(calls.toasts));

    calls.toasts.length = 0;
    saveOutcome = 'ok';
    await api.flushColumnMeta();
    calls.toasts.length = 0;
    saveOutcome = 'fail';
    await api.flushColumnMeta();
    check('中间成功过一次后，后续失败恢复可提示', calls.toasts.length === 1, JSON.stringify(calls.toasts));

    saveOutcome = 'ok';
    calls.saved.length = 0;
    setState({ tableId: null });
    await api.flushColumnMeta();
    check('没有当前表格时 flush 不发请求', calls.saved.length === 0);

    console.log('\n[5] resetColumnMeta：切表时清空并取消防抖');
    calls.saved.length = 0;
    timers = {};
    setState({ tableId: 3, headers: ['名称'], hidden: ['名称'], widths: { '名称': 100 } });
    api.scheduleMetaSave();
    check('切换前有一个待执行定时器', Object.keys(timers).length === 1);
    api.resetColumnMeta();
    check('reset 取消待执行定时器', Object.keys(timers).length === 0, Object.keys(timers).length);
    check('reset 清空隐藏列', read('hiddenColumns').length === 0);
    check('reset 清空列宽', Object.keys(read('columnWidths')).length === 0);

    runTimers();
    await tick();
    check('reset 后旧定时器不会把上一张表的偏好写出去', calls.saved.length === 0, JSON.stringify(calls.saved));

    console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
    process.exit(fail === 0 ? 0 : 1);
})();
