// ═══════════════════════════════════════════════════════════════
// 问答区（新生指南）· 浏览端
// 列表 / 筛选 / 搜索 / 详情 / 收藏 / 点赞 / 登录提示 / 「我要提问」埋点
// 依赖：utils.js（api / esc / escJs / lockScroll / ICONS）、qa-editor.js（qaSafeHtml）
// 2026-10-02 视觉重构：常驻工具栏（总数 + 文字排序 + 筛选）、紧凑列表
// 共享容器、精选问答标题区、详情单张阅读底板，回答默认全部展开。
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
var _qaTotalCount = null;  // 接口返回的筛选后可靠总数（工具栏「全部问题 · N」）
var _qaTags = null;        // 两级标签缓存
var _qaPhInitialized = false;
var _qaFilterOpen = false;   // 筛选面板默认收起

// ── 图标（与全站 24×24 stroke 风格一致）──
var _QA_IC_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" aria-hidden="true"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z"/></svg>';
var _QA_IC_THUMB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.9L14 10h5a2 2 0 0 1 2 2.5l-1.7 7A2 2 0 0 1 17.3 21H8a1 1 0 0 1-1-1V11a1 1 0 0 1 .6-.9L12 8l1.2-4.3A2 2 0 0 1 15 5.9z"/></svg>';
var _QA_IC_THUMB_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M7 10v12H3a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h4zm2 12h8a2 2 0 0 0 1.9-1.4l1.7-7A2 2 0 0 0 18.6 10H14l1-4.3A2 2 0 0 0 12.9 3.2L12 8 8.9 10.6A1 1 0 0 0 9 12v10z"/></svg>';
var _QA_IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
var _QA_IC_FILTER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>';

// v183：普通用户提问/回答开放开关（renderQaView 从 /api/qa/config/ 拉取）
// S02：配置改为四态 loading/open/closed/error——冷加载表单时守卫等待配置结果，
// 不再以默认 false 把「还没加载」误报成「功能未开放」。
window._qaUserOpen = false;
window._qaConfigState = 'loading';
var _qaConfigPromise = null;

function _qaRefreshConfig() {
  if (_qaConfigPromise) return _qaConfigPromise;
  window._qaConfigState = 'loading';
  _qaConfigPromise = api('/api/qa/config/').then(function(cfg) {
    window._qaConfigState = cfg && cfg.user_open ? 'open' : 'closed';
    window._qaUserOpen = window._qaConfigState === 'open';
  }).catch(function() {
    window._qaConfigState = 'error';
    window._qaUserOpen = false;
  }).then(function() {
    _qaConfigPromise = null;
    return window._qaConfigState;
  });
  return _qaConfigPromise;
}

// 取得当前配置状态：loading 中等待结果，失败/关闭为终态（重进问答区时刷新）
function _qaEnsureConfig() {
  if (_qaConfigPromise) return _qaConfigPromise;
  if (window._qaConfigState !== 'loading') return Promise.resolve(window._qaConfigState);
  return _qaRefreshConfig();
}

// 未登录进入问答区时，登录成功后恢复问答列表
window._qaLoginPending = false;
// 用户主动关闭登录弹窗后，避免回退重绘问答区时立即再次打开
window._qaLoginPromptDismissed = false;
// 当前详情问题 id（采纳/删除后重渲用）
var _qaCurrentDetailId = null;
// S03：列表/详情请求序号——只有最新一次请求允许提交渲染结果
var _qaListSeq = 0;
var _qaDetailSeq = 0;
// F08：搜索请求序号 + 当前页码（浮层内分页）
var _qaSearchSeq = 0;
var _qaSearchQuery = '';
var _qaSearchPage = 1;

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

// reduced-motion 下关闭平滑滚动（规范 §12）
function _qaScrollBehavior() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch (e) { return 'auto'; }
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
async function renderQaView(restoreScrollY) {
  _initQaPlaceholder();
  if (!currentUser) {
    if (window._qaLoginPromptDismissed) {
      window._qaLoginPromptDismissed = false;
      return;
    }
    window._qaLoginPending = true;
    showLoginModal();
    return;
  }
  window._qaLoginPending = false;
  window._qaLoginPromptDismissed = false;
  // S02：异步刷新站点开关（四态）；表单入口由 _qaEnsureConfig 等待结果
  _qaRefreshConfig();
  if (restoreScrollY) {
    return renderQaList().then(function() {
      requestAnimationFrame(function() { window.scrollTo({ top: restoreScrollY }); });
    });
  }
  renderQaList();
}

// ── 列表状态与 URL（F02/F05：筛选条件、排序、页码同步进 /qa 查询参数）──
function _qaListState() {
  return {
    tagL1: _qaTagL1 || undefined,
    tagL2: _qaTagL2 || undefined,
    sort: _qaSort && _qaSort !== 'default' ? _qaSort : undefined,
    page: _qaPage > 1 ? _qaPage : undefined,
  };
}

// popstate / 刷新恢复：把历史状态中的列表条件写回模块状态
function _qaApplyListState(state) {
  if (!state) return;
  if (typeof state.tagL1 !== 'undefined') _qaTagL1 = state.tagL1 ? String(state.tagL1) : '';
  if (typeof state.tagL2 !== 'undefined') _qaTagL2 = state.tagL2 ? String(state.tagL2) : '';
  if (state.sort && ['default', 'latest', 'heat'].indexOf(state.sort) >= 0) _qaSort = state.sort;
  if (state.page && state.page >= 1) _qaPage = parseInt(state.page, 10) || 1;
}

function _qaPatchListUrl() {
  if (typeof patchViewState !== 'function') return;
  var st = history.state;
  if (st && st._modal) return;
  if (typeof _suppressingPushState !== 'undefined' && _suppressingPushState) return;
  patchViewState(_qaListState());
}

// ── 列表 ──
async function renderQaList() {
  var container = document.getElementById('qaContent');
  if (!container) return;
  var view = document.getElementById('qaView');
  if (view) view.classList.remove('qa-detail-mode');
  var seq = ++_qaListSeq; // S03：快速切换筛选时，过期响应不得覆盖最新结果
  container.innerHTML = '<div class="qa-loading">加载中…</div>';
  try {
    if (!_qaTags) {
      _qaTags = await api('/api/qa/tags/');
    }
    // 工具栏是 #qaContent 之外的常驻容器，列表刷新不重建它
    _ensureQaToolbar();
    var params = '?page=' + _qaPage + '&pageSize=' + _qaPageSize + '&sort=' + encodeURIComponent(_qaSort);
    if (_qaTagL1) params += '&tag_l1=' + _qaTagL1;
    if (_qaTagL2) params += '&tag_l2=' + _qaTagL2;
    var data = await api('/api/qa/questions/' + params);
    if (seq !== _qaListSeq) return;
    _qaTotalPages = data.total_pages || 1;
    _qaTotalCount = typeof data.total === 'number' ? data.total : null;
    container.innerHTML = _qaListHtml(data);
    _syncQaToolbarSelection();
    _updateQaFilterButton();
    _qaPatchListUrl();
  } catch (err) {
    if (seq !== _qaListSeq) return;
    container.innerHTML = '<div class="qa-empty">' +
      '<div class="qa-empty-title">加载失败</div>' +
      '<div class="qa-empty-desc">网络似乎不太顺畅</div>' +
      '<button type="button" class="qa-empty-action" onclick="renderQaList()">重试</button>' +
    '</div>';
  }
}

// 常驻筛选工具栏（幂等渲染，展开/收起状态在列表刷新间保持）
function _ensureQaToolbar() {
  var holder = document.getElementById('qaToolbar');
  if (!holder) return;
  if (holder.childElementCount === 0) {
    holder.innerHTML = _qaFilterBarHtml();
  }
}

function _qaListHtml(data) {
  var html = '';
  // 精选区：仅无筛选且第一页时展示（后端保证置顶优先且上限 5 条）
  var showPinned = !_qaTagL1 && !_qaTagL2 && _qaPage === 1;
  var pinnedItems = [];
  var listItems = data.items;
  if (showPinned) {
    pinnedItems = data.items.filter(function(q) { return q.is_pinned; });
    listItems = data.items.filter(function(q) { return !q.is_pinned; });
  }
  if (pinnedItems.length) {
    html += _qaPinnedHtml(pinnedItems);
  }
  if (!listItems.length) {
    var hasFilter = !!_qaTagL1 || !!_qaTagL2;
    html += '<div class="qa-empty">' +
      '<div class="qa-empty-title">' + (pinnedItems.length ? '暂无其他问答' : '暂无相关问答') + '</div>' +
      '<div class="qa-empty-desc">' + (hasFilter ? '当前筛选条件下没有内容' : '换个关键词试试') + '</div>' +
      (hasFilter ? '<button type="button" class="qa-empty-action" onclick="qaClearFilters()">清除筛选</button>' : '') +
    '</div>';
  } else {
    html += '<div class="qa-list">';
    listItems.forEach(function(q) {
      html += _qaItemHtml(q);
    });
    html += '</div>';
    html += _qaPaginationHtml();
  }
  return html;
}

// ── 工具栏（左：全部问题 · N；右：文字排序 + 筛选按钮）──
// 排序文案服从接口真实语义：latest = 按提问时间倒序 → 「最新提问」
function _qaFilterBarHtml() {
  var l1 = (_qaTags && _qaTags.l1) || [];
  var l2 = (_qaTags && _qaTags.l2) || [];
  var sorts = [['default', '默认排序'], ['latest', '最新提问'], ['heat', '热度']];
  var sortHtml = '';
  sorts.forEach(function(s) {
    var on = _qaSort === s[0];
    sortHtml += '<button type="button" class="qa-sort-btn" data-sort="' + s[0] + '"' +
      ' aria-pressed="' + (on ? 'true' : 'false') + '" onclick="qaSort(\'' + s[0] + '\')">' + s[1] + '</button>';
  });

  var html = '<div class="qa-toolbar-row">' +
    '<span class="qa-toolbar-title">全部问题<span class="qa-toolbar-total" id="qaToolbarTotal" hidden></span></span>' +
    '<div class="qa-toolbar-actions">' +
      '<div class="qa-sort-group" role="group" aria-label="排序方式">' + sortHtml + '</div>' +
      '<button type="button" class="qa-filter-btn" id="qaFilterBtn"' +
        ' aria-expanded="' + (_qaFilterOpen ? 'true' : 'false') + '" aria-controls="qaFilterPanel"' +
        ' onclick="toggleQaFilter()">' + _QA_IC_FILTER +
        '<span class="qa-filter-btn-label">筛选</span></button>' +
    '</div>' +
  '</div>';

  // 筛选展开区：工具栏下方、列表上方；关闭时不占高度、不进焦点顺序
  var l1Html = '<button type="button" class="qa-pill qa-pill-l1' + (!_qaTagL1 ? ' on' : '') + '" data-id="" aria-pressed="' + (!_qaTagL1 ? 'true' : 'false') + '" onclick="qaFilterL1(\'\')">全部</button>';
  l1.forEach(function(t) {
    var on = String(_qaTagL1) === String(t.id);
    l1Html += '<button type="button" class="qa-pill qa-pill-l1' + (on ? ' on' : '') + '" data-id="' + t.id + '" aria-pressed="' + (on ? 'true' : 'false') + '" onclick="qaFilterL1(' + t.id + ')">' + esc(t.name) + '</button>';
  });
  var l2Html = '<button type="button" class="qa-pill qa-pill-l2' + (!_qaTagL2 ? ' on' : '') + '" data-id="" aria-pressed="' + (!_qaTagL2 ? 'true' : 'false') + '" onclick="qaFilterL2(\'\')">全部</button>';
  l2.forEach(function(t) {
    var on = String(_qaTagL2) === String(t.id);
    l2Html += '<button type="button" class="qa-pill qa-pill-l2' + (on ? ' on' : '') + '" data-id="' + t.id + '" aria-pressed="' + (on ? 'true' : 'false') + '" onclick="qaFilterL2(' + t.id + ')">' + esc(t.name) + '</button>';
  });
  html += '<div class="qa-filter-panel' + (_qaFilterOpen ? '' : ' qa-filter-collapsed') + '" id="qaFilterPanel">' +
    '<div class="qa-filter-panel-inner">' +
      '<div class="qa-filter-row"><span class="qa-filter-label">分类</span><div class="qa-pills qa-pills-l1">' + l1Html + '</div></div>' +
      '<div class="qa-filter-row"><span class="qa-filter-label">话题</span><div class="qa-pills qa-pills-l2">' + l2Html + '</div></div>' +
    '</div>' +
  '</div>';
  return html;
}

// F02：筛选/排序变更后就地同步选中态（视觉 + aria-pressed），不重建工具栏、不丢焦点
function _syncQaToolbarSelection() {
  var holder = document.getElementById('qaToolbar');
  if (!holder) return;
  holder.querySelectorAll('.qa-pill-l1').forEach(function(b) {
    var on = String(b.getAttribute('data-id') || '') === String(_qaTagL1 || '');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  holder.querySelectorAll('.qa-pill-l2').forEach(function(b) {
    var on = String(b.getAttribute('data-id') || '') === String(_qaTagL2 || '');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  holder.querySelectorAll('.qa-sort-btn').forEach(function(b) {
    var on = b.getAttribute('data-sort') === _qaSort;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  _updateQaToolbarTotal();
}

function _updateQaToolbarTotal() {
  var el = document.getElementById('qaToolbarTotal');
  if (!el) return;
  if (typeof _qaTotalCount === 'number') {
    el.hidden = false;
    el.textContent = ' · ' + _qaTotalCount;
  } else {
    el.hidden = true;
  }
}

// ── 中性标签 ──
function _qaTagsHtml(q) {
  var h = '';
  if (q.tag_l1) h += '<span class="qa-tag">' + esc(q.tag_l1) + '</span>';
  if (q.tag_l2) h += '<span class="qa-tag">' + esc(q.tag_l2) + '</span>';
  return h;
}

// 日期到日：跨年保留年份；完整时间通过 title 提供
function _qaFormatDay(s) {
  var str = String(s || '');
  var m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return str;
  try {
    if (String(new Date().getFullYear()) === m[1]) return m[2] + '-' + m[3];
  } catch (e) { /* 保持完整格式 */ }
  return m[1] + '-' + m[2] + '-' + m[3];
}

// 统计内联片段：回答数（零回答次要色，有回答主色）+ 已采纳状态
function _qaItemStatsInner(q) {
  var n = q.answer_count || 0;
  var cls = q.has_accepted ? ' has-accepted' : (n > 0 ? ' has-answers' : '');
  var accepted = q.has_accepted
    ? '<span class="qa-item-accepted">' + _QA_IC_CHECK + ' 已采纳</span>' : '';
  return '<span class="qa-item-count' + cls + '"><b>' + n + '</b><i>回答</i></span>' + accepted;
}

// F09：问题标题使用真实链接（可键盘聚焦、可新标签打开）；普通左键仍走 SPA 导航，
// 修饰键点击（新标签）交给浏览器原生行为。
function _qaQuestionUrl(id) {
  return '/qa/questions/' + parseInt(id, 10);
}

function _qaCardTitleLink(q, cls) {
  return '<a class="' + (cls || 'qa-item-title') + '" href="' + _qaQuestionUrl(q.id) + '"' +
    ' onclick="if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;' +
    ' event.preventDefault(); event.stopPropagation(); qaOpenDetail(' + q.id + ')">' + esc(q.title) + '</a>';
}

// 列表条目：桌面两列（72px 统计列 + 内容列），手机单列（状态并入辅助行）
function _qaItemHtml(q) {
  var preview = q.content_preview
    ? '<div class="qa-item-preview">' + esc(q.content_preview) + '</div>' : '';
  var tags = _qaTagsHtml(q);
  return '<div class="qa-item">' +
    '<div class="qa-item-stats">' + _qaItemStatsInner(q) + '</div>' +
    '<div class="qa-item-main">' +
      _qaCardTitleLink(q) +
      preview +
      '<div class="qa-item-meta">' +
        '<span class="qa-item-tags">' + tags + '</span>' +
        '<span class="qa-item-stats qa-item-stats--inline">' + _qaItemStatsInner(q) + '</span>' +
        '<span class="qa-item-byline">' +
          '<span class="qa-item-author">' + esc(q.author) + '</span>' +
          '<span class="qa-item-date" title="' + esc(q.created_at) + '">' + _qaFormatDay(q.created_at) + '</span>' +
        '</span>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ── 精选问答：紧凑标题链接，默认两项，其余可展开/收起 ──
function _qaPinnedHtml(pinnedItems) {
  var limit = 2;
  var visible = pinnedItems.slice(0, limit);
  var extra = pinnedItems.slice(limit);
  var html = '<div class="qa-pinned-section">' +
    '<div class="qa-pinned-head">' + _QA_IC_PIN + '<span class="qa-pinned-title">精选问答</span></div>' +
    '<div class="qa-pinned-list">';
  visible.forEach(function(q) { html += _qaPinnedItemHtml(q); });
  html += '</div>';
  if (extra.length) {
    html += '<div class="qa-pinned-extra" hidden><div class="qa-pinned-list">';
    extra.forEach(function(q) { html += _qaPinnedItemHtml(q); });
    html += '</div></div>';
    html += '<button type="button" class="qa-pinned-toggle" aria-expanded="false" onclick="toggleQaPinned(this)">展开其余 ' + extra.length + ' 条</button>';
  }
  html += '</div>';
  return html;
}

function _qaPinnedItemHtml(q) {
  return '<div class="qa-pinned-item">' +
    _qaCardTitleLink(q, 'qa-pinned-link') +
    (q.has_accepted ? '<span class="qa-pinned-check" title="已采纳回答">' + _QA_IC_CHECK + '</span>' : '') +
  '</div>';
}

function toggleQaPinned(btn) {
  var extra = btn.previousElementSibling;
  if (!extra || !extra.classList.contains('qa-pinned-extra')) return;
  var open = !extra.hidden;
  extra.hidden = open;
  btn.setAttribute('aria-expanded', open ? 'false' : 'true');
  btn.textContent = open
    ? '展开其余 ' + extra.querySelectorAll('.qa-pinned-item').length + ' 条'
    : '收起';
}

function _qaPaginationHtml() {
  if (_qaTotalPages <= 1) return '';
  var html = '<div class="file-pagination" style="justify-content:center">';
  var pages = getPageNumbers(_qaPage, _qaTotalPages);
  html += '<button class="fp-btn fp-prev' + (_qaPage <= 1 ? ' fp-disabled' : '') + '" aria-label="上一页" onclick="qaGoPage(' + (_qaPage - 1) + ')">' + iconSvg('chevron-left') + '</button>';
  pages.forEach(function(n) {
    if (n === '…') { html += '<button class="fp-btn fp-ellipsis">⋯</button>'; }
    else { html += '<button class="fp-btn fp-num' + (n === _qaPage ? ' fp-active' : '') + '" onclick="qaGoPage(' + n + ')">' + n + '</button>'; }
  });
  html += '<button class="fp-btn fp-next' + (_qaPage >= _qaTotalPages ? ' fp-disabled' : '') + '" aria-label="下一页" onclick="qaGoPage(' + (_qaPage + 1) + ')">' + iconSvg('chevron-right') + '</button>';
  html += '</div>';
  return html;
}

function qaFilterL1(id) {
  _qaTagL1 = id === '' ? '' : id;
  _qaTagL2 = ''; // 切一级时清空二级
  _qaPage = 1;
  _syncQaToolbarSelection(); // F02：点击即同步选中态，不等请求返回
  _updateQaFilterButton();
  renderQaList();
}

function qaFilterL2(id) {
  _qaTagL2 = id === '' ? '' : id;
  _qaPage = 1;
  _syncQaToolbarSelection();
  _updateQaFilterButton();
  renderQaList();
}

function qaSort(s) {
  _qaSort = s;
  _qaPage = 1;
  _syncQaToolbarSelection();
  renderQaList();
}

function qaClearFilters() {
  _qaTagL1 = '';
  _qaTagL2 = '';
  _qaPage = 1;
  _syncQaToolbarSelection();
  _updateQaFilterButton();
  renderQaList();
}

function qaGoPage(p) {
  if (p < 1 || p > _qaTotalPages || p === _qaPage) return;
  _qaPage = p;
  renderQaList();
  window.scrollTo({ top: 0, behavior: _qaScrollBehavior() });
}

// ── 筛选面板展开/收起 ──
function toggleQaFilter() {
  _qaFilterOpen = !_qaFilterOpen;
  var panel = document.getElementById('qaFilterPanel');
  if (panel) panel.classList.toggle('qa-filter-collapsed', !_qaFilterOpen);
  var btn = document.getElementById('qaFilterBtn');
  if (btn) btn.setAttribute('aria-expanded', _qaFilterOpen ? 'true' : 'false');
  _updateQaFilterButton();
}

// 筛选按钮状态：展开高亮；有已选条件时显示数量
function _updateQaFilterButton() {
  var b = document.getElementById('qaFilterBtn');
  if (!b) return;
  var condCount = (_qaTagL1 ? 1 : 0) + (_qaTagL2 ? 1 : 0);
  b.classList.toggle('open', _qaFilterOpen);
  b.classList.toggle('active', condCount > 0);
  var label = b.querySelector('.qa-filter-btn-label');
  if (label) label.textContent = condCount > 0 ? '筛选 · ' + condCount : '筛选';
}

// ── 详情 ──
// F05：问题详情拥有独立地址 /qa/questions/{id}；回答命中带 answerId（锚点 /qa/questions/{id}#answer-{aid}）
function qaOpenDetail(id, opts) {
  opts = opts || {};
  var state = Object.assign({ qaId: id }, opts.answerId ? { answerId: opts.answerId } : {}, _qaListState());
  if (typeof pushViewState === 'function') pushViewState('qa', state);
  renderQaDetail(id, opts);
  window.scrollTo({ top: 0 });
}

async function renderQaDetail(id, opts) {
  opts = opts || {};
  var container = document.getElementById('qaContent');
  if (!container) return;
  var view = document.getElementById('qaView');
  if (view) view.classList.add('qa-detail-mode');
  var seq = ++_qaDetailSeq; // S03：同题快速重渲时旧响应不得覆盖
  _qaCurrentDetailId = id;
  container.innerHTML = '<div class="qa-loading">加载中…</div>';
  try {
    var data = await api('/api/qa/questions/' + id + '/');
    if (seq !== _qaDetailSeq) return;
    if (data.deleted) {
      container.innerHTML = _qaDeletedHtml(data);
      return;
    }
    // 浏览量 +1（去重由后端处理）
    api('/api/qa/questions/' + id + '/view/', { method: 'POST' }).catch(function() {});
    container.innerHTML = _qaDetailHtml(data);
    if (opts.answerId) {
      _qaFocusAnswer(opts.answerId);
    } else if (opts.scrollY) {
      requestAnimationFrame(function() { window.scrollTo({ top: opts.scrollY }); });
    }
  } catch (err) {
    if (seq !== _qaDetailSeq) return;
    container.innerHTML = '<div class="qa-detail">' +
      '<button type="button" class="qa-back-link" onclick="qaBackToList()">← 返回问题列表</button>' +
      '<div class="qa-empty">' +
        '<div class="qa-empty-title">加载失败</div>' +
        '<div class="qa-empty-desc">网络似乎不太顺畅</div>' +
        '<button type="button" class="qa-empty-action" onclick="renderQaDetail(' + parseInt(id, 10) + ')">重试</button>' +
      '</div></div>';
  }
}

function _qaDeletedHtml(d) {
  return '<div class="qa-detail">' +
    '<button type="button" class="qa-back-link" onclick="qaBackToList()">← 返回问题列表</button>' +
    '<div class="qa-thread"><div class="qa-q-section"><div class="qa-article-body">' +
      '<div class="qa-deleted-hint">' + esc(d.deleted_hint) + '</div>' +
      '<h1 class="qa-q-title">' + esc(d.title) + '</h1>' +
      '<div class="qa-detail-meta"><span class="qa-detail-byline">' +
        '<span>' + esc(d.author) + '</span>' +
        '<span>' + esc(d.created_at) + '</span>' +
      '</span></div>' +
    '</div></div></div></div>';
}

// 详情：问题 + 操作 + 回答共享同一张阅读底板，回答全部展开
function _qaDetailHtml(d) {
  var isManager = _qaIsManager();
  var isOwner = !!(currentUser && currentUser.id === d.owner_id);
  var canAnswer = isManager || d.qa_user_open;

  var html = '<div class="qa-detail">';
  html += '<button type="button" class="qa-back-link" onclick="qaBackToList()">← 返回问题列表</button>';

  // 状态条（作者视角：待审核/已驳回，简短不占屏）
  if (d.status === 'pending') {
    html += '<div class="qa-status-banner qa-status-banner--pending">' + iconSvg('clock') + ' 内容审核中，通过后将公开展示</div>';
  } else if (d.status === 'rejected') {
    html += '<div class="qa-status-banner qa-status-banner--rejected">已驳回，编辑后可重新提交审核</div>';
  }

  var favState = d.is_favorited ? ' on' : '';
  var favIcon = window.ICONS[d.is_favorited ? 'starFilled' : 'star'];
  var tags = _qaTagsHtml({ tag_l1: d.tag_l1, tag_l2: d.tag_l2 });

  html += '<div class="qa-thread">';
  // 问题
  html += '<article class="qa-q-section"><div class="qa-article-body">';
  html += '<h1 class="qa-q-title">' + esc(d.title) + '</h1>';
  html += '<div class="qa-detail-meta">' +
    (tags ? '<span class="qa-detail-tags">' + tags + '</span>' : '') +
    (d.is_pinned ? '<span class="qa-pin-badge qa-pin-badge-sm">' + _QA_IC_PIN + ' 置顶</span>' : '') +
    '<span class="qa-detail-byline">' +
      '<span>' + esc(d.author) + '</span>' +
      '<span title="' + esc(d.created_at) + '">' + _qaFormatDay(d.created_at) + '</span>' +
      '<span>浏览量 ' + d.view_count + '</span>' +
    '</span>' +
  '</div>';
  html += '<div class="qa-rich">' + qaSafeHtml(d.content) + '</div>';
  html += '<div class="qa-q-actions">' +
    '<button type="button" class="qa-fav-btn' + favState + '" onclick="qaToggleQuestionFav(' + d.id + ', this)">' + favIcon + '<span>' + (d.is_favorited ? '已收藏' : '收藏') + '</span><b class="qa-count">' + d.favorite_count + '</b></button>' +
    '<button type="button" class="qa-report-btn" onclick="openQaReportModal(\'question\', ' + d.id + ')">举报</button>' +
    (isOwner
      ? '<button type="button" class="qa-owner-btn" onclick="showQaCompose({ type: \'question\', action: \'edit\', qid: ' + d.id + ' })">编辑</button>' +
        '<button type="button" class="qa-owner-btn" onclick="showQaEditHistory(\'question\', ' + d.id + ')">编辑历史</button>' +
        '<button type="button" class="qa-owner-btn qa-owner-btn--danger" onclick="qaAskDelete(\'question\', ' + d.id + ')">删除</button>'
      : '') +
  '</div>';
  html += '</div></article>';

  // 回答区头部：左「N 个回答」，右「写回答」（仅有权限时呈现）
  html += '<div class="qa-answers-head">' +
    '<h2 class="qa-answers-title">' + d.answers.length + ' 个回答</h2>' +
    (canAnswer
      ? '<button type="button" class="qa-write-btn" onclick="showQaCompose({ type: \'answer\', action: \'create\', qid: ' + d.id + ' })">写回答</button>'
      : '') +
  '</div>';

  // 回答列表：连续阅读流（1px 分隔线），不再折叠
  if (d.answers.length) {
    html += '<div class="qa-answers">';
    d.answers.forEach(function(a) {
      html += _qaAnswerHtml(a, d);
    });
    html += '</div>';
  } else {
    html += '<div class="qa-answers-empty">还没有回答' + (canAnswer ? '，来写下第一条回答' : '') + '</div>';
  }

  html += '</div></div>';
  return html;
}

function _qaAnswerHtml(a, d) {
  var likeState = a.liked ? ' on' : '';
  var likeIcon = a.liked ? _QA_IC_THUMB_FILLED : _QA_IC_THUMB;
  var favState = a.is_favorited ? ' on' : '';
  var favIcon = window.ICONS[a.is_favorited ? 'starFilled' : 'star'];
  var pin = a.is_pinned ? '<span class="qa-pin-badge qa-pin-badge-sm">' + _QA_IC_PIN + ' 置顶</span>' : '';

  // F04：作者自己的待审核/已驳回回答随详情返回，需要明确的状态标识（他人不可见）
  var statusNote = '';
  if (a.status === 'pending') {
    statusNote = '<div class="qa-answer-status qa-answer-status--pending">' + iconSvg('clock') + ' 审核中，通过后公开可见（当前仅你可见）</div>';
  } else if (a.status === 'rejected') {
    statusNote = '<div class="qa-answer-status qa-answer-status--rejected">未通过审核，编辑后可重新提交</div>';
  }

  var canAccept = d && (_qaIsManager() || (currentUser && currentUser.id === d.owner_id && d.qa_user_open));
  var acceptBtn = canAccept
    ? '<button type="button" class="qa-accept-btn' + (a.is_accepted ? ' on' : '') + '" onclick="qaAcceptAnswer(' + a.id + ', this)">' +
      (a.is_accepted ? '取消采纳' : '采纳为最佳回答') + '</button>'
    : '';

  var isAnswerOwner = !!(currentUser && currentUser.id === a.author_id);
  var ownerBtns = isAnswerOwner
    ? '<button type="button" class="qa-owner-btn" onclick="showQaCompose({ type: \'answer\', action: \'edit\', qid: ' + (d ? d.id : '') + ', aid: ' + a.id + ' })">编辑</button>' +
      '<button type="button" class="qa-owner-btn" onclick="showQaEditHistory(\'answer\', ' + a.id + ')">编辑历史</button>' +
      '<button type="button" class="qa-owner-btn qa-owner-btn--danger" onclick="qaAskDelete(\'answer\', ' + a.id + ')">删除</button>'
    : '';

  // F05：回答锚点 id，收藏/搜索/通知可直达该回答；采纳强调用 2px 绿色左边线
  return '<article class="qa-answer' + (a.is_accepted ? ' qa-answer--accepted' : '') + '" data-qa-answer data-answer-id="' + a.id + '" id="answer-' + a.id + '">' +
    '<div class="qa-article-body">' +
      statusNote +
      '<div class="qa-answer-author-row">' +
        _qaAvatarHtml(a.author, a.avatar_url, 'answer') +
        '<span class="qa-answer-author">' + esc(a.author) + '</span>' +
        '<span class="qa-answer-date" title="' + esc(a.created_at) + '">' + _qaFormatDay(a.created_at) + '</span>' +
        pin +
        (a.is_accepted ? '<span class="qa-accepted-flag" title="最佳回答">' + _QA_IC_CHECK + ' 已采纳</span>' : '') +
      '</div>' +
      '<div class="qa-rich">' + qaSafeHtml(a.content) + '</div>' +
      '<div class="qa-answer-actions">' +
        '<button type="button" class="qa-like-btn' + likeState + '" onclick="qaToggleAnswerLike(' + a.id + ', this)">' + likeIcon + '<span>赞</span><b class="qa-count">' + a.like_count + '</b></button>' +
        '<button type="button" class="qa-fav-btn' + favState + '" onclick="qaToggleAnswerFav(' + a.id + ', this)">' + favIcon + '<span>收藏</span><b class="qa-count">' + a.favorite_count + '</b></button>' +
        acceptBtn +
        '<button type="button" class="qa-report-btn" onclick="openQaReportModal(\'answer\', ' + a.id + ')">举报</button>' +
        ownerBtns +
      '</div>' +
    '</div>' +
  '</article>';
}

function _qaAvatarHtml(name, url, role) {
  var initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  var image = url
    ? '<img src="' + esc(url) + '" alt="" loading="lazy">'
    : '<span>' + esc(initial) + '</span>';
  return '<span class="qa-avatar qa-avatar--' + (role || 'answer') + '" aria-hidden="true">' + image + '</span>';
}

// F05：收藏/搜索/通知直达某条回答 → 定位 + 轻量高亮（回答默认全展开，无需先展开）
function _qaFocusAnswer(answerId) {
  var el = document.querySelector('[data-answer-id="' + parseInt(answerId, 10) + '"]');
  if (!el) return;
  requestAnimationFrame(function() {
    el.scrollIntoView({ block: 'start', behavior: _qaScrollBehavior() });
    el.classList.add('qa-answer--flash');
    window.setTimeout(function() { el.classList.remove('qa-answer--flash'); }, 1600);
  });
}

function qaBackToList() {
  // F05：返回列表写回 /qa 历史条目（恢复筛选/页码），刷新不再重现之前的问题
  if (typeof pushViewState === 'function') pushViewState('qa', _qaListState());
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
// F08：覆盖已发布回答（后端 /api/qa/search/），带命中来源、命中片段与分页
// F01：打开/关闭统一生命周期——滚动锁、弹层 history、焦点恢复走同一对函数
// F01：点击搜索结果后的关闭路径——结果点击后还要导航，不能走异步 history.back()，
// 就地把浮层 history 条目替换回打开前的 SPA 状态（与 openNewCourseFromSearch 同模式）
function _closeQaSearchKeepEntry() {
  var overlay = document.querySelector('.search-overlay');
  if (overlay) overlay.remove();
  unlockScroll();
  if (typeof deactivateDialog === 'function' && overlay) deactivateDialog(overlay);
  if (history.state && history.state._modal) {
    var restored = (overlay && overlay._bnusparksReturnState && overlay._bnusparksReturnState._bnusparks)
      ? overlay._bnusparksReturnState
      : { _bnusparks: true, view: 'qa' };
    var url = typeof routeToPath === 'function' ? routeToPath(restored.view, restored) : null;
    history.replaceState(restored, '', url || location.pathname);
  }
}

function closeQaSearch(overlay) {
  var el = overlay || document.querySelector('.search-overlay');
  if (!el) return;
  el.remove();
  unlockScroll();
  _popModalHistory();
}

async function qaSearch(q, page) {
  _qaSearchQuery = q;
  _qaSearchPage = page || 1;
  var seq = ++_qaSearchSeq;
  try {
    var data = await api('/api/qa/search/?q=' + encodeURIComponent(q) +
      '&page=' + _qaSearchPage + '&pageSize=10');
    if (seq !== _qaSearchSeq) return; // 已有更新的搜索：丢弃旧结果
    var overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    var html = '<div class="search-overlay-inner sg-inner">';
    html += '<div class="sg-header">';
    html += '<button class="sg-close" onclick="closeQaSearch()" aria-label="关闭">✕</button>';
    html += '<div class="sg-title-row"><span class="sg-title-icon">' + iconSvg('search') + '</span><h3 class="sg-title">' + esc(q) + '</h3></div>';
    html += '<p class="sg-subtitle">问答区搜索结果</p>';
    html += '</div>';
    html += '<div class="sg-body">';
    if (data.items.length) {
      html += '<div class="sg-section"><div class="sg-section-header">' +
        '<span class="sg-section-label">问答</span><span class="sg-section-badge">' + data.total + '</span></div>';
      html += '<div class="sg-section-body">';
      data.items.forEach(function(it) {
        var hitLabel = it.hit === 'answer' ? '命中回答' : '命中问题';
        var openExpr = it.hit === 'answer' && it.answer_id
          ? 'qaOpenDetail(' + it.id + ', { answerId: ' + it.answer_id + ' })'
          : 'qaOpenDetail(' + it.id + ')';
        html += '<div class="sg-item" onclick="_closeQaSearchKeepEntry();' + openExpr + '">' +
          '<div class="sg-item-body">' +
            '<span class="sg-item-name">' + esc(it.title) + '</span>' +
            (it.snippet ? '<span class="sg-item-snippet">' + esc(it.snippet) + '</span>' : '') +
            '<span class="sg-item-meta"><span class="sg-item-hit">' + hitLabel + '</span>' +
              '<span class="sg-item-code">' + esc(it.tag_l2 || it.tag_l1 || '') + (it.tag_l2 || it.tag_l1 ? ' · ' : '') + esc(it.author) + '</span></span>' +
          '</div>' +
          '<span class="sg-item-arrow">→</span>' +
        '</div>';
      });
      html += '</div>';
      // F08：结果分页——不超过一页时不显示
      if (data.total_pages > 1) {
        html += '<div class="sg-pagination">';
        html += '<button class="sg-page-btn"' + (_qaSearchPage <= 1 ? ' disabled' : '') + ' onclick="event.stopPropagation();qaSearch(_qaSearchQuery,' + (_qaSearchPage - 1) + ')">← 上一页</button>';
        html += '<span class="sg-page-info">第 ' + data.page + ' / ' + data.total_pages + ' 页</span>';
        html += '<button class="sg-page-btn"' + (_qaSearchPage >= data.total_pages ? ' disabled' : '') + ' onclick="event.stopPropagation();qaSearch(_qaSearchQuery,' + (_qaSearchPage + 1) + ')">下一页 →</button>';
        html += '</div>';
      }
      html += '</div></div>';
    } else {
      html += '<div class="sg-empty"><div class="sg-empty-icon">' + iconSvg('search') + '</div>' +
        '<div class="sg-empty-title">未找到相关问答</div>' +
        '<div class="sg-empty-desc">试试其他关键词</div></div>';
    }
    html += '</div></div>';
    overlay.innerHTML = html;
    // 单一活动结果层：展示新结果前移除旧的搜索覆层
    document.querySelectorAll('.search-overlay').forEach(function(el) {
      el.remove();
      unlockScroll();
    });
    document.body.appendChild(overlay);
    lockScroll();
    // 记录浮层打开前的 SPA 状态：点击结果时就地恢复，避免异步 popstate 竞态
    overlay._bnusparksReturnState = history.state;
    _pushModalHistory(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) closeQaSearch(overlay); };
  } catch (err) {
    if (seq !== _qaSearchSeq) return;
    alert('搜索失败：' + ((err && (err.message || err.error)) || '请稍后再试'));
  }
}

// ── 「我要提问」按钮 ──
function qaAskClick() {
  if (!currentUser) { showLoginModal(); return; }
  // 问答区版主 / 超管 → 管理端独立发布视图
  if (_qaIsManager()) {
    if (typeof showQaCompose === 'function') {
      showQaCompose({ type: 'question', action: 'create' });
    } else {
      alert('发布功能加载中，请稍后再试');
    }
    return;
  }
  // S02：普通用户等待配置状态再决定——loading 等待、closed 提示未开放、error 提示失败
  _qaEnsureConfig().then(function(state) {
    if (state === 'open') {
      if (typeof showQaCompose === 'function') {
        showQaCompose({ type: 'question', action: 'create' });
      } else {
        alert('发布功能加载中，请稍后再试');
      }
      return;
    }
    if (state === 'error') {
      alert('问答设置加载失败，请稍后重试');
      return;
    }
    // 未开放：埋点 + 提示
    api('/api/qa/ask-click/', { method: 'POST' }).catch(function() {});
    alert('提问功能即将开放，敬请期待！');
  });
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
