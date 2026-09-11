// ================================================================
// 设置页：修改密码 + 偏好设置 + 关于
// 依赖：api.js、utils.js、shell.js
// ================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (!Shell.requireLogin()) return;

    initUserCard();
    initPasswordForm();
    initPreferences();
    initAbout();
});

/** 账号信息卡片 */
function initUserCard() {
    const nameEl = document.getElementById('accountName');
    const name = localStorage.getItem('username') || '（未知）';
    if (nameEl) nameEl.textContent = name;

    getCurrentUser()
        .then(user => {
            if (user && user.username && nameEl) nameEl.textContent = user.username;
        })
        .catch(() => { /* 401 已由 request() 统一跳转，这里静默即可 */ });
}

/** 修改密码表单 */
function initPasswordForm() {
    const form = document.getElementById('passwordForm');
    if (!form) return;

    form.addEventListener('submit', e => {
        e.preventDefault();

        const oldPwd = document.getElementById('oldPassword').value;
        const newPwd = document.getElementById('newPassword').value;
        const confirmPwd = document.getElementById('confirmPassword').value;

        // 前端先做一轮校验，减少无意义的请求；后端仍会再校验一遍
        if (!oldPwd) return showToast('请输入原密码', 'error');
        if (newPwd.length < 6) return showToast('新密码至少 6 位', 'error');
        if (newPwd !== confirmPwd) return showToast('两次输入的新密码不一致', 'error');
        if (newPwd === oldPwd) return showToast('新密码不能与原密码相同', 'error');

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        changePassword(oldPwd, newPwd, confirmPwd)
            .then(msg => {
                showToast('✅ ' + (msg || '密码修改成功'), 'success');
                form.reset();
            })
            .catch(err => showToast('❌ ' + err.message, 'error'))
            .finally(() => {
                if (submitBtn) submitBtn.disabled = false;
            });
    });
}

// ================================================================
// 偏好设置（存 localStorage，刷新后仍然生效）
// ================================================================
const PREF_KEYS = {
    theme: 'theme',              // light / dark
    pageSize: 'prefPageSize',    // 0 表示全部
    textSize: 'prefTextSize'     // normal / large
};

function readPref(key, fallback) {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
}

function initPreferences() {
    // 主题
    const themeSel = document.getElementById('prefTheme');
    if (themeSel) {
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        themeSel.value = current;
        themeSel.addEventListener('change', () => {
            if (themeSel.value === 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem(PREF_KEYS.theme, 'dark');
            } else {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem(PREF_KEYS.theme, 'light');
            }
            // 侧边栏按钮的图标/文案需要跟着同步
            Shell.highlightNav();
            syncThemeButton();
            showToast('✅ 主题已切换', 'success');
        });
    }

    // 默认每页行数
    const sizeSel = document.getElementById('prefPageSize');
    if (sizeSel) {
        sizeSel.value = readPref(PREF_KEYS.pageSize, '0');
        sizeSel.addEventListener('change', () => {
            localStorage.setItem(PREF_KEYS.pageSize, sizeSel.value);
            showToast('✅ 已保存默认每页行数', 'success');
        });
    }

    // 表格字号
    const textSel = document.getElementById('prefTextSize');
    if (textSel) {
        textSel.value = readPref(PREF_KEYS.textSize, 'normal');
        applyTextSize(textSel.value);
        textSel.addEventListener('change', () => {
            localStorage.setItem(PREF_KEYS.textSize, textSel.value);
            applyTextSize(textSel.value);
            showToast('✅ 已保存字号设置', 'success');
        });
    }

    // 表格密度
    const densitySel = document.getElementById('prefDensity');
    if (densitySel) {
        const savedDensity = readPref(PREF_KEYS.density, 'comfortable');
        densitySel.value = ['compact', 'comfortable', 'spacious'].indexOf(savedDensity) !== -1
            ? savedDensity
            : 'comfortable';
        densitySel.addEventListener('change', () => {
            localStorage.setItem(PREF_KEYS.density, densitySel.value);
            applyDensity(densitySel.value);
            showToast('✅ 已保存表格密度', 'success');
        });
    }

    // 网格线
    const gridSel = document.getElementById('prefGrid');
    if (gridSel) {
        gridSel.value = readPref(PREF_KEYS.grid, 'on') === 'off' ? 'off' : 'on';
        gridSel.addEventListener('change', () => {
            localStorage.setItem(PREF_KEYS.grid, gridSel.value);
            applyGridLines(gridSel.value !== 'off');
            showToast('✅ 已保存网格线设置', 'success');
        });
    }

    // 清空本地偏好
    const resetBtn = document.getElementById('resetPrefs');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (!confirm('确定要恢复默认设置吗？（不会影响你的账号与数据）')) return;
            localStorage.removeItem(PREF_KEYS.pageSize);
            localStorage.removeItem(PREF_KEYS.textSize);
            localStorage.removeItem(PREF_KEYS.density);
            localStorage.removeItem(PREF_KEYS.grid);
            if (sizeSel) sizeSel.value = '0';
            if (textSel) textSel.value = 'normal';
            if (densitySel) densitySel.value = 'comfortable';
            if (gridSel) gridSel.value = 'on';
            applyTextSize('normal');
            applyDensity('comfortable');
            applyGridLines(true);
            showToast('✅ 已恢复默认设置', 'success');
        });
    }
}

/** 字号通过根元素上的 data-text-size 属性生效，样式侧统一控制 */
function applyTextSize(size) {
    if (size === 'large') {
        document.documentElement.setAttribute('data-text-size', 'large');
    } else {
        document.documentElement.removeAttribute('data-text-size');
    }
}

/** 主题切换后，让侧边栏按钮的图标与文案跟上（shell.js 的 refresh 是闭包内的，这里重新触发一次） */
function syncThemeButton() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const useEl = btn.querySelector('use');
    const labelEl = btn.querySelector('.theme-label');
    if (useEl) useEl.setAttribute('href', dark ? '#i-sun' : '#i-moon');
    if (labelEl) labelEl.textContent = dark ? '浅色模式' : '深色模式';
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
