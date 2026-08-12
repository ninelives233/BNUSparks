// ═══════════════════════════════════════════════════════════════
// 问答区管理端（问答区版主 / 超管）
// 论坛记录 tab、论坛管理 pending、发布/编辑问题与回答、历史回滚、删除/恢复
// 依赖：qa-editor.js（buildQaEditor / getQaEditorHtml）、utils.js、admin.js 的 overlay 模式
// ═══════════════════════════════════════════════════════════════

// ── 论坛记录（管理后台 tab）──
function renderAdminQaRecords(content, page) {
  content.innerHTML = '<div class="admin-loading">加载中…</div>';
  api('/api/admin/qa/records/?page=' + page + '&pageSize=10').then(function(data) {
    var items = data.items || [];
    var html = '<div class="pc-toolbar" style="margin-bottom:12px">' +
      '<span class="pc-type-label">💬 论坛记录 — 问答区文字内容过审情况</span>' +
    '</div>';
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
  return '<div class="qa-record-card">' +
    '<div class="qa-record-main">' +
      '<div class="qa-record-title">' + (it.kind === 'question' ? '❓ ' : '💬 ') + esc(it.title) + pinHtml +
        '<span class="review-badge ' + statusCls + '" style="margin-left:6px">' + statusLabel + '</span>' + '</div>' +
      '<div class="qa-record-meta">' + (it.kind === 'question' ? '问题' : '回答') + ' · ' + esc(it.author) + ' · ' + esc(it.created_at) +
        (it.content_preview ? ' · ' + esc(it.content_preview) : '') + '</div>' +
    '</div>' +
    '<div class="qa-record-actions">' + actions + '</div>' +
  '</div>';
}

// ── 论坛管理待审（Phase 2 预留卡片渲染）──
function _qaForumPendingCardHtml(item) {
  var statusLabel = _QA_STATUS_LABEL[item.status] || item.status;
  return '<div class="qa-record-card">' +
    '<div class="qa-record-main">' +
      '<div class="qa-record-title">❓ ' + esc(item.title || '') +
        '<span class="review-badge review-badge-pending" style="margin-left:6px">' + statusLabel + '</span></div>' +
      '<div class="qa-record-meta">' + esc(item.author || '') + ' · ' + esc(item.created_at || '') + '</div>' +
    '</div>' +
  '</div>';
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

// ── 发布 / 编辑 问题 ──
function openQaPublishModal() {
  openQaQuestionEditor(null);
}

function openQaQuestionEditor(qid) {
  var isEdit = !!qid;
  var title = '', content = '', tagL1 = '', tagL2 = '', pinned = false;
  var load = isEdit ? api('/api/admin/qa/questions/' + qid + '/') : Promise.resolve(null);
  load.then(function(q) {
    if (q) { title = q.title; content = q.content; tagL1 = q.tag_l1_id; tagL2 = q.tag_l2_id; pinned = q.is_pinned; }
    _buildQaQuestionModal(qid, title, content, tagL1, tagL2, pinned, isEdit);
  }).catch(function() { alert('加载问题失败'); });
}

function _buildQaQuestionModal(qid, title, content, tagL1, tagL2, pinned, isEdit) {
  api('/api/qa/tags/').then(function(tags) {
    var old = document.querySelector('.qa-editor-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay qa-editor-overlay';
    overlay.innerHTML =
      '<div class="modal-card modal-card-wide">' +
        '<button class="modal-close" onclick="closeQaEditorOverlay(this)">✕</button>' +
        '<h3 class="modal-title">' + (isEdit ? '编辑问题' : '发布问题') + '</h3>' +
        '<div class="mf-group"><label>标题</label>' +
          '<input type="text" id="qeTitle" class="mf-input" maxlength="100" placeholder="一句话概括问题" value="' + esc(title) + '"></div>' +
        '<div class="qe-tags-row">' +
          '<div class="mf-group"><label>一级标签</label><select id="qeTagL1" class="mf-input" onchange="qeTagL1Changed()"></select></div>' +
          '<div class="mf-group"><label>二级标签</label><select id="qeTagL2" class="mf-input" onchange="qeTagL2Changed()"></select></div>' +
        '</div>' +
        '<div id="qeTagDesc" class="qa-tag-desc"></div>' +
        '<div class="mf-group"><label>描述（富文本，≤1000 字）</label><div id="qeEditorContainer"></div></div>' +
        '<label class="qe-pin-row"><input type="checkbox" id="qePin" ' + (pinned ? 'checked' : '') + '> 置顶此问题（全局最多 5 篇）</label>' +
        '<div id="qeError" class="mf-error" style="display:none"></div>' +
        '<div class="qe-editor-actions"><button class="qa-gate-btn" onclick="submitQaQuestionEditor(this)">' + (isEdit ? '保存' : '发布') + '</button></div>' +
      '</div>';
    document.body.appendChild(overlay);
    lockScroll();

    // 标签下拉
    var sel1 = document.getElementById('qeTagL1');
    var sel2 = document.getElementById('qeTagL2');
    sel1.innerHTML = '<option value="">选择一级标签</option>' + (tags.l1 || []).map(function(t) {
      return '<option value="' + t.id + '"' + (String(tagL1) === String(t.id) ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');
    sel2.innerHTML = '<option value="">选择二级标签</option>' + (tags.l2 || []).map(function(t) {
      return '<option value="' + t.id + '"' + (String(tagL2) === String(t.id) ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');
    // 编辑器
    var editable = buildQaEditor(document.getElementById('qeEditorContainer'), content || '');
    overlay.setAttribute('data-editable', 'qeEditorContainer');
    window._qaEditable = editable;
    qeTagL2Changed();
  }).catch(function() { alert('加载标签失败'); });
}

function qeTagL1Changed() {
  // 一级标签切换不重置二级（8 个固定二级对所有一级通用）
}

function qeTagL2Changed() {
  var desc = document.getElementById('qeTagDesc');
  var sel2 = document.getElementById('qeTagL2');
  if (!desc || !sel2) return;
  var opt = sel2.options[sel2.selectedIndex];
  var d = opt ? opt.getAttribute('data-desc') : '';
  desc.textContent = d ? (opt.text + '（' + d + '）') : '';
}

function submitQaQuestionEditor(btn) {
  var isEdit = !!btn.dataset.edit;
  var title = document.getElementById('qeTitle').value.trim();
  var tagL1 = document.getElementById('qeTagL1').value;
  var tagL2 = document.getElementById('qeTagL2').value;
  var pin = document.getElementById('qePin').checked;
  var editable = window._qaEditable;
  var content = editable ? getQaEditorHtml(editable) : '';
  var errEl = document.getElementById('qeError');
  if (!title) { errEl.style.display = 'block'; errEl.textContent = '请填写标题'; return; }
  if (!tagL1 || !tagL2) { errEl.style.display = 'block'; errEl.textContent = '请选择一级和二级标签'; return; }
  if (!content) { errEl.style.display = 'block'; errEl.textContent = '请填写描述正文'; return; }
  btn.disabled = true;
  var body = { title: title, content: content, tag_l1: parseInt(tagL1), tag_l2: parseInt(tagL2), is_pinned: pin };
  var qid = btn.dataset.qid;
  var req = qid
    ? api('/api/admin/qa/questions/' + qid + '/', { method: 'PUT', body: body })
    : api('/api/admin/qa/questions/', { method: 'POST', body: body });
  req.then(function() {
    var overlay = btn.closest('.qa-editor-overlay');
    if (overlay) overlay.remove();
    unlockScroll();
    window._qaEditable = null;
    renderAdminQaRecords(document.getElementById('adminContent'), 1);
  }).catch(function(err) {
    errEl.style.display = 'block';
    errEl.textContent = (err && (err.message || err.error)) || '保存失败';
    btn.disabled = false;
  });
}

function closeQaEditorOverlay(closeBtn) {
  var overlay = closeBtn.closest('.qa-editor-overlay');
  if (overlay) overlay.remove();
  unlockScroll();
  window._qaEditable = null;
}

// ── 发布 / 编辑 回答 ──
function openQaAnswerEditor(qid, aid) {
  var isEdit = !!aid;
  var load = isEdit ? api('/api/admin/qa/answers/' + aid + '/') : Promise.resolve(null);
  load.then(function(a) {
    var content = a ? a.content : '';
    var pinned = a ? a.is_pinned : false;
    var old = document.querySelector('.qa-editor-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay qa-editor-overlay';
    overlay.innerHTML =
      '<div class="modal-card modal-card-wide">' +
        '<button class="modal-close" onclick="closeQaEditorOverlay(this)">✕</button>' +
        '<h3 class="modal-title">' + (isEdit ? '编辑回答' : '发布回答') + '</h3>' +
        '<div class="mf-group"><label>回答正文（富文本，≤2 万字）</label><div id="qeAnswerEditorContainer"></div></div>' +
        '<label class="qe-pin-row"><input type="checkbox" id="qeAnsPin" ' + (pinned ? 'checked' : '') + '> 在回答中置顶展示</label>' +
        '<div id="qeAnsError" class="mf-error" style="display:none"></div>' +
        '<div class="qe-editor-actions"><button class="qa-gate-btn" onclick="submitQaAnswerEditor(this)">' + (isEdit ? '保存' : '发布') + '</button></div>' +
      '</div>';
    document.body.appendChild(overlay);
    lockScroll();
    window._qaEditable = buildQaEditor(document.getElementById('qeAnswerEditorContainer'), content || '');
    if (isEdit) {
      var btn = overlay.querySelector('.qe-editor-actions .qa-gate-btn');
      btn.dataset.aid = aid;
      btn.dataset.qid = qid;
    } else {
      var btn2 = overlay.querySelector('.qe-editor-actions .qa-gate-btn');
      btn2.dataset.qid = qid;
    }
  }).catch(function() { alert('加载回答失败'); });
}

function submitQaAnswerEditor(btn) {
  var qid = btn.dataset.qid;
  var aid = btn.dataset.aid;
  var pin = document.getElementById('qeAnsPin').checked;
  var content = window._qaEditable ? getQaEditorHtml(window._qaEditable) : '';
  var errEl = document.getElementById('qeAnsError');
  if (!content) { errEl.style.display = 'block'; errEl.textContent = '请填写回答正文'; return; }
  btn.disabled = true;
  var req = aid
    ? api('/api/admin/qa/answers/' + aid + '/', { method: 'PUT', body: { content: content, is_pinned: pin } })
    : api('/api/admin/qa/questions/' + qid + '/answers/', { method: 'POST', body: { content: content, is_pinned: pin } });
  req.then(function() {
    var overlay = btn.closest('.qa-editor-overlay');
    if (overlay) overlay.remove();
    unlockScroll();
    window._qaEditable = null;
    renderAdminQaRecords(document.getElementById('adminContent'), 1);
  }).catch(function(err) {
    errEl.style.display = 'block';
    errEl.textContent = (err && (err.message || err.error)) || '保存失败';
    btn.disabled = false;
  });
}
