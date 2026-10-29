# -*- coding: utf-8 -*-
"""RBAC 授权回归：三档角色（管理员 / 编辑 / 只读）的越权矩阵。

要点：授权是服务端强制的，不靠前端隐藏按钮。因此这里全部直接打接口，
不经过页面——前端藏了按钮也挡不住直接调 API 的人，测试必须模拟那种人。

覆盖：
  - 新注册账号默认管理员，登录响应带角色与权限码（前端据此隐藏入口）
  - 匿名访问成员接口返回 401（不是 403，否则前端分不清「该登录」和「被降级」）
  - 只读账号：可读、不可写、不可删、不可管理成员
  - 编辑账号：可写、不可删表、不可管理成员
  - 管理员：可列成员、可改角色；不能改自己；非法角色名被拒
  - 角色变更立即生效：同一个旧令牌，改完角色后下一次请求就被拦
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from smoke_base import call, ensure_user, login   # noqa: E402

passed = 0
failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print("  ✅ " + name)
    else:
        failed += 1
        print("  ❌ " + name + (" | " + str(detail) if detail != "" else ""))


suffix = str(int(time.time()))[-6:]
ADMIN = "rbacadm" + suffix
MEMBER = "rbacusr" + suffix
PWD = "rbac_pass_123"


def perms(token):
    st, r = call("GET", "/auth/me", token=token)
    data = r.get("data") or {}
    return st, data.get("role"), data.get("permissions") or []


# ---------- 1) 注册即管理员，登录响应带权限码 ----------
print("\n--- 1) 注册与登录下发的角色 ---")
ensure_user(ADMIN, PWD)
ensure_user(MEMBER, PWD)

token_a = login(ADMIN, PWD)
token_b = login(MEMBER, PWD)
check("管理员账号登录成功", bool(token_a))
check("成员账号登录成功", bool(token_b))

st, r = call("POST", "/auth/login", {"username": MEMBER, "password": PWD})
data = r.get("data") or {}
check("登录响应带角色", data.get("role") == "Admin", data.get("role"))
check("管理员拥有全部 5 项权限", len(data.get("permissions") or []) == 5,
      data.get("permissions"))

# ---------- 2) 匿名访问 ----------
print("\n--- 2) 未登录 ---")
st, r = call("GET", "/users")
check("匿名访问成员接口返回 401", st == 401, st)

# ---------- 3) 管理员：列成员 ----------
print("\n--- 3) 管理员列成员 ---")
st, r = call("GET", "/users", token=token_a)
members = r.get("data") or []
check("管理员可列成员", st == 200, st)
me = [m for m in members if m.get("username") == ADMIN]
check("自己的那条标记 isSelf", bool(me) and me[0].get("isSelf") is True, me)
member = [m for m in members if m.get("username") == MEMBER]
check("能找到刚注册的成员", bool(member), len(members))
member_id = member[0]["id"] if member else 0

# ---------- 4) 管理员改角色的边界 ----------
print("\n--- 4) 改角色的边界 ---")
st, r = call("PUT", "/users/%d/role" % (me[0]["id"] if me else 0), {"role": "Viewer"}, token=token_a)
check("不能修改自己的角色", st == 400 and "自己" in (r.get("message") or ""), r.get("message"))

st, r = call("PUT", "/users/%d/role" % member_id, {"role": "Root"}, token=token_a)
check("非法角色名被拒", st == 400 and "不合法" in (r.get("message") or ""), r.get("message"))

st, r = call("PUT", "/users/999999/role", {"role": "Viewer"}, token=token_a)
check("不存在的成员返回 404", st == 404, st)

# ---------- 5) 只读：能看不能改 ----------
print("\n--- 5) 只读账号 ---")
st, r = call("PUT", "/users/%d/role" % member_id, {"role": "Viewer"}, token=token_a)
check("管理员把成员降为只读", st == 200, r.get("message"))

st, role, plist = perms(token_b)
check("只读账号只有 table:read", role == "Viewer" and plist == ["table:read"], (role, plist))

st, r = call("GET", "/excel/tables", token=token_b)
check("只读账号可以读表格列表", st == 200, st)

# 关键：用的还是降级前签发的同一个令牌 —— 权限以库为准，不认令牌里的快照
st, r = call("POST", "/excel/save", {"tableId": 1, "rows": []}, token=token_b)
check("只读账号保存被拦", st == 403, st)
check("403 提示说明了缺哪种权限", "编辑表格" in (r.get("message") or ""), r.get("message"))

st, r = call("DELETE", "/excel/delete?tableId=1", token=token_b)
check("只读账号删表被拦", st == 403, st)

st, r = call("GET", "/users", token=token_b)
check("只读账号不能管理成员", st == 403, st)

# ---------- 6) 编辑：能写不能删 ----------
print("\n--- 6) 编辑账号 ---")
st, r = call("PUT", "/users/%d/role" % member_id, {"role": "Editor"}, token=token_a)
check("管理员把成员升为编辑", st == 200, r.get("message"))

st, role, plist = perms(token_b)
check("编辑拥有两项权限", role == "Editor" and plist == ["table:read", "table:write"], (role, plist))

# 表不存在没关系：授权先于业务，能把 403 排除掉就说明过了授权这一关
st, r = call("POST", "/excel/save", {"tableId": 999999, "rows": []}, token=token_b)
check("编辑账号保存不再被授权拦截", st != 403, st)

st, r = call("DELETE", "/excel/delete?tableId=999999", token=token_b)
check("编辑账号不能删表", st == 403, st)

st, r = call("PUT", "/excel/headers",
             {"tableId": 999999, "headers": ["a"], "renames": {}}, token=token_b)
check("编辑账号可以改列结构（业务 404 而非 403）", st != 403, st)

# ---------- 7) 演示账号没有管理权 ----------
print("\n--- 7) 演示账号 ---")
demo_token = login("demo", "demo1234")
if demo_token:
    st, r = call("GET", "/users", token=demo_token)
    check("演示账号（编辑档）不能管理成员", st == 403, st)
else:
    check("演示账号登录（跳过后续断言）", False, "登录失败")

# ---------- 8) 收尾：把成员还原成管理员 ----------
print("\n--- 8) 还原 ---")
st, r = call("PUT", "/users/%d/role" % member_id, {"role": "Admin"}, token=token_a)
check("成员还原为管理员", st == 200, r.get("message"))

print("\n" + "=" * 60)
print("结果：%d 通过 / %d 失败" % (passed, failed))
print("=" * 60)
raise SystemExit(1 if failed else 0)
