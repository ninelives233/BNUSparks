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
      content.innerHTML = '<div class="admin-empty">加载失败：' + esc(err.message) + '</div>';
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
      content.innerHTML = '<div class="admin-empty">加载失败：' + esc(err.message) + '</div>';
    });
  }

  // ── 待审核 ──
  var _pendingIncludeSub = false;
  var _pendingHidePeerApproved = true;
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
        '<label class="pc-toolbar-toggle" title="默认隐藏同僚已通过的记录，勾选后显示">' +
          '<input type="checkbox" ' + (!_pendingHidePeerApproved ? 'checked' : '') + ' onchange="togglePendingHidePeerApproved(!this.checked)"> 显示同僚已通过' +
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
      content.innerHTML = '<div class="admin-empty">加载失败：' + esc(err.message) + '</div>';
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
    if (!confirm('确认删除此文件？此操作将在48小时内可撤销。')) return;
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
    // 尝试从当前 pending list 卡片中获取数据
    var card = document.getElementById('pc-' + materialId);
    if (card) {
      // 从卡片提取信息
      var title = card.querySelector('.pc-title') ? card.querySelector('.pc-title').textContent : '';
      var metaEls = card.querySelectorAll('.pc-meta span');
      var courseName = '', uploader = '', createdAt = '', fileSize = '';
      if (metaEls[0]) courseName = metaEls[0].textContent.replace(/^📚 /, '');
      if (metaEls[1]) uploader = metaEls[1].textContent.replace(/^👤 /, '');
      if (metaEls[2]) createdAt = metaEls[2].textContent.replace(/^📅 /, '');
      if (metaEls[3]) fileSize = metaEls[3].textContent.replace(/^📄 /, '');
      var fileObj = {
        id: materialId,
        title: title,
        course_name: courseName,
        course_code: '',
        file_name: title,
        file_size: parseInt(fileSize) || 0,
        file_type: '未知',
        uploader: uploader,
        teacher: '待填',
        description: '',
        download_count: 0,
        created_at: createdAt,
        is_uploader: false,
        can_delete: currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'moderator' || currentUser.role === 'sub_moderator'),
        is_admin_uploaded: false,
      };
      showFileInfoModal(fileObj);
      return;
    }
    // 降级：尝试从 API 加载
    api('/api/user/uploads/').then(function(data) {
      var item = data ? data.find(function(m) { return m.id === materialId; }) : null;
      if (item) {
        var fileObj = {
          id: item.id,
          title: item.title,
          course_name: item.course_name,
          course_code: item.course_code,
          file_name: item.file_name || item.title,
          file_size: item.file_size,
          file_type: item.file_type || '未知',
          uploader: item.uploader_name || '匿名',
          teacher: item.teacher || '',
          description: item.description || '',
          download_count: item.download_count || 0,
          created_at: item.created_at || '',
          is_uploader: false,
          can_delete: currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'moderator' || currentUser.role === 'sub_moderator'),
          is_admin_uploaded: false,
        };
        showFileInfoModal(fileObj);
      } else {
        alert('无法加载文件详情');
      }
    }).catch(function() {
      alert('无法加载文件详情');
    });
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
      content.innerHTML = '<div class="admin-empty">加载失败：' + esc(err.message) + '</div>';
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
      content.innerHTML = '<p style="text-align:center;color:var(--ink-faint);padding:40px">加载失败：' + esc(err.message || '未知错误') + '</p>';
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

  async function renderAdminOperations(content, page) {
    if (page !== undefined) _opPage = page;
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
      content.innerHTML = '<p style="text-align:center;color:var(--ink-faint);padding:40px">加载失败：' + esc(err.message || '未知错误') + '</p>';
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
      content.innerHTML = '<div class="admin-empty">加载失败：' + esc(err.message) + '</div>';
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
