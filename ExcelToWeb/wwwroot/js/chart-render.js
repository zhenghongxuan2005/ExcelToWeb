// ================================================================
// 看板图表 · 渲染层：ECharts 选项装配 + 画布挂载
// ----------------------------------------------------------------
// 计算部分（柱宽 / 画布宽度 / 数值分布 / 配色令牌）见 chart.js。
// 本文件只把算好的东西画出来，不读表格数据、不做聚合。
// ================================================================

function chartEsc(text) {
    return typeof escapeHtml === 'function' ? escapeHtml(String(text)) : String(text);
}

/** 平均参考线：设计稿里那条贯穿全图的虚线，标签由页面上方的「— 平均 x」承担 */
function averageMarkLine(stats, theme, horizontal) {
    if (!stats || !stats.count) return undefined;
    return {
        silent: true,
        symbol: 'none',
        animation: false,
        lineStyle: { color: theme.text4, type: 'dashed', width: 1 },
        label: { show: false },
        data: [horizontal ? { xAxis: stats.avg } : { yAxis: stats.avg }]
    };
}

function baseValueAxis(theme, logScale) {
    const axis = {
        type: logScale ? 'log' : 'value',
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: theme.grid } },
        axisLabel: { color: theme.text4, fontSize: 11, margin: 8, formatter: v => formatCompact(v) }
    };
    if (logScale) axis.logBase = 10;
    return axis;
}

function baseCategoryAxis(theme, categories, slot) {
    // interval: 0 强制每个分组都出标签；截断长度按槽位算，保证相邻标签不粘连
    const limit = axisLabelLimit(slot);
    return {
        type: 'category',
        data: categories,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: theme.border } },
        axisLabel: { color: theme.text3, fontSize: 12, interval: 0, margin: 10, formatter: v => truncateLabel(v, limit) }
    };
}

/** tooltip：分组名 + 指标值 + 占比（分组多时占比比绝对值更好比较） */
function buildTooltip(cfg, theme, stats, font) {
    return {
        trigger: cfg.type === 'pie' ? 'item' : 'axis',
        backgroundColor: theme.card,
        borderColor: theme.border,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: theme.text1, fontSize: 12, fontFamily: font },
        extraCssText: 'box-shadow: 0 8px 24px rgba(17, 26, 43, .12); border-radius: 8px;',
        axisPointer: cfg.type === 'bar' || cfg.type === 'horizontal'
            ? { type: 'shadow', shadowStyle: { color: theme.soft } }
            : { type: 'line', lineStyle: { color: theme.border } },
        formatter: function (params) {
            const first = Array.isArray(params) ? params[0] : params;
            if (!first) return '';
            const value = Number(first.value) || 0;
            const share = stats.sum ? (value / stats.sum) * 100 : 0;
            return '<div style="font-weight:600;margin-bottom:2px;">' + chartEsc(first.name) + '</div>'
                + chartEsc(cfg.metric) + '：<b>' + formatCompact(value) + '</b>'
                + '<div style="color:' + theme.text4 + ';font-size:11px;">占合计 ' + share.toFixed(1) + '%</div>';
        }
    };
}

function buildPieSeries(cfg, theme) {
    return [{
        type: 'pie',
        name: cfg.metric,
        radius: ['52%', '74%'],
        center: ['50%', '52%'],
        avoidLabelOverlap: true,
        minShowLabelAngle: 1.5,
        itemStyle: { borderColor: theme.card, borderWidth: 2, borderRadius: 4 },
        label: { color: theme.text2, fontSize: 12, formatter: '{b}\n{d}%' },
        labelLine: { length: 10, length2: 12, lineStyle: { color: theme.border } },
        emphasis: { scale: true, scaleSize: 4 },
        // 「其他」用中性灰：它是汇总项，不该和真实分组抢同一个色板位
        data: pieSlices(cfg.categories, cfg.values).map(it => it.isOther
            ? { name: it.name, value: it.value, itemStyle: { color: theme.text4 } }
            : it),
        color: chartPalette(theme)
    }];
}

function buildBarSeries(cfg, theme, stats, horizontal) {
    const layout = cfg.layout;
    const lineMode = cfg.type === 'line' || cfg.type === 'area';
    return [{
        type: lineMode ? 'line' : 'bar',
        name: cfg.metric,
        data: cfg.values,
        barWidth: layout.barWidth,
        smooth: lineMode ? 0.35 : false,
        showSymbol: lineMode ? cfg.categories.length <= 24 : false,
        symbolSize: 6,
        lineStyle: { color: theme.brand, width: 2.4 },
        itemStyle: {
            borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
            color: lineMode ? theme.brand : p => hexToRgba(theme.brand, barAlpha(p.value, stats))
        },
        areaStyle: cfg.type === 'area' ? { color: hexToRgba(theme.brand, 0.18) } : undefined,
        label: {
            // 水平条形图的标签在柱子右侧、不占横向槽位，所以不受 labelSlot 限制
            show: horizontal ? cfg.categories.length <= 50 : shouldShowValueLabel(cfg.categories.length, layout),
            position: horizontal ? 'right' : 'top',
            distance: 6,
            color: theme.text3,
            fontSize: 11,
            formatter: p => formatCompact(p.value)
        },
        markLine: averageMarkLine(stats, theme, horizontal)
    }];
}

/**
 * 装配 ECharts option。纯函数：只依赖入参（theme 由 chartTheme() 算好传进来），
 * 不读 DOM —— 所以测试里可以直接对 option 结构下断言。
 * cfg: { type, categories, values, metric, dimension, layout, theme, logScale }
 */
function buildChartOption(cfg) {
    // theme 允许外部传入（测试里传固定令牌），不传就现读一次设计令牌
    const theme = cfg.theme || chartTheme();
    const horizontal = cfg.type === 'horizontal';
    const stats = valueStats(cfg.values);
    const font = '-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif';

    const option = {
        textStyle: { fontFamily: font, color: theme.text3 },
        animationDuration: 420,
        animationEasing: 'cubicOut',
        grid: { left: 10, right: 24, top: 30, bottom: 12, containLabel: true },
        tooltip: buildTooltip(cfg, theme, stats, font)
    };

    if (cfg.type === 'pie') {
        option.series = buildPieSeries(cfg, theme);
        return option;
    }

    option.series = buildBarSeries(cfg, theme, stats, horizontal);

    if (horizontal) {
        // 第一组排最上面，读起来是从上往下的自然顺序
        option.xAxis = baseValueAxis(theme, cfg.logScale);
        option.yAxis = {
            type: 'category',
            data: cfg.categories,
            inverse: true,
            axisTick: { show: false },
            axisLine: { lineStyle: { color: theme.border } },
            axisLabel: { color: theme.text3, fontSize: 12, interval: 0, formatter: v => truncateLabel(v, 12) }
        };
    } else {
        option.xAxis = baseCategoryAxis(theme, cfg.categories, cfg.layout.slot);
        option.yAxis = baseValueAxis(theme, cfg.logScale);
    }
    return option;
}

// ================================================================
// 画布挂载：容器尺寸 → ECharts 实例 → 重绘
// ================================================================
let chartInstance = null;
let lastChartConfig = null;

/** 外层滚动容器的可用内容宽度（扣掉左右 padding，否则画布会比可视区宽出一点，永远露出一条缝） */
function chartContentWidth(el) {
    if (!el) return 0;
    let width = 0;
    if (typeof el.getBoundingClientRect === 'function') width = el.getBoundingClientRect().width || 0;
    if (!width) width = el.clientWidth || 0;
    if (typeof getComputedStyle === 'function') {
        try {
            const style = getComputedStyle(el);
            width -= (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        } catch (e) {
            width = width || 0;   // 取不到样式就按无内边距处理
        }
    }
    return Math.round(width);
}

function disposeChart() {
    if (chartInstance) {
        try {
            chartInstance.dispose();
        } catch (e) {
            chartInstance = null;   // 已释放或容器被移除，丢掉引用即可
        }
        chartInstance = null;
    }
    lastChartConfig = null;
}

function ensureChartInstance(box, layout) {
    if (chartInstance && chartInstance.getDom() === box && !chartInstance.isDisposed()) {
        chartInstance.resize({ width: layout.width, height: layout.height });
        return chartInstance;
    }
    disposeChart();
    chartInstance = echarts.init(box);
    return chartInstance;
}

/**
 * 画图（唯一入口）：算尺寸 → 建实例 → 一次 setOption。
 * 旧实现把 setOption 调了两次（先画再补主题色），第二次其实是再合并一遍配置，
 * 切到饼图时会残留上一张图的坐标轴；这里 notMerge 一次画全。
 */
function drawChart(cfg) {
    lastChartConfig = cfg;
    const scroll = document.getElementById('chartScroll');
    const box = document.getElementById('chartContainer');
    if (!box) return null;

    const layout = chartLayout((cfg.categories || []).length, cfg.type, chartContentWidth(scroll) || 720);

    // 画布宽度写死成计算值：分组多时它会超出可视区，由 .chart-scroll 横向滚动
    box.style.width = layout.width + 'px';
    box.style.height = layout.height + 'px';

    if (typeof echarts === 'undefined') return layout;

    const option = buildChartOption(Object.assign({}, cfg, { layout: layout }));
    ensureChartInstance(box, layout).setOption(option, { notMerge: true });
    return layout;
}

/** 窗口尺寸变化时只重算尺寸重画，不重新聚合数据 */
function redrawChart() {
    if (lastChartConfig) drawChart(lastChartConfig);
}
