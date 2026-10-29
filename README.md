# ExcelToWeb

[![CI](https://github.com/zhenghongxuan2005/ExcelToWeb/actions/workflows/ci.yml/badge.svg)](https://github.com/zhenghongxuan2005/ExcelToWeb/actions)

把 Excel 表格搬到浏览器里：上传 `.xlsx` / `.csv` 自动建表，在线编辑、规则校验、条件配色，再导出回 Excel —— 一套完整的「Excel → Web」轻量数据工具。

后端是 ASP.NET Core Web API + EF Core + SQL Server，前端是零构建的原生 HTML/CSS/JavaScript（唯一的外部运行时依赖是数据看板按需从 CDN 加载的 ECharts），静态文件由后端直接托管，一条命令即可跑起来。

- **想先看一眼**：`dotnet run --project ExcelToWeb` → 打开 <http://localhost:5185> → 点登录页的「演示账号」，不用注册就能体验只读样例表
- **想跑一遍测试**：`python tests/run.py`（起真实服务跑全量黑盒回归，详见 [测试](#测试)）
- **想部署**：见 [快速开始](#快速开始) 与 [Azure 部署（容器）](#azure-部署容器)

---

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [数据模型](#数据模型)
- [API 接口](#api-接口)
- [测试](#测试)
- [快速开始](#快速开始)
- [示例：5 分钟走一遍](#示例5-分钟走一遍)
- [配置说明](#配置说明)
- [使用流程](#使用流程)
- [常见问题](#常见问题)
- [已知限制与安全提醒](#已知限制与安全提醒)
- [许可](#许可)

---

## 功能特性

### 表格核心
- **Excel 导入**：读取工作表的表头与数据行，自动跳过空行，日期列自动从 Excel 序列号转换为 `yyyy-MM-dd`；多工作表文件会先弹出工作表选择（CSV 天然单表，跳过该步骤）
- **CSV 导入**：与 Excel 共用同一条导入链路。编码自动识别（UTF-8 BOM → 严格 UTF-8 → GBK，中文 Excel 导出的 CSV 直接可用），分隔符按首行自动检测（逗号 / 分号 / 制表符），支持双引号字段（含字段内逗号与 `""` 转义）
- **在线编辑**：单元格级编辑、新增/删除行，前端状态管理 + 统一保存
- **按日期筛选**：`query` 接口支持 `date` 参数，自动匹配「日期 / 成交日期 / 创建时间 / 更新时间 / Date」等同义列名前缀
- **批量写入**：导入时通过原生 SQL 多值 `INSERT` 批量落库（每批 500 行循环，规避 SQL Server 2100 参数上限），避免逐行往返

### 编辑与计算
- **计算列**：给某一列写受限表达式（如 `[单价] * [数量]`、`IF([数量] > 10, "大单", "小单")`），值不落库、每次读取实时计算，因此不会出现「算好的值和源数据对不上」。语法自研（分词 → 建树 → 白名单函数递归求值，**不接任何脚本引擎**），可用 `+ - * / &`、比较运算与 `CONCAT / ROUND / INT / YEAR / MONTH / IF`
- **透视汇总**：按行维度分组、列维度展开，对数值列做 `sum / count / avg / max / min`，预览与导出走服务端同一份计算（`PivotService`），导出侧只排版不二次加工
- **列管理**：新增、删除、重命名、移动列，改列结构时同步迁移数据与列元数据（`ColumnMetaJson` 按列名索引）；列宽、显隐、计算公式都存服务端，换浏览器也一致
- **区域操作**：单元格区域选择（拖选 / Shift 扩选）、区域复制粘贴、填充柄拖拽（复制单元格或按等差数列延续）、查找替换（范围是全表所有列，与 Excel 的「查找」一致，支持区分大小写）
- **撤销 / 重做**与「变更历史」时间线；`pushHistory()` 语义全站统一为「修改前压栈」，切换数据源会自动清空撤销栈
- **合并单元格**：导入时识别合并区域并铺平入库（`MergeCount` 告知用户会还原成几个区域），导出时按原区域还原
- **键盘优先**：Enter / Tab / 方向键 / Ctrl+Home、`Ctrl+K` 命令面板（跨页面跳转与命令检索）

### 导出
- **导出 Excel**（`.xlsx`，EPPlus 生成，自动列宽；数值与日期口径与页面展示同源，走 `ExcelNumber`）
- **导出 CSV**（UTF-8 带 BOM，Excel 打开不乱码）
- **导出当前视图 CSV**：只导出搜索结果 / 筛选 / 排序后看到的那部分
- **导出透视结果**（`.xlsx`）
- **下载导入模板**：复用当前表头，附示例行、灰斜体提示与红色填写说明，第 4 行起填数据

### 规则引擎
- **条件配色规则**（`ColorRule`）：按列名 + 数值区间（`MinValue` ~ `MaxValue`，上界为空表示「以上」）绑定颜色（如 `#dc2626`），数据看板据此渲染红黄绿
- **数据校验规则**（`ValidationRule`）：支持 `Required` 必填、`DataType`（`text` / `number` / `date` / `email`）、数值区间、`MaxLength` 长度上限、`AllowedValues` 枚举白名单
- **带校验导入**：逐行校验并返回成功/失败行数及「第 N 行：具体原因」的错误清单，只有通过校验的行才进入可导入集合

### 认证
- **JWT 登录**：用户名 + 密码（仅字母数字，3–20 位），密码经 **PBKDF2-SHA256（10 万次迭代）** 加盐哈希存储，兼容旧版 SHA256 格式
- **Windows 集成认证**：`GET /api/auth/windows` 走 NTLM/Kerberos 协商，浏览器免密登录，首次访问自动建档（密码哈希置空，不可走密码登录）
- **刷新令牌 + 会话吊销**：Access Token 短效（默认 2 小时），刷新令牌 7 天有效、落库可吊销；刷新时旧令牌立即轮换签发新对，检测到已吊销令牌被重用则整族吊销（reuse detection）。前端遇 401 先静默刷新再重放原请求；设置页「会话管理」可查看活跃会话并逐个注销
- **登录限流**：`/api/auth/*` 按来源 IP 固定窗口限流（默认 10 次 / 分钟，`RateLimit:AuthPermitLimit` 可调）
- **数据隔离**：所有表格查询、保存、删除、导出均校验 `UserId` 归属

### 数据看板
- **维度 / 指标自动识别**：根据列内容判断哪些列可分组（上限 50 组）、哪些列可聚合，识别不出就明确落到空状态而不是硬画一张空图
- **图表类型自适应**：柱状 / 折线 / 面积 / 水平条形 / 环形五种可切换；极值悬殊时（最大 / 最小正值 ≥ 20 倍）出现对数轴开关，含 0 或负值时出现但禁用并说明原因
- **分组多也不变形**：容器横向滚动 + 柱宽随槽位动态计算（每组可用宽度小于 68px 即撑宽画布出滚动条），轴标签按槽位反推截断长度
- **看板表格选择器**：可切换任意表格查看汇总，不再局限于第一张表

### 演示与可观测
- **演示模式**：登录页一键进入 `demo` 账号，预置有看点的样例表；只读拦截在服务端门面层强制执行（保存 / 删除 / 导入 / 回收站恢复与彻底删除均拒绝），不依赖前端置灰
- **结构化日志（Serilog）**：开发环境输出控制台，生产输出按天滚动的 JSON 文件（保留 14 天）；导入批插耗时、保存耗时、限流拒绝（含来源 IP）、乐观并发冲突等关键路径均有埋点，可直接被日志平台 / Application Insights 摄取
- **健康检查**：`/health`（存活）与 `/health/ready`（就绪，验证数据库连通）

### 后台任务与缓存
- **Hangfire 调度**（`Jobs/`）：任务状态存业务库（`HangFire.*` 表，Hangfire 自建，不走 EF 迁移），多副本部署时靠存储里的分布式锁保证同一条任务只跑一次；执行记录（起止时间、耗时、异常栈）可在 Dashboard 查
  - `recycle-bin-cleanup`（每天 03:00）：物理删除超过保留期的回收站表格 + 过期/已吊销的刷新令牌；应用启动时额外补跑一次
  - `daily-export`（每天 02:00）：为开启了「每日自动导出」的表格生成 xlsx 快照，产物落 `App_Data/exports/{userId}/`，保留 14 天，并自愈清理「库里已无记录」的孤儿文件
- **Hangfire Dashboard**：`/hangfire`，**默认只在开发环境挂载且仅允许本机访问**（前端用 JWT，浏览器直接访问带不上令牌，做不成登录后放行；暴露公网等于交出调度权）
- **分布式缓存**（`Caching/`）：业务只依赖 `IDistributedCache`，默认进程内内存实现，`Cache:Provider=redis` 切 Redis
  - 缓存**用户角色**（5 分钟兜底 TTL）：RBAC 每请求要读一次角色，改角色时主动失效——降级立即生效靠的是「写时删缓存」，不是短 TTL
  - 缓存**列元数据解析结果**（10 分钟兜底 TTL）：写路径集中在 `TableRepository.SaveColumnMetaAsync`（唯一失效点）+ 列结构变更处
  - 缓存读写失败一律降级为「未命中」，不让缓存故障影响主流程
  - **降级之外还有熔断**：连续失败 2 次后暂停使用缓存 30 秒，期间请求直接走数据库。只靠 try/catch 是不够的——Redis 不可达时每次调用都要等连接超时，实测一个普通请求能拖到 25 秒，比不用缓存还糟；加熔断后除第一次（约 5 秒）以外，全部回到毫秒级

### 界面
- **八个页面**：`index.html` 表格编辑、`login.html` 登录注册、`tables.html` 表格管理、`dashboard.html` 数据看板、`audit.html` 审计中心、`trash.html` 回收站、`settings.html` 设置、`help.html` 使用帮助
- **搜索 / 排序 / 分页**：全局搜索命中高亮；排序与分页只做显示层裁剪，不改写底层数据，编辑始终作用于真实行
- **列自定义**：按需隐藏列、调整列宽，偏好写入服务端列元数据并在下次打开时恢复
- **选中统计**：勾选若干行后，对纯数字列自动求和 / 求平均
- **审计中心**：跨全部表格的审计时间线，按表格 / 操作 / 时间筛选，支持分页
- **回收站**：删除的表格进入回收站保留 30 天（`Trash:RetentionDays` 可配，前端通过 `/api/excel/trash/policy` 取天数，不自己写死），可随时恢复或彻底删除；过期由 Hangfire 任务自动物理清除
- **设置页**：账号与密码状态、修改密码、会话管理、偏好设置（主题 / 每页行数 / 表格字号三档 / 网格线开关）与关于信息；偏好存本机 `localStorage`，字号与网格线在表格页即时生效
- **帮助页速查**：帮助中心带页内锚点导航与完整键盘快捷键速查表
- **拖拽上传**：把 Excel / CSV 拖到页面上即可导入，与「上传」按钮共用同一套导入流程
- **可折叠侧边栏**：收起后仅留图标并悬停提示，窄屏自动还原
- **加载骨架屏**：数据请求慢时才出现（延迟 120ms），避免快响应时闪屏
- 深浅色主题切换（跟随系统偏好，`localStorage` 持久化，首屏内联脚本防闪烁）
- 无障碍支持：跳到主要内容链接、`aria-live` 状态播报、可见焦点圈、`prefers-reduced-motion` 降级
- 内联 SVG 图标 sprite，无外部图标库依赖

---

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 运行时 | .NET 10.0 (`net10.0`)，`Nullable` / `ImplicitUsings` 开启 |
| Web 框架 | ASP.NET Core Web API（Controller 模式） |
| ORM / 迁移 | Entity Framework Core 10.0.10（SqlServer Provider + Migrations） |
| 数据库 | SQL Server（`Microsoft.Data.SqlClient`） |
| 认证 | `Microsoft.AspNetCore.Authentication.JwtBearer` + `Negotiate` |
| 限流 | 内置 `Microsoft.AspNetCore.RateLimiting`（固定窗口 + 按 IP 分区） |
| Excel 读写 | EPPlus 8.7.0（原生 `net10.0` 目标框架），`ExcelPackage.License.SetNonCommercialPersonal(...)` 声明非商业用途 |
| 日志 | Serilog.AspNetCore 10.0.0（控制台 + 按天滚动 JSON 文件） |
| 后台任务 | Hangfire 1.8.25（`Hangfire.AspNetCore` + `Hangfire.SqlServer`，SQL Server 存储） |
| 缓存 | `Microsoft.Extensions.Caching.StackExchangeRedis` 10.0.14 / 内置 `AddDistributedMemoryCache`，按配置切换 |
| API 文档 | Swashbuckle.AspNetCore 7.2.0（Swagger UI，仅开发环境启用） |
| 前端 | 原生 HTML / CSS / JavaScript，无构建步骤；图表用 ECharts 5.5.1（CDN，jsDelivr 失败自动切 npmmirror） |
| 测试 | xUnit（单元）+ Python / Node 脚本（黑盒回归） |

---

## 项目结构

```
ExcelToWeb/
├── ExcelToWeb.slnx               # SLNX 格式解决方案（新版 Visual Studio 原生支持）
├── .github/workflows/ci.yml      # CI：构建 → 单测 → 约束守门 → 黑盒回归
├── CODE_STANDARDS.md             # 代码约束（分编辑器 / 守门脚本 / 评审三层）
├── CODE_REVIEW.md                # 代码评审记录
├── .gitattributes                # 行尾统一为 auto
├── .gitignore                    # 标准 VisualStudio 忽略规则（另含 .workbuddy/、*.sln 等本地文件）
├── Dockerfile                    # 多阶段构建（.NET 10 SDK + ASP.NET Core 运行时）
├── LICENSE                       # MIT 许可证
├── README.md
├── ExcelToWeb.Tests/             # xUnit 单元测试（纯逻辑，不依赖数据库）
├── tests/                        # 黑盒回归（Python 后端 + Node 前端），说明见 tests/README.md
└── ExcelToWeb/
    ├── Program.cs                # 应用入口：DI、认证、CORS、限流、健康检查、中间件管道、建库、EPPlus 许可
    ├── ExcelToWeb.csproj
    ├── appsettings.json          # 连接串、JWT 配置、日志
    ├── appsettings.Development.json
    ├── Properties/
    │   └── launchSettings.json   # http profile，端口 5185
    ├── Controllers/
    │   ├── AuthController.cs     # 注册 / 登录 / Windows 登录 / 刷新令牌 / 会话管理 / 修改密码
    │   ├── ExcelController.cs    # 表格 CRUD、列结构、列元数据、计算列、透视、导入导出、规则、审计
    │   ├── TrashController.cs    # 回收站：列表 / 恢复 / 彻底删除 / 保留策略
    │   ├── UsersController.cs    # 成员管理（RBAC）：账号列表 / 改角色
    │   └── ExportsController.cs  # 定时导出报表：列表 / 下载 / 开发环境手动触发
    ├── Auth/                     # RBAC：角色与权限码映射、授权处理器、403 响应统一出口
    ├── Caching/                  # 分布式缓存门面（AppCache）+ 缓存键与 TTL 常量
    ├── Jobs/                     # Hangfire 任务：回收站清理、每日导出报表
    ├── Services/
    │   ├── IExcelService.cs      # 对外的 Excel 服务契约
    │   ├── ExcelService.cs       # 门面：编排下列协作类，本身只做流程串联与异常收敛
    │   ├── RetentionPolicy.cs    # 保留期唯一真源（回收站 / 导出快照），配置驱动
    │   ├── TokenService.cs       # JWT 签发与用户 ID 提取
    │   ├── RefreshTokenService.cs# 刷新令牌签发 / 轮换 / 重用检测 / 会话列表
    │   ├── TrashService.cs       # 回收站：恢复 / 彻底删除（含演示账号只读拦截）
    │   ├── DemoSeeder.cs         # 演示账号与样例表的幂等 seed（含密码自愈）
    │   └── Excel/                # Excel 协作类（按职责拆分，单一职责而非凑行数）
    │       ├── ExcelSheetReader.cs      # xlsx 解析 → 表头 + 数据行 + 合并区域
    │       ├── CsvSheetReader.cs        # CSV 解析（编码嗅探 UTF-8/GBK、分隔符检测、引号字段）
    │       ├── TableImportService.cs    # 导入编排：解析 → 建表 → 批插（Excel / CSV 共用链路）
    │       ├── TableRepository.cs       # 动态表持久化（分批插入、整表替换、重命名、复制）
    │       ├── ColumnStructureService.cs# 列结构增删改移（含数据迁移，事务内完成）
    │       ├── ColumnMetaService.cs     # 列元数据：列宽 / 显隐 / 计算列公式
    │       ├── ComputedColumnService.cs # 计算列求值编排（读取时实时算，不落库）
    │       ├── FormulaEngine.cs         # 公式对外契约：解析 / 校验 / 列名改名
    │       ├── FormulaLexer.cs          # 分词（internal，经 InternalsVisibleTo 直测）
    │       ├── FormulaParser.cs         # 建树（internal）
    │       ├── FormulaEvaluator.cs      # 白名单函数递归求值
    │       ├── MergeRange.cs / MergeRangeCodec.cs / SheetGrid.cs  # 合并区域模型、编解码、工作表栅格
    │       ├── PivotService.cs          # 透视聚合（分组 / 聚合 / 排序的单一计算来源）
    │       ├── PivotExportService.cs    # 透视结果导出（只排版）
    │       ├── ExcelExportService.cs    # xlsx / csv 导出、导入模板生成
    │       ├── ExcelNumber.cs           # 数值 / 日期口径（导出与求值共用）
    │       ├── RowValidator.cs          # 按校验规则逐行校验
    │       ├── RuleService.cs           # 配色规则 / 校验规则读写
    │       ├── RowDateFilter.cs         # 按日期列前缀筛选
    │       ├── AuditService.cs          # 审计日志写入与跨表查询
    │       ├── DemoWriteGuard.cs        # 演示账号只读拦截（服务端强制）
    │       └── RecycleBinCleanupService.cs # 后台清理：物理删除回收站中超 30 天的表格
    ├── Data/
    │   └── AppDbContext.cs       # DbSet 定义与实体映射（索引、精度、级联删除）
    ├── Migrations/               # EF Core 迁移：Baseline / AddRefreshTokens / AddSoftDelete
    ├── Models/
    │   ├── User.cs               # 用户
    │   ├── DynamicTable.cs       # 动态表 + DynamicRow
    │   ├── ColorRule.cs          # 条件配色规则
    │   ├── ValidationRule.cs     # 数据校验规则
    │   ├── ValidationResult.cs   # 校验结果（总/成功/错误行数 + 错误明细）
    │   ├── AuditLog.cs           # 审计日志
    │   ├── RefreshToken.cs       # 刷新令牌（按 FamilyId 分组吊销）
    │   └── ApiResponse.cs        # 统一响应包装（泛型 / 非泛型）
    ├── DTOs/
    │   └── Dtos.cs               # 请求/响应传输对象
    ├── Middleware/
    │   └── ExceptionMiddleware.cs# 全局异常捕获，统一返回 JSON 错误
    ├── HealthChecks/
    │   └── DatabaseHealthCheck.cs# 就绪探针：SELECT 1 验证数据库连通
    ├── Helpers/
    │   ├── ExcelHelper.cs        # 字符串清洗、日期列识别、CSV 转义、示例值
    │   ├── PasswordHelper.cs     # PBKDF2 哈希与校验（兼容旧格式）
    │   └── UtcDateTimeJsonConverter.cs # 统一 UTC 时间序列化口径
    └── wwwroot/                  # 前端静态资源（后端直接托管）
        ├── index.html            # 表格编辑页
        ├── login.html            # 登录 / 注册页（含演示账号一键进入）
        ├── dashboard.html        # 数据看板页
        ├── tables.html           # 表格管理页
        ├── audit.html            # 审计中心页（跨表审计时间线）
        ├── trash.html            # 回收站页（恢复 / 彻底删除）
        ├── settings.html         # 设置页（账号 / 密码 / 会话 / 偏好 / 关于）
        ├── help.html             # 使用帮助页（页内锚点导航 + 快捷键速查表）
        ├── css/
        │   ├── style.css         # 入口：按顺序 @import 下列模块，层叠顺序即加载顺序
        │   ├── tokens.css        # 设计令牌（亮/暗）+ 全局重置 + 无障碍基础
        │   ├── layout.css        # 应用外壳：主内容、页头、状态胶囊
        │   ├── sidebar.css       # 侧边栏：品牌 / 导航 / 底部操作 / 折叠态
        │   ├── toolbar.css       # 按钮、工具栏、下拉菜单、表格选择器
        │   ├── search.css        # 全局搜索框、列显示 / 列宽菜单
        │   ├── table.css         # 数据表格、冻结列、表头、表格密度、网格线
        │   ├── cell.css          # 可编辑单元格、建议列表、命中高亮、选区、填充柄（必须紧跟 table.css）
        │   ├── stats.css         # 汇总行、统计栏、分页条、选中统计、空状态
        │   ├── modal.css         # 弹窗外壳 + 表单控件
        │   ├── rules.css         # 规则表格 + 列管理面板
        │   ├── toast.css         # Toast 提示
        │   ├── palette.css       # Ctrl+K 命令面板
        │   ├── history.css       # 变更历史时间线
        │   ├── login.css         # 登录页（极光背景 + 玻璃卡片）
        │   ├── dash.css          # 数据看板：统计卡 / 卡片外壳 / 图表区
        │   ├── dash-table.css    # 看板分组汇总表（必须紧跟 dash.css）
        │   ├── pages.css         # 主页面响应式断点（只放 media query）
        │   ├── cards.css         # 表格管理页卡片网格
        │   ├── doc.css           # 帮助页文档排版
        │   ├── console.css       # 二级页面公共部分 + 表格字号三档
        │   ├── settings.css      # 设置页：页头 / 卡片网格 / 账号 / 密码 / 会话
        │   ├── settings-prefs.css# 设置页：偏好 / 关于（必须紧跟 settings.css）
        │   └── pivot.css         # 透视汇总弹窗
        └── js/                   # 按依赖顺序加载：state.js 须最先，app.js 须最后
            ├── shell.js          # 页面外壳：图标 sprite、主题、导航高亮、侧边栏折叠、登出
            ├── api.js            # 统一 fetch 封装 + 全部接口调用
            ├── state.js          # 全局状态容器（唯一可变状态声明处）
            ├── modal-templates.js# 编辑器各类弹窗的 HTML 模板（加载期注入）
            ├── utils.js          # toast / 状态栏 / 通用格式化 / escapeHtml / 字号与网格线应用
            ├── view.js           # 搜索·排序·分页·列显隐管线
            ├── selection.js      # 选中行统计
            ├── aggregate.js      # 汇总行计算
            ├── history.js        # 撤销 / 重做
            ├── column-meta.js    # 列宽 / 显隐 / 计算列公式的服务端同步
            ├── computed-column.js# 计算列：只读判定与求值结果回填
            ├── tables.js         # 表格列表、切换、删除、刷新
            ├── io.js             # 保存 / 导出 / 导出当前视图 / 下载模板
            ├── dnd.js            # 拖拽上传（与按钮上传共用同一导入流程）
            ├── sheet-picker.js   # 多工作表选择弹窗
            ├── render.js         # 表格渲染 + 状态标签 + 加载骨架屏
            ├── keyboard.js       # 单元格键盘导航（Enter / Tab / 方向键 / Ctrl+Home…）
            ├── range.js          # 单元格区域选择
            ├── range-clipboard.js# 区域复制 / 粘贴
            ├── fill-handle.js    # 填充柄拖拽（复制 / 递增）
            ├── findreplace.js    # 查找替换
            ├── edit.js           # 单元格编辑、增删行
            ├── filter.js         # 日期筛选
            ├── color-rules.js    # 条件配色规则
            ├── validation.js     # 数据校验规则
            ├── upload-validated.js # 带校验的导入
            ├── column-manager.js # 列管理（增删改移）
            ├── audit.js          # 编辑器内单表审计弹窗
            ├── palette.js        # Ctrl+K 命令面板（跨页面快速跳转）
            ├── pivot.js          # 透视汇总弹窗
            ├── app.js            # 应用初始化与页面编排（须最后加载）
            ├── tables-page.js    # 表格管理页逻辑
            ├── audit-page.js     # 审计中心页逻辑
            ├── trash-page.js     # 回收站页逻辑
            ├── settings.js       # 设置页逻辑
            ├── chart.js          # 看板图表「算」：布局 / 数值分布 / 配色令牌（纯函数，可单测）
            ├── chart-render.js   # 看板图表「画」：ECharts option 装配与实例挂载
            ├── dashboard-view.js # 看板模板（纯 model → HTML）
            └── dashboard.js      # 看板取数 / 维度识别 / 聚合 / 联动
```

> 前端新增 JS 模块需要四处登记：`index.html` 的 `<script>` 顺序、`app.js` 的 `Object.assign(window, {…})`（内联 `onclick` 能调用到）、`Esc` 关闭列表，以及 `tests/frontend/wire_check.js` 的接线检查。改任何文件前先读 [CODE_STANDARDS.md](CODE_STANDARDS.md)。

---

## 数据模型

| 表 | 说明 | 关键字段 |
| --- | --- | --- |
| `Users` | 用户 | `Username`（唯一索引）、`PasswordHash`、`LastLoginAt` |
| `DynamicTables` | 动态表元数据 | `TableName`、`Headers`（JSON 数组，`nvarchar(max)`）、`ColumnMetaJson`（列宽 / 显隐 / 计算列公式）、`UserId`（索引）、`RowVersion`（乐观并发令牌）、`DeletedAt`（软删除标记，null = 活表） |
| `DynamicRows` | 动态表数据行 | `TableId`（外键，级联删除）、`DataJson`（整行 JSON，`nvarchar(max)`） |
| `ColorRules` | 条件配色规则 | `UserId` + `ColumnName`（复合索引）、`MinValue` / `MaxValue`（`decimal(18,2)`）、`ColorCode` |
| `ValidationRules` | 数据校验规则 | `TableId`（索引）、`ColumnName`、`Required`、`DataType`、`MinValue` / `MaxValue`、`MaxLength`、`AllowedValues` |
| `RefreshTokens` | 刷新令牌 | `TokenHash`（唯一索引）、`FamilyId`（重用检测整族吊销）、`ExpiresAt` / `RevokedAt`、`UserId`（索引） |
| `AuditLogs` | 审计日志 | `TableId` / `UserId`（索引）、`Action`、`Detail`、`CreatedAt` |

**设计要点**：表结构是「动态」的 —— 不同 Excel 的列名各不相同，因此不生成物理列，而是把表头存为 JSON 数组、每行数据存为一行 JSON 记录。牺牲了 SQL 层面的列级查询能力，换来任意 Excel 结构即插即用。

数据库结构由 **EF Core Migrations** 管理（`Migrations/` 目录，baseline 迁移覆盖全部表）。应用启动时自动执行 `Database.Migrate()`：全新数据库会先建库再按序应用迁移；此前的老库（`EnsureCreated` 时代）会被自动检测并补上迁移历史记录，平滑过渡到迁移体系，**首次运行无需手动执行任何 SQL 脚本**。

> 后续改表结构：`dotnet ef migrations add Xxx --project ExcelToWeb`。启动自动迁移在多实例部署下有并发竞争的边界，单实例无碍 —— 多实例时建议改为部署流水线里单独执行迁移。

---

## API 接口

统一响应格式：

```json
{ "success": true, "message": "操作成功", "data": { } }
```

所有 `/api/excel/*` 与 `/api/trash/*` 接口均需在请求头携带 `Authorization: Bearer {token}`。
未捕获异常统一返回 `application/problem+json`（RFC 7807，含 `traceId`），业务错误仍用上面的 `ApiResponse` 契约。

### 认证 `/api/auth`

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | 注册（用户名 3–20 位字母数字，密码 ≥ 6 位，两次一致）；只返回结果，不签发 Token | 匿名 + 限流 |
| `POST` | `/api/auth/login` | 登录，返回用户信息 + JWT + 刷新令牌 + `AuthType` / `HasPassword` | 匿名 + 限流 |
| `GET` | `/api/auth/windows` | Windows 集成认证登录（NTLM/Kerberos 协商） | Negotiate |
| `GET` | `/api/auth/me` | 获取当前登录用户（含账号类型与是否设置本地密码） | JWT |
| `POST` | `/api/auth/change-password` | 修改密码（校验原密码；Windows 建档账号无本地密码，不支持修改） | JWT |
| `POST` | `/api/auth/refresh` | 刷新令牌轮换：旧令牌立即吊销并签发新对；重用已吊销令牌会触发该族全部吊销 | 匿名（凭 refresh token） |
| `POST` | `/api/auth/logout` | 注销当前会话（吊销刷新令牌） | JWT |
| `GET` / `DELETE` | `/api/auth/sessions` | 查看活跃会话列表（设备 / IP / 最后活跃）/ 注销单个会话 | JWT |

### 表格 `/api/excel`

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/excel/upload` | `file`（multipart）、`sheetIndex?` | 上传 Excel / CSV，创建新表并导入（默认首个工作表） |
| `POST` | `/api/excel/sheets` | `file`（multipart） | 只解析工作表清单（名称 / 行数），供「选一张导入」弹窗使用 |
| `GET` | `/api/excel/query` | `tableId`、`date?` | 查询表数据，可选按日期前缀筛选 |
| `POST` | `/api/excel/save` | `{ tableId, rows[] }` | 保存数据（**先清空后写入**，整表替换语义） |
| `DELETE` | `/api/excel/delete` | `tableId` | 删除表格（**软删除**进回收站，30 天内可恢复；数据与审计原样保留） |
| `PUT` | `/api/excel/rename` | `{ tableId, tableName }` | 重命名表格 |
| `POST` | `/api/excel/duplicate` | `{ tableId }` | 复制表格（含全部数据行），副本名自动去重为「- 副本」「- 副本(2)」… |
| `GET` | `/api/excel/tables` | — | 当前用户的表格列表（按更新时间倒序，含暂无数据行的空表） |
| `GET` | `/api/excel/export` | `tableId` | 导出 `.xlsx` |
| `GET` | `/api/excel/export-csv` | `tableId` | 导出 `.csv`（UTF-8 BOM） |
| `GET` | `/api/excel/template` | `tableId` | 下载导入模板 `.xlsx` |
| `GET` | `/api/excel/column-values` | `tableId`、`columnName` | 取某列的全部去重值（校验规则「枚举白名单」与条件格式选值用） |

### 列结构与计算列

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| `PUT` | `/api/excel/headers` | `{ tableId, headers[] }` | 改列结构（增删改移），数据按列名迁移，事务内完成 |
| `GET` | `/api/excel/column-meta` | `tableId` | 列元数据：列宽 / 是否隐藏 / 计算列公式 |
| `PUT` | `/api/excel/column-meta` | `{ tableId, meta }` | 保存列元数据（列增删时自动同步键名） |
| `PUT` | `/api/excel/formula` | `{ tableId, columnName, formula }` | 设置 / 清空某列的计算列公式（传空串即还原为普通列） |

### 透视汇总

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/excel/pivot` | `{ tableId, rowField, colField?, valueField, agg }` | 计算透视结果，`agg` 取 `sum / count / avg / max / min` |
| `POST` | `/api/excel/pivot-export` | 同上 | 把同一份透视结果导出为 `.xlsx` |

### 规则与校验

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/excel/rules` | `columnName?` | 查询配色规则（可按列过滤） |
| `POST` | `/api/excel/rules` | `ColorRule[]` | 保存配色规则（按 `rules[0].ColumnName` 整列替换） |
| `GET` | `/api/excel/validation-rules` | `tableId` | 查询某表的校验规则 |
| `POST` | `/api/excel/validation-rules` | `ValidationRule[]` | 保存校验规则（按 `rules[0].TableId` 整表替换） |
| `POST` | `/api/excel/upload-with-validation` | `file` + `tableId` | 按已有规则校验后导入，返回成功/失败行数与错误明细 |

> 未配置校验规则时，`upload-with-validation` 直接放行全部数据行。

### 回收站与审计

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/excel/trash` | 回收站列表（表名、数据行数、删除时间） |
| `GET` | `/api/excel/trash/policy` | 保留策略（`retentionDays`），前端据此渲染「N 天后自动清除」，不再自己写死天数 |
| `POST` | `/api/excel/trash/{id}/restore` | 恢复表格（清掉删除标记，数据原样回到表格列表） |
| `DELETE` | `/api/excel/trash/{id}` | 彻底删除（物理删表，并清理关联的审计日志与校验规则） |
| `GET` | `/api/excel/audit-logs` | **单表**审计：`tableId` 必填，`rowIndex?` 可精确到行（编辑器内弹窗用） |
| `GET` | `/api/excel/audit-center` | **跨表**审计：`tableId?`、`actionType?`、`from?`、`to?`、`page`、`pageSize`（审计中心页用） |

> 回收站中的表格超过保留期（`Trash:RetentionDays`，默认 30 天）后，由 Hangfire 的 `recycle-bin-cleanup` 任务（每天 03:00，启动时补跑一次）自动物理清除。

### 定时导出与后台任务

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `PUT` | `/api/excel/tables/{id}/auto-export` | `table:write` | 开关某张表的「每日自动导出」 |
| `GET` | `/api/exports` | `table:read` | 当前用户最近 50 份导出报表 |
| `GET` | `/api/exports/{id}/download` | `table:read` | 下载报表（校验归属，别人的 id 一律 404） |
| `POST` | `/api/exports/run-now` | `member:manage` | **仅开发环境**：把 `daily-export` 排进队列，不必等到凌晨两点 |
| `GET` | `/hangfire` | 本机 | Hangfire Dashboard，`Hangfire:DashboardEnabled` 控制，生产默认关闭 |

### 健康检查

| 端点 | 用途 | 说明 |
| --- | --- | --- |
| `GET /health` | 存活探针 | 不查任何外部依赖，进程活着即 200 |
| `GET /health/ready` | 就绪探针 | `SELECT 1` 验证数据库，失败返回 503 |

---

## 测试

测试分两层，各守各的：

| 层 | 位置 | 守什么 | 怎么跑 |
| --- | --- | --- | --- |
| **单元测试**（xUnit） | `ExcelToWeb.Tests/` | 纯逻辑类：公式引擎（词法/语法/求值）、数值/日期口径、密码哈希、JWT 签发、行校验、透视聚合 | `dotnet test` |
| **黑盒回归**（Python + Node） | `tests/` | 起真实服务后的集成路径：API 行为、导入导出、前端模块接线 | `python tests/run.py` |

- 单元测试全部指向不依赖数据库的纯函数/纯类，零 mock；`FormulaLexer`、`FormulaParser` 是 internal 类，经 `InternalsVisibleTo` 直接测
- 黑盒套件由 `tests/run.py` 一键编排：代码约束守门 → 起服务（5185）→ `backend/*.py` → `frontend/*.js`，当前共 28 项
- 前端用例不依赖浏览器：Node `vm` 沙箱 + DOM 桩（`tests/frontend/helpers/dom-harness.js`），直接读 `wwwroot` 源文件，因此改前端必跑
- **约束守门**（`tests/check_constraints.py`，`run.py` 的第 0 项，不过则后面全跳过）：禁 `eval` / `new Function` / `alert` / `document.write`、禁用 `Console.WriteLine` 与空 catch、`index.html` 脚本加载顺序、共享模块装配审计；行数**不再是约束**（`--lines` 只打印体量提示）。规则细节见 [CODE_STANDARDS.md](CODE_STANDARDS.md)
- GitHub Actions（`.github/workflows/ci.yml`）按同样顺序跑全部门禁：`dotnet build ExcelToWeb.slnx` → `dotnet test` → 约束守门 → 黑盒回归（ubuntu runner + SQL Server 容器服务）

> 前置：Python 3.x、Node 20+（仅跑测试需要）。测试固定连 `http://localhost:5185`，可用环境变量 `TEST_BASE_URL` 改端口；`run.py` 用 `dotnet run --no-build`，**改了 C# 要先 `dotnet build`**，否则测的是旧二进制。

---

## 快速开始

### 前置条件

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| .NET SDK | 10.0 | 或 Visual Studio 2022 17.x+ / VS Code + C# Dev Kit |
| SQL Server | 2019+（Express / Developer / LocalDB 均可） | 默认连接串指向 `localhost\SQLEXPRESS01` |
| Python 3.x、Node 20+ | 可选 | 只在跑黑盒回归时需要 |

> macOS / Linux 上没有 Windows 身份验证，连接串要改成 SQL 账号登录（见下一步）。

### 1. 配置数据库连接

编辑 `ExcelToWeb/appsettings.json`，改成你本机的实例名与数据库名：

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=localhost\\SQLEXPRESS01;Database=ExcelToWebDB;Trusted_Connection=True;TrustServerCertificate=True;"
  }
}
```

连接串使用 `Trusted_Connection=True`（Windows 身份验证），无需填写账号密码。若使用 SQL 账号登录（或在容器 / 非 Windows 环境），改为：

```
Server=localhost;Database=ExcelToWebDB;User Id=sa;Password=你的密码;TrustServerCertificate=True;
```

不装 SQL Server 也可以用 **LocalDB**：`Server=(localdb)\\MSSQLLocalDB;Database=ExcelToWebDB;Trusted_Connection=True;`。

### 2. 配置 JWT 密钥

JWT 签名密钥**不随仓库分发**，用 .NET 用户机密（User Secrets）保存在本机 —— 它存放在项目目录之外，永远不会被提交：

```bash
dotnet user-secrets set "Jwt:Key" "<你的随机密钥，建议 48 字节 Base64>" --project ExcelToWeb
```

`appsettings.json` 中**不含** `Jwt:Key`；未配置用户机密时应用会直接启动失败并提示「Jwt:Key 未配置」。生产环境还必须改用环境变量 `Jwt__Key` 提供 ≥32 字符的独立密钥。更换密钥后，此前签发的所有 Token 立即失效，需要重新登录。

### 3. 构建并运行

```bash
# 在解决方案根目录
dotnet build ExcelToWeb.slnx          # 可选：先构建一遍，之后跑测试更快
dotnet run --project ExcelToWeb
```

或直接用 Visual Studio 打开 `ExcelToWeb.slnx` 后按 F5。

应用监听 **http://localhost:5185**（由 `Program.cs` 中 `UseUrls` 兜底，端口优先级见下方「配置说明」）。数据库与所有表会在首次启动时自动创建并应用迁移。

### 4. 访问

| 地址 | 用途 |
| --- | --- |
| <http://localhost:5185/> | 表格编辑页（静态首页，未登录会跳登录） |
| <http://localhost:5185/login.html> | 登录 / 注册 |
| <http://localhost:5185/tables.html> | 表格管理（列表、重命名、复制、删除） |
| <http://localhost:5185/dashboard.html> | 数据看板 |
| <http://localhost:5185/audit.html> | 审计中心（跨表审计时间线） |
| <http://localhost:5185/trash.html> | 回收站（恢复 / 彻底删除） |
| <http://localhost:5185/settings.html> | 设置（修改密码、界面偏好、会话管理） |
| <http://localhost:5185/help.html> | 使用帮助 |
| <http://localhost:5185/swagger> | Swagger UI（**仅开发环境**） |
| <http://localhost:5185/health> · `/health/ready` | 存活 / 就绪探针 |

先在登录页注册一个账号，再登录使用；也可以点登录页的「演示账号」一键进入只读体验（预置样例表，写操作会被服务端拒绝）。

> 想以单个 exe 形式运行（内容根=bin 目录）也没问题：`.csproj` 中已配置 `wwwroot` 随生成复制，静态文件照常可访问。
>
> ⚠️ 但**直接运行 exe 时环境默认为 Production**，此时不会加载 `appsettings.Development.json`、也不会读取用户机密（`dotnet user-secrets` 仅在 Development 生效），因此**必须先注入 `Jwt__Key`（≥32 字符）和 `ConnectionStrings__DefaultConnection`**，否则会因缺少 `Jwt:Key` 直接启动失败；`Auth:EnableWindows` 也会回落到默认关闭。想沿用本地开发配置（Swagger、用户机密里的密钥等），请先设 `ASPNETCORE_ENVIRONMENT=Development` 再运行。

### 5. 跑一遍自检（可选）

```bash
dotnet test                  # 单元测试（不需要数据库）
python tests/run.py          # 黑盒回归（会自己起服务、跑完关掉）
python tests/check_constraints.py   # 只跑代码约束守门（秒级）
```

---

## 示例：5 分钟走一遍

### 方式一：界面（推荐先走这条）

1. 打开 <http://localhost:5185/login.html> → 注册 `test01` / `123456` → 登录
2. 把任意 `.xlsx` / `.csv` 拖到页面上（或点「上传」）→ 自动建表并进入编辑页
3. 改几个单元格 → 点「保存」→ 刷新页面确认已落库
4. 「设置 → 列管理」里新增一列 `金额`，给它填计算公式 `[单价] * [数量]` → 该列变为只读计算列
5. 「透视汇总」：行维度选 `销售员`、值字段选 `金额`、聚合选 `sum` → 预览 → 导出
6. 「导出 → 导出 Excel」，与页面数据对一遍
7. 「数据看板」切到这张表看图表；「审计中心」能看到刚才每一步的记录
8. 删除这张表 → 「回收站」里恢复回来

### 方式二：命令行（验证 API 或写脚本）

```bash
# 1) 注册（只返回结果，不签发 token）
curl -X POST http://localhost:5185/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test01","password":"123456","confirmPassword":"123456"}'

# 2) 登录，取 access token
curl -X POST http://localhost:5185/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test01","password":"123456"}'
# → {"success":true,"data":{"token":"eyJ...","refreshToken":"...","familyId":"..."}}

# 3) 上传 Excel（Windows cmd 里 curl 的续行符是 ^，不是 \）
curl -X POST http://localhost:5185/api/excel/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@销售数据.xlsx"

# 4) 查询（拿到上一步返回的 tableId）
curl "http://localhost:5185/api/excel/query?tableId=1" -H "Authorization: Bearer <token>"

# 5) 导出
curl -L "http://localhost:5185/api/excel/export?tableId=1" \
  -H "Authorization: Bearer <token>" -o 导出.xlsx
```

> 保存接口是**整表替换**语义，请求体的 `rows` 必须是「列名 → 值」的字典数组：
> `{"tableId":1,"rows":[{"销售员":"张伟","数量":3}]}`。传成二维数组不会报错，但会绑成空行。

更多参数与返回示例见开发环境的 Swagger UI（<http://localhost:5185/swagger>）。

---

## 配置说明

`appsettings.json`：

| 键 | 说明 |
| --- | --- |
| `ConnectionStrings:DefaultConnection` | SQL Server 连接串 |
| `Jwt:Key` | HMAC-SHA256 签名密钥，**长度需 ≥ 32 字符**。仓库内不含此键，缺失会启动失败；本地用 `dotnet user-secrets`、生产用环境变量 `Jwt__Key` 注入。生产环境若密钥以 `CHANGE_ME` 开头或短于 32 字符也会拒绝启动 |
| `Jwt:Issuer` / `Jwt:Audience` | 签发者与受众，校验时需一致 |
| `Jwt:ExpireMinutes` | Access Token 有效期（分钟），代码默认 `1440`；仓库配置为 `120`（2 小时短效，配合刷新令牌使用）。刷新令牌固定 7 天有效，在 `RefreshTokenService` 中以常量管理 |
| `Cors:AllowedOrigins` | 允许跨域的来源数组。**开发环境忽略此项**（一律放开，便于 `file://` 或独立前端 dev server 调试）；生产环境只放行此处列出的来源，留空则不启用跨域（前端由本应用同源托管，通常无需配置） |
| `Auth:EnableWindows` | 是否启用 Windows 集成身份验证（Negotiate）。默认 `false`；`appsettings.Development.json` 中为 `true`。关闭时 `/api/auth/windows` 返回 404。Azure 等无域环境保持关闭 |
| `RateLimit:AuthPermitLimit` | 登录 / 注册接口按 IP 的每分钟放行次数（固定窗口），未配置时代码默认 `10`。反向代理后部署需开启转发头，否则所有请求会算作代理 IP 一个配额 |
| `Cache:Provider` | `memory`（默认，进程内内存实现）或 `redis`。多副本部署时应设为 `redis`：内存缓存每个副本各存一份，改角色后的主动失效只能打到其中一个副本 |
| `Cache:Redis:Connection` | Redis 连接串（`Provider=redis` 时必填，缺失直接启动失败），如 `localhost:6379` |
| `Cache:Redis:InstanceName` | 键前缀，默认 `exceltoweb:`；多个应用共用一个 Redis 时用来隔离 |
| `Hangfire:Enabled` | 是否启用后台任务调度，默认 `true`。关闭后 `/api/exports/run-now` 返回 503、`/hangfire` 不挂载，业务接口不受影响 |
| `Hangfire:DashboardEnabled` | 是否挂载 `/hangfire` Dashboard。`appsettings.Development.json` 为 `true`，生产默认 `false`（Dashboard 能看到任务参数与异常栈、能手动触发任务，且只对本机请求放行） |
| `Trash:RetentionDays` | 回收站保留天数，默认 `30`。后台清理与前端文案共用这一份（`Services/RetentionPolicy.cs`） |
| `Export:RetentionDays` | 定时导出快照保留天数，默认 `14` |
| `Logging:LogLevel` | 日志级别（Serilog 会接管输出：控制台 + 生产按天滚动 JSON 文件，保留 14 天） |

后台任务的 cron 写在 `Program.cs` 的 `RecurringJob.AddOrUpdate` 里（每次启动覆盖存储中的定义），调度时区取服务器本地时区——容器部署时记得设 `TZ=Asia/Shanghai`。导出快照落 `App_Data/exports/`（已在 `.gitignore` 中排除）。

本地开发端口默认为 5185（`Program.cs` 仅在「开发环境且未设置 `ASPNETCORE_URLS`」时兜底监听）；生产环境改由 `ASPNETCORE_URLS` 决定（Azure 容器默认 8080），不会再被硬编码端口覆盖。

EPPlus 的许可通过 `ExcelPackage.License.SetNonCommercialPersonal("…")` 声明为**非商业个人使用**（EPPlus 7+ 已移除旧的 `LicenseContext` 属性，旧写法会编译失败）；若用于商业场景，需自行购买 EPPlus 商业许可证并改用 `SetCommercial(key)`。

Swagger UI 仅在**开发环境**启用，生产环境访问 `/swagger` 返回 404。

### Azure 部署（容器）

仓库根目录提供多阶段 `Dockerfile`（.NET 10 SDK 构建 + ASP.NET Core 运行时，默认监听 8080）：

```bash
docker build -t excel-to-web .
docker run -p 8080:8080 \
  -e ConnectionStrings__DefaultConnection="Server=...;Database=...;User Id=...;Password=...;TrustServerCertificate=True;" \
  -e Jwt__Key="<≥32 字符的随机密钥>" \
  excel-to-web
```

部署到 **Azure App Service / Container Apps** 时，以下配置必须通过环境变量注入（`__` 对应配置节的 `:`）：

| 环境变量 | 说明 |
| --- | --- |
| `ConnectionStrings__DefaultConnection` | Azure SQL 连接串（含账号密码，不能用 `Trusted_Connection`） |
| `Jwt__Key` | ≥32 字符的独立签名密钥（生产环境缺失 / 过短会拒绝启动） |
| `Cors__AllowedOrigins__0` | 前端来源白名单（前后端同源部署可留空） |
| `Auth__EnableWindows` | Azure 无域环境请设为 `false`（默认即 `false`，此时 `/api/auth/windows` 返回 404） |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | 设为 `true`：让应用从代理转发头取到真实客户端 IP。登录限流按 IP 分区，不设则所有请求都会算作代理 IP、退化成全局配额 |

> 容器监听端口由平台经 `ASPNETCORE_URLS` 注入，应用不再硬编码覆盖。

### 健康检查（平台探活）

应用内置两个探活端点，职责刻意分离：

| 端点 | 用途 | 判定逻辑 |
| --- | --- | --- |
| `/health` | **存活探针**（liveness） | 不执行任何检查，进程活着即 200。数据库闪断不会导致容器被平台反复重启 |
| `/health/ready` | **就绪探针**（readiness） | 执行 `SELECT 1` 验证 SQL Server 连通性，失败返回 503 |

Azure 上的接入方式：App Service「运行状况监视」的常规探测路径填 `/health`；「运行状况检查（Health Check）」功能与 Container Apps 的就绪探针填 `/health/ready`。容器镜像内置 `HEALTHCHECK` 指令（探 `/health`），`docker run` 后约 30 秒起可通过 `docker inspect --format "{{.State.Health.Status}}"` 观察。

---

## 使用流程

1. **注册 / 登录** → 获取 JWT，存入 `localStorage`
2. **上传 Excel / CSV** → 自动解析表头与数据行（多工作表时选一张），创建动态表
3. **在线编辑** → 修改单元格、增删行，区域复制粘贴 / 填充柄 / 查找替换，点击保存
4. **调整列**（可选）→ 列管理里增删改移列、调列宽、隐藏不必要的列；给列写计算公式变成只读计算列
5. **配置规则**（可选）
   - 配色规则：让某列数值区间显示红 / 黄 / 绿
   - 校验规则：约束必填、类型、范围、长度、枚举值
6. **校验导入**（可选）→ 用已有规则校验新 Excel，查看错误明细，仅导入合法行
7. **透视汇总 / 看板**（可选）→ 分组聚合得到汇总视图，或到数据看板看图表
8. **导出** → 下载 `.xlsx` / `.csv`（或当前视图 CSV），或下载模板分发给填报人
9. **误删找回**（可选）→ 删除的表格进入回收站保留 30 天，可恢复或彻底删除

---

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 启动即退出，日志提示「Jwt:Key 未配置」 | 没设用户机密，或当前不是 Development 环境（用户机密只在 Development 生效）。按「快速开始 · 2」设置 `Jwt:Key`，或注入环境变量 `Jwt__Key` |
| `A network-related or instance-specific error` | SQL Server 实例名写错或服务没启动。用 `sqlcmd -S localhost\SQLEXPRESS01 -Q "SELECT 1"` 自测，再改连接串 |
| 端口 5185 被占用（`EADDRINUSE` / `Address already in use`） | 换端口：`dotnet run --project ExcelToWeb --urls http://localhost:5186`，测试侧同步设 `TEST_BASE_URL` |
| 改了 C# 但行为没变 | `tests/run.py` 用 `--no-build`，测的是旧二进制。先 `dotnet build`；或 `ExcelToWeb.exe` 还在运行锁着 `bin`，先结束进程 |
| 中文 CSV 导进来看是乱码 | 导入侧已做 UTF-8 / GBK 嗅探；乱码一般是导出后被别的工具按非 UTF-8 打开 —— 导出的 CSV 带 BOM，用 Excel 直接打开即可 |
| 演示账号点保存没反应 / 提示只读 | 预期行为。`demo` 账号的写操作在服务端被 `DemoWriteGuard` 拒绝，与前端无关 |
| 大表格编辑卡顿 | 默认每页 50 行（设置页可改），也可临时切「全部」。单表超过 5 万行会直接在上传阶段被拒 |
| 图表显示不出来 | 看板从 CDN 加载 ECharts，内网 / 离线环境会回落到空图表。需要离线使用时把 `echarts.min.js` 下载到 `wwwroot/js/` 并改本地引用 |
| 换浏览器后列宽 / 隐藏列没了 | 列元数据存在服务端（按表），但**表格字号、主题**等界面偏好存本机 `localStorage`，换浏览器需重设 |

---

## 已知限制与安全提醒

**已完成的安全加固：**

- **JWT 密钥已移出仓库**：`appsettings.json` 中已**删除** `Jwt:Key`，本地用用户机密、生产用环境变量注入；生产环境额外拒绝占位串与 < 32 字符的弱密钥。⚠️ 需注意 git **历史**里仍残留一个早期提交的明文旧密钥 —— 该密钥已轮换失效，但若要让仓库历史也干净，需用 `git filter-repo` 或 BFG 重写历史并强推。
- **CORS 已按环境区分**：开发环境仍放开（`AllowAnyOrigin`，便于本地调试）；生产环境只放行 `Cors:AllowedOrigins` 中显式配置的来源，未配置即不启用跨域。正式上线前记得填白名单。
- **异常信息已按环境收敛（RFC 7807 ProblemDetails）**：未捕获异常统一返回 `application/problem+json`（含 `traceId` 扩展与 `message` 兼容字段）；生产环境 `detail` 只含追踪号、异常明细仅写服务端日志，开发环境保留明细便于排查。业务 4xx 仍走 `ApiResponse { success, message }` 契约，前端与测试只处理两种明确结构。
- **登录 / 注册已限流**：按来源 IP 固定窗口（默认 10 次 / 分钟），避免撞库与用户枚举。
- **`.gitignore` 已补充** `.workbuddy/` 与 `appsettings.*.local.json`。
- **依赖漏洞已根除**：原先 EPPlus 6.0.3 会传递引入 `System.Drawing.Common` 5.0.0，触发 `NU1904`（GHSA-rxg9-xrhp-64gj / CVE-2021-24112，严重级）。已升级到 **EPPlus 8.7.0**，该版本不再依赖 `System.Drawing.Common`，依赖图中已无易受攻击的包（`dotnet list package --vulnerable --include-transitive` 返回空），构建 0 警告。

**仍需注意：**

- **未设置 CSP 响应头**：目前防 XSS 只有一层 —— 所有动态内容经 `escapeHtml` 转义（`innerHTML` 拼接处一律先转义）。**这是已知待补项**，加 CSP（`default-src 'self'` + 允许 ECharts CDN）应在正式上线前完成。
- **Windows 集成认证**需服务端与客户端处于同一域（或受信任域）才有意义；由 `Auth:EnableWindows` 开关控制（本地开发默认开、生产默认关），关闭时 `/api/auth/windows` 返回 404，不会在无域环境暴露必然失败的端点。
- **HTTPS**：生产环境已启用 `UseHttpsRedirection()` + `UseHsts()`；本地开发仍走 HTTP（不影响 localhost 调试）。部署到 App Service 时 TLS 在网关层终结，若出现重定向异常，检查平台的 HTTPS 端口 / 转发头配置。
- **JWT 存在 `localStorage`**：实现简单，但页面一旦存在 XSS，Token 就可能被脚本读取。若需要更强保证，建议改为 `HttpOnly` Cookie + CSRF 防护（需同步改刷新令牌的下发与校验路径）。

**架构层面：**

- **EF Migrations 已切换完成**：此前用 `EnsureCreated()` + 手写补表 SQL，现已切换为 baseline 迁移 + 启动自动 `Migrate()`，存量库自动平滑过渡。后续改表结构直接 `dotnet ef migrations add Xxx` 即可，但「启动时自动迁移」在生产多实例下有并发竞争的边界，单实例部署下无碍。
- **保存语义为整表替换**：`/api/excel/save` 会先删除该表所有行再插入，大数据量下有性能开销；已引入 `RowVersion` 乐观并发控制，多标签页/多人并发编辑同一张表时，后保存者会收到「表格已被其他人修改，请刷新后再保存」的提示并回滚，不再静默覆盖。
- **计算列不落库**：值是读取时按公式实时算的，所以不会与源数据不一致；代价是每次查询多一轮求值，且公式只能引用本行已有列（不支持跨行 / 跨表引用，也没有 `SUM` 这类聚合函数，聚合请用透视汇总）。
- **数据存在 JSON blob 中**：不支持 SQL 层的列级索引与聚合查询，所有筛选在应用内存中完成。适合中小规模数据集，**单表建议 ≤ 5 万行**。
- **上传/导入已设资源上限**：文件 ≤ 10MB、单表数据 ≤ 5 万行、列数 ≤ 200 列，超限会在上传阶段直接拒绝并返回明确提示（避免大文件全量进内存拖垮实例）。
- **无构建、无打包的前端**：改完刷新即可生效，但也意味着没有 tree-shaking / 模块隔离，靠 `CODE_STANDARDS.md` 的约束守门兜住「模块装配遗漏」这类问题。

---

## 许可

本项目以 **MIT 许可证** 开源，详见 [LICENSE](LICENSE)。

**注意**：MIT 只覆盖本仓库自身的源代码。项目依赖的 **EPPlus 8.x 采用 Polyform Noncommercial 许可证**，非商业使用免费，商业使用需单独获得授权。
