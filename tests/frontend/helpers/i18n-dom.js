// i18n 单测共用的装配件：极简 DOM（元素 / 文本节点 / 属性选择器 / TreeWalker / MutationObserver）
// + vm 沙箱。放在 helpers/ 子目录，避免被 tests/run.py 的 frontend/*.js 通配当成测试脚本执行。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_ROOT = path.join(__dirname, '..', '..', '..', 'ExcelToWeb', 'wwwroot', 'js');

function makeClassList() {
    const set = new Set();
    return {
        add: c => set.add(c),
        remove: c => set.delete(c),
        contains: c => set.has(c),
        toggle(c, on) {
            if (on === undefined) { if (set.has(c)) set.delete(c); else set.add(c); }
            else if (on) set.add(c);
            else set.delete(c);
        }
    };
}

/** 只支持 'tag' / '.class' / '[attr]' 三种选择器片段——够 i18n.js 用 */
function matches(node, sel) {
    if (!node || node.nodeType !== 1) return false;
    if (sel.charAt(0) === '[') return node.getAttribute(sel.slice(1, -1)) !== null;
    if (sel.charAt(0) === '.') return node.classList.contains(sel.slice(1));
    return node.tagName === sel.toUpperCase();
}

function makeElement(tag) {
    const kids = [];
    const node = {
        nodeType: 1,
        tagName: String(tag || 'div').toUpperCase(),
        nodeValue: null,
        children: kids,
        parentElement: null,
        classList: makeClassList(),
        _attrs: {},
        _on: {},
        _html: '',
        getAttribute(k) { return k in node._attrs ? node._attrs[k] : null; },
        setAttribute(k, v) {
            node._attrs[k] = String(v);
            // 真实 DOM 里 class 属性与 classList 是同一份数据，这里必须跟着同步
            if (k === 'class') String(v).split(/\s+/).forEach(c => c && node.classList.add(c));
        },
        removeAttribute(k) { delete node._attrs[k]; },
        appendChild(c) { c.parentElement = node; kids.push(c); return c; },
        insertBefore(c, ref) {
            c.parentElement = node;
            const at = kids.indexOf(ref);
            if (at === -1) kids.push(c); else kids.splice(at, 0, c);
            return c;
        },
        addEventListener(type, fn) { (node._on[type] || (node._on[type] = [])).push(fn); },
        dispatch(type, ev) { (node._on[type] || []).forEach(fn => fn(ev)); },
        closest(sel) {
            const parts = String(sel).split(',').map(s => s.trim());
            let n = node;
            while (n && n.nodeType === 1) {
                if (parts.some(p => matches(n, p))) return n;
                n = n.parentElement;
            }
            return null;
        },
        querySelectorAll(sel) {
            const parts = String(sel).split(',').map(s => s.trim());
            const out = [];
            (function visit(n) {
                n.children.forEach(c => {
                    if (c.nodeType !== 1) return;
                    if (parts.some(p => matches(c, p))) out.push(c);
                    visit(c);
                });
            })(node);
            return out;
        }
    };

    // innerHTML 只解析 <button>：语言控件是唯一用 innerHTML 拼 DOM 的地方
    Object.defineProperty(node, 'innerHTML', {
        get: () => node._html,
        set(v) {
            node._html = String(v);
            const re = /<button([^>]*)>([\s\S]*?)<\/button>/g;
            let m;
            while ((m = re.exec(node._html))) {
                const btn = makeElement('button');
                const ar = /([\w-]+)="([^"]*)"/g;
                let a;
                while ((a = ar.exec(m[1]))) btn.setAttribute(a[1], a[2]);
                btn.appendChild(makeText(m[2]));
                node.appendChild(btn);
            }
        }
    });
    return node;
}

function makeText(value) {
    return { nodeType: 3, nodeValue: String(value), parentElement: null };
}

/** 取元素内所有文本（断言用） */
function textOf(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.nodeValue;
    return node.children.map(textOf).join('');
}

/**
 * 组装一个可运行的 i18n 沙箱。
 * @param {object} [initialStorage] 初始 localStorage（例如 { lang: 'en' }）
 * @returns {{I18n, document, store, events, body, html, mount, mutate, block}}
 */
function build(initialStorage) {
    const store = Object.assign({}, initialStorage || {});
    const events = [];
    const body = makeElement('body');
    const html = makeElement('html');
    const mount = makeElement('div');   // 登录页那种 data-lang-mount 容器
    let obsCallback = null;

    const document = {
        readyState: 'complete',
        documentElement: html,
        body,
        _on: {},
        createElement: tag => makeElement(tag),
        getElementById(id) {
            const find = n => {
                if (n._attrs && (n._attrs.id === id || n.id === id)) return n;
                for (let i = 0; i < n.children.length; i++) {
                    const hit = find(n.children[i]);
                    if (hit) return hit;
                }
                return null;
            };
            // 语言控件挂在 [data-lang-mount] 容器里（不在 body 下），两个根都要找
            return find(body) || find(mount);
        },
        querySelector(sel) {
            if (sel === '[data-lang-mount]') return mount;
            return null;
        },
        querySelectorAll(sel) {
            if (sel === '#langSwitch .lang-btn') {
                const wrap = document.getElementById('langSwitch');
                return wrap ? wrap.querySelectorAll('.lang-btn') : [];
            }
            return [];
        },
        addEventListener(type, fn) { (document._on[type] || (document._on[type] = [])).push(fn); },
        dispatchEvent(ev) {
            events.push(ev);
            (document._on[ev.type] || []).forEach(fn => fn(ev));
        },
        createTreeWalker(root, what, filter) {
            const list = [];
            (function visit(n) {
                if (n.nodeType === 3) {
                    if (!filter || filter.acceptNode(n) === 1) list.push(n);
                    return;
                }
                (n.children || []).forEach(visit);
            })(root);
            let i = 0;
            return { nextNode: () => (i < list.length ? list[i++] : null) };
        }
    };

    const sandbox = {
        console,
        document,
        localStorage: {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; }
        },
        NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
        MutationObserver: function (cb) { obsCallback = cb; this.observe = () => {}; },
        CustomEvent: function (type, opts) { this.type = type; this.detail = opts && opts.detail; }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const ctx = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(JS_ROOT, 'i18n.js'), 'utf8'), ctx, { filename: 'i18n.js' });
    vm.runInContext(fs.readFileSync(path.join(JS_ROOT, 'i18n-en.js'), 'utf8'), ctx, { filename: 'i18n-en.js' });

    return {
        I18n: sandbox.I18n,
        document, store, events, body, html, mount,
        /** 触发 MutationObserver（真实浏览器里是异步回调，这里手动调用） */
        mutate: records => obsCallback(records),
        /** 造一段带文本的元素，用于翻译断言 */
        block: (tag, value) => {
            const el = makeElement(tag || 'p');
            el.appendChild(makeText(value));
            return el;
        }
    };
}

module.exports = { build, makeElement, makeText, textOf };
