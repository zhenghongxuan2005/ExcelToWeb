// ================================================================
// 看板逻辑
// ================================================================

let tableId = null;
let headers = [];
let rows = [];
let chartInstance = null;

const EXCLUDED_METRICS = ['序号', 'id', 'ID', '编号', '行号', 'No', 'NO', 'no'];
const EXCLUDED_DIMENSIONS = ['序号', 'id', 'ID', '编号', '行号', 'No', 'NO', 'no'];

function fetchDashboardData() {
    showDashboardSkeleton();
    fetchTableList()
        .then(tables => {
            if (!tables || tables.length === 0) {
                showEmptyState('暂无数据，请先上传 Excel 文件');
                return;
            }
            tableId = tables[0].id;
            loadData(tableId);
        })
        .catch(err => {
            showEmptyState('加载数据失败：' + err.message);
            console.error('fetchDashboardData 错误:', err);
        });
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

/** 看板加载骨架：统计卡 + 图表区的占位轮廓（样式见 table.css 骨架屏段） */
function showDashboardSkeleton() {
    const container = document.getElementById('dashboardContent');
    if (!container) return;
    let html = '<div class="stats-grid">';
    for (let i = 0; i < 4; i++) {
        html += '<div class="stat-card skeleton-card" aria-hidden="true">'
            + '<div class="skeleton-block" style="height:12px; width:45%;"></div>'
            + '<div class="skeleton-block" style="height:28px; width:65%;"></div>'
            + '</div>';
    }
    html += '</div>';
    html += '<div class="skeleton-block" style="height:340px; margin-top:16px;" aria-hidden="true"></div>';
    container.innerHTML = html;
}

function showEmptyState(msg) {
    const container = document.getElementById('dashboardContent');
    if (!container) return;
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg class="icon"><use href="#i-inbox"/></svg></div><p>${msg}</p></div>`;
}

// ================================================================
// 智能识别维度和指标
// ================================================================
function identifyDimensions() {
    const dims = [];
    const metrics = [];

    for (const col of headers) {
        const values = rows.map(r => r[col]);
        const nonEmpty = values.filter(v => v !== undefined && v !== null && v !== '');
        const unique = {};
        for (const v of nonEmpty) unique[v] = true;
        const uniqueCount = Object.keys(unique).length;

        const numericValues = nonEmpty.filter(v => !isNaN(parseFloat(v)) && isFinite(v));
        const isNumeric = numericValues.length === nonEmpty.length && nonEmpty.length > 0;

        const isExcludedMetric = EXCLUDED_METRICS.includes(col);
        const isExcludedDim = EXCLUDED_DIMENSIONS.includes(col);

        if (isNumeric && !isExcludedMetric) {
            metrics.push(col);
        } else if (uniqueCount > 1 && uniqueCount <= 20 && nonEmpty.length > 0 && !isExcludedDim) {
            dims.push(col);
        }
    }

    return { dimensions: dims, metrics };
}

function groupData(dim, metric) {
    const groups = {};
    for (const row of rows) {
        const dimVal = row[dim] || '未知';
        const metVal = parseFloat(row[metric]) || 0;
        if (!groups[dimVal]) {
            groups[dimVal] = { count: 0, total: 0, items: [] };
        }
        groups[dimVal].count++;
        groups[dimVal].total += metVal;
        groups[dimVal].items.push(row);
    }
    return groups;
}

// ================================================================
// 渲染看板
// ================================================================
function renderDashboard() {
    const container = document.getElementById('dashboardContent');
    const { dimensions: dims, metrics } = identifyDimensions();

    if (dims.length === 0 || metrics.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="icon"><use href="#i-inbox"/></svg></div><p>数据中未识别到分组维度或数值指标</p><p class="empty-sub">请确保 Excel 包含文本列（如销售员）和数值列（如金额）</p></div>';
        return;
    }

    const preferredMetrics = ['单价(元)', '总价', '金额', '数量', 'total', 'price', 'amount', '销售额', '成交额'];
    const defaultDim = dims[0];
    let defaultMetric = metrics[0];
    for (const p of preferredMetrics) {
        if (metrics.includes(p)) {
            defaultMetric = p;
            break;
        }
    }

    const totalRows = rows.length;
    let totalAmount = 0;
    for (const row of rows) {
        totalAmount += parseFloat(row[defaultMetric]) || 0;
    }
    const avgAmount = totalRows > 0 ? totalAmount / totalRows : 0;

    let completionRate = 0;
    const hasCompletion = headers.includes('是否完成');
    if (hasCompletion) {
        let completed = 0;
        for (const row of rows) {
            if (row['是否完成'] === '是' || row['是否完成'] === '已完成') completed++;
        }
        completionRate = rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0;
    } else {
        completionRate = totalAmount > 0 ? 100 : 0;
    }

    let html = '';
    html += '<div class="stats-grid">';
    html += `<div class="stat-card"><div class="label">总记录数</div><div class="value">${totalRows}</div></div>`;
    html += `<div class="stat-card"><div class="label">总金额</div><div class="value">${totalAmount.toFixed(0)}</div></div>`;
    html += `<div class="stat-card"><div class="label">平均值</div><div class="value">${avgAmount.toFixed(0)}</div></div>`;
    html += `<div class="stat-card"><div class="label">完成率</div><div class="value">${completionRate}%</div></div>`;
    html += '</div>';

    const dimOptions = dims.map(d => `<option value="${d}"${d === defaultDim ? ' selected' : ''}>${d}</option>`).join('');
    const metricOptions = metrics.map(m => `<option value="${m}"${m === defaultMetric ? ' selected' : ''}>${m}</option>`).join('');

    html += '<div class="controls">';
    html += `<label>分组：<select id="dimSelect" onchange="updateChart()">${dimOptions}</select></label>`;
    html += `<label>指标：<select id="metricSelect" onchange="updateChart()">${metricOptions}</select></label>`;
    html += '<label>图表：<select id="chartTypeSelect" onchange="updateChart()">';
    html += '<option value="bar">柱状图</option>';
    html += '<option value="line">折线图</option>';
    html += '<option value="area">面积图</option>';
    html += '<option value="horizontal">水平条形图</option>';
    html += '<option value="pie">饼图</option>';
    html += '</select></label></div>';

    html += '<div id="chartContainer"></div>';

    html += '<div class="summary-table-wrap"><table><thead><tr>';
    html += `<th>${defaultDim}</th>`;
    html += '<th>记录数</th>';
    html += `<th>${defaultMetric} 合计</th>`;
    html += `<th>${defaultMetric} 平均</th>`;
    html += '</tr></thead><tbody id="summaryBody"></tbody></table></div>';

    container.innerHTML = html;

    chartInstance = echarts.init(document.getElementById('chartContainer'));
    updateChart();
}

// ================================================================
// 更新图表
// ================================================================
function updateChart() {
    const dimSelect = document.getElementById('dimSelect');
    const metricSelect = document.getElementById('metricSelect');
    const chartTypeSelect = document.getElementById('chartTypeSelect');

    if (!dimSelect || !metricSelect || !chartTypeSelect) return;

    const dim = dimSelect.value;
    const metric = metricSelect.value;
    const chartType = chartTypeSelect.value;

    const groups = groupData(dim, metric);
    const dims = Object.keys(groups);
    const values = dims.map(d => groups[d].total);

    // 更新汇总表格
    const tbody = document.getElementById('summaryBody');
    if (tbody) {
        let tableHtml = '';
        for (const d of dims) {
            const g = groups[d];
            const avg = g.count > 0 ? g.total / g.count : 0;
            tableHtml += `<tr><td><strong>${d}</strong></td><td>${g.count}</td><td>${g.total.toFixed(0)}</td><td>${avg.toFixed(0)}</td></tr>`;
        }
        tbody.innerHTML = tableHtml;
    }

    if (!chartInstance) return;

    // 适配亮/暗主题的坐标轴颜色
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const axisColor = isDark ? '#b3c2d9' : '#4a5a72';
    const splitColor = isDark ? '#223046' : '#eef2f7';

    const option = {
        textStyle: { color: axisColor },
        tooltip: {
            trigger: 'axis',
            formatter: params => {
                const p = params[0];
                return `<strong>${p.name}</strong><br/>${metric}: ${p.value.toFixed(0)}`;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true }
    };

    // 图表重新渲染前刷新主题
    if (chartInstance.__theme !== undefined && chartInstance.__theme !== isDark) {
        chartInstance.dispose();
        chartInstance = echarts.init(document.getElementById('chartContainer'));
    }
    chartInstance.__theme = isDark;

    const colors = ['#1a5cff', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

    switch (chartType) {
        case 'bar':
            option.series = [{ type: 'bar', data: values, barWidth: '40%', itemStyle: { color: '#1a5cff', borderRadius: [4, 4, 0, 0] } }];
            option.xAxis = { type: 'category', data: dims, axisLabel: { rotate: dims.length > 6 ? 30 : 0 } };
            option.yAxis = { type: 'value', name: metric };
            break;
        case 'line':
            option.series = [{ type: 'line', data: values, smooth: true, lineStyle: { color: '#1a5cff', width: 3 }, itemStyle: { color: '#1a5cff' }, areaStyle: { color: 'rgba(26, 92, 255, 0.05)' } }];
            option.xAxis = { type: 'category', data: dims, axisLabel: { rotate: dims.length > 6 ? 30 : 0 } };
            option.yAxis = { type: 'value', name: metric };
            break;
        case 'area':
            option.series = [{ type: 'line', data: values, smooth: true, lineStyle: { color: '#1a5cff', width: 3 }, itemStyle: { color: '#1a5cff' }, areaStyle: { color: 'rgba(26, 92, 255, 0.25)' } }];
            option.xAxis = { type: 'category', data: dims, axisLabel: { rotate: dims.length > 6 ? 30 : 0 } };
            option.yAxis = { type: 'value', name: metric };
            break;
        case 'horizontal':
            option.series = [{ type: 'bar', data: values, barWidth: '40%', itemStyle: { color: '#1a5cff', borderRadius: [0, 4, 4, 0] } }];
            option.xAxis = { type: 'value', name: metric };
            option.yAxis = { type: 'category', data: dims };
            break;
        case 'pie':
            option.series = [{ type: 'pie', radius: ['40%', '70%'], data: dims.map((d, idx) => ({ name: d, value: values[idx] })), label: { formatter: '{b}\n{c}', fontSize: 11 }, color: colors }];
            option.xAxis = undefined;
            option.yAxis = undefined;
            break;
        default:
            option.series = [{ type: 'bar', data: values, barWidth: '40%', itemStyle: { color: '#1a5cff', borderRadius: [4, 4, 0, 0] } }];
            option.xAxis = { type: 'category', data: dims, axisLabel: { rotate: dims.length > 6 ? 30 : 0 } };
            option.yAxis = { type: 'value', name: metric };
    }

    chartInstance.setOption(option);

    // 坐标轴主题色（在 switch 之后统一补充，避免覆盖各类型特有配置）
    if (option.xAxis) {
        option.xAxis.axisLabel = Object.assign({ color: axisColor }, option.xAxis.axisLabel || {});
        option.xAxis.axisLine = { lineStyle: { color: splitColor } };
    }
    if (option.yAxis) {
        option.yAxis.axisLabel = Object.assign({ color: axisColor }, option.yAxis.axisLabel || {});
        option.yAxis.splitLine = { lineStyle: { color: splitColor } };
        option.yAxis.nameTextStyle = { color: axisColor };
    }
    chartInstance.setOption(option);

    chartInstance.resize();
}

// 页面加载时检查登录并获取数据
(function init() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    fetchDashboardData();
})();
