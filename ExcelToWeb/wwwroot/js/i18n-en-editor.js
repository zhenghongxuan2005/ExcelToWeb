// ================================================================
// 英文文案字典 · 表格编辑页（index.html 及其 35 个前端模块）
// ----------------------------------------------------------------
// 与 i18n-en.js 的关系：基础字典管外壳 / 命令面板 / 页面标题，
// 这里只管编辑页正文、工具栏、弹窗、toast 与校验提示。
// 同一个中文可以重复出现在两个文件里（英文值必须一致），但**不同中文不许撞同一个英文**：
// 切回中文靠反向查表，撞车会把文案还原成另一条。
// ================================================================

I18n.register({
    // ===== 工具栏与页头 =====
    '数据表格': 'Data table',
    '上传 Excel': 'Upload Excel',
    '-- 请选择表格 --': '-- Select a table --',
    '删除表格': 'Delete table',
    '删除当前表格': 'Delete the current table',
    '筛选': 'Filter',
    '保存': 'Save',
    '导出': 'Export',
    '导出当前视图 CSV': 'Export current view as CSV',
    '下载导入模板': 'Download import template',
    '刷新': 'Refresh',
    '透视汇总': 'Pivot summary',
    '显示 / 关闭汇总行': 'Show / hide summary row',
    '清空当前数据': 'Clear current data',
    '批量编辑': 'Bulk edit',
    '删除选中': 'Delete selected',
    '列': 'Columns',
    '请点击"上传 Excel"开始': 'Click "Upload Excel" to get started',
    '支持 .xlsx / .csv 格式': 'Supports .xlsx / .csv',
    '搜索全表，含表头与单元格': 'Search the whole table…',
    '清除搜索': 'Clear search',
    '按行分组、列展开，对某一列做汇总': 'Group by rows, spread by columns, summarize one column',
    '按日期筛选': 'Filter by date',
    '每页行数': 'Rows per page',
    '0 行 · 0 列': '0 rows · 0 columns',
    '就绪': 'Ready',

    // ===== 演示模式 =====
    '演示模式：只能浏览、筛选与导出，编辑和导入需要注册账号。':
        'Demo mode: browse, filter and export only. Sign up to edit and import.',
    '关闭演示提示': 'Dismiss demo notice',

    // ===== 分页条 / 列菜单 =====
    '命中 {n} 行': '{n} rows matched',
    '无匹配': 'No matches',
    '第 {start}-{end} 行 / 共 {total} 行': 'Rows {start}-{end} of {total}',
    '首页': 'First',
    '上一页': 'Previous',
    '下一页': 'Next',
    '末页': 'Last',
    '请先加载数据': 'Load data first',
    '显示列': 'Show columns',
    '宽': 'Width',
    '列宽（px，留空为自动）': 'Column width (px, blank for auto)',
    '全部显示': 'Show all',
    '已选 {n} 行': '{n} rows selected',

    // ===== 汇总行 =====
    '关闭汇总': 'Turn off summary',
    '该列没有可汇总的数值': 'This column has no numbers to summarize',
    '已关闭汇总行': 'Summary row turned off',
    '汇总方式：{mode}': 'Summary: {mode}',
    '汇总行：{mode}': 'Summary row: {mode}',

    // ===== 撤销 / 重做 =====
    '没有可撤销的操作': 'Nothing to undo',
    '已撤销': 'Undone',
    '没有可重做的操作': 'Nothing to redo',
    '已重做': 'Redone',
    '列设置没能保存到服务器，刷新后可能丢失':
        'Column settings were not saved to the server and may be lost on reload',

    // ===== 计算列 =====
    '计算列 公式：{f}': 'Computed column\nFormula: {f}',
    '值由服务端算出，不能手动修改；改动源列后点「保存」会重新计算。':
        'Values are computed on the server and cannot be edited by hand. Save after changing source columns to recalculate.',
    '(未命名列)': '(Unnamed column)',
    '公式看起来没问题；保存列结构时会由服务端再校验一次。':
        'The formula looks fine; the server validates it again when you save the column structure.',
    '没有可引用的列': 'No columns available to reference',
    '留空表示取消这一列的计算列': 'Leave blank to drop this computed column',
    '公式不能超过 {n} 个字符': 'The formula cannot exceed {n} characters',
    '括号不匹配：多了一个 )': 'Unbalanced parentheses: one extra )',
    '括号不匹配：少了一个 )': 'Unbalanced parentheses: one missing )',
    '双引号没有成对': 'Unpaired double quote',
    '单引号没有成对': 'Unpaired single quote',
    '方括号没有成对': 'Unpaired square bracket',
    '不支持的函数：{bad}（可用：{ok}）': 'Unsupported function: {bad} (available: {ok})',
    '保存计算公式...': 'Saving formula…',
    '部分公式没保存成功：': 'Some formulas were not saved:',
    'editor.formulaSub': 'Column <strong id="formulaColumnLabel"></strong> is computed from a formula and can no longer be typed in. Reference columns with square brackets (e.g. <code>[Unit price] * [Quantity]</code>); the server calculates the result once you save the column structure.',
    'editor.pivotSub': 'Pick a <strong>row</strong> field to group by and a <strong>column</strong> field to spread the groups across, then choose the column to aggregate. Check the preview before exporting — the exported file also carries the source data sheet, so every cell can be traced back.<br>The pivot is computed from <strong>saved</strong> data, so save pending edits first.',

    // ===== 表格加载 / 切换 / 删除 =====
    '无表格，请上传 Excel': 'No table yet — upload an Excel file',
    '未知表格': 'Unknown table',
    '加载中...': 'Loading table…',
    '已加载: {name} ({n}行)': 'Loaded: {name} ({n} rows)',
    '已切换到: {name}': 'Switched to: {name}',
    '该表格没有数据': 'This table has no rows',
    '加载失败：{msg}': 'Could not load: {msg}',
    '加载失败': 'Load failed',
    '请选择表格': 'Select a table',
    '请先选择一个表格': 'Select a table first',
    '确定要删除当前表格吗？删除后进回收站，30 天内可恢复。':
        'Delete the current table? It goes to Trash and can be restored within 30 days.',
    '表格已删除': 'Table deleted',
    '已删除': 'Deleted',
    '删除失败：{msg}': 'Could not delete: {msg}',
    '请先上传一个 Excel 文件': 'Upload an Excel file first',
    '刷新中...': 'Refreshing…',
    '已刷新': 'Refreshed',
    '已刷新 ({n}行)': 'Refreshed ({n} rows)',
    '刷新失败：{msg}': 'Could not refresh: {msg}',
    '刷新失败': 'Refresh failed',

    // ===== 保存时的校验明细（服务端也会跑同一套规则） =====
    '{col} 不能为空': '{col} cannot be empty',
    '{col} 必须是数字': '{col} must be a number',
    '{col} 不能小于 {min}': '{col} cannot be less than {min}',
    '{col} 不能大于 {max}': '{col} cannot be greater than {max}',
    '第 {row} 行：{msg}': 'Row {row}: {msg}',
    '第 {row} 行：{col} 的值「{v}」与第 {other} 行重复':
        'Row {row}: the value "{v}" in {col} duplicates row {other}',
    '第 {row} 行：{col} 的值「{v}」不在引用表「{table}」的 {ref} 列中':
        'Row {row}: "{v}" in {col} is not in column {ref} of the referenced table "{table}"',
    '校验失败：': 'Validation failed:',

    // ===== 保存 / 导出 / 上传 =====
    '保存中...': 'Saving…',
    '保存成功': 'Saved successfully',
    '已保存': 'Saved',
    '保存失败：{msg}': 'Could not save: {msg}',
    '导出中...': 'Exporting…',
    '已导出': 'Exported',
    'Excel 导出成功': 'Excel file exported',
    '导出失败': 'Export failed',
    'CSV 导出成功': 'CSV exported',
    '导出失败：{msg}': 'Could not export: {msg}',
    '请先上传一个 Excel 文件或选择一个表格': 'Upload an Excel file or select a table first',
    '下载模板中...': 'Downloading template…',
    '已下载': 'Downloaded',
    '模板下载成功': 'Template downloaded',
    '下载失败：{msg}': 'Could not download: {msg}',
    '下载失败': 'Download failed',
    '没有可导出的数据': 'No data to export',
    '当前筛选结果为空，无可导出内容': 'The current filters return nothing to export',
    '已导出当前视图（{n} 行）': 'Current view exported ({n} rows)',
    '请上传 .xlsx 或 .csv 格式的文件': 'Upload a .xlsx or .csv file',
    '上传中...': 'Uploading…',
    '成功导入 {n} 条数据': 'Imported {n} rows',
    '已记录 {n} 个合并区域，导出时会按原样还原':
        'Recorded {n} merged ranges — they are restored as-is on export',
    '上传失败：{msg}': 'Upload failed: {msg}',
    '上传失败': 'Upload failed',
    '一次只能上传一个文件，已取第一个': 'Only one file at a time — using the first one',
    '正在读取工作表...': 'Reading worksheets…',
    '文件里没有工作表': 'The file contains no worksheet',
    '读取工作表失败：{msg}': 'Could not read the worksheet: {msg}',
    '{rows} 行数据 · {cols} 列': '{rows} data rows · {cols} columns',
    '没有数据行，无法导入': 'No data rows to import',

    // ===== 表格正文与空态 =====
    '{name} · 最后保存 {time}': '{name} · Last saved {time}',
    '尚未选择表格 · 上传 Excel 或从上方下拉框选择':
        'No table selected · Upload an Excel file or pick one above',
    '{rows} 行 · {cols} 列': '{rows} rows · {cols} columns',
    '暂无数据，请上传 Excel 文件': 'No data yet — upload an Excel file',
    '没有匹配「{q}」的数据': 'Nothing matches "{q}"',
    '当前筛选条件下没有数据': 'No rows match the current filters',
    '换个关键词，或点搜索框右侧的 ✕ 清除': 'Try another keyword, or click ✕ in the search box',
    '点下方统计栏里的筛选标签 ✕ 可清除筛选':
        'Clear a filter by clicking ✕ on its chip in the status bar below',
    '序号': 'No.',
    '点击排序：升序 → 降序 → 取消；按住 Shift 点击可追加为次级排序键':
        'Click to sort: ascending → descending → off; Shift+click adds a secondary key',
    '计算列': 'Computed',
    '筛选该列': 'Filter this column',
    '本行变更历史': 'Change history for this row',
    '添加一行': 'Add a row',

    // ===== 底部统计栏 =====
    '筛选出 {n} 行': '{n} rows after filtering',
    '全量 {n} 行': 'All {n} rows',
    '共 {n} 行 · {c} 列': '{n} rows · {c} columns in total',
    '筛选：{v}': 'Filter: {v}',
    '清除筛选': 'Clear filter',
    '排序：{v}': 'Sort: {v}',
    '清除排序': 'Clear sort',
    '{c} 列': 'Columns: {c}',
    '拖拽 / Shift+方向键选区 · 表头点击排序（Shift+点击多列）· Ctrl+C·V 与 Excel 互通 · 编辑后点击"保存"':
        'Drag or Shift+arrow to select · click a header to sort (Shift+click for more) · Ctrl+C/V interoperates with Excel · click "Save" when done',

    // ===== 选区 / 复制粘贴 / 填充柄 =====
    '已选 {r} 行 × {c} 列': '{r} rows × {c} columns selected',
    'Ctrl+C 复制（TSV）· Ctrl+V 粘贴 · Delete 清空 · Shift+方向键 扩展 · Esc 取消':
        'Ctrl+C copies (TSV) · Ctrl+V pastes · Delete clears · Shift+arrows extend · Esc cancels',
    '复制选区': 'Copy selection',
    '清空内容': 'Clear contents',
    '请先选择单元格区域': 'Select a range of cells first',
    '已复制选区，可直接粘贴到 Excel': 'Selection copied — paste it straight into Excel',
    '已复制选区': 'Selection copied',
    '复制失败，请改用 Ctrl+C': 'Copy failed — use Ctrl+C instead',
    '当前环境不支持直接复制，请按 Ctrl+C': 'Copying here is unavailable — press Ctrl+C',
    '已粘贴 {rows} 行 × {cols} 列，共 {cells} 个单元格':
        'Pasted {rows} rows × {cols} columns ({cells} cells)',
    '；右侧 {n} 列超出表格宽度，已忽略': '; {n} columns on the right exceeded the table width and were skipped',
    '已粘贴 {n} 个单元格': 'Pasted {n} cells',
    '已清空 {n} 个单元格': 'Cleared {n} cells',
    '已清空选区': 'Selection cleared',
    '拖拽填充：复制单元格，或按等差数列延续序列':
        'Drag to fill: copy the cell, or extend the series',
    '拖拽填充中…松开鼠标完成': 'Filling… release the mouse to finish',
    '已填充 {n} 个单元格': 'Filled {n} cells',

    // ===== 查找替换 =====
    '输入要查找的内容': 'Enter text to find',
    '未找到匹配项': 'No matches found',
    '共 {n} 处，当前第 {i} 处': '{n} matches · showing {i}',
    '找到 {n} 处': 'Found {n} matches',
    '请输入要查找的内容': 'Enter the text to search for',
    '该匹配项被当前筛选条件隐藏了': 'The current filters hide this match',
    '已定位到第一处，再点一次「替换」即可替换':
        'Jumped to the first match — click "Replace" again to replace it',
    '请先点「查找下一个」定位到要替换的单元格':
        'Click "Find next" to locate the cell you want to replace',
    '「{col}」是计算列，值由公式算出，不能直接替换':
        '"{col}" is a computed column — its values come from a formula and cannot be replaced',
    '已替换 1 处': 'Replaced 1 match',
    '将替换 {n} 处，确定继续吗？': 'Replace {n} matches?',
    '已替换 {n} 处': 'Replaced {n} matches',

    // ===== 增删行 / 批量编辑 =====
    '已新增一行，请填写数据后点击保存': 'Row added — fill it in and click Save',
    '已新增一行': 'Row added',
    '请先勾选要删除的行': 'Select the rows to delete first',
    '确定要删除选中的 {n} 行吗？': 'Delete the {n} selected rows?',
    '已删除 {n} 行': 'Deleted {n} rows',
    '没有数据可清空': 'There is no data to clear',
    '确定要清空当前表格数据吗？（保存后生效）':
        'Clear all rows in this table? (Applied once you save)',
    '已清空': 'Cleared',
    '请先勾选要修改的行': 'Select the rows to change first',
    '请输入新值': 'Enter a new value',
    '没有选中任何行': 'No rows selected',
    '「{col}」是计算列，值由公式算出，不能批量修改':
        '"{col}" is a computed column — its values come from a formula and cannot be bulk edited',
    '已成功修改 {n} 行的 "{col}" 列': 'Updated column "{col}" in {n} rows',
    '请先勾选一行，或点一下作为插入位置的单元格':
        'Select a row, or click the cell to insert above',
    '已在第 {at} 行上方插入 {n} 行': 'Inserted {n} rows above row {at}',
    '已插入 {n} 行': 'Inserted {n} rows',
    '请先勾选要移动的行': 'Select the rows to move first',
    '已经是第一行，无法上移': 'This is already the first row',
    '已经是最后一行，无法下移': 'This is already the last row',
    '已上移 {n} 行': 'Moved {n} rows up',
    '已下移 {n} 行': 'Moved {n} rows down',
    '上移 {n} 行': 'Move {n} rows up',
    '下移 {n} 行': 'Move {n} rows down',
    '已取消排序': 'Sort cleared',

    // ===== 筛选（按值 / 按条件 / 按日期） =====
    '{col}：未勾选任何值': '{col}: no values selected',
    '{col} ∈ {n} 个值': '{col} in {n} values',
    '请选择日期': 'Pick a date',
    '没有找到可用于日期筛选的列': 'No column can be used for date filtering',
    '已按「{col}」筛选 {date}：{shown} 行（共 {total} 行）':
        'Filtered "{col}" to {date}: {shown} of {total} rows',
    '已筛选 {date}（{n} 行）': 'Filtered to {date} ({n} rows)',
    '已清除筛选': 'Filter cleared',
    '（空白）': '(blank)',
    '值过多，仅列出前 {limit} 个（共 {total} 个），请用上方搜索框缩小范围':
        'Too many values — showing the first {limit} of {total}. Narrow it down with the search box above.',
    '该列没有可筛选的值': 'This column has no values to filter',
    '已选 {checked} / {total}': '{checked} of {total} selected',
    '按值筛选': 'Filter by value',
    '按条件筛选': 'Filter by condition',
    '请先选择要筛选的列': 'Select a column to filter first',
    '没有勾选任何值，筛选结果将为空': 'No values selected — the result will be empty',
    '请输入筛选关键词': 'Enter a filter keyword',
    '筛选完成：显示 {shown} 行（共 {total} 行）':
        'Filter applied: showing {shown} of {total} rows',
    '已筛选（{n} 行）': 'Filtered ({n} rows)',

    // ===== 条件格式规则 =====
    '加载规则失败：{msg}': 'Could not load rules: {msg}',
    '当前表格没有可用的列': 'This table has no usable columns',
    '加载规则中...': 'Loading rules…',
    '暂无规则，点击下方"添加规则"开始设置': 'No rules yet — click "Add rule" below to start',
    '优先级': 'Priority',
    '最小值': 'Min',
    '最大值': 'Max',
    '颜色': 'Color',
    '上移/下移': 'Order',
    '以上': 'and above',
    '上移': 'Move up',
    '下移': 'Move down',
    '删除规则': 'Delete rule',
    '区间不合法：{min} ~ {max}（最大值不能小于最小值）':
        'Invalid range: {min} ~ {max} — the maximum cannot be less than the minimum',

    // ===== 数据校验规则 =====
    '加载校验规则失败：{msg}': 'Could not load validation rules: {msg}',
    '列名': 'Column',
    '必填': 'Required',
    '唯一': 'Unique',
    '类型': 'Type',
    '限制': 'Limits',
    '引用来源': 'Lookup',
    '该列取值在整张表内不允许重复': 'Values in this column must be unique across the table',
    '文本': 'Text',
    '数字': 'Number',
    '日期': 'Date',
    '邮箱': 'Email',
    '允许值(逗号分隔)': 'Allowed values (comma separated)',
    '不引用': 'No lookup',
    '选择列': 'Choose a column',
    '新列_{n}': 'New column {n}',
    '列「{col}」选择了引用表，但还没选引用列':
        'Column "{col}" has a lookup table but no lookup column yet',

    // ===== 带校验的上传 =====
    '请先选择文件': 'Choose a file first',
    '请选择文件': 'Choose a file',
    '校验并上传中...': 'Validating and uploading…',
    '校验完成：总行数 {total}，成功 {ok} 行，错误 {bad} 行':
        'Validation done: {total} rows · {ok} valid · {bad} with errors',
    '错误详情：': 'Error details:',

    // ===== 列管理 =====
    '当前表格没有列': 'This table has no columns',
    '暂无列，点击下方「添加列」开始': 'No columns yet — click "Add column" below',
    '新': 'New',
    '设置计算列公式': 'Set the computed column formula',
    '删除列': 'Delete column',
    '删除列「{col}」将同时删除该列的所有数据和相关规则，确定吗？':
        'Deleting column "{col}" also removes its data and related rules. Continue?',
    '至少保留一列': 'Keep at least one column',
    '列名不能为空': 'The column name cannot be empty',
    '列名「{name}」超过 100 字符': 'Column name "{name}" is longer than 100 characters',
    '列名「{name}」重复': 'Column name "{name}" is already taken',
    '列结构没有变化': 'The column structure is unchanged',
    '新增 {n} 列': 'Add {n} columns',
    '删除 {n} 列（数据与规则一并清除）': 'Delete {n} columns (data and rules go with them)',
    '重命名 {n} 列': 'Rename {n} columns',
    '更新计算列公式': 'Update a computed column formula',
    '确认执行：{ops}？': 'Apply: {ops}?',
    '更新列结构中...': 'Updating the column structure…',
    '列结构已更新': 'Column structure updated',
    '更新失败：{msg}': 'Could not update: {msg}',

    // ===== 变更历史弹窗 =====
    '第 {n} 行的变更历史': 'Change history · row {n}',
    '只看第 {n} 行': 'Row {n} only',
    '还没有变更记录——保存一次数据后这里会出现时间线':
        'No changes yet — a timeline appears once you save data',
    '第 {n} 行 · {col}：': 'Row {n} · {col}:',
    '旧值': 'Before',
    '空': 'Empty',
    '新值': 'After',
    '新增了第 {n} 行': 'Added row {n}',
    '删除了第 {n} 行': 'Deleted row {n}',
    '批量变更（{v}）': 'Bulk change ({v})',

    // ===== 透视汇总 =====
    '请先上传并打开一个表格': 'Upload and open a table first',
    '选好行 / 列 / 值字段后点「生成预览」。':
        'Pick the row, column and value fields, then click "Generate preview".',
    '不分组': 'No grouping',
    '请先选择要汇总的列': 'Select the column to summarize first',
    '行字段与列字段不能是同一列': 'The row and column fields cannot be the same column',
    '汇总中...': 'Summarizing…',
    '正在汇总…': 'Building the summary…',
    '透视汇总完成': 'Pivot summary ready',
    '汇总失败': 'Summary failed',
    '这张表还没有数据': 'This table has no data yet',
    '所选的行 / 列字段里没有可分组的内容（空单元格不参与分组）':
        'The chosen row/column fields have nothing to group by (blank cells are skipped)',
    '合计': 'Total',
    '{n} 组': '{n} groups',
    '{n} 列': '{n} columns',
    '共 {n} 行原始数据 · {value} · {dims}': '{n} source rows · {value} · {dims}',
    '没有数据': 'No data',
    '还没有预览结果': 'Nothing previewed yet',
    '请先生成预览，确认数字没问题再导出':
        'Generate a preview and check the numbers before exporting',
    '导出成功（含原始数据表与「透视」表）':
        'Exported — includes the source data sheet and a "Pivot" sheet',

    // 列管理弹窗里 fx 标记的悬停气泡（公式原文是用户数据，只有前缀要翻）
    '公式：{expr}': 'Formula: {expr}'
});
