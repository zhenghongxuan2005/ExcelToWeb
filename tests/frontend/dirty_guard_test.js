// ================================================================
// 未保存修改的判定（history.js 的 dataSignature / hasUnsavedChanges）
// 与三处拦截（切表确认）
// ----------------------------------------------------------------
// 为什么用「数据指纹」而不是脏标志位：写数据的入口有十来处，逐个挂标志
// 迟早漏一个，漏掉的表现是「明明改了却静默放弃询问」——比不提示更糟。
// 指纹的代价是「改回去就不算脏」，这正是本用例第 3 项要钉住的行为。
// ================================================================
const path = require('path');
const vm = require('vm');
const { createHarness } = require(path.join(__dirname, 'helpers', 'dom-harness.js'));

const h = createHarness({
    files: ['state.js', 'history.js', 'tables.js', 'view.js', 'io.js'],
    api: ['resetHistory', 'markDataClean', 'hasUnsavedChanges', 'dataSignature', 'switchTable',
        'exportExcel', 'exportCsv', 'exportViewCsv', 'refreshData']
});

// tt 只做「原样返回」：本用例断言的是「问没问、问的哪一句」，不关心译文
h.sandbox.tt = s => s;

const HEADERS = ['日期', '数量', '销售员'];
const ROWS = [
    { '日期': '2026-01-05', '数量': '10', '销售员': '张三', __rid: 11 },
    { '日期': '2026-01-06', '数量': '3', '销售员': '李四', __rid: 12 }
];

/** 重置为「刚加载完一张表」的状态：数据就位 + 基线重设 */
function load(headers, rows) {
    h.sandbox.__h = headers;
    h.sandbox.__r = rows;
    vm.runInContext(`
        currentTableId = 1;
        currentHeaders = __h;
        currentRows = __r.map(r => Object.assign({}, r));
        resetHistory();
    `, h.ctx);
}

const rows = () => h.read('currentRows');

// ---------------------------------------------------------------
console.log('\n[1] 刚加载完：不脏');
load(HEADERS, ROWS);
h.check('hasUnsavedChanges() 为 false', h.api.hasUnsavedChanges() === false);

// ---------------------------------------------------------------
console.log('\n[2] 改一个值：脏');
rows()[0]['数量'] = '99';
h.check('改值后为 true', h.api.hasUnsavedChanges() === true);

// ---------------------------------------------------------------
console.log('\n[3] 改回原值：重新变干净（指纹的固有特性，标志位做法做不到）');
rows()[0]['数量'] = '10';
h.check('改回原值后为 false', h.api.hasUnsavedChanges() === false,
    h.read('dataSignature()'));

// ---------------------------------------------------------------
console.log('\n[4] 增删行同样算脏');
rows().push({ '日期': '2026-02-01', '数量': '1', '销售员': '王五' });
h.check('新增一行后为 true', h.api.hasUnsavedChanges() === true);
rows().pop();
h.check('删掉那行后又为 false', h.api.hasUnsavedChanges() === false);

// ---------------------------------------------------------------
console.log('\n[5] 行主键 __rid 变化不算脏（它只是传输元信息）');
rows().forEach((r, i) => { r.__rid = 900 + i; });
h.check('只换 __rid 仍为 false', h.api.hasUnsavedChanges() === false);

// ---------------------------------------------------------------
console.log('\n[6] 保存成功后的基线重设');
rows()[1]['销售员'] = '赵六';
h.check('保存前为 true', h.api.hasUnsavedChanges() === true);
vm.runInContext('resetHistory();', h.ctx);   // applySavedRows 就是这一步
h.check('resetHistory 后为 false', h.api.hasUnsavedChanges() === false);

// ---------------------------------------------------------------
console.log('\n[7] 空值与非空值的区分');
load(HEADERS, [{ '日期': 'x', '数量': '', '销售员': 'y' }]);
rows()[0]['数量'] = '0';
h.check('空串改成 "0" 算脏', h.api.hasUnsavedChanges() === true);

// ---------------------------------------------------------------
console.log('\n[8] 切表：有未保存修改时先问，取消则原地不动');
const selector = { value: '2' };
h.sandbox.document.getElementById = id => (id === 'tableSelector' ? selector : null);
let loaded = [];
h.sandbox.loadTableData = id => { loaded.push(id); };
h.sandbox.flushColumnMeta = () => {};

load(HEADERS, ROWS);
rows()[0]['数量'] = '77';
h.sandbox.__confirm.value = false;
h.sandbox.__confirm.calls = 0;
h.sandbox.__confirm.msgs.length = 0;
h.api.switchTable();
h.check('问了一次', h.sandbox.__confirm.calls === 1, h.sandbox.__confirm.calls);
h.check('问的是「未保存」这件事',
    String(h.sandbox.__confirm.msgs[0] || '').indexOf('未保存') !== -1,
    h.sandbox.__confirm.msgs[0]);
h.check('没有加载新表', loaded.length === 0, loaded);
h.check('currentTableId 没变', h.read('currentTableId') === 1);
h.check('下拉框被拨回原表（否则显示与内容不一致）', selector.value === '1', selector.value);

// ---------------------------------------------------------------
console.log('\n[9] 切表：确认后正常切换');
h.sandbox.__confirm.value = true;
selector.value = '2';
h.api.switchTable();
h.check('加载了新表', loaded.length === 1 && loaded[0] === 2, loaded);
h.check('currentTableId 已更新', h.read('currentTableId') === 2);

// ---------------------------------------------------------------
console.log('\n[10] 切表：没有未保存修改时不打扰');
load(HEADERS, ROWS);
h.sandbox.__confirm.calls = 0;
loaded = [];
selector.value = '3';
h.api.switchTable();
h.check('没有弹确认', h.sandbox.__confirm.calls === 0, h.sandbox.__confirm.calls);
h.check('直接切换', loaded.length === 1 && loaded[0] === 3, loaded);

// ---------------------------------------------------------------
// 导出：Excel / CSV 都由后端读库生成，未保存修改不在其中 —— 必须问一句，
// 否则用户对着导出文件找刚改的那几处，只会以为数据被吞了。
// 「导出当前视图」是纯前端生成、导出所见内容，不该问（第 12 项钉住这点）。
console.log('\n[11] 导出 Excel / CSV：有未保存修改时先问');
let exportCalls = 0;
h.sandbox.exportExcelBlob = () => { exportCalls++; return new Promise(() => {}); };
h.sandbox.exportCsvBlob = () => { exportCalls++; return new Promise(() => {}); };
h.sandbox.isEnglish = () => false;
// exportViewCsv 是纯前端拼 CSV，需要 Blob（vm 沙箱不继承 Node 全局对象）
h.sandbox.Blob = class { constructor(parts) { this.parts = parts; } };

load(HEADERS, ROWS);
rows()[0]['数量'] = '55';
h.sandbox.__confirm.value = false;
h.sandbox.__confirm.calls = 0;
h.api.exportExcel();
h.check('Excel：问了一次', h.sandbox.__confirm.calls === 1, h.sandbox.__confirm.calls);
h.check('Excel：取消后没有发起导出', exportCalls === 0, exportCalls);

h.sandbox.__confirm.calls = 0;
h.api.exportCsv();
h.check('CSV：问了一次', h.sandbox.__confirm.calls === 1, h.sandbox.__confirm.calls);
h.check('CSV：取消后没有发起导出', exportCalls === 0, exportCalls);

h.sandbox.__confirm.value = true;
h.api.exportExcel();
h.check('同意后真正发起导出', exportCalls === 1, exportCalls);

// ---------------------------------------------------------------
console.log('\n[12] 没有未保存修改时导出不打扰；「导出当前视图」永远不打扰');
load(HEADERS, ROWS);
exportCalls = 0;
h.sandbox.__confirm.calls = 0;
h.api.exportExcel();
h.check('干净时不弹确认', h.sandbox.__confirm.calls === 0, h.sandbox.__confirm.calls);
h.check('直接导出', exportCalls === 1, exportCalls);

rows()[0]['数量'] = '66';
h.sandbox.__confirm.calls = 0;
let viewExported = 0;
h.sandbox.downloadBlob = () => { viewExported++; };
h.api.exportViewCsv();
h.check('导出当前视图不问（它导的就是屏幕上看到的内容）',
    h.sandbox.__confirm.calls === 0, h.sandbox.__confirm.calls);
h.check('导出当前视图用的是本地数据', viewExported === 1, viewExported);

// ---------------------------------------------------------------
// 刷新：拿库里的数据整表覆盖本地，屏幕上的未保存修改会消失。
// 但保存流程自己的回读（silent）刚存过数据，不该再问一次。
console.log('\n[13] 刷新：有未保存修改时先问，保存流程的静默回读不问');
h.sandbox.showTableSkeleton = () => {};
h.sandbox.hideTableSkeleton = () => {};
let queries = 0;
h.sandbox.queryTableData = () => { queries++; return new Promise(() => {}); };

load(HEADERS, ROWS);
rows()[0]['数量'] = '88';
h.sandbox.__confirm.value = false;
h.sandbox.__confirm.calls = 0;
h.api.refreshData();
h.check('问了一次', h.sandbox.__confirm.calls === 1, h.sandbox.__confirm.calls);
h.check('取消后没有发请求', queries === 0, queries);
h.check('取消后修改还在（仍为脏）', h.api.hasUnsavedChanges() === true);

h.sandbox.__confirm.calls = 0;
h.api.refreshData({ silent: true, keepView: true });
h.check('silent 回读不弹确认', h.sandbox.__confirm.calls === 0, h.sandbox.__confirm.calls);
h.check('silent 回读照常发请求', queries === 1, queries);

h.summary();
