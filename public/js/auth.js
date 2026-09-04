  var currentUser = null;
  var _pendingVerificationEmail = '';
  var _verificationResendTimer = null;

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

  function showLoginModal() {
    var modal = document.getElementById('loginModal');
    modal.style.display = 'flex';
    lockScroll();
    _pushModalHistory(modal);
  }
  function showRegister() {
    document.getElementById('loginModal').style.display = 'none';
    var modal = document.getElementById('registerModal');
    modal.style.display = 'flex';
    document.getElementById('registerResendAction').style.display = 'block';
    activateDialog(modal);
    populateIdentitySelects('regCollege', 'regMajor', {});
  }
  function showVerificationResend(message) {
    showRegister();
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('registerSuccess').style.display = 'none';
    document.getElementById('registerError').style.display = 'none';
    document.querySelectorAll('.register-resend-status').forEach(function(status) {
      status.textContent = message || '填写上方学号并选择邮箱后缀，然后重新发送验证邮件。';
    });
    var sidInput = document.getElementById('regSid');
    if (sidInput) setTimeout(function() { sidInput.focus(); }, 80);
  }
  function showLogin() {
    document.getElementById('registerModal').style.display = 'none';
    var modal = document.getElementById('loginModal');
    modal.style.display = 'flex';
    activateDialog(modal);
  }
  function closeAuthModal() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('registerModal').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('registerError').style.display = 'none';
    document.getElementById('registerResendAction').style.display = 'none';
    document.getElementById('registerSuccess').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    _clearVerificationResendState();
    _pendingVerificationEmail = '';
    unlockScroll();
    _popModalHistory();
    // 清除密码字段
    var pw = document.getElementById('regPassword');
    var pwc = document.getElementById('regPasswordConfirm');
    if (pw) pw.value = '';
    if (pwc) pwc.value = '';
  }

  // 身份标签：注册/个人中心编辑共用的学院+专业联动；培养层次为固定四项。
  // preset = { college, major }，用于编辑时回填当前身份。
  async function populateIdentitySelects(collegeSelId, majorSelId, preset) {
    preset = preset || {};
    const collegeSel = document.getElementById(collegeSelId);
    const majorSel = document.getElementById(majorSelId);
    if (!collegeSel || !majorSel) return;
    let colleges = [];
    try { colleges = await api('/api/colleges/'); } catch(e) { /* 拉取失败则只有「其他」 */ }
    // 经济与工商管理学院排第一，其余保持原顺序，最后「其他」（预防学院未收录）
    var ordered = colleges.slice().sort(function(a, b) {
      var aEc = /经济与工商/.test(a.name);
      var bEc = /经济与工商/.test(b.name);
      return aEc === bEc ? 0 : (aEc ? -1 : 1);
    });
    collegeSel.innerHTML = '<option value="">学院</option>' +
      ordered.map(function(c) { return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('') +
      '<option value="其他">其他</option>';
    if (preset.college) collegeSel.value = preset.college;
    await fillIdentityMajors(collegeSelId, majorSelId, preset.major || '');
  }

  // 依据所选学院联动专业列表；「其他」学院 → 专业强制「其他」
  async function fillIdentityMajors(collegeSelId, majorSelId, presetMajor) {
    const collegeSel = document.getElementById(collegeSelId);
    const majorSel = document.getElementById(majorSelId);
    if (!collegeSel || !majorSel) return;
    var college = collegeSel.value;
    if (!college) {
      majorSel.innerHTML = '<option value="">专业</option>';
      majorSel.value = '';
      majorSel.disabled = true;
      return;
    }
    if (college === '其他') {
      majorSel.innerHTML = '<option value="其他">其他</option>';
      majorSel.value = '其他';
      majorSel.disabled = true;
      return;
    }
    if (typeof courseTree === 'undefined' || !courseTree || !courseTree['专业课']) {
      if (typeof ensureFeature === 'function' && typeof loadCourseTree !== 'function') {
        await ensureFeature('explorer');
      }
      if (typeof loadCourseTree === 'function') await loadCourseTree();
    }
    var kids = (typeof courseTree !== 'undefined' && courseTree && courseTree['专业课'] && courseTree['专业课'].children) || [];
    var colNode = kids.find(function(c) { return c.name === college; }) || null;
    // 只抓取「父节点」（有子目录）作为专业选项，过滤 divider
    var majors = (colNode && colNode.children || []).filter(function(c) {
      return !c.divider && c.children && c.children.length;
    });
    majorSel.innerHTML = '<option value="">请选择专业…</option>' +
      majors.map(function(m) { return '<option value="' + esc(m.name) + '">' + esc(m.name) + '</option>'; }).join('') +
      '<option value="其他">其他</option>';
    majorSel.disabled = false;
    if (presetMajor && majors.some(function(m) { return m.name === presetMajor; })) {
      majorSel.value = presetMajor;
    }
  }

  function onRegCollegeChange() {
    fillIdentityMajors('regCollege', 'regMajor', '');
  }

  async function handleLogin(e) {
    e.preventDefault();
    const el = document.getElementById('loginError');
    try {
      var sid = document.getElementById('loginSid').value.trim();
      var remember = document.getElementById('loginRemember').checked;
      if (!sid) throw new Error('请输入学号');
      // 发送纯学号，后端依次尝试 @mail.bnu.edu.cn 与 @bnu.edu.cn 两种后缀
      const data = await api('/api/auth/login/', { method: 'POST',
        body: { username: sid, password: document.getElementById('loginPassword').value, remember: remember } });
      _persistToken(data.token, remember, data.user && data.user.id);
      currentUser = data.user;
      closeAuthModal(); updateAuthUI();
    } catch (err) { el.textContent = err.message; el.style.display = 'block'; }
    return false;
  }

  // ── 忘记密码 ──
  function showForgotPassword() {
    var hadAuthModal = ['loginModal', 'registerModal'].some(function(id) {
      return document.getElementById(id).style.display !== 'none';
    });
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('registerModal').style.display = 'none';
    var modal = document.getElementById('forgotPwdModal');
    modal.style.display = 'flex';
    document.getElementById('forgotPwdForm').style.display = 'block';
    document.getElementById('forgotPwdSuccess').style.display = 'none';
    document.getElementById('forgotPwdError').style.display = 'none';
    if (!hadAuthModal) { lockScroll(); _pushModalHistory(modal); }
    else activateDialog(modal);
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
      // 用户自选邮箱后缀，拼成完整邮箱提交（后端按完整邮箱查找）
      var suffixEl = document.getElementById('forgotSuffix');
      var suffix = (suffixEl && suffixEl.value) || '@mail.bnu.edu.cn';
      const data = await api('/api/auth/forgot-password/', { method: 'POST',
        body: { email: sid + suffix } });
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
    var modal = document.getElementById('resetPwdModal');
    modal.style.display = 'flex';
    document.getElementById('resetPwdForm').style.display = 'block';
    document.getElementById('resetPwdSuccess').style.display = 'none';
    document.getElementById('resetPwdError').style.display = 'none';
    document.getElementById('resetNewPwd').value = '';
    document.getElementById('resetConfirmPwd').value = '';
    lockScroll();
    _pushModalHistory(modal);
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

  // ── 注册验证邮件重发 ──
  function _clearVerificationResendState() {
    if (_verificationResendTimer) {
      clearTimeout(_verificationResendTimer);
      _verificationResendTimer = null;
    }
    document.querySelectorAll('.register-resend-btn').forEach(function(btn) {
      btn.disabled = false;
      btn.textContent = '重新发送验证邮件';
    });
    document.querySelectorAll('.register-resend-status').forEach(function(status) {
      status.textContent = '';
    });
  }

  function _startVerificationResendCooldown(seconds, message) {
    var remaining = Math.max(1, Number(seconds) || 60);
    if (_verificationResendTimer) clearTimeout(_verificationResendTimer);
    document.querySelectorAll('.register-resend-btn').forEach(function(btn) {
      btn.disabled = true;
    });

    function tick() {
      var suffix = remaining > 0 ? '（' + remaining + ' 秒后可再次发送）' : '';
      document.querySelectorAll('.register-resend-btn').forEach(function(btn) {
        btn.disabled = remaining > 0;
        btn.textContent = remaining > 0 ? '重新发送（' + remaining + ' 秒）' : '重新发送验证邮件';
      });
      document.querySelectorAll('.register-resend-status').forEach(function(status) {
        status.textContent = (message || '验证邮件已重新发送。') + suffix;
      });
      if (remaining > 0) {
        remaining--;
        _verificationResendTimer = setTimeout(tick, 1000);
      } else {
        _verificationResendTimer = null;
      }
    }
    tick();
  }

  async function resendVerificationEmail() {
    var statuses = document.querySelectorAll('.register-resend-status');
    var buttons = document.querySelectorAll('.register-resend-btn');
    var sidInput = document.getElementById('regSid');
    var sid = sidInput ? sidInput.value.trim() : '';
    if (sid) {
      var suffixEl = document.getElementById('regEmailSuffix');
      var suffix = suffixEl ? suffixEl.value : '@mail.bnu.edu.cn';
      _pendingVerificationEmail = sid.indexOf('@') === -1 ? sid + suffix : sid.toLowerCase();
    }
    if (!_pendingVerificationEmail) {
      statuses.forEach(function(status) { status.textContent = '请先填写上方学号并选择邮箱后缀。'; });
      return;
    }
    buttons.forEach(function(btn) { btn.disabled = true; });
    statuses.forEach(function(status) { status.textContent = '正在发送验证邮件…'; });
    try {
      var data = await api('/api/auth/resend-verification/', { method: 'POST',
        body: { email: _pendingVerificationEmail } });
      _startVerificationResendCooldown(data.cooldown_seconds, data.message);
    } catch (err) {
      buttons.forEach(function(btn) { btn.disabled = false; });
      statuses.forEach(function(status) { status.textContent = err.message; });
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    const el = document.getElementById('registerError');
    const form = document.getElementById('registerForm');
    const success = document.getElementById('registerSuccess');
    try {
      var sid = document.getElementById('regSid').value.trim();
      if (!sid) throw new Error('请输入学号');
      var suffix = document.getElementById('regEmailSuffix') ? document.getElementById('regEmailSuffix').value : '@mail.bnu.edu.cn';
      var email = sid.indexOf('@') === -1 ? sid + suffix : sid.toLowerCase();
      _pendingVerificationEmail = email;
      var password = document.getElementById('regPassword').value;
      var passwordConfirm = document.getElementById('regPasswordConfirm').value;
      var education = (document.getElementById('regEducation') || { value: '' }).value || '';
      var college = (document.getElementById('regCollege') || { value: '' }).value || '';
      var major = (document.getElementById('regMajor') || { value: '' }).value || '';
      if (password.length < 8) throw new Error('密码长度至少 8 位');
      if (password !== passwordConfirm) throw new Error('两次密码输入不一致');
      if (!education || !college || !major) throw new Error('请选择培养层次、学院和专业');
      await api('/api/auth/register/', { method: 'POST',
        body: { email: email,
                nickname: document.getElementById('regNickname').value.trim(),
                password: password,
                education: education,
                college: college,
                major: major } });
      // 不自动登录 — 用户需要先验证邮箱
      el.style.display = 'none';
      form.style.display = 'none';
      document.getElementById('registerResendAction').style.display = 'none';
      success.style.display = 'block';
      // 清除密码字段
      document.getElementById('regPassword').value = '';
      document.getElementById('regPasswordConfirm').value = '';
    } catch (err) {
      el.textContent = err.message;
      el.style.display = 'block';
      success.style.display = 'none';
      var resendAction = document.getElementById('registerResendAction');
      var canResend = (err.message || '').indexOf('未验证') !== -1;
      resendAction.style.display = 'block';
      if (!canResend) _clearVerificationResendState();
    }
    return false;
  }

  function logout() {
    clearAuthToken();
    sessionStorage.removeItem('bnusparks_qa_guest'); // 问答区 2026 门控标记
    currentUser = null;
    location.reload();
  }

  // ── Token 持久化：sessionStorage（当前会话）+ localStorage（跨会话） ──
  function _persistToken(token, remember, userId) {
    setAuthTokenCache(token);
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
    }
    catch (err) {
      // 只有服务端明确拒绝认证时才清 token；断网/超时保留会话，避免误登出。
      if (err && (err.status === 401 || err.status === 403)) _clearStaleToken();
      updateAuthUI();
    }
  }

  function _clearStaleToken() {
    clearAuthToken();
  }

  var _notifCountPromise = null;

  // 启动、focus、visibilitychange 可能同时触发徽章刷新；复用进行中的请求。
  function loadNotifCount() {
    if (_notifCountPromise) return _notifCountPromise;
    var promise = _loadNotifCount();
    _notifCountPromise = promise;
    promise.then(function() {
      if (_notifCountPromise === promise) _notifCountPromise = null;
    }, function() {
      if (_notifCountPromise === promise) _notifCountPromise = null;
    });
    return promise;
  }

  async function _loadNotifCount() {
    try {
      const data = await api('/api/auth/notifications/?unread_only=1');
      const badge = document.getElementById('notifBadge');
      if (!badge) return;
      // 与通知中心同一口径：服务端未读 && 本地未标已读
      // v=164.1：分页后列表只含第 1 页，未读数必须以 unread_count 为权威，
      // 再扣掉本地已标已读但服务端仍未读的（瞬时同步窗口）
      var readSet = (typeof _getReadNotifSet === 'function') ? _getReadNotifSet() : new Set();
      var realUnread = data.unread_count || 0;
      if (data.list) {
        data.list.forEach(function(n) {
          if (!n.is_read && readSet.has(n.id)) realUnread--;
        });
      }
      if (realUnread < 0) realUnread = 0;
      if (realUnread > 0) {
        badge.textContent = realUnread > 99 ? '99+' : realUnread;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    } catch(e) { /* ignore */ }
  }
