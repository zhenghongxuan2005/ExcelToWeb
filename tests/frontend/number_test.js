// 数字口径单测：界面上「这个值算不算一个数」必须与导出时的判断一致。
// 样例表与 tests/backend/number_export_test.py 保持同步 —— 那边用导出后 xlsx 的单元格
// 类型证明服务端行为，这边断言前端的判断，两边合起来才算「口径一致」。
const vm = require('vm');
const { createHarness } = require('./helpers/dom-harness');

const H = createHarness({
    files: ['state.js', 'utils.js', 'view.js', 'fill-handle.js'],
    api: ['parseSafeNumber', 'isSafeNumber', 'isNumericColumn', 'compareValues', 'fillNumber', 'fillSeries']
});
const { api, ctx, read, check, setTable, summary } = H;

// (值, 是否会被导出成 Excel 数值) —— 与后端用例逐条对应
const SAMPLES = [
    ['007', false],
    ['1,000', true],
    ['1e3', false],
    ['1234567890123456', false],
    ['0.5', true],
    ['0', true],
    ['abc', false],
    ['123456789012345', true],
    ['00.5', false],
    ['1,234.5', true],
    ['12345678901234567', false]
];

console.log('[1] 与导出口径逐条对齐');
for (const [value, wantNumber] of SAMPLES) {
    const got = api.isSafeNumber(value);
    check(`"${value}" → ${wantNumber ? '数字' : '非数字'}`, got === wantNumber, got);
}

console.log('\n[2] 与 Number() / parseFloat() 的分歧点');
check('千分位解析为 1000（Number() 会是 NaN）', api.parseSafeNumber('1,000') === 1000, api.parseSafeNumber('1,000'));
check('科学计数法不给数字（Number() 会是 1000）', api.parseSafeNumber('1e3') === null);
check('十六进制不给数字（Number() 会是 16）', api.parseSafeNumber('0x10') === null);
check('Infinity 不给数字', api.parseSafeNumber('Infinity') === null);
check('NaN 字样不给数字', api.parseSafeNumber('NaN') === null);
check('空串 / null / undefined → null',
    api.parseSafeNumber('') === null && api.parseSafeNumber(null) === null && api.parseSafeNumber(undefined) === null);
check('两侧空白被忽略', api.parseSafeNumber('  12  ') === 12, api.parseSafeNumber('  12  '));
check('负数与正号', api.parseSafeNumber('-2.5') === -2.5 && api.parseSafeNumber('+3') === 3);
check('单 0 是数字，且 0 不会被当成「没有值」',
    api.parseSafeNumber('0') === 0 && api.isSafeNumber('0') === true);

console.log('\n[3] 数值列判定（颜色规则选列 / 统计栏）');
setTable(['数量'], [{ '数量': '1,000' }, { '数量': '2,000' }]);
check('千分位列算数值列', read('isNumericColumn("数量")') === true);
setTable(['编号'], [{ '编号': '007' }, { '编号': '008' }]);
check('前导零编号列不算数值列', read('isNumericColumn("编号")') === false);
setTable(['文本'], [{ '文本': 'a' }, { '文本': '1' }]);
check('混了文本的列不算数值列', read('isNumericColumn("文本")') === false);

console.log('\n[4] 排序按真实数值，而不是截断值');
setTable(['金额'], [{ '金额': '1,000' }, { '金额': '999' }]);
check('1,000 排在 999 之后（parseFloat 会得到 1 而排反）',
    read('compareValues("1,000", "999")') === 1, read('compareValues("1,000", "999")'));
check('两位小数按数值比较', read('compareValues("2.5", "2.45")') === 1);
check('前导零编号退化为字符串比较', read('compareValues("007", "008")') < 0,
    read('compareValues("007", "008")'));
check('一边不是数字时走字符串比较', read('compareValues("abc", "abd")') < 0);

console.log('\n[5] 填充柄的数列判定');
check('fillNumber 直接暴露同一口径',
    api.fillNumber('1,000') === 1000 && api.fillNumber('007') === null && api.fillNumber('') === null);
check('千分位序列按等差延续',
    api.fillSeries(['1,000', '3,000'], 1)[0] === '5000', api.fillSeries(['1,000', '3,000'], 1)[0]);
check('编号序列仍按文本循环复制',
    api.fillSeries(['007', '008'], 2).join(',') === '007,008', api.fillSeries(['007', '008'], 2).join(','));
check('普通数列不受影响', api.fillSeries(['1', '2', '3'], 1)[0] === '4');

summary();
