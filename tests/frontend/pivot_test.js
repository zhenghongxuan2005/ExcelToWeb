// 透视汇总前端单测：pivot.js 的职责是「把选中的字段发出去、把回来的二维结果画出来」，
// 数字一个都不算。所以这里盯的是三件容易出错、又只有跑到浏览器里才会发现的事：
//   1) 请求地址与请求体字段名对不对（写错一个字段名，界面只会说「请求失败」）
//   2) 画出来的表格结构对不对（行标签 / 列表头 / 格子 / 合计行 / 空值显示成 —）
//   3) 导出必须复用「上一次成功预览」的请求 —— 用户看到哪张表，导出的就得是哪张
// 另外两条：连点两次「生成预览」时先回来的旧响应必须被丢掉；
//          聚合方式清单必须与后端 PivotService.Aggs 一致（漂移防护）。
const fs = require('fs');
const path = require('path');
const { createPivotHarness } = require('./helpers/pivot-harness');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

const H = createPivotHarness({
    files: ['state.js', 'utils.js', 'api.js', 'pivot.js'],
    api: ['openPivotModal', 'closePivotModal', 'runPivot', 'exportPivot']
});
const { api, getEl, run, read, fetchCalls, respond, lastCall, flush } = H;

const WWW = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot');
const HEADERS = ['地区', '品类', '金额'];
const ROWS = [
    { '地区': '华东', '品类': 'A', '金额': '10' },
    { '地区': '华东', '品类': 'B', '金额': '20' },
    { '地区': '华北', '品类': 'A', '金额': '5' },
    { '地区': '华北', '品类': 'B', '金额': '' }
];

function setTable(headers, rows) {
    run(`currentTableId = 1; currentHeaders = ${JSON.stringify(headers)}; currentRows = ${JSON.stringify(rows)};`);
}

/** 一份「正常情况下」的服务端返回，用例只覆盖自己关心的那几个字段 */
function pivotData(over) {
    return Object.assign({
        rowKeys: ['华东', '华北'],
        colKeys: ['A', 'B'],
        cells: [['40', '20'], ['5', '']],
        rowTotals: ['60', '5'],
        colTotals: ['45', '20'],
        grandTotal: '65',
        sourceRows: 4,
        valueLabel: '求和(金额)'
    }, over || {});
}

async function main() {
    // ---------- 1) 打开弹窗 ----------
    console.log('[1] 打开弹窗：守卫 + 下拉填充');
    setTable([], []);
    api.openPivotModal();
    check('没有表格时不打开面板', getEl('pivotModal').style.display !== 'flex', getEl('pivotModal').style.display);
    check('并且给了提示', H.toasts().length === 1 && H.toasts()[0].indexOf('上传') !== -1, H.toasts());

    setTable(HEADERS, ROWS);
    H.resetLogs();
    api.openPivotModal();
    check('有表格时打开面板', getEl('pivotModal').style.display === 'flex');
    check('行字段下拉带「不分组」', getEl('pivotRowField').innerHTML.indexOf('不分组') !== -1);
    check('列字段下拉带「不分组」', getEl('pivotColField').innerHTML.indexOf('不分组') !== -1);
    check('行字段默认第一列', getEl('pivotRowField').value === '地区', getEl('pivotRowField').value);
    check('列字段默认不分组', getEl('pivotColField').value === '', getEl('pivotColField').value);
    check('汇总列默认挑数值列（跳过非数字的「地区」）',
        getEl('pivotValueField').value === '金额', getEl('pivotValueField').value);
    check('汇总列表里没有「不分组」', getEl('pivotValueField').innerHTML.indexOf('不分组') === -1);

    // 汇总方式的选项写在 modal-templates.js 的模板里（本用例不加载 DOM 模板），
    // 所以从模板原文里取 —— 顺便钉一条漂移防护：这份清单必须与后端 Aggs 一致。
    console.log('\n[1b] 汇总方式：模板选项必须与后端 Aggs 一致（漂移防护）');
    const tpl = fs.readFileSync(path.join(WWW, 'js', 'modal-templates.js'), 'utf8');
    const aggBlock = /id="pivotAgg"[\s\S]*?<\/select>/.exec(tpl);
    const options = aggBlock ? [...aggBlock[0].matchAll(/value="([^"]+)"/g)].map(m => m[1]) : [];
    const csText = fs.readFileSync(
        path.join(__dirname, '..', '..', 'ExcelToWeb', 'Services', 'Excel', 'PivotService.cs'), 'utf8');
    const aggsLine = /Aggs\s*=\s*\{([^}]*)\}/.exec(csText);
    const serverAggs = aggsLine ? aggsLine[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean) : [];
    check('模板里能找到 pivotAgg 且有 5 个选项', options.length === 5, options);
    check('能从 PivotService.cs 里读到聚合白名单', serverAggs.length === 5, serverAggs);
    check('两侧聚合方式完全一致',
        JSON.stringify(options.slice().sort()) === JSON.stringify(serverAggs.slice().sort()),
        JSON.stringify(options.slice().sort()) + ' vs ' + JSON.stringify(serverAggs.slice().sort()));

    getEl('pivotAgg').innerHTML = aggBlock ? aggBlock[0] : '';
    check('汇总方式默认求和', getEl('pivotAgg').value === 'sum', getEl('pivotAgg').value);

    // ---------- 2) 生成预览 ----------
    console.log('\n[2] 生成预览：请求 + 渲染');
    getEl('pivotColField').value = '品类';
    getEl('pivotValueField').value = '金额';
    const c0 = fetchCalls.length;
    api.runPivot();
    await flush();

    check('发出了一个请求', fetchCalls.length === c0 + 1);
    check('地址与方法是 POST /api/excel/pivot',
        lastCall().url === '/api/excel/pivot' && lastCall().opts.method === 'POST', lastCall().url);
    check('带上了 Authorization', lastCall().opts.headers['Authorization'] === 'Bearer T', lastCall().opts.headers);
    const sent = JSON.parse(lastCall().opts.body);
    check('请求体字段名与后端 DTO 一致',
        sent.tableId === 1 && sent.rowField === '地区' && sent.colField === '品类'
        && sent.valueField === '金额' && sent.agg === 'sum', sent);

    respond(c0, 200, { success: true, message: '操作成功', data: pivotData() });
    await flush();

    const html = getEl('pivotPreview').innerHTML;
    check('行标签渲染出来了', html.indexOf('华东') !== -1 && html.indexOf('华北') !== -1);
    check('列表头是展开键', html.indexOf('>A<') !== -1 && html.indexOf('>B<') !== -1);
    check('角上是行字段名', html.indexOf('pivot-corner">地区<') !== -1, html.slice(0, 200));
    check('格子值原样来自服务端', html.indexOf('>40<') !== -1 && html.indexOf('>20<') !== -1 && html.indexOf('>5<') !== -1);
    check('行合计列', html.indexOf('>60<') !== -1);
    check('合计行的列合计与总计', html.indexOf('>45<') !== -1 && html.indexOf('>65<') !== -1);
    check('合计行有独立样式类', html.indexOf('pivot-totals-row') !== -1);
    check('「合计」出现两次（列表头 + 合计行行首）',
        html.split('合计').length - 1 === 2, html.split('合计').length - 1);
    check('四行（表头 + 两个分组 + 一个合计行）', html.split('<tr').length - 1 === 4, html.split('<tr').length - 1);
    check('提示里说清了数据量与口径',
        getEl('pivotHint').textContent.indexOf('共 4 行原始数据') !== -1
        && getEl('pivotHint').textContent.indexOf('求和(金额)') !== -1, getEl('pivotHint').textContent);
    check('状态栏更新了', H.status().indexOf('透视汇总完成') !== -1, H.status());

    console.log('\n[3] 没有数据的格子显示成 —，不是 0');
    check('有一个空值格子', html.indexOf('pivot-empty') !== -1);
    check('空值显示为破折号', html.indexOf('>—<') !== -1);
    check('空值格子只有一个', html.split('pivot-empty').length - 1 === 1, html.split('pivot-empty').length - 1);

    // ---------- 4) 不分组 ----------
    console.log('\n[4] 两个维度都不分组：只有一行合计');
    H.resetLogs();
    const c1 = fetchCalls.length;
    getEl('pivotRowField').value = '';
    getEl('pivotColField').value = '';
    api.runPivot();
    await flush();
    respond(c1, 200, {
        success: true, data: pivotData({
            rowKeys: [''], colKeys: [''], cells: [['65']], rowTotals: ['65'],
            colTotals: ['65'], grandTotal: '65'
        })
    });
    await flush();
    const html2 = getEl('pivotPreview').innerHTML;
    check('只有一行数据', html2.split('<tr').length - 1 === 2, html2.split('<tr').length - 1);
    check('不再重复渲染一行「合计」', html2.indexOf('pivot-totals-row') === -1);
    check('唯一的数值列用值标签当表头', html2.indexOf('求和(金额)') !== -1, html2.slice(0, 300));
    check('那个格子就是总计', html2.indexOf('>65<') !== -1);

    // ---------- 5) 前端当场拦住的两种错 ----------
    console.log('\n[5] 能当场说清的错就不发请求');
    H.resetLogs();
    setTable([], []);
    // 表里一列都没有：下拉自然是空的（把选项清掉来模拟），此时不该发请求
    getEl('pivotValueField').innerHTML = '';
    getEl('pivotValueField').value = null;
    const c2 = fetchCalls.length;
    api.runPivot();
    await flush();
    check('没有可选的汇总列时不发请求', fetchCalls.length === c2, fetchCalls.length - c2);
    check('并且提示要选列', H.toasts().some(t => t.indexOf('汇总的列') !== -1), H.toasts());

    H.resetLogs();
    setTable(HEADERS, ROWS);
    api.openPivotModal();
    getEl('pivotRowField').value = '地区';
    getEl('pivotColField').value = '地区';
    api.runPivot();
    await flush();
    check('行 = 列时不发请求', fetchCalls.length === c2, fetchCalls.length - c2);
    check('提示说清了原因', H.toasts().some(t => t.indexOf('同一列') !== -1), H.toasts());

    // ---------- 6) 服务端拒绝 ----------
    console.log('\n[6] 服务端拒绝：显示原因并清掉旧结果');
    H.resetLogs();
    getEl('pivotColField').value = '品类';
    const c3 = fetchCalls.length;
    api.runPivot();
    await flush();
    respond(c3, 400, { success: false, message: '「金额」里有不是数字的内容（例如「abc」），无法求和。' });
    await flush();
    check('提示里带上了服务端的原话（不是笼统的「请求失败」）',
        getEl('pivotHint').textContent.indexOf('不是数字') !== -1, getEl('pivotHint').textContent);
    check('提示被标记为错误', getEl('pivotHint').classList.contains('is-error'));
    check('旧表格被清掉（免得看着旧数字以为成功了）',
        getEl('pivotPreview').innerHTML.indexOf('还没有预览结果') !== -1);
    check('状态栏是失败', H.status().indexOf('汇总失败') !== -1, H.status());

    console.log('\n[7] 没有成功预览时不许导出');
    H.resetLogs();
    const c4 = fetchCalls.length;
    api.exportPivot();
    await flush();
    check('不发导出请求', fetchCalls.length === c4);
    check('提示先预览', H.toasts().some(t => t.indexOf('先') !== -1 && t.indexOf('预览') !== -1), H.toasts());

    // ---------- 8) 导出复用上一次成功预览的请求 ----------
    console.log('\n[8] 导出：复用上次成功预览的请求，文件名带时间戳');
    H.resetLogs();
    const c5 = fetchCalls.length;
    api.runPivot();
    await flush();
    respond(c5, 200, { success: true, data: pivotData() });
    await flush();
    const previewBody = fetchCalls[c5].opts.body;

    // 用户改了下拉但没重新生成：导出必须是屏幕上那一张
    getEl('pivotRowField').value = '品类';
    getEl('pivotAgg').value = 'max';
    const c6 = fetchCalls.length;
    api.exportPivot();
    await flush();
    check('发出了导出请求', fetchCalls.length === c6 + 1);
    check('地址是 POST /api/excel/pivot-export',
        lastCall().url === '/api/excel/pivot-export' && lastCall().opts.method === 'POST', lastCall().url);
    check('导出用的还是上次预览的请求体，不受下拉框后续改动影响',
        lastCall().opts.body === previewBody, lastCall().opts.body);
    check('导出请求也带了 Authorization', lastCall().opts.headers['Authorization'] === 'Bearer T');

    respond(c6, 200, { success: true });
    await flush();
    const dls = H.downloads();
    check('触发了下载', dls.length === 1, dls);
    check('文件名形如 透视_20260911_165130.xlsx',
        /^透视_\d{8}_\d{6}\.xlsx$/.test(dls[0].filename), dls[0] && dls[0].filename);
    check('导出成功给了提示', H.toasts().some(t => t.indexOf('导出成功') !== -1), H.toasts());

    console.log('\n[9] 导出失败：把 400 里的 message 取出来当提示');
    H.resetLogs();
    const c7 = fetchCalls.length;
    api.exportPivot();
    await flush();
    respond(c7, 400, { success: false, message: '「金额」的不同取值超过 200 个' });
    await flush();
    check('提示里是服务端的原因，不是「导出失败」四个字',
        H.toasts().some(t => t.indexOf('超过 200') !== -1), H.toasts());
    check('没有触发第二次下载', H.downloads().length === 1);

    // ---------- 10) 连点两次只认最后一次 ----------
    console.log('\n[10] 连点「生成预览」：旧响应不许覆盖新结果');
    H.resetLogs();
    // [8] 里故意把行 / 列改成了同一列，这里先恢复成合法组合，否则会被前端守卫拦下
    getEl('pivotRowField').value = '地区';
    getEl('pivotColField').value = '品类';
    getEl('pivotAgg').value = 'sum';
    const a = fetchCalls.length;
    api.runPivot();          // 第 a 个请求（先发）
    await flush();
    api.runPivot();          // 第 a+1 个请求（后发）
    await flush();
    check('发了两次请求', fetchCalls.length === a + 2);

    respond(a + 1, 200, { success: true, data: pivotData({
        rowKeys: ['新分组'], colKeys: ['A', 'B'], cells: [['新', '新']],
        rowTotals: ['新'], colTotals: ['新', '新'], grandTotal: '新'
    }) });
    await flush();
    respond(a, 200, { success: true, data: pivotData({
        rowKeys: ['旧分组'], colKeys: ['A', 'B'], cells: [['旧', '旧']],
        rowTotals: ['旧'], colTotals: ['旧', '旧'], grandTotal: '旧'
    }) });
    await flush();
    const html3 = getEl('pivotPreview').innerHTML;
    check('屏幕上留下的是后发那次的结果', html3.indexOf('新分组') !== -1, html3.slice(0, 200));
    check('先回来的旧结果被丢掉', html3.indexOf('旧分组') === -1);

    // ---------- 11) 换表后旧预览失效 ----------
    console.log('\n[11] 换表格后，上一次的预览不能留（否则会导出错表）');
    H.resetLogs();
    run('currentTableId = 2;');
    api.openPivotModal();
    check('重新打开时清掉了上一次结果',
        getEl('pivotPreview').innerHTML.indexOf('还没有预览结果') !== -1);
    H.resetLogs();
    const c8 = fetchCalls.length;
    api.exportPivot();
    await flush();
    check('此时导出被拦（必须为新表先生成预览）',
        fetchCalls.length === c8 && H.toasts().some(t => t.indexOf('预览') !== -1), H.toasts());

    console.log('\n[12] 关闭弹窗');
    api.closePivotModal();
    check('弹窗被隐藏', getEl('pivotModal').style.display === 'none', getEl('pivotModal').style.display);

    console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
    console.log('  FAIL 用例执行异常 -> ' + (err && err.stack ? err.stack : err));
    process.exit(1);
});
