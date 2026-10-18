// ================================================================
// 英文文案字典 · 审计中心（audit.html）
// ----------------------------------------------------------------
// 时间线里的表名、列名、旧值 / 新值都是数据，保持原文；这里只翻界面文案。
// 时间格式跟着语言走（utils.js 的 formatTime），不在字典里维护。
// ================================================================

I18n.register({
    // ===== 页头与筛选栏 =====
    '返回表格编辑': 'Back to the editor',
    '表格：': 'Table:',
    '全部表格': 'All tables',
    '操作：': 'Action:',
    '单元格编辑': 'Cell edit',
    '删除行': 'Delete row',
    '批量变更': 'Bulk change',
    '从': 'From',
    '至': 'To',
    '查询': 'Search',
    '重置': 'Reset',

    // ===== 时间线与分页 =====
    '加载失败：{msg}': 'Could not load: {msg}',
    '没有符合条件的变更记录': 'No change records match these filters',
    '编辑表格数据后这里会出现时间线': 'A timeline appears here once you edit table data',
    '跳转到该表格': 'Open this table',
    '第 {n} 行 · {col}：': 'Row {n} · {col}:',
    '旧值': 'Before',
    '空': 'Empty',
    '新值': 'After',
    '新增了第 {n} 行': 'Added row {n}',
    '删除了第 {n} 行': 'Deleted row {n}',
    '批量变更（{v}）': 'Bulk change ({v})',
    '共 {n} 条记录': '{n} records',
    '上一页': 'Previous',
    '第 {page} / {total} 页': 'Page {page} of {total}',
    '下一页': 'Next'
});
