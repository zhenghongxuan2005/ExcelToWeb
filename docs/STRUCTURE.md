# 项目结构与数据模型

想改代码的人从这里看起：目录分工、以及三类核心表（用户 / 表格 / 行数据）的关系。

> 返回 [README](../README.md)

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
    │       ├── AuditService.cs          # 审计日志写入与跨表查询
    │       ├── DemoWriteGuard.cs        # 演示账号只读拦截（服务端强制）
    │       └── RowPayloadGuard.cs       # 整表保存守门：拒绝空行集与未知列
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

> 前端新增 JS 模块需要四处登记：`index.html` 的 `<script>` 顺序、`app.js` 的 `Object.assign(window, {…})`（内联 `onclick` 能调用到）、`Esc` 关闭列表，以及 `tests/frontend/wire_check.js` 的接线检查。改任何文件前先读 [CODE_STANDARDS.md](../CODE_STANDARDS.md)。

---

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
