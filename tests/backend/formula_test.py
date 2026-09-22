# -*- coding: utf-8 -*-
"""计算列：值不落库、读取时按公式实时算。

为什么专门测「不落库」这件事：计算列的值一旦顺着「保存」混进 DataJson，就会变成
一份永远不更新的陈旧数据 —— 页面上看还是好的，但源列改了它不会变，且导出也跟着错。
本文件里 [8] 那一段就是钉死这条的。

覆盖：
  - 未登录 / 越权 / 列不存在 / 公式语法错 的参数校验
  - 四则运算、CONCAT / ROUND / INT / IF / YEAR / MONTH
  - 错误值：#DIV/0! / #VALUE!，以及 IF 的短路（除零不参与求值）
  - 引用不存在的列 / 引用别的计算列 / 引用自己 一律拒绝
  - 改源列 → 保存 → 重新查询，计算列的值跟着变
  - 列改名后公式跟随；被引用列被删后公式作废
  - 导出 xlsx 时计算列有值
  - 取消计算列后退回普通可编辑列
"""
import io
import json
import os as _os
import urllib.error
import urllib.request
import zipfile

BASE = _os.environ.get("TEST_BASE_URL", "http://localhost:5185/api")

USER = "smokeformula"
PWD = "smoke_formula_pass"

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
        boundary = "----smoke_formula_boundary"
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


TOKEN = None
created = []


def upload(headers, rows, name="formula.xlsx"):
    st, r = call("POST", "/excel/upload", form={"file": (name, make_xlsx(headers, rows))}, token=TOKEN)
    if st == 200 and r.get("success"):
        created.append(r["data"]["tableId"])
    return st, r


def set_formula(table_id, column, formula, token=None):
    # 注意用 is None 判断：token="" 是「故意不带 token」用来测 401 的，
    # 写成 `token or TOKEN` 会被当成没传而偷偷带上真 token，401 那条就永远测不到
    return call("PUT", "/excel/formula",
                {"tableId": table_id, "columnName": column, "formula": formula},
                token=TOKEN if token is None else token)


def add_columns(table_id, headers):
    """补出目标列。公式只能设在已存在的列上（这也是前端「先保存列结构、再提交公式」的原因）。"""
    return call("PUT", "/excel/headers",
                {"tableId": table_id, "headers": headers, "renames": []}, token=TOKEN)


def query(table_id):
    st, r = call("GET", "/excel/query?tableId=%d" % table_id, token=TOKEN)
    return r.get("data") or {}


def values(table_id, column):
    return [row.get(column, "") for row in query(table_id).get("rows", [])]


def export_text(table_id):
    st, exp = call("GET", "/excel/export?tableId=%d" % table_id, token=TOKEN, raw=True)
    if st != 200 or not (isinstance(exp, bytes) and exp[:2] == b"PK"):
        return None
    zf = zipfile.ZipFile(io.BytesIO(exp))
    return "".join(zf.read(n).decode("utf-8", "ignore") for n in zf.namelist())


print("=" * 60)
print("计算列：读取时按公式实时算")
print("=" * 60)

if not ensure_user(USER, PWD):
    print("  FAIL 测试账号准备失败")
    raise SystemExit(1)
TOKEN = login(USER, PWD)
if not TOKEN:
    print("  FAIL 登录失败")
    raise SystemExit(1)

# ---------- 1) 未登录 / 参数校验 ----------
print("\n--- 1) 未登录 / 越权 / 参数校验 ---")
st, _ = set_formula(1, "x", "[a]+[b]", token="")
check("未登录被拒（401）", st == 401, st)

st, r = upload(["单价", "数量"], [["10", "3"], ["4", "5"]])
check("上传成功", st == 200 and r.get("success"), r)
base = r["data"]["tableId"] if st == 200 else None
if base:
    st, r = add_columns(base, ["单价", "数量", "合计"])
    check("先补出「合计」列（公式只能设在已存在的列上）", st == 200 and r.get("success"), r)

if base:
    st, r = set_formula(base, "不存在的列", "[单价]*2")
    check("列不存在被拒（400）", st == 400, (st, r))

    st, r = set_formula(base, "合计", "[单价]*")
    check("公式语法错被拒（400）", st == 400, (st, r))
    check("语法错的提示能看懂", "公式有误" in (r.get("message") or ""), r.get("message"))

    st, r = set_formula(base, "合计", "[单价]*(1+" * 300 + "1)")
    check("超长公式被拒（400）", st == 400, (st, r))

# ---------- 2) 正常路径：四则运算 ----------
print("\n--- 2) 四则运算 ---")
if base:
    st, r = set_formula(base, "合计", "[单价] * [数量]")
    check("设置公式成功", st == 200 and r.get("success"), r)
    check("计算列的值算对了", values(base, "合计") == ["30", "20"], values(base, "合计"))

    st, r = set_formula(base, "合计", "[单价] / 4")
    check("除法保留合理精度", values(base, "合计") == ["2.5", "1"], values(base, "合计"))

    st, r = set_formula(base, "合计", "ROUND([单价] / 3, 2)")
    check("ROUND 生效", values(base, "合计") == ["3.33", "1.33"], values(base, "合计"))

    set_formula(base, "合计", "INT([单价] / 3)")
    check("INT 是向下取整", values(base, "合计") == ["3", "1"], values(base, "合计"))

# ---------- 3) 函数 ----------
print("\n--- 3) 函数白名单 ---")
if base:
    set_formula(base, "合计", 'CONCAT([单价], "-", [数量])')
    check("CONCAT 拼接", values(base, "合计") == ["10-3", "4-5"], values(base, "合计"))

    set_formula(base, "合计", 'IF([数量] > 3, "多", "少")')
    check("IF 条件返回文本", values(base, "合计") == ["少", "多"], values(base, "合计"))

    set_formula(base, "合计", "IF([数量] > 3, 1, 0)")
    check("IF 条件返回数字", values(base, "合计") == ["0", "1"], values(base, "合计"))

    set_formula(base, "合计", "[单价] < 5")
    check("比较返回 1/0", values(base, "合计") == ["0", "1"], values(base, "合计"))

# ---------- 4) 错误值 ----------
print("\n--- 4) 算不出来时如实报错 ---")
if base:
    set_formula(base, "合计", "[单价] / 0")
    check("除零报 #DIV/0!", values(base, "合计") == ["#DIV/0!", "#DIV/0!"], values(base, "合计"))

    # 让「数量」列出现非数字文本，再让公式去乘它
    st, r = call("POST", "/excel/save", {
        "tableId": base,
        "rows": [{"单价": "10", "数量": "abc"}, {"单价": "4", "数量": "5"}]
    }, token=TOKEN)
    check("保存成功（文本进了数量列）", st == 200 and r.get("success"), r)

    set_formula(base, "合计", "[单价] * [数量]")
    check("文本参与乘法报 #VALUE!", values(base, "合计") == ["#VALUE!", "20"], values(base, "合计"))

# ---------- 5) IF 短路 ----------
print("\n--- 5) IF 未命中的分支不参与求值 ---")
if base:
    st, r = call("POST", "/excel/save", {
        "tableId": base,
        "rows": [{"单价": "10", "数量": "0"}, {"单价": "4", "数量": "5"}]
    }, token=TOKEN)
    check("保存成功", st == 200 and r.get("success"), r)

    set_formula(base, "合计", "IF([数量] = 0, 0, [单价] / [数量])")
    got = values(base, "合计")
    check("条件命中时不报除零，而是走另一支", got == ["0", "0.8"], got)

# ---------- 6) 引用校验 ----------
print("\n--- 6) 引用校验 ---")
if base:
    st, r = set_formula(base, "合计", "[查无此列] + 1")
    check("引用不存在的列被拒", st == 400 and "不存在的列" in (r.get("message") or ""), (st, r.get("message")))

    st, r = set_formula(base, "单价", "[合计] + 1")
    check("引用别的计算列被拒", st == 400 and "计算列之间" in (r.get("message") or ""), (st, r.get("message")))

    st, r = set_formula(base, "合计", "[合计] + 1")
    check("引用自己被拒", st == 400 and "自己" in (r.get("message") or ""), (st, r.get("message")))

    st, r = set_formula(base, "合计", "SUM([单价])")
    check("白名单外的函数被拒", st == 400 and "不支持的函数" in (r.get("message") or ""), (st, r.get("message")))

# ---------- 7) 值不落库：改源列就跟着变 ----------
print("\n--- 7) 值不落库，改源列后重算 ---")
if base:
    st, r = call("POST", "/excel/save", {
        "tableId": base,
        "rows": [{"单价": "10", "数量": "3"}, {"单价": "4", "数量": "5"}]
    }, token=TOKEN)
    set_formula(base, "合计", "[单价] * [数量]")
    check("基础值", values(base, "合计") == ["30", "20"], values(base, "合计"))

    # 客户端把算出来的值一起回传（真实前端就是这样），服务端必须落库前抹掉
    st, r = call("POST", "/excel/save", {
        "tableId": base,
        "rows": [{"单价": "100", "数量": "3", "合计": "300"},
                 {"单价": "4", "数量": "5", "合计": "20"}]
    }, token=TOKEN)
    check("保存成功", st == 200 and r.get("success"), r)
    check("改了源列之后重新算（不是回传的旧值）", values(base, "合计") == ["300", "20"], values(base, "合计"))

    # 直接把计算列本身回传成别的值：必须被无视，仍按公式算
    st, r = call("POST", "/excel/save", {
        "tableId": base,
        "rows": [{"单价": "100", "数量": "3", "合计": "99999"},
                 {"单价": "4", "数量": "5", "合计": "99999"}]
    }, token=TOKEN)
    check("计算列被强行回传时以公式为准", values(base, "合计") == ["300", "20"], values(base, "合计"))

# ---------- 8) 列改名 / 删除 ----------
print("\n--- 8) 列改名与删除 ---")
if base:
    st, r = call("PUT", "/excel/headers", {
        "tableId": base,
        "headers": ["售价", "数量", "合计", "税率"],
        "renames": [{"oldName": "单价", "newName": "售价"}]
    }, token=TOKEN)
    check("改名并新增列成功", st == 200 and r.get("success"), r)
    check("改名后公式跟随（仍在算）", values(base, "合计") == ["300", "20"], values(base, "合计"))

    # 新列也设公式：只引用普通列
    st, r = set_formula(base, "税率", "[售价] * 0.1")
    if st == 400:
        # 售价 是普通列，应当能设
        check("新列可以设计算列公式", False, r)
    else:
        check("新列可以设计算列公式", values(base, "税率") == ["10", "0.4"], values(base, "税率"))

    # 删掉被公式引用的列 → 公式作废，列退回普通列（不再是计算列）
    st, r = call("PUT", "/excel/headers", {
        "tableId": base,
        "headers": ["数量", "合计", "税率"],
        "renames": []
    }, token=TOKEN)
    check("删除被引用列成功", st == 200 and r.get("success"), r)

    meta = query(base).get("columnMeta") or {}
    check("合计 的公式被清掉（免得留一列永远算不出的只读格）",
          not (meta.get("合计") or {}).get("expr"), meta.get("合计"))
    check("税率 的公式也一并清掉（它引用的售价没了）",
          not (meta.get("税率") or {}).get("expr"), meta.get("税率"))

# ---------- 9) 导出带上计算列 ----------
print("\n--- 9) 导出 xlsx 时计算列有值 ---")
st, r = upload(["单价", "数量"], [["7", "6"]], name="exportme.xlsx")
if st == 200 and r.get("success"):
    tid = r["data"]["tableId"]
    add_columns(tid, ["单价", "数量", "合计"])
    set_formula(tid, "合计", "[单价] * [数量]")
    text = export_text(tid)
    check("导出成功", text is not None)
    if text:
        # Excel 把数值写成 <v>，算出来是 42
        check("导出里带上了算出来的 42", ">42<" in text, text[:200])

# ---------- 10) 取消计算列 ----------
print("\n--- 10) 取消计算列 ---")
st, r = upload(["甲", "乙", "丙"], [["1", "2", ""]], name="clear.xlsx")
if st == 200 and r.get("success"):
    tid = r["data"]["tableId"]
    set_formula(tid, "丙", "[甲] + [乙]")
    check("先算成 3", values(tid, "丙") == ["3"], values(tid, "丙"))

    st, r = set_formula(tid, "丙", "")
    check("清空公式成功", st == 200 and r.get("success"), r)
    meta = query(tid).get("columnMeta") or {}
    check("不再是计算列", not (meta.get("丙") or {}).get("expr"), meta.get("丙"))
    check("值变成空（这一列不再有数据）", values(tid, "丙") == [""], values(tid, "丙"))

    # 退回普通列之后可以手填
    st, r = call("POST", "/excel/save", {
        "tableId": tid,
        "rows": [{"甲": "1", "乙": "2", "丙": "手填"}]
    }, token=TOKEN)
    check("普通列可以手填", st == 200 and values(tid, "丙") == ["手填"], values(tid, "丙"))

for tid in created:
    call("DELETE", "/excel/delete?tableId=%d" % tid, token=TOKEN)

print("\n" + "=" * 60)
print("结果：%d 通过 / %d 失败" % (passed, failed))
print("=" * 60)
raise SystemExit(1 if failed else 0)
