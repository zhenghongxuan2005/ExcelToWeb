// P1 列管理面板（column-manager.js）纯逻辑单测：
// 草稿模型 / 增删移 / rename 计算 / 校验拦截 / 保存成功后的视图缓存清理
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot', 'js');
const FILES = ['state.js', 'utils.js', 'column-manager.js'];

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
    addEventListener() {},
    getElementById() { return makeEl(); },
    querySelectorAll() { return []; }, querySelector() { return null; },
    createElement() { return makeEl(); }, body: makeEl()
};
const sandbox = {
    console, setTimeout, clearTimeout, document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    confirm: () => true,
    window: {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
vm.runInContext(
    FILES.map(f => '\n/* ' + f + ' */\n' + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
    // 打桩：API 与刷新链路，只记录调用
    + '\n;globalThis.__calls = { updateHeaders: [], refreshData: 0, toasts: [] };'
    + '\n;function updateHeaders(tableId, headers, renames) { __calls.updateHeaders.push({ tableId, headers, renames }); return Promise.resolve({ message: "列结构已更新：新增 1 列" }); }'
    + '\n;function refreshData() { __calls.refreshData++; }'
    + '\n;const __showToastRaw = showToast;'
    + '\n;function showToast(msg, type) { __calls.toasts.push(msg); }'
    + '\n;globalThis.__api = { openColumnModal, closeColumnModal, addColumnRow, removeColumnRow, moveColumnRow, onColumnDraftInput, saveColumnStructure };',
    ctx, { filename: 'bundle.js' }
);
const api = sandbox.__api;

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}
function setState(tableId, headers) {
    vm.runInContext(`currentTableId = ${JSON.stringify(tableId)}; currentHeaders = ${JSON.stringify(headers)};`, ctx);
}
const read = expr => vm.runInContext(expr, ctx);
const calls = () => vm.runInContext('__calls', ctx);
const lastUpdate = () => read('__calls.updateHeaders[__calls.updateHeaders.length - 1] || null');

const HEADERS = ['日期', '数量', '销售员'];

console.log('[1] 打开面板：草稿初始化与守卫');
setState(null, []);
api.openColumnModal();
check('未选表格时不开面板', read('columnDraft.length') === 0);
setState(1, HEADERS);
api.openColumnModal();
check('草稿镜像当前表头', JSON.stringify(read('columnDraft.map(c => c.name)')) === JSON.stringify(HEADERS));
check('原列名被记录为 original', read('columnDraft[1].original') === '数量');

console.log('[2] 增 / 删 / 移');
api.addColumnRow();
check('添加列追加空草稿', read('columnDraft.length') === 4 && read('columnDraft[3].original') === '');
api.onColumnDraftInput(3, '备注');
check('onColumnDraftInput 写入草稿', read('columnDraft[3].name') === '备注');
api.moveColumnRow(3, -1);
check('上移交换位置', read('columnDraft[2].name') === '备注' && read('columnDraft[3].name') === '销售员');
api.moveColumnRow(0, -1);
check('越界上移无变化', read('columnDraft[0].name') === '日期');
api.moveColumnRow(3, 5);
check('越界下移无变化', read('columnDraft[3].name') === '销售员');
api.removeColumnRow(2); // 新增的「备注」列，confirm 默认 true
check('删除新增列直接移除', read('columnDraft.length') === 3 && read('columnDraft.length') === 3);
vm.runInContext('confirm = () => false;', ctx);
api.removeColumnRow(1); // 原有列，confirm=false 应阻止
check('原有列在 confirm=false 时不删除', read('columnDraft.length') === 3);
vm.runInContext('confirm = () => true;', ctx);
api.removeColumnRow(1);
check('confirm=true 时删除原有列', read('columnDraft.length') === 2);

console.log('[3] 保存校验：空名 / 重名 / 无变化 / 空表');
setState(1, HEADERS);
api.openColumnModal();
api.onColumnDraftInput(0, '  ');
api.saveColumnStructure();
check('空白列名被拦截，不调接口', calls().updateHeaders.length === 0);
vm.runInContext("columnDraft[0].name = '日期'; columnDraft[1].name = '日期';", ctx);
api.saveColumnStructure();
check('重复列名被拦截', calls().updateHeaders.length === 0);
vm.runInContext("columnDraft[1].name = '数量'; columnDraft[2].name = '销售员';", ctx);
api.saveColumnStructure();
check('无变化时不调接口', calls().updateHeaders.length === 0, calls().updateHeaders.length);
vm.runInContext('columnDraft = [];', ctx);
api.saveColumnStructure();
check('至少保留一列', calls().updateHeaders.length === 0);

console.log('[4] 保存成功：headers + renames 计算与视图缓存清理');
setState(1, ['日期', '数量', '销售员']);
vm.runInContext("hiddenColumns = ['销售员', '旧列']; columnWidths = { '数量': 120, '销售员': 80 };", ctx);
api.openColumnModal();
vm.runInContext(
    "columnDraft[1].name = '件数';" +          // 重命名 数量 -> 件数
    "columnDraft.splice(2, 1);" +              // 删除 销售员
    "columnDraft.push({ name: '备注', original: '' });" + // 新增 备注
    "columnDraft.push({ name: '日期2', original: '日期' });" + // 日期 -> 日期2（注意旧名仍在新列表外）
    "columnDraft.splice(0, 1);",               // 删掉原「日期」草稿，仅保留改名的「日期2」? 不：这样 rename 源没了
    ctx
);
// 上面最后一步会破坏 rename 前提，重新构造一个干净场景
setState(1, ['日期', '数量', '销售员']);
vm.runInContext("hiddenColumns = ['销售员', '旧列']; columnWidths = { '数量': 120, '销售员': 80 };", ctx);
api.openColumnModal();
vm.runInContext(
    "columnDraft[0].name = '日期2';" +   // rename 日期 -> 日期2
    "columnDraft[1].name = '件数';" +    // rename 数量 -> 件数
    "columnDraft.splice(2, 1);" +        // drop 销售员
    "columnDraft.push({ name: '备注', original: '' });", // add 备注
    ctx
);
api.saveColumnStructure();
setTimeout(() => {
    const up = lastUpdate();
    check('接口被调用一次', calls().updateHeaders.length === 1);
    check('tableId 正确', up && up.tableId === 1);
    check('最终 headers = 重命名后的新列 + 新增列',
        up && JSON.stringify(up.headers) === JSON.stringify(['日期2', '件数', '备注']),
        up && JSON.stringify(up.headers));
    check('renames 含两条改名',
        up && JSON.stringify(up.renames) === JSON.stringify([{ oldName: '日期', newName: '日期2' }, { oldName: '数量', newName: '件数' }]),
        up && JSON.stringify(up.renames));
    check('隐藏列里失效的键被清理（销售员已删、旧列已不存在）', JSON.stringify(read('hiddenColumns')) === JSON.stringify([]), read('hiddenColumns'));
    check('列宽里失效的键被清理（改名/删除列宽度重置）', JSON.stringify(Object.keys(read('columnWidths'))) === JSON.stringify([]), JSON.stringify(Object.keys(read('columnWidths'))));
    check('保存成功后调用 refreshData', calls().refreshData === 1);

    console.log('[5] 失败路径：接口抛错时不清理、不刷新');
    vm.runInContext(
        'updateHeaders = function() { __calls.updateHeaders.push({}); return Promise.reject(new Error("列名重复")); };',
        ctx
    );
    setState(1, HEADERS);
    vm.runInContext("hiddenColumns = []; columnWidths = {};", ctx);
    api.openColumnModal();
    vm.runInContext("columnDraft[0].name = 'A1'; columnDraft[1].name = 'B1'; columnDraft[2].name = 'C1';", ctx);
    api.saveColumnStructure();
    setTimeout(() => {
        check('失败后不调用 refreshData', calls().refreshData === 1, calls().refreshData);
        check('失败时有错误提示', calls().toasts.some(t => t.indexOf('列名重复') !== -1), JSON.stringify(calls().toasts));

        console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
        process.exit(fail === 0 ? 0 : 1);
    }, 10);
}, 10);
