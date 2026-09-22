// ================================================================
// API 层 - 所有与后端交互的请求（统一 JWT 认证 + 响应格式）
// ================================================================

const API_BASE = '/api';

/** 获取存储的 token */
function getToken() {
    return localStorage.getItem('token') || '';
}

/** 构建带认证的请求头 */
function authHeaders(extra = {}) {
    const token = getToken();
    return token ? { 'Authorization': 'Bearer ' + token, ...extra } : extra;
}

/**
 * 统一 fetch 封装：自动带 token、解析统一响应、处理 401
 * @returns {Promise<any>} 解析后的响应 data（如果 success=true）
 * @throws {Error} 包含错误 message
 */
async function request(url, options = {}) {
    const headers = authHeaders(options.headers || {});
    const res = await fetch(API_BASE + url, { ...options, headers });

    if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        window.location.href = '/login.html';
        throw new Error('登录已过期，请重新登录');
    }

    const result = await res.json();
    if (!result.success) {
        throw new Error(result.message || '请求失败');
    }
    return result.data !== undefined ? result.data : result;
}

// ================================================================
// 认证
// ================================================================
function login(username, password) {
    return fetch(API_BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).then(res => res.json());
}

function register(username, password, confirmPassword) {
    return fetch(API_BASE + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, confirmPassword })
    }).then(res => res.json());
}

function getCurrentUser() {
    return request('/auth/me');
}

/** 修改密码（需登录，后端会校验原密码）。后端返回的是纯消息，这里直接取 message */
function changePassword(oldPassword, newPassword, confirmPassword) {
    return request('/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword })
    }).then(r => (typeof r === 'string' ? r : (r && r.message) || '密码修改成功'));
}

// ================================================================
// Excel 表格
// ================================================================
/**
 * 上传 Excel 导入为新表。
 * @param {File} file
 * @param {number} [sheetIndex] 用文件里的哪张工作表（0 基）；不传即第一张
 */
function uploadExcel(file, sheetIndex) {
    const formData = new FormData();
    formData.append('file', file);
    const query = (sheetIndex === undefined || sheetIndex === null) ? '' : '?sheetIndex=' + sheetIndex;
    return request('/excel/upload' + query, { method: 'POST', body: formData });
}

/** 列出 Excel 文件里的工作表（多工作表时让用户选一张再导入） */
function listSheets(file) {
    const formData = new FormData();
    formData.append('file', file);
    return request('/excel/sheets', { method: 'POST', body: formData });
}

function queryTableData(tableId, date) {
    let url = '/excel/query?tableId=' + tableId;
    if (date) url += '&date=' + encodeURIComponent(date);
    return request(url);
}

function saveTableData(tableId, rows) {
    return request('/excel/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, rows })
    });
}

function deleteTable(tableId) {
    return request('/excel/delete?tableId=' + tableId, { method: 'DELETE' });
}

/** 重命名表格 */
function renameTable(tableId, tableName) {
    return request('/excel/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, tableName })
    });
}

/** 复制表格（表结构 + 全部数据行） */
function duplicateTable(tableId) {
    return request('/excel/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId })
    });
}

function fetchTableList() {
    return request('/excel/tables');
}

/** 列结构维护（增 / 删 / 改 / 移）：headers 为最终列名，renames 为 [{oldName, newName}] */
function updateHeaders(tableId, headers, renames) {
    return request('/excel/headers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, headers, renames: renames || [] })
    });
}

/** 读取列视图元数据（列名 -> { width, hidden }） */
function fetchColumnMeta(tableId) {
    return request('/excel/column-meta?tableId=' + tableId);
}

/** 整表保存列视图元数据（列宽 / 是否隐藏） */
function saveColumnMeta(tableId, meta) {
    return request('/excel/column-meta', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, meta })
    });
}

/**
 * 设置 / 清空某列的计算公式。formula 传空串表示把该列退回普通可编辑列。
 * 公式的语法与引用校验在服务端做，失败时 err.message 就是「公式哪里写错了」。
 */
function saveFormula(tableId, columnName, formula) {
    return request('/excel/formula', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, columnName, formula })
    });
}

// ================================================================
// 透视汇总
// ----------------------------------------------------------------
// 预览与导出走同一份服务端计算，所以两个函数放在一起，免得日后改一个忘一个。
// ================================================================

/** 透视汇总预览：按行字段分组、列字段展开，对值字段做 agg 聚合 */
function buildPivot(payload) {
    return request('/excel/pivot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

/**
 * 透视导出（blob）：数据表 + 「透视」工作表两张。
 * 校验失败时后端回的是 400 + JSON，得把里面的 message 取出来当错误提示 ——
 * 一律说「导出失败」的话，用户根本不知道自己哪里填错了。
 */
function exportPivotBlob(payload) {
    return fetch(API_BASE + '/excel/pivot-export', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
    }).then(res => {
        if (res.ok) return res.blob();
        return res.json()
            .catch(() => null)
            .then(body => { throw new Error((body && body.message) || '导出失败'); });
    });
}

// ================================================================
// 导出（返回 blob，不走统一 JSON 解析）
// ================================================================
function exportExcelBlob(tableId) {
    return fetch(API_BASE + '/excel/export?tableId=' + tableId, {
        headers: authHeaders()
    }).then(res => {
        if (!res.ok) throw new Error('导出失败');
        return res.blob();
    });
}

function exportCsvBlob(tableId) {
    return fetch(API_BASE + '/excel/export-csv?tableId=' + tableId, {
        headers: authHeaders()
    }).then(res => {
        if (!res.ok) throw new Error('导出失败');
        return res.blob();
    });
}

function downloadTemplateBlob(tableId) {
    return fetch(API_BASE + '/excel/template?tableId=' + tableId, {
        headers: authHeaders()
    }).then(res => {
        if (!res.ok) throw new Error('下载失败');
        return res.blob();
    });
}

// ================================================================
// 颜色规则
// ================================================================
function fetchColorRules(columnName) {
    let url = '/excel/rules';
    if (columnName) url += '?columnName=' + encodeURIComponent(columnName);
    return request(url);
}

function saveColorRules(rules) {
    return request('/excel/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules)
    });
}

// ================================================================
// 校验规则
// ================================================================
function fetchValidationRules(tableId) {
    return request('/excel/validation-rules?tableId=' + tableId);
}

function saveValidationRulesApi(rules) {
    return request('/excel/validation-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules)
    });
}

/** 取某列的去重值（上限 500），供「跨表引用」下拉与保存校验使用 */
function fetchColumnValues(tableId, columnName) {
    return request('/excel/column-values?tableId=' + tableId + '&columnName=' + encodeURIComponent(columnName));
}

/** 查询变更历史（按时间倒序，最多 100 条）；rowIndex 可选，传值时只看该行 */
function fetchAuditLogs(tableId, rowIndex) {
    let url = '/excel/audit-logs?tableId=' + tableId;
    if (rowIndex) url += '&rowIndex=' + rowIndex;
    return request(url);
}

// ================================================================
// 带校验的上传
// ================================================================
function uploadWithValidationApi(file, tableId) {
    const formData = new FormData();
    formData.append('file', file);
    return request('/excel/upload-with-validation?tableId=' + tableId, {
        method: 'POST',
        body: formData
    });
}

// ================================================================
// 工具：触发浏览器下载 blob
// ================================================================
function downloadBlob(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}
