// ================================================================
// 定时导出（Hangfire）相关接口
// ----------------------------------------------------------------
// 依赖：api.js（API_BASE / authHeaders / request）
// 单独成文件而不是塞进 api.js：定时导出是独立子域，
// 与「表格编辑」那套 CRUD 没有共用语义。
// ================================================================

/** 当前用户最近的定时导出报表（服务端已按时间倒序，最多 50 条） */
function fetchExports() {
    return request('/exports');
}

/**
 * 下载某份报表。
 * 必须走 fetch + Authorization 头：报表文件不放在 wwwroot 下，
 * 直接 <a href> 既带不上令牌，也绕过了归属校验。
 */
function downloadExportBlob(snapshotId) {
    return fetch(API_BASE + '/exports/' + snapshotId + '/download', {
        headers: authHeaders()
    }).then(res => {
        if (!res.ok) throw new Error('报表不存在或已被清理');
        return res.blob();
    });
}

/** 开启 / 关闭某张表的每日自动导出 */
function setAutoExport(tableId, enabled) {
    return request('/excel/tables/' + tableId + '/auto-export', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!enabled })
    });
}
