// ═══════════════════════════════════════════════════════════════
// 问答区（新生指南）· 浏览端
// 列表 / 筛选 / 搜索 / 详情 / 收藏 / 点赞 / 2026 门控 / 「我要提问」埋点
// 依赖：utils.js（api / esc / escJs / lockScroll / ICONS）
// ═══════════════════════════════════════════════════════════════

var _QA_SEARCH_PLACEHOLDER = '搜索问题、回答…';
var _DEFAULT_SEARCH_PLACEHOLDER = '搜索课程、资料、课程代码…';
var _QA_GATE_KEY = 'bnusparks_qa_guest';

// 分页 / 筛选状态
var _qaPage = 1;
var _qaPageSize = 10;
var _qaTagL1 = '';
var _qaTagL2 = '';
var _qaSort = 'default';
var _qaTotalPages = 1;
var _qaTags = null;       // 两级标签缓存
var _qaPhInitialized = false;
var _qaFilterOpen = false;   // 筛选面板默认收起（v177：筛选按钮展开/收起）

// ── 图标（与全站 24×24 stroke 风格一致）──
var _QA_IC_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" aria-hidden="true"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z"/></svg>';
var _QA_IC_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
var _QA_IC_ANSWER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
var _QA_IC_THUMB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.9L14 10h5a2 2 0 0 1 2 2.5l-1.7 7A2 2 0 0 1 17.3 21H8a1 1 0 0 1-1-1V11a1 1 0 0 1 .6-.9L12 8l1.2-4.3A2 2 0 0 1 15 5.9z"/></svg>';
var _QA_IC_THUMB_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M7 10v12H3a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h4zm2 12h8a2 2 0 0 0 1.9-1.4l1.7-7A2 2 0 0 0 18.6 10H14l1-4.3A2 2 0 0 0 12.9 3.2L12 8 8.9 10.6A1 1 0 0 0 9 12v10z"/></svg>';

function isQaViewActive() {
  var el = document.getElementById('qaView');
  return !!(el && el.classList.contains('active'));
}

// 搜索框 placeholder 自适应：进入问答区 → 帖子搜索提示，离开 → 恢复
function _initQaPlaceholder() {
  if (_qaPhInitialized) return;
  _qaPhInitialized = true;
  var el = document.getElementById('qaView');
  var input = document.querySelector('.search-box input');
  if (!el || !input) return;
  new MutationObserver(function() {
    if (el.classList.contains('active')) {
      if (input.placeholder !== _QA_SEARCH_PLACEHOLDER) input.placeholder = _QA_SEARCH_PLACEHOLDER;
    } else if (input.placeholder === _QA_SEARCH_PLACEHOLDER) {
      input.placeholder = _DEFAULT_SEARCH_PLACEHOLDER;
    }
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
}

// ── 视图入口 ──
async function renderQaView() {
  _initQaPlaceholder();
  if (!currentUser && !sessionStorage.getItem(_QA_GATE_KEY)) {
    showQaGate();
    return;
  }
  renderQaList();
}

// ── 2026 门控 ──
function showQaGate() {
  _removeQaOverlay('qa-gate-overlay');
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay qa-gate-overlay';
  overlay.innerHTML =
    '<div class="modal-card qa-gate-card">' +
      '<button class="modal-close" onclick="closeQaGate()">✕</button>' +
      '<h3 class="modal-title">学号验证</h3>' +
      '<p class="qa-gate-desc">若邮箱未激活，请填写学号完成验证。</p>' +
      '<input type="text" id="qaGateSid" class="qa-gate-input" maxlength="20" placeholder="请输入学号" autocomplete="off">' +
      '<div id="qaGateError" class="qa-gate-error" style="display:none"></div>' +
      '<div class="qa-gate-actions">' +
        '<button class="qa-gate-btn" onclick="submitQaGate()">验证并进入</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  lockScroll();
  var inp = document.getElementById('qaGateSid');
  if (inp) {
    inp.focus();
    inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') submitQaGate(); });
  }
}

function closeQaGate() {
  _removeQaOverlay('qa-gate-overlay');
  // 未验证则回到首页
  if (!currentUser && !sessionStorage.getItem(_QA_GATE_KEY)) {
    if (typeof showHome === 'function') showHome();
  }
}

async function submitQaGate() {
  var sid = document.getElementById('qaGateSid').value.trim();
  var errEl = document.getElementById('qaGateError');
  if (!sid) { if (errEl) { errEl.style.display = 'block'; errEl.textContent = '请输入学号'; } return; }
  try {
    await api('/api/qa/guest/verify/', { method: 'POST', body: { sid: sid } });
    sessionStorage.setItem(_QA_GATE_KEY, '1');
    _removeQaOverlay('qa-gate-overlay');
    renderQaList();
  } catch (err) {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = err.message || err.error || '验证失败'; }
  }
}

function _removeQaOverlay(cls) {
  var el = document.querySelector('.' + cls);
  if (el) { el.remove(); unlockScroll(); }
}

// ── 列表 ──
async function renderQaList() {
  var container = document.getElementById('qaContent');
  if (!container) return;
  container.innerHTML = '<div class="empty-state compact" style="padding:40px">加载中...</div>';
  try {
    if (!_qaTags) {
      _qaTags = await api('/api/qa/tags/');
    }
    var params = '?page=' + _qaPage + '&pageSize=' + _qaPageSize + '&sort=' + encodeURIComponent(_qaSort);
    if (_qaTagL1) params += '&tag_l1=' + _qaTagL1;
    if (_qaTagL2) params += '&tag_l2=' + _qaTagL2;
    var data = await api('/api/qa/questions/' + params);
    _qaTotalPages = data.total_pages || 1;
    container.innerHTML = _qaListHtml(data);
    _updateQaFilterButton();
  } catch (err) {
    container.innerHTML = '<div class="empty-state compact" style="padding:40px">加载失败，请重试。</div>';
  }
}

function _qaListHtml(data) {
  var html = '';
  // 筛选工具栏
  html += _qaFilterBarHtml();
  // 置顶精选区：仅无筛选且第一页时独立展示（上限 5 由后端保障）
  var showPinned = !_qaTagL1 && !_qaTagL2 && _qaPage === 1;
  var pinnedItems = [];
  var listItems = data.items;
  if (showPinned) {
    pinnedItems = data.items.filter(function(q) { return q.is_pinned; });
    listItems = data.items.filter(function(q) { return !q.is_pinned; });
  }
  if (pinnedItems.length) {
    html += '<div class="qa-pinned-section">' +
      '<div class="qa-pinned-head">' +
        '<span class="qa-pinned-title">' + _QA_IC_PIN + ' 精选</span>' +
        '<span class="qa-pinned-sub">置顶推荐 · 管理员精选</span>' +
      '</div>' +
      '<div class="qa-pinned-list">';
    pinnedItems.forEach(function(q) { html += _qaPinCardHtml(q); });
    html += '</div></div>';
  }
  // 列表
  if (!listItems.length) {
    html += '<div class="qa-empty">' +
      '<div class="qa-empty-icon">🔍</div>' +
      '<div class="qa-empty-title">' + (pinnedItems.length ? '暂无其他问答' : '暂无相关问答') + '</div>' +
      '<div class="qa-empty-desc">换个筛选条件或关键词试试</div>' +
    '</div>';
  } else {
    html += '<div class="qa-list">';
    listItems.forEach(function(q) {
      html += _qaCardHtml(q);
    });
    html += '</div>';
    // 分页
    html += _qaPaginationHtml();
  }
  return html;
}

function _qaFilterBarHtml() {
  var l1 = (_qaTags && _qaTags.l1) || [];
  var l2 = (_qaTags && _qaTags.l2) || [];
  // 外层 qa-toolbar 是 grid 容器（动画高度），内层 qa-toolbar-inner 承载卡片样式（v178）
  var html = '<div class="qa-toolbar' + (_qaFilterOpen ? '' : ' qa-toolbar-collapsed') + '"><div class="qa-toolbar-inner">';

  // 一级标签（accent 系徽章，暖色层级更高）
  var l1Html = '<button class="qa-pill qa-pill-l1' + (!_qaTagL1 ? ' on' : '') + '" onclick="qaFilterL1(\'\')">全部</button>';
  l1.forEach(function(t) {
    l1Html += '<button class="qa-pill qa-pill-l1' + (_qaTagL1 == t.id ? ' on' : '') + '" onclick="qaFilterL1(' + t.id + ')">' + esc(t.name) + '</button>';
  });
  html += '<div class="qa-filter-row">' +
    '<span class="qa-filter-label">一级</span>' +
    '<div class="qa-pills qa-pills-l1">' + l1Html + '</div>' +
  '</div>';

  // 二级标签（primary 系徽章）
  var l2Html = '<button class="qa-pill qa-pill-l2' + (!_qaTagL2 ? ' on' : '') + '" onclick="qaFilterL2(\'\')">全部</button>';
  l2.forEach(function(t) {
    l2Html += '<button class="qa-pill qa-pill-l2' + (_qaTagL2 == t.id ? ' on' : '') + '" onclick="qaFilterL2(' + t.id + ')">' + esc(t.name) + '</button>';
  });
  html += '<div class="qa-filter-row">' +
    '<span class="qa-filter-label">二级</span>' +
    '<div class="qa-pills qa-pills-l2">' + l2Html + '</div>' +
  '</div>';
  if (_qaTagL2 && _qaTags) {
    var sel = _qaTags.l2.find(function(t) { return t.id == _qaTagL2; });
    if (sel && sel.description) {
      html += '<div class="qa-tag-desc">' + esc(sel.name) + '（' + esc(sel.description) + '）</div>';
    }
  }

  // 排序
  html += '<div class="qa-sort-row">' +
    '<button class="qa-pill qa-sort' + (_qaSort === 'default' ? ' on' : '') + '" onclick="qaSort(\'default\')">默认</button>' +
    '<button class="qa-pill qa-sort' + (_qaSort === 'latest' ? ' on' : '') + '" onclick="qaSort(\'latest\')">最新</button>' +
  '</div>';

  html += '</div></div>';
  return html;
}

// 两级标签徽章（L1 accent 系 / L2 primary 系，v175 后 v177 互换）
function _qaBadgesHtml(q) {
  var h = '';
  if (q.tag_l1) h += '<span class="qa-badge qa-badge-l1">' + esc(q.tag_l1) + '</span>';
  if (q.tag_l2) h += '<span class="qa-badge qa-badge-l2">' + esc(q.tag_l2) + '</span>';
  return h;
}

// 紧凑统计（去竖线，v175）
function _qaStatHtml(q) {
  return '<span class="qa-stat">' + _QA_IC_EYE + '<b>' + q.view_count + '</b></span>' +
    '<span class="qa-stat">' + window.ICONS.star + '<b>' + q.favorite_count + '</b></span>' +
    '<span class="qa-stat">' + _QA_IC_ANSWER + '<b>' + q.answer_count + '</b></span>';
}

function _qaCardHtml(q) {
  var badges = _qaBadgesHtml(q);
  var pinHtml = q.is_pinned ? '<span class="qa-pin-badge">' + _QA_IC_PIN + ' 置顶</span>' : '';
  return '<div class="qa-card' + (q.is_pinned ? ' qa-card--pinned' : '') + '" onclick="qaOpenDetail(' + q.id + ')">' +
    '<div class="qa-card-head">' +
      (badges ? '<span class="qa-card-tags">' + badges + '</span>' : '') +
      (pinHtml ? pinHtml : '') +
      '<span class="qa-card-date">' + esc(q.created_at) + '</span>' +
    '</div>' +
    '<div class="qa-card-title">' + esc(q.title) + '</div>' +
    (q.content_preview ? '<div class="qa-card-preview">' + esc(q.content_preview) + '</div>' : '') +
    '<div class="qa-card-foot">' +
      '<span class="qa-card-author">' + esc(q.author) + '</span>' +
      '<span class="qa-card-meta">' + _qaStatHtml(q) + '</span>' +
    '</div>' +
  '</div>';
}

// 置顶精选卡（v175：accent 左边条 + 浅底，与普通卡形成权重差）
function _qaPinCardHtml(q) {
  return '<div class="qa-pin-card" onclick="qaOpenDetail(' + q.id + ')">' +
    '<div class="qa-pin-main">' +
      '<div class="qa-pin-title">' + esc(q.title) + '</div>' +
      (q.content_preview ? '<div class="qa-pin-preview">' + esc(q.content_preview) + '</div>' : '') +
    '</div>' +
    '<div class="qa-pin-side">' +
      '<div class="qa-pin-badges">' + _qaBadgesHtml(q) + '</div>' +
      '<div class="qa-pin-meta">' +
        '<span class="qa-card-author">' + esc(q.author) + '</span>' +
        '<span class="qa-card-meta">' + _qaStatHtml(q) + '</span>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function _qaPaginationHtml() {
  if (_qaTotalPages <= 1) return '';
  var html = '<div class="file-pagination" style="justify-content:center">';
  var pages = getPageNumbers(_qaPage, _qaTotalPages);
  html += '<button class="fp-btn fp-prev' + (_qaPage <= 1 ? ' fp-disabled' : '') + '" onclick="qaGoPage(' + (_qaPage - 1) + ')">◀</button>';
  pages.forEach(function(n) {
    if (n === '…') { html += '<button class="fp-btn fp-ellipsis">⋯</button>'; }
    else { html += '<button class="fp-btn fp-num' + (n === _qaPage ? ' fp-active' : '') + '" onclick="qaGoPage(' + n + ')">' + n + '</button>'; }
  });
  html += '<button class="fp-btn fp-next' + (_qaPage >= _qaTotalPages ? ' fp-disabled' : '') + '" onclick="qaGoPage(' + (_qaPage + 1) + ')">▶</button>';
  html += '</div>';
  return html;
}

function qaFilterL1(id) {
  _qaTagL1 = id === '' ? '' : id;
  _qaTagL2 = ''; // 切一级时清空二级
  _qaPage = 1;
  renderQaList();
}

function qaFilterL2(id) {
  _qaTagL2 = id === '' ? '' : id;
  _qaPage = 1;
  renderQaList();
}

function qaSort(s) {
  _qaSort = s;
  _qaPage = 1;
  renderQaList();
}

function qaGoPage(p) {
  if (p < 1 || p > _qaTotalPages || p === _qaPage) return;
  _qaPage = p;
  renderQaList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── 筛选面板展开/收起（v177）──
function toggleQaFilter() {
  _qaFilterOpen = !_qaFilterOpen;
  var panel = document.querySelector('#qaContent .qa-toolbar');
  if (panel) panel.classList.toggle('qa-toolbar-collapsed', !_qaFilterOpen);
  _updateQaFilterButton();
}

function _updateQaFilterButton() {
  var b = document.getElementById('qaFilterBtn');
  if (!b) return;
  var hasFilter = !!_qaTagL1 || !!_qaTagL2 || _qaSort !== 'default';
  b.classList.toggle('open', _qaFilterOpen);
  b.classList.toggle('active', hasFilter);
}

// ── 详情 ──
function qaOpenDetail(id) {
  if (typeof pushViewState === 'function') pushViewState('qa', { qaId: id });
  renderQaDetail(id);
  window.scrollTo({ top: 0 });
}

async function renderQaDetail(id) {
  var container = document.getElementById('qaContent');
  if (!container) return;
  container.innerHTML = '<div class="empty-state compact" style="padding:40px">加载中...</div>';
  try {
    var data = await api('/api/qa/questions/' + id + '/');
    if (data.deleted) {
      container.innerHTML =
        '<div class="qa-detail">' +
          '<div class="qa-q-card">' +
            '<div class="qa-deleted-hint">' + esc(data.deleted_hint) + '</div>' +
            '<div class="qa-card-title">' + esc(data.title) + '</div>' +
            '<div class="qa-card-foot"><span class="qa-card-author">' + esc(data.author) + '</span>' +
            '<span class="qa-card-date">' + esc(data.created_at) + '</span></div>' +
          '</div>' +
          '<div class="qa-back-row"><button class="qa-back-btn" onclick="renderQaView()">← 返回列表</button></div>' +
        '</div>';
      return;
    }
    // 浏览量 +1（去重由后端处理）
    api('/api/qa/questions/' + id + '/view/', { method: 'POST' }).catch(function() {});
    container.innerHTML = _qaDetailHtml(data);
  } catch (err) {
    container.innerHTML = '<div class="empty-state compact" style="padding:40px">加载失败，请重试。</div>';
  }
}

function _qaDetailHtml(d) {
  var html = '<div class="qa-detail">';

  // 问题卡
  var favState = d.is_favorited ? 'on' : '';
  var favIcon = window.ICONS[d.is_favorited ? 'starFilled' : 'star'];
  var badges = _qaBadgesHtml({ tag_l1: d.tag_l1, tag_l2: d.tag_l2 });
  var stats = '<span class="qa-stat">' + _QA_IC_EYE + '<b>' + d.view_count + '</b></span>' +
    '<span class="qa-stat">' + _QA_IC_ANSWER + '<b>' + d.answers.length + '</b></span>';
  html += '<div class="qa-q-card">' +
    (d.is_pinned ? '<span class="qa-pin-badge">' + _QA_IC_PIN + ' 置顶</span>' : '') +
    '<h3 class="qa-q-title">' + esc(d.title) + '</h3>' +
    (badges ? '<div class="qa-q-tags">' + badges + '</div>' : '') +
    '<div class="qa-rich">' + d.content + '</div>' +
    '<div class="qa-q-meta">' + stats + '</div>' +
    '<div class="qa-q-foot">' +
      '<span class="qa-card-author">' + esc(d.author) + ' · ' + esc(d.created_at) + '</span>' +
      '<button class="qa-fav-btn ' + favState + '" onclick="qaToggleQuestionFav(' + d.id + ', this)">' + favIcon + '<span>' + (d.is_favorited ? '已收藏' : '收藏') + '</span><b class="qa-count">' + d.favorite_count + '</b></button>' +
    '</div>' +
  '</div>';

  // 发布回答入口（仅问答区版主/超管，v175）
  var canManage = !!(currentUser && (currentUser.role === 'super_admin' || currentUser.can_moderate_qa));
  if (canManage) {
    html += '<div class="qa-answer-publish">' +
      '<span class="qa-answer-publish-hint">你是问答区版主</span>' +
      '<button class="qa-gate-btn qa-answer-publish-btn" onclick="showQaCompose({ type: \'answer\', action: \'create\', qid: ' + d.id + ' })">发布回答</button>' +
    '</div>';
  }

  // 回答列表
  if (d.answers.length) {
    html += '<div class="qa-answers">';
    d.answers.forEach(function(a, idx) {
      var expanded = d.answers.length === 1 ? ' expanded' : '';
      html += _qaAnswerHtml(a, idx, expanded, d.answers.length);
    });
    html += '</div>';
  } else {
    html += '<div class="qa-empty" style="border:1px dashed var(--border)">' +
      '<div class="qa-empty-title">还没有回答</div>' +
      '<div class="qa-empty-desc">管理员正在准备解答，敬请期待</div>' +
    '</div>';
  }

  html += '<div class="qa-back-row"><button class="qa-back-btn" onclick="qaBackToList()">← 返回列表</button></div>';
  html += '</div>';
  return html;
}

function _qaAnswerHtml(a, idx, expanded, total) {
  var likeState = a.liked ? 'on' : '';
  var likeIcon = a.liked ? _QA_IC_THUMB_FILLED : _QA_IC_THUMB;
  var favState = a.is_favorited ? 'on' : '';
  var favIcon = window.ICONS[a.is_favorited ? 'starFilled' : 'star'];
  var pin = a.is_pinned ? '<span class="qa-pin-badge qa-pin-badge-sm">' + _QA_IC_PIN + ' 置顶</span>' : '';
  var collapseBtn = total > 1
    ? '<button class="qa-answer-toggle" onclick="qaToggleAnswer(this)">' + (expanded ? '收起' : '展开') + '</button>'
    : '';
  return '<div class="qa-answer' + expanded + '" data-qa-answer>' +
    '<div class="qa-answer-head">' + pin + '<span class="qa-answer-author">' + esc(a.author) + '</span>' +
      '<span class="qa-answer-date">' + esc(a.created_at) + '</span>' + collapseBtn + '</div>' +
    '<div class="qa-answer-body"><div class="qa-rich">' + a.content + '</div></div>' +
    '<div class="qa-answer-actions">' +
      '<button class="qa-like-btn ' + likeState + '" onclick="qaToggleAnswerLike(' + a.id + ', this)">' + likeIcon + '<span>赞</span><b class="qa-count">' + a.like_count + '</b></button>' +
      '<button class="qa-fav-btn ' + favState + '" onclick="qaToggleAnswerFav(' + a.id + ', this)">' + favIcon + '<span>收藏</span><b class="qa-count">' + a.favorite_count + '</b></button>' +
    '</div>' +
  '</div>';
}

function qaToggleAnswer(btn) {
  var card = btn.closest('.qa-answer');
  if (!card) return;
  var expanded = card.classList.toggle('expanded');
  btn.textContent = expanded ? '收起' : '展开';
}

function qaBackToList() {
  renderQaView();
  window.scrollTo({ top: 0 });
}

// ── 收藏 / 点赞 ──
async function qaToggleQuestionFav(id, btn) {
  if (!currentUser) { showLoginModal(); return; }
  try {
    var r = await api('/api/qa/questions/' + id + '/favorite/', { method: 'POST' });
    var on = !!r.favorited;
    btn.classList.toggle('on', on);
    btn.innerHTML = window.ICONS[on ? 'starFilled' : 'star'] +
      '<span>' + (on ? '已收藏' : '收藏') + '</span><b class="qa-count">' + r.favorite_count + '</b>';
    clearApiCache('/api/qa/');
  } catch (err) {
    alert('操作失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
  }
}

async function qaToggleAnswerFav(id, btn) {
  if (!currentUser) { showLoginModal(); return; }
  try {
    var r = await api('/api/qa/answers/' + id + '/favorite/', { method: 'POST' });
    var on = !!r.favorited;
    btn.classList.toggle('on', on);
    btn.innerHTML = window.ICONS[on ? 'starFilled' : 'star'] +
      '<span>收藏</span><b class="qa-count">' + r.favorite_count + '</b>';
    clearApiCache('/api/qa/');
  } catch (err) {
    alert('操作失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
  }
}

async function qaToggleAnswerLike(id, btn) {
  if (!currentUser) { showLoginModal(); return; }
  try {
    var r = await api('/api/qa/answers/' + id + '/like/', { method: 'POST' });
    var on = !!r.liked;
    btn.classList.toggle('on', on);
    btn.innerHTML = (on ? _QA_IC_THUMB_FILLED : _QA_IC_THUMB) +
      '<span>赞</span><b class="qa-count">' + r.like_count + '</b>';
  } catch (err) {
    alert('操作失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
  }
}

// ── 问答区搜索浮层（顶栏搜索框在问答区视图内切换至此）──
async function qaSearch(q) {
  try {
    var data = await api('/api/qa/questions/?keyword=' + encodeURIComponent(q) + '&pageSize=20');
    var overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    var html = '<div class="search-overlay-inner sg-inner">';
    html += '<div class="sg-header">';
    html += '<button class="sg-close" onclick="this.closest(\'.search-overlay\').remove()" aria-label="关闭">✕</button>';
    html += '<div class="sg-title-row"><span class="sg-title-icon">🔍</span><h3 class="sg-title">' + esc(q) + '</h3></div>';
    html += '<p class="sg-subtitle">问答区搜索结果</p>';
    html += '</div>';
    html += '<div class="sg-body">';
    if (data.items.length) {
      html += '<div class="sg-section"><div class="sg-section-header">' +
        '<span class="sg-section-label">问答</span><span class="sg-section-badge">' + data.total + '</span></div>';
      html += '<div class="sg-section-body">';
      data.items.forEach(function(it) {
        html += '<div class="sg-item" onclick="this.closest(\'.search-overlay\').remove();qaOpenDetail(' + it.id + ')">' +
          '<div class="sg-item-body">' +
            '<span class="sg-item-name">' + esc(it.title) + '</span>' +
            '<span class="sg-item-meta"><span class="sg-item-code">' + esc(it.tag_l2 || it.tag_l1) + ' · ' + esc(it.author) + '</span></span>' +
          '</div>' +
          '<span class="sg-item-arrow">→</span>' +
        '</div>';
      });
      html += '</div></div>';
    } else {
      html += '<div class="sg-empty"><div class="sg-empty-icon">🔍</div>' +
        '<div class="sg-empty-title">未找到相关问答</div>' +
        '<div class="sg-empty-desc">试试其他关键词</div></div>';
    }
    html += '</div></div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    lockScroll();
  } catch (err) {
    alert('搜索失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
  }
}

// ── 「我要提问」按钮 ──
function qaAskClick() {
  var canAsk = currentUser && (currentUser.role === 'super_admin' || currentUser.can_moderate_qa);
  if (canAsk) {
    // 问答区版主 / 超管 → 独立发布视图（v175 qa-compose.js）
    if (typeof showQaCompose === 'function') {
      showQaCompose({ type: 'question', action: 'create' });
    } else {
      alert('发布功能加载中，请稍后再试');
    }
    return;
  }
  // 无权限：埋点 + 提示
  api('/api/qa/ask-click/', { method: 'POST' }).catch(function() {});
  alert('提问功能即将开放，敬请期待！');
}

// 模块加载即初始化 placeholder 观察器（defer 保证 DOM 已就绪）
_initQaPlaceholder();
