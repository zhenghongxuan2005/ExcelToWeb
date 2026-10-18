// ================================================================
// 英文文案字典 · 数据看板页（dashboard.html）
// ----------------------------------------------------------------
// 看板有两种文案要分开看：
//   · 这里收录的是「界面文案」（卡片标题、图表类型、空状态…）
//   · 表名、列名、分组值来自 Excel 数据，属于**数据**，一律保持原样不翻
// 数字与日期格式由 dashboard-view.js 的 fmtNumber / utils.js 的 formatTime 按语言切换，
// 不在这里维护；这里只管文字。
// ================================================================

I18n.register({
    // ===== 页头与空态 =====
    '正在加载数据…': 'Loading data…',
    '返回表格编辑': 'Back to the editor',
    '请先在表格页面上传 Excel 数据': 'Upload your data on the editor page first',
    '上传后刷新此页面即可看到看板': 'Then reload this page to see the dashboard',

    // ===== 统计卡 =====
    '总记录数': 'Total records',
    '行': 'rows',
    '{tables} 张表 · {groups} 个{dim}': '{tables} tables · {groups} groups by {dim}',
    '{metric}合计': '{metric} total',
    '{n} 条记录 · 均值 {avg}': '{n} records · mean {avg}',
    '平均{metric}': 'Avg {metric}',
    '中位数 {median} · 最高 {max}': 'Median {median} · max {max}',
    '完成率': 'Completion',
    '{done} / {total} 条已完成': '{done} of {total} completed',
    '指标覆盖率': 'Metric coverage',
    '{filled} / {total} 条有值': '{filled} of {total} filled',

    // ===== 图表卡 =====
    '柱状图': 'Bar',
    '折线图': 'Line',
    '面积图': 'Area',
    '水平条形图': 'Horizontal bar',
    '环形图': 'Donut',
    '图表分析': 'Chart analysis',
    '图表类型': 'Chart type',
    '分组': 'Group by',
    '指标': 'Metric',
    '对数轴': 'Log axis',
    '数据集': 'Dataset',

    // ===== 分组汇总表 =====
    '分组汇总': 'Group summary',
    '记录数': 'Records',
    '{metric}平均': 'Average {metric}',
    '占合计比例': 'Share of total',
    '合计 · {n} 组': 'Total · {n} groups',
    '按「{dim}」分组 · 共 {n} 组': 'Grouped by "{dim}" · {n} groups',
    '合计': 'Total',

    // ===== 图表副标题与提示 =====
    '{metric} · 按「{dim}」汇总': '{metric} · summarized by "{dim}"',
    '— 平均 {avg}': '— avg {avg}',
    '共 {n} 组': 'Groups: {n}',
    '按「{dim}」分组汇总': 'Grouped summary by "{dim}"',
    '· 可横向滚动': '· scroll sideways',
    '最大 / 最小相差 {n} 倍，可切对数轴压缩差距':
        'Max and min differ by {n}× — switch to a log axis to compress the gap',
    '含 0 或负值，无法使用对数轴': 'Contains 0 or negative values, so a log axis is unavailable',
    '· 按「{dim}」分组': '· grouped by "{dim}"',
    '· {n} 条记录': '· {n} records',
    '数据截至 {time}': 'Data as of {time}',

    // ===== 错误与「识别不出维度/指标」 =====
    '暂无数据，请先上传 Excel 文件': 'No data yet — please upload an Excel file first',
    '加载数据失败：{msg}': 'Could not load the dashboard data: {msg}',
    '该表格没有数据': 'This table has no rows',
    '数据中未识别到分组维度或数值指标':
        'No grouping dimension or numeric metric was found in this data',
    '请确保 Excel 含文本列（如销售员）与数值列（如金额）':
        'Make sure the Excel file has a text column (such as salesperson) and a numeric column (such as amount)'
});
