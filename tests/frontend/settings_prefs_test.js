// 设置页偏好与账号渲染单测：
// 「三档字号映射 / 默认值 / 控件与 localStorage 双向同步 / 恢复默认 / 会话行文案」
// 都是纯逻辑或纯字符串，与浏览器无关，用极简 DOM 桩直接锁住，
// 避免以后调设置页样式时把「开关点了不生效」这类接线问题带回来。
// 对应实现：wwwroot/js/settings.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot');
const code = fs.readFileSync(path.join(ROOT, 'js', 'settings.js'), 'utf8');
const tabsCode = fs.readFileSync(path.join(ROOT, 'js', 'settings-tabs.js'), 'utf8');

// ---------------------------------------------------------------
// 极简 DOM：只实现 settings.js 真正用到的接口
// ---------------------------------------------------------------
function makeButton(attrs) {
    const a = Object.assign({}, attrs || {});
    return {
        _attrs: a,
        getAttribute: k => (k in a ? a[k] : null),
        setAttribute: (k, v) => { a[k] = String(v); },
        addEventListener() {}
    };
}

function makeEl(extra) {
    return Object.assign({
        _attrs: {},
        value: '',
        textContent: '',
        innerHTML: '',
        hidden: true,
        getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
        setAttribute(k, v) { this._attrs[k] = String(v); },
        removeAttribute(k) { delete this._attrs[k]; },
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; }
    }, extra || {});
}

function build() {
    const segButtons = ['standard', 'compact', 'cozy'].map(v => makeButton({ 'data-value': v }));
    const themeUse = makeEl();
    const themeLabel = makeEl();

    const els = {
        prefTheme: makeEl({ value: 'light' }),
        prefPageSize: makeEl({ value: '0' }),
        prefTextSize: makeEl({
            querySelectorAll: sel => (sel === 'button[data-value]' ? segButtons : [])
        }),
        prefGrid: makeButton(),
        resetPrefs: makeEl(),
        themeToggle: makeEl({
            querySelector: sel => (sel === 'use' ? themeUse : (sel === '.theme-label' ? themeLabel : null))
        }),
        sessionList: makeEl(),
        sessionCount: makeEl(),
        accountName: makeEl(),
        accountType: makeEl(),
        passwordState: makeEl(),
        accountNote: makeEl(),
        accountNoteText: makeEl(),
        appVersion: makeEl(),
        appBrowser: makeEl()
    };

    const htmlAttrs = {};
    const document = {
        addEventListener() {},
        getElementById: id => (id in els ? els[id] : null),
        querySelectorAll: () => [],
        documentElement: {
            getAttribute: k => (k in htmlAttrs ? htmlAttrs[k] : null),
            setAttribute: (k, v) => { htmlAttrs[k] = String(v); },
            removeAttribute: k => { delete htmlAttrs[k]; }
        }
    };

    const store = {};
    const sandbox = {
        console,
        document,
        localStorage: {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; }
        },
        navigator: { userAgent: 'test-ua' },
        confirm: () => true,
        matchMedia: () => ({ matches: false }),
        __toasts: [],
        __grid: []
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    // settings.js 依赖的共享模块换成计数器桩（只关心它调了什么，不关心内部实现）
    sandbox.showToast = m => sandbox.__toasts.push(m);
    sandbox.applyGridLines = on => sandbox.__grid.push(on);
    sandbox.escapeHtml = s => String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    sandbox.formatTime = v => String(v).slice(0, 16).replace('T', ' ');
    sandbox.alert = () => {};
    sandbox.Shell = { requireLogin: () => true, highlightNav() {} };

    const ctx = vm.createContext(sandbox);
    vm.runInContext(
        code + '\n;globalThis.__api = { normalizeTextSize, TEXT_SIZE_ATTR, PREF_DEFAULTS, PREF_KEYS,'
        + ' currentPrefs, paintPreferences, resetPreferences, setTheme, applyTextSize,'
        + ' renderSessionList, paintAccountType, describeClient };',
        ctx, { filename: 'settings.js' });
    return { api: sandbox.__api, sandbox, store, els, htmlAttrs, segButtons, themeLabel, ctx };
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

// ---------------------------------------------------------------
console.log('[1] 表格字号：三档值 ↔ 根元素属性');
// ---------------------------------------------------------------
{
    const H = build();
    const A = H.api;

    check('三档原值直通', ['compact', 'standard', 'cozy']
        .every(v => A.normalizeTextSize(v) === v));
    check('旧值 normal 归到「标准」', A.normalizeTextSize('normal') === 'standard',
        A.normalizeTextSize('normal'));
    check('旧值 large 归到「舒适」', A.normalizeTextSize('large') === 'cozy');
    check('脏值回落到默认值', A.normalizeTextSize('xxl') === A.PREF_DEFAULTS.textSize);

    A.applyTextSize('cozy');
    check('舒适 → data-text-size=large', H.htmlAttrs['data-text-size'] === 'large', H.htmlAttrs['data-text-size']);
    A.applyTextSize('compact');
    check('紧凑 → data-text-size=compact', H.htmlAttrs['data-text-size'] === 'compact');
    A.applyTextSize('standard');
    check('标准 → 不设属性（回到基础字号）', !('data-text-size' in H.htmlAttrs), H.htmlAttrs['data-text-size']);
    check('映射表与样式约定一致',
        A.TEXT_SIZE_ATTR.compact === 'compact' && A.TEXT_SIZE_ATTR.standard === ''
        && A.TEXT_SIZE_ATTR.cozy === 'large');
}

// ---------------------------------------------------------------
console.log('[2] 默认值：50 行 / 舒适 / 网格线开');
// ---------------------------------------------------------------
{
    const H = build();
    const p = H.api.currentPrefs();
    check('默认每页 50 行', p.pageSize === '50', p.pageSize);
    check('默认表格字号为舒适', p.textSize === 'cozy', p.textSize);
    check('默认显示网格线', p.grid === true, p.grid);
    check('PREF_DEFAULTS 与实现同源', H.api.PREF_DEFAULTS.pageSize === '50'
        && H.api.PREF_DEFAULTS.grid === 'on');
}

// ---------------------------------------------------------------
console.log('[3] 控件投影：localStorage 是唯一真源');
// ---------------------------------------------------------------
{
    const H = build();
    H.store.prefPageSize = '100';
    H.store.prefTextSize = 'compact';
    H.store.prefGrid = 'off';

    H.api.paintPreferences();

    check('下拉框同步到 100', H.els.prefPageSize.value === '100', H.els.prefPageSize.value);
    const pressed = H.segButtons.map(b => b._attrs['data-value'] + '=' + b._attrs['aria-pressed']).join(',');
    check('只有「紧凑」被按下', pressed === 'standard=false,compact=true,cozy=false', pressed);
    check('开关同步为关', H.els.prefGrid._attrs['aria-checked'] === 'false',
        H.els.prefGrid._attrs['aria-checked']);
    check('字号属性落盘为紧凑', H.htmlAttrs['data-text-size'] === 'compact');
    check('网格线按偏好关闭', H.sandbox.__grid[H.sandbox.__grid.length - 1] === false);

    H.store.prefGrid = 'on';
    H.api.paintPreferences();
    check('网格线重新打开', H.sandbox.__grid[H.sandbox.__grid.length - 1] === true);
}

// ---------------------------------------------------------------
console.log('[4] 主题切换：根属性 + 存储 + 侧栏按钮三处同步');
// ---------------------------------------------------------------
{
    const H = build();
    H.api.setTheme('dark');
    check('切到深色写根属性', H.htmlAttrs['data-theme'] === 'dark');
    check('切到深色写 localStorage', H.store.theme === 'dark');
    check('下拉框跟着变深色', H.els.prefTheme.value === 'dark', H.els.prefTheme.value);
    check('侧栏文案变成「浅色模式」', H.themeLabel.textContent === '浅色模式', H.themeLabel.textContent);

    H.api.setTheme('light');
    check('切回浅色移除根属性', !('data-theme' in H.htmlAttrs));
    check('切回浅色写 localStorage', H.store.theme === 'light');
    check('侧栏文案变回「深色模式」', H.themeLabel.textContent === '深色模式');
}

// ---------------------------------------------------------------
console.log('[5] 恢复默认：清空本地偏好并回到默认值');
// ---------------------------------------------------------------
{
    const H = build();
    H.store.prefPageSize = '500';
    H.store.prefTextSize = 'compact';
    H.store.prefGrid = 'off';
    H.store.prefDensity = 'compact';
    H.store.theme = 'dark';
    H.htmlAttrs['data-theme'] = 'dark';
    H.api.setTheme('dark');

    H.api.resetPreferences();

    check('分页偏好被清空', !('prefPageSize' in H.store));
    check('字号偏好被清空', !('prefTextSize' in H.store));
    check('网格线偏好被清空', !('prefGrid' in H.store));
    check('旧版密度偏好一并清空', !('prefDensity' in H.store));
    check('主题恢复「跟随系统」（不写死 light）', !('theme' in H.store), H.store.theme);
    check('系统是浅色 → 回到浅色', !('data-theme' in H.htmlAttrs));
    check('控件回到 50 行', H.els.prefPageSize.value === '50', H.els.prefPageSize.value);
    check('控件回到「舒适」',
        H.segButtons.filter(b => b._attrs['aria-pressed'] === 'true')
            .map(b => b._attrs['data-value']).join() === 'cozy');
    check('开关回到开', H.els.prefGrid._attrs['aria-checked'] === 'true');
    check('有成功提示', H.sandbox.__toasts.some(t => t.indexOf('恢复默认') !== -1), H.sandbox.__toasts.join('|'));
}

// ---------------------------------------------------------------
console.log('[6] 会话列表：登录时间 + 当前会话标记 + 注销按钮');
// ---------------------------------------------------------------
{
    const H = build();
    H.store.familyId = 'fam-a';
    const host = H.els.sessionList;

    H.api.renderSessionList(host, [
        {
            id: 7, familyId: 'fam-a', createdAt: '2026-10-17 22:52', createdByIp: '10.0.0.2',
            createdByUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                + '(KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0'
        },
        {
            id: 8, familyId: 'fam-b', createdAt: '2026-10-16 22:03', createdByIp: '10.0.0.3',
            createdByUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                + '(KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
        }
    ]);

    check('两行会话', (host.innerHTML.match(/class="session-row"/g) || []).length === 2,
        host.innerHTML);
    check('文案是「登录于 + 时间」', host.innerHTML.indexOf('登录于 2026-10-17 22:52') !== -1);
    check('只有当前会话带标记', (host.innerHTML.match(/session-badge/g) || []).length === 1);
    check('每行都有注销按钮', (host.innerHTML.match(/注销/g) || []).length === 2);
    check('当前会话传给注销函数是 true', host.innerHTML.indexOf('onRevokeSession(7,true)') !== -1);
    check('其他会话传给注销函数是 false', host.innerHTML.indexOf('onRevokeSession(8,false)') !== -1);
    check('IP 只在 title 里备查', host.innerHTML.indexOf('title="来源 10.0.0.2"') !== -1);
    check('标题计数与列表同源', H.els.sessionCount.textContent === '2 个已登录会话',
        H.els.sessionCount.textContent);
    // 第一行是 Edge 的 UA（同时含 Chrome/155），不能被认成 Chrome
    check('客户端标识识别 Edge', host.innerHTML.indexOf('Edge 155 · Windows') !== -1, host.innerHTML);
    check('客户端标识识别 Chrome', host.innerHTML.indexOf('>Chrome 155 · Windows<') !== -1);

    H.api.renderSessionList(host, []);
    check('无会话时给空态文案', host.innerHTML.indexOf('当前没有活跃会话') !== -1);
    check('空列表时计数归零', H.els.sessionCount.textContent === '0 个已登录会话',
        H.els.sessionCount.textContent);
}

// ---------------------------------------------------------------
console.log('[7] 账号类型：Windows 账号没有本地密码');
// ---------------------------------------------------------------
{
    const H = build();
    H.api.paintAccountType({ authType: 'windows', hasPassword: false });
    check('Windows 账号类型文案', H.els.accountType.textContent === 'Windows 集成身份验证',
        H.els.accountType.textContent);
    check('Windows 账号密码状态', H.els.passwordState.textContent === '未设置本地密码');
    check('Windows 提示条文案命中', H.els.accountNoteText.textContent.indexOf('Windows 集成身份验证') !== -1);

    H.api.paintAccountType({ authType: 'local', hasPassword: true });
    check('本地账号类型文案', H.els.accountType.textContent === '本地账号密码');
    check('本地账号密码状态', H.els.passwordState.textContent === '已设置本地密码');
    check('本地账号提示条不再提 Windows', H.els.accountNoteText.textContent.indexOf('Windows') === -1);
}

// ---------------------------------------------------------------
console.log('[8] 客户端标识：UA → 「浏览器 主版本 · 系统」');
// ---------------------------------------------------------------
{
    const d = build().api.describeClient;

    check('Windows + Chrome',
        d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
            + 'Chrome/155.0.0.0 Safari/537.36') === 'Chrome 155 · Windows');
    // Edge 的 UA 里同时含 Chrome/155，必须先认 Edg
    check('Windows + Edge（同时含 Chrome 字样也不误判）',
        d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
            + 'Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0') === 'Edge 155 · Windows');
    check('macOS + Safari（主版本取 Version/ 而不是 605.1）',
        d('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) '
            + 'Version/17.4 Safari/605.1.15') === 'Safari 17 · macOS');
    check('Android + Chrome',
        d('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) '
            + 'Chrome/155.0.0.0 Mobile Safari/537.36') === 'Chrome 155 · Android');
    check('空 UA 回落「未知设备」',
        d('') === '未知设备' && d(undefined) === '未知设备' && d(null) === '未知设备');
    check('认不出浏览器但认得出系统：只给系统',
        d('curl/8.0 (Windows)') === 'Windows');
    check('完全不认识的串也不瞎猜', d('something-odd') === '未知设备');
}

// ---------------------------------------------------------------
console.log('[9] 标签栏：高亮唯一 + 点击跳转到对应板块');
// ---------------------------------------------------------------
function buildTabs() {
    const ids = ['section-account', 'section-password', 'section-sessions', 'section-prefs', 'section-about'];
    const tabs = ids.map(id => {
        const attrs = { 'data-target': id };
        const classes = new Set(['settings-tab']);
        if (id === 'section-account') classes.add('is-active');
        return {
            _attrs: attrs,
            _classes: classes,
            getAttribute: k => (k in attrs ? attrs[k] : null),
            setAttribute: (k, v) => { attrs[k] = String(v); },
            removeAttribute: k => { delete attrs[k]; },
            classList: {
                toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }
            }
        };
    });
    const scrolled = [];

    const nav = {
        querySelectorAll: sel => (sel === '.settings-tab' ? tabs : []),
        addEventListener() {}
    };
    // 每个板块只需要 id 与 scrollIntoView，记录被滚到哪一块
    const sections = {};
    ids.forEach(id => {
        sections[id] = { id, scrollIntoView: () => scrolled.push(id) };
    });

    const sandbox = {
        console,
        document: {
            getElementById: id => (id === 'settingsTabs' ? nav : (sections[id] || null)),
            addEventListener() {}
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const ctx = vm.createContext(sandbox);
    vm.runInContext(
        tabsCode + '\n;globalThis.__api = { initSettingsTabs, setActiveTab, onClickTab };',
        ctx, { filename: 'settings-tabs.js' });
    return { api: sandbox.__api, tabs, scrolled };
}

{
    const T = buildTabs();

    T.api.setActiveTab('section-prefs');
    check('任何时刻只有一个标签高亮',
        T.tabs.filter(t => t._classes.has('is-active')).length === 1);
    check('高亮落在目标标签', T.tabs[3]._classes.has('is-active'));
    check('aria-current 与高亮同步',
        T.tabs[3]._attrs['aria-current'] === 'true'
        && T.tabs[0]._attrs['aria-current'] === undefined);

    // 单测环境没有 IntersectionObserver：只应保留点击跳转，不能抛错
    let threw = false;
    try { T.api.initSettingsTabs(); } catch (e) { threw = true; }
    check('没有 IntersectionObserver 时既不报错也不崩', !threw);

    let prevented = false;
    T.api.onClickTab({
        target: { closest: () => T.tabs[2] },
        preventDefault() { prevented = true; }
    });
    check('点击「会话」滚到该板块', T.scrolled[0] === 'section-sessions', T.scrolled.join());
    check('点击时拦掉默认锚点跳转（避免 URL 里多出 #）', prevented);
    check('点击后高亮跟随', T.tabs[2]._classes.has('is-active') && !T.tabs[3]._classes.has('is-active'));
}

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail === 0 ? 0 : 1);
