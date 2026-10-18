// 看板图表布局单测：分组多 / 极值悬殊时「画布多宽、柱多宽、要不要滚动」是纯计算，
// 与设计稿无关、与浏览器无关，所以直接用断言锁住，避免以后微调样式时把这两条规则改坏。
// 对应实现：wwwroot/js/chart.js（计算层）、wwwroot/js/chart-render.js（选项装配）。
const { createHarness } = require('./helpers/dom-harness');

const H = createHarness({
    files: ['chart.js', 'chart-render.js'],
    api: ['CHART_LIMITS', 'chartLayout', 'valueStats', 'logScaleAdvice', 'pieSlices',
        'truncateLabel', 'axisLabelLimit', 'formatCompact', 'barAlpha', 'shouldShowValueLabel',
        'buildChartOption', 'chartTheme']
});
const { api, check, summary } = H;

const L = api.CHART_LIMITS;

// ---------------------------------------------------------------
console.log('[1] 竖向图表：分组少时铺满，分组多时撑宽画布交给外层滚动');
// ---------------------------------------------------------------
// 6 组、可用 900px → 每组 150px，柱宽顶到上限，不需要滚动
let lay = api.chartLayout(6, 'bar', 900);
check('6 组 / 900px 不滚动', lay.scroll === false, lay.scroll);
check('6 组 / 900px 画布等于可视宽', lay.width === 900, lay.width);
check('6 组 / 900px 柱宽封顶 ' + L.maxBar, lay.barWidth === L.maxBar, lay.barWidth);

// 20 组（「20 个销售员」）在 900px 里每组只剩 45px，低于 minSlot → 撑到 20×58
lay = api.chartLayout(20, 'bar', 900);
check('20 组 / 900px 需要横向滚动', lay.scroll === true, lay.scroll);
check('20 组 / 900px 画布 = 20 × minSlot', lay.width === 20 * L.minSlot, lay.width);
check('20 组 / 900px 每组占位不小于 minSlot', lay.slot >= L.minSlot, lay.slot);
check('20 组柱宽落在 [minBar, maxBar]',
    lay.barWidth >= L.minBar && lay.barWidth <= L.maxBar, lay.barWidth);

// 同样的 20 组放到宽屏（20 × minSlot），每组刚好够用就不该再滚动
lay = api.chartLayout(20, 'bar', 20 * L.minSlot);
check('20 组 / 刚好 20×minSlot 不滚动', lay.scroll === false, lay.scroll);
check('20 组 / 刚好 20×minSlot 画布等于可视宽', lay.width === 20 * L.minSlot, lay.width);

// 再窄 40px 就必须滚动了 —— 判据是「放不放得下」而不是「分组数到没到阈值」
lay = api.chartLayout(20, 'bar', 20 * L.minSlot - 40);
check('20 组 / 比临界值窄 40px → 滚动', lay.scroll === true, lay.scroll);

// 判断依据是「可用宽度」而不是「分组数」：同屏宽下 12 组不滚、24 组才滚
check('12 组 / 900px 仍不滚动', api.chartLayout(12, 'bar', 900).scroll === false);
check('24 组 / 900px 才滚动', api.chartLayout(24, 'bar', 900).scroll === true);

// 极端窄屏（手机 320px 视口扣除内边距）也不该把柱压成 1px
lay = api.chartLayout(5, 'bar', 300);
check('窄屏柱宽不低于 minBar', lay.barWidth >= L.minBar, lay.barWidth);

// ---------------------------------------------------------------
console.log('\n[2] 水平条形图：沿纵向生长，不产生横向滚动');
// ---------------------------------------------------------------
lay = api.chartLayout(20, 'horizontal', 900);
check('水平图不横向滚动', lay.scroll === false);
check('水平图宽度铺满', lay.width === 900, lay.width);
check('水平图高度随分组数增长', lay.height === 20 * L.rowSlot + 64, lay.height);
check('水平图柱高落在 [minBar, 26]',
    lay.barWidth >= L.minBar && lay.barWidth <= 26, lay.barWidth);
check('3 组时高度取下限 300', api.chartLayout(3, 'horizontal', 900).height === 300,
    api.chartLayout(3, 'horizontal', 900).height);

// ---------------------------------------------------------------
console.log('\n[3] 饼图：不参与横向布局');
// ---------------------------------------------------------------
lay = api.chartLayout(20, 'pie', 900);
check('饼图宽度铺满', lay.width === 900);
check('饼图不横向滚动', lay.scroll === false);
check('饼图无柱宽概念', lay.barWidth === 0, lay.barWidth);

// ---------------------------------------------------------------
console.log('\n[4] 数值分布：极值悬殊的判据是「最大 / 最小正值」');
// ---------------------------------------------------------------
const SAMPLE = [12500, 3800, 560, 2800, 1200, 6800];   // 设计稿里的 6 位销售员
let stats = api.valueStats(SAMPLE);
check('合计 27,660', stats.sum === 27660, stats.sum);
check('最高 12,500', stats.max === 12500, stats.max);
check('最低 560', stats.min === 560, stats.min);
check('中位数 3,300', stats.median === 3300, stats.median);
check('均值 4,610', Math.round(stats.avg) === 4610, stats.avg);
check('倍差 ≈ 22.3', Math.round(stats.ratio * 10) / 10 === 22.3, stats.ratio);
check('全为正数', stats.allPositive === true);
check('空数组不炸', api.valueStats([]).count === 0);

// ---------------------------------------------------------------
console.log('\n[5] 对数轴：倍差大才提供，含 0 / 负值则只提供但禁用');
// ---------------------------------------------------------------
let adv = api.logScaleAdvice(SAMPLE);
check('倍差 22 倍 → 提供对数轴', adv.offered === true);
check('全为正 → 可以真的切过去', adv.usable === true);

adv = api.logScaleAdvice([0, 1200, 12500, 560]);
check('含 0 时仍提供（说明原因）', adv.offered === true);
check('含 0 时禁用', adv.usable === false);

adv = api.logScaleAdvice([100, 120, 90]);
check('倍差小时不提供', adv.offered === false);

adv = api.logScaleAdvice([-5, 1000]);
check('含负值时禁用', adv.usable === false);

check('倍差刚好等于阈值 → 提供', api.logScaleAdvice([L.logRatio, 1]).offered === true);
check('倍差略低于阈值 → 不提供', api.logScaleAdvice([L.logRatio - 1, 1]).offered === false);

// ---------------------------------------------------------------
console.log('\n[6] 标签策略：放得下才画数值标签');
// ---------------------------------------------------------------
check('槽位 58px → 画标签', api.shouldShowValueLabel(20, { slot: 58 }) === true);
check('槽位 30px → 不画标签（只留 tooltip）', api.shouldShowValueLabel(20, { slot: 30 }) === false);
check('无 layout 时不画', api.shouldShowValueLabel(6, null) === false);

// ---------------------------------------------------------------
console.log('\n[7] 饼图扇区：超过 12 组时合并尾部');
// ---------------------------------------------------------------
const many = [];
for (let i = 1; i <= 20; i++) many.push(i * 100);
let slices = api.pieSlices(many.map((v, i) => '组' + (i + 1)), many);
check('20 组合并成 12 个扇区', slices.length === 12, slices.length);
check('最后一项是「其他」', slices[slices.length - 1].name === '其他 9 组', slices[slices.length - 1].name);
const sliceSum = slices.reduce((s, it) => s + it.value, 0);
const rawSum = many.reduce((s, v) => s + v, 0);
check('合并后总量不变', sliceSum === rawSum, sliceSum + ' vs ' + rawSum);
check('12 组以内不合并', api.pieSlices(['a', 'b'], [1, 2]).length === 2);

// ---------------------------------------------------------------
console.log('\n[8] 数字与标签格式化');
// ---------------------------------------------------------------
check('12,500 用千分位', api.formatCompact(12500) === '12,500', api.formatCompact(12500));
check('125,000 转「万」', api.formatCompact(125000) === '12.5万', api.formatCompact(125000));
check('整数万不带 .0', api.formatCompact(1000000) === '100万', api.formatCompact(1000000));
check('超过 8 字省略为 7 字 + …', api.truncateLabel('华东大区销售一部甲', 8) === '华东大区销售一…',
    api.truncateLabel('华东大区销售一部甲', 8));
check('正好 8 字不省略', api.truncateLabel('华东大区销售一部', 8) === '华东大区销售一部');
check('短标签原样', api.truncateLabel('张伟') === '张伟');
// 轴标签截断长度按槽位反推：窄槽位截短，宽槽位给足
check('槽位 68px → 标签限 5 字', api.axisLabelLimit(68) === 5, api.axisLabelLimit(68));
check('槽位 200px → 封顶 ' + L.axisMaxChars + ' 字', api.axisLabelLimit(200) === L.axisMaxChars,
    api.axisLabelLimit(200));
check('极窄槽位也不少于 ' + L.axisMinChars + ' 字', api.axisLabelLimit(20) === L.axisMinChars,
    api.axisLabelLimit(20));

// ---------------------------------------------------------------
console.log('\n[9] 柱体透明度：值越大越实');
// ---------------------------------------------------------------
check('最大值最实(1)', api.barAlpha(12500, stats) === 1, api.barAlpha(12500, stats));
check('最小值最淡(0.42)', Math.round(api.barAlpha(560, stats) * 100) / 100 === 0.42,
    api.barAlpha(560, stats));
check('中间值介于两者之间', api.barAlpha(3800, stats) > 0.42 && api.barAlpha(3800, stats) < 1);

// ---------------------------------------------------------------
console.log('\n[10] ECharts 选项装配：类型 / 轴 / 参考线');
// ---------------------------------------------------------------
const theme = api.chartTheme();
const base = {
    categories: ['张伟', '李娜', '王磊', '赵敏', '陈诚', '刘洋'],
    values: SAMPLE,
    metric: '单价(元)',
    dimension: '销售员',
    theme: theme
};

let opt = api.buildChartOption(Object.assign({}, base, {
    type: 'bar', layout: api.chartLayout(6, 'bar', 900)
}));
check('柱状图 series.type', opt.series[0].type === 'bar', opt.series[0].type);
check('柱宽取自布局计算结果', opt.series[0].barWidth === L.maxBar, opt.series[0].barWidth);
check('横轴是分类轴', opt.xAxis.type === 'category', opt.xAxis.type);
check('纵轴是数值轴', opt.yAxis.type === 'value', opt.yAxis.type);
check('横轴每个分组都出标签（interval:0）', opt.xAxis.axisLabel.interval === 0);
check('带平均参考线', !!opt.series[0].markLine && opt.series[0].markLine.data[0].yAxis === stats.avg,
    JSON.stringify(opt.series[0].markLine && opt.series[0].markLine.data));

opt = api.buildChartOption(Object.assign({}, base, {
    type: 'bar', logScale: true, layout: api.chartLayout(6, 'bar', 900)
}));
check('对数轴开关生效', opt.yAxis.type === 'log', opt.yAxis.type);

opt = api.buildChartOption(Object.assign({}, base, {
    type: 'horizontal', layout: api.chartLayout(6, 'horizontal', 900)
}));
check('水平图：纵轴变成分类轴', opt.yAxis.type === 'category', opt.yAxis.type);
check('水平图：横轴变成数值轴', opt.xAxis.type === 'value', opt.xAxis.type);
check('水平图：第一组排最上面', opt.yAxis.inverse === true);
check('水平图：参考线挂在 xAxis 上',
    opt.series[0].markLine.data[0].xAxis === stats.avg,
    JSON.stringify(opt.series[0].markLine.data));

opt = api.buildChartOption(Object.assign({}, base, {
    type: 'pie', layout: api.chartLayout(6, 'pie', 900)
}));
check('饼图不残留坐标轴', opt.xAxis === undefined && opt.yAxis === undefined);
check('饼图 6 个扇区', opt.series[0].data.length === 6, opt.series[0].data.length);

opt = api.buildChartOption(Object.assign({}, base, {
    type: 'area', layout: api.chartLayout(6, 'bar', 900)
}));
check('面积图用 line 系列 + areaStyle',
    opt.series[0].type === 'line' && !!opt.series[0].areaStyle, opt.series[0].type);

// tooltip 同时给出绝对值与占比，分组多时占比更好比较
const tip = opt.tooltip.formatter([{ name: '张伟', value: 12500 }]);
check('tooltip 含绝对值', tip.indexOf('12,500') !== -1, tip);
check('tooltip 含占比', tip.indexOf('占合计') !== -1);
check('tooltip 含分组名', tip.indexOf('张伟') !== -1);

// 回归：drawChart 曾漏传 theme，cfg.theme 为 undefined 时整页报「reading 'text3'」
try {
    const noTheme = api.buildChartOption({
        type: 'bar', categories: ['a', 'b'], values: [1, 2], metric: '金额',
        layout: api.chartLayout(2, 'bar', 600)
    });
    check('不传 theme 时自动读设计令牌', !!noTheme.textStyle.color && noTheme.series[0].type === 'bar',
        noTheme.textStyle.color);
} catch (e) {
    check('不传 theme 时自动读设计令牌', false, e.message);
}

// ---------------------------------------------------------------
console.log('\n[11] 悬停指针不许遮挡柱子与数值');
// ---------------------------------------------------------------
// 回归：柱状图曾把 tooltip 的 axisPointer 设成 type:'shadow' + shadowStyle{color:--bg-soft}，
// 那块底板是实色且 z 序在 series 之上，一 hover 就把整根柱子和顶部数值糊成一片灰。
['bar', 'horizontal', 'line', 'area'].forEach(t => {
    const o = api.buildChartOption(Object.assign({}, base, {
        type: t, layout: api.chartLayout(6, t === 'horizontal' ? 'horizontal' : 'bar', 900)
    }));
    check('[' + t + '] 指针是细线而非 shadow 底板', o.tooltip.axisPointer.type === 'line',
        o.tooltip.axisPointer.type);
    check('[' + t + '] 指针不带 shadowStyle 底色', o.tooltip.axisPointer.shadowStyle === undefined,
        JSON.stringify(o.tooltip.axisPointer.shadowStyle));
});

// 底板去掉后，悬停反馈必须由柱子自身承担，否则鼠标移上去毫无反馈
const hoverOpt = api.buildChartOption(Object.assign({}, base, {
    type: 'bar', layout: api.chartLayout(6, 'bar', 900)
}));
check('柱子有 emphasis 悬停反馈', !!hoverOpt.series[0].emphasis,
    JSON.stringify(hoverOpt.series[0].emphasis));
check('悬停时柱子回到实色', hoverOpt.series[0].emphasis.itemStyle.color === theme.brand,
    hoverOpt.series[0].emphasis.itemStyle.color);

// 数值标签仍在柱顶，且不再被任何底板压住（label.position 是 top / right）
check('柱状图数值标签在柱顶', hoverOpt.series[0].label.position === 'top',
    hoverOpt.series[0].label.position);
const hOpt = api.buildChartOption(Object.assign({}, base, {
    type: 'horizontal', layout: api.chartLayout(6, 'horizontal', 900)
}));
check('水平图数值标签在柱右', hOpt.series[0].label.position === 'right', hOpt.series[0].label.position);

summary();
