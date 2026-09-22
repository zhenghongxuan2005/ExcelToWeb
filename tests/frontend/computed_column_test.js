// 计算列前端单测。
//
// 重点不在公式能不能算（那是服务端 FormulaEvaluator 的事），而在两件前端必须守住的事：
//   1) isComputedColumn 必须准确 —— 它错了，下面五条写入路径就全错
//   2) 五条写入路径（粘贴 / 清空 / 填充 / 查找替换 / 保存收集）都必须跳过计算列，
//      漏掉一条就会把「算出来的值」写回 currentRows 并被保存进库
// 另外做一条漂移防护：前端的函数白名单必须与服务端 FormulaEngine.Functions 完全一致。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHarness } = require('./helpers/dom-harness');

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

// ================================================================
// 一、行为：只读判定 + 五条写入路径
// ================================================================
const H = createHarness({
    files: [
        'state.js', 'utils.js', 'view.js', 'column-meta.js', 'computed-column.js',
        'column-manager.js', 'range.js', 'range-clipboard.js', 'findreplace.js', 'edit.js', 'io.js'
    ],
    api: [
        'isComputedColumn', 'formulaOf', 'computedColumnHint', 'formulaCheck', 'unknownFunctions',
        'openFormulaEditor', 'closeFormulaEditor', 'onFormulaInput', 'applyFormulaDraft',
        'clearFormulaDraft', 'insertFormulaText', 'applyColumnFormulas', 'formulaColumnCandidates',
        'columnDraftSnapshot', 'setColumnDraftExpr', 'renderColumnDraft', 'openColumnModal',
        'collectFindMatches', 'pasteTsv', 'clearRangeContent', 'confirmBatchEdit', 'saveData',
        'applyColumnMeta'
    ],
    stubs: [
        'clearSelectionStats', 'paintSelection', 'clearRange', 'updateUndoButtons',
        'updateSelectionStats', 'refreshData', 'resetHistory', 'fetchValidationRules',
        'saveTableData', 'updateHeaders', 'saveFormula', 'saveColumnMeta', 'filterSummaryText'
    ]
});
const { api, sandbox, read } = H;
const run = code => vm.runInContext(code, H.ctx);

// currentTableEl 住在 keyboard.js，本用例没加载它；这里补一个等价实现，
// 否则 rangeRowEls() 取不到行，粘贴/清空会直接提前返回、把用例测成假的
run('currentTableEl = function () { return document.getElementById("tableContainer").querySelector("table"); };');

const HEADERS = ['日期', '单价', '数量', '合计'];
const ROWS = [
    { '日期': '2026-01-05', '单价': '10', '数量': '3', '合计': '30' },
    { '日期': '2026-01-06', '单价': '4', '数量': '5', '合计': '20' }
];

/** 设定表格 + 计算列（合计 是计算列） */
function setTable(exprs) {
    H.setTable(HEADERS, ROWS, [], exprs === undefined ? { '合计': '[单价] * [数量]' } : exprs);
    run('__toasts.length = 0;');
}

console.log('[1] isComputedColumn / formulaOf');
setTable();
check('计算列判定为真', api.isComputedColumn('合计') === true);
check('普通列判定为假', api.isComputedColumn('单价') === false);
check('不存在的列判定为假', api.isComputedColumn('查无此列') === false);
check('取得到公式原文', api.formulaOf('合计') === '[单价] * [数量]', api.formulaOf('合计'));
check('普通列的公式为空串', api.formulaOf('单价') === '', api.formulaOf('单价'));
check('悬浮提示里带公式', api.computedColumnHint('合计').indexOf('[单价] * [数量]') !== -1);

console.log('\n[2] formulaCheck 预检');
check('空公式给出「取消计算列」的说明', api.formulaCheck('') .indexOf('取消') !== -1, api.formulaCheck(''));
check('少右括号被拦', api.formulaCheck('(1+2') .indexOf('括号') !== -1, api.formulaCheck('(1+2'));
check('多右括号被拦', api.formulaCheck('1+2)').indexOf('括号') !== -1);
check('双引号不成对被拦', api.formulaCheck('CONCAT("a, 1)').indexOf('双引号') !== -1);
check('方括号不成对被拦', api.formulaCheck('[单价 * 2').indexOf('方括号') !== -1);
check('白名单外的函数被拦', api.formulaCheck('SUM(1)').indexOf('不支持的函数') !== -1, api.formulaCheck('SUM(1)'));
check('合法公式不报问题', api.formulaCheck('ROUND([单价] * [数量], 2)') === '', api.formulaCheck('ROUND([单价] * [数量], 2)'));
check('超长公式被拦', api.formulaCheck('1'.repeat(600)).indexOf('500') !== -1);
check('未知函数能被识别出来', JSON.stringify(api.unknownFunctions('SUM(1) + MAX(2)')) === '["SUM","MAX"]',
    JSON.stringify(api.unknownFunctions('SUM(1) + MAX(2)')));

console.log('\n[3] 前端函数白名单必须与服务端一致（漂移防护）');
const csPath = path.join(__dirname, '..', '..', 'ExcelToWeb', 'Services', 'Excel', 'FormulaEngine.cs');
const csText = fs.readFileSync(csPath, 'utf8');
const m = /Functions\s*=\s*\{([^}]*)\}/.exec(csText);
const serverFns = m ? m[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean).sort() : [];
check('能从 FormulaEngine.cs 里读到函数白名单', serverFns.length > 0, serverFns);
check('两侧函数白名单完全一致',
    JSON.stringify(serverFns) === JSON.stringify(read('FORMULA_FUNCTIONS').slice().sort()),
    JSON.stringify(serverFns) + ' vs ' + JSON.stringify(read('FORMULA_FUNCTIONS')));

console.log('\n[4] 写入路径：粘贴（pasteTsv）跳过计算列');
setTable();
run('rangeAnchor = { rowPos: 0, colPos: 1 }; rangeFocus = { rowPos: 1, colPos: 3 };');
api.pasteTsv('100\t200\t300\n400\t500\t600');   // 覆盖 单价/数量/合计 三列
check('单价 被粘贴', read('currentRows[0]["单价"]') === '100', read('currentRows[0]["单价"]'));
check('数量 被粘贴', read('currentRows[0]["数量"]') === '200', read('currentRows[0]["数量"]'));
check('合计 没被粘贴（仍是算出来的 30）', read('currentRows[0]["合计"]') === '30',
    read('currentRows[0]["合计"]'));

console.log('\n[5] 写入路径：清空选区（clearRangeContent）跳过计算列');
setTable();
run('rangeAnchor = { rowPos: 0, colPos: 1 }; rangeFocus = { rowPos: 1, colPos: 3 };');
api.clearRangeContent();
check('单价 被清空', read('currentRows[0]["单价"]') === '', read('currentRows[0]["单价"]'));
check('合计 没被清空', read('currentRows[0]["合计"]') === '30', read('currentRows[0]["合计"]'));

console.log('\n[6] 写入路径：查找（collectFindMatches）不把计算列算进结果');
setTable();
const matches = api.collectFindMatches('30');
check('算出来的 30 不会被当成可替换的命中', matches.filter(x => x.key === '合计').length === 0,
    JSON.stringify(matches));
const manual = api.collectFindMatches('2026');
check('普通列仍然能被找到', manual.length > 0 && manual.every(x => x.key === '日期'),
    JSON.stringify(manual));

console.log('\n[7] 写入路径：批量编辑（confirmBatchEdit）拒绝计算列');
setTable();
sandbox.document.getElementById = id => {
    if (id === 'batchColumnSelect') return { value: '合计' };
    if (id === 'batchValueInput') return { value: '999' };
    if (id === 'batchModal') return { style: {} };
    return null;
};
sandbox.document.querySelectorAll = sel => (sel === '.row-checkbox:checked'
    ? [{ dataset: { index: '0' } }, { dataset: { index: '1' } }]
    : []);
api.confirmBatchEdit();
check('计算列没被改动', read('currentRows[0]["合计"]') === '30' && read('currentRows[1]["合计"]') === '20',
    read('currentRows.map(r => r["合计"])'));
check('给出了「不能批量修改」的提示', read('__toasts').join('|').indexOf('计算列') !== -1, read('__toasts'));

console.log('\n[8] 写入路径：保存时收集（saveData）不把计算列的值收进模型');
setTable();
sandbox.document.querySelectorAll = sel => (sel === '.cell-input'
    ? [
        { dataset: { index: '0', key: '单价' }, value: '11' },
        { dataset: { index: '0', key: '合计' }, value: '99999' }
    ]
    : []);
run('fetchValidationRules = function () { return Promise.resolve([]); };');
run(`saveTableData = function (id, rows) { __saved = rows; return Promise.resolve({ message: "ok" }); };`);
api.saveData();
check('普通列的输入被收进模型', read('currentRows[0]["单价"]') === '11', read('currentRows[0]["单价"]'));
check('计算列的输入框值被无视', read('currentRows[0]["合计"]') === '30', read('currentRows[0]["合计"]'));

// ================================================================
// 二、渲染：计算列只读 + 表头 fx
// ================================================================
console.log('\n[9] 渲染：计算列只读、表头带 fx 角标');
const R = createHarness({
    files: ['state.js', 'utils.js', 'column-meta.js', 'computed-column.js', 'render.js'],
    api: ['renderTable'],
    keep: ['renderTable'],
    stubs: [
        'buildDisplayRows', 'getVisibleHeaders', 'getPagedRows', 'cellMatchesSearch', 'sortOrderOf',
        'columnWidthStyle', 'sortSummaryText', 'filterSummaryText', 'isFilterActive', 'renderPager',
        'buildAggregateRowHtml', 'clearSelectionStats', 'clearRange', 'updateUndoButtons',
        'paintSelection', 'updateSelectionStats'
    ]
});
R.sandbox.__exprs = { '合计': '[甲] * [乙]' };
R.read('columnExprs = __exprs;');
R.read('currentHeaders = ["甲", "乙", "合计"];');
R.read('currentRows = [{ "甲": "2", "乙": "3", "合计": "6" }];');
R.read('buildDisplayRows = function () { return currentRows; };');
R.read('getVisibleHeaders = function () { return currentHeaders; };');
R.read('getPagedRows = function (rows) { return rows; };');
R.read('buildAggregateRowHtml = function () { return ""; };');
R.read('renderPager = function () { return ""; };');
R.read('columnWidthStyle = function () { return ""; };');
R.read('sortOrderOf = function () { return 0; };');
R.read('cellMatchesSearch = function () { return false; };');
R.read('sortSummaryText = function () { return ""; };');
R.read('filterSummaryText = function () { return ""; };');
R.read('isFilterActive = function () { return false; };');
R.read('renderTable();');

const html = R.container.innerHTML || '';
check('渲染出了表格', html.indexOf('<table>') !== -1, html.slice(0, 120));
check('计算列那格带 readonly', /data-key="合计"[^>]*readonly/.test(html), html.match(/<input[^>]*合计[^>]*>/));
check('计算列那格带锁定样式类', html.indexOf('cell-input-locked') !== -1);
check('普通列那格没有 readonly', !/data-key="甲"[^>]*readonly/.test(html));
check('表头带 fx 角标', html.indexOf('th-fx') !== -1);
check('fx 的悬浮提示里有公式', html.indexOf('[甲] * [乙]') !== -1);
// 合计 是最后一列，从它的格子往后不该再出现建议列表（普通列的仍应保留）
const tailFromComputed = html.slice(html.indexOf('data-key="合计"'));
check('计算列那格不产出建议列表', tailFromComputed.indexOf('suggest-list') === -1,
    tailFromComputed.slice(0, 200));
check('普通列仍然有建议列表', (html.match(/suggest-list/g) || []).length === 2,
    (html.match(/suggest-list/g) || []).length);

// ================================================================
console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail === 0 ? 0 : 1);
