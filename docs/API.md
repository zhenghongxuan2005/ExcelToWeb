# API 接口

所有接口的完整清单。前端在 `wwwroot/js/api.js` 等模块里按领域封装，这里记录契约本身：
路径、方法、权限、请求与响应形状。

> 返回 [README](../README.md)

统一响应格式：

```json
{ "success": true, "message": "操作成功", "data": { } }
```

所有 `/api/excel/*` 与 `/api/trash/*` 接口均需在请求头携带 `Authorization: Bearer {token}`。
未捕获异常统一返回 `application/problem+json`（RFC 7807，含 `traceId`），业务错误仍用上面的 `ApiResponse` 契约。

## 认证 `/api/auth`

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

## 表格 `/api/excel`

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

## 列结构与计算列

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| `PUT` | `/api/excel/headers` | `{ tableId, headers[] }` | 改列结构（增删改移），数据按列名迁移，事务内完成 |
| `GET` | `/api/excel/column-meta` | `tableId` | 列元数据：列宽 / 是否隐藏 / 计算列公式 |
| `PUT` | `/api/excel/column-meta` | `{ tableId, meta }` | 保存列元数据（列增删时自动同步键名） |
| `PUT` | `/api/excel/formula` | `{ tableId, columnName, formula }` | 设置 / 清空某列的计算列公式（传空串即还原为普通列） |

## 透视汇总

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/excel/pivot` | `{ tableId, rowField, colField?, valueField, agg }` | 计算透视结果，`agg` 取 `sum / count / avg / max / min` |
| `POST` | `/api/excel/pivot-export` | 同上 | 把同一份透视结果导出为 `.xlsx` |

## 规则与校验

| 方法 | 路径 | 参数 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/excel/rules` | `columnName?` | 查询配色规则（可按列过滤） |
| `POST` | `/api/excel/rules` | `ColorRule[]` | 保存配色规则（按 `rules[0].ColumnName` 整列替换） |
| `GET` | `/api/excel/validation-rules` | `tableId` | 查询某表的校验规则 |
| `POST` | `/api/excel/validation-rules` | `ValidationRule[]` | 保存校验规则（按 `rules[0].TableId` 整表替换） |
| `POST` | `/api/excel/upload-with-validation` | `file` + `tableId` | 按已有规则校验后导入，返回成功/失败行数与错误明细 |

> 未配置校验规则时，`upload-with-validation` 直接放行全部数据行。

## 回收站与审计

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/excel/trash` | 回收站列表（表名、数据行数、删除时间） |
| `GET` | `/api/excel/trash/policy` | 保留策略（`retentionDays`），前端据此渲染「N 天后自动清除」，不再自己写死天数 |
| `POST` | `/api/excel/trash/{id}/restore` | 恢复表格（清掉删除标记，数据原样回到表格列表） |
| `DELETE` | `/api/excel/trash/{id}` | 彻底删除（物理删表，并清理关联的审计日志与校验规则） |
| `GET` | `/api/excel/audit-logs` | **单表**审计：`tableId` 必填，`rowIndex?` 可精确到行（编辑器内弹窗用） |
| `GET` | `/api/excel/audit-center` | **跨表**审计：`tableId?`、`actionType?`、`from?`、`to?`、`page`、`pageSize`（审计中心页用） |

> 回收站中的表格超过保留期（`Trash:RetentionDays`，默认 30 天）后，由 Hangfire 的 `recycle-bin-cleanup` 任务（每天 03:00，启动时补跑一次）自动物理清除。

## 定时导出与后台任务

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `PUT` | `/api/excel/tables/{id}/auto-export` | `table:write` | 开关某张表的「每日自动导出」 |
| `GET` | `/api/exports` | `table:read` | 当前用户最近 50 份导出报表 |
| `GET` | `/api/exports/{id}/download` | `table:read` | 下载报表（校验归属，别人的 id 一律 404） |
| `POST` | `/api/exports/run-now` | `member:manage` | **仅开发环境**：把 `daily-export` 排进队列，不必等到凌晨两点 |
| `GET` | `/hangfire` | 本机 | Hangfire Dashboard，`Hangfire:DashboardEnabled` 控制，生产默认关闭 |

## 健康检查

| 端点 | 用途 | 说明 |
| --- | --- | --- |
| `GET /health` | 存活探针 | 不查任何外部依赖，进程活着即 200 |
| `GET /health/ready` | 就绪探针 | `SELECT 1` 验证数据库，失败返回 503 |

---
