// ================================================================
// 透视汇总：行分组 × 列展开 × 值聚合
// ----------------------------------------------------------------
// 这里一行数据都不算 —— 行列顺序与每个格子的数字全部来自服务端
// （Services/Excel/PivotService.cs）。前端只做两件事：
//   1) 把用户选的行 / 列 / 值字段发过去
//   2) 把返回的二维结果画成表格
//
// 为什么不干脆在前端算一遍：算就必然有第二份实现，而 Excel 导出用的是服务端那份，
// 两份迟早对不上 —— 那时用户看到的就是「预览 12.5、导出 12.4」，
// 而且他没有任何办法判断哪个是对的。
//
// 依赖：state.js（currentTableId / currentHeaders）、utils.js、api.js
// ================================================================

/** 请求序号：连点两次「生成预览」时只认最后一次回来的结果 */
let pivotSeq = 0;

/**
 * 最近一次成功预览用的请求参数。导出沿用它而不是重新读下拉框 ——
 * 用户看到的是哪张表，导出的就必须是哪张表。
 */
let pivotLastRequest = null;

// ================================================================
// 弹窗开关
// ================================================================

function openPivotModal() {
    if (!currentTableId || currentHeaders.length === 0) {
        showToast('请先上传并打开一个表格', 'error');
        return;
    }

    // 中途换过表格：上一次的预览属于另一张表，留着会导出错表
    if (pivotLastRequest && pivotLastRequest.tableId !== currentTableId) resetPivot();

    populatePivotFields();
    const modal = document.getElementById('pivotModal');
    if (modal) modal.style.display = 'flex';
}

function closePivotModal() {
    const modal = document.getElementById('pivotModal');
    if (modal) modal.style.display = 'none';
}

/** 清掉上一次的表与状态（换表、或汇总失败后调用） */
function resetPivot() {
    pivotLastRequest = null;
    renderPivotEmpty();
    setPivotHint('选好行 / 列 / 值字段后点「生成预览」。', false);
}

// ================================================================
// 字段下拉
// ================================================================

/** 用当前表的列名填充三个下拉；已选中的列还在就保留 */
function populatePivotFields() {
    const headers = currentHeaders.slice();
    if (headers.length === 0) return;

    const rowSel = document.getElementById('pivotRowField');
    const colSel = document.getElementById('pivotColField');
    const valSel = document.getElementById('pivotValueField');
    if (!rowSel || !colSel || !valSel) return;

    // 值字段默认挑第一个数值列 —— 做透视十有八九就是为了汇总数字
    const numeric = headers.filter(isNumericColumn);
    const defaultValue = numeric.length > 0 ? numeric[0] : headers[0];

    fillPivotSelect(rowSel, headers, true, currentPivotValue(rowSel) || headers[0]);
    fillPivotSelect(colSel, headers, true, currentPivotValue(colSel));
    fillPivotSelect(valSel, headers, false, currentPivotValue(valSel) || defaultValue);
}

function currentPivotValue(sel) {
    return sel && sel.value ? sel.value : '';
}

/** allowEmpty 为真时多一个「不分组」选项（行 / 列维度可以不用） */
function fillPivotSelect(sel, headers, allowEmpty, keep) {
    const options = allowEmpty ? ['<option value="">不分组</option>'] : [];
    for (const name of headers) {
        options.push(`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
    }

    sel.innerHTML = options.join('');
    if (keep && headers.indexOf(keep) !== -1) sel.value = keep;
}

function readPivotSelect(id) {
    const el = document.getElementById(id);
    return el && el.value ? el.value : '';
}

/** 把弹窗里的四项读成请求体 */
function readPivotRequest() {
    return {
        tableId: currentTableId,
        rowField: readPivotSelect('pivotRowField'),
        colField: readPivotSelect('pivotColField'),
        valueField: readPivotSelect('pivotValueField'),
        agg: readPivotSelect('pivotAgg') || 'sum'
    };
}

// ================================================================
// 生成预览
// ================================================================

function runPivot() {
    const req = readPivotRequest();
    if (!req.valueField) {
        showToast('请先选择要汇总的列', 'error');
        return;
    }
    // 服务端也会拦这一条，但当场说是能省一趟往返的
    if (req.rowField && req.rowField === req.colField) {
        showToast('行字段与列字段不能是同一列', 'error');
        return;
    }

    const seq = ++pivotSeq;
    setStatus('汇总中...');
    setPivotHint('正在汇总…', false);

    buildPivot(req)
        .then(data => {
            if (seq !== pivotSeq) return;   // 期间又发了一次，这份结果已经过期
            pivotLastRequest = req;
            renderPivot(data, req);
            setStatus('透视汇总完成');
        })
        .catch(err => {
            if (seq !== pivotSeq) return;
            pivotLastRequest = null;
            renderPivotEmpty();
            setPivotHint('❌ ' + err.message, true);
            setStatus('汇总失败');
        });
}

/**
 * 把服务端回来的二维结果画成表格。
 * 行 / 列 / 值全部是字符串，这里不做任何换算（哪怕只是补个千分位）——
 * 数字一旦在客户端再加工一次，「和导出一不一样」就没法保证了。
 */
function renderPivot(data, req) {
    const noRow = !req.rowField;
    // 不分组时那一列没有列名，用值标签当表头，否则会是一整列空白
    const colLabels = req.colField ? data.colKeys : [data.valueLabel];

    if (data.sourceRows === 0) {
        renderPivotEmpty();
        setPivotHint('这张表还没有数据', true);
        return;
    }
    if (data.rowKeys.length === 0 && data.colKeys.length === 0) {
        renderPivotEmpty();
        setPivotHint('所选的行 / 列字段里没有可分组的内容（空单元格不参与分组）', true);
        return;
    }

    const head = [`<th class="pivot-corner">${escapeHtml(noRow ? '合计' : req.rowField)}</th>`];
    for (const label of colLabels) head.push(`<th>${escapeHtml(label)}</th>`);
    head.push('<th class="pivot-total">合计</th>');

    const body = [];
    for (let r = 0; r < data.rowKeys.length; r++) {
        const cells = data.cells[r] || [];
        const tds = [`<th class="pivot-row-label">${escapeHtml(noRow ? '合计' : data.rowKeys[r])}</th>`];
        for (let c = 0; c < colLabels.length; c++) tds.push(pivotCellHtml(cells[c]));
        tds.push(pivotCellHtml(data.rowTotals[r], 'pivot-total'));
        body.push('<tr>' + tds.join('') + '</tr>');
    }

    // 没有行分组时，唯一那一行本身就是总计，再补一行「合计」只是把同一组数字重复一遍
    if (!noRow) {
        const tds = ['<th class="pivot-row-label">合计</th>'];
        for (let c = 0; c < colLabels.length; c++) tds.push(pivotCellHtml(data.colTotals[c], 'pivot-total'));
        tds.push(pivotCellHtml(data.grandTotal, 'pivot-grand'));
        body.push('<tr class="pivot-totals-row">' + tds.join('') + '</tr>');
    }

    const box = document.getElementById('pivotPreview');
    if (box) {
        box.innerHTML = '<div class="pivot-scroll"><table class="pivot-table">'
            + '<thead><tr>' + head.join('') + '</tr></thead>'
            + '<tbody>' + body.join('') + '</tbody></table></div>';
    }

    const dims = (noRow ? '不分组' : data.rowKeys.length + ' 组')
        + ' × ' + (req.colField ? data.colKeys.length + ' 列' : '不分组');
    setPivotHint(`共 ${data.sourceRows} 行原始数据 · ${data.valueLabel} · ${dims}`, false);
}

/** 一个格子。空串是「这个组合没有数据」，显示成 — 而不是 0（两者不是一回事） */
function pivotCellHtml(text, extraClass) {
    const cls = 'pivot-num' + (extraClass ? ' ' + extraClass : '');
    if (text === undefined || text === null || text === '') {
        return `<td class="${cls} pivot-empty" title="没有数据">—</td>`;
    }
    return `<td class="${cls}">${escapeHtml(text)}</td>`;
}

function renderPivotEmpty() {
    const box = document.getElementById('pivotPreview');
    if (box) box.innerHTML = '<p class="pivot-placeholder">还没有预览结果</p>';
}

function setPivotHint(text, isError) {
    const el = document.getElementById('pivotHint');
    if (!el) return;
    el.classList.toggle('is-error', !!isError);
    el.textContent = text;
}

// ================================================================
// 导出
// ================================================================

/**
 * 导出成 xlsx（原始数据表 + 「透视」工作表两张）。
 * 先要有一次成功的预览才允许导出：导出的必须是屏幕上已经看过的数字。
 */
function exportPivot() {
    if (!pivotLastRequest) {
        showToast('请先生成预览，确认数字没问题再导出', 'error');
        return;
    }

    setStatus('导出中...');
    exportPivotBlob(pivotLastRequest)
        .then(blob => {
            downloadBlob(blob, '透视_' + pivotStamp() + '.xlsx');
            setStatus('已导出');
            showToast('✅ 导出成功（含原始数据表与「透视」表）', 'success');
        })
        .catch(err => {
            setStatus('导出失败');
            showToast('❌ 导出失败：' + err.message, 'error');
        });
}

/** 文件名用的时间戳：20260911_165130 */
function pivotStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
        + `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
