// 填充柄单测：规律计算（纯函数）+ 落数据（currentRows 与 DOM 双写）
const vm = require('vm');
const { createHarness } = require('./helpers/dom-harness');

const H = createHarness({
    files: ['state.js', 'utils.js', 'view.js', 'keyboard.js', 'range.js', 'fill-handle.js'],
    api: ['fillSeries', 'fillNumber', 'tidyNumber', 'computeFillTarget', 'applyFill',
        'updateFillHandle', 'rangeBounds', 'setRange', 'clearRange', 'isRangeActive']
});
const { api, ctx, sandbox, container, read, check, setTable, summary } = H;
const run = code => vm.runInContext(code, ctx);

console.log('[1] fillSeries：等差数列延续 / 循环重复');
check('单值重复', api.fillSeries(['7'], 3).join(',') === '7,7,7', api.fillSeries(['7'], 3).join(','));
check('步长 1 延续', api.fillSeries(['1', '2', '3'], 3).join(',') === '4,5,6', api.fillSeries(['1', '2', '3'], 3).join(','));
check('步长 2 延续', api.fillSeries(['2', '4'], 4).join(',') === '6,8,10,12', api.fillSeries(['2', '4'], 4).join(','));
check('负步长延续', api.fillSeries(['5', '4'], 2).join(',') === '3,2', api.fillSeries(['5', '4'], 2).join(','));
check('小数步长', api.fillSeries(['0.5', '1'], 2).join(',') === '1.5,2', api.fillSeries(['0.5', '1'], 2).join(','));
check('浮点误差被消掉（0.1,0.2 → 0.3）',
    api.fillSeries(['0.1', '0.2'], 1).join(',') === '0.3', api.fillSeries(['0.1', '0.2'], 1).join(','));
check('步长不一致 → 循环重复', api.fillSeries(['1', '2', '4'], 4).join(',') === '1,2,4,1', api.fillSeries(['1', '2', '4'], 4).join(','));
check('文本 → 循环重复', api.fillSeries(['张三', '李四'], 5).join(',') === '张三,李四,张三,李四,张三',
    api.fillSeries(['张三', '李四'], 5).join(','));
check('含空值 → 按文本处理', api.fillSeries(['1', ''], 2).join(',') === '1,', api.fillSeries(['1', ''], 2).join(','));
check('带后缀的编号不算数字', api.fillSeries(['1a', '2a'], 2).join(',') === '1a,2a', api.fillSeries(['1a', '2a'], 2).join(','));
check('count<=0 → 空', api.fillSeries(['1', '2'], 0).length === 0);
check('源为空 → 空', api.fillSeries([], 3).length === 0);

console.log('\n[2] computeFillTarget：方向与范围');
const b = { r1: 1, r2: 2, c1: 0, c2: 1 };
let t = api.computeFillTarget(b, { rowPos: 5, colPos: 1 });
check('向下拖 → 纵向，列范围锁定在源列',
    t && t.vert === true && t.r1 === 1 && t.r2 === 5 && t.c1 === 0 && t.c2 === 1, JSON.stringify(t));
t = api.computeFillTarget(b, { rowPos: 0, colPos: 1 });
check('向上拖 → 纵向，向上扩展', t && t.vert === true && t.r1 === 0 && t.r2 === 2, JSON.stringify(t));
t = api.computeFillTarget(b, { rowPos: 2, colPos: 4 });
check('向右拖 → 横向，行范围锁定在源行',
    t && t.vert === false && t.c1 === 0 && t.c2 === 4 && t.r1 === 1 && t.r2 === 2, JSON.stringify(t));
t = api.computeFillTarget(b, { rowPos: 1, colPos: 1 });
check('拖回源区域内部 → null（无可填充）', t === null);
t = api.computeFillTarget(b, { rowPos: 6, colPos: 2 });
check('斜拖时取位移较大的轴（纵向）', t && t.vert === true && t.r2 === 6 && t.c2 === 1, JSON.stringify(t));

console.log('\n[3] applyFill 纵向填充（写入 currentRows + DOM）');
setTable(['A', 'B'], [
    { 'A': '1', 'B': 'x' },
    { 'A': '2', 'B': 'y' },
    { 'A': '', 'B': '' },
    { 'A': '', 'B': '' }
]);
const srcV = { r1: 0, r2: 1, c1: 0, c2: 0 };
const res = api.applyFill({ r1: 0, r2: 3, c1: 0, c2: 0, vert: true }, srcV);
check('数列 1,2 → 续写 3,4',
    read('currentRows').map(r => r['A']).join(',') === '1,2,3,4', read('currentRows').map(r => r['A']).join(','));
check('DOM 输入框同步更新', container._table._trs[3]._cells[0].input.value === '4',
    container._table._trs[3]._cells[0].input.value);
check('未参与填充的列不受影响',
    read('currentRows').map(r => r['B']).join(',') === 'x,y,,', read('currentRows').map(r => r['B']).join(','));
check('写前压了一次历史（可撤销）', sandbox.__hist.count === 1, sandbox.__hist.count);
check('只改值、不整表重绘（避免排序跳位）', sandbox.__renders === 0, sandbox.__renders);
check('返回填充统计', res && res.cells === 2 && res.rows === 4, JSON.stringify(res));
check('选区扩为整个目标区', read('rangeBounds().r1') === 0 && read('rangeBounds().r2') === 3);

console.log('\n[4] applyFill：向上填充 / 循环重复 / 单格复制');
setTable(['A'], [{ 'A': '' }, { 'A': '' }, { 'A': '10' }, { 'A': '20' }]);
api.applyFill({ r1: 0, r2: 3, c1: 0, c2: 0, vert: true }, { r1: 2, r2: 3, c1: 0, c2: 0 });
check('向上填充得到递减数列 -10,0',
    read('currentRows').map(r => r['A']).join(',') === '-10,0,10,20', read('currentRows').map(r => r['A']).join(','));

setTable(['A'], [{ 'A': '甲' }, { 'A': '乙' }, { 'A': '' }, { 'A': '' }, { 'A': '' }]);
api.applyFill({ r1: 0, r2: 4, c1: 0, c2: 0, vert: true }, { r1: 0, r2: 1, c1: 0, c2: 0 });
check('文本按 2 格循环重复',
    read('currentRows').map(r => r['A']).join(',') === '甲,乙,甲,乙,甲', read('currentRows').map(r => r['A']).join(','));

setTable(['A'], [{ 'A': '9' }, { 'A': '' }, { 'A': '' }]);
api.applyFill({ r1: 0, r2: 2, c1: 0, c2: 0, vert: true }, { r1: 0, r2: 0, c1: 0, c2: 0 });
check('单格复制到下方', read('currentRows').map(r => r['A']).join(',') === '9,9,9', read('currentRows').map(r => r['A']).join(','));

setTable(['A'], [{ 'A': '1' }, { 'A': '' }]);
api.applyFill({ r1: 0, r2: 1, c1: 0, c2: 0, vert: true }, { r1: 1, r2: 1, c1: 0, c2: 0 });
check('空源会把目标一并清空（复制空格，Excel 行为）',
    read('currentRows').map(r => r['A']).join(',') === ',', read('currentRows').map(r => r['A']).join(','));

setTable(['A'], [{ 'A': '1' }, { 'A': '2' }]);
check('拖回源区域内部不写入、不压历史',
    api.applyFill(null, { r1: 0, r2: 1, c1: 0, c2: 0 }) === null && sandbox.__hist.count === 0,
    sandbox.__hist.count);

console.log('\n[5] applyFill 横向填充（逐行独立判断）');
setTable(['A', 'B', 'C', 'D'], [
    { 'A': '1', 'B': '3', 'C': '', 'D': '' },
    { 'A': 'x', 'B': 'y', 'C': '', 'D': '' }
]);
api.applyFill({ r1: 0, r2: 1, c1: 0, c2: 3, vert: false }, { r1: 0, r2: 1, c1: 0, c2: 1 });
check('数值行向右延续 5,7',
    read('currentRows')[0]['C'] === '5' && read('currentRows')[0]['D'] === '7',
    JSON.stringify(read('currentRows')[0]));
check('文本行向右循环 x,y',
    read('currentRows')[1]['C'] === 'x' && read('currentRows')[1]['D'] === 'y',
    JSON.stringify(read('currentRows')[1]));

console.log('\n[6] 填充柄 DOM');
setTable(['A', 'B'], [{ 'A': '1', 'B': '2' }, { 'A': '3', 'B': '4' }]);
run('updateFillHandle()');
check('无选区时不生成填充柄', container._table._trs[0]._cells[0].td._children.length === 0,
    container._table._trs[0]._cells[0].td._children.length);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
run('updateFillHandle()');
const hostTd = container._table._trs[1]._cells[1].td;
check('填充柄挂在选区右下角单元格上',
    hostTd._children.length === 1 && String(hostTd._children[0].className).indexOf('range-fill-handle') !== -1,
    JSON.stringify(hostTd._children.map(c => c.className)));
run('updateFillHandle()');
check('重复调用不会堆叠出多个填充柄', hostTd._children.length === 1, hostTd._children.length);
api.clearRange();
run('updateFillHandle()');
check('取消选区后填充柄被移除', hostTd._children.length === 0, hostTd._children.length);

summary();
