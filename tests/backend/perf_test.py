# -*- coding: utf-8 -*-
"""数据访问层的正确性与量级回归：整表保存、回收站行数统计、按表取数的耗时。

为什么需要这个文件：
`ReplaceRowsAsync` 从「读实体 → RemoveRange → AddRange」换成了
「ExecuteDelete + 原生批量插入」，`GetTrashedAsync` 从逐表子查询换成了
一次 JOIN + GROUP BY。这两处都是写路径/列表页的核心，改错的表现是
「数据没了」或「行数一直是 0」，而不是抛异常——所以必须有断言锁住。

耗时断言只钉量级（3~5 秒），不做精确比较：目的是在
「TableId 聚集索引丢失 / 回收站退回 N 次子查询」时立刻报警，
而不是卡住机器差异。
"""
import sys
import time

sys.path.insert(0, "tests/backend/helpers")
from smoke_base import call, ensure_user, login, make_xlsx

N = 800
fails = 0


def check(name, cond, extra=""):
    global fails
    if cond:
        print("  PASS", name)
    else:
        fails += 1
        print("  FAIL", name, "->", extra)


user = "perf" + str(int(time.time()))[-6:]
ensure_user(user, "perf_pass_123")
token = login(user, "perf_pass_123")
check("登录成功", bool(token))

headers = ["名称", "数量", "日期"]
rows = [[f"行{i}", str(i), "2026-10-%02d" % (i % 28 + 1)] for i in range(N)]

# ===== 1. 导入与加载 =====
print("\n[1] 导入与加载")
t0 = time.time()
st, r = call("POST", "/excel/upload", form={"file": ("perf.xlsx", make_xlsx(headers, rows))}, token=token)
table_id = (r.get("data") or {}).get("tableId") or 0
check("上传 %d 行" % N, st == 200 and table_id > 0, r)

t0 = time.time()
st, r = call("GET", "/excel/query?tableId=%d" % table_id, token=token)
load_ms = (time.time() - t0) * 1000
loaded = (r.get("data") or {}).get("rows") or []
check("加载返回 %d 行" % N, st == 200 and len(loaded) == N, len(loaded))
check("加载耗时在 3 秒内（实测 %.0f ms）" % load_ms, load_ms < 3000, load_ms)

# ===== 2. 整表保存：走 ExecuteDelete + 原生批量插入 =====
print("\n[2] 整表保存（删全部 + 批量重插）")
payload = [dict(zip(headers, row)) for row in rows]
payload[0]["名称"] = "改过的首行"
t0 = time.time()
st, r = call("POST", "/excel/save", {"tableId": table_id, "rows": payload}, token=token)
save_ms = (time.time() - t0) * 1000
check("保存成功", st == 200 and r.get("success"), r)
check("保存耗时在 5 秒内（实测 %.0f ms）" % save_ms, save_ms < 5000, save_ms)

st, r = call("GET", "/excel/query?tableId=%d" % table_id, token=token)
after = (r.get("data") or {}).get("rows") or []
names = [str(x.get("名称") or "") for x in after]
check("保存后行数不变（%d）" % N, len(after) == N, len(after))
check("首行改动已落库", names and names[0] == "改过的首行", names[:2])
check("末行没有丢", ("行%d" % (N - 1)) in names)
# 删除与插入都在同一事务里：若 ExecuteDelete 之后插入失败，旧数据必须回滚回来
check("中间行没有出现空洞", ("行1" in names) and ("行%d" % (N // 2) in names))

# 再保存一次：确认可重复执行（幂等，不会因为上次的行残留而翻倍）
st, r = call("POST", "/excel/save", {"tableId": table_id, "rows": payload}, token=token)
st, r = call("GET", "/excel/query?tableId=%d" % table_id, token=token)
check("连续两次保存后行数仍是 %d（不会翻倍）" % N,
      len((r.get("data") or {}).get("rows") or []) == N)

# ===== 3. 回收站行数统计：JOIN + GROUP BY 而不是逐表子查询 =====
print("\n[3] 回收站列表")
st, r = call("DELETE", "/excel/delete?tableId=%d" % table_id, token=token)
check("删除成功（进回收站）", st == 200 and r.get("success"), r)

t0 = time.time()
st, r = call("GET", "/excel/trash", token=token)
trash_ms = (time.time() - t0) * 1000
items = r.get("data") or []
mine = [x for x in items if x.get("id") == table_id]
check("回收站里能找到刚删的表", len(mine) == 1, items)
check("行数统计准确（应 %d）" % N, mine and mine[0].get("rowCount") == N,
      mine[0].get("rowCount") if mine else None)
check("回收站列表耗时在 3 秒内（实测 %.0f ms）" % trash_ms, trash_ms < 3000, trash_ms)

# ===== 4. 收尾：彻底删除，不给库留垃圾 =====
st, r = call("DELETE", "/excel/trash/%d" % table_id, token=token)
check("彻底删除成功", st == 200 and r.get("success"), r)

st, r = call("GET", "/excel/trash", token=token)
check("彻底删除后列表里没有了",
      not [x for x in (r.get("data") or []) if x.get("id") == table_id])

print("\n================ 结果：%d 项失败 ================" % fails)
sys.exit(1 if fails else 0)
