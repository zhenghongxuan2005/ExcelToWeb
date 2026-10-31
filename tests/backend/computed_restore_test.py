# -*- coding: utf-8 -*-
"""计算列原值保留（QA 第 19 条）的后端回归。

问题：给已有列（比如「数量」）设公式后再保存，取消公式时那一列整列空白。
根因是保存 = 整表替换，ComputedColumnService.Strip 会把计算列的键整个删掉 ——
算出来的值不该落库（这是对的），但「库里本来就有的原值」也跟着一起没了。

修复：读取时每行带行主键（RowPayloadGuard.RowIdKey = __rid），
保存时按主键把计算列的历史原值补回原行（ComputedColumnService.RestoreComputedOriginals）。

锁住的行为：
  · 设公式 → 保存 → 取消公式，原值 1/2/3 还在
  · 行顺序打乱（各带自己的主键）也不串位
  · 新增行没有主键 → 该列保持无值，不会继承别人的值
  · 删掉一行后其余行的原值仍对得上
  · 保存返回体带新的行主键，旧主键全部作废（整表替换重新分配 identity）
  · __rid 是传输元信息，不写进 DataJson（导出里不该出现这一列）
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


user = "ridrestore" + str(int(time.time()))[-6:]
ensure_user(user, "rid_pass_123")
token = login(user, "rid_pass_123")
check("登录成功", bool(token))

headers = ["名称", "数量"]
seed = [["甲", "1"], ["乙", "2"], ["丙", "3"]]

st, r = call("POST", "/excel/upload", form={"file": ("rid.xlsx", make_xlsx(headers, seed))}, token=token)
tid = (r.get("data") or {}).get("tableId") or 0
check("导入 3 行", st == 200 and tid > 0, r)


def snapshot():
    st, r = call("GET", "/excel/query?tableId=%d" % tid, token=token)
    return (r.get("data") or {}).get("rows") or []


def col(name):
    return [str(x.get(name) if x.get(name) is not None else "") for x in snapshot()]


def set_formula(formula, column="数量"):
    return call("PUT", "/excel/formula",
                {"tableId": tid, "columnName": column, "formula": formula}, token=token)


def save(rows):
    return call("POST", "/excel/save", {"tableId": tid, "rows": rows}, token=token)


# ===== 1. 主路径：设公式 → 保存 → 取消公式，原值必须还在 =====
print("\n[1] 原值保留")
check("初始原值 1/2/3", col("数量") == ["1", "2", "3"], col("数量"))

st, r = set_formula("1+1")
check("设公式成功", st == 200 and r.get("success"), r)

rows = snapshot()
check("读出来是算好的 2", [str(x.get("数量")) for x in rows] == ["2", "2", "2"], rows)
old_ids = [x.get("__rid") for x in rows]
check("每行都带行主键", all(old_ids), old_ids)

st, r = save(rows)
check("保存成功", st == 200 and r.get("success"), (st, r.get("message")))

saved = (r.get("data") or {}).get("rows") or []
check("返回体带保存后的行", len(saved) == 3, len(saved))
new_ids = [x.get("__rid") for x in saved]
check("返回的每行都带新行主键", all(new_ids), new_ids)
check("旧主键全部作废（identity 重新分配）", set(old_ids).isdisjoint(set(new_ids)), (old_ids, new_ids))
check("返回的行里计算列已重算", [str(x.get("数量")) for x in saved] == ["2", "2", "2"], saved)

st, r = set_formula("")
check("取消公式成功", st == 200 and r.get("success"), r)
check("原值 1/2/3 回来了", col("数量") == ["1", "2", "3"], col("数量"))


# ===== 2. 顺序打乱：值跟着行走，不按下标错位 =====
print("\n[2] 行顺序打乱")
set_formula("1+1")
rows = snapshot()
rows.reverse()                       # 丙 / 乙 / 甲，主键各自跟着走
st, r = save(rows)
check("乱序保存成功", st == 200 and r.get("success"), (st, r.get("message")))

set_formula("")
by_name = {x.get("名称"): str(x.get("数量")) for x in snapshot()}
check("甲仍对应 1", by_name.get("甲") == "1", by_name)
check("乙仍对应 2", by_name.get("乙") == "2", by_name)
check("丙仍对应 3", by_name.get("丙") == "3", by_name)


# ===== 3. 新增行：没有主键就没有历史原值，不能继承别人的 =====
print("\n[3] 新增行")
set_formula("1+1")
rows = snapshot()
rows.append({"名称": "丁"})           # 新行：没有 __rid，也没有「数量」
st, r = save(rows)
check("带新增行的保存成功", st == 200 and r.get("success"), (st, r.get("message")))

set_formula("")
by_name = {x.get("名称"): ("" if x.get("数量") is None else str(x.get("数量"))) for x in snapshot()}
check("原有三行原值不受影响",
      [by_name.get(n) for n in ("甲", "乙", "丙")] == ["1", "2", "3"], by_name)
check("新增行「数量」为空（本来就没有历史原值）", by_name.get("丁") == "", by_name)


# ===== 4. 删行：剩下的行原值仍对得上 =====
print("\n[4] 删掉一行")
set_formula("1+1")
rows = [x for x in snapshot() if x.get("名称") != "乙"]
st, r = save(rows)
check("删行后保存成功", st == 200 and r.get("success"), (st, r.get("message")))

set_formula("")
by_name = {x.get("名称"): str(x.get("数量")) for x in snapshot()}
check("乙已经没了", "乙" not in by_name, by_name)
check("甲 / 丙 的原值还在",
      [by_name.get("甲"), by_name.get("丙")] == ["1", "3"], by_name)


# ===== 5. 行主键不落库 =====
print("\n[5] 行主键不写进 DataJson")
st, raw = call("GET", "/excel/export-csv?tableId=%d" % tid, token=token, raw=True)
text = raw.decode("utf-8-sig", "replace") if isinstance(raw, bytes) else str(raw)
check("导出的 CSV 不含 __rid 列", "__rid" not in text, text[:200])
check("导出的 CSV 仍含真实列名", "名称" in text and "数量" in text, text[:200])


# ===== 收尾：彻底删除，不给库留垃圾 =====
st, r = call("DELETE", "/excel/delete?tableId=%d" % tid, token=token)
check("删除成功（进回收站）", st == 200 and r.get("success"), r)
st, r = call("DELETE", "/excel/trash/%d" % tid, token=token)
check("彻底删除成功", st == 200 and r.get("success"), r)

print("\n================ 结果：%d 项失败 ================" % fails)
sys.exit(1 if fails else 0)
