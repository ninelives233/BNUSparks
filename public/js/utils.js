  async function api(url, opts = {}) {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    const headers = { ...opts.headers };
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && !(opts.body instanceof FormData)) opts.body = JSON.stringify(opts.body);
    const resp = await fetch(url, { ...opts, headers });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || '请求失败');
    return data.data;
  }

  function formatSize(bytes) {
    if (!bytes) return '未知';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024/1024).toFixed(1) + ' MB';
  }

  // ── 弹窗滚动锁定 ──
  let _scrollPos = 0;
  let _scrollLockCount = 0;

  function lockScroll() {
    if (_scrollLockCount === 0) {
      _scrollPos = window.pageYOffset;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = -_scrollPos + 'px';
      document.body.style.width = '100%';
    }
    _scrollLockCount++;
  }

  function unlockScroll() {
    if (_scrollLockCount > 0) _scrollLockCount--;
    if (_scrollLockCount === 0) {
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('position');
      document.body.style.removeProperty('top');
      document.body.style.removeProperty('width');
      window.scrollTo(0, _scrollPos);
    }
  }

  // ── 模态框 history 管理 ──
  function _pushModalHistory() {
    var currentState = history.state;
    if (currentState && currentState._modal) {
      history.replaceState({ _bnusparks: true, _modal: true }, '');
    } else {
      history.pushState({ _bnusparks: true, _modal: true }, '');
    }
  }
  function _popModalHistory() {
    if (history.state && history.state._modal) {
      history.back();
    }
  }

  // ── 下载处理（含限额梯度提醒） ──
  function handleDownloadClick(fileId, el, event) {
    event.preventDefault();
    event.stopPropagation();

    // 限额梯度提醒
    if (currentUser && currentUser.daily_download_remaining !== undefined && currentUser.daily_download_remaining > 0 && currentUser.daily_download_remaining <= 40) {
      var used = 60 - currentUser.daily_download_remaining;
      if (used >= 21 && used % 5 === 0) {
        if (!confirm('温馨提醒：今日已下载 ' + used + ' 次。请考虑一下平台的维护成本，珍惜每一次下载。\n\n点击「确定」继续下载。')) {
          return;
        }
      }
    }

    // 乐观递增前端下载计数（仅在文件表格内有效）
    var tr = el.closest('tr');
    if (tr) { var c = tr.querySelector('.ft-dlcount'); if (c) { var m = c.textContent.match(/(\d+)/); if (m) { c.textContent = parseInt(m[1]) + 1; } } }

    // 即时反馈：按钮显示加载状态
    _showDownloadFeedback(el);

    // 直接触发浏览器原生下载（流式写入磁盘，无 fetch+blob 内存问题）
    doDirectDownload(fileId);
  }

  // ── 下载按钮即时反馈 ──
  function _showDownloadFeedback(el) {
    if (!el) return;
    var orig = el.textContent || el.innerText || '';
    el.textContent = '⏳';
    el.style.pointerEvents = 'none';
    setTimeout(function() {
      el.textContent = orig;
      el.style.pointerEvents = '';
    }, 3000);
  }

  // ── 直接下载（短时令牌替代 JWT 放入 URL，避免 JWT 泄露到日志） ──
  async function doDirectDownload(fileId, fileName) {
    var token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (!token) { alert('请先登录'); return; }
    try {
      var resp = await fetch('/api/files/' + fileId + '/download-token/', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      var data = await resp.json();
      if (!data.ok) throw new Error(data.error || '获取下载令牌失败');
      var dtoken = data.data.token;
      var url = '/api/files/' + fileId + '/download/?dtoken=' + encodeURIComponent(dtoken);
      var a = document.createElement('a');
      a.href = url;
      a.download = fileName || '';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      alert('下载失败：' + err.message);
    }
  }

  // ── 批量下载辅助 ──
  var _selectedIds = {};

  function updateBatchDlBar() {
    var count = Object.keys(_selectedIds).length;
    var countEl = document.getElementById('selectedCount');
    if (countEl) countEl.textContent = '已选 ' + count + ' 个';
    var btn = document.getElementById('batchDlBtn');
    if (btn) btn.disabled = count === 0;
    // 更新表头计数（已选 X / 总可见）
    var headCount = document.getElementById('selectedCountHead');
    if (headCount) {
      var tbody = document.getElementById('fileTableBody');
      var total = tbody ? tbody.querySelectorAll('.dl-chk').length : 0;
      headCount.textContent = count + '/' + total;
    }
  }

  function toggleSelectAll(source) {
    var checked = source.checked;
    var tbody = document.getElementById('fileTableBody');
    tbody.querySelectorAll('.dl-chk').forEach(function(c) {
      c.checked = checked;
      var fid = parseInt(c.getAttribute('data-fid'));
      if (fid) {
        if (checked) _selectedIds[fid] = true;
        else delete _selectedIds[fid];
      }
    });
    updateBatchDlBar();
  }

  function onDlChkChange(el) {
    var fid = parseInt(el.getAttribute('data-fid'));
    if (fid) {
      if (el.checked) _selectedIds[fid] = true;
      else delete _selectedIds[fid];
    }
    updateBatchDlBar();
  }

  function batchDownloadSelected() {
    var selected = Object.keys(_selectedIds).map(Number);
    if (!selected.length) { alert('请先选择文件'); return; }
    var btn = document.getElementById('batchDlBtn');
    if (btn) { btn.textContent = '⏳ 下载中 0/' + selected.length; btn.disabled = true; }
    var done = 0;
    selected.reduce(function(promise, fid, idx) {
      return promise.then(function() {
        return new Promise(function(resolve) {
          doDirectDownload(fid);
          done++;
          if (btn) btn.textContent = '⏳ 下载中 ' + done + '/' + selected.length;
          // 每个文件下载间隔 500ms，避免浏览器拦截
          setTimeout(resolve, 500);
        });
      });
    }, Promise.resolve()).then(function() {
      if (btn) { btn.textContent = '⬇ 下载选中'; btn.disabled = false; }
    }).catch(function() {
      if (btn) { btn.textContent = '⬇ 下载选中'; btn.disabled = false; }
    });
  }

  // ── 批量删除（管理模式） ──
  function batchDeleteSelected() {
    var selected = Object.keys(_selectedIds).map(Number);
    if (!selected.length) { alert('请先选择文件'); return; }
    var reason = '';
    // 非本人操作需填理由
    if (!confirm('确定删除选中的 ' + selected.length + ' 个文件？')) return;
    var btn = document.getElementById('batchDeleteBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 处理中…'; }
    api('/api/files/batch-delete/', { method: 'POST', body: { file_ids: selected, reason: reason } }).then(function(result) {
      alert('已删除 ' + (result.deleted || 0) + ' 个文件' + (result.errors && result.errors.length ? '，' + result.errors.length + ' 个失败' : ''));
      // 刷新当前视图
      renderExplorer();
    }).catch(function(err) {
      alert('批量删除失败：' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = '🗑 删除选中'; }
    });
  }

  // ── 批量编辑（管理模式） ──
  function showBatchEditDialog() {
    var selected = Object.keys(_selectedIds).map(Number);
    if (!selected.length) { alert('请先选择文件'); return; }
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay';
    overlay.innerHTML =
      '<div class="admin-reject-dialog" style="max-width:420px">' +
        '<h3>✏️ 批量编辑选中文件</h3>' +
        '<p style="font-size:0.8rem;color:var(--text-muted);margin:4px 0 12px">将统一应用到选中的 ' + selected.length + ' 个文件</p>' +
        '<div style="margin-bottom:10px"><label style="font-size:0.85rem;display:block;margin-bottom:4px">任课教师</label>' +
          '<input type="text" id="batchEditTeacher" placeholder="留空不修改" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.85rem;box-sizing:border-box"></div>' +
        '<div style="margin-bottom:10px"><label style="font-size:0.85rem;display:block;margin-bottom:4px">文件简介</label>' +
          '<textarea id="batchEditDesc" rows="3" placeholder="留空不修改" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.85rem;box-sizing:border-box;resize:vertical"></textarea></div>' +
        '<div style="margin-bottom:10px"><label style="font-size:0.85rem;display:block;margin-bottom:4px">资料类型</label>' +
        '<select id="batchEditType" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.85rem;box-sizing:border-box">' +
        '<option value="">留空不修改</option>' +
        (typeof MATERIAL_TYPES !== 'undefined' ? MATERIAL_TYPES.map(function(t){ return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('') : '') +
        '</select></div>' +
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" onclick="confirmBatchEdit(\'' + selected.join(',') + '\')">确认修改</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
  }

  function confirmBatchEdit(fileIdsStr) {
    var teacher = document.getElementById('batchEditTeacher').value.trim();
    var description = document.getElementById('batchEditDesc').value.trim();
    var batchType = (document.getElementById('batchEditType') || {}).value || '';
    if (!teacher && !description && !batchType) { alert('请至少填写一项修改内容'); return; }
    var body = { file_ids: fileIdsStr.split(',').map(Number) };
    if (teacher) body.teacher = teacher;
    if (description) body.description = description;
    if (batchType) body.material_type_id = parseInt(batchType);
    var overlay = document.querySelector('.admin-reject-overlay');
    api('/api/files/batch-edit/', { method: 'POST', body: body }).then(function(result) {
      _removeOverlay(overlay);
      alert('已更新 ' + (result.updated || 0) + ' 个文件');
      renderExplorer();
    }).catch(function(err) {
      alert('批量编辑失败：' + err.message);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatFileSize(bytes) {
    if (!bytes) return '未知';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  /* ═══════════════════════════════════════════════════════════
     搜索
     ═══════════════════════════════════════════════════════════ */

  function setupSearch() {
    const input = document.querySelector('.search-box input');
    const btn = document.querySelector('.search-box button');
    if (!input) return;
    function go() { const q = input.value.trim(); if (q) searchQuery(q); }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    if (btn) btn.addEventListener('click', go);
  }

  async function searchQuery(q) {
    try {
      const results = await api('/api/search/?q=' + encodeURIComponent(q));
      const overlay = document.createElement('div');
      overlay.className = 'search-overlay';
      let html = '<div class="search-overlay-inner"><button class="search-overlay-close" onclick="this.parentElement.parentElement.remove()">✕</button><h3>搜索「' + esc(q) + '」</h3>';
      if (results.courses.length) {
        html += '<div class="search-section"><h4>课程 ' + results.courses.length + '</h4>';
        results.courses.forEach(c => { html += '<div class="search-item" onclick="this.closest(\'.search-overlay\').remove();showExplorer(\'' + (c.course_type === 'general' ? '通识课' : '专业课') + '\');navToLast(\'' + esc(c.code) + '\')"><span class="si-name">' + esc(c.name) + '</span> <span class="si-code">' + esc(c.code || '') + '</span></div>'; });
        html += '</div>';
      }
      if (results.materials.length) {
        html += '<div class="search-section"><h4>资料 ' + results.materials.length + '</h4>';
        results.materials.forEach(function(m) {
          var badgeHtml = '';
          if (m.review_status && m.review_status !== 'approved') {
            badgeHtml = ' <span class="review-badge review-badge-' + m.review_status + '" style="font-size:0.65rem">' + (m.review_status === 'pending' ? '审核中' : '已驳回') + '</span>';
          }
          html += '<a href="/api/files/' + m.id + '/download/" class="search-item" style="text-decoration:none" onclick="this.closest(\'.search-overlay\').remove()"><span class="si-name">' + esc(m.title) + badgeHtml + '</span> <span class="si-code">' + esc(m.course_name) + '</span></a>';
        });
        html += '</div>';
      }
      if (!results.courses.length && !results.materials.length) html += '<p class="search-empty">没有找到相关结果</p>';
      html += '</div>';
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
    } catch(e) { /* ignore */ }
  }

  /* ═══════════════════════════════════════════════════════════
     统计
     ═══════════════════════════════════════════════════════════ */

  async function loadStats() {
    try {
      const s = await api('/api/stats/');
      document.getElementById('statColleges').textContent = s.college_with_data_count;
      document.getElementById('statGeneral').textContent = s.general_with_data_count;
      document.getElementById('statMajor').textContent = s.major_with_data_count;
      const pills = document.querySelectorAll('.stat-pill');
      if (pills.length >= 3) {
        pills[0].style.cursor = 'pointer';
        pills[0].onclick = function(e) { showExplorer('专业课'); };
        pills[1].style.cursor = 'pointer';
        pills[1].onclick = function(e) { showExplorer('通识课'); };
        pills[2].style.cursor = 'pointer';
        pills[2].onclick = function(e) { showExplorer('专业课'); };
      }
      // 下载最多（左列）
      const topEl = document.getElementById('topDownloadedList');
      if (topEl && s.top_downloaded && s.top_downloaded.length) {
        topEl.innerHTML = s.top_downloaded.map(m =>
          '<a href="#" class="hc-item" onclick="event.preventDefault();highlightFileId=' + m.id + ';returnState={view:\'home\',scrollY:pageYOffset};showExplorer(\'' + (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\');navToLast(\'' + esc(m.course_code) + '\')">' +
            '<div class="hc-item-left"><div class="hc-item-name">' + esc(m.title) + '</div><div class="hc-item-meta">' + esc(m.course_name) + '</div></div>' +
            '<span class="hc-item-count">' + m.download_count + ' 次</span>' +
          '</a>'
        ).join('');
      } else {
        topEl.innerHTML = '<div class="hc-empty">暂无热门资料，做第一个上传者吧！</div>';
      }
      // 最近上传（右列）
      const recentEl = document.getElementById('recentUploadsList');
      if (recentEl && s.recent_uploads && s.recent_uploads.length) {
        recentEl.innerHTML = s.recent_uploads.map(function(m) {
          var badge = '';
          if (m.review_status && m.review_status !== 'approved') {
            badge = '<span class="review-badge review-badge-' + m.review_status + '" style="margin-left:6px;font-size:0.7rem">' + (m.review_status === 'pending' ? '审核中' : '已驳回') + '</span>';
          }
          return '<a href="#" class="hc-item" onclick="event.preventDefault();highlightFileId=' + m.id + ';returnState={view:\'home\',scrollY:pageYOffset};showExplorer(\'' + (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\');navToLast(\'' + esc(m.course_code) + '\')">' +
            '<div class="hc-item-left"><div class="hc-item-name">' + esc(m.title) + badge + '</div><div class="hc-item-meta">' + m.created_at + ' · ' + esc(m.course_name) + '</div></div>' +
            '<span class="hc-item-count">' + esc(m.uploader_name) + '</span>' +
          '</a>';
        }).join('');
      } else {
        recentEl.innerHTML = '<div class="hc-empty">暂无上传记录，快来上传第一份资料！</div>';
      }
    // Iter 7: 首页文件总数
      var totalCountEls = document.querySelectorAll('.total-material-count');
      totalCountEls.forEach(function(el){ el.textContent = s.material_count || 0; });
    } catch(e) {}
  }
