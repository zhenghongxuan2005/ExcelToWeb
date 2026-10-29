// ================================================================
// 设置页标签栏：锚点跳转 + 滚动高亮
// 五块都在同一页纵向排列，标签只负责「定位」，不做内容切换。
// 单独成文件是因为 settings.js 体量已经很大，导航逻辑也本该独立。
// 依赖：无（只用 DOM API）
// ================================================================

document.addEventListener('DOMContentLoaded', initSettingsTabs);

function initSettingsTabs() {
    const nav = document.getElementById('settingsTabs');
    if (!nav) return;

    nav.addEventListener('click', onClickTab);

    // 滚动高亮：判定带落在视口中上部，取其中最靠上的一块。
    // 没有 IntersectionObserver 的环境（老浏览器 / 单测桩）只保留点击跳转。
    if (typeof IntersectionObserver !== 'function') return;

    const observer = new IntersectionObserver(entries => {
        const visible = entries.filter(en => en.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) setActiveTab(visible[0].target.id);
    }, { rootMargin: '-20% 0px -60% 0px' });

    const tabs = nav.querySelectorAll('.settings-tab');
    for (let i = 0; i < tabs.length; i++) {
        const section = document.getElementById(tabs[i].getAttribute('data-target'));
        if (section) observer.observe(section);
    }
}

function onClickTab(e) {
    const tab = e.target.closest('.settings-tab');
    if (!tab) return;

    const id = tab.getAttribute('data-target');
    const section = document.getElementById(id);
    if (!section) return;

    e.preventDefault();
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveTab(id);
}

/** 激活某个标签：class 负责下划线，aria-current 负责可访问性，两者必须同步 */
function setActiveTab(id) {
    const nav = document.getElementById('settingsTabs');
    if (!nav) return;

    const tabs = nav.querySelectorAll('.settings-tab');
    for (let i = 0; i < tabs.length; i++) {
        const on = tabs[i].getAttribute('data-target') === id;
        if (tabs[i].classList) tabs[i].classList.toggle('is-active', on);
        if (on) tabs[i].setAttribute('aria-current', 'true');
        else tabs[i].removeAttribute('aria-current');
    }
}
