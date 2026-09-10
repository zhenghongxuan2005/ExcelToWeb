# ExcelToWeb

把 Excel 表格搬到浏览器里：上传 `.xlsx` 自动建表，在线编辑、规则校验、条件配色，再导出回 Excel —— 一套完整的「Excel → Web」轻量数据工具。

后端是 ASP.NET Core Web API + EF Core + SQL Server，前端是零依赖的原生 HTML/CSS/JavaScript，静态文件由后端直接托管，一条命令即可跑起来。

---

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [数据模型](#数据模型)
- [API 接口](#api-接口)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [使用流程](#使用流程)
- [已知限制与安全提醒](#已知限制与安全提醒)

---

## 功能特性

### 表格核心
- **Excel 导入**：读取首个工作表的表头与数据行，自动跳过空行，日期列自动从 Excel 序列号转换为 `yyyy-MM-dd`
- **在线编辑**：单元格级编辑、新增/删除行，前端状态管理 + 统一保存
- **按日期筛选**：`query` 接口支持 `date` 参数，自动匹配「日期 / 成交日期 / 创建时间 / 更新时间 / Date」等同义列名前缀
- **批量写入**：导入时通过原生 SQL 多值 `INSERT` 批量落库（每批 500 行循环，规避 SQL Server 2100 参数上限），避免逐行往返

### 导出
- **导出 Excel**（`.xlsx`，EPPlus 生成，自动列宽）
- **导出 CSV**（UTF-8 带 BOM，Excel 打开不乱码）
- **下载导入模板**：复用当前表头，附示例行、灰斜体提示与红色填写说明，第 4 行起填数据

### 规则引擎
- **条件配色规则**（`ColorRule`）：按列名 + 数值区间（`MinValue` ~ `MaxValue`，上界为空表示「以上」）绑定颜色（如 `#dc2626`），数据看板据此渲染红黄绿
- **数据校验规则**（`ValidationRule`）：支持 `Required` 必填、`DataType`（`text` / `number` / `date` / `email`）、数值区间、`MaxLength` 长度上限、`AllowedValues` 枚举白名单
- **带校验导入**：逐行校验并返回成功/失败行数及「第 N 行：具体原因」的错误清单，只有通过校验的行才进入可导入集合

### 认证
- **JWT 登录**：用户名 + 密码（仅字母数字，3–20 位），密码经 **PBKDF2-SHA256（10 万次迭代）** 加盐哈希存储，兼容旧版 SHA256 格式
- **Windows 集成认证**：`GET /api/auth/windows` 走 NTLM/Kerberos 协商，浏览器免密登录，首次访问自动建档（密码哈希置空，不可走密码登录）
- **数据隔离**：所有表格查询、保存、删除、导出均校验 `UserId` 归属

### 界面
- **六个页面**：`index.html` 表格编辑、`login.html` 登录注册、`tables.html` 表格管理、`dashboard.html` 数据看板、`settings.html` 设置、`help.html` 使用帮助
- **搜索 / 排序 / 分页**：全局搜索命中高亮；排序与分页只做显示层裁剪，不改写底层数据，编辑始终作用于真实行
- **列自定义**：按需隐藏列、调整列宽，偏好写入 `localStorage` 并在下次打开时恢复
- **选中统计**：勾选若干行后，对纯数字列自动求和 / 求平均
- **拖拽上传**：把 Excel 拖到页面上即可导入，与「上传 Excel」按钮共用同一套导入流程
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
| ORM | Entity Framework Core 10.0.10（SqlServer Provider） |
| 数据库 | SQL Server（`Microsoft.Data.SqlClient`） |
| 认证 | `Microsoft.AspNetCore.Authentication.JwtBearer` + `Negotiate` |
| Excel 读写 | EPPlus 8.7.0（原生 `net10.0` 目标框架），`ExcelPackage.License.SetNonCommercialPersonal(...)` 声明非商业用途 |
| API 文档 | Swashbuckle.AspNetCore 7.2.0（Swagger UI，仅开发环境启用） |
| 前端 | 原生 HTML / CSS / JavaScript，无构建步骤 |

---

## 项目结构

```
ExcelToWeb/
├── ExcelToWeb.slnx               # SLNX 格式解决方案（新版 Visual Studio 原生支持）
├── .gitattributes                # 行尾统一为 auto
├── .gitignore                    # 标准 VisualStudio 忽略规则（另含 .workbuddy/、*.sln 等本地文件）
├── LICENSE                       # MIT 许可证
├── README.md
└── ExcelToWeb/
    ├── Program.cs                # 应用入口：DI、认证、CORS、中间件管道、建库、EPPlus 许可
    ├── ExcelToWeb.csproj
    ├── appsettings.json          # 连接串、JWT 配置、日志
    ├── appsettings.Development.json
    ├── Properties/
    │   └── launchSettings.json   # http profile，端口 5185
    ├── Controllers/
    │   ├── AuthController.cs     # 注册 / 登录 / Windows 登录 / 当前用户 / 修改密码
    │   └── ExcelController.cs    # 表格 CRUD、导入导出、模板、重命名/复制、规则、校验导入
    ├── Services/
    │   ├── IExcelService.cs      # 对外的 Excel 服务契约
    │   ├── ExcelService.cs       # 门面：编排下列协作类，本身只做流程串联
    │   ├── TokenService.cs       # JWT 签发与用户 ID 提取
    │   └── Excel/                # Excel 协作类（按职责拆分，避免单文件膨胀）
    │       ├── ExcelSheetReader.cs    # xlsx 解析 → 表头 + 数据行
    │       ├── ExcelExportService.cs  # xlsx / csv 导出、导入模板生成
    │       ├── TableRepository.cs     # 动态表持久化（分批插入、整表替换、重命名、复制）
    │       ├── RowValidator.cs        # 按校验规则逐行校验
    │       └── RuleService.cs         # 配色规则 / 校验规则读写
    ├── Data/
    │   └── AppDbContext.cs       # DbSet 定义与实体映射（索引、精度、级联删除）
    ├── Models/
    │   ├── User.cs               # 用户
    │   ├── DynamicTable.cs       # 动态表 + DynamicRow
    │   ├── ColorRule.cs          # 条件配色规则
    │   ├── ValidationRule.cs     # 数据校验规则
    │   ├── ValidationResult.cs   # 校验结果（总/成功/错误行数 + 错误明细）
    │   └── ApiResponse.cs        # 统一响应包装（泛型 / 非泛型）
    ├── DTOs/
    │   └── Dtos.cs               # 请求/响应传输对象
    ├── Middleware/
    │   └── ExceptionMiddleware.cs# 全局异常捕获，统一返回 JSON 错误
    ├── Helpers/
    │   ├── ExcelHelper.cs        # 字符串清洗、日期列识别、CSV 转义、示例值
    │   └── PasswordHelper.cs     # PBKDF2 哈希与校验（兼容旧格式）
    └── wwwroot/                  # 前端静态资源（后端直接托管）
        ├── index.html            # 表格编辑页
        ├── login.html            # 登录 / 注册页
        ├── dashboard.html        # 数据看板页
        ├── tables.html           # 表格管理页（二级页面）
        ├── settings.html         # 设置页（二级页面）
        ├── help.html             # 使用帮助页（二级页面）
        ├── css/
        │   ├── style.css         # 入口：按顺序 @import 下列模块，层叠顺序即加载顺序
        │   ├── tokens.css        # 设计令牌（亮/暗）+ 全局重置 + 无障碍基础
        │   ├── layout.css        # 应用外壳：侧边栏（含折叠态）+ 主内容
        │   ├── toolbar.css       # 按钮、工具栏、下拉菜单
        │   ├── search.css        # 全局搜索框、列显示 / 列宽菜单
        │   ├── table.css         # 数据表格、可编辑单元格、统计栏、骨架屏
        │   ├── modal.css         # 弹窗、表单、规则表格、Toast
        │   ├── pages.css         # 登录页、看板页、响应式断点
        │   └── console.css       # 二级页面（表格管理 / 设置 / 帮助）
        └── js/                   # 按依赖顺序用 <script> 加载：shell→…→app
            ├── shell.js          # 页面外壳：图标 sprite、主题、导航高亮、侧边栏折叠、登出
            ├── api.js            # 统一 fetch 封装 + 全部接口调用
            ├── state.js          # 全局状态容器（须最先加载）
            ├── utils.js          # toast / 状态栏 / 通用格式化 / escapeHtml
            ├── view.js           # 搜索·排序·分页·列显隐管线
            ├── selection.js      # 选中行统计
            ├── history.js        # 撤销 / 重做
            ├── tables.js         # 表格列表、切换、删除、刷新
            ├── io.js             # 保存 / 导出 / 导出当前视图 / 下载模板
            ├── dnd.js            # 拖拽上传（与按钮上传共用同一导入流程）
            ├── render.js         # 表格渲染 + 加载骨架屏
            ├── edit.js           # 单元格编辑、增删行
            ├── filter.js         # 日期筛选
            ├── color-rules.js    # 条件配色规则
            ├── validation.js     # 数据校验规则
            ├── upload-validated.js # 带校验的导入
            ├── tables-page.js    # 表格管理页逻辑
            ├── settings.js       # 设置页逻辑
            ├── dashboard.js      # 看板图表
            └── app.js            # 应用初始化与页面编排（须最后加载）
```

---

## 数据模型

| 表 | 说明 | 关键字段 |
| --- | --- | --- |
| `Users` | 用户 | `Username`（唯一索引）、`PasswordHash`、`LastLoginAt` |
| `DynamicTables` | 动态表元数据 | `TableName`、`Headers`（JSON 数组，`nvarchar(max)`）、`UserId`（索引） |
| `DynamicRows` | 动态表数据行 | `TableId`（外键，级联删除）、`DataJson`（整行 JSON，`nvarchar(max)`） |
| `ColorRules` | 条件配色规则 | `UserId` + `ColumnName`（复合索引）、`MinValue` / `MaxValue`（`decimal(18,2)`）、`ColorCode` |
| `ValidationRules` | 数据校验规则 | `TableId`（索引）、`ColumnName`、`Required`、`DataType`、`MinValue` / `MaxValue`、`MaxLength`、`AllowedValues` |

**设计要点**：表结构是「动态」的 —— 不同 Excel 的列名各不相同，因此不生成物理列，而是把表头存为 JSON 数组、每行数据存为一行 JSON 记录。牺牲了 SQL 层面的列级查询能力，换来任意 Excel 结构即插即用。

数据库在应用启动时自动创建：`EnsureCreated()` 建库建表，随后用一段 `IF NOT EXISTS ... CREATE TABLE` 原生 SQL 补建 `ColorRules` 与 `ValidationRules`（因为 `EnsureCreated` 对已存在的库不会补建缺失表）。**首次运行无需手动执行任何 SQL 脚本。**

---

## API 接口

统一响应格式：

```json
{ "success": true, "message": "操作成功", "data": { } }
```

所有 `/api/excel/*` 接口均需在请求头携带 `Authorization: Bearer {token}`。

### 认证 `/api/auth`

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | 注册（用户名 3–20 位字母数字，密码 ≥ 6 位，两次一致） | 匿名 |
| `POST` | `/api/auth/login` | 登录，返回用户信息 + JWT | 匿名 |
| `GET` | `/api/auth/windows` | Windows 集成认证登录（NTLM/Kerberos 协商） | Negotiate |
| `GET` | `/api/auth/me` | 获取当前登录用户 | JWT |
| `POST` | `/api/auth/change-password` | 修改密码（校验原密码；Windows 建档账号无本地密码，不支持修改） | JWT |

### 表格 `/api/excel`

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/excel/upload` | `file`（multipart） | 上传 Excel，创建新表并导入全部数据 |
| `GET` | `/api/excel/query` | `tableId`、`date?` | 查询表数据，可选按日期前缀筛选 |
| `POST` | `/api/excel/save` | `{ tableId, rows[] }` | 保存数据（**先清空后写入**，整表替换语义） |
| `DELETE` | `/api/excel/delete` | `tableId` | 删除表格（级联删除数据行） |
| `PUT` | `/api/excel/rename` | `{ tableId, tableName }` | 重命名表格 |
| `POST` | `/api/excel/duplicate` | `{ tableId }` | 复制表格（含全部数据行），副本名自动去重为「- 副本」「- 副本(2)」… |
| `GET` | `/api/excel/tables` | — | 当前用户的表格列表（按时更新时间倒序，仅返回有数据的表） |
| `GET` | `/api/excel/export` | `tableId` | 导出 `.xlsx` |
| `GET` | `/api/excel/export-csv` | `tableId` | 导出 `.csv`（UTF-8 BOM） |
| `GET` | `/api/excel/template` | `tableId` | 下载导入模板 `.xlsx` |

### 规则与校验

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/excel/rules` | `columnName?` | 查询配色规则（可按列过滤） |
| `POST` | `/api/excel/rules` | `ColorRule[]` | 保存配色规则（按 `rules[0].ColumnName` 整列替换） |
| `GET` | `/api/excel/validation-rules` | `tableId` | 查询某表的校验规则 |
| `POST` | `/api/excel/validation-rules` | `ValidationRule[]` | 保存校验规则（按 `rules[0].TableId` 整表替换） |
| `POST` | `/api/excel/upload-with-validation` | `file` + `tableId` | 按已有规则校验后导入，返回成功/失败行数与错误明细 |

> 未配置校验规则时，`upload-with-validation` 直接放行全部数据行。

---

## 快速开始

### 前置条件

- [.NET SDK 10.0](https://dotnet.microsoft.com/download) 或 Visual Studio 2022 17.x+
- SQL Server（Express 或更高版本均可）。默认连接串指向 `localhost\SQLEXPRESS01`

### 1. 配置数据库连接

编辑 `ExcelToWeb/appsettings.json`，改成你本机的实例名与数据库名：

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=localhost\\SQLEXPRESS01;Database=ExcelToWebDB;Trusted_Connection=True;TrustServerCertificate=True;"
  }
}
```

连接串使用 `Trusted_Connection=True`（Windows 身份验证），无需填写账号密码。若使用 SQL 账号登录，改为：

```
Server=localhost;Database=ExcelToWebDB;User Id=sa;Password=你的密码;TrustServerCertificate=True;
```

### 2. 配置 JWT 密钥

JWT 签名密钥**不随仓库分发**，用 .NET 用户机密（User Secrets）保存在本机 —— 它存放在项目目录之外，永远不会被提交：

```bash
dotnet user-secrets set "Jwt:Key" "<你的随机密钥，建议 48 字节 Base64>" --project ExcelToWeb
```

`appsettings.json` 里的 `Jwt:Key` 只是占位值。未配置用户机密时应用仍能启动，但会用占位值签名，请务必先执行上面的命令。更换密钥后，此前签发的所有 Token 立即失效，需要重新登录。

### 3. 运行

```bash
# 在解决方案根目录
dotnet run --project ExcelToWeb
```

或直接用 Visual Studio 打开 `ExcelToWeb.slnx` 后按 F5。

应用监听 **http://localhost:5185**（由 `Program.cs` 中 `UseUrls` 兜底，端口优先级见下方「配置说明」）。数据库与所有表会在首次启动时自动创建。

### 4. 访问

| 地址 | 用途 |
| --- | --- |
| http://localhost:5185/ | 表格编辑页（静态首页，未登录会跳登录） |
| http://localhost:5185/login.html | 登录 / 注册 |
| http://localhost:5185/tables.html | 表格管理（列表、重命名、复制、删除） |
| http://localhost:5185/dashboard.html | 数据看板 |
| http://localhost:5185/settings.html | 设置（修改密码、界面偏好） |
| http://localhost:5185/help.html | 使用帮助 |
| http://localhost:5185/swagger | Swagger UI（**仅开发环境**） |

先在登录页注册一个账号，再登录使用。

> 想以单个 exe 形式运行（内容根=bin 目录）也没问题：`.csproj` 中已配置 `wwwroot` 随生成复制，静态文件照常可访问。

---

## 配置说明

`appsettings.json`：

| 键 | 说明 |
| --- | --- |
| `ConnectionStrings:DefaultConnection` | SQL Server 连接串 |
| `Jwt:Key` | HMAC-SHA256 签名密钥，**长度需 ≥ 32 字符**，缺失会直接启动失败。仓库内为占位值，真实密钥通过 `dotnet user-secrets` 或环境变量 `Jwt__Key` 注入 |
| `Jwt:Issuer` / `Jwt:Audience` | 签发者与受众，校验时需一致 |
| `Jwt:ExpireMinutes` | Token 有效期，默认 `1440`（24 小时） |
| `Cors:AllowedOrigins` | 允许跨域的来源数组。**开发环境忽略此项**（一律放开，便于 `file://` 或独立前端 dev server 调试）；生产环境只放行此处列出的来源，留空则不启用跨域（前端由本应用同源托管，通常无需配置） |
| `Logging:LogLevel` | 日志级别 |

端口由 `Program.cs` 中的 `UseUrls` 固定为 5185。注意它**优先于** `ASPNETCORE_URLS` 环境变量；要改端口请改 `launchSettings.json` 的 `applicationUrl`（`dotnet run` 时以命令行参数注入，可覆盖 `UseUrls`）。

EPPlus 的许可通过 `ExcelPackage.License.SetNonCommercialPersonal("…")` 声明为**非商业个人使用**（EPPlus 7+ 已移除旧的 `LicenseContext` 属性，旧写法会编译失败）；若用于商业场景，需自行购买 EPPlus 商业许可证并改用 `SetCommercial(key)`。

Swagger UI 仅在**开发环境**启用，生产环境访问 `/swagger` 返回 404。

---

## 使用流程

1. **注册 / 登录** → 获取 JWT，存入 `localStorage`
2. **上传 Excel** → 自动解析表头与数据行，创建动态表
3. **在线编辑** → 修改单元格、增删行，点击保存
4. **配置规则**（可选）
   - 配色规则：让某列数值区间显示红 / 黄 / 绿
   - 校验规则：约束必填、类型、范围、长度、枚举值
5. **校验导入**（可选）→ 用已有规则校验新 Excel，查看错误明细，仅导入合法行
6. **导出** → 下载 `.xlsx` / `.csv`，或下载模板分发给填报人

---

## 已知限制与安全提醒

**已完成的安全加固：**

- **JWT 密钥已移出仓库**：`appsettings.json` 中只保留占位值，真实密钥通过用户机密 / 环境变量注入。⚠️ 需注意 git **历史**里仍残留一个早期提交的明文旧密钥 —— 该密钥已轮换失效，但若要让仓库历史也干净，需用 `git filter-repo` 或 BFG 重写历史并强推。
- **CORS 已按环境区分**：开发环境仍放开（`AllowAnyOrigin`，便于本地调试）；生产环境只放行 `Cors:AllowedOrigins` 中显式配置的来源，未配置即不启用跨域。正式上线前记得填白名单。
- **异常信息已按环境收敛**：生产环境只返回 `服务器内部错误，请稍后重试（追踪号：xxx）`，异常明细仅写服务端日志；开发环境保留明细便于排查。顺带修正了一处 JSON 大小写缺陷 —— 原先该中间件用默认序列化输出 PascalCase（`Success`/`Message`），与 MVC 的 camelCase 不一致，导致前端拿不到 `result.message`，错误提示丢失。
- **`.gitignore` 已补充** `.workbuddy/` 与 `appsettings.*.local.json`。
- **依赖漏洞已根除**：原先 EPPlus 6.0.3 会传递引入 `System.Drawing.Common` 5.0.0，触发 `NU1904`（GHSA-rxg9-xrhp-64gj / CVE-2021-24112，严重级）。已升级到 **EPPlus 8.7.0**，该版本不再依赖 `System.Drawing.Common`，依赖图中已无易受攻击的包（`dotnet list package --vulnerable --include-transitive` 返回空），构建 0 警告。

**仍需注意：**

- **Windows 集成认证**需服务端与客户端处于同一域（或受信任域）才有意义；跨域裸机环境请只使用 JWT 登录。
- **未启用 HTTPS 重定向**，示例仅监听 HTTP。

**架构层面：**

- **无 EF Core Migrations**：用 `EnsureCreated()` + 手写补表 SQL。好处是开箱即用，代价是**无法通过迁移升级已存在数据库的结构**。若后续要改表结构，建议切换为 Migrations。
- **保存语义为整表替换**：`/api/excel/save` 会先删除该表所有行再插入，大数据量下有性能与并发覆盖风险；并发编辑同一张表时后保存者覆盖先保存者。
- **数据存在 JSON blob 中**：不支持 SQL 层的列级索引与聚合查询，所有筛选在应用内存中完成。适合中小规模数据集。
- **上传未限制文件大小**：建议在 Kestrel 或反向代理层补充 `MaxRequestBodySize` 限制。

---

## 许可

本项目以 **MIT 许可证** 开源，详见 [LICENSE](LICENSE)。

**注意**：MIT 只覆盖本仓库自身的源代码。项目依赖的 **EPPlus 8.x 采用 Polyform Noncommercial 许可证**，非商业使用免费，商业使用需单独获得授权。
