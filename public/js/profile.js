  function showProfile() {
    // 关闭所有视图
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.style.display = 'none';
      v.classList.remove('active');
    });
    // 显示个人资料
    var pv = document.getElementById('profileView');
    if (pv) { pv.style.display = 'block'; pv.classList.add('active'); }
    updateSidebar(null);
    window.scrollTo({ top: 0 });
    pushViewState('profile', {});
    // 加载数据
    loadProfile();
    _updateFooterVisibility('profile');
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
      // ── Iter 7: 用户数据 ──
      var statUploads = document.getElementById('statUploads');
      var statDownloads = document.getElementById('statDownloads');
      var statCollections = document.getElementById('statCollections');
      if (statUploads) statUploads.textContent = data.upload_count || 0;
      if (statDownloads) statDownloads.textContent = data.download_count || 0;
      if (statCollections) statCollections.textContent = data.collection_count != null ? data.collection_count : '-';

      // ── Iter 7: 公开资料 ──
      var contactEmailEl = document.getElementById('pubContactEmail');
      var contactWayEl = document.getElementById('pubContactWay');
      var bioEl = document.getElementById('pubBio');
      if (contactEmailEl) contactEmailEl.value = data.contact_email || '';
      if (contactWayEl) contactWayEl.value = data.contact_way || '';
      if (bioEl) {
        bioEl.value = data.bio || '';
        var countEl = document.getElementById('pubBioCount');
        if (countEl) countEl.textContent = (data.bio || '').length;
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

  // ── 我的上传独立页面（Iter 6） ──
  function showMyUploadsPage() {
    closeNotifDrawer();
    // 彻底清除所有视图
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.style.display = 'none';
      v.classList.remove('active');
    });
    var v = document.getElementById('myUploadsView');
    if (v) { v.style.display = 'block'; v.classList.add('active'); }
    updateSidebar(null);
    window.scrollTo({ top: 0 });
    pushViewState('myuploads', {});
    renderMyUploadsPage();
    _updateFooterVisibility('myuploads');
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
        var ctype = m.course_type === 'general' ? '通识课' : '专业课';
        html += '<div class="hc-item" style="cursor:pointer" onclick="showExplorer(\'' + ctype + '\');navToLast(\'' + esc(m.course_code) + '\')">' +
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

  // ── 我的下载独立页面 ═══
  function showMyDownloadsPage() {
    closeNotifDrawer();
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.style.display = 'none';
      v.classList.remove('active');
    });
    var v = document.getElementById('myDownloadsView');
    if (v) { v.style.display = 'block'; v.classList.add('active'); }
    updateSidebar(null);
    window.scrollTo({ top: 0 });
    pushViewState('mydownloads', {});
    renderMyDownloadsPage();
    _updateFooterVisibility('mydownloads');
  }

  function renderMyDownloadsPage() {
    var list = document.getElementById('myDownloadsPageList');
    if (!list) return;
    list.innerHTML = '<div class="admin-loading">加载中…</div>';
    api('/api/user/downloads/').then(function(data) {
      if (!data || !data.length) {
        list.innerHTML = '<div class="admin-empty">暂无下载记录</div>';
        return;
      }
      list.innerHTML = data.map(function(r) {
        return '<div class="hc-item" style="cursor:pointer" onclick="navToMaterial(' + r.material_id + ',\'' + esc(r.course_code) + '\',\'' + esc(r.course_name) + '\')">' +
          '<div class="hc-item-left">' +
            '<div class="hc-item-name">' + esc(r.material_title) + '</div>' +
            '<div class="hc-item-meta">' + esc(r.course_name) + ' · ' + esc(r.created_at) + '</div>' +
          '</div>' +
          '<span class="hc-item-count">📥</span>' +
        '</div>';
      }).join('');
    }).catch(function(err) {
      list.innerHTML = '<div class="admin-empty">加载失败</div>';
    });
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
      // 刷新我的上传页面
      renderMyUploadsPage();
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
    if (newPwd.length < 8) { errEl.textContent = '新密码长度至少 8 位'; errEl.style.display = 'block'; return; }
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
  // ── Iter 7: 保存公开资料 ──
  async function savePublicProfile() {
    var contactEmail = document.getElementById('pubContactEmail').value.trim();
    var contactWay = document.getElementById('pubContactWay').value.trim();
    var bio = document.getElementById('pubBio').value.trim();
    var msgEl = document.getElementById('pubProfileMsg');
    if (bio.length > 200) { alert('个人简介不能超过 200 字'); return; }
    try {
      await api('/api/auth/profile/', { method: 'PATCH', body: {
        contact_email: contactEmail,
        contact_way: contactWay,
        bio: bio,
      }});
      if (msgEl) { msgEl.style.display = 'block'; setTimeout(function(){ msgEl.style.display = 'none'; }, 2000); }
    } catch (err) { alert('保存失败：' + err.message); }
  }

  // ── 公开资料实时字数统计 ──
  document.addEventListener('input', function(e) {
    if (e.target && e.target.id === 'pubBio') {
      var countEl = document.getElementById('pubBioCount');
      if (countEl) countEl.textContent = e.target.value.length;
    }
  });
