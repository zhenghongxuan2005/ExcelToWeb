// ================================================================
// 页面外壳（shell）：图标 sprite、主题切换、退出登录、用户名、导航高亮
// ----------------------------------------------------------------
// 目的：index / tables / dashboard / help / settings 五个页面共用同一套外壳逻辑，
//       避免把「主题切换 + 退出登录 + 侧边栏高亮」在各页面重复实现、日久行为不一致。
// 用法：在每个页面的 <body> 内最先引入本脚本，并在侧边栏链接上标注 data-page。
// 说明：图标 sprite 由本脚本注入，页面无需再内联一份 <symbol> 定义。
// ================================================================

(function () {
    'use strict';

    // ---------------------------------------------------------------
    // 1. 图标 sprite
    // ---------------------------------------------------------------
    var SYMBOLS = [
        '<symbol id="i-table" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></symbol>',
        '<symbol id="i-chart" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></symbol>',
        '<symbol id="i-sigma" viewBox="0 0 24 24"><path d="M18 4H6l6 8-6 8h12"/></symbol>',
        '<symbol id="i-upload" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></symbol>',
        '<symbol id="i-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></symbol>',
        '<symbol id="i-plus" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></symbol>',
        '<symbol id="i-trash" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></symbol>',
        '<symbol id="i-edit" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></symbol>',
        '<symbol id="i-save" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></symbol>',
        '<symbol id="i-refresh" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></symbol>',
        '<symbol id="i-settings" viewBox="0 0 24 24"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></symbol>',
        '<symbol id="i-check" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></symbol>',
        '<symbol id="i-filter" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></symbol>',
        '<symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></symbol>',
        '<symbol id="i-logout" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></symbol>',
        '<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></symbol>',
        '<symbol id="i-moon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></symbol>',
        '<symbol id="i-user" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></symbol>',
        '<symbol id="i-chevron-up" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></symbol>',
        '<symbol id="i-chevron-down" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></symbol>',
        '<symbol id="i-chevron-left" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></symbol>',
        '<symbol id="i-chevron-right" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></symbol>',
        '<symbol id="i-x" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></symbol>',
        '<symbol id="i-x-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></symbol>',
        '<symbol id="i-inbox" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></symbol>',
        '<symbol id="i-file" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></symbol>',
        '<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></symbol>',
        '<symbol id="i-columns" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></symbol>',
        '<symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></symbol>',
        '<symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></symbol>',
        '<symbol id="i-key" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></symbol>',
        '<symbol id="i-home" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></symbol>',
        '<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></symbol>',
        '<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></symbol>'
    ];

    function injectSprite() {
        if (document.getElementById('iconSprite')) return;   // 已存在则不重复注入
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'iconSprite';
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('style', 'display:none;');
        svg.innerHTML = SYMBOLS.join('');
        document.body.insertBefore(svg, document.body.firstChild);
    }

    // ---------------------------------------------------------------
    // 2. 主题切换
    // ---------------------------------------------------------------
    function initTheme() {
        var btn = document.getElementById('themeToggle');
        if (!btn) return;

        var useEl = btn.querySelector('use');
        var labelEl = btn.querySelector('.theme-label');

        function refresh() {
            var dark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (useEl) useEl.setAttribute('href', dark ? '#i-sun' : '#i-moon');
            if (labelEl) labelEl.textContent = dark ? '浅色模式' : '深色模式';
        }

        btn.addEventListener('click', function () {
            var el = document.documentElement;
            var dark = el.getAttribute('data-theme') === 'dark';
            if (dark) {
                el.removeAttribute('data-theme');
                localStorage.setItem('theme', 'light');
            } else {
                el.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark');
            }
            refresh();
        });

        refresh();
    }

    // ---------------------------------------------------------------
    // 3. 登录态相关
    // ---------------------------------------------------------------
    /** 退出登录（HTML 通过 onclick="handleLogout()" 调用，须为全局函数） */
    function handleLogout() {
        if (!confirm('确定要退出登录吗？')) return;
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        window.location.href = '/login.html';
    }
    // 挂到 window，保证内联 onclick 也能找到
    window.handleLogout = handleLogout;

    function initUserBox() {
        var el = document.getElementById('userInfo');
        var name = localStorage.getItem('username');
        if (el && name) el.textContent = name;
    }

    /** 未登录则直接跳登录页——所有受保护页面共用同一道判断 */
    function requireLogin() {
        if (!localStorage.getItem('token')) {
            window.location.href = '/login.html';
            return false;
        }
        return true;
    }

    // ---------------------------------------------------------------
    // 4. 导航高亮
    // ---------------------------------------------------------------
    /** 当前页面标识：/ -> index，/tables.html -> tables */
    function currentPageId() {
        var file = (window.location.pathname.split('/').pop() || '').toLowerCase();
        if (file === '' || file === 'index.html') return 'index';
        return file.replace(/\.html$/, '');
    }

    function highlightNav() {
        var id = currentPageId();
        document.querySelectorAll('.sidebar-nav .nav-link').forEach(function (a) {
            var page = a.getAttribute('data-page');
            a.classList.toggle('active', page === id);
        });
    }

    // ---------------------------------------------------------------
    // 5. 侧边栏折叠（图标模式）
    // ---------------------------------------------------------------
    var COLLAPSE_KEY = 'sidebarCollapsed';

    function applyCollapse(collapsed) {
        var shell = document.querySelector('.app-shell');
        if (!shell) return;
        shell.classList.toggle('sidebar-collapsed', collapsed);

        var btn = document.getElementById('sidebarToggle');
        if (!btn) return;

        var icon = btn.querySelector('use');
        if (icon) icon.setAttribute('href', collapsed ? '#i-chevron-right' : '#i-chevron-left');

        var label = btn.querySelector('.collapse-label');
        if (label) label.textContent = collapsed ? '展开' : '折叠侧边栏';

        // 供屏幕阅读器与悬停提示使用
        var text = collapsed ? '展开侧边栏' : '折叠侧边栏';
        btn.setAttribute('aria-label', text);
        btn.setAttribute('title', text);
        btn.setAttribute('aria-expanded', String(!collapsed));
    }

    function initSidebarCollapse() {
        var btn = document.getElementById('sidebarToggle');
        if (!btn) return;

        // 恢复上次的选择
        applyCollapse(localStorage.getItem(COLLAPSE_KEY) === '1');

        btn.addEventListener('click', function () {
            var shell = document.querySelector('.app-shell');
            var collapsed = !shell.classList.contains('sidebar-collapsed');
            applyCollapse(collapsed);
            localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
        });
    }

    // ---------------------------------------------------------------
    // 初始化
    // ---------------------------------------------------------------
    injectSprite();   // 同步注入，确保后续脚本渲染图标时符号已就绪

    function boot() {
        highlightNav();
        initTheme();
        initUserBox();
        initSidebarCollapse();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // 暴露给各页面复用
    window.Shell = { requireLogin: requireLogin, highlightNav: highlightNav };
})();
