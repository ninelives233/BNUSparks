/* BNU Sparks · admin-pending.js —— 待审核+审核历史：renderAdminPending/_userPill/quickApprove/deleteFileConfirm/renderAdminHistory 等。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */

  // ── 待审核 ──
  var _pendingIncludeSub = false;
  var _pendingHidePeerApproved = true;
  var _highlightDisputeMaterialId = null;
  var _pendingItems = {}; // {id: 原始待审核项} — 详情弹窗直接取原始数据（file_size 为字节）
  var _pendingType = 'file'; // 审核类型分段控制器：'file' 文件上传 | 'course' 课程创建 | 'forum' 论坛管理 | 'report' 举报受理
  var _pendingPage = { file: 1, course: 1 }; // 客户端分页（每类独立页码）

  // 待审核卡片「上传者 pill」：26px 头像 + 名字，点击跳用户主页
  function _userPill(name, avatar, uid) {
    var av = avatar
      ? '<img src="' + esc(avatar) + '" class="cr-pill-avatar" alt="">'
      : '<span class="cr-pill-avatar cr-pill-avatar-ph">' + esc((name || '?').charAt(0).toUpperCase()) + '</span>';
    var click = uid ? ' onclick="showUserPublic(' + uid + ')" title="查看用户主页"' : '';
    return '<span class="cr-user-pill"' + click + '>' + av + '<span class="cr-pill-name">' + esc(name || '匿名') + '</span></span>';
  }

  // 待审核分页控件（复用 .file-pagination 样式）
  function _pendingPagination(totalPages, current, type) {
    if (totalPages <= 1) return '';
    var h = '<div class="file-pagination">';
    h += '<button class="fp-btn' + (current <= 1 ? ' fp-disabled' : '') + '"' + (current <= 1 ? ' disabled' : '') + ' onclick="pendingGoPage(\'' + type + '\',' + (current - 1) + ')">‹</button>';
    for (var p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || Math.abs(p - current) <= 1) {
        h += '<button class="fp-btn' + (p === current ? ' fp-active' : '') + '" onclick="pendingGoPage(\'' + type + '\',' + p + ')">' + p + '</button>';
      } else if (Math.abs(p - current) === 2) {
        h += '<span class="fp-btn fp-ellipsis">…</span>';
      }
    }
    h += '<button class="fp-btn' + (current >= totalPages ? ' fp-disabled' : '') + '"' + (current >= totalPages ? ' disabled' : '') + ' onclick="pendingGoPage(\'' + type + '\',' + (current + 1) + ')">›</button>';
    h += '</div>';
    return h;
  }

  function pendingGoPage(type, page) {
    _pendingPage[type] = page || 1;
    renderAdminPending(document.getElementById('adminContent'));
  }

  function switchPendingType(type) {
    _pendingType = type;
    renderAdminPending(document.getElementById('adminContent'));
  }

  function renderAdminPending(content) {
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    // v=XXX：小版主不参与「显示下级板块/同僚已通过」开关，强制复位为默认值，
    // 避免版主勾选后登出、小版主登入仍残留 hide_peer_approved=1 且无控件取消。
    if (!(currentUser && (currentUser.role === 'moderator' || currentUser.role === 'super_admin'))) {
      _pendingIncludeSub = false;
      _pendingHidePeerApproved = true;
    }
    var url = '/api/moderation/pending/';
    var params = [];
    if (_pendingIncludeSub) params.push('include_subordinate=1');
    if (_pendingHidePeerApproved) params.push('hide_peer_approved=1');
    if (params.length) url += '?' + params.join('&');
    // v=153：课程创建申请同样受「显示下级板块」开关控制（下级版主区域默认隐藏）
    var reqUrl = '/api/moderation/course-requests/';
    if (_pendingIncludeSub) reqUrl += '?include_subordinate=1';
    // 论坛管理待审仅问答区版主/超管拉取（非问答区版主访问该端点会 403，故不加入请求）
    var canQA = currentUser && (currentUser.role === 'super_admin' || currentUser.can_moderate_qa);
    var forumIdx = -1;
    var requests = [
      api(url),
      api('/api/auth/profile/'),
      api(reqUrl),
      api('/api/moderation/reports/pending/')
    ];
    if (canQA) {
      forumIdx = requests.length;
      requests.push(api('/api/admin/qa/pending/'));
    }
    Promise.all(requests).then(function(results) {
      var list = results[0];
      var profile = results[1];
      var courseRequests = results[2] || [];
      var reportData = results[3] || {};
      var forumItems = forumIdx >= 0 ? ((results[forumIdx] || {}).items || []) : [];
      var reportGroups = (reportData.material_groups || []).concat(reportData.user_groups || []);
      _pendingItems = {};
      (list || []).forEach(function(m) { _pendingItems[m.id] = m; });

      var html = '';

      // 自动托管开关（仅版主/小版主有 can_auto_approve 时显示；举报受理/论坛管理视图不显示）
      if (profile.can_auto_approve && _pendingType !== 'report' && _pendingType !== 'forum') {
        var isOn = profile.auto_approve;
        html += '<div class="admin-auto-toggle">' +
          '<span><strong>🤖 自动托管审核</strong><br><span class="at-hint">开启后自动通过管辖板块内所有新上传的资料</span></span>' +
          '<button class="admin-btn ' + (isOn ? 'admin-btn-approve' : 'admin-btn-secondary') + '" onclick="toggleAutoApprove(this)">' + (isOn ? '✅ 已开启' : '⏸ 已关闭') + '</button>' +
        '</div>';
      }

      // 审核类型分段控制器（文件上传 / 课程创建 / 举报受理）
      var isMod = currentUser && (currentUser.role === 'moderator' || currentUser.role === 'super_admin');
      var fileCount = (list || []).length;
      html += '<div class="pc-type-bar">' +
        '<span class="pc-type-label">审核类型</span>' +
        '<div class="pc-seg" role="tablist">' +
          '<button class="pc-seg-btn' + (_pendingType === 'file' ? ' active' : '') + '" data-type="file" onclick="switchPendingType(\'file\')">📄 文件上传<span class="pc-seg-count">' + fileCount + '</span></button>' +
          '<button class="pc-seg-btn' + (_pendingType === 'course' ? ' active' : '') + '" data-type="course" onclick="switchPendingType(\'course\')">✏️ 课程创建<span class="pc-seg-count">' + courseRequests.length + '</span></button>' +
          (canQA ? '<button class="pc-seg-btn' + (_pendingType === 'forum' ? ' active' : '') + '" data-type="forum" onclick="switchPendingType(\'forum\')">💬 论坛管理<span class="pc-seg-count">' + forumItems.length + '</span></button>' : '') +
          '<button class="pc-seg-btn' + (_pendingType === 'report' ? ' active' : '') + '" data-type="report" onclick="switchPendingType(\'report\')">🚩 举报受理<span class="pc-seg-count">' + reportGroups.length + '</span></button>' +
        '</div>';
      if (isMod && _pendingType !== 'report' && _pendingType !== 'forum') {
        html += '<span class="pc-seg-right">' +
          '<label class="pc-toolbar-toggle" title="启用后显示下级版主管辖板块的待审核资料">' +
            '<input type="checkbox" ' + (_pendingIncludeSub ? 'checked' : '') + ' onchange="togglePendingIncludeSub(this.checked)"> 显示下级板块' +
          '</label>' +
          '<label class="pc-toolbar-toggle" title="默认隐藏同僚已通过的记录，勾选后显示">' +
            '<input type="checkbox" ' + (!_pendingHidePeerApproved ? 'checked' : '') + ' onchange="togglePendingHidePeerApproved(!this.checked)"> 显示同僚已通过' +
          '</label>' +
        '</span>';
      }
      html += '</div>';

      // ── 举报受理视图（v173：作为待审核第 3 个 seg，与文件上传/课程创建并列）──
      if (_pendingType === 'report') {
        if (!reportGroups.length) {
          html += '<div class="admin-empty">🎉 没有待处理的举报</div>';
        } else {
          _reportGroups = {};
          var mg = reportData.material_groups || [];
          var ug = reportData.user_groups || [];
          mg.forEach(function(g) { _reportGroups[g.group_key] = g; });
          ug.forEach(function(g) { _reportGroups[g.group_key] = g; });
          if (mg.length) {
            html += '<div class="pc-section-label">🚩 待处理资料举报</div><div class="admin-pending-list">';
            mg.forEach(function(g) { html += _reportCardHtml(g); });
            html += '</div>';
          }
          if (ug.length) {
            if (mg.length) html += '<div class="pc-section-divider"></div>';
            html += '<div class="pc-section-label">🚩 待处理连带举报</div><div class="admin-pending-list">';
            ug.forEach(function(g) { html += _reportCardHtml(g); });
            html += '</div>';
          }
        }
        content.innerHTML = html;
        return;
      }

      // ── 课程创建审核视图 ──
      if (_pendingType === 'course') {
        if (courseRequests.length) {
          html += _courseRequestsSectionHtml(courseRequests);
        } else {
          html += '<div class="admin-empty">🎉 没有待审核的课程创建申请</div>';
        }
        content.innerHTML = html;
        return;
      }

      // ── 论坛管理视图（问答区文字内容审核，仅问答区版主可见；Phase 1 管理员直发 → 恒空）──
      if (_pendingType === 'forum') {
        if (forumItems.length) {
          html += '<div class="pc-section-label">💬 待审核的问答区内容</div><div class="admin-pending-list">';
          forumItems.forEach(function(item) { html += _qaForumPendingCardHtml(item); });
          html += '</div>';
        } else {
          html += '<div class="admin-empty">🎉 没有待审核的问答区内容</div>';
        }
        content.innerHTML = html;
        return;
      }

      // ── 文件上传审核视图 ──
      // 一键过审（仅当有待审核且非自己的上传时显示）
      var hasApprovable = list && list.some(function(m) { return !m.is_peer_approved && !m.is_own; });
      if (hasApprovable) {
        html += '<div class="pc-toolbar"><button class="admin-btn admin-btn-approve" onclick="batchApprovePending(this)">⚡ 一键通过全部</button></div>';
      }

      if (!list || list.length === 0) {
        html += '<div class="admin-empty">🎉 没有待审核的资料</div>';
        content.innerHTML = html;
        return;
      }

      // 客户端分页
      var _PER_PAGE = 10;
      var _fileTotalPages = Math.max(1, Math.ceil((list || []).length / _PER_PAGE));
      _pendingPage.file = Math.max(1, Math.min(_pendingPage.file, _fileTotalPages));
      var pageList = (list || []).slice((_pendingPage.file - 1) * _PER_PAGE, _pendingPage.file * _PER_PAGE);

      html += '<div class="admin-pending-list">';

      var hasPeerApproved = pageList.some(function(m) { return m.is_peer_approved; });
      var hasMyPending = pageList.some(function(m) { return !m.is_peer_approved; });

      // ─── 所有待审核（含下级版主分流内容，上级可越级操作） ───
      if (hasMyPending) {
        if (hasPeerApproved) html += '<div class="pc-section-label">⏳ 待审核</div>';
        pageList.forEach(function(m) {
          if (m.is_peer_approved) return;
          var isSuperAdmin = currentUser && currentUser.role === 'super_admin';
          // v=153：去掉「下级版主」标签（无实际用途，且下级版主可能不止一个）
          html += '<div class="admin-pending-card' + (m.is_subordinate_handled ? ' pc-sub-handled' : '') + '" id="pc-' + m.id + '">' +
            '<div class="pc-title">' + escapeHtml(m.title) + '</div>' +
            '<div class="pc-meta">' +
              _userPill(m.uploader_name, m.uploader_avatar, m.uploader_id) +
              '<span>📚 ' + escapeHtml(m.course_name) + ' (' + escapeHtml(m.course_code) + ')</span>' +
              '<span>📅 ' + m.created_at + '</span>' +
              '<span>📄 ' + formatFileSize(m.file_size) + '</span>' +
            '</div>';
          if (m.is_own) {
            html += '<div class="pc-own">你的上传，等待其他审核员处理</div>';
          } else {
            html += '<div class="pc-actions">' +
              '<button class="admin-btn admin-btn-secondary pc-btn-detail" onclick="showPendingFileDetail(' + m.id + ')" title="查看文件详情">' + (window.ICONS ? ICONS.file : '') + '<span>详情</span></button>' +
              '<button class="admin-btn admin-btn-secondary" onclick="doDirectDownload(' + m.id + ')" title="下载文件进行审核">⬇ 下载</button>' +
              '<button class="admin-btn admin-btn-approve" onclick="quickApprove(' + m.id + ')">✓ 通过</button>' +
              '<button class="admin-btn admin-btn-reject" onclick="showRejectDialog(' + m.id + ')">✗ 驳回</button>' +
              (isMod ? '<button class="admin-btn admin-btn-secondary" onclick="showReassignDialog(' + m.id + ')" title="手动指派审核人">↗ 指派</button>' : '') +
            '</div>';
          }
          html += '</div>';
        });
      }

      // ─── 同僚已通过（24h 内可提出异议） ───
      if (hasPeerApproved && !_pendingHidePeerApproved) {
        if (hasMyPending) html += '<div class="pc-section-divider"></div>';
        html += '<div class="pc-section-label">✅ 同僚已通过（24h 内可提出异议）</div>';
        pageList.forEach(function(m) {
          if (!m.is_peer_approved) return;
          html += '<div class="admin-pending-card pc-peer-approved" id="pc-' + m.id + '">' +
            '<div class="pc-title">' + escapeHtml(m.title) + '</div>' +
            '<div class="pc-meta">' +
              _userPill(m.uploader_name, m.uploader_avatar, m.uploader_id) +
              '<span>📚 ' + escapeHtml(m.course_name) + ' (' + escapeHtml(m.course_code) + ')</span>' +
              '<span>📅 ' + m.created_at + '</span>' +
              '<span>📄 ' + formatFileSize(m.file_size) + '</span>' +
            '</div>' +
            '<div class="pc-peer-approved-badge">✅ 已被 ' + escapeHtml(m.approved_by_name) + ' 于 ' + m.approved_at + ' 审核通过</div>' +
            '<div class="pc-actions pc-actions--spaced">' +
              '<button class="admin-btn admin-btn-secondary" onclick="showPendingFileDetail(' + m.id + ')" title="查看文件详情">' + (window.ICONS ? ICONS.file : '') + '<span>详情</span></button>' +
              '<button class="admin-btn admin-btn-secondary" onclick="doDirectDownload(' + m.id + ')" title="下载文件查看">⬇ 下载查看</button>' +
              '<button class="admin-btn admin-btn-sm" onclick="showObjectionDialog(' + m.id + ', \'' + escJs(m.title) + '\')">💬 提出异议</button>' +
            '</div>' +
          '</div>';
        });
      }

      html += '</div>';
      html += _pendingPagination(_fileTotalPages, _pendingPage.file, 'file');
      content.innerHTML = html;
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">加载失败：' + esc(err.message) + '</div>';
    });
  }

  // ── 新建课程申请（v=142，v=145 改版：分段控制器「课程创建」分类下展示）──
  // 卡片随后端「卡片消失规则」：pending 一直显示；approved 且随附文件仍在待审 → 等待态
  function _courseRequestsSectionHtml(requests) {
    var approvable = requests.filter(function(r) { return r.status === 'pending' && !r.is_own; });
    var html = '';
    if (approvable.length) {
      html += '<div class="cr-batch-bar"><button class="admin-btn admin-btn-approve" onclick="batchApproveCourseRequests(this)">⚡ 一键通过全部申请</button></div>';
    }
    // 课程创建卡片较大，每页 8 条客户端分页
    var _courseTotal = Math.max(1, Math.ceil((requests || []).length / 8));
    _pendingPage.course = Math.max(1, Math.min(_pendingPage.course, _courseTotal));
    var _pageReqs = (requests || []).slice((_pendingPage.course - 1) * 8, _pendingPage.course * 8);
    html += '<div class="admin-pending-list">';
    _pageReqs.forEach(function(r) { html += _courseRequestCardHtml(r); });
    html += '</div>';
    html += _pendingPagination(_courseTotal, _pendingPage.course, 'course');
    return html;
  }

  function _courseRequestCardHtml(req) {
    var isGeneral = req.course_type === 'general';
    var mats = req.materials || [];
    var files = mats.map(function(m) {
      var stCls = m.review_status === 'approved' ? 'cr-st-approved'
        : m.review_status === 'rejected' ? 'cr-st-rejected' : 'cr-st-pending';
      var stLabel = m.review_status === 'approved' ? '已通过'
        : m.review_status === 'rejected' ? '已驳回' : '待审';
      var size = m.file_size ? formatFileSize(m.file_size) : '';
      // 每行固定：状态 + 详情 + 下载；申请已批准（等待随附文件）且该文件待审时，
      // 追加 通过/驳回（随附文件只在卡片上下文审核，不单独出现在文件上传列表）。
      var rowBtns = '<button class="cr-file-btn cr-file-btn-detail" onclick="event.stopPropagation();showPendingFileDetail(' + m.id + ')" title="查看文件详情">详情</button>' +
        '<button class="cr-file-btn cr-file-btn-dl" onclick="event.stopPropagation();doDirectDownload(' + m.id + ')" title="下载文件">下载</button>';
      if (req.is_waiting_files && m.review_status === 'pending') {
        rowBtns += '<button class="cr-file-btn cr-file-btn-approve" onclick="quickApprove(' + m.id + ')">✓ 通过</button>' +
          '<button class="cr-file-btn cr-file-btn-reject" onclick="showRejectDialog(' + m.id + ')">✗ 驳回</button>';
      }
      return '<div class="cr-file">' +
        '<span class="cr-file-icon">' + (typeof _fileGlyph === 'function' ? _fileGlyph(m.file_name) : '<span class="pc-glyph pc-glyph-other">FILE</span>') + '</span>' +
        '<span class="cr-file-name">' + esc(m.title) + (size ? ' <span class="cr-file-size">' + size + '</span>' : '') + '</span>' +
        '<span class="cr-file-actions">' +
          '<span class="cr-file-status ' + stCls + '">' + stLabel + '</span>' +
          rowBtns +
        '</span>' +
      '</div>';
    }).join('');

    var meta = _userPill(req.uploader_name, req.uploader_avatar, req.uploader_id) +
      '<span>📅 ' + esc(req.created_at) + '</span>';
    if (req.college_name) meta += '<span>🏫 ' + esc(req.college_name) + '</span>';
    if (req.assigned_moderator_name) meta += '<span>↗ ' + esc(req.assigned_moderator_name) + '</span>';

    var body = '<div class="cr-path">📂 <span>' + esc(req.target_path || '（目标位置缺失）') + '</span></div>';
    if (files) {
      body += '<div class="cr-files">' +
        '<div class="cr-files-label">随附文件（' + mats.length + '）</div>' +
        '<div class="cr-files-list">' + files + '</div>' +
      '</div>';
    }

    var actions = '';
    if (req.is_own) {
      actions = '<div class="pc-own">你的申请，等待其他审核员处理</div>';
    } else if (req.status === 'pending') {
      // v=165：will_link → 批准后为壳节点（链接到既有课程），按钮文案同步
      actions = '<div class="pc-actions">' +
        '<button class="admin-btn admin-btn-approve" onclick="approveCourseRequest(' + req.id + ', this)">' + (req.will_link ? '✓ 批准（链接到既有课程）' : '✓ 批准并创建文件夹') + '</button>' +
        '<button class="admin-btn admin-btn-reject" onclick="showCourseRequestReject(' + req.id + ')">✗ 驳回</button>' +
      '</div>';
    } else if (req.is_waiting_files) {
      actions = '<div class="cr-waiting">⏳ 申请已批准，课程文件夹已创建；待随附文件全部审核通过后本申请自动消失</div>';
    }

    var waitingTag = req.is_waiting_files ? '<span class="cr-waiting-tag">⏳ 等待随附文件</span>' : '';
    var linkTag = req.will_link
      ? '<span class="cr-link-tag" title="批准后不会新建独立文件夹，树节点将指向既有课程目录">🔗 将链接到既有课程「' + esc(req.existing_course_name || '') + '」</span>'
      : '';

    return '<div class="admin-pending-card cr-card' + (req.is_waiting_files ? ' cr-waiting-card' : '') + '">' +
      '<div class="cr-head">' +
        '<span class="cr-tag ' + (isGeneral ? 'cr-tag-general' : 'cr-tag-major') + '">' + (isGeneral ? '通识课' : '专业课') + '</span>' +
        '<span class="cr-title">' + esc(req.course_name) + '</span>' +
        '<span class="cr-code">' + esc(req.course_code) + '</span>' +
        waitingTag +
        linkTag +
      '</div>' +
      '<div class="cr-meta">' + meta + '</div>' +
      body +
      actions +
    '</div>';
  }

  function approveCourseRequest(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
    api('/api/moderation/course-requests/' + id + '/approve/', { method: 'POST' }).then(function() {
      if (typeof refreshCourseTree === 'function') refreshCourseTree();
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('操作失败：' + (err && err.message));
      renderAdminPending(document.getElementById('adminContent'));
    });
  }

  function showCourseRequestReject(id) {
    var old = document.querySelector('.admin-reject-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay';
    overlay.innerHTML =
      '<div class="admin-reject-dialog">' +
        '<h3>驳回新建课程申请</h3>' +
        '<textarea id="rejectNotes" placeholder="请填写驳回理由（必填）"></textarea>' +
        '<div class="ar-error" id="rejectError">驳回理由不能为空</div>' +
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-reject" onclick="confirmCourseRequestReject(' + id + ')">确认驳回</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
    setTimeout(function() { document.getElementById('rejectNotes').focus(); }, 100);
  }

  function confirmCourseRequestReject(id) {
    var notes = document.getElementById('rejectNotes').value.trim();
    var errEl = document.getElementById('rejectError');
    if (!notes) { if (errEl) errEl.style.display = 'block'; return; }
    if (errEl) errEl.style.display = 'none';
    api('/api/moderation/course-requests/' + id + '/reject/', { method: 'POST', body: { notes: notes } }).then(function() {
      var overlay = document.querySelector('.admin-reject-overlay');
      _removeOverlay(overlay);
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('操作失败：' + err.message);
    });
  }

  function batchApproveCourseRequests(btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 处理中…'; }
    api('/api/moderation/course-requests/batch-approve/', { method: 'POST' }).then(function() {
      if (typeof refreshCourseTree === 'function') refreshCourseTree();
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('批量过审失败：' + err.message);
      renderAdminPending(document.getElementById('adminContent'));
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
      if (typeof refreshCourseTree === 'function') refreshCourseTree();
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
      if (typeof refreshCourseTree === 'function') refreshCourseTree();
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('操作失败：' + err.message);
    });
  }

  function toggleAutoApprove(btn) {
    // v=XXX：版主/小版主自服务开关（需超管先授权 can_auto_approve），
    // 不再调用 super_admin 专属的 admin/users 接口。
    api('/api/moderation/auto-approve/', {
      method: 'POST'
    }).then(function() {
      // 重渲染当前 tab（概览/待审页均有此开关）
      var content = document.getElementById('adminContent');
      var active = document.querySelector('.admin-tab.active');
      var tab = active ? active.getAttribute('data-tab') : 'pending';
      switchAdminTab(tab);
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
      if (typeof refreshCourseTree === 'function') refreshCourseTree();
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
      // 删除成功后：清公开页前端缓存 + 刷新课程树（fileCount 即时更新）
      if (typeof clearUserPublicCache === 'function') clearUserPublicCache();
      if (typeof refreshCourseTree === 'function') refreshCourseTree();
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
          tbody.innerHTML = '<tr><td colspan="7" class="admin-empty admin-empty--sm">暂无资料</td></tr>';
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
    // 从 /api/files/<id>/ 拉取完整数据：file_size 为原始字节、file_name 为真实文件名，
    // 修复此前 DOM 抓取 + parseInt("3.5 MB") 导致的错误大小与无法预览
    api('/api/files/' + materialId + '/').then(function(full) {
      if (window._fileLookup) window._fileLookup[full.id] = full; // 供 showPreview 识别真实扩展名
      if (typeof full.can_delete !== 'boolean') full.can_delete = true; // 审核员可删
      showFileInfoModal(full);
    }).catch(function() {
      // 降级：用待审核列表原始项（file_size 为字节，非格式化文本）
      var item = _pendingItems[materialId];
      if (!item) { alert('无法加载文件详情'); return; }
      var fileObj = {
        id: item.id,
        title: item.title,
        course_name: item.course_name,
        course_code: item.course_code,
        file_name: item.file_name || item.title,
        file_size: item.file_size,
        file_type: item.file_type || '未知',
        uploader: item.uploader_name || '匿名',
        teacher: '',
        description: '',
        download_count: 0,
        created_at: item.created_at || '',
        is_uploader: false,
        can_delete: currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'moderator' || currentUser.role === 'sub_moderator'),
        is_admin_uploaded: false,
      };
      showFileInfoModal(fileObj);
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
      var html = '<div class="admin-section-label">📋 审核历史</div>' +
        '<div class="admin-pending-list">';
      data.items.forEach(function(m) {
        var statusClass = m.review_status === 'approved' ? 'review-badge-approved' : 'review-badge-rejected';
        var statusText = m.review_status === 'approved' ? '✓ 通过' : '✗ 驳回';
        var adminBadge = m.is_admin_uploaded ? '<span class="admin-uploaded-badge">🛡️ 管理员自传</span>' : '';
        var reviewerName = m.is_admin_uploaded ? escapeHtml(m.uploader_name) + ' (自传)' : escapeHtml(m.reviewed_by_name);
        var objHtml = '';
        if (m.can_object && m.review_status === 'approved') {
          objHtml = '<button class="admin-btn admin-btn-sm" onclick="showObjectionDialog(' + m.id + ', \'' + escJs(m.title) + '\')">💬 异议</button>';
        } else {
          objHtml = '<button class="admin-btn admin-btn-sm admin-btn-secondary" onclick="toggleComments(' + m.id + ', this, true)" title="查看异议记录">💬 查看异议</button>';
        }
        html += '<div class="admin-pending-card hist-card ' + (m.review_status === 'approved' ? 'hc-approved' : 'hc-rejected') + '">' +
          '<div class="pc-title">' + escapeHtml(m.title) + adminBadge +
            '<span class="review-badge ' + statusClass + '" style="margin-left:6px">' + statusText + '</span></div>' +
          '<div class="pc-meta">' +
            '<span>📚 ' + escapeHtml(m.course_name) + '</span>' +
            '<span>👤 ' + escapeHtml(m.uploader_name) + '</span>' +
            '<span>🔍 ' + reviewerName + '</span>' +
            '<span>📝 ' + escapeHtml(m.review_notes || '') + '</span>' +
            '<span>🕐 ' + (m.is_admin_uploaded ? m.created_at : m.reviewed_at) + '</span>' +
          '</div>' +
          '<div class="pc-actions">' + objHtml + '</div>' +
          '<div class="hc-comments-row hc-comments-card" id="hc-comments-row-' + m.id + '" style="display:none"><div class="pc-comments" id="hc-comments-' + m.id + '"></div></div>' +
        '</div>';
      });
      html += '</div>';
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
          targetRow.style.display = 'block';
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

