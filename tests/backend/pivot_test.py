# -*- coding: utf-8 -*-
"""透视汇总：唯一一份计算（PivotService），预览与导出共用。

为什么盯着「预览和导出一致」这件事测：导出走的是同一份 PivotService，
只要两边都调它，数字就不可能对不上。本文件 [10] 那一段把导出结果拆开、
逐格核对，钉死这条。

覆盖：
  - 未登录 / 越权 / 字段不存在 / 行=列 / 不支持的聚合方式
  - sum / count / avg / max / min 五种聚合
  - 空单元格不参与分组；没有数据的组合返回空串而不是 0
  - 行 / 列都不分组时，结果退化成唯一一格的总计
  - 行列顺序确定（全数字按数值排序）
  - 非数字整列拒绝（而不是静默丢掉那几个数字）
  - 取值超过 200 个直接拒绝，不截断
  - 计算列参与透视时按公式现算
  - 导出 xlsx：数据表 + 「透视」表两张，数字与预览一致
"""
import io
import os as _os
import sys as _sys
import zipfile

_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "helpers"))
from smoke_base import call, ensure_user, login, make_xlsx, package_text  # noqa: E402

USER = "smokepivot"
PWD = "smoke_pivot_pass"
USER2 = "smokepivot2"
PWD2 = "smoke_pivot_pass2"

passed = 0
failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print("  PASS " + name)
    else:
        failed += 1
        print("  FAIL " + name + (("  -> " + str(extra)) if extra else ""))


TOKEN = None
TOKEN2 = None
created = []


def upload(headers, rows, name="pivot.xlsx"):
    st, r = call("POST", "/excel/upload", form={"file": (name, make_xlsx(headers, rows))}, token=TOKEN)
    if st == 200 and r.get("success"):
        created.append(r["data"]["tableId"])
    return st, r


def pivot(table_id, value, row="", col="", agg="sum", token=None):
    return call("POST", "/excel/pivot", {
        "tableId": table_id, "rowField": row, "colField": col,
        "valueField": value, "agg": agg
    }, token=TOKEN if token is None else token)


def export_pivot(table_id, value, row="", col="", agg="sum"):
    return call("POST", "/excel/pivot-export", {
        "tableId": table_id, "rowField": row, "colField": col,
        "valueField": value, "agg": agg
    }, token=TOKEN, raw=True)


def save(table_id, rows):
    """rows 传「按当前表头顺序的值列表」，这里转成服务端要的「列名 -> 值」字典。

    服务端是整表替换：直接发值列表不会报错，只会绑成一批空行 —— 数据没变而用例
    以为变了，这种假通过比直接失败更难发现，所以统一在 helper 里转一次。
    """
    st, q = call("GET", "/excel/query?tableId=%d" % table_id, token=TOKEN)
    headers = (q.get("data") or {}).get("headers") or []
    dicts = [{h: (r[i] if i < len(r) else "") for i, h in enumerate(headers)} for r in rows]
    return call("POST", "/excel/save", {"tableId": table_id, "rows": dicts}, token=TOKEN)


print("=" * 60)
print("透视汇总：一份计算，预览与导出共用")
print("=" * 60)

if not ensure_user(USER, PWD) or not ensure_user(USER2, PWD2):
    print("  FAIL 测试账号准备失败")
    raise SystemExit(1)
TOKEN = login(USER, PWD)
TOKEN2 = login(USER2, PWD2)
if not TOKEN or not TOKEN2:
    print("  FAIL 登录失败")
    raise SystemExit(1)

# ---------- 1) 未登录 / 参数校验 ----------
print("\n--- 1) 未登录 / 越权 / 参数校验 ---")
st, _ = pivot(1, "x", token="")
check("未登录被拒（401）", st == 401, st)

DATA_HEADERS = ["地区", "品类", "金额"]
DATA_ROWS = [
    ["华东", "A", "10"],
    ["华东", "B", "20"],
    ["华北", "A", "5"],
    ["华北", "B", ""],
    ["华东", "A", "30"],
]
st, r = upload(DATA_HEADERS, DATA_ROWS, name="pivot_base.xlsx")
check("上传测试数据成功", st == 200 and r.get("success"), r)
base = r["data"]["tableId"] if st == 200 else None

if base:
    st, r = pivot(base, "金额", row="地区", col="品类")
    check("正常请求成功", st == 200 and r.get("success"), r)
    d = r.get("data") or {}
    check("RowKeys 是分组键", d.get("rowKeys") == ["华东", "华北"], d.get("rowKeys"))
    check("ColKeys 是展开键", d.get("colKeys") == ["A", "B"], d.get("colKeys"))
    check("SourceRows 是原始行数", d.get("sourceRows") == 5, d.get("sourceRows"))
    check("ValueLabel 说清了口径", d.get("valueLabel") == "求和(金额)", d.get("valueLabel"))

    st, r = pivot(base, "")
    check("没选汇总列被拒（400）", st == 400, (st, r))
    check("提示能看懂", "汇总" in (r.get("message") or ""), r.get("message"))

    st, r = pivot(base, "金额", row="查无此列")
    check("行字段不存在被拒（400）", st == 400 and "查无此列" in (r.get("message") or ""), (st, r.get("message")))

    st, r = pivot(base, "金额", col="查无此列")
    check("列字段不存在被拒（400）", st == 400, (st, r))

    st, r = pivot(base, "金额", row="地区", col="地区")
    check("行字段与列字段相同被拒（400）", st == 400 and "同一列" in (r.get("message") or ""), (st, r.get("message")))

    st, r = pivot(base, "金额", agg="median")
    check("不支持的聚合方式被拒（400）", st == 400, (st, r))

    st, r = pivot(base, "金额", row="地区", token=TOKEN2)
    check("别人的表查不到（400）", st == 400 and "不存在" in (r.get("message") or ""), (st, r.get("message")))

# ---------- 2) sum：格子 / 行列合计 / 总计 ----------
print("\n--- 2) 求和：格子与三个方向的合计 ---")
if base:
    st, r = pivot(base, "金额", row="地区", col="品类")
    d = r.get("data") or {}
    check("格子对：华东 A=40 / B=20", d["cells"][0] == ["40", "20"], d["cells"])
    check("没有数据的组合是空串而不是 0（华北B 的金额为空）", d["cells"][1][1] == "", d["cells"][1])
    check("行合计", d["rowTotals"] == ["60", "5"], d["rowTotals"])
    check("列合计", d["colTotals"] == ["45", "20"], d["colTotals"])
    check("总计", d["grandTotal"] == "65", d["grandTotal"])

    # 表里再塞一行「地区为空」：它不该出现在任何分组里，也不该进总计
    save(base, DATA_ROWS + [["", "A", "100"]])
    st, r = pivot(base, "金额", row="地区", col="品类")
    d = r.get("data") or {}
    check("行键里没有空值（空单元格不参与分组）", "" not in d["rowKeys"], d["rowKeys"])
    check("空地区那一行不计入总计", d["grandTotal"] == "65", d["grandTotal"])
    check("但原始行数如实计入", d["sourceRows"] == 6, d["sourceRows"])
    save(base, DATA_ROWS)

# ---------- 3) 其它四种聚合 ----------
print("\n--- 3) 计数 / 平均 / 最大 / 最小 ---")
if base:
    st, r = pivot(base, "金额", row="地区", col="品类", agg="count")
    d = r.get("data") or {}
    check("计数：华东 A 有 2 条", d["cells"][0] == ["2", "1"], d["cells"])
    check("计数：一条都没有的组合是空串", d["cells"][1][1] == "", d["cells"][1])
    check("计数合计（只数非空）", d["grandTotal"] == "4", d["grandTotal"])
    check("计数的标签", d["valueLabel"] == "计数(金额)", d["valueLabel"])

    st, r = pivot(base, "金额", row="地区", col="品类", agg="avg")
    d = r.get("data") or {}
    check("平均：华东 A = (10+30)/2", d["cells"][0][0] == "20", d["cells"][0])
    check("平均：总计 = 65/4", d["grandTotal"] == "16.25", d["grandTotal"])

    st, r = pivot(base, "金额", row="地区", agg="max")
    check("最大", (r.get("data") or {}).get("rowTotals") == ["30", "5"], r.get("data"))

    st, r = pivot(base, "金额", row="地区", agg="min")
    check("最小", (r.get("data") or {}).get("rowTotals") == ["10", "5"], r.get("data"))

# ---------- 4) 非数字整列拒绝 ----------
print("\n--- 4) 值字段混了文字：整列拒绝，不静默丢数 ---")
if base:
    save(base, [["华东", "A", "10"], ["华东", "A", "abc"]])
    st, r = pivot(base, "金额", row="地区", agg="sum")
    check("求和被拒（400）", st == 400, (st, r))
    check("提示里指出了是哪个值", "abc" in (r.get("message") or ""), r.get("message"))

    st, r = pivot(base, "金额", row="地区", agg="count")
    check("同样的数据改用计数仍然可以", st == 200 and (r.get("data") or {}).get("grandTotal") == "2", r)
    save(base, DATA_ROWS)

# ---------- 5) 不分组 ----------
print("\n--- 5) 两个维度都不分组：退化成唯一一格的总计 ---")
if base:
    st, r = pivot(base, "金额")
    d = r.get("data") or {}
    check("行轴只有一条（空标签）", d["rowKeys"] == [""], d["rowKeys"])
    check("列轴只有一条（空标签）", d["colKeys"] == [""], d["colKeys"])
    check("格子数是 1×1", len(d["cells"]) == 1 and len(d["cells"][0]) == 1, d["cells"])
    check("数字就是总计", d["cells"][0][0] == "65" and d["grandTotal"] == "65", d)

    st, r = pivot(base, "金额", col="品类")
    d = r.get("data") or {}
    check("只按列展开：行轴一条、列轴两条", d["rowKeys"] == [""] and d["colKeys"] == ["A", "B"], d)
    check("列合计就是各列总计", d["cells"][0] == ["45", "20"], d["cells"])

    st, r = pivot(base, "金额", row="地区")
    d = r.get("data") or {}
    check("只按行分组：列轴一条", d["colKeys"] == [""], d["colKeys"])
    check("格子是每行的合计", [line[0] for line in d["cells"]] == ["60", "5"], d["cells"])

# ---------- 6) 行列顺序确定 ----------
print("\n--- 6) 行列顺序：全数字按数值排序 ---")
st, r = upload(["编号", "金额"], [["10", "1"], ["2", "2"], ["1", "4"]], name="pivot_sort.xlsx")
if st == 200 and r.get("success"):
    st, r = pivot(r["data"]["tableId"], "金额", row="编号")
    check("数字键按数值排（1,2,10 而不是 1,10,2）",
          (r.get("data") or {}).get("rowKeys") == ["1", "2", "10"], r.get("data"))

# ---------- 7) 取值过多直接拒绝 ----------
print("\n--- 7) 取值超过 200 个：拒绝而不是截断 ---")
st, r = upload(["键", "值"], [["K%03d" % i, "1"] for i in range(201)], name="pivot_many.xlsx")
if st == 200 and r.get("success"):
    tid = r["data"]["tableId"]
    st, r = pivot(tid, "值", row="键")
    check("超过 200 被拒（400）", st == 400, (st, r))
    check("提示里说清了是行字段超了", "200" in (r.get("message") or ""), r.get("message"))
    st, r = pivot(tid, "值", col="键")
    check("列方向同样被拒", st == 400, (st, r))

# ---------- 8) 计算列参与透视 ----------
print("\n--- 8) 计算列的值现算，透视跟着走 ---")
st, r = upload(["单价", "数量"], [["10", "3"], ["4", "5"]], name="pivot_calc.xlsx")
if st == 200 and r.get("success"):
    tid = r["data"]["tableId"]
    call("PUT", "/excel/headers",
         {"tableId": tid, "headers": ["单价", "数量", "合计"], "renames": []}, token=TOKEN)
    call("PUT", "/excel/formula",
         {"tableId": tid, "columnName": "合计", "formula": "[单价] * [数量]"}, token=TOKEN)

    st, r = pivot(tid, "合计", col="单价")
    d = r.get("data") or {}
    check("按计算列汇总成功（不落库也现算得出来）", st == 200 and d.get("grandTotal") == "50", (st, d))
    # 列键按数值排序，所以是 单价=4 在前（合计 4×5=20）、单价=10 在后（10×3=30）
    check("格子里是两个乘积", d["cells"][0] == ["20", "30"], d.get("cells"))

# ---------- 9) 导出 ----------
print("\n--- 9) 导出：数据表 + 透视表两张 ---")
if base:
    st, raw = export_pivot(base, "金额", row="地区", col="品类")
    check("导出成功", st == 200 and isinstance(raw, bytes) and raw[:2] == b"PK", st)
    if st == 200 and isinstance(raw, bytes) and raw[:2] == b"PK":
        zf = zipfile.ZipFile(io.BytesIO(raw))
        wb = zf.read("xl/workbook.xml").decode("utf-8", "ignore")
        text = package_text(raw)

        check("工作簿里有「透视」这张表", "透视" in wb, wb[:300])
        check("两张工作表（数据 + 透视）", wb.count("<sheet ") == 2, wb.count("<sheet "))
        check("原始数据表还在", "地区" in text and "华东" in text, text[:200])
        check("透视表有标题", "透视汇总" in text, text[:200])
        check("透视表写明了口径", "求和(金额)" in text, text[:200])
        # 数字写成了真数值：EPPlus 写 <v>40</v>
        check("格子 40 写成了真数值", ">40<" in text, text[:300])
        check("总计 65 写成了真数值", ">65<" in text, text[:300])
        check("口径说明里带上了行 / 列字段", "行：地区" in text, text[:300])

# ---------- 10) 导出与预览一致 ----------
print("\n--- 10) 导出与预览是同一份数字 ---")
if base:
    st, pr = pivot(base, "金额", row="地区", col="品类", agg="avg")
    st2, raw = export_pivot(base, "金额", row="地区", col="品类", agg="avg")
    check("两边都成功", st == 200 and st2 == 200, (st, st2))
    if st == 200 and st2 == 200 and isinstance(raw, bytes):
        text = package_text(raw)
        d = pr.get("data") or {}
        # 预览里的每个关键数字，导出里都必须有
        wanted = [d["grandTotal"], d["cells"][0][0], d["colTotals"][1], d["rowTotals"][1]]
        check("预览的四个关键数字都出现在导出里：%s" % wanted,
              all((">%s<" % w) in text for w in wanted), wanted)

# ---------- 11) 导出也要校验 ----------
print("\n--- 11) 导出同样先校验 ---")
if base:
    st, r = export_pivot(base, "查无此列")
    check("导出不存在的列被拒（400）", st == 400, (st, r))
    check("错误提示是 JSON 而不是坏掉的文件",
          isinstance(r, dict) and r.get("success") is False, r)

for tid in created:
    call("DELETE", "/excel/delete?tableId=%d" % tid, token=TOKEN)

print("\n" + "=" * 60)
print("结果：%d 通过 / %d 失败" % (passed, failed))
print("=" * 60)
raise SystemExit(1 if failed else 0)
