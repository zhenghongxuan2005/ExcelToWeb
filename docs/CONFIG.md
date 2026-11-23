# 配置说明与常见问题

所有可配项的默认值、改法与影响；末尾是开发时最常撞见的几个问题。

> 返回 [README](../README.md)

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

## 容器化部署

本地跑、零成本公网演示（GitHub Codespaces / 内网穿透）、云服务器长期挂——三种形态的完整步骤、
内存与镜像拉取的坑、公网暴露前的检查清单，见 **[DEPLOY.md](DEPLOY.md)**。
下面只留最短路径。

### 方式一：本地一键起（Docker Compose，推荐先走这条）

不需要预先安装 SQL Server —— 一条命令把应用和数据库都起来：

```bash
cp .env.compose.example .env
# 编辑 .env：改掉 SQL_SA_PASSWORD，把 JWT_KEY 换成一串 ≥32 位的随机值
#   生成：openssl rand -base64 32
docker compose up -d --build
```

打开 <http://localhost:8080>。首次启动 SQL Server 需要 40~60 秒，`web` 容器会等数据库**真正能执行查询**之后才启动（健康检查跑的是 `SELECT 1`，不是只探端口），所以这段时间 `docker compose ps` 里 `web` 显示 `Created` 是正常现象。

```bash
docker compose ps                              # sqlserver 应为 healthy
docker compose logs -f web                     # 观察迁移与演示账号播种日志
curl -fsS http://localhost:8080/health/ready   # 就绪探针，返回 200 即数据库已通
docker compose down                            # 停止；加 -v 则连数据卷一起删除
```

几点说明：

- 应用启动时**自动**执行 EF 迁移、播种演示账号、开启 RCSI，不需要手工建库或跑 SQL 脚本
- 数据存放在命名卷 `mssql-data` 里，`docker compose down` 不会丢；要彻底重置用 `down -v`
- Data Protection 密钥单独存在 `dp-keys` 卷里：不挂卷的话容器一重建就换密钥，已签发的保护数据全部失效
- 应用日志同时写 stdout 与容器内 `logs/`，`docker compose logs -f web` 直接可看（只写文件时 `docker logs` 是空的，这个坑跑一次才发现）
- SQL Server 容器至少需要 2GB 内存，Docker Desktop 分配不足时会启动即退出
- `.env` 已加入 `.gitignore`，密码与密钥不会进仓库；模板 `.env.compose.example` 才入库
- 模板里的 `JWT_KEY` 故意以 `CHANGE_ME_` 开头：不改就会启动失败并提示密钥不合规。这是刻意设的闸门，避免有人拿着公开仓库里的默认密钥直接跑起来
- 容器内是 Linux，没有 Negotiate，`Auth__EnableWindows` 固定为 `false`，走账号密码登录

### 方式二：云平台（Azure Container Apps / App Service）

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

## 健康检查（平台探活）

应用内置两个探活端点，职责刻意分离：

| 端点 | 用途 | 判定逻辑 |
| --- | --- | --- |
| `/health` | **存活探针**（liveness） | 不执行任何检查，进程活着即 200。数据库闪断不会导致容器被平台反复重启 |
| `/health/ready` | **就绪探针**（readiness） | 执行 `SELECT 1` 验证 SQL Server 连通性，失败返回 503 |

Azure 上的接入方式：App Service「运行状况监视」的常规探测路径填 `/health`；「运行状况检查（Health Check）」功能与 Container Apps 的就绪探针填 `/health/ready`。容器镜像内置 `HEALTHCHECK` 指令（探 `/health`），`docker run` 后约 30 秒起可通过 `docker inspect --format "{{.State.Health.Status}}"` 观察。

---

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
