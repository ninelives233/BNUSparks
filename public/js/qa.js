// ═══════════════════════════════════════════════════════════════
// 问答区（新生指南）· 浏览端
// 列表 / 筛选 / 搜索 / 详情 / 收藏 / 点赞 / 登录提示 / 「我要提问」埋点
// 依赖：utils.js（api / esc / escJs / lockScroll / ICONS）
// ═══════════════════════════════════════════════════════════════

var _QA_SEARCH_PLACEHOLDER = '搜索问题、回答…';
var _DEFAULT_SEARCH_PLACEHOLDER = '搜索课程、资料、课程代码…';

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
var _QA_IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

// v183：普通用户提问/回答开放开关（renderQaView 从 /api/qa/config/ 拉取）
window._qaUserOpen = false;
// 未登录进入问答区时，登录成功后恢复问答列表
window._qaLoginPending = false;
// 当前详情问题 id（采纳/删除后重渲用）
var _qaCurrentDetailId = null;

// v183：问答区举报理由（10 项，用户确认；other 必填详细说明）
var _QA_REPORT_ITEMS = [
  ['harassment', '人身攻击/辱骂'],
  ['hate', '歧视/仇恨言论'],
  ['privacy', '隐私泄露'],
  ['politics', '内容违规'],
  ['error', '内容错误/误导'],
  ['irrelevant', '答非所问/离题'],
  ['plagiarism', '抄袭/搬运'],
  ['ads', '广告/营销'],
  ['suspicious', '钓鱼/可疑链接'],
  ['other', '其他原因（必填说明）'],
];

function _qaIsManager() {
  return !!(currentUser && (currentUser.role === 'super_admin' || currentUser.can_moderate_qa));
}

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
  if (!currentUser) {
    window._qaLoginPending = true;
    showLoginModal();
    return;
  }
  window._qaLoginPending = false;
  // v183：拉站点开关（普通用户提问/回答开放状态），失败默认关闭
  api('/api/qa/config/').then(function(cfg) {
    window._qaUserOpen = !!(cfg && cfg.user_open);
  }).catch(function() {
    window._qaUserOpen = false;
  });
  renderQaList();
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
    // v183 筛选修复：工具栏是 #qaContent 之外的常驻容器，列表刷新不重建它
    _ensureQaToolbar();
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

// v183：常驻筛选工具栏（幂等渲染，展开/收起状态在列表刷新间保持）
function _ensureQaToolbar() {
  var holder = document.getElementById('qaToolbar');
  if (!holder) return;
  if (holder.childElementCount === 0) {
    holder.innerHTML = _qaFilterBarHtml();
  }
}

function _qaListHtml(data) {
  var html = '';
  // 筛选工具栏在 #qaToolbar 常驻容器内渲染，不再随列表重建（v183 修复筛选整页刷新）
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

  // 排序（v183 加「最热」）
  html += '<div class="qa-sort-row">' +
    '<button class="qa-pill qa-sort' + (_qaSort === 'default' ? ' on' : '') + '" onclick="qaSort(\'default\')">默认</button>' +
    '<button class="qa-pill qa-sort' + (_qaSort === 'latest' ? ' on' : '') + '" onclick="qaSort(\'latest\')">最新</button>' +
    '<button class="qa-pill qa-sort' + (_qaSort === 'heat' ? ' on' : '') + '" onclick="qaSort(\'heat\')">最热</button>' +
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
  var solved = q.has_accepted ? '<span class="qa-accepted-badge qa-accepted-badge--sm" title="已有最佳回答">' + _QA_IC_CHECK + '</span>' : '';
  return '<div class="qa-card' + (q.is_pinned ? ' qa-card--pinned' : '') + '" onclick="qaOpenDetail(' + q.id + ')">' +
    '<div class="qa-card-head">' +
      (badges ? '<span class="qa-card-tags">' + badges + '</span>' : '') +
      (pinHtml ? pinHtml : '') +
      '<span class="qa-card-date">' + esc(q.created_at) + '</span>' +
    '</div>' +
    '<div class="qa-card-title">' + solved + esc(q.title) + '</div>' +
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
      '<div class="qa-pin-title">' + (q.has_accepted ? '<span class="qa-accepted-badge qa-accepted-badge--sm" title="已有最佳回答">' + _QA_IC_CHECK + '</span>' : '') + esc(q.title) + '</div>' +
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
  // v183：工具栏在常驻 #qaToolbar 内，选择器同步
  var panel = document.querySelector('#qaToolbar .qa-toolbar');
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
  _qaCurrentDetailId = id;
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
  var isManager = _qaIsManager();
  var isOwner = !!(currentUser && currentUser.id === d.owner_id);

  // v183 状态 banner（作者视角：待审核/已驳回）
  if (d.status === 'pending') {
    html += '<div class="qa-status-banner qa-status-banner--pending">⏳ 内容审核中，通过后将公开展示</div>';
  } else if (d.status === 'rejected') {
    html += '<div class="qa-status-banner qa-status-banner--rejected">已驳回，编辑后可重新提交审核</div>';
  }

  // 问题卡
  var favState = d.is_favorited ? 'on' : '';
  var favIcon = window.ICONS[d.is_favorited ? 'starFilled' : 'star'];
  var badges = _qaBadgesHtml({ tag_l1: d.tag_l1, tag_l2: d.tag_l2 });
  var solvedBadge = d.has_accepted ? '<span class="qa-accepted-badge" title="已有最佳回答">' + _QA_IC_CHECK + ' 已解决</span>' : '';
  var stats = '<span class="qa-stat">' + _QA_IC_EYE + '<b>' + d.view_count + '</b></span>' +
    '<span class="qa-stat">' + _QA_IC_ANSWER + '<b>' + d.answers.length + '</b></span>';
  html += '<div class="qa-q-card">' +
    (d.is_pinned ? '<span class="qa-pin-badge">' + _QA_IC_PIN + ' 置顶</span>' : '') +
    solvedBadge +
    '<h3 class="qa-q-title">' + esc(d.title) + '</h3>' +
    (badges ? '<div class="qa-q-tags">' + badges + '</div>' : '') +
    '<div class="qa-rich">' + qaSafeHtml(d.content) + '</div>' +
    '<div class="qa-q-meta">' + stats + '</div>' +
    '<div class="qa-q-foot">' +
      '<span class="qa-card-author">' + esc(d.author) + ' · ' + esc(d.created_at) + '</span>' +
      '<button class="qa-fav-btn ' + favState + '" onclick="qaToggleQuestionFav(' + d.id + ', this)">' + favIcon + '<span>' + (d.is_favorited ? '已收藏' : '收藏') + '</span><b class="qa-count">' + d.favorite_count + '</b></button>' +
      '<button class="qa-report-btn" onclick="openQaReportModal(\'question\', ' + d.id + ')">举报</button>' +
    '</div>' +
    // v183 作者操作栏（编辑/编辑历史/删除）
    (isOwner ? '<div class="qa-owner-actions">' +
      '<button class="qa-owner-btn" onclick="showQaCompose({ type: \'question\', action: \'edit\', qid: ' + d.id + ' })">编辑</button>' +
      '<button class="qa-owner-btn" onclick="showQaEditHistory(\'question\', ' + d.id + ')">编辑历史</button>' +
      '<button class="qa-owner-btn qa-owner-btn--danger" onclick="qaAskDelete(\'question\', ' + d.id + ')">删除</button>' +
    '</div>' : '') +
  '</div>';

  // 发布回答入口（问答区版主/超管 或 站点开放时普通用户，v183）
  if (isManager || d.qa_user_open) {
    html += '<div class="qa-answer-publish">' +
      '<span class="qa-answer-publish-hint">' + (isManager ? '你是问答区版主' : '分享你的回答') + '</span>' +
      '<button class="qa-gate-btn qa-answer-publish-btn" onclick="showQaCompose({ type: \'answer\', action: \'create\', qid: ' + d.id + ' })">发布回答</button>' +
    '</div>';
  }

  // 回答列表
  if (d.answers.length) {
    html += '<div class="qa-answers">';
    d.answers.forEach(function(a, idx) {
      var expanded = d.answers.length === 1 ? ' expanded' : '';
      html += _qaAnswerHtml(a, idx, expanded, d.answers.length, d);
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

function _qaAnswerHtml(a, idx, expanded, total, d) {
  var likeState = a.liked ? 'on' : '';
  var likeIcon = a.liked ? _QA_IC_THUMB_FILLED : _QA_IC_THUMB;
  var favState = a.is_favorited ? 'on' : '';
  var favIcon = window.ICONS[a.is_favorited ? 'starFilled' : 'star'];
  var pin = a.is_pinned ? '<span class="qa-pin-badge qa-pin-badge-sm">' + _QA_IC_PIN + ' 置顶</span>' : '';
  var collapseBtn = total > 1
    ? '<button class="qa-answer-toggle" onclick="qaToggleAnswer(this)">' + (expanded ? '收起' : '展开') + '</button>'
    : '';

  // v183 采纳徽章 + 采纳按钮
  var acceptedBadge = a.is_accepted
    ? '<span class="qa-accepted-badge qa-accepted-badge--answer" title="最佳回答">' + _QA_IC_CHECK + ' 最佳回答</span>'
    : '';
  var canAccept = d && (_qaIsManager() || (currentUser && currentUser.id === d.owner_id && d.qa_user_open));
  var acceptBtn = canAccept
    ? '<button class="qa-accept-btn' + (a.is_accepted ? ' on' : '') + '" onclick="qaAcceptAnswer(' + a.id + ', this)">' +
      (a.is_accepted ? '取消采纳' : '采纳为最佳回答') + '</button>'
    : '';

  // v183 作者操作栏（编辑/编辑历史/删除）
  var isAnswerOwner = !!(currentUser && currentUser.id === a.author_id);
  var ownerActions = isAnswerOwner ? '<div class="qa-owner-actions qa-owner-actions--answer">' +
    '<button class="qa-owner-btn" onclick="showQaCompose({ type: \'answer\', action: \'edit\', qid: ' + (d ? d.id : '') + ', aid: ' + a.id + ' })">编辑</button>' +
    '<button class="qa-owner-btn" onclick="showQaEditHistory(\'answer\', ' + a.id + ')">编辑历史</button>' +
    '<button class="qa-owner-btn qa-owner-btn--danger" onclick="qaAskDelete(\'answer\', ' + a.id + ')">删除</button>' +
  '</div>' : '';

  return '<div class="qa-answer' + expanded + '" data-qa-answer>' +
    '<div class="qa-answer-head">' + pin + acceptedBadge + '<span class="qa-answer-author">' + esc(a.author) + '</span>' +
      '<span class="qa-answer-date">' + esc(a.created_at) + '</span>' + collapseBtn + '</div>' +
    '<div class="qa-answer-body"><div class="qa-rich">' + qaSafeHtml(a.content) + '</div></div>' +
    '<div class="qa-answer-actions">' +
      '<button class="qa-like-btn ' + likeState + '" onclick="qaToggleAnswerLike(' + a.id + ', this)">' + likeIcon + '<span>赞</span><b class="qa-count">' + a.like_count + '</b></button>' +
      '<button class="qa-fav-btn ' + favState + '" onclick="qaToggleAnswerFav(' + a.id + ', this)">' + favIcon + '<span>收藏</span><b class="qa-count">' + a.favorite_count + '</b></button>' +
      acceptBtn +
      '<button class="qa-report-btn" onclick="openQaReportModal(\'answer\', ' + a.id + ')">举报</button>' +
    '</div>' +
    ownerActions +
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
  if (!currentUser) { showLoginModal(); return; }
  var canAsk = currentUser && (currentUser.role === 'super_admin' || currentUser.can_moderate_qa);
  if (canAsk || window._qaUserOpen) {
    // 问答区版主 / 超管 → 管理端独立发布视图；普通用户（站点开放）→ 用户提交视图
    if (typeof showQaCompose === 'function') {
      showQaCompose({ type: 'question', action: 'create' });
    } else {
      alert('发布功能加载中，请稍后再试');
    }
    return;
  }
  // 未开放：埋点 + 提示
  api('/api/qa/ask-click/', { method: 'POST' }).catch(function() {});
  alert('提问功能即将开放，敬请期待！');
}

// ═══════════════════════════════════════════════════════════════
// v183 · 问答区举报（复用文件举报系统：Report 双 kind + 参数化弹窗）
// 弹窗本体复用 report-overlay/report-dialog/report-option/rd-* 全套 CSS
// 与 explorer-file.js 的全局交互函数（toggleReportOption/closeReportModal/
// _getSelectedReport/_updateReportState/_showReportError）
// ═══════════════════════════════════════════════════════════════

function openQaReportModal(kind, id) {
  if (!currentUser) { showLoginModal(); return; }
  var seg = kind === 'answer' ? 'answers' : 'questions';
  // 先查状态：已举报/超限 → 仅提示，不进入举报界面
  api('/api/qa/' + seg + '/' + id + '/report-status/').then(function(rs) {
    if (rs.reported) { alert('你已举报过该内容'); return; }
    if (rs.can_report === false) { alert('今日举报次数过多'); return; }
    _renderQaReportModal(kind, id);
  }).catch(function() {
    _renderQaReportModal(kind, id);
  });
}

function _renderQaReportModal(kind, id) {
  var old = document.querySelector('.report-overlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.className = 'report-overlay';
  var itemsHtml = _QA_REPORT_ITEMS.map(function(it) {
    return '<div class="report-option" data-value="' + it[0] + '" onclick="toggleReportOption(this)">' +
      '<span class="ro-cb"></span>' +
      '<span class="ro-text"><span class="ro-label">' + it[1] + '</span></span>' +
    '</div>';
  }).join('');
  var kindLabel = kind === 'answer' ? '回答举报' : '问题举报';
  overlay.innerHTML =
    '<div class="report-dialog" role="dialog" aria-modal="true">' +
      '<div class="rd-head">' +
        '<div class="rd-title">' + kindLabel + '</div>' +
        '<div class="rd-sub">请选择至少一个举报原因（可多选），问答区管理员将在 1–3 个工作日内处理</div>' +
        '<button class="rd-close" onclick="closeReportModal(event)" aria-label="关闭">✕</button>' +
      '</div>' +
      '<div class="rd-body">' +
        '<div class="report-group"><div class="rg-head">举报原因</div><div class="rg-options">' + itemsHtml + '</div></div>' +
        '<div class="report-group rd-detail-group">' +
          '<div class="rg-head">详细说明（可选）</div>' +
          '<textarea id="rdDetail" placeholder="可以提供更详细的举报原因说明，以帮助管理员更好地判断"></textarea>' +
          '<div class="rd-hint" id="rdDetailHint">如果选择了「其他原因」，则必须填写详细说明。</div>' +
        '</div>' +
      '</div>' +
      '<div class="rd-error" id="rdError" style="display:none"></div>' +
      '<div class="rd-actions">' +
        '<button class="admin-btn admin-btn-primary" id="rdSubmitBtn" onclick="submitQaReport(\'' + kind + '\', ' + id + ')" disabled>提交举报</button>' +
        '<button class="admin-btn admin-btn-secondary" onclick="closeReportModal(event)">取消</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.onclick = function(e) { if (e.target === overlay) closeReportModal(null); };
  lockScroll();
  _pushModalHistory();
}

function submitQaReport(kind, id) {
  var sel = _getSelectedReport();
  if (!sel.length) { _showReportError('请至少选择一个举报原因'); return; }
  var detailEl = document.getElementById('rdDetail');
  var detail = detailEl ? detailEl.value.trim() : '';
  if (sel.indexOf('other') >= 0 && !detail) {
    _showReportError('选择「其他原因」时，必须填写详细说明');
    if (detailEl) detailEl.focus();
    return;
  }
  var btn = document.getElementById('rdSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
  var seg = kind === 'answer' ? 'answers' : 'questions';
  api('/api/qa/' + seg + '/' + id + '/report/', { method: 'POST', body: { reasons: sel, detail: detail } })
    .then(function() {
      closeReportModal(null);
      alert('举报已提交，管理员将在 1–3 个工作日内处理');
    })
    .catch(function(err) {
      _showReportError((err && err.message) || '提交失败，请稍后重试');
      if (btn) { btn.disabled = false; btn.textContent = '提交举报'; }
    });
}

// ═══════════════════════════════════════════════════════════════
// v183 · 最佳回答采纳
// ═══════════════════════════════════════════════════════════════

async function qaAcceptAnswer(id, btn) {
  if (!currentUser) { showLoginModal(); return; }
  if (btn) { btn.disabled = true; }
  try {
    var r = await api('/api/qa/answers/' + id + '/accept/', { method: 'POST' });
    alert(r && r.accepted ? '已采纳为最佳回答' : '已取消采纳');
    if (_qaCurrentDetailId) renderQaDetail(_qaCurrentDetailId);
  } catch (err) {
    alert('操作失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
    if (btn) { btn.disabled = false; }
  }
}

// ═══════════════════════════════════════════════════════════════
// v183 · 编辑历史（知乎式面板；history 端点作者/管理端可读）
// ═══════════════════════════════════════════════════════════════

function _qaStripHtml(html) {
  var d = document.createElement('div');
  d.innerHTML = html || '';
  return d.textContent || d.innerText || '';
}

async function showQaEditHistory(kind, id) {
  if (!currentUser) { showLoginModal(); return; }
  var seg = kind === 'answer' ? 'answers' : 'questions';
  try {
    var data = await api('/api/admin/qa/' + seg + '/' + id + '/history/');
    _renderQaHistoryModal(kind, data && data.items ? data.items : []);
  } catch (err) {
    alert('加载失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
  }
}

function _renderQaHistoryModal(kind, items) {
  var old = document.querySelector('.qa-history-overlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay qa-history-overlay';
  var bodyHtml = '';
  if (!items.length) {
    bodyHtml = '<div class="qa-history-empty">暂无编辑记录</div>';
  } else {
    bodyHtml = '<div class="qa-history-list">';
    items.forEach(function(h) {
      var diff = '';
      if (kind === 'answer') {
        var o = _qaStripHtml(h.old_content).slice(0, 80);
        var n = _qaStripHtml(h.new_content).slice(0, 80);
        diff = (o !== n)
          ? '<div class="qa-history-diff"><span class="qa-history-old">' + esc(o || '（空）') + '</span><span class="qa-history-arrow">→</span><span class="qa-history-new">' + esc(n || '（空）') + '</span></div>'
          : '<div class="qa-history-diff"><span class="qa-history-new">' + esc(n || '（空）') + '</span></div>';
      } else {
        var ot = h.old_title, nt = h.new_title;
        diff = (ot && ot !== nt)
          ? '<div class="qa-history-diff"><span class="qa-history-old">' + esc(ot) + '</span><span class="qa-history-arrow">→</span><span class="qa-history-new">' + esc(nt) + '</span></div>'
          : '<div class="qa-history-diff"><span class="qa-history-new">' + esc(nt || ot || '') + '</span></div>';
      }
      bodyHtml += '<div class="qa-history-item">' +
        '<div class="qa-history-meta"><span class="qa-history-editor">' + esc(h.editor) + '</span><span class="qa-history-time">' + esc(h.created_at) + '</span></div>' +
        diff +
      '</div>';
    });
    bodyHtml += '</div>';
  }
  overlay.innerHTML =
    '<div class="modal-card qa-history-card">' +
      '<button class="modal-close" onclick="closeQaHistory()">✕</button>' +
      '<h3 class="modal-title">编辑历史 · ' + (kind === 'answer' ? '回答' : '问题') + '</h3>' +
      '<div class="qa-history-body">' + bodyHtml + '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  lockScroll();
  _pushModalHistory();
}

function closeQaHistory() {
  var el = document.querySelector('.qa-history-overlay');
  if (el) { el.remove(); unlockScroll(); _popModalHistory(); }
}

// ═══════════════════════════════════════════════════════════════
// v183 · 删除（理由弹窗 → 自动软删 / 删除申请待批准）
// ═══════════════════════════════════════════════════════════════

function qaAskDelete(kind, id) {
  var old = document.querySelector('.qa-del-overlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay qa-del-overlay';
  var kindLabel = kind === 'answer' ? '回答' : '问题';
  var needHint = kind === 'answer'
    ? '若该回答已获赞或收藏，删除需管理员批准；简单情况将直接删除。'
    : '若该问题下已有回答，删除需管理员批准；简单情况将直接删除。';
  overlay.innerHTML =
    '<div class="modal-card qa-del-card">' +
      '<button class="modal-close" onclick="closeQaDelete()">✕</button>' +
      '<h3 class="modal-title">删除' + kindLabel + '</h3>' +
      '<p class="qa-del-hint">' + needHint + '</p>' +
      '<textarea id="qaDelReason" class="qa-del-reason" maxlength="500" placeholder="请填写删除理由（必填，≤500 字）"></textarea>' +
      '<div class="qa-del-error" id="qaDelError" style="display:none"></div>' +
      '<div class="qa-del-actions">' +
        '<button class="admin-btn admin-btn-primary" onclick="qaConfirmDelete(\'' + kind + '\', ' + id + ')">提交删除</button>' +
        '<button class="admin-btn admin-btn-secondary" onclick="closeQaDelete()">取消</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  lockScroll();
  _pushModalHistory();
  var inp = document.getElementById('qaDelReason');
  if (inp) inp.focus();
}

function closeQaDelete() {
  var el = document.querySelector('.qa-del-overlay');
  if (el) { el.remove(); unlockScroll(); _popModalHistory(); }
}

async function qaConfirmDelete(kind, id) {
  var reasonEl = document.getElementById('qaDelReason');
  var reason = reasonEl ? reasonEl.value.trim() : '';
  if (!reason) {
    var errEl = document.getElementById('qaDelError');
    if (errEl) { errEl.textContent = '请填写删除理由'; errEl.style.display = ''; }
    if (reasonEl) reasonEl.focus();
    return;
  }
  var seg = kind === 'answer' ? 'answers' : 'questions';
  var btn = document.querySelector('.qa-del-card .admin-btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
  try {
    var r = await api('/api/qa/' + seg + '/' + id + '/', { method: 'DELETE', body: { reason: reason } });
    closeQaDelete();
    alert(r && r.submitted ? '已提交删除申请，等待管理员审核' : '已删除');
    if (_qaCurrentDetailId) renderQaDetail(_qaCurrentDetailId);
  } catch (err) {
    var e = document.getElementById('qaDelError');
    if (e) { e.textContent = (err && (err.message || err.error)) || '删除失败，请稍后重试'; e.style.display = ''; }
    if (btn) { btn.disabled = false; btn.textContent = '提交删除'; }
  }
}

// 模块加载即初始化 placeholder 观察器（defer 保证 DOM 已就绪）
_initQaPlaceholder();
