# -*- coding: utf-8 -*-
"""P2 列元数据持久化（GET/PUT /api/excel/column-meta）与带格式导出的后端测试。

覆盖：
  - 保存 / 读回列宽与隐藏列
  - columnMeta 随 GET /excel/query 一起下发
  - 未知列名被丢弃、列宽夹到合法范围、全默认值不落库
  - 列改名后 meta 跟随、列删除后 meta 清理、新增列不受影响
  - 保存 meta 不改 UpdatedAt（视图偏好不该让表格跳到列表最前）
  - 越权 / 未登录 / 不存在的表
  - 导出 xlsx：数字列写真数值、长数字与前导零保持文本、日期列带日期格式、
    表头加粗、列宽与隐藏列落进 <cols>、条件格式颜色进入样式表
"""
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile

BASE = os.environ.get("TEST_BASE_URL", "http://localhost:5185/api")

USER = "smokep2"
PWD = "smoke_p2pass"
OTHER = "smokep2other"
OTHER_PWD = "smoke_p2_otherpass"

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
        boundary = "----smoke_p2_boundary"
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


# ---------- 账号 ----------
def ensure_user(username, password):
    st, r = call("POST", "/auth/register",
                 {"username": username, "password": password, "confirmPassword": password})
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


# 数量 / 单价 -> 数值列；编号 -> 含 007 与 18 位数字，必须保持文本；日期 -> 日期列
HEADERS = ["名称", "数量", "单价", "编号", "日期"]
ROWS = [
    ["甲", "10", "35.5", "123456789012345678", "2026-01-05"],
    ["乙", "3", "120", "007", "2026-01-06"],
]

# ============================================================
print("[0] 准备账号与基线表")
# ============================================================
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
    st, r = call("POST", "/excel/upload", form={"file": (name, make_xlsx(headers, rows))}, token=tok)
    if st == 200 and r.get("success"):
        return r["data"]["tableId"]
    return None


def cleanup_table(tid, tok=token):
    if tid:
        call("DELETE", "/excel/delete?tableId=%d" % tid, token=tok)


def get_data(tid, tok=token):
    st, r = call("GET", "/excel/query?tableId=%d" % tid, token=tok)
    return (r.get("data") or {}) if st == 200 else {}


def get_headers(tid, tok=token):
    return get_data(tid, tok).get("headers") or []


def get_meta(tid, tok=token):
    st, r = call("GET", "/excel/column-meta?tableId=%d" % tid, token=tok)
    return (r.get("data") or {}) if (st == 200 and r.get("success")) else {}


base_id = upload("p2_base.xlsx", HEADERS, ROWS)
check("基线表上传成功", isinstance(base_id, int))
created.append(base_id)

# ============================================================
print("\n[1] 保存 / 读回列宽与隐藏列")
# ============================================================
st, r = call("PUT", "/excel/column-meta",
             {"tableId": base_id, "meta": {"名称": {"width": 200}, "数量": {"hidden": True}}},
             token=token)
check("保存列元数据成功", st == 200 and r.get("success"), r)

meta = get_meta(base_id)
check("读回「名称」列宽", meta.get("名称", {}).get("width") == 200, meta)
check("读回「数量」隐藏标记", meta.get("数量", {}).get("hidden") is True, meta)

data = get_data(base_id)
check("columnMeta 随 query 一起下发", bool(data.get("columnMeta")), list(data.keys()))

# ============================================================
print("\n[2] 未知列名丢弃 / 列宽夹取 / 默认值不落库")
# ============================================================
st, r = call("PUT", "/excel/column-meta",
             {"tableId": base_id,
              "meta": {"名称": {"width": 9999},
                       "数量": {"width": 1},
                       "根本不存在的列": {"width": 120, "hidden": True},
                       "单价": {"width": None, "hidden": False}}},
             token=token)
check("第二次保存成功", st == 200 and r.get("success"), r)

meta = get_meta(base_id)
check("不存在的列名被丢弃", "根本不存在的列" not in meta, meta)
check("超大列宽被夹到 600", meta.get("名称", {}).get("width") == 600, meta)
check("过小列宽被夹到 40", meta.get("数量", {}).get("width") == 40, meta)
check("全默认的列不落库", "单价" not in meta, meta)

st, r = call("PUT", "/excel/column-meta", {"tableId": base_id, "meta": {}}, token=token)
check("传空 meta 成功", st == 200 and r.get("success"), r)
check("空 meta 后读回为空", get_meta(base_id) == {}, get_meta(base_id))

# ============================================================
print("\n[3] 列结构变更时 meta 跟随（改名 / 删除 / 新增）")
# ============================================================
call("PUT", "/excel/column-meta",
     {"tableId": base_id,
      "meta": {"名称": {"width": 180}, "数量": {"hidden": True}, "单价": {"width": 90}}},
     token=token)
check("基线 meta 就绪", len(get_meta(base_id)) == 3, get_meta(base_id))

# 把「名称」改名为「客户」，删掉「单价」，新增「备注」
st, r = call("PUT", "/excel/headers",
             {"tableId": base_id,
              "headers": ["客户", "数量", "编号", "日期", "备注"],
              "renames": [{"oldName": "名称", "newName": "客户"}]},
             token=token)
check("列结构变更成功", st == 200 and r.get("success"), r)

meta = get_meta(base_id)
check("改名后列宽跟着新列名（没丢）", meta.get("客户", {}).get("width") == 180, meta)
check("改名后旧列名不再残留", "名称" not in meta, meta)
check("被删列的 meta 已清理", "单价" not in meta, meta)
check("未涉及的列 meta 不受影响", meta.get("数量", {}).get("hidden") is True, meta)
check("新增列不产生 meta 条目", "备注" not in meta, meta)

# ============================================================
print("\n[4] 保存 meta 不改动表格的 UpdatedAt")
# ============================================================
def updated_at(tid):
    st, r = call("GET", "/excel/tables", token=token)
    for t in (r.get("data") or []):
        if t.get("id") == tid:
            return t.get("updatedAt")
    return None


before = updated_at(base_id)
call("PUT", "/excel/column-meta", {"tableId": base_id, "meta": {"客户": {"width": 260}}}, token=token)
after = updated_at(base_id)
check("调列宽不会让表格跳到列表最前", before == after, "%s -> %s" % (before, after))

# ============================================================
print("\n[5] 越权 / 未登录 / 不存在的表")
# ============================================================
st, r = call("PUT", "/excel/column-meta", {"tableId": base_id, "meta": {}})
check("未登录返回 401", st == 401, r)
st, r = call("PUT", "/excel/column-meta", {"tableId": base_id, "meta": {}}, token=other_token)
check("他人操作本账号的表被拒", st == 400 and r.get("message") == "表格不存在", r)
st, r = call("GET", "/excel/column-meta?tableId=%d" % base_id, token=other_token)
check("他人读取返回空 meta", r.get("data") == {}, r)
st, r = call("PUT", "/excel/column-meta", {"tableId": 99999999, "meta": {}}, token=token)
check("不存在的表返回友好提示", st == 400 and r.get("message") == "表格不存在", r)

# ============================================================
print("\n[6] 导出 xlsx 带格式")
# ============================================================
exp_id = upload("p2_export.xlsx", HEADERS, ROWS)
check("导出用表上传成功", isinstance(exp_id, int))
created.append(exp_id)

# 设列宽与隐藏，让导出的 <cols> 有据可查
call("PUT", "/excel/column-meta",
     {"tableId": exp_id, "meta": {"名称": {"width": 200}, "数量": {"hidden": True}}},
     token=token)

# 条件格式：数量 0~5 -> 红色（第 2 行「乙」的数量 3 应命中）
cr = [{
    "id": 0, "userId": 0, "columnName": "数量",
    "minValue": 0, "maxValue": 5, "colorCode": "#ff0000",
    "createdAt": "2026-01-01T00:00:00", "updatedAt": "2026-01-01T00:00:00",
}]
call("POST", "/excel/rules", cr, token=token)

st, payload = call("GET", "/excel/export?tableId=%d" % exp_id, token=token, raw=True)
check("导出接口返回文件流", st == 200 and isinstance(payload, bytes) and len(payload) > 0, st)

with zipfile.ZipFile(io.BytesIO(payload)) as z:
    names = z.namelist()
    sheet = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    styles = z.read("xl/styles.xml").decode("utf-8")
    shared = z.read("xl/sharedStrings.xml").decode("utf-8") if "xl/sharedStrings.xml" in names else ""


def cell(ref):
    m = re.search(r'<c r="%s"([^>]*?)(?:/>|>(.*?)</c>)' % ref, sheet, re.S)
    if not m:
        return None, ""
    return m.group(1) or "", m.group(2) or ""


attrs, inner = cell("B2")
check("数量列写成真数值（A2 数据行第 2 列）",
      attrs is not None and 't="' not in attrs and "<v>" in inner, attrs + " | " + inner)

attrs, inner = cell("C2")
check("单价列写成真数值", attrs is not None and 't="' not in attrs and "<v>" in inner, attrs + " | " + inner)

attrs, inner = cell("D2")
check("18 位编号保持文本（未变成科学计数法）",
      attrs is not None and ('t="s"' in attrs or 't="inlineStr"' in attrs), attrs)
check("18 位编号内容完整保留",
      "123456789012345678" in shared or "123456789012345678" in sheet)

attrs_d3, _ = cell("D3")
check("带前导零的编号保持文本", attrs_d3 is not None and
      ('t="s"' in attrs_d3 or 't="inlineStr"' in attrs_d3), attrs_d3)
check("前导零内容未被吃掉", "007" in shared or ">007<" in sheet)

attrs, inner = cell("E2")
check("日期列写成日期值（带样式索引）", attrs is not None and 's="' in attrs and "<v>" in inner,
      attrs + " | " + inner)
check("日期格式进入样式表", "yyyy-mm-dd" in styles)

cols_match = re.search(r"<cols>(.*?)</cols>", sheet, re.S)
cols = cols_match.group(1) if cols_match else ""
check("导出带有列宽定义", "customWidth" in cols or "width=" in cols, cols[:200])

width_match = re.search(r'<col min="1"[^>]*width="([\d.]+)"', cols)
width_val = float(width_match.group(1)) if width_match else 0
check("列宽按 px->字符换算写入（200px 约 28.5）", 27 <= width_val <= 30, width_val)

hidden_match = re.search(r'<col min="2"[^>]*hidden="(1|true)"', cols)
check("隐藏列在导出里也是隐藏的", bool(hidden_match), cols[:200])

fonts_xml = re.search(r"<fonts.*?</fonts>", styles, re.S)
check("表头加粗（样式表含粗体字体）", "<b" in styles,
      (fonts_xml.group(0)[:400] if fonts_xml else styles[:400]))
check("条件格式颜色进入导出样式", "FF0000" in styles.upper())

# 命中与未命中：B3（乙 的数量 3）应带填充色，B2（甲 的数量 10）不应带
attrs_hit, _ = cell("B3")
attrs_miss, _ = cell("B2")
check("命中的单元格带了填充色样式",
      attrs_hit is not None and 's="' in attrs_hit and (attrs_miss is None or attrs_miss != attrs_hit),
      "%s vs %s" % (attrs_hit, attrs_miss))

# ============================================================
print("\n[7] 清理")
# ============================================================
for tid in created:
    cleanup_table(tid)
check("清理完成", True)

print("\n================ 结果：%d 通过 / %d 失败 ================" % (passed, failed))
sys.exit(0 if failed == 0 else 1)
