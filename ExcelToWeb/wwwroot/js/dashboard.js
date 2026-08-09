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
    showEmptyState('加载中...');
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

function showEmptyState(msg) {
    const container = document.getElementById('dashboardContent');
    if (!container) return;
    container.innerHTML = `<div class="empty-state" style="text-align:center; padding:60px 0; color:#9aabbf;"><div class="empty-icon" style="font-size:48px; margin-bottom:12px;">📂</div><p>${msg}</p></div>`;
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
        container.innerHTML = '<div class="empty-state" style="text-align:center; padding:60px 0; color:#9aabbf;"><div class="empty-icon" style="font-size:48px; margin-bottom:12px;">📊</div><p>数据中未识别到分组维度或数值指标</p><p style="font-size:13px; color:#9aabbf;">请确保 Excel 包含文本列（如销售员）和数值列（如金额）</p></div>';
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
    html += '<div class="stats-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px,1fr)); gap:16px; margin-bottom:24px;">';
    html += `<div class="stat-card" style="background:#f8faff; padding:16px 20px; border-radius:12px; border:1px solid #eaf0f8;"><div class="label" style="font-size:13px; color:#6b7b93;">📋 总记录数</div><div class="value" style="font-size:28px; font-weight:700; color:#0b1e33; margin-top:4px;">${totalRows}</div></div>`;
    html += `<div class="stat-card" style="background:#f8faff; padding:16px 20px; border-radius:12px; border:1px solid #eaf0f8;"><div class="label" style="font-size:13px; color:#6b7b93;">💰 总金额</div><div class="value" style="font-size:28px; font-weight:700; color:#0b1e33; margin-top:4px;">${totalAmount.toFixed(0)}</div></div>`;
    html += `<div class="stat-card" style="background:#f8faff; padding:16px 20px; border-radius:12px; border:1px solid #eaf0f8;"><div class="label" style="font-size:13px; color:#6b7b93;">📈 平均</div><div class="value" style="font-size:28px; font-weight:700; color:#0b1e33; margin-top:4px;">${avgAmount.toFixed(0)}</div></div>`;
    html += `<div class="stat-card" style="background:#f8faff; padding:16px 20px; border-radius:12px; border:1px solid #eaf0f8;"><div class="label" style="font-size:13px; color:#6b7b93;">✅ 完成率</div><div class="value" style="font-size:28px; font-weight:700; color:#0b1e33; margin-top:4px;">${completionRate}%</div></div>`;
    html += '</div>';

    const dimOptions = dims.map(d => `<option value="${d}"${d === defaultDim ? ' selected' : ''}>${d}</option>`).join('');
    const metricOptions = metrics.map(m => `<option value="${m}"${m === defaultMetric ? ' selected' : ''}>${m}</option>`).join('');

    html += '<div class="controls" style="display:flex; flex-wrap:wrap; gap:12px; margin-bottom:24px; padding:16px 20px; background:#f8faff; border-radius:12px; border:1px solid #eaf0f8; align-items:center;">';
    html += `<label style="font-size:13px; color:#4a5a72; font-weight:500;">分组：<select id="dimSelect" onchange="updateChart()" style="padding:6px 12px; border:1px solid #dce3ed; border-radius:6px; font-size:13px; background:white;">${dimOptions}</select></label>`;
    html += `<label style="font-size:13px; color:#4a5a72; font-weight:500;">指标：<select id="metricSelect" onchange="updateChart()" style="padding:6px 12px; border:1px solid #dce3ed; border-radius:6px; font-size:13px; background:white;">${metricOptions}</select></label>`;
    html += '<label style="font-size:13px; color:#4a5a72; font-weight:500;">图表：<select id="chartTypeSelect" onchange="updateChart()" style="padding:6px 12px; border:1px solid #dce3ed; border-radius:6px; font-size:13px; background:white;">';
    html += '<option value="bar">📊 柱状图</option>';
    html += '<option value="line">📈 折线图</option>';
    html += '<option value="area">📈 面积图</option>';
    html += '<option value="horizontal">📊 水平条形图</option>';
    html += '<option value="pie">🍩 饼图</option>';
    html += '</select></label></div>';

    html += '<div id="chartContainer" style="width:100%; height:400px; background:white; border-radius:12px; border:1px solid #eaf0f8; padding:16px; margin-bottom:24px;"></div>';

    html += '<div class="summary-table-wrap" style="background:white; border-radius:12px; border:1px solid #eaf0f8; overflow:hidden;"><table style="width:100%; border-collapse:collapse; font-size:14px;"><thead><tr>';
    html += `<th style="background:#f8faff; text-align:left; padding:12px 16px; font-weight:600; color:#4a5a72; border-bottom:2px solid #e2e8f0;">${defaultDim}</th>`;
    html += '<th style="background:#f8faff; text-align:left; padding:12px 16px; font-weight:600; color:#4a5a72; border-bottom:2px solid #e2e8f0;">记录数</th>';
    html += `<th style="background:#f8faff; text-align:left; padding:12px 16px; font-weight:600; color:#4a5a72; border-bottom:2px solid #e2e8f0;">${defaultMetric} 合计</th>`;
    html += `<th style="background:#f8faff; text-align:left; padding:12px 16px; font-weight:600; color:#4a5a72; border-bottom:2px solid #e2e8f0;">${defaultMetric} 平均</th>`;
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
            tableHtml += `<tr><td style="padding:10px 16px; border-bottom:1px solid #f0f4fa;"><strong>${d}</strong></td><td style="padding:10px 16px; border-bottom:1px solid #f0f4fa;">${g.count}</td><td style="padding:10px 16px; border-bottom:1px solid #f0f4fa;">${g.total.toFixed(0)}</td><td style="padding:10px 16px; border-bottom:1px solid #f0f4fa;">${avg.toFixed(0)}</td></tr>`;
        }
        tbody.innerHTML = tableHtml;
    }

    if (!chartInstance) return;

    const option = {
        tooltip: {
            trigger: 'axis',
            formatter: params => {
                const p = params[0];
                return `<strong>${p.name}</strong><br/>${metric}: ${p.value.toFixed(0)}`;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true }
    };

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
