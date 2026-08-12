  // ── Token 缓存 + API 内存缓存 ──
  let _cachedToken = null;
  const _apiCache = {};
  const API_CACHE_TTL = {
    '/api/courses/tree/': 600000,
    '/api/stats/': 120000,
    '/api/colleges/': 300000,
    '/api/search/': 30000,
    '/api/user/rankings/': 30000,
  };

  // 清除 GET 内存缓存中 url 以 prefix 开头的项（上传/删除/审核等变更后调用，
  // 保证课程树 fileCount / 排行榜等数据即时刷新，无需硬刷新）
  function clearApiCache(prefix) {
    if (!prefix) return;
    Object.keys(_apiCache).forEach(function(url) {
      if (url.indexOf(prefix) === 0) delete _apiCache[url];
    });
  }

  async function api(url, opts = {}) {
    // GET 请求内存缓存
    if (!opts.method || opts.method === 'GET') {
      const entry = _apiCache[url];
      if (entry && Date.now() - entry.ts < (entry.ttl || 0)) {
        return entry.data;
      }
    }

    // Token 缓存（避免每次读取 storage）
    if (!_cachedToken) {
      _cachedToken = sessionStorage.getItem('token') || localStorage.getItem('token');
    }
    const headers = { ...opts.headers };
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (_cachedToken) headers['Authorization'] = 'Bearer ' + _cachedToken;
    if (opts.body && !(opts.body instanceof FormData)) opts.body = JSON.stringify(opts.body);

    // 超时控制（默认 10 秒）
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeout || 10000);
    if (!opts.signal) opts.signal = controller.signal;

    let resp;
    try {
      resp = await fetch(url, { ...opts, headers });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('请求超时');
      throw err;
    }
    clearTimeout(timeout);

    let data;
    try {
      data = await resp.json();
    } catch (err) {
      // 非 JSON 响应（Django 500 HTML / nginx 网关页）：给出可读错误，
      // 避免前端暴露 "Unexpected token '<' ... is not valid JSON"
      throw new Error('服务器返回异常（HTTP ' + resp.status + '），请稍后重试');
    }
    if (!data.ok) throw new Error(data.error || '请求失败');

    // 缓存 GET 响应
    if (!opts.method || opts.method === 'GET') {
      _apiCache[url] = {
        data: data.data,
        ts: Date.now(),
        ttl: API_CACHE_TTL[url] || 0,
      };
    }

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

  // ── SPA 干净 URL 路由（v=171）：每个视图对应一个可分享/可刷新/可返回的路径 ──
  // 静态视图名 → 路径；explorer/userPublic/fileDetail 是动态路径，在 routeToPath 里单独处理；
  // drawer 是叠在当前视图上的浮层，不占 URL。
  var VIEW_ROUTES = { home: '/', about: '/about', tutorial: '/tutorial',
    announcements: '/announcements', broad: '/broad', rankings: '/rankings',
    recentAll: '/recent', leaderboard: '/leaderboard', profile: '/profile',
    myuploads: '/uploads', mydownloads: '/downloads', myfavorites: '/favorites',
    admin: '/manage', notif: '/notifications', newCourse: '/new-course', qa: '/qa' };

  // state = { view, expPath, userId, fileId, ... } → 路径字符串；返回 null 表示保持当前 URL
  function routeToPath(view, state) {
    if (view === 'explorer') {
      var p = (state && state.expPath) || [];
      return p.length ? '/explorer/' + p.map(encodeURIComponent).join('/') : '/explorer';
    }
    if (view === 'userPublic') return state && state.userId ? '/user/' + state.userId : null;
    if (view === 'fileDetail') return state && state.fileId ? '/file/' + state.fileId : null;
    if (view === 'drawer') return null;
    return VIEW_ROUTES[view] || null;
  }

  // pathname → { view, expPath?/userId?/fileId? }；不认识的路径返回 null
  function parseRoute(path) {
    if (!path) path = location.pathname;
    if (path === '/') return { view: 'home' };
    var segs = path.split('/').filter(Boolean).map(decodeURIComponent);
    var head = segs[0];
    if (head === 'explorer') return { view: 'explorer', expPath: segs.slice(1) };
    if (head === 'user') {
      var uid = parseInt(segs[1], 10);
      return uid ? { view: 'userPublic', userId: uid } : null;
    }
    if (head === 'file') {
      var fid = parseInt(segs[1], 10);
      return fid ? { view: 'fileDetail', fileId: fid } : null;
    }
    var v = Object.keys(VIEW_ROUTES).find(function(k) { return VIEW_ROUTES[k] === '/' + head; });
    return v ? { view: v } : null;
  }

  // ── 下载处理（含限额梯度提醒） ──
  function handleDownloadClick(fileId, el, event) {
    event.preventDefault();
    event.stopPropagation();

    // 未登录：非单纯浏览操作 → 弹登录弹窗
    if (!currentUser) { showLoginModal(); return; }

    // 限额梯度提醒（limit 从后端实时读；limit<0 表示不限量角色，跳过提醒）
    if (currentUser.daily_download_remaining !== undefined && currentUser.daily_download_limit >= 0) {
      var limit = currentUser.daily_download_limit || 15;
      var used = limit - currentUser.daily_download_remaining;
      if (used >= Math.min(10, limit)) {
        if (!confirm('温馨提醒：今日已下载 ' + used + ' 次，接近当日上限。请考虑一下平台的维护成本，珍惜每一次下载。\n\n点击「确定」继续下载。')) {
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
    if (!token) { showLoginModal(); return; }
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
      // 刷新当前视图（课程树 fileCount 同步更新）
      if (typeof clearUserPublicCache === 'function') clearUserPublicCache();
      if (typeof refreshCourseTree === 'function') refreshCourseTree();
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
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;');
  }

  // JS 字符串字面量转义：用于内联 onclick 属性里单引号包裹的 JS 字符串参数。
  // 注意：HTML 实体转义（&#39;）在 onclick 场景会被浏览器解码回 '，仍可注入
  // （…' + esc(x) + '… → …');alert(1)…），所以此处必须用 JS 反斜杠转义：
  //   '  → \'  （保持 JS 字符串闭合）
  //   \  → \\  （防止攻击者用 \ 抵消我们的转义）
  //   "  → &quot;  （HTML 属性安全，解码为 " 在 JS 单引号串内无害）
  //   &  → &amp;  （同上）
  function escJs(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');
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
    function go() {
      // 问答区视图内：搜索框自动切为帖子搜索（未登录经 2026 门控也可搜）
      if (typeof isQaViewActive === 'function' && isQaViewActive()) {
        const qaQ = input.value.trim();
        if (qaQ && typeof qaSearch === 'function') qaSearch(qaQ);
        return;
      }
      // v=164：未登录回车提交在此拦截（点击搜索框/按钮已由 app.js capture 拦截器兜底）
      if (!currentUser) { showLoginModal(); return; }
      const q = input.value.trim(); if (q) searchQuery(q);
    }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    if (btn) btn.addEventListener('click', go);
  }

  async function searchQuery(q) {
    try {
      const results = await api('/api/search/?q=' + encodeURIComponent(q));
      const overlay = document.createElement('div');
      overlay.className = 'search-overlay';

      /* ---------- 搜索覆层 — 全新设计 ---------- */
      let html = '<div class="search-overlay-inner sg-inner">';

      /* 头部 */
      html += '<div class="sg-header">';
      html += '<button class="sg-close" onclick="this.closest(\'.search-overlay\').remove()" aria-label="关闭">✕</button>';
      html += '<div class="sg-title-row">';
      html += '<span class="sg-title-icon">🔍</span>';
      html += '<h3 class="sg-title">' + esc(q) + '</h3>';
      html += '</div>';
      html += '<p class="sg-subtitle">搜索结果</p>';
      html += '</div>';

      /* 结果区 */
      html += '<div class="sg-body">';

      /* ── 课程结果 ── */
      if (results.courses.length) {
        html += '<div class="sg-section">';
        html += '<div class="sg-section-header">';
        html += '<svg class="sg-section-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="10" x2="14" y2="10"/></svg>';
        html += '<span class="sg-section-label">课程</span>';
        html += '<span class="sg-section-badge">' + results.courses.length + '</span>';
        html += '</div>';
        html += '<div class="sg-section-body">';
        results.courses.forEach(function(c) {
          var typeLabel = c.course_type === 'general' ? '通识' : '专业';
          var typeClass = c.course_type === 'general' ? 'sg-pill-general' : 'sg-pill-major';
          html += '<div class="sg-item" onclick="this.closest(\'.search-overlay\').remove();showExplorer(\'' + (c.course_type === 'general' ? '通识课' : '专业课') + '\');navToLast(\'' + escJs(c.code) + '\')">';
          html += '<div class="sg-item-body">';
          html += '<span class="sg-item-name">' + esc(c.name) + '</span>';
          html += '<span class="sg-item-meta">';
          html += '<span class="sg-pill ' + typeClass + '">' + typeLabel + '</span>';
          html += '<span class="sg-item-code">' + esc(c.code) + '</span>';
          html += '</span>';
          html += '</div>';
          html += '<span class="sg-item-arrow">→</span>';
          html += '</div>';
        });
        html += '</div>';
        html += '</div>';
      }

      /* ── 资料结果 ── */
      if (results.materials.length) {
        html += '<div class="sg-section">';
        html += '<div class="sg-section-header">';
        html += '<svg class="sg-section-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/><polyline points="14 2 14 8 10 5 6 8 6 2"/></svg>';
        html += '<span class="sg-section-label">资料</span>';
        html += '<span class="sg-section-badge">' + results.materials.length + '</span>';
        html += '</div>';
        html += '<div class="sg-section-body">';
        results.materials.forEach(function(m) {
          var badgeHtml = '';
          if (m.review_status && m.review_status !== 'approved') {
            badgeHtml = '<span class="review-badge review-badge-' + m.review_status + '" style="font-size:0.65rem;margin-left:6px">' + (m.review_status === 'pending' ? '审核中' : '已驳回') + '</span>';
          }
          html += '<div class="sg-item sg-item-link" onclick="this.closest(\'.search-overlay\').remove();showFileDetail({id:' + m.id + ',title:\'' + escJs(m.title) + '\',course_code:\'' + escJs(m.course_code) + '\',course_name:\'' + escJs(m.course_name) + '\'})">';
          html += '<div class="sg-item-body">';
          html += '<span class="sg-item-name">' + esc(m.title) + badgeHtml + '</span>';
          html += '<span class="sg-item-meta">';
          html += '<span class="sg-item-code">' + esc(m.course_name) + '</span>';
          html += '</span>';
          html += '</div>';
          html += '<span class="sg-item-arrow">→</span>';
          html += '</div>';
        });
        html += '</div>';
        html += '</div>';
      }

      /* ── 空状态 ── */
      if (!results.courses.length && !results.materials.length) {
        html += '<div class="sg-empty">';
        html += '<div class="sg-empty-icon">🔍</div>';
        html += '<div class="sg-empty-title">未找到相关结果</div>';
        html += '<div class="sg-empty-desc">试试其他关键词，或使用课程代码搜索</div>';
        html += '</div>';
      }

      html += '</div>'; /* /.sg-body */
      html += '</div>'; /* /.search-overlay-inner */

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
          '<a href="#" class="hc-item" onclick="event.preventDefault();highlightFileId=' + m.id + ';returnState={view:\'home\',scrollY:pageYOffset};showExplorer(\'' + (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\');navToLast(\'' + escJs(m.course_code) + '\')">' +
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
          return '<a href="#" class="hc-item" onclick="event.preventDefault();highlightFileId=' + m.id + ';returnState={view:\'home\',scrollY:pageYOffset};showExplorer(\'' + (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\');navToLast(\'' + escJs(m.course_code) + '\')">' +
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

  // ── v160 Phase3 · 共享图标集 ICONS ──
  // 统一 24×24 viewBox、stroke-width 1.6、currentColor；
  // SVG 本身不带 width/height，尺寸交给 CSS（.ico-nav / .login-icon svg / .es-icon svg 等）。
  window.ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/><path d="M8 8h3M8 11h3"/></svg>',
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><rect x="5" y="4" width="6" height="17" rx="1"/><rect x="13" y="4" width="6" height="17" rx="1"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M12 15v5"/><path d="M8.5 21h7"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.5" r="3.5"/><path d="M5 21c1-3.5 4-5 7-5s6 1.5 7 5"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3.5-7z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v11"/><path d="M6 11l6 6 6-6"/><path d="M4 20h16"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V5"/><path d="M6 11l6-6 6 6"/><path d="M4 20h16"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    starFilled: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h7l2 3h9v11H3V5z"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>'
  };
