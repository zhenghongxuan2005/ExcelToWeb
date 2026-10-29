// ================================================================
// API 层 - 所有与后端交互的请求（统一 JWT 认证 + 响应格式）
// ================================================================

const API_BASE = '/api';

/** 获取存储的 token */
function getToken() {
    return localStorage.getItem('token') || '';
}

/** 获取存储的刷新令牌（长效、可吊销，用于 access token 过期后的静默续期） */
function getRefreshToken() {
    return localStorage.getItem('refreshToken') || '';
}

/** 构建带认证的请求头 */
function authHeaders(extra = {}) {
    const token = getToken();
    return token ? { 'Authorization': 'Bearer ' + token, ...extra } : extra;
}

/** 清空本地登录态并回到登录页 */
function redirectToLogin() {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('familyId');
    localStorage.removeItem('username');
    window.location.href = '/login.html';
}

/**
 * 单例刷新：并发多个 401 共享同一次刷新请求（promise 去重）。
 * 服务端是轮换语义（旧 refresh token 用一次即失效），如果并发各刷各的，
 * 第一轮之后的令牌都已被吊销，反而触发重用检测把整个会话族踢下线。
 */
let refreshingPromise = null;

function refreshSession() {
    if (refreshingPromise) return refreshingPromise;

    const refreshToken = getRefreshToken();
    if (!refreshToken) return Promise.reject(new Error('无刷新令牌'));

    refreshingPromise = fetch(API_BASE + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
    }).then(async res => {
        const result = await res.json().catch(() => null);
        if (!res.ok || !result || !result.success) throw new Error('刷新失败');
        localStorage.setItem('token', result.data.token);
        localStorage.setItem('refreshToken', result.data.refreshToken);
        if (result.data.familyId) localStorage.setItem('familyId', result.data.familyId);
        return result.data.token;
    }).finally(() => {
        refreshingPromise = null;
    });
    return refreshingPromise;
}

/**
 * 统一 fetch 封装：自动带 token、解析统一响应、处理 401
 * 401 时先用刷新令牌静默续期一次并重放原请求（仅排除 refresh 自身，防死循环）
 * @returns {Promise<any>} 解析后的响应 data（如果 success=true）
 * @throws {Error} 包含错误 message
 */
async function request(url, options = {}) {
    let res = await fetch(API_BASE + url, { ...options, headers: authHeaders(options.headers || {}) });

    // access token 失效：静默刷新一次并重放。只排除 refresh 自身（它走裸 fetch，这里纯防御）；
    // /auth/me、/auth/sessions 等认证端点同样需要静默续期。重放后不再二次刷新，防止死循环
    if (res.status === 401 && getRefreshToken() && url !== '/auth/refresh') {
        try {
            await refreshSession();
            // 重放原请求：authHeaders 此时读到的已是新 token
            res = await fetch(API_BASE + url, { ...options, headers: authHeaders(options.headers || {}) });
        } catch (e) {
            redirectToLogin();
            throw new Error('登录已过期，请重新登录');
        }
    }

    if (res.status === 401) {
        redirectToLogin();
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

/** 注销：通知服务端吊销当前会话族。失败静默——本地清 token 后照常退出 */
function logoutApi() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return Promise.resolve();
    return request('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
    }).catch(() => { /* 服务端吊销失败不阻塞本地退出 */ });
}

/** 活跃会话列表（settings 页会话管理） */
function fetchSessions() {
    return request('/auth/sessions');
}

/** 注销指定会话（吊销其所属会话族） */
function revokeSessionApi(sessionId) {
    return request('/auth/sessions/' + sessionId, { method: 'DELETE' });
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

// ================================================================
// 回收站（软删除的表格：30 天内可恢复）
// ================================================================

/** 回收站列表：已删除表格（删除时间 + 行数） */
function fetchTrash() {
    return request('/excel/trash');
}

/** 恢复回收站里的表格 */
function restoreFromTrash(tableId) {
    return request('/excel/trash/' + tableId + '/restore', { method: 'POST' });
}

/** 彻底删除：物理删表并清掉关联的审计与校验规则，不可恢复 */
function purgeTableForever(tableId) {
    return request('/excel/trash/' + tableId, { method: 'DELETE' });
}

/**
 * 回收站保留策略（当前是 { retentionDays: 30 }）。
 * 保留天数由服务端下发，前端不再各写一份常量——两边硬编码同一个数字，
 * 一旦后台清理的配置改了，页面上的「N 天后自动清除」就会开始说谎。
 */
function fetchTrashPolicy() {
    return request('/excel/trash/policy');
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
