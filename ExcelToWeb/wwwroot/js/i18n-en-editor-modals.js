// ================================================================
// 英文文案字典 · 表格编辑页的弹窗与下拉（modal-templates.js 等）
// ----------------------------------------------------------------
// 为什么单独一个文件：
//   1. 这些文案不是 tt('…') 字面量，而是模板里写死的 HTML / 传进 tt() 的变量
//      （AGG_MODES[mode].label、筛选操作符表），字面量扫描抓不到，只能靠渲染后核对；
//   2. i18n-en-editor.js 已经接近 400 行上限。
// 翻译方式仍是「文本节点整段匹配」：弹窗在页面加载时就插进 DOM，boot 时会整体翻一遍；
// 之后由 JS 重新渲染的片段由 MutationObserver 补翻，所以这里不需要改模板代码。
// ================================================================

I18n.register({
    // ===== 各弹窗标题与说明 =====
    '条件格式规则设置': 'Set up conditional formatting',
    '设置数值列的颜色规则，输入范围后点击保存。留空最大值表示"以上"。':
        'Set color rules for a numeric column: enter a range and save. Leave the maximum blank to mean "and above".',
    '应用列': 'Apply to column',
    '插入列': 'Insert column',
    '插入函数': 'Insert function',
    '取消计算列': 'Clear computed column',
    '确定': 'OK',
    '例如：[单价] * [数量]': 'e.g. [Unit price] * [Quantity]',
    '添加规则': 'Add rule',
    '取消': 'Cancel',
    '保存规则': 'Save rules',
    '数据校验规则设置': 'Set up data validation',
    '为每列设置校验规则，点击"保存"时自动检查数据合法性':
        'Add validation rules per column; they run automatically when you click Save.',
    '每次「保存」时自动记录前后差异（最多显示最近 100 条）。行号以保存当时为准，行增删后旧记录的行号可能不再对齐。':
        'Every save records the before/after difference (the latest 100 entries are listed). Row numbers reflect the moment of saving, so they can drift once rows are added or removed.',
    '关闭': 'Close',
    '关闭弹窗': 'Close dialog',
    '将选中行的某一列统一修改为新值': 'Set one column of the selected rows to the same value',
    '确认修改': 'Confirm',
    '列管理': 'Column manager',
    '重排（↑↓）、改名（直接编辑）、删除（×）或添加列。删除列会连同数据与相关规则一起清除，保存时一次提交。':
        'Reorder with ↑↓, rename by typing, delete with ×, or add a column. Deleting a column also removes its data and related rules; everything is submitted in a single save.',
    '添加列': 'Add column',
    '保存列结构': 'Save columns',
    '计算列公式': 'Computed column formula',
    '选择工作表': 'Select a worksheet',
    '这个文件里有多个工作表，请选择要导入的一张。每次导入一张，导入后会成为一个新表格。':
        'This file holds several worksheets — pick the one to import. Imports are one sheet at a time, and each becomes a new table.',

    // ===== 筛选弹窗 =====
    '筛选:': 'Filter:',
    '勾选要显示的值（Excel 式值清单），或切换到「按条件」用关键词筛选。筛选只影响显示，保存时仍会保存全部数据。':
        'Tick the values to show (an Excel-style value list), or switch to "By condition" and filter by keyword. Filtering only changes what is displayed — saving still writes every row.',
    '按值选择': 'By value',
    '按条件': 'By condition',
    '全选': 'Select all',
    '全不选': 'Clear all',
    '条件': 'Condition',
    '包含': 'Contains',
    '不包含': 'Does not contain',
    '等于': 'Equals',
    '开头是': 'Starts with',
    '结尾是': 'Ends with',
    '关键词': 'Keyword',
    '应用': 'Apply',
    '搜索值...': 'Search values…',
    '输入筛选关键词...': 'Enter a filter keyword…',
    '输入要修改的值': 'Enter the new value',

    // ===== 查找替换弹窗 =====
    '在整个表格中查找，范围不受筛选与分页影响':
        'Searches the whole table — filtering and paging do not narrow the scope.',
    '查找内容': 'Find',
    '替换为': 'Replace with',
    '区分大小写': 'Match case',
    '查找下一个': 'Find next',
    '替换': 'Replace',
    '全部替换': 'Replace all',
    '要查找的文字或数字': 'Text or number to find',
    '留空表示删除匹配内容': 'Leave blank to delete the match',

    // ===== 透视弹窗与汇总下拉 =====
    '行（分组）': 'Row (group by)',
    '列（展开）': 'Column (spread by)',
    '汇总列': 'Value column',
    '汇总方式': 'Aggregation',
    '生成预览': 'Generate preview',
    '求和': 'Sum',
    '计数': 'Count',
    '平均': 'Average',
    '查看整表历史': 'View history for the whole table'
});
