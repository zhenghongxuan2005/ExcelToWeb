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
        + ' renderSessionList, paintAccountType };',
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
        { id: 7, familyId: 'fam-a', createdAt: '2026-10-17 22:52', createdByIp: '10.0.0.2' },
        { id: 8, familyId: 'fam-b', createdAt: '2026-10-16 22:03', createdByIp: '10.0.0.3' }
    ]);

    check('两行会话', (host.innerHTML.match(/class="session-row"/g) || []).length === 2,
        host.innerHTML);
    check('文案是「登录于 + 时间」', host.innerHTML.indexOf('登录于 2026-10-17 22:52') !== -1);
    check('只有当前会话带标记', (host.innerHTML.match(/session-badge/g) || []).length === 1);
    check('每行都有注销按钮', (host.innerHTML.match(/注销/g) || []).length === 2);
    check('当前会话传给注销函数是 true', host.innerHTML.indexOf('onRevokeSession(7,true)') !== -1);
    check('其他会话传给注销函数是 false', host.innerHTML.indexOf('onRevokeSession(8,false)') !== -1);
    check('IP 只在 title 里备查', host.innerHTML.indexOf('title="来源 10.0.0.2"') !== -1);

    H.api.renderSessionList(host, []);
    check('无会话时给空态文案', host.innerHTML.indexOf('当前没有活跃会话') !== -1);
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

console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail === 0 ? 0 : 1);
