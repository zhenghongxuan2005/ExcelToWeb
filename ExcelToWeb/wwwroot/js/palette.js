// ================================================================
// Ctrl+K 命令面板：快速跳转页面 / 切换表格 / 触发常用操作
// ----------------------------------------------------------------
// 自包含组件：首次打开时才构建 DOM，动作列表在每次打开时重新收集
// （按函数存在性探测，未加载表格编辑模块的页面自动只保留通用动作）。
// 不依赖 utils.js：escape / toast 均有兜底，dashboard 页也能用。
// ================================================================
(function () {
    'use strict';

    let overlay = null;        // 遮罩 + 卡片（懒创建）
    let inputEl = null;
    let listEl = null;
    let isOpen = false;
    let baseActions = [];      // 静态动作（页面 / 工具 / 列跳转）
    let tableActions = [];     // 异步补充的「切换表格」动作
    let flatActions = [];      // 当前过滤后的可见动作
    let activeIndex = 0;

    /** 自带转义：dashboard 页未加载 utils.js，不能依赖 escapeHtml */
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function toast(msg, type) {
        if (typeof showToast === 'function') showToast(msg, type || 'info');
    }

    // ---------------------------------------------------------------
    // DOM 构建（第一次打开时）
    // ---------------------------------------------------------------
    function buildDom() {
        overlay = document.createElement('div');
        overlay.id = 'cmdPalette';
        overlay.className = 'cmdk-overlay';
        overlay.innerHTML =
            '<div class="cmdk-card" role="dialog" aria-modal="true" aria-label="命令面板">'
            + '<div class="cmdk-input-row">'
            + '<svg class="icon icon-sm"><use href="#i-search"/></svg>'
            + '<input type="text" class="cmdk-input" placeholder="输入命令、页面或表格名…" autocomplete="off">'
            + '<span class="cmdk-kbd">Esc</span>'
            + '</div>'
            + '<div class="cmdk-list" role="listbox"></div>'
            + '<div class="cmdk-foot"><span>↑↓ 选择</span><span>Enter 执行</span><span>Ctrl+K 开关</span></div>'
            + '</div>';
        document.body.appendChild(overlay);

        inputEl = overlay.querySelector('.cmdk-input');
        listEl = overlay.querySelector('.cmdk-list');

        overlay.addEventListener('mousedown', e => {
            if (e.target === overlay) close();
        });
        inputEl.addEventListener('input', render);
        inputEl.addEventListener('keydown', onInputKey);
    }

    // ---------------------------------------------------------------
    // 动作收集
    // ---------------------------------------------------------------
    function collectActions() {
        const acts = [];
        const has = name => typeof window[name] === 'function';

        // —— 页面跳转（所有页面可用） ——
        [
            ['/', 'i-table', '前往：表格编辑'],
            ['/tables.html', 'i-columns', '前往：表格管理'],
            ['/dashboard.html', 'i-chart', '前往：数据看板'],
            ['/help.html', 'i-help', '前往：使用帮助'],
            ['/settings.html', 'i-settings', '前往：设置']
        ].forEach(([href, icon, label]) => {
            acts.push({ icon, label, hint: '页面', run: () => { location.href = href; } });
        });

        // —— 外观 ——
        acts.push({
            icon: 'i-moon', label: '切换深色 / 浅色模式', hint: '外观',
            run: () => { const b = document.getElementById('themeToggle'); if (b) b.click(); }
        });

        // —— 表格编辑页专属（探测函数存在性） ——
        if (has('addRow')) acts.push({ icon: 'i-plus', label: '新增行', hint: '编辑', run: () => window.addRow() });
        if (has('saveData')) acts.push({ icon: 'i-save', label: '保存当前表格', hint: '数据', run: () => window.saveData() });
        if (has('refreshData')) acts.push({ icon: 'i-refresh', label: '刷新数据', hint: '数据', run: () => window.refreshData() });
        if (document.getElementById('fileInput')) {
            acts.push({ icon: 'i-upload', label: '上传 Excel…', hint: '数据', run: () => document.getElementById('fileInput').click() });
        }
        if (has('exportExcel')) acts.push({ icon: 'i-download', label: '导出 Excel', hint: '数据', run: () => window.exportExcel() });
        if (has('exportCsv')) acts.push({ icon: 'i-download', label: '导出 CSV', hint: '数据', run: () => window.exportCsv() });
        if (has('openFindModal')) acts.push({ icon: 'i-search', label: '查找和替换', hint: '工具', run: () => window.openFindModal() });
        if (has('openColumnModal')) acts.push({ icon: 'i-columns', label: '列管理（增删改移）', hint: '工具', run: () => window.openColumnModal() });
        if (has('openValidationModal')) acts.push({ icon: 'i-check', label: '数据校验规则', hint: '工具', run: () => window.openValidationModal() });
        if (has('openRuleModal')) acts.push({ icon: 'i-settings', label: '条件格式规则', hint: '工具', run: () => window.openRuleModal() });
        if (has('openHistoryModal')) acts.push({ icon: 'i-clock', label: '变更历史', hint: '工具', run: () => window.openHistoryModal() });
        if (has('undo')) acts.push({ icon: 'i-refresh', label: '撤销', hint: 'Ctrl+Z', run: () => window.undo() });
        if (has('redo')) acts.push({ icon: 'i-refresh', label: '重做', hint: 'Ctrl+Y', run: () => window.redo() });

        // —— 跳到列（当前表格的每一列） ——
        if (typeof currentHeaders !== 'undefined' && Array.isArray(currentHeaders)) {
            currentHeaders.forEach(h => {
                acts.push({ icon: 'i-chevron-right', label: '跳到列：' + h, hint: '当前表格', run: () => focusColumn(h) });
            });
        }

        return acts;
    }

    /** 异步补充「切换表格」动作（每张开着的页面都可通过 fetchTableList 拿到列表） */
    function loadTableActions() {
        if (typeof fetchTableList !== 'function') return;
        fetchTableList()
            .then(tables => {
                tableActions = (tables || []).map(t => ({
                    icon: 'i-table',
                    label: '切换表格：' + t.tableName,
                    hint: '表格',
                    run: () => switchToTable(t.id)
                }));
                if (isOpen) render();
            })
            .catch(() => { /* 列表拉取失败时静默降级：仅不显示表格动作 */ });
    }

    function switchToTable(id) {
        // 表格编辑页：复用 switchTable()（内部会处理列偏好落库等收尾）
        if (typeof switchTable === 'function' && document.getElementById('tableSelector')) {
            const sel = document.getElementById('tableSelector');
            sel.value = String(id);
            switchTable();
            return;
        }
        // 其它页面：记住目标表，跳回编辑页打开（与表格管理页 openTable 同一套约定）
        localStorage.setItem('openTableId', String(id));
        location.href = '/';
    }

    function focusColumn(name) {
        const inp = document.querySelector('.cell-input[data-key="' + (window.CSS ? CSS.escape(name) : name) + '"]');
        if (!inp) {
            toast('当前页未显示该列（可能在其它页码或被隐藏）');
            return;
        }
        inp.scrollIntoView({ block: 'center', behavior: 'smooth' });
        inp.focus();
        inp.select();
    }

    // ---------------------------------------------------------------
    // 渲染与键盘交互
    // ---------------------------------------------------------------
    function render() {
        const q = inputEl.value.trim().toLowerCase();
        flatActions = baseActions.concat(tableActions)
            .filter(a => !q || a.label.toLowerCase().indexOf(q) !== -1);

        if (activeIndex >= flatActions.length) activeIndex = 0;

        if (flatActions.length === 0) {
            listEl.innerHTML = '<div class="cmdk-empty">没有匹配的命令</div>';
            return;
        }

        listEl.innerHTML = flatActions.map((a, i) =>
            '<div class="cmdk-item' + (i === activeIndex ? ' active' : '') + '" role="option" data-i="' + i + '">'
            + '<svg class="icon icon-sm"><use href="#' + a.icon + '"/></svg>'
            + '<span class="cmdk-label">' + esc(a.label) + '</span>'
            + '<span class="cmdk-hint">' + esc(a.hint) + '</span>'
            + '</div>'
        ).join('');

        const active = listEl.children[activeIndex];
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function onInputKey(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (flatActions.length) { activeIndex = (activeIndex + 1) % flatActions.length; render(); }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (flatActions.length) { activeIndex = (activeIndex - 1 + flatActions.length) % flatActions.length; render(); }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            runActive();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();   // 不再冒泡给页面级 Esc（避免误关底层弹窗）
            close();
        }
    }

    function runActive() {
        const action = flatActions[activeIndex];
        if (!action) return;
        close();
        action.run();
    }

    function open() {
        if (!overlay) buildDom();
        baseActions = collectActions();
        activeIndex = 0;
        inputEl.value = '';
        overlay.classList.add('open');
        isOpen = true;
        render();
        loadTableActions();
        setTimeout(() => inputEl.focus(), 0);
    }

    function close() {
        if (!overlay || !isOpen) return;
        overlay.classList.remove('open');
        isOpen = false;
    }

    // 列表点击 / 悬停（事件委托，动作含异步补充，不能用一次性绑定）
    document.addEventListener('click', e => {
        if (!isOpen) return;
        const item = e.target.closest && e.target.closest('.cmdk-item');
        if (item) {
            activeIndex = parseInt(item.dataset.i, 10) || 0;
            runActive();
        }
    });
    document.addEventListener('mousemove', e => {
        if (!isOpen) return;
        const item = e.target.closest && e.target.closest('.cmdk-item');
        if (item && (parseInt(item.dataset.i, 10) || 0) !== activeIndex) {
            activeIndex = parseInt(item.dataset.i, 10) || 0;
            render();
        }
    });

    // Ctrl+K / Cmd+K 开关；打开状态下 Esc 兜底（input 失焦时也能关）
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            if (isOpen) close(); else open();
            return;
        }
        if (isOpen && e.key === 'Escape') close();
    });
})();
