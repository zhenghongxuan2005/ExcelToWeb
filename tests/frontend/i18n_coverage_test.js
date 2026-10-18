// ================================================================
// 国际化覆盖率守门：把「英文版漏翻」变成可执行断言
// ----------------------------------------------------------------
// 三件事：
//   1) 字典本身：英文值非空、且**全局唯一**（切回中文靠反向查表，撞车会还原成另一条）
//   2) 页面静态文案：每页 HTML 里的文本节点 / 占位符 / title / aria-label，
//      凡含中文的都必须在该页加载的字典里（否则切成英文后仍是中文）
//   3) JS 里的 tt('…') 键：必须能在该页字典里查到（拼错的键不会报错，只会静默回落中文）
// 覆盖的页面是「已国际化」清单；新增页面时把它加进 PAGES 即可。
// ================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot');

// 页面 -> 该页加载的字典文件（顺序无关，最后合并成一个 map）
const PAGES = {
    'index.html': ['i18n-en.js', 'i18n-en-editor.js', 'i18n-en-editor-modals.js'],
    'dashboard.html': ['i18n-en.js', 'i18n-en-dashboard.js'],
    'audit.html': ['i18n-en.js', 'i18n-en-audit.js'],
    'trash.html': ['i18n-en.js', 'i18n-en-trash.js'],
    'help.html': ['i18n-en.js', 'i18n-en-help.js'],
    'settings.html': ['i18n-en.js'],
    'login.html': ['i18n-en.js']
};

// JS 里写死的模板文案不算在页面 HTML 里，但同样会渲染给用户
// （弹窗标题、说明段、按钮都在 modal-templates.js 里，靠 i18n.js 的整段匹配翻译）
const JS_TEMPLATES = {
    'index.html': ['js/modal-templates.js']
};

// 这些容器里的是「数据」不是「文案」（与 i18n.js 的 SKIP_SELECTOR 保持一致）
const SKIP_BLOCKS = ['script', 'style', 'code', 'pre', 'thead', 'tbody'];

let fail = 0;
let pass = 0;
const problems = [];

function check(ok, msg) {
    if (ok) pass++;
    else { fail++; problems.push(msg); }
}

/** 在沙箱里执行字典文件并收集 register() 的入参 */
function loadDict(files) {
    const map = {};
    const sandbox = {
        I18n: {
            register(m) {
                Object.keys(m || {}).forEach(k => {
                    if (!(k in map)) map[k] = m[k];
                });
            },
            t: k => k
        }
    };
    sandbox.window = sandbox;
    const ctx = vm.createContext(sandbox);
    for (const f of files) {
        const p = path.join(ROOT, 'js', f);
        check(fs.existsSync(p), `缺少字典文件 js/${f}`);
        if (!fs.existsSync(p)) continue;
        try {
            vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
        } catch (e) {
            check(false, `js/${f} 求值失败：${e.message}`);
        }
    }
    return map;
}

const norm = t => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------
// [1] 字典质量
// ---------------------------------------------------------------
const allKeys = {};
const allFiles = new Set();
Object.values(PAGES).forEach(list => list.forEach(f => allFiles.add(f)));
allFiles.forEach(f => {
    const map = loadDict([f]);
    const seen = {};        // 英文 -> 中文，检查本文件内是否撞车
    Object.keys(map).forEach(zh => {
        const en = map[zh];
        check(typeof en === 'string' && norm(en).length > 0, `js/${f}：「${zh}」缺少英文`);
        check(!/[\u4e00-\u9fa5]/.test(en), `js/${f}：「${zh}」的英文值里还有中文（${en}）`);
        const key = norm(en);
        if (seen[key] && seen[key] !== zh) {
            check(false, `js/${f}：英文值重复 —— 「${seen[key]}」与「${zh}」都翻成「${en}」`);
        }
        seen[key] = zh;
        if (!(zh in allKeys)) allKeys[zh] = en;
    });
});

// 跨文件重复也要查：同一个英文值出现在两个文件里，切回中文时只认第一个
const enToZh = {};
Object.keys(allKeys).forEach(zh => {
    const key = norm(allKeys[zh]);
    if (enToZh[key] && enToZh[key] !== zh) {
        check(false, `英文值跨文件重复：「${enToZh[key]}」与「${zh}」都是「${allKeys[zh]}」`);
    }
    enToZh[key] = zh;
});

// ---------------------------------------------------------------
// [2] 页面静态文案
// ---------------------------------------------------------------
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#039;': "'", '&nbsp;': ' ' };

function decode(s) {
    return s.replace(/&(lt|gt|amp|quot|nbsp|#039);/g, m => ENTITIES[m] || m);
}

/** 把 HTML 里「会被 i18n 扫到」的文本片段抽出来（近似 text node） */
function textFragments(html) {
    let s = html.replace(/<!--[\s\S]*?-->/g, '');
    for (const tag of SKIP_BLOCKS) {
        s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
    }
    // data-i18n-html 的子树整块由字典接管，不参与逐节点检查
    s = s.replace(/<(\w+)[^>]*\bdata-i18n-html="[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    // 关键：标签之间夹着的连续文字在浏览器里是**一个**文本节点（换行与缩进不会切开它），
    // 这里必须用同一个模型切分，否则「一个 <p> 里写两句中文」这类漏翻会被按行切开而看不出来
    s = s.replace(/<[^>]+>/g, '\u0000');
    return s.split('\u0000').map(decode).map(norm).filter(Boolean);
}

function attrFragments(html) {
    const out = [];
    const re = /\b(?:placeholder|title|aria-label|data-label)="([^"]*)"/g;
    let m;
    while ((m = re.exec(html)) !== null) out.push(decode(norm(m[1])));
    return out.filter(Boolean);
}

function blockKeys(html) {
    const out = [];
    const re = /\bdata-i18n-html="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) out.push(m[1]);
    return out;
}

Object.entries(PAGES).forEach(([page, files]) => {
    const file = path.join(ROOT, page);
    check(fs.existsSync(file), `缺少页面 ${page}`);
    if (!fs.existsSync(file)) return;

    const html = fs.readFileSync(file, 'utf8');
    const dict = loadDict(files);

    // 页面标题
    const title = /<title>([^<]*)<\/title>/.exec(html);
    if (title && /[\u4e00-\u9fa5]/.test(title[1])) {
        check(norm(title[1]) in dict, `${page}：<title>「${title[1]}」没有英文`);
    }

    blockKeys(html).forEach(k => check(k in dict, `${page}：data-i18n-html="${k}" 在字典里找不到`));

    const frags = textFragments(html).concat(attrFragments(html));
    const missing = [];
    frags.forEach(t => {
        if (!/[\u4e00-\u9fa5]/.test(t)) return;
        if (norm(t) in dict) return;
        if (missing.indexOf(t) === -1) missing.push(t);
    });
    check(missing.length === 0,
        `${page}：${missing.length} 处静态文案没有英文 -> ${missing.slice(0, 12).map(t => '「' + t + '」').join(' ')}`);
});

// ---------------------------------------------------------------
// [3] JS 模板里写死的文案（弹窗标题 / 说明 / 按钮）
// ---------------------------------------------------------------
function jsTemplateFragments(code) {
    let s = code
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ');
    // data-i18n-html 的段落整块由字典接管（英文值是带标记的 HTML），不参与逐节点检查
    s = s.replace(/<(\w+)[^>]*\bdata-i18n-html="[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    const attrs = [];
    const reA = /\b(?:placeholder|title|aria-label|data-label)="([^"]*)"/g;
    let a;
    while ((a = reA.exec(s)) !== null) attrs.push(decode(norm(a[1])));
    s = s.replace(/<[^>]+>/g, '\n');
    return s.split('\n').map(decode).map(norm).filter(Boolean).concat(attrs.filter(Boolean));
}

Object.entries(JS_TEMPLATES).forEach(([page, files]) => {
    const dict = loadDict(PAGES[page] || []);
    files.forEach(f => {
        const p = path.join(ROOT, f);
        check(fs.existsSync(p), `缺少模板文件 ${f}`);
        if (!fs.existsSync(p)) return;

        const missing = [];
        jsTemplateFragments(fs.readFileSync(p, 'utf8')).forEach(t => {
            if (!/[\u4e00-\u9fa5]/.test(t)) return;
            if (norm(t) in dict) return;
            if (missing.indexOf(t) === -1) missing.push(t);
        });
        check(missing.length === 0,
            `${f}：${missing.length} 处模板文案没有英文 -> ${missing.slice(0, 12).map(t => '「' + t + '」').join(' ')}`);
    });
});

// ---------------------------------------------------------------
// [4] JS 里 tt('…') 的键
// ---------------------------------------------------------------
Object.entries(PAGES).forEach(([page, files]) => {
    const file = path.join(ROOT, page);
    if (!fs.existsSync(file)) return;
    const html = fs.readFileSync(file, 'utf8');
    const dict = loadDict(files);

    const scripts = [];
    const re = /<script[^>]*\bsrc="((?!https?:)[^"]+)"[^>]*>\s*<\/script>/g;
    let m;
    while ((m = re.exec(html)) !== null) scripts.push(m[1]);

    const bad = [];
    for (const src of scripts) {
        const p = path.join(ROOT, src);
        if (!fs.existsSync(p)) continue;
        const code = fs.readFileSync(p, 'utf8');
        const reKey = /\btt\(\s*'((?:[^'\\]|\\.)*)'/g;
        let k;
        while ((k = reKey.exec(code)) !== null) {
            const key = norm(k[1].replace(/\\n/g, '\n'));
            if (!/[\u4e00-\u9fa5]/.test(key)) continue;   // '、' / '，' 这类标点也要翻，见下
            if (!(key in dict) && bad.indexOf(key) === -1) bad.push(key);
        }
    }
    check(bad.length === 0,
        `${page}：${bad.length} 个 tt() 键在字典里找不到 -> ${bad.slice(0, 10).map(t => '「' + t + '」').join(' ')}`);
});

// ---------------------------------------------------------------
console.log('\n================ 国际化覆盖：' + (fail === 0 ? '全部通过' : fail + ' 处问题') +
    '（' + pass + ' 项通过）================');
if (fail) {
    problems.slice(0, 60).forEach(p => console.log('  ✗ ' + p));
    if (problems.length > 60) console.log('  … 还有 ' + (problems.length - 60) + ' 条');
}
process.exitCode = fail === 0 ? 0 : 1;
