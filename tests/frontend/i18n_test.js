// i18n 单测：字典完整性 + t() 回落 + DOM 双向翻译 + 动态内容补翻 + 语言持久化 + 控件状态
// 这些都是纯逻辑，用极简 DOM 桩（含 TreeWalker / MutationObserver）直接锁住，
// 避免以后往字典里加词时把「英文值撞车导致切不回中文」这类问题带回来。
// 对应实现：wwwroot/js/i18n.js、wwwroot/js/i18n-en.js
// DOM 桩在 helpers/i18n-dom.js（helpers/ 不被 run.py 当用例执行）
const fs = require('fs');
const path = require('path');
const { build, makeElement, makeText, textOf } = require('./helpers/i18n-dom');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot');
const dictCode = fs.readFileSync(path.join(ROOT, 'js', 'i18n-en.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

// ---------------------------------------------------------------
console.log('[1] 字典：英文值唯一 / 无中文残留 / 占位符两侧一致');
// ---------------------------------------------------------------
{
    const H = build();
    const keys = [];
    const re = /'([^'\n]*[\u4e00-\u9fa5][^'\n]*)'\s*:/g;
    let m;
    while ((m = re.exec(dictCode))) keys.push(m[1]);

    check('字典条目数合理（外壳 + 设置 + 登录）', keys.length >= 80, keys.length);
    check('关键条目都在（导航 / 主题 / 登录）',
        ['表格编辑', '深色模式', '退出登录', '欢迎回来'].every(k => keys.indexOf(k) !== -1));

    const dirty = [];      // 英文值里还夹着中文
    const badBack = [];    // 切回中文时还原成了别的文案（英文值撞车）
    const lostVar = [];    // 占位符在英文侧被吃掉

    keys.forEach(key => {
        H.I18n.setLang('en');
        const en = H.I18n.t(key);
        if (/[\u4e00-\u9fa5]/.test(en)) dirty.push(key);

        const holes = (key.match(/\{\w+\}/g) || []).sort().join(',');
        const enHoles = (en.match(/\{\w+\}/g) || []).sort().join(',');
        if (holes !== enHoles) lostVar.push(key);

        // 反向查表：英文值必须是唯一的，否则还原成另一个中文
        const holder = H.block('p', en);
        H.I18n.setLang('zh');
        H.I18n.apply(holder);
        if (textOf(holder) !== key) badBack.push(key + ' → ' + textOf(holder));
    });

    check('英文值里不夹中文', dirty.length === 0, dirty.slice(0, 5).join(' | '));
    check('占位符中英一致', lostVar.length === 0, lostVar.slice(0, 5).join(' | '));
    check('英文值唯一，可无损切回中文', badBack.length === 0, badBack.slice(0, 5).join(' | '));
}

// ---------------------------------------------------------------
console.log('[2] t()：中文直通 / 英文命中 / 漏翻回落 / 占位符');
// ---------------------------------------------------------------
{
    const I = build().I18n;

    check('默认语言是中文', I.lang() === 'zh');
    check('中文模式原样返回', I.t('设置') === '设置');
    check('未收录的文案原样返回，不会露 key', I.t('这段文案字典里没有') === '这段文案字典里没有');

    I.setLang('en');
    check('英文模式命中字典', I.t('设置') === 'Settings', I.t('设置'));
    check('英文模式漏翻回落中文', I.t('这段文案字典里没有') === '这段文案字典里没有');
    check('占位符替换（英文）',
        I.t('{n} 个已登录会话', { n: 3 }) === '3 active sessions',
        I.t('{n} 个已登录会话', { n: 3 }));

    I.setLang('zh');
    check('占位符替换（中文侧同样是模板）',
        I.t('{n} 个已登录会话', { n: 3 }) === '3 个已登录会话',
        I.t('{n} 个已登录会话', { n: 3 }));
    check('多个占位符都替换', I.t('登录于 {time}', { time: '10:30' }) === '登录于 10:30');
}

// ---------------------------------------------------------------
console.log('[3] apply()：文本节点双向翻译 / 跳过数据区 / 属性也翻');
// ---------------------------------------------------------------
{
    const H = build();
    const I = H.I18n;

    const head = H.block('h1', '  设置  ');          // 首尾空白要保留
    const tbody = makeElement('tbody');
    tbody.appendChild(H.block('td', '设置'));        // 表格正文是数据，不翻
    const skip = makeElement('span');
    skip.setAttribute('data-i18n-skip', '');
    skip.appendChild(makeText('设置'));              // 控件自身不参与翻译
    const input = makeElement('input');
    input.setAttribute('placeholder', '请输入密码');
    input.setAttribute('title', '设置');
    input.setAttribute('data-label', '表格编辑');

    const root = makeElement('div');
    [head, tbody, skip, input].forEach(n => root.appendChild(n));

    I.setLang('en');
    I.apply(root);

    check('文本节点被翻译', textOf(head) === '  Settings  ', JSON.stringify(textOf(head)));
    check('tbody 里的数据不动', textOf(tbody) === '设置', textOf(tbody));
    check('data-i18n-skip 子树不动', textOf(skip) === '设置', textOf(skip));
    check('placeholder 被翻译', input.getAttribute('placeholder') === 'Enter your password');
    check('title 被翻译', input.getAttribute('title') === 'Settings');
    check('data-label（折叠气泡）被翻译', input.getAttribute('data-label') === 'Table editor');

    I.setLang('zh');
    I.apply(root);
    check('切回中文：文本还原', textOf(head) === '  设置  ', JSON.stringify(textOf(head)));
    check('切回中文：属性还原', input.getAttribute('title') === '设置'
        && input.getAttribute('placeholder') === '请输入密码'
        && input.getAttribute('data-label') === '表格编辑');
}

// ---------------------------------------------------------------
console.log('[4] 动态内容：新增节点 / 文本改写都会被补翻');
// ---------------------------------------------------------------
{
    const H = build();
    const I = H.I18n;
    I.setLang('en');

    const holder = H.block('p', '设置');
    H.mutate([{ type: 'childList', addedNodes: [holder] }]);
    check('新增节点立即翻译', textOf(holder) === 'Settings', textOf(holder));

    const t = holder.children[0];
    t.nodeValue = '回收站';
    H.mutate([{ type: 'characterData', target: t }]);
    check('原地改写文本也翻译', textOf(holder) === 'Trash', textOf(holder));

    I.setLang('zh');
    const zhHolder = H.block('p', '设置');
    H.mutate([{ type: 'childList', addedNodes: [zhHolder] }]);
    check('中文模式下不做多余改写', textOf(zhHolder) === '设置', textOf(zhHolder));
}

// ---------------------------------------------------------------
console.log('[5] setLang()：持久化 + <html lang> + 变更事件');
// ---------------------------------------------------------------
{
    const H = build();
    const I = H.I18n;

    I.setLang('en');
    check('写入 localStorage.lang', H.store.lang === 'en', H.store.lang);
    check('html lang = en', H.html.getAttribute('lang') === 'en');
    check('html data-lang = en', H.html.getAttribute('data-lang') === 'en');
    check('派发 i18n:change', H.events.some(e => e.type === 'i18n:change' && e.detail.lang === 'en'));

    const before = H.events.length;
    I.setLang('en');
    check('重复设同一语言不再派发事件', H.events.length === before);

    I.setLang('zh');
    check('切回中文后 html lang = zh-CN', H.html.getAttribute('lang') === 'zh-CN');
    check('脏值落到默认值', I.setLang('fr') === 'zh' && H.store.lang === 'zh');

    // 刷新页面（重建沙箱）后仍记得上次的选择
    const again = build({ lang: 'en' });
    check('下次访问沿用已保存的语言', again.I18n.lang() === 'en');
    check('启动时同步 html lang', again.html.getAttribute('lang') === 'en');

    check('存储里的脏值不影响启动', build({ lang: 'fr' }).I18n.lang() === 'zh');
}

// ---------------------------------------------------------------
console.log('[6] 切换控件：两个选项 / 选中态 / 点击生效');
// ---------------------------------------------------------------
{
    const H = build();
    const I = H.I18n;

    const wrap = H.document.getElementById('langSwitch');
    check('控件已挂到 data-lang-mount 容器里', !!wrap && H.mount.children.indexOf(wrap) !== -1);

    const btns = wrap.querySelectorAll('.lang-btn');
    check('只有中 / EN 两个选项', btns.length === 2, btns.length);
    check('选项文案是「中」「EN」',
        textOf(btns[0]) === '中' && textOf(btns[1]) === 'EN',
        textOf(btns[0]) + '/' + textOf(btns[1]));
    check('选项值分别是 zh / en',
        btns[0].getAttribute('data-lang') === 'zh' && btns[1].getAttribute('data-lang') === 'en');

    check('初始选中中文',
        btns[0].classList.contains('is-active') && btns[0].getAttribute('aria-pressed') === 'true'
        && !btns[1].classList.contains('is-active'));

    wrap.dispatch('click', { target: btns[1] });
    check('点击 EN 切到英文', I.lang() === 'en' && H.store.lang === 'en');
    check('选中态跟着走',
        btns[1].classList.contains('is-active') && btns[1].getAttribute('aria-pressed') === 'true'
        && !btns[0].classList.contains('is-active')
        && btns[0].getAttribute('aria-pressed') === 'false');

    wrap.dispatch('click', { target: btns[0] });
    check('点击「中」切回中文', I.lang() === 'zh');

    // 点空白处（不是按钮）不应改变语言
    wrap.dispatch('click', { target: makeElement('svg') });
    check('点非按钮区域不切换', I.lang() === 'zh');
}

// ---------------------------------------------------------------
console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail === 0 ? 0 : 1);
