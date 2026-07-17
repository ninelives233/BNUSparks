  var currentUser = null;

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
      _persistToken(data.token, remember, data.user && data.user.id);
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
  function _persistToken(token, remember, userId) {
    sessionStorage.setItem('token', token);
    localStorage.setItem('token', token);
    localStorage.setItem('_loginTime', Date.now().toString());
    localStorage.setItem('_loginRemember', remember ? '1' : '0');
    if (userId) localStorage.setItem('bnusparks_user_id', String(userId));
  }

  async function checkAuth() {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (!token) { updateAuthUI(); return; }
    // 从 localStorage 恢复 sessionStorage（页面刷新后）
    // 但仅在 localStorage 用户 ID 与当前 session 一致时才恢复
    if (!sessionStorage.getItem('token') && localStorage.getItem('token')) {
      var savedUserId = localStorage.getItem('bnusparks_user_id');
      if (savedUserId) {
        sessionStorage.setItem('token', localStorage.getItem('token'));
      } else {
        // 无存储的用户 ID，安全起见不清除 localStorage 但也不恢复
      }
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
