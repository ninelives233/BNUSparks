// ── Mobile Drawer ──
  const drawer = document.getElementById('mobileDrawer');
  document.getElementById('menuOpen').addEventListener('click', () => drawer.classList.add('open'));
  document.getElementById('menuClose').addEventListener('click', () => drawer.classList.remove('open'));
  drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.classList.remove('open'); });

  // ── Header scroll shadow ──
  const header = document.getElementById('siteHeader');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        header.classList.toggle('scrolled', window.scrollY > 10);
        ticking = false;
      });
      ticking = true;
    }
  });

  /* ═══════════════════════════════════════════════════════════
     API 工具
     ═══════════════════════════════════════════════════════════ */

  async function api(url, opts = {}) {
    const token = localStorage.getItem('token');
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

  /* ═══════════════════════════════════════════════════════════
     用户认证
     ═══════════════════════════════════════════════════════════ */

  let currentUser = null;

  function updateAuthUI() {
    const container = document.getElementById('headerLogin');
    if (!container) return;
    if (currentUser) {
      const roleLabel = currentUser.role === 'super_admin' ? ' 总管理' : currentUser.role === 'moderator' ? ' 版主' : '';
      container.innerHTML =
        '<div class="user-dropdown-wrap">' +
          '<button class="user-dropdown-trigger" id="userDdTrigger" onclick="toggleUserDropdown(event)">' +
            '<span class="notif-bell" onclick="event.stopPropagation();toggleNotifDrawer()">🔔<span class="notif-badge" id="notifBadge" style="display:none">0</span></span>' +
            '<span class="user-name">' + esc(currentUser.nickname || currentUser.username) + '</span>' +
            '<span class="dd-arrow">▾</span>' +
          '</button>' +
          '<div class="user-dropdown-menu" id="userDropdown">' +
            '<a href="#" onclick="showProfile();closeUserDropdown()"><span>👤</span> 个人中心</a>' +
            '<a href="#" onclick="toggleNotifDrawer();closeUserDropdown()"><span>🔔</span> 通知中心<span class="notif-badge-dot" id="notifDot" style="display:none"></span></a>' +
            '<div class="dd-divider"></div>' +
            '<a href="#" onclick="showAdminPanel();closeUserDropdown()" id="adminEntry" style="display:' + (currentUser.role !== 'user' ? 'flex' : 'none') + '"><span>⚙️</span> 管理后台</a>' +
            '<div class="dd-divider"></div>' +
            '<a href="#" onclick="logout();closeUserDropdown()"><span>🚪</span> 退出登录</a>' +
          '</div>' +
        '</div>';
    } else {
      container.innerHTML =
        '<a href="#" class="login-btn" onclick="event.preventDefault();showLoginModal()">' +
          '<span class="login-icon gi gi-login"></span><span class="login-text">登录</span>' +
        '</a>';
    }
  }

  function toggleUserDropdown(e) {
    e && e.stopPropagation();
    const menu = document.getElementById('userDropdown');
    const trigger = document.getElementById('userDdTrigger');
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    closeUserDropdown();
    if (!isOpen) {
      menu.classList.add('open');
      trigger.classList.add('open');
    }
  }

  function closeUserDropdown() {
    document.querySelectorAll('.user-dropdown-menu').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.user-dropdown-trigger').forEach(t => t.classList.remove('open'));
  }

  // 点击页面其他地方关闭下拉菜单
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.user-dropdown-wrap')) closeUserDropdown();
  });

  function togglePwdVisibility(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    if (inp.type === 'password') {
      inp.type = 'text';
      btn.textContent = '🙈';
    } else {
      inp.type = 'password';
      btn.textContent = '👁️';
    }
  }

  function showLoginModal() { document.getElementById('loginModal').style.display = 'flex'; }
  function showRegister() { document.getElementById('loginModal').style.display = 'none'; document.getElementById('registerModal').style.display = 'flex'; }
  function showLogin() { document.getElementById('registerModal').style.display = 'none'; document.getElementById('loginModal').style.display = 'flex'; }
  function closeAuthModal() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('registerModal').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('registerError').style.display = 'none';
    document.getElementById('registerSuccess').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.querySelector('#registerModal .modal-close').style.display = '';
    document.querySelector('#registerModal .modal-card').style.pointerEvents = '';
  }

  function copyGeneratedPassword() {
    const pwd = document.getElementById('generatedPassword').textContent;
    navigator.clipboard.writeText(pwd).then(() => {
      const btn = document.querySelector('.ms-copy-btn');
      btn.textContent = '✅ 已复制';
      setTimeout(() => { btn.textContent = '📋 复制密码'; }, 2000);
    }).catch(() => {
      // fallback
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('generatedPassword'));
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
    });
  }

  function togglePwdSaveBtn() {
    const checked = document.getElementById('pwdSaveCheck').checked;
    document.getElementById('pwdConfirmBtn').disabled = !checked;
  }

  async function handleLogin(e) {
    e.preventDefault();
    const el = document.getElementById('loginError');
    try {
      const data = await api('/api/auth/login/', { method: 'POST',
        body: { username: document.getElementById('loginUsername').value, password: document.getElementById('loginPassword').value } });
      localStorage.setItem('token', data.token);
      currentUser = data.user;
      closeAuthModal(); updateAuthUI();
    } catch (err) { el.textContent = err.message; el.style.display = 'block'; }
    return false;
  }

  // ── 忘记密码 ──
  function showForgotPassword() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('forgotPwdModal').style.display = 'flex';
    document.getElementById('forgotPwdForm').style.display = 'block';
    document.getElementById('forgotPwdSuccess').style.display = 'none';
    document.getElementById('forgotPwdError').style.display = 'none';
  }

  function closeForgotPwdModal() {
    document.getElementById('forgotPwdModal').style.display = 'none';
    document.getElementById('forgotPwdForm').style.display = 'block';
    document.getElementById('forgotPwdSuccess').style.display = 'none';
    document.getElementById('forgotPwdError').style.display = 'none';
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    const el = document.getElementById('forgotPwdError');
    const success = document.getElementById('forgotPwdSuccess');
    const form = document.getElementById('forgotPwdForm');
    try {
      const data = await api('/api/auth/forgot-password/', { method: 'POST',
        body: { email: document.getElementById('forgotEmail').value.trim() } });
      document.getElementById('forgotPwdMsg').textContent = data.message;
      el.style.display = 'none';
      form.style.display = 'none';
      success.style.display = 'block';
    } catch (err) { el.textContent = err.message; el.style.display = 'block'; }
    return false;
  }

  // ── 重置密码 ──
  let _resetUid = null, _resetToken = null;

  function showResetPassword(uid, token) {
    _resetUid = uid;
    _resetToken = token;
    document.getElementById('forgotPwdModal').style.display = 'none';
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('resetPwdModal').style.display = 'flex';
    document.getElementById('resetPwdForm').style.display = 'block';
    document.getElementById('resetPwdSuccess').style.display = 'none';
    document.getElementById('resetPwdError').style.display = 'none';
    document.getElementById('resetNewPwd').value = '';
    document.getElementById('resetConfirmPwd').value = '';
  }

  function closeResetPwdModal() {
    document.getElementById('resetPwdModal').style.display = 'none';
    document.getElementById('resetPwdForm').style.display = 'block';
    document.getElementById('resetPwdSuccess').style.display = 'none';
    document.getElementById('resetPwdError').style.display = 'none';
    _resetUid = null; _resetToken = null;
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    const el = document.getElementById('resetPwdError');
    const success = document.getElementById('resetPwdSuccess');
    const form = document.getElementById('resetPwdForm');
    const newPwd = document.getElementById('resetNewPwd').value;
    const confirmPwd = document.getElementById('resetConfirmPwd').value;

    if (newPwd !== confirmPwd) {
      el.textContent = '两次输入的密码不一致';
      el.style.display = 'block';
      return false;
    }
    if (newPwd.length < 8) {
      el.textContent = '密码长度至少 8 位';
      el.style.display = 'block';
      return false;
    }

    try {
      const data = await api('/api/auth/reset-password/', { method: 'POST',
        body: { uid: _resetUid, token: _resetToken, new_password: newPwd } });
      el.style.display = 'none';
      form.style.display = 'none';
      success.style.display = 'block';
      // 清理 URL 参数
      const url = new URL(window.location);
      url.searchParams.delete('uid');
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url);
    } catch (err) { el.textContent = err.message; el.style.display = 'block'; }
    return false;
  }

  // 页面加载时检测 URL 参数 (reset-password 链接)
  (function checkResetParams() {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get('uid');
    const token = params.get('token');
    if (uid && token) {
      // 等 DOM 加载完毕再显示
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          setTimeout(function() { showResetPassword(uid, token); }, 100);
        });
      } else {
        setTimeout(function() { showResetPassword(uid, token); }, 100);
      }
    }
  })();

  async function handleRegister(e) {
    e.preventDefault();
    const el = document.getElementById('registerError');
    const form = document.getElementById('registerForm');
    const success = document.getElementById('registerSuccess');
    const closeBtn = document.querySelector('#registerModal .modal-close');
    try {
      const data = await api('/api/auth/register/', { method: 'POST',
        body: { email: document.getElementById('regEmail').value.trim(),
                nickname: document.getElementById('regNickname').value.trim() } });
      localStorage.setItem('token', data.token);
      currentUser = data.user;
      document.getElementById('generatedPassword').textContent = data.generated_password;
      // 重置保存确认状态
      document.getElementById('pwdSaveCheck').checked = false;
      document.getElementById('pwdConfirmBtn').disabled = true;
      el.style.display = 'none';
      form.style.display = 'none';
      success.style.display = 'block';
      // 禁用关闭按钮和外部点击
      closeBtn.style.display = 'none';
      document.querySelector('#registerModal .modal-card').style.pointerEvents = 'none';
      document.querySelector('#registerModal .modal-card .mf-success').style.pointerEvents = 'auto';
    } catch (err) { el.textContent = err.message; el.style.display = 'block'; success.style.display = 'none'; }
    return false;
  }

  function logout() { localStorage.removeItem('token'); currentUser = null; location.reload(); }

  async function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      currentUser = await api('/api/auth/me/');
      updateAuthUI();
      // 异步加载未读通知数
      loadNotifCount();
    }
    catch { localStorage.removeItem('token'); }
  }

  async function loadNotifCount() {
    try {
      const data = await api('/api/auth/notifications/?unread_only=1');
      const badge = document.getElementById('notifBadge');
      const dot = document.getElementById('notifDot');
      if (data.unread_count > 0) {
        badge.textContent = data.unread_count > 99 ? '99+' : data.unread_count;
        badge.style.display = '';
        if (dot) dot.style.display = '';
      }
    } catch(e) { /* ignore */ }
  }

  // ── 个人资料 ──
  function showProfile() {
    // 关闭所有视图
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.classList.remove('active');
    });
    // 显示个人资料
    var pv = document.getElementById('profileView');
    if (pv) pv.classList.add('active');
    updateSidebar(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    pushViewState('profile', {});
    // 加载数据
    loadProfile();
  }

  async function loadProfile() {
    const emailEl = document.getElementById('profileEmail');
    const nickEl = document.getElementById('profileNickname');
    const roleEl = document.getElementById('profileRole');
    const joinedEl = document.getElementById('profileJoined');
    const quotaEl = document.getElementById('profileQuota');
    const avatarEl = document.getElementById('profileAvatar');
    if (!emailEl) return;
    try {
      const data = await api('/api/auth/profile/');
      emailEl.textContent = data.email;
      nickEl.textContent = data.nickname;
      roleEl.textContent = data.role_label;
      joinedEl.textContent = data.date_joined;
      avatarEl.textContent = data.nickname.charAt(0) || '🧑';
      quotaEl.textContent = data.daily_download_remaining < 0 ? '不限' : data.daily_download_remaining + ' / 60 次';
    } catch (err) {
      emailEl.textContent = '加载失败';
    }
  }

  function editNickname() {
    const input = document.getElementById('nicknameInput');
    const current = document.getElementById('profileNickname').textContent;
    if (input) input.value = current;
    document.getElementById('nicknameEditor').style.display = 'flex';
    document.getElementById('nicknameError').style.display = 'none';
    if (input) input.focus();
  }

  function cancelEditNickname() {
    document.getElementById('nicknameEditor').style.display = 'none';
  }

  async function saveNickname() {
    const input = document.getElementById('nicknameInput');
    const name = input.value.trim();
    const errEl = document.getElementById('nicknameError');
    if (!name) { errEl.textContent = '昵称不能为空'; errEl.style.display = 'block'; return; }
    if (name.length > 50) { errEl.textContent = '昵称不能超过 50 字'; errEl.style.display = 'block'; return; }
    try {
      const data = await api('/api/auth/profile/', { method: 'PATCH', body: { nickname: name } });
      document.getElementById('profileNickname').textContent = data.nickname;
      document.getElementById('profileAvatar').textContent = data.nickname.charAt(0) || '🧑';
      cancelEditNickname();
      // 更新全局 currentUser 和头部显示
      if (currentUser) { currentUser.nickname = data.nickname; }
      updateAuthUI();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }

  function showChangePwdOverlay() {
    document.getElementById('changePwdEditor').style.display = 'flex';
    document.getElementById('changePwdError').style.display = 'none';
    document.getElementById('changePwdSuccess').style.display = 'none';
    document.getElementById('cpOldPwd').value = '';
    document.getElementById('cpNewPwd').value = '';
    document.getElementById('cpConfirmPwd').value = '';
  }

  function closeChangePwdOverlay() {
    document.getElementById('changePwdEditor').style.display = 'none';
  }

  async function saveChangePwd() {
    const errEl = document.getElementById('changePwdError');
    const successEl = document.getElementById('changePwdSuccess');
    const oldPwd = document.getElementById('cpOldPwd').value;
    const newPwd = document.getElementById('cpNewPwd').value;
    const confirmPwd = document.getElementById('cpConfirmPwd').value;

    if (!oldPwd) { errEl.textContent = '请输入当前密码'; errEl.style.display = 'block'; return; }
    if (newPwd.length < 6) { errEl.textContent = '新密码长度至少 6 位'; errEl.style.display = 'block'; return; }
    if (newPwd !== confirmPwd) { errEl.textContent = '两次输入的新密码不一致'; errEl.style.display = 'block'; return; }

    try {
      await api('/api/auth/change-password/', { method: 'POST', body: { old_password: oldPwd, new_password: newPwd } });
      errEl.style.display = 'none';
      successEl.style.display = 'block';
      setTimeout(function() { closeChangePwdOverlay(); }, 1500);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }

  // ── 通知抽屉 ──
  let _notifLoaded = false;

  function toggleNotifDrawer() {
    const drawer = document.getElementById('notifDrawer');
    if (drawer.style.display === 'flex') {
      closeNotifDrawer();
    } else {
      drawer.style.display = 'flex';
      if (!_notifLoaded) { loadNotifications(); _notifLoaded = true; }
    }
  }

  function closeNotifDrawer(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('notifDrawer').style.display = 'none';
  }

  async function loadNotifications() {
    const list = document.getElementById('notifList');
    const badge = document.getElementById('notifBadge');
    const dot = document.getElementById('notifDot');
    try {
      const data = await api('/api/auth/notifications/');
      // 更新未读标记
      if (data.unread_count > 0) {
        badge.textContent = data.unread_count > 99 ? '99+' : data.unread_count;
        badge.style.display = '';
        if (dot) dot.style.display = '';
      } else {
        badge.style.display = 'none';
        if (dot) dot.style.display = 'none';
      }

      if (!data.list || !data.list.length) {
        list.innerHTML = '<p class="notif-empty">暂无通知</p>';
        return;
      }
      list.innerHTML = data.list.map(function(n) {
        var unreadClass = n.is_read ? 'notif-item-read' : 'notif-item-unread';
        return '<div class="notif-item ' + unreadClass + '" onclick="markOneNotifRead(' + n.id + ',this)" data-nid="' + n.id + '">' +
          '<div class="notif-item-dot"></div>' +
          '<div class="notif-item-content">' +
            '<div class="notif-item-title">' + esc(n.title) + '</div>' +
            (n.message ? '<div class="notif-item-msg">' + esc(n.message) + '</div>' : '') +
          '</div>' +
          '<div class="notif-item-time">' + esc(n.created_at) + '</div>' +
        '</div>';
      }).join('');
    } catch (err) {
      list.innerHTML = '<p class="notif-empty">加载失败</p>';
    }
  }

  async function markOneNotifRead(nid, el) {
    try {
      await api('/api/auth/notifications/' + nid + '/read/', { method: 'POST' });
      if (el) {
        el.classList.remove('notif-item-unread');
        el.classList.add('notif-item-read');
      }
      // 更新未读计数
      await loadNotifications();
    } catch (err) { /* ignore */ }
  }

  async function markAllNotifRead() {
    try {
      await api('/api/auth/notifications/', { method: 'POST' });
      document.querySelectorAll('.notif-item-unread').forEach(function(el) {
        el.classList.remove('notif-item-unread');
        el.classList.add('notif-item-read');
      });
      document.getElementById('notifBadge').style.display = 'none';
      if (document.getElementById('notifDot')) document.getElementById('notifDot').style.display = 'none';
    } catch (err) { /* ignore */ }
  }

  // ── 占位：管理后台（Iter 3） ──
  function showAdminPanel() { alert('管理后台功能正在开发中'); }

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
            '<span class="hc-item-count">' + esc(m.uploader) + '</span>' +
          '</a>';
        }).join('');
      } else {
        recentEl.innerHTML = '<div class="hc-empty">暂无上传记录，快来上传第一份资料！</div>';
      }
    } catch(e) {}
  }

  // 递归搜索整棵树，找到 courseId 对应的路径
  function findPathByCourseId(code) {
    function walk(nodes, path) {
      for (const n of nodes) {
        if (n.courseId === code) return [...path, n.name];
        if (n.children) {
          const found = walk(n.children, [...path, n.name]);
          if (found) return found;
        }
      }
      return null;
    }
    for (const [key, val] of Object.entries(courseTree || {})) {
      if (val.children) {
        const found = walk(val.children, [key]);
        if (found) return found;
      }
    }
    return null;
  }

  function navToLast(code) {
    const path = findPathByCourseId(code);
    if (!path) return;
    expPath = path;
    pushViewState('explorer', { expPath: [...expPath] }, true);
    renderExplorer();
  }

  /* ═══════════════════════════════════════════════════════════
     API：课程文件
     ═══════════════════════════════════════════════════════════ */

  async function getFiles(courseCode) {
    try { return await api('/api/courses/' + encodeURIComponent(courseCode) + '/files/'); }
    catch { return []; }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await loadCourseTree();
    buildSameNameMap();
    checkAuth(); setupSearch(); loadStats(); loadCourseFileCounts();
    // 尝试从 sessionStorage 恢复刷新前的视图
    try {
      var saved = JSON.parse(sessionStorage.getItem('bnusparks_view'));
      if (saved && saved._bnusparks) {
        _suppressingPushState = true;
        // 替换当前历史状态（不新增条目）
        history.replaceState(saved, '');
        switch (saved.view) {
          case 'home': showHome(saved.scrollY); break;
          case 'explorer':
            expPath = saved.expPath || ['专业课'];
            renderExplorer();
            switchView('explorer', true);
            updateSidebar(expPath[0] === '通识课' ? 'general' : 'major');
            if (saved.scrollY) requestAnimationFrame(function(){ window.scrollTo({top: saved.scrollY}); });
            break;
          case 'rankings': showTopDownloaded(saved.scrollY); break;
          case 'recentAll': showRecentAll(saved.scrollY); break;
          case 'profile': showProfile(); break;
          case 'about': showAbout(saved.aboutSection || 'introduction'); break;
          default: showHome();
        }
        _suppressingPushState = false;
        return;
      }
    } catch(e) {}
    // 默认首页
    showHome();
  });
  /* ═══════════════════════════════════════════════════════════
     上传 / 模态框
     ═══════════════════════════════════════════════════════════ */

  let uploadCourseCode = '';

  function showUploadModal(code, name) {
    if (!currentUser) { showLoginModal(); return; }
    uploadCourseCode = code;
    document.getElementById('uploadCourse').value = name + ' (' + code + ')';
    document.getElementById('uploadModal').style.display = 'flex';
  }

  function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('uploadForm').reset();
    document.getElementById('uploadError').style.display = 'none';
    document.getElementById('uploadProgress').style.display = 'none';
  }

  async function handleUpload(e) {
    e.preventDefault();
    const el = document.getElementById('uploadError');
    const progress = document.getElementById('uploadProgress');
    const fill = document.getElementById('uploadProgressFill');
    const text = document.getElementById('uploadProgressText');

    const file = document.getElementById('uploadFile').files[0];
    if (!file) { el.textContent = '请选择文件'; el.style.display = 'block'; return false; }
    if (file.size > 50 * 1024 * 1024) { el.textContent = '文件大小不能超过 50MB'; el.style.display = 'block'; return false; }

    el.style.display = 'none';
    progress.style.display = 'flex';
    fill.style.width = '10%';
    text.textContent = '上传中...';

    try {
      const formData = new FormData();
      formData.append('course_code', uploadCourseCode);
      formData.append('title', document.getElementById('uploadTitle').value);
      formData.append('file', file);
      formData.append('description', document.getElementById('uploadDesc').value);
      formData.append('teacher', document.getElementById('uploadTeacher').value);

      const token = localStorage.getItem('token');
      const resp = await fetch('/api/files/upload/', {
        method: 'POST',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        body: formData,
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || '上传失败');

      fill.style.width = '100%';
      text.textContent = '上传成功！';
      setTimeout(() => { closeUploadModal(); renderExplorer(); }, 1000);
    } catch (err) {
      el.textContent = err.message;
      el.style.display = 'block';
      progress.style.display = 'none';
    }
    return false;
  }


  /* ═══════════════════════════════════════════════════════════
     EXPLORER — 课程浏览器（文件管理器风格）
     ═══════════════════════════════════════════════════════════ */

  // 课程导航树现在由后端 API /api/courses/tree 提供
  // ── Card SVG Icons ─────────────────────────
  const CARD_ICONS = {
    'folder': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h7l2 3h9v11H3V5z"/></svg>',
    'book': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/><path d="M8 8h3M8 11h3"/></svg>',
    'runner': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="8" width="6" height="8" rx="1.5"/><rect x="4" y="5" width="5" height="14" rx="2"/><rect x="15" y="5" width="5" height="14" rx="2"/></svg>',
    'shield': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l7-3 7 3v6c0 5-4 8-7 10-3-2-7-5-7-10V5z"/><line x1="12" y1="8" x2="12" y2="13"/></svg>',
    'globe': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3" y1="12" x2="21" y2="12"/></svg>',
    'board': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14v9H5z"/><path d="M5 8l7-3 7 3"/><path d="M16 17l2 4"/><path d="M8 17l-2 4"/><line x1="8" y1="11" x2="11" y2="11"/><line x1="8" y1="14" x2="13" y2="14"/></svg>',
    'star': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    'diamond': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,3 21,12 12,21 3,12" opacity="0.3"/><polygon points="12,7 17,12 12,17 7,12"/></svg>',
    'graph': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16"/><path d="M8 20v-6h4v6M14 20v-9h4v9"/></svg>',
    'hands': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h18"/><path d="M5 13V5h14v8"/><path d="M9 13v4h6v-4"/><rect x="10" y="9" width="4" height="4" rx="1"/></svg>',
    'scroll': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3h8V3M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 9h8M8 13h5"/></svg>',
    'columns': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="3" rx="0.5"/><rect x="3" y="10" width="18" height="1.5" rx="0.3"/><rect x="5.5" y="11.5" width="3" height="7.5" rx="0.3"/><rect x="10.5" y="11.5" width="3" height="7.5" rx="0.3"/><rect x="15.5" y="11.5" width="3" height="7.5" rx="0.3"/><rect x="3" y="19" width="18" height="2" rx="0.3"/><rect x="2" y="21" width="20" height="2" rx="0.3"/></svg>',
    'scales': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="9"/><line x1="4" y1="9" x2="20" y2="9"/><path d="M4 9L1 17"/><path d="M20 9l3 8"/><path d="M-1 17C-1 20 3 20 3 17"/><path d="M21 17c0 3 4 3 4 0"/></svg>',
  };

  // ── State ──
  let expPath = [];
  let courseFileCounts = {};
  let courseTree = null;  // 从 API 动态加载
  let highlightFileId = null;  // 从排行榜/最近上传跳转时高亮目标文件
  var returnState = null;      // { view:'home'|'rankings'|'recentAll', scrollY } 供"返回"按钮使用

  // ── 浏览器历史导航 ──
  let _suppressingPushState = false;

  function pushViewState(view, extra, replace) {
    if (_suppressingPushState) return;
    const state = { _bnusparks: true, view, scrollY: window.scrollY, ...extra };
    if (replace) {
      history.replaceState(state, '');
    } else {
      history.pushState(state, '');
    }
    // 同时写入 sessionStorage，刷新后可恢复
    try { sessionStorage.setItem('bnusparks_view', JSON.stringify(state)); } catch(e) {}
  }

  // ── 从后端加载课程导航树 ──
  async function loadCourseTree() {
    try {
      courseTree = await api('/api/courses/tree/');
    } catch(e) {
      console.warn('课程树加载失败，使用备用空树', e);
      courseTree = {};
    }
  }

  async function loadCourseFileCounts() {
    try {
      const courses = await api('/api/courses/');
      courses.forEach(c => { courseFileCounts[c.code] = c.material_count; });
    } catch(e) { /* ignore */ }
  }

  // ── 同名课程映射 ──
  let sameNameMap = {};

  // 手动补充已知的同名课程
  // 如果你知道某门课在不同专业有不同代码，在这里加上：
  // sameNameExtra["课程名"] = [ { courseId, program, type }, ... ]
  const sameNameExtra = {
  };

  async function buildSameNameMap() {
    const items = [];

    // 遍历课程树，搜集 { name, courseId, type, program }
    // walk 从 val.children 开始：
    //   通识课 depth=0 = 分类（思想政治理论类）
    //   专业课 depth=0 = 学院（经管学院），depth=1 = 专业（金融学）
    function walk(nodes, topType, depth, program) {
      for (const n of nodes) {
        // 叶子：有 courseId 的课程
        if (n.name && n.courseId && !n.courseId.includes('*')) {
          items.push({ name: n.name, courseId: n.courseId, type: topType, program: program || '' });
        }
        // 有子节点且不是数学类 → 继续遍历
        if (n.children && !n.mathCard) {
          let nextProgram = program;
          // 通识课：分类节点在 depth=0
          if (depth === 0 && topType === '通识课' && n.name) {
            nextProgram = n.name;
          // 专业课：专业节点在 depth=1（depth=0 是学院）
          } else if (depth === 1 && topType === '专业课' && n.name) {
            nextProgram = n.name;
          }
          walk(n.children, topType, depth + 1, nextProgram);
        }
      }
    }

    for (const [key, val] of Object.entries(courseTree || {})) {
      const t = key === '通识课' ? '通识课' : '专业课';
      walk(val.children || [], t, 0, '');
    }

    // 补充手动配置
    for (const [name, extras] of Object.entries(sameNameExtra)) {
      extras.forEach(e => {
        if (!items.some(i => i.courseId === e.courseId)) {
          items.push({ name, courseId: e.courseId, type: e.type, program: e.program || '' });
        }
      });
    }

    // 分组 + 去重：同名 >1 不同代码 的保留
    const finalize = (itemList) => {
      const groups = {};
      itemList.forEach(item => {
        if (!groups[item.name]) groups[item.name] = [];
        groups[item.name].push(item);
      });
      const map = {};
      for (const [name, list] of Object.entries(groups)) {
        // 去重（同一课程代码可能出现多次）
        const seen = new Set();
        const deduped = list.filter(i => !seen.has(i.courseId) && seen.add(i.courseId));
        if (deduped.length > 1) {
          deduped.sort((a, b) => a.courseId.localeCompare(b.courseId));
          map[name] = deduped;
        }
      }
      return map;
    };

    sameNameMap = finalize(items);

    // 从数据库补充
    try {
      const courses = await api('/api/courses/');
      courses.forEach(c => {
        if (!items.some(i => i.courseId === c.code)) {
          items.push({
            name: c.name, courseId: c.code,
            type: c.course_type === 'general' ? '通识课' : '专业课',
            program: c.college || '',
          });
        }
      });
      sameNameMap = finalize(items);
    } catch(e) { /* ignore */ }
  }

  function extBadge(fileName) {
    if (!fileName) return '';
    const ext = fileName.split('.').pop().toLowerCase();
    const label = {pdf:'PDF', ppt:'PPT', pptx:'PPT', doc:'DOC', docx:'DOC', xls:'XLS', xlsx:'XLS',
                   jpg:'IMG', jpeg:'IMG', png:'IMG', gif:'IMG', webp:'IMG', md:'MD', txt:'TXT',
                   zip:'ZIP', rar:'RAR', py:'PY', js:'JS', html:'HTML', css:'CSS'}[ext] || ext.toUpperCase().slice(0,4);
    return '<span class="ext-badge">' + esc(label) + '</span>';
  }

  function getNode(path) {
    if (!path.length || !courseTree) return null;
    let node = courseTree[path[0]];
    if (!node) return null;
    for (let i = 1; i < path.length; i++) {
      if (!node.children) return null;
      node = node.children.find(c => c.name === path[i]);
      if (!node) return null;
    }
    return node;
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ── Navigation ──
  function navTo(depth) { expPath = expPath.slice(0, depth); pushViewState('explorer', { expPath: [...expPath] }); renderExplorer(); }
  function navIn(name) {
    const node = getNode(expPath);
    if (!node || !node.children) return;
    const child = node.children.find(c => c.name === name);
    if (!child) return;
    expPath.push(name);
    pushViewState('explorer', { expPath: [...expPath] });
    renderExplorer();
  }

  // ── Breadcrumb ──
  function renderBC() {
    const el = document.getElementById('breadcrumb');
    el.innerHTML = '';
    const home = document.createElement('a');
    home.textContent = '首页'; home.onclick = showHome;
    el.appendChild(home);
    for (let i = 0; i < expPath.length; i++) {
      const sep = document.createElement('span');
      sep.className = 'bc-sep'; sep.textContent = ' / ';
      el.appendChild(sep);
      if (i === expPath.length - 1) {
        const cur = document.createElement('span');
        cur.className = 'bc-current'; cur.textContent = expPath[i];
        el.appendChild(cur);
      } else {
        const a = document.createElement('a');
        a.textContent = expPath[i]; a.onclick = () => navTo(i + 1);
        el.appendChild(a);
      }
    }
  }

  // ── Renderers ──
  function renderGrid(items) {
    const parent = document.getElementById('explorerContent');
    const mathItem = items.find(i => i.mathCard);
    const regularItems = items.filter(i => !i.divider && !i.mathCard);
    let html = '';

    html += '<div class="folder-grid">' +
      regularItems.map(item =>
        '<div class="folder-card" data-n="' + esc(item.name) + '">' +
          '<div class="fc-icon">' + (CARD_ICONS[item.iconClass] || CARD_ICONS['folder']) + '</div>' +
          '<div class="fc-name">' + esc(item.name) + '</div>' +
          '<div class="fc-count">' + (item.children ? item.children.length + ' 项' : '') + '</div>' +
        '</div>'
      ).join('') +
    '</div>';

    // Divider before math section
    if (mathItem) {
      html += '<div class="grid-divider-wrap"><hr class="grid-divider"></div>';
      html += '<div class="folder-grid">' +
        '<div class="folder-card" data-n="数学类">' +
          '<div class="fc-icon">' + (CARD_ICONS[mathItem.iconClass] || CARD_ICONS['folder']) + '</div>' +
          '<div class="fc-name">数学类</div>' +
          '<div class="fc-count">' + mathItem.children.length + ' 项</div>' +
        '</div>' +
      '</div>';
    }

    parent.innerHTML = html;
    parent.querySelectorAll('.folder-card').forEach(el => {
      el.addEventListener('click', () => navIn(el.dataset.n));
    });
  }

  function renderList(items) {
    const parent = document.getElementById('explorerContent');
    let html = '<div class="folder-list">';
    items.forEach(item => { html += listHtml(item); });
    html += '</div>';
    parent.innerHTML = html;
    parent.querySelectorAll('.folder-list-item').forEach(el => {
      el.addEventListener('click', () => navIn(el.dataset.n));
    });
  }

  function listHtml(item) {
    const hasSub = !!(item.children && item.children.length);
    const cId = item.courseId;
    const fCount = cId && courseFileCounts[cId] !== undefined ? courseFileCounts[cId] : null;
    let badge = '';
    if (cId) {
      badge = fCount > 0
        ? '<span class="fli-badge has-data">' + fCount + ' 个文件</span>'
        : '<span class="fli-badge no-data">暂无资料</span>';
    } else if (hasSub) {
      badge = '<span class="fli-badge has-data">' + item.children.length + ' 项</span>';
    }
    const meta = cId ? '课程代码 ' + cId : (hasSub ? item.children.length + ' 项' : '');
    return '<div class="folder-list-item" data-n="' + esc(item.name) + '">' +
      '<span class="fli-icon">' + (hasSub ? '▸' : '·') + '</span>' +
      '<div class="fli-info"><div class="fli-name">' + esc(item.name) + '</div><div class="fli-meta">' + meta + '</div></div>' +
      badge + '</div>';
  }

  function renderFiles(course) {
    const code = course.courseId;
    const container = document.getElementById('explorerContent');

    // 通配符课程代码（如 GEN02***）只显示提示
    if (code && code.includes('*')) {
      container.innerHTML =
        '<div class="file-area">' +
          '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + '</h3></div>' +
          '<div class="empty-state"><div class="es-text">该课程由多个模块组成</div><div class="es-sub">请在上层分类中查看具体课程</div></div>' +
        '</div>';
      return;
    }

    // 查找同名课程
    const sameNameEntries = sameNameMap[course.name] || [];
    const sameNameOthers = sameNameEntries.filter(e => e.courseId !== code);
    // 按 courseId 分组，合并同一代码的不同专业名
    const sameNameGroups = {};
    sameNameOthers.forEach(e => {
      if (!sameNameGroups[e.courseId]) {
        sameNameGroups[e.courseId] = { courseId: e.courseId, programs: [], type: e.type };
      }
      if (e.program && !sameNameGroups[e.courseId].programs.includes(e.program)) {
        sameNameGroups[e.courseId].programs.push(e.program);
      }
    });

    container.innerHTML =
      '<div class="file-area-row">' +
        '<div class="file-area-main">' +
          (returnState ? '<div class="fa-back-bar"><a href="#" onclick="returnToPreviousView();return false">← 返回' + (returnState.view === 'rankings' ? '排行榜' : returnState.view === 'home' ? '首页' : '最近上传') + '</a></div>' : '') +
          '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + ' — 资料列表</h3><span class="fa-count" id="fileCount">加载中...</span><span class="fa-per-page" id="perPageControl"></span>' + (code ? '<div class="fa-upload-header-btn"><button class="fa-upload-btn" onclick="showUploadModal(\'" + esc(code) + "\',\'" + esc(course.name) + "\')">+ 上传资料</button></div>' : '') + '</div>' +
          '<div class="file-table-scroll"><table class="file-table"><thead><tr><th>文件名</th><th>类型</th><th>大小</th><th>上传者</th><th>任课教师</th><th>下载次数</th><th>下载</th></tr></thead><tbody id="fileTableBody">' +
          '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint);padding:40px">加载中...</td></tr>' +
          '</tbody></table></div>' +
        '</div>' +
        (Object.keys(sameNameGroups).length ? '<div class="file-area-side"><div class="fas-title">同名课程</div>' +
          Object.values(sameNameGroups).map(g =>
            '<div class="fas-item" onclick="showExplorer(\'' + g.type + '\');setTimeout(function(){navToLast(\'' + esc(g.courseId) + '\')},60)">' +
              '<div class="fas-code">' + esc(g.courseId) + '</div>' +
              '<div class="fas-course">' + esc(course.name) + '</div>' +
            '</div>'
          ).join('') +
        '</div>' : '') +
      '</div>';

    if (!code) return;

    getFiles(code).then(allFiles => {
      const totalFiles = allFiles.length;
      document.getElementById('fileCount').textContent = totalFiles + ' 个文件';

      // 初始化每页条数选择器
      var ppc = document.getElementById('perPageControl');
      if (ppc) {
        ppc.innerHTML = ' 每页 <select class="ppc-select" id="ppcSelect"><option value="10">10</option><option value="15">15</option><option value="20">20</option></select> 条';
        ppc.style.display = '';
        document.getElementById('ppcSelect').addEventListener('change', function() {
          pageSize = parseInt(this.value);
          currentPage = 1;
          renderPage();
        });
      }

      let pageSize = 10;
      let currentPage = 1;

      // 从排行榜/最近上传跳转 → 定位到目标文件所在页
      let firstHighlight = true;
      if (highlightFileId) {
        const targetIdx = allFiles.findIndex(f => f.id === highlightFileId);
        if (targetIdx >= 0) {
          currentPage = Math.floor(targetIdx / pageSize) + 1;
        }
      }
      const targetHighlightFileId = highlightFileId;
      highlightFileId = null;

      function renderPage() {
        const tbody = document.getElementById('fileTableBody');
        if (!allFiles.length) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint);padding:40px">暂无资料，欢迎上传</td></tr>';
          hidePagination();
          return;
        }

        const totalPages = Math.ceil(totalFiles / pageSize);
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * pageSize;
        const pageFiles = allFiles.slice(start, start + pageSize);

        const fileLookup = {};
        pageFiles.forEach(f => { fileLookup[f.id] = f; });
        tbody.innerHTML = pageFiles.map(function(f) {
          var badgeHtml = '';
          if (f.is_uploader && f.review_status !== 'approved') {
            var badgeLabel = f.review_status === 'pending' ? '审核中' : '已驳回';
            var badgeClass = f.review_status === 'pending' ? 'review-badge-pending' : 'review-badge-rejected';
            badgeHtml = '<span class="review-badge ' + badgeClass + '">' + badgeLabel + '</span>';
          }
          var dlLink = f.can_download !== false
            ? '<a href="/api/files/' + f.id + '/download/" class="dl-link">⬇ 下载</a>'
            : '<span class="dl-link dl-disabled" title="审核通过后可下载">⏳ 待审核</span>';
          return '<tr data-file-id="' + f.id + '"><td class="ft-name"><span class="fn-wrap">' + extBadge(f.file_name) + '<span class="fn-text">' + esc(f.title) + '</span>' + badgeHtml + '</span></td>' +
            '<td class="ft-type-cell">' + esc(f.file_type) + '</td>' +
            '<td class="ft-size-cell">' + formatSize(f.file_size) + '</td>' +
            '<td class="ft-uploader">' + esc(f.uploader) + '</td>' +
            '<td class="ft-teacher">' + esc(f.teacher || '') + '</td>' +
            '<td class="ft-dlcount">' + f.download_count + ' 次</td>' +
            '<td class="ft-download">' + dlLink + '</td></tr>';
        }).join('');
        // 点击行显示文件简介
        Array.from(tbody.children).forEach(tr => {
          tr.addEventListener('click', function(e) {
            if (e.target.closest('.dl-link')) return;
            const fileId = parseInt(this.dataset.fileId);
            if (fileLookup[fileId]) showFileInfoModal(fileLookup[fileId]);
          });
        });
        renderPagination(currentPage, totalPages);
        // 同名课程侧栏存在时折叠次要列
        const mainArea = document.querySelector('.file-area-main');
        const sidePanel = document.querySelector('.file-area-side');
        if (mainArea && sidePanel) mainArea.classList.add('file-area-compact');
        else if (mainArea) mainArea.classList.remove('file-area-compact');

        // 来自排行榜/最近上传 → 高亮并滚动到目标行
        if (firstHighlight && targetHighlightFileId) {
          firstHighlight = false;
          requestAnimationFrame(function() {
            const row = tbody.querySelector('tr[data-file-id="' + targetHighlightFileId + '"]');
            if (row) {
              row.scrollIntoView({ behavior: 'smooth', block: 'center' });
              row.classList.add('highlight-row');
              setTimeout(function() {
                row.classList.remove('highlight-row');
              }, 2500);
            }
          });
        }
      }

      function renderPagination(page, total) {
        let pag = document.getElementById('filePagination');
        if (total <= 1) {
          if (pag) pag.style.display = 'none';
          return;
        }
        if (!pag) {
          pag = document.createElement('div');
          pag.id = 'filePagination';
          pag.className = 'file-pagination';
          document.querySelector('.file-table-scroll').after(pag);
        }

        const numbers = getPageNumbers(page, total);

        let html = '<button class="fp-btn fp-prev' + (page <= 1 ? ' fp-disabled' : '') + '" data-page="' + (page - 1) + '">◀</button>';

        numbers.forEach(function(n) {
          if (n === '…') {
            html += '<button class="fp-btn fp-ellipsis">⋯</button>';
          } else {
            html += '<button class="fp-btn fp-num' + (n === page ? ' fp-active' : '') + '" data-page="' + n + '">' + n + '</button>';
          }
        });

        html += '<button class="fp-btn fp-next' + (page >= total ? ' fp-disabled' : '') + '" data-page="' + (page + 1) + '">▶</button>';

        pag.innerHTML = html;
        pag.style.display = 'flex';

        // Page number / prev / next clicks
        pag.querySelectorAll('.fp-num, .fp-prev, .fp-next').forEach(function(btn) {
          btn.addEventListener('click', function() {
            const p = parseInt(this.dataset.page);
            if (p && p >= 1 && p <= total && p !== currentPage) {
              currentPage = p;
              renderPage();
            }
          });
        });

        // Ellipsis → show jump popup
        pag.querySelectorAll('.fp-ellipsis').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            showJumpPopup(e, total);
          });
        });
      }

      function getPageNumbers(current, total) {
        const pages = [];
        if (total <= 5) {
          for (let i = 1; i <= total; i++) pages.push(i);
          return pages;
        }
        pages.push(1);
        if (current - 1 > 2) pages.push('…');
        var start = Math.max(2, current - 1);
        var end = Math.min(total - 1, current + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (current + 1 < total - 1) pages.push('…');
        pages.push(total);
        return pages;
      }

      function showJumpPopup(event, total) {
        var existing = document.querySelector('.fp-jump-popup');
        if (existing) existing.remove();

        var btn = event.currentTarget;
        var rect = btn.getBoundingClientRect();

        var popup = document.createElement('div');
        popup.className = 'fp-jump-popup';

        let gridHtml = '<div class="fp-jump-grid">';
        for (let i = 1; i <= total; i++) {
          gridHtml += '<button class="fp-jump-num' + (i === currentPage ? ' fp-active' : '') + '" data-page="' + i + '">' + i + '</button>';
        }
        gridHtml += '</div>';
        popup.innerHTML = gridHtml;

        popup.addEventListener('click', function(e) {
          var targetBtn = e.target.closest('.fp-jump-num');
          if (targetBtn) {
            var p = parseInt(targetBtn.dataset.page);
            if (p && p >= 1 && p <= total && p !== currentPage) {
              currentPage = p;
              renderPage();
            }
            popup.remove();
          }
        });

        // Close on click outside
        requestAnimationFrame(function() {
          document.addEventListener('click', function closeHandler(ev) {
            if (popup && !popup.contains(ev.target) && !btn.contains(ev.target)) {
              popup.remove();
              document.removeEventListener('click', closeHandler);
            }
          });
        });

        // Position relative to the ellipsis button
        popup.style.position = 'fixed';
        popup.style.zIndex = '1000';
        document.body.appendChild(popup);

        // Position after append so we can measure
        var popupRect = popup.getBoundingClientRect();
        var topPos = rect.bottom + 4;
        var leftPos = Math.max(8, rect.left + rect.width / 2 - popupRect.width / 2);
        // Keep within viewport
        if (leftPos + popupRect.width > window.innerWidth - 8) {
          leftPos = window.innerWidth - popupRect.width - 8;
        }
        popup.style.top = topPos + 'px';
        popup.style.left = leftPos + 'px';
      }

      function hidePagination() {
        const pag = document.getElementById('filePagination');
        if (pag) pag.style.display = 'none';
      }

      renderPage();
    });
  }

  // ── 文件简介模态框 ──
  function showFileInfoModal(file) {
    const existing = document.querySelector('.file-info-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay file-info-overlay';
    overlay.innerHTML =
      '<div class="modal-card">' +
        '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()">✕</button>' +
        '<h2 class="modal-title">' + esc(file.title) + '</h2>' +
        '<div class="file-info-content">' +
          '<div class="fi-row"><span class="fi-label">课程名称</span><span class="fi-value">' + esc(file.course_name || '') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">文件名称</span><span class="fi-value">' + esc(file.file_name || '') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">文件类型</span><span class="fi-value">' + esc(file.file_type || '') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">文件大小</span><span class="fi-value">' + formatSize(file.file_size) + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">上传者</span><span class="fi-value">' + esc(file.uploader || '匿名') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">任课教师</span><span class="fi-value">' + esc(file.teacher || '未填写') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">下载次数</span><span class="fi-value">' + file.download_count + ' 次</span></div>' +
          '<div class="fi-row"><span class="fi-label">上传日期</span><span class="fi-value">' + esc(file.created_at || '') + '</span></div>' +
          '<div style="text-align:center"><a href="/api/files/' + file.id + '/download/" class="fi-download-btn">⬇ 下载文件</a></div>' +
        '</div>' +
      '</div>';
    overlay.addEventListener('click', function(e) {
      if (e.target === this) this.remove();
    });
    document.body.appendChild(overlay);
  }

  function renderEmpty(course) {
    document.getElementById('explorerContent').innerHTML =
      '<div class="empty-state"><div class="es-icon"><span class="gi gi-empty"></span></div><div class="es-text">「' + esc(course.name) + '」暂无资料</div><div class="es-sub">可能是课程尚未开始，或资料正在征集中</div></div>';
  }

  function renderExplorer() {
    renderBC();
    const node = getNode(expPath);
    if (!node) return;
    if (node.children) {
      expPath.length === 1 ? renderGrid(node.children) : renderList(node.children);
    } else {
      renderFiles(node);
    }
  }

  // ── View Switching ──
  function switchView(name, skipScroll) {
    const views = [
      'homeView', 'explorerView', 'aboutView',
      'tutorialView', 'announcementsView', 'broadView',
      'rankingsView', 'recentAllView', 'profileView'
    ];
    views.forEach(id => {
      document.getElementById(id).classList.toggle('active', id.replace('View','') === name);
    });
    if (!skipScroll) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function updateSidebar(viewName) {
    document.querySelectorAll('.side-nav a').forEach(a => a.classList.remove('active'));
    const link = document.querySelector('.side-nav a[data-view="' + viewName + '"]');
    if (link) link.classList.add('active');
  }

  // ── About Content Data (易编辑) ──
  const aboutContent = {
    introduction: {
      title: '平台介绍',
      sections: [
        { heading: '🌟 我们的使命', text: '致力于贯彻开源精神，抹平信息差，让每一位北师大同学都能免费获取优质学习资源。' },
        { heading: '📚 平台内容', text: '课程笔记、复习资料、考试真题、学术论文、软件教程等一切对学习有帮助的资源。' },
        { heading: '🤝 贡献方式', text: '任何同学都可以上传资料。我们鼓励每人都贡献一份自己的力量——星星之火，可以燎原！' },
      ]
    },
    help: {
      title: '使用帮助',
      sections: [
        { heading: '📖 浏览资料', text: '通过左侧导航栏选择通识课或专业课分类，逐层进入课程页面，即可浏览和下载资料。' },
        { heading: '🔍 搜索功能', text: '在顶栏搜索框输入课程名、课程代码或资料标题，按回车或点击搜索按钮即可快速查找。' },
        { heading: '📤 上传资料', text: '登录后在任意课程页面点击"上传资料"按钮，填写信息并选择文件即可分享你的学习资源。' },
      ]
    },
    contact: {
      title: '联系我们',
      sections: [
        { heading: '📬 邮箱', text: 'bnusparks@163.com — 欢迎投稿、建议与合作。' },
        { heading: '🐙 GitHub', text: '在 <a href="https://github.com/ninelives233/BNUSparks" target="_blank">github.com/ninelives233/BNUSparks</a> 提交 Issue 或 PR。' },
        { heading: '💬 意见反馈', text: '任何问题或建议都可以通过邮箱或 GitHub 告诉我们。' },
      ]
    },
    privacy: {
      title: '隐私政策',
      sections: [
        { heading: '🔒 信息收集', text: '我们仅收集必要的账号信息（校内邮箱、昵称）用于平台身份识别。' },
        { heading: '🛡️ 信息使用', text: '收集的信息仅用于平台功能（如资料上传身份标识），不会分享给任何第三方。' },
        { heading: '🗑️ 数据删除', text: '如你需要删除账号数据，请通过邮箱联系我们，我们将在 7 个工作日内处理。' },
      ]
    }
  };

  function renderAboutContent(sectionKey) {
    const data = aboutContent[sectionKey] || aboutContent.introduction;
    const container = document.getElementById('aboutSectionContent');
    container.innerHTML = data.sections.map(s =>
      '<section class="about-section"><h3>' + esc(s.heading) + '</h3><p>' + s.text + '</p></section>'
    ).join('');
    // Update tabs
    document.querySelectorAll('.about-tab').forEach(t => t.classList.remove('active'));
    const tab = document.querySelector('.about-tab[onclick*="' + sectionKey + '"]');
    if (tab) tab.classList.add('active');
  }

  function showAbout(section) {
    pushViewState('about', { aboutSection: section || 'introduction' });
    switchView('about');
    updateSidebar('about');
    renderAboutContent(section || 'introduction');
  }

  // ── Static Pages Content Data (易编辑) ──
  const staticPages = {
    tutorial: {
      title: '使用教程',
      sections: [
        { heading: '👋 欢迎', text: '欢迎使用 BNU Sparks 学术资源共享平台！以下教程将帮助你快速上手。' },
        { heading: '🔎 搜索资料', text: '在顶栏的搜索框中输入课程名称、课程代码或资料标题，直接回车即可搜索。搜索结果会显示关联的课程和资料文件。' },
        { heading: '📁 浏览课程', text: '通过左侧导航栏选择"通识课"或"专业课"，逐层进入课程分类，点击课程卡片即可查看该课程的所有资料。' },
        { heading: '⬆️ 如何上传', text: '登录账号后，进入任意课程页面，点击页面上方的"上传资料"按钮，填写标题、选择文件即可分享你的学习资源。上传需要使用北师大校内邮箱(@mail.bnu.edu.cn)注册。' },
        { heading: '📱 移动端使用', text: '在手机或平板上，点击左上角的菜单按钮打开导航抽屉，即可像桌面端一样浏览全部功能。' },
      ]
    },
    announcements: {
      title: '公告',
      sections: [
        { heading: '🎉 平台上线', text: 'BNU Sparks 现已正式上线！欢迎访问 bnu.icu，获取和分享学习资料。' },
        { heading: '📢 招募贡献者', text: '我们正在招募平台维护者和内容贡献者。如果你对开源、教育资源开放感兴趣，欢迎通过邮箱联系我们。' },
        { heading: '📋 后续规划', text: '平台将持续更新课程数据，逐步覆盖全校所有专业的培养方案课程。同时将开发更多实用功能，如个人收藏、资料评论等。' },
      ]
    },
    broad: {
      title: '关于大类招生',
      sections: [
        { heading: '📋 什么是大类招生', text: '大类招生是高校将相同或相近学科门类（通常是同一学院内的多个专业）合并为一个大类进行招生。学生入学后前 1-2 年学习通识课程和大类基础课程，之后根据学业成绩和个人意愿进行专业分流。' },
        { heading: '📚 通识课程安排', text: '大类招生下，全校通识教育课程包括思想政治理论类、体育与健康类、军事理论与军事技能、大学外语类、教师素养类、家国情怀与价值理想模块等 11 个类别，所有本科生统一修读。' },
        { heading: '🧭 专业分流', text: '大一下或大二上，学生根据学业成绩（GPA）和个人意愿，在大类涵盖的专业中选择具体专业方向。分流标准因学院而异，通常包括绩点排名、面试表现等。' },
        { heading: '🏫 北京师范大学的大类招生', text: 'BNU 目前多个学院实行大类招生，如经济与工商管理学院按"经济学类"招生（含金融学、经济学励耘、金融科技、工商管理、会计学），法学院按"法学"招生等。' },
      ]
    }
  };

  function renderStaticView(viewKey) {
    const data = staticPages[viewKey];
    const container = document.getElementById(viewKey + 'Content');
    if (!container) return;
    container.innerHTML = data.sections.map(s =>
      '<section class="about-section"><h3>' + esc(s.heading) + '</h3><p>' + esc(s.text) + '</p></section>'
    ).join('');
  }

  function showTutorial() {
    switchView('tutorial');
    updateSidebar('home');
    renderStaticView('tutorial');
  }

  function showAnnouncements() {
    switchView('announcements');
    updateSidebar('home');
    renderStaticView('announcements');
  }

  function showBroad() {
    switchView('broad');
    updateSidebar('home');
    renderStaticView('broad');
  }

  // ── Rankings & Recent All Views ──
  async function renderTopDownloaded(restoreScrollY) {
    const container = document.getElementById('rankingsContent');
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--ink-faint)">加载中...</div>';
    try {
      const s = await api('/api/stats/?limit=100');
      const allItems = s.top_downloaded || [];

      function renderList(filterCollege, filterType) {
        var filtered = allItems;
        if (filterType === 'general') {
          filtered = filtered.filter(function(m){ return m.course_code.startsWith('GEN'); });
        }
        if (filterCollege) {
          filtered = filtered.filter(function(m){ return m.college === filterCollege; });
        }
        if (!filterType && !filterCollege) {
          filtered = allItems;
        }

        var colleges = [];
        allItems.forEach(function(m){
          if (m.college && colleges.indexOf(m.college) === -1) colleges.push(m.college);
        });
        colleges.sort();

        var html = '<div class="filter-bar">';
        html += '<button class="fb-pill' + (!filterCollege && !filterType ? ' fb-active' : '') + '" data-filter-college="" data-filter-type="">全部</button>';
        html += '<button class="fb-pill' + (filterType === 'general' ? ' fb-active' : '') + '" data-filter-college="" data-filter-type="general">通识课</button>';
        colleges.forEach(function(c){
          html += '<button class="fb-pill' + (c === filterCollege && !filterType ? ' fb-active' : '') + '" data-filter-college="' + esc(c) + '" data-filter-type="">' + esc(c) + '</button>';
        });
        html += '</div>';

        if (!filtered.length) {
          html += '<div class="rankings-item" style="justify-content:center;color:var(--ink-faint);border:none;background:none">暂无该学院的资料</div>';
        } else {
          html += filtered.map(function(m, i){
            var idx = allItems.indexOf(m) + 1;
            return '<a href="#" class="rankings-item" onclick="event.preventDefault();highlightFileId=' + m.id + ';returnState={view:\'rankings\',scrollY:pageYOffset};showExplorer(\'' +
                (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\');navToLast(\'' + esc(m.course_code) + '\')">' +
              '<span class="ri-rank">#' + idx + '</span>' +
              '<div class="ri-info"><div class="ri-name">' + esc(m.title) + '</div><div class="ri-meta">' + esc(m.course_name) + '</div></div>' +
              '<span class="ri-stat">' + m.download_count + ' 次下载</span>' +
            '</a>';
          }).join('');
        }

        container.innerHTML = html;
        container.querySelectorAll('.fb-pill').forEach(function(btn){
          btn.addEventListener('click', function(){
            renderList(this.dataset.filterCollege, this.dataset.filterType);
          });
        });
        if (restoreScrollY) requestAnimationFrame(function(){ window.scrollTo({top:restoreScrollY}); });
      }

      renderList(null, null);
    } catch(e) {
      container.innerHTML = '<div class="rankings-item" style="justify-content:center;color:var(--ink-faint)">加载失败</div>';
    }
  }

  async function renderRecentAll(restoreScrollY) {
    const container = document.getElementById('recentAllContent');
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--ink-faint)">加载中...</div>';
    try {
      const s = await api('/api/stats/?limit=100');
      const allItems = s.recent_uploads || [];

      function renderList(filterCollege, filterType) {
        var filtered = allItems;
        if (filterType === 'general') {
          filtered = filtered.filter(function(m){ return m.course_code.startsWith('GEN'); });
        }
        if (filterCollege) {
          filtered = filtered.filter(function(m){ return m.college === filterCollege; });
        }
        if (!filterType && !filterCollege) {
          filtered = allItems;
        }

        var colleges = [];
        allItems.forEach(function(m){
          if (m.college && colleges.indexOf(m.college) === -1) colleges.push(m.college);
        });
        colleges.sort();

        var html = '<div class="filter-bar">';
        html += '<button class="fb-pill' + (!filterCollege && !filterType ? ' fb-active' : '') + '" data-filter-college="" data-filter-type="">全部</button>';
        html += '<button class="fb-pill' + (filterType === 'general' ? ' fb-active' : '') + '" data-filter-college="" data-filter-type="general">通识课</button>';
        colleges.forEach(function(c){
          html += '<button class="fb-pill' + (c === filterCollege && !filterType ? ' fb-active' : '') + '" data-filter-college="' + esc(c) + '" data-filter-type="">' + esc(c) + '</button>';
        });
        html += '</div>';

        if (!filtered.length) {
          html += '<div class="rankings-item" style="justify-content:center;color:var(--ink-faint);border:none;background:none">暂无该学院的资料</div>';
        } else {
          html += filtered.map(function(m){
            return '<a href="#" class="rankings-item" onclick="event.preventDefault();highlightFileId=' + m.id + ';returnState={view:\'recentAll\',scrollY:pageYOffset};showExplorer(\'' +
                (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\');navToLast(\'' + esc(m.course_code) + '\')">' +
              '<div class="ri-info"><div class="ri-name">' + esc(m.title) + '</div><div class="ri-meta">' + m.created_at + ' · ' + esc(m.course_name) + '</div></div>' +
              '<span class="ri-stat">' + esc(m.uploader) + '</span>' +
            '</a>';
          }).join('');
        }

        container.innerHTML = html;
        container.querySelectorAll('.fb-pill').forEach(function(btn){
          btn.addEventListener('click', function(){
            renderList(this.dataset.filterCollege, this.dataset.filterType);
          });
        });
        if (restoreScrollY) requestAnimationFrame(function(){ window.scrollTo({top:restoreScrollY}); });
      }

      renderList(null, null);
    } catch(e) {
      container.innerHTML = '<div class="rankings-item" style="justify-content:center;color:var(--ink-faint)">加载失败</div>';
    }
  }

  function showTopDownloaded(restoreScrollY) {
    pushViewState('rankings', {});
    switchView('rankings', !!restoreScrollY);
    updateSidebar('home');
    renderTopDownloaded(restoreScrollY);
  }

  function showRecentAll(restoreScrollY) {
    pushViewState('recentAll', {});
    switchView('recentAll', !!restoreScrollY);
    updateSidebar('home');
    renderRecentAll(restoreScrollY);
  }

  function returnToPreviousView() {
    if (!returnState) return;
    const sv = returnState.scrollY;
    const view = returnState.view;
    returnState = null;
    if (view === 'rankings') showTopDownloaded(sv);
    else if (view === 'recentAll') showRecentAll(sv);
    else showHome(sv);
  }

  function showHome(restoreScrollY) {
    pushViewState('home', {});
    returnState = null;
    if (restoreScrollY) {
      switchView('home', true);
      requestAnimationFrame(function(){ window.scrollTo({top: restoreScrollY}); });
    } else {
      switchView('home');
    }
    updateSidebar('home');
  }

  function showExplorer(type) {
    expPath = [type];
    pushViewState('explorer', { expPath: [type] });
    renderExplorer();
    switchView('explorer');
    updateSidebar(type === '通识课' ? 'general' : 'major');
  }

  // ── Sidebar ──
  document.querySelectorAll('.side-nav a').forEach(a => {
    a.addEventListener('click', (e) => {
      const view = a.dataset.view;
      if (!view) return;
      e.preventDefault();
      if (view === 'home') showHome();
      else if (view === 'general') showExplorer('通识课');
      else if (view === 'major') showExplorer('专业课');
      else if (view === 'about') showAbout('introduction');
    });
  });

  // ── Mobile Drawer links ──
  document.querySelectorAll('.mobile-drawer a').forEach(a => {
    a.addEventListener('click', (e) => {
      const view = a.dataset.view;
      if (!view) return;
      e.preventDefault();
      if (view === 'home') showHome();
      else if (view === 'general') showExplorer('通识课');
      else if (view === 'major') showExplorer('专业课');
      else if (view === 'about') showAbout('introduction');
      drawer.classList.remove('open');
    });
  });

  // ── Browser Back/Forward Navigation ──
  window.addEventListener('popstate', function(e) {
    var s = e.state;
    _suppressingPushState = true;

    if (!s || !s._bnusparks) {
      // 无历史状态 → 回首页
      returnState = null;
      switchView('home');
      updateSidebar('home');
      _suppressingPushState = false;
      return;
    }

    switch (s.view) {
      case 'home':
        showHome(s.scrollY);
        break;
      case 'explorer':
        returnState = null;
        expPath = s.expPath || [];
        renderExplorer();
        switchView('explorer', true);
        updateSidebar(expPath[0] === '通识课' ? 'general' : 'major');
        if (s.scrollY) requestAnimationFrame(function(){ window.scrollTo({top: s.scrollY}); });
        break;
      case 'rankings':
        showTopDownloaded(s.scrollY);
        break;
      case 'recentAll':
        showRecentAll(s.scrollY);
        break;
      case 'about':
        showAbout(s.aboutSection || 'introduction');
        break;
      case 'profile':
        showProfile();
        break;
    }
    _suppressingPushState = false;
  });

  // ── Init ──
  updateAuthUI();