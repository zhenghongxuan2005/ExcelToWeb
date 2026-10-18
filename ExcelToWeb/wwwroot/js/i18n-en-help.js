// ================================================================
// 英文文案字典 · 使用帮助（help.html）
// ----------------------------------------------------------------
// 这个页面几乎每段都夹着 <strong> / <code> / <kbd> / <a>，
// 逐文本节点翻会把句子切碎、英文语序拼不回来，所以整段交给 data-i18n-html：
// 值就是「带标记的 HTML 字符串」，中文原文留在页面里，切回中文时由 i18n.js 还原。
// 修改时注意：HTML 结构（尤其 <kbd> 与 <a href>）要和页面保持一致，否则样式会掉。
// ================================================================

I18n.register({
    // ===== 页内导航与小标题 =====
    '页内导航': 'On this page',
    '开始使用': 'Getting started',
    '快速上手': 'Quick start',
    '功能说明': 'Features',
    '键盘与快捷键': 'Keyboard shortcuts',
    '常见问题': 'FAQ',
    '全局搜索': 'Global search',
    '查找替换': 'Find and replace',
    '填充柄': 'Fill handle',
    '合并单元格': 'Merged cells',
    '计算列': 'Computed columns',
    '分页': 'Paging',
    '列显示与列宽': 'Column visibility and width',
    '选中行统计': 'Selection statistics',
    '条件格式（颜色规则）': 'Conditional formatting (color rules)',
    '数据校验规则': 'Data validation rules',
    '透视汇总': 'Pivot summary',
    '导出': 'Export',
    '撤销与重做': 'Undo and redo',
    '表格管理与回收站': 'Table management and trash',

    // ===== 快捷键区块 =====
    '单元格操作只在可编辑单元格上生效，不影响页面其它输入框；越过页边界时会自动翻页并落在目标行。':
        'Cell shortcuts only apply inside editable cells, so other inputs on the page are unaffected. Crossing a page boundary flips the page and lands on the target row.',
    '单元格导航与编辑（表格编辑器内）': 'Cell navigation and editing (inside the editor)',
    '下移 / 上移一格': 'Down / up one cell',
    '右移 / 左移一格（到行尾自动换行，与 Excel 一致）':
        'Right / left one cell (wraps at the end of a row, like Excel)',
    '上移 / 下移一格': 'Up / down one cell',
    '光标先在格内移动，到首 / 尾才跳到相邻单元格':
        'The caret moves inside the cell first and only leaves it at the start / end',
    '+ 方向键': '+ arrow keys',
    '从当前格扩展选区（Excel 的选区手感）':
        'Extend the selection from the current cell (feels like Excel)',
    '跳到第一个单元格': 'Jump to the first cell',
    '跳到最后一个单元格': 'Jump to the last cell',
    '取消编辑 / 关闭当前弹窗': 'Cancel editing / close the open dialog',
    '全局快捷键': 'Global shortcuts',
    '聚焦全表搜索': 'Focus the table search',
    '打开命令面板（跨页面快速跳转 / 执行操作）':
        'Open the command palette (jump between pages / run actions)',

    // ===== 常见问题标题 =====
    '上传后提示「文件解析失败」怎么办？': 'The upload says "could not parse the file" — what now?',
    '保存后为什么提示某些行不合法？': 'Why does saving report some rows as invalid?',
    '关闭浏览器后数据会丢吗？': 'Will I lose data if I close the browser?',
    '搜索后保存，会把搜索之外的行删掉吗？':
        'If I save after searching, are rows outside the search deleted?',
    '误删了整张表格还能找回来吗？': 'Can I get a deleted table back?',

    // ===== 快速上手（整块 HTML） =====
    'help.quickstart.steps':
        '<li><strong>Sign in</strong> with a registered account, or get straight in through Windows integrated authentication.</li>'
        + '<li><strong>Import data</strong> with the Upload button, or drag a <code>.xlsx</code> / <code>.csv</code> file onto the page. GBK-encoded CSVs exported from Chinese Excel work too — the encoding is detected automatically.</li>'
        + '<li><strong>Edit data</strong> by typing into cells; adding rows, bulk editing and deleting selected rows all live in the toolbar. See the <a href="#keyboard">shortcut sheet below</a> for the full keyboard set.</li>'
        + '<li><strong>Save</strong> writes everything back to the database, and the validation rules you configured run automatically.</li>'
        + '<li><strong>Open the dashboard</strong> to pick any table and see its summary charts.</li>',

    // ===== 功能说明（整块 HTML） =====
    'help.feature.search':
        '<p>The search box on the right of the toolbar looks through <strong>every column</strong>, highlights hits with a blue background and shows the match count as you type. Searching never touches the underlying data — it only narrows what is displayed.</p>'
        + '<p>Press <kbd>Ctrl</kbd> + <kbd>F</kbd> to jump to the box; click ✕ inside it to clear.</p>',
    'help.feature.replace':
        '<p>The editor can find and replace across all data. Run a search first to confirm the matches, so nothing unintended gets replaced.</p>',
    'help.feature.fill':
        '<p>Select a cell and drag the fill handle in its bottom-right corner to spread the content into neighbouring cells — handy for numbering rows or copying values in bulk.</p>',
    'help.feature.merge':
        '<p>Merged areas in the Excel file are recorded as they are, rendered as merged cells on the page and kept when you export.</p>',
    'help.feature.formula':
        '<p>Type a formula starting with <code>=</code> to create a computed column (unit price × quantity, say). Arithmetic and cell references are supported, and results are calculated on save — ideal for derived metrics.</p>',
    'help.feature.paging':
        '<p>Use the per-page dropdown in the toolbar to show 50 / 100 / 500 rows or all of them. The default is configurable under <strong>Settings → Preferences</strong>.</p>'
        + '<p>Paging is recommended for large tables — it noticeably reduces rendering work in the browser.</p>',
    'help.feature.columns':
        '<p>The Columns button in the toolbar picks which columns are visible, and the adjacent input sets the width (60–600 px; leave it empty for automatic).</p>'
        + '<p>Hiding a column only affects the display — exports and saves are unaffected.</p>',
    'help.feature.selection':
        '<p>Tick any row and a statistics bar appears below the table, showing the sum (Σ) and average (x̄) of every column that is <strong>entirely numeric</strong>.</p>'
        + '<p>Columns with non-numeric content are left out, so dates and IDs are never added up.</p>',
    'help.feature.rules':
        '<p><strong>Settings → Conditional formatting rules</strong> paints numeric columns by range. Choose the column, add a rule, then fill in the minimum, maximum and color.</p>'
        + '<p>Leaving the maximum empty means "this value and above". Every column with rules is painted at once, not just the selected one.</p>',
    'help.feature.validation':
        '<p><strong>Settings → Data validation rules</strong> covers required fields, data type (number and so on) and min / max per column, and can validate values against a column in <strong>another table</strong>.</p>'
        + '<p>Rows are checked one by one when you save; failing rows are reported with their row number and reason, and the whole batch is rejected.</p>',
    'help.feature.pivot':
        '<p>Pick a dimension column, a value column and an aggregation to get a grouped summary across rows — exportable, and no formulas needed for results like "by region" or "by month".</p>',
    'help.feature.export':
        '<p>The export menu offers four options: <strong>Export Excel</strong>, <strong>Export CSV</strong>, <strong>Export current view as CSV</strong> (only the searched and sorted result, honouring the current column visibility) and <strong>Download import template</strong>.</p>',
    'help.feature.undo':
        '<p>Cell edits are tracked — up to 50 steps.</p>'
        + '<p>Shortcuts: <kbd>Ctrl</kbd> + <kbd>Z</kbd> to undo, <kbd>Ctrl</kbd> + <kbd>Y</kbd> to redo. The status bar shows how many steps remain in each direction.</p>',
    'help.feature.trash':
        '<p><strong>Tables</strong> lists every table as a card, where you can open, rename, duplicate, export individually or delete.</p>'
        + '<p>Deleting does not erase data immediately: the table moves to the <a href="/trash.html">trash</a> for 30 days and can be restored at any time. Delete it there permanently and its data, audit history and validation rules go with it.</p>',

    // ===== 常见问题（整块 HTML） =====
    'help.faq.parse':
        '<p><code>.xlsx</code> and <code>.csv</code> are supported (renaming another format will not work), and the first row must be a header with at least one data row below it. CSVs must be UTF-8 or GBK — CSVs exported from Chinese Excel usually work as-is.</p>',
    'help.faq.invalid':
        '<p>Those rows break the <strong>data validation rules</strong>. The message names the row and the reason — fix it and save again. Nothing is written when validation fails, so you never end up with a half-applied save.</p>',
    'help.faq.persist':
        '<p>No. Data lives in the server database and is only written when you click Save. Edits that were never saved are lost when you close the page.</p>',
    'help.faq.searchsave':
        '<p>No. Saving always submits the complete dataset — searching only filters what is displayed. Deleting selected rows is different: only the ticked rows are removed.</p>',
    'help.faq.restore':
        '<p>Yes. A deleted table sits in the <a href="/trash.html">trash</a> for 30 days; click Restore there and it comes back exactly as it was, data, audit history and validation rules included. After 30 days the system removes it for good.</p>'
});
