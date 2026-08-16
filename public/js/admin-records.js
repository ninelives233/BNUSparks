/* BNU Sparks · admin-records.js —— 删除记录+操作记录+举报处理：renderAdminDeletions/renderAdminOperations/renderAdminReportHistory/restoreDeletion 等。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
  // ── 文件删除记录 ──
  var _delPage = 1, _delPerPage = 20;

  async function renderAdminDeletions(content, page) {
    _delPage = page;
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    try {
      var data = await api('/api/moderation/deletions/?page=' + page + '&per_page=' + _delPerPage);
      if (!data.items || !data.items.length) {
        content.innerHTML = '<div class="admin-empty">🗑️ 暂无文件删除记录</div>';
        return;
      }
      var _esc = escapeHtml || function(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      };
      var html = '<div class="admin-section-label">🗑️ 删除记录</div>' +
        '<div class="admin-table-card"><div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr><th>资料标题</th><th>课程</th><th>大小</th><th>上传者</th><th>删除人</th><th>删除时间</th><th>操作</th></tr></thead><tbody>';
      data.items.forEach(function(r) {
        var restoreBtn = '';
        if (r.can_restore && !r.is_restored) {
          restoreBtn = '<button class="admin-btn admin-btn-sm admin-btn-approve" data-deleter="' + _esc(r.deleted_by_name) + '" onclick="restoreDeletion(' + r.id + ', this)">↩ 撤销</button>';
        } else if (r.is_restored) {
          restoreBtn = '<span class="status-restored">✅ 已恢复</span>';
        } else {
          restoreBtn = '<span class="status-expired">⏰ 已过期</span>';
        }
        html += '<tr>' +
          '<td>' + _esc(r.title) + '<br><span class="ft-meta">' + _esc(r.file_name) + '</span></td>' +
          '<td>' + _esc(r.course_name) + '<br><span class="ft-meta">' + _esc(r.course_code) + '</span></td>' +
          '<td>' + formatSize(r.file_size) + '</td>' +
          '<td>' + _esc(r.uploader_name) + '</td>' +
          '<td>' + _esc(r.deleted_by_name) + '</td>' +
          '<td>' + _esc(r.deleted_at) + '</td>' +
          '<td>' + restoreBtn + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div></div>';
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
      content.innerHTML = '<div class="admin-empty admin-empty--sm">加载失败：' + esc(err.message || '未知错误') + '</div>';
    }
  }

  // ── 撤销删除（管理后台删除记录） ──
  function restoreDeletion(delId, btn) {
    // v=180 卡片化：从按钮 data-deleter 读删除人名（原表格读 td:nth-child(5)，行为一致）
    var isOwn = true;
    if (btn) {
      var deletedByName = (btn.getAttribute('data-deleter') || '').trim();
      isOwn = deletedByName === (currentUser ? currentUser.nickname || currentUser.username : '');
    }
    if (isOwn) {
      if (!confirm('确定撤销此删除操作？文件将被恢复。')) return;
      if (btn) btn.disabled = true;
      api('/api/moderation/deletions/' + delId + '/restore/', { method: 'POST', body: {} }).then(function() {
        alert('✅ 文件已恢复');
        if (typeof refreshCourseTree === 'function') refreshCourseTree();
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
      '<div class="admin-reject-dialog">' +
        '<h3>↩ 撤销删除</h3>' +
        '<p class="dlg-hint">你正在撤销他人的删除操作，请填写撤销理由。</p>' +
        '<textarea id="restoreReason" rows="3" placeholder="请填写撤销理由"></textarea>' +
        '<div class="ar-actions">' +
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
      if (typeof refreshCourseTree === 'function') refreshCourseTree();
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
        content.innerHTML = '<div class="admin-empty">📋 暂无操作记录</div>';
        return;
      }
      var html = '<div class="admin-section-label">📋 操作记录</div>' +
        '<div class="admin-table-card"><div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr><th>操作人</th><th>操作</th><th>文件夹</th><th>路径</th><th>类型</th><th>时间</th><th>操作</th></tr></thead><tbody>';
      data.items.forEach(function(op) {
        var restoreBtn = '';
        if (op.can_restore && !op.is_restored) {
          restoreBtn = '<button class="admin-btn admin-btn-sm admin-btn-approve" onclick="restoreFolderOp(' + op.id + ', this)">↩ 撤销</button>';
        } else if (op.is_restored) {
          restoreBtn = '<span class="status-restored">✅ 已撤销</span>';
        } else {
          restoreBtn = '<span class="status-expired">⏰ 已过期</span>';
        }
        var isCreate = op.action === 'create';
        html += '<tr>' +
          '<td>' + esc(op.user_name) + '</td>' +
          '<td><span class="status-tag ' + (isCreate ? 'status-approved' : 'status-rejected') + '">' + esc(op.action_label) + '</span></td>' +
          '<td>' + esc(op.category_name) + '</td>' +
          '<td class="td-muted">' + esc(op.parent_path) + '</td>' +
          '<td>' + (op.folder_type === 'leaf' ? '底层' : '普通') + '</td>' +
          '<td>' + esc(op.created_at) + '</td>' +
          '<td>' + restoreBtn + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div></div>';
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
      content.innerHTML = '<div class="admin-empty admin-empty--sm">加载失败：' + esc(err.message || '未知错误') + '</div>';
    }
  }

  // ═══════════════════ 举报受理 / 举报记录（v172） ═══════════════════
  var _reportGroups = {};  // group_key → group（供处理浮窗取用）

  function _reportReasonTags(labels) {
    if (!labels || !labels.length) return '';
    return '<div class="report-reason-tags">' + labels.map(function(r) {
      return '<span class="report-reason-tag">' + esc(r) + '</span>';
    }).join('') + '</div>';
  }

  // v173：材料举报详情 → 跳转到文件在探索器列表中的位置（滚动高亮，不弹窗）
  function jumpToFileLocation(courseCode, fileId) {
    highlightFileId = fileId;                  // explorer.js:397，渲染时自动翻页 + scrollIntoView + 高亮
    var type = (courseCode || '').indexOf('GEN') === 0 ? '通识课' : '专业课';
    showExplorer(type);                        // views.js:731，切到探索器
    if (courseCode) navToLast(courseCode);     // explorer.js:21，定位课程目录
  }

  function _reportCardHtml(g) {
    // v183 问答区举报（问题/回答）
    if (g.kind === 'question' || g.kind === 'answer') {
      var qaKindIcon = g.kind === 'answer' ? '💬' : '❓';
      var qaKindLabel = g.kind === 'answer' ? '回答举报' : '问题举报';
      var viewBtn = g.kind === 'question'
        ? '<button class="admin-btn admin-btn-secondary pc-btn-detail" onclick="qaOpenDetail(' + g.target_id + ')" title="跳转到该问题核实"><span>详情</span></button>'
        : '';
      return '<div class="admin-pending-card report-card">' +
        '<div class="pc-title">' + qaKindIcon + ' ' + esc(g.target_title) + ' <span class="report-count-pill">' + g.reporter_count + ' 人举报</span></div>' +
        '<div class="pc-meta">' +
          '<span>💬 ' + qaKindLabel + '</span>' +
          '<span>👤 ' + esc(g.author_name) + '</span>' +
          '<span>📅 ' + esc(g.latest_reported_at) + '</span>' +
        '</div>' +
        _reportReasonTags(g.reason_labels) +
        '<div class="pc-meta report-reporters">举报人：' + g.reporter_names.map(esc).join('、') + '</div>' +
        (g.latest_detail ? '<div class="report-detail">' + esc(g.latest_detail) + '</div>' : '') +
        '<div class="pc-actions">' + viewBtn +
          '<button class="admin-btn admin-btn-primary" onclick="openReportHandleDialog(\'' + g.group_key + '\')">处理</button></div>' +
      '</div>';
    }
    if (g.kind === 'material') {
      var directTag = g.is_direct_super ? '<span class="report-status-tag report-status-direct">已直送总管理</span>' : '';
      var detailBtn = g.material_exists
        ? '<button class="admin-btn admin-btn-secondary pc-btn-detail" onclick="jumpToFileLocation(\'' + escJs(g.course_code || '') + '\',' + g.material_id + ')" title="跳转到该文件所在位置核实"><span>详情</span></button>'
        : '<button class="admin-btn admin-btn-secondary pc-btn-detail" onclick="alert(\'该资料已被删除\')" title="该资料已被删除"><span>详情</span></button>';
      return '<div class="admin-pending-card report-card">' +
        '<div class="pc-title">' + esc(g.material_title) + ' ' + directTag + ' <span class="report-count-pill">' + g.reporter_count + ' 人举报</span></div>' +
        '<div class="pc-meta">' +
          '<span>📚 ' + esc(g.course_name) + ' (' + esc(g.course_code) + ')</span>' +
          '<span>📅 ' + g.latest_reported_at + '</span>' +
          (g.material_exists ? '' : '<span class="report-gone">⚠ 资料已删除</span>') +
        '</div>' +
        _reportReasonTags(g.reason_labels) +
        '<div class="pc-meta report-reporters">举报人：' + g.reporter_names.map(esc).join('、') + '</div>' +
        (g.latest_detail ? '<div class="report-detail">' + esc(g.latest_detail) + '</div>' : '') +
        '<div class="pc-actions">' + detailBtn +
          '<button class="admin-btn admin-btn-primary" onclick="openReportHandleDialog(\'' + g.group_key + '\')">处理</button></div>' +
      '</div>';
    }
    // user kind（连带举报）
    var stTag = g.status === 'escalated'
      ? '<span class="report-status-tag report-status-escalated">已升级</span>'
      : '<span class="report-status-tag report-status-pending">待处理</span>';
    var handleBtn = g.can_finish
      ? '<button class="admin-btn admin-btn-approve" onclick="submitReportFinish(' + g.report_id + ')">已处理</button>'
      : '<button class="admin-btn admin-btn-primary" onclick="openReportHandleDialog(\'' + g.group_key + '\')">处理</button>';
    return '<div class="admin-pending-card report-card">' +
      '<div class="pc-title">用户：' + esc(g.target_user_name) + ' <span class="report-count-pill">' + g.reporter_count + ' 人举报</span> ' + stTag + '</div>' +
      '<div class="pc-meta"><span>📅 ' + g.latest_reported_at + '</span></div>' +
      _reportReasonTags(g.reason_labels) +
      '<div class="pc-meta report-reporters">举报人：' + g.reporter_names.map(esc).join('、') + '</div>' +
      (g.latest_detail ? '<div class="report-detail">' + esc(g.latest_detail) + '</div>' : '') +
      '<div class="pc-actions">' +
        '<button class="admin-btn admin-btn-secondary pc-btn-detail" onclick="showUserPublic(' + g.target_user_id + ')" title="查看该用户主页核实"><span>详情</span></button>' +
        handleBtn +
      '</div>' +
    '</div>';
  }

  function openReportHandleDialog(groupKey) {
    var g = _reportGroups[groupKey];
    if (!g) return;
    var old = document.querySelector('.admin-reject-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay report-handle-overlay';
    var isMaterial = g.kind === 'material';
    var isQA = g.kind === 'question' || g.kind === 'answer';
    var inner = '';
    if (isQA) {
      // v183 问答区举报：属实→删除目标并通知双方；不属实→保留+反馈；恶意举报仅在保留分支判定
      var qaKindName = g.kind === 'answer' ? '回答' : '问题';
      inner =
        '<div class="rh-question"><div class="rh-q-label">1. 举报情况是否属实？</div>' +
          '<label class="rh-radio"><input type="radio" name="rhTrue" value="true" onchange="updateReportHandleState()"> <span><span class="ro-main">是</span><span class="rh-hint">确认属实后将删除该' + qaKindName + '并通知双方</span></span></label>' +
          '<label class="rh-radio"><input type="radio" name="rhTrue" value="false" onchange="updateReportHandleState()"> <span><span class="ro-main">否</span><span class="rh-hint">内容保留，反馈至举报者</span></span></label>' +
        '</div>' +
        '<div class="rh-field" id="rhActualField" style="display:none">' +
          '<textarea id="rhActual" placeholder="请填写实际情况（必填）" rows="2"></textarea>' +
        '</div>' +
        '<div class="rh-question" id="rhMalQ"><div class="rh-q-label">2. 是否为恶意举报？</div><div class="rh-hint">选择「属实」后此条不可用</div>' +
          '<label class="rh-radio"><input type="radio" name="rhMal" value="true"> <span><span class="ro-main">是</span><span class="rh-hint">此条通知转发至总管理，提醒注意</span></span></label>' +
          '<label class="rh-radio"><input type="radio" name="rhMal" value="false"> <span><span class="ro-main">否</span><span class="rh-hint">仅为误报，不需大惊小怪</span></span></label>' +
        '</div>' +
        '<div class="ar-error" id="rhError" style="display:none"></div>';
    } else if (isMaterial) {
      inner =
        '<div class="rh-question"><div class="rh-q-label">1. 举报情况是否属实？</div>' +
          '<label class="rh-radio"><input type="radio" name="rhTrue" value="true" onchange="updateReportHandleState()"> <span><span class="ro-main">是</span></span></label>' +
          '<label class="rh-radio"><input type="radio" name="rhTrue" value="false" onchange="updateReportHandleState()"> <span><span class="ro-main">否</span><span class="rh-hint">若资料确有问题但描述不准确也选否</span></span></label>' +
        '</div>' +
        '<div class="rh-field" id="rhActualField" style="display:none">' +
          '<textarea id="rhActual" placeholder="请填写实际情况（必填）" rows="2"></textarea>' +
        '</div>' +
        '<div class="rh-question"><div class="rh-q-label">2. 如何处理？</div>' +
          '<label class="rh-radio"><input type="radio" name="rhAction" value="delete" onchange="updateReportHandleState()"> <span><span class="ro-main">删除</span>' + (g.material_exists ? '' : '<span class="rh-hint">该文件已被删除，此条无实际效果</span>') + '</span></label>' +
          '<label class="rh-radio"><input type="radio" name="rhAction" value="keep" onchange="updateReportHandleState()"> <span><span class="ro-main">保留</span></span></label>' +
        '</div>' +
        '<div class="rh-question" id="rhRetryQ"><div class="rh-q-label">3. 是否允许重新上传？</div><div class="rh-hint">选择「保留」后此条不可用</div>' +
          '<label class="rh-radio"><input type="radio" name="rhRetry" value="true"> <span><span class="ro-main">是</span><span class="rh-hint">小错可原谅</span></span></label>' +
          '<label class="rh-radio"><input type="radio" name="rhRetry" value="false"> <span><span class="ro-main">否</span><span class="rh-hint">大错需谨慎</span></span></label>' +
        '</div>' +
        '<div class="rh-question" id="rhMalQ"><div class="rh-q-label">4. 是否为恶意举报？</div><div class="rh-hint">选择「删除」后此条不可用</div>' +
          '<label class="rh-radio"><input type="radio" name="rhMal" value="true"> <span><span class="ro-main">是</span><span class="rh-hint">此条通知转发至总管理，提醒注意</span></span></label>' +
          '<label class="rh-radio"><input type="radio" name="rhMal" value="false"> <span><span class="ro-main">否</span><span class="rh-hint">仅为误报，不需大惊小怪</span></span></label>' +
        '</div>' +
        '<div class="ar-error" id="rhError" style="display:none"></div>';
    } else {
      inner =
        '<div class="rh-question"><div class="rh-q-label">1. 是否属实？</div>' +
          '<label class="rh-radio"><input type="radio" name="rhTrue" value="true" onchange="updateReportHandleState()"> <span><span class="ro-main">是</span><span class="rh-hint">确认属实后将升级转发至总管理员</span></span></label>' +
          '<label class="rh-radio"><input type="radio" name="rhTrue" value="false" onchange="updateReportHandleState()"> <span><span class="ro-main">否</span><span class="rh-hint">反馈至举报者</span></span></label>' +
        '</div>' +
        '<div class="rh-question" id="rhMalQ"><div class="rh-q-label">2. 是否为恶意举报？</div><div class="rh-hint">选择「否」后此条不可用</div>' +
          '<label class="rh-radio"><input type="radio" name="rhMal" value="true"> <span><span class="ro-main">是</span><span class="rh-hint">此条通知转发至总管理，提醒注意</span></span></label>' +
          '<label class="rh-radio"><input type="radio" name="rhMal" value="false"> <span><span class="ro-main">否</span><span class="rh-hint">仅为误报，不需大惊小怪</span></span></label>' +
        '</div>' +
        '<div class="ar-error" id="rhError" style="display:none"></div>';
    }
    var dialogTitle = isMaterial ? (g.material_title || '') : (isQA ? (g.target_title || '') : (g.target_user_name || ''));
    overlay.innerHTML =
      '<div class="admin-reject-dialog report-handle-dialog">' +
        '<h3>处理举报 · ' + esc(dialogTitle) + '</h3>' +
        '<div id="rhBody">' + inner + '</div>' +
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" id="rhSubmitBtn" onclick="submitReportHandle(\'' + g.group_key + '\')">确定</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.setAttribute('data-report-kind', g.kind || '');
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
    updateReportHandleState();
  }

  function updateReportHandleState() {
    var overlay = document.querySelector('.report-handle-overlay');
    if (!overlay) return;
    var kind = overlay.getAttribute('data-report-kind') || '';
    var isQA = kind === 'question' || kind === 'answer';
    var isMaterial = !!overlay.querySelector('input[name="rhAction"]');
    var isTrue = _rhVal(overlay, 'rhTrue');
    var actualField = overlay.querySelector('#rhActualField');
    if (actualField) actualField.style.display = isTrue === 'false' ? '' : 'none';
    if (isQA) {
      // v183 问答区：属实（删除）后不再判定恶意举报（后端 is_malicious=None if is_true）
      var qaMal = overlay.querySelector('#rhMalQ');
      if (qaMal) {
        qaMal.classList.toggle('rh-disabled', isTrue === 'true');
        qaMal.querySelectorAll('input').forEach(function(i) { i.disabled = isTrue === 'true'; });
      }
      if (isTrue === 'true') _clearRadios(overlay, 'rhMal');
    } else if (isMaterial) {
      var action = _rhVal(overlay, 'rhAction');
      var retryQ = overlay.querySelector('#rhRetryQ');
      var malQ = overlay.querySelector('#rhMalQ');
      if (retryQ) {
        retryQ.classList.toggle('rh-disabled', action === 'keep');
        retryQ.querySelectorAll('input').forEach(function(i) { i.disabled = action === 'keep'; });
      }
      if (malQ) {
        malQ.classList.toggle('rh-disabled', action === 'delete');
        malQ.querySelectorAll('input').forEach(function(i) { i.disabled = action === 'delete'; });
      }
      if (action === 'keep') _clearRadios(overlay, 'rhRetry');
      if (action === 'delete') _clearRadios(overlay, 'rhMal');
    } else {
      var malQ2 = overlay.querySelector('#rhMalQ');
      if (malQ2) {
        malQ2.classList.toggle('rh-disabled', isTrue === 'false');
        malQ2.querySelectorAll('input').forEach(function(i) { i.disabled = isTrue === 'false'; });
      }
      if (isTrue === 'false') _clearRadios(overlay, 'rhMal');
    }
  }

  function _rhVal(overlay, name) {
    var el = overlay.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function _clearRadios(overlay, name) {
    overlay.querySelectorAll('input[name="' + name + '"]').forEach(function(i) { i.checked = false; });
  }

  function _showRhError(overlay, msg) {
    var e = overlay.querySelector('#rhError');
    if (e) { e.textContent = msg; e.style.display = ''; }
  }

  function submitReportHandle(groupKey) {
    var g = _reportGroups[groupKey];
    var overlay = document.querySelector('.report-handle-overlay');
    if (!g || !overlay) return;
    var isMaterial = g.kind === 'material';
    var isQA = g.kind === 'question' || g.kind === 'answer';
    var isTrue = _rhVal(overlay, 'rhTrue');
    if (!isTrue) { _showRhError(overlay, '请选择是否属实'); return; }
    var body = { is_true: isTrue === 'true' };
    if (isQA) {
      // v183 问答区：属实 → 后端按 is_true 派生 action（删除）并通知双方；
      // 不属实 → 必填实际情况 + 恶意举报判定
      if (body.is_true === false) {
        var qaActualEl = overlay.querySelector('#rhActual');
        var qaActual = qaActualEl ? qaActualEl.value.trim() : '';
        if (!qaActual) { _showRhError(overlay, '选择不属实时，必须填写实际情况'); return; }
        body.actual_situation = qaActual;
        var qaMal = _rhVal(overlay, 'rhMal');
        if (qaMal === null) { _showRhError(overlay, '请选择是否为恶意举报'); return; }
        body.is_malicious = qaMal === 'true';
      }
    } else if (isMaterial) {
      var action = _rhVal(overlay, 'rhAction');
      if (!action) { _showRhError(overlay, '请选择处理方式'); return; }
      body.action = action;
      if (body.is_true === false) {
        var actualEl = overlay.querySelector('#rhActual');
        var actual = actualEl ? actualEl.value.trim() : '';
        if (!actual) { _showRhError(overlay, '选择不属实时，必须填写实际情况'); return; }
        body.actual_situation = actual;
      }
      if (action === 'delete') {
        var retry = _rhVal(overlay, 'rhRetry');
        if (retry === null) { _showRhError(overlay, '请选择是否允许重新上传'); return; }
        body.allow_retry = retry === 'true';
      } else {
        var mal = _rhVal(overlay, 'rhMal');
        if (mal === null) { _showRhError(overlay, '请选择是否为恶意举报'); return; }
        body.is_malicious = mal === 'true';
      }
    } else {
      if (body.is_true) {
        var mal2 = _rhVal(overlay, 'rhMal');
        if (mal2 === null) { _showRhError(overlay, '请选择是否为恶意举报'); return; }
        body.is_malicious = mal2 === 'true';
      }
    }
    var btn = overlay.querySelector('#rhSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
    api('/api/moderation/reports/' + g.report_id + '/handle/', { method: 'POST', body: body })
      .then(function(data) {
        _removeOverlay(overlay);
        if (data.file_already_deleted) alert('该文件已被删除，删除操作无实际效果。');
        renderAdminPending(document.getElementById('adminContent'));
      })
      .catch(function(err) {
        _showRhError(overlay, err.message || '处理失败');
        if (btn) { btn.disabled = false; btn.textContent = '确定'; }
      });
  }

  function submitReportFinish(reportId) {
    if (!confirm('确认此连带举报已处理完毕？')) return;
    api('/api/moderation/reports/' + reportId + '/finish/', { method: 'POST', body: {} })
      .then(function() {
        renderAdminPending(document.getElementById('adminContent'));
      })
      .catch(function(err) {
        alert('操作失败：' + err.message);
      });
  }

  function renderAdminReportHistory(content, page) {
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    api('/api/moderation/reports/history/?page=' + page + '&per_page=20').then(function(data) {
      if (!data.items || !data.items.length) {
        content.innerHTML = '<div class="admin-empty">暂无举报记录</div>';
        return;
      }
      var html = '<div class="admin-section-label">📄 举报记录</div>' +
        '<div class="admin-table-card"><div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr><th>类型</th><th>被举报</th><th>课程</th><th>举报人</th><th>原因</th><th>状态</th><th>处理人</th><th>举报时间</th><th>处理时间</th></tr></thead><tbody>';
      data.items.forEach(function(r) {
        // v183：问答区举报（问题/回答）在记录中显示问题标题
        var target;
        if (r.kind === 'material') target = r.material_title || '资料已删除';
        else if (r.kind === 'question') target = r.qa_question_title || '问题已删除';
        else if (r.kind === 'answer') target = (r.qa_question_title ? '回答 · ' + r.qa_question_title : '回答已删除');
        else target = '用户：' + (r.target_user_name || '匿名');
        var stCls = r.status === 'handled' ? 'report-status-handled'
          : r.status === 'escalated' ? 'report-status-escalated' : 'report-status-pending';
        html += '<tr>' +
          '<td>' + esc(r.kind_label) + '</td>' +
          '<td>' + esc(target) + '</td>' +
          '<td class="td-muted">' + esc(r.course_name) + '</td>' +
          '<td>' + esc(r.reporter_name) + '</td>' +
          '<td>' + (r.reason_labels || []).map(function(x) { return '<span class="report-reason-tag report-reason-tag-sm">' + esc(x) + '</span>'; }).join('') + '</td>' +
          '<td><span class="report-status-tag ' + stCls + '">' + esc(r.status_label) + '</span></td>' +
          '<td>' + esc(r.handled_by_name || '—') + '</td>' +
          '<td>' + esc(r.created_at) + '</td>' +
          '<td>' + esc(r.handled_at || '—') + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div></div>';
      if (data.total_pages > 1) {
        html += '<div class="admin-pagination">';
        if (page > 1) html += '<button onclick="renderAdminReportHistory(document.getElementById(\'adminContent\'), ' + (page - 1) + ')">← 上一页</button>';
        else html += '<button disabled>← 上一页</button>';
        html += '<span class="page-info">第 ' + page + ' / ' + data.total_pages + ' 页（共 ' + data.total + ' 条）</span>';
        if (page < data.total_pages) html += '<button onclick="renderAdminReportHistory(document.getElementById(\'adminContent\'), ' + (page + 1) + ')">下一页 →</button>';
        else html += '<button disabled>下一页 →</button>';
        html += '</div>';
      }
      content.innerHTML = html;
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">加载失败：' + esc(err.message) + '</div>';
    });
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

