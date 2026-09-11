# 测试套件

回归资产统一管理在这里，不再散落在系统 Temp 目录。

## 目录

```
tests/
├── backend/                Python 后端测试（要求服务已起在 :5185）
│   ├── step1_smoke.py      基础接口冒烟（20）
│   ├── step3_smoke.py      改名/复制/改密码等接口（35）
│   └── epplus8_test.py     EPPlus 8 升级后的解析/导出/模板路径（29）
├── frontend/               Node 前端测试（直接读 wwwroot 源文件）
│   ├── view_test.js        视图管线：搜索 / 排序 / 分页 / 列（34）
│   ├── p0_test.js          P0「向 Excel 靠拢」功能逻辑（57）
│   ├── frontend_check.js   5 个 HTML 页面脚本挂载是否齐全
│   └── wire_check.js       脚本加载期：ReferenceError / state 绑定 / window 导出
├── run.py                  一键编排：起服务 → 跑全部 → 关服务
└── README.md
```

## 前置条件

- Python 3.13（managed 或 system 都行），用于 `backend/*.py` 和 `run.py`
- Node 22（managed 或 system 都行），用于 `frontend/*.js`
- ExcelToWeb 服务监听 `http://localhost:5185`（默认）。要换端口：
  ```bash
  set TEST_BASE_URL=http://localhost:9999/api   # Windows cmd
  export TEST_BASE_URL=http://localhost:9999/api # bash
  ```

## 单独跑某个测试

后端：
```bash
python tests/backend/step1_smoke.py
python tests/backend/step3_smoke.py
python tests/backend/epplus8_test.py
```

前端：
```bash
node tests/frontend/view_test.js
node tests/frontend/p0_test.js
node tests/frontend/frontend_check.js
node tests/frontend/wire_check.js
```

`view_test.js` / `p0_test.js` 不需要服务；其他都要。

## 一键全跑

```bash
python tests/run.py
```

`run.py` 会：
1. 检查 5185 端口是否有服务；没有就自动 `dotnet run` 拉起来
2. 等待 `/login.html` 返回 200
3. 依次跑 7 个测试脚本
4. 如果是它自己拉的服务，结束后关掉
5. 汇总 PASS/FAIL，**任何一项失败整体退出码非零**

## 不进仓的一次性脚本

之前在 `C:\Users\Ben\AppData\Local\Temp\` 下还有几个一次性改写脚本（`split_css.py`、`shell_a11y.py`、`split_rules.py`、`diag_tpl.py` 等），那些是阶段性重构工具，**不进仓**，用完即丢。

## 新增测试的约定

- 每个脚本要在退出码上区分 0 = 全过 / 1 = 有失败
- 后端测试只读 stdout 也能看清进度（每条断言都打 `PASS` / `FAIL`）
- 前端测试用同一个 `node + vm.createContext` 的小跑法（参考 `p0_test.js`），不要依赖 Puppeteer/Chromium
- 不要写绝对路径，全部用 `path.join(__dirname, ...)`