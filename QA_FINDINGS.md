# 深度使用测试记录（2026-10-31）

以管理员账号（`Ben`，Admin，五项权限全开）从登录开始，按真实用户的动线把编辑、管理、
看板、审计、回收站、设置、帮助都走了一遍：点击、排序、搜索、改单元格、保存、导出、
复制/删除、切深浅色、看接口边界。下面是发现的问题，按严重度排列。

**进度**：19 条中已修 17 条（1–10、12–19）。第 11 条评估后决定不改（理由见条目内），没有遗留待办。
提交分布：1、2 在 `8f4797e`，3–10、12、17 在 `65e8aec`，15、16、18 在 `1e7077a`，13、14、19 在本轮。

标记：🔴 数据安全 / 🟠 交互缺陷 / 🟡 一致性·健壮性 / ⚪ 体验细节

---

## 🔴 数据安全

### 1. 保存接口不校验列名，可以写入「幽灵列」 ✅ 已修复

`POST /api/excel/save` 传 `{"tableId":<副本>,"rows":[{"不存在的列":"x"}]}` → **200「成功保存 2 条数据」**，
数据原样入库，但 `headers` 不含该列，于是这列数据永远显示不出来。

- 复现：接口直接调，或前端任何一处拼错 key 的写入路径。
- 现状：`SaveRequest.Rows` 是 `List<Dictionary<string, object>>`，服务端按字典原样落 DataJson，
  与 `headers` 不做交叉校验。
- 建议：保存前对每行的 key 做白名单过滤（只保留当前 headers），或直接 400 拒绝未知列。
- **修复**：新增 `Services/Excel/RowPayloadGuard.cs`，按「headers + 计算列」白名单校验，
  未知列返回 400 并点名到列与行（`第 2 行有表格里不存在的列「幽灵」`），数据一行不动。
  选择拒绝而不是静默过滤：过滤等于「客户端以为存了、库里没有」，和幽灵数据是同一个后果，
  区别只是连报错都没有。

### 2. 空数据保存会静默清空整表，并返回「成功」 ✅ 已修复

`POST /api/excel/save` 带 `{"rows":[]}`（或整个 `rows` 字段缺失）→ **200「成功保存 0 条数据」，表被清空**。

- 前端 `saveData()`（`js/io.js:6-19`）只检查 `currentTableId`，**不检查 `currentRows` 是否为空**。
  一旦取数失败 / 渲染异常导致 `currentRows` 为空，用户点「保存」就是静默删库。
- 建议：后端拒绝空数组（除非显式带 `allowEmpty:true`）；前端在 `currentRows.length===0` 时二次确认。
- **修复**：后端默认拒绝空行集，`SaveRequest.AllowEmpty` 为 true 才放行（「清空全部」是合法诉求）；
  前端 `saveData()` 在 `currentRows` 为空时先弹确认，确认后才带 `allowEmpty`。
  顺带把 `rows:[null]` 也挡了（原先会一路传到 `ReplaceRowsAsync` 才炸）。

---

## 🟠 交互缺陷

### 3. 保存后排序和筛选被重置 ✅ 已修复

`saveData()` 成功后调 `refreshData()`，而 `refreshData()` 里有 `resetFilter()` 和 `resetSort()`。
用户按「销售员」排好序、改了一个格、保存 —— 顺序回到原始状态，没有任何提示。Excel 不会这样。

> 实测：排序「销售员 ▲」→ 改第 1 行 → 保存 → 表头箭头消失、顺序复原。

- **修复**：`refreshData(opts)` 新增 `keepView` / `silent` 两个开关。保存后的回读走
  `refreshData({ keepView: true, silent: true })` —— 这是同一份数据的回读，排序与筛选是与数据
  无关的视图状态，清掉等于无故丢失用户刚才的操作顺序；手动点「刷新」仍走默认清理（那代表
  「重新拉一份干净数据」）。用例 `tests/frontend/refresh_view_test.js` 锁住两种路径。
- 回读失败时也不再报「刷新失败」（数据其实已存进去），改为「数据已保存，但重新加载失败：
  {msg}。请手动点刷新」。

### 4. 「保存成功」的提示被「已刷新」盖掉 ✅ 已修复

保存成功先弹 `✅ 成功保存 6 条数据`，紧接着 `refreshData()` 弹 `✅ 已刷新`。两个 toast 连发，
后一个覆盖前一个，用户看到的是「已刷新」，不知道数据到底存没存上。

- **修复**：同上，`silent: true` 让回读不再弹提示、也不改状态栏（状态栏保留「已保存」）。

### 5. 「筛选」按钮其实是「按日期筛选」，点了像没反应 ✅ 已修复

`index.html` 的「筛选」按钮 `onclick="applyDateFilter()"`，只认它左边那个日期输入框。
日期为空时仅弹一条 3 秒的 `请选择日期`，截图时早已消失 —— 第一反应就是「按钮坏了」。
同时表头每列还有漏斗图标叫「筛选该列」，两个「筛选」语义打架。

- **修复**：按钮文案改「按日期筛选」，日期框为空时按钮 `disabled`（由 `syncDateFilterButton()`
  在输入、清空、`resetFilter` 三处同步），悬停提示「按左侧日期筛选当前表格」。

### 6. 表头出现两个「序号」 ✅ 已修复

行号列的表头写死 `tt('序号')`（`js/render.js:139`），当数据本身有一列叫「序号」（现有测试表就是），
表头变成「序号 | 序号」。左侧是行号（不可排序），右侧是数据列（可排序），用户无法区分。

- **修复**：行号列表头改为 `#`（`title="行号"`），数据列「序号」保持原文，两者一眼可分。

### 7. 回收站为空时，说明文字下方有一条空白白条 ✅ 已修复

`trash.html` 的 `<div class="stats-bar" id="trashCount">` 在没有内容时仍然渲染背景与边框，
在「删除的表格在这里保留 30 天…」下面形成一条空白横条。

- **修复**：空列表时给 `trashCount` 加 `hidden`；因为 `.stats-bar` 是 `display:flex`
  会盖掉 `[hidden]` 的 UA 规则，`stats.css` 补 `.stats-bar[hidden] { display: none; }`。

### 8. Windows 集成账号仍显示可用的「修改密码」表单 ✅ 已修复

设置页账号卡片明确写着「使用 Windows 集成身份验证自动创建的账号没有本地密码，无法在此修改」，
但紧接其下的「修改密码」卡片里三个输入框和「保存新密码」按钮都是可用的 —— 填了也改不了。

- **修复**：`paintAccountType()` 按 `hasPassword` 锁死表单（三个输入 + 提交按钮 `disabled`，
  `form.dataset.passwordLocked` 记录状态），并在表单上方显示说明；`initPasswordForm` 的 submit
  再挡一道（回车 / 程序触发也发不出注定失败的请求）。已用 Ben 的 Windows 账号实测：
  `data-password-locked="1"`、三个 input 与按钮均 `disabled`。

---

## 🟡 一致性 / 健壮性

### 9. 同一类错误用了三种状态码 ✅ 已修复

| 场景 | 修复前 | 修复后 |
|---|---|---|
| `GET /api/excel/query` 缺 `tableId` | 404「表格不存在」 | **400**「缺少 tableId 参数」 |
| `GET /api/excel/query?tableId=abc` | 400（无 message） | **400**「参数 tableId 缺失或格式不正确」 |
| `GET /api/excel/export?tableId=999999` | 400「表格不存在」 | **404**「表格不存在」 |
| `POST /api/excel/save` 不存在的表 | 400「表格不存在」 | **404**「表格不存在」 |
| `PUT /api/excel/tables/999999/auto-export` | 400「表格不存在」 | **404**「表格不存在」 |

- **修复**：`ApiResponse` 新增 `ApiErrorKind`（Invalid / NotFound / Forbidden）与
  `ApiResponse.NotFound()`；控制器统一用 `Failure(result)` 映射 400 / 403 / 404；
  `Filters/RequireTableIdFilter.cs` 全局拦「缺 tableId（含 `0` 与未传）」→ 400，
  不再退化成「表格不存在」；`InvalidModelStateResponseFactory` 把框架默认的
  ValidationProblemDetails 换成项目自己的 ApiResponse，并点名出错参数（前端才有话可显示）。
  用例 `tests/backend/status_code_test.py` 40 项锁住全部场景。

### 10. `query` 的 `date` 参数是死参数，但仍在生效 ✅ 已修复

`GET /api/excel/query?tableId=1760&date=2026-10-15` 返回 **0 行**（该表共 6 行）。
前端已改成纯视图筛选不再传 `date`，后端这条过滤路径成了没人用、行为又可疑的遗留分支。

- **修复**：删除 `Query` 的 `date` 参数、`GetTableDataAsync` 的过滤分支与
  `Services/Excel/RowDateFilter.cs`。传 `date` 现在被当作多余参数忽略，返回整表。
  为什么不保留「能用」的版本：它按日期过滤后把结果当成整表下发，前端再整表保存
  就会把其余日期的行删掉 —— 是数据损失级的历史包袱，不是「顺手能修好」的小功能。

### 11. `column-meta` 无元数据时返回空对象 `{}` —— 评估后不改

`GET /api/excel/column-meta?tableId=1760` → `{}`，前端只能整体兜底空值。
原建议是返回 `{tableId, columns:[], widths:{}, hidden:[]}` 这类固定形状。

- **结论**：不改。这是「纯视图偏好」，前端已按「空对象 = 全部默认」处理（列宽/隐藏都是空时的
  自然语义），改成固定形状要动接口契约与前端解包，收益是「看起来更整齐」，
  换不来功能或可维护性上的收益。若以后要加 `tableId` 回显等字段，再一次性设计。

### 12. `audit-logs` 缺 `tableId` 返回 200 + 空列表 ✅ 已修复

`GET /api/excel/audit-logs`（不传 tableId）→ `200 list[0]`。缺少必填参数当成「没有记录」返回，
用户会以为真的没有操作历史。

- **修复**：由 #9 的全局 filter 覆盖，现在返回 400「缺少 tableId 参数」
  （`query` / `export` / `export-csv` / `template` / `column-meta` / `audit-logs` /
  `validation-rules` 七个 GET 端点一致）。

### 13. 开发库里 94 个用户账号 ✅ 已清理

`GET /api/users` 返回 94 条。成员管理页要翻十几页，全是历次测试注册的账号
（正式部署前建议清一次，只留真实账号）。

- 实测清理前已是 **155** 个账号（QA 之后又跑了几轮回归）。真正的账号只有两个：
  `zhx`（Id=1，名下 109 张表）与 `LAPTOP-1H09FLSL\Ben`（Id=5，2 张表，Windows 集成登录），
  其余 153 个是 `smoke* / rbac* / perf* / guard* / jobadm* / stcode* / ridrestore*` 这类脚本账号。
  **`demo` 不能当测试账号删**：它是产品内置演示账号，重启服务时由 `DemoSeeder` 重建。
- 另外发现 **444 张孤儿表**：`UserId` 指向已不存在的账号，表格管理页按用户过滤所以永远看不见、
  也删不掉，只能占库（都是空表，0 行）。
- 清理前备份：`App_Data/backup/ExcelToWebDB-before-account-cleanup.bak`。
  一次事务里删掉 153 个账号 + 862 张表（含回收站 301 张）+ 47,616 行 + 12 条校验规则
  + 4 条导出快照记录；跨表引用规则（`ValidationRules.RefTableId`）指向被删表的置 NULL。
- 清理后：**3 个账号**（zhx / Ben / demo）、113 张活表、86 行，回收站与孤儿表均为 0。
- 经验：**清完再跑回归等于白清**（每个后端用例都会注册自己的账号），要清就在最后一轮回归之后跑。
  脚本要按「用户名白名单」而不是硬编码 id 保留账号，否则重启重建的 `demo` 换了 id 就保不住。

### 14. 保存是「整表替换 + 再取一次全表」 ✅ 已修复

`ReplaceRowsAsync` 走 `ExecuteDelete + BulkInsert`（正确，避免了 2N 条 SQL），但前端保存成功后
又 `GET /api/excel/query` 拉一遍整表。大表（10 万行）时保存 = 两次全表往返。

- **修复**：`POST /api/excel/save` 改成返回 `SaveTableDataDto`（`saved` / `rows` / `updatedAt`），
  `rows` 就是**保存后的行**，带着新的行主键与重算过的计算列。前端 `applySavedRows()`
  直接替换 `currentRows`，省掉保存后那次整表 GET。
- 回传缺 `rows`（老服务端，或服务端发现库内行数对不上）时退回
  `refreshData({ keepView: true, silent: true })`，行为与以前完全一致 —— 这是兜底，不是主路径。
- 代价是保存后多一条 `SELECT Id FROM DynamicRows WHERE TableId=… ORDER BY Id`（只查一列）：
  比整表 DataJson 回读便宜得多，也让下一次保存有可用的行主键。
- 用例 `tests/frontend/save_roundtrip_test.js`（17 项，含「缺 rows 时兜底」「清空整表也是有效回传」）。

---

## ⚪ 体验细节

### 15. 窄屏（≤604px）适配 ✅ 已修复

- 顶部导航出现横向滚动条（宽屏 1440 下正常）。
- 表格管理卡片 6 个按钮被迫换行成 4+2，第二行只有 CSV 与「删除」，左侧对齐留出大片空白。
- **修复**：导航在 `768px` 以下改为换行（7 个入口约 640px 宽，660~768 这种「差一点」的宽度上
  最难看：滚动条横在页头上面，最右边的「设置」还露半截）；768~960 仍保留横向滚动，
  但用 `scrollbar-width: none` + `::-webkit-scrollbar { height: 0 }` 不画那条 15px 高的滚动条。
  卡片操作按钮在 `640px` 以下改成 3 列等分网格，永远是 3+3、每格等宽，不会再出现 4+2 的尾巴。
- 实测 504 / 660 / 1440 三种宽度：504 导航两行（5+2）+ 按钮 3+3，660 导航两行（6+1）+ 按钮一行 6 个，
  1440 与改动前一致。CSS 无自动化覆盖，这三张是把静态快照喂给 Edge 无头浏览器目视核对的。

### 16. 编辑器右上两个胶囊信息重复 ✅ 已修复

`已加载: 测试数据 - Sheet1 (6行)` 与紧邻的 `6 行 · 8 列` 表达同一件事，
建议只留后者并把表名放回页头。

- **修复**：状态栏只报告「动作完成」（`已加载` / `已保存` / `已删除 N 行`），不再拼表名与行数；
  表名归页头副标题（`表名 · 最后保存 时间`），行列数归 `meta-pill`，三处各说一件事。
  四个写状态栏的入口（`app.js` 语言切换重渲染、`tables.js` 切换表格、`dnd.js` 拖拽导入、
  `upload-validated.js` 校验后导入）一起改掉 —— 顺带修了 `upload-validated.js` 里
  把 `currentTableId`（一个数字 id）当表名显示的老问题。
  用例 `tests/frontend/status_label_test.js` 14 项锁住文案与四个入口。

### 17. 没有 `Ctrl+S` 保存 ✅ 已修复

帮助页承诺了 `Ctrl+F` 聚焦搜索（已实现，且 `preventDefault` 拦掉了浏览器查找），
但 Excel 用户的本能 `Ctrl+S` 会触发浏览器「另存为」。

- **修复**：`keyboard.js` 新增文档级监听，`Ctrl/Cmd+S` → `saveData()` 并 `preventDefault`；
  弹窗打开时不抢键（那里可能有自己的提交语义）。帮助页「全局快捷键」补了这一行。

### 18. 看板「总记录数」卡片的副标题不搭 ✅ 已修复

`6 行` 下面写 `2 张表 · 6 个销售员` —— 记录数卡片里混进了「表数量」，含义不清。

- **修复**：副标题改成只说分组（`6 个销售员`）。那个「2 张表」其实是 `tablesCache.length`，
  即**库里所有表的数量**，和当前看板看的这一张表、和这 6 条记录都没有关系 ——
  它会让人以为「6 行是从 2 张表汇总来的」。`buildViewModel` 里相应删掉 `tableCount` 字段。
  用例 `tests/frontend/dashboard_stat_test.js` 11 项（中英文各一遍，并断言视图模型就算带了
  `tableCount` 卡片也不消费它）。

### 19. 给已有列设公式后再保存，该列的原数据会被抹掉 ✅ 已修复

复现：`数量` 列原本是 `1 / 2 / 3` → 给它设公式（读出来变成 `2`）→ 点保存 →
取消公式 → `数量` 三个格子全空了。

原因：保存是整表替换，客户端回传的行里带着算出来的值，`ComputedColumnService.Strip`
把计算列的键整个删掉后再写库，于是「该列在库里的原值」也跟着没了。
`Strip` 本身是对的（算出来的值绝不能落库），问题在于整表替换没有「保留原值」的位置。

- **修复**：读取时每行下发**行主键**（`RowPayloadGuard.RowIdKey = "__rid"`，库里是 `DynamicRow.Id`），
  保存时 `ComputedColumnService.RestoreComputedOriginals` 按主键把计算列的历史原值补回原行。
  顺序不能反：Validate → **Strip**（抹掉算出来的值）→ **Restore**（补回库里的原值）
  → RemoveRowId（主键是传输元信息，不落库）。
- 为什么不下发下标：前端可以增删行，下标一错位就会把 A 行的值写到 B 行，属于静默错位。
  新增行没有主键 → 该列为空（它本来也没有历史值），不会继承别人的。
- 整表替换会重新分配 identity，所以保存响应里把**新主键**发回前端（见第 14 条），
  前端替换数据时一并换掉并 `resetHistory()` —— 旧快照里的主键已作废。
- `__rid` 不落库：`RowPayloadGuard.RemoveRowId` 在写库前移除，导出的 CSV 里也没有这一列。
- 顺手修了 `headers_dup_test.py` 三处断言（原先按 `row.values()` 比较，会把 `__rid` 一起排进去）。
- 用例：`tests/backend/computed_restore_test.py`（27 项：主路径 / 乱序 / 新增行 / 删行 / 主键不落库）；
  `save_guard_test.py` 的 [5] 改成正向断言 —— 它原先断言「清掉公式后不残留 2」，
  等于把这个 bug 写成了期望值。

---

## 已验证正常（供对照，不是问题）

- **鉴权**：匿名访问、伪造 token 均 401。
- **导出**：xlsx 有 `PK` 魔数（真实 xlsx）、CSV 带 UTF-8 BOM（Excel 打开中文不乱码）。
- **透视**：空字段 →「请选择要汇总的数值列」；非法聚合 →「不支持的汇总方式」。
- **重命名边界**：空 / 全空格 / 101 字符 均 400 且文案准确。
- **XSS**：表名改成 `<img src=x onerror=alert(1)>` 后端原样存，前端 `escapeHtml` 在卡片和下拉框
  都做了转义（`tables.js:16`、`tables-page.js`），没被执行。
- **权限**：改自己角色 → 400「不能修改自己的角色」；非法角色 → 400；不存在用户 → 404。
- **复制 / 删除 / 彻底清除**链路正常，清完回收站为空、无孤儿数据。
- **深色模式**：编辑器表格、看板 ECharts（坐标轴/网格/柱子/平均线）配色都正确，无黑字黑底。
- **定时任务**：启动即执行了一轮刷新令牌清理（删 18 条过期）与定时导出（1 张表成功）。

---

## 测试备注

- 测试用的副本表（`测试数据 - Sheet1 - 副本`）已删除并彻底清除；被改动的单元格
  （`陈诚` → `陈诚QA`）已还原为原值；表名在 XSS 测试后已改回。
- 内置浏览器实例在中途出现点击/截图超时（工具侧问题，与站点无关），后续页面改用
  1440×900 无头 Chrome + 注入登录态截图核对。
