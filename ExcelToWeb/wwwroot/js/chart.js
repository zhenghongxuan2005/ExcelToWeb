// ================================================================
// 看板图表 · 计算层：尺寸/滚动策略、数值分布、配色令牌
// ----------------------------------------------------------------
// 为什么拆成两层：
//   chart.js（本文件）只做「算」——分组多不多、要不要滚动、柱宽多少、
//   极值差多少倍。全是纯函数，可以脱离浏览器单测（tests/frontend/chart_layout_test.js）。
//   chart-render.js 只做「画」——把算好的尺寸和数值装成 ECharts option。
//   两层分开后，「分组 20 个 / 极值差 300 倍时画布该多宽」这类问题
//   可以在测试里断言，而不是靠截图肉眼比对。
//
// 核心决策：横向滚动的判据是「每个分组的可用宽度 < minSlot」，不是「分组数 > N」。
//   固定阈值在不同屏宽下表现不一致（1440 屏 12 组可能刚好，1024 屏 6 组就挤扁），
//   按可用宽度算才叫自适应；分组数只通过 minSlot 间接影响结果。
// ================================================================

const CHART_LIMITS = {
    baseHeight: 400,     // 竖向图表（柱 / 折线 / 面积 / 饼）的画布高度
    minSlot: 68,         // 竖向图表「每个分组」的最小横向占位：柱宽 + 两侧留白 + 标签
    rowSlot: 32,         // 水平条形图「每个分组」的最小行高
    barRatio: 0.30,      // 柱宽 = 槽位宽 × 该比例（设计稿里的柱比「等分」瘦，留白更透气）
    maxBar: 34,
    minBar: 12,
    labelSlot: 46,       // 槽位窄于此值就不画数值标签（宁可只留 tooltip，也不糊成一片）
    pieMax: 12,          // 饼图最多 12 个扇区，其余合并为「其他」
    logRatio: 20,        // 最大值 / 最小正值 超过该倍数，才提供「对数轴」开关
    axisCharWidth: 13,   // 中文标签的估算字宽（px），用来按槽位算截断长度
    axisMinChars: 4,
    axisMaxChars: 10
};

function chartClamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
}

/** 千分位；过万自动改「万 / 亿」，避免长数字把坐标轴挤变形（12500 → 12,500，125000 → 12.5万） */
function formatCompact(value) {
    const n = Number(value);
    if (!isFinite(n)) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e8) return trimZero((n / 1e8).toFixed(1)) + '亿';
    if (abs >= 1e5) return trimZero((n / 1e4).toFixed(1)) + '万';
    return Math.round(n).toLocaleString('zh-CN');
}

function trimZero(text) {
    return text.replace(/\.0$/, '');
}

/** 分类轴标签截断：完整值仍在 tooltip 里，轴标签只负责「认得出是谁」 */
function truncateLabel(name, maxChars) {
    const text = name === null || name === undefined ? '' : String(name);
    const limit = maxChars || CHART_LIMITS.axisMaxChars;
    return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

/**
 * 按槽位宽度算轴标签的截断长度：槽位越窄截得越短。
 * 只靠 minSlot 保证「标签放得下」是不够的 —— 分组名可长可短，
 * 名长 10 个字时槽位得 130px 才不粘连，所以这里按实际槽位反推。
 */
function axisLabelLimit(slot) {
    const perChar = CHART_LIMITS.axisCharWidth;
    return chartClamp(Math.floor((slot || CHART_LIMITS.minSlot) / perChar),
        CHART_LIMITS.axisMinChars, CHART_LIMITS.axisMaxChars);
}

/**
 * 一组数值的分布特征。ratio = 最大 / 最小正值，是「极值是否悬殊」的唯一判据
 * （用最小正值而不是最小值：有 0 或负数时相除没有意义）。
 */
function valueStats(values) {
    const nums = (values || []).map(Number).filter(v => isFinite(v));
    if (!nums.length) {
        return { count: 0, sum: 0, max: 0, min: 0, avg: 0, median: 0, ratio: 0, allPositive: false };
    }
    const sorted = nums.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const positives = sorted.filter(v => v > 0);
    const minPositive = positives.length ? positives[0] : 0;
    const max = sorted[sorted.length - 1];
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return {
        count: sorted.length,
        sum: sum,
        max: max,
        min: sorted[0],
        avg: sum / sorted.length,
        median: median,
        ratio: minPositive > 0 && max > 0 ? max / minPositive : 0,
        allPositive: positives.length === sorted.length
    };
}

/**
 * 对数轴建议。
 *   offered —— 极值差距够大（ratio ≥ logRatio），值得给用户一个开关；
 *   usable  —— 还能真的切过去（对数轴要求所有值 > 0）。
 * 分开判断：有 0 值时按钮仍在，只是禁用并说明原因，比「按钮凭空消失」更好懂。
 */
function logScaleAdvice(values) {
    const stats = valueStats(values);
    const offered = stats.ratio >= CHART_LIMITS.logRatio;
    return { offered: offered, usable: offered && stats.allPositive, ratio: stats.ratio, stats: stats };
}

/**
 * 画布布局：分组越多单组占位越小；小到 minSlot 就撑宽画布，交给外层横向滚动。
 * width / height 直接写进 #chartContainer 的行内样式，scroll 表示「需要横向滚动」。
 */
function chartLayout(count, type, availableWidth) {
    const n = Math.max(1, Math.round(Number(count) || 1));
    const avail = Math.max(240, Math.round(Number(availableWidth) || 0));

    if (type === 'pie') {
        // 饼图不吃横向空间，分组多靠合并扇区解决（见 pieSlices）
        return { width: avail, height: CHART_LIMITS.baseHeight, slot: avail, barWidth: 0, scroll: false };
    }

    if (type === 'horizontal') {
        // 水平条形图沿纵向生长：分组多就让卡片变高、由页面滚动，不做容器内竖向滚动
        const slot = CHART_LIMITS.rowSlot;
        return {
            width: avail,
            height: Math.max(300, n * slot + 64),
            slot: slot,
            barWidth: chartClamp(Math.round(slot * 0.56), CHART_LIMITS.minBar, 26),
            scroll: false
        };
    }

    const slot = Math.max(CHART_LIMITS.minSlot, avail / n);
    const needed = Math.round(slot * n);
    return {
        width: Math.max(avail, needed),
        height: CHART_LIMITS.baseHeight,
        slot: slot,
        barWidth: Math.round(chartClamp(slot * CHART_LIMITS.barRatio, CHART_LIMITS.minBar, CHART_LIMITS.maxBar)),
        scroll: needed > avail + 1
    };
}

/** 读取 tokens.css 的设计令牌，图表配色跟着主题走，不再硬编码色值 */
function chartTheme() {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    const dark = !!(root && root.getAttribute && root.getAttribute('data-theme') === 'dark');

    function token(name, fallback) {
        if (typeof getComputedStyle !== 'function' || !root) return fallback;
        try {
            const value = getComputedStyle(root).getPropertyValue(name);
            return value && value.trim() ? value.trim() : fallback;
        } catch (e) {
            return fallback;
        }
    }

    return {
        dark: dark,
        brand: token('--primary', dark ? '#8e97ea' : '#5e6ad2'),
        purple: token('--purple', dark ? '#9b7bf0' : '#7c5cf0'),
        success: token('--success', dark ? '#3fbb8c' : '#1a7f5a'),
        warning: token('--warning', dark ? '#dfa758' : '#b26a12'),
        danger: token('--danger', dark ? '#e8828a' : '#c2444b'),
        text1: token('--text-1', dark ? '#e8edf7' : '#1c2433'),
        text2: token('--text-2', dark ? '#b1bccd' : '#4a5568'),
        text3: token('--text-3', dark ? '#7f8da3' : '#78839a'),
        text4: token('--text-4', dark ? '#5c6a80' : '#a0aabb'),
        card: token('--bg-card', dark ? '#131a27' : '#ffffff'),
        soft: token('--bg-soft', dark ? '#1a2231' : '#f5f6fa'),
        border: token('--border', dark ? '#26303f' : '#e9ecf2'),
        grid: token('--border-row', dark ? '#1d2634' : '#f1f3f8')
    };
}

/** #rrggbb → rgba()：柱体按数值调透明度要用；解析失败原样返回，不至于画出透明柱 */
function hexToRgba(color, alpha) {
    const text = String(color || '').trim();
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (!match) return text || 'rgb(94, 106, 210)';
    let hex = match[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

/**
 * 柱体透明度：数值越高越实。分组多、极值悬殊时，读者不必逐个读标签
 * 也能一眼看出谁高谁低——纯色柱做不到这件事。
 */
function barAlpha(value, stats) {
    if (!stats || stats.max <= stats.min) return 1;
    const v = Number(value) || 0;
    const ratio = (v - stats.min) / (stats.max - stats.min);
    return chartClamp(0.42 + ratio * 0.58, 0.42, 1);
}

/** 饼图扇区：超过 pieMax 时保留最大的若干个，其余合并成「其他」，避免丝状扇区与标签打架 */
function pieSlices(categories, values) {
    const items = (categories || []).map((name, i) => ({ name: name, value: Number(values[i]) || 0 }));
    if (items.length <= CHART_LIMITS.pieMax) return items;

    const sorted = items.slice().sort((a, b) => b.value - a.value);
    const head = sorted.slice(0, CHART_LIMITS.pieMax - 1);
    const restSum = sorted.slice(CHART_LIMITS.pieMax - 1).reduce((sum, it) => sum + it.value, 0);
    // isOther：让渲染层把「其他」画成中性灰，跟真实分组区分开
    head.push({ name: '其他 ' + (items.length - head.length) + ' 组', value: restSum, isOther: true });
    return head;
}

/** 分类调色板：口径色（品牌/语义）优先，不够时补一组可视化专用色，避免 12 个扇区里颜色重复 */
function chartPalette(theme) {
    return [
        theme.brand, theme.purple, theme.success, '#0ea5e9', theme.warning, '#db2777',
        '#0d9488', theme.danger, '#7c3aed', '#ca8a04', '#0891b2', '#65a30d'
    ];
}

/** 数值标签只在「放得下」时出现：槽位太窄就只留 tooltip，宁可少画也不糊 */
function shouldShowValueLabel(count, layout) {
    return count <= 20 && !!layout && layout.slot >= CHART_LIMITS.labelSlot;
}
