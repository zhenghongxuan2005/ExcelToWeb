// ================================================================
// 国际化（i18n）：语言状态 + 文案字典 + DOM 即时翻译
// ----------------------------------------------------------------
// 设计取舍：
//   1. 以中文为「源语言」，字典只维护「中文 → 英文」一份。中文不需要查表，
//      英文漏翻时自动回落中文，不会出现空白或 key 外泄。
//   2. 不要求每处文案写 data-i18n 标注：按文本节点整段匹配，弹窗、toast、
//      表格里由 JS 拼出来的 HTML 也能被同一套机制覆盖。
//   3. 切换语言时反向查表把中文换回来（中文 ↔ 英文各查一次），
//      所以不需要缓存每个节点的原始文本。
// 用法：
//   I18n.t('中文原文')                       —— JS 里需要拼字符串时用（可带 {name} 占位）
//   I18n.setLang('en' | 'zh')                —— 切换语言
//   字典：I18n.register({ '中文': 'English' }) —— 由 i18n-en.js 调用
// ================================================================

var I18n = (function () {
    'use strict';

    var STORAGE_KEY = 'lang';
    var DEFAULT_LANG = 'zh';

    var dict = {};        // 中文 → 英文
    var reverse = {};     // 英文 → 中文（切换回中文时用）
    var current = DEFAULT_LANG;
    var observer = null;
    var applying = false;

    // 这些容器里的文本是「数据」不是「文案」：表头与表格正文（列名 / 单元格值都可能
    // 恰好等于字典里的词，比如「设置」「版本」，翻了就与数据对不上了）、代码块、输入框
    // [data-i18n-html] 的子树整块由 translateBlocks 接管，不能再逐节点翻
    var SKIP_SELECTOR = 'script,style,textarea,code,pre,thead,tbody,[data-i18n-skip],[data-i18n-html]';
    // 需要跟着翻译的属性（data-label 是折叠侧栏的悬停气泡文案）
    var ATTRS = ['placeholder', 'title', 'aria-label', 'data-label'];

    /** 折叠空白后比较：HTML 里的换行与缩进不该影响命中 */
    function norm(text) {
        return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    }

    /** 注册字典。同一个中文只认第一次注册的结果（后面的页面模块可以增量补） */
    function register(map) {
        Object.keys(map || {}).forEach(function (zh) {
            var en = map[zh];
            if (!en || dict[zh]) return;
            dict[zh] = en;
            // 反向表的 key 也走 norm：英文值允许带首尾空格（"No account yet? " 后面紧跟链接），
            // 否则切回中文时按 norm 查不到，会留下半句英文
            var key = norm(en);
            if (!reverse[key]) reverse[key] = zh;
        });
    }

    /** 取当前语言的文案：英文查不到时原样返回中文（回落而不是报错） */
    function t(key, vars) {
        var text = current === 'en' ? (dict[norm(key)] || key) : key;
        if (vars) {
            Object.keys(vars).forEach(function (name) {
                text = text.split('{' + name + '}').join(String(vars[name]));
            });
        }
        return text;
    }

    function lang() {
        return current;
    }

    /** 数字 / 日期格式化用的区域标识（格式也算文案的一部分） */
    function locale() {
        return current === 'en' ? 'en-US' : 'zh-CN';
    }

    function shouldSkip(node) {
        var el = node.parentElement;
        return !el || !!el.closest(SKIP_SELECTOR);
    }

    /** 单个文本节点：整段命中才替换，首尾空白原样保留 */
    function translateNode(node, map) {
        var raw = node.nodeValue;
        if (!raw) return;

        var hit = map[norm(raw)];
        if (!hit || hit === norm(raw)) return;

        var parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
        node.nodeValue = parts[1] + hit + parts[3];
    }

    function translateAttrs(root, map) {
        if (!root.querySelectorAll) return;

        var nodes = root.querySelectorAll('[placeholder],[title],[aria-label],[data-label]');
        for (var i = 0; i < nodes.length; i++) {
            for (var j = 0; j < ATTRS.length; j++) {
                var value = nodes[i].getAttribute(ATTRS[j]);
                if (!value) continue;
                var hit = map[norm(value)];
                if (hit) nodes[i].setAttribute(ATTRS[j], hit);
            }
        }
    }

    /**
     * 整块 HTML 覆盖：给「一句话里夹着 <strong>/<code>/<a>」的长段落用（帮助页几乎全是这种）。
     * 逐文本节点匹配只能翻片段，英文语序会碎掉；这里让整段作为一条字典项，
     * 英文值是带标记的 HTML 字符串。中文原文留在页面里，第一次替换前缓存到节点上，
     * 切回中文时原样还原 —— 所以页面上不需要写两份中文。
     * 用法：<p data-i18n-html="help.quickstart.1">登录：<strong>…</strong></p>
     */
    function translateBlocks(root, map) {
        if (!root.querySelectorAll) return;

        var nodes = root.querySelectorAll('[data-i18n-html]');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var key = el.getAttribute('data-i18n-html');
            if (!key) continue;

            if (current === 'en') {
                var html = dict[key];
                if (!html) continue;                       // 没翻的段落保持中文（回落）
                if (el.__i18nZh === undefined) el.__i18nZh = el.innerHTML;
                el.innerHTML = html;
            } else if (el.__i18nZh !== undefined) {
                el.innerHTML = el.__i18nZh;
            }
        }
    }

    /** <title> 不在 body 里，得单独翻一次（切回中文靠反向表） */
    function translateTitle(map) {
        if (typeof document.title !== 'string' || !document.title) return;
        var hit = map[norm(document.title)];
        if (hit) document.title = hit;
    }

    function walk(root, map) {
        if (root.nodeType === 3) {
            if (!shouldSkip(root)) translateNode(root, map);
            return;
        }
        if (root.nodeType !== 1 && root.nodeType !== 9) return;

        if (typeof document.createTreeWalker === 'function') {
            var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode: function (n) {
                    return shouldSkip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                }
            });
            var n;
            while ((n = walker.nextNode())) translateNode(n, map);
        }
        translateAttrs(root, map);
    }

    /** 翻译子树（root 可以是文档、元素或单个文本节点） */
    function apply(root) {
        if (!root) return;
        var map = current === 'en' ? dict : reverse;
        if (!Object.keys(map).length) return;

        applying = true;
        try {
            translateTitle(map);
            // 只有元素/文档才可能含整块段落；字符节点的 mutation 直接跳过，
            // 否则表格里每敲一个字都要对 body 做一次 querySelectorAll
            if (root.nodeType === 1 || root.nodeType === 9) translateBlocks(root, map);
            walk(root, map);
        } finally {
            applying = false;
        }
    }

    // ---------------------------------------------------------------
    // 动态内容：JS 生成的弹窗、toast、会话行插入后立刻补翻
    // 只翻新增的那一小块，不做全文档重扫（大表格下每敲一个字都会触发 mutation）
    // ---------------------------------------------------------------
    function startObserver() {
        if (observer || typeof MutationObserver !== 'function' || !document.body) return;

        observer = new MutationObserver(function (records) {
            if (applying || current !== 'en') return;
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (r.type === 'characterData') apply(r.target);
                else if (r.addedNodes) {
                    for (var j = 0; j < r.addedNodes.length; j++) apply(r.addedNodes[j]);
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    // ---------------------------------------------------------------
    // 语言切换控件：侧栏底部（深色模式开关上方）；登录页用 data-lang-mount 指定位置
    // ---------------------------------------------------------------
    function mountSwitcher() {
        if (document.getElementById('langSwitch')) return;

        var host = document.querySelector('[data-lang-mount]') || document.querySelector('.sidebar-bottom');
        if (!host) return;

        var wrap = document.createElement('div');
        wrap.className = 'side-lang';
        wrap.id = 'langSwitch';
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', '语言 / Language');
        wrap.setAttribute('data-i18n-skip', '');   // 中 / EN 是选项本身，不参与翻译
        wrap.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-globe"/></svg>'
            + '<span class="lang-seg">'
            + '<button type="button" class="lang-btn" data-lang="zh" aria-pressed="false">中</button>'
            + '<button type="button" class="lang-btn" data-lang="en" aria-pressed="false">EN</button>'
            + '</span>';

        wrap.addEventListener('click', function (e) {
            var btn = e.target.closest('.lang-btn');
            if (!btn) return;

            var next = btn.getAttribute('data-lang');
            // 折叠态只显示当前语言那一个按钮，点了它没有「另一个」可点 → 直接互换
            if (next === current && document.querySelector('.app-shell.sidebar-collapsed')) {
                next = current === 'en' ? 'zh' : 'en';
            }
            setLang(next);
        });

        var themeBtn = document.getElementById('themeToggle');
        if (themeBtn && themeBtn.parentNode === host) host.insertBefore(wrap, themeBtn);
        else host.insertBefore(wrap, host.firstChild);

        paintSwitcher();
    }

    /** 让控件状态跟上当前语言（class 管样式，aria-pressed 管可访问性） */
    function paintSwitcher() {
        var btns = document.querySelectorAll('#langSwitch .lang-btn');
        for (var i = 0; i < btns.length; i++) {
            var on = btns[i].getAttribute('data-lang') === current;
            btns[i].classList.toggle('is-active', on);
            btns[i].setAttribute('aria-pressed', String(on));
        }
    }

    /** 切换语言：落库 → 更新 <html lang> → 翻译现有 DOM → 刷新控件 */
    function setLang(next) {
        var value = next === 'en' ? 'en' : DEFAULT_LANG;
        var changed = value !== current;
        current = value;

        localStorage.setItem(STORAGE_KEY, value);
        document.documentElement.setAttribute('lang', value === 'en' ? 'en' : 'zh-CN');
        document.documentElement.setAttribute('data-lang', value);

        apply(document.body);
        paintSwitcher();

        if (changed && typeof CustomEvent === 'function') {
            document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: value } }));
        }
        return value;
    }

    function boot() {
        var saved = localStorage.getItem(STORAGE_KEY);
        current = saved === 'en' ? 'en' : DEFAULT_LANG;

        document.documentElement.setAttribute('lang', current === 'en' ? 'en' : 'zh-CN');
        document.documentElement.setAttribute('data-lang', current);

        mountSwitcher();
        paintSwitcher();
        if (current === 'en') apply(document.body);
        startObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    return {
        t: t,
        lang: lang,
        locale: locale,
        setLang: setLang,
        apply: apply,
        register: register
    };
})();
