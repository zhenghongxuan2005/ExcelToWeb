# ExcelToWeb 项目升级方案

> 面向求职作品集 + Azure 部署目标的升级规划（2026-10-08）
> 前提：P0/P1/P2 三轮安全与质量修复已闭环，26 项测试全绿，Dockerfile 已具备但未实测。

---

## 一、现状总结

项目已是一个功能完整度相当高的全栈应用：Excel 导入（动态建表）、在线网格编辑（撤销/填充柄/查找替换/合并单元格）、计算列（自研词法/语法/求值四件套）、校验规则、条件配色、透视汇总（单一计算来源）、xlsx/csv 导出、审计日志、JWT + Windows 双认证、乐观并发、按 IP 分区限流。架构上 Controller → 门面 ExcelService → 14 个协作类的分层干净，无循环依赖，归属校验全覆盖。真正的短板在**工程化链路**：没有 .NET 单元测试工程（测试只有 Python 黑盒 + Node 前端桩）、没有 CI、EnsureCreated 替代 Migrations 的技术债未还、没有健康检查（Azure 探活没东西可探）、Dockerfile 从未实际构建验证过、JWT 无刷新/吊销机制、整表全量读写决定了数据规模上限。另外从求职角度缺一个「 recruiter 不用注册就能点开看」的演示入口。

---

## 二、功能添加清单

### P0 必须做

#### 功能 1：xUnit 后端单元测试工程
- 功能描述：新建 `ExcelToWeb.Tests` 测试工程，为不依赖数据库的纯逻辑类补齐单元测试。
- 技术要点：
  - 首选目标全是纯函数/纯类，零 mock 成本：`FormulaLexer` / `FormulaParser` / `FormulaEvaluator`（词法→AST→求值）、`PivotService`（分组/聚合/排序口径）、`RowValidator`（校验规则）、`ExcelNumber`（数值/日期口径）、`PasswordHelper`（PBKDF2 + 旧哈希升级）、`TokenService`（签发与 claims）。
  - 现有 Python 黑盒套件保留不动，形成「单元测试守逻辑、Python 套件守集成」的双层结构，README 里画出测试金字塔。
  - 涉及文件：新建 `ExcelToWeb.Tests/ExcelToWeb.Tests.csproj` + 每类一个 `*Tests.cs`；`ExcelToWeb.sln` 登记。
- 预计工作量：**中**（2-3 天，公式引擎和透视是既有断言的迁移，写起来快）
- 面试价值：**极高**。新加坡面试官几乎必问 "How do you test your code?"。可答：为什么纯逻辑类优先（无 DbContext 依赖、不用 mock）、为什么保留黑盒套件（集成路径覆盖）、测试金字塔的取舍。公式引擎四件套本身就是展示 TDD 素材的绝佳案例。

#### 功能 2：GitHub Actions CI 流水线
- 功能描述：push/PR 自动执行：dotnet build → xUnit → 约束守门脚本 → Python 集成套件 → 前端 Node 用例。
- 技术要点：
  - `.github/workflows/ci.yml`：windows-latest runner（项目用 SQL Server LocalDB/Trusted_Connection，Windows runner 最省事）；或 ubuntu + SQL Server 容器服务，连接串改环境变量——后者更能体现容器化能力，推荐后者。
  - 集成套件需要真实服务：CI 里 `dotnet run` 后台起服务、等 5185 探活、再跑 `tests/run.py`，与本机流程一致。
  - 加 build status badge 到 README 顶部。
  - 涉及文件：新建 `.github/workflows/ci.yml`；README.md。
- 预计工作量：**中**（1-2 天，主要是调试 runner 上的 SQL Server 与端口）
- 面试价值：**极高**。"Walk me through your CI pipeline" 是 DevOps 方向标配问题；讲清楚每个 gate 的顺序理由（守门脚本最先，失败成本最低）就是架构思维。

#### 功能 3：健康检查端点 + Docker 冒烟验证
- 功能描述：加 `/health`（liveness）和 `/health/ready`（readiness，含 SQL Server 连通性检查），并实际 `docker build` + `docker run` 验证一遍部署链路。
- 技术要点：
  - `Program.cs`：`builder.Services.AddHealthChecks().AddSqlServer(connStr)`（包 `AspNetCore.HealthChecks.SqlServer`），`app.MapHealthChecks("/health")`；readiness 单独路径。
  - Dockerfile 加 `HEALTHCHECK` 指令；README 的 Azure 章节补上 App Service 探活路径配置。
  - 本地实测：`docker build -t excel-to-web .` → 起 SQL Server 容器 → `docker run` 注入 `Jwt__Key` / `ConnectionStrings__DefaultConnection` → 跑冒烟脚本。这一步**必然暴露新问题**（此前 P1 的 Linux 换行符 bug 就是同类型），把它当作一次部署演习。
- 涉及文件：`Program.cs`、`.csproj`（加包）、`Dockerfile`、README.md。
- 预计工作量：**小**（半天到一天，含 Docker 实测）
- 面试价值：**高**。直接接 P1 修复的故事："我发现硬编码 UseUrls 会导致平台探活失败，于是加了健康检查并完整演练了容器部署"。liveness vs readiness 的区别本身就是高频考点。

### P1 强烈建议

#### 功能 4：EF Core Migrations 切换（偿还最大架构债）
- 功能描述：`EnsureCreated()` + 手写幂等 DDL 切换为正式 Migrations，把手写 SQL 收编进一个 baseline 迁移。
- 技术要点：
  - `dotnet ef migrations add Baseline --project ExcelToWeb`；已有数据库用 `__EFMigrationsHistory` 手工插入 baseline 记录（或空迁移占位）实现平滑过渡。
  - `Program.cs` 启动块改为 `Database.Migrate()`，删除 `EnsureCreated()` 与全部 `IF COL_LENGTH(...) IS NULL` 手写 DDL。
  - 保留「启动时自动迁移」这个行为并写进 README——这本身就是面试讨论点（自动迁移的利弊）。
- 涉及文件：`Program.cs`、`Data/AppDbContext.cs`、新建 `Data/Migrations/`。
- 预计工作量：**中**（1-2 天，存量库平滑过渡是要小心验证的部分）
- 面试价值：**极高**。这是项目里最大的一笔技术债，主动还掉它 = 直接展示「识别债务→评估风险→平滑迁移」的完整工程决策链，比任何新功能都有说服力。

#### 功能 5：演示模式（Demo 账号 + 只读数据）
- 功能描述：登录页加「演示账号一键进入」，预置 2-3 张有看点的样例表（销售数据、项目排期），演示账号只读（保存/删除/导入接口对 demo 用户返回 403 并提示）。
- 技术要点：
  - 启动时 seed：检查 demo 用户不存在则创建并导入样例 xlsx（放 `ExcelToWeb/Samples/`）。
  - 只读实现：在 `ExcelService` 门面入口或 `ExcelController` 的写操作上检查 `User.IsInRole("demo")` / username 约定，一处拦截即可——门面层拦更干净。
  - 前端：登录页加按钮；编辑器对 demo 会话把保存按钮置灰并提示。
- 涉及文件：`Program.cs`（seed）、`Services/ExcelService.cs`、`wwwroot/login.html`、`wwwroot/js/`（登录与编辑器入口）。
- 预计工作量：**中**（1 天）
- 面试价值：**高（产品思维维度）**。recruiter 和 hiring manager 点开链接 30 秒内看到完整功能，作品集转化率完全不同。面试可讲 "I optimized the demo path for evaluators"，这是 senior 才有的用户视角。

#### 功能 6：JWT 刷新令牌 + 会话吊销
- 功能描述：access token（短效，如 2h）+ refresh token（长效、落库、可吊销）；settings 页显示「活跃会话」并支持逐个注销。
- 技术要点：
  - 新表 `RefreshTokens`（UserId、TokenHash、ExpiresAt、RevokedAt、CreatedByIp）；`TokenService` 扩展签发/轮换/吊销逻辑；`AuthController` 加 `/api/auth/refresh`、`/api/auth/logout`。
  - 轮换策略：refresh 时旧 token 立即吊销并签发新对（rotation），检测到已吊销 token 被重用则整族吊销（reuse detection）——这是 RFC 6819 推荐做法，讲出来就是深度。
  - 前端 `api.js` 的 `request()` 遇到 401 先静默 refresh 再重放原请求。
- 涉及文件：`Models/RefreshToken.cs`（新）、`Services/TokenService.cs`、`Controllers/AuthController.cs`、`Data/AppDbContext.cs`、`wwwroot/js/api.js`。
- 预计工作量：**中-大**（2-3 天）
- 面试价值：**极高**。"Your JWT expires in 24h — what happens when it leaks?" 是安全面高频题；rotation + reuse detection 是能直接把回答拉到 senior 水平的细节。

#### 功能 7：结构化日志 + Azure 可观测性
- 功能描述：引入 Serilog（结构化 JSON 日志），关键路径（导入行数、保存耗时、并发冲突、限流拒绝）打结构化事件；部署后接 Application Insights。
- 技术要点：
  - `Program.cs`：`builder.Host.UseSerilog(...)`，Development 输出 console、Production 输出 JSON。
  - 埋点重点选**能讲故事的**：`ConcurrencyConflictException` 被吞了多少次（证明乐观并发真的在工作）、导入每批 500 行的耗时分布。
  - Azure 侧：App Service 加 `ApplicationInsights:ConnectionString`，`builder.Services.AddApplicationInsightsTelemetry()`。
- 涉及文件：`Program.cs`、`.csproj`、`Services/Excel/TableRepository.cs`、`Services/Excel/TableImportService.cs`。
- 预计工作量：**中**（1-2 天）
- 面试价值：**高**。"How do you know your app is healthy in production?"——日志、指标、追踪三板斧是运维面必答，有真实埋点截图放 README 更加分。

### P2 有时间再做

#### 功能 8：CSV 导入
- 功能描述：上传除 .xlsx 外支持 .csv（自动识别编码 UTF-8/GBK、首行表头）。
- 技术要点：`ExcelSheetReader` 旁加一个 `CsvSheetReader`，`TableImportService.ValidateFile` 白名单加 `.csv`，导入编排复用。
- 涉及文件：新建 `Services/Excel/CsvSheetReader.cs`、`TableImportService.cs`、前端 3 个上传入口的 accept 判断。
- 预计工作量：**小**
- 面试价值：**中**。价值在「编码嗅探、分隔符兼容」这些细节题，功能本身不惊艳。

#### 功能 9：表格回收站（软删除）
- 功能描述：删表进回收站，30 天内可恢复，过期物理清除。
- 技术要点：`DynamicTable` 加 `DeletedAt`（可空），`TableRepository` 查询统一加过滤；后台定时清理由一个简单 `BackgroundService` 或手动触发完成（别上 Hangfire，杀鸡用牛刀）。
- 涉及文件：`Models/DynamicTable.cs`、`Services/Excel/TableRepository.cs`、新页面（见页面清单）。
- 预计工作量：**中**
- 面试价值：**中**。软删除 vs 硬删除的取舍（索引、唯一约束污染）是不错的讨论点，但功能深度一般。

#### 功能 10：API 错误响应统一为 ProblemDetails
- 功能描述：所有错误响应遵循 RFC 7807（`application/problem+json`），`ExceptionMiddleware` 与 4xx 统一出口。
- 涉及文件：`Middleware/ExceptionMiddleware.cs`、`Program.cs`（`AddProblemDetails()`）。
- 预计工作量：**小**
- 面试价值：**中低**。规范正确但话题浅，适合顺手做。

---

## 三、二级页面添加清单

### P0 必须做

（现有 6 个页面已覆盖核心流程，无 P0 级新页面；演示模式涉及的登录页改造已并入功能 5。）

### P1 强烈建议

#### 页面 1：审计中心 `audit.html`
- 页面功能：跨全部表格的审计时间线——按表格/操作类型/时间范围筛选，支持跳转回对应表格。当前审计只能以弹窗形式看「单表」历史，跨表视角缺失。
- 与现有页面的关系：后端 `/api/excel/audit-logs` 已存在（`AuditService` 已支持按表过滤），前端 `audit.js` 是编辑器内弹窗；本页是同一数据源的第二种视图，复用 `fetchAuditLogs` API。
- 前后端改动：后端需给 audit-logs 加分页/筛选参数（当前疑似整取）；前端新建 `audit.html` + `audit-page.js`（弹窗版 `audit.js` 保留不动）。
- 预计工作量：**中**
- 面试价值：**中高**。讲「同一份数据、两种视图密度」的 UX 取舍，以及审计数据不可变（append-only）的设计。

#### 页面 2：看板增强（优化现有 `dashboard.html`）
- 页面功能：修复一个真实缺陷——当前 `dashboard.js` 硬取 `tables[0]`，**只能看第一张表**。加表格选择器、指标/维度自由组合、图表类型切换。
- 与现有页面的关系：纯前端增强，数据源复用 `/api/excel/query`；不改后端。
- 前后端改动：`dashboard.html` + `dashboard.js`。
- 预计工作量：**小-中**
- 面试价值：**中**。这是「修自己产品的缺陷」，可以在面试里坦诚讲："dashboard 最初只支持第一张表，用户反馈后我做了选择器"——展示迭代思维。

#### 页面 3：回收站 `trash.html`
- 页面功能：列出已删除表格（删除时间、行数），支持恢复/彻底删除。
- 与现有页面的关系：依赖功能 9（软删除）；`tables.html` 是「活的表」，本页是「死的表」，导航互为入口。
- 前后端改动：后端 `TableRepository` 加回收站查询/恢复接口；前端新页面 + `tables.js` 删除按钮改为软删除。
- 预计工作量：**中**（含功能 9）
- 面试价值：**中**。

#### 页面 4：设置页安全分区扩展（优化现有 `settings.html`）
- 页面功能：新增「登录安全」分区——显示活跃会话列表（设备/IP/最后活跃），支持注销单个会话。
- 与现有页面的关系：依赖功能 6（refresh token 落库才有会话可管）；`settings.js` 已按分区组织（账号/密码/偏好/关于），加一个分区即可。
- 前后端改动：后端 `AuthController` 加 `/api/auth/sessions`（GET/DELETE）；前端 `settings.html` + `settings.js`。
- 预计工作量：**小**（功能 6 完成后的增量）
- 面试价值：**中高**。GitHub/Google 风格的会话管理是用户能直观感知的安全能力。

### P2 有时间再做

#### 页面 5：帮助中心重构（优化现有 `help.html`）
- 页面功能：从静态说明升级为带锚点导航、快捷键速查表（项目已有完整键盘操作体系 `keyboard.js`，值得一张速查卡）、GIF/截图演示。
- 前后端改动：纯前端。
- 预计工作量：**小**
- 面试价值：**低**。纯打磨，面试讲不出东西，但对 recruiter 体验友好。

---

## 四、分阶段实施路线图

### 阶段一（第 1-2 周）：工程化地基
- 目标：把「能跑」变成「可持续交付」——测试、CI、部署探活。
- 任务清单（按序）：
  1. 功能 3 健康检查 + Docker 冒烟（先做，暴露的部署问题越早知道越好）
  2. 功能 1 xUnit 测试工程
  3. 功能 2 GitHub Actions CI（依赖 1，CI 里跑 xUnit）
  4. 顺手提交此前的四轮修复（按此前建议的分批切分）
- 依赖关系：1 独立；2 独立；3 依赖 2。
- 验证标准：`docker build` 成功且容器内 `/health/ready` 返回 200；`dotnet test` 本地与 CI 双绿；README 出现绿色 CI badge；测试金字塔图进 README。

### 阶段二（第 3-4 周）：还债与产品化
- 目标：还掉最大架构债，同时把作品集的「可演示性」拉满。
- 任务清单（按序）：
  1. 功能 4 EF Migrations 切换（含存量库平滑过渡演练：先在副本库上验证）
  2. 功能 5 演示模式（recruiter 入口）
  3. 页面 2 看板表选择器（修真实缺陷）
  4. 页面 1 审计中心（依赖审计接口分页参数，可与 3 并行）
- 依赖关系：1 独立但要先备份数据库演练；2 独立；3、4 独立可并行。
- 验证标准：存量数据库 `dotnet ef database update` 后结构不变且 26 项测试仍全绿；演示链接无注册可看全功能；dashboard 可切换任意表。

### 阶段三（第 5-6 周）：安全纵深与可观测
- 目标：把安全故事从「修过漏洞」升级到「体系化设计」。
- 任务清单（按序）：
  1. 功能 6 刷新令牌 + 会话吊销
  2. 页面 4 会话管理分区（依赖 1）
  3. 功能 7 Serilog + App Insights
  4. 部署到 Azure App Service（容器）+ Azure SQL 正式环境，写部署复盘进 README
- 依赖关系：2 依赖 1；3、4 独立，4 建议最后做（前面所有改动一起上生产）。
- 验证标准：access token 过期后无感刷新；吊销 refresh token 后 5 分钟内会话失效；App Insights 里能看到导入/保存的结构化日志与耗时；生产环境 26 项测试指向 Azure 实例仍通过（至少冒烟子集）。

---

## 五、风险与取舍

### 不建议现在做的功能及原因
- **SignalR 多人实时协同编辑**：技术炫酷，但整表替换的保存语义与协同编辑根本冲突，等于重写数据模型；且面试官深挖「冲突解决算法（OT/CRDT）」时极易翻车。**讲不出深度反而暴露短板，典型的高风险低回报。**
- **微服务拆分 / 引入 Redis / 消息队列**：单用户量级的工具型应用，拆出去每一刀都是负资产。面试官问 "为什么不用微服务" 时，「规模未到、单体模块化足够」本身就是正确答案。
- **用 React/Vue 重写前端**：现有原生 JS 模块化体系（34 个模块 + wire_check 约束）是项目特色之一，重写等于丢掉差异化资产，还讲不出「为什么值得重写」。
- **Hangfire/Quartz 定时任务框架**：回收站清理用 `BackgroundService` 够了，上框架是为了用而用。
- **AI 智能分析套壳**（接 LLM 解读表格）：在新加坡 JD 里确实热，但浅层套壳人人都做；除非做成「自然语言转透视配置」且复用现有 PivotService 单一计算来源，否则是减分项。

### 容易踩坑的地方
- **EF Migrations 平滑过渡**：存量库必须先在副本上演练 `__EFMigrationsHistory` 手工对齐，直接切换会试图重建已有表。
- **CI 里 SQL Server**：ubuntu runner 用 SQL Server 容器服务时注意连接串认证方式要从 `Trusted_Connection` 切到 `User ID=sa;Password=...`，这块建议抽成配置而非改代码。
- **Refresh token 的 api.js 静默刷新**：并发多个 401 时要做单例刷新（promise 去重），否则会连环刷新把 rotation 机制打坏。
- **演示账号的只读拦截**：必须在服务端门面层拦，只置灰前端按钮等于没做。
- **健康检查别把 SQL 检查挂到 liveness**：数据库闪断会导致容器被反复重启（liveness 应只反映进程自身健康）。

### 优先级调整建议
- 如果时间只够做三件事：**功能 1（xUnit）→ 功能 2（CI）→ 功能 4（Migrations）**。这三件组合起来讲的故事是「我把一个能跑的 demo 升级成了有工程保障的项目」，比堆十个新功能更有说服力。
- 如果目标是快速让 recruiter 眼前一亮：功能 5（演示模式）提到最高优先级，配合部署上线（阶段三的 Azure 部署可以提前），一个能点的链接胜过 README 里的一万字。
- 功能 6（刷新令牌）与功能 7（可观测性）是面试深度担当，但用户无感知，安排在最后、时间紧可砍功能 7 的 App Insights 部分（保留 Serilog 结构化日志）。
