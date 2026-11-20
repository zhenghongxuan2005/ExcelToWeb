# 部署指南

四种形态，按成本排。核心差别只有一个：**别人能不能点开**。

| 形态 | 成本 | 公网可访问 | 适合 |
| --- | --- | --- | --- |
| 本地 Docker Compose | 0 | 否 | 自己跑、答辩现场演示 |
| GitHub Codespaces | 0（免费额度内） | 是（临时） | 发给面试官 / 老师看 |
| 内网穿透（cpolar / ngrok） | 0 | 是（临时） | 面试前一小时开起来 |
| 云服务器 | 10~20 元/月 | 是（长期） | 求职期连续挂两三个月 |

三种公网方案都建立在同一套 `docker-compose.yml` 上，差别只在「跑在哪」和「谁的端口转发」。
应用启动时会自动执行 EF 迁移、播种演示账号、开启 RCSI，所以任何形态都不需要手工建库。

---

## 一、本地（零依赖，先用这个确认能跑）

```bash
cp .env.compose.example .env
# 编辑 .env：改 SQL_SA_PASSWORD，把 JWT_KEY 换成一串 ≥32 位随机值
#   openssl rand -base64 32
docker compose up -d --build
```

打开 <http://localhost:8080>，演示账号 `demo` / `demo1234`（只读）。

首次启动 SQL Server 需要 40~60 秒，`web` 会等数据库**真正能执行查询**之后才启动，
这期间 `docker compose ps` 里 `web` 显示 `Created` 属正常。

---

## 二、零成本公网 A：GitHub Codespaces

适合「把链接发给别人看」。仓库是公开的，任何有 GitHub 账号的人都能在自己的额度里开一份，
但通常是你自己开好、把转发地址发出去。

### 步骤

1. 仓库页面 → `Code` → `Codespaces` → `Create codespace on master`
2. 等环境就绪（默认镜像自带 Docker，先 `docker --version` 确认）
3. 在终端执行：

```bash
cp .env.compose.example .env
# 改 .env：
#   SQL_SA_PASSWORD  随便设一个合规密码
#   JWT_KEY          换成 ≥32 位随机串
#   MSSQL_MEMORY_MB  改成 1024（免费机是 2 核 8G，但 SQL Server 仍会尽量吃满）
#   FORWARDED_HEADERS 改成 true ← 关键，见下
docker compose up -d --build
```

4. 底部「端口」面板找到 `8080` → 右键 → `Port Visibility` → **Public**
5. 得到形如 `https://<名字>-8080.app.github.dev` 的地址，可直接发给别人

设成 Public 之后，访问者**不需要 GitHub 账号**就能打开——这一步没做的话，
别人点开只会看到一个登录页，等于没给出去。

### 两个必须知道的点

**`FORWARDED_HEADERS` 一定要开。** Codespaces 的端口转发是反向代理，应用看不到真实客户端 IP。
不开启的话，登录限流按 IP 分区会退化成「全站共用一个配额」——别人刷几次，你自己也登不进去了。

**免费额度和时长。** GitHub Free 每月 120 core-hours，2 核机器约等于 60 小时；
且 Codespace 停止后地址失效，重新启动域名会变。所以它适合「面试前后开起来」，
不适合长期挂着当官网。

---

## 三、零成本公网 B：内网穿透

适合「本机已经跑着，临时给个地址」。电脑关机、休眠、断网都会断。

以 cpolar 为例（ngrok 同理）：

1. 注册免费账号，下载 Windows 客户端
2. 确认本地容器在跑：`docker compose ps` 两个服务都 healthy
3. `cpolar http 8080`
4. 得到形如 `https://xxxx.cpolar.io` 的地址

注意事项：

- 免费版域名每次重启会变，带宽有限（大约 1 Mbps，够点页面、不够传大 Excel）
- `.env` 里 `FORWARDED_HEADERS` 同样要改成 `true`
- 用完把隧道关掉，别让演示库长期暴露

---

## 四、云服务器（长期挂）

> **先别急着付钱。** 如果你是在校生，先申请 [GitHub Student Developer Pack](https://education.github.com/pack)，
> 里面包含 Azure for Students（约 $100 / 12 个月，不需要信用卡）以及 DigitalOcean、Namecheap 等额度，
> 足够把这个项目挂上大半年。审核通常几天到两周，越早申请越好——学生身份是有时效的。

### 配置

2 核 4G 起步。2 核 2G 能跑，但要把 `MSSQL_MEMORY_MB` 降到 `1024`。

这个值会落到两处，各管一件事：

| 配置 | 作用 | 实测行为 |
| --- | --- | --- |
| `MSSQL_MEMORY_LIMIT_MB` | 调 SQL Server 自己的缓冲池上限 | 对**已经初始化过**的数据卷不会重设（`max server memory` 仍显示无限制），只有全新库可靠 |
| `mem_limit`（compose） | Docker cgroup 硬上限 | 一定生效，用 `docker inspect` 可查，超限直接 OOM kill |

所以调参以 `mem_limit` 为准。设得太小，容器会被反复 OOM kill——
表现是 `sqlserver` 每几十秒重启一次、`web` 永远等不到 healthy。

### 步骤（Ubuntu 22.04）

```bash
# 1. 装 Docker
curl -fsSL https://get.docker.com | sh

# 2. 取代码
git clone https://github.com/zhenghongxuan2005/ExcelToWeb.git
cd ExcelToWeb

# 3. 配置
cp .env.compose.example .env
vi .env          # 改密码与 JWT_KEY；4G 机器 MSSQL_MEMORY_MB 留 1536
                 # 直接用 IP:8080 访问时 FORWARDED_HEADERS 保持 false

# 4. 起服务
docker compose up -d --build

# 5. 验证
curl -fsS http://localhost:8080/health/ready
```

最后在云厂商控制台的**安全组**里放行 `8080`（TCP），然后访问 `http://公网IP:8080`。

> 用 8080 端口**不需要域名备案**，只有 80/443 绑域名才需要。先用 IP 访问，
> 别为了「看起来正规」去折腾域名和备案。

### 镜像拉不动怎么办

这个项目的镜像来自 `mcr.microsoft.com`（.NET SDK / ASP.NET 运行时 / SQL Server），
**不在 Docker Hub，所以配 `registry-mirrors` 加速器对它无效**。三条可行路径：

1. **直连**：国内通常能拉，只是慢（首次约 2.5 GB），挂一晚上也拉完了
2. **本地导出再上传**（最稳）：
   ```bash
   # 本机
   docker pull mcr.microsoft.com/mssql/server:2022-latest
   docker save mcr.microsoft.com/mssql/server:2022-latest -o mssql.tar
   scp mssql.tar user@server:/tmp/
   # 服务器
   docker load -i /tmp/mssql.tar
   ```
   之后 `docker compose up -d` 会直接用本地镜像，不再拉取。
3. **用云厂商的镜像服务**同步 MCR 镜像到私有仓库，再把 `docker-compose.yml` 里的
   `image:` 换成私有地址（麻烦，除非要反复部署多台）

---

## 五、常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `sqlserver` 反复重启 | 内存不足：把 `.env` 的 `MSSQL_MEMORY_MB` 调小（如 1024），或把机器升到 4G。调小后仍重启说明设得太小 |
| `web` 一直停在 `Created` | 在等 `sqlserver` 变 healthy。`docker compose logs sqlserver` 看它是否在恢复数据库 |
| 8080 打不开，容器却是 healthy | 安全组 / 防火墙没放行，或云厂商默认只开 22 |
| 登录后很快就掉登录态 | 容器重建换了 Data Protection 密钥。已用 `dp-keys` 卷解决，确认该卷没被 `down -v` 删掉 |
| 别人一试，你自己就登不进去 | 前面有代理但没开 `FORWARDED_HEADERS`，限流按代理 IP 合并了 |
| 启动即退出，日志说 Jwt:Key 不合规 | `JWT_KEY` 还是 `CHANGE_ME_` 开头，或短于 32 字符（生产环境的强制守卫） |
| 页面能开但接口全 401 | 浏览器里是旧 token。退出重登，或清 localStorage |

---

## 六、公网暴露前的检查清单

- [ ] `.env` 里的密码不是从示例里抄来的，`JWT_KEY` 是随机生成的
- [ ] `demo` 账号保持只读（服务端按用户名判定，前端置灰只是提示）
- [ ] 不需要 Swagger 时确认 `ASPNETCORE_ENVIRONMENT` 不是 `Development`（否则 `/swagger` 可访问）
- [ ] Hangfire 面板只在开发 + 本机开放（`Program.cs` 里已限制）
- [ ] 长期挂着的话，隔一段时间 `docker compose pull && docker compose up -d` 更新基础镜像
