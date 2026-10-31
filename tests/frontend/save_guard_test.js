// 保存守门的前端部分（后端那一半见 tests/backend/save_guard_test.py）。
//
// 保存是整表替换，所以「手里一行都没有还按了保存」等价于清空整张表。
// 前端必须做到两件事，本用例逐条锁住：
//   1) currentRows 为空时先问一句，用户点取消就一个请求都不发
//   2) 只有用户确认过，才把 allowEmpty 带上去（服务端默认拒绝空行集）
// 另外回归一条：正常的校验失败仍然在发请求之前被拦下，守门没有把主路径改坏。
const vm = require('vm');
const { createHarness } = require('./helpers/dom-harness');

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

const H = createHarness({
    files: ['state.js', 'utils.js', 'view.js', 'column-meta.js', 'computed-column.js', 'io.js'],
    api: ['saveData'],
    stubs: ['refreshData', 'fetchValidationRules', 'saveTableData', 'updateUndoButtons']
});

const { api, sandbox } = H;
const run = code => vm.runInContext(code, H.ctx);

// 把 harness 的空桩换成可观察的实现：真实的 saveTableData 会把 allowEmpty 发给服务端
run(`
    __sent = [];
    fetchValidationRules = function () { return Promise.resolve([]); };
    saveTableData = function (id, rows, allowEmpty) {
        __sent.push({ id: id, rows: rows, allowEmpty: allowEmpty });
        return Promise.resolve({ message: 'ok' });
    };
    refreshData = function () {};
`);

const reset = () => run('__sent.length = 0; __confirm.calls = 0; __confirm.msgs = [];');
const tick = () => new Promise(r => setTimeout(r, 10));
const sent = () => sandbox.__sent;

const HEADERS = ['日期', '数量'];
const ROWS = [
    { '日期': '2026-01-05', '数量': '10' },
    { '日期': '2026-01-06', '数量': '3' }
];

(async () => {
    console.log('[1] 有数据：不弹确认，按原样保存');
    H.setTable(HEADERS, ROWS);
    reset();
    run('__confirm.value = false;');   // 即便用户会点取消，也不该问
    api.saveData();
    await tick();
    check('没有弹确认', sandbox.__confirm.calls === 0, sandbox.__confirm.calls);
    check('发出 1 次保存请求', sent().length === 1, sent().length);
    check('allowEmpty 是 false', sent()[0] && sent()[0].allowEmpty === false, sent()[0]);
    check('2 行数据原样带过去', sent()[0] && sent()[0].rows.length === 2,
        sent()[0] && sent()[0].rows.length);

    console.log('\n[2] 空表 + 用户取消：一个请求都不发');
    H.setTable(HEADERS, []);
    reset();
    run('__confirm.value = false;');
    api.saveData();
    await tick();
    check('弹了 1 次确认', sandbox.__confirm.calls === 1, sandbox.__confirm.calls);
    check('确认文案说明了会清空整表',
        (sandbox.__confirm.msgs[0] || '').indexOf('清空整张表') !== -1, sandbox.__confirm.msgs[0]);
    check('没有发出任何保存请求', sent().length === 0, sent().length);

    console.log('\n[3] 空表 + 用户确认：带 allowEmpty 清空');
    H.setTable(HEADERS, []);
    reset();
    run('__confirm.value = true;');
    api.saveData();
    await tick();
    check('发出 1 次保存请求', sent().length === 1, sent().length);
    check('allowEmpty 是 true', sent()[0] && sent()[0].allowEmpty === true, sent()[0]);
    check('rows 是空数组', sent()[0] && sent()[0].rows.length === 0,
        sent()[0] && sent()[0].rows.length);

    console.log('\n[4] 校验失败仍在发请求之前拦下');
    H.setTable(HEADERS, [{ '日期': '2026-01-05', '数量': '' }]);
    reset();
    run(`fetchValidationRules = function () {
        return Promise.resolve([{ columnName: '数量', required: true }]);
    };`);
    api.saveData();
    await tick();
    check('没有发请求', sent().length === 0, sent().length);
    check('弹的是校验失败提示',
        (sandbox.__toasts[0] || '').indexOf('校验失败') !== -1, sandbox.__toasts[0]);
    check('守门没把「空表」和「校验失败」混为一谈', sandbox.__confirm.calls === 0, sandbox.__confirm.calls);

    console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
    process.exit(fail === 0 ? 0 : 1);
})();
