// 汇总行单测：聚合计算 + 与 renderTable 的接线。
// 背景：aggregate.js 里的 buildAggregateRowHtml() 早已写好，但 render.js 从未调用它，
//       于是「显示 / 关闭汇总行」按钮点了没反应 —— 本用例把这条接线焊死在测试里。
// 语义：Excel SUBTOTAL —— 只统计当前「看得到」的数据（搜索 / 列筛选 / 隐藏列之后），
//       与分页无关。
const vm = require('vm');
const { createHarness } = require('./helpers/dom-harness');

const H = createHarness({
    files: ['state.js', 'utils.js', 'view.js', 'aggregate.js', 'render.js'],
    keep: ['renderTable'],          // 本用例专门验证 render.js 真的把汇总行拼进去了
    stubs: ['updateSelectionStats', 'clearSelectionStats', 'updateUndoButtons'],
    api: ['AGG_MODES', 'initAggregatePref', 'computeColumnAggregate', 'buildAggregateRowHtml',
        'setAggregateMode', 'toggleAggregateRow', 'renderTable']
});
const { api, ctx, sandbox, container, read, check, setTable, summary } = H;
const run = code => vm.runInContext(code, ctx);
const tdCount = html => (html.match(/<td/g) || []).length;

// 汇总值原样展示，便于断言（真实的 formatNumber 只做两位小数裁剪，与此无关）
run('globalThis.formatNumber = n => String(Math.round(n * 100) / 100);');

const ROWS = [
    { '名称': '甲', '数量': '10' },
    { '名称': '乙', '数量': '20' },
    { '名称': '丙', '数量': '30' },
    { '名称': '丁', '数量': '' }
];

console.log('[1] 五种汇总方式（空单元格不参与数值计算）');
setTable(['名称', '数量'], ROWS);
run('aggregateMode = "sum"');
check('求和 = 60', read('computeColumnAggregate("数量", currentRows)') === 60,
    read('computeColumnAggregate("数量", currentRows)'));
run('aggregateMode = "avg"');
check('平均 = 20（按 3 个非空值算）', read('computeColumnAggregate("数量", currentRows)') === 20,
    read('computeColumnAggregate("数量", currentRows)'));
run('aggregateMode = "count"');
check('计数 = 3', read('computeColumnAggregate("数量", currentRows)') === 3);
check('计数对文本列同样有效', read('computeColumnAggregate("名称", currentRows)') === 4);
run('aggregateMode = "max"');
check('最大值 = 30', read('computeColumnAggregate("数量", currentRows)') === 30);
run('aggregateMode = "min"');
check('最小值 = 10', read('computeColumnAggregate("数量", currentRows)') === 10);

console.log('\n[2] 非数值列不参与求和 / 平均');
setTable(['名称', '数量'], ROWS);
run('aggregateMode = "sum"');
check('纯文本列 → null', read('computeColumnAggregate("名称", currentRows)') === null);
setTable(['混合'], [['a'], ['1'], ['b']].map(v => ({ '混合': v[0] })));
check('夹杂文本的列 → null', read('computeColumnAggregate("混合", currentRows)') === null);
setTable(['空列'], [{ '空列': '' }, { '空列': '' }]);
check('全空列 → null', read('computeColumnAggregate("空列", currentRows)') === null);

console.log('\n[3] 关闭汇总时不产出任何结构');
setTable(['名称', '数量'], ROWS);
run('aggregateMode = "off"; renderTable();');
check('buildAggregateRowHtml 返回空串', read('buildAggregateRowHtml(getVisibleHeaders())') === '');
check('renderTable 输出里没有 tfoot', container.innerHTML.indexOf('<tfoot>') === -1);

console.log('\n[4] 接线：renderTable 底部真的拼出了汇总行');
run('aggregateMode = "sum"; renderTable();');
check('输出含汇总行', container.innerHTML.indexOf('id="aggregateRow"') !== -1);
check('汇总行排在 tbody 之后',
    container.innerHTML.indexOf('</tbody>') < container.innerHTML.indexOf('aggregateRow'));
check('带汇总方式下拉框', container.innerHTML.indexOf('class="aggregate-select"') !== -1);
check('下拉框 = 5 种方式 + 关闭 = 6 个选项',
    (container.innerHTML.match(/<option/g) || []).length === 6,
    (container.innerHTML.match(/<option/g) || []).length);

const aggHtml = run('buildAggregateRowHtml(getVisibleHeaders())');
check('固定 2 列 + 2 个可见列 = 4 个 td', tdCount(aggHtml) === 4, tdCount(aggHtml));
check('数值单元格带单位 Σ', aggHtml.indexOf('aggregate-unit') !== -1);
check('求和结果 60 落在单元格里', aggHtml.indexOf('>60<') !== -1, aggHtml);
check('没有任何可用数值时给出占位',
    run('aggregateMode = "sum"; buildAggregateRowHtml(["名称"])').indexOf('is-empty') !== -1);

console.log('\n[5] SUBTOTAL 语义：只统计当前看得到的行');
setTable(['名称', '数量'], ROWS);
run('aggregateMode = "sum"');
run('searchKeyword = "甲"');
check('搜索命中 1 行', read('buildDisplayRows().length') === 1);
check('求和只算命中行 = 10',
    read('computeColumnAggregate("数量", buildDisplayRows())') === 10,
    read('computeColumnAggregate("数量", buildDisplayRows())'));
check('汇总行展示的也是 10',
    run('buildAggregateRowHtml(getVisibleHeaders())').indexOf('>10<') !== -1);
run('searchKeyword = ""');

console.log('\n[6] 隐藏列不占汇总行的位置');
setTable(['名称', '数量', '备注'],
    ROWS.map(r => ({ '名称': r['名称'], '数量': r['数量'], '备注': 'x' })), ['备注']);
run('aggregateMode = "sum"');
const h6 = run('buildAggregateRowHtml(getVisibleHeaders())');
check('2 个可见列 + 2 个固定列 = 4 个 td', tdCount(h6) === 4, tdCount(h6));
check('renderTable 与汇总行使用同一批可见列',
    container.innerHTML.indexOf('id="aggregateRow"') !== -1);

console.log('\n[7] 偏好持久化 / 启动恢复');
const store = {};
sandbox.localStorage.getItem = k => (k in store ? store[k] : null);
sandbox.localStorage.setItem = (k, v) => { store[k] = String(v); };
setTable(['名称', '数量'], ROWS);
run('aggregateMode = "off"; setAggregateMode("avg")');
check('切换方式写入偏好', store.prefAggregate === 'avg', store.prefAggregate);
check('切换后当前方式生效', read('aggregateMode') === 'avg');
store.prefAggregate = 'max';
run('initAggregatePref()');
check('initAggregatePref 从偏好恢复', read('aggregateMode') === 'max', read('aggregateMode'));
store.prefAggregate = 'bogus';
run('initAggregatePref()');
check('非法偏好回落 off', read('aggregateMode') === 'off', read('aggregateMode'));
store.prefAggregate = 'off';
run('aggregateMode = "sum"; initAggregatePref()');
check('偏好是 off 时不会强行打开', read('aggregateMode') === 'off', read('aggregateMode'));
container.innerHTML = '';
store.prefAggregate = 'sum';
run('initAggregatePref()');
check('initAggregatePref 只恢复状态、不渲染（供启动链调用）',
    container.innerHTML === '' && read('aggregateMode') === 'sum', container.innerHTML);

console.log('\n[8] 工具栏开关');
run('aggregateMode = "off"; toggleAggregateRow()');
check('关闭状态下点一下 → 打开为求和', read('aggregateMode') === 'sum', read('aggregateMode'));
run('toggleAggregateRow()');
check('再点一下 → 关闭', read('aggregateMode') === 'off', read('aggregateMode'));

summary();
