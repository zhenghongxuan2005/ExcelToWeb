# -*- coding: utf-8 -*-
"""合并单元格：导入按左上角值铺平，导出按原区域还原。

为什么要铺平：动态表是「每行一个 JSON」的矩形结构，没有合并这个概念。把区域铺平
成普通矩形入库（区域内每格都是左上角的值），表格视图、搜索、排序、导出全套逻辑
都不用为合并开特例。

为什么导出必须还原：
  · 被合并吃掉的格子必须留空 —— 铺平后每格都有值，写了的话 Excel 打开会判定
    「合并单元格只能保留左上角」并提示文件已修复
  · 区域记的是列名而不是下标，列改名跟着走、列被移开就放弃，绝不框错位置

覆盖：
  - 表头行合并 → 铺平后走表头去重，不出现静默覆盖
  - 数据区竖直合并 → 区域内每格都拿到左上角的值
  - 导出还原：mergeCell ref 一致、被覆盖格无值
  - 列改名后仍能还原（区域记录跟随改名）
  - 列被移开到不相邻 → 放弃该区域（宁可少还原，也不框错）
  - 行数变了 → 放弃该区域
  - 没有合并的文件：导出行为完全不变
"""
import io
import json
import os as _os
import re
import urllib.error
import urllib.request
import zipfile

BASE = _os.environ.get("TEST_BASE_URL", "http://localhost:5185/api")

USER = "smokemerge"
PWD = "smoke_merge_pass"

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


def call(method, path, body=None, form=None, token=None, raw=False):
    url = BASE + path
    data = None
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if form is not None:
        boundary = "----smoke_merge_boundary"
        buf = io.BytesIO()
        for k, v in form.items():
            fn, content = v
            buf.write(("--%s\r\n" % boundary).encode())
            buf.write(('Content-Disposition: form-data; name="%s"; filename="%s"\r\n' % (k, fn)).encode())
            buf.write(b"Content-Type: application/octet-stream\r\n\r\n")
            buf.write(content)
            buf.write(b"\r\n")
        buf.write(("--%s--\r\n" % boundary).encode())
        data = buf.getvalue()
        headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    elif body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = r.read()
            return (r.status, payload if raw else json.loads(payload.decode("utf-8")))
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return (e.code, json.loads(payload.decode("utf-8")))
        except Exception:
            return (e.code, {"_raw": payload[:300].decode("utf-8", "replace")})


def ensure_user(username, password):
    st, r = call("POST", "/auth/register",
                 {"username": username, "password": password, "confirmPassword": password})
    return (st == 200 and r.get("success")) or (st == 400 and "已被占用" in (r.get("message") or ""))


def login(username, password):
    st, r = call("POST", "/auth/login", {"username": username, "password": password})
    return (r.get("data") or {}).get("token") if (st == 200 and r.get("success")) else None


def col_letter(idx):
    s = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def esc(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def make_xlsx(headers, rows, merges=None):
    """merges: ["A1:B1", ...]，写在 sheetData 之后（OOXML 要求这个顺序）"""
    def row_xml(r, values):
        cells = "".join(
            '<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>' % (col_letter(i), r, esc(v))
            for i, v in enumerate(values)
        )
        return '<row r="%d">%s</row>' % (r, cells)

    sheet_rows = [row_xml(1, headers)] + [row_xml(i + 2, v) for i, v in enumerate(rows)]
    merge_part = ""
    if merges:
        cells = "".join('<mergeCell ref="%s"/>' % m for m in merges)
        merge_part = '<mergeCells count="%d">%s</mergeCells>' % (len(merges), cells)

    sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             '<sheetData>%s</sheetData>%s</worksheet>' % ("".join(sheet_rows), merge_part))
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
          "</Types>")
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>")
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
          '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
    wb_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
               "</Relationships>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


def export_sheet_xml(token, table_id):
    st, exp = call("GET", "/excel/export?tableId=%d" % table_id, token=token, raw=True)
    if st != 200 or not (isinstance(exp, bytes) and exp[:2] == b"PK"):
        return None, st
    zf = zipfile.ZipFile(io.BytesIO(exp))
    return zf.read("xl/worksheets/sheet1.xml").decode("utf-8", "ignore"), st


def merge_refs(sheet_xml):
    return re.findall(r'<mergeCell ref="([^"]+)"', sheet_xml)


def export_all_text(token, table_id):
    """把 xlsx 里所有 xml 部件拼起来。字符串可能落在 sharedStrings，不能只看 sheet1。"""
    st, exp = call("GET", "/excel/export?tableId=%d" % table_id, token=token, raw=True)
    if st != 200 or not (isinstance(exp, bytes) and exp[:2] == b"PK"):
        return None
    zf = zipfile.ZipFile(io.BytesIO(exp))
    return "".join(zf.read(n).decode("utf-8", "ignore") for n in zf.namelist())


created = []


def upload(token, content, name="book.xlsx"):
    st, r = call("POST", "/excel/upload", form={"file": (name, content)}, token=token)
    if st == 200 and r.get("success"):
        created.append(r["data"]["tableId"])
    return st, r


print("=" * 60)
print("合并单元格：导入铺平 + 导出还原")
print("=" * 60)

if not ensure_user(USER, PWD):
    print("  FAIL 测试账号准备失败")
    raise SystemExit(1)
TOKEN = login(USER, PWD)
if not TOKEN:
    print("  FAIL 登录失败")
    raise SystemExit(1)

# ---------- 1) 表头行合并：铺平 + 表头去重 ----------
print("\n--- 1) 表头行合并（A1:B1 大标题） ---")
st, r = upload(TOKEN, make_xlsx(
    ["销售额", "", "数量"],
    [["10", "20", "3"], ["5", "6", "4"]],
    merges=["A1:B1"]))
check("上传成功", st == 200 and r.get("success"), r)
table_a = None
if st == 200 and r.get("success"):
    d = r["data"]
    table_a = d["tableId"]
    check("B1 被铺上左上角的值，表头去重为 [销售额, 销售额_2, 数量]",
          d["headers"] == ["销售额", "销售额_2", "数量"], d["headers"])
    check("第 1 行三列都有值（没被覆盖）",
          d["rows"][0]["销售额"] == "10" and d["rows"][0]["销售额_2"] == "20"
          and d["rows"][0]["数量"] == "3", d["rows"][0])
    check("响应带上合并区域个数", d.get("mergeCount") == 1, d.get("mergeCount"))

# ---------- 2) 数据区竖直合并 ----------
print("\n--- 2) 数据区竖直合并（A2:A3） ---")
st, r = upload(TOKEN, make_xlsx(
    ["名称", "数量"],
    [["合并值", "1"], ["x", "2"], ["y", "3"]],
    merges=["A2:A3"]), name="vertical.xlsx")
if st == 200 and r.get("success"):
    rows = r["data"]["rows"]
    check("合并区域内每格都是左上角的值",
          rows[0]["名称"] == "合并值" and rows[1]["名称"] == "合并值", [x["名称"] for x in rows])
    check("区域外的行不受影响", rows[2]["名称"] == "y", rows[2]["名称"])
    check("记下了 1 个区域", r["data"].get("mergeCount") == 1, r["data"].get("mergeCount"))

# ---------- 3) 导出还原 ----------
print("\n--- 3) 导出还原合并区域 ---")
if table_a:
    sheet_xml, st = export_sheet_xml(TOKEN, table_a)
    check("导出成功", sheet_xml is not None, st)
    if sheet_xml:
        check("还原出 mergeCell A1:B1", "A1:B1" in merge_refs(sheet_xml), merge_refs(sheet_xml))
        check("只还原了 1 个区域", len(merge_refs(sheet_xml)) == 1, merge_refs(sheet_xml))

        # 被合并吃掉的 B1 必须留空，否则 Excel 打开会提示「文件已修复」
        m = re.search(r'<c r="B1"([^>]*?)(/>|>)', sheet_xml)
        if m and m.group(2) == "/>":
            cell_xml = m.group(0)
        elif m:
            end = sheet_xml.find("</c>", m.end())
            cell_xml = sheet_xml[m.start():end + 4] if end != -1 else m.group(0)
        else:
            cell_xml = ""
        check("被覆盖的 B1 是空单元格（不写值，否则 Excel 会报「已修复」）",
              cell_xml != "" and "<v>" not in cell_xml, cell_xml or "(找不到 B1)")

        # 合并会吃掉样式，导出端必须给表头行重施样式，否则表头变成裸文本
        check("合并后表头三格样式仍在",
              len(re.findall(r'<c r="[A-Z]+1" s="', sheet_xml)) == 3,
              re.findall(r'<c r="[A-Z]+1"[^>]*>', sheet_xml))

# ---------- 4) 列改名后仍能还原 ----------
print("\n--- 4) 列改名后区域跟随 ---")
if table_a:
    st, r = call("PUT", "/excel/headers", {
        "tableId": table_a,
        "headers": ["营收", "销售额_2", "数量"],
        "renames": [{"oldName": "销售额", "newName": "营收"}]
    }, token=TOKEN)
    check("改名成功", st == 200 and r.get("success"), r)
    sheet_xml, st = export_sheet_xml(TOKEN, table_a)
    check("改名后仍然还原出 A1:B1", sheet_xml is not None and "A1:B1" in merge_refs(sheet_xml),
          merge_refs(sheet_xml) if sheet_xml else st)

# ---------- 5) 列被移开、不再相邻 → 放弃 ----------
print("\n--- 5) 列被移开（不再相邻）→ 放弃该区域 ---")
if table_a:
    st, r = call("PUT", "/excel/headers", {
        "tableId": table_a,
        "headers": ["营收", "数量", "销售额_2"],
        "renames": []
    }, token=TOKEN)
    check("重排列成功", st == 200 and r.get("success"), r)
    sheet_xml, st = export_sheet_xml(TOKEN, table_a)
    check("不再相邻的区域被放弃（宁可少还原，也不框错地方）",
          sheet_xml is not None and len(merge_refs(sheet_xml)) == 0,
          merge_refs(sheet_xml) if sheet_xml else st)

# ---------- 6) 行数变了 → 放弃 ----------
print("\n--- 6) 行数变化 → 放弃该区域 ---")
st, r = upload(TOKEN, make_xlsx(
    ["名称", "数量"],
    [["合并值", "1"], ["x", "2"], ["y", "3"]],
    merges=["A2:A3"]), name="rowchange.xlsx")
if st == 200 and r.get("success"):
    tid = r["data"]["tableId"]
    sheet_xml, _ = export_sheet_xml(TOKEN, tid)
    check("行数未变时能还原", "A2:A3" in merge_refs(sheet_xml), merge_refs(sheet_xml))

    # 删掉一行（两行数据）
    rows_to_save = r["data"]["rows"][:2]
    st2, r2 = call("POST", "/excel/save", {"tableId": tid, "rows": rows_to_save}, token=TOKEN)
    check("保存（少一行）成功", st2 == 200 and r2.get("success"), r2)
    sheet_xml, _ = export_sheet_xml(TOKEN, tid)
    check("行数变了之后不再还原", len(merge_refs(sheet_xml)) == 0, merge_refs(sheet_xml))

# ---------- 7) 没有合并的文件：回归 ----------
print("\n--- 7) 无合并文件（回归，导出行为不变） ---")
st, r = upload(TOKEN, make_xlsx(["甲", "乙"], [["1", "2"]]), name="plain.xlsx")
if st == 200 and r.get("success"):
    check("mergeCount 为 0", r["data"].get("mergeCount") == 0, r["data"].get("mergeCount"))
    sheet_xml, _ = export_sheet_xml(TOKEN, r["data"]["tableId"])
    check("导出里没有 mergeCells", len(merge_refs(sheet_xml)) == 0, merge_refs(sheet_xml))
    all_text = export_all_text(TOKEN, r["data"]["tableId"])
    check("导出的表头仍然正确（甲乙都在）", all_text is not None and "甲" in all_text and "乙" in all_text,
          (all_text or "")[:200])

# ---------- 8) 未登录 / 越权 ----------
print("\n--- 8) 未登录 / 越权 ---")
if table_a:
    st, r = call("GET", "/excel/export?tableId=%d" % table_a)
    check("未登录导出被拒（401）", st == 401, st)

for tid in created:
    call("DELETE", "/excel/delete?tableId=%d" % tid, token=TOKEN)

print("\n" + "=" * 60)
print("结果：%d 通过 / %d 失败" % (passed, failed))
print("=" * 60)
raise SystemExit(1 if failed else 0)
