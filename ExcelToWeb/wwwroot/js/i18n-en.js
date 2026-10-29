// ================================================================
// 英文文案字典（中文为源语言，这里只维护「中文 → 英文」）
// ----------------------------------------------------------------
// 覆盖范围（按约定分批推进）：页面外壳（侧栏 / 主题 / 退出）、设置页、登录页。
// 未收录的文案会自动回落中文，不会出现空白；补齐时直接往对象里加一行即可。
// 注意：英文值必须唯一 —— 切回中文靠反向查表，重复值会还原成另一个中文。
// ================================================================

I18n.register({
    // ===== 页面外壳：侧栏导航与底部操作 =====
    '表格数据工作台': 'Spreadsheet workbench',
    '工作区': 'Workspace',
    '系统': 'System',
    '表格编辑': 'Table editor',
    '表格管理': 'Tables',
    '数据看板': 'Dashboard',
    '审计中心': 'Audit trail',
    '回收站': 'Trash',
    '使用帮助': 'Help',
    '设置': 'Settings',
    '管理员 · 本机': 'Administrator · Local',
    '深色模式': 'Dark mode',
    '浅色模式': 'Light mode',
    '折叠侧边栏': 'Collapse sidebar',
    '展开侧边栏': 'Expand sidebar',
    '展开': 'Expand',
    '退出登录': 'Sign out',
    '确定要退出登录吗？': 'Sign out of your account?',
    '跳到主要内容': 'Skip to main content',
    '切换主题': 'Toggle theme',
    '未知时间': 'Unknown time',
    '表格': 'Table',
    '全部': 'All',

    // ===== 页面标题（<title> 不在 body 里，由 i18n.js 的 translateTitle 单独翻） =====
    'Excel 在线编辑工具': 'Excel online editor',
    '表格管理 - Excel 在线编辑工具': 'Tables - Excel online editor',
    '数据看板 - Excel 在线编辑工具': 'Dashboard - Excel online editor',
    '审计中心 - Excel 在线编辑工具': 'Audit trail - Excel online editor',
    '回收站 - Excel 在线编辑工具': 'Trash - Excel online editor',
    '使用帮助 - Excel 在线编辑工具': 'Help - Excel online editor',
    '设置 - Excel 在线编辑工具': 'Settings - Excel online editor',
    '登录 - Excel 在线编辑工具': 'Sign in - Excel online editor',

    // ===== 命令面板（palette.js，全站共用，所以放在基础字典里） =====
    '命令面板': 'Command palette',
    '输入命令、页面或表格名…': 'Type a command, page or table name…',
    '↑↓ 选择': '↑↓ to move',
    'Enter 执行': 'Enter to run',
    'Ctrl+K 开关': 'Ctrl+K to toggle',
    '前往：表格编辑': 'Go to: Table editor',
    '前往：表格管理': 'Go to: Tables',
    '前往：数据看板': 'Go to: Dashboard',
    '前往：使用帮助': 'Go to: Help',
    '前往：设置': 'Go to: Settings',
    '页面': 'Page',
    '切换深色 / 浅色模式': 'Toggle dark / light mode',
    '外观': 'Appearance',
    '新增行': 'Add row',
    '编辑': 'Edit',
    '保存当前表格': 'Save current table',
    '数据': 'Data',
    '刷新数据': 'Refresh data',
    '上传 Excel…': 'Upload Excel…',
    '导出 Excel': 'Export Excel',
    '导出 CSV': 'Export CSV',
    '查找和替换': 'Find and replace…',
    '工具': 'Tools',
    '列管理（增删改移）': 'Column manager (add, edit, move)',
    '数据校验规则': 'Data validation rules',
    '条件格式规则': 'Conditional formatting rules',
    '变更历史': 'Change history',
    '撤销': 'Undo',
    '重做': 'Redo',
    '跳到列：{col}': 'Jump to column: {col}',
    '当前表格': 'Current table',
    '切换表格：{name}': 'Switch table: {name}',
    '当前页未显示该列（可能在其它页码或被隐藏）':
        'This column is not on the current page (another page, or hidden)',
    '没有匹配的命令': 'No matching commands',

    // ===== 设置页：会话与分区（页头下方的锚点标签栏） =====
    '设置分区': 'Settings sections',
    '会话按「浏览器登录」划分：在某设备上注销该会话后，那台设备需要重新登录。':
        'Sessions are tracked per browser sign-in: revoking one on a device means that device must sign in again.',
    '登录状态最短 2 小时自动续期一次，最长 7 天不动也会过期。':
        'A session renews at most every 2 hours and expires after 7 days of inactivity.',

    // ===== 设置页：页头 / 标签栏 / 账号 =====
    '账号、偏好与安全设置 · 仅作用于本机浏览器': 'Account, preferences and security · This browser only',
    '账号': 'Account',
    '密码': 'Password',
    '会话': 'Sessions',
    '会话管理': 'Session management',
    '偏好设置': 'Preferences',
    '关于': 'About',
    '加载中…': 'Loading…',
    '账号类型': 'Account type',
    '密码状态': 'Password status',
    '识别中…': 'Detecting…',
    '本地账号密码': 'Local username and password',
    'Windows 集成身份验证': 'Windows integrated authentication',
    '已设置本地密码': 'Local password set',
    '未设置本地密码': 'No local password',
    '使用 Windows 集成身份验证自动创建的账号没有本地密码，无法在此修改。':
        'Accounts created by Windows integrated authentication have no local password, so it cannot be changed here.',
    '本地密码由服务器校验：修改后其他设备无需重新登录，下次登录请使用新密码。':
        'The local password is verified by the server. Other devices stay signed in; use the new password next time.',

    // ===== 设置页：修改密码 =====
    '修改密码': 'Change password',
    '原密码': 'Current password',
    '请输入当前密码': 'Enter your current password',
    '仅用于身份校验，不会以明文保存': 'Used for verification only, never stored in plain text',
    '新密码': 'New password',
    '至少 6 位': 'At least 6 characters',
    '至少 6 位，建议包含字母与数字': 'At least 6 characters; letters and digits recommended',
    '确认新密码': 'Confirm new password',
    '再次输入新密码': 'Re-enter the new password',
    '需与新密码完全一致': 'Must match the new password exactly',
    '保存新密码': 'Save new password',

    // ===== 设置页：会话管理 =====
    // 带 {占位} 的条目由 I18n.t(key, vars) 拼装，中文侧同样是模板，改中文即改 UI
    '{n} 个已登录会话': '{n} active sessions',
    '登录于 {time}': 'Signed in {time}',
    '来源 {ip}': 'From {ip}',
    '未知': 'Unknown',
    '当前会话': 'This session',
    '注销': 'Revoke',
    '未知设备': 'Unknown device',
    '当前没有活跃会话。': 'No active sessions.',
    '会话列表加载失败：{msg}': 'Failed to load sessions: {msg}',
    '注销当前会话将退出登录，确定吗？': 'Revoking this session signs you out. Continue?',
    '确定要注销该会话吗？该设备将需要重新登录。': 'Revoke this session? That device will need to sign in again.',
    '会话已注销': 'Session revoked',

    // ===== 设置页：偏好设置 =====
    '主题': 'Theme',
    '浅色': 'Light',
    '深色': 'Dark',
    '默认每页行数': 'Default rows per page',
    '全部（不分页）': 'All (no paging)',
    '50 行': '50 rows',
    '100 行': '100 rows',
    '500 行': '500 rows',
    '数据量较大时建议分页，可明显提升表格滚动与编辑的流畅度':
        'Paging keeps large tables smooth to scroll and edit',
    '表格字号': 'Table font size',
    '标准': 'Standard',
    '紧凑': 'Compact',
    '舒适': 'Comfortable',
    '在「表格编辑」页生效，可自行切换对比': 'Applies to the editor — switch back and forth to compare',
    '网格线': 'Grid lines',
    '关闭后表格只保留行分隔线，画面更干净': 'When off, only row separators remain — a cleaner grid',
    '恢复默认设置': 'Reset to defaults',
    '偏好设置保存在本机浏览器中，不影响账号数据。':
        'Preferences live in this browser and never touch account data.',
    '主题已切换': 'Theme switched',
    '已保存默认每页行数': 'Default page size saved',
    '已保存表格字号': 'Table font size saved',
    '已显示网格线': 'Grid lines shown',
    '已隐藏网格线': 'Grid lines hidden',
    '已恢复默认设置': 'Defaults restored',
    '恢复默认设置后，主题、分页与表格字号都会回到初始值，确定吗？':
        'Resetting restores theme, paging and font size to their defaults. Continue?',

    // ===== 设置页：成员管理（RBAC） =====
    '成员': 'Members',
    '{n} 名成员': '{n} members',
    '新注册的账号默认是管理员。': 'New accounts start as administrators.',
    '把不需要写权限的账号降为「编辑」或「只读」，权限变更立即生效，对方无需重新登录。':
        'Demote accounts that should not write to Editor or Viewer — the change takes effect immediately, no re-login needed.',
    '成员列表加载失败：{msg}': 'Failed to load members: {msg}',
    '还没有其他账号。': 'No other accounts yet.',
    '当前账号': 'This account',
    '最后登录 {time}': 'Last signed in {time}',
    '从未登录': 'Never signed in',
    '成员角色': 'Member role',
    '把「{name}」设为{role}？权限变更立即生效。': 'Set “{name}” to {role}? This takes effect immediately.',
    '角色已更新': 'Role updated',

    // ===== 角色名（RBAC 三档，见 Auth/Rbac.cs） =====
    '管理员': 'Administrator',
    '编辑者': 'Editor',
    '只读': 'Viewer',

    // ===== 设置页：关于 =====
    '版本': 'Version',
    '后端': 'Backend',
    '前端': 'Frontend',
    '浏览器': 'Browser',
    '帮助文档': 'Documentation',
    '查看使用帮助': 'Open the help guide',
    '原生 HTML/CSS/JavaScript（零构建、零依赖）': 'Vanilla HTML/CSS/JavaScript (no build, no dependencies)',

    // ===== 修改密码：校验与提示 =====
    '请输入原密码': 'Enter the current password',
    '新密码至少 6 位': 'The new password needs at least 6 characters',
    '两次输入的新密码不一致': 'The new passwords do not match',
    '新密码不能与原密码相同': 'The new password must differ from the current one',
    '密码修改成功': 'Password updated',

    // ===== 登录页 =====
    '欢迎回来': 'Welcome back',
    '登录后继续管理你的数据': 'Sign in to keep managing your data',
    '创建账号': 'Create an account',
    '注册后即可开始使用': 'Register to get started',
    '用户名': 'Username',
    '请输入用户名': 'Enter your username',
    '请输入密码': 'Enter your password',
    '登 录': 'Sign in',
    '注 册': 'Register',
    '或': 'or',
    '使用 Windows 账号登录': 'Sign in with a Windows account',
    '一键体验演示账号（只读）': 'Try the demo account (read-only)',
    '还没有账号？': 'No account yet?',
    '立即注册': 'Create one',
    '已有账号？': 'Already have an account?',
    '去登录': 'Sign in instead',
    '用户名（3-20位，仅字母和数字）': 'Username (3–20 letters or digits)',
    '密码（至少6位）': 'Password (at least 6 characters)',
    '确认密码': 'Confirm password',
    '请再次输入密码': 'Re-enter the password',
    '正在使用 Windows 账号自动登录...': 'Signing in with your Windows account…',
    '请填写完整信息': 'Please fill in every field',
    '两次密码输入不一致': 'The passwords do not match',
    '网络错误，请稍后重试': 'Network error — please try again',
    '注册成功，请登录': 'Account created — please sign in',
    '注册失败': 'Registration failed',
    '登录失败': 'Sign-in failed',
    '演示账号暂不可用': 'The demo account is unavailable',
    '登录成功，跳转中...': 'Signed in — redirecting…',
    '正在进入演示模式...': 'Entering demo mode…',
    '确定使用当前 Windows 账号登录吗？': 'Sign in with your current Windows account?',
    'Windows 登录不可用或已被拒绝，请使用账号密码登录':
        'Windows sign-in is unavailable or was denied — use your username and password',

    // 请求层（api.js）的错误文案：超时 / 非 JSON 响应 / 会话过期
    '服务器响应超时，请稍后重试': 'The server took too long to respond — please try again',
    '服务器返回了无法解析的响应（HTTP {status}）': 'The server returned an unreadable response (HTTP {status})',
    '服务器暂时不可用（HTTP {status}），请稍后重试': 'The server is temporarily unavailable (HTTP {status}) — please try again',
    '登录已过期，请重新登录': 'Your session has expired — please sign in again',
    '请求失败': 'Request failed'
});
