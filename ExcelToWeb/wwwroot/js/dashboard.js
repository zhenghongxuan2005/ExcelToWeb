// ================================================================
// 看板逻辑（完整版 - 序号不作为指标，也不作为分组维度）
// ================================================================
var tableId = null;
var headers = [];
var rows = [];
var chartInstance = null;

// 排除作为指标的列名
var EXCLUDED_METRICS = ['序号', 'id', 'ID', '编号', '行号', 'No', 'NO', 'no'];

// 排除作为分组的列名
var EXCLUDED_DIMENSIONS = ['序号', 'id', 'ID', '编号', '行号', 'No', 'NO', 'no'];

function fetchDashboardData() {
    showEmptyState('加载中...');
    fetch('/api/excel/tables')
        .then(function (res) {
            if (!res.ok) {
                throw new Error('HTTP ' + res.status);
            }
            return res.json();
        })
        .then(function (tables) {
            if (!tables || tables.length === 0) {
                showEmptyState('暂无数据，请先上传 Excel 文件');
                return;
            }
            var latest = tables[0];
            tableId = latest.id;
            loadData(tableId);
        })
        .catch(function (err) {
            showEmptyState('加载数据失败：' + err.message);
            console.error('fetchDashboardData 错误:', err);
        });
}

function loadData(id) {
    fetch('/api/excel/query?tableId=' + id)
        .then(function (res) {
            if (!res.ok) {
                throw new Error('HTTP ' + res.status);
            }
            return res.json();
        })
        .then(function (data) {
            if (data && data.headers && data.rows && data.rows.length > 0) {
                headers = data.headers;
                rows = data.rows;
                renderDashboard();
            } else {
                showEmptyState('该表格没有数据');
            }
        })
        .catch(function (err) {
            showEmptyState('加载数据失败：' + err.message);
            console.error('loadData 错误:', err);
        });
}

function showEmptyState(msg) {
    var container = document.getElementById('dashboardContent');
    if (!container) return;
    container.innerHTML = '<div class="empty-state" style="text-align:center; padding:60px 0; color:#9aabbf;"><div class="empty-icon" style="font-size:48px; margin-bottom:12px;">📂</div><p>' + msg + '</p></div>';
}

// ================================================================
// 智能识别维度和指标（排除序号类列）
// ================================================================
function identifyDimensions() {
    var dims = [];
    var metrics = [];

    for (var i = 0; i < headers.length; i++) {
        var col = headers[i];
        var values = rows.map(function (r) { return r[col]; });
        var nonEmpty = values.filter(function (v) { return v !== undefined && v !== null && v !== ''; });
        var unique = {};
        for (var j = 0; j < nonEmpty.length; j++) {
            unique[nonEmpty[j]] = true;
        }
        var uniqueCount = Object.keys(unique).length;

        var numericValues = nonEmpty.filter(function (v) {
            return !isNaN(parseFloat(v)) && isFinite(v);
        });
        var isNumeric = numericValues.length === nonEmpty.length && nonEmpty.length > 0;

        // 排除作为指标的列
        var isExcludedMetric = false;
        for (var e = 0; e < EXCLUDED_METRICS.length; e++) {
            if (col === EXCLUDED_METRICS[e]) {
                isExcludedMetric = true;
                break;
            }
        }

        // 排除作为分组的列
        var isExcludedDim = false;
        for (var d = 0; d < EXCLUDED_DIMENSIONS.length; d++) {
            if (col === EXCLUDED_DIMENSIONS[d]) {
                isExcludedDim = true;
                break;
            }
        }

        if (isNumeric && !isExcludedMetric) {
            metrics.push(col);
        } else if (uniqueCount > 1 && uniqueCount <= 20 && nonEmpty.length > 0 && !isExcludedDim) {
            dims.push(col);
        }
    }

    return { dimensions: dims, metrics: metrics };
}

function groupData(dim, metric) {
    var groups = {};
    for (var i = 0; i < rows.length; i++) {
        var dimVal = rows[i][dim] || '未知';
        var metVal = parseFloat(rows[i][metric]) || 0;
        if (!groups[dimVal]) {
            groups[dimVal] = { count: 0, total: 0, items: [] };
        }
        groups[dimVal].count++;
        groups[dimVal].total += metVal;
        groups[dimVal].items.push(rows[i]);
    }
    return groups;
}

// ================================================================
// 渲染看板
// ================================================================
function renderDashboard() {
    var container = document.getElementById('dashboardContent');

    var result = identifyDimensions();
    var dims = result.dimensions;
    var metrics = result.metrics;

    if (dims.length === 0 || metrics.length === 0) {
        container.innerHTML = '<div class="empty-state" style="text-align:center; padding:60px 0; color:#9aabbf;"><div class="empty-icon" style="font-size:48px; margin-bottom:12px;">📊</div><p>数据中未识别到分组维度或数值指标</p><p style="font-size:13px; color:#9aabbf;">请确保 Excel 包含文本列（如销售员）和数值列（如金额）</p></div>';
        return;
    }

    // 优先选择“单价(元)”、“总价”、“金额”等列作为默认指标
    var preferredMetrics = ['单价(元)', '总价', '金额', '数量', 'total', 'price', 'amount', '销售额', '成交额'];
    var defaultDim = dims[0];
    var defaultMetric = metrics[0];
    for (var p = 0; p < preferredMetrics.length; p++) {
        if (metrics.indexOf(preferredMetrics[p]) !== -1) {
            defaultMetric = preferredMetrics[p];
            break;
        }
    }

    var totalRows = rows.length;
    var totalAmount = 0;
    var amountMetric = defaultMetric;
    for (var i = 0; i < rows.length; i++) {
        var val = parseFloat(rows[i][amountMetric]) || 0;
        totalAmount += val;
    }
    var avgAmount = totalRows > 0 ? (totalAmount / totalRows) : 0;

    var completionRate = 0;
    var hasCompletion = headers.indexOf('是否完成') !== -1;
    if (hasCompletion) {
        var completed = 0;
        for (var k = 0; k < rows.length; k++) {
            if (rows[k]['是否完成'] === '是' || rows[k]['是否完成'] === '已完成') {
                completed++;
            }
        }
        completionRate = rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0;
    } else {
        completionRate = Math.round((totalAmount > 0 ? 1 : 0) * 100);
    }

    var html = '';
    html += '<div class="stats-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px,1fr)); gap:16px; margin-bottom:24px;">';
    html += '<div class="stat-card" style="background:#f8faff; padding:16px 20px; border-radius:12px; border:1px solid #eaf0f8;"><div class="label" style="font-size:13px; color:#6b7b93;">📋 总记录数</div><div class="value" style="font-size:28px; font-weight:700; color:#0b1e33; margin-top:4px;">' + totalRows + '</div></div>';
    html += '<div class="stat-card" style="background:#f8faff; padding:16px 20px; border-radius:12px; border:1px solid #eaf0f8;"><div class="label" style="font-size:13px; color:#6b7b93;">💰 总金额</div><div class="value" style="font-size:28px; font-weight:700; color:#0b1e33; margin-top:4px;">' + totalAmount.toFixed(0) + '</div></div>';
    html += '<div class="stat-card" style="background:#f8faff; padding:16px 20px; border-radius:12px; border:1px solid #eaf0f8;"><div class="label" style="font-size:13px; color:#6b7b93;">📈 平均</div><div class="value" style="font-size:28px; font-weight:700; color:#0b1e33; margin-top:4px;">' + avgAmount.toFixed(0) + '</div></div>';
    html += '<div class="stat-card" style="background:#f8faff; padding:16px 20px; border-radius:12px; border:1px solid #eaf0f8;"><div class="label" style="font-size:13px; color:#6b7b93;">✅ 完成率</div><div class="value" style="font-size:28px; font-weight:700; color:#0b1e33; margin-top:4px;">' + completionRate + '%</div></div>';
    html += '</div>';

    var dimOptions = dims.map(function (d) {
        var selected = (d === defaultDim) ? ' selected' : '';
        return '<option value="' + d + '"' + selected + '>' + d + '</option>';
    }).join('');

    var metricOptions = metrics.map(function (m) {
        var selected = (m === defaultMetric) ? ' selected' : '';
        return '<option value="' + m + '"' + selected + '>' + m + '</option>';
    }).join('');

    html += '<div class="controls" style="display:flex; flex-wrap:wrap; gap:12px; margin-bottom:24px; padding:16px 20px; background:#f8faff; border-radius:12px; border:1px solid #eaf0f8; align-items:center;">';
    html += '<label style="font-size:13px; color:#4a5a72; font-weight:500;">分组：<select id="dimSelect" onchange="updateChart()" style="padding:6px 12px; border:1px solid #dce3ed; border-radius:6px; font-size:13px; background:white;">' + dimOptions + '</select></label>';
    html += '<label style="font-size:13px; color:#4a5a72; font-weight:500;">指标：<select id="metricSelect" onchange="updateChart()" style="padding:6px 12px; border:1px solid #dce3ed; border-radius:6px; font-size:13px; background:white;">' + metricOptions + '</select></label>';
    html += '<label style="font-size:13px; color:#4a5a72; font-weight:500;">图表：<select id="chartTypeSelect" onchange="updateChart()" style="padding:6px 12px; border:1px solid #dce3ed; border-radius:6px; font-size:13px; background:white;">';
    html += '<option value="bar">📊 柱状图</option>';
    html += '<option value="line">📈 折线图</option>';
    html += '<option value="area">📈 面积图</option>';
    html += '<option value="horizontal">📊 水平条形图</option>';
    html += '<option value="pie">🍩 饼图</option>';
    html += '</select></label>';
    html += '</div>';

    html += '<div id="chartContainer" style="width:100%; height:400px; background:white; border-radius:12px; border:1px solid #eaf0f8; padding:16px; margin-bottom:24px;"></div>';

    html += '<div class="summary-table-wrap" style="background:white; border-radius:12px; border:1px solid #eaf0f8; overflow:hidden;"><table style="width:100%; border-collapse:collapse; font-size:14px;"><thead><tr>';
    html += '<th style="background:#f8faff; text-align:left; padding:12px 16px; font-weight:600; color:#4a5a72; border-bottom:2px solid #e2e8f0;">' + defaultDim + '</th>';
    html += '<th style="background:#f8faff; text-align:left; padding:12px 16px; font-weight:600; color:#4a5a72; border-bottom:2px solid #e2e8f0;">记录数</th>';
    html += '<th style="background:#f8faff; text-align:left; padding:12px 16px; font-weight:600; color:#4a5a72; border-bottom:2px solid #e2e8f0;">' + defaultMetric + ' 合计</th>';
    html += '<th style="background:#f8faff; text-align:left; padding:12px 16px; font-weight:600; color:#4a5a72; border-bottom:2px solid #e2e8f0;">' + defaultMetric + ' 平均</th>';
    html += '</tr></thead><tbody id="summaryBody"></tbody></table></div>';

    container.innerHTML = html;

    chartInstance = echarts.init(document.getElementById('chartContainer'));
    updateChart();
}

// ================================================================
// 更新图表
// ================================================================
function updateChart() {
    var dimSelect = document.getElementById('dimSelect');
    var metricSelect = document.getElementById('metricSelect');
    var chartTypeSelect = document.getElementById('chartTypeSelect');

    if (!dimSelect || !metricSelect || !chartTypeSelect) return;

    var dim = dimSelect.value;
    var metric = metricSelect.value;
    var chartType = chartTypeSelect.value;

    var groups = groupData(dim, metric);
    var dims = Object.keys(groups);
    var values = dims.map(function (d) { return groups[d].total; });

    // 更新汇总表格
    var tbody = document.getElementById('summaryBody');
    if (tbody) {
        var tableHtml = '';
        for (var i = 0; i < dims.length; i++) {
            var g = groups[dims[i]];
            var avg = g.count > 0 ? (g.total / g.count) : 0;
            tableHtml += '<tr><td style="padding:10px 16px; border-bottom:1px solid #f0f4fa;"><strong>' + dims[i] + '</strong></td><td style="padding:10px 16px; border-bottom:1px solid #f0f4fa;">' + g.count + '</td><td style="padding:10px 16px; border-bottom:1px solid #f0f4fa;">' + g.total.toFixed(0) + '</td><td style="padding:10px 16px; border-bottom:1px solid #f0f4fa;">' + avg.toFixed(0) + '</td></tr>';
        }
        tbody.innerHTML = tableHtml;
    }

    // 更新图表
    if (chartInstance) {
        var option = {
            tooltip: {
                trigger: 'axis',
                formatter: function (params) {
                    var p = params[0];
                    return '<strong>' + p.name + '</strong><br/>' + metric + ': ' + p.value.toFixed(0);
                }
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                top: '10%',
                containLabel: true
            }
        };

        // 图表类型配置
        var colors = ['#1a5cff', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

        switch (chartType) {
            case 'bar':
                // 柱状图
                option.series = [{
                    type: 'bar',
                    data: values,
                    barWidth: '40%',
                    itemStyle: {
                        color: '#1a5cff',
                        borderRadius: [4, 4, 0, 0]
                    }
                }];
                option.xAxis = {
                    type: 'category',
                    data: dims,
                    axisLabel: { rotate: dims.length > 6 ? 30 : 0 }
                };
                option.yAxis = {
                    type: 'value',
                    name: metric
                };
                break;

            case 'line':
                // 折线图
                option.series = [{
                    type: 'line',
                    data: values,
                    smooth: true,
                    lineStyle: {
                        color: '#1a5cff',
                        width: 3
                    },
                    itemStyle: {
                        color: '#1a5cff'
                    },
                    areaStyle: {
                        color: 'rgba(26, 92, 255, 0.05)'
                    }
                }];
                option.xAxis = {
                    type: 'category',
                    data: dims,
                    axisLabel: { rotate: dims.length > 6 ? 30 : 0 }
                };
                option.yAxis = {
                    type: 'value',
                    name: metric
                };
                break;

            case 'area':
                // 面积图
                option.series = [{
                    type: 'line',
                    data: values,
                    smooth: true,
                    lineStyle: {
                        color: '#1a5cff',
                        width: 3
                    },
                    itemStyle: {
                        color: '#1a5cff'
                    },
                    areaStyle: {
                        color: 'rgba(26, 92, 255, 0.25)'
                    }
                }];
                option.xAxis = {
                    type: 'category',
                    data: dims,
                    axisLabel: { rotate: dims.length > 6 ? 30 : 0 }
                };
                option.yAxis = {
                    type: 'value',
                    name: metric
                };
                break;

            case 'horizontal':
                // 水平条形图
                option.series = [{
                    type: 'bar',
                    data: values,
                    barWidth: '40%',
                    itemStyle: {
                        color: '#1a5cff',
                        borderRadius: [0, 4, 4, 0]
                    }
                }];
                option.xAxis = {
                    type: 'value',
                    name: metric
                };
                option.yAxis = {
                    type: 'category',
                    data: dims,
                    axisLabel: { rotate: 0 }
                };
                break;

            case 'pie':
                // 饼图
                option.series = [{
                    type: 'pie',
                    radius: ['40%', '70%'],
                    data: dims.map(function (d, idx) {
                        return { name: d, value: values[idx] };
                    }),
                    label: {
                        formatter: '{b}\n{c}',
                        fontSize: 11
                    },
                    color: colors
                }];
                option.xAxis = undefined;
                option.yAxis = undefined;
                break;

            default:
                // 默认柱状图
                option.series = [{
                    type: 'bar',
                    data: values,
                    barWidth: '40%',
                    itemStyle: {
                        color: '#1a5cff',
                        borderRadius: [4, 4, 0, 0]
                    }
                }];
                option.xAxis = {
                    type: 'category',
                    data: dims,
                    axisLabel: { rotate: dims.length > 6 ? 30 : 0 }
                };
                option.yAxis = {
                    type: 'value',
                    name: metric
                };
        }

        chartInstance.setOption(option);
        chartInstance.resize();
    }
}

fetchDashboardData();