// ================================================================
// 设置页：账号 / 修改密码 / 会话管理 / 偏好设置 / 关于
// 依赖：api.js、utils.js、shell.js（i18n.js 可选，缺省回落中文）
// ================================================================

/**
 * 文案取字典。i18n.js 未接入时按中文原文返回，但仍要做占位替换，
 * 保证「有字典 / 没字典」两种情况下拼出来的句子结构一致。
 */
function tr(key, vars) {
    if (typeof I18n !== 'undefined') return I18n.t(key, vars);
    return String(key).replace(/\{(\w+)\}/g, (m, name) =>
        vars && name in vars ? String(vars[name]) : m);
}

document.addEventListener('DOMContentLoaded', () => {
    if (!Shell.requireLogin()) return;

    initAccountCard();
    initPasswordForm();
    initSessions();
    initPreferences();
    initAbout();

    // 切换语言后，用 JS 拼出来的文案（会话行、「N 个已登录会话」）不会自动重翻，
    // 直接按新语言重渲染一遍，避免中英混排
    document.addEventListener('i18n:change', () => {
        initSessions();
        syncThemeButton();
    });
});

// ================================================================
// 账号：头像 + 账号类型 / 密码状态
// 账号类型由 /auth/me 下发（本地账号密码 / Windows 集成身份验证），
// 不在前端猜：Windows 自动建档的账号 PasswordHash 为空，只有服务端知道
// ================================================================
function initAccountCard() {
    const nameEl = document.getElementById('accountName');
    const name = localStorage.getItem('username') || '（未知账号）';
    if (nameEl) nameEl.textContent = name;

    getCurrentUser()
        .then(user => {
            if (!user) return;
            if (user.username && nameEl) nameEl.textContent = user.username;
            paintAccountType(user);
        })
        .catch(() => {
            // 401 已由 request() 统一跳转；网络异常时保留上面按本地账号渲染的兜底文案
            paintAccountType({ authType: 'local', hasPassword: true });
        });
}

/** 账号类型 / 密码状态 / 底部提示条：三者必须口径一致，所以放在一处渲染 */
function paintAccountType(user) {
    const isWindows = user && user.authType === 'windows';
    const hasPassword = isWindows ? false : !(user && user.hasPassword === false);

    const typeEl = document.getElementById('accountType');
    const pwdEl = document.getElementById('passwordState');
    const noteEl = document.getElementById('accountNote');
    const noteText = document.getElementById('accountNoteText');

    if (typeEl) typeEl.textContent = tr(isWindows ? 'Windows 集成身份验证' : '本地账号密码');
    if (pwdEl) pwdEl.textContent = tr(hasPassword ? '已设置本地密码' : '未设置本地密码');

    if (noteText) {
        noteText.textContent = tr(isWindows
            ? '使用 Windows 集成身份验证自动创建的账号没有本地密码，无法在此修改。'
            : '本地密码由服务器校验：修改后其他设备无需重新登录，下次登录请使用新密码。');
    }
    if (noteEl) noteEl.hidden = false;
}

// ================================================================
// 修改密码
// ================================================================
function initPasswordForm() {
    const form = document.getElementById('passwordForm');
    if (!form) return;

    form.addEventListener('submit', e => {
        e.preventDefault();

        const oldPwd = document.getElementById('oldPassword').value;
        const newPwd = document.getElementById('newPassword').value;
        const confirmPwd = document.getElementById('confirmPassword').value;

        // 前端先做一轮校验，减少无意义的请求；后端仍会再校验一遍
        if (!oldPwd) return showToast(tr('请输入原密码'), 'error');
        if (newPwd.length < 6) return showToast(tr('新密码至少 6 位'), 'error');
        if (newPwd !== confirmPwd) return showToast(tr('两次输入的新密码不一致'), 'error');
        if (newPwd === oldPwd) return showToast(tr('新密码不能与原密码相同'), 'error');

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        changePassword(oldPwd, newPwd, confirmPwd)
            .then(msg => {
                // 服务端提示是中文原文，字典里没有时按原样透出
                showToast('✅ ' + tr(msg || '密码修改成功'), 'success');
                form.reset();
            })
            .catch(err => showToast('❌ ' + err.message, 'error'))
            .finally(() => {
                if (submitBtn) submitBtn.disabled = false;
            });
    });
}

// ================================================================
// 会话管理：一行一个「浏览器登录」，支持逐个注销
// 「当前会话」用 localStorage.familyId 识别（登录 / 静默刷新时随响应下发）
// 来源 IP 不进正文（一眼要看的是登录时间），放到 title 里备查
// ================================================================
function initSessions() {
    const host = document.getElementById('sessionList');
    if (!host) return;

    fetchSessions()
        .then(sessions => renderSessionList(host, sessions || []))
        .catch(err => {
            host.innerHTML = '<p class="panel-hint">'
                + tr('会话列表加载失败：{msg}', { msg: escapeHtml(err.message) }) + '</p>';
        });
}

function renderSessionList(host, sessions) {
    // 计数与列表同源：注销后重渲染，标题上的「N 个已登录会话」自动跟着变
    const countEl = document.getElementById('sessionCount');
    if (countEl) countEl.textContent = tr('{n} 个已登录会话', { n: sessions.length });

    if (sessions.length === 0) {
        host.innerHTML = '<p class="panel-hint">' + tr('当前没有活跃会话。') + '</p>';
        return;
    }

    const currentFamily = localStorage.getItem('familyId');
    host.innerHTML = sessions.map(s => {
        const isCurrent = !!currentFamily && s.familyId === currentFamily;
        const ip = escapeHtml(tr('来源 {ip}', { ip: s.createdByIp || '未知' }));
        return '<div class="session-row">'
            + '<svg class="icon session-enter" aria-hidden="true"><use href="#i-log-in"/></svg>'
            + '<span class="session-time" title="' + ip + '">'
            + escapeHtml(tr('登录于 {time}', { time: formatTime(s.createdAt) })) + '</span>'
            + (isCurrent ? '<span class="session-badge">' + tr('当前会话') + '</span>' : '')
            + '<span class="session-client">' + escapeHtml(describeClient(s.createdByUserAgent)) + '</span>'
            + '<button type="button" class="btn-quiet" onclick="onRevokeSession('
            + Number(s.id) + ',' + isCurrent + ')">'
            + '<svg class="icon" aria-hidden="true"><use href="#i-x"/></svg>' + tr('注销') + '</button>'
            + '</div>';
    }).join('');
}

/**
 * UA → 「Chrome 155 · Windows」。
 * 会话列表只需要区分「哪台设备」，完整 UA 留给「关于」页，这里取主版本号即可。
 * 认不出来就回落「未知设备」——宁可承认不知道，也不要显示错误的浏览器名。
 */
function describeClient(userAgent) {
    const ua = String(userAgent || '');
    if (!ua) return tr('未知设备');

    let browser = '';
    let m = /Edg\/(\d+)/.exec(ua) || /Edge\/(\d+)/.exec(ua);
    if (m) browser = 'Edge ' + m[1];
    else if ((m = /OPR\/(\d+)/.exec(ua))) browser = 'Opera ' + m[1];
    else if ((m = /Firefox\/(\d+)/.exec(ua))) browser = 'Firefox ' + m[1];
    else if ((m = /Chrome\/(\d+)/.exec(ua))) browser = 'Chrome ' + m[1];
    else if ((m = /Version\/(\d+)[\d.]* .*Safari\//.exec(ua))) browser = 'Safari ' + m[1];

    const system =
        /Windows/.test(ua) ? 'Windows'
        : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
        : /Linux/.test(ua) ? 'Linux' : '';

    return [browser, system].filter(Boolean).join(' · ') || tr('未知设备');
}

/** 注销一条会话。isCurrent 为 true 时等同退出登录：清本地登录态并回登录页 */
function onRevokeSession(sessionId, isCurrent) {
    const ask = isCurrent
        ? tr('注销当前会话将退出登录，确定吗？')
        : tr('确定要注销该会话吗？该设备将需要重新登录。');
    if (!confirm(ask)) return;

    revokeSessionApi(sessionId)
        .then(() => {
            if (isCurrent) {
                localStorage.removeItem('token');
                localStorage.removeItem('refreshToken');
                localStorage.removeItem('familyId');
                localStorage.removeItem('username');
                // loggedout 标记：阻止 login.html 的 Windows 静默登录把用户又自动登回去
                window.location.href = '/login.html?loggedout=1';
                return;
            }
            showToast('✅ ' + tr('会话已注销'), 'success');
            initSessions();   // 刷新列表
        })
        .catch(err => showToast('❌ ' + err.message, 'error'));
}

// ================================================================
// 偏好设置（存 localStorage，刷新后仍然生效）
// 四个控件共用一套「读 → 写 → 重绘」，避免各处自己拼状态导致显示与实际不一致
// ================================================================
const PREF_KEYS = {
    theme: 'theme',              // light / dark（空 = 跟随系统）
    pageSize: 'prefPageSize',    // 0 表示全部
    textSize: 'prefTextSize',    // compact / standard / cozy
    density: 'prefDensity',      // 旧版表格密度，仅用于重置时清理
    grid: 'prefGrid'             // on / off
};

const PREF_DEFAULTS = {
    pageSize: '50',
    textSize: 'cozy',
    grid: 'on'
};

/** 表格字号三档 → 根元素属性（'' 表示标准，去掉属性即可） */
const TEXT_SIZE_ATTR = { compact: 'compact', standard: '', cozy: 'large' };

function readPref(key, fallback) {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
}

/** 兼容旧值：normal = 标准、large = 舒适 */
function normalizeTextSize(value) {
    if (value === 'compact' || value === 'standard' || value === 'cozy') return value;
    if (value === 'normal') return 'standard';
    if (value === 'large') return 'cozy';
    return PREF_DEFAULTS.textSize;
}

function initPreferences() {
    paintPreferences();

    const themeSel = document.getElementById('prefTheme');
    if (themeSel) {
        themeSel.value = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        themeSel.addEventListener('change', () => {
            setTheme(themeSel.value);
            showToast('✅ ' + tr('主题已切换'), 'success');
        });
    }

    const sizeSel = document.getElementById('prefPageSize');
    if (sizeSel) {
        sizeSel.addEventListener('change', () => {
            localStorage.setItem(PREF_KEYS.pageSize, sizeSel.value);
            showToast('✅ ' + tr('已保存默认每页行数'), 'success');
        });
    }

    const sizeGroup = document.getElementById('prefTextSize');
    if (sizeGroup) {
        sizeGroup.addEventListener('click', e => {
            const btn = e.target.closest('button[data-value]');
            if (!btn) return;
            const value = btn.getAttribute('data-value');
            if (value === currentPrefs().textSize) return;
            localStorage.setItem(PREF_KEYS.textSize, value);
            paintPreferences();
            showToast('✅ ' + tr('已保存表格字号'), 'success');
        });
    }

    const gridBtn = document.getElementById('prefGrid');
    if (gridBtn) {
        gridBtn.addEventListener('click', () => {
            const next = !currentPrefs().grid;
            localStorage.setItem(PREF_KEYS.grid, next ? 'on' : 'off');
            paintPreferences();
            showToast('✅ ' + tr(next ? '已显示网格线' : '已隐藏网格线'), 'success');
        });
    }

    const resetBtn = document.getElementById('resetPrefs');
    if (resetBtn) resetBtn.addEventListener('click', resetPreferences);
}

/** 当前偏好（localStorage 是唯一真源，DOM 只是它的投影） */
function currentPrefs() {
    return {
        pageSize: readPref(PREF_KEYS.pageSize, PREF_DEFAULTS.pageSize),
        textSize: normalizeTextSize(readPref(PREF_KEYS.textSize, PREF_DEFAULTS.textSize)),
        grid: readPref(PREF_KEYS.grid, PREF_DEFAULTS.grid) !== 'off'
    };
}

/** 把偏好刷到控件与页面上（首次加载与「恢复默认」共用） */
function paintPreferences() {
    const prefs = currentPrefs();

    const sizeSel = document.getElementById('prefPageSize');
    if (sizeSel) sizeSel.value = prefs.pageSize;

    const sizeGroup = document.getElementById('prefTextSize');
    if (sizeGroup) {
        const buttons = sizeGroup.querySelectorAll('button[data-value]');
        for (let i = 0; i < buttons.length; i++) {
            const on = buttons[i].getAttribute('data-value') === prefs.textSize;
            buttons[i].setAttribute('aria-pressed', String(on));
        }
    }

    const gridBtn = document.getElementById('prefGrid');
    if (gridBtn) gridBtn.setAttribute('aria-checked', String(prefs.grid));

    applyTextSize(prefs.textSize);
    applyGridLines(prefs.grid);
}

/** 恢复默认：清掉本地偏好后按默认值重绘（主题回到「跟随系统」） */
function resetPreferences() {
    if (!confirm(tr('恢复默认设置后，主题、分页与表格字号都会回到初始值，确定吗？'))) return;

    localStorage.removeItem(PREF_KEYS.pageSize);
    localStorage.removeItem(PREF_KEYS.textSize);
    localStorage.removeItem(PREF_KEYS.density);
    localStorage.removeItem(PREF_KEYS.grid);
    localStorage.removeItem(PREF_KEYS.theme);

    setTheme(prefersDark() ? 'dark' : 'light', true);
    paintPreferences();
    showToast('✅ ' + tr('已恢复默认设置'), 'success');
}

/** 系统主题偏好（恢复默认时用；浏览器不支持就按浅色） */
function prefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** 主题切换：根属性 + localStorage + 侧栏按钮图标文案，三处必须同步 */
function setTheme(value, silent) {
    const dark = value === 'dark';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    // silent：恢复默认时主题回到「跟随系统」，不写 localStorage，否则就记死了
    if (silent) localStorage.removeItem(PREF_KEYS.theme);
    else localStorage.setItem(PREF_KEYS.theme, dark ? 'dark' : 'light');

    const themeSel = document.getElementById('prefTheme');
    if (themeSel) themeSel.value = dark ? 'dark' : 'light';
    syncThemeButton();
}

/** 字号通过根元素上的 data-text-size 属性生效，样式侧统一控制 */
function applyTextSize(size) {
    const attr = TEXT_SIZE_ATTR[normalizeTextSize(size)];
    if (attr) document.documentElement.setAttribute('data-text-size', attr);
    else document.documentElement.removeAttribute('data-text-size');
}

/** 主题切换后，让侧边栏按钮的图标与文案跟上（shell.js 的 refresh 在闭包里，这里重画一次） */
function syncThemeButton() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const useEl = btn.querySelector('use');
    const labelEl = btn.querySelector('.theme-label');
    if (useEl) useEl.setAttribute('href', dark ? '#i-sun' : '#i-moon');
    if (labelEl) labelEl.textContent = tr(dark ? '浅色模式' : '深色模式');
}

// ================================================================
// 关于
// ================================================================
const APP_BUILD = '2026.09';

function initAbout() {
    const ver = document.getElementById('appVersion');
    if (ver) ver.textContent = APP_BUILD;

    const ua = document.getElementById('appBrowser');
    if (ua) ua.textContent = navigator.userAgent;
}
