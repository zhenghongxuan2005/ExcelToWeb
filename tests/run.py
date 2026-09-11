#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
回归测试编排：起服务 → 跑全部测试 → 关服务（如果是我拉起来的）

用法：
    python tests/run.py

环境变量：
    TEST_BASE_URL      默认 http://localhost:5185/api；测试连接的基础 URL
    SKIP_BACKEND       非空则跳过 backend/* 测试
    SKIP_FRONTEND      非空则跳过 frontend/* 测试
    KEEP_SERVER        非空则结束时不关服务（排查时用）
"""
import os
import sys
import time
import socket
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = Path(__file__).resolve().parent
BASE = os.environ.get("TEST_BASE_URL", "http://localhost:5185")
START_URL = "http://localhost:5185/login.html"
HOST_PORT = 5185


def _port_listening(port, host="127.0.0.1", timeout=1.0):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _wait_for_server(deadline_s):
    """轮询 /login.html，等到返回 200 或超时。"""
    end = time.time() + deadline_s
    while time.time() < end:
        try:
            with urllib.request.urlopen(START_URL, timeout=2) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, ConnectionError, OSError):
            pass
        time.sleep(0.5)
    return False


def _kill_server():
    # 通过进程名结束（Windows / 类 Unix 通用）
    if sys.platform.startswith("win"):
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-Process -Name ExcelToWeb -ErrorAction SilentlyContinue | Stop-Process -Force"],
            check=False,
        )
    else:
        subprocess.run(["pkill", "-f", "ExcelToWeb"], check=False)


def _start_server():
    print("[run.py] 端口 %d 无服务，正在启动 ..." % HOST_PORT)
    log_path = TESTS / "server.log"
    log = open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(
        ["dotnet", "run", "--project", str(EXCEL_PROJECT), "--no-build", "--urls", "http://localhost:%d" % HOST_PORT],
        cwd=str(ROOT),
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    print("[run.py] 服务 PID = %d，日志在 %s" % (proc.pid, log_path))
    return proc


EXCEL_PROJECT = ROOT / "ExcelToWeb" / "ExcelToWeb.csproj"


def _run_script(cmd, label):
    print("\n" + "=" * 60)
    print("▶ %s" % label)
    print("=" * 60)
    t0 = time.time()
    rc = subprocess.run(cmd, cwd=str(ROOT)).returncode
    dt = time.time() - t0
    mark = "✅" if rc == 0 else "❌"
    print("%s %s   exit=%d   耗时 %.1fs" % (mark, label, rc, dt))
    return rc


def main():
    # 第 0 项：代码约束守门（不起服务，秒级；约束内容见 CODE_STANDARDS.md）
    rc = _run_script([sys.executable, str(TESTS / "check_constraints.py")], "[guard] check_constraints.py")
    if rc != 0:
        print("\n[run.py] 代码约束未通过，跳过后续测试（先修约束再跑回归）")
        return rc
    results = [("[guard] check_constraints.py", rc)]

    own_server = None
    any_tests = (not os.environ.get("SKIP_BACKEND")) or (not os.environ.get("SKIP_FRONTEND"))
    if not any_tests:
        print("[run.py] backend/frontend 均已跳过，不启动服务")
    elif _port_listening(HOST_PORT):
        print("[run.py] 检测到已有服务运行在 %d 端口，不另起" % HOST_PORT)
    else:
        own_server = _start_server()
        if not _wait_for_server(deadline_s=60):
            print("[run.py] 服务启动超时，请查看 tests/server.log", file=sys.stderr)
            if own_server:
                own_server.terminate()
            return 1

    if not os.environ.get("SKIP_BACKEND"):
        for f in sorted((TESTS / "backend").glob("*.py")):
            label = "[backend] %s" % f.name
            rc = _run_script([sys.executable, str(f), ], label)
            results.append((label, rc))
            if rc != 0:
                break  # 后端一挂，后续用例都是噪音，先修再跑

    if not os.environ.get("SKIP_FRONTEND"):
        node = os.environ.get("NODE_BIN", "node")
        for f in sorted((TESTS / "frontend").glob("*.js")):
            label = "[frontend] %s" % f.name
            rc = _run_script([node, str(f)], label)
            results.append((label, rc))

    if own_server and not os.environ.get("KEEP_SERVER"):
        print("\n[run.py] 结束测试，关闭自起的服务 ...")
        try:
            own_server.terminate()
        except Exception:
            pass
        _kill_server()

    print("\n" + "=" * 60)
    print("汇总")
    print("=" * 60)
    fail = [n for n, rc in results if rc != 0]
    for name, rc in results:
        print("  %s  %s" % ("✅" if rc == 0 else "❌", name))
    print("=" * 60)
    print("总计 %d 项，失败 %d 项" % (len(results), len(fail)))
    return 0 if not fail else 1


if __name__ == "__main__":
    sys.exit(main())