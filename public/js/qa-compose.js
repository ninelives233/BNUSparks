// ═══════════════════════════════════════════════════════════════
// 问答区（新生指南）· 独立发布/编辑视图（v175）
// 一个视图参数化四场景：问题创建 / 问题编辑 / 回答创建 / 回答编辑
// 依赖：utils.js（api / esc / escJs / clearApiCache / pushViewState / switchView）、qa-editor.js
// v186 缺陷修复：
//   F03 新回答正文为空，问题标题/描述作为只读参考展示
//   F04 普通用户提交按钮改「提交审核」，成功后回执（详情页含作者可见的待审卡）
//   F06 草稿自动保存/恢复/放弃（按账号+内容类型+问题隔离），提交成功才清除
//   S02 配置守卫改四态（loading/open/closed/error），冷加载不再误报「未开放」
// ═══════════════════════════════════════════════════════════════

var _qaComposeMode = null;        // {type:'question'|'answer', action:'create'|'edit', qid, aid}
var _qaComposeTags = null;        // 标签缓存
var _qaComposeTagL1 = '';
var _qaComposeTagL2 = '';
var _qaComposeEditable = null;
var _qaComposePrefetch = null;    // 编辑预填数据（含 question_id，供保存后导航用）

// F06 草稿状态
var _qaDraftTimer = null;
var _qaDraftDirty = false;        // 用户是否改动过表单（决定离开时是否提示）

function _qaComposeCanManage() {
  return !!(currentUser && (currentUser.role === 'super_admin' || currentUser.can_moderate_qa));
}

// S02：守卫改异步——普通用户等待配置状态（loading 等待 / closed 准确提示 /
// error 提示加载失败），管理端直接放行。返回 Promise<boolean>。
function _qaComposeGuard() {
  if (!currentUser) { showLoginModal(); return Promise.resolve(false); }
  if (_qaComposeCanManage()) return Promise.resolve(true);
  if (typeof _qaEnsureConfig !== 'function') return Promise.resolve(false);
  return _qaEnsureConfig().then(function(state) {
    if (state === 'open') return true;
    alert(state === 'error' ? '问答设置加载失败，请刷新重试' : '提问/回答功能暂未开放');
    if (typeof showQa === 'function') showQa();
    return false;
  });
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
  _qaComposeGuard().then(function(ok) {
    if (ok) _renderQaComposeInto(container);
  });
}

function _renderQaComposeInto(container) {
  container.innerHTML = '<div class="empty-state compact" style="padding:40px">加载中...</div>';

  var mode = _qaComposeMode || {};
  _qaComposeTagL1 = '';
  _qaComposeTagL2 = '';
  _qaComposeEditable = null;
  _qaComposePrefetch = null;
  _qaDraftDirty = false;
  if (_qaDraftTimer) { clearTimeout(_qaDraftTimer); _qaDraftTimer = null; }

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
      load = api('/api/qa/questions/' + mode.qid + '/'); // 只读问题上下文（标题/描述）
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
    var qDescHtml = '';
    if (!isEdit && data) {
      // F03：问题标题与描述作为只读参考展示；回答正文保持空白
      qTitle = esc(data.title || '');
      if (data.content) {
        qDescHtml = '<div class="qc-answer-qdesc">' + qaSafeHtml(data.content) + '</div>';
      }
    }
    html += '<div class="qa-compose-card">' +
      '<div class="qc-answer-context">' +
        '<span class="qc-answer-context-label">' + contextLabel + '</span>' +
        (qTitle ? '<div class="qc-answer-qtitle">' + qTitle + '</div>' : '') +
        qDescHtml +
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
      '<div id="qcDraftStatus" class="qc-draft-status" aria-live="polite"></div>' +
      '<button class="admin-btn admin-btn-secondary" onclick="qaComposeBack()">取消</button>' +
      '<button class="qa-gate-btn qc-submit" onclick="submitQaCompose(this)">' + _qaComposeSubmitLabel(mode) + '</button>' +
    '</div></div>';

  container.innerHTML = html;

  var titleEl = document.getElementById('qaComposeTitle');
  if (titleEl) titleEl.textContent = _qaComposeTitle(mode);

  _renderQaTagPickers();

  // F03：编辑场景才预填正文；新建场景（问题/回答）一律空白起稿
  var initHtml = (isEdit && data && (data.content || '')) || '';
  var editorOpts = isQuestion
    ? { placeholder: '正文内容…（支持加粗、列表、小标题、插图）', maxCount: 1000 }
    : { placeholder: '回答正文…（支持加粗、列表、小标题、插图）', maxCount: 20000 };
  _qaComposeEditable = buildQaEditor(document.getElementById('qcEditor'), initHtml, editorOpts);

  // F06：恢复草稿（新建/编辑一致，按账号+类型+目标隔离）
  _qaDraftRestore();

  // F06：输入即标记脏状态并排程自动保存
  var titleInput = document.getElementById('qcTitle');
  if (titleInput) {
    titleInput.addEventListener('input', function() {
      _qaDraftDirty = true;
      _qaDraftSchedule();
    });
  }
  if (_qaComposeEditable) {
    _qaComposeEditable.addEventListener('input', function() {
      _qaDraftDirty = true;
      _qaDraftSchedule();
    });
  }
}

function _qaComposeSubmitLabel(mode) {
  var isEdit = mode.action === 'edit';
  if (isEdit) return _qaComposeIsUser() ? '保存修改' : '保存';
  // F04：普通用户发布前明确「进审核」；管理端直发保持「发布」
  return _qaComposeIsUser() ? '提交审核' : '发布';
}

function _qaComposeTitle(mode) {
  if (mode.type === 'answer') return mode.action === 'edit' ? '编辑回答' : '发布回答';
  return mode.action === 'edit' ? '编辑问题' : '发布问题';
}

// ═══════════════════════════════════════════════════════════════
// F06 · 草稿（localStorage：账号 + 内容类型 + 目标隔离）
// ═══════════════════════════════════════════════════════════════

function _qaDraftKey() {
  var mode = _qaComposeMode || {};
  var uid = (currentUser && currentUser.id) ||
    (function() { try { return localStorage.getItem('bnusparks_user_id') || 'anon'; } catch (e) { return 'anon'; } })();
  var type = mode.type === 'answer' ? 'answer' : 'question';
  var scope;
  if (mode.action === 'edit') {
    scope = type === 'answer' ? ('a' + (mode.aid || '')) : ('q' + (mode.qid || ''));
  } else {
    // 新回答绑定所属问题；新问题为全局单草稿
    scope = type === 'answer' ? ('new-' + (mode.qid || '')) : 'new';
  }
  return 'bnusparks_qa_draft:' + uid + ':' + type + ':' + scope;
}

function _qaDraftCollect() {
  var title = document.getElementById('qcTitle');
  return {
    title: title ? title.value : '',
    content: _qaComposeEditable ? getQaEditorHtml(_qaComposeEditable) : '',
    tagL1: _qaComposeTagL1 || '',
    tagL2: _qaComposeTagL2 || '',
    savedAt: Date.now(),
  };
}

function _qaDraftApply(draft) {
  var draftEmpty = draft && !(draft.title || '').trim() && !(draft.content || '').trim() && !draft.tagL1 && !draft.tagL2;
  if (!draft || draftEmpty) return;
  var titleInput = document.getElementById('qcTitle');
  if (titleInput && (draft.title || '').trim()) titleInput.value = draft.title;
  if (draft.tagL1) _qaComposeTagL1 = String(draft.tagL1);
  if (draft.tagL2) _qaComposeTagL2 = String(draft.tagL2);
  _renderQaTagPickers();
  if (_qaComposeEditable && draft.content) {
    _qaComposeEditable.innerHTML = qaSafeHtml(draft.content);
    _qaComposeEditable.classList.remove('is-empty');
    if (typeof _qaEditorSyncCount === 'function') _qaEditorSyncCount(_qaComposeEditable);
  }
  _qaDraftDirty = true;
  _qaDraftStatus('已恢复上次未提交的草稿 · 保存于 ' + _qaDraftTime(draft.savedAt));
}

function _qaDraftRestore() {
  try {
    var raw = localStorage.getItem(_qaDraftKey());
    if (raw) _qaDraftApply(JSON.parse(raw));
  } catch (e) { /* 草稿损坏时静默忽略，按空白起稿 */ }
}

function _qaDraftTime(ts) {
  var d = new Date(ts || Date.now());
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

function _qaDraftStatus(text) {
  var el = document.getElementById('qcDraftStatus');
  if (el) el.textContent = text || '';
}

function _qaDraftSaveNow() {
  if (_qaDraftTimer) { clearTimeout(_qaDraftTimer); _qaDraftTimer = null; }
  if (!_qaComposeEditable) return;
  try {
    localStorage.setItem(_qaDraftKey(), JSON.stringify(_qaDraftCollect()));
    _qaDraftStatus('草稿已保存 ' + _qaDraftTime());
  } catch (e) {
    _qaDraftStatus('草稿保存失败（存储空间不足）');
  }
}

function _qaDraftSchedule() {
  if (_qaDraftTimer) clearTimeout(_qaDraftTimer);
  _qaDraftTimer = setTimeout(_qaDraftSaveNow, 800);
}

function _qaDraftClear() {
  try { localStorage.removeItem(_qaDraftKey()); } catch (e) {}
  _qaDraftStatus('');
}

function _qaRenderQaTagPickersWithDraft() {
  _renderQaTagPickers();
  _qaDraftDirty = true;
  _qaDraftSchedule();
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

function qaComposePickL1(id) { _qaComposeTagL1 = String(id); _qaRenderQaTagPickersWithDraft(); }
function qaComposePickL2(id) { _qaComposeTagL2 = String(id); _qaRenderQaTagPickersWithDraft(); }

function qaComposeBack() {
  // F06：有未保存改动时明确「保存草稿并返回」或「放弃」；不丢内容也不静默丢弃
  if (_qaDraftDirty) {
    var keep = confirm('有未提交的内容。\n点击「确定」保存为草稿并返回，点击「取消」放弃草稿直接返回。');
    if (keep) _qaDraftSaveNow();
    else _qaDraftClear();
  }
  if (_qaDraftTimer) { clearTimeout(_qaDraftTimer); _qaDraftTimer = null; }
  if (typeof pushViewState === 'function') pushViewState('qa', typeof _qaListState === 'function' ? _qaListState() : {});
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
    req.then(function(d) {
      // F06：提交成功才清除草稿；失败保留输入
      _qaDraftClear();
      _qaDraftDirty = false;
      // F04：普通用户提问进审核——明确回执 + 详情页呈现作者可见的待审卡
      if (isUser && !isEdit && d && d.status === 'pending') {
        alert('提问已提交审核，通过后将公开展示。\n你可以在问题页随时查看和编辑它。');
      } else if (isUser && isEdit) {
        alert('已保存修改');
      }
      qaComposeAfterSave(d.id);
    }).catch(function(e) {
      _err((e && (e.message || e.error)) || '保存失败');
      _qaDraftSaveNow(); // F06：网络失败保留输入
    });
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
  req.then(function(d) {
    _qaDraftClear();
    _qaDraftDirty = false;
    var qid = mode.qid;
    if (isEdit) qid = (_qaComposePrefetch && _qaComposePrefetch.question_id) || mode.qid;
    // F04：提交待审核回答的明确回执；详情页会显示作者可见的「审核中」回答卡
    if (isUser && !isEdit && (!d || d.status === 'pending')) {
      alert('回答已提交审核，通过后将公开展示。\n你可以在问题页随时查看和编辑它。');
    } else if (isUser && isEdit) {
      alert('已保存修改');
    }
    qaComposeAfterSave(qid);
  }).catch(function(e) {
    _err((e && (e.message || e.error)) || '保存失败');
    _qaDraftSaveNow();
  });
}

function qaComposeAfterSave(qid) {
  clearApiCache('/api/qa/');
  if (!qid) { qaComposeBack(); return; }
  if (typeof pushViewState === 'function') pushViewState('qa', Object.assign({ qaId: qid }, typeof _qaListState === 'function' ? _qaListState() : {}));
  switchView('qa');
  updateSidebar('qa');
  renderQaDetail(qid);
  window.scrollTo({ top: 0 });
}
