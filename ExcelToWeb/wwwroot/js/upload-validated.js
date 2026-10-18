// ================================================================
// 带校验的 Excel 上传
// 依赖：state.js、utils.js、api.js、render.js（renderTable / showTableSkeleton / hideTableSkeleton）
// ================================================================

// ===== 带校验的上传 =====

function uploadWithValidation() {
    const fileInput = document.getElementById('fileInputValidate');
    if (!fileInput) {
        showToast(tt('请先选择文件'), 'info');
        return;
    }
    const file = fileInput.files[0];
    if (!file) {
        showToast(tt('请选择文件'), 'info');
        return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'xlsx' && ext !== 'csv') {
        showToast(tt('请上传 .xlsx 或 .csv 格式的文件'), 'error');
        fileInput.value = '';
        return;
    }

    if (!currentTableId) {
        showToast(tt('请先上传一个 Excel 文件或选择一个表格'), 'error');
        fileInput.value = '';
        return;
    }

    setStatus(tt('校验并上传中...'));
    showTableSkeleton(currentHeaders.length);
    uploadWithValidationApi(file, currentTableId)
        .then(vr => {
            hideTableSkeleton();
            const msg = tt('校验完成：总行数 {total}，成功 {ok} 行，错误 {bad} 行', {
                total: vr.totalRows, ok: vr.successRows, bad: vr.errorRows
            });
            if (vr.errorRows > 0) {
                showToast('⚠️ ' + msg + '\n\n' + tt('错误详情：') + '\n' + vr.errors.join('\n'), 'error');
            } else {
                showToast('✅ ' + msg, 'success');
                currentRows = vr.validRows;
                // 整表被替换，撤销栈随之作废
                resetHistory();
                renderTable();
                setStatus(tt('已加载: {name} ({n}行)', { name: currentTableId, n: currentRows.length }));
            }
            fileInput.value = '';
        })
        .catch(err => {
            hideTableSkeleton();
            showToast('❌ ' + tt('上传失败：{msg}', { msg: err.message }), 'error');
            setStatus(tt('上传失败'));
            fileInput.value = '';
            console.error('上传错误:', err);
        });
}
