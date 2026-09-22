// 多工作表导入单测：单表直接导入、多表先弹选择框、以及「选择」落到真上传时带的 sheetIndex。
// 桩掉 listSheets / uploadFile，只验证 sheet-picker.js 的分支与传参。
const vm = require('vm');
const { createHarness } = require('./helpers/dom-harness');

const H = createHarness({
    files: ['state.js', 'utils.js', 'dnd.js', 'sheet-picker.js'],
    api: ['startImport', 'pickSheet', 'closeSheetPicker', 'openSheetPicker']
});
const { api, ctx, sandbox, read, check, summary } = H;
const run = code => vm.runInContext(code, ctx);

// —— 假弹窗（harness 的 getElementById 默认只认 tableContainer / rangeInfo）——
const modal = { classList: H.makeClassList() };
const listEl = { innerHTML: '' };
sandbox.document.getElementById = id => {
    if (id === 'sheetPickerModal') return modal;
    if (id === 'sheetPickerList') return listEl;
    return null;
};

// —— 可控桩 ——
run(`
globalThis.__listCalls = 0;
globalThis.__uploads = [];
globalThis.__toasts = __toasts;
globalThis.__pending = [];
globalThis.listSheets = function (file) {
    __listCalls++;
    return new Promise(function (resolve) { __pending.push({ name: file.name, resolve: resolve }); });
};
globalThis.uploadFile = function (file, sheetIndex) {
    __uploads.push({ name: file.name, sheetIndex: sheetIndex });
};
globalThis.__lastUpload = () => __uploads[__uploads.length - 1];
`);

const fileA = { name: 'a.xlsx' };
const fileB = { name: 'b.xlsx' };
sandbox.__fileA = fileA;
sandbox.__fileB = fileB;

const SHEET1 = { index: 0, name: 'Sheet1', rowCount: 3, columnCount: 2, hasData: true };
const SHEET2 = { index: 1, name: '第二张表', rowCount: 4, columnCount: 2, hasData: true };

// 触发一次 startImport 并让它跑完（桩 Promise 手动 resolve）
async function probe(file, sheets) {
    const idx = sandbox.__pending.length;
    run(file === fileA ? 'startImport(__fileA)' : 'startImport(__fileB)');
    run(`__pending[${idx}].resolve(${JSON.stringify(sheets)})`);
    await Promise.resolve();
    await Promise.resolve();
}

(async () => {
    console.log('[1] 只有一张工作表 → 不弹框，直接导入');
    await probe(fileA, [SHEET1]);
    check('发生了一次导入', read('__uploads.length') === 1, read('__uploads.length'));
    check('没带 sheetIndex（沿用第一张）', read('__lastUpload().sheetIndex') === undefined,
        read('__lastUpload().sheetIndex'));
    check('弹框没被打开', !modal.classList.contains('show'));

    console.log('\n[2] 多张工作表 → 弹框，先不导入');
    run('closeSheetPicker(); __uploads.length = 0');
    await probe(fileA, [SHEET1, SHEET2]);
    check('还没有发生导入', read('__uploads.length') === 0, read('__uploads.length'));
    check('弹框已打开', modal.classList.contains('show'));
    check('列出了两张工作表',
        listEl.innerHTML.indexOf('Sheet1') !== -1 && listEl.innerHTML.indexOf('第二张表') !== -1,
        listEl.innerHTML);
    check('每项带行列说明', listEl.innerHTML.indexOf('行数据') !== -1);
    check('点击项带 onclick=pickSheet(序号)',
        listEl.innerHTML.indexOf('pickSheet(0)') !== -1 && listEl.innerHTML.indexOf('pickSheet(1)') !== -1);

    console.log('\n[3] 选中第 2 张 → 带上 sheetIndex 真正上传');
    run('pickSheet(1)');
    check('发生了一次导入', read('__uploads.length') === 1, read('__uploads.length'));
    check('sheetIndex = 1', read('__lastUpload().sheetIndex') === 1, read('__lastUpload().sheetIndex'));
    check('用的是同一个文件', read('__lastUpload().name') === 'a.xlsx', read('__lastUpload().name'));
    check('选完后弹框关闭', !modal.classList.contains('show'));

    console.log('\n[4] 取消 → 不导入');
    run('__uploads.length = 0');
    await probe(fileA, [SHEET1, SHEET2]);
    check('弹框开着', modal.classList.contains('show'));
    api.closeSheetPicker();
    check('取消后弹框关闭', !modal.classList.contains('show'));
    check('取消后没有导入', read('__uploads.length') === 0, read('__uploads.length'));

    console.log('\n[5] 极端情况');
    run('__uploads.length = 0; __toasts.length = 0; __listCalls = 0');
    api.startImport({ name: 'note.txt' });
    check('非 xlsx/xls 直接拦下（不请求后端）', read('__listCalls') === 0, read('__listCalls'));
    check('给出格式提示', read('__toasts')[0] && read('__toasts')[0].indexOf('.xlsx') !== -1,
        read('__toasts'));

    run('__toasts.length = 0');
    await probe(fileA, []);
    check('文件里没有工作表时给出提示',
        read('__toasts')[0] === '文件里没有工作表', read('__toasts'));
    check('也没有导入', read('__uploads.length') === 0);

    run('__toasts.length = 0');
    await probe(fileA, [{ index: 0, name: '空', rowCount: 0, columnCount: 0, hasData: false },
        { index: 1, name: '有', rowCount: 2, columnCount: 1, hasData: true }]);
    check('没有数据行的工作表被标注',
        listEl.innerHTML.indexOf('没有数据行') !== -1, listEl.innerHTML);
    check('没有数据行的项带 is-empty', listEl.innerHTML.indexOf('is-empty') !== -1);

    console.log('\n[6] 连续导入两个文件：只认最后一次的结果');
    run('closeSheetPicker(); __uploads.length = 0; __pending.length = 0; __listCalls = 0');
    run('startImport(__fileA)');
    run('startImport(__fileB)');
    check('发起了两次探测', read('__listCalls') === 2, read('__listCalls'));
    run('__pending[1].resolve([{index:0,name:"单表",rowCount:2,columnCount:1,hasData:true}])');
    await Promise.resolve();
    await Promise.resolve();
    run('__pending[0].resolve([{index:0,name:"旧",rowCount:2,columnCount:1,hasData:true},{index:1,name:"旧二",rowCount:2,columnCount:1,hasData:true}])');
    await Promise.resolve();
    await Promise.resolve();
    check('只有后一次的文件被导入', read('__uploads.length') === 1, read('__uploads.length'));
    check('导入的是后一个文件', read('__lastUpload().name') === 'b.xlsx', read('__lastUpload().name'));
    check('旧文件的「多表」结果被丢弃（没有弹框）', !modal.classList.contains('show'));

    console.log('\n[7] 弹窗节点缺失时不至于整个导入不可用');
    const savedGet = sandbox.document.getElementById;
    sandbox.document.getElementById = () => null;
    run('__uploads.length = 0');
    await probe(fileA, [SHEET1, SHEET2]);
    check('退回直接导入整个文件', read('__uploads.length') === 1, read('__uploads.length'));
    sandbox.document.getElementById = savedGet;

    summary();
})();
