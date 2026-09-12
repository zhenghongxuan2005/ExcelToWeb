// 针对「单元格区域选择 + TSV 复制 / 粘贴」的纯逻辑单测（range.js / range-clipboard.js）
// DOM 模型与沙箱装配见 helpers/dom-harness.js。
const { createHarness, HEADERS, ROWS } = require('./helpers/dom-harness');

const H = createHarness({
    files: ['state.js', 'utils.js', 'view.js', 'keyboard.js', 'range.js', 'range-clipboard.js'],
    api: ['tsvCell', 'parseTsv', 'buildRangeTsv', 'pasteTsv', 'clearRangeContent',
        'setRange', 'clearRange', 'rangeBounds', 'isRangeActive', 'isMultiCellRange',
        'extendRangeByKey', 'onRangeKeydown', 'rangeSignature', 'paintSelection',
        'clipboardYieldsToFocus', 'onRangeCopy', 'onRangePaste']
});
const { api, ctx, sandbox, container, rangeInfoHost, read, check,
    setTable, domValue, focusCell, setActive } = H;
const noop = () => {};
/** 在 bundle 的同一个全局作用域里改状态（state.js 的 let 不挂在 sandbox 对象上） */
const vmSet = code => require('vm').runInContext(code, ctx);

console.log('[1] TSV 转义 / 解析');
check('普通值不加引号', api.tsvCell('张三') === '张三');
check('含制表符加引号', api.tsvCell('a\tb') === '"a\tb"');
check('含双引号转义为两个双引号', api.tsvCell('说"你好"') === '"说""你好"""');
check('null -> 空串', api.tsvCell(null) === '');
check('undefined -> 空串', api.tsvCell(undefined) === '');
check('解析单行多列', JSON.stringify(api.parseTsv('a\tb\tc')) === JSON.stringify([['a', 'b', 'c']]));
check('解析多行', JSON.stringify(api.parseTsv('a\tb\nc\td')) === JSON.stringify([['a', 'b'], ['c', 'd']]));
check('尾随换行不产生空行', api.parseTsv('a\tb\n').length === 1);
check('空字符串 -> 空数组', api.parseTsv('').length === 0);
check('引号包裹的含制表符字段', JSON.stringify(api.parseTsv('"a\tb"\tc')) === JSON.stringify([['a\tb', 'c']]));
check('引号包裹的含换行字段', api.parseTsv('"a\nb"\tc')[0][0] === 'a\nb');
check('CRLF 归一化', JSON.stringify(api.parseTsv('a\r\nb')) === JSON.stringify([['a'], ['b']]));
check('转义回环：tsvCell -> parseTsv 原样还原',
    api.parseTsv(api.tsvCell('x\ty') + '\t' + api.tsvCell('说"你好"'))[0][1] === '说"你好"');

console.log('\n[2] 选区几何');
setTable(HEADERS, ROWS);
check('初始无选区', api.isRangeActive() === false);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 2, colPos: 1 });
check('建立选区后激活', api.isRangeActive() === true);
check('边界归一化', JSON.stringify(api.rangeBounds()) === JSON.stringify({ r1: 0, r2: 2, c1: 0, c2: 1 }),
    JSON.stringify(api.rangeBounds()));
check('多格选区判定', api.isMultiCellRange() === true);
api.setRange({ rowPos: 2, colPos: 1 }, { rowPos: 0, colPos: 0 });
check('锚点在右下时仍归一化', JSON.stringify(api.rangeBounds()) === JSON.stringify({ r1: 0, r2: 2, c1: 0, c2: 1 }));
api.setRange({ rowPos: 1, colPos: 1 }, { rowPos: 1, colPos: 1 });
check('单格选区不算多格', api.isMultiCellRange() === false);
check('单格选区提示条已渲染', rangeInfoHost.innerHTML.indexOf('1</strong> 行') !== -1, rangeInfoHost.innerHTML);
api.clearRange();
check('取消后不再激活', api.isRangeActive() === false);
check('取消后提示条清空', rangeInfoHost.innerHTML === '');

console.log('\n[3] 复制（读输入框，保证与「所见」一致）');
setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
domValue(0, 0, 'X1');
domValue(0, 1, 'X2');
check('复制为 TSV 且取自输入框',
    api.buildRangeTsv() === 'X1\tX2\n2026-01-06\t3', JSON.stringify(api.buildRangeTsv()));
setTable(HEADERS, ROWS, ['数量']);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 0, colPos: 1 });
check('只复制可见列（隐藏列不参与）',
    api.buildRangeTsv() === '2026-01-05\t张三', JSON.stringify(api.buildRangeTsv()));

console.log('\n[4] 粘贴');
setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 0, colPos: 0 });
api.pasteTsv('A\tB\nC\tD');
let r = read('currentRows');
check('2x2 写入锚点起始的区域',
    r[0]['日期'] === 'A' && r[0]['数量'] === 'B' && r[1]['日期'] === 'C' && r[1]['数量'] === 'D');
check('区域外数据不受影响', r[2]['日期'] === '2026-02-11' && r[0]['销售员'] === '张三');
check('粘贴计入一次撤销', sandbox.__hist.count === 1, sandbox.__hist.count);
check('粘贴后重绘一次', sandbox.__renders === 1, sandbox.__renders);
check('粘贴后选区=刚粘贴的区域',
    JSON.stringify(api.rangeBounds()) === JSON.stringify({ r1: 0, r2: 1, c1: 0, c2: 1 }),
    JSON.stringify(api.rangeBounds()));
check('提示里说明了行列数', sandbox.__toasts.some(t => t.indexOf('2 行 × 2 列') !== -1),
    JSON.stringify(sandbox.__toasts));

setTable(HEADERS, ROWS);
api.setRange({ rowPos: 3, colPos: 0 }, { rowPos: 3, colPos: 0 });
api.pasteTsv('1\n2\n3');
r = read('currentRows');
check('超出底部自动补行（4 -> 6 行）', r.length === 6, r.length);
check('首列按序写入', r[3]['日期'] === '1' && r[4]['日期'] === '2' && r[5]['日期'] === '3');
check('补出的新行其它列为空串', r[4]['销售员'] === '' && r[5]['数量'] === '');
check('补行也计入同一次撤销', sandbox.__hist.count === 1);

setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 1 }, { rowPos: 0, colPos: 1 });
api.pasteTsv('a\tb\tc\td');
r = read('currentRows');
check('超宽只写进剩余的可见列', r[0]['数量'] === 'a' && r[0]['销售员'] === 'b');
check('超宽明确提示被忽略的列数（不静默丢数据）',
    sandbox.__toasts.some(t => t.indexOf('已忽略') !== -1), JSON.stringify(sandbox.__toasts));

setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 0, colPos: 0 });
check('全空白粘贴不写入', api.pasteTsv('\n\n') === false);
check('全空白粘贴不计撤销', sandbox.__hist.count === 0);
check('全空白粘贴不重绘', sandbox.__renders === 0);

setTable(HEADERS, ROWS);
api.setRange({ rowPos: 1, colPos: 1 }, { rowPos: 1, colPos: 1 });
api.pasteTsv('9');
check('单格粘贴只改一个单元格',
    read('currentRows')[1]['数量'] === '9' && read('currentRows')[0]['数量'] === '10');

console.log('\n[5] 清空内容');
setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
check('清空返回 true', api.clearRangeContent() === true);
r = read('currentRows');
check('选中区域被清空', r[0]['日期'] === '' && r[0]['数量'] === '' && r[1]['数量'] === '');
check('区域外不受影响', r[0]['销售员'] === '张三' && r[2]['日期'] === '2026-02-11');
check('清空计入一次撤销', sandbox.__hist.count === 1);

console.log('\n[6] Delete / Esc 键');
setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
let prevented = false;
api.onRangeKeydown({ key: 'Delete', altKey: false, metaKey: false, preventDefault() { prevented = true; } });
check('多格选区按 Delete 清空且阻止默认', prevented === true && read('currentRows')[0]['日期'] === '');

setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 0, colPos: 0 });
focusCell(0, 0);
prevented = false;
api.onRangeKeydown({ key: 'Delete', altKey: false, metaKey: false, preventDefault() { prevented = true; } });
check('单格编辑态不抢 Delete（交给浏览器删字符）', prevented === false);

setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
api.onRangeKeydown({ key: 'Escape', altKey: false, metaKey: false, preventDefault: noop });
check('Esc 取消选区', api.isRangeActive() === false);

console.log('\n[7] Shift + 方向键扩展');
setTable(HEADERS, ROWS);
focusCell(0, 0);
check('Shift+Down 被接管', api.extendRangeByKey('ArrowDown') === true);
check('选区扩展到下一行', JSON.stringify(api.rangeBounds()) === JSON.stringify({ r1: 0, r2: 1, c1: 0, c2: 0 }),
    JSON.stringify(api.rangeBounds()));
check('Shift+Right 继续扩展', api.extendRangeByKey('ArrowRight') === true);
check('选区变成 2x2', JSON.stringify(api.rangeBounds()) === JSON.stringify({ r1: 0, r2: 1, c1: 0, c2: 1 }),
    JSON.stringify(api.rangeBounds()));
check('锚点始终保持不动', read('rangeAnchor').rowPos === 0 && read('rangeAnchor').colPos === 0,
    JSON.stringify(read('rangeAnchor')));
check('焦点跟随移动', read('rangeFocus').rowPos === 1 && read('rangeFocus').colPos === 1);
for (let i = 0; i < 5; i++) api.extendRangeByKey('ArrowUp');
check('越界被夹在首行', read('rangeFocus').rowPos === 0, read('rangeFocus').rowPos);
for (let i = 0; i < 9; i++) api.extendRangeByKey('ArrowRight');
check('越界被夹在末列', read('rangeFocus').colPos === HEADERS.length - 1, read('rangeFocus').colPos);
check('非方向键原样返回 false', api.extendRangeByKey('Enter') === false);
setTable(HEADERS, ROWS);
setActive(null);
check('不在单元格上时返回 false（落回普通键盘逻辑）', api.extendRangeByKey('ArrowDown') === false);

console.log('\n[8] 视图变化自动作废选区（防止「选中的是 A 行、改的是 B 行」）');
setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
api.paintSelection();
check('视图未变时选区保留', api.isRangeActive() === true);
vmSet("searchKeyword = '张三';");
api.paintSelection();
check('搜索关键词变化 -> 选区作废', api.isRangeActive() === false);
setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
api.paintSelection();
vmSet('sortKeys = [{ field: "数量", order: 1 }];');
api.paintSelection();
check('排序变化 -> 选区作废', api.isRangeActive() === false);
setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
api.paintSelection();
vmSet('pageSize = 2; currentPage = 2;');
api.paintSelection();
check('翻页 -> 选区作废', api.isRangeActive() === false);
setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
api.paintSelection();
vmSet("currentRows.push({ '日期': 'x', '数量': 'y', '销售员': 'z' });");
api.paintSelection();
check('行数变化 -> 选区作废', api.isRangeActive() === false);

console.log('\n[9] Ctrl+C / Ctrl+V 不劫持普通输入框');
function fakeClipboardEvent(text) {
    const store = {};
    return {
        _store: store,
        _prevented: false,
        clipboardData: {
            setData: (type, v) => { store[type] = v; },
            getData: () => text
        },
        preventDefault() { this._prevented = true; }
    };
}

check('普通 INPUT 视为文本输入（让路）', api.clipboardYieldsToFocus({ tagName: 'INPUT' }) === true);
check('TEXTAREA 视为文本输入（让路）', api.clipboardYieldsToFocus({ tagName: 'TEXTAREA' }) === true);
check('单元格输入框不算普通输入（不让路）',
    api.clipboardYieldsToFocus(container._table._trs[0]._cells[0].input) === false);
check('null 不让路', api.clipboardYieldsToFocus(null) === false);

setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
setActive(null);
let ev = fakeClipboardEvent('');
api.onRangeCopy(ev);
check('Ctrl+C 写入选区 TSV',
    ev._prevented === true && ev._store['text/plain'] === '2026-01-05\t10\n2026-01-06\t3',
    ev._store['text/plain']);

setActive({ tagName: 'INPUT', selectionStart: 1, selectionEnd: 3 });
ev = fakeClipboardEvent('');
api.onRangeCopy(ev);
check('焦点在搜索框时不劫持 Ctrl+C', ev._prevented === false && Object.keys(ev._store).length === 0);

setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 1, colPos: 1 });
focusCell(0, 0);
setActive(Object.assign(container._table._trs[0]._cells[0].input, { selectionStart: 0, selectionEnd: 2 }));
ev = fakeClipboardEvent('');
api.onRangeCopy(ev);
check('单元格内选中文字时不劫持 Ctrl+C', ev._prevented === false);

setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 0, colPos: 0 });
setActive({ tagName: 'INPUT', selectionStart: 0, selectionEnd: 0 });
ev = fakeClipboardEvent('P\tQ');
api.onRangePaste(ev);
check('焦点在搜索框时不劫持 Ctrl+V',
    ev._prevented === false && read('currentRows')[0]['日期'] === '2026-01-05');

setTable(HEADERS, ROWS);
api.setRange({ rowPos: 0, colPos: 0 }, { rowPos: 0, colPos: 0 });
setActive(null);
ev = fakeClipboardEvent('P\tQ');
api.onRangePaste(ev);
check('选区状态下 Ctrl+V 粘进表格',
    ev._prevented === true && read('currentRows')[0]['日期'] === 'P' && read('currentRows')[0]['数量'] === 'Q');

H.summary();
