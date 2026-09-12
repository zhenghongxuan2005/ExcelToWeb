# ExcelToWeb 代码约束方案

> 约束分三层：**编辑器级**（写代码时 IDE 就纠正）、**守门脚本级**（`tests/check_constraints.py`，提交前机器检查）、
> **评审级**（人工判断，无法自动化的部分）。改任何约束：先改本文档，再同步守门脚本。
> 运行 `python tests/check_constraints.py` 秒级自检；`tests/run.py` 已把它编排为第 0 项。

---

## 1. 架构分层（每类逻辑只允许住在一个地方）

| 层 | 位置 | 职责 | 禁止 |
|---|---|---|---|
| Controller | `Controllers/` | HTTP 壳：鉴权、取参、调服务、返回响应 | 写业务逻辑、直接摸 DbContext |
| 门面 | `Services/ExcelService.cs` | 对外契约编排、异常日志、友好提示 | 越过协作类直接写 SQL |
| 协作类 | `Services/Excel/` | 单一职责（解析/导出/校验/仓储/规则/列结构） | 互相感知内部实现 |
| DTO | `DTOs/` | 请求/响应契约 | 混入模型实体 |
| 前端状态 | `js/state.js` | 全局可变状态唯一声明处 | 其它文件新增全局 `let` 状态 |
| 前端模块 | `js/*.js` | 按 UI 职责拆分，函数级依赖显式调用 | `document.write`、直接改他模块内部变量 |

新增业务能力时**默认新建协作类**（参照 `ColumnStructureService`），而不是往 `ExcelService` 里堆——
门面一旦再破 400 行，说明有第二处该拆了。

## 2. 规模约束：单文件 ≤ 400 行

- 适用 `.cs / .js / .html / .css / .py`（bin/obj、第三方库除外）。
- 超限的**拆分方向**按优先级：抽独立协作类（C#）→ 抽独立 JS 模块并登记接线 → CSS 按 UI 区域拆文件
  （`style.css` 用 `@import` 汇总，层叠顺序即加载顺序）→ 测试按被测对象拆文件。
- 确需超限时进守门脚本 `LINE_EXEMPTS` 豁免清单，**每条必须写理由**，并定清零时间。

## 3. 数据安全红线（本仓库真实踩过坑的条目，违反即打回）

1. **多步写库必须包事务**：先删后插（`ReplaceRowsAsync`）、列结构批量改行（`UpdateHeadersAsync`）都是教训。
   失败必须回滚，不允许「半截结构」。
2. **越权校验前置**：凡按 `tableId` 操作，必须先 `FindTableAsync(tableId, userId)`；userId 来自 token，不收客户端传值。
3. **异常细节不出服务器**：catch 后只 `LogError`，对客户端返回固定友好文案（「稍后重试」类）；
   只有面向用户的校验提示（如「列名重复」）才原样返回。
4. **SQL 必须参数化**；原生 SQL 批量插入遵守 2100 参数上限，按 500 行分批（见 `BulkInsertRowsAsync`）。
5. **前端 `currentRows` 是唯一数据模型**：任何写操作先改模型再渲染；从 DOM 反读只允许发生在 `saveData` 兜底。
6. **换数据源必须 `resetHistory()`**：加载/切换/刷新/重新导入之后，撤销栈必须清空，否则 A 表快照会写进 B 表。
7. **`pushHistory()` 语义全站统一为「修改前压栈」**；在 input 事件已改模型的场景，用「暂存旧值 → try/finally」
   模式恢复后压栈（见 `render.js` blur 处理器）。
8. **集合推导 + 分步迁移要审交叉**：一个键同时落入两个集合（如 rename 源列 ∈ dropped）时必须显式剔除。
9. **视图裁剪绝不改写数据模型**：搜索 / 排序 / 筛选 / 分页 / 列隐藏一律只裁剪「显示」，
   必须经由 `view.js` 的管线（`getFilteredRows` → `buildDisplayRows` → `getPagedRows`）算出来，
   **不允许把 `currentRows` 换成裁剪结果**。历史实现里 `applyFilter()` 干过这件事，
   于是「筛选后点保存」永久删掉被筛掉的行 —— `saveData()` 保存的是整个 `currentRows`。
   裁剪状态（`searchKeyword` / `filter*` / `sortKeys` / `hiddenColumns`）切换数据源时必须重置
   （`resetHistory()` 已一并清列筛选）。
10. **看板类状态必须可见**：搜索、筛选、选区这类「隐形」状态要有常驻提示（统计栏文字 / 筛选标签 / 选区提示条），
    否则用户会以为数据丢了 —— 这类误判会直接变成「重新上传覆盖」的二次事故。
11. **单元格级批量写值（粘贴 / 填充）两条硬要求**：写前 `pushHistory()`；**只改值、不增删行时不要整表重绘**
    （顺手同步 DOM 输入框即可），否则持久化的排序会在重绘时把行重排、刚建立的选区随之跳位。
    反过来，一旦会增删行（粘贴补行），就必须 `resetSort()`。
12. **导出 / 格式化不得损坏原始值**：写进 xlsx 的每个值要么保持原始文本，要么是**可无损还原**的数值 / 日期。
    两类值必须保持文本：**前导零**（`007`、区号）与**整数部分超过 15 位**的数字（18 位身份证号写进 Excel 会变科学计数法）。
    判定「能不能安全数值化」的逻辑集中在 `ExcelExportService.TryParseNumber`，别处要用请复用而不是另写一套。

## 4. 前端接线（新模块 checklist）

新 JS 模块必须同时完成四件事，缺一即破：

1. `index.html` 登记 `<script src="js/xxx.js">`（`app.js` 之前）；
2. 需要被内联 `onclick` 调用的函数，登记进 `app.js` 的 `Object.assign(window, {...})` 暴露名单；
3. `Esc` 能关的弹窗登记进 `app.js` 的 keydown 关闭列表；
4. 跑 `wire_check.js` 确认「加载期求值 + 内联处理器全挂载」。

加载顺序铁律：`state.js` 最先、`app.js` 最后（守门脚本检查）。

## 5. 代码风格（`.editorconfig` 已固化，IDE 自动执行）

- 缩进：4 空格；`end_of_line = lf`；文件尾换行；去除行尾空白（`.md` 除外）。
- C#：file-scoped namespace、显式访问修饰符、多行必须大括号。
- 命名：服务接口 `I` 前缀；DTO 以 `Request / Result / Dto` 结尾；前端文件按职责命名（`column-manager.js` 而非 `utils2.js`）。
- 禁用：`eval` / `new Function` / `alert` / `document.write`（提示统一 `showToast`，删除等确认用 `confirm`；
  `prompt` 暂容忍，重命名对话框后续升级为弹窗后一并禁掉）。C# 禁 `Console.WriteLine`、禁空 catch。

## 6. 测试与提交节奏

- **每批功能一个 commit**，标题格式 `type(scope): 中文摘要`（feat / fix / refactor / test / style / chore）。
- 新增后端接口 → 必须带 `tests/backend/xxx_test.py` 冒烟（正常路径 + 越权 + 未登录 + 参数校验）。
- 新增前端模块 → 必须带 `tests/frontend/xxx_test.js`（vm 打桩，断言放在 Promise 微任务之后）。
- 修复缺陷 → 先写能复现的失败用例，再修，用例随修复一起提交（防回归，本项目已两次靠它抓住真 bug）。
- 提交前自检三连：`dotnet build` 0 错 0 警 → `python tests/check_constraints.py` 全绿 → `python tests/run.py` 全绿。
- 测试账号规则：用户名只允许字母数字（后端限制），注册需 `confirmPassword`。

## 7. 评审级约束（人查，脚本查不了）

- 新增交互有「不可恢复」后果（删表、删列、清空）→ 必须二次确认且后果写清楚。
- 新增状态变量先进 `state.js` 并注释用途与清空时机。
- 撤销语义：结构性修改（列管理）走服务端 + `refreshData`，不进撤销栈；数据修改才压栈。
- 提交信息说清「为什么」，不只说「改了什么」。
