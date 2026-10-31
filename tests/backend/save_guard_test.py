# -*- coding: utf-8 -*-
"""整表保存的入参守门（Services/Excel/RowPayloadGuard.cs）的后端回归。

为什么单独一个文件：
保存接口的语义是**整表替换**（先删光再批量插），所以「客户端没准备好」的两种
常见形态都会造成真实的数据损失，而接口原本都会返回 200「成功保存 N 条」：

  · rows 为空 —— 取数失败后点一下「保存」就是静默清库
  · 行里带表格中不存在的列 —— 数据进了 DataJson 却永远显示不出来（幽灵列）

锁住的行为：
  · 未知列 400 拒绝，且表里的数据和表头一行/一列都不动
  · 空行集 400 拒绝，只有显式 allowEmpty=true（界面上确认过「清空全部」）才放行
  · 计算列的键必须放行：它们的值不落库，由 Strip 在写入前抹掉
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


user = "guard" + str(int(time.time()))[-6:]
ensure_user(user, "guard_pass_123")
token = login(user, "guard_pass_123")
check("登录成功", bool(token))

headers = ["名称", "数量"]
seed = [["甲", "1"], ["乙", "2"], ["丙", "3"]]

st, r = call("POST", "/excel/upload", form={"file": ("guard.xlsx", make_xlsx(headers, seed))}, token=token)
tid = (r.get("data") or {}).get("tableId") or 0
check("导入 3 行", st == 200 and tid > 0, r)


def snapshot():
    """当前表头 + 当前数据（每次重新取，避免拿缓存下的旧结论）"""
    st, r = call("GET", "/excel/query?tableId=%d" % tid, token=token)
    data = r.get("data") or {}
    return (data.get("headers") or [], data.get("rows") or [])


def names():
    return [str(x.get("名称") or "") for x in snapshot()[1]]


# ===== 1. 未知列：拒绝而不是静默丢弃 =====
print("\n[1] 行里带表格中不存在的列")
bad = [{"名称": "甲", "数量": "1", "不存在的列": "x"}]
st, r = call("POST", "/excel/save", {"tableId": tid, "rows": bad}, token=token)
check("返回 400 且 success=false", st == 400 and not r.get("success"), (st, r))
check("文案点名了那一列", "不存在的列" in (r.get("message") or ""), r.get("message"))
check("数据没有被改动", names() == ["甲", "乙", "丙"], names())
check("表头没有被悄悄加列", snapshot()[0] == headers, snapshot()[0])

# 只有中间一行带未知列：文案要能指向具体行，否则 800 行里没法查
mixed = [{"名称": "甲", "数量": "1"},
         {"名称": "乙", "数量": "2", "幽灵": "1"},
         {"名称": "丙", "数量": "3"}]
st, r = call("POST", "/excel/save", {"tableId": tid, "rows": mixed}, token=token)
check("中间行带未知列同样拒绝", st == 400, (st, r.get("message")))
check("文案指向第 2 行", "第 2 行" in (r.get("message") or ""), r.get("message"))
check("被拒绝的那次没有写入任何一行", names() == ["甲", "乙", "丙"], names())

# ===== 2. 空行集：默认拒绝 =====
print("\n[2] 空行集")
st, r = call("POST", "/excel/save", {"tableId": tid, "rows": []}, token=token)
check("rows: [] 被拒绝", st == 400, (st, r.get("message")))
check("拒绝时数据还在", names() == ["甲", "乙", "丙"], names())

# rows 字段整个缺失时模型绑定出的是空列表，和显式传 [] 同源
st, r = call("POST", "/excel/save", {"tableId": tid}, token=token)
check("rows 字段缺失也被拒绝", st == 400, (st, r.get("message")))
check("拒绝时数据还在（缺字段）", names() == ["甲", "乙", "丙"], names())

# ===== 3. allowEmpty：只有显式确认才允许清空 =====
print("\n[3] allowEmpty=true 才允许清空")
st, r = call("POST", "/excel/save", {"tableId": tid, "rows": [], "allowEmpty": True}, token=token)
check("显式确认后允许清空", st == 200 and r.get("success"), r)
check("表真的空了", snapshot()[1] == [], snapshot()[1])
check("表头还在（清空数据不等于删列）", snapshot()[0] == headers, snapshot()[0])

back = [dict(zip(headers, row)) for row in seed]
st, r = call("POST", "/excel/save", {"tableId": tid, "rows": back}, token=token)
check("随后能重新写入 3 行", st == 200 and len(snapshot()[1]) == 3, (st, r.get("message")))

# ===== 4. 畸形行：null 元素要点名，不能落到 ReplaceRowsAsync 里炸 =====
print("\n[4] 畸形行")
st, r = call("POST", "/excel/save", {"tableId": tid, "rows": [None]}, token=token)
check("null 行被拒绝", st == 400, (st, r.get("message")))
check("文案指向第 1 行", "第 1 行" in (r.get("message") or ""), r.get("message"))
check("数据还在", names() == ["甲", "乙", "丙"], names())

# ===== 5. 计算列的键必须放行 =====
print("\n[5] 计算列")
st, r = call("PUT", "/excel/formula",
             {"tableId": tid, "columnName": "数量", "formula": "1+1"}, token=token)
check("设置计算列成功", st == 200 and r.get("success"), r)

rows = snapshot()[1]
check("读取时按公式算出值（都应该变成 2）",
      rows and all(str(x.get("数量")) == "2" for x in rows), rows[:2])

st, r = call("POST", "/excel/save", {"tableId": tid, "rows": rows}, token=token)
check("带计算列的保存被放行（不误判成未知列）", st == 200 and r.get("success"), (st, r.get("message")))

# 清掉公式：Strip 的作用就是让「算出来的 2」别进 DataJson，
# 否则取消公式后页面会一直显示一份陈旧的数字
st, r = call("PUT", "/excel/formula",
             {"tableId": tid, "columnName": "数量", "formula": ""}, token=token)
check("取消计算列成功", st == 200 and r.get("success"), r)
vals = [str(x.get("数量")) for x in snapshot()[1]]
check("计算列算出的值没有写进库（清掉公式后不会残留 2）",
      all(v != "2" for v in vals), vals)

# ===== 6. 正常保存照旧（不能因为加守门把主路径改坏）=====
print("\n[6] 正常保存")
rows = snapshot()[1]
rows[0]["名称"] = "甲改"
st, r = call("POST", "/excel/save", {"tableId": tid, "rows": rows}, token=token)
check("正常保存成功", st == 200 and r.get("success"), r)
check("改动已落库", names()[0] == "甲改", names())

# ===== 收尾：彻底删除，不给库留垃圾 =====
st, r = call("DELETE", "/excel/delete?tableId=%d" % tid, token=token)
check("删除成功（进回收站）", st == 200 and r.get("success"), r)
st, r = call("DELETE", "/excel/trash/%d" % tid, token=token)
check("彻底删除成功", st == 200 and r.get("success"), r)

print("\n================ 结果：%d 项失败 ================" % fails)
sys.exit(1 if fails else 0)
