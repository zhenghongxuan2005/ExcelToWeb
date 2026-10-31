// 看板「总记录数」卡片的副标题不能混进「库里一共几张表」。
//
// 背景（QA 第 18 条）：卡上主数是 6 行，副标题却写「2 张表 · 6 个销售员」。
// 那个 2 是 tablesCache.length（库里所有表的数量），跟当前看板看的这一张表、
// 跟这 6 条记录都没有关系 —— 会让人以为「6 行是从 2 张表汇总来的」。
// 现在的口径：副标题只说「这些记录由几个分组构成」（6 个销售员）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHarness } = require('./helpers/dom-harness');

const JS_ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot', 'js');
const readFile = f => fs.readFileSync(path.join(JS_ROOT, f), 'utf8');

const h = createHarness({
    files: ['utils.js', 'dashboard-view.js'],
    api: ['renderStatCards']
});

// 极简 I18n：tt() 走 I18n.t，字典由 i18n-en-dashboard.js 自己注册
vm.runInContext(`
    var __dict = {};
    var __lang = 'zh';
    globalThis.I18n = {
        t: function (key, vars) {
            var text = (__lang === 'en' && __dict[key]) ? __dict[key] : String(key);
            if (vars) Object.keys(vars).forEach(function (n) {
                text = text.split('{' + n + '}').join(String(vars[n]));
            });
            return text;
        },
        locale: function () { return __lang === 'en' ? 'en-US' : 'zh-CN'; },
        setLang: function (v) { __lang = v; return v; },
        register: function (m) { Object.keys(m).forEach(function (k) { __dict[k] = m[k]; }); }
    };
    globalThis.formatCompact = function (v) { return String(v); };
`, h.ctx);
vm.runInContext(readFile('i18n-en-dashboard.js'), h.ctx);

/** 六条记录、6 个销售员；tableCount 故意传一个显眼的数字，看卡片会不会消费它 */
function model(groupCount) {
    return {
        dim: '销售员',
        metric: '数量',
        stats: { count: 6, sum: 21, avg: 3.5, median: 3, max: 6, min: 1 },
        groupCount: groupCount,
        totalRows: 6,
        tableCount: 999,
        rate: { label: '完成率', rate: 50, foot: '3 / 6 条已完成' }
    };
}

const setLang = lang => vm.runInContext(`I18n.setLang('${lang}')`, h.ctx);

console.log('\n[1] 中文：副标题只说分组，不提表数量');
let html = h.api.renderStatCards(model(6));
h.check('卡片主数仍是 6 行', html.indexOf('>6<span class="value-unit">行') !== -1, html.slice(0, 200));
h.check('副标题是「6 个销售员」', html.indexOf('6 个销售员') !== -1, html);
h.check('不再出现「张表」', html.indexOf('张表') === -1, html);

console.log('\n[2] 视图模型里就算塞了 tableCount，卡片也不消费');
h.check('999 没有出现在输出里', html.indexOf('999') === -1, html);

console.log('\n[3] 分组数变化时跟着变');
html = h.api.renderStatCards(model(12));
h.check('副标题变成「12 个销售员」', html.indexOf('12 个销售员') !== -1, html);

console.log('\n[4] 英文：同一句话换语言');
setLang('en');
html = h.api.renderStatCards(model(6));
h.check('副标题是「6 groups by 销售员」', html.indexOf('6 groups by 销售员') !== -1, html);
h.check('没有残留「张表」或 tables', html.indexOf('张表') === -1 && html.indexOf('tables') === -1, html);
setLang('zh');

console.log('\n[5] 其余三张统计卡不受影响');
const zhHtml = h.api.renderStatCards(model(6));
h.check('合计卡在', zhHtml.indexOf('数量合计') !== -1, zhHtml);
h.check('合计卡副标题仍是「记录数 + 均值」', zhHtml.indexOf('6 条记录 · 均值 3.5') !== -1, zhHtml);
h.check('平均卡副标题仍是「中位数 · 最高」', zhHtml.indexOf('中位数 3 · 最高 6') !== -1, zhHtml);

console.log('\n[6] 静态守门：buildViewModel 不再把表数量塞进视图模型');
const dash = readFile('dashboard.js');
h.check('dashboard.js 里没有 tableCount 字段', dash.indexOf('tableCount') === -1, 'still present');

h.summary();
