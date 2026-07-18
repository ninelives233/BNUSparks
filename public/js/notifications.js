  var _mgmtMode = localStorage.getItem('bnusparks_mgmt') === '1';
  var _civilianMode = localStorage.getItem('bnusparks_civilian') === '1';

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
      '<a href="javascript:void(0)" class="dm-item" onclick="closeNotifDrawer();showMyDownloadsPage()"><span>📥</span> 我的下载</a>' +
	      '<a href="javascript:void(0)" class="dm-item" onclick="closeNotifDrawer();showMyFavoritesPage()"><span>⭐</span> 我的收藏</a>' +
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
          } else if (n.type === 'operation') {
            // 操作通知：如果有 material_id 则跳转到文件
            if (n.material_id) {
              linkHtml = '<div class="notif-item-link"><a href="javascript:void(0)" onclick="closeNotifDrawer();navToMaterial(' + n.material_id + ',\'' + esc(n.course_code || '') + '\',\'' + esc(n.course_name || '') + '\')">查看资料详情 →</a></div>';
            }
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
    if (materialId) {
      // 先尝试从缓存中获取文件数据
      if (window._fileLookup && window._fileLookup[materialId]) {
        showFileDetail(window._fileLookup[materialId]);
        return;
      }
      // 否则构建一个最小对象跳转到详情页
      showFileDetail({ id: materialId, title: courseName || ('#' + materialId), course_code: courseCode || '', course_name: courseName || '' });
    } else if (courseCode) {
      var type = courseCode.startsWith('GEN') ? '通识课' : '专业课';
      showExplorer(type);
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
