# -*- coding: utf-8 -*-
"""多工作表导入：列出工作表 + 按序号导入其中一张。

背景：原先 upload 固定读第一个工作表，用户拿到的文件若有多个工作表，
只能导入第一张且完全不知道还有别的。现在：
  POST /excel/sheets              列出工作表（序号 / 名称 / 行数 / 列数 / 是否有数据）
  POST /excel/upload?sheetIndex=N 导入指定的一张（0 基，不传仍是第一张）

覆盖：
  - 工作表清单的序号与名称、行数列数、hasData 判定
  - 按序号导入正确的那张（表头与数据都来自目标表）
  - 表名拼接：多工作表文件带工作表名，单工作表文件保持原样（不改既有行为）
  - 序号越界给出可读提示而不是 500
  - 只有表头没有数据的工作表 hasData=false
"""
import io
import json
import os as _os
import re
import urllib.error
import urllib.request
import zipfile

BASE = _os.environ.get("TEST_BASE_URL", "http://localhost:5185/api")

USER = "smokesheets"
PWD = "smoke_sheets_pass"

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
        boundary = "----smoke_sheets_boundary"
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


def sheet_xml(headers, rows):
    """一个工作表的 XML；rows 可以为空（只有表头）"""
    def row_xml(r, values):
        cells = "".join(
            '<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>' % (col_letter(i), r, esc(v))
            for i, v in enumerate(values)
        )
        return '<row r="%d">%s</row>' % (r, cells)

    data_rows = [row_xml(1, headers)] + [row_xml(i + 2, v) for i, v in enumerate(rows)]
    width = max([len(headers)] + [len(r) for r in rows]) if headers else 1
    ref = "A1:%s%d" % (col_letter(width - 1), len(data_rows))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<dimension ref="%s"/><sheetData>%s</sheetData></worksheet>' % (ref, "".join(data_rows)))


def make_xlsx(sheets):
    """sheets: [(名称, 表头, 数据行), ...]，只写第一个工作表以外的部分由 pairs 决定"""
    sheet_tags, rel_tags, parts = [], [], []
    overrides = []
    for i, (name, headers, rows) in enumerate(sheets, start=1):
        sheet_tags.append('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (esc(name), i, i))
        rel_tags.append('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i, i))
        parts.append(("xl/worksheets/sheet%d.xml" % i, sheet_xml(headers, rows)))
        overrides.append('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % i)

    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          + "".join(overrides) + "</Types>")
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>")
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
          '<sheets>%s</sheets></workbook>' % "".join(sheet_tags))
    wb_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               + "".join(rel_tags) + "</Relationships>")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        for path, content in parts:
            z.writestr(path, content)
    return buf.getvalue()


TWO_SHEETS = make_xlsx([
    ("Sheet1", ["姓名", "数量"], [["张三", "1"], ["李四", "2"]]),
    ("第二张表", ["部门", "预算"], [["研发", "100"], ["市场", "200"], ["行政", "300"]]),
])
SINGLE_SHEET = make_xlsx([("唯一表", ["品类", "库存"], [["甲", "9"]])])
EMPTY_SHEET = make_xlsx([("空白表", ["列一", "列二"], [])])

created = []


def upload(token, content, name="book.xlsx", sheet_index=None):
    path = "/excel/upload" if sheet_index is None else "/excel/upload?sheetIndex=%d" % sheet_index
    st, r = call("POST", path, form={"file": (name, content)}, token=token)
    if st == 200 and r.get("success"):
        created.append(r["data"]["tableId"])
    return st, r


print("=" * 60)
print("多工作表导入")
print("=" * 60)

if not ensure_user(USER, PWD):
    print("  FAIL 测试账号准备失败")
    raise SystemExit(1)
TOKEN = login(USER, PWD)
if not TOKEN:
    print("  FAIL 登录失败")
    raise SystemExit(1)

# ---------- 1) 列出工作表 ----------
print("\n--- 1) 列出工作表 ---")
st, r = call("POST", "/excel/sheets", form={"file": ("book.xlsx", TWO_SHEETS)}, token=TOKEN)
check("列出成功", st == 200 and r.get("success"), r)
sheets = r.get("data") or []
check("返回 2 张工作表", len(sheets) == 2, sheets)
if len(sheets) == 2:
    check("第 1 张序号 0 / 名称 Sheet1",
          sheets[0]["index"] == 0 and sheets[0]["name"] == "Sheet1", sheets[0])
    check("第 2 张序号 1 / 名称 第二张表",
          sheets[1]["index"] == 1 and sheets[1]["name"] == "第二张表", sheets[1])
    check("第 1 张行数列数正确（含表头 3 行 / 2 列）",
          sheets[0]["rowCount"] == 3 and sheets[0]["columnCount"] == 2, sheets[0])
    check("第 2 张行数列数正确（含表头 4 行 / 2 列）",
          sheets[1]["rowCount"] == 4 and sheets[1]["columnCount"] == 2, sheets[1])
    check("两张都有可导入数据", sheets[0]["hasData"] and sheets[1]["hasData"], sheets)

# ---------- 2) 按序号导入第二张 ----------
print("\n--- 2) 导入第 2 张（sheetIndex=1） ---")
st, r = upload(TOKEN, TWO_SHEETS, sheet_index=1)
check("导入成功", st == 200 and r.get("success"), r)
if st == 200 and r.get("success"):
    d = r["data"]
    check("表头来自第二张", d["headers"] == ["部门", "预算"], d["headers"])
    check("数据来自第二张（3 行）", len(d["rows"]) == 3, len(d["rows"]))
    check("第 1 行内容正确",
          d["rows"][0].get("部门") == "研发" and d["rows"][0].get("预算") == "100", d["rows"][0])
    check("响应的 sheetName 是第二张的名字", d.get("sheetName") == "第二张表", d.get("sheetName"))
    check("多工作表 → 表名带上工作表名",
          d["tableName"] == "book - 第二张表", d["tableName"])

# ---------- 3) 不传 sheetIndex 仍是第一张（回归） ----------
print("\n--- 3) 不传 sheetIndex → 第一张（既有行为不变） ---")
st, r = upload(TOKEN, TWO_SHEETS)
check("导入成功", st == 200 and r.get("success"), r)
if st == 200 and r.get("success"):
    d = r["data"]
    check("表头来自第一张", d["headers"] == ["姓名", "数量"], d["headers"])
    check("数据来自第一张（2 行）", len(d["rows"]) == 2, len(d["rows"]))
    check("sheetName 是第一张的名字", d.get("sheetName") == "Sheet1", d.get("sheetName"))

# ---------- 4) 单工作表文件：表名不带工作表名 ----------
print("\n--- 4) 单工作表文件 ---")
st, r = call("POST", "/excel/sheets", form={"file": ("solo.xlsx", SINGLE_SHEET)}, token=TOKEN)
check("只返回 1 张", st == 200 and len(r.get("data") or []) == 1, r)
st, r = upload(TOKEN, SINGLE_SHEET, name="solo.xlsx")
check("导入成功", st == 200 and r.get("success"), r)
if st == 200 and r.get("success"):
    check("表名保持文件名、不拼工作表名",
          r["data"]["tableName"] == "solo", r["data"]["tableName"])

# ---------- 5) 越界与空表 ----------
print("\n--- 5) 序号越界 / 空工作表 ---")
st, r = upload(TOKEN, TWO_SHEETS, sheet_index=5)
check("越界导入被拒绝（400）", st == 400, st)
check("给出可读的越界提示", "超出范围" in (r.get("message") or ""), r.get("message"))

st, r = upload(TOKEN, TWO_SHEETS, sheet_index=-1)
check("负数序号被拒绝（400）", st == 400, st)

st, r = call("POST", "/excel/sheets", form={"file": ("empty.xlsx", EMPTY_SHEET)}, token=TOKEN)
check("空表也能列出", st == 200 and r.get("success"), r)
if st == 200 and r.get("success"):
    only = (r.get("data") or [{}])[0]
    check("空表 hasData=false", only.get("hasData") is False, only)

st, r = upload(TOKEN, EMPTY_SHEET, name="empty.xlsx")
check("空表导入被拒绝（400）", st == 400, st)

# ---------- 6) 非 Excel 文件 ----------
print("\n--- 6) 非 Excel 文件 ---")
st, r = call("POST", "/excel/sheets", form={"file": ("note.txt", b"hello")}, token=TOKEN)
check("列出工作表时拒绝非 xlsx/xls", st == 400 and "xlsx" in (r.get("message") or ""), r)

for tid in created:
    call("DELETE", "/excel/delete?tableId=%d" % tid, token=TOKEN)

print("\n" + "=" * 60)
print("结果：%d 通过 / %d 失败" % (passed, failed))
print("=" * 60)
raise SystemExit(1 if failed else 0)
