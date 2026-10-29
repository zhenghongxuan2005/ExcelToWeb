// ================================================================
// 表格管理页：卡片列表 + 重命名 / 复制 / 导出 / 删除
// 依赖：api.js、utils.js（tt / escapeHtml / formatTime / showToast）、shell.js
// 说明：卡片是 JS 拼出来的，所有含中文的句子都必须走 tt()——整段拼接之后再查字典
//       是查不到的（「创建 Oct 13」这种带时间戳的串永远命中不了静态条目）。
// ================================================================

let manageTables = [];

document.addEventListener('DOMContentLoaded', () => {
    if (!Shell.requireLogin()) return;
    loadManageList();
    // 报表列表与表格列表并行拉取：两者互不依赖，串行只会让首屏多等一个 RTT
    loadExportList();
});

// 切换语言后必须重渲染：卡片里的「N 列」「创建 …」是拼出来的，已经写进 DOM 的
// 中英混排文本没有可匹配的字典条目，只能按新语言重新生成一遍。
document.addEventListener('i18n:change', () => {
    if (!manageTables.length) return;   // 首屏还没回来时由 loadManageList 自己按新语言渲染
    renderManageList();
    renderExportList();
});

/** 拉取全部表格并渲染 */
function loadManageList() {
    const host = document.getElementById('tableGrid');
    if (!host) return;

    // 骨架卡片占位：避免「白屏 → 卡片突然出现」的跳动（样式见 table.css 骨架屏段）
    let sk = '';
    for (let i = 0; i < 3; i++) {
        sk += '<div class="table-card skeleton-card" aria-hidden="true">'
            + '<div class="skeleton-block" style="height:20px; width:55%;"></div>'
            + '<div class="skeleton-block" style="height:12px; width:90%;"></div>'
            + '<div class="skeleton-block" style="height:12px; width:72%;"></div>'
            + '<div class="skeleton-block" style="height:30px; width:100%;"></div>'
            + '</div>';
    }
    host.innerHTML = sk;

    fetchTableList()
        .then(tables => {
            manageTables = tables || [];
            renderManageList();
        })
        .catch(err => {
            host.innerHTML = '<div class="empty-state">'
                + '<div class="empty-icon"><svg class="icon"><use href="#i-x-circle"/></svg></div>'
                + `<p>${escapeHtml(tt('加载失败：{msg}', { msg: err.message }))}</p>`
                + '</div>';
        });
}

/** 渲染卡片列表 */
function renderManageList() {
    const host = document.getElementById('tableGrid');
    if (!host) return;

    const countEl = document.getElementById('tableCount');
    if (countEl) {
        countEl.textContent = manageTables.length === 0
            ? ''
            : tt('{n} 个表格', { n: manageTables.length });
    }

    if (manageTables.length === 0) {
        host.innerHTML = '<div class="empty-state">'
            + '<div class="empty-icon"><svg class="icon"><use href="#i-inbox"/></svg></div>'
            + '<p>' + tt('还没有任何表格') + '</p>'
            + '<p class="empty-sub">' + tt('到「表格编辑」页上传一个 Excel 即可创建') + '</p>'
            + '<a class="btn btn-primary" href="/" style="margin-top:14px;">'
            + '<svg class="icon"><use href="#i-upload"/></svg>' + tt('去上传 Excel') + '</a>'
            + '</div>';
        return;
    }

    let html = '';
    for (const t of manageTables) {
        const headers = t.headers || [];
        html += '<div class="table-card">';
        html += '<div class="card-head">';
        html += '<div class="card-icon"><svg class="icon"><use href="#i-table"/></svg></div>';
        html += `<h3 class="card-title" title="${escapeHtml(t.tableName)}">${escapeHtml(t.tableName)}</h3>`;
        html += '</div>';

        // 列名预览：最多显示 4 个，其余折叠为 +N
        html += '<div class="card-headers">';
        if (headers.length === 0) {
            html += '<span class="chip chip-muted">' + tt('无列信息') + '</span>';
        } else {
            headers.slice(0, 4).forEach(h => {
                html += `<span class="chip">${escapeHtml(h)}</span>`;
            });
            if (headers.length > 4) {
                html += `<span class="chip chip-muted">+${headers.length - 4}</span>`;
            }
        }
        html += '</div>';

        html += '<div class="card-meta">';
        html += `<span><svg class="icon icon-sm"><use href="#i-columns"/></svg>${tt('{n} 列', { n: headers.length })}</span>`;
        html += `<span><svg class="icon icon-sm"><use href="#i-clock"/></svg>`
            + `${tt('创建 {time}', { time: escapeHtml(formatTime(t.createdAt)) })}</span>`;
        html += `<span><svg class="icon icon-sm"><use href="#i-refresh"/></svg>`
            + `${tt('更新 {time}', { time: escapeHtml(formatTime(t.updatedAt)) })}</span>`;
        html += '</div>';

        // 每日自动导出开关。挂在 data-perm 下：只读账号看到的是「关」而且是禁用的，
        // 不能交互却显示成开启，会让人以为报表在生成
        html += '<label class="card-toggle" data-perm="table:write">'
            + `<input type="checkbox"${t.autoExportEnabled ? ' checked' : ''}`
            + ` onchange="toggleAutoExport(${t.id}, this.checked)">`
            + '<span>' + tt('每日自动导出') + '</span></label>';

        html += '<div class="card-actions">';
        html += `<button class="btn btn-primary btn-sm" onclick="openTable(${t.id})"><svg class="icon icon-sm"><use href="#i-edit"/></svg>${tt('打开')}</button>`;
        html += `<button class="btn btn-outline btn-sm" data-perm="table:write" onclick="promptRename(${t.id})"><svg class="icon icon-sm"><use href="#i-file"/></svg>${tt('重命名')}</button>`;
        html += `<button class="btn btn-outline btn-sm" data-perm="table:write" onclick="doDuplicate(${t.id})"><svg class="icon icon-sm"><use href="#i-copy"/></svg>${tt('复制')}</button>`;
        html += `<button class="btn btn-outline btn-sm" onclick="doExport(${t.id}, 'xlsx')"><svg class="icon icon-sm"><use href="#i-download"/></svg>Excel</button>`;
        html += `<button class="btn btn-outline btn-sm" onclick="doExport(${t.id}, 'csv')"><svg class="icon icon-sm"><use href="#i-download"/></svg>CSV</button>`;
        html += `<button class="btn btn-danger btn-sm" data-perm="table:delete" onclick="doDelete(${t.id})"><svg class="icon icon-sm"><use href="#i-trash"/></svg>${tt('删除')}</button>`;
        html += '</div>';

        html += '</div>';
    }
    host.innerHTML = html;
    // 没有写权限的账号只保留「打开 / 导出」，不显示改与删
    if (typeof Authz !== "undefined") Authz.apply(host);
}

/** 按 id 取表格（找不到返回 null） */
function findTable(tableId) {
    return manageTables.find(t => t.id === tableId) || null;
}

/** 打开表格：记住要打开的表 id，回到编辑页由它读取 */
function openTable(tableId) {
    localStorage.setItem('openTableId', String(tableId));
    window.location.href = '/';
}

/** 重命名 */
function promptRename(tableId) {
    const t = findTable(tableId);
    if (!t) return;

    const input = prompt(tt('请输入新的表格名称：'), t.tableName);
    if (input === null) return;                     // 用户取消

    const name = input.trim();
    if (name.length === 0) {
        showToast(tt('表格名称不能为空'), 'error');
        return;
    }
    if (name.length > 100) {
        showToast(tt('表格名称不能超过 100 个字符'), 'error');
        return;
    }
    if (name === t.tableName) return;               // 没变化就不打扰后端

    renameTable(tableId, name)
        .then(() => {
            t.tableName = name;                     // 就地更新，避免整页重载
            renderManageList();
            showToast('✅ ' + tt('重命名成功'), 'success');
        })
        .catch(err => showToast('❌ ' + tt('重命名失败：{msg}', { msg: err.message }), 'error'));
}

/** 复制。返回的是新表格信息（UploadResult），用新表名回显更直观 */
function doDuplicate(tableId) {
    duplicateTable(tableId)
        .then(copy => {
            const name = copy && copy.tableName ? copy.tableName : tt('副本');
            showToast('✅ ' + tt('已复制为「{name}」', { name: name }), 'success');
            loadManageList();                       // 列表需要重新拉取（多了一张表）
        })
        .catch(err => showToast('❌ ' + tt('复制失败：{msg}', { msg: err.message }), 'error'));
}

/** 导出 Excel / CSV */
function doExport(tableId, kind) {
    const t = findTable(tableId);
    const base = t ? t.tableName : 'data';
    const today = new Date().toISOString().slice(0, 10);

    const task = kind === 'csv'
        ? exportCsvBlob(tableId).then(blob => downloadBlob(blob, `${base}_${today}.csv`))
        : exportExcelBlob(tableId).then(blob => downloadBlob(blob, `${base}_${today}.xlsx`));

    task
        .then(() => showToast('✅ ' + tt('导出成功'), 'success'))
        .catch(err => showToast('❌ ' + tt('导出失败：{msg}', { msg: err.message }), 'error'));
}

/** 删除（二次确认；删除进回收站，可在回收站页恢复） */
function doDelete(tableId) {
    const t = findTable(tableId);
    const name = t ? t.tableName : tt('该表格');
    // 不写死「30 天内可恢复」：保留天数由服务端配置决定，这里的数字一旦过期就成了假承诺
    if (!confirm(tt('确定要删除「{name}」吗？删除后进回收站，可在「回收站」页恢复。', { name: name }))) return;

    deleteTable(tableId)
        .then(msg => {
            manageTables = manageTables.filter(x => x.id !== tableId);
            renderManageList();
            showToast('✅ ' + tt(msg || '已删除'), 'success');
        })
        .catch(err => showToast('❌ ' + tt('删除失败：{msg}', { msg: err.message }), 'error'));
}

// ================================================================
// 定时导出（Hangfire 每日任务产出的 xlsx 快照）
// ================================================================

let exportItems = [];

/** 切换某张表的「每日自动导出」 */
function toggleAutoExport(tableId, enabled) {
    const t = findTable(tableId);

    setAutoExport(tableId, enabled)
        .then(msg => {
            if (t) t.autoExportEnabled = enabled;
            showToast('✅ ' + tt(msg || (enabled ? '已开启每日自动导出' : '已关闭每日自动导出')), 'success');
        })
        .catch(err => {
            // 失败必须把勾选状态还原：界面显示「开着」而实际没开，
            // 用户会以为明天有报表，到第二天发现什么都没有
            if (t) t.autoExportEnabled = !enabled;
            renderManageList();
            showToast('❌ ' + err.message, 'error');
        });
}

/** 拉取报表列表 */
function loadExportList() {
    const panel = document.getElementById('exportsPanel');
    if (!panel) return;

    fetchExports()
        .then(items => {
            exportItems = items || [];
            renderExportList();
        })
        .catch(() => {
            // 报表是附加信息，取不到就整块不显示，不影响表格管理本身
            panel.hidden = true;
        });
}

/** 渲染报表列表；没有任何快照时整块隐藏，不摆一张空卡占位 */
function renderExportList() {
    const host = document.getElementById('exportList');
    const panel = document.getElementById('exportsPanel');
    if (!host || !panel) return;

    if (exportItems.length === 0) {
        panel.hidden = true;
        return;
    }

    let html = '';
    for (const s of exportItems) {
        html += '<div class="export-row">';
        html += '<div class="export-main">';
        html += `<span class="export-name" title="${escapeHtml(s.fileName)}">${escapeHtml(s.tableName)}</span>`;
        html += `<span class="export-meta">${escapeHtml(formatTime(s.createdAt))}`
            + ` · ${tt('{n} 行', { n: s.rowCount })} · ${formatBytes(s.sizeBytes)}</span>`;
        html += '</div>';
        html += `<button class="btn btn-outline btn-sm" onclick="downloadExport(${s.id})">`
            + '<svg class="icon icon-sm"><use href="#i-download"/></svg>' + tt('下载') + '</button>';
        html += '</div>';
    }
    host.innerHTML = html;
    panel.hidden = false;
}

/** 下载某份报表（文件名用服务端登记的那份，避免前端再造一套命名规则） */
function downloadExport(snapshotId) {
    const item = exportItems.find(x => x.id === snapshotId);
    const name = item ? item.fileName : `export_${snapshotId}.xlsx`;

    downloadExportBlob(snapshotId)
        .then(blob => downloadBlob(blob, name))
        .catch(err => showToast('❌ ' + err.message, 'error'));
}

/** 字节数 → 可读大小 */
function formatBytes(bytes) {
    if (!bytes || bytes < 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ================================================================
// 暴露给内联 onclick
// ================================================================
Object.assign(window, {
    openTable, promptRename, doDuplicate, doExport, doDelete,
    toggleAutoExport, downloadExport
});
