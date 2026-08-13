/* BNU Sparks · explorer-upload.js —— 上传。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
  async function getFiles(courseCode) {
    try { return await api('/api/courses/' + encodeURIComponent(courseCode) + '/files/'); }
    catch { return []; }
  }

  /* ═══════════════════════════════════════════════════════════
     上传 / 模态框
     ═══════════════════════════════════════════════════════════ */

  let uploadCourseCode = '';
  let uploadCategoryId = null; // v170：上传上下文节点（决定审核路由 L1/L2）
  let _uploadMode = 'file'; // 'file' | 'text'

  function autoFillUploadTitle() {
    var fileInput = document.getElementById('uploadFile');
    var titleInput = document.getElementById('uploadTitle');
    if (!fileInput || !titleInput) return;
    // 选中文件即提示超限（非阻断，提交时才会真正拦截）
    if (fileInput.files.length && _hasOversizeFile(fileInput.files)) _showSizeLimitError();
    if (titleInput.value.trim()) return;
    if (fileInput.files.length === 1) {
      titleInput.value = fileInput.files[0].name.replace(/\.[^.]+$/, '');
    }
  }

  function switchUploadMode(mode) {
    _uploadMode = mode;
    document.getElementById('uploadModeFile').style.display = mode === 'file' ? '' : 'none';
    document.getElementById('uploadModeText').style.display = mode === 'text' ? '' : 'none';
    document.querySelectorAll('.um-tab').forEach(function(t) {
      t.classList.toggle('um-tab-active', t.dataset.mode === mode);
    });
    // 切换模式更新标题占位符 + 清空标题
    var titleInput = document.getElementById('uploadTitle');
    if (titleInput) {
      titleInput.value = '';
      titleInput.placeholder = mode === 'text' ? '留空则自动取内容前20字' : '留空则自动使用文件名';
    }
    // 切换模式自动清空错误
    document.getElementById('uploadError').style.display = 'none';
  }

  // 资料类型选项（与后端 MaterialType 同步）
  function populateMaterialTypeDropdown() {
    var sel = document.getElementById('uploadMaterialType');
    if (!sel) return;
    // 只在第一次填充
    if (sel.options.length > 1) return;
    sel.innerHTML = '<option value="">请选择类型…</option>';
    MATERIAL_TYPES.forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
  }

  // ── 上传大小限制（与后端 DATA_UPLOAD_MAX_MEMORY_SIZE 对齐）──
  const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
  const SIZE_LIMIT_MSG = '文件大小超出限制，建议使用文件瘦身、压缩、拆分等方式处理后上传';

  function _hasOversizeFile(files) {
    for (var i = 0; i < (files ? files.length : 0); i++) {
      if (files[i].size > MAX_UPLOAD_SIZE) return true;
    }
    return false;
  }

  function _showSizeLimitError() {
    var el = document.getElementById('uploadError');
    if (!el) return;
    el.textContent = SIZE_LIMIT_MSG;
    el.classList.add('warn');
    el.style.display = 'block';
  }

  function showUploadModal(code, name, catId) {
    if (!currentUser) { showLoginModal(); return; }
    uploadCourseCode = code;
    uploadCategoryId = catId || null; // v170：从哪个专业节点上传
    _uploadMode = 'file';
    document.getElementById('uploadCourse').value = name + ' (' + code + ')';
    populateMaterialTypeDropdown();
    var ri = document.getElementById('reuploadInfo');
    if (ri) ri.style.display = 'none';
    _reuploadOldId = null;
    // 重置到文件模式
    switchUploadMode('file');
    document.getElementById('uploadModal').style.display = 'flex';
    lockScroll();
    _pushModalHistory();
  }

  function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('uploadForm').reset();
    document.getElementById('uploadError').style.display = 'none';
    document.getElementById('uploadProgress').style.display = 'none';
    var ri = document.getElementById('reuploadInfo');
    if (ri) ri.style.display = 'none';
    _reuploadOldId = null;
    unlockScroll();
    _popModalHistory();
  }

  async function handleUpload(e) {
    e.preventDefault();
    const el = document.getElementById('uploadError');
    const progress = document.getElementById('uploadProgress');
    const fill = document.getElementById('uploadProgressFill');
    const text = document.getElementById('uploadProgressText');

    el.style.display = 'none';

    var title = document.getElementById('uploadTitle').value;
    var description = document.getElementById('uploadDesc').value;
    var teacher = document.getElementById('uploadTeacher').value;
    var materialTypeId = document.getElementById('uploadMaterialType')?.value || '';
    if (!materialTypeId) {
      el.textContent = '请选择资料类型';
      el.style.display = 'block';
      progress.style.display = 'none';
      return false;
    }
    if (!teacher.trim()) {
      el.textContent = '请填写任课教师姓名';
      el.style.display = 'block';
      progress.style.display = 'none';
      return false;
    }

    // ── 文字录入模式 ──
    if (_uploadMode === 'text') {
      var content = document.getElementById('uploadTextContent').value;
      if (!content.trim()) {
        el.textContent = '请输入文字内容';
        el.style.display = 'block';
        return false;
      }
      progress.style.display = 'flex';
      fill.style.width = '30%';
      text.textContent = '正在提交文字内容…';

      try {
        var token = sessionStorage.getItem('token') || localStorage.getItem('token');
        const resp = await fetch('/api/files/upload-text/', {
          method: 'POST',
          headers: token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course_code: uploadCourseCode,
            category_id: uploadCategoryId, // v170 路由上下文
            title: title,
            content: content,
            description: description,
            teacher: teacher,
            material_type_id: materialTypeId,
          }),
        });
        // 非 JSON 响应（nginx 429 限流 / 413 超限默认页）→ 显示可读原因，而非「Unexpected token」
        let data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        if (!resp.ok || !data || !data.ok) {
          if (resp.status === 429) {
            throw new Error('上传过于频繁，请稍等一分钟后再试');
          }
          throw new Error((data && data.error) || '上传失败，请稍后重试（' + resp.status + '）');
        }

        fill.style.width = '100%';
        text.textContent = '✅ 文字录入成功！';
        setTimeout(function() { closeUploadModal(); refreshCourseTree(); }, 1500);
      } catch (err) {
        fill.style.width = '100%';
        text.textContent = '❌ 失败: ' + err.message;
      }
      return false;
    }

    // ── 文件上传模式 ──
    const files = document.getElementById('uploadFile').files;
    if (!files || !files.length) { el.textContent = '请选择文件'; el.style.display = 'block'; return false; }

    // 超限阻断：任一文件 >50MB → 下方高亮提示，不发请求
    if (_hasOversizeFile(files)) {
      _showSizeLimitError();
      progress.style.display = 'none';
      return false;
    }

    progress.style.display = 'flex';
    var successCount = 0, failCount = 0;
    var token = sessionStorage.getItem('token') || localStorage.getItem('token');

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (file.size > 50 * 1024 * 1024) {
        failCount++;
        text.textContent = (i + 1) + '/' + files.length + ' ' + file.name + ' 超过 50MB，跳过';
        continue;
      }

      var fileTitle = title || file.name.replace(/\.[^.]+$/, '');
      if (files.length > 1) fileTitle += ' (' + (i + 1) + ')';
      var pct = Math.round(((i + 1) / files.length) * 70) + 5;
      fill.style.width = pct + '%';
      text.textContent = (i + 1) + '/' + files.length + ' 上传中: ' + file.name;

      try {
        const formData = new FormData();
        formData.append('course_code', uploadCourseCode);
        if (uploadCategoryId) formData.append('category_id', uploadCategoryId); // v170 路由上下文
        formData.append('title', fileTitle);
        formData.append('file', file);
        formData.append('description', description);
        formData.append('teacher', teacher);
	        if (materialTypeId) formData.append('material_type_id', materialTypeId);

        const resp = await fetch('/api/files/upload/', {
          method: 'POST',
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
          body: formData,
        });
        let data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        // 400 默认页（非 JSON，通常是请求体超限）→ 显示友好超限文案而非「Unexpected token」
        if (!resp.ok || !data || !data.ok) {
          throw new Error((data && data.error) || SIZE_LIMIT_MSG);
        }
        successCount++;
      } catch (err) {
        failCount++;
        text.textContent = (i + 1) + '/' + files.length + ' ' + file.name + ' 失败: ' + err.message;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (successCount > 0 && _reuploadOldId) {
      try {
        await api('/api/files/' + _reuploadOldId + '/delete/', { method: 'DELETE' });
      } catch(e) { /* 静默失败 */ }
      _reuploadOldId = null;
    }

    fill.style.width = '100%';
    text.textContent = '完成！成功 ' + successCount + ' 个' + (failCount > 0 ? '，失败 ' + failCount + ' 个' : '');
    // 全部失败时不自动关闭弹窗，让用户看到失败原因
    if (successCount > 0) {
      setTimeout(function() { closeUploadModal(); refreshCourseTree(); }, 1500);
    }
    return false;
  }


  /* ═══════════════════════════════════════════════════════════
     EXPLORER — 课程浏览器（文件管理器风格）
     ═══════════════════════════════════════════════════════════ */

  // 课程导航树现在由后端 API /api/courses/tree 提供
  // ── Card SVG Icons ─────────────────────────

