# 本地部署教程

从零到浏览器里能打开，全程约 15 分钟。每一步都写了「看到什么算成功」，卡住了直接看最后一节。

---

## 一、装两个软件

| 软件 | 作用 | 下载地址 |
| --- | --- | --- |
| **.NET SDK 10.0** | 运行这个程序 | <https://dotnet.microsoft.com/download/dotnet/10.0> |
| **SQL Server Express 2022** | 存数据 | <https://www.microsoft.com/sql-server/sql-server-downloads> |

安装时注意三点：

1. .NET SDK 装完**重开一个命令行窗口**，否则 `dotnet` 命令找不到
2. SQL Server 选「基本」安装即可，默认实例名是 `SQLEXPRESS`
3. 不想单独装 SQL Server 的话，Visual Studio 自带的 **LocalDB** 也能用（第三步有对应写法）

装完验证一下：

```bash
dotnet --version
```

看到 `10.0.x` 就算好了。

---

## 二、拿到代码

```bash
git clone https://github.com/zhenghongxuan2005/ExcelToWeb.git
cd ExcelToWeb
```

没装 git 就在仓库页面点 `Code → Download ZIP`，解压后进入目录，效果一样。

---

## 三、改数据库连接串

用记事本或 VS Code 打开 `ExcelToWeb/appsettings.json`，找到这一段：

```json
"ConnectionStrings": {
  "DefaultConnection": "Server=localhost\\SQLEXPRESS01;Database=ExcelToWebDB;Trusted_Connection=True;TrustServerCertificate=True;"
}
```

**只需要改 `Server=` 那一段**，换成你自己的实例名：

| 你的情况 | 改成 |
| --- | --- |
| 装了 SQL Server Express，用默认实例 | `Server=localhost\\SQLEXPRESS;...` |
| 实例名就是 SQLEXPRESS01（本仓库开发机的配置） | 保持不变 |
| 用 Visual Studio 自带的 LocalDB | `Server=(localdb)\\MSSQLLocalDB;...` |
| 用 SQL 账号密码登录（非 Windows 环境） | `Server=localhost;Database=ExcelToWebDB;User Id=sa;Password=你的密码;TrustServerCertificate=True;` |

`Database=ExcelToWebDB` **不用改** —— 第一次启动时会自动建库、建表、灌演示数据。

> 不知道实例名？开始菜单搜 `SQL Server 配置管理器`，或在命令行执行 `sqlcmd -L` 能看到本机实例列表。

---

## 四、配置 JWT 密钥

```bash
dotnet user-secrets set "Jwt:Key" "<一串随机字符，48 位以上>" --project ExcelToWeb
```

生成随机串（PowerShell）：

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))
```

这个密钥**不写在代码里**，存在你的用户目录，不会随仓库提交。少了它程序会直接报 `Jwt:Key 未配置` 并退出——这是刻意的，避免密钥被误传上网。

---

## 五、运行

```bash
dotnet run --project ExcelToWeb
```

首次启动会依次做三件事，看到这些就是正常的：

```
info: Microsoft.EntityFrameworkCore.Migrations[...] Applying migration '20261013072308_Baseline'
...
Now listening on: http://localhost:5185
Application started. Press Ctrl+C to shut down.
```

之后再用就不用重新建库了，启动只要几秒。

---

## 六、打开浏览器

访问 <http://localhost:5185>，会跳到登录页。两种进去的方式：

- 点 **「一键体验演示账号（只读）」** —— 不用注册，直接看，但不能改
- 点 **「立即注册」** 建个账号 —— 注册的账号默认是管理员，功能全开

进去之后试三件事，能做完就说明整套链路是通的：

1. **上传**：拖一个 `.xlsx` 或 `.csv` 进页面，会自动建表
2. **编辑**：改几个单元格，点保存
3. **看板**：点左侧「数据看板」，选一个维度看汇总

---

## 七、上手走一遍（5 分钟）

照这个顺序点一遍，能走完就说明导入、编辑、计算、汇总、导出、审计、回收站整条链路都是通的：

1. 打开 <http://localhost:5185/login.html> → 注册一个账号（用户名 3–20 位字母数字，密码至少 6 位）
2. 把任意 `.xlsx` / `.csv` 拖到页面上（或点「上传」）→ 自动建表并进入编辑页
3. 改几个单元格 → 点「保存」→ 刷新页面，确认已落库
4. 「设置 → 列管理」新增一列 `金额`，填公式 `[单价] * [数量]` → 该列变成只读计算列
5. 「透视汇总」：行维度选一个文本列、值字段选 `金额`、聚合选 `sum` → 预览 → 导出
6. 「导出 → 导出 Excel」，与页面数据对一遍
7. 「数据看板」切到这张表看图表；「审计中心」能看到刚才每一步的记录
8. 删除这张表 → 「回收站」里恢复回来

### 想验证 API？

```bash
# 1) 注册（只返回结果，不签发 token）
curl -X POST http://localhost:5185/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test01","password":"123456","confirmPassword":"123456"}'

# 2) 登录，取 access token
curl -X POST http://localhost:5185/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test01","password":"123456"}'

# 3) 上传（token 换成上一步返回的值）
curl -X POST http://localhost:5185/api/excel/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@销售数据.xlsx"

# 4) 查询（tableId 换成上传返回的 id）
curl "http://localhost:5185/api/excel/query?tableId=1" -H "Authorization: Bearer <token>"

# 5) 导出
curl -L "http://localhost:5185/api/excel/export?tableId=1" \
  -H "Authorization: Bearer <token>" -o 导出.xlsx
```

> 保存接口是**整表替换**语义，`rows` 必须是「列名 → 值」的字典数组：
> `{"tableId":1,"rows":[{"销售员":"张伟","数量":3}]}`。
> 传成二维数组不会报错，但会绑成空行 —— 这是最容易踩的一个坑。
>
> Windows 的 cmd 里 curl 续行符是 `^` 而不是 `\`，直接整行粘贴更省事。

更多参数与返回示例见开发环境的 Swagger UI（<http://localhost:5185/swagger>）。

---

## 八、卡住了看这里

| 你看到的提示 | 原因 | 怎么解决 |
| --- | --- | --- |
| `'dotnet' 不是内部或外部命令` | SDK 没装，或装完没重开命令行 | 关掉命令行重开；还不行就重装 SDK 并勾选「加入 PATH」 |
| `Jwt:Key 未配置` | 第四步没做 | 执行第四步那条 `user-secrets` 命令 |
| `无法连接到 SQL Server` / 登录超时 | 实例名写错，或服务没启动 | 核对第三步的 `Server=`；`services.msc` 里把 `SQL Server (SQLEXPRESS)` 启动 |
| `Failed to bind to address http://localhost:5185` | 端口被别的程序占了 | 换端口：`dotnet run --project ExcelToWeb --urls http://localhost:5186` |
| 页面能打开，但操作提示「登录已过期」 | 浏览器里是旧的登录态 | 退出重新登录，或在浏览器里清掉本站数据 |
| 上传 Excel 报「数据行超过上限 50,000 行」 | 单表行数有上限 | 拆分文件后再导入，详见 [配置说明](CONFIG.md) |

---

## 九、另一种方式：Docker（不用装 .NET 和 SQL Server）

装了 Docker Desktop 的话，一条命令就能起完整环境，连 SQL Server 一起：

```bash
cp .env.compose.example .env
```

编辑 `.env`，改两个值：

- `SQL_SA_PASSWORD`：随便设一个符合复杂度要求的密码
- `JWT_KEY`：换成 32 位以上的随机串

然后：

```bash
docker compose up -d --build
```

打开 <http://localhost:8080>。首次要拉约 2.5GB 镜像，5~15 分钟；之后启动只要几十秒。

容器方式的完整说明（含云服务器部署、内存限制、镜像拉不动怎么办）见 [DEPLOY.md](DEPLOY.md)。

---

## 附：跑一遍测试（可选）

```bash
dotnet test                          # 单元测试，不需要数据库
python tests/run.py                  # 黑盒回归，会自己起服务跑完关掉
python tests/check_constraints.py    # 代码约束守门，秒级
```

Python 与 Node 20+ 只在跑回归时需要，跑程序本身用不到。
