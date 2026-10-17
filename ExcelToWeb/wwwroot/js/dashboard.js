// ================================================================
// 数据看板 · 逻辑层：取数 → 识别维度/指标 → 聚合 → 驱动视图与图表
// ----------------------------------------------------------------
// 三个协作文件的边界：
//   dashboard.js（本文件）  取数、识别维度、聚合、控件与图表的联动
//   dashboard-view.js       统计卡/图表卡/汇总表的 HTML 装配（纯 model -> HTML）
//   chart.js + chart-render.js  画布尺寸/滚动策略 + ECharts 选项
// ================================================================

// 可作为「分组维度」的文本列，取值去重数上限。太大 → 备注、姓名这类自由文本
// 也会被当成维度塞进下拉框；太小 → 「20 个销售员」这种正常场景反而识别不出来。
const DASH_DIM_MAX = 50;

const EXCLUDED_COLUMNS = ['序号', 'id', 'ID', '编号', '行号', 'No', 'NO', 'no'];
const PREFERRED_METRICS = ['单价(元)', '总价', '金额', '数量', 'total', 'price', 'amount', '销售额', '成交额'];

let tableId = null;
let tablesCache = [];     // 表格选择器的数据源：此前看板硬取 tables[0]，其余表根本无法查看
let headers = [];
let rows = [];

let chartType = 'bar';    // 当前图表类型（分段按钮维护，不再依赖 <select>）
let logScaleOn = false;   // 对数轴开关：仅极值悬殊时可用
let resizeTimer = null;

// ================================================================
// 取数
// ================================================================
function fetchDashboardData() {
    showDashboardSkeleton();
    fetchTableList()
        .then(tables => {
            if (!tables || tables.length === 0) {
                showEmptyState('暂无数据，请先上传 Excel 文件');
                return;
            }
            tablesCache = tables;
            // 优先恢复上次看过的表；那张表已被删除时回落到第一张
            const saved = localStorage.getItem('dashboardTableId');
            tableId = tables.some(t => String(t.id) === saved) ? Number(saved) : tables[0].id;
            loadData(tableId);
        })
        .catch(err => {
            showEmptyState('加载数据失败：' + err.message);
            console.error('fetchDashboardData 错误:', err);
        });
}

/** 切换看板的表格（表格选择器 onchange 入口） */
function onDashboardTableChange(el) {
    tableId = Number(el.value);
    localStorage.setItem('dashboardTableId', String(tableId));
    logScaleOn = false;
    loadData(tableId);
}

function loadData(id) {
    queryTableData(id)
        .then(data => {
            if (data && data.headers && data.rows && data.rows.length > 0) {
                headers = data.headers;
                rows = data.rows;
                renderDashboard();
            } else {
                showEmptyState('该表格没有数据');
            }
        })
        .catch(err => {
            showEmptyState('加载数据失败：' + err.message);
            console.error('loadData 错误:', err);
        });
}

/** 骨架屏：统计卡 + 图表卡的占位轮廓（样式见 table.css 骨架屏段） */
function showDashboardSkeleton() {
    const container = document.getElementById('dashboardContent');
    if (!container) return;
    let html = '<div class="stats-grid">';
    for (let i = 0; i < 4; i++) {
        html += '<div class="stat-card skeleton-card" aria-hidden="true">'
            + '<div class="skeleton-block" style="height:12px; width:45%;"></div>'
            + '<div class="skeleton-block" style="height:28px; width:65%; margin-top:12px;"></div>'
            + '<div class="skeleton-block" style="height:11px; width:55%; margin-top:12px;"></div>'
            + '</div>';
    }
    html += '</div>';
    html += '<div class="skeleton-block" style="height:380px; margin-top:14px;" aria-hidden="true"></div>';
    container.innerHTML = html;
}

function showEmptyState(msg) {
    const container = document.getElementById('dashboardContent');
    if (!container) return;
    container.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="icon"><use href="#i-inbox"/></svg></div>'
        + '<p>' + escapeHtml(msg) + '</p></div>';
}

// ================================================================
// 识别维度与指标
// ================================================================
function identifyDimensions() {
    const dims = [];
    const metrics = [];

    for (const col of headers) {
        if (EXCLUDED_COLUMNS.includes(col)) continue;

        const nonEmpty = rows.map(r => r[col]).filter(v => v !== undefined && v !== null && v !== '');
        if (nonEmpty.length === 0) continue;

        const unique = {};
        for (const v of nonEmpty) unique[v] = true;
        const uniqueCount = Object.keys(unique).length;
        const isNumeric = nonEmpty.every(v => !isNaN(parseFloat(v)) && isFinite(v));

        if (isNumeric) {
            metrics.push(col);
        } else if (uniqueCount > 1 && uniqueCount <= DASH_DIM_MAX) {
            dims.push(col);
        }
    }
    return { dimensions: dims, metrics: metrics };
}

function groupData(dim, metric) {
    const groups = {};
    for (const row of rows) {
        const dimVal = row[dim] || '未知';
        const metVal = parseFloat(row[metric]) || 0;
        if (!groups[dimVal]) groups[dimVal] = { count: 0, total: 0, items: [] };
        groups[dimVal].count++;
        groups[dimVal].total += metVal;
        groups[dimVal].items.push(row);
    }
    return groups;
}

function pickDefaultMetric(metrics) {
    for (const name of PREFERRED_METRICS) {
        if (metrics.includes(name)) return name;
    }
    return metrics[0];
}

/** 完成率：优先用「是否完成」这类列；没有就把指标覆盖率当完成度，不编造 100% */
function completionInfo(metric) {
    const statusCol = headers.find(h => ['是否完成', '完成情况', '状态'].includes(h));
    if (statusCol) {
        const done = rows.filter(r => ['是', '已完成', '完成', '已交付'].includes(String(r[statusCol]).trim())).length;
        return {
            label: '完成率',
            rate: rows.length ? Math.round((done / rows.length) * 100) : 0,
            foot: done + ' / ' + rows.length + ' 条已完成'
        };
    }
    const filled = rows.filter(r => String(r[metric] === undefined || r[metric] === null ? '' : r[metric]).trim() !== '').length;
    return {
        label: '指标覆盖率',
        rate: rows.length ? Math.round((filled / rows.length) * 100) : 0,
        foot: filled + ' / ' + rows.length + ' 条有值'
    };
}

/** 视图模型：模板需要的数字一次算齐，模板里不再做业务判断 */
function buildViewModel(dim, metric) {
    const values = rows.map(r => parseFloat(r[metric]) || 0);
    return {
        dim: dim,
        metric: metric,
        stats: valueStats(values),
        groupCount: Object.keys(groupData(dim, metric)).length,
        tableCount: tablesCache.length,
        totalRows: rows.length,
        rate: completionInfo(metric)
    };
}

// ================================================================
// 渲染
// ================================================================
function renderDashboard() {
    const container = document.getElementById('dashboardContent');
    if (!container) return;

    disposeChart();

    const found = identifyDimensions();
    const tableOptions = dashOptions(tablesCache.map(t => ({ value: t.id, text: t.tableName })), tableId);
    const tableSelect = dashField('表格', 'dashboardTableSelect', tableOptions, 'onDashboardTableChange(this)');

    if (found.dimensions.length === 0 || found.metrics.length === 0) {
        updateDashHead('', 0);
        container.innerHTML = '<div class="dash-card"><div class="dash-card-toolbar">' + tableSelect + '</div>'
            + '<div class="empty-state"><div class="empty-icon"><svg class="icon"><use href="#i-inbox"/></svg></div>'
            + '<p>数据中未识别到分组维度或数值指标</p>'
            + '<p class="empty-sub">请确保 Excel 含文本列（如销售员）与数值列（如金额）</p></div></div>';
        return;
    }

    const dim = found.dimensions[0];
    const metric = pickDefaultMetric(found.metrics);
    const model = buildViewModel(dim, metric);

    // 换表/重渲染时回到默认视图：柱状图、线性轴
    chartType = 'bar';
    logScaleOn = false;

    container.innerHTML = renderStatCards(model)
        + renderChartCard({
            tableSelect: tableSelect,
            dims: found.dimensions,
            metrics: found.metrics,
            dim: dim,
            metric: metric,
            chartType: chartType
        })
        + renderSummaryCard(model);

    updateChart();
}

// ================================================================
// 图表 + 汇总表联动
// ================================================================
function updateChart() {
    const dimSelect = document.getElementById('dimSelect');
    const metricSelect = document.getElementById('metricSelect');
    if (!dimSelect || !metricSelect) return;

    const dim = dimSelect.value;
    const metric = metricSelect.value;
    const groups = groupData(dim, metric);
    const keys = Object.keys(groups);
    const values = keys.map(k => groups[k].total);
    const stats = valueStats(values);

    renderSummaryRows(dim, metric, keys, groups, stats);
    syncLogToggle(values);

    // 图表上方那行元信息：指标 · 按维度汇总 ／ 平均线
    const metaText = document.getElementById('chartMetaText');
    if (metaText) metaText.textContent = metric + ' · 按「' + dim + '」汇总';
    const avgText = document.getElementById('chartAvg');
    if (avgText) avgText.textContent = stats.count ? '— 平均 ' + formatCompact(stats.avg) : '';
    const countText = document.getElementById('chartCount');
    if (countText) countText.textContent = '共 ' + keys.length + ' 组';
    const subText = document.getElementById('chartSub');
    if (subText) subText.textContent = '按「' + dim + '」分组汇总' + (keys.length > 12 ? ' · 可横向滚动' : '');

    drawChart({
        type: chartType,
        categories: keys,
        values: values,
        metric: metric,
        dimension: dim,
        logScale: logScaleOn
    });

    updateDashHead(dim);
}

/** 对数轴只对数值轴有意义；饼图没有轴，切过去就自动关掉（见 syncLogToggle） */
function typeCannotUseLog(type) {
    return type === 'pie';
}

/** 分段按钮切换图表类型 */
function setChartType(type) {
    chartType = type;
    const buttons = document.querySelectorAll('.seg-btn');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle('is-on', buttons[i].getAttribute('data-type') === type);
    }
    updateChart();
}

/**
 * 极值悬殊时才给「对数轴」开关：倍差够大 → 出现；含 0 / 负值 → 出现但禁用并说明原因。
 * 切换后柱高差距被压缩，小分组不再贴着 0 线看不见。
 */
function syncLogToggle(values) {
    const btn = document.getElementById('logToggle');
    if (!btn) return;
    const advice = logScaleAdvice(values);
    const applicable = !typeCannotUseLog(chartType);
    if (!applicable) logScaleOn = false;

    btn.hidden = !applicable || !advice.offered;
    btn.disabled = !advice.usable;
    btn.classList.toggle('is-on', logScaleOn && advice.usable);
    btn.setAttribute('aria-pressed', String(logScaleOn && advice.usable));
    btn.title = advice.usable
        ? '最大 / 最小相差 ' + Math.round(advice.ratio) + ' 倍，可切对数轴压缩差距'
        : '含 0 或负值，无法使用对数轴';
}

function toggleLogScale() {
    logScaleOn = !logScaleOn;
    updateChart();
}

// ================================================================
// 页头
// ================================================================
function updateDashHead(dim, groupCount) {
    const table = tablesCache.find(t => String(t.id) === String(tableId));
    const tableName = table ? table.tableName : '数据集';
    const sub = document.getElementById('dashSub');
    if (sub) {
        sub.textContent = tableName + (dim ? ' · 按「' + dim + '」分组' : '') + ' · ' + rows.length + ' 条记录';
    }
    const updated = document.getElementById('dashUpdated');
    if (updated) {
        updated.textContent = '数据截至 ' + (table && table.updatedAt ? formatTime(table.updatedAt) : '—');
    }
}

// 主题切换后要重画：ECharts 的颜色是画图时取的设计令牌，不重画就还是旧主题的色
function watchThemeAndResize() {
    const toggle = document.getElementById('themeToggle');
    if (toggle && toggle.addEventListener) {
        // setTimeout 0：shell.js 的点击处理器先把 data-theme 改好，这里再读新值
        toggle.addEventListener('click', () => setTimeout(() => updateChart(), 0));
    }
    // 屏宽变化改变「每组可用宽度」，柱宽与是否横向滚动都要重算（guard 兼作测试沙箱兜底）
    if (window.addEventListener) {
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(redrawChart, 120);
        });
    }
}

// 页面加载时检查登录并获取数据
(function init() {
    if (!localStorage.getItem('token')) {
        window.location.href = '/login.html';
        return;
    }
    watchThemeAndResize();
    fetchDashboardData();
})();

// 供 HTML 内联处理器调用（模板由本文件注入，显式挂一遍更稳）
Object.assign(window, {
    updateChart: updateChart,
    setChartType: setChartType,
    toggleLogScale: toggleLogScale,
    onDashboardTableChange: onDashboardTableChange
});
