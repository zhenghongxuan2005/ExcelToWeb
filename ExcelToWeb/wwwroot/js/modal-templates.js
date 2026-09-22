// ================================================================
// 页面弹窗模板：原先直接写在 index.html 里的 7 个模态框搬到这里。
// ----------------------------------------------------------------
// 为什么搬：index.html 已顶到 400 行上限（CODE_STANDARDS.md §2），而每个弹窗都是
//   「外壳固定、内容由 JS 填充」，留在 HTML 里只会让后续新增功能无处登记 <script>。
// 搬出来后 index.html 只留结构骨架，弹窗随本模块一起版本化。
//
// 注入时机（与 shell.js 注入图标 sprite 是同一套路）：
//   本文件在 <body> 末尾、业务脚本之前求值，此时 document.body 已存在；
//   真正消费弹窗的代码都在 app.js 的 DOMContentLoaded 回调里、或点击时才执行，
//   因此「先注入、后使用」的时序是安全的。
//
// 注意：内联 onclick/onchange 的处理函数仍需登记进 app.js 的 window 暴露名单；
//   tests/frontend/wire_check.js 与 frontend_check.js 已改为同时扫描本文件，
//   否则「弹窗外置」会让这部分接线校验静默漏检。
// ================================================================

(function () {
    'use strict';

    // 幂等：本模块被重复引入时不重复注入
    if (document.getElementById('ruleModal')) return;

    var html = `
    <!-- ===== 条件格式规则弹窗 ===== -->
    <div id="ruleModal" class="modal">
        <div class="modal-card">
            <button class="modal-close" aria-label="关闭弹窗" onclick="closeRuleModal()"><svg class="icon"><use href="#i-x"/></svg></button>
            <h3 class="modal-title">条件格式规则设置</h3>
            <p class="modal-sub">设置数值列的颜色规则，输入范围后点击保存。留空最大值表示"以上"。</p>

            <div class="field">
                <label class="field-label">应用列</label>
                <select id="ruleColumnSelect" class="select" style="width:auto; min-width:180px;" onchange="handleRuleColumnChange()">
                    <!-- 选项由 populateRuleColumnSelect() 按当前表格的真实列名填充 -->
                </select>
            </div>

            <div id="ruleList">
                <!-- 规则列表由 JS 动态生成 -->
            </div>

            <button class="btn btn-primary btn-sm" onclick="addRuleRow()" style="margin-top:12px;">
                <svg class="icon icon-sm"><use href="#i-plus"/></svg>添加规则
            </button>

            <div class="modal-footer">
                <button class="btn btn-outline" onclick="closeRuleModal()">取消</button>
                <button class="btn btn-success" onclick="saveRules()"><svg class="icon"><use href="#i-save"/></svg>保存规则</button>
            </div>
        </div>
    </div>

    <!-- ===== 列筛选弹窗 ===== -->
    <div id="filterModal" class="modal">
        <div class="modal-card">
            <button class="modal-close" aria-label="关闭弹窗" onclick="closeFilter()"><svg class="icon"><use href="#i-x"/></svg></button>
            <h3 class="modal-title" style="font-size:17px;">筛选: <span id="filterColumnName"></span></h3>
            <p class="modal-sub">勾选要显示的值（Excel 式值清单），或切换到「按条件」用关键词筛选。筛选只影响显示，保存时仍会保存全部数据。</p>

            <div class="filter-mode">
                <label class="filter-mode-opt"><input type="radio" name="filterMode" value="values" checked onchange="setFilterMode('values')"> 按值选择</label>
                <label class="filter-mode-opt"><input type="radio" name="filterMode" value="condition" onchange="setFilterMode('condition')"> 按条件</label>
            </div>

            <div id="filterValuesPane">
                <input type="text" id="filterValueSearch" class="input" placeholder="搜索值..." autocomplete="off"
                       oninput="onFilterValueSearch(this.value)">
                <div class="filter-value-tools">
                    <button class="btn btn-outline btn-sm" onclick="filterSelectAll(true)">全选</button>
                    <button class="btn btn-outline btn-sm" onclick="filterSelectAll(false)">全不选</button>
                    <span class="filter-value-count" id="filterValueCount"></span>
                </div>
                <div class="filter-value-list" id="filterValueList"></div>
            </div>

            <div id="filterConditionPane" style="display:none;">
                <div class="field">
                    <label class="field-label">条件</label>
                    <select id="filterCondition" class="select">
                        <option value="contains">包含</option>
                        <option value="notContains">不包含</option>
                        <option value="equals">等于</option>
                        <option value="startsWith">开头是</option>
                        <option value="endsWith">结尾是</option>
                    </select>
                </div>

                <div class="field">
                    <label class="field-label">关键词</label>
                    <input type="text" id="filterKeyword" class="input" placeholder="输入筛选关键词...">
                </div>
            </div>

            <div class="modal-footer">
                <button class="btn btn-outline" onclick="clearFilter()">清除筛选</button>
                <button class="btn btn-outline" onclick="closeFilter()">取消</button>
                <button class="btn btn-primary" onclick="applyFilter()">应用</button>
            </div>
        </div>
    </div>

    <!-- ===== 批量编辑弹窗 ===== -->
    <div id="batchModal" class="modal">
        <div class="modal-card modal-sm">
            <button class="modal-close" aria-label="关闭弹窗" onclick="closeBatchModal()"><svg class="icon"><use href="#i-x"/></svg></button>
            <h3 class="modal-title">批量编辑</h3>
            <p class="modal-sub">将选中行的某一列统一修改为新值</p>

            <div class="field">
                <label class="field-label">选择列</label>
                <select id="batchColumnSelect" class="select"></select>
            </div>

            <div class="field">
                <label class="field-label">新值</label>
                <input type="text" id="batchValueInput" class="input" placeholder="输入要修改的值">
            </div>

            <div class="modal-footer" style="border-top:none; padding-top:0;">
                <button class="btn btn-outline" onclick="closeBatchModal()">取消</button>
                <button class="btn btn-primary" onclick="confirmBatchEdit()">确认修改</button>
            </div>
        </div>
    </div>

    <!-- ===== 数据校验规则弹窗 ===== -->
    <div id="validationModal" class="modal">
        <div class="modal-card modal-wide">
            <button class="modal-close" aria-label="关闭弹窗" onclick="closeValidationModal()"><svg class="icon"><use href="#i-x"/></svg></button>
            <h3 class="modal-title">数据校验规则设置</h3>
            <p class="modal-sub">为每列设置校验规则，点击"保存"时自动检查数据合法性</p>

            <div id="validationRuleList">
                <!-- 规则列表由 JS 动态生成 -->
            </div>

            <button class="btn btn-primary btn-sm" onclick="addValidationRule()" style="margin-top:14px;">
                <svg class="icon icon-sm"><use href="#i-plus"/></svg>添加规则
            </button>

            <div class="modal-footer">
                <button class="btn btn-outline" onclick="closeValidationModal()">取消</button>
                <button class="btn btn-success" onclick="saveValidationRules()"><svg class="icon"><use href="#i-save"/></svg>保存规则</button>
            </div>
        </div>
    </div>

    <!-- ===== 变更历史弹窗 ===== -->
    <div id="historyModal" class="modal">
        <div class="modal-card">
            <button class="modal-close" aria-label="关闭弹窗" onclick="closeHistoryModal()"><svg class="icon"><use href="#i-x"/></svg></button>
            <h3 class="modal-title" id="historyTitle">变更历史</h3>
            <p class="modal-sub">每次「保存」时自动记录前后差异（最多显示最近 100 条）。行号以保存当时为准，行增删后旧记录的行号可能不再对齐。</p>

            <span id="historyFilterChip" class="filter-chip" style="display:none;">
                <span id="historyFilterText"></span>
                <button class="filter-chip-x" title="查看整表历史" onclick="clearHistoryFilter()"><svg class="icon icon-sm"><use href="#i-x"/></svg></button>
            </span>

            <div id="historyList" class="history-list"></div>

            <div class="modal-footer">
                <button class="btn btn-outline" onclick="closeHistoryModal()">关闭</button>
            </div>
        </div>
    </div>

    <!-- ===== 查找 / 替换弹窗 ===== -->
    <div id="findModal" class="modal">
        <div class="modal-card modal-sm">
            <button class="modal-close" aria-label="关闭弹窗" onclick="closeFindModal()"><svg class="icon"><use href="#i-x"/></svg></button>
            <h3 class="modal-title">查找和替换</h3>
            <p class="modal-sub">在整个表格中查找，范围不受筛选与分页影响</p>

            <div class="field">
                <label class="field-label" for="findKeyword">查找内容</label>
                <input type="text" id="findKeyword" class="input" placeholder="要查找的文字或数字" autocomplete="off" oninput="updateFindStatus()">
            </div>

            <div class="field">
                <label class="field-label" for="findReplace">替换为</label>
                <input type="text" id="findReplace" class="input" placeholder="留空表示删除匹配内容" autocomplete="off">
            </div>

            <div class="find-row">
                <label class="find-check"><input type="checkbox" id="findCaseSensitive" onchange="updateFindStatus()"> 区分大小写</label>
            </div>

            <p class="find-status" id="findStatus"></p>

            <div class="modal-footer">
                <button class="btn btn-outline" onclick="closeFindModal()">关闭</button>
                <button class="btn" onclick="findNext()">查找下一个</button>
                <button class="btn" onclick="replaceCurrent()">替换</button>
                <button class="btn btn-primary" onclick="replaceAll()"><svg class="icon"><use href="#i-check"/></svg>全部替换</button>
            </div>
        </div>
    </div>

    <!-- ===== 列管理弹窗 ===== -->
    <div id="columnModal" class="modal">
        <div class="modal-card">
            <button class="modal-close" aria-label="关闭弹窗" onclick="closeColumnModal()"><svg class="icon"><use href="#i-x"/></svg></button>
            <h3 class="modal-title">列管理</h3>
            <p class="modal-sub">重排（↑↓）、改名（直接编辑）、删除（×）或添加列。删除列会连同数据与相关规则一起清除，保存时一次提交。</p>

            <div id="columnDraftList" class="col-draft-list">
                <!-- 列草稿行由 column-manager.js 动态生成 -->
            </div>

            <button class="btn btn-primary btn-sm" onclick="addColumnRow()" style="margin-top:12px;">
                <svg class="icon icon-sm"><use href="#i-plus"/></svg>添加列
            </button>

            <div class="modal-footer">
                <button class="btn btn-outline" onclick="closeColumnModal()">取消</button>
                <button class="btn btn-success" onclick="saveColumnStructure()"><svg class="icon"><use href="#i-save"/></svg>保存列结构</button>
            </div>
        </div>
    </div>

    <!-- ===== 工作表选择弹窗（文件里有多张工作表时才出现） ===== -->
    <div id="sheetPickerModal" class="modal">
        <div class="modal-card">
            <button class="modal-close" aria-label="关闭弹窗" onclick="closeSheetPicker()"><svg class="icon"><use href="#i-x"/></svg></button>
            <h3 class="modal-title">选择工作表</h3>
            <p class="modal-sub">这个文件里有多个工作表，请选择要导入的一张。每次导入一张，导入后会成为一个新表格。</p>

            <div id="sheetPickerList" class="sheet-list">
                <!-- 工作表按钮由 sheet-picker.js 生成 -->
            </div>

            <div class="modal-footer">
                <button class="btn btn-outline" onclick="closeSheetPicker()">取消</button>
            </div>
        </div>
    </div>
`;

    document.body.insertAdjacentHTML('beforeend', html);
})();
