// 保存后重新取数时，排序 / 列筛选必须保留。
//
// 背景（QA 第 3、4 条）：saveData() 成功后走 refreshData()，而 refreshData 里
// 原本无条件 resetSort() + resetFilter() —— 用户按「销售员」排好序、改一格、保存，
// 顺序直接回到原始状态且没有任何提示；同时 refreshData 又弹一条「已刷新」，
// 把刚弹出的「保存成功」顶掉，用户根本看不出到底存没存上。
//
// 约定：saveData 调 refreshData({ keepView: true, silent: true })
//   keepView —— 这是同一份数据的回读，视图状态与数据无关，不能清
//   silent   —— 保存流程自己已经提示过，不再重复打扰
// 手动点「刷新」仍然走默认行为（清视图 + 提示），那代表「重新拉一份干净数据」。
const vm = require('vm');
const { createHarness } = require('./helpers/dom-harness');

const h = createHarness({
    files: ['state.js', 'utils.js', 'view.js', 'tables.js'],
    api: ['refreshData'],
    // 这些是 refreshData 的周边依赖，本用例只关心它有没有动视图状态
    stubs: ['showTableSkeleton', 'hideTableSkeleton', 'loadColorRules', 'loadRefValues']
});

// 用计数器替换要被观察的两个副作用，其余依赖补上
vm.runInContext(`
    __resetFilter = 0;
    resetFilter = function () { __resetFilter++; };
    __resetHistory = 0;
    resetHistory = function () { __resetHistory++; };
    __nextQuery = null;
    queryTableData = function () { return Promise.resolve(__nextQuery); };
`, h.ctx);

const H = ['名称', '数量'];
const R = [{ '名称': '甲', '数量': '1' }, { '名称': '乙', '数量': '2' }, { '名称': '丙', '数量': '3' }];

/** 重置场景：两张表的数据、清空的统计、以及一个「服务端返回」 */
function reset() {
    h.setTable(H, R);
    vm.runInContext(`
        __nextQuery = { headers: ['名称', '数量'], rows: [{名称:'甲',数量:'1'},{名称:'乙',数量:'2'},{名称:'丙',数量:'3'}] };
        __resetFilter = 0; __resetHistory = 0;
        __toasts.length = 0; __status.length = 0; __renders = 0;
        sortKeys = [{ field: '名称', dir: -1 }];
        filterColumn = '名称';
        filterKeyword = '甲';
    `, h.ctx);
}

const tick = () => new Promise(r => setTimeout(r, 30));

(async () => {
    console.log('\n[1] 保存后的回读：保留排序与筛选、不重复提示');
    reset();
    h.api.refreshData({ keepView: true, silent: true });
    await tick();

    h.check('排序状态保留', JSON.stringify(h.read('sortKeys')) === JSON.stringify([{ field: '名称', dir: -1 }]),
        JSON.stringify(h.read('sortKeys')));
    h.check('没有调用 resetFilter', h.read('__resetFilter') === 0, h.read('__resetFilter'));
    h.check('筛选条件仍在', h.read('filterKeyword') === '甲' && h.read('filterColumn') === '名称',
        h.read('filterKeyword') + ' / ' + h.read('filterColumn'));
    h.check('没有弹「已刷新」', h.sandbox.__toasts.length === 0, h.sandbox.__toasts);
    h.check('数据被替换成服务端返回的行', h.read('currentRows').length === 3, h.read('currentRows').length);
    h.check('仍然重绘了一次表格', h.sandbox.__renders === 1, h.sandbox.__renders);
    h.check('撤销栈按约定清空（数据已换，旧快照不能留）', h.read('__resetHistory') === 1, h.read('__resetHistory'));

    console.log('\n[2] 手动刷新：默认行为不变（清视图 + 提示）');
    reset();
    h.api.refreshData();
    await tick();

    h.check('排序被清空', h.read('sortKeys').length === 0, JSON.stringify(h.read('sortKeys')));
    h.check('resetFilter 被调用', h.read('__resetFilter') === 1, h.read('__resetFilter'));
    h.check('弹出了「已刷新」', h.sandbox.__toasts.some(t => String(t).indexOf('已刷新') !== -1), h.sandbox.__toasts);
    h.check('状态栏变成「已刷新」', h.sandbox.__status.some(s => String(s).indexOf('已刷新') !== -1), h.sandbox.__status);

    console.log('\n[3] 回读失败：不能说成「刷新失败」（数据其实已经存进去了）');
    reset();
    // refreshData 的 catch 里有 console.error，用例里把它静音，否则失败路径的堆栈会混进测试输出
    vm.runInContext(`
        console = { error: function () {}, log: function () {}, warn: function () {} };
        queryTableData = function () { return Promise.reject(new Error('boom')); };
    `, h.ctx);
    h.api.refreshData({ keepView: true, silent: true });
    await tick();

    const toast = String(h.sandbox.__toasts[h.sandbox.__toasts.length - 1] || '');
    h.check('提示里点明「数据已保存」', toast.indexOf('数据已保存') !== -1, toast);
    h.check('提示里带上了原因', toast.indexOf('boom') !== -1, toast);
    h.check('没有说成「刷新失败」', toast.indexOf('刷新失败') === -1, toast);

    h.summary();
})();
