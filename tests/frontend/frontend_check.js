// 逐页验证前端接线：
//   1) 按 HTML 中 <script> 的真实顺序（内联 + 外链）拼接求值 —— 捕获语法错误、重复声明、
//      顶层代码抛错（如 app.js 的 Object.assign 引用了不存在的函数）
//   2) 抽取该页所有内联事件处理器名，确认已挂到 window
//   3) 共享模块引用审计：页面脚本调用了 utils.js / shell.js / api.js 等共享模块的函数，
//      但该页没有引入对应模块 —— 即「dashboard.html 忘引 utils.js 导致 escapeHtml 未定义」
//      这类装配 bug。加载期求值查不出它（函数在运行时才被调用），必须做静态引用交叉比对。
// 覆盖 wwwroot 下全部 *.html（自动纳入新页面，不靠人工登记）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot');
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();

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

function makeSandbox(knownIds) {
    // getElementById 按页面 HTML 里真实存在的 id 返回桩元素，不存在才返回 null ——
    // 既贴近浏览器行为（login.html 加载期就会读 windowsStatus.classList），
    // 又能顺带捕获「JS 引用了页面里不存在的 id」这类装配 bug
    const document = {
        readyState: 'complete',
        addEventListener() {}, removeEventListener() {},
        getElementById(id) { return knownIds && knownIds.has(id) ? makeEl() : null; },
        querySelectorAll() { return []; }, querySelector() { return null; },
        createElement() { return makeEl(); }, createElementNS() { return makeEl(); },
        createTextNode(t) { return { textContent: t }; },
        // 兜底资源的页面会调 document.write 注入 <script>；沙箱里不需要真的写入，
        // 但必须存在，否则整页脚本会在加载期中断（dashboard.html 的 echarts 兜底即如此）
        write() {},
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
        // 浏览器标准对象，Node 里同样是全局可用的；缺了它 login.html 查查询串会中断
        URLSearchParams,
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

    const sandbox = makeSandbox(new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1])));
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

// ================================================================
// 共享模块引用审计（检查 3）
// ================================================================
// 共享模块：顶层声明的函数/对象即其它脚本可调用的全局名
const SHARED_MODULES = ['utils.js', 'shell.js', 'api.js', 'state.js'];
const sharedExports = {};
for (const mod of SHARED_MODULES) {
    const code = fs.readFileSync(path.join(ROOT, 'js', mod), 'utf8');
    const names = new Set();
    for (const m of code.matchAll(/^function\s+([\w$]+)\s*\(/gm)) names.add(m[1]);
    for (const m of code.matchAll(/^(?:const|let)\s+([\w$]+)\s*=/gm)) names.add(m[1]);
    for (const m of code.matchAll(/window\.([\w$]+)\s*=/g)) names.add(m[1]);
    sharedExports[mod] = names;
}

// JS 注释、字符串、正则字面量会造成误报，比对前先剥离。
// 用迷你状态机而不是连环正则：正则无法处理「字符串里的 //」（shell.js 的 xmlns）、
// 「正则字面量里的引号」（palette.js 的 /'/g）这类嵌套，会错位吞掉后续真实代码。
// 模板字符串的 ${...} 是可执行表达式，递归保留（如 `${escapeHtml(name)}`）。
function stripNoise(code) {
    let out = '';
    let prevSig = '';   // 上一个有效字符：区分 / 是除法还是正则开头
    let i = 0;
    const n = code.length;
    while (i < n) {
        const ch = code[i];
        if (ch === '/' && code[i + 1] === '/') {
            while (i < n && code[i] !== '\n') i++;
            continue;
        }
        if (ch === '/' && code[i + 1] === '*') {
            i += 2;
            while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (ch === "'" || ch === '"') {
            const q = ch;
            i++;
            while (i < n && code[i] !== q) { if (code[i] === '\\') i++; i++; }
            i++;
            out += q + q;
            prevSig = q;
            continue;
        }
        if (ch === '`') {
            i++;
            while (i < n && code[i] !== '`') {
                if (code[i] === '\\') { i += 2; continue; }
                if (code[i] === '$' && code[i + 1] === '{') {
                    let depth = 1;
                    i += 2;
                    const start = i;
                    while (i < n && depth > 0) {
                        if (code[i] === '{') depth++;
                        else if (code[i] === '}') depth--;
                        i++;
                    }
                    out += stripNoise(code.slice(start, i - 1));
                    continue;
                }
                i++;
            }
            i++;
            prevSig = '`';
            continue;
        }
        // 正则字面量：前一有效字符不是标识符/)/]/} 时，/ 视为正则开头（除法前一操作数必是那些字符）
        if (ch === '/' && !/[\w$\)\]\}]/.test(prevSig)) {
            i++;
            while (i < n && code[i] !== '/') { if (code[i] === '\\') i++; i++; }
            i++;
            while (i < n && /[a-z]/.test(code[i])) i++;   // flags
            prevSig = '/';
            continue;
        }
        out += ch;
        if (!/\s/.test(ch)) prevSig = ch;
        i++;
    }
    return out;
}

for (const page of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const scripts = extractScripts(html).filter(s => !s.src || !/^https?:/.test(s.src));
    const included = new Set(scripts.filter(s => s.src).map(s => path.basename(s.src)));

    // 只审计「页面专属脚本 + 内联脚本」的引用：共享模块之间允许互相依赖
    // （utils.js 的 isNumericColumn 读 state.js 的 currentRows，只有首页会调它——
    // 非首页引入 utils.js 但不调该函数，不算装配错误）
    const auditBodies = scripts
        .filter(s => !s.src || !SHARED_MODULES.includes(path.basename(s.src)))
        .map(s => s.src ? fs.readFileSync(path.join(ROOT, s.src), 'utf8') : s.inline);
    const ownDefined = new Set();
    for (const b of auditBodies) {
        // 允许前导空白：内联脚本的 function 声明是缩进的（login.html 即如此）
        for (const m of b.matchAll(/^[ \t]*function\s+([\w$]+)\s*\(/gm)) ownDefined.add(m[1]);
        for (const m of b.matchAll(/^[ \t]*(?:const|let|var)\s+([\w$]+)\s*=/gm)) ownDefined.add(m[1]);
    }

    const clean = stripNoise(auditBodies.join('\n'));
    // 已被「本页引入的共享模块」提供的名字不算缺失（如 handleLogout 同时挂在 shell.js 与 state.js）
    const provided = new Set();
    for (const mod of included) {
        if (sharedExports[mod]) for (const n of sharedExports[mod]) provided.add(n);
    }
    for (const [mod, names] of Object.entries(sharedExports)) {
        if (included.has(mod)) continue;
        const hits = [...names].filter(n =>
            !ownDefined.has(n) && !provided.has(n) &&
            // typeof 守卫 = 有意的可选引用（palette.js 用 typeof currentHeaders 探测首页上下文）
            !new RegExp(`typeof\\s+${n}\\b`).test(clean) &&
            (new RegExp(`\\b${n}\\s*\\(`).test(clean) || new RegExp(`\\b${n}\\.`).test(clean)));
        if (hits.length) {
            console.log(`\n=== ${page} ===\n  调用了 js/${mod} 的 ${hits.sort().join(', ')}，但该页未引入此模块`);
            totalFail++;
        }
    }
}

console.log('\n================ ' + (totalFail === 0 ? '全部页面通过' : '存在 ' + totalFail + ' 处问题') + ' ================');
process.exitCode = totalFail === 0 ? 0 : 1;
