#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
代码约束守门（CODE_STANDARDS.md 的机器可执行部分）。不需要起服务，秒级完成。

用法：
    python tests/check_constraints.py          # 全量检查
    python tests/check_constraints.py --lines  # 附一份「体积偏大」文件清单（提示，不影响退出码）

约束与豁免清单见仓库根目录 CODE_STANDARDS.md；改约束先改文档，再同步这里。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "ExcelToWeb"
WWW = APP / "wwwroot"

# 单文件「体量参考线」：**不是上限**，只用于 --lines 时打印提示。
# 超过它通常意味着「这里该不该抽个协作类」值得想一想，但拆不拆由人判断，脚本不拦提交。
SIZE_HINT = 400

# JS 禁用模式：正则 -> 说明
JS_FORBIDDEN = [
    (r"\beval\s*\(", "禁止 eval（注入风险，替换/查找一律走转义后的 RegExp 字面逻辑）"),
    (r"new\s+Function\s*\(", "禁止 new Function（等同 eval）"),
    (r"\balert\s*\(", "禁止 alert（统一用 showToast，样式与可测性更好）"),
    (r"document\.write\s*\(", "禁止 document.write"),
]

# C# 禁用模式：正则 -> 说明
CS_FORBIDDEN = [
    (r"Console\.Write(Line|)\s*\(", "禁止 Console.WriteLine（用 ILogger，生产环境没有控制台可看）"),
    (r"catch\s*(\(\s*Exception\s*\w*\s*\))?\s*\{\s*\}", "禁止空 catch 块（至少记日志或转友好提示）"),
    (r"\"(SA_)?Password\"?\s*\+\s*\w+", "禁止字符串拼接 SQL 密码等敏感信息"),
]

# 危险 SQL 拼接：ExecuteSqlRaw 里的非参数化插值
CS_SQL_INTERP = re.compile(r"ExecuteSqlRawAsync?\(\s*\$" , re.M)


def iter_sources():
    skips = {"bin", "obj", "node_modules", ".git", ".workbuddy", "lib"}
    exts = {".cs", ".js", ".html", ".css", ".py"}
    seen = set()
    for p in ROOT.rglob("*"):
        if not p.is_file() or p.suffix not in exts:
            continue
        parts = set(p.relative_to(ROOT).parts[:-1])
        if parts & skips:
            continue
        if p in seen:
            continue
        seen.add(p)
        yield p


failures = []


def fail(msg):
    failures.append(msg)


def rel(p):
    return str(p.relative_to(ROOT)).replace("\\", "/")


def report_sizes():
    """按体量倒序列出超过参考线的文件。仅提示，不计入 failures。"""
    rows = []
    for p in iter_sources():
        try:
            n = sum(1 for _ in p.open(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        if n > SIZE_HINT:
            rows.append((n, rel(p)))
    if not rows:
        return
    rows.sort(reverse=True)
    print("\n体积参考（> %d 行，不构成约束）：" % SIZE_HINT)
    for n, r in rows:
        print("  · %5d 行  %s" % (n, r))
    print()


def check_patterns():
    for p in iter_sources():
        r = rel(p)
        text = p.read_text(encoding="utf-8", errors="replace")
        rules = []
        if r.startswith("ExcelToWeb/wwwroot/") and p.suffix == ".js":
            rules = JS_FORBIDDEN
        elif p.suffix == ".cs":
            rules = CS_FORBIDDEN
            if CS_SQL_INTERP.search(text):
                fail(f"[sql] {r}: ExecuteSqlRaw 疑似使用字符串插值，必须参数化（见 BulkInsertRowsAsync 的写法）")
        for pat, why in rules:
            m = re.search(pat, text)
            if m:
                line_no = text[: m.start()].count("\n") + 1
                fail(f"[{p.suffix}] {r}:{line_no}: {why}")


def check_script_order():
    """index.html：state.js 必须先于 app.js，且两者都存在；新模块必须登记。"""
    html = (WWW / "index.html").read_text(encoding="utf-8", errors="replace")
    order = re.findall(r'src="(js/[^"]+)"', html)
    if "js/state.js" not in order or "js/app.js" not in order:
        fail("[wire] index.html 缺少 state.js 或 app.js 引用")
        return
    if order.index("js/state.js") > order.index("js/app.js"):
        fail("[wire] index.html 加载顺序错误：state.js 必须在 app.js 之前")
    # app.js 必须是最后一个业务脚本（除 shell.js 外；shell.js 在 head 里）
    tail = [s for s in order if s != "js/shell.js"]
    if tail and tail[-1] != "js/app.js":
        fail(f"[wire] index.html 中 app.js 必须是最后加载的业务脚本，当前最后是 {tail[-1]}")


def main():
    only_sizes = "--lines" in sys.argv
    check_patterns()
    check_script_order()

    if only_sizes:
        report_sizes()

    if failures:
        print("代码约束检查：%d 项不通过\n" % len(failures))
        for f in failures:
            print("  ❌ " + f)
        print("\n约束详情见 CODE_STANDARDS.md")
        return 1

    print("代码约束检查：全部通过（注入与调试残留 / 脚本接线顺序；行数已改为体量提示，不再设上限）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
