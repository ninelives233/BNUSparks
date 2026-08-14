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
  var segHtml = '<div class="pc-type-bar"><span class="pc-type-label">💬 论坛记录</span>' +
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
      html += '<div class="qa-record-list">';
      items.forEach(function(it) { html += _qaRecordCardHtml(it); });
      html += '</div>';
      if (data.total_pages > 1) {
        html += '<div class="file-pagination" style="justify-content:center;margin-top:14px">' +
          '<button class="fp-btn fp-prev' + (page <= 1 ? ' fp-disabled' : '') + '" onclick="qaRecordsGoPage(' + (page - 1) + ')">◀</button>' +
          '<span class="fp-btn fp-num fp-active">' + page + ' / ' + data.total_pages + '</span>' +
          '<button class="fp-btn fp-next' + (page >= data.total_pages ? ' fp-disabled' : '') + '" onclick="qaRecordsGoPage(' + (page + 1) + ')">▶</button>' +
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
var _QA_STATUS_CLS = { published: 'review-badge-approved', deleted: 'review-badge-rejected', pending: 'review-badge-pending', rejected: 'review-badge-rejected' };

function _qaRecordCardHtml(it) {
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
  return '<div class="qa-record-card qa-status-' + (it.status || '') + '">' +
    '<div class="qa-record-main">' +
      '<div class="qa-record-title">' + (it.kind === 'question' ? '❓ ' : '💬 ') + esc(it.title) + pinHtml +
        '<span class="review-badge ' + statusCls + '" style="margin-left:6px">' + statusLabel + '</span>' + '</div>' +
      '<div class="qa-record-meta">' + (it.kind === 'question' ? '问题' : '回答') + ' · ' + esc(it.author) + ' · ' + esc(it.created_at) +
        (it.content_preview ? ' · ' + esc(it.content_preview) : '') + '</div>' +
    '</div>' +
    '<div class="qa-record-actions">' + actions + '</div>' +
  '</div>';
}

// ── 论坛管理待审（v175：真实 pending 列表 + 通过/驳回）──
function _qaForumPendingCardHtml(item) {
  var statusLabel = _QA_STATUS_LABEL[item.status] || item.status;
  var kindIcon = item.kind === 'answer' ? '💬' : '❓';
  var reasonBtn = '驳回原因（可选）';
  return '<div class="qa-record-card qa-status-' + (item.status || '') + '">' +
    '<div class="qa-record-main">' +
      '<div class="qa-record-title">' + kindIcon + ' ' + esc(item.title || '') +
        '<span class="review-badge review-badge-pending" style="margin-left:6px">' + statusLabel + '</span></div>' +
      '<div class="qa-record-meta">' + (item.kind === 'answer' ? '回答' : '问题') + ' · ' + esc(item.author || '') + ' · ' + esc(item.created_at || '') + '</div>' +
      (item.content_preview ? '<div class="qa-record-meta">' + esc(item.content_preview) + '</div>' : '') +
    '</div>' +
    '<div class="qa-record-actions">' +
      '<button class="admin-btn admin-btn-approve admin-btn-sm" onclick="qaAdminApprove(\'' + item.kind + '\',' + item.id + ')">通过</button>' +
      '<button class="admin-btn admin-btn-reject admin-btn-sm" onclick="qaAdminReject(\'' + item.kind + '\',' + item.id + ')">驳回</button>' +
    '</div>' +
  '</div>';
}

// 通过 / 驳回待审内容（后端原子条件更新防双审；驳回带原因则通知作者）
function qaAdminApprove(kind, id) {
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
  var reason = prompt('请输入驳回原因（可选，填写后将通知作者）：', '');
  if (reason === null) return; // 用户取消
  api(kind === 'question'
      ? '/api/admin/qa/questions/' + id + '/reject/'
      : '/api/admin/qa/answers/' + id + '/reject/', { method: 'POST', body: { reason: reason } })
    .then(function() {
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
