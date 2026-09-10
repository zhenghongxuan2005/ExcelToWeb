// ================================================================
// 表格管理页：卡片列表 + 重命名 / 复制 / 导出 / 删除
// 依赖：api.js、utils.js、shell.js
// ================================================================

let manageTables = [];

document.addEventListener('DOMContentLoaded', () => {
    if (!Shell.requireLogin()) return;
    loadManageList();
});

/** 拉取全部表格并渲染 */
function loadManageList() {
    const host = document.getElementById('tableGrid');
    if (!host) return;

    host.innerHTML = '<div class="empty-state"><p>加载中...</p></div>';

    fetchTableList()
        .then(tables => {
            manageTables = tables || [];
            renderManageList();
        })
        .catch(err => {
            host.innerHTML = '<div class="empty-state">'
                + '<div class="empty-icon"><svg class="icon"><use href="#i-x-circle"/></svg></div>'
                + `<p>加载失败：${escapeHtml(err.message)}</p>`
                + '</div>';
        });
}

/** 渲染卡片列表 */
function renderManageList() {
    const host = document.getElementById('tableGrid');
    if (!host) return;

    const countEl = document.getElementById('tableCount');
    if (countEl) countEl.textContent = manageTables.length === 0 ? '' : `${manageTables.length} 个表格`;

    if (manageTables.length === 0) {
        host.innerHTML = '<div class="empty-state">'
            + '<div class="empty-icon"><svg class="icon"><use href="#i-inbox"/></svg></div>'
            + '<p>还没有任何表格</p>'
            + '<p class="empty-sub">到「表格编辑」页上传一个 Excel 即可创建</p>'
            + '<a class="btn btn-primary" href="/" style="margin-top:14px;">'
            + '<svg class="icon"><use href="#i-upload"/></svg>去上传 Excel</a>'
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
            html += '<span class="chip chip-muted">无列信息</span>';
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
        html += `<span><svg class="icon icon-sm"><use href="#i-columns"/></svg>${headers.length} 列</span>`;
        html += `<span><svg class="icon icon-sm"><use href="#i-clock"/></svg>创建 ${escapeHtml(formatTime(t.createdAt))}</span>`;
        html += `<span><svg class="icon icon-sm"><use href="#i-refresh"/></svg>更新 ${escapeHtml(formatTime(t.updatedAt))}</span>`;
        html += '</div>';

        html += '<div class="card-actions">';
        html += `<button class="btn btn-primary btn-sm" onclick="openTable(${t.id})"><svg class="icon icon-sm"><use href="#i-edit"/></svg>打开</button>`;
        html += `<button class="btn btn-outline btn-sm" onclick="promptRename(${t.id})"><svg class="icon icon-sm"><use href="#i-file"/></svg>重命名</button>`;
        html += `<button class="btn btn-outline btn-sm" onclick="doDuplicate(${t.id})"><svg class="icon icon-sm"><use href="#i-copy"/></svg>复制</button>`;
        html += `<button class="btn btn-outline btn-sm" onclick="doExport(${t.id}, 'xlsx')"><svg class="icon icon-sm"><use href="#i-download"/></svg>Excel</button>`;
        html += `<button class="btn btn-outline btn-sm" onclick="doExport(${t.id}, 'csv')"><svg class="icon icon-sm"><use href="#i-download"/></svg>CSV</button>`;
        html += `<button class="btn btn-danger btn-sm" onclick="doDelete(${t.id})"><svg class="icon icon-sm"><use href="#i-trash"/></svg>删除</button>`;
        html += '</div>';

        html += '</div>';
    }
    host.innerHTML = html;
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

    const input = prompt('请输入新的表格名称：', t.tableName);
    if (input === null) return;                     // 用户取消

    const name = input.trim();
    if (name.length === 0) {
        alert('表格名称不能为空');
        return;
    }
    if (name.length > 100) {
        alert('表格名称不能超过 100 个字符');
        return;
    }
    if (name === t.tableName) return;               // 没变化就不打扰后端

    renameTable(tableId, name)
        .then(() => {
            t.tableName = name;                     // 就地更新，避免整页重载
            renderManageList();
            showToast('✅ 重命名成功', 'success');
        })
        .catch(err => showToast('❌ 重命名失败：' + err.message, 'error'));
}

/** 复制。返回的是新表格信息（UploadResult），用新表名回显更直观 */
function doDuplicate(tableId) {
    duplicateTable(tableId)
        .then(copy => {
            const name = copy && copy.tableName ? copy.tableName : '副本';
            showToast('✅ 已复制为「' + name + '」', 'success');
            loadManageList();                       // 列表需要重新拉取（多了一张表）
        })
        .catch(err => showToast('❌ 复制失败：' + err.message, 'error'));
}

/** 导出 Excel / CSV */
function doExport(tableId, kind) {
    const t = findTable(tableId);
    const base = t ? t.tableName : '数据';
    const today = new Date().toISOString().slice(0, 10);

    const task = kind === 'csv'
        ? exportCsvBlob(tableId).then(blob => downloadBlob(blob, `${base}_${today}.csv`))
        : exportExcelBlob(tableId).then(blob => downloadBlob(blob, `${base}_${today}.xlsx`));

    task
        .then(() => showToast('✅ 导出成功', 'success'))
        .catch(err => showToast('❌ 导出失败：' + err.message, 'error'));
}

/** 删除（二次确认，含表格名，避免误删） */
function doDelete(tableId) {
    const t = findTable(tableId);
    const name = t ? t.tableName : '该表格';
    if (!confirm(`确定要删除「${name}」及其全部数据吗？此操作不可恢复。`)) return;

    deleteTable(tableId)
        .then(() => {
            manageTables = manageTables.filter(x => x.id !== tableId);
            renderManageList();
            showToast('✅ 已删除', 'success');
        })
        .catch(err => showToast('❌ 删除失败：' + err.message, 'error'));
}

// ================================================================
// 暴露给内联 onclick
// ================================================================
Object.assign(window, {
    openTable, promptRename, doDuplicate, doExport, doDelete
});
