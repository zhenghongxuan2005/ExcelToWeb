// ================================================================
// 拖拽上传：把 Excel 文件拖到页面上即可导入
// 依赖：utils.js（showToast / setStatus）、api.js（uploadExcel）、state.js、render.js、tables.js
// ================================================================

/** 校验拖入的文件是否为受支持的 Excel */
function isAcceptedExcelFile(file) {
    if (!file) return false;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return ext === 'xlsx' || ext === 'xls';
}

/**
 * 走与「上传 Excel」按钮完全相同的导入流程。
 * 抽成公共函数，避免拖拽与点击两条路径各写一份、行为逐渐不一致。
 */
function uploadFile(file) {
    if (!file) return;

    if (!isAcceptedExcelFile(file)) {
        showToast('请上传 .xlsx 或 .xls 格式的文件', 'error');
        return;
    }

    setStatus('上传中...');
    showTableSkeleton(currentHeaders.length);
    uploadExcel(file)
        .then(data => {
            hideTableSkeleton();
            currentTableId = data.tableId;
            currentHeaders = data.headers;
            currentRows = data.rows;
            resetSort();
            // 刚导入的是全新数据源，撤销栈从零开始
            resetHistory();
            // 换了数据源，搜索与分页都要回到初始状态
            searchKeyword = '';
            currentPage = 1;
            const input = document.getElementById('globalSearch');
            if (input) input.value = '';
            const clearBtn = document.getElementById('searchClear');
            if (clearBtn) clearBtn.style.display = 'none';

            renderTable();
            showToast('✅ 成功导入 ' + data.rows.length + ' 条数据', 'success');
            setStatus(`已加载: ${data.tableName} (${data.rows.length}行)`);
            loadTableList();
        })
        .catch(err => {
            hideTableSkeleton();
            showToast('❌ 上传失败：' + err.message, 'error');
            setStatus('上传失败');
            console.error(err);
        });
}

/** 绑定拖拽上传（在 app.js 初始化时调用一次） */
function initDragAndDrop() {
    const main = document.querySelector('.main');
    if (!main) return;

    let depth = 0;   // dragenter/dragleave 会随子元素冒泡，用计数避免遮罩闪烁

    main.addEventListener('dragenter', e => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        depth++;
        main.classList.add('is-dragover');
    });

    main.addEventListener('dragover', e => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();          // 必须阻止默认行为，否则浏览器会直接打开文件
        e.dataTransfer.dropEffect = 'copy';
    });

    main.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) main.classList.remove('is-dragover');
    });

    main.addEventListener('drop', e => {
        e.preventDefault();
        depth = 0;
        main.classList.remove('is-dragover');

        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || files.length === 0) return;
        if (files.length > 1) showToast('一次只能上传一个文件，已取第一个', 'info');
        uploadFile(files[0]);
    });
}
