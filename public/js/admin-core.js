/* BNU Sparks · admin-core.js —— 管理后台框架：showAdminPanel/loadAdminPanel/switchAdminTab + 概览 renderAdminOverview。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
  // ── 管理后台（Iter 3） ──
  function adminFeatureForTab(tab) {
    if (tab === 'users') return 'admin-users';
    if (tab === 'pending' || tab === 'history') return 'admin-pending';
    if (tab === 'deletions' || tab === 'operations' || tab === 'report-history') return 'admin-records';
    if (tab === 'qa-records') return 'admin-qa';
    return null;
  }

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
    var persisted = typeof getPersistedViewState === 'function' ? getPersistedViewState() : null;
    var rememberedTab = (persisted && persisted.view === 'admin' && persisted.adminTab) ||
      sessionStorage.getItem('bnusparks_admin_tab') || 'overview';
    var adminState = { adminTab: rememberedTab };
    // 进入后台时不要只重写顶层 Tab，把当前后台的内层分区/筛选一起带上；
    // 否则从后台离开再返回，或启动阶段重写路由时，会抹掉可恢复的子状态。
    if (persisted && persisted.view === 'admin') {
      ['adminUserSection', 'pendingType', 'adminMonitorPeriod', 'adminIdentityPeriod',
        'adminIdentityEducation', 'adminTimetablePeriod', 'adminDownloadActivity',
        'adminHealthPeriod', 'adminHealthAutoRefresh', 'adminEventsPeriod', 'adminEventsDate'].forEach(function(key) {
        if (Object.prototype.hasOwnProperty.call(persisted, key)) adminState[key] = persisted[key];
      });
    }
    pushViewState('admin', adminState);
    _updateFooterVisibility('admin');
    if (window.BnuMonitoring && typeof window.BnuMonitoring.track === 'function') {
      window.BnuMonitoring.track('view.open', { view_name: 'admin' });
    }
    // 从首页首次进入后台时，先补齐后台公共样式，再加载当前 Tab 的脚本。
    if (typeof ensureFeature === 'function' &&
        !(window._bnusparksFeatureReady && window._bnusparksFeatureReady.admin)) {
      var adminContent = document.getElementById('adminContent');
      if (adminContent) adminContent.innerHTML = '<div class="admin-loading">管理后台加载中…</div>';
      ensureFeature('admin').then(loadAdminPanel).catch(function() {
        if (adminContent) adminContent.innerHTML = '<div class="admin-empty">管理后台加载失败，请刷新重试。</div>';
      });
      return;
    }
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
    // 举报记录 tab（所有管理员可见，可见性原则与操作记录一致）
    var repHistTab = document.querySelector('.admin-tab[data-tab="report-history"]');
    if (repHistTab) repHistTab.style.display = '';
    // 论坛记录 tab（仅问答区版主 / 超管可见）
    var qaTab = document.getElementById('adminQaTab');
    if (qaTab) {
      qaTab.style.display = currentUser && (currentUser.role === 'super_admin' || currentUser.can_moderate_qa) ? '' : 'none';
    }
    // 绑定 tab 切换（保存 tab 状态到 sessionStorage）
    document.querySelectorAll('.admin-tab').forEach(function(tab) {
      tab.onclick = function() {
        document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        var tabName = tab.getAttribute('data-tab');
        sessionStorage.setItem('bnusparks_admin_tab', tabName);
        if (typeof patchViewState === 'function') patchViewState({ adminTab: tabName });
        switchAdminTab(tabName);
      };
    });
    // 从 sessionStorage 恢复上次的 tab
    var persistedState = typeof getPersistedViewState === 'function' ? getPersistedViewState() : null;
    var savedTab = (persistedState && persistedState.view === 'admin' && persistedState.adminTab) ||
      sessionStorage.getItem('bnusparks_admin_tab') || 'overview';
    var validTabs = ['overview', 'pending', 'history', 'deletions', 'operations', 'report-history', 'qa-records', 'users'];
    if (validTabs.indexOf(savedTab) === -1) savedTab = 'overview';
    document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
    var tabBtn = document.querySelector('.admin-tab[data-tab="' + savedTab + '"]');
    if (!tabBtn || tabBtn.style.display === 'none') savedTab = 'overview';
    tabBtn = document.querySelector('.admin-tab[data-tab="' + savedTab + '"]');
    if (tabBtn) tabBtn.classList.add('active');
    sessionStorage.setItem('bnusparks_admin_tab', savedTab);
    if (typeof patchViewState === 'function') patchViewState({ adminTab: savedTab });
    switchAdminTab(savedTab);
  }

  function switchAdminTab(tab) {
    var content = document.getElementById('adminContent');
    if (!content) return;
    // 管理端按 Tab 加载模块；用户管理不再等待待审/问答/记录脚本。
    var feature = adminFeatureForTab(tab);
    if (feature && typeof ensureFeature === 'function' &&
        !(window._bnusparksFeatureReady && window._bnusparksFeatureReady[feature])) {
      content.innerHTML = '<div class="admin-loading">管理模块加载中…</div>';
      ensureFeature(feature).then(function() {
        switchAdminTab(tab);
      }).catch(function() {
        content.innerHTML = '<div class="admin-empty">管理模块加载失败，请刷新重试。</div>';
      });
      return;
    }
    if (tab === 'overview') renderAdminOverview(content);
    else if (tab === 'pending') renderAdminPending(content);
    else if (tab === 'history') renderAdminHistory(content, 1);
    else if (tab === 'deletions') renderAdminDeletions(content, 1);
    else if (tab === 'users') renderAdminUsers(content, '', 1);
    else if (tab === 'operations') renderAdminOperations(content);
    else if (tab === 'report-history') renderAdminReportHistory(content, 1);
    else if (tab === 'qa-records') renderAdminQaRecords(content, 1);
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
      var html = '<div class="admin-section-label">' + iconSvg('chart') + ' 数据概览</div>' +
        '<div class="admin-stats-grid">' +
        '<div class="admin-stat-card stat-card--lead"><div class="stat-icon stat-icon--amber">' + iconSvg('clock') + '</div><div class="stat-number">' + (stats.pending_count || 0) + '</div><div class="stat-label">待审核</div></div>' +
        '<div class="admin-stat-card"><div class="stat-icon">' + iconSvg('check-circle') + '</div><div class="stat-number">' + (stats.total_approved || 0) + '</div><div class="stat-label">已通过</div></div>' +
        '<div class="admin-stat-card"><div class="stat-icon stat-icon--green">' + iconSvg('chart') + '</div><div class="stat-number">' + (stats.approved_today || 0) + '</div><div class="stat-label">今日通过</div></div>' +
        '<div class="admin-stat-card"><div class="stat-icon stat-icon--orange">' + iconSvg('archive') + '</div><div class="stat-number">' + (stats.total_materials || 0) + '</div><div class="stat-label">管辖范围总数</div></div>' +
        '</div>';
      // 待审核快速入口（v180：收进卡片容器 + 分区线）
      if (stats.pending_count > 0) {
        html += '<div class="pc-section-divider"></div><div class="ov-tool-card"><div class="pc-title">' + iconSvg('clock') + ' 待审核快速入口</div>' +
          '<button class="admin-btn admin-btn-primary" onclick="switchAdminTab(\'pending\');document.querySelector(\'[data-tab=pending]\').click()">查看 ' + stats.pending_count + ' 条待审核资料 →</button></div>';
      }
      // 自动托管开关（仅版主/小版主有 can_auto_approve 时显示，v180 收进卡片容器）
      if (profile.can_auto_approve) {
        var isOn = profile.auto_approve;
        html += '<div class="pc-section-divider"></div><div class="ov-tool-card"><div class="admin-auto-toggle">' +
          '<span><strong>' + iconSvg('shield') + ' 自动托管审核</strong><br><span class="at-hint">开启后自动通过管辖板块内所有新上传的资料</span></span>' +
          '<button class="admin-btn ' + (isOn ? 'admin-btn-approve' : 'admin-btn-secondary') + '" onclick="toggleAutoApprove(this)">' + iconSvg(isOn ? 'check-circle' : 'pause') + (isOn ? ' 已开启' : ' 已关闭') + '</button>' +
        '</div></div>';
      }
      content.innerHTML = html;
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">加载失败：' + esc(err.message) + '</div>';
    });
  }
