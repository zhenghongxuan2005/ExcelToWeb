// 权限模块单测：can() / applyPermissions() / saveAuthz() 的判定与降级行为
//
// 这里测的是「界面能不能用」，不是安全边界——服务端的 403 由 rbac_test.py 覆盖。
// 但两者有个共同前提值得锁住：权限列表为空时必须「放行」（fail-open），
// 否则换账号或旧登录态下整个界面会被藏空。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', 'ExcelToWeb', 'wwwroot', 'js');
const code = fs.readFileSync(path.join(ROOT, 'authz.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
    if (ok) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail !== undefined ? ' | ' + JSON.stringify(detail) : '')); }
}

/** 造一个能记录 hidden 的元素，并回放它的 data-perm */
function makePermEl(permission) {
    return { hidden: false, getAttribute: () => permission };
}

/** 在独立沙箱里加载 authz.js，返回 { api, store } */
function boot(store, elements) {
    const document = {
        addEventListener() {},
        querySelectorAll(sel) { return sel === '[data-perm]' ? (elements || []) : []; }
    };
    const sandbox = {
        console,
        document,
        localStorage: {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; }
        }
    };
    sandbox.window = sandbox;
    vm.runInContext(code, vm.createContext(sandbox), { filename: 'authz.js' });
    return { api: sandbox.Authz, store };
}

console.log('\n[1] 没有权限缓存时（未登录 / 旧登录态）');
{
    const { api } = boot({}, []);
    check('导出 Authz 对象', !!api && typeof api.can === 'function');
    check('未知权限按放行处理', api.can('table:write') === true);
    check('角色为空串', api.role() === '', api.role());
}

console.log('\n[2] 只读账号的权限判定');
{
    const { api } = boot({ permissions: JSON.stringify(['table:read']), role: 'Viewer' }, []);
    check('有 table:read', api.can('table:read') === true);
    check('没有 table:write', api.can('table:write') === false);
    check('没有 member:manage', api.can('member:manage') === false);
    check('读得到角色', api.role() === 'Viewer', api.role());
}

console.log('\n[3] 按 data-perm 隐藏入口');
{
    const writeEl = makePermEl('table:write');
    const readEl = makePermEl('table:read');
    const { api } = boot({ permissions: JSON.stringify(['table:read']) }, [writeEl, readEl]);
    api.apply();
    check('写入口被隐藏', writeEl.hidden === true);
    check('读入口保持可见', readEl.hidden === false);
}

console.log('\n[4] 管理员全部可见');
{
    const els = [makePermEl('table:write'), makePermEl('table:delete'), makePermEl('member:manage')];
    const { api } = boot({
        permissions: JSON.stringify(['table:read', 'table:write', 'table:delete', 'trash:manage', 'member:manage'])
    }, els);
    api.apply();
    check('三个入口都可见', els.every(e => e.hidden === false));
}

console.log('\n[5] 保存服务端下发的角色与权限');
{
    const el = makePermEl('table:write');
    const { api, store } = boot({}, [el]);
    api.save({ role: 'Viewer', permissions: ['table:read'] });
    check('权限写进本地存储', store.permissions === '["table:read"]', store.permissions);
    check('角色写进本地存储', store.role === 'Viewer', store.role);
    check('保存后立即按新权限隐藏入口', el.hidden === true);
}

console.log('\n[6] 本地缓存损坏时不影响页面');
{
    const { api } = boot({ permissions: '{坏掉的 JSON', role: 'Viewer' }, []);
    check('解析失败当空权限处理（放行）', api.can('table:write') === true);
    check('不清空已有角色，避免侧栏显示空白', api.role() === 'Viewer', api.role());
}

console.log('\n[7] 权限码与角色名的兜底');
{
    const { api } = boot({ role: 'Admin' }, []);
    // 沙箱里没有 shell.js（真实页面一定有），此时 roleText 退化为角色码本身
    check('无 Shell 时回落到角色码', api.roleText('Admin') === 'Admin', api.roleText('Admin'));
    check('未知角色原样返回（真实页面由 shell.js 兜底成「只读」）', api.roleText('Root') === 'Root', api.roleText('Root'));
}

console.log('\n================ ' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exitCode = fail === 0 ? 0 : 1;
