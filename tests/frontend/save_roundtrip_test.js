// 保存后不再整表重取（QA 第 14 条）：服务端把「保存后的行」直接回传。
//
// 原先 saveData 成功后要再 GET 一次整表：保存已经是两次全表写（删 + 批量插），
// 再加一次全表读，大表上等于三次全量往返。而现在回传里带着：
//   · 新的行主键（整表替换会重新分配 identity，旧主键全部作废）
//   · 重算过的计算列值（值不落库，只能在服务端算）
// 有了这两样，本地数据直接替换即可，不必再读一次。
//
// 兜底：回传里没有 rows（老服务端 / 行数对不上）时退回 refreshData，行为与以前一致。
const vm = require('vm');
const { createHarness } = require('./helpers/dom-harness');

const h = createHarness({
    files: ['state.js', 'io.js'],
    api: ['applySavedRows'],
    stubs: ['resetHistory', 'updatePageMeta', 'refreshData']
});

vm.runInContext(`
    __resetHistory = 0;
    resetHistory = function () { __resetHistory++; };
    __renders = 0;
    renderTable = function () { __renders++; };
    __refreshed = 0;
    refreshData = function () { __refreshed++; };
    __pageMeta = 0;
    updatePageMeta = function () { __pageMeta++; };
    currentRows = [{ 名称: '旧', 数量: '9', __rid: 1 }];
    allTables = [{ id: 7, tableName: '测试表', updatedAt: '2026-10-01T00:00:00Z' }];
`, h.ctx);

function reset() {
    vm.runInContext(`
        __resetHistory = 0; __renders = 0; __refreshed = 0; __pageMeta = 0;
        currentRows = [{ 名称: '旧', 数量: '9', __rid: 1 }];
        allTables = [{ id: 7, tableName: '测试表', updatedAt: '2026-10-01T00:00:00Z' }];
    `, h.ctx);
}

const saved = [
    { 名称: '甲', 数量: '2', __rid: 41 },
    { 名称: '乙', 数量: '2', __rid: 42 }
];

console.log('\n[1] 回传了行：直接替换，不再重取');
reset();
let ok = h.api.applySavedRows({ rows: saved, updatedAt: '2026-10-31T13:00:00Z' }, 7);

h.check('返回 true', ok === true, ok);
h.check('currentRows 被整体替换', h.read('currentRows').length === 2, h.read('currentRows').length);
h.check('带上了服务端的新行主键', h.read('currentRows')[0].__rid === 41, h.read('currentRows')[0]);
h.check('计算列的值来自服务端', h.read('currentRows')[0].数量 === '2', h.read('currentRows')[0].数量);
h.check('重绘了一次表格', h.read('__renders') === 1, h.read('__renders'));
h.check('没有调用 refreshData（省掉整表重取）', h.read('__refreshed') === 0, h.read('__refreshed'));
h.check('清掉了撤销栈（旧快照的行主键已作废）', h.read('__resetHistory') === 1, h.read('__resetHistory'));
h.check('刷新了页头（最后保存时间）', h.read('__pageMeta') === 1, h.read('__pageMeta'));
h.check('列表里那张表的 updatedAt 同步了',
    h.read('allTables')[0].updatedAt === '2026-10-31T13:00:00Z', h.read('allTables')[0].updatedAt);

console.log('\n[2] 回传缺 rows（老服务端 / 行数对不上）：退回整表重取');
reset();
ok = h.api.applySavedRows({ updatedAt: '2026-10-31T13:00:00Z' }, 7);

h.check('返回 false', ok === false, ok);
h.check('调用了 refreshData 兜底', h.read('__refreshed') === 1, h.read('__refreshed'));
h.check('没有擅自动 currentRows', h.read('currentRows')[0].名称 === '旧', h.read('currentRows'));

console.log('\n[3] 清空整表后保存：空数组也是有效回传，不能当成「没给数据」');
reset();
ok = h.api.applySavedRows({ rows: [], updatedAt: '2026-10-31T13:00:00Z' }, 7);

h.check('返回 true', ok === true, ok);
h.check('currentRows 变成空数组', h.read('currentRows').length === 0, h.read('currentRows'));
h.check('没有走 refreshData 兜底', h.read('__refreshed') === 0, h.read('__refreshed'));

console.log('\n[4] 没有 updatedAt 时不炸（只替换数据）');
reset();
ok = h.api.applySavedRows({ rows: saved }, 7);
h.check('返回 true', ok === true, ok);
h.check('updatedAt 保持原值', h.read('allTables')[0].updatedAt === '2026-10-01T00:00:00Z',
    h.read('allTables')[0].updatedAt);

h.summary();
