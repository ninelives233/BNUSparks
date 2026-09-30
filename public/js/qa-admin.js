// ═══════════════════════════════════════════════════════════════
// 问答区管理端（问答区版主 / 超管）
// 论坛记录 tab（状态筛选）、论坛管理 pending（通过/驳回）、发布/编辑入口、
// 历史回滚、删除/恢复
// 依赖：utils.js、admin.js 的 overlay 模式；
// v175：发布/编辑统一改走独立 qaCompose 视图（qa-compose.js），
//       此处 openQa* 仅作薄包装保留调用点兼容
// ═══════════════════════════════════════════════════════════════

// ── 论坛记录（管理后台 tab，v175 加状态筛选）──
var _qaRecordsStatus = '';

function qaRecordsFilter(status) {
  _qaRecordsStatus = status;
  renderAdminQaRecords(document.getElementById('adminContent'), 1);
}

function renderAdminQaRecords(content, page) {
  content.innerHTML = '<div class="admin-loading">加载中…</div>';
  var segs = [
    { v: '', label: '全部' },
    { v: 'published', label: '已发布' },
    { v: 'pending', label: '待审核' },
    { v: 'rejected', label: '已驳回' },
    { v: 'deleted', label: '已删除' }
  ];
  var segHtml = '<div class="pc-type-bar"><span class="pc-type-label">' + iconSvg('comment') + ' 论坛记录</span>' +
    '<div class="pc-seg" role="tablist">';
  segs.forEach(function(s) {
    segHtml += '<button class="pc-seg-btn' + (_qaRecordsStatus === s.v ? ' active' : '') + '" data-status="' + s.v +
      '" onclick="qaRecordsFilter(\'' + s.v + '\')">' + s.label + '</button>';
  });
  segHtml += '</div></div>';

  var qs = [];
  if (_qaRecordsStatus) qs.push('status=' + encodeURIComponent(_qaRecordsStatus));
  var url = '/api/admin/qa/records/?page=' + page + '&pageSize=10' + (qs.length ? '&' + qs.join('&') : '');
  api(url).then(function(data) {
    var items = data.items || [];
    var html = segHtml;
    if (!items.length) {
      html += '<div class="admin-empty">暂无问答区内容，去发布第一篇吧。</div>';
    } else {
      html += '<div class="admin-table-card"><div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr><th>内容</th><th>作者</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>';
      items.forEach(function(it) { html += _qaRecordRowHtml(it); });
      html += '</tbody></table></div></div>';
      if (data.total_pages > 1) {
        html += '<div class="file-pagination" style="justify-content:center;margin-top:14px">' +
          '<button class="fp-btn fp-prev' + (page <= 1 ? ' fp-disabled' : '') + '" aria-label="上一页" onclick="qaRecordsGoPage(' + (page - 1) + ')">' + iconSvg('chevron-left') + '</button>' +
          '<span class="fp-btn fp-num fp-active">' + page + ' / ' + data.total_pages + '</span>' +
          '<button class="fp-btn fp-next' + (page >= data.total_pages ? ' fp-disabled' : '') + '" aria-label="下一页" onclick="qaRecordsGoPage(' + (page + 1) + ')">' + iconSvg('chevron-right') + '</button>' +
        '</div>';
      }
    }
    content.innerHTML = html;
  }).catch(function() {
    content.innerHTML = '<div class="admin-empty">加载失败</div>';
  });
}

function qaRecordsGoPage(page) {
  renderAdminQaRecords(document.getElementById('adminContent'), page);
}

var _QA_STATUS_LABEL = { published: '已发布', deleted: '已删除', pending: '待审核', rejected: '已驳回' };
var _QA_STATUS_CLS = { published: 'status-approved', deleted: 'status-deleted', pending: 'status-pending', rejected: 'status-rejected' };

function _qaRecordRowHtml(it) {
  var statusLabel = _QA_STATUS_LABEL[it.status] || it.status;
  var statusCls = _QA_STATUS_CLS[it.status] || '';
  var pinHtml = it.is_pinned ? '<span class="qa-pin-badge qa-pin-badge-sm" style="margin-left:6px">置顶</span>' : '';
  var actions = '';
  actions += '<button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="qaAdminView(' + (it.kind === 'question' ? it.id : it.question_id) + ')">查看</button>';
  if (it.kind === 'question') {
    actions += '<button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="openQaQuestionEditor(' + it.id + ')">编辑</button>';
  } else {
    actions += '<button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="openQaAnswerEditor(' + it.question_id + ',' + it.id + ')">编辑</button>';
  }
  actions += '<button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="showQaHistory(\'' + it.kind + '\',' + it.id + ')">历史</button>';
  if (it.status === 'deleted') {
    actions += '<button class="admin-btn admin-btn-approve admin-btn-sm" onclick="qaAdminRestore(\'' + it.kind + '\',' + it.id + ')">恢复</button>';
  } else {
    actions += '<button class="admin-btn admin-btn-reject admin-btn-sm" onclick="qaAdminDelete(\'' + it.kind + '\',' + it.id + ')">删除</button>';
  }
  return '<tr>' +
    '<td>' + iconSvg(it.kind === 'question' ? 'question' : 'comment') + ' ' + esc(it.title) + pinHtml + '</td>' +
    '<td>' + esc(it.author) + '</td>' +
    '<td><span class="status-tag ' + statusCls + '">' + statusLabel + '</span></td>' +
    '<td>' + esc(it.created_at) + '</td>' +
    '<td>' + actions + '</td>' +
  '</tr>';
}

// ── 论坛管理待审（v175：真实 pending 列表 + 通过/驳回）──
function _qaForumPendingCardHtml(item) {
  var statusLabel = _QA_STATUS_LABEL[item.status] || item.status;
  var kindIcon = iconSvg(item.kind === 'answer' ? 'comment' : 'question');
  return '<div class="qa-record-card qa-status-' + (item.status || '') + '">' +
    '<div class="qa-record-main">' +
      '<div class="qa-record-title">' + kindIcon + ' ' + esc(item.title || '') +
        '<span class="review-badge review-badge-pending" style="margin-left:6px">' + statusLabel + '</span></div>' +
      '<div class="qa-record-meta">' + (item.kind === 'answer' ? '回答' : '问题') + ' · ' + esc(item.author || '') + ' · ' + esc(item.created_at || '') + '</div>' +
      (item.content_preview ? '<div class="qa-record-meta">' + esc(item.content_preview) + '</div>' : '') +
    '</div>' +
    '<div class="qa-record-actions">' +
      '<button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="qaAdminReview(\'' + item.kind + '\',' + item.id + ',\'' + escJs(item.title || '') + '\',\'' + escJs(item.author || '') + '\',\'' + escJs(item.created_at || '') + '\')">全文审阅</button>' +
      '<button class="admin-btn admin-btn-approve admin-btn-sm" onclick="qaAdminApprove(\'' + item.kind + '\',' + item.id + ')">通过</button>' +
      '<button class="admin-btn admin-btn-reject admin-btn-sm" onclick="qaAdminReject(\'' + item.kind + '\',' + item.id + ')">驳回</button>' +
    '</div>' +
  '</div>';
}

// S07：审核队列全文审阅——读取完整内容（含图片、所属问题上下文）后决策。
// 列表侧传入标题/作者/时间（admin 详情端点对回答不返回这些元信息）。
function qaAdminReview(kind, id, title, author, createdAt) {
  var seg = kind === 'answer' ? 'answers' : 'questions';
  var meta = { title: title || '', author: author || '', createdAt: createdAt || '' };
  api('/api/admin/qa/' + seg + '/' + id + '/').then(function(data) {
    // 回答：附所属问题全文作为审阅上下文
    var qPromise = (kind === 'answer' && data.question_id)
      ? api('/api/admin/qa/questions/' + data.question_id + '/').catch(function() { return null; })
      : Promise.resolve(null);
    return qPromise.then(function(q) { return { item: data, question: q }; });
  }).then(function(payload) {
    _renderQaReviewModal(kind, id, payload.item, payload.question, meta);
  }).catch(function(err) {
    alert('加载全文失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
  });
}

function _renderQaReviewModal(kind, id, item, question, meta) {
  meta = meta || {};
  var old = document.querySelector('.qa-review-overlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay qa-review-overlay';
  var kindLabel = kind === 'answer' ? '回答' : '问题';
  var displayTitle = item.title || (kind === 'answer' && question ? question.title : '') || meta.title || ('#' + id);
  var metaText = [meta.author || (kind === 'question' ? (item.author || '') : '') || '', meta.createdAt ? '提交于 ' + meta.createdAt : '']
    .filter(Boolean).join(' · ');
  var contextHtml = '';
  if (kind === 'answer' && question) {
    contextHtml = '<div class="qa-review-context">' +
      '<div class="qa-review-context-label">所属问题</div>' +
      '<div class="qa-review-context-title">' + esc(question.title || '') + '</div>' +
      '<div class="qa-rich">' + qaSafeHtml(question.content || '') + '</div>' +
    '</div>';
  }
  overlay.innerHTML =
    '<div class="modal-card qa-review-card">' +
      '<button type="button" class="modal-close" aria-label="关闭审阅窗口" onclick="closeQaReview()">✕</button>' +
      '<h3 class="modal-title">审阅' + kindLabel + ' · ' + esc(displayTitle) + '</h3>' +
      (metaText ? '<div class="qa-review-meta">' + esc(metaText) + '</div>' : '') +
      contextHtml +
      '<div class="qa-review-content-label">' + kindLabel + '全文</div>' +
      '<div class="qa-review-body"><div class="qa-rich">' + qaSafeHtml(item.content || '') + '</div></div>' +
      '<div class="qa-review-hint">通过后公开展示；驳回时请填写可执行的原因，作者将收到通知并可修改后重新提交。</div>' +
      '<div class="qa-review-actions">' +
        '<button class="admin-btn admin-btn-approve" onclick="qaAdminApprove(\'' + kind + '\',' + id + ')">通过</button>' +
        '<button class="admin-btn admin-btn-reject" onclick="qaAdminReject(\'' + kind + '\',' + id + ')">驳回…</button>' +
        '<button class="admin-btn admin-btn-secondary" onclick="closeQaReview()">关闭</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  lockScroll();
  _pushModalHistory(overlay);
  overlay.onclick = function(e) { if (e.target === overlay) closeQaReview(); };
}

function closeQaReview() {
  var el = document.querySelector('.qa-review-overlay');
  if (el) { el.remove(); unlockScroll(); _popModalHistory(); }
}

// 通过 / 驳回待审内容（后端原子条件更新防双审；S05：驳回原因必填并通知作者）
function qaAdminApprove(kind, id) {
  closeQaReview(); // 从全文审阅弹窗决策后关闭弹窗
  api(kind === 'question'
      ? '/api/admin/qa/questions/' + id + '/approve/'
      : '/api/admin/qa/answers/' + id + '/approve/', { method: 'POST' })
    .then(function() {
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert((err && (err.message || err.error)) || '操作失败');
      renderAdminPending(document.getElementById('adminContent'));
    });
}

function qaAdminReject(kind, id) {
  // S05：驳回必须给出可执行原因（作者将收到通知并据此修改）
  var reason = '';
  for (;;) {
    var input = prompt('请输入驳回原因（必填，将通知作者并保存在内容状态中）：', '');
    if (input === null) return; // 用户取消
    reason = input.trim();
    if (reason) break;
    alert('驳回原因不能为空：作者需要据此修改内容');
  }
  closeQaReview();
  api(kind === 'question'
      ? '/api/admin/qa/questions/' + id + '/reject/'
      : '/api/admin/qa/answers/' + id + '/reject/', { method: 'POST', body: { reason: reason } })
    .then(function() {
      alert('已驳回，作者将收到通知');
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert((err && (err.message || err.error)) || '操作失败');
      renderAdminPending(document.getElementById('adminContent'));
    });
}

// ── v183 删除申请（用户提交 → 管理员批准/驳回）──
function _qaDeleteRequestCardHtml(req) {
  var kindLabel = req.target_type === 'answer' ? '回答' : '问题';
  return '<div class="qa-record-card qa-delete-req-card">' +
    '<div class="qa-record-main">' +
      '<div class="qa-record-title">' + iconSvg('trash') + ' 删除申请 · ' + kindLabel +
        '<span class="review-badge review-badge-pending" style="margin-left:6px">待批准</span></div>' +
      '<div class="qa-record-meta">目标：' + esc(req.target_title || '') + '</div>' +
      '<div class="qa-record-meta">申请人：' + esc(req.requester || '') + ' · ' + esc(req.created_at || '') + '</div>' +
      '<div class="qa-record-meta qa-delreq-reason">理由：' + esc(req.reason || '') + '</div>' +
    '</div>' +
    '<div class="qa-record-actions">' +
      '<button class="admin-btn admin-btn-approve admin-btn-sm" onclick="qaDeleteRequestApprove(' + req.id + ')">批准</button>' +
      '<button class="admin-btn admin-btn-reject admin-btn-sm" onclick="qaDeleteRequestReject(' + req.id + ')">驳回</button>' +
    '</div>' +
  '</div>';
}

function qaDeleteRequestApprove(id) {
  if (!confirm('批准后该内容将被删除（48 小时内可恢复）。确定批准？')) return;
  api('/api/admin/qa/delete-requests/' + id + '/approve/', { method: 'POST' })
    .then(function() {
      alert('已批准删除');
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert((err && (err.message || err.error)) || '操作失败');
      renderAdminPending(document.getElementById('adminContent'));
    });
}

function qaDeleteRequestReject(id) {
  var note = prompt('驳回备注（可选，将通知申请人）：', '');
  if (note === null) return; // 用户取消
  api('/api/admin/qa/delete-requests/' + id + '/reject/', { method: 'POST', body: { reason: note || '' } })
    .then(function() {
      alert('已驳回删除申请');
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert((err && (err.message || err.error)) || '操作失败');
      renderAdminPending(document.getElementById('adminContent'));
    });
}

// ── 管理动作 ──
function qaAdminView(qid) {
  pushViewState('qa', { qaId: qid });
  switchView('qa');
  updateSidebar('qa');
  renderQaDetail(qid);
  window.scrollTo({ top: 0 });
}

function qaAdminDelete(kind, id) {
  if (!confirm('确定删除这条' + (kind === 'question' ? '问题' : '回答') + '？48 小时内可恢复。')) return;
  api(kind === 'question'
      ? '/api/admin/qa/questions/' + id + '/delete/'
      : '/api/admin/qa/answers/' + id + '/delete/', { method: 'DELETE' })
    .then(function() {
      renderAdminQaRecords(document.getElementById('adminContent'), 1);
    }).catch(function(err) {
      alert('删除失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
    });
}

function qaAdminRestore(kind, id) {
  if (!confirm('确定恢复这条' + (kind === 'question' ? '问题' : '回答') + '？')) return;
  api(kind === 'question'
      ? '/api/admin/qa/questions/' + id + '/'
      : '/api/admin/qa/answers/' + id + '/', { method: 'PUT', body: { status: 'published' } })
    .then(function() {
      renderAdminQaRecords(document.getElementById('adminContent'), 1);
    }).catch(function(err) {
      alert('恢复失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
    });
}

// ── 编辑历史 + 回滚 ──
function showQaHistory(kind, id) {
  var base = kind === 'question' ? '/api/admin/qa/questions/' + id + '/history/' : '/api/admin/qa/answers/' + id + '/history/';
  api(base).then(function(data) {
    var items = data.items || [];
    var html = '<div class="admin-reject-dialog"><h3>编辑历史</h3>';
    if (!items.length) {
      html += '<div class="admin-empty">暂无编辑历史</div>';
    } else {
      html += '<div class="qa-history-list">';
      items.forEach(function(h, i) {
        var diffHtml;
        if (kind === 'question') {
          diffHtml = '标题：' + esc(h.old_title || '') + ' → ' + esc(h.new_title || '');
        } else {
          diffHtml = '回答正文有变更';
        }
        html += '<div class="qa-history-item">' +
          '<div class="qa-history-meta">' + esc(h.editor) + ' · ' + esc(h.created_at) + '</div>' +
          '<div class="qa-history-diff">' + diffHtml + '</div>' +
          '<button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="qaRollback(\'' + kind + '\',' + id + ',' + h.id + ',this)">回滚到此版本</button>' +
        '</div>';
      });
      html += '</div>';
    }
    html += '<div class="ar-actions"><button class="admin-btn admin-btn-secondary" onclick="this.closest(\'.admin-reject-overlay\').remove();unlockScroll()">关闭</button></div></div>';

    var old = document.querySelector('.qa-history-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay qa-history-overlay';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    lockScroll();
    overlay.onclick = function(e) { if (e.target === overlay) { overlay.remove(); unlockScroll(); } };
  }).catch(function() { alert('加载历史失败'); });
}

function qaRollback(kind, id, historyId, btn) {
  btn.disabled = true;
  var base = kind === 'question'
    ? '/api/admin/qa/questions/' + id + '/rollback/'
    : '/api/admin/qa/answers/' + id + '/rollback/';
  api(base, { method: 'POST', body: { history_id: historyId } }).then(function() {
    alert('已回滚');
    btn.closest('.admin-reject-overlay').remove();
    unlockScroll();
    renderAdminQaRecords(document.getElementById('adminContent'), 1);
  }).catch(function(err) {
    alert('回滚失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
    btn.disabled = false;
  });
}

// ── 发布 / 编辑 问题 · 回答（v175：薄包装 → 独立 qaCompose 视图）──
function openQaPublishModal() {
  showQaCompose({ type: 'question', action: 'create' });
}

function openQaQuestionEditor(qid) {
  showQaCompose({ type: 'question', action: qid ? 'edit' : 'create', qid: qid || undefined });
}

function openQaAnswerEditor(qid, aid) {
  showQaCompose({ type: 'answer', action: aid ? 'edit' : 'create', qid: qid || undefined, aid: aid || undefined });
}
