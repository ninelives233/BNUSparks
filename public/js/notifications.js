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

  // 抽屉扁平图标（弃用 emoji，与课程卡 CARD_ICONS 同语言：24 网格线形）
  // v=153：按语义分层 stroke-width——核心身份 1.9 / 内容动作 1.6 / 系统开关 1.4，
  // 颜色由 .dm-ico-* 类在 style.css 中按网站调性分配（品牌蓝/琥珀/成功绿/危险红/中性灰）。
  const DM_ICONS = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.5" r="3.5"/><path d="M5 21c1-3.5 4-5 7-5s6 1.5 7 5"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V5"/><path d="M6 11l6-6 6 6"/><path d="M4 20h16"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v11"/><path d="M6 11l6 6 6-6"/><path d="M4 20h16"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    mgmt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none"/></svg>',
    civilian: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  };

  // v=164：通知类型图标（24 网格线形，与 DM_ICONS 同语言；颜色按类型在 style.css 分配）
  var _NOTIF_ICONS = {
    approved: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
    rejected: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
    disagree: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="15.5" r="0.5" fill="currentColor"/></svg>',
    report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V3"/><path d="M6 4h11l-2.5 4L17 12H6"/></svg>',
    file_deleted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
    operation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>',
    // v=172：举报系统 4 类型（旗标 / 结果 / 升级 / 恶意提醒）
    report_alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
    report_result: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v4h6V3"/><path d="M9 12l2 2 4-4"/></svg>',
    report_escalated: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6"/><path d="M5 12l7-7 7 7"/></svg>',
    report_malicious: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>'
  };
  function _notifTypeIcon(type) { return _NOTIF_ICONS[type] || _NOTIF_ICONS.operation; }

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
      pushViewState('drawer', {});
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
    loadNotifications();
    pushViewState('drawer', { sub: 'notif' });
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
        return '<div class="notif-item notif-item-read" style="cursor:pointer" onclick="closeNotifDrawer();navToMaterial(' + r.material_id + ',\'' + escJs(r.course_code) + '\',\'' + escJs(r.course_name) + '\')">' +
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
    var mgmtToggle = '<label class="dm-toggle-row"><span class="dm-toggle-label"><span class="dm-ico dm-ico-mgmt">' + DM_ICONS.mgmt + '</span>管理模式</span><span class="ios-toggle' + (_mgmtMode ? ' ios-toggle-on' : '') + '" onclick="toggleMgmtMode()"><span class="ios-toggle-knob"></span></span></label>';
    var civilianToggle = '<label class="dm-toggle-row"><span class="dm-toggle-label"><span class="dm-ico dm-ico-civilian">' + DM_ICONS.civilian + '</span>平民模式</span><span class="ios-toggle' + (_civilianMode ? ' ios-toggle-on' : '') + '" onclick="toggleCivilianMode()"><span class="ios-toggle-knob"></span></span></label>';
    body.innerHTML =
      '<div class="dm-user">' +
        avatarHtml +
        '<div class="dm-info">' +
          '<div class="dm-name">' + esc(currentUser.nickname || currentUser.username) + '</div>' +
          '<div class="dm-role">' + roleLabel + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dm-divider"></div>' +
      '<a href="javascript:void(0)" class="dm-item" onclick="closeNotifDrawer();showProfile()"><span class="dm-ico dm-ico-user">' + DM_ICONS.user + '</span>个人中心</a>' +
      '<a href="javascript:void(0)" class="dm-item" onclick="showDrawerNotif()"><span class="dm-ico dm-ico-bell">' + DM_ICONS.bell + '</span>通知中心' + notifBadgeHtml + '</a>' +
      '<a href="javascript:void(0)" class="dm-item" onclick="closeNotifDrawer();showMyUploadsPage()"><span class="dm-ico dm-ico-upload">' + DM_ICONS.upload + '</span>我的上传</a>' +
      '<a href="javascript:void(0)" class="dm-item" onclick="closeNotifDrawer();showMyDownloadsPage()"><span class="dm-ico dm-ico-download">' + DM_ICONS.download + '</span>我的下载</a>' +
	      '<a href="javascript:void(0)" class="dm-item" onclick="closeNotifDrawer();showMyFavoritesPage()"><span class="dm-ico dm-ico-star">' + DM_ICONS.star + '</span>我的收藏</a>' +
      '<div class="dm-divider"></div>' +
      (showAdmin ? mgmtToggle + civilianToggle + '<div class="dm-divider"></div>' : '') +
      '<a href="javascript:void(0)" class="dm-item dm-logout" onclick="logout()"><span class="dm-ico dm-ico-logout">' + DM_ICONS.logout + '</span>退出登录</a>';
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
    document.body.classList.toggle('mgmt-active', isMgmtActive());
    renderDrawerMenu();
    // 如果当前在 explorer 视图，立刻刷新
    var exp = document.getElementById('explorerView');
    if (exp && exp.style.display !== 'none') renderExplorer();
    // 平民模式：显示侧边栏管理入口
    document.querySelectorAll('#sideAdminLink, #mobAdminLink').forEach(function(link) {
      link.style.display = (currentUser && currentUser.role !== 'user') ? '' : 'none';
    });
    // 文件详情页/弹窗即时反馈
    _refreshModeSensitiveViews();
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
    document.body.classList.toggle('mgmt-active', isMgmtActive());
    renderDrawerMenu();
    // 平民模式：隐藏侧边栏管理入口
    document.querySelectorAll('#sideAdminLink, #mobAdminLink').forEach(function(link) {
      link.style.display = (_civilianMode || !currentUser || currentUser.role === 'user') ? 'none' : '';
    });
    // 文件详情页/弹窗即时反馈
    _refreshModeSensitiveViews();
  }

  // 模式切换后即时重渲染依赖 _civilianMode 的视图（文件详情页 + 文件信息弹窗）
  function _refreshModeSensitiveViews() {
    var fdv = document.getElementById('fileDetailView');
    if (fdv && fdv.classList.contains('active') && window._currentDetailFile) {
      _renderFileDetail(window._currentDetailFile);
    }
    if (document.querySelector('.file-info-overlay') && window._currentInfoFile) {
      showFileInfoModal(window._currentInfoFile);
    }
  }

  function isMgmtActive() { return _mgmtMode && !_civilianMode && currentUser && currentUser.role !== 'user'; }

  async function loadNotifications() {
    const list = document.getElementById('notifList');
    const badge = document.getElementById('notifBadge');
    try {
      const data = await api('/api/auth/notifications/');
      // 合并本地已读缓存与服务器数据
      // v=164.1：分页后列表只含第 1 页，未读数以 unread_count 为权威
      var readSet = _getReadNotifSet();
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

      // v=164：抽屉只渲染最近 15 条；v=164.1：总数取后端 total（分页后权威）
      var total = (data.total != null) ? data.total : (data.list ? data.list.length : 0);
      var items = (data.list || []).slice(0, 15);
      var html = '';
      if (!items.length) {
        html += '<p class="notif-empty">暂无通知</p>';
      } else {
        html += items.map(function(n) {
          var isRead = n.is_read || readSet.has(n.id);
          var unreadClass = isRead ? 'notif-item-read' : 'notif-item-unread';
          var msgPreview = n.message ? (n.message.length > 40 ? esc(n.message).slice(0, 40) + '…' : esc(n.message)) : '';
          // 审核异议链接到管理后台
          var linkHtml = '';
          if (n.material_id) {
            if (n.type === 'disagree') {
              linkHtml = '<div class="notif-item-link"><a href="javascript:void(0)" onclick="closeNotifDrawer();navToReviewDispute(' + n.material_id + ')">管理后台查看异议 →</a></div>';
            } else if (n.type === 'rejected') {
              linkHtml = '<div class="notif-item-link"><a href="javascript:void(0)" onclick="navToReUpload(\'' + escJs(n.course_code || '') + '\',\'' + escJs(n.course_name || '') + '\')" style="font-weight:600">↻ 跳转到文件目录并重新上传 →</a></div>';
            } else if (n.type === 'operation') {
              // 操作通知：如果有 material_id 则跳转到文件
              if (n.material_id) {
                linkHtml = '<div class="notif-item-link"><a href="javascript:void(0)" onclick="closeNotifDrawer();navToMaterial(' + n.material_id + ',\'' + escJs(n.course_code || '') + '\',\'' + escJs(n.course_name || '') + '\')">查看资料详情 →</a></div>';
              }
            } else {
              linkHtml = '<div class="notif-item-link"><a href="javascript:void(0)" onclick="closeNotifDrawer();navToMaterial(' + n.material_id + ',\'' + escJs(n.course_code || '') + '\',\'' + escJs(n.course_name || '') + '\')">查看相关资料 →</a></div>';
            }
          }
          return '<div class="notif-item ' + unreadClass + '" data-nid="' + n.id + '">' +
            '<div class="notif-item-header" onclick="toggleNotifExpand(' + n.id + ', ' + (isRead ? 'true' : 'false') + ', this)">' +
              '<span class="notif-item-ico notif-ico-' + esc(n.type || 'operation') + '">' + _notifTypeIcon(n.type) + '</span>' +
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
                '<button class="notif-mark-btn" onclick="deleteOneNotif(' + n.id + ', this.closest(\'.notif-item\'), event)" style="color:var(--accent)"><span class="dm-ico notif-btn-ico">' + DM_ICONS.trash + '</span>删除</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      }
      // v=164：底部单一跳转按钮——有通知「查看全部N条通知」，无通知「进入通知中心」
      html += '<div class="notif-footer">' +
        '<button class="notif-view-all" onclick="closeNotifDrawer();showNotifFull()"><span class="dm-ico notif-btn-ico">' + DM_ICONS.list + '</span>' + (total > 0 ? '查看全部' + total + '条通知' : '进入通知中心') + '</button>' +
        '</div>';
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
    showExplorer(type).then(function(ready) {
      if (!ready || typeof showUploadModal !== 'function') {
        alert('上传模块加载失败，请刷新重试。');
        return;
      }
      navToLast(courseCode);
      showUploadModal(courseCode, courseName);
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

  function renderNotifFull(page) {
    page = page || 1;
    var el = document.getElementById('notifFullContent');
    if (!el) return;
    el.innerHTML = '<div class="admin-loading">加载中…</div>';
    api('/api/auth/notifications/?page=' + page).then(function(data) {
      var readSet = _getReadNotifSet();
      // v=164.1：未读数以 unread_count 为权威（分页后列表只含当前页）
      var realUnread = data.unread_count || 0;
      if (data.list) {
        data.list.forEach(function(n) { if (!n.is_read && readSet.has(n.id)) realUnread--; });
      }
      if (realUnread < 0) realUnread = 0;
      var total = (data.total != null) ? data.total : (data.list ? data.list.length : 0);
      // v=164：标题副标（#notifFullCount）+ 工具栏
      var countEl = document.getElementById('notifFullCount');
      if (countEl) countEl.textContent = '共 ' + total + ' 条' + (realUnread > 0 ? ' · ' + realUnread + ' 条未读' : '');
      var html = '<div class="notif-full-toolbar">' +
        '<div class="notif-full-actions">' +
          (realUnread > 0 ? '<button class="nf-btn" onclick="markAllNotifFullRead()"><span class="dm-ico notif-btn-ico">' + DM_ICONS.check + '</span>全部标为已读</button>' : '') +
          '<button class="nf-btn nf-btn-danger" onclick="clearAllNotifsFull()"><span class="dm-ico notif-btn-ico">' + DM_ICONS.trash + '</span>清空通知</button>' +
        '</div>' +
        '</div>';
      if (!total) {
        html += '<div class="nf-empty"><span class="nf-empty-ico">' + _NOTIF_ICONS.operation + '</span><div class="nf-empty-title">暂无通知</div><div class="nf-empty-sub">有新的审核、下载或互动消息时会出现在这里</div></div>';
        el.innerHTML = html;
        return;
      }
      // v=164.1：按已读/未读分组（未读前置，已读组可折叠）
      var unreadItems = [], readItems = [];
      (data.list || []).forEach(function(n) {
        var isRead = n.is_read || readSet.has(n.id);
        (isRead ? readItems : unreadItems).push(n);
      });
      function itemHtml(n) {
        var isRead = n.is_read || readSet.has(n.id);
        return '<div class="notif-full-item' + (isRead ? '' : ' notif-full-item-unread') + '" data-nid="' + n.id + '">' +
          '<div class="notif-full-header" onclick="toggleFullNotif(' + n.id + ', this)">' +
            '<span class="notif-full-ico notif-ico-' + esc(n.type || 'operation') + '">' + _notifTypeIcon(n.type) + '</span>' +
            '<div class="notif-full-info">' +
              '<div class="notif-full-title">' + esc(n.title) + '</div>' +
              '<div class="notif-full-meta">' + esc(n.created_at) + ' · ' + esc(n.type || '通知') + '</div>' +
            '</div>' +
            '<span class="notif-expand-icon">▾</span>' +
          '</div>' +
          '<div class="notif-full-body" style="display:none">' +
            '<div class="notif-full-msg">' + (n.message ? esc(n.message) : '') + '</div>' +
            (n.material_id ? '<div class="notif-full-link">' + (n.type === 'disagree' ? '<a href="javascript:void(0)" onclick="closeNotifDrawer();navToReviewDispute(' + n.material_id + ')">管理后台查看异议 →</a>' : '<a href="javascript:void(0)" onclick="navToMaterial(' + n.material_id + ',\'' + escJs(n.course_code || '') + '\',\'' + escJs(n.course_name || '') + '\')">查看相关资料 →</a>') + '</div>' : '') +
          '</div>' +
        '</div>';
      }
      html += '<div class="notif-full-list">';
      if (unreadItems.length) {
        html += '<div class="notif-full-group">' +
          '<div class="notif-full-group-head" onclick="toggleFullGroup(this)"><span class="ng-dot"></span>未读 <em>' + unreadItems.length + '</em><span class="ng-chevron">▾</span></div>' +
          '<div class="notif-full-group-list">' + unreadItems.map(itemHtml).join('') + '</div>' +
        '</div>';
      }
      if (readItems.length) {
        // 已读组默认折叠（未读优先）；无未读时展开
        var readCollapsed = unreadItems.length > 0;
        html += '<div class="notif-full-group">' +
          '<div class="notif-full-group-head' + (readCollapsed ? ' collapsed' : '') + '" onclick="toggleFullGroup(this)"><span class="ng-dot ng-dot--dim"></span>已读 <em>' + readItems.length + '</em><span class="ng-chevron">' + (readCollapsed ? '▸' : '▾') + '</span></div>' +
          '<div class="notif-full-group-list"' + (readCollapsed ? ' style="display:none"' : '') + '>' + readItems.map(itemHtml).join('') + '</div>' +
        '</div>';
      }
      html += '</div>';
      // v=164.1：翻页条（复用排行榜样式，窗口化页码）
      var totalPages = data.total_pages || 1;
      if (totalPages > 1) {
        html += _notifPager(page, totalPages);
      }
      el.innerHTML = html;
    }).catch(function(err) {
      el.innerHTML = '<div class="admin-empty">加载失败</div>';
    });
  }

  function _notifPager(page, totalPages) {
    var html = '<div class="leaderboard-pagination notif-pager">';
    html += '<button onclick="renderNotifFull(' + Math.max(1, page - 1) + ')" ' + (page <= 1 ? 'disabled' : '') + '>‹</button>';
    var lo = Math.max(1, page - 2), hi = Math.min(totalPages, page + 2);
    var pages = [];
    for (var i = lo; i <= hi; i++) pages.push(i);
    if (lo > 2) pages.unshift('…');
    if (lo > 1) pages.unshift(1);
    if (hi < totalPages - 1) pages.push('…');
    if (hi < totalPages) pages.push(totalPages);
    pages.forEach(function(p) {
      if (p === '…') { html += '<button disabled class="notif-pager-ellipsis">…</button>'; }
      else { html += '<button class="' + (p === page ? 'active' : '') + '" onclick="renderNotifFull(' + p + ')">' + p + '</button>'; }
    });
    html += '<button onclick="renderNotifFull(' + Math.min(totalPages, page + 1) + ')" ' + (page >= totalPages ? 'disabled' : '') + '>›</button>';
    html += '</div>';
    return html;
  }

  function toggleFullGroup(headEl) {
    var group = headEl.closest('.notif-full-group');
    if (!group) return;
    var list = group.querySelector('.notif-full-group-list');
    if (!list) return;
    var collapsed = list.style.display === 'none';
    list.style.display = collapsed ? '' : 'none';
    headEl.classList.toggle('collapsed', !collapsed);
    var chev = headEl.querySelector('.ng-chevron');
    if (chev) chev.textContent = collapsed ? '▾' : '▸';
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
