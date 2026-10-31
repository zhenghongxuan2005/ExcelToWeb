# -*- coding: utf-8 -*-
"""接口状态码约定（Models/ApiResponse.cs 的 ApiErrorKind + Filters/RequireTableIdFilter）的回归。

为什么单独一个文件：
此前「少了 tableId」和「这张表真的不存在」返回同一个状态码、同一句「表格不存在」，
按提示排障会走反方向；参数格式错误（?tableId=abc）则是 400 但响应体里没有 message，
前端只能显示「请求失败」。这套约定把三种情况分开：

  · 参数缺失 / 格式不对 / 业务校验没过 → 400，且响应体带可直接展示的中文 message
  · 资源不存在（或不属于当前用户）    → 404「表格不存在」
  · 有身份但没权限                    → 403（由 PermissionResultHandler 统一出）

顺带锁住「query 的 date 死参数已移除」：它曾按日期前缀过滤后把结果当成整表下发，
前端再整表保存就会把其余日期删掉，是数据损失级的历史包袱。
"""
import sys
import time

sys.path.insert(0, "tests/backend/helpers")
from smoke_base import call, ensure_user, login, make_xlsx

fails = 0


def check(name, cond, extra=""):
    global fails
    if cond:
        print("  PASS", name)
    else:
        fails += 1
        print("  FAIL", name, "->", extra)


def msg(r):
    return (r.get("message") or "").strip()


user = "stcode" + str(int(time.time()))[-6:]
ensure_user(user, "stcode_pass_123")
token = login(user, "stcode_pass_123")
check("登录成功", bool(token))

headers = ["名称", "日期", "数量"]
seed = [["甲", "2026-10-01", "1"], ["乙", "2026-10-02", "2"], ["丙", "2026-10-03", "3"]]
st, r = call("POST", "/excel/upload", form={"file": ("stcode.xlsx", make_xlsx(headers, seed))}, token=token)
tid = (r.get("data") or {}).get("tableId") or 0
check("导入 3 行", st == 200 and tid > 0, r)

# ===== 1. 参数缺失：400，而不是 404「表格不存在」 =====
print("\n[1] 缺必填参数")
for path, name in [
    ("/excel/query", "query"),
    ("/excel/export", "export"),
    ("/excel/export-csv", "export-csv"),
    ("/excel/template", "template"),
    ("/excel/column-meta", "column-meta"),
    ("/excel/audit-logs", "audit-logs"),
    ("/excel/validation-rules", "validation-rules"),
]:
    st, r = call("GET", path, token=token)
    check("%s 缺 tableId → 400" % name, st == 400, (st, r))
    check("%s 文案说明缺参数" % name, "缺少 tableId" in msg(r), msg(r))

st, r = call("GET", "/excel/query?tableId=0", token=token)
check("tableId=0 也按缺参处理（400）", st == 400 and "缺少 tableId" in msg(r), (st, r))

st, r = call("GET", "/excel/column-values?tableId=%d" % tid, token=token)
check("缺 columnName → 400 且点名该参数", st == 400 and "columnName" in msg(r), (st, r))

# ===== 2. 参数格式：400，且响应体是项目自己的 ApiResponse（有 message） =====
print("\n[2] 参数格式不对")
st, r = call("GET", "/excel/query?tableId=abc", token=token)
check("tableId=abc → 400", st == 400, (st, r))
check("响应体有中文 message（不是 ValidationProblemDetails）", bool(msg(r)), r)
check("message 点名了 tableId", "tableId" in msg(r), msg(r))
check("响应体仍是 success=false 形状", r.get("success") is False, r)

# ===== 3. 资源不存在：404 =====
print("\n[3] 表格不存在")
missing = 99999999
for path, name, method, body in [
    ("/excel/query?tableId=%d" % missing, "query", "GET", None),
    ("/excel/export?tableId=%d" % missing, "export", "GET", None),
    ("/excel/export-csv?tableId=%d" % missing, "export-csv", "GET", None),
    ("/excel/template?tableId=%d" % missing, "template", "GET", None),
    ("/excel/save", "save", "POST", {"tableId": missing, "rows": [{"名称": "x"}]}),
    ("/excel/rename", "rename", "PUT", {"tableId": missing, "tableName": "新的"}),
    ("/excel/delete?tableId=%d" % missing, "delete", "DELETE", None),
    ("/excel/tables/%d/auto-export" % missing, "auto-export", "PUT", {"enabled": True}),
]:
    st, r = call(method, path, body, token=token) if body is not None else call(method, path, token=token)
    check("%s 不存在的表 → 404" % name, st == 404, (st, r))
    check("%s 文案是「表格不存在」" % name, "表格不存在" in msg(r), msg(r))

# ===== 4. 业务校验失败仍是 400（不能被 404 吞掉） =====
print("\n[4] 业务校验失败")
st, r = call("PUT", "/excel/rename", {"tableId": tid, "tableName": "   "}, token=token)
check("空表名 → 400", st == 400 and not r.get("success"), (st, r))

st, r = call("POST", "/excel/save", {"tableId": tid, "rows": []}, token=token)
check("空行集 → 400（不是 404）", st == 400 and "没有任何数据行" in msg(r), (st, r))

# ===== 5. date 死参数已移除：传了也不该改变返回行数 =====
print("\n[5] query 的 date 参数已移除")
st, base = call("GET", "/excel/query?tableId=%d" % tid, token=token)
st2, withdate = call("GET", "/excel/query?tableId=%d&date=2026-10-01" % tid, token=token)
rows_base = len((base.get("data") or {}).get("rows") or [])
rows_date = len((withdate.get("data") or {}).get("rows") or [])
check("不带 date 返回 3 行", st == 200 and rows_base == 3, rows_base)
check("带 date 仍返回整表（多余参数被忽略，不再过滤）", st2 == 200 and rows_date == 3, rows_date)

print("\n%s（%d 项失败）" % ("状态码约定：全部通过" if fails == 0 else "状态码约定：存在失败", fails))
sys.exit(1 if fails != 0 else 0)
