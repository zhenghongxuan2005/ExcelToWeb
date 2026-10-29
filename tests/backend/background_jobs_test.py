# -*- coding: utf-8 -*-
"""后台任务（Hangfire）回归：定时导出报表 + 回收站保留策略下发。

要点：
  - 这些是**真的跑一遍后台任务**，不是 mock：通过开发环境的 /exports/run-now 把
    daily-export 排进 Hangfire 队列，再轮询产物接口等它落库落盘。
  - 覆盖「策略同源」：回收站保留天数由服务端下发，前端不再自己写 30。
  - 覆盖「产物归属」：别人的报表 id 一律 404，不泄露存在性。

前提：服务以 Development 环境跑（/exports/run-now 只在该环境挂载）。
"""
import io
import os
import sys
import time
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from smoke_base import call, ensure_user, login, make_xlsx   # noqa: E402

passed = 0
failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print("  ✅ " + name)
    else:
        failed += 1
        print("  ❌ " + name + (" | " + str(detail) if detail != "" else ""))


suffix = str(int(time.time()))[-6:]
ADMIN = "jobadm" + suffix
OTHER = "jobusr" + suffix
PWD = "job_pass_123"


def wait_export(token, table_id, timeout=25):
    """轮询 /exports 直到出现这张表的快照（任务在后台 worker 上跑，落库有延迟）"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        st, r = call("GET", "/exports", token=token)
        if st == 200:
            for item in (r.get("data") or []):
                if item.get("tableId") == table_id:
                    return item
        time.sleep(1)
    return None


# ===== 准备账号与一张表 =====
check("管理员账号就绪", ensure_user(ADMIN, PWD))
check("另一账号就绪", ensure_user(OTHER, PWD))
tok = login(ADMIN, PWD)
tok2 = login(OTHER, PWD)
check("管理员登录成功", bool(tok))

st, r = call("POST", "/excel/upload",
             form={"file": ("jobs.xlsx", make_xlsx(["产品", "数量"], [["甲", "10"], ["乙", "20"]]))},
             token=tok)
table_id = ((r.get("data") or {}).get("tableId") or 0) if st == 200 else 0
check("上传一张用于导出的表", st == 200 and table_id > 0, r)

# ===== 1. 回收站保留策略由服务端下发 =====
st, r = call("GET", "/excel/trash/policy", token=tok)
days = ((r.get("data") or {}).get("retentionDays")) if st == 200 else None
check("策略接口返回正整数保留天数", st == 200 and isinstance(days, int) and 1 <= days <= 365,
      "%s %s" % (st, r))
check("策略接口匿名不可访问", call("GET", "/excel/trash/policy")[0] == 401)

# ===== 2. 导出接口的鉴权 =====
check("报表列表匿名 401", call("GET", "/exports")[0] == 401)
check("立即执行匿名 401", call("POST", "/exports/run-now")[0] == 401)

# ===== 3. 自动导出开关 =====
st, r = call("GET", "/excel/tables", token=tok)
row = next((t for t in (r.get("data") or []) if t.get("id") == table_id), None)
check("新表默认不开启自动导出", st == 200 and row is not None and row.get("autoExportEnabled") is False, row)

st, r = call("PUT", "/excel/tables/%d/auto-export" % table_id, {"enabled": True}, token=tok)
check("开启自动导出", st == 200 and r.get("success") is True, r)

st, r = call("GET", "/excel/tables", token=tok)
row = next((t for t in (r.get("data") or []) if t.get("id") == table_id), None)
check("列表回读为已开启", row is not None and row.get("autoExportEnabled") is True, row)

# 重复设置同一状态：幂等返回，不算失败
st, r = call("PUT", "/excel/tables/%d/auto-export" % table_id, {"enabled": True}, token=tok)
check("重复开启幂等", st == 200 and r.get("success") is True, r)

# 越权：不存在的表 id 要被拒（不是 500）
st, r = call("PUT", "/excel/tables/999999/auto-export", {"enabled": True}, token=tok)
check("不存在的表返回业务失败", st == 400 and r.get("success") is False, r)

# ===== 4. 真的跑一次后台任务 =====
st, r = call("POST", "/exports/run-now", token=tok)
check("立即执行排入队列", st == 200 and r.get("success") is True, r)

snapshot = wait_export(tok, table_id)
check("后台任务产出该表的报表", snapshot is not None, "等待 25s 仍无产物")
check("报表记录了行数", bool(snapshot) and snapshot.get("rowCount") == 2, snapshot)
check("报表大小非零", bool(snapshot) and snapshot.get("sizeBytes", 0) > 0, snapshot)

# ===== 5. 下载产物 =====
if snapshot:
    st, blob = call("GET", "/exports/%d/download" % snapshot["id"], token=tok, raw=True)
    check("下载返回 200", st == 200)
    check("下载内容是 xlsx（zip 头 PK）", isinstance(blob, bytes) and blob[:2] == b"PK")
    if isinstance(blob, bytes) and blob[:2] == b"PK":
        text = "".join(zipfile.ZipFile(io.BytesIO(blob)).read(n).decode("utf-8", "ignore")
                       for n in zipfile.ZipFile(io.BytesIO(blob)).namelist())
        check("报表里带着表头与数据", "产品" in text and "甲" in text, text[:120])

    # 归属校验：别人的报表 id 一律 404
    check("他人报表下载 404", call("GET", "/exports/%d/download" % snapshot["id"], token=tok2)[0] == 404)

    # 不存在的 id 也是 404（不区分「没有」和「不是你的」）
    check("不存在的报表 404", call("GET", "/exports/99999999/download", token=tok)[0] == 404)

    # 同一天补跑：应该**覆盖同一行**，而不是再插一份指向同一个文件的记录。
    # 这条盯的是一个很隐蔽的坑：两行共用一个路径时，先过期的那行会把文件删掉，
    # 另一行还活着却下载不到——只能靠这种「跑两次再数行数」的用例才抓得住。
    first_seen = snapshot.get("createdAt")
    st, _ = call("POST", "/exports/run-now", token=tok)
    check("同日补跑排入队列", st == 200)

    refreshed = False
    deadline = time.time() + 25
    while time.time() < deadline:
        st, r2 = call("GET", "/exports", token=tok)
        rows = [x for x in (r2.get("data") or []) if x.get("tableId") == table_id]
        if rows and rows[0].get("createdAt") != first_seen:
            refreshed = True
            break
        time.sleep(1)
    check("同日补跑刷新了报表", refreshed)

    st, r2 = call("GET", "/exports", token=tok)
    same_day = [x for x in (r2.get("data") or []) if x.get("tableId") == table_id]
    check("同一天只保留一份报表（覆盖而非追加）", len(same_day) == 1, same_day)

# ===== 6. 角色变更对 /run-now 立即生效（顺带验缓存失效）=====
st, r = call("GET", "/users", token=tok)
other_id = next((u["id"] for u in (r.get("data") or []) if u.get("username") == OTHER), 0)
check("能列出成员", st == 200 and other_id > 0)

st, r = call("PUT", "/users/%d/role" % other_id, {"role": "Viewer"}, token=tok)
check("把另一账号降为只读", st == 200 and r.get("success") is True, r)
check("只读账号不能触发导出任务", call("POST", "/exports/run-now", token=tok2)[0] == 403)

# ===== 7. 彻底删除表格后，报表记录随外键级联消失 =====
st, _ = call("DELETE", "/excel/delete?tableId=%d" % table_id, token=tok)
check("软删除表格", st == 200)
st, _ = call("DELETE", "/excel/trash/%d" % table_id, token=tok)
check("彻底删除表格", st == 200)

st, r = call("GET", "/exports", token=tok)
left = [x for x in (r.get("data") or []) if x.get("tableId") == table_id]
check("表格没了，报表记录也清了", left == [], left)

print("\n通过 %d 项，失败 %d 项" % (passed, failed))
sys.exit(1 if failed else 0)
