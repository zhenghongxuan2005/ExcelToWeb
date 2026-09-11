# -*- coding: utf-8 -*-
"""步骤 3 冒烟测试：重命名 / 复制 / 修改密码，以及 BulkInsertRowsAsync 的分批修复。"""
import io
import json
import zipfile
import urllib.request
import urllib.error

BASE = "http://localhost:5185/api"
# 可通过环境变量 TEST_BASE_URL 覆盖，便于 CI / 其他端口
import os as _os
BASE = _os.environ.get("TEST_BASE_URL", BASE)
USER = "smoke2"
PWD = "smoke2pass"

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
        boundary = "----smoke3boundary"
        buf = io.BytesIO()
        for k, v in form.items():
            if isinstance(v, tuple):
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
            return (e.code, {"_raw": payload[:200].decode("utf-8", "replace")})


# ---------- 生成 xlsx ----------
def col_letter(idx):
    s = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def make_xlsx(headers, rows):
    def row_xml(r, values):
        cells = "".join(
            '<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>' % (col_letter(i), r, v)
            for i, v in enumerate(values)
        )
        return '<row r="%d">%s</row>' % (r, cells)

    sheet_rows = [row_xml(1, headers)] + [row_xml(i + 2, v) for i, v in enumerate(rows)]
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<dimension ref="A1:D%d"/><sheetData>%s</sheetData></worksheet>'
        % (len(rows) + 1, "".join(sheet_rows))
    )
    ct = (
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
    wb = (
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
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


HEADERS = ["日期", "数量", "单价(元)", "销售员"]
ROWS = [
    ["2026-01-05", "10", "35.5", "张三"],
    ["2026-01-06", "3", "120", "李四"],
    ["2026-01-07", "8", "60", "王五"],
]

print("[1] 登录取 token")
st, r = call("POST", "/auth/login", {"username": USER, "password": PWD})
check("登录成功", st == 200 and r.get("success"), r)
token = (r.get("data") or {}).get("token")
if not token:
    print("无法取得 token，终止")
    raise SystemExit(1)

created = []

print("\n[2] 上传基准表格")
st, r = call("POST", "/excel/upload", form={"file": ("smoke3.xlsx", make_xlsx(HEADERS, ROWS))}, token=token)
check("上传成功", st == 200 and r.get("success"), r)
base_id = (r.get("data") or {}).get("tableId")
created.append(base_id)
check("拿到 tableId", isinstance(base_id, int), base_id)

print("\n[3] 重命名")
st, r = call("PUT", "/excel/rename", {"tableId": base_id, "tableName": "步骤3-重命名后"}, token=token)
check("重命名返回成功", st == 200 and r.get("success"), r)
st, r = call("GET", "/excel/query?tableId=%d" % base_id, token=token)
check("表名已更新", (r.get("data") or {}).get("tableName") == "步骤3-重命名后", (r.get("data") or {}).get("tableName"))

st, r = call("PUT", "/excel/rename", {"tableId": base_id, "tableName": "   "}, token=token)
check("空名称被拒绝（400）", st == 400 and not r.get("success"), r)
st, r = call("PUT", "/excel/rename", {"tableId": base_id, "tableName": "x" * 101}, token=token)
check("超长名称被拒绝（400）", st == 400, r)
st, r = call("PUT", "/excel/rename", {"tableId": 99999999, "tableName": "nope"}, token=token)
check("不存在的表返回 400 且提示友好", st == 400 and r.get("message") == "表格不存在", r)

print("\n[4] 复制")
st, r = call("POST", "/excel/duplicate", {"tableId": base_id}, token=token)
check("复制返回成功", st == 200 and r.get("success"), r)
copy1 = r.get("data") or {}
created.append(copy1.get("tableId"))
check("副本名带「- 副本」", isinstance(copy1.get("tableName"), str) and "副本" in copy1.get("tableName"), copy1.get("tableName"))
check("副本表头一致", copy1.get("headers") == HEADERS, copy1.get("headers"))
check("副本行数一致", len(copy1.get("rows") or []) == len(ROWS), len(copy1.get("rows") or []))

st, r2 = call("POST", "/excel/duplicate", {"tableId": base_id}, token=token)
copy2 = r2.get("data") or {}
created.append(copy2.get("tableId"))
check("再复制一次不会重名（带序号）", copy2.get("tableName") != copy1.get("tableName"), copy2.get("tableName"))

st, r = call("GET", "/excel/query?tableId=%d" % copy1.get("tableId"), token=token)
data = r.get("data") or {}
check("副本数据已真实落库", len(data.get("rows") or []) == len(ROWS), len(data.get("rows") or []))
check("副本内容与源一致", (data.get("rows") or [{}])[0].get("销售员") == "张三", (data.get("rows") or [{}])[0])

st, r = call("GET", "/excel/query?tableId=%d" % base_id, token=token)
check("源表未被复制操作破坏", len((r.get("data") or {}).get("rows") or []) == len(ROWS))

print("\n[5] 大表导入（验证 >700 行的分批插入修复）")
BIG = [[str(i), str(i * 2), "1.5", "批量"] for i in range(1, 1801)]
st, r = call("POST", "/excel/upload", form={"file": ("big3.xlsx", make_xlsx(HEADERS, BIG))}, token=token)
check("1800 行导入成功（修复前会因参数超限失败）", st == 200 and r.get("success"), r.get("message"))
big_id = (r.get("data") or {}).get("tableId")
created.append(big_id)
if big_id:
    st, r = call("GET", "/excel/query?tableId=%d" % big_id, token=token)
    check("1800 行全部落库", len((r.get("data") or {}).get("rows") or []) == 1800,
          len((r.get("data") or {}).get("rows") or []))
    st, r = call("POST", "/excel/duplicate", {"tableId": big_id}, token=token)
    check("大表也能复制", st == 200 and r.get("success"), r.get("message"))
    if r.get("data"):
        created.append(r["data"].get("tableId"))

print("\n[6] 修改密码")
st, r = call("POST", "/auth/change-password",
             {"oldPassword": "wrongpwd", "newPassword": "newpass123", "confirmPassword": "newpass123"}, token=token)
check("原密码错误被拒绝", st == 400 and r.get("message") == "原密码不正确", r)

st, r = call("POST", "/auth/change-password",
             {"oldPassword": PWD, "newPassword": "12345", "confirmPassword": "12345"}, token=token)
check("新密码过短被拒绝", st == 400, r)

st, r = call("POST", "/auth/change-password",
             {"oldPassword": PWD, "newPassword": "newpass123", "confirmPassword": "different"}, token=token)
check("两次不一致被拒绝", st == 400, r)

st, r = call("POST", "/auth/change-password",
             {"oldPassword": PWD, "newPassword": PWD, "confirmPassword": PWD}, token=token)
check("新旧密码相同被拒绝", st == 400, r)

st, r = call("POST", "/auth/change-password",
             {"oldPassword": PWD, "newPassword": "newpass123", "confirmPassword": "newpass123"}, token=token)
check("修改成功", st == 200 and r.get("success"), r)

st, r = call("POST", "/auth/login", {"username": USER, "password": "newpass123"})
check("可用新密码登录", st == 200 and r.get("success"), r)
st, r = call("POST", "/auth/login", {"username": USER, "password": PWD})
check("原密码已失效", st == 400, r)

# 改回原密码，保证脚本可重复运行
st, r = call("POST", "/auth/change-password",
             {"oldPassword": "newpass123", "newPassword": PWD, "confirmPassword": PWD}, token=token)
check("已改回原密码（脚本可重复执行）", st == 200, r)
st, r = call("POST", "/auth/login", {"username": USER, "password": PWD})
check("原密码恢复可用", st == 200, r)
token = (r.get("data") or {}).get("token")

print("\n[7] 未登录访问新接口应 401")
st, r = call("PUT", "/excel/rename", {"tableId": base_id, "tableName": "x"})
check("rename 未登录 401", st == 401, st)
st, r = call("POST", "/excel/duplicate", {"tableId": base_id})
check("duplicate 未登录 401", st == 401, st)
st, r = call("POST", "/auth/change-password", {"oldPassword": "a", "newPassword": "bbbbbb", "confirmPassword": "bbbbbb"})
check("change-password 未登录 401", st == 401, st)

print("\n[8] 越权：另一个账号不能操作本账号的表")
st, r = call("POST", "/auth/register", {"username": "smoke3other", "password": "otherpass", "confirmPassword": "otherpass"})
st2, r2 = call("POST", "/auth/login", {"username": "smoke3other", "password": "otherpass"})
other_token = (r2.get("data") or {}).get("token")
if other_token:
    st, r = call("PUT", "/excel/rename", {"tableId": base_id, "tableName": "hacked"}, token=other_token)
    check("他人无法重命名", st == 400 and r.get("message") == "表格不存在", r)
    st, r = call("POST", "/excel/duplicate", {"tableId": base_id}, token=other_token)
    check("他人无法复制", st == 400 and r.get("message") == "表格不存在", r)
    st, r = call("GET", "/excel/query?tableId=%d" % base_id, token=token)
    check("越权尝试未改动表名", (r.get("data") or {}).get("tableName") == "步骤3-重命名后",
          (r.get("data") or {}).get("tableName"))

print("\n[9] 清理")
for tid in created:
    if tid:
        call("DELETE", "/excel/delete?tableId=%d" % tid, token=token)
st, r = call("GET", "/excel/tables", token=token)
remaining = [t["id"] for t in (r.get("data") or []) if t["id"] in created]
check("测试表格已清理", remaining == [], remaining)

print("\n================ 结果：%d 通过 / %d 失败 ================" % (passed, failed))
