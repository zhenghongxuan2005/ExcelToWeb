import io, json, sys, zipfile, urllib.request, urllib.error

BASE = "http://localhost:5185/api"
# 可通过环境变量 TEST_BASE_URL 覆盖，便于 CI / 其他端口
import os as _os
BASE = _os.environ.get("TEST_BASE_URL", BASE)

# ---------- 1. 生成一个最小可用的 xlsx（inline string，无需 sharedStrings） ----------
HEADERS = ["日期", "数量", "单价(元)", "销售员"]
DATA = [
    ["2026-01-05", "10", "35.5", "张三"],
    ["2026-01-06", "3", "120", "李四"],
    ["2026-01-07", "8", "60", "王五"],
]


def col_letter(idx):
    s = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def row_xml(r, values):
    cells = "".join(
        '<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>' % (col_letter(i), r, v)
        for i, v in enumerate(values)
    )
    return '<row r="%d">%s</row>' % (r, cells)


sheet_rows = [row_xml(1, HEADERS)] + [row_xml(i + 2, v) for i, v in enumerate(DATA)]

sheet = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<dimension ref="A1:D%d"/><sheetData>%s</sheetData></worksheet>'
    % (len(DATA) + 1, "".join(sheet_rows))
)

content_types = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    "</Types>"
)

rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    "</Relationships>"
)

workbook = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
)

wb_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    "</Relationships>"
)

buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("_rels/.rels", rels)
    z.writestr("xl/workbook.xml", workbook)
    z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
    z.writestr("xl/worksheets/sheet1.xml", sheet)
XLSX = buf.getvalue()
print("[0] 生成测试 xlsx：%d 字节" % len(XLSX))


# ---------- 2. HTTP 辅助 ----------
def call(method, path, body=None, token=None, raw=False, content_type="application/json"):
    headers = {}
    data = None
    if body is not None:
        if isinstance(body, bytes):
            data = body
            headers["Content-Type"] = content_type
        else:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = r.read()
            return r.status, (payload if raw else json.loads(payload.decode()))
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload.decode())
        except Exception:
            return e.code, payload.decode(errors="replace")


def multipart(fields, filename, content):
    boundary = "----smokeboundary1234567890"
    body = b""
    for k, v in fields.items():
        body += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (boundary, k, v)).encode()
    body += (
        "--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\n"
        "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
        % (boundary, filename)
    ).encode()
    body += content + b"\r\n"
    body += ("--%s--\r\n" % boundary).encode()
    return body, "multipart/form-data; boundary=" + boundary


USER = "smoke2"
PWD = "smoke2pass"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("  PASS " if ok else "  FAIL ") + name + ("" if ok else "  -> " + str(detail)))


print("\n[1] 注册 / 登录")
st, r = call("POST", "/auth/register", {"username": USER, "password": PWD, "confirmPassword": PWD})
if st != 200 or not r.get("success"):
    print("    注册返回：", st, r, "（可能已存在，继续尝试登录）")
st, r = call("POST", "/auth/login", {"username": USER, "password": PWD})
check("登录成功", st == 200 and r.get("success"), r)
token = r["data"]["token"] if st == 200 and r.get("success") else None
if not token:
    sys.exit("无法登录，终止")

print("\n[2] 上传 Excel")
body, ct = multipart({}, "step1test.xlsx", XLSX)
st, r = call("POST", "/excel/upload", body, token=token, content_type=ct)
check("上传成功", st == 200 and r.get("success"), r)
table_id = r["data"]["tableId"] if st == 200 and r.get("success") else None
check("表头解析正确", table_id and r["data"]["headers"] == HEADERS, r.get("data", {}).get("headers"))
check("行数为 3", table_id and len(r["data"]["rows"]) == 3, r.get("data", {}).get("rows"))

print("\n[3] 查询")
st, r = call("GET", "/excel/query?tableId=%d" % table_id, token=token)
check("查询成功", st == 200 and r.get("success"), r)
check("日期序列号已转 yyyy-MM-dd", r["data"]["rows"][0].get("日期") == "2026-01-05", r["data"]["rows"][0])

print("\n[4] 保存（本次改动的重点：整表替换已加事务）")
new_rows = list(r["data"]["rows"])
new_rows[0]["数量"] = "999"
new_rows.append({"日期": "2026-01-08", "数量": "1", "单价(元)": "5", "销售员": "赵六"})
st, r = call("POST", "/excel/save", {"tableId": table_id, "rows": new_rows}, token=token)
check("保存成功", st == 200 and r.get("success"), r)
st, r = call("GET", "/excel/query?tableId=%d" % table_id, token=token)
rows_after = r["data"]["rows"] if st == 200 else []
check("保存生效（4 行）", len(rows_after) == 4, len(rows_after))
check("修改值已落库", rows_after and rows_after[0].get("数量") == "999", rows_after[:1])

print("\n[5] 失败路径：非法请求不得泄露异常/堆栈细节，且不得丢数据")
st, r = call("POST", "/excel/save", {"tableId": table_id, "rows": None}, token=token)
blob_text = json.dumps(r, ensure_ascii=False)
check("返回 400", st == 400, (st, r))
leaked = any(k in blob_text for k in ("Exception", "System.", "Microsoft.", "   at "))
check("响应不含异常类型/堆栈", not leaked, blob_text[:200])
st2, r2 = call("GET", "/excel/query?tableId=%d" % table_id, token=token)
check("失败后原有 4 行完好（未丢数据）", st2 == 200 and len(r2["data"]["rows"]) == 4,
      len(r2["data"]["rows"]) if st2 == 200 else r2)

st, r = call("POST", "/excel/save", {"tableId": 99999999, "rows": [{"a": "1"}]}, token=token)
check("保存不存在的表返回「表格不存在」", st == 400 and r.get("message") == "表格不存在", (st, r))

print("\n[6] 颜色规则（前端条件格式弹窗依赖的接口）")
rules = [
    {"columnName": "数量", "minValue": 0, "maxValue": 5, "colorCode": "#dc2626"},
    {"columnName": "数量", "minValue": 6, "maxValue": None, "colorCode": "#0f973d"},
]
st, r = call("POST", "/excel/rules", rules, token=token)
check("保存颜色规则成功", st == 200 and r.get("success"), r)
st, r = call("GET", "/excel/rules", token=token)
check("读回 2 条规则", st == 200 and r.get("success") and len(r["data"]) == 2, r)
st, r = call("GET", "/excel/rules?columnName=%E6%95%B0%E9%87%8F", token=token)
check("按列过滤返回 2 条", st == 200 and len(r.get("data", [])) == 2, r)

print("\n[7] 带校验上传：损坏文件应返回 400 而不是 500（本次补的异常保护）")
body, ct = multipart({}, "broken.xlsx", b"this is not a real xlsx file at all")
st, r = call("POST", "/excel/upload-with-validation?tableId=%d" % table_id, body, token=token, content_type=ct)
check("损坏文件返回 400 且提示友好", st == 400 and "文件解析失败" in r.get("message", ""), (st, r))

print("\n[8] 导出")
st, blob = call("GET", "/excel/export?tableId=%d" % table_id, token=token, raw=True)
check("导出 xlsx 是有效 zip", st == 200 and blob[:2] == b"PK", (st, blob[:4]))
st, blob = call("GET", "/excel/export-csv?tableId=%d" % table_id, token=token, raw=True)
check("导出 csv 含表头", st == 200 and "日期" in blob.decode("utf-8", "ignore"), st)

print("\n[9] 清理测试表格")
st, r = call("DELETE", "/excel/delete?tableId=%d" % table_id, token=token)
check("删除测试表格", st == 200 and r.get("success"), r)

failed = [x for x in results if not x[1]]
print("\n================ 结果：%d 通过 / %d 失败 ================" % (len(results) - len(failed), len(failed)))
for name, ok, detail in failed:
    print("  FAILED: %s -> %s" % (name, detail))
sys.exit(1 if failed else 0)
