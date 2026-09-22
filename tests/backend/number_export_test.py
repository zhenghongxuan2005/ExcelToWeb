# -*- coding: utf-8 -*-
"""导出的数字口径：哪些值会被写成「数值单元格」。

ExcelExportService.TryParseNumber 决定了一列是不是数值列（DetectColumnKind），
进而决定导出时写成数值还是文本。前端也有一套同样的判断（utils.js 的 isSafeNumber，
用于汇总行 / 选中统计 / 填充柄 / 排序 / 数值列判定），两边必须一致 ——
否则会出现「界面上算得出数、导出的 Excel 里却是文本」这种自相矛盾。

本用例把服务端的真实行为钉死，前端 number_test.js 用同一组样例做断言。
两边样例表必须同步修改。

判断依据：xlsx 里数值单元格写作 <c r="B2"><v>1000</v></c>，
文本单元格带 t="s"（sharedStrings 索引）或 t="inlineStr"。
"""
import io
import json
import os as _os
import re
import urllib.error
import urllib.request
import zipfile

BASE = _os.environ.get("TEST_BASE_URL", "http://localhost:5185/api")

USER = "smokenum"
PWD = "smoke_num_pass"

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
        boundary = "----smoke_num_boundary"
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


def make_xlsx(headers, rows):
    def row_xml(r, values):
        cells = "".join(
            '<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>' % (col_letter(i), r, esc(v))
            for i, v in enumerate(values)
        )
        return '<row r="%d">%s</row>' % (r, cells)

    sheet_rows = [row_xml(1, headers)] + [row_xml(i + 2, v) for i, v in enumerate(rows)]
    sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             '<sheetData>%s</sheetData></worksheet>' % "".join(sheet_rows))
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


# ---------- 样例表：前端 number_test.js 用同一组 ----------
# (值, 期望是否为数值单元格)
SAMPLES = [
    ("007", False),                  # 前导零：编号 / 区号，数值化会丢零
    ("1,000", True),                 # 千分位：NumberStyles.Number 认，Number() 不认
    ("1e3", False),                  # 科学计数法：decimal.TryParse 不认
    ("1234567890123456", False),     # 16 位整数：超过 Excel 的 15 位有效数字
    ("0.5", True),
    ("0", True),                     # 单个 0 不算前导零
    ("abc", False),
    ("123456789012345", True),       # 正好 15 位，允许
    ("00.5", False),                 # 前导零（第二位不是小数点）
    ("1,234.5", True),               # 千分位 + 小数
    ("12345678901234567", False),    # 17 位
]

HEADERS = [col_letter(i) for i in range(len(SAMPLES))]

created = []


def cell_kinds(xlsx_bytes):
    """{单元格引用: 类型}，缺 t 属性即数值（'n'）"""
    zf = zipfile.ZipFile(io.BytesIO(xlsx_bytes))
    sheet = zf.read("xl/worksheets/sheet1.xml").decode("utf-8", "ignore")
    kinds = {}
    for m in re.finditer(r"<c r=\"([A-Z]+)(\d+)\"([^>]*)>", sheet):
        col, row, attrs = m.group(1), m.group(2), m.group(3)
        t = re.search(r't="([^"]+)"', attrs)
        kinds[col + row] = t.group(1) if t else "n"
    return kinds


print("=" * 60)
print("导出的数字口径（数值单元格 vs 文本单元格）")
print("=" * 60)

if not ensure_user(USER, PWD):
    print("  FAIL 测试账号准备失败")
    raise SystemExit(1)
TOKEN = login(USER, PWD)
if not TOKEN:
    print("  FAIL 登录失败")
    raise SystemExit(1)

print("\n--- 上传样例 ---")
st, r = call("POST", "/excel/upload",
             form={"file": ("num.xlsx", make_xlsx(HEADERS, [[v for v, _ in SAMPLES]]))}, token=TOKEN)
if not (st == 200 and r.get("success")):
    print("  FAIL 上传失败 -> " + str(r))
    raise SystemExit(1)
created.append(r["data"]["tableId"])
print("  上传成功，tableId = %d" % r["data"]["tableId"])

print("\n--- 导出并检查单元格类型 ---")
st, exp = call("GET", "/excel/export?tableId=%d" % created[0], token=TOKEN, raw=True)
check("导出返回 200", st == 200, st)
check("导出是有效 xlsx", isinstance(exp, bytes) and exp[:2] == b"PK", repr(exp[:20]))

if isinstance(exp, bytes) and exp[:2] == b"PK":
    kinds = cell_kinds(exp)
    for i, (value, want_number) in enumerate(SAMPLES):
        ref = col_letter(i) + "2"
        kind = kinds.get(ref)
        got_number = kind is not None and kind == "n"
        check("%-18s -> %s" % ('"' + value + '"', "数值" if want_number else "文本"),
              got_number == want_number, "实际 t=%s" % kind)

for tid in created:
    call("DELETE", "/excel/delete?tableId=%d" % tid, token=TOKEN)

print("\n" + "=" * 60)
print("结果：%d 通过 / %d 失败" % (passed, failed))
print("=" * 60)
raise SystemExit(1 if failed else 0)
