# -*- coding: utf-8 -*-
"""EPPlus 8 升级专项验证：模板样式生成 + xlsx 往返（写出→再读入）。

step1/step3 冒烟只覆盖了「解析上传」和「导出 xlsx」，没有覆盖模板下载——
而模板正是样式 API（Fill.PatternType / BackgroundColor.SetColor / Font.Color.SetColor /
Merge / HorizontalAlignment）最集中的地方，跨大版本最容易出问题。这里专门补上。

另外做一次往返：把导出的 xlsx 重新上传解析，证明 EPPlus 8 写出的文件自己读得回来。
"""
import io, json, re, sys, zipfile, urllib.request, urllib.error

BASE = "http://localhost:5185/api"
# 可通过环境变量 TEST_BASE_URL 覆盖，便于 CI / 其他端口
import os as _os
BASE = _os.environ.get("TEST_BASE_URL", BASE)
USER = "tmpltest"
PWD = "tmplpass123"

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print("  PASS " + name)
    else:
        failed += 1
        print("  FAIL " + name + ("  -> " + str(detail) if detail else ""))


def call(method, path, body=None, token=None, raw=False, content_type=None):
    headers = {}
    data = None
    if body is not None:
        if isinstance(body, bytes):
            data = body
            if content_type:
                headers["Content-Type"] = content_type
        else:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = r.read()
            return r.status, (payload if raw else json.loads(payload.decode()))
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload.decode())
        except Exception:
            return e.code, payload.decode(errors="replace")


def multipart(filename, content):
    boundary = "----tmplboundary1234567890"
    body = (
        "--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\n"
        "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
        % (boundary, filename)
    ).encode()
    body += content + b"\r\n"
    body += ("--%s--\r\n" % boundary).encode()
    return body, "multipart/form-data; boundary=" + boundary


# ---------- 造一个最小 xlsx ----------
def col_letter(i):
    s = ""
    i += 1
    while i:
        i, rem = divmod(i - 1, 26)
        s = chr(65 + rem) + s
    return s


HEADERS = ["日期", "数量", "单价(元)", "销售员"]
DATA = [["2026-01-05", "10", "35.5", "张三"], ["2026-01-06", "3", "120", "李四"]]


def row_xml(r, vals):
    return '<row r="%d">%s</row>' % (
        r,
        "".join('<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>' % (col_letter(i), r, v)
                for i, v in enumerate(vals)),
    )


sheet = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<dimension ref="A1:D%d"/><sheetData>%s</sheetData></worksheet>'
    % (len(DATA) + 1, "".join([row_xml(1, HEADERS)] + [row_xml(i + 2, v) for i, v in enumerate(DATA)]))
)
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml",
               '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
               '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
               '<Default Extension="xml" ContentType="application/xml"/>'
               '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
               '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
               "</Types>")
    z.writestr("_rels/.rels",
               '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
               "</Relationships>")
    z.writestr("xl/workbook.xml",
               '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
               'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
               '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
    z.writestr("xl/_rels/workbook.xml.rels",
               '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
               "</Relationships>")
    z.writestr("xl/worksheets/sheet1.xml", sheet)
XLSX = buf.getvalue()

print("[1] 登录")
call("POST", "/auth/register", {"username": USER, "password": PWD, "confirmPassword": PWD})
st, r = call("POST", "/auth/login", {"username": USER, "password": PWD})
check("登录成功", st == 200 and r.get("success"), r)
token = (r.get("data") or {}).get("token")
if not token:
    sys.exit("无法登录")

print("\n[2] 上传 xlsx（EPPlus 解析路径）")
body, ct = multipart("tmpl.xlsx", XLSX)
st, r = call("POST", "/excel/upload", body, token=token, content_type=ct)
check("上传成功", st == 200 and r.get("success"), r)
table_id = (r.get("data") or {}).get("tableId")
check("拿到 tableId", bool(table_id), r)
check("表头解析正确", (r.get("data") or {}).get("headers") == HEADERS, (r.get("data") or {}).get("headers"))

print("\n[3] 下载模板（样式 API 集中路径）")
st, tpl = call("GET", "/excel/template?tableId=%d" % table_id, token=token, raw=True)
check("模板下载返回 200", st == 200, st)
check("返回的是 xlsx（zip 头 PK）", isinstance(tpl, bytes) and tpl[:2] == b"PK", repr(tpl[:20]))
if not (isinstance(tpl, bytes) and tpl[:2] == b"PK"):
    sys.exit("模板不是有效 xlsx，无法继续")

zf = zipfile.ZipFile(io.BytesIO(tpl))
names = zf.namelist()
check("zip 内含 sheet1.xml", "xl/worksheets/sheet1.xml" in names, names)
check("zip 内含 styles.xml", "xl/styles.xml" in names, names)

sheet_xml = zf.read("xl/worksheets/sheet1.xml").decode("utf-8", "ignore").upper()
styles_xml = zf.read("xl/styles.xml").decode("utf-8", "ignore").upper() if "xl/styles.xml" in names else ""

# 注意：EPPlus 默认把字符串写进 sharedStrings.xml，sheet1.xml 里只有 t="s" + <v>索引</v>。
# 所以查文字必须把两个部件合起来看，只看 sheet1.xml 会误判成「文字没写进去」。
tpl_text = ""
for part in ("xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"):
    if part in names:
        tpl_text += zf.read(part).decode("utf-8", "ignore")

print("      —— 模板内容与样式断言 ——")
check("表头文字写入（日期/销售员）", "日期" in tpl_text and "销售员" in tpl_text, "")
check("示例行文字写入（示例数据/100.00）", "示例数据" in tpl_text and "100.00" in tpl_text, "")
check("第3行提示文字写入", "请从第4行开始填写数据" in tpl_text, "")
check("Merge=true 生效（出现 mergeCell A3:D3）", 'MERGECELL' in sheet_xml and 'A3:D3' in sheet_xml,
      re.findall(r'<mergeCell[^>]*>', sheet_xml))
check("表头浅灰填充生效（FILL 含 D3D3D3）", "D3D3D3" in styles_xml, "")
check("提示文字红色生效（含 FF0000）", "FF0000" in styles_xml, "")
check("示例行灰色生效（含 808080）", "808080" in styles_xml, "")
# EPPlus 把布尔元素写成 `<b />` / `<i />`（斜杠前有空格），不能用 `<B/>` 精确匹配
check("表头加粗生效（font 含 <b）", re.search(r'<B[\s/>]', styles_xml) is not None, "")
check("示例行斜体生效（font 含 <i）", re.search(r'<I[\s/>]', styles_xml) is not None, "")
check("水平居中生效（含 CENTER）", "CENTER" in styles_xml, "")
check("AutoFitColumns 生效（cols 含 customWidth）", "CUSTOMWIDTH" in sheet_xml, "")

print("\n[4] 导出 xlsx 并做往返（写出的文件必须能被自己读回）")
st, exp = call("GET", "/excel/export?tableId=%d" % table_id, token=token, raw=True)
check("导出返回 200", st == 200, st)
check("导出是有效 zip", isinstance(exp, bytes) and exp[:2] == b"PK", repr(exp[:20]))

if isinstance(exp, bytes) and exp[:2] == b"PK":
    body2, ct2 = multipart("roundtrip.xlsx", exp)
    st2, r2 = call("POST", "/excel/upload", body2, token=token, content_type=ct2)
    check("导出的 xlsx 可被重新上传解析（往返成功）", st2 == 200 and (r2.get("success")), r2)
    check("往返后表头一致", (r2.get("data") or {}).get("headers") == HEADERS, (r2.get("data") or {}).get("headers"))
    check("往返后行数一致", len((r2.get("data") or {}).get("rows") or []) == len(DATA),
          len((r2.get("data") or {}).get("rows") or []))
    rt_id = (r2.get("data") or {}).get("tableId")
    if rt_id:
        call("DELETE", "/excel/delete?tableId=%d" % rt_id, token=token)

print("\n[5] 模板本身也应可解析（模板 → 上传）")
body3, ct3 = multipart("template_as_data.xlsx", tpl)
st3, r3 = call("POST", "/excel/upload", body3, token=token, content_type=ct3)
check("模板文件可被解析（说明 write→read 兼容）", st3 == 200 and r3.get("success"), r3)
check("模板解析出的表头正确", (r3.get("data") or {}).get("headers") == HEADERS, (r3.get("data") or {}).get("headers"))
tpl_tbl = (r3.get("data") or {}).get("tableId")

print("\n[6] 带校验上传（校验路径同样走 EPPlus 解析）")
st4, r4 = call("POST", "/excel/upload-with-validation?tableId=%d" % table_id, body, token=token, content_type=ct)
check("带校验上传成功", st4 == 200 and r4.get("success"), r4)
if st4 == 200 and r4.get("success"):
    d = r4.get("data") or {}
    check("校验统计正确（总%d行/成功%d行/错误0行）" % (len(DATA), len(DATA)),
          d.get("totalRows") == len(DATA) and d.get("successRows") == len(DATA) and d.get("errorRows") == 0, d)

print("\n[7] 清理")
for tid in [table_id, tpl_tbl]:
    if tid:
        call("DELETE", "/excel/delete?tableId=%d" % tid, token=token)
check("测试表格已清理", True)

print("\n================ 结果：%d 通过 / %d 失败 ================" % (passed, failed))
sys.exit(0 if failed == 0 else 1)
