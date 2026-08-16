// ═══════════════════════════════════════════════════════════════
// 问答区（新生指南）· 独立发布/编辑视图（v175）
// 一个视图参数化四场景：问题创建 / 问题编辑 / 回答创建 / 回答编辑
// 依赖：utils.js（api / esc / escJs / clearApiCache / pushViewState / switchView）、qa-editor.js
// ═══════════════════════════════════════════════════════════════

var _qaComposeMode = null;        // {type:'question'|'answer', action:'create'|'edit', qid, aid}
var _qaComposeTags = null;        // 标签缓存
var _qaComposeTagL1 = '';
var _qaComposeTagL2 = '';
var _qaComposeEditable = null;
var _qaComposePrefetch = null;    // 编辑预填数据（含 question_id，供保存后导航用）

function _qaComposeCanManage() {
  return !!(currentUser && (currentUser.role === 'super_admin' || currentUser.can_moderate_qa));
}

function _qaComposeGuard() {
  if (!currentUser) { showLoginModal(); return false; }
  if (!_qaComposeCanManage() && !window._qaUserOpen) {
    alert('提问/回答功能暂未开放');
    if (typeof showQa === 'function') showQa();
    return false;
  }
  return true;
}

// v183：user 模式 = 普通用户且站点开放（非管理端）。管理端仍走 admin 端点，普通用户走 /api/qa/ 端点
function _qaComposeIsUser() {
  return !!currentUser && !_qaComposeCanManage();
}

function showQaCompose(mode) {
  _qaComposeMode = mode || { type: 'question', action: 'create' };
  if (typeof pushViewState === 'function') pushViewState('qaCompose', _qaComposeMode);
  switchView('qaCompose');
  updateSidebar('qa');
  renderQaCompose();
  window.scrollTo({ top: 0 });
}

function renderQaCompose() {
  var container = document.getElementById('qaComposeContent');
  if (!container) return;
  if (!_qaComposeGuard()) return;
  container.innerHTML = '<div class="empty-state compact" style="padding:40px">加载中...</div>';

  var mode = _qaComposeMode || {};
  _qaComposeTagL1 = '';
  _qaComposeTagL2 = '';
  _qaComposeEditable = null;
  _qaComposePrefetch = null;

  var tagsPromise = _qaComposeTags
    ? Promise.resolve(_qaComposeTags)
    : api('/api/qa/tags/').then(function(t) { _qaComposeTags = t; return t; });

  tagsPromise.then(function(tags) {
    var load = null;
    var isUser = _qaComposeIsUser();
    if (mode.type === 'question' && mode.action === 'edit' && mode.qid) {
      // v183：user 模式走作者编辑端点（GET /api/qa/questions/{qid}/）
      load = isUser
        ? api('/api/qa/questions/' + mode.qid + '/')
        : api('/api/admin/qa/questions/' + mode.qid + '/');
    } else if (mode.type === 'answer' && mode.action === 'edit' && mode.aid) {
      load = isUser
        ? api('/api/qa/answers/' + mode.aid + '/')
        : api('/api/admin/qa/answers/' + mode.aid + '/');
    } else if (mode.type === 'answer' && mode.action === 'create' && mode.qid) {
      load = api('/api/qa/questions/' + mode.qid + '/'); // 只读标题展示
    }
    (load || Promise.resolve(null)).then(function(data) {
      _qaComposePrefetch = data;
      _renderQaComposeForm(container, tags, data);
    }).catch(function() {
      container.innerHTML = '<div class="empty-state compact" style="padding:40px">加载失败，请重试。</div>';
    });
  }).catch(function() {
    container.innerHTML = '<div class="empty-state compact" style="padding:40px">加载标签失败。</div>';
  });
}

function _renderQaComposeForm(container, tags, data) {
  var mode = _qaComposeMode;
  var isQuestion = mode.type === 'question';
  var isEdit = mode.action === 'edit';

  var title = '';
  var pin = false;
  if (isQuestion && isEdit && data) {
    title = data.title || '';
    _qaComposeTagL1 = data.tag_l1_id || '';
    _qaComposeTagL2 = data.tag_l2_id || '';
    pin = !!data.is_pinned;
  }
  if (!isQuestion && isEdit && data) pin = !!data.is_pinned;

  var html = '<div class="qa-compose-page">';

  if (isQuestion) {
    html += '<div class="qa-compose-card">' +
      '<div class="mf-group">' +
        '<label>标题 <span class="qc-hint">一句话概括问题，最长 100 字</span></label>' +
        '<input type="text" id="qcTitle" class="mf-input" maxlength="100" placeholder="例如：新生报到需要准备哪些材料？" value="' + esc(title) + '">' +
      '</div>' +
      '<div class="qc-tag-section">' +
        '<div class="qc-tag-block">' +
          '<div class="qc-tag-label">一级标签 <span class="qc-hint">所属学院，或选「通用」</span></div>' +
          '<div class="qa-compose-l1" id="qcTagL1Row"></div>' +
        '</div>' +
        '<div class="qc-tag-block">' +
          '<div class="qc-tag-label">二级标签 <span class="qc-hint">点击后显示括号内解释</span></div>' +
          '<div class="qa-compose-l2" id="qcTagL2Row"></div>' +
        '</div>' +
        '<div class="qc-tag-summary" id="qcTagSummary"></div>' +
      '</div>' +
      '<div class="mf-group">' +
        '<label>正文 <span class="qc-hint">富文本，最长 1000 字</span></label>' +
        '<div id="qcEditor"></div>' +
      '</div>' +
      (_qaComposeIsUser() ? '' : '<label class="qe-pin-row"><input type="checkbox" id="qcPin" ' + (pin ? 'checked' : '') + '> 置顶此问题（全局最多 5 篇）</label>') +
    '</div>';
  } else {
    var contextLabel = isEdit ? '正在编辑回答' : '回答此问题';
    var qTitle = '';
    if (!isEdit && data && data.title) qTitle = esc(data.title);
    html += '<div class="qa-compose-card">' +
      '<div class="qc-answer-context">' +
        '<span class="qc-answer-context-label">' + contextLabel + '</span>' +
        (qTitle ? '<div class="qc-answer-qtitle">' + qTitle + '</div>' : '') +
      '</div>' +
      '<div class="mf-group">' +
        '<label>回答正文 <span class="qc-hint">富文本，最长 2 万字</span></label>' +
        '<div id="qcEditor"></div>' +
      '</div>' +
      (_qaComposeIsUser() ? '' : '<label class="qe-pin-row"><input type="checkbox" id="qcPin" ' + (pin ? 'checked' : '') + '> 在回答中置顶展示</label>') +
    '</div>';
  }

  html += '<div id="qcError" class="mf-error" style="display:none"></div>' +
    '<div class="qc-actions">' +
      '<button class="admin-btn admin-btn-secondary" onclick="qaComposeBack()">取消</button>' +
      '<button class="qa-gate-btn qc-submit" onclick="submitQaCompose(this)">' + (isEdit ? '保存' : '发布') + '</button>' +
    '</div></div>';

  container.innerHTML = html;

  var titleEl = document.getElementById('qaComposeTitle');
  if (titleEl) titleEl.textContent = _qaComposeTitle(mode);

  _renderQaTagPickers();

  var initHtml = (data && (data.content || '')) || '';
  var editorOpts = isQuestion
    ? { placeholder: '正文内容…（支持加粗、列表、小标题、插图）', maxCount: 1000 }
    : { placeholder: '回答正文…（支持加粗、列表、小标题、插图）', maxCount: 20000 };
  _qaComposeEditable = buildQaEditor(document.getElementById('qcEditor'), initHtml, editorOpts);
}

function _qaComposeTitle(mode) {
  if (mode.type === 'answer') return mode.action === 'edit' ? '编辑回答' : '发布回答';
  return mode.action === 'edit' ? '编辑问题' : '发布问题';
}

function _renderQaTagPickers() {
  var tags = _qaComposeTags;
  var l1Row = document.getElementById('qcTagL1Row');
  var l2Row = document.getElementById('qcTagL2Row');
  var summary = document.getElementById('qcTagSummary');
  if (!l1Row || !l2Row || !tags) return;

  var l1Html = '';
  (tags.l1 || []).forEach(function(t) {
    l1Html += '<button type="button" class="qa-l1-chip' + (String(_qaComposeTagL1) === String(t.id) ? ' on' : '') + '" onclick="qaComposePickL1(' + t.id + ')">' + esc(t.name) + '</button>';
  });
  l1Row.innerHTML = l1Html;

  var l2Html = '';
  (tags.l2 || []).forEach(function(t) {
    var on = String(_qaComposeTagL2) === String(t.id);
    l2Html += '<button type="button" class="qa-theme-card' + (on ? ' on' : '') + '" onclick="qaComposePickL2(' + t.id + ')">' +
      '<span class="qa-theme-name">' + esc(t.name) + '</span>' +
      (on ? '<span class="qa-theme-desc">' + esc(t.description || '') + '</span>' : '') +
    '</button>';
  });
  l2Row.innerHTML = l2Html;

  if (summary) {
    var l1Name = '', l2Name = '';
    var t1 = (tags.l1 || []).find(function(t) { return String(t.id) === String(_qaComposeTagL1); });
    var t2 = (tags.l2 || []).find(function(t) { return String(t.id) === String(_qaComposeTagL2); });
    if (t1) l1Name = t1.name;
    if (t2) l2Name = t2.name;
    var show = l1Name || l2Name;
    summary.innerHTML = show ? ('已选：' + esc(l1Name || '—') + ' · ' + esc(l2Name || '—')) : '';
    summary.style.display = show ? '' : 'none';
  }
}

function qaComposePickL1(id) { _qaComposeTagL1 = String(id); _renderQaTagPickers(); }
function qaComposePickL2(id) { _qaComposeTagL2 = String(id); _renderQaTagPickers(); }

function qaComposeBack() {
  if (typeof pushViewState === 'function') pushViewState('qa', {});
  switchView('qa');
  updateSidebar('qa');
  renderQaList();
  window.scrollTo({ top: 0 });
}

function submitQaCompose(btn) {
  var mode = _qaComposeMode || {};
  var isQuestion = mode.type === 'question';
  var isEdit = mode.action === 'edit';
  var isUser = _qaComposeIsUser();
  var errEl = document.getElementById('qcError');
  var _err = function(m) { if (errEl) { errEl.style.display = 'block'; errEl.textContent = m; } btn.disabled = false; };

  if (isQuestion) {
    var title = (document.getElementById('qcTitle') ? document.getElementById('qcTitle').value : '').trim();
    var content = _qaComposeEditable ? getQaEditorHtml(_qaComposeEditable) : '';
    var pin = !!(document.getElementById('qcPin') && document.getElementById('qcPin').checked);
    if (!title) { _err('请填写标题'); return; }
    if (title.length > 100) { _err('标题最长 100 字'); return; }
    if (!_qaComposeTagL1 || !_qaComposeTagL2) { _err('请选择一级和二级标签'); return; }
    if (!content) { _err('请填写正文'); return; }
    if (qaEditorVisibleLen(content) > 1000) { _err('正文最长 1000 字'); return; }

    var body = {
      title: title, content: content,
      tag_l1: parseInt(_qaComposeTagL1, 10), tag_l2: parseInt(_qaComposeTagL2, 10),
    };
    // v183：user 模式禁置顶（后端亦忽略，前端不发送）
    if (!isUser) body.is_pinned = pin;
    btn.disabled = true;
    // v183：user 模式走 /api/qa/ 端点（进待审核），管理端走 admin 端点
    var req;
    if (isEdit && mode.qid) {
      req = isUser
        ? api('/api/qa/questions/' + mode.qid + '/', { method: 'PUT', body: body })
        : api('/api/admin/qa/questions/' + mode.qid + '/', { method: 'PUT', body: body });
    } else {
      req = isUser
        ? api('/api/qa/questions/', { method: 'POST', body: body })
        : api('/api/admin/qa/questions/', { method: 'POST', body: body });
    }
    req.then(function(d) { qaComposeAfterSave(d.id); })
       .catch(function(e) { _err((e && (e.message || e.error)) || '保存失败'); });
    return;
  }

  var content = _qaComposeEditable ? getQaEditorHtml(_qaComposeEditable) : '';
  var pin = !!(document.getElementById('qcPin') && document.getElementById('qcPin').checked);
  if (!content) { _err('请填写回答正文'); return; }
  if (qaEditorVisibleLen(content) > 20000) { _err('回答最长 2 万字'); return; }
  btn.disabled = true;
  var body = { content: content };
  if (!isUser) body.is_pinned = pin;
  var req;
  if (isEdit && mode.aid) {
    req = isUser
      ? api('/api/qa/answers/' + mode.aid + '/', { method: 'PUT', body: body })
      : api('/api/admin/qa/answers/' + mode.aid + '/', { method: 'PUT', body: body });
  } else if (mode.qid) {
    req = isUser
      ? api('/api/qa/questions/' + mode.qid + '/answers/', { method: 'POST', body: body })
      : api('/api/admin/qa/questions/' + mode.qid + '/answers/', { method: 'POST', body: body });
  } else {
    _err('缺少问题上下文'); btn.disabled = false; return;
  }
  req.then(function() {
    var qid = mode.qid;
    if (isEdit) qid = (_qaComposePrefetch && _qaComposePrefetch.question_id) || mode.qid;
    qaComposeAfterSave(qid);
  }).catch(function(e) {
    _err((e && (e.message || e.error)) || '保存失败');
  });
}

function qaComposeAfterSave(qid) {
  clearApiCache('/api/qa/');
  if (!qid) { qaComposeBack(); return; }
  if (typeof pushViewState === 'function') pushViewState('qa', { qaId: qid });
  switchView('qa');
  updateSidebar('qa');
  renderQaDetail(qid);
  window.scrollTo({ top: 0 });
}
