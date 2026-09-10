// ================================================================
// 带校验的 Excel 上传
// 依赖：state.js、utils.js、api.js、render.js（renderTable / showTableSkeleton / hideTableSkeleton）
// ================================================================

// ===== 带校验的上传 =====

function uploadWithValidation() {
    const fileInput = document.getElementById('fileInputValidate');
    if (!fileInput) {
        showToast('请先选择文件', 'info');
        return;
    }
    const file = fileInput.files[0];
    if (!file) {
        showToast('请选择文件', 'info');
        return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
        showToast('请上传 .xlsx 或 .xls 格式的文件', 'error');
        fileInput.value = '';
        return;
    }

    if (!currentTableId) {
        showToast('请先上传一个 Excel 文件或选择一个表格', 'error');
        fileInput.value = '';
        return;
    }

    setStatus('校验并上传中...');
    showTableSkeleton(currentHeaders.length);
    uploadWithValidationApi(file, currentTableId)
        .then(vr => {
            hideTableSkeleton();
            const msg = `校验完成：总行数 ${vr.totalRows}，成功 ${vr.successRows} 行，错误 ${vr.errorRows} 行`;
            if (vr.errorRows > 0) {
                showToast('⚠️ ' + msg + '\n\n错误详情：\n' + vr.errors.join('\n'), 'error');
            } else {
                showToast('✅ ' + msg, 'success');
                currentRows = vr.validRows;
                renderTable();
                setStatus(`已加载: ${currentTableId} (${currentRows.length}行)`);
            }
            fileInput.value = '';
        })
        .catch(err => {
            hideTableSkeleton();
            showToast('❌ 上传失败：' + err.message, 'error');
            setStatus('上传失败');
            fileInput.value = '';
            console.error('上传错误:', err);
        });
}
