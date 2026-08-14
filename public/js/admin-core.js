/* BNU Sparks · admin-core.js —— 管理后台框架：showAdminPanel/loadAdminPanel/switchAdminTab + 概览 renderAdminOverview。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
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
    loadAdminPanel();
    _updateFooterVisibility('admin');
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
      var html = '<div class="admin-section-label">📊 数据概览</div>' +
        '<div class="admin-stats-grid">' +
        '<div class="admin-stat-card stat-card--lead"><div class="stat-icon stat-icon--amber">⏳</div><div class="stat-number">' + (stats.pending_count || 0) + '</div><div class="stat-label">待审核</div></div>' +
        '<div class="admin-stat-card"><div class="stat-icon">✅</div><div class="stat-number">' + (stats.total_approved || 0) + '</div><div class="stat-label">已通过</div></div>' +
        '<div class="admin-stat-card"><div class="stat-icon stat-icon--green">📈</div><div class="stat-number">' + (stats.approved_today || 0) + '</div><div class="stat-label">今日通过</div></div>' +
        '<div class="admin-stat-card"><div class="stat-icon stat-icon--orange">📦</div><div class="stat-number">' + (stats.total_materials || 0) + '</div><div class="stat-label">管辖范围总数</div></div>' +
        '</div>';
      // 待审核快速入口（v180：收进卡片容器 + 分区线）
      if (stats.pending_count > 0) {
        html += '<div class="pc-section-divider"></div><div class="ov-tool-card"><div class="pc-title">⏳ 待审核快速入口</div>' +
          '<button class="admin-btn admin-btn-primary" onclick="switchAdminTab(\'pending\');document.querySelector(\'[data-tab=pending]\').click()">查看 ' + stats.pending_count + ' 条待审核资料 →</button></div>';
      }
      // 自动托管开关（仅版主/小版主有 can_auto_approve 时显示，v180 收进卡片容器）
      if (profile.can_auto_approve) {
        var isOn = profile.auto_approve;
        html += '<div class="pc-section-divider"></div><div class="ov-tool-card"><div class="admin-auto-toggle">' +
          '<span><strong>🤖 自动托管审核</strong><br><span class="at-hint">开启后自动通过管辖板块内所有新上传的资料</span></span>' +
          '<button class="admin-btn ' + (isOn ? 'admin-btn-approve' : 'admin-btn-secondary') + '" onclick="toggleAutoApprove(this)">' + (isOn ? '✅ 已开启' : '⏸ 已关闭') + '</button>' +
        '</div></div>';
      }
      content.innerHTML = html;
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">加载失败：' + esc(err.message) + '</div>';
    });
  }
