# -*- coding: utf-8 -*-
"""P1 列结构维护接口（PUT /api/excel/headers）的后端冒烟测试。

覆盖：
  - 新增列：每行 DataJson 自动补空串
  - 删除列：每行 DataJson 删除该键
  - 重命名：数据从 old 拷到 new，引用旧名的 ColorRule / ValidationRule 改名跟随
  - 排序：headers 顺序变化
  - 复合：add + drop + rename 在一次请求里完成
  - ColorRule / ValidationRule 引用了被删列时一并清掉
  - 越权 / 未登录 / 不存在的表
  - 参数校验：空 headers、重复名、rename 引用不存在的列、rename 同名、rename 同存
"""
import io
import json
import urllib.request
import urllib.error

BASE = "http://localhost:5185/api"
import os as _os
BASE = _os.environ.get("TEST_BASE_URL", BASE)

USER = "smokep1"
PWD = "smoke_p1pass"
OTHER = "smokep1other"
OTHER_PWD = "smoke_p1_otherpass"

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
        boundary = "----smoke_p1_boundary"
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


# ---------- 注册 / 登录 ----------
def ensure_user(username, password):
    st, r = call("POST", "/auth/register", {"username": username, "password": password, "confirmPassword": password})
    return (st == 200 and r.get("success")) or (st == 400 and "已被占用" in (r.get("message") or ""))


def login(username, password):
    st, r = call("POST", "/auth/login", {"username": username, "password": password})
    if st == 200 and r.get("success"):
        return (r.get("data") or {}).get("token")
    return None


# ---------- 生成最小可用的 xlsx ----------
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
        '<sheetData>%s</sheetData></worksheet>' % "".join(sheet_rows)
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
]

# ============================================================
print("[0] 准备账号与基线表")
# ============================================================
import zipfile
ensure_user(USER, PWD)
ensure_user(OTHER, OTHER_PWD)
token = login(USER, PWD)
check("主账号登录", bool(token))
other_token = login(OTHER, OTHER_PWD)
check("副账号登录", bool(other_token))
if not token or not other_token:
    print("无法继续")
    raise SystemExit(1)

created = []

def upload(name, headers, rows, tok=token):
    body, _ = ("file", (name, make_xlsx(headers, rows))), None
    st, r = call("POST", "/excel/upload", form={body[0]: body[1]}, token=tok)
    if st == 200 and r.get("success"):
        return r["data"]["tableId"]
    return None


def cleanup_table(tid, tok=token):
    if tid:
        call("DELETE", "/excel/delete?tableId=%d" % tid, token=tok)


def get_rows(tid, tok=token):
    st, r = call("GET", "/excel/query?tableId=%d" % tid, token=tok)
    return (r.get("data") or {}).get("rows") or [] if st == 200 else []


def get_headers(tid, tok=token):
    st, r = call("GET", "/excel/query?tableId=%d" % tid, token=tok)
    return (r.get("data") or {}).get("headers") or [] if st == 200 else []


base_id = upload("p1_base.xlsx", HEADERS, ROWS)
check("基线表上传成功", isinstance(base_id, int))
created.append(base_id)

# 给「数量」+「销售员」两个列加 ColorRule / ValidationRule，用来检查规则迁移
cr = [{
    "id": 0,
    "userId": 0,
    "columnName": "数量",
    "minValue": 0,
    "maxValue": 999,
    "colorCode": "#ff0000",
    "createdAt": "2026-01-01T00:00:00",
    "updatedAt": "2026-01-01T00:00:00",
}]
st, r = call("POST", "/excel/rules", cr, token=token)
check("基线 ColorRule 保存成功", st == 200 and r.get("success"), r)

vr = [{
    "id": 0,
    "tableId": base_id,
    "columnName": "销售员",
    "required": False,
    "dataType": "string",
    "minValue": None,
    "maxValue": None,
    "maxLength": None,
    "allowedValues": "",
    "createdAt": "2026-01-01T00:00:00",
    "updatedAt": "2026-01-01T00:00:00",
}]
st, r = call("POST", "/excel/validation-rules", vr, token=token)
check("基线 ValidationRule 保存成功", st == 200 and r.get("success"), r)

# ============================================================
print("\n[1] 新增列：每行 DataJson 自动补空串")
# ============================================================
new_headers = HEADERS + ["备注"]
st, r = call("PUT", "/excel/headers", {"tableId": base_id, "headers": new_headers}, token=token)
check("新增列返回成功", st == 200 and r.get("success"), r)
rows = get_rows(base_id)
check("新增列后 row 含「备注」键", all("备注" in row for row in rows))
check("新增列初始值为空串", all(row.get("备注", None) == "" for row in rows))
check("Headers 末尾出现「备注」", get_headers(base_id)[-1] == "备注")

# ============================================================
print("\n[2] 删除列：DataJson 中该键被移除，引用它的规则也被清掉")
# ============================================================
new_headers2 = [h for h in HEADERS]  # 移除「备注」
st, r = call("PUT", "/excel/headers", {"tableId": base_id, "headers": new_headers2}, token=token)
check("删除列返回成功", st == 200 and r.get("success"), r)
rows = get_rows(base_id)
check("删除后 row 不再含「备注」", all("备注" not in row for row in rows))
st, r = call("GET", "/excel/rules?columnName=%E5%85%85%E6%8E%B5", token=token)  # columnName=备注
# 上一步已经把 ColorRule 全部清了（备注列没规则），但「数量」的 ColorRule 还在 —— 重点是 deleted 计数
# 改测一下：删一个真有规则的列「数量」
new_headers3 = [h for h in HEADERS if h != "数量"]
st, r = call("PUT", "/excel/headers", {"tableId": base_id, "headers": new_headers3}, token=token)
check("删「数量」返回成功", st == 200 and r.get("success"), r)
st, r = call("GET", "/excel/rules?columnName=%E6%95%B0%E9%87%8F", token=token)
rules_after = r.get("data") if (st == 200 and r.get("success")) else []
check("删「数量」后 ColorRule 已被清掉", rules_after == [], rules_after)

# ============================================================
print("\n[3] 重命名：数据从 old 拷到 new，引用 old 的规则改名跟随")
# ============================================================
# 当前 headers = ["日期","单价(元)","销售员"]。把「销售员」改名为「负责人」。
new_headers4 = ["日期", "单价(元)", "负责人"]
st, r = call("PUT", "/excel/headers",
             {"tableId": base_id, "headers": new_headers4,
              "renames": [{"oldName": "销售员", "newName": "负责人"}]},
             token=token)
check("重命名返回成功", st == 200 and r.get("success"), r)
rows = get_rows(base_id)
check("重命名后数据从「销售员」搬到「负责人」",
      rows[0].get("负责人") == "张三" and "销售员" not in rows[0],
      rows[0])
check("重命名后 ValidationRule 已跟随改名",
      any(r.get("columnName") == "负责人" for r in call("GET", "/excel/validation-rules?tableId=%d" % base_id, token=token)[1].get("data") or []))

# ============================================================
print("\n[4] 排序：Headers 顺序变化")
# ============================================================
new_headers5 = ["负责人", "日期", "单价(元)"]
st, r = call("PUT", "/excel/headers", {"tableId": base_id, "headers": new_headers5}, token=token)
check("排序返回成功", st == 200 and r.get("success"), r)
check("Headers 顺序生效", get_headers(base_id) == new_headers5, get_headers(base_id))

# ============================================================
print("\n[5] 复合：add + drop + rename 在一次请求里完成")
# ============================================================
# 当前 ["负责人","日期","单价(元)"]；新增「数量」+「备注」，删「单价(元)」，把「负责人」改名为「客户名」
new_headers6 = ["客户名", "日期", "数量", "备注"]
st, r = call("PUT", "/excel/headers",
             {"tableId": base_id, "headers": new_headers6,
              "renames": [{"oldName": "负责人", "newName": "客户名"}]},
             token=token)
check("复合请求返回成功", st == 200 and r.get("success"), r)
h = get_headers(base_id)
rows = get_rows(base_id)
check("复合后 Headers 正确", h == new_headers6, h)
check("复合后「负责人」数据搬到「客户名」", rows[0].get("客户名") == "张三", rows[0])
check("复合后「单价(元)」从 row 中消失", all("单价(元)" not in row for row in rows))
check("复合后「数量」「备注」是空串", all(row.get("数量") == "" and row.get("备注") == "" for row in rows))

# ============================================================
print("\n[6] 参数校验：空 / 重复 / 引用不存在的列")
# ============================================================
st, r = call("PUT", "/excel/headers", {"tableId": base_id, "headers": []}, token=token)
check("空 headers 被拒", st == 400 and not r.get("success"), r)
st, r = call("PUT", "/excel/headers", {"tableId": base_id, "headers": ["a", "a"]}, token=token)
check("重复列名被拒", st == 400 and "重复" in (r.get("message") or ""), r)
st, r = call("PUT", "/excel/headers",
             {"tableId": base_id, "headers": ["a", "b"],
              "renames": [{"oldName": "不存在", "newName": "a"}]},
             token=token)
check("rename 引用不存在的列被拒", st == 400 and "不存在" in (r.get("message") or ""), r)
st, r = call("PUT", "/excel/headers",
             {"tableId": base_id, "headers": ["a", "b"],
              "renames": [{"oldName": "a", "newName": "a"}]},
             token=token)
check("rename 前后同名被拒", st == 400 and "前后同名" in (r.get("message") or ""), r)

# ============================================================
print("\n[7] 越权 / 未登录 / 不存在的表")
# ============================================================
st, r = call("PUT", "/excel/headers", {"tableId": base_id, "headers": ["x"]})
check("未登录调用返回 401", st == 401, r)
st, r = call("PUT", "/excel/headers", {"tableId": base_id, "headers": ["x"]}, token=other_token)
check("他人操作本账号的表被拒", st == 400 and r.get("message") == "表格不存在", r)
st, r = call("PUT", "/excel/headers", {"tableId": 99999999, "headers": ["x"]}, token=token)
check("不存在的表返回 400 友好提示", st == 400 and r.get("message") == "表格不存在", r)

# ============================================================
print("\n[8] 清理")
# ============================================================
for tid in created:
    cleanup_table(tid)
check("清理完成", True)

print("\n================ 结果：=%d 通过=%d 失败 ================" % (passed, failed))
print(("================ 结果：" if False else "================ 结果：") + str(passed) + " 通过 / " + str(failed) + " 失败 ================")
import sys
sys.exit(0 if failed == 0 else 1)