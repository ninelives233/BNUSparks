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
    if (tr) { var c = tr.querySelector('.ft-dlcount'); if (c) { var m = c.textContent.match(/(\d+)/); if (m) { c.textContent = (parseInt(m[1]) + 1) + ' 次'; } } }

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

  // ── 直接下载（浏览器原生下载对话框，无内存缓冲问题） ──
  function doDirectDownload(fileId, fileName) {
    var token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (!token) { alert('请先登录'); return; }
    var url = '/api/files/' + fileId + '/download/?token=' + encodeURIComponent(token);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName || '';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" onclick="confirmBatchEdit(' + selected.join(',') + ')">确认修改</button>' +
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
    if (!teacher && !description) { alert('请至少填写一项修改内容'); return; }
    var body = { file_ids: fileIdsStr.split(',').map(Number) };
    if (teacher) body.teacher = teacher;
    if (description) body.description = description;
    var overlay = document.querySelector('.admin-reject-overlay');
    api('/api/files/batch-edit/', { method: 'POST', body: body }).then(function(result) {
      _removeOverlay(overlay);
      alert('已更新 ' + (result.updated || 0) + ' 个文件');
      renderExplorer();
    }).catch(function(err) {
      alert('批量编辑失败：' + err.message);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     用户认证
     ═══════════════════════════════════════════════════════════ */

  let currentUser = null;
  let _mgmtMode = localStorage.getItem('bnusparks_mgmt') === '1';
  let _civilianMode = localStorage.getItem('bnusparks_civilian') === '1';
  // 防止旧版本遗留数据导致两者同时为真
  if (_mgmtMode && _civilianMode) {
    _civilianMode = false;
    localStorage.setItem('bnusparks_civilian', '0');
  }

  function updateAuthUI() {
    const container = document.getElementById('headerLogin');
    if (!container) return;
    if (currentUser) {
      const roleLabel = currentUser.role === 'super_admin' ? ' 总管理' : currentUser.role === 'moderator' ? ' 版主' : currentUser.role === 'sub_moderator' ? ' 小版主' : '';
      var initial = (currentUser.nickname || currentUser.username).charAt(0).toUpperCase();
      var avatarHtml = currentUser.avatar_url
        ? '<img src="' + esc(currentUser.avatar_url) + '" class="user-avatar-img" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover">'
        : '<span class="user-avatar-circle" id="userAvatarCircle">' + esc(initial) + '</span>';
      container.innerHTML =
        '<button class="user-avatar-trigger" id="userAvatarTrigger" onclick="toggleNotifDrawer()" title="通知 / 个人中心">' +
          avatarHtml +
          '<span class="notif-badge" id="notifBadge" style="display:none">0</span>' +
        '</button>';
    } else {
      container.innerHTML =
        '<a href="#" class="login-btn" onclick="event.preventDefault();showLoginModal()">' +
          '<span class="login-icon gi gi-login"></span><span class="login-text">登录</span>' +
        '</a>';
    }
    // 侧边栏管理后台入口显示/隐藏（平民模式隐藏一切）
    var showAdmin = currentUser && currentUser.role !== 'user' && !_civilianMode;
    document.querySelectorAll('#sideAdminLink, #mobAdminLink').forEach(function(link) {
      link.style.display = showAdmin ? '' : 'none';
    });
  }


  // 静默刷新当前用户信息（不阻塞 UI）
  var _refreshing = false;
  async function refreshCurrentUser() {
    if (_refreshing || !currentUser) return;
    _refreshing = true;
    try {
      var fresh = await api('/api/auth/me/');
      if (!fresh) return;
      var roleChanged = fresh.role !== currentUser.role;
      currentUser = fresh;
      if (roleChanged) {
        updateAuthUI();
        // 角色变化时刷新头像首字母
        var circle = document.getElementById('userAvatarCircle');
        if (circle) circle.textContent = (currentUser.nickname || currentUser.username).charAt(0).toUpperCase();
      }
      // 更新头像（即使角色没变，昵称可能变了）
      var circle = document.getElementById('userAvatarCircle');
      if (circle) circle.textContent = (currentUser.nickname || currentUser.username).charAt(0).toUpperCase();
    } catch(e) { /* 静默失败，沿用缓存 */ }
    _refreshing = false;
  }

  // 点击页面其他地方关闭抽屉
  document.addEventListener('click', function(e) {
    if (e.target.closest('#notifDrawer') || e.target.closest('#userAvatarTrigger')) return;
    var drawer = document.getElementById('notifDrawer');
    if (drawer && drawer.style.display === 'flex') closeNotifDrawer();
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

  function showLoginModal() { document.getElementById('loginModal').style.display = 'flex'; lockScroll(); _pushModalHistory(); }
  function showRegister() { document.getElementById('loginModal').style.display = 'none'; document.getElementById('registerModal').style.display = 'flex'; }
  function showLogin() { document.getElementById('registerModal').style.display = 'none'; document.getElementById('loginModal').style.display = 'flex'; }
  function closeAuthModal() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('registerModal').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('registerError').style.display = 'none';
    document.getElementById('registerSuccess').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    unlockScroll();
    _popModalHistory();
    // 清除密码字段
    var pw = document.getElementById('regPassword');
    var pwc = document.getElementById('regPasswordConfirm');
    if (pw) pw.value = '';
    if (pwc) pwc.value = '';
  }

  async function handleLogin(e) {
    e.preventDefault();
    const el = document.getElementById('loginError');
    try {
      var sid = document.getElementById('loginSid').value.trim();
      var remember = document.getElementById('loginRemember').checked;
      if (!sid) throw new Error('请输入学号');
      var username = sid + '@mail.bnu.edu.cn';
      const data = await api('/api/auth/login/', { method: 'POST',
        body: { username: username, password: document.getElementById('loginPassword').value, remember: remember } });
      _persistToken(data.token, remember);
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
    lockScroll();
    _pushModalHistory();
  }

  function closeForgotPwdModal() {
    document.getElementById('forgotPwdModal').style.display = 'none';
    document.getElementById('forgotPwdForm').style.display = 'block';
    document.getElementById('forgotPwdSuccess').style.display = 'none';
    document.getElementById('forgotPwdError').style.display = 'none';
    unlockScroll();
    _popModalHistory();
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    const el = document.getElementById('forgotPwdError');
    const success = document.getElementById('forgotPwdSuccess');
    const form = document.getElementById('forgotPwdForm');
    try {
      var sid = document.getElementById('forgotSid').value.trim();
      if (!sid) throw new Error('请输入学号');
      var email = sid + '@mail.bnu.edu.cn';
      const data = await api('/api/auth/forgot-password/', { method: 'POST',
        body: { email: email } });
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
    lockScroll();
    _pushModalHistory();
  }

  function closeResetPwdModal() {
    document.getElementById('resetPwdModal').style.display = 'none';
    document.getElementById('resetPwdForm').style.display = 'block';
    document.getElementById('resetPwdSuccess').style.display = 'none';
    document.getElementById('resetPwdError').style.display = 'none';
    _resetUid = null; _resetToken = null;
    unlockScroll();
    _popModalHistory();
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
    try {
      var sid = document.getElementById('regSid').value.trim();
      if (!sid) throw new Error('请输入学号');
      var email = sid + '@mail.bnu.edu.cn';
      var password = document.getElementById('regPassword').value;
      var passwordConfirm = document.getElementById('regPasswordConfirm').value;
      if (password.length < 8) throw new Error('密码长度至少 8 位');
      if (password !== passwordConfirm) throw new Error('两次密码输入不一致');
      await api('/api/auth/register/', { method: 'POST',
        body: { email: email,
                nickname: document.getElementById('regNickname').value.trim(),
                password: password } });
      // 不自动登录 — 用户需要先验证邮箱
      el.style.display = 'none';
      form.style.display = 'none';
      success.style.display = 'block';
      // 清除密码字段
      document.getElementById('regPassword').value = '';
      document.getElementById('regPasswordConfirm').value = '';
    } catch (err) { el.textContent = err.message; el.style.display = 'block'; success.style.display = 'none'; }
    return false;
  }

  function logout() {
    sessionStorage.removeItem('token');
    localStorage.removeItem('token');
    localStorage.removeItem('_loginTime');
    localStorage.removeItem('_loginRemember');
    currentUser = null;
    location.reload();
  }

  // ── Token 持久化：sessionStorage（当前会话）+ localStorage（跨会话） ──
  function _persistToken(token, remember) {
    sessionStorage.setItem('token', token);
    localStorage.setItem('token', token);
    localStorage.setItem('_loginTime', Date.now().toString());
    localStorage.setItem('_loginRemember', remember ? '1' : '0');
  }

  async function checkAuth() {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (!token) { updateAuthUI(); return; }
    // 从 localStorage 恢复 sessionStorage（页面刷新后）
    if (!sessionStorage.getItem('token') && localStorage.getItem('token')) {
      sessionStorage.setItem('token', localStorage.getItem('token'));
    }
    try {
      currentUser = await api('/api/auth/me/');
      updateAuthUI();
      // 异步加载未读通知数
      loadNotifCount();
    }
    catch {
      // token 过期或无效——检查 localStorage 中的时间戳决定是否自动清除
      _clearStaleToken();
      updateAuthUI();
    }
  }

  function _clearStaleToken() {
    var remember = localStorage.getItem('_loginRemember') === '1';

    if (remember) {
      // 记住我：不清除 token 本身，让用户手动重登（避免服务端 key 轮换时误删）
      return;
    }

    // 未勾选"记住我"：清除过期的 token
    sessionStorage.removeItem('token');
    localStorage.removeItem('token');
    localStorage.removeItem('_loginTime');
    localStorage.removeItem('_loginRemember');
  }

  async function loadNotifCount() {
    try {
      const data = await api('/api/auth/notifications/?unread_only=1');
      const badge = document.getElementById('notifBadge');
      if (data.unread_count > 0) {
        // 减去本地已读缓存中仍在 server 未读列表里的
        var readSet = _getReadNotifSet();
        var actual = data.unread_count;
        if (data.list) {
          data.list.forEach(function(n) {
            if (readSet.has(n.id)) actual--;
          });
        }
        if (actual > 0) {
          badge.textContent = actual > 99 ? '99+' : actual;
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch(e) { /* ignore */ }
  }

  // ── 个人资料 ──
  function showProfile() {
    // 关闭所有视图（直接操作 display 避免 CSS 类冲突）
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.style.display = 'none';
    });
    // 显示个人资料
    var pv = document.getElementById('profileView');
    if (pv) pv.style.display = 'block';
    updateSidebar(null);
    window.scrollTo({ top: 0 });
    pushViewState('profile', {});
    // 显示我的上传
    switchView('profile', true);
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
      // 头像：有真实图片则显示 img，否则首字母
      var initial = data.nickname.charAt(0) || '🧑';
      if (data.avatar_url) {
        avatarEl.innerHTML = '<img src="' + esc(data.avatar_url) + '" alt="avatar" style="width:80px;height:80px;border-radius:50%;object-fit:cover">';
      } else {
        avatarEl.textContent = initial;
      }
      quotaEl.textContent = data.daily_download_limit < 0 ? '不限' : (data.daily_download_used || 0) + ' / ' + data.daily_download_limit + ' 次';
      // 管辖板块
      var sectionsRow = document.getElementById('profileSectionsRow');
      var sectionsEl = document.getElementById('profileSections');
      if (sectionsRow && sectionsEl) {
        if (data.managed_sections && data.managed_sections.length) {
          sectionsEl.textContent = data.managed_sections.join('、');
          sectionsRow.style.display = '';
        } else {
          sectionsRow.style.display = 'none';
        }
      }
    } catch (err) {
      emailEl.textContent = '加载失败';
    }
  }

  // ── 头像上传 ──
  function triggerAvatarUpload() {
    var input = document.getElementById('avatarUploadInput');
    if (input) input.click();
  }

  async function handleAvatarUpload(e) {
    var file = e.target && e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('图片不能超过 2MB');
      return;
    }
    var fd = new FormData();
    fd.append('avatar', file);
    try {
      var token = sessionStorage.getItem('token') || localStorage.getItem('token');
      var resp = await fetch('/api/auth/avatar/', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd,
      });
      var data = await resp.json();
      if (!data.ok) throw new Error(data.error || '上传失败');
      // 刷新头像显示
      if (currentUser) currentUser.avatar_url = data.data.avatar_url;
      loadProfile();
      updateAuthUI();
      alert('头像已更新');
    } catch (err) {
      alert('头像上传失败：' + err.message);
    }
    e.target.value = ''; // 重置 input 可重复选同一文件
  }

  async function loadMyUploads() {
    const section = document.getElementById('myUploadsSection');
    const list = document.getElementById('myUploadsList');
    const count = document.getElementById('myUploadsCount');
    if (!section || !list) return;
    try {
      const uploads = await api('/api/user/uploads/');
      if (!uploads || !uploads.length) {
        section.style.display = 'block';
        list.innerHTML = '<div class="hc-empty">暂无上传记录，快去上传第一份资料吧！</div>';
        if (count) count.textContent = '';
        return;
      }
      section.style.display = 'block';
      if (count) count.textContent = '共 ' + uploads.length + ' 条';
      list.innerHTML = uploads.map(function(m) {
        var badgeLabel = '', badgeClass = '';
        if (m.review_status === 'pending') { badgeLabel = '审核中'; badgeClass = 'review-badge-pending'; }
        else if (m.review_status === 'rejected') { badgeLabel = '已驳回'; badgeClass = 'review-badge-rejected'; }
        else { badgeLabel = '已通过'; badgeClass = 'review-badge-approved'; }
        var badgeHtml = '<span class="review-badge ' + badgeClass + '">' + badgeLabel + '</span>';
        var reuploadBtn = m.review_status === 'rejected'
          ? '<button class="reupload-btn" onclick="showReUploadDialog(' + m.id + ',\'' + esc(m.course_code) + '\',\'' + esc(m.course_name) + '\',\'' + esc(m.title) + '\',\'' + esc(m.review_notes||'') + '\',\'' + esc(m.teacher||'') + '\')">↻ 重新上传</button>'
          : '';
        return '<div class="hc-item">' +
          '<div class="hc-item-left">' +
            '<div class="hc-item-name">' + esc(m.title) + ' ' + badgeHtml + '</div>' +
            '<div class="hc-item-meta">' + esc(m.course_name) + ' · ' + formatSize(m.file_size) + ' · ' + m.download_count + ' 次下载' +
              (m.review_status === 'rejected' && m.review_notes ? ' · 驳回原因: ' + esc(m.review_notes) : '') +
            '</div>' +
            (m.review_status === 'rejected' ? '<div class="hc-item-actions">' + reuploadBtn + '<button class="delete-rejected-btn" onclick="deleteRejected(' + m.id + ', this)">🗑 删除记录</button></div>' : '') +
          '</div>' +
          '<span class="hc-item-count">' + m.created_at + '</span>' +
        '</div>';
      }).join('');
    } catch(e) {
      section.style.display = 'block';
      list.innerHTML = '<div class="hc-empty">加载失败</div>';
    }
  }

  // ── 我的上传独立页面（Iter 6） ──
  function showMyUploadsPage() {
    closeNotifDrawer();
    document.querySelectorAll('.view-section').forEach(function(v) { v.style.display = 'none'; });
    var v = document.getElementById('myUploadsView');
    if (v) v.style.display = 'block';
    switchView('profile', true);
    updateSidebar(null);
    window.scrollTo({ top: 0 });
    pushViewState('myuploads', {});
    renderMyUploadsPage();
  }

  var _myUploadTab = 'approved';

  function renderMyUploadsPage() {
    var list = document.getElementById('myUploadsPageList');
    if (!list) return;
    list.innerHTML = '<div class="admin-loading">加载中…</div>';
    // 更新 tab 高亮
    document.querySelectorAll('.mu-tab').forEach(function(t) { t.classList.remove('active'); });
    var activeTab = document.querySelector('.mu-tab[data-tab="' + _myUploadTab + '"]');
    if (activeTab) activeTab.classList.add('active');

    api('/api/user/uploads/').then(function(uploads) {
      if (!uploads || !uploads.length) {
        list.innerHTML = '<div class="admin-empty">暂无上传记录</div>';
        return;
      }
      var filtered = uploads.filter(function(m) {
        if (_myUploadTab === 'approved') return m.review_status === 'approved';
        if (_myUploadTab === 'pending') return m.review_status === 'pending';
        if (_myUploadTab === 'rejected') return m.review_status === 'rejected';
        if (_myUploadTab === 'deleted') return false; // 需从删除记录单独加载
        return true;
      });
      if (!filtered.length) {
        list.innerHTML = '<div class="admin-empty">暂无' + (_myUploadTab==='approved'?'已通过':_myUploadTab==='pending'?'待审核':_myUploadTab==='rejected'?'已驳回':'已删除') + '的记录</div>';
        if (_myUploadTab === 'deleted') renderMyDeletedTab(list);
        return;
      }
      var html = '';
      filtered.forEach(function(m) {
        var badgeLabel = '', badgeClass = '';
        if (m.review_status === 'pending') { badgeLabel = '审核中'; badgeClass = 'review-badge-pending'; }
        else if (m.review_status === 'rejected') { badgeLabel = '已驳回'; badgeClass = 'review-badge-rejected'; }
        else { badgeLabel = '已通过'; badgeClass = 'review-badge-approved'; }
        var badgeHtml = '<span class="review-badge ' + badgeClass + '">' + badgeLabel + '</span>';
        var actions = '';
        if (m.review_status === 'rejected') {
          actions = '<button class="reupload-btn" onclick="showReUploadDialog(' + m.id + ',\'' + esc(m.course_code) + '\',\'' + esc(m.course_name) + '\',\'' + esc(m.title) + '\',\'' + esc(m.review_notes||'') + '\',\'' + esc(m.teacher||'') + '\')">↻ 重新上传</button>' +
            '<button class="delete-rejected-btn" onclick="deleteRejected(' + m.id + ', this)">🗑 删除记录</button>';
        }
        html += '<div class="hc-item">' +
          '<div class="hc-item-left">' +
            '<div class="hc-item-name">' + esc(m.title) + ' ' + badgeHtml + '</div>' +
            '<div class="hc-item-meta">' + esc(m.course_name) + ' · ' + formatSize(m.file_size) + ' · ' + m.download_count + ' 次下载' +
              (m.review_status === 'rejected' && m.review_notes ? ' · 驳回原因: ' + esc(m.review_notes) : '') +
            '</div>' +
            (actions ? '<div class="hc-item-actions">' + actions + '</div>' : '') +
          '</div>' +
          '<span class="hc-item-count">' + m.created_at + '</span>' +
        '</div>';
      });
      list.innerHTML = html;
    }).catch(function(err) {
      list.innerHTML = '<div class="admin-empty">加载失败</div>';
    });
  }

  function switchMyUploadsTab(tab) {
    _myUploadTab = tab;
    renderMyUploadsPage();
  }

  function renderMyDeletedTab(listEl) {
    // 从删除记录 API 加载当前用户相关的删除记录
    api('/api/moderation/deletions/?page=1&per_page=100').then(function(data) {
      if (!data.items || !data.items.length) {
        listEl.innerHTML = '<div class="admin-empty">暂无已删除的记录</div>';
        return;
      }
      // 只显示当前用户自己的删除记录
      var mine = data.items.filter(function(r) { return r.deleted_by_id === (currentUser ? currentUser.id : -1); });
      if (!mine.length) {
        listEl.innerHTML = '<div class="admin-empty">暂无已删除的记录</div>';
        return;
      }
      var html = '';
      mine.forEach(function(r) {
        var canRestore = r.can_restore && !r.is_restored;
        html += '<div class="hc-item">' +
          '<div class="hc-item-left">' +
            '<div class="hc-item-name">' + esc(r.title) + (r.is_restored ? ' <span style="color:var(--success)">✅ 已恢复</span>' : ' <span class="review-badge review-badge-rejected">已删除</span>') + '</div>' +
            '<div class="hc-item-meta">' + esc(r.course_name) + ' · ' + formatSize(r.file_size) + ' · 删除于 ' + esc(r.deleted_at) + '</div>' +
            (canRestore ? '<div class="hc-item-actions"><button class="admin-btn admin-btn-approve" onclick="restoreMyDeletion(' + r.id + ', this)">↩ 撤销删除</button></div>' : '') +
          '</div>' +
          '<span class="hc-item-count">' + (!canRestore && !r.is_restored ? '⏰ 已过期' : '') + '</span>' +
        '</div>';
      });
      listEl.innerHTML = html;
    }).catch(function() {
      listEl.innerHTML = '<div class="admin-empty">加载失败</div>';
    });
  }

  async function restoreMyDeletion(delId, btn) {
    var reason = '';
    if (btn) btn.disabled = true;
    try {
      await api('/api/moderation/deletions/' + delId + '/restore/', { method: 'POST', body: { reason: reason } });
      alert('✅ 文件已恢复');
      renderMyUploadsPage();
    } catch(err) {
      alert('恢复失败：' + err.message);
      if (btn) btn.disabled = false;
    }
  }

  // ── 删除驳回记录 ──
  async function deleteRejected(materialId, btn) {
    if (!confirm('确定删除这条已驳回的记录？删除后不可恢复。')) return;
    if (btn) btn.disabled = true;
    try {
      await api('/api/files/' + materialId + '/delete/', { method: 'DELETE' });
      // 从 DOM 移除整条记录
      var item = btn ? btn.closest('.hc-item') : null;
      if (item) item.remove();
      loadMyUploads(); // 刷新列表
    } catch (err) {
      alert('删除失败：' + err.message);
      if (btn) btn.disabled = false;
    }
  }

  // ── 驳回重新上传 ──
  let _reuploadOldId = null;

  function showReUploadDialog(materialId, courseCode, courseName, title, reviewNotes, teacher) {
    if (!currentUser) { showLoginModal(); return; }
    _reuploadOldId = materialId;
    showUploadModal(courseCode, courseName);
    document.getElementById('uploadTitle').value = title;
    if (teacher) document.getElementById('uploadTeacher').value = teacher;
    // 显示上次驳回原因提示
    var notesEl = document.getElementById('reuploadInfo');
    if (!notesEl) {
      notesEl = document.createElement('div');
      notesEl.id = 'reuploadInfo';
      notesEl.className = 'reupload-info';
      document.querySelector('#uploadForm .mf-group').before(notesEl);
    }
    notesEl.innerHTML = '📌 上次驳回原因：' + esc(reviewNotes) + '<br><small>修改后重新提交，将重新进入审核流程。旧驳回记录将自动删除。</small>';
    notesEl.style.display = 'block';
  }

  function editNickname() {
    const input = document.getElementById('nicknameInput');
    const current = document.getElementById('profileNickname').textContent;
    if (input) input.value = current;
    document.getElementById('nicknameEditor').style.display = 'flex';
    document.getElementById('nicknameError').style.display = 'none';
    if (input) input.focus();
    lockScroll();
  }

  function cancelEditNickname() {
    document.getElementById('nicknameEditor').style.display = 'none';
    unlockScroll();
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
    lockScroll();
  }

  function closeChangePwdOverlay() {
    document.getElementById('changePwdEditor').style.display = 'none';
    unlockScroll();
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

  // ── 通知已读状态 localStorage 缓存 ──
  function _getReadNotifSet() {
    try { return new Set(JSON.parse(localStorage.getItem('readNotifs') || '[]')); } catch(e) { return new Set(); }
  }
  function _addReadNotif(nid) {
    var set = _getReadNotifSet();
    set.add(nid);
    localStorage.setItem('readNotifs', JSON.stringify(Array.from(set)));
  }
  function _addAllReadNotifs(nids) {
    var set = _getReadNotifSet();
    nids.forEach(function(id) { set.add(id); });
    localStorage.setItem('readNotifs', JSON.stringify(Array.from(set)));
  }

  // ── 用户抽屉（菜单 + 通知子视图） ──
  let _notifLoaded = false;

  function toggleNotifDrawer() {
    const drawer = document.getElementById('notifDrawer');
    if (drawer.style.display === 'flex') {
      closeNotifDrawer();
    } else {
      drawer.style.display = 'flex';
      showDrawerMenu();
      renderDrawerMenu();
      if (currentUser) refreshCurrentUser();
      lockScroll();
    }
  }

  function showDrawerMenu() {
    document.getElementById('drawerMenu').style.display = '';
    document.getElementById('drawerNotif').style.display = 'none';
    // 重置标题和动作栏（可能被 showDrawerDownloads 修改过）
    var header = document.querySelector('#drawerNotif .notif-drawer-header h3');
    if (header) header.textContent = '通知';
    var actions = document.querySelector('#drawerNotif .notif-drawer-actions');
    if (actions) actions.style.display = '';
    renderDrawerMenu(); // 刷新未读计数
  }

  function showDrawerNotif() {
    document.getElementById('drawerMenu').style.display = 'none';
    document.getElementById('drawerNotif').style.display = '';
    if (!_notifLoaded) { loadNotifications(); _notifLoaded = true; }
  }

  async function showDrawerDownloads() {
    document.getElementById('drawerMenu').style.display = 'none';
    document.getElementById('drawerNotif').style.display = '';
    // 换标题 + 隐藏默认的 notif 动作栏
    var header = document.querySelector('#drawerNotif .notif-drawer-header h3');
    if (header) header.textContent = '我的下载';
    var actions = document.querySelector('#drawerNotif .notif-drawer-actions');
    if (actions) actions.style.display = 'none';
    var list = document.getElementById('notifList');
    if (!list) return;
    list.innerHTML = '<div class="notif-empty">加载中…</div>';
    try {
      var data = await api('/api/user/downloads/');
      if (!data || !data.length) {
        list.innerHTML = '<div class="notif-empty">暂无下载记录</div>';
        return;
      }
      list.innerHTML = data.map(function(r) {
        return '<div class="notif-item notif-item-read" style="cursor:pointer" onclick="closeNotifDrawer();navToMaterial(' + r.material_id + ',\'' + esc(r.course_code) + '\',\'' + esc(r.course_name) + '\')">' +
          '<div class="notif-item-header">' +
            '<div class="notif-item-content">' +
              '<div class="notif-item-title">' + esc(r.material_title) + '</div>' +
              '<div class="notif-item-preview" style="color:var(--text-muted);font-size:0.75rem">' + esc(r.course_name) + ' · ' + esc(r.created_at) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    } catch(e) {
      list.innerHTML = '<div class="notif-empty">加载失败</div>';
    }
  }

  function renderDrawerMenu() {
    var body = document.getElementById('drawerMenuBody');
    if (!body || !currentUser) return;
    var initial = (currentUser.nickname || currentUser.username).charAt(0).toUpperCase();
    var avatarHtml = currentUser.avatar_url
      ? '<img src="' + esc(currentUser.avatar_url) + '" class="dm-avatar-img" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover">'
      : '<div class="dm-avatar">' + esc(initial) + '</div>';
    var roleLabel = currentUser.role === 'super_admin' ? '总管理' : currentUser.role === 'moderator' ? '版主' : currentUser.role === 'sub_moderator' ? '小版主' : '用户';
    var readSet = _getReadNotifSet();
    // 从未读计数（减掉本地已读缓存）
    var unreadCount = 0;
    var notifItems = document.querySelectorAll('.notif-item[data-nid]');
    if (notifItems.length) {
      notifItems.forEach(function(el) {
        var nid = parseInt(el.getAttribute('data-nid'));
        if (nid && !readSet.has(nid)) unreadCount++;
      });
    } else {
      var badgeEl = document.getElementById('notifBadge');
      if (badgeEl && badgeEl.style.display !== 'none' && badgeEl.textContent) {
        unreadCount = parseInt(badgeEl.textContent) || 0;
      }
    }
    var notifBadgeHtml = unreadCount > 0 ? '<span class="dm-badge">' + (unreadCount > 99 ? '99+' : unreadCount) + '</span>' : '';
    var showAdmin = currentUser.role !== 'user';
    var mgmtToggle = '<label class="dm-toggle-row"><span class="dm-toggle-label">📁 管理模式</span><span class="ios-toggle' + (_mgmtMode ? ' ios-toggle-on' : '') + '" onclick="toggleMgmtMode()"><span class="ios-toggle-knob"></span></span></label>';
    var civilianToggle = '<label class="dm-toggle-row"><span class="dm-toggle-label">🙈 平民模式</span><span class="ios-toggle' + (_civilianMode ? ' ios-toggle-on' : '') + '" onclick="toggleCivilianMode()"><span class="ios-toggle-knob"></span></span></label>';
    body.innerHTML =
      '<div class="dm-user">' +
        avatarHtml +
        '<div class="dm-info">' +
          '<div class="dm-name">' + esc(currentUser.nickname || currentUser.username) + '</div>' +
          '<div class="dm-role">' + roleLabel + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dm-divider"></div>' +
      '<a href="javascript:void(0)" class="dm-item" onclick="closeNotifDrawer();showProfile()"><span>👤</span> 个人中心</a>' +
      '<a href="javascript:void(0)" class="dm-item" onclick="showDrawerNotif()"><span>🔔</span> 通知中心' + notifBadgeHtml + '</a>' +
      '<a href="javascript:void(0)" class="dm-item" onclick="closeNotifDrawer();showMyUploadsPage()"><span>📤</span> 我的上传</a>' +
      '<a href="javascript:void(0)" class="dm-item" onclick="showDrawerDownloads()"><span>📥</span> 我的下载</a>' +
      '<div class="dm-divider"></div>' +
      (showAdmin ? mgmtToggle + civilianToggle + '<div class="dm-divider"></div>' : '') +
      '<a href="javascript:void(0)" class="dm-item dm-logout" onclick="logout()"><span>🚪</span> 退出登录</a>';
  }

  function closeNotifDrawer(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('notifDrawer').style.display = 'none';
    unlockScroll();
  }

  // ── 模式切换（Iter 6） ──
  function toggleMgmtMode() {
    _mgmtMode = !_mgmtMode;
    if (_mgmtMode) {
      // 打开管理模式 → 自动关闭平民模式
      _civilianMode = false;
      localStorage.setItem('bnusparks_civilian', '0');
    }
    localStorage.setItem('bnusparks_mgmt', _mgmtMode ? '1' : '0');
    renderDrawerMenu();
    // 如果当前在 explorer 视图，立刻刷新
    var exp = document.getElementById('explorerView');
    if (exp && exp.style.display !== 'none') renderExplorer();
    // 平民模式：显示侧边栏管理入口
    document.querySelectorAll('#sideAdminLink, #mobAdminLink').forEach(function(link) {
      link.style.display = (currentUser && currentUser.role !== 'user') ? '' : 'none';
    });
  }

  function toggleCivilianMode() {
    _civilianMode = !_civilianMode;
    if (_civilianMode) {
      // 打开平民模式 → 自动关闭管理模式
      _mgmtMode = false;
      localStorage.setItem('bnusparks_mgmt', '0');
      // 刷新 explorer（去掉管理模式 UI）
      var exp = document.getElementById('explorerView');
      if (exp && exp.style.display !== 'none') renderExplorer();
    }
    localStorage.setItem('bnusparks_civilian', _civilianMode ? '1' : '0');
    renderDrawerMenu();
    // 平民模式：隐藏侧边栏管理入口
    document.querySelectorAll('#sideAdminLink, #mobAdminLink').forEach(function(link) {
      link.style.display = (_civilianMode || !currentUser || currentUser.role === 'user') ? 'none' : '';
    });
  }

  function isMgmtActive() { return _mgmtMode && !_civilianMode && currentUser && currentUser.role !== 'user'; }

  async function loadNotifications() {
    const list = document.getElementById('notifList');
    const badge = document.getElementById('notifBadge');
    try {
      const data = await api('/api/auth/notifications/');
      // 合并本地已读缓存与服务器数据
      var readSet = _getReadNotifSet();
      var realUnread = 0;
      if (data.list) {
        data.list.forEach(function(n) {
          if (!n.is_read && !readSet.has(n.id)) realUnread++;
        });
      }
      if (realUnread > 0) {
        badge.textContent = realUnread > 99 ? '99+' : realUnread;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }

      if (!data.list || !data.list.length) {
        list.innerHTML = '<p class="notif-empty">暂无通知</p>';
        return;
      }
      var html = data.list.map(function(n) {
        var isRead = n.is_read || readSet.has(n.id);
        var unreadClass = isRead ? 'notif-item-read' : 'notif-item-unread';
        var msgPreview = n.message ? (n.message.length > 40 ? esc(n.message).slice(0, 40) + '…' : esc(n.message)) : '';
        // 审核异议链接到管理后台
        var linkHtml = '';
        if (n.material_id) {
          if (n.type === 'disagree') {
            linkHtml = '<div class="notif-item-link"><a href="javascript:void(0)" onclick="closeNotifDrawer();navToReviewDispute(' + n.material_id + ')">管理后台查看异议 →</a></div>';
          } else if (n.type === 'rejected') {
            linkHtml = '<div class="notif-item-link"><a href="javascript:void(0)" onclick="navToReUpload(\'' + esc(n.course_code || '') + '\',\'' + esc(n.course_name || '') + '\')" style="font-weight:600">↻ 跳转到文件目录并重新上传 →</a></div>';
          } else {
            linkHtml = '<div class="notif-item-link"><a href="javascript:void(0)" onclick="closeNotifDrawer();navToMaterial(' + n.material_id + ',\'' + esc(n.course_code || '') + '\',\'' + esc(n.course_name || '') + '\')">查看相关资料 →</a></div>';
          }
        }
        return '<div class="notif-item ' + unreadClass + '" data-nid="' + n.id + '">' +
          '<div class="notif-item-header" onclick="toggleNotifExpand(' + n.id + ', ' + (isRead ? 'true' : 'false') + ', this)">' +
            '<div class="notif-item-dot"></div>' +
            '<div class="notif-item-content">' +
              '<div class="notif-item-title">' + esc(n.title) + '</div>' +
              (msgPreview ? '<div class="notif-item-preview">' + msgPreview + '</div>' : '') +
            '</div>' +
            '<div class="notif-item-time">' + esc(n.created_at) + '</div>' +
            '<span class="notif-expand-icon">▾</span>' +
          '</div>' +
          '<div class="notif-item-body" style="display:none" data-body="' + n.id + '">' +
            '<div class="notif-item-fullmsg">' + (n.message ? esc(n.message) : '') + '</div>' +
            linkHtml +
            '<div style="margin-top:8px;display:flex;gap:6px">' +
              (isRead ? '' : '<button class="notif-mark-btn" onclick="markOneNotifRead(' + n.id + ', this.closest(\'.notif-item\'), event)">标为已读</button>') +
              '<button class="notif-mark-btn" onclick="deleteOneNotif(' + n.id + ', this.closest(\'.notif-item\'), event)" style="color:var(--accent)">🗑 删除</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
      if (data.list.length > 0) {
        html += '<div style="padding:8px;text-align:center;display:flex;justify-content:center;gap:12px;font-size:0.78rem"><a href="javascript:void(0)" onclick="closeNotifDrawer();showNotifFull()" class="notif-view-all">📋 查看全部通知</a><a href="javascript:void(0)" onclick="clearAllNotifs()" style="color:var(--accent);text-decoration:none">🗑 清空通知</a></div>';
      }
      list.innerHTML = html;
    } catch (err) {
      list.innerHTML = '<p class="notif-empty">加载失败</p>';
    }
  }

  function toggleNotifExpand(nid, isRead, headerEl) {
    var item = headerEl.closest('.notif-item');
    var body = item ? item.querySelector('.notif-item-body') : null;
    if (!body) return;
    var isOpen = body.style.display === 'block';
    if (isOpen) {
      body.style.display = 'none';
      headerEl.querySelector('.notif-expand-icon').classList.remove('expanded');
    } else {
      // 自动折叠其他打开的项
      document.querySelectorAll('.notif-item-body').forEach(function(b) {
        if (b !== body && b.style.display === 'block') {
          b.style.display = 'none';
          var h = b.closest('.notif-item');
          if (h) { var icon = h.querySelector('.notif-expand-icon'); if (icon) icon.classList.remove('expanded'); }
        }
      });
      body.style.display = 'block';
      headerEl.querySelector('.notif-expand-icon').classList.add('expanded');
      // 未读通知展开时自动标为已读
      if (!isRead) {
        _addReadNotif(nid);
        api('/api/auth/notifications/' + nid + '/read/', { method: 'POST' }).catch(function(err) {
          console.warn('标记已读 API 失败:', err);
        });
        item.classList.remove('notif-item-unread');
        item.classList.add('notif-item-read');
        var badge = document.getElementById('notifBadge');
        if (badge && badge.style.display !== 'none') {
          var c = parseInt(badge.textContent) || 0;
          if (c > 1) badge.textContent = c - 1;
          else badge.style.display = 'none';
        }
        // 隐藏 body 内的标为已读按钮
        var markBtn = body.querySelector('.notif-mark-btn');
        if (markBtn) markBtn.style.display = 'none';
      }
    }
  }

  function navToMaterial(materialId, courseCode, courseName) {
    closeNotifDrawer();
    if (courseCode) {
      var type = courseCode.startsWith('GEN') ? '通识课' : '专业课';
      showExplorer(type);
      // 用 rAF 替代脆弱的 setTimeout，在下一个渲染帧执行导航
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          navToLast(courseCode);
        });
      });
    } else {
      showHome();
    }
  }

  // 驳回通知 → 跳转到文件目录并自动打开上传弹窗
  function navToReUpload(courseCode, courseName) {
    closeNotifDrawer();
    if (!courseCode) { showHome(); return; }
    var type = courseCode.startsWith('GEN') ? '通识课' : '专业课';
    showExplorer(type);
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        navToLast(courseCode);
        setTimeout(function() { showUploadModal(courseCode, courseName); }, 200);
      });
    });
  }

  async function markOneNotifRead(nid, el, event) {
    if (event) event.stopPropagation();
    _addReadNotif(nid);
    try {
      await api('/api/auth/notifications/' + nid + '/read/', { method: 'POST' });
      if (el) {
        el.classList.remove('notif-item-unread');
        el.classList.add('notif-item-read');
      }
      // 更新未读计数
      await loadNotifCount();
      // 隐藏按钮
      var btn = el ? el.querySelector('.notif-mark-btn') : null;
      if (btn) btn.style.display = 'none';
    } catch (err) { console.warn('标记已读 API 失败:', err); }
  }

  async function markAllNotifRead() {
    // 先更新本地缓存（无论 API 成败，UI 立即反映）
    var list = document.getElementById('notifList');
    var ids = [];
    if (list) {
      list.querySelectorAll('.notif-item').forEach(function(el) {
        var nid = parseInt(el.getAttribute('data-nid'));
        if (nid) ids.push(nid);
      });
    }
    _addAllReadNotifs(ids);
    // 后台尝试通知服务器（不阻塞 UI）
    try {
      await api('/api/auth/notifications/', { method: 'POST' });
    } catch (err) { console.warn('全部标为已读 API 失败:', err); }
    _notifLoaded = false;
    loadNotifications();
  }

  async function deleteOneNotif(nid, el, event) {
    if (event) event.stopPropagation();
    if (!confirm('确认删除此通知？')) return;
    try {
      await api('/api/auth/notifications/' + nid + '/read/', { method: 'DELETE' });
      if (el) el.remove();
      await loadNotifCount();
    } catch (err) { console.warn('删除通知失败:', err); }
  }

  async function clearAllNotifs() {
    if (!confirm('确认清空所有通知？此操作不可撤销。')) return false;
    try {
      await api('/api/auth/notifications/', { method: 'DELETE' });
      _notifLoaded = false;
      loadNotifications();
      await loadNotifCount();
      return true;
    } catch (err) { console.warn('清空通知失败:', err); return false; }
  }

  function clearAllNotifsFull() {
    clearAllNotifs().then(function(ok) { if (ok) renderNotifFull(); });
  }

  function navToReviewDispute(materialId) {
    if (!currentUser || currentUser.role === 'user') {
      alert('仅管理员可查看审核异议详情');
      return;
    }
    showAdminPanel();
    _highlightDisputeMaterialId = materialId;
    switchAdminTab('history');
  }

  // ── 通知中心完整页 ──
  function showNotifFull() {
    document.querySelectorAll('.view-section').forEach(function(v) { v.style.display = 'none'; });
    var v = document.getElementById('notifView');
    if (v) v.style.display = 'block';
    switchView('notif');
    updateSidebar('home');
    window.scrollTo({ top: 0 });
    pushViewState('notif', {});
    renderNotifFull();
  }

  function renderNotifFull() {
    var el = document.getElementById('notifFullContent');
    if (!el) return;
    el.innerHTML = '<div class="admin-loading">加载中…</div>';
    api('/api/auth/notifications/').then(function(data) {
      var readSet = _getReadNotifSet();
      var realUnread = 0;
      if (data.list) {
        data.list.forEach(function(n) { if (!n.is_read && !readSet.has(n.id)) realUnread++; });
      }
      var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        '<span style="font-size:0.85rem;color:var(--text-muted)">共 ' + (data.list ? data.list.length : 0) + ' 条' + (realUnread > 0 ? '，' + realUnread + ' 条未读' : '') + '</span>' +
        '<div style="display:flex;gap:6px">' +
          (realUnread > 0 ? '<button class="admin-btn admin-btn-sm" onclick="markAllNotifFullRead()">全部标为已读</button>' : '') +
          '<button class="admin-btn admin-btn-sm" onclick="clearAllNotifsFull()" style="color:var(--accent)">🗑 清空通知</button>' +
        '</div>' +
        '</div>';
      if (!data.list || !data.list.length) {
        html += '<div class="admin-empty">暂无通知</div>';
        el.innerHTML = html;
        return;
      }
      html += '<div class="notif-full-list">';
      data.list.forEach(function(n) {
        var isRead = n.is_read || readSet.has(n.id);
        html += '<div class="notif-full-item' + (isRead ? '' : ' notif-full-item-unread') + '" data-nid="' + n.id + '">' +
          '<div class="notif-full-header" onclick="toggleFullNotif(' + n.id + ', this)">' +
            '<div class="notif-full-dot' + (isRead ? '' : ' unread') + '"></div>' +
            '<div class="notif-full-info">' +
              '<div class="notif-full-title">' + esc(n.title) + '</div>' +
              '<div class="notif-full-meta">' + esc(n.created_at) + ' · ' + esc(n.type || '通知') + '</div>' +
            '</div>' +
            '<span class="notif-expand-icon">▾</span>' +
          '</div>' +
          '<div class="notif-full-body" style="display:none">' +
            '<div class="notif-full-msg">' + (n.message ? esc(n.message) : '') + '</div>' +
            (n.material_id ? '<div class="notif-full-link">' + (n.type === 'disagree' ? '<a href="javascript:void(0)" onclick="closeNotifDrawer();navToReviewDispute(' + n.material_id + ')">管理后台查看异议 →</a>' : '<a href="javascript:void(0)" onclick="navToMaterial(' + n.material_id + ',\'' + esc(n.course_code || '') + '\',\'' + esc(n.course_name || '') + '\')">查看相关资料 →</a>') + '</div>' : '') +
          '</div>' +
        '</div>';
      });
      html += '</div>';
      el.innerHTML = html;
    }).catch(function(err) {
      el.innerHTML = '<div class="admin-empty">加载失败</div>';
    });
  }

  function toggleFullNotif(nid, headerEl) {
    var item = headerEl.closest('.notif-full-item');
    var body = item ? item.querySelector('.notif-full-body') : null;
    if (!body) return;
    var isOpen = body.style.display === 'block';
    // 自动折叠其他打开的项
    if (!isOpen) {
      document.querySelectorAll('.notif-full-body').forEach(function(b) {
        if (b !== body && b.style.display === 'block') {
          b.style.display = 'none';
          var h = b.closest('.notif-full-item');
          if (h) { var icon = h.querySelector('.notif-expand-icon'); if (icon) icon.classList.remove('expanded'); }
        }
      });
    }
    body.style.display = isOpen ? 'none' : 'block';
    headerEl.querySelector('.notif-expand-icon').classList.toggle('expanded', !isOpen);
    // 未读自动标记已读
    if (!isOpen && item && item.classList.contains('notif-full-item-unread')) {
      _addReadNotif(nid);
      api('/api/auth/notifications/' + nid + '/read/', { method: 'POST' }).catch(function(){});
      item.classList.remove('notif-full-item-unread');
      // 通知抽屉同步更新
      var drawerItem = document.querySelector('.notif-item[data-nid="' + nid + '"]');
      if (drawerItem) { drawerItem.classList.remove('notif-item-unread'); drawerItem.classList.add('notif-item-read'); }
    }
  }

  function markAllNotifFullRead() {
    var ids = [];
    document.querySelectorAll('.notif-full-item').forEach(function(el) {
      var nid = parseInt(el.getAttribute('data-nid'));
      if (nid) ids.push(nid);
    });
    _addAllReadNotifs(ids);
    api('/api/auth/notifications/', { method: 'POST' }).catch(function(){});
    document.querySelectorAll('.notif-full-item').forEach(function(el) { el.classList.remove('notif-full-item-unread'); });
    document.querySelectorAll('.notif-item').forEach(function(el) { el.classList.remove('notif-item-unread'); el.classList.add('notif-item-read'); });
    renderNotifFull();
    var badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
  }

  // ── 管理后台（Iter 3） ──
  function showAdminPanel() {
    if (!currentUser || (currentUser.role !== 'moderator' && currentUser.role !== 'super_admin' && currentUser.role !== 'sub_moderator')) {
      if (currentUser) alert('权限不足');
      return;
    }
    // 直接操作 display 避免 CSS 类冲突
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.style.display = 'none';
    });
    var av = document.getElementById('adminView');
    if (av) av.style.display = 'block';
    updateSidebar('admin');
    window.scrollTo({ top: 0 });
    pushViewState('admin', {});
    // 确保"我的上传"区域被隐藏（不在 .view-section 中）
    var uploadsSec = document.getElementById('myUploadsSection');
    if (uploadsSec) uploadsSec.style.display = 'none';
    loadAdminPanel();
  }

  function loadAdminPanel() {
    var content = document.getElementById('adminContent');
    if (!content) return;
    // 隐藏用户管理 tab（仅 super_admin 可见）
    var usersTab = document.getElementById('adminUsersTab');
    if (usersTab) {
      usersTab.style.display = currentUser && currentUser.role === 'super_admin' ? '' : 'none';
    }
    // 显示操作记录 tab（所有管理员可见）
    var opTab = document.querySelector('.admin-tab[data-tab="operations"]');
    if (opTab) opTab.style.display = '';
    // 绑定 tab 切换（保存 tab 状态到 sessionStorage）
    document.querySelectorAll('.admin-tab').forEach(function(tab) {
      tab.onclick = function() {
        document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        var tabName = tab.getAttribute('data-tab');
        sessionStorage.setItem('bnusparks_admin_tab', tabName);
        switchAdminTab(tabName);
      };
    });
    // 从 sessionStorage 恢复上次的 tab
    var savedTab = sessionStorage.getItem('bnusparks_admin_tab') || 'overview';
    document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
    var tabBtn = document.querySelector('.admin-tab[data-tab="' + savedTab + '"]');
    if (tabBtn) tabBtn.classList.add('active');
    switchAdminTab(savedTab);
  }

  function switchAdminTab(tab) {
    var content = document.getElementById('adminContent');
    if (!content) return;
    if (tab === 'overview') renderAdminOverview(content);
    else if (tab === 'pending') renderAdminPending(content);
    else if (tab === 'history') renderAdminHistory(content, 1);
    else if (tab === 'deletions') renderAdminDeletions(content, 1);
    else if (tab === 'users') renderAdminUsers(content, '');
    else if (tab === 'operations') renderAdminOperations(content);
  }

  // ── 文件管理模式 ──
  var _fileMgmtMode = false;

  function renderFileManager(content) {
    content.innerHTML = '<div class="admin-loading">加载课程树…</div>';
    api('/api/courses/tree/').then(function(tree) {
      var html = '<div class="fm-header"><h3>📁 文件管理模式</h3><p style="font-size:0.8rem;color:var(--text-muted)">在此模式下，可管理文件夹和文件。点击文件夹进入管理。</p></div>';
      html += '<div class="fm-tree">';
      for (var rootKey in tree) {
        html += renderFmRoot(rootKey, tree[rootKey]);
      }
      html += '</div>';
      content.innerHTML = html;
      // 点击文件夹进入管理
      content.querySelectorAll('.fm-node[data-path]').forEach(function(el) {
        el.addEventListener('click', function(e) {
          if (e.target.closest('.fm-action-btn')) return;
          var path = this.dataset.path;
          if (path) openFmPath(JSON.parse(path));
        });
      });
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">加载失败：' + err.message + '</div>';
    });
  }

  function renderFmRoot(rootKey, node) {
    var html = '<div class="fm-root"><div class="fm-root-title">' + esc(rootKey) + '</div>';
    if (node.children) {
      html += '<div class="fm-children">';
      node.children.forEach(function(child) {
        html += renderFmNode(child, [rootKey]);
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderFmNode(node, parentPath) {
    if (node.divider) return '';
    var hasChildren = node.children && node.children.length > 0;
    var path = parentPath.concat([node.name]);
    var pathStr = JSON.stringify(path);
    var html = '<div class="fm-node" data-path=\'' + pathStr + '\'>';
    html += '<span class="fm-node-icon">' + (hasChildren || node.courseId ? (node.courseId ? '📄' : '📁') : '·') + '</span>';
    html += '<span class="fm-node-name">' + esc(node.name) + '</span>';
    html += '<span class="fm-node-actions">';
    if (node.courseId) {
      // 有 courseId → 该节点是课程，可直接进入文件管理
      html += '<button class="fm-action-btn" onclick="event.stopPropagation();openFmCourse(\'' + esc(node.courseId) + '\',\'' + esc(node.name) + '\')">📋 管理文件</button>';
    } else if (hasChildren) {
      html += '<button class="fm-action-btn" onclick="event.stopPropagation();openFmPath(' + pathStr + ')">📂 进入</button>';
    }
    html += '</span>';
    html += '</div>';
    if (hasChildren) {
      html += '<div class="fm-children">';
      node.children.forEach(function(child) {
        html += renderFmNode(child, path);
      });
      html += '</div>';
    }
    return html;
  }

  function openFmCourse(courseCode, courseName) {
    // 进入文件管理模式：显示该课程的文件，每行带管理按钮
    _fileMgmtMode = true;
    // 需要把 explorer view 的路径设置为课程所在的树路径
    // 先尝试用 findPathByCourseId 找到路径
    var path = findPathByCourseId(courseCode);
    if (!path) {
      // 无路径则直接用首页的通识课/专业课
      var type = courseCode.startsWith('GEN') ? '通识课' : '专业课';
      path = [type];
    }
    expPath = path;
    pushViewState('explorer', { expPath: [...expPath] });
    renderExplorer();
    switchView('explorer');
    // 刷新侧边栏
    updateSidebar(path[0] === '通识课' ? 'general' : 'major');
    // 强制重新渲染文件表带管理按钮
    // 注意：renderExplorer 会调用 renderFiles，而 renderFiles 读 _fileMgmtMode 变量
  }

  function openFmPath(path) {
    // 导航到该路径
    expPath = path;
    pushViewState('explorer', { expPath: [...expPath] });
    renderExplorer();
    switchView('explorer');
    updateSidebar(path[0] === '通识课' ? 'general' : 'major');
  }

  // ── 概览 ──
  function renderAdminOverview(content) {
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    Promise.all([
      api('/api/moderation/stats/'),
      api('/api/auth/profile/')
    ]).then(function(results) {
      var stats = results[0];
      var profile = results[1];
      var html = '<div class="admin-stats-grid">' +
        '<div class="admin-stat-card"><div class="stat-number">' + (stats.pending_count || 0) + '</div><div class="stat-label">⏳ 待审核</div></div>' +
        '<div class="admin-stat-card"><div class="stat-number">' + (stats.total_approved || 0) + '</div><div class="stat-label">✅ 已通过</div></div>' +
        '<div class="admin-stat-card"><div class="stat-number">' + (stats.approved_today || 0) + '</div><div class="stat-label">📈 今日通过</div></div>' +
        '<div class="admin-stat-card"><div class="stat-number">' + (stats.total_materials || 0) + '</div><div class="stat-label">📦 管辖范围总数</div></div>' +
        '</div>';
      // 待审核快速入口
      if (stats.pending_count > 0) {
        html += '<div style="margin-top:12px"><button class="admin-btn admin-btn-primary" onclick="switchAdminTab(\'pending\');document.querySelector(\'[data-tab=pending]\').click()">查看 ' + stats.pending_count + ' 条待审核资料 →</button></div>';
      }
      // 自动托管开关（仅版主/小版主有 can_auto_approve 时显示）
      if (profile.can_auto_approve) {
        var isOn = profile.auto_approve;
        html += '<div class="admin-auto-toggle" style="margin-top:16px;padding:10px 14px;background:var(--card-bg);border-radius:8px;display:flex;align-items:center;justify-content:space-between">' +
          '<span><strong>🤖 自动托管审核</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">开启后自动通过管辖板块内所有新上传的资料</span></span>' +
          '<button class="admin-btn ' + (isOn ? 'admin-btn-approve' : 'admin-btn-secondary') + '" onclick="toggleAutoApprove(this)">' + (isOn ? '✅ 已开启' : '⏸ 已关闭') + '</button>' +
        '</div>';
      }
      content.innerHTML = html;
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">加载失败：' + err.message + '</div>';
    });
  }

  // ── 待审核 ──
  var _pendingIncludeSub = false;
  var _pendingHidePeerApproved = false;
  var _highlightDisputeMaterialId = null;

  function renderAdminPending(content) {
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    var url = '/api/moderation/pending/';
    var params = [];
    if (_pendingIncludeSub) params.push('include_subordinate=1');
    if (_pendingHidePeerApproved) params.push('hide_peer_approved=1');
    if (params.length) url += '?' + params.join('&');
    // 同时加载待审核数据和当前用户资料（自动托管状态）
    Promise.all([
      api(url),
      api('/api/auth/profile/')
    ]).then(function(results) {
      var list = results[0];
      var profile = results[1];

      var html = '';

      // 自动托管开关（仅版主/小版主有 can_auto_approve 时显示）
      if (profile.can_auto_approve) {
        var isOn = profile.auto_approve;
        html += '<div class="admin-auto-toggle" style="margin-bottom:12px;padding:10px 14px;background:var(--card-bg);border-radius:8px;display:flex;align-items:center;justify-content:space-between">' +
          '<span><strong>🤖 自动托管审核</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">开启后自动通过管辖板块内所有新上传的资料</span></span>' +
          '<button class="admin-btn ' + (isOn ? 'admin-btn-approve' : 'admin-btn-secondary') + '" onclick="toggleAutoApprove(this)">' + (isOn ? '✅ 已开启' : '⏸ 已关闭') + '</button>' +
        '</div>';
      }

      // 工具条：下级板块切换 + 一键过审
      var isMod = currentUser && (currentUser.role === 'moderator' || currentUser.role === 'super_admin');
      var hasSubItems = list && list.some(function(m) { return m.is_subordinate_handled; });
      html += '<div class="pc-toolbar">';
      if (isMod) {
        html += '<label class="pc-toolbar-toggle" title="启用后显示下级版主管辖板块的待审核资料">' +
          '<input type="checkbox" ' + (_pendingIncludeSub ? 'checked' : '') + ' onchange="togglePendingIncludeSub(this.checked)"> 显示下级板块' +
        '</label>' +
        '<label class="pc-toolbar-toggle" title="隐藏同僚已通过的记录，只显示待审核">' +
          '<input type="checkbox" ' + (_pendingHidePeerApproved ? 'checked' : '') + ' onchange="togglePendingHidePeerApproved(this.checked)"> 隐藏同僚已通过' +
        '</label>';
      } else {
        html += '<span></span>';
      }
      // 一键过审（仅当有待审核且非自己的上传时显示）
      var hasApprovable = list && list.some(function(m) { return !m.is_peer_approved && !m.is_own; });
      if (hasApprovable) {
        html += '<button class="admin-btn admin-btn-approve" onclick="batchApprovePending(this)">⚡ 一键通过全部</button>';
      }
      html += '</div>';

      if (!list || list.length === 0) {
        html += '<div class="admin-empty">🎉 没有待审核的资料</div>';
        content.innerHTML = html;
        return;
      }

      html += '<div class="admin-pending-list">';

      var hasPeerApproved = list.some(function(m) { return m.is_peer_approved; });
      var hasMyPending = list.some(function(m) { return !m.is_peer_approved; });

      // ─── 所有待审核（含下级版主分流内容，上级可越级操作） ───
      if (hasMyPending) {
        if (hasPeerApproved) html += '<div class="pc-section-label">⏳ 待审核</div>';
        list.forEach(function(m) {
          if (m.is_peer_approved) return;
          var isSuperAdmin = currentUser && currentUser.role === 'super_admin';
          var subTag = m.is_subordinate_handled ? '<span class="sub-tag">下级版主</span>' : '';
          html += '<div class="admin-pending-card' + (m.is_subordinate_handled ? ' pc-sub-handled' : '') + '" id="pc-' + m.id + '">' +
            subTag +
            '<div class="pc-title">' + escapeHtml(m.title) + '</div>' +
            '<div class="pc-meta">' +
              '<span>📚 ' + escapeHtml(m.course_name) + ' (' + m.course_code + ')</span>' +
              '<span>👤 ' + escapeHtml(m.uploader_name) + '</span>' +
              '<span>📅 ' + m.created_at + '</span>' +
              '<span>📄 ' + formatFileSize(m.file_size) + '</span>' +
            '</div>';
          if (m.is_own) {
            html += '<div class="pc-own">你的上传，等待其他审核员处理</div>';
          } else {
            html += '<div class="pc-actions">' +
              '<button class="admin-btn admin-btn-secondary pc-btn-detail" onclick="showPendingFileDetail(' + m.id + ')" title="查看文件详情">📄 详情</button>' +
              '<button class="admin-btn admin-btn-secondary" onclick="doDirectDownload(' + m.id + ')" title="下载文件进行审核">⬇ 下载</button>' +
              '<button class="admin-btn admin-btn-approve" onclick="quickApprove(' + m.id + ')">✓ 通过</button>' +
              '<button class="admin-btn admin-btn-reject" onclick="showRejectDialog(' + m.id + ')">✗ 驳回</button>' +
              (isSuperAdmin ? '<button class="admin-btn admin-btn-secondary" onclick="showReassignDialog(' + m.id + ')" title="手动指派审核人">↗ 指派</button>' : '') +
            '</div>';
          }
          html += '</div>';
        });
      }

      // ─── 同僚已通过（24h 内可提出异议） ───
      if (hasPeerApproved && !_pendingHidePeerApproved) {
        if (hasMyPending) html += '<div class="pc-section-divider"></div>';
        html += '<div class="pc-section-label">✅ 同僚已通过（24h 内可提出异议）</div>';
        list.forEach(function(m) {
          if (!m.is_peer_approved) return;
          html += '<div class="admin-pending-card pc-peer-approved" id="pc-' + m.id + '">' +
            '<div class="pc-title">' + escapeHtml(m.title) + '</div>' +
            '<div class="pc-meta">' +
              '<span>📚 ' + escapeHtml(m.course_name) + ' (' + m.course_code + ')</span>' +
              '<span>👤 ' + escapeHtml(m.uploader_name) + '</span>' +
              '<span>📅 ' + m.created_at + '</span>' +
              '<span>📄 ' + formatFileSize(m.file_size) + '</span>' +
            '</div>' +
            '<div class="pc-peer-approved-badge">✅ 已被 ' + escapeHtml(m.approved_by_name) + ' 于 ' + m.approved_at + ' 审核通过</div>' +
            '<div class="pc-actions" style="margin-top:8px">' +
              '<button class="admin-btn admin-btn-secondary" onclick="showPendingFileDetail(' + m.id + ')" title="查看文件详情">📄 详情</button>' +
              '<button class="admin-btn admin-btn-secondary" onclick="doDirectDownload(' + m.id + ')" title="下载文件查看">⬇ 下载查看</button>' +
              '<button class="admin-btn admin-btn-sm" onclick="showObjectionDialog(' + m.id + ', \'' + escapeHtml(m.title) + '\')">💬 提出异议</button>' +
            '</div>' +
          '</div>';
        });
      }

      html += '</div>';
      content.innerHTML = html;
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">加载失败：' + err.message + '</div>';
    });
  }

  function togglePendingIncludeSub(checked) {
    _pendingIncludeSub = checked;
    renderAdminPending(document.getElementById('adminContent'));
  }

  function togglePendingHidePeerApproved(checked) {
    _pendingHidePeerApproved = checked;
    renderAdminPending(document.getElementById('adminContent'));
  }

  function batchApprovePending(btn) {
    if (btn) { btn.textContent = '⏳ 处理中…'; btn.disabled = true; }
    api('/api/moderation/batch-approve/', { method: 'POST' }).then(function(result) {
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('批量过审失败：' + err.message);
      renderAdminPending(document.getElementById('adminContent'));
    });
  }

  function quickApprove(id) {
    api('/api/moderation/' + id + '/approve/', { method: 'POST', body: {} }).then(function() {
      var card = document.getElementById('pc-' + id);
      if (card) card.style.opacity = '0.3';
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('操作失败：' + err.message);
    });
  }

  function toggleAutoApprove(btn) {
    api('/api/auth/profile/').then(function(profile) {
      var newVal = !profile.auto_approve;
      var uid = currentUser ? currentUser.id : 0;
      // 使用后端 toggle API
      return api('/api/admin/users/' + uid + '/auto-approve/', {
        method: 'POST',
        body: { auto_approve: newVal }
      });
    }).then(function(result) {
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('操作失败：' + err.message);
    });
  }

  function _removeOverlay(el) {
    if (el) { el.remove(); unlockScroll(); _popModalHistory(); }
  }

  function showRejectDialog(id) {
    // 移除已有弹窗
    var old = document.querySelector('.admin-reject-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay';
    overlay.innerHTML =
      '<div class="admin-reject-dialog">' +
        '<h3>驳回原因</h3>' +
        '<textarea id="rejectNotes" placeholder="请填写驳回原因（必填）"></textarea>' +
        '<div class="ar-error" id="rejectError">驳回原因不能为空</div>' +
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-reject" onclick="confirmReject(' + id + ')">确认驳回</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
    // 自动聚焦
    setTimeout(function() { document.getElementById('rejectNotes').focus(); }, 100);
  }

  function confirmReject(id) {
    var notes = document.getElementById('rejectNotes').value.trim();
    var errEl = document.getElementById('rejectError');
    if (!notes) {
      if (errEl) errEl.style.display = 'block';
      return;
    }
    if (errEl) errEl.style.display = 'none';
    api('/api/moderation/' + id + '/reject/', { method: 'POST', body: { notes: notes } }).then(function() {
      var overlay = document.querySelector('.admin-reject-overlay');
      _removeOverlay(overlay);
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('操作失败：' + err.message);
    });
  }

  // ── 文件删除 ──
  function deleteFileConfirm(fileId, btn) {
    if (!confirm('确认删除此文件？此操作不可撤销。')) return;
    var overlay = btn && btn.closest('.file-info-overlay');
    api('/api/files/' + fileId + '/delete/', { method: 'DELETE' }).then(function() {
      if (overlay) overlay.remove();
      // 删除成功后刷新当前课程的文件列表
      var tbody = document.getElementById('fileTableBody');
      if (tbody) {
        var row = tbody.querySelector('tr[data-file-id="' + fileId + '"]');
        if (row) row.remove();
        // 更新文件计数
        var fc = document.getElementById('fileCount');
        if (fc) { var fm = fc.textContent.match(/(\d+)/); if (fm) { fc.textContent = (parseInt(fm[1]) - 1) + ' 个文件'; } }
        // 如果表为空，显示空提示
        if (!tbody.querySelector('tr[data-file-id]')) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint);padding:40px">暂无资料</td></tr>';
          var pag = document.getElementById('filePagination');
          if (pag) pag.style.display = 'none';
        }
      }
    }).catch(function(err) {
      alert('删除失败：' + err.message);
    });
  }

  // ── 审核界面查看待审资料详情 ──
  function showPendingFileDetail(materialId) {
    // 尝试从当前 pending list 中获取数据
    var card = document.getElementById('pc-' + materialId);
    if (!card) {
      // 降级：显示最简单的弹窗
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay file-info-overlay';
      overlay.innerHTML = '<div class="modal-card file-info-card" style="max-width:400px"><button class="modal-close" onclick="closeFileInfoModal(event)">✕</button><h2 class="modal-title">资料 #' + materialId + '</h2><div class="file-info-content"><p style="color:var(--text-muted)">加载详情中…</p></div></div>';
      document.body.appendChild(overlay);
      lockScroll();
      _pushModalHistory();
      // 尝试从 API 获取
      api('/api/user/uploads/').then(function(data) {
        var item = data ? data.find(function(m) { return m.id === materialId; }) : null;
        if (item && overlay) {
          overlay.querySelector('.file-info-content').innerHTML =
            '<div class="fi-row"><span class="fi-label">标题</span><span class="fi-value">' + esc(item.title) + '</span></div>' +
            '<div class="fi-row"><span class="fi-label">课程</span><span class="fi-value">' + esc(item.course_name) + ' (' + esc(item.course_code) + ')</span></div>' +
            '<div class="fi-row"><span class="fi-label">任课教师</span><span class="fi-value">' + esc(item.teacher || '未填写') + '</span></div>' +
            '<div class="fi-row"><span class="fi-label">大小</span><span class="fi-value">' + formatSize(item.file_size) + '</span></div>' +
            (item.description ? '<div class="fi-row fi-row-desc"><span class="fi-label">简介</span><span class="fi-value">' + esc(item.description) + '</span></div>' : '') +
            '<div style="text-align:center;margin-top:12px"><button class="fi-download-btn" onclick="doDirectDownload(' + item.id + ')">⬇ 下载文件</button></div>';
        }
      }).catch(function(){});
      return;
    }
    // 直接从卡片 DOM 提取信息
    var title = card.querySelector('.pc-title') ? card.querySelector('.pc-title').textContent : '';
    var metaEls = card.querySelectorAll('.pc-meta span');
    var courseName = '', uploader = '', createdAt = '', fileSize = '';
    if (metaEls[0]) courseName = metaEls[0].textContent.replace(/^📚 /, '');
    if (metaEls[1]) uploader = metaEls[1].textContent.replace(/^👤 /, '');
    if (metaEls[2]) createdAt = metaEls[2].textContent.replace(/^📅 /, '');
    if (metaEls[3]) fileSize = metaEls[3].textContent.replace(/^📄 /, '');
    // 渲染详情弹窗
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay file-info-overlay';
    overlay.innerHTML =
      '<div class="modal-card file-info-card">' +
        '<button class="modal-close" onclick="closeFileInfoModal(event)">✕</button>' +
        '<h2 class="modal-title" style="padding-right:28px">' + esc(title) + '</h2>' +
        '<div class="file-info-content">' +
          '<div class="fi-row"><span class="fi-label">课程</span><span class="fi-value">' + esc(courseName) + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">上传者</span><span class="fi-value">' + esc(uploader) + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">大小</span><span class="fi-value">' + esc(fileSize) + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">上传时间</span><span class="fi-value">' + esc(createdAt) + '</span></div>' +
          '<div style="text-align:center;margin-top:12px"><button class="fi-download-btn" onclick="doDirectDownload(' + materialId + ');closeFileInfoModal(event)">⬇ 下载文件</button></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    lockScroll();
    _pushModalHistory();
    overlay.addEventListener('click', function(e) { if (e.target === this) closeFileInfoModal(e); });
  }

  // ── 审核历史 ──
  function renderAdminHistory(content, page) {
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    api('/api/moderation/history/?page=' + page + '&per_page=20').then(function(data) {
      if (!data.items || data.items.length === 0) {
        content.innerHTML = '<div class="admin-empty">暂无审核历史</div>';
        return;
      }
      var html = '<div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr>' +
          '<th>资料</th><th>课程</th><th>上传者</th><th>审核人</th><th>结果</th><th>备注</th><th>审核时间</th><th>操作</th>' +
        '</tr></thead><tbody>';
      data.items.forEach(function(m) {
        var statusClass = m.review_status === 'approved' ? 'status-approved' : 'status-rejected';
        var statusText = m.review_status === 'approved' ? '✓ 通过' : '✗ 驳回';
        var adminBadge = m.is_admin_uploaded ? '<span class="admin-uploaded-badge">🛡️ 管理员自传</span>' : '';
        var reviewerName = m.is_admin_uploaded ? escapeHtml(m.uploader_name) + ' (自传)' : escapeHtml(m.reviewed_by_name);
        var objHtml = '';
        if (m.can_object && m.review_status === 'approved') {
          objHtml = '<button class="admin-btn admin-btn-sm" onclick="showObjectionDialog(' + m.id + ', \'' + escapeHtml(m.title) + '\')">💬 异议</button>';
        } else {
          objHtml = '<button class="admin-btn admin-btn-sm admin-btn-secondary" onclick="toggleComments(' + m.id + ', this, true)" title="查看异议记录">💬</button>';
        }
        html += '<tr>' +
          '<td>' + escapeHtml(m.title) + adminBadge + '</td>' +
          '<td>' + escapeHtml(m.course_name) + '</td>' +
          '<td>' + escapeHtml(m.uploader_name) + '</td>' +
          '<td>' + reviewerName + '</td>' +
          '<td><span class="status-tag ' + statusClass + '">' + statusText + '</span></td>' +
          '<td>' + escapeHtml(m.review_notes || '') + '</td>' +
          '<td>' + (m.is_admin_uploaded ? m.created_at : m.reviewed_at) + '</td>' +
          '<td>' + objHtml + '</td>' +
        '</tr>';
        // 异议详情行（隐藏，展开时显示）
        html += '<tr id="hc-comments-row-' + m.id + '" style="display:none" class="hc-comments-row"><td colspan="8"><div class="pc-comments" id="hc-comments-' + m.id + '"></div></td></tr>';
      });
      html += '</tbody></table></div>';
      // 分页
      if (data.total_pages > 1) {
        html += '<div class="admin-pagination">';
        if (page > 1) {
          html += '<button onclick="renderAdminHistory(document.getElementById(\'adminContent\'), ' + (page - 1) + ')">← 上一页</button>';
        } else {
          html += '<button disabled>← 上一页</button>';
        }
        html += '<span class="page-info">第 ' + page + ' / ' + data.total_pages + ' 页（共 ' + data.total + ' 条）</span>';
        if (page < data.total_pages) {
          html += '<button onclick="renderAdminHistory(document.getElementById(\'adminContent\'), ' + (page + 1) + ')">下一页 →</button>';
        } else {
          html += '<button disabled>下一页 →</button>';
        }
        html += '</div>';
      }
      content.innerHTML = html;
      // 自动展开指定的异议高亮
      if (_highlightDisputeMaterialId) {
        var targetId = _highlightDisputeMaterialId;
        _highlightDisputeMaterialId = null; // 只触发一次
        var targetRow = document.getElementById('hc-comments-row-' + targetId);
        if (targetRow) {
          targetRow.style.display = 'table-row';
          var div = document.getElementById('hc-comments-' + targetId);
          if (div) {
            toggleComments(targetId, null, true);
            setTimeout(function() {
              targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 200);
          }
        } else {
          if (data.total_pages > 1) {
            alert('高亮异议未在当前页找到，请手动翻页查找');
          }
        }
      }
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">加载失败：' + err.message + '</div>';
    });
  }

  // ── 文件删除记录 ──
  var _delPage = 1, _delPerPage = 20;

  async function renderAdminDeletions(content, page) {
    _delPage = page;
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    try {
      var data = await api('/api/moderation/deletions/?page=' + page + '&per_page=' + _delPerPage);
      if (!data.items || !data.items.length) {
        content.innerHTML = '<p style="text-align:center;color:var(--ink-faint);padding:60px 0">暂无文件删除记录</p>';
        return;
      }
      var _esc = escapeHtml || function(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      };
      var html = '<div class="admin-table-wrapper"><table class="admin-table">';
      html += '<thead><tr><th>资料标题</th><th>课程</th><th>大小</th><th>上传者</th><th>删除人</th><th>删除时间</th><th>操作</th></tr></thead><tbody>';
      data.items.forEach(function(r) {
        var restoreBtn = '';
        if (r.can_restore && !r.is_restored) {
          restoreBtn = '<button class="admin-btn admin-btn-sm admin-btn-approve" onclick="restoreDeletion(' + r.id + ', this)">↩ 撤销</button>';
        } else if (r.is_restored) {
          restoreBtn = '<span style="font-size:0.75rem;color:var(--success)">✅ 已恢复</span>';
        } else {
          restoreBtn = '<span style="font-size:0.75rem;color:var(--text-muted)">⏰ 已过期</span>';
        }
        html += '<tr>' +
          '<td><strong>' + _esc(r.title) + '</strong><br><span class="ft-meta">' + _esc(r.file_name) + '</span></td>' +
          '<td>' + _esc(r.course_name) + '<br><span class="ft-meta">' + _esc(r.course_code) + '</span></td>' +
          '<td>' + formatSize(r.file_size) + '</td>' +
          '<td>' + _esc(r.uploader_name) + '</td>' +
          '<td>' + _esc(r.deleted_by_name) + '</td>' +
          '<td>' + _esc(r.deleted_at) + '</td>' +
          '<td>' + restoreBtn + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      if (data.total_pages > 1) {
        html += '<div class="admin-pagination">';
        if (page > 1) {
          html += '<button onclick="renderAdminDeletions(document.getElementById(\'adminContent\'), ' + (page - 1) + ')">← 上一页</button>';
        } else {
          html += '<button disabled>← 上一页</button>';
        }
        html += '<span class="page-info">第 ' + page + ' / ' + data.total_pages + ' 页（共 ' + data.total + ' 条）</span>';
        if (page < data.total_pages) {
          html += '<button onclick="renderAdminDeletions(document.getElementById(\'adminContent\'), ' + (page + 1) + ')">下一页 →</button>';
        } else {
          html += '<button disabled>下一页 →</button>';
        }
        html += '</div>';
      }
      content.innerHTML = html;
    } catch (err) {
      content.innerHTML = '<p style="text-align:center;color:var(--ink-faint);padding:40px">加载失败：' + (err.message || '未知错误') + '</p>';
    }
  }

  // ── 撤销删除（管理后台删除记录） ──
  function restoreDeletion(delId, btn) {
    var isSelf = btn && btn.closest('tr') && btn.closest('tr').querySelector('td:nth-child(5)');
    // 检查是否需要填理由（非本人操作）
    var isOwn = true;
    var cells = btn ? btn.closest('tr').querySelectorAll('td') : [];
    if (cells.length >= 5) {
      // 简单判断：若删除人列包含当前用户名，则视为本人
      var deletedByName = cells[4].textContent.trim();
      isOwn = deletedByName === (currentUser ? currentUser.nickname || currentUser.username : '');
    }
    if (isOwn) {
      if (!confirm('确定撤销此删除操作？文件将被恢复。')) return;
      if (btn) btn.disabled = true;
      api('/api/moderation/deletions/' + delId + '/restore/', { method: 'POST', body: {} }).then(function() {
        alert('✅ 文件已恢复');
        renderAdminDeletions(document.getElementById('adminContent'), _delPage);
      }).catch(function(err) {
        alert('恢复失败：' + err.message);
        if (btn) btn.disabled = false;
      });
    } else {
      // 非本人撤销要填理由
      showRestoreReasonDialog(delId, btn);
    }
  }

  function showRestoreReasonDialog(delId, btn) {
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay';
    overlay.innerHTML =
      '<div class="admin-reject-dialog" style="max-width:400px">' +
        '<h3>↩ 撤销删除</h3>' +
        '<p style="font-size:0.8rem;color:var(--text-muted);margin:4px 0 12px">你正在撤销他人的删除操作，请填写撤销理由。</p>' +
        '<textarea id="restoreReason" rows="3" placeholder="请填写撤销理由" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.85rem;box-sizing:border-box;resize:vertical"></textarea>' +
        '<div class="ar-actions" style="margin-top:12px">' +
          '<button class="admin-btn admin-btn-approve" onclick="confirmRestoreWithReason(' + delId + ', this)">确认撤销</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
  }

  async function confirmRestoreWithReason(delId, btn) {
    var reason = document.getElementById('restoreReason').value.trim();
    if (!reason) { alert('请填写撤销理由'); return; }
    if (btn) btn.disabled = true;
    var overlay = document.querySelector('.admin-reject-overlay');
    try {
      await api('/api/moderation/deletions/' + delId + '/restore/', { method: 'POST', body: { reason: reason } });
      _removeOverlay(overlay);
      alert('✅ 文件已恢复，撤销理由已通知相关用户');
      renderAdminDeletions(document.getElementById('adminContent'), _delPage);
    } catch(err) {
      alert('恢复失败：' + err.message);
      if (btn) btn.disabled = false;
    }
  }

  // ── 操作记录（替换文件管理） ──
  var _opPage = 1, _opPerPage = 20;

  async function renderAdminOperations(content) {
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    try {
      var data = await api('/api/operations/?page=' + _opPage + '&per_page=' + _opPerPage);
      if (!data.items || !data.items.length) {
        content.innerHTML = '<p style="text-align:center;color:var(--ink-faint);padding:60px 0">暂无操作记录</p>';
        return;
      }
      var html = '<div class="admin-table-wrapper"><table class="admin-table">';
      html += '<thead><tr><th>操作人</th><th>操作</th><th>文件夹</th><th>路径</th><th>类型</th><th>时间</th><th>操作</th></tr></thead><tbody>';
      data.items.forEach(function(op) {
        var restoreBtn = '';
        if (op.can_restore && !op.is_restored) {
          restoreBtn = '<button class="admin-btn admin-btn-sm admin-btn-approve" onclick="restoreFolderOp(' + op.id + ', this)">↩ 撤销</button>';
        } else if (op.is_restored) {
          restoreBtn = '<span style="font-size:0.75rem;color:var(--success)">✅ 已撤销</span>';
        } else {
          restoreBtn = '<span style="font-size:0.75rem;color:var(--text-muted)">⏰ 已过期</span>';
        }
        html += '<tr>' +
          '<td>' + esc(op.user_name) + '</td>' +
          '<td><span class="status-tag ' + (op.action === 'create' ? 'status-approved' : 'status-rejected') + '">' + op.action_label + '</span></td>' +
          '<td>' + esc(op.category_name) + '</td>' +
          '<td style="font-size:0.78rem;color:var(--text-muted)">' + esc(op.parent_path) + '</td>' +
          '<td>' + (op.folder_type === 'leaf' ? '底层' : '普通') + '</td>' +
          '<td>' + esc(op.created_at) + '</td>' +
          '<td>' + restoreBtn + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      if (data.total_pages > 1) {
        html += '<div class="admin-pagination">';
        if (_opPage > 1) {
          html += '<button onclick="renderAdminOperations(document.getElementById(\'adminContent\'), ' + (_opPage - 1) + ')">← 上一页</button>';
        } else {
          html += '<button disabled>← 上一页</button>';
        }
        html += '<span class="page-info">第 ' + _opPage + ' / ' + data.total_pages + ' 页（共 ' + data.total + ' 条）</span>';
        if (_opPage < data.total_pages) {
          html += '<button onclick="renderAdminOperations(document.getElementById(\'adminContent\'), ' + (_opPage + 1) + ')">下一页 →</button>';
        } else {
          html += '<button disabled>下一页 →</button>';
        }
        html += '</div>';
      }
      content.innerHTML = html;
    } catch (err) {
      content.innerHTML = '<p style="text-align:center;color:var(--ink-faint);padding:40px">加载失败：' + (err.message || '未知错误') + '</p>';
    }
  }

  function restoreFolderOp(opId, btn) {
    if (!confirm('确定撤销此操作？')) return;
    if (btn) btn.disabled = true;
    api('/api/operations/' + opId + '/restore/', { method: 'POST', body: {} }).then(function() {
      alert('✅ 操作已撤销');
      renderAdminOperations(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('撤销失败：' + err.message);
      if (btn) btn.disabled = false;
    });
  }

  // ── 用户管理（仅 super_admin） ──
  function renderAdminUsers(content, search) {
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    var url = '/api/admin/users/';
    if (search) url += '?search=' + encodeURIComponent(search);
    api(url).then(function(users) {
      if (!users || users.length === 0) {
        content.innerHTML = '<div class="admin-empty">未找到用户</div>';
        return;
      }
      var html = '<div class="admin-search-box">' +
        '<input type="text" id="adminUserSearch" placeholder="搜索昵称 / 邮箱…" value="' + escapeHtml(search) + '" onkeydown="if(event.key===\'Enter\')adminSearchUsers()">' +
        '<button onclick="adminSearchUsers()">搜索</button>' +
        '</div>';
      var isSuperAdmin = currentUser && currentUser.role === 'super_admin';
      html += '<div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr>' +
          '<th>昵称</th><th>邮箱</th><th>角色</th><th>管辖板块</th>' + (isSuperAdmin ? '<th>自动托管</th>' : '') + '<th>资料数</th><th>注册时间</th>' +
        '</tr></thead><tbody>';
      users.forEach(function(u) {
        var canChange = u.id !== (currentUser ? currentUser.id : -1) && u.role !== 'super_admin';
        var roleOptions = '<select class="admin-role-select" data-user-id="' + u.id + '" data-original="' + u.role + '"' + (canChange ? ' onchange="onRoleChange(' + u.id + ', this.value, \'' + escapeHtml(u.nickname) + '\')"' : ' disabled') + '>' +
          '<option value="user"' + (u.role === 'user' ? ' selected' : '') + '>普通用户</option>' +
          '<option value="sub_moderator"' + (u.role === 'sub_moderator' ? ' selected' : '') + '>小版主</option>' +
          '<option value="moderator"' + (u.role === 'moderator' ? ' selected' : '') + '>版主</option>' +
          (u.role === 'super_admin' ? '<option value="super_admin" selected>总管理员</option>' : '') +
        '</select>';
        var sections = '—';
        if (u.role === 'moderator') {
          var names = [...new Set((u.managed_majors_info || []).map(function(s) { return s.name; }))];
          if (u.can_moderate_general) {
            names.push('通识课');
          } else if (u.moderated_sections_info && u.moderated_sections_info.length) {
            var secNames = [...new Set(u.moderated_sections_info.map(function(s) { return s.name; }))];
            names = names.concat(secNames);
          }
          var display = names.length ? names.join('、') : '—';
          if (canChange) {
            sections = '<a href="javascript:void(0)" class="section-link" onclick="onRoleChange(' + u.id + ',\'moderator\',\'' + escapeHtml(u.nickname) + '\')">' + display + '</a>';
          } else {
            sections = display;
          }
        } else if (u.role === 'sub_moderator') {
          var info = u.moderated_sections_info || [];
          var allIds = info.map(function(s) { return s.id; });
          // 仅显示最高层级的节点（父节点不在管辖范围内则不显示子节点）
          var display = [...new Set(info.filter(function(s) { return allIds.indexOf(s.parent_id) === -1; }).map(function(s) { return s.name; }))].join('、') || '—';
          if (canChange) {
            sections = '<a href="javascript:void(0)" class="section-link" onclick="onRoleChange(' + u.id + ',\'sub_moderator\',\'' + escapeHtml(u.nickname) + '\')">' + display + '</a>';
          } else {
            sections = display;
          }
        }
        var autoApproveCell = '';
        if (isSuperAdmin) {
          if (u.role === 'moderator' || u.role === 'sub_moderator') {
            var aaState = u.auto_approve ? '🟢 开' : '🔴 关';
            var caaState = u.can_auto_approve ? '允许' : '禁止';
            autoApproveCell = '<td style="font-size:0.75rem;white-space:nowrap">' +
              '<span>' + aaState + '</span>' +
              '<br><button class="admin-btn admin-btn-sm" style="font-size:0.65rem;margin-top:2px" data-caa="' + (u.can_auto_approve ? 1 : 0) + '" onclick="toggleAdminAutoApprove(' + u.id + ', this)">' + caaState + '</button>' +
            '</td>';
          } else {
            autoApproveCell = '<td style="font-size:0.75rem;color:var(--text-muted)">—</td>';
          }
        }
        html += '<tr>' +
          '<td>' + escapeHtml(u.nickname) + '</td>' +
          '<td style="font-size:0.8rem">' + escapeHtml(u.email) + '</td>' +
          '<td>' + roleOptions + '</td>' +
          '<td style="font-size:0.78rem;color:var(--text-muted)">' + sections + '</td>' +
          autoApproveCell +
          '<td>' + (u.file_count || 0) + '</td>' +
          '<td>' + u.date_joined + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
      content.innerHTML = html;
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">加载失败：' + err.message + '</div>';
    });
  }

  function adminSearchUsers() {
    var q = document.getElementById('adminUserSearch');
    renderAdminUsers(document.getElementById('adminContent'), q ? q.value.trim() : '');
  }

  function onRoleChange(uid, newRole, nickname) {
    // 统一取消回调：取消时还原 select
    function cancelWithRevert() {
      revertRoleSelect(uid);
    }
    // 通用关闭处理：overlay 点击背景关闭
    function setupOverlayClose(overlay, uid2) {
      overlay.onclick = function(e) {
        if (e.target === overlay) { _removeOverlay(overlay); revertRoleSelect(uid2); }
      };
    }

    if (newRole === 'moderator') {
      // 版主：选择学院 + 通识课（含可选子类）
      Promise.all([
        api('/api/colleges/'),
        api('/api/admin/sections/')
      ]).then(function(results) {
        var colleges = results[0];
        var sections = results[1];
        if (!colleges || !colleges.length) {
          alert('当前没有可用学院，请在后台添加学院后再分配');
          revertRoleSelect(uid);
          return;
        }
        var html = '<div class="admin-reject-dialog"><h3>选择「' + nickname + '」的管辖范围</h3><p style="font-size:0.8rem;color:var(--text-muted);margin:4px 0 12px">版主可审核所选学院/大类下所有课程的资料。<br>选中上级分类将自动勾选其所有下级分类。</p>';
        html += '<div class="college-check-list">';
        // 通识课（父复选框 + 子复选框列表，无需展开）
        var genSection = sections.find(function(s) { return s.name === '通识课'; });
        html += '<div class="mod-gen-block">';
        html += '<label class="college-check-item" style="font-weight:600;border-bottom:1px solid var(--border-light);padding-bottom:8px;margin-bottom:4px"><input type="checkbox" id="modGenCheck_' + uid + '" value="general" onchange="modGenToggle(this,' + uid + ')"> 📖 通识课（全部）</label>';
        if (genSection && genSection.children) {
          genSection.children.forEach(function(child) {
            if (child.is_divider) return;
            html += '<label class="college-check-item" style="padding-left:24px;font-size:0.85rem"><input type="checkbox" class="gen-sub-cat" value="' + child.id + '" onchange="genSubCatToggle(this,' + uid + ')"> ' + esc(child.name) + '</label>';
          });
        }
        html += '</div>';
        // 学院列表
        colleges.forEach(function(c) {
          html += '<label class="college-check-item"><input type="checkbox" value="' + c.id + '"> ' + esc(c.name) + '</label>';
        });
        html += '</div>';
        html += '<div class="ar-actions" style="margin-top:12px">' +
          '<button class="admin-btn admin-btn-primary" onclick="confirmModeratorRole(' + uid + ', this)">确认设置</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="this.closest(\'.admin-reject-overlay\').remove();revertRoleSelect(' + uid + ')">取消</button>' +
        '</div></div>';

        var overlay = document.createElement('div');
        overlay.className = 'admin-reject-overlay';
        overlay.innerHTML = html;
        document.body.appendChild(overlay);
        overlay.onclick = function(e) { if (e.target === overlay) { _removeOverlay(overlay); revertRoleSelect(uid); } };
      }).catch(function() {
        alert('加载数据失败');
        revertRoleSelect(uid);
      });
      return;
    }
    if (newRole === 'sub_moderator') {
      // 小版主：从课程树选择具体专业/课程（CourseCategory 节点）
      api('/api/admin/sections/').then(function(sections) {
        if (!sections || !sections.length) {
          alert('当前没有可选的课程分类节点');
          revertRoleSelect(uid);
          return;
        }
        var html = '<div class="admin-reject-dialog"><h3>选择「' + nickname + '」的管辖范围</h3><p style="font-size:0.8rem;color:var(--text-muted);margin:4px 0 12px">小版主可审核具体专业层级及以下目录的资料。<br>📌 上级分类节点仅作导航，具体专业层级以下可选。<br>💡 选中上级分类将自动勾选所有下级，防止冲突。</p>';
        html += '<div class="section-check-list" style="max-height:min(60vh,350px);overflow-y:auto">';
        // 递归渲染可展开树
        function renderSectionTree(nodes, indent) {
          nodes.forEach(function(s) {
            if (s.is_divider) return;
            var hasChildren = s.children && s.children.length;
            var selectable = indent >= 1;  // 具体专业级及以上可选
            html += '<div class="section-tree-node" style="padding-left:' + (indent * 20) + 'px">';
            if (hasChildren) {
              html += '<span class="tree-expand-btn" onclick="var n=this.parentElement.nextElementSibling;if(n){var v=n.style.display;n.style.display=v===\'block\'?\'none\':\'block\';this.textContent=v===\'block\'?\'▶\':\'▼\';}" style="cursor:pointer;margin-right:2px">▶</span>';
            } else {
              html += '<span style="margin-right:2px;opacity:0.3">·</span>';
            }
            if (selectable) {
              html += '<input type="checkbox" value="' + s.id + '" onchange="treeCheckPropagate(this)"> ';
              html += '<label>' + esc(s.name) + '</label>';
            } else {
              html += '<span style="opacity:0.3;margin-right:4px">▸ </span>';
              html += '<span style="color:var(--text-muted);font-size:0.8rem">' + esc(s.name) + '</span>';
            }
            html += '</div>';
            if (hasChildren) {
              html += '<div class="tree-children" style="display:none">';
              renderSectionTree(s.children, indent + 1);
              html += '</div>';
            }
          });
        }
        // 根节点渲染
        sections.forEach(function(root) {
          html += '<div style="font-weight:600;padding:6px 0 2px 4px;font-size:0.85rem;color:var(--ink)">' + esc(root.name) + '</div>';
          if (root.children) {
            html += '<div class="tree-children" style="display:none">';
            renderSectionTree(root.children, 0);
            html += '</div>';
            html += '<div style="padding-left:4px"><a href="javascript:void(0)" style="font-size:0.7rem;color:var(--accent)" onclick="var n=this.parentElement.previousElementSibling;n.style.display=n.style.display===\'none\'?\'block\':\'none\';this.textContent=this.textContent===\'展开此分类 ›\'?\'收起 ‹\':\'展开此分类 ›\'">展开此分类 ›</a></div>';
          }
        });
        html += '</div>';
        html += '<div class="ar-actions" style="margin-top:12px">' +
          '<button class="admin-btn admin-btn-primary" onclick="confirmSubModeratorRole(' + uid + ', this)">确认设置</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="this.closest(\'.admin-reject-overlay\').remove();revertRoleSelect(' + uid + ')">取消</button>' +
        '</div></div>';

        var overlay = document.createElement('div');
        overlay.className = 'admin-reject-overlay';
        overlay.innerHTML = html;
        document.body.appendChild(overlay);
        overlay.onclick = function(e) { if (e.target === overlay) { _removeOverlay(overlay); revertRoleSelect(uid); } };
      }).catch(function() {
        alert('加载课程分类失败');
        revertRoleSelect(uid);
      });
      return;
    }
    // 普通用户：直接确认
    var roleLabel = '普通用户';
    if (!confirm('确定将「' + nickname + '」的角色改为「' + roleLabel + '」？')) {
      revertRoleSelect(uid);
      return;
    }
    api('/api/admin/users/' + uid + '/role/', {
      method: 'POST',
      body: { role: newRole }
    }).then(function() {
      renderAdminUsers(document.getElementById('adminContent'), '');
    }).catch(function(err) {
      alert('操作失败：' + err.message);
      // 失败也要还原
      revertRoleSelect(uid);
      renderAdminUsers(document.getElementById('adminContent'), '');
    });
  }

  function revertRoleSelect(uid) {
    var select = document.querySelector('.admin-role-select[data-user-id="' + uid + '"]');
    if (select) {
      select.value = select.getAttribute('data-original') || 'user';
    }
  }

  // ── 树形复选框自动勾选下级 ──
  function treeCheckPropagate(cb) {
    var node = cb.closest('.section-tree-node');
    if (!node) return;
    var next = node.nextElementSibling;
    if (next && next.classList.contains('tree-children')) {
      next.querySelectorAll('input[type=checkbox]').forEach(function(c) { c.checked = cb.checked; });
    }
  }

  // ── 通识课全选/取消 ──
  function modGenToggle(cb, uid) {
    var block = cb.closest('.mod-gen-block');
    if (!block) return;
    block.querySelectorAll('.gen-sub-cat').forEach(function(c) { c.checked = cb.checked; });
  }

  // ── 通识课子类切换时联动父复选框（注意：子类仅可"取消"父类，不会因勾选子类而自动勾选父类）
  //    因为父类 can_moderate_general 有特殊语义（允许所有通识课），勾选子类不应自动开启全部权限
  function genSubCatToggle(cb, uid) {
    var parent = document.getElementById('modGenCheck_' + uid);
    if (!parent) return;
    // 仅当子类全部取消时自动取消父类
    if (!cb.checked) {
      var block = cb.closest('.mod-gen-block');
      var all = block.querySelectorAll('.gen-sub-cat');
      var any = false;
      all.forEach(function(c) { if (c.checked) any = true; });
      if (!any) parent.checked = false;
    }
  }

  function confirmSubModeratorRole(uid, btn) {
    var checked = btn.closest('.admin-reject-dialog').querySelectorAll('.section-check-list input:checked');
    var catIds = Array.from(checked).map(function(cb) { return parseInt(cb.value); });
    if (!catIds.length) {
      alert('请至少选择一个管辖范围（专业/课程节点）');
      return;
    }
    var overlay = btn.closest('.admin-reject-overlay');
    api('/api/admin/users/' + uid + '/role/', {
      method: 'POST',
      body: { role: 'sub_moderator', moderated_sections: catIds }
    }).then(function() {
      if (overlay) overlay.remove();
      var si = document.getElementById('adminUserSearch');
      renderAdminUsers(document.getElementById('adminContent'), si ? si.value.trim() : '');
    }).catch(function(err) {
      alert('操作失败：' + err.message);
      if (overlay) overlay.remove();
      var si = document.getElementById('adminUserSearch');
      renderAdminUsers(document.getElementById('adminContent'), si ? si.value.trim() : '');
    });
  }

  function confirmModeratorRole(uid, btn) {
    var dialog = btn.closest('.admin-reject-dialog');
    var genCheck = dialog.querySelector('#modGenCheck_' + uid);
    var canGen = genCheck ? genCheck.checked : false;
    var checked = dialog.querySelectorAll('.college-check-list input[type=checkbox]:checked:not([id^=modGenCheck]):not(.gen-sub-cat)');
    var collegeIds = Array.from(checked).map(function(cb) { return parseInt(cb.value); });
    // 通识课子类 ID
    var genChildChecked = dialog.querySelectorAll('.gen-sub-cat:checked');
    var sectionIds = Array.from(genChildChecked).map(function(cb) { return parseInt(cb.value); });
    // 如果有 .section-check-list（版主也可能有额外分类）
    var otherSections = dialog.querySelectorAll('.section-check-list input:checked');
    Array.from(otherSections).forEach(function(cb) { sectionIds.push(parseInt(cb.value)); });
    if (!collegeIds.length && !canGen && !sectionIds.length) {
      alert('请至少选择一项管辖范围（学院、通识课大类或具体子类）');
      return;
    }
    var overlay = btn.closest('.admin-reject-overlay');
    api('/api/admin/users/' + uid + '/role/', {
      method: 'POST',
      body: { role: 'moderator', managed_majors: collegeIds, can_moderate_general: canGen, moderated_sections: sectionIds }
    }).then(function() {
      if (overlay) overlay.remove();
      var si = document.getElementById('adminUserSearch');
      renderAdminUsers(document.getElementById('adminContent'), si ? si.value.trim() : '');
    }).catch(function(err) {
      alert('操作失败：' + err.message);
      if (overlay) overlay.remove();
      var si = document.getElementById('adminUserSearch');
      renderAdminUsers(document.getElementById('adminContent'), si ? si.value.trim() : '');
    });
  }

  // ── 审核异议（一次性通知弹窗，而非评论区） ──
  function showObjectionDialog(fileId, title) {
    var old = document.querySelector('.objection-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay objection-overlay';
    overlay.innerHTML =
      '<div class="admin-reject-dialog" style="max-width:420px">' +
        '<h3>💬 对资料提出异议</h3>' +
        '<p style="font-size:0.8rem;color:var(--text-muted);margin:4px 0 12px">该异议将发送给原审核人，并在审核记录中留存。</p>' +
        '<p style="font-size:0.85rem;font-weight:500;margin-bottom:8px">' + escapeHtml(title) + '</p>' +
        '<textarea id="objInput" placeholder="请说明异议原因…（必填）" rows="3" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);resize:vertical;font-size:0.85rem;box-sizing:border-box"></textarea>' +
        '<div class="ar-error" id="objError" style="display:none">请填写异议原因</div>' +
        '<div class="ar-actions" style="margin-top:10px">' +
          '<button class="admin-btn admin-btn-primary" onclick="submitObjection(' + fileId + ')">提交异议</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
    setTimeout(function() { document.getElementById('objInput').focus(); }, 100);
  }

  function submitObjection(fileId) {
    var input = document.getElementById('objInput');
    if (!input) return;
    var content = input.value.trim();
    if (!content) {
      document.getElementById('objError').style.display = 'block';
      return;
    }
    document.getElementById('objError').style.display = 'none';
    var overlay = document.querySelector('.objection-overlay');
    api('/api/moderation/' + fileId + '/comments/', { method: 'POST', body: { content: content } }).then(function() {
      _removeOverlay(overlay);
      alert('异议已提交，原审核人将收到通知。');
    }).catch(function(err) {
      alert('提交失败：' + err.message);
    });
  }

  // 历史页查看已有异议（只读，不发表）
  function toggleComments(fileId, btn, isHistory) {
    var commentsDiv;
    if (isHistory) {
      var row = document.getElementById('hc-comments-row-' + fileId);
      if (row) {
        if (row.style.display === 'table-row') { row.style.display = 'none'; return; }
        row.style.display = 'table-row';
        commentsDiv = document.getElementById('hc-comments-' + fileId);
      }
    }
    if (!commentsDiv) return;
    commentsDiv.innerHTML = '<div class="pc-comments-loading">加载中…</div>';
    api('/api/moderation/' + fileId + '/comments/').then(function(data) {
      var html = '';
      if (data.comments && data.comments.length) {
        // 先渲染顶层评论，再按 parent_id 挂子评论
        var topLevel = data.comments.filter(function(c) { return !c.parent_id; });
        var replies = {};
        data.comments.forEach(function(c) {
          if (c.parent_id) {
            if (!replies[c.parent_id]) replies[c.parent_id] = [];
            replies[c.parent_id].push(c);
          }
        });
        topLevel.forEach(function(c) {
          html += '<div class="pc-comment-item">' +
            '<span class="pcc-name">' + esc(c.commenter_name) + '</span>' +
            '<span class="pcc-time">' + esc(c.created_at) + '</span>' +
            '<div class="pcc-content">' + esc(c.content) + '</div>' +
            '<button class="pcc-reply-btn" onclick="showReplyForm(' + fileId + ', ' + c.id + ', this)">↩ 回复</button>' +
            '</div>';
          // 渲染子评论（回复）
          if (replies[c.id]) {
            replies[c.id].forEach(function(r) {
              html += '<div class="pc-comment-item pc-comment-reply"><span class="pcc-name">' + esc(r.commenter_name) + '</span><span class="pcc-time">' + esc(r.created_at) + '</span><div class="pcc-content">' + esc(r.content) + '</div></div>';
            });
          }
        });
      } else {
        html += '<div class="pc-comment-empty">暂无异议</div>';
      }
      commentsDiv.innerHTML = html;
    }).catch(function() {
      commentsDiv.innerHTML = '<div class="pc-comment-empty">加载失败</div>';
    });
  }

  // ── 回复异议 ──
  function showReplyForm(fileId, parentId, btn) {
    // 移除已有的回复输入框
    var existingForm = document.querySelector('.pcc-reply-form');
    if (existingForm) existingForm.remove();
    var form = document.createElement('div');
    form.className = 'pcc-reply-form';
    form.style.cssText = 'margin:8px 0 8px 32px;padding:8px;background:var(--surface);border-radius:6px';
    form.innerHTML =
      '<textarea rows="2" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--border-light);resize:vertical;font-size:0.82rem;box-sizing:border-box" placeholder="输入回复…"></textarea>' +
      '<div style="display:flex;gap:6px;margin-top:6px">' +
        '<button class="admin-btn admin-btn-sm admin-btn-primary" onclick="submitReply(' + fileId + ', ' + parentId + ', this)">发送</button>' +
        '<button class="admin-btn admin-btn-sm admin-btn-secondary" onclick="this.closest(\'.pcc-reply-form\').remove()">取消</button>' +
      '</div>';
    // 插入到按钮后面
    if (btn && btn.parentNode) {
      btn.parentNode.insertAdjacentElement('afterend', form);
    }
    form.querySelector('textarea').focus();
  }

  function submitReply(fileId, parentId, btn) {
    var form = btn.closest('.pcc-reply-form');
    var textarea = form ? form.querySelector('textarea') : null;
    if (!textarea) return;
    var content = textarea.value.trim();
    if (!content) { alert('回复内容不能为空'); return; }
    var overlay = document.querySelector('.admin-reject-overlay');
    api('/api/moderation/' + fileId + '/comments/', {
      method: 'POST',
      body: { content: content, parent_id: parentId }
    }).then(function() {
      // 刷新评论列表
      var commentsDiv = document.getElementById('hc-comments-' + fileId);
      if (commentsDiv) toggleComments(fileId, null, true);
      textarea.value = '';
    }).catch(function(err) {
      alert('回复失败：' + err.message);
    });
  }

  // ── 手动分流（指派审核人） ──
  function showReassignDialog(fileId) {
    var existing = document.querySelector('.reassign-overlay');
    if (existing) existing.remove();
    api('/api/admin/users/').then(function(users) {
      // 过滤出版主和小版主
      var mods = users.filter(function(u) { return u.role === 'moderator' || u.role === 'sub_moderator'; });
      if (!mods.length) {
        alert('当前没有可指派的审核员（版主/小版主）');
        return;
      }
      var html = '<div class="admin-reject-dialog" style="max-width:400px"><h3>指派审核人</h3><p style="font-size:0.8rem;color:var(--text-muted);margin:4px 0 12px">选择后仅该审核员和总管理员可看到此待审资料</p>';
      html += '<select id="reassignSelect" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem">';
      html += '<option value="">— 取消指派（回归自动路由） —</option>';
      mods.forEach(function(u) {
        var roleLabel = u.role === 'moderator' ? '版主' : '小版主';
        html += '<option value="' + u.id + '">' + esc(u.nickname) + ' (' + roleLabel + ')</option>';
      });
      html += '</select>';
      html += '<div class="ar-actions" style="margin-top:12px">' +
        '<button class="admin-btn admin-btn-primary" onclick="confirmReassign(' + fileId + ')">确认指派</button>' +
        '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
      '</div></div>';

      var overlay = document.createElement('div');
      overlay.className = 'admin-reject-overlay reassign-overlay';
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
      overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
      lockScroll();
    }).catch(function() {
      alert('加载用户列表失败');
    });
  }

  function confirmReassign(fileId) {
    var select = document.getElementById('reassignSelect');
    if (!select) return;
    var assignedMod = select.value ? parseInt(select.value) : null;
    var overlay = document.querySelector('.reassign-overlay');
    api('/api/moderation/' + fileId + '/reassign/', {
      method: 'POST',
      body: { assigned_moderator: assignedMod }
    }).then(function() {
      _removeOverlay(overlay);
      // 刷新待审核列表
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('指派失败：' + err.message);
    });
  }

  // ── 自动托管管理（super_admin 切换 can_auto_approve） ──
  function toggleAdminAutoApprove(uid, btn) {
    // 从按钮 data-caa 属性直接读取当前状态
    var currentOn = btn && btn.getAttribute('data-caa') === '1';
    var newVal = !currentOn;
    api('/api/admin/users/' + uid + '/auto-approve/', {
      method: 'POST',
      body: { can_auto_approve: newVal, auto_approve: newVal }
    }).then(function(result) {
      // 直接修改所在 <td> 的 DOM，无需重渲染
      if (!btn) return;
      var td = btn.closest('td');
      if (td) {
        // 更新 🟢🔴 标识
        var span = td.querySelector('span');
        if (span) span.textContent = result.auto_approve ? '🟢 开' : '🔴 关';
      }
      // 更新按钮本身
      btn.textContent = result.can_auto_approve ? '允许' : '禁止';
      btn.setAttribute('data-caa', result.can_auto_approve ? '1' : '0');
    }).catch(function(err) {
      btn.textContent = currentOn ? '允许' : '禁止';
      btn.setAttribute('data-caa', currentOn ? '1' : '0');
      alert('操作失败：' + err.message);
    });
  }

  // ── 工具函数 ──
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
    // 先检查 token 是否存在，立即显示侧边栏管理入口（避免延迟）
    var hasToken = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (hasToken) {
      document.querySelectorAll('#sideAdminLink, #mobAdminLink').forEach(function(link) {
        link.style.display = '';
      });
    }
    // 等待 auth 检查完成再恢复视图（避免刷新后登录状态丢失）
    await checkAuth();

    // 邮箱验证链接检查（?uid=xxx&vtoken=xxx）
    try {
      (function() {
        var params = new URLSearchParams(window.location.search);
        var uid = params.get('uid');
        var vtoken = params.get('vtoken');
        if (uid && vtoken) {
          _suppressingPushState = true;  // 阻止恢复历史视图
          api('/api/auth/verify-email/', { method: 'POST', body: { uid: parseInt(uid), vtoken: vtoken } })
            .then(function(data) {
              if (data.token) {
                _persistToken(data.token, false);
                currentUser = data.user;
              }
              history.replaceState(null, '', '/');
              alert('✅ ' + (data.message || '邮箱验证成功！'));
              showHome();
              updateAuthUI();
            })
            .catch(function(err) {
              history.replaceState(null, '', '/');
              alert('验证失败：' + err.message + '\n请重新注册或联系管理员。');
              showHome();
              updateAuthUI();
            });
        }
      })();
    } catch(e) {}

    setupSearch(); loadStats(); loadCourseFileCounts();
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
          case 'notif': showNotifFull(); break;
          case 'admin': showAdminPanel(); break;
          case 'about': showAbout(saved.aboutSection || 'introduction'); break;
          case 'tutorial': showTutorial(); break;
          case 'announcements': showAnnouncements(); break;
          case 'broad': showBroad(); break;
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

  function autoFillUploadTitle() {
    var fileInput = document.getElementById('uploadFile');
    var titleInput = document.getElementById('uploadTitle');
    if (!fileInput || !titleInput) return;
    if (titleInput.value.trim()) return; // 已填写标题不覆盖
    if (fileInput.files.length === 1) {
      titleInput.value = fileInput.files[0].name.replace(/\.[^.]+$/, '');
    }
  }

  function showUploadModal(code, name) {
    if (!currentUser) { showLoginModal(); return; }
    uploadCourseCode = code;
    document.getElementById('uploadCourse').value = name + ' (' + code + ')';
    // 普通上传时隐藏重传驳回提示（避免残留）
    var ri = document.getElementById('reuploadInfo');
    if (ri) ri.style.display = 'none';
    _reuploadOldId = null;
    document.getElementById('uploadModal').style.display = 'flex';
    lockScroll();
    _pushModalHistory();
  }

  function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('uploadForm').reset();
    document.getElementById('uploadError').style.display = 'none';
    document.getElementById('uploadProgress').style.display = 'none';
    // 清除重传相关的状态，防止残留到下一次打开弹窗
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

    const files = document.getElementById('uploadFile').files;
    if (!files || !files.length) { el.textContent = '请选择文件'; el.style.display = 'block'; return false; }

    el.style.display = 'none';

    var title = document.getElementById('uploadTitle').value;
    var description = document.getElementById('uploadDesc').value;
    var teacher = document.getElementById('uploadTeacher').value;
    if (!teacher.trim()) {
      el.textContent = '请填写任课教师姓名';
      el.style.display = 'block';
      progress.style.display = 'none';
      return false;
    }

    progress.style.display = 'flex';

    var successCount = 0, failCount = 0;
    var token = sessionStorage.getItem('token') || localStorage.getItem('token');

    // 单标题模式：用相同标题上传多个文件（会在文件名后追加序号）
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      // 检查大小
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
        formData.append('title', fileTitle);
        formData.append('file', file);
        formData.append('description', description);
        formData.append('teacher', teacher);

        const resp = await fetch('/api/files/upload/', {
          method: 'POST',
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
          body: formData,
        });
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error || '上传失败');
        successCount++;
      } catch (err) {
        failCount++;
        text.textContent = (i + 1) + '/' + files.length + ' ' + file.name + ' 失败: ' + err.message;
        await new Promise(r => setTimeout(r, 500)); // 短暂停顿，让用户看到错误
      }
    }

    // 如果是重传，自动删除旧驳回记录
    if (successCount > 0 && _reuploadOldId) {
      try {
        await api('/api/files/' + _reuploadOldId + '/delete/', { method: 'DELETE' });
      } catch(e) { /* 静默失败 */ }
      _reuploadOldId = null;
    }

    fill.style.width = '100%';
    text.textContent = '完成！成功 ' + successCount + ' 个' + (failCount > 0 ? '，失败 ' + failCount + ' 个' : '');
    setTimeout(function() { closeUploadModal(); renderExplorer(); }, 1500);
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
  let _initialNav = true;  // 首次加载用 replaceState 代替 pushState，避免按返回退出网站

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
  function navTo(depth) { expPath = expPath.slice(0, depth); pushViewState('explorer', { expPath: [...expPath] }); renderExplorer(); window.scrollTo({ top: 0 }); }
  function navIn(name) {
    const node = getNode(expPath);
    if (!node || !node.children) return;
    const child = node.children.find(c => c.name === name);
    if (!child) return;
    expPath.push(name);
    pushViewState('explorer', { expPath: [...expPath] });
    renderExplorer();
    window.scrollTo({ top: 0 });
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
    // 管理模式：在面包屑同一行最右侧加「新建」按钮
    if (isMgmtActive()) {
      var node = getNode(expPath);
      var hasCourse = node && (node.courseId || (node.children && node.children.some(function(c) { return c.courseId; })));
      var showNewBtn = true;
      // 最后一层（有course关联的节点）不显示
      if (node && node.courseId) showNewBtn = false;
      // 小版主在管辖范围外的层级不显示
      if (currentUser && currentUser.role === 'sub_moderator' && !_userInScope(expPath)) showNewBtn = false;
      if (showNewBtn) {
        var newBtn = document.createElement('button');
        newBtn.className = 'mgmt-new-btn';
        newBtn.textContent = '＋ 新建';
        newBtn.onclick = function(e) { e.stopPropagation(); showNewFolderDialog(node && node.id); };
        el.appendChild(newBtn);
      }
    }
  }

  function showNewFolderDialog(parentId) {
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay';
    overlay.innerHTML =
      '<div class="admin-reject-dialog" style="max-width:380px">' +
        '<h3>📁 新建文件夹</h3>' +
        '<div style="margin:12px 0"><label style="font-size:0.85rem;display:block;margin-bottom:4px">文件夹名称</label>' +
          '<input type="text" id="newFolderName" placeholder="输入名称" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem;box-sizing:border-box"></div>' +
        '<div style="margin-bottom:12px"><label style="font-size:0.85rem;display:block;margin-bottom:4px">文件夹类型</label>' +
          '<select id="newFolderType" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem">' +
            '<option value="">普通文件夹（内部可再建文件夹）</option>' +
            '<option value="leaf">底层文件夹（内部可上传文件，不可再建文件夹）</option>' +
          '</select></div>' +
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" onclick="confirmNewFolder(' + (parentId || 'null') + ')">创建</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
    setTimeout(function() { document.getElementById('newFolderName').focus(); }, 100);
  }

  function confirmNewFolder(parentId) {
    var name = document.getElementById('newFolderName').value.trim();
    var type = document.getElementById('newFolderType').value;
    if (!name) { alert('请输入文件夹名称'); return; }
    var overlay = document.querySelector('.admin-reject-overlay');
    api('/api/folders/create/', { method: 'POST', body: { name: name, parent_id: parentId, folder_type: type } }).then(function() {
      _removeOverlay(overlay);
      renderExplorer(); // 刷新视图
    }).catch(function(err) {
      alert('创建失败：' + err.message);
    });
  }

  function _userInScope(path) {
    // 简易检查：小版主的管辖范围是否包含当前路径
    // 当前仅返回 true — 后端 API 会做实际权限校验
    return true;
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
      if (fCount !== null) {
        badge = fCount > 0
          ? '<span class="fli-badge has-data">' + fCount + ' 个文件</span>'
          : '<span class="fli-badge no-data">暂无资料</span>';
      } else {
        // courseFileCounts 尚未加载完毕，使用 tree 中的 hasFiles 布尔值
        badge = item.hasFiles
          ? '<span class="fli-badge has-data">有文件</span>'
          : '<span class="fli-badge no-data">暂无资料</span>';
      }
    } else if (hasSub) {
      badge = '<span class="fli-badge has-data">' + item.children.length + ' 项</span>';
    }
    const meta = cId ? '课程代码 ' + cId : (hasSub ? item.children.length + ' 项' : '');
    return '<div class="folder-list-item" data-n="' + esc(item.name) + '">' +
      '<span class="fli-icon">' + (hasSub ? '▸' : '·') + '</span>' +
      '<div class="fli-info"><div class="fli-name">' + esc(item.name) + '</div><div class="fli-meta">' + meta + '</div></div>' +
      badge + '</div>';
  }

  var _multiSelectMode = false;

  function toggleMultiSelect() {
    var tbody = document.getElementById('fileTableBody');
    if (!tbody || !tbody.querySelector('tr[data-file-id]')) return;
    _multiSelectMode = !_multiSelectMode;
    var btn = document.getElementById('multiSelectToggle');
    var mgmt = isMgmtActive();
    btn.textContent = _multiSelectMode ? '✕ 取消' : (mgmt ? '📋 批量操作' : '⬇ 批量下载');
    if (!_multiSelectMode) {
      // 退出模式时清空选择
      _selectedIds = {};
      document.querySelectorAll('.dl-chk').forEach(function(c) { c.checked = false; });
      var allChk = document.getElementById('selectAllChkHead');
      if (allChk) allChk.checked = false;
    }
    syncMultiSelectUI();
  }

  function syncMultiSelectUI() {
    var ft = document.getElementById('fileTable');
    if (!ft) return;
    var tbody = document.getElementById('fileTableBody');
    var mgmt = isMgmtActive();
    // 管理模式显示额外按钮
    var delBtn = document.getElementById('batchDeleteBtn');
    var editBtn = document.getElementById('batchEditBtn');
    if (mgmt) {
      if (delBtn) delBtn.style.display = '';
      if (editBtn) editBtn.style.display = '';
    } else {
      if (delBtn) delBtn.style.display = 'none';
      if (editBtn) editBtn.style.display = 'none';
    }
    if (_multiSelectMode) {
      ft.classList.add('multi-select');
      var batchBar = document.getElementById('batchDlBar');
      if (batchBar) { batchBar.classList.add('is-visible'); batchBar.style.display = 'flex'; }
      // 从 _selectedIds 恢复可见行勾选状态
      var visibleChk = 0, visibleChecked = 0;
      if (tbody) {
        tbody.querySelectorAll('.dl-chk').forEach(function(c) {
          var fid = parseInt(c.getAttribute('data-fid'));
          if (fid) {
            var isChecked = !!_selectedIds[fid];
            c.checked = isChecked;
            visibleChk++;
            if (isChecked) visibleChecked++;
          }
        });
      }
      var allChk = document.getElementById('selectAllChkHead');
      if (allChk) allChk.checked = visibleChk > 0 && visibleChecked === visibleChk;
      updateBatchDlBar();
    } else {
      ft.classList.remove('multi-select');
      var batchBar = document.getElementById('batchDlBar');
      if (batchBar) { batchBar.classList.remove('is-visible'); batchBar.style.display = ''; }
    }
  }

  function cancelMultiSelect() {
    _multiSelectMode = false;
    _selectedIds = {};
    var btn = document.getElementById('multiSelectToggle');
    if (btn) btn.textContent = '⬇ 批量下载';
    var allChk = document.getElementById('selectAllChkHead');
    if (allChk) allChk.checked = false;
    syncMultiSelectUI();
  }

  function renderFiles(course) {
    // 切换课程时退出多选模式
    _multiSelectMode = false; _selectedIds = {};
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

    // 无课程代码 → 展示空状态（避免表格永久停留在"加载中"）
    if (!code) {
      container.innerHTML =
        '<div class="file-area">' +
          '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + '</h3></div>' +
          '<div class="empty-state"><div class="es-text">该课程暂无资料</div><div class="es-sub">可能是课程尚未开始，或资料正在征集中</div></div>' +
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
        '<div class="file-area-main">' +
          (returnState ? '<div class="fa-back-bar"><a href="#" onclick="returnToPreviousView();return false">← 返回' + (returnState.view === 'rankings' ? '排行榜' : returnState.view === 'home' ? '首页' : '最近上传') + '</a></div>' : '') +
          '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + ' — 资料列表</h3><span class="fa-count" id="fileCount">加载中...</span><span class="fa-per-page" id="perPageControl"></span>' + (code ? '<div class="fa-upload-header-btn">' + (currentUser ? '<button class="fa-upload-btn" onclick="showUploadModal(\'' + esc(code) + '\',\'' + esc(course.name) + '\')">+ 上传资料</button><button class="fa-upload-btn fa-batch-dl-btn" id="multiSelectToggle" onclick="toggleMultiSelect()">' + (isMgmtActive() ? '📋 批量操作' : '⬇ 批量下载') + '</button>' : '<button class="fa-upload-btn dl-login-prompt" onclick="event.stopPropagation();showLoginModal()" style="border-style:dashed">🔒 登录后上传</button>') + '</div>' : '') + '</div>' +
          '<div class="file-table-wrap"><div class="batch-dl-bar" id="batchDlBar"><span id="selectedCount">已选 0 个</span>' +
            '<button class="admin-btn admin-btn-sm" onclick="batchDeleteSelected()" id="batchDeleteBtn" style="display:none">🗑 删除选中</button>' +
            '<button class="admin-btn admin-btn-sm" onclick="showBatchEditDialog()" id="batchEditBtn" style="display:none">✏️ 编辑选中</button>' +
            '<button class="admin-btn admin-btn-sm" onclick="batchDownloadSelected()" id="batchDlBtn" style="margin-left:auto">⬇ 下载选中</button>' +
          '</div>' +
          '<div class="file-table-scroll"><table class="file-table" id="fileTable"><thead><tr><th class="th-name">文件名</th><th class="th-type">类型</th><th class="th-size">大小</th><th class="th-uploader">上传者</th><th class="th-teacher">任课教师</th><th class="th-dlcount">下载次数</th><th class="th-download"><span class="dl-normal">下载</span><span class="dl-check"><input type="checkbox" id="selectAllChkHead" onchange="toggleSelectAll(this)"> <span id="selectedCountHead"></span></span></th></tr></thead><tbody id="fileTableBody">' +
          '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint);padding:40px">加载中...</td></tr>' +
          '</tbody></table></div></div>' +
        '</div>' +
        (Object.keys(sameNameGroups).length ? '<div class="file-area-side-bottom"><div class="fasb-title">📚 同名课程（相同名称的不同课程代码）</div><div class="fasb-list">' +
          Object.values(sameNameGroups).map(g =>
            '<span class="fasb-item" onclick="showExplorer(\'' + g.type + '\');setTimeout(function(){navToLast(\'' + esc(g.courseId) + '\')},60)">' +
              '<span class="fasb-code">' + esc(g.courseId) + '</span>' +
              (g.programs.length ? '<span class="fasb-programs">（' + esc(g.programs.join(' / ')) + '）</span>' : '') +
            '</span>'
          ).join(' · ') +
        '</div></div>' : '');

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
          if (_multiSelectMode) { _multiSelectMode = false; _selectedIds = {}; var mBtn = document.getElementById('multiSelectToggle'); if (mBtn) mBtn.textContent = '⬇ 批量下载'; }
          var batchBar = document.getElementById('batchDlBar');
          if (batchBar) { batchBar.classList.remove('is-visible'); batchBar.style.display = ''; }
          var ft = document.getElementById('fileTable');
          if (ft) ft.classList.remove('multi-select');
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
          var dlLink = currentUser
            ? (f.can_download !== false
                ? '<a href="javascript:void(0)" class="dl-link" onclick="handleDownloadClick(' + f.id + ',this,event)">⬇ 下载</a>'
                : '<span class="dl-link dl-disabled" title="审核通过后可下载">⏳ 待审核</span>')
            : '<a href="javascript:void(0)" class="dl-link dl-login-prompt" onclick="event.stopPropagation();showLoginModal()">🔒 登录下载</a>';
          var isChecked = !!_selectedIds[f.id];
          var mgmt = isMgmtActive();
          // 管理模式：文件名和教师旁加铅笔（屏幕宽度 > 768px）
          var mgmtPens = mgmt && window.innerWidth > 768
            ? ('<span class="mgmt-pen" onclick="event.stopPropagation();showFileInfoModal(' + f.id + ')">✏️</span>')
            : '';
          var teacherPen = mgmt && window.innerWidth > 768
            ? ('<span class="mgmt-pen mgmt-pen-sm" onclick="event.stopPropagation();quickEditField(' + f.id + ',\'teacher\',\'' + esc(f.teacher || '') + '\')">✏️</span>')
            : '';
          return '<tr data-file-id="' + f.id + '"><td class="ft-name"><span class="fn-wrap">' + extBadge(f.file_name) + '<span class="fn-text" title="' + esc(f.title) + '">' + esc(f.title) + '</span>' + badgeHtml + mgmtPens + '</span></td>' +
            '<td class="ft-type-cell">' + esc(f.file_type) + '</td>' +
            '<td class="ft-size-cell">' + formatSize(f.file_size) + '</td>' +
            '<td class="ft-uploader">' + esc(f.uploader) + '</td>' +
            '<td class="ft-teacher">' + esc(f.teacher || '') + teacherPen + '</td>' +
            '<td class="ft-dlcount">' + f.download_count + ' 次</td>' +
            '<td class="ft-download"><span class="dl-normal">' + dlLink + '</span><span class="dl-check"><input type="checkbox" class="dl-chk" data-fid="' + f.id + '"' + (isChecked ? ' checked' : '') + ' onchange="onDlChkChange(this)"></span></td></tr>';
        }).join('');
        // 点击行显示文件简介
        Array.from(tbody.children).forEach(tr => {
          tr.addEventListener('click', function(e) {
            if (e.target.closest('.dl-link, .dl-chk, .dl-check')) return;
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

        // ── 同步多选模式 UI（下载列 ↔ 复选框，CSS 控制可见性，无布局抖动） ──
        if (_multiSelectMode) {
          syncMultiSelectUI();
        } else {
          var ft = document.getElementById('fileTable');
          if (ft) ft.classList.remove('multi-select');
          var batchBar = document.getElementById('batchDlBar');
          if (batchBar) batchBar.style.display = 'none';
        }

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
  var _fileInfoOverlay = null;

  function showFileInfoModal(file) {
    var existing = document.querySelector('.file-info-overlay');
    if (existing) existing.remove();

    // 根据文件名长度决定标题字号
    var titleLen = (file.title || '').length;
    var titleFontSize = titleLen > 20 ? '1.0rem' : (titleLen > 10 ? '1.15rem' : '1.3rem');

    // 权限检测：是否可编辑（上传者本人或有管辖权限的管理员）
    var canEdit = currentUser && (
      currentUser.role === 'super_admin'
      || currentUser.role === 'moderator'
      || currentUser.role === 'sub_moderator'
      || file.is_uploader
    );

    var penIcon = '<span class="fi-pen" onclick="fiEditField(this)" title="点击编辑">✏️</span>';
    var titleHtml = canEdit
      ? '<span class="fi-editable" data-field="title" data-fid="' + file.id + '">' + esc(file.title) + '</span>' + penIcon
      : esc(file.title);
    var teacherHtml = canEdit
      ? '<span class="fi-editable" data-field="teacher" data-fid="' + file.id + '">' + esc(file.teacher || '未填写') + '</span>' + penIcon
      : esc(file.teacher || '未填写');
    var descHtml = canEdit
      ? '<span class="fi-editable" data-field="description" data-fid="' + file.id + '">' + esc(file.description || '暂无简介') + '</span>' + penIcon
      : esc(file.description || '暂无简介');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay file-info-overlay';
    overlay.innerHTML =
      '<div class="modal-card file-info-card">' +
        '<button class="modal-close" onclick="closeFileInfoModal(event)">✕</button>' +
        '<h2 class="modal-title" style="font-size:' + titleFontSize + ';padding-right:28px;word-break:break-word">' + titleHtml + '</h2>' +
        '<div class="file-info-content">' +
          '<div class="fi-row"><span class="fi-label">课程名称</span><span class="fi-value">' + esc(file.course_name || file.course_code || '') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">文件名称</span><span class="fi-value">' + esc(file.file_name || '') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">文件类型</span><span class="fi-value">' + esc(file.file_type || '') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">文件大小</span><span class="fi-value">' + formatSize(file.file_size) + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">上传者</span><span class="fi-value">' + esc(file.uploader || '匿名') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">任课教师</span><span class="fi-value">' + teacherHtml + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">下载次数</span><span class="fi-value">' + file.download_count + ' 次</span></div>' +
          '<div class="fi-row"><span class="fi-label">上传日期</span><span class="fi-value">' + esc(file.created_at || '') + '</span></div>' +
          '<div class="fi-row fi-row-desc"><span class="fi-label">简介</span><span class="fi-value">' + descHtml + '</span></div>' +
          '<div style="text-align:center;margin-top:12px">' + (currentUser ? '<button class="fi-download-btn" onclick="handleDownloadClick(' + file.id + ',this,event)">⬇ 下载文件</button>' : '<a href="javascript:void(0)" class="fi-download-btn" onclick="event.stopPropagation();showLoginModal()" style="opacity:0.6">🔒 登录后下载</a>') + '</div>' +
          (file.can_delete ? '<div style="text-align:center;margin-top:10px"><button class="admin-btn admin-btn-reject" onclick="deleteFileConfirm(' + file.id + ',this)">🗑️ 删除此资料</button></div>' : '') +
        '</div>' +
      '</div>';
    overlay.addEventListener('click', function(e) {
      if (e.target === this) closeFileInfoModal(e);
    });
    document.body.appendChild(overlay);
    lockScroll();
    _fileInfoOverlay = overlay + 1; // 标记有弹窗
    _pushModalHistory();
  }

  // ── 文件详情内联编辑 ──
  function fiEditField(penEl) {
    var parent = penEl.parentElement;
    var span = parent.querySelector('.fi-editable');
    if (!span || span.querySelector('input')) return;
    var field = span.getAttribute('data-field');
    var fid = parseInt(span.getAttribute('data-fid'));
    var currentVal = span.textContent;
    if (!currentVal || currentVal === '未填写' || currentVal === '暂无简介') currentVal = '';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'fi-edit-input';
    input.value = currentVal;
    input.placeholder = field === 'title' ? '输入标题' : (field === 'teacher' ? '输入任课教师' : '输入简介');
    var original = span.textContent;
    span.textContent = '';
    span.appendChild(input);
    input.focus();
    input.select();
    penEl.textContent = '💾';
    penEl.onclick = function(e) {
      e.stopPropagation();
      fiSaveField(span, fid, field, input, penEl);
    };
    input.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') { fiSaveField(span, fid, field, input, penEl); }
      if (ev.key === 'Escape') { span.textContent = original; penEl.textContent = '✏️'; penEl.onclick = function(){fiEditField(penEl);}; }
    });
    input.addEventListener('blur', function() {
      // small delay to allow click on save button
      setTimeout(function() {
        if (!penEl.textContent.includes('✅')) {
          span.textContent = original;
          penEl.textContent = '✏️';
          penEl.onclick = function(){fiEditField(penEl);};
        }
      }, 200);
    });
  }

  function fiSaveField(spanEl, fid, field, input, penEl) {
    var val = input.value.trim();
    api('/api/files/' + fid + '/update/', { method: 'PATCH', body: (function(){var o={};o[field]=val;return o;})() }).then(function(data) {
      spanEl.textContent = data[field] || val || '未填写';
      penEl.textContent = '✅';
      penEl.onclick = function(){};
      setTimeout(function() { penEl.textContent = '✏️'; penEl.onclick = function(){fiEditField(penEl);}; }, 1500);
    }).catch(function(err) {
      alert('保存失败：' + err.message);
    });
  }

  // ── 管理模式表格行内快速编辑 ──
  function quickEditField(fid, field, currentVal) {
    var newVal = prompt('请输入新的' + (field === 'teacher' ? '任课教师' : '值'), currentVal);
    if (newVal === null || newVal === currentVal) return;
    api('/api/files/' + fid + '/update/', { method: 'PATCH', body: (function(){var o={};o[field]=newVal.trim();return o;})() }).then(function() {
      renderExplorer();
    }).catch(function(err) {
      alert('保存失败：' + err.message);
    });
  }

  // ── 关闭文件简介弹窗 ──
  var _skipPopstateRender = false;
  function closeFileInfoModal(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    var overlay = document.querySelector('.file-info-overlay');
    if (!overlay) return;
    unlockScroll();
    // 先移除弹窗，再修复历史状态
    overlay.remove();
    if (history.state && history.state._modal) {
      _skipPopstateRender = true;
      history.back();
      // 100ms 后清除标志（足够 popstate 处理完毕）
      setTimeout(function() { _skipPopstateRender = false; }, 100);
    }
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
      'rankingsView', 'recentAllView', 'profileView', 'notifView', 'adminView'
    ];
    views.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = '';
      el.classList.toggle('active', id.replace('View','') === name);
    });
    // 我的上传：仅在首页和个人中心显示
    var uploadsSec = document.getElementById('myUploadsSection');
    if (uploadsSec) {
      if (name === 'home' || name === 'profile') {
        loadMyUploads();  // 异步加载并显示
      } else {
        uploadsSec.style.display = 'none';
      }
    }
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
    pushViewState('tutorial', {});
    switchView('tutorial');
    updateSidebar('home');
    renderStaticView('tutorial');
  }

  function showAnnouncements() {
    pushViewState('announcements', {});
    switchView('announcements');
    updateSidebar('home');
    renderStaticView('announcements');
  }

  function showBroad() {
    pushViewState('broad', {});
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
    pushViewState('home', {}, _initialNav);
    _initialNav = false;
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
      else if (view === 'admin') showAdminPanel();
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
      else if (view === 'admin') showAdminPanel();
      drawer.classList.remove('open');
    });
  });

  // ── Browser Back/Forward Navigation ──
  window.addEventListener('popstate', function(e) {
    var s = e.state;
    _suppressingPushState = true;

    // 如果有打开的弹窗，关闭弹窗并阻止页面导航
    // 动态创建的弹窗（直接移除 DOM）
    var dynOverlay = document.querySelector('.file-info-overlay, .admin-reject-overlay, .search-overlay');
    if (dynOverlay) {
      dynOverlay.remove();
      unlockScroll();
      _suppressingPushState = false;
      return;
    }
    // 手动关闭弹窗后跳过视图重渲染（防止 renderExplorer 清空 _multiSelectMode）
    if (_skipPopstateRender) { _skipPopstateRender = false; _suppressingPushState = false; return; }
    // 持久化的模态框（隐藏而非删除）
    var modalOverlay = document.querySelector('.modal-overlay[style*="flex"]');
    if (modalOverlay) {
      modalOverlay.style.display = 'none';
      unlockScroll();
      _suppressingPushState = false;
      return;
    }

    // 孤立的 _modal 状态（无可见弹窗且无视图）→ 跳过继续回退
    if (s && s._modal && !s.view) {
      history.back();
      _suppressingPushState = false;
      return;
    }

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
        // 不要恢复旧的 scrollY — 页面高度已变，恢复反而导致位置错乱
        window.scrollTo({ top: 0 });
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
      case 'notif':
        showNotifFull();
        break;
      case 'admin':
        showAdminPanel();
        break;
      case 'tutorial':
        showTutorial();
        break;
      case 'announcements':
        showAnnouncements();
        break;
      case 'broad':
        showBroad();
        break;
    }
    _suppressingPushState = false;
  });

  // ── Init ──
  updateAuthUI();