// 编辑器页头不该把「当前是哪张表、有几行」说两遍。
//
// 背景（QA 第 16 条）：右上角并排两个胶囊 ——
//   左：「已加载: 测试数据 - Sheet1 (6行)」
//   右：「6 行 · 8 列」
// 两句在说同一件事，而且左边那句还挤掉了状态栏本来的语义（加载完成 / 已保存 / 已删除）。
// 现在的口径：状态栏只报告「动作完成」，表名归页头副标题，行列数归 meta 胶囊。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHarness } = require('./helpers/dom-harness');

const JS_ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot', 'js');
const readFile = f => fs.readFileSync(path.join(JS_ROOT, f), 'utf8');

const h = createHarness({
    files: ['utils.js'],
    api: ['tt']
});

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
`, h.ctx);
vm.runInContext(readFile('i18n-en-editor.js'), h.ctx);

const setLang = lang => vm.runInContext(`I18n.setLang('${lang}')`, h.ctx);

// 会写状态栏的四个入口：切换表格 / 拖拽导入 / 校验后导入 / 语言切换后重渲染
const CALL_SITES = ['app.js', 'tables.js', 'dnd.js', 'upload-validated.js'];

console.log('\n[1] 状态栏文案：只有「已加载」，不带表名与行数');
h.check('中文 = 已加载', h.api.tt('已加载') === '已加载', h.api.tt('已加载'));
setLang('en');
h.check('英文 = Loaded', h.api.tt('已加载') === 'Loaded', h.api.tt('已加载'));
setLang('zh');

console.log('\n[2] 四个写入入口都用这一句，没有残留旧拼串');
CALL_SITES.forEach(f => {
    const src = readFile(f);
    h.check(f + ' 不含「已加载: {name}」', src.indexOf('已加载: {name}') === -1,
        src.split('\n').filter(l => l.indexOf('已加载') !== -1).join(' | '));
    h.check(f + ' 调用了 tt(\'已加载\')', src.indexOf("tt('已加载')") !== -1);
});

console.log('\n[3] 字典同步：旧条目删除、新条目存在');
const editorDict = readFile('i18n-en-editor.js');
h.check("有 '已加载': 'Loaded'", editorDict.indexOf("'已加载': 'Loaded'") !== -1);
h.check('旧的带占位条目已删', editorDict.indexOf('已加载: {name}') === -1);

console.log('\n[4] 表名与行列数各有归处：页头副标题 + meta 胶囊');
const render = readFile('render.js');
h.check('副标题写表名与最后保存时间', render.indexOf("'{name} · 最后保存 {time}'") !== -1);
h.check('meta 胶囊写行数与列数', render.indexOf("'{rows} 行 · {cols} 列'") !== -1);

h.summary();
