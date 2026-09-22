// 逐页验证前端接线：
//   1) 按 HTML 中 <script> 的真实顺序（内联 + 外链）拼接求值 —— 捕获语法错误、重复声明、
//      顶层代码抛错（如 app.js 的 Object.assign 引用了不存在的函数）
//   2) 抽取该页所有内联事件处理器名，确认已挂到 window
// 覆盖 index / tables / settings / help / dashboard 五个页面。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot');
const PAGES = ['index.html', 'tables.html', 'settings.html', 'help.html', 'dashboard.html'];

function makeEl() {
    return {
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        children: [], value: '', textContent: '', innerHTML: '', checked: false, files: [],
        appendChild(c) { return c; }, removeChild(c) { return c; }, remove() {},
        setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
        querySelectorAll() { return []; }, querySelector() { return null; },
        focus() {}, blur() {}, click() {}, insertAdjacentHTML() {}, scrollIntoView() {},
        insertBefore() {}
    };
}

function makeSandbox() {
    const document = {
        readyState: 'complete',
        addEventListener() {}, removeEventListener() {},
        getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; },
        createElement() { return makeEl(); }, createElementNS() { return makeEl(); },
        createTextNode(t) { return { textContent: t }; },
        body: makeEl(), head: makeEl(), documentElement: makeEl()
    };
    const store = {};
    const sandbox = {
        console, setTimeout, clearTimeout, setInterval, clearInterval, document,
        localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
        location: { pathname: '/', href: 'http://localhost:5185/', origin: 'http://localhost:5185', reload() {} },
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
        confirm: () => true, alert: () => {}, prompt: () => null,
        navigator: { userAgent: 'node' },
        matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        requestAnimationFrame: cb => setTimeout(cb, 0),
        XMLHttpRequest: function () {},
        Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
        Element: function () {}, Node: function () {}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    return sandbox;
}

/** 按出现顺序取出页面里的脚本段：{inline: 源码} 或 {src: 路径} */
function extractScripts(html) {
    const out = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>|<script[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (m[2] !== undefined) out.push({ src: m[2] });
        else out.push({ inline: m[1] });
    }
    return out;
}

let totalFail = 0;

for (const page of PAGES) {
    const file = path.join(ROOT, page);
    if (!fs.existsSync(file)) { console.log('\n=== ' + page + ' ===\n  文件不存在，跳过'); totalFail++; continue; }

    const html = fs.readFileSync(file, 'utf8');
    const scripts = extractScripts(html).filter(s => !s.src || !/^https?:/.test(s.src));

    console.log('\n=== ' + page + ' ===');
    const externals = scripts.filter(s => s.src).map(s => s.src);
    console.log('  外链脚本：' + (externals.join(' -> ') || '（无）'));

    const missingFiles = externals.filter(src => !fs.existsSync(path.join(ROOT, src)));
    if (missingFiles.length) {
        console.log('  缺少脚本文件 -> ' + missingFiles.join(', '));
        totalFail++;
        continue;
    }

    const bundle = scripts.map(s => {
        if (s.src) return '\n/* ==== ' + s.src + ' ==== */\n' + fs.readFileSync(path.join(ROOT, s.src), 'utf8');
        return '\n/* ==== inline ==== */\n' + s.inline;
    }).join('\n;\n');

    const sandbox = makeSandbox();
    const ctx = vm.createContext(sandbox);
    let err = null;
    try {
        vm.runInContext(bundle, ctx, { filename: page });
        console.log('  加载期求值：通过');
    } catch (e) {
        err = e;
        console.log('  加载期求值：失败 -> ' + e.name + ': ' + e.message);
        totalFail++;
    }

    // 内联事件处理器接线。处理器可能写在 HTML 里，也可能写在「注入 HTML 模板」的
    // JS 模块里（弹窗已外置到 modal-templates.js），只扫 HTML 会静默漏检。
    const handlerSources = [html];
    for (const src of externals) {
        const text = fs.readFileSync(path.join(ROOT, src), 'utf8');
        if (text.includes('insertAdjacentHTML')) handlerSources.push(text);
    }

    const handlers = new Set();
    for (const src of handlerSources) {
        for (const m of src.matchAll(/\bon(?:click|change|input|keyup|keydown|blur|focus|submit)="\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
            handlers.add(m[1]);
        }
    }
    const missing = [...handlers].filter(h => typeof sandbox[h] !== 'function').sort();
    console.log('  内联处理器（' + handlers.size + ' 个）：' + (missing.length ? '未挂载 -> ' + missing.join(', ') : '全部已挂载'));
    if (missing.length) totalFail++;
}

console.log('\n================ ' + (totalFail === 0 ? '全部页面通过' : '存在 ' + totalFail + ' 处问题') + ' ================');
process.exitCode = totalFail === 0 ? 0 : 1;
