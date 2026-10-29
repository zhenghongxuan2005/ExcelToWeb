// ================================================================
// 英文文案字典 · 回收站（trash.html）
// ----------------------------------------------------------------
// 「N 天后自动清除」里的天数由服务端算，前端只负责把句子按语言拼出来。
// 表名仍是用户数据，不翻。
// ================================================================

I18n.register({
    // ===== 页头 =====
    '返回表格管理': 'Back to Tables',
    '删除的表格在这里保留 30 天，期间可随时恢复；超过 30 天由系统自动彻底清除。':
        'Deleted tables stay here for 30 days and can be restored at any time. After 30 days the system removes them for good.',

    // ===== 卡片与空态 =====
    '加载失败：{msg}': 'Could not load: {msg}',
    '{n} 个已删除表格': '{n} deleted tables',
    '回收站是空的': 'The trash is empty',
    '删除的表格会出现在这里，{n} 天内可恢复':
        'Deleted tables show up here and can be restored within {n} days',
    '查看表格管理': 'Go to Tables',
    '{n} 行数据': '{n} rows of data',
    '删除于 {time}': 'Deleted {time}',
    '{n} 天后自动清除': 'Removed automatically in {n} days',

    // ===== 恢复与彻底删除 =====
    '恢复': 'Restore',
    '彻底删除': 'Delete permanently',
    '已恢复': 'Restored',
    '恢复失败：{msg}': 'Could not restore: {msg}',
    '该表格': 'this table',
    '确定要彻底删除「{name}」吗？其全部数据、变更历史与校验规则都将被清除，此操作不可恢复。':
        'Permanently delete "{name}"? All of its data, change history and validation rules will be erased. This cannot be undone.',
    '已彻底删除': 'Permanently deleted',
    '彻底删除失败：{msg}': 'Could not delete permanently: {msg}'
});
