# -*- coding: utf-8 -*-
"""导入时表头重名会静默丢数据 —— 回归用例。

缺陷：ExcelSheetReader.ReadHeaders 用 headers.Add() 逐列收集表头，没有去重；
      ReadRows 又把列名当字典键用（row[columnName] = ...），于是同名列会
      覆盖前一个值 —— 任何表头重复的文件（例如「备注」出现两列）导入即丢一列。
      下游本来就容忍不了重名（列结构校验拒绝重复表头、列元数据以列名为键），
      只有导入这一环漏了。

修复：ReadHeaders 内去重，重名追加 _2 / _3 后缀；并夹到 100 字符
      （与 ColumnStructureService 的列名上限一致，否则导入出的表存不进列结构）。

覆盖：
  - 重名列去重，且三列的值都在（不丢数据）
  - 名字本身长得像「_2」时不会撞名（A / A_2 / A_3 而不是 A / A_2 / A_2_2）
  - 超长表头被夹到 100 字符，且去重后仍不超长
  - 空表头补的「列N」与真实表头重名时同样去重
  - 去重后的表头能被 PUT /headers 原样接受（证明下游不再拒绝）
"""
import io
import json
import os as _os
import urllib.error
import urllib.request
import zipfile

BASE = _os.environ.get("TEST_BASE_URL", "http://localhost:5185/api")

USER = "smokedup"
PWD = "smoke_dup_pass"

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
        boundary = "----smoke_dup_boundary"
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


created = []


def upload(token, headers, rows, name="dup.xlsx"):
    body, ct = make_xlsx(headers, rows), None
    st, r = call("POST", "/excel/upload", form={"file": (name, body)}, token=token)
    if st == 200 and r.get("success"):
        created.append(r["data"]["tableId"])
        return r["data"]
    return None


def cleanup(token):
    for tid in created:
        call("DELETE", "/excel/delete?tableId=%d" % tid, token=token)


print("=" * 60)
print("表头重名去重（导入不丢数据）")
print("=" * 60)

if not ensure_user(USER, PWD):
    print("  FAIL 测试账号准备失败")
    raise SystemExit(1)
TOKEN = login(USER, PWD)
if not TOKEN:
    print("  FAIL 登录失败")
    raise SystemExit(1)

# ---------- 1) 重名列：值必须全部保留 ----------
print("\n--- 1) 重名列去重 ---")
data = upload(TOKEN, ["备注", "数量", "备注"],
              [["甲备注", "1", "乙备注"], ["丙", "2", "丁"]])
if not data:
    check("上传重名表头文件成功", False, "上传失败")
else:
    check("上传成功", True)
    hs = data["headers"]
    check("表头去重为 [备注, 数量, 备注_2]", hs == ["备注", "数量", "备注_2"], hs)

    rows = data["rows"]
    check("行数 = 2", len(rows) == 2, len(rows))
    if len(rows) == 2:
        check("第 1 行三列的值都在（不丢数据）",
              rows[0].get("备注") == "甲备注" and rows[0].get("数量") == "1" and rows[0].get("备注_2") == "乙备注",
              rows[0])
        check("第 2 行三列的值都在",
              rows[1].get("备注") == "丙" and rows[1].get("数量") == "2" and rows[1].get("备注_2") == "丁",
              rows[1])
        check("重名列的两列值不相同（确实没被覆盖）",
              rows[0].get("备注") != rows[0].get("备注_2"), rows[0])

    # 去重后的表头必须能被列结构接口原样接受
    st, r = call("PUT", "/excel/headers",
                 {"tableId": data["tableId"], "headers": hs, "renames": []}, token=TOKEN)
    check("去重后的表头可被 PUT /headers 接受（下游不再拒绝重名）",
          st == 200 and r.get("success"), r)

# ---------- 2) 名字长得像 _2：不撞名、不堆叠后缀 ----------
print("\n--- 2) 名字本身含 _2 的情形 ---")
data = upload(TOKEN, ["A", "A", "A_2"], [["1", "2", "3"]], name="suffix.xlsx")
if not data:
    check("上传成功（A / A / A_2）", False, "上传失败")
else:
    check("A / A / A_2 -> [A, A_2, A_3]（不产生 A_2_2）",
          data["headers"] == ["A", "A_2", "A_3"], data["headers"])
    check("三列的值都在", sorted(data["rows"][0].values()) == ["1", "2", "3"], data["rows"][0])

# ---------- 3) 超长表头 ----------
print("\n--- 3) 超长表头夹到 100 字符 ---")
long_a = "X" * 120
data = upload(TOKEN, [long_a, long_a], [["1", "2"]], name="long.xlsx")
if not data:
    check("上传成功（两个 120 字符同名表头）", False, "上传失败")
else:
    hs = data["headers"]
    check("两个表头都 <= 100 字符", all(len(h) <= 100 for h in hs), [len(h) for h in hs])
    check("两个表头互不相同", hs[0] != hs[1], hs)
    check("第二个表头以 _2 结尾", hs[1].endswith("_2"), hs[1])
    check("值未被覆盖", sorted(data["rows"][0].values()) == ["1", "2"], data["rows"][0])

# ---------- 4) 空表头补的「列N」与真实表头撞名 ----------
print("\n--- 4) 空表头补名撞车 ---")
data = upload(TOKEN, ["列2", "", "x"], [["a", "b", "c"]], name="blank.xlsx")
if not data:
    check("上传成功（表头含空列且与补名撞车）", False, "上传失败")
else:
    hs = data["headers"]
    check("空表头补名后与已有「列2」去重", hs == ["列2", "列2_2", "x"], hs)
    check("三列的值都在", sorted(data["rows"][0].values()) == ["a", "b", "c"], data["rows"][0])

# ---------- 5) 不重名的文件行为不变（回归） ----------
print("\n--- 5) 正常文件不受影响 ---")
data = upload(TOKEN, ["姓名", "数量"], [["张三", "5"]], name="normal.xlsx")
if not data:
    check("上传成功（无重名）", False, "上传失败")
else:
    check("表头原样保留", data["headers"] == ["姓名", "数量"], data["headers"])
    check("值原样保留", data["rows"][0].get("姓名") == "张三", data["rows"][0])

cleanup(TOKEN)

print("\n" + "=" * 60)
print("结果：%d 通过 / %d 失败" % (passed, failed))
print("=" * 60)
raise SystemExit(1 if failed else 0)
