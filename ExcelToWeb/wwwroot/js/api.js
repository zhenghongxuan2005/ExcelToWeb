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

// ================================================================
// Excel 表格
// ================================================================
function uploadExcel(file) {
    const formData = new FormData();
    formData.append('file', file);
    return request('/excel/upload', { method: 'POST', body: formData });
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

function fetchTableList() {
    return request('/excel/tables');
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
