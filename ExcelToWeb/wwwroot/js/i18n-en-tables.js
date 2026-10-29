// ================================================================
// 英文文案字典 · 表格管理（tables.html）
// ----------------------------------------------------------------
// 这一页几乎全是 JS 渲染（tables-page.js），所以文案分两类：
//   1. 静态骨架（page-desc、按钮、面板标题）—— 由 i18n.js 按文本节点整段匹配
//   2. 卡片里拼出来的句子（「N 个表格」「创建 {time}」）—— 必须走 tt()，
//      否则拼接后的整串永远命中不了字典
// 表名、列名是用户数据，不翻；数量单位（个 / 列 / 行）跟着语言走。
// ================================================================

I18n.register({
    // ===== 页头与说明 =====
    '导入新表格': 'Import a table',
    '刷新': 'Refresh',
    '集中管理已导入的表格：打开编辑、重命名、复制、导出或删除。':
        'Manage your imported tables here: open, rename, duplicate, export or delete.',
    // 这四条在编辑页字典里也有，但 tables.html 不加载编辑页字典，必须本页带一份
    '加载中...': 'Loading…',
    '加载失败：{msg}': 'Could not load: {msg}',
    '{n} 列': '{n} columns',

    // ===== 空态 =====
    '{n} 个表格': '{n} tables',
    '还没有任何表格': 'No tables yet',
    '到「表格编辑」页上传一个 Excel 即可创建':
        'Upload an Excel file on the Table editor page to create one',
    '去上传 Excel': 'Upload an Excel file',

    // ===== 卡片 =====
    '无列信息': 'No column info',
    '创建 {time}': 'Created {time}',
    '更新 {time}': 'Updated {time}',
    '每日自动导出': 'Daily auto export',

    // ===== 卡片按钮 =====
    '打开': 'Open',
    '重命名': 'Rename',
    '复制': 'Duplicate',
    '删除': 'Delete',
    '下载': 'Download',

    // ===== 重命名 =====
    '请输入新的表格名称：': 'Enter a new table name:',
    '表格名称不能为空': 'Table name cannot be empty',
    '表格名称不能超过 100 个字符': 'Table name cannot be longer than 100 characters',
    '重命名成功': 'Renamed',
    '重命名失败：{msg}': 'Could not rename: {msg}',

    // ===== 复制 =====
    '副本': 'Copy',
    '已复制为「{name}」': 'Duplicated as "{name}"',
    '复制失败：{msg}': 'Could not duplicate: {msg}',

    // ===== 导出与删除 =====
    // 这三条在编辑页字典里也有同值条目：tables.html 不加载编辑页字典，
    // 每页只带自己那份，跨文件同中文同英文是允许的（反向表不会打架）
    '导出成功': 'Export finished',
    '导出失败：{msg}': 'Could not export: {msg}',
    '已删除': 'Deleted',
    '该表格': 'this table',
    '删除失败：{msg}': 'Could not delete: {msg}',
    '确定要删除「{name}」吗？删除后进回收站，可在「回收站」页恢复。':
        'Delete "{name}"? It goes to Trash, where you can restore it.',

    // ===== 定时导出报表 =====
    '定时导出报表': 'Scheduled reports',
    '每天凌晨 2:00 为开启「每日自动导出」的表格生成一份快照':
        'A snapshot of every table with daily auto export is generated at 2:00 AM each day',
    '{n} 行': '{n} rows',
    '已开启每日自动导出': 'Daily auto export turned on',
    '已关闭每日自动导出': 'Daily auto export turned off'
});
