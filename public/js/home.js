/* BNU Sparks · 紧凑首页
 * 首页只消费真实接口；请求按用户 ID + 认证代次隔离，失败态与真实空数据分开显示。
 */
(function () {
  'use strict';

  var _compactRequest = null;
  var _recommendationRefreshIndex = 0;
  var _compactData = {
    stats: null, announcements: [], campus: [], campusPayload: null, campusExpanded: false, recommendations: [], recommendationMeta: null, recommendationPageMeta: null,
    discoveryKind: 'recent', hotKind: 'download',
  };

  function htmlEscape(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function plainText(value) {
    var node = document.createElement('div');
    node.innerHTML = String(value || '');
    return (node.textContent || node.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function currentContext() {
    var user = typeof currentUser !== 'undefined' && currentUser ? currentUser : null;
    return { userId: user && user.id ? String(user.id) : null, generation: Number(window._bnuAuthGeneration || 0) };
  }

  function contextKey(context) {
    return (context.userId || 'guest') + ':' + context.generation;
  }

  function isCurrent(context) {
    var now = currentContext();
    return now.userId === context.userId && now.generation === context.generation;
  }

  function isMobileHome() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 700px)').matches);
  }

  function icon(name, filled) {
    if (window.ICONS && window.ICONS[filled ? 'starFilled' : name]) return window.ICONS[filled ? 'starFilled' : name];
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="' + (filled ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>';
  }

  function materialTypeLabel(value) {
    var labels = { textbook: '课本', exercise: '习题', exam: '真题', lecture: '课件', note: '笔记', summary: '汇总' };
    return labels[value] || value || '资料';
  }

  function recentMetaMarkup(item) {
    var course = item.course_name || item.course_code || '未分类';
    var uploader = item.uploader_name || '匿名';
    return '<span class="h8-course-meta">' + htmlEscape(course) + '</span><span class="h8-meta-sep" aria-hidden="true"> · </span><span class="h8-uploader">' + htmlEscape(uploader) + '</span>';
  }

  function materialMarkup(item, recommended) {
    var id = Number(item.id) || 0;
    var favorite = recommended && !!item.is_favorited;
    var reason = recommended ? (item.reason || '') : '';
    var title = htmlEscape(item.title || '未命名资料');
    var course = htmlEscape(item.course_name || item.course_code || '');
    return '<article class="h8-card compact-material-card" data-material-id="' + id + '">' +
      '<div class="h8-card-head"><a href="/file/' + id + '" data-material-link="' + id + '">' + course + '</a><span>' + htmlEscape(materialTypeLabel(item.material_type || item.file_type)) + '</span></div>' +
      '<a class="h8-card-title" href="/file/' + id + '" data-material-link="' + id + '">' + title + '</a>' +
      (reason ? '<p>' + htmlEscape(reason) + '</p>' : '<p>' + htmlEscape(item.file_name || '已审核资料') + '</p>') +
      '<div class="h8-card-bottom"><span>' + (item.download_count != null ? htmlEscape(item.download_count) + ' 次下载' : '') + (item.created_at ? ' · ' + htmlEscape(String(item.created_at).slice(0, 10)) : '') + '</span>' +
      (recommended ? '<button type="button" class="icon-btn bookmark compact-material-favorite' + (favorite ? ' is-favorited' : '') + '" data-favorite-id="' + id + '" aria-label="' + (favorite ? '取消收藏' : '收藏资料') + '">' + icon('star', favorite) + '</button>' : '') + '</div>' +
    '</article>';
  }

  function materialFromItem(item) {
    return {
      id: item.id, title: item.title || '', course_code: item.course_code || '', course_name: item.course_name || '',
      file_type: item.file_type || '', file_name: item.file_name || '',
    };
  }

  function setHostError(host, label, retryKind) {
    if (!host) return;
    host.innerHTML = '<div class="compact-error"><span>' + htmlEscape(label) + '</span><button type="button" data-compact-retry="' + htmlEscape(retryKind) + '">重试</button></div>';
  }

  function renderCompactStats(stats, error) {
    var fields = ['total_courses', 'total_files', 'total_users', 'college_with_data_count'];
    document.querySelectorAll('#compactHomeLayout [data-stat]').forEach(function (element) {
      var value = stats && stats[element.getAttribute('data-stat')];
      element.textContent = typeof value === 'number' ? value : '—';
    });
    if (error) {
      var note = document.getElementById('compactDataNote');
      if (note) note.innerHTML = '<span>平台统计暂时无法读取。</span> <button type="button" data-compact-retry="stats">重试</button>';
    }
    fields.forEach(function (field) {
      var element = document.querySelector('#compactStats [data-stat="' + field + '"]');
      if (element && (!stats || typeof stats[field] !== 'number')) element.textContent = '—';
    });
  }

  function updateHelperVisibility() {
    var helper = document.querySelector('.compact-announce-campus');
    var announcement = document.querySelector('.compact-announcement-block');
    var campus = document.querySelector('.compact-campus-block');
    if (helper) helper.hidden = !!(announcement && announcement.hidden && campus && campus.hidden);
  }

  function renderCompactAnnouncement(result) {
    var host = document.getElementById('compactAnnouncement');
    var block = document.querySelector('.compact-announcement-block');
    if (!host) return;
    if (result && result.error) {
      if (block) block.hidden = false;
      setHostError(host, '公告暂时无法读取。', 'announcements');
      updateHelperVisibility();
      return;
    }
    var items = result && result.value && result.value.items || [];
    _compactData.announcements = items;
    if (block) block.hidden = !items.length;
    if (!items.length) {
      host.innerHTML = '<p class="compact-empty">暂无新公告</p>';
      updateHelperVisibility();
      return;
    }
    var first = items[0];
    host.innerHTML = '<a href="/announcements#announcement-' + Number(first.id || 0) + '" data-announcement-id="' + Number(first.id || 0) + '" class="h8-notice-main compact-announcement-link"><span class="h8-label">' + htmlEscape(String(first.created_at || '').slice(0, 10)) + '</span><strong>' + htmlEscape(first.title) + '</strong><span>' + htmlEscape(plainText(first.content).slice(0, 100)) + '</span></a>';
    updateHelperVisibility();
  }

  function canManageCampus() {
    var user = typeof currentUser !== 'undefined' ? currentUser : null;
    var active = typeof isMgmtActive === 'function' ? isMgmtActive() : true;
    return !!(user && user.role === 'super_admin' && active);
  }

  function renderCompactCampus(result) {
    var host = document.getElementById('compactCampusLinks');
    var block = document.querySelector('.compact-campus-block');
    var button = document.getElementById('campusManageButton');
    var moreLink = document.getElementById('compactCampusMore');
    if (!host) return;
    if (result && result.error) {
      if (block) block.hidden = false;
      if (button) button.style.display = canManageCampus() ? '' : 'none';
      if (moreLink) moreLink.hidden = true;
      setHostError(host, '校园入口暂时无法读取。', 'campus');
      updateHelperVisibility();
      return;
    }
    var data = result && result.value || {};
    var items = Array.isArray(data.items) ? data.items : [];
    var canEdit = !!data.can_manage && canManageCampus();
    _compactData.campus = items;
    _compactData.campusPayload = data;
    if (button) button.style.display = canEdit ? '' : 'none';
    // 访客/普通用户无入口时不显示内部配置流程；管理员在管理模式保留轻量入口。
    if (!items.length && !canEdit) {
      if (block) block.hidden = true;
      host.innerHTML = '';
      if (moreLink) moreLink.hidden = true;
      updateHelperVisibility();
      return;
    }
    if (block) block.hidden = false;
    var visibleItems = _compactData.campusExpanded ? items : items.slice(0, 4);
    host.innerHTML = items.length
      ? visibleItems.map(function (item) {
          return '<a href="' + htmlEscape(item.url) + '" target="_blank" rel="noopener noreferrer" class="h8-campus-link compact-campus-link"><span>' + htmlEscape(item.name) + '</span><span aria-hidden="true">↗</span></a>';
        }).join('')
      : '<p class="h8-shortcut-note">还没有配置校园入口。</p>';
    // 「更多入口」收进区块头部，不再占用一整行。
    if (moreLink) {
      var hasMore = items.length > 4;
      moreLink.hidden = !hasMore;
      if (hasMore) {
        moreLink.textContent = _compactData.campusExpanded ? '收起 →' : '更多入口 →';
        moreLink.setAttribute('aria-expanded', _compactData.campusExpanded ? 'true' : 'false');
      }
    }
    updateHelperVisibility();
  }

  function renderCompactRecommendations(result) {
    var host = document.getElementById('compactRecommendations');
    if (!host) return;
    if (result && result.error) {
      setHostError(host, '推荐资料暂时无法读取。', 'recommendations');
      return;
    }
    var data = result && result.value || {};
    var items = Array.isArray(data.items) ? data.items : [];
    _compactData.recommendations = items;
    _compactData.recommendationMeta = data;
    if (!items.length) {
      var emptyText = data.related_exhausted ? '暂无新资料' : '暂无精选资料';
      host.innerHTML = '<div class="compact-empty"><span>' + emptyText + '</span><a href="/explorer/通识课" data-home-action="courses">查看全部课程</a></div>';
      return;
    }
    renderRecommendationItems();
  }

  function renderRecommendationItems() {
    var host = document.getElementById('compactRecommendations');
    if (!host) return;
    var items = _compactData.recommendations || [];
    var html = items.slice(0, 4).map(function (item) { return materialMarkup(item, true); }).join('');
    host.innerHTML = html;
  }

  function recommendationIndexMarkup(item, index) {
    var id = Number(item.id) || 0;
    var course = item.course_name || item.course_code || '未分类课程';
    var type = materialTypeLabel(item.material_type || item.file_type);
    var title = htmlEscape(item.title || '未命名资料');
    var reason = item.reason || (item.is_exploration ? '来自站内热门资料。' : '来自相关课程的资料。');
    var date = String(item.created_at || '').slice(0, 10);
    var downloads = item.download_count != null ? htmlEscape(item.download_count) + ' 次下载' : '已审核资料';
    var favorite = !!item.is_favorited;
    return '<article class="recommendation-index-card' + (index === 0 ? ' is-lead' : '') + '" data-recommendation-id="' + id + '">' +
      '<div class="recommendation-index-overline"><span class="recommendation-index-number">' + String(index + 1).padStart(2, '0') + '</span><span>' + htmlEscape(course) + '</span><span class="recommendation-index-type">' + htmlEscape(type) + '</span></div>' +
      '<a class="recommendation-index-title" href="/file/' + id + '" data-recommendation-material-link="' + id + '">' + title + '</a>' +
      '<p class="recommendation-index-reason">' + htmlEscape(reason) + '</p>' +
      '<div class="recommendation-index-bottom"><span>' + downloads + (date ? ' · ' + htmlEscape(date) : '') + '</span>' +
      '<button type="button" class="icon-btn bookmark recommendation-index-favorite' + (favorite ? ' is-favorited' : '') + '" data-recommendation-favorite-id="' + id + '" aria-label="' + (favorite ? '取消收藏' : '收藏资料') + '">' + icon('star', favorite) + '</button></div>' +
    '</article>';
  }

  function setRecommendationsStatus(message) {
    var status = document.getElementById('recommendationsStatus');
    if (status) status.textContent = message || '';
  }

  function setRecommendationsLoading(loading) {
    var button = document.getElementById('recommendationsRefresh');
    if (!button) return;
    button.disabled = !!loading;
    button.setAttribute('aria-busy', loading ? 'true' : 'false');
    button.classList.toggle('is-loading', !!loading);
  }

  function renderRecommendationsPage(result) {
    var host = document.getElementById('recommendationsPageContent');
    if (!host) return;
    if (result && result.error) {
      host.innerHTML = '<div class="recommendations-empty recommendations-empty--error"><strong>推荐资料暂时无法读取</strong><span>请稍后再试。</span><button type="button" data-recommendations-retry>重试</button></div>';
      setRecommendationsStatus('');
      return;
    }
    var data = result && result.value || {};
    var items = Array.isArray(data.items) ? data.items : [];
    _compactData.recommendations = items;
    _compactData.recommendationMeta = data;
    _compactData.recommendationPageMeta = data;
    var lead = document.getElementById('recommendationsLead');
    if (lead) lead.textContent = data.mode === 'personalized' ? '从正在学习的课程里，先看这些资料。' : '先从站内热门资料开始浏览。';
    var count = document.getElementById('recommendationsCount');
    if (count) count.textContent = String(items.length);
    var context = document.getElementById('recommendationsContext');
    if (context) {
      var signals = Array.isArray(data.signals) ? data.signals.filter(Boolean) : [];
      context.textContent = signals.length ? signals.join(' · ') : (data.mode === 'popular' ? '热门资料' : '课程相关');
    }
    setRecommendationsStatus('');
    if (!items.length) {
      host.innerHTML = '<div class="recommendations-empty"><strong>暂无可推荐的资料</strong><span>先进入课程目录浏览，新的资料会在这里出现。</span></div>';
      return;
    }
    host.innerHTML = items.map(recommendationIndexMarkup).join('');
  }

  function loadRecommendationsPage(forceRefresh) {
    var host = document.getElementById('recommendationsPageContent');
    if (!host) return;
    if (!forceRefresh && _compactData.recommendationPageMeta) {
      setRecommendationsLoading(false);
      renderRecommendationsPage({ value: _compactData.recommendationPageMeta, error: null });
      return;
    }
    host.innerHTML = '<span class="compact-loading">正在整理资料…</span>';
    var context = currentContext();
    var requestUrl = '/api/recommendations/?limit=13';
    if (forceRefresh) {
      _recommendationRefreshIndex += 1;
      requestUrl += '&refresh=' + _recommendationRefreshIndex;
    }
    setRecommendationsLoading(true);
    requestPart(requestUrl).then(function (result) {
      if (!isCurrent(context)) return;
      renderRecommendationsPage(result);
    }).finally(function () {
      if (isCurrent(context)) setRecommendationsLoading(false);
    });
  }

  function showRecommendations() {
    pushViewState('recommendations', {});
    switchView('recommendations');
    updateSidebar('recommendations');
    setupRecommendationsEvents();
    loadRecommendationsPage();
  }

  function setupRecommendationsEvents() {
    var page = document.getElementById('recommendationsView');
    if (!page || page.dataset.bound) return;
    page.dataset.bound = '1';
    page.addEventListener('click', function (event) {
      var refresh = event.target.closest('#recommendationsRefresh');
      if (refresh) { event.preventDefault(); loadRecommendationsPage(true); return; }
      var retry = event.target.closest('[data-recommendations-retry]');
      if (retry) { loadRecommendationsPage(true); return; }
      var link = event.target.closest('[data-recommendation-material-link]');
      if (link) {
        event.preventDefault();
        var linked = materialById(link.getAttribute('data-recommendation-material-link'));
        if (linked && typeof showFileDetail === 'function') showFileDetail(materialFromItem(linked));
        return;
      }
      var favorite = event.target.closest('[data-recommendation-favorite-id]');
      if (!favorite) return;
      event.preventDefault();
      event.stopPropagation();
      if (!currentUser) { showLoginModal(); return; }
      var id = favorite.getAttribute('data-recommendation-favorite-id');
      var context = currentContext();
      favorite.disabled = true;
      api('/api/files/' + id + '/favorite/', { method: 'POST' }).then(function (data) {
        if (!isCurrent(context)) return;
        var active = !!data.favorited;
        favorite.innerHTML = icon('star', active);
        favorite.classList.toggle('is-favorited', active);
        favorite.setAttribute('aria-label', active ? '取消收藏' : '收藏资料');
        var item = materialById(id);
        if (item) item.is_favorited = active;
        setRecommendationsStatus('');
      }).catch(function (error) {
        if (isCurrent(context)) setRecommendationsStatus('收藏失败：' + (error.message || '请稍后重试'));
      }).finally(function () { favorite.disabled = false; });
    });
  }

  function discoveryMore(kind) {
    if (kind === 'recent' && typeof showRecentAll === 'function') showRecentAll();
    else if (typeof showTopDownloaded === 'function') showTopDownloaded(undefined, kind === 'favorite' ? 'favorite' : 'download');
  }

  function renderCompactHot(kind) {
    var host = document.getElementById('compactHotList');
    var more = document.getElementById('compactHotMore');
    var note = document.getElementById('compactHotNote');
    if (!host) return;
    var stats = _compactData.stats || {};
    var key = kind === 'favorite' ? 'top_favorited' : 'top_downloaded';
    var items = Array.isArray(stats[key]) ? stats[key].slice(0, 8) : [];
    _compactData.hotKind = kind === 'favorite' ? 'favorite' : 'download';
    document.querySelectorAll('.h8-rank-tabs [data-hot]').forEach(function (tab) {
      var active = tab.getAttribute('data-hot') === _compactData.hotKind;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (note) note.textContent = _compactData.hotKind === 'favorite' ? '按收藏量排序' : '按下载量排序';
    if (more) {
      more.textContent = _compactData.hotKind === 'favorite' ? '查看收藏榜 →' : '查看下载榜 →';
      more.setAttribute('href', '/rankings');
      more.dataset.rankingType = _compactData.hotKind;
    }
    if (!items.length) {
      host.innerHTML = '<p class="compact-empty">暂无可展示的真实资料</p>';
      return;
    }
    host.innerHTML = items.map(function (item, index) {
      var id = Number(item.id) || 0;
      var count = _compactData.hotKind === 'favorite' ? (item.favorite_count || 0) : (item.download_count || 0);
      return '<article class="h8-rank-row compact-rank-row"><span class="h8-rank-num">' + String(index + 1).padStart(2, '0') + '</span><div><a href="/file/' + id + '" data-material-link="' + id + '">' + htmlEscape(item.title || '未命名资料') + '</a><small>' + htmlEscape(item.course_name || '') + '</small></div><span class="h8-metric">' + htmlEscape(count) + '<small>' + (_compactData.hotKind === 'favorite' ? '收藏' : '下载') + '</small></span></article>';
    }).join('');
  }

  function renderCompactRecent() {
    var host = document.getElementById('compactRecentList');
    if (!host) return;
    var stats = _compactData.stats || {};
    var items = Array.isArray(stats.recent_uploads) ? stats.recent_uploads.slice(0, 8) : [];
    if (!items.length) {
      host.innerHTML = '<p class="compact-empty">暂无可展示的真实资料</p>';
      return;
    }
    host.innerHTML = items.map(function (item) {
      var id = Number(item.id) || 0;
      var date = String(item.created_at || '').slice(0, 10).slice(5).replace('-', ' / ');
      return '<article class="h8-rank-row compact-rank-row"><div><a href="/file/' + id + '" data-material-link="' + id + '">' + htmlEscape(item.title || '未命名资料') + '</a><small>' + recentMetaMarkup(item) + '</small></div><time>' + htmlEscape(date) + '</time></article>';
    }).join('');
  }

  function renderCompactDesktopLists(stats, error) {
    var hotHost = document.getElementById('compactHotList');
    var recentHost = document.getElementById('compactRecentList');
    if (!hotHost || !recentHost) return;
    if (error) {
      setHostError(hotHost, '热门资料暂时无法读取。', 'stats');
      setHostError(recentHost, '最近上传暂时无法读取。', 'stats');
      return;
    }
    renderCompactHot(_compactData.hotKind || 'download');
    renderCompactRecent();
  }

  function renderCompactDiscovery(kind, error) {
    var host = document.getElementById('compactDiscoveryList');
    var more = document.getElementById('compactDiscoveryMore');
    var note = document.getElementById('compactDiscoveryNote');
    if (!host) return;
    if (error) {
      setHostError(host, '资料动态暂时无法读取。', 'stats');
      return;
    }
    var stats = _compactData.stats || {};
    var key = kind === 'download' ? 'top_downloaded' : kind === 'favorite' ? 'top_favorited' : 'recent_uploads';
    var items = Array.isArray(stats[key]) ? stats[key].slice(0, 8) : [];
    _compactData.discoveryKind = kind;
    if (note) note.textContent = kind === 'download' ? '按累计下载量排列' : kind === 'favorite' ? '按累计收藏数排列' : '按上传日期排列';
    document.querySelectorAll('.compact-discovery-tabs [data-discovery]').forEach(function (tab) {
      var active = tab.getAttribute('data-discovery') === kind;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (more) {
      more.textContent = kind === 'recent' ? '查看全部上传 →' : '查看排行榜 →';
      more.setAttribute('href', kind === 'recent' ? '/recent' : '/rankings');
    }
    if (!items.length) {
      host.innerHTML = '<p class="compact-empty">暂无可展示的真实资料</p>';
      return;
    }
    host.innerHTML = items.map(function (item, index) {
      var marker = kind === 'recent' ? '' : '<span class="compact-discovery-rank">' + String(index + 1).padStart(2, '0') + '</span>';
      var count = kind === 'favorite' ? ((item.favorite_count || 0) + ' 收藏') : kind === 'download' ? ((item.download_count || 0) + ' 下载') : String(item.created_at || '').slice(0, 10);
      return '<button type="button" class="compact-discovery-item" data-material-id="' + (Number(item.id) || 0) + '">' + marker + '<span class="compact-discovery-info"><strong>' + htmlEscape(item.title || '未命名资料') + '</strong><small>' + (kind === 'recent' ? recentMetaMarkup(item) : htmlEscape(item.course_name || '')) + '</small></span><span class="compact-discovery-count">' + htmlEscape(count) + '</span></button>';
    }).join('');
  }

  function clearCompactData() {
    _compactData.stats = null;
    _compactData.announcements = [];
    _compactData.campus = [];
    _compactData.campusPayload = null;
    _compactData.campusExpanded = false;
    _compactData.recommendations = [];
    _compactData.recommendationMeta = null;
    _compactData.recommendationPageMeta = null;
    var ids = ['compactAnnouncement', 'compactCampusLinks', 'compactRecommendations', 'compactHotList', 'compactRecentList', 'compactDiscoveryList'];
    ids.forEach(function (id) {
      var host = document.getElementById(id);
      if (host) host.innerHTML = '<span class="compact-loading">正在读取…</span>';
    });
    document.querySelectorAll('.compact-announcement-block, .compact-campus-block').forEach(function (block) { block.hidden = false; });
    var entry = document.getElementById('compact2026Link');
    if (entry) entry.style.display = 'none';
  }

  function requestPart(url) {
    return api(url).then(function (value) { return { value: value, error: null }; }).catch(function (error) { return { value: null, error: error || new Error('请求失败') }; });
  }

  function loadCompactHome() {
    var layout = document.body && document.body.dataset.homeLayout;
    if (layout !== 'compact') return Promise.resolve(false);
    var context = currentContext();
    var key = contextKey(context);
    // 没有可靠的后端身份字段时保守隐藏 2026 新生入口，不根据用户名猜测。
    var entry = document.getElementById('compact2026Link');
    if (entry) entry.style.display = 'none';
    if (_compactRequest && _compactRequest.key === key) return _compactRequest.promise;
    // 先完成首屏刚需数据，推荐列表单独异步加载，避免一个慢接口阻塞首页的全部内容。
    var criticalPromise = Promise.all([
      requestPart('/api/stats/?limit=8'), requestPart('/api/announcements/?limit=1'),
      requestPart('/api/campus-links/'),
    ]).then(function (result) {
      if (!isCurrent(context) || (document.body && document.body.dataset.homeLayout !== 'compact')) return false;
      var stats = result[0], announcements = result[1], campus = result[2];
      _compactData.stats = stats.value;
      renderCompactStats(stats.value, stats.error);
      renderCompactDesktopLists(stats.value, stats.error);
      renderCompactAnnouncement(announcements);
      renderCompactCampus(campus);
      renderCompactDiscovery(_compactData.discoveryKind || 'recent', stats.error);
      var note = document.getElementById('compactDataNote');
      var failed = result.some(function (part) { return !!part.error; });
      if (note && !stats.error) note.innerHTML = failed ? '<span>部分数据暂时无法读取，页面未使用估算值。</span> <button type="button" data-compact-retry="all">重试</button>' : '';
      return true;
    });
    var recommendationPromise = criticalPromise.then(function () {
      if (!isCurrent(context) || (document.body && document.body.dataset.homeLayout !== 'compact')) return false;
      return requestPart('/api/recommendations/?limit=4').then(function (recommendations) {
        if (!isCurrent(context) || (document.body && document.body.dataset.homeLayout !== 'compact')) return false;
        renderCompactRecommendations(recommendations);
        return !recommendations.error;
      });
    });
    var promise = Promise.all([criticalPromise, recommendationPromise]).then(function (result) {
      return result.some(function (value) { return value !== false; });
    }).finally(function () {
      if (_compactRequest && _compactRequest.promise === promise) _compactRequest = null;
    });
    _compactRequest = { key: key, context: context, promise: promise };
    return promise;
  }

  function materialById(id) {
    var stats = _compactData.stats || {};
    return (_compactData.recommendations || []).concat(stats.recent_uploads || [], stats.top_downloaded || [], stats.top_favorited || [])
      .find(function (item) { return String(item.id) === String(id); });
  }

  function setManagerStatus(message, kind) {
    var status = document.getElementById('campusFormStatus');
    if (!status) return;
    status.textContent = message || '';
    status.className = kind ? 'is-' + kind : '';
  }

  function campusManagerMarkup(items) {
    return '<div class="campus-manager-overlay" role="dialog" aria-modal="true" aria-labelledby="campusManagerTitle"><div class="campus-manager-dialog">' +
      '<div class="campus-manager-head"><div><span class="compact-kicker">ADMIN · LINKS</span><h2 id="campusManagerTitle">管理校园入口</h2></div><button type="button" class="campus-manager-close" onclick="closeCampusManager()" aria-label="关闭">×</button></div>' +
      '<form id="campusLinkForm" class="campus-link-form" novalidate><input type="hidden" name="id"><label>名称<input name="name" maxlength="40" required placeholder="如：教务系统"></label><label>网址<input name="url" type="url" maxlength="500" required placeholder="https://example.edu.cn"></label><div class="campus-form-actions"><button type="submit">保存入口</button><button type="button" class="secondary" onclick="resetCampusForm()">清空表单</button></div><p id="campusFormStatus" role="status" aria-live="polite"></p></form>' +
      '<div class="campus-manager-list" id="campusManagerList">' + (items.length ? items.map(function (item, index) {
        return '<div class="campus-manager-row" data-campus-id="' + item.id + '"><span class="campus-drag-handle" aria-hidden="true">≡</span><div><strong>' + htmlEscape(item.name) + '</strong><small>' + htmlEscape(item.url) + '</small></div><span class="campus-enabled-status ' + (item.is_enabled ? 'is-enabled' : 'is-disabled') + '">' + (item.is_enabled ? '启用' : '停用') + '</span><button type="button" data-campus-action="edit">编辑</button><button type="button" data-campus-action="toggle">' + (item.is_enabled ? '停用' : '启用') + '</button><button type="button" data-campus-action="up"' + (index === 0 ? ' disabled' : '') + '>上移</button><button type="button" data-campus-action="down"' + (index === items.length - 1 ? ' disabled' : '') + '>下移</button></div>';
      }).join('') : '<p class="compact-empty">还没有入口。</p>') + '</div>' +
      '<p class="campus-manager-hint">管理列表包含停用项；普通首页只显示启用项。</p></div></div>';
  }

  function renderManager(data, statusMessage) {
    renderCompactCampus({ value: data, error: null });
    var old = document.querySelector('.campus-manager-overlay');
    if (!old) return;
    old.outerHTML = campusManagerMarkup(data.items || []);
    var next = document.querySelector('.campus-manager-overlay');
    bindCampusManager();
    if (next && typeof activateDialog === 'function') activateDialog(next);
    if (statusMessage) setManagerStatus(statusMessage, 'success');
  }

  function refreshCampusManager(statusMessage) {
    var context = currentContext();
    return api('/api/campus-links/').then(function (data) {
      if (isCurrent(context) && document.querySelector('.campus-manager-overlay')) renderManager(data, statusMessage);
      return data;
    });
  }

  function openCampusManager() {
    if (!canManageCampus()) return;
    var context = currentContext();
    api('/api/campus-links/').then(function (data) {
      if (!isCurrent(context)) return;
      closeCampusManager();
      var wrapper = document.createElement('div');
      wrapper.innerHTML = campusManagerMarkup(data.items || []);
      var overlay = wrapper.firstChild;
      document.body.appendChild(overlay);
      bindCampusManager();
      lockScroll();
      if (typeof _pushModalHistory === 'function') _pushModalHistory(overlay);
      var input = overlay.querySelector('input[name="name"]');
      if (input) input.focus();
    }).catch(function (error) {
      setCompactNote('入口管理加载失败：' + (error.message || '请稍后重试'));
    });
  }

  function closeCampusManager() {
    var overlay = document.querySelector('.campus-manager-overlay');
    if (!overlay) return;
    overlay.remove();
    if (typeof deactivateDialog === 'function') deactivateDialog(overlay);
    unlockScroll();
    if (typeof _popModalHistory === 'function') _popModalHistory(overlay);
  }

  function openCampusLinksPanel() {
    var data = _compactData.campusPayload || {};
    var items = Array.isArray(data.items) ? data.items : [];
    if (items.length <= 4) return;
    var old = document.querySelector('.campus-more-overlay');
    if (old) closeCampusLinksPanel();
    var overlay = document.createElement('div');
    overlay.className = 'campus-more-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'campusMoreTitle');
    overlay.innerHTML = '<div class="campus-more-dialog"><div class="campus-more-head"><h2 id="campusMoreTitle">校园入口</h2><button type="button" class="campus-more-close" aria-label="关闭" onclick="closeCampusLinksPanel()">✕</button></div><div class="campus-more-links">' + items.map(function (item) {
      return '<a href="' + htmlEscape(item.url) + '" target="_blank" rel="noopener noreferrer" class="h8-campus-link compact-campus-link"><span>' + htmlEscape(item.name) + '</span><span aria-hidden="true">↗</span></a>';
    }).join('') + '</div></div>';
    overlay.addEventListener('click', function (event) { if (event.target === overlay) closeCampusLinksPanel(); });
    document.body.appendChild(overlay);
    lockScroll();
    if (typeof _pushModalHistory === 'function') _pushModalHistory(overlay);
    if (typeof activateDialog === 'function') activateDialog(overlay);
    var close = overlay.querySelector('.campus-more-close');
    if (close) close.focus();
  }

  function closeCampusLinksPanel() {
    var overlay = document.querySelector('.campus-more-overlay');
    if (!overlay) return;
    overlay.remove();
    if (typeof deactivateDialog === 'function') deactivateDialog(overlay);
    unlockScroll();
    if (typeof _popModalHistory === 'function') _popModalHistory(overlay);
  }

  function resetCampusForm() {
    var form = document.getElementById('campusLinkForm');
    if (form) {
      form.reset();
      var id = form.querySelector('[name="id"]');
      if (id) id.value = '';
    }
    setManagerStatus('');
  }

  function bindCampusManager() {
    var form = document.getElementById('campusLinkForm');
    var list = document.getElementById('campusManagerList');
    if (!form || !list || form.dataset.bound) return;
    form.dataset.bound = '1';
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var id = form.querySelector('[name="id"]').value;
        var body = { name: form.querySelector('[name="name"]').value.trim(), url: form.querySelector('[name="url"]').value.trim() };
      if (!body.name || body.name.length > 40) {
        setManagerStatus('请填写 1–40 个字符的入口名称', 'error');
        form.querySelector('[name="name"]').focus();
        return;
      }
      var parsedUrl;
      try { parsedUrl = new URL(body.url); } catch (error) { parsedUrl = null; }
      if (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
        setManagerStatus('网址必须是 http 或 https 地址', 'error');
        form.querySelector('[name="url"]').focus();
        return;
      }
        setManagerStatus('正在保存…', 'saving');
      var context = currentContext();
      api(id ? '/api/campus-links/' + id + '/' : '/api/campus-links/create/', { method: id ? 'PATCH' : 'POST', body: body })
        .then(function () { return refreshCampusManager('已保存'); })
        .then(function () { if (!isCurrent(context)) return; })
        .catch(function (error) { if (isCurrent(context)) setManagerStatus(error.message || '保存失败，请检查输入后重试', 'error'); });
    });
    list.addEventListener('click', function (event) {
      var action = event.target.closest('[data-campus-action]');
      var row = event.target.closest('[data-campus-id]');
      if (!action || !row) return;
      var id = row.getAttribute('data-campus-id');
      var items = _compactData.campus.slice();
      var index = items.findIndex(function (item) { return String(item.id) === String(id); });
      if (index < 0) return;
      var actionName = action.dataset.campusAction;
      if (actionName === 'edit') {
        form.querySelector('[name="id"]').value = items[index].id;
        form.querySelector('[name="name"]').value = items[index].name;
        form.querySelector('[name="url"]').value = items[index].url;
        form.querySelector('[name="name"]').focus();
        setManagerStatus('');
        return;
      }
      if (actionName === 'toggle') {
        setManagerStatus('正在更新…', 'saving');
        api('/api/campus-links/' + id + '/', { method: 'PATCH', body: { is_enabled: !items[index].is_enabled } })
          .then(function () { return refreshCampusManager('已更新'); })
          .catch(function (error) { setManagerStatus(error.message || '更新失败，请重试', 'error'); });
        return;
      }
      if (actionName === 'up' || actionName === 'down') {
        var target = actionName === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= items.length) return;
        var moved = items.splice(index, 1)[0];
        items.splice(target, 0, moved);
        setManagerStatus('正在保存顺序…', 'saving');
        api('/api/campus-links/reorder/', { method: 'POST', body: { ids: items.map(function (entry) { return entry.id; }) } })
          .then(function () { return refreshCampusManager('顺序已保存'); })
          .catch(function (error) { setManagerStatus(error.message || '排序失败，请重试', 'error'); });
      }
    });
  }

  function setCompactNote(message) {
    var note = document.getElementById('compactDataNote');
    if (note) note.innerHTML = message ? htmlEscape(message) + ' <button type="button" data-compact-retry="all">重试</button>' : '';
  }

  function setupCompactEvents() {
    setupRecommendationsEvents();
    var home = document.getElementById('compactHomeLayout');
    if (!home || home.dataset.bound) return;
    home.dataset.bound = '1';
    home.addEventListener('click', function (event) {
      var retry = event.target.closest('[data-compact-retry]');
      if (retry) { loadCompactHome(); return; }
      var hotTab = event.target.closest('[data-hot]');
      if (hotTab) { renderCompactHot(hotTab.getAttribute('data-hot')); return; }
      var hotMore = event.target.closest('#compactHotMore');
      if (hotMore && typeof showTopDownloaded === 'function') {
        event.preventDefault();
        showTopDownloaded(undefined, hotMore.dataset.rankingType || 'download');
        return;
      }
      var campusMore = event.target.closest('[data-campus-more]');
      if (campusMore) {
        if (isMobileHome()) {
          openCampusLinksPanel();
        } else {
          _compactData.campusExpanded = !_compactData.campusExpanded;
          renderCompactCampus({ value: _compactData.campusPayload || { items: _compactData.campus }, error: null });
        }
        return;
      }
      var tab = event.target.closest('[data-discovery]');
      if (tab) { renderCompactDiscovery(tab.getAttribute('data-discovery')); return; }
      var more = event.target.closest('#compactDiscoveryMore');
      if (more) { event.preventDefault(); discoveryMore(_compactData.discoveryKind); return; }
      var homeAction = event.target.closest('[data-home-action="courses"]');
      if (homeAction && typeof showAllCourses === 'function') { event.preventDefault(); showAllCourses(); return; }
      var announcement = event.target.closest('[data-announcement-id]');
      if (announcement && typeof showAnnouncements === 'function') { event.preventDefault(); showAnnouncements(Number(announcement.getAttribute('data-announcement-id'))); return; }
      var materialLink = event.target.closest('[data-material-link]');
      if (materialLink) {
        event.preventDefault();
        var linked = materialById(materialLink.getAttribute('data-material-link'));
        if (linked && typeof showFileDetail === 'function') showFileDetail(materialFromItem(linked));
        return;
      }
      var favorite = event.target.closest('[data-favorite-id]');
      if (favorite) {
        event.stopPropagation();
        if (!currentUser) { showLoginModal(); return; }
        var id = favorite.getAttribute('data-favorite-id');
        var context = currentContext();
        favorite.disabled = true;
        api('/api/files/' + id + '/favorite/', { method: 'POST' }).then(function (data) {
          if (!isCurrent(context)) return;
          favorite.innerHTML = icon('star', !!data.favorited);
          favorite.classList.toggle('is-favorited', !!data.favorited);
          favorite.setAttribute('aria-label', data.favorited ? '取消收藏' : '收藏资料');
          _compactData.recommendations.forEach(function (item) { if (String(item.id) === String(id)) item.is_favorited = !!data.favorited; });
        }).catch(function (error) { if (isCurrent(context)) setCompactNote('收藏失败：' + (error.message || '请稍后重试')); }).finally(function () { favorite.disabled = false; });
        return;
      }
      var card = event.target.closest('[data-material-id]');
      if (card && typeof showFileDetail === 'function') {
        var item = materialById(card.getAttribute('data-material-id'));
        if (item) showFileDetail(materialFromItem(item));
      }
    });
    document.addEventListener('click', function (event) {
      var overlay = event.target.closest('.campus-manager-overlay');
      if (overlay && event.target === overlay) closeCampusManager();
    });
    window.addEventListener('resize', function () {
      if (document.body && document.body.dataset.homeLayout === 'compact') renderRecommendationItems();
    });
  }

  window.loadCompactHome = loadCompactHome;
  window.openCampusManager = openCampusManager;
  window.closeCampusManager = closeCampusManager;
  window.openCampusLinksPanel = openCampusLinksPanel;
  window.closeCampusLinksPanel = closeCampusLinksPanel;
  window.resetCampusForm = resetCampusForm;
  window.showRecommendations = showRecommendations;
  window.loadRecommendationsPage = loadRecommendationsPage;
  window.renderRecommendationsPage = renderRecommendationsPage;
  window.addEventListener('bnuauthchange', function () {
    _compactRequest = null;
    clearCompactData();
    if (document.body && document.body.dataset.homeLayout === 'compact' && document.getElementById('homeView') && document.getElementById('homeView').classList.contains('active')) loadCompactHome();
    if (document.getElementById('recommendationsView') && document.getElementById('recommendationsView').classList.contains('active')) loadRecommendationsPage();
  });
  document.addEventListener('DOMContentLoaded', function () { setupCompactEvents(); });
})();
