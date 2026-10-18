// ================================================================
// 数据看板 · 视图层：统计卡 / 图表卡 / 汇总表的 HTML 装配
// ----------------------------------------------------------------
// 只做「model → HTML」，不取数、不聚合、不改全局状态（唯一例外是
// renderSummaryRows 需要就地更新已渲染的 tbody / tfoot / 表头）。
// 这样拆分的目的：看板的模板会随设计稿反复微调，逻辑层不该跟着频繁改动。
// ================================================================

function fmtNumber(value) {
    const n = Number(value) || 0;
    const locale = isEnglish() ? 'en-US' : 'zh-CN';
    return Math.abs(n) >= 100 ? Math.round(n).toLocaleString(locale) : String(Math.round(n * 100) / 100);
}

/** 指标单位：金额类补「元」，其余不硬塞单位（数量后面挂个「元」是用户一眼能看穿的错） */
function metricUnit(metric) {
    if (!/元|价|金额|额|费|收入|成本/.test(String(metric))) return '';
    return isEnglish() ? 'CNY' : '元';
}

function dashOptions(items, selected) {
    return items.map(it => '<option value="' + escapeHtml(it.value) + '"'
        + (String(it.value) === String(selected) ? ' selected' : '') + '>'
        + escapeHtml(it.text) + '</option>').join('');
}

function dashField(labelText, selectId, optionsHtml, onChange) {
    return '<label class="field"><span>' + labelText + '</span>'
        + '<select id="' + selectId + '" onchange="' + onChange + '">' + optionsHtml + '</select></label>';
}

/** 完成率点阵：6 个点表示进度，比再画一根进度条更轻 */
function rateDots(rate) {
    const filled = Math.round((rate / 100) * 6);
    let dots = '';
    for (let i = 0; i < 6; i++) dots += '<i class="' + (i < filled ? 'is-on' : '') + '"></i>';
    return '<span class="rate-dots" aria-hidden="true">' + dots + '</span>';
}

function statCard(tone, icon, label, value, unit, foot, extra) {
    return '<div class="stat-card stat-accent-' + tone + '">'
        + '<div class="stat-head"><span class="stat-icon"><svg class="icon"><use href="' + icon + '"/></svg></span>'
        + '<span class="label">' + label + '</span></div>'
        + '<div class="value">' + value + (unit ? '<span class="value-unit">' + unit + '</span>' : '') + '</div>'
        + '<div class="stat-foot">' + (foot || '') + (extra || '') + '</div>'
        + '</div>';
}

/** 四张统计卡；顺序与设计稿一致：记录数 / 合计 / 平均 / 完成率 */
function renderStatCards(model) {
    const stats = model.stats;
    return '<div class="stats-grid">'
        + statCard('blue', '#i-table', tt('总记录数'), fmtNumber(model.totalRows), tt('行'),
            tt('{tables} 张表 · {groups} 个{dim}', {
                tables: fmtNumber(model.tableCount),
                groups: fmtNumber(model.groupCount),
                dim: escapeHtml(model.dim)
            }))
        + statCard('green', '#i-sigma', tt('{metric}合计', { metric: escapeHtml(model.metric) }),
            fmtNumber(stats.sum), metricUnit(model.metric),
            tt('{n} 条记录 · 均值 {avg}', { n: stats.count, avg: formatCompact(stats.avg) }))
        + statCard('purple', '#i-columns', tt('平均{metric}', { metric: escapeHtml(model.metric) }),
            fmtNumber(stats.avg), metricUnit(model.metric),
            tt('中位数 {median} · 最高 {max}', {
                median: formatCompact(stats.median),
                max: formatCompact(stats.max)
            }))
        + statCard('amber', '#i-check', model.rate.label, String(model.rate.rate), '%', model.rate.foot,
            rateDots(model.rate.rate))
        + '</div>';
}

/** 图表卡：标题 + 类型分段控件 / 筛选行 / 元信息行 / 可横向滚动的画布 */
function renderChartCard(view) {
    const types = [
        { key: 'bar', icon: '#i-chart', title: tt('柱状图') },
        { key: 'line', icon: '#i-trend', title: tt('折线图') },
        { key: 'area', icon: '#i-area', title: tt('面积图') },
        { key: 'horizontal', icon: '#i-bars-h', title: tt('水平条形图') },
        { key: 'pie', icon: '#i-pie', title: tt('环形图') }
    ];
    let seg = '';
    for (const t of types) {
        seg += '<button type="button" class="seg-btn' + (t.key === view.chartType ? ' is-on' : '') + '"'
            + ' data-type="' + t.key + '" title="' + t.title + '" aria-label="' + t.title + '"'
            + ' onclick="setChartType(\'' + t.key + '\')">'
            + '<svg class="icon"><use href="' + t.icon + '"/></svg></button>';
    }

    return '<section class="dash-card chart-card">'
        + '<div class="dash-card-head">'
        + '<div class="dash-card-title-group">'
        + '<span class="dash-card-title"><svg class="icon"><use href="#i-chart"/></svg>' + tt('图表分析') + '</span>'
        + '<span class="dash-card-sub" id="chartSub"></span>'
        + '</div>'
        + '<div class="seg" role="group" aria-label="' + tt('图表类型') + '">' + seg + '</div>'
        + '</div>'
        + '<div class="dash-card-toolbar">'
        + view.tableSelect
        + dashField(tt('分组'), 'dimSelect', dashOptions(view.dims.map(d => ({ value: d, text: d })), view.dim), 'updateChart()')
        + dashField(tt('指标'), 'metricSelect', dashOptions(view.metrics.map(m => ({ value: m, text: m })), view.metric), 'updateChart()')
        + '<span class="spacer"></span>'
        + '<button type="button" class="chip-btn" id="logToggle" onclick="toggleLogScale()" hidden>' + tt('对数轴') + '</button>'
        + '<span class="chart-count" id="chartCount"></span>'
        + '</div>'
        + '<div class="chart-meta"><span id="chartMetaText"></span><span class="chart-avg" id="chartAvg"></span></div>'
        + '<div class="chart-scroll" id="chartScroll"><div id="chartContainer"></div></div>'
        + '</section>';
}

/** 汇总表：表头右侧是合计，表体每行带占比条，表尾一行总计 */
function renderSummaryCard(model) {
    return '<section class="dash-card summary-card">'
        + '<div class="dash-card-head">'
        + '<div class="dash-card-title-group">'
        + '<span class="dash-card-title"><svg class="icon"><use href="#i-table"/></svg>' + tt('分组汇总') + '</span>'
        + '<span class="dash-card-sub" id="summarySub"></span>'
        + '</div>'
        + '<span class="summary-total" id="summaryTotal"></span>'
        + '</div>'
        + '<div class="table-scroll"><table>'
        + '<thead><tr><th id="thDim">' + escapeHtml(model.dim) + '</th><th class="num">' + tt('记录数') + '</th>'
        + '<th class="num" id="thSum">' + tt('{metric}合计', { metric: escapeHtml(model.metric) }) + '</th>'
        + '<th class="num" id="thAvg">' + tt('{metric}平均', { metric: escapeHtml(model.metric) }) + '</th>'
        + '<th class="num">' + tt('占合计比例') + '</th></tr></thead>'
        + '<tbody id="summaryBody"></tbody>'
        + '<tfoot id="summaryFoot"></tfoot>'
        + '</table></div></section>';
}

/**
 * 汇总表按当前分组重算。表头也要跟着下拉框换 —— 只换表体的话，
 * 用户切到「地区」后列名还写着「销售员」，是很容易漏掉的错位。
 */
function renderSummaryRows(dim, metric, keys, groups, stats) {
    const thDim = document.getElementById('thDim');
    if (thDim) thDim.textContent = dim;
    const thSum = document.getElementById('thSum');
    if (thSum) thSum.textContent = tt('{metric}合计', { metric: metric });
    const thAvg = document.getElementById('thAvg');
    if (thAvg) thAvg.textContent = tt('{metric}平均', { metric: metric });

    const tbody = document.getElementById('summaryBody');
    if (tbody) {
        let html = '';
        for (const key of keys) {
            const g = groups[key];
            const share = stats.sum ? (g.total / stats.sum) * 100 : 0;
            html += '<tr>'
                + '<td class="dim">' + escapeHtml(key) + '</td>'
                + '<td class="num">' + fmtNumber(g.count) + '</td>'
                + '<td class="num strong">' + fmtNumber(g.total) + '</td>'
                + '<td class="num">' + fmtNumber(g.count ? g.total / g.count : 0) + '</td>'
                + '<td class="num share"><span class="ratio"><i style="width:' + share.toFixed(1) + '%"></i></span>'
                + '<span class="ratio-num">' + share.toFixed(1) + '%</span></td>'
                + '</tr>';
        }
        tbody.innerHTML = html;
    }

    const foot = document.getElementById('summaryFoot');
    if (foot) {
        foot.innerHTML = '<tr><td>' + tt('合计 · {n} 组', { n: keys.length }) + '</td>'
            + '<td class="num">' + fmtNumber(rows.length) + '</td>'
            + '<td class="num strong">' + fmtNumber(stats.sum) + '</td>'
            + '<td class="num">' + fmtNumber(stats.avg) + '</td>'
            + '<td class="num">100%</td></tr>';
    }

    const sub = document.getElementById('summarySub');
    if (sub) sub.textContent = tt('按「{dim}」分组 · 共 {n} 组', { dim: dim, n: keys.length });
    const total = document.getElementById('summaryTotal');
    if (total) total.innerHTML = '<span>' + tt('合计') + '</span> ' + fmtNumber(stats.sum) + ' ' + metricUnit(metric);
}
