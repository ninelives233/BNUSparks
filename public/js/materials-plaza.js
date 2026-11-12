/* BNU Sparks · materials-plaza.js —— 资料广场（/plaza）
 * 目录范围由服务端按叶节点、course_text、同码共享与合并链解析；本模块只维护
 * 当前范围、筛选、页码和浮层状态，卡片操作全部复用既有资料 API 与详情页。
 */
(function () {
  'use strict';

  var DEFAULTS = { q: '', materialType: null, teacher: '', format: '', favorites: false, sort: 'smart', page: 1 };
  var _state = { categoryId: null, q: '', materialType: null, teacher: '', format: '', favorites: false, sort: 'smart', page: 1 };
  var _nav = null;
  var _items = [];
  var _groups = [];
  var _groupTimer = null;
  var _groupCloseTimer = null;
  var _groupIntent = null;
  var _groupByHover = false;
  var _openGroup = null;
  var _suppressGroupFocus = false;
  var _requestSeq = 0;
  var _navRequestSeq = 0;
  var _active = false;
  var _overlay = null;
  var _tree = null;
  var _searchTimer = null;
  var _lastSignature = '';

  function rangeOfNav() {
    return _nav && _nav.course_type === 'major' ? '专业课' : '通识课';
  }

  function signatureOf(state) {
    return [state.categoryId || '', state.q || '', state.materialType || '', state.teacher || '', state.format || '',
      state.favorites ? 1 : 0, state.sort || 'smart', state.page || 1].join('|');
  }

  function stateFromHistory() {
    var state = history.state;
    if (!state || state.view !== 'plaza') return null;
    return {
      categoryId: state.categoryId || null,
      q: state.q || '',
      materialType: state.materialType || null,
      teacher: state.teacher || '',
      format: state.format || '',
      favorites: !!state.favorites,
      sort: state.sort || 'smart',
      page: state.page || 1,
      scrollY: state.scrollY || 0,
    };
  }

  function historyState() {
    return {
      categoryId: _state.categoryId,
      q: _state.q,
      materialType: _state.materialType,
      teacher: _state.teacher,
      format: _state.format,
      favorites: _state.favorites,
      sort: _state.sort,
      page: _state.page,
    };
  }

  function sessionPayload() {
    return {
      categoryId: _state.categoryId,
      q: _state.q,
      materialType: _state.materialType,
      teacher: _state.teacher,
      format: _state.format,
      favorites: _state.favorites,
      sort: _state.sort,
      page: _state.page,
    };
  }

  function saveSession() {
    if (!_state.categoryId) return;
    saveScopePosition('plaza', rangeOfNav(), sessionPayload());
    setLastCourseRange(rangeOfNav());
  }

  function fetchNavigation(categoryId, courseType) {
    var type = courseType === '专业课' || courseType === 'major' ? 'major' : 'general';
    var query = categoryId
      ? '?category_id=' + encodeURIComponent(categoryId)
      : '?course_type=' + encodeURIComponent(type);
    return api('/api/courses/navigation/' + query);
  }

  function materialsQuery() {
    var params = new URLSearchParams();
    params.set('category_id', _state.categoryId);
    if (_state.q) params.set('q', _state.q);
    if (_state.materialType) params.set('material_type', _state.materialType);
    if (_state.teacher) params.set('teacher', _state.teacher);
    if (_state.format) params.set('format', _state.format);
    if (_state.favorites) params.set('favorites', '1');
    params.set('sort', _state.sort);
    params.set('page', _state.page);
    return params.toString();
  }

  function restoreSessionFilters(range) {
    var saved = getScopePosition('plaza', range);
    return {
      categoryId: saved && saved.categoryId ? saved.categoryId : null,
      q: saved && saved.q ? saved.q : '',
      materialType: saved && saved.materialType ? saved.materialType : null,
      teacher: saved && saved.teacher ? saved.teacher : '',
      format: saved && saved.format ? saved.format : '',
      favorites: false,
      sort: saved && saved.sort ? saved.sort : DEFAULTS.sort,
      page: saved && saved.page ? saved.page : 1,
    };
  }

  function show(options) {
    options = options || {};
    var requestedRange = options.courseType === '专业课' || options.courseType === '通识课'
      ? options.courseType : getLastCourseRange();
    var requestedType = options.courseType === '专业课' ? 'major'
      : options.courseType === '通识课' ? 'general' : null;
    if (options.fromHistory) {
      var restored = stateFromHistory();
      if (!restored) return;
      var signature = signatureOf(restored);
      if (_active && signature === _lastSignature && _nav) {
        _state = restored;
        if (typeof scrollToInstant === 'function') scrollToInstant(restored.scrollY || 0);
        return;
      }
      _state = restored;
    } else {
      var range = requestedRange;
      var shared = options.resetFilters ? Object.assign({ categoryId: null }, DEFAULTS) : restoreSessionFilters(range);
      _state = {
        categoryId: options.categoryId || shared.categoryId,
        q: options.keepFilters ? _state.q : shared.q,
        materialType: options.keepFilters ? _state.materialType : shared.materialType,
        teacher: options.keepFilters ? _state.teacher : shared.teacher,
        format: options.keepFilters ? _state.format : shared.format,
        favorites: options.keepFilters ? _state.favorites : shared.favorites,
        sort: options.keepFilters ? _state.sort : shared.sort,
        page: options.page || (options.keepFilters ? 1 : shared.page),
      };
      setLastCourseRange(range);
      if (options.group) {
        _state.teacher = options.group.teacher.trim();
        _state.materialType = options.group.material_type_id;
      }
    }
    if (!currentUser && _state.favorites) {
      _state.favorites = false;
      _state.page = 1;
    }

    closeOverlay(true);
    _nav = null;
    _requestSeq += 1;
    _active = true;
    switchView('plaza');
    updateSidebar('allCourses');
    ensureShell();
    var breadcrumb = document.getElementById('plazaBreadcrumb');
    if (breadcrumb) breadcrumb.innerHTML = '';
    renderBrowseBar(requestedRange);
    renderChrome();
    renderLoading();
    if (!options.fromHistory && typeof pushViewState === 'function') {
      pushViewState('plaza', historyState(), !!options.replace);
    }
    _lastSignature = signatureOf(_state);

    var navSeq = ++_navRequestSeq;
    return fetchNavigation(_state.categoryId, requestedRange)
      .then(function (nav) {
        if (navSeq !== _navRequestSeq || !_active) return null;
        // 会话中保存的目录可能来自旧数据：课程类型字段修复前，专业课目录会被
        // 记在通识课名下。此时若继续加载该目录，切换课程类型看起来毫无反应；
        // 类型对不上就回到目标范围的根目录，并覆盖这份失效的会话位置。
        if (requestedType && nav.course_type !== requestedType) {
          return fetchNavigation(null, requestedRange).then(function (rootNav) {
            if (navSeq !== _navRequestSeq || !_active) return null;
            return applyNavigation(rootNav, !options.fromHistory);
          });
        }
        return applyNavigation(nav, !options.fromHistory);
      })
      .catch(function (error) {
        if (navSeq !== _navRequestSeq || !_active) return;
        if (error && error.status === 404 && _state.categoryId) {
          return fetchNavigation(null, requestedRange).then(function (nav) {
            if (navSeq !== _navRequestSeq || !_active) return null;
            return applyNavigation(nav, true);
          }).catch(function (fallbackError) {
            if (navSeq === _navRequestSeq && _active) renderError(fallbackError);
          });
        }
        renderError(error);
      });
  }

  function applyNavigation(nav, patchHistory) {
    _nav = nav;
    _state.categoryId = nav.category_id;
    setLastCourseRange(rangeOfNav());
    saveSession();
    renderBrowseBar(rangeOfNav());
    renderChrome();
    renderBreadcrumb();
    renderTreeHost();
    if (patchHistory && typeof patchViewState === 'function') patchViewState(historyState());
    return loadMaterials();
  }

  function ensureShell() {
    var host = document.getElementById('plazaContent');
    if (!host || host.dataset.plazaShell === '1') return;
    host.dataset.plazaShell = '1';
    host.innerHTML =
      '<div class="plaza-toolbar">' +
        '<label class="plaza-search">' + iconSvg('search') +
          '<input id="plazaSearchInput" type="search" autocomplete="off" placeholder="搜索资料或课程…" aria-label="搜索当前范围的资料">' +
          '<button type="button" class="plaza-search-filter" id="plazaMobileFilter" aria-label="筛选">' + iconSvg('filter') + '</button>' +
        '</label>' +
        '<div class="plaza-selects" id="plazaSelects">' +
          filterPillHtml({ label: '类型', id: 'plazaTypeSelect', aria: '资料类型筛选', value: '全部' }) +
          filterPillHtml({ label: '格式', id: 'plazaFormatSelect', aria: '文件格式筛选', value: '全部' }) +
          filterPillHtml({
            label: '排序', id: 'plazaSortSelect', aria: '排序方式', value: '智能推荐',
            options: '<option value="smart">智能推荐</option><option value="latest">最新上传</option><option value="downloads">下载最多</option><option value="favorites">收藏最多</option>'
          }) +
        '</div>' +
        '<button type="button" class="plaza-upload" id="plazaUploadBtn" aria-label="上传文件">' + iconSvg('upload') + '<span>上传文件</span></button>' +
      '</div>' +
      '<div class="plaza-summary"><span id="plazaScopeLabel">当前范围加载中…</span><span id="plazaCount"></span></div>' +
      '<div class="plaza-filter-chips" id="plazaFilterChips"></div>' +
      '<div class="plaza-grid" id="plazaGrid" aria-live="polite"></div>' +
      '<div class="file-pagination" id="plazaPager" aria-label="资料分页"></div>';

    var search = document.getElementById('plazaSearchInput');
    search.addEventListener('input', function () {
      _state.q = search.value.trim();
      _state.page = 1;
      if (_searchTimer) clearTimeout(_searchTimer);
      _searchTimer = setTimeout(function () { loadMaterials(); }, 300);
    });
    search.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (_searchTimer) clearTimeout(_searchTimer);
      _state.q = search.value.trim();
      _state.page = 1;
      loadMaterials();
    });

    document.getElementById('plazaUploadBtn').addEventListener('click', openUploadEntry);
    document.getElementById('plazaMobileFilter').addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openFilterSheet();
    });
    document.getElementById('plazaTypeSelect').addEventListener('change', function (event) {
      _state.materialType = event.target.value ? parseInt(event.target.value, 10) : null;
      _state.page = 1;
      syncSelectPill(event.target);
      loadMaterials();
    });
    document.getElementById('plazaFormatSelect').addEventListener('change', function (event) {
      _state.format = event.target.value || '';
      _state.page = 1;
      syncSelectPill(event.target);
      loadMaterials();
    });
    document.getElementById('plazaSortSelect').addEventListener('change', function (event) {
      _state.sort = event.target.value;
      _state.page = 1;
      syncSelectPill(event.target);
      loadMaterials();
    });
    var grid = document.getElementById('plazaGrid');
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && _openGroup) {
        event.preventDefault();
        closeGroup(_openGroup.contains(document.activeElement));
      }
    });
    window.addEventListener('resize', function () { if (_openGroup) closeGroup(); });
    window.addEventListener('scroll', function () { if (_openGroup) closeGroup(); }, { passive: true });
    grid.addEventListener('click', function (event) {
      var more = event.target.closest('[data-plaza-group-more]');
      if (more) {
        var group = _groups[parseInt(more.getAttribute('data-plaza-group-more'), 10)];
        if (group) show({ categoryId: group.items[0].course_category_id, keepFilters: true, group: group.items[0] });
        return;
      }
      var trigger = event.target.closest('[data-plaza-group-open]');
      if (trigger) { openGroup(trigger.closest('.plaza-stack')); return; }
      if (event.target.closest('[data-plaza-group-close]')) { closeGroup(_openGroup && _openGroup.contains(document.activeElement)); return; }
      var courseButton = event.target.closest('[data-plaza-course]');
      if (courseButton) {
        event.preventDefault();
        event.stopPropagation();
        navigateCategory(parseInt(courseButton.getAttribute('data-plaza-course'), 10));
        return;
      }
      var favorite = event.target.closest('[data-plaza-fav]');
      if (favorite) {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(parseInt(favorite.getAttribute('data-plaza-fav'), 10), favorite);
        return;
      }
      var download = event.target.closest('[data-plaza-download]');
      if (download) {
        event.stopPropagation();
        var fileId = parseInt(download.getAttribute('data-plaza-download'), 10);
        if (typeof handleDownloadClick === 'function') handleDownloadClick(fileId, download, event);
        return;
      }
      var card = event.target.closest('.plaza-card');
      if (card) openDetail(parseInt(card.getAttribute('data-id'), 10));
    });
    grid.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { closeGroup(true); return; }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var card = event.target.closest('.plaza-card');
      if (!card || event.target.closest('button, a, select, input')) return;
      event.preventDefault();
      openDetail(parseInt(card.getAttribute('data-id'), 10));
    });
    function scheduleIntent(trigger, x, y) {
      clearTimeout(_groupTimer);
      _groupIntent = { trigger: trigger, x: x, y: y };
      _groupTimer = setTimeout(function () {
        if (_groupIntent && _groupIntent.trigger === trigger && trigger.isConnected) openGroup(trigger.closest('.plaza-stack'), true);
        _groupIntent = null;
      }, 650);
    }
    function scheduleGroupClose() {
      if (!_openGroup || !_groupByHover) return;
      clearTimeout(_groupCloseTimer);
      _groupCloseTimer = setTimeout(function () {
        _groupCloseTimer = null;
        if (_openGroup && _groupByHover) closeGroup();
      }, 120);
    }
    grid.addEventListener('pointerover', function (event) {
      if (event.pointerType !== 'mouse') return;
      if (event.target.closest('.plaza-stack-hint')) {
        clearTimeout(_groupTimer);
        _groupIntent = null;
        return;
      }
      var trigger = event.target.closest('[data-plaza-group-open]');
      if (!_openGroup && trigger && !trigger.contains(event.relatedTarget)) scheduleIntent(trigger, event.clientX, event.clientY);
      if (event.target.closest('.plaza-stack-backdrop')) scheduleGroupClose();
      if (event.target.closest('.plaza-stack-cards .plaza-card')) clearTimeout(_groupCloseTimer);
    });
    grid.addEventListener('pointermove', function (event) {
      if (event.pointerType !== 'mouse') return;
      if (_groupIntent && event.target.closest('[data-plaza-group-open]') === _groupIntent.trigger &&
          Math.hypot(event.clientX - _groupIntent.x, event.clientY - _groupIntent.y) > 8) {
        scheduleIntent(_groupIntent.trigger, event.clientX, event.clientY);
      }
      if (_openGroup && event.target.closest('.plaza-stack-backdrop') && !_groupCloseTimer) scheduleGroupClose();
    });
    grid.addEventListener('pointerout', function (event) {
      var stack = event.target.closest('.plaza-stack');
      if (stack && !stack.contains(event.relatedTarget)) {
        clearTimeout(_groupTimer);
        _groupIntent = null;
        if (_groupByHover) scheduleGroupClose();
      }
    });
    grid.addEventListener('focusin', function (event) {
      var trigger = event.target.closest('[data-plaza-group-open]');
      if (trigger && !_suppressGroupFocus) openGroup(trigger.closest('.plaza-stack'));
    });
    grid.addEventListener('focusout', function (event) {
      var stack = event.target.closest('.plaza-stack');
      if (stack && !stack.contains(event.relatedTarget)) closeGroup();
    });

    document.getElementById('plazaPager').addEventListener('click', function (event) {
      var button = event.target.closest('[data-plaza-page]');
      if (!button) return;
      var page = parseInt(button.getAttribute('data-plaza-page'), 10);
      if (!page || page === _state.page) return;
      _state.page = page;
      loadMaterials().then(function () {
        var summary = document.getElementById('plazaSummaryAnchor');
        if (summary) summary.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  }

  function renderBrowseBar(range) {
    var host = document.getElementById('plazaBrowseBar');
    if (!host) return;
    var activeRange = range || rangeOfNav() || '通识课';
    host.innerHTML = '<div class="plaza-desktop-switches">' + browseSwitcherHtml('plaza', activeRange) + '</div>';
    var modeGroup = host.querySelector('.browse-switcher[aria-label="资料浏览方式"]');
    if (modeGroup) {
      modeGroup.outerHTML = '<button type="button" class="browse-mode-link" data-browse-mode="directory" aria-label="切换到课程目录">' +
        iconSvg('folder') + '<span>课程目录</span></button>';
    }
    if (_nav && _nav.path && _nav.path.length > 1) {
      var rangeGroup = host.querySelector('.browse-switcher[aria-label="课程范围"]');
      if (rangeGroup) rangeGroup.remove();
    }
    bindBrowseSwitcher(host, {
      range: switchPlazaRange,
      mode: function (mode) {
        if (mode === 'directory') switchToDirectory();
      }
    });
  }

  function switchPlazaRange(range) {
    saveSession();
    setLastCourseRange(range);
    var saved = getScopePosition('plaza', range);
    var options = { courseType: range, keepFilters: true, page: 1 };
    if (saved && saved.categoryId) options.categoryId = saved.categoryId;
    show(options);
  }

  function switchToDirectory(skipPreference) {
    saveSession();
    if (!skipPreference && typeof setAppearance === 'function') setAppearance('material_browse_mode', 'directory');
    var path = _nav && _nav.path.length ? _nav.path.map(function (level) { return level.name; }) : [rangeOfNav()];
    if (typeof showExplorerPath === 'function') showExplorerPath(path);
  }

  function renderChrome() {
    var scope = document.getElementById('plazaScopeLabel');
    if (scope) {
      scope.textContent = _nav
        ? '当前范围：' + _nav.name + (_nav.can_expand_tree ? '及其下属课程' : ' · 本课程')
        : '当前范围加载中…';
    }
    var typeSelect = document.getElementById('plazaTypeSelect');
    var formatSelect = document.getElementById('plazaFormatSelect');
    var sortSelect = document.getElementById('plazaSortSelect');
    if (typeSelect && document.activeElement !== typeSelect) typeSelect.value = _state.materialType || '';
    if (formatSelect && document.activeElement !== formatSelect) formatSelect.value = _state.format || '';
    if (sortSelect && document.activeElement !== sortSelect) sortSelect.value = _state.sort;
    var search = document.getElementById('plazaSearchInput');
    if (search && document.activeElement !== search && search.value !== _state.q) search.value = _state.q;
    renderFilterChips();
  }

  function renderFilterChips() {
    var host = document.getElementById('plazaFilterChips');
    if (!host) return;
    var chips = [];
    if (_state.q) chips.push({ key: 'q', label: '关键词：' + _state.q });
    if (_state.materialType) {
      var option = document.querySelector('#plazaTypeSelect option[value="' + _state.materialType + '"]');
      chips.push({ key: 'materialType', label: '类型：' + (option ? (option.getAttribute('data-pill') || option.textContent) : _state.materialType) });
    }
    if (_state.format) chips.push({ key: 'format', label: '格式：' + _state.format.toUpperCase() });
    if (_state.teacher) chips.push({ key: 'teacher', label: '教师：' + _state.teacher });
    if (_state.favorites) chips.push({ key: 'favorites', label: '我的收藏' });
    if (!chips.length) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = chips.map(function (chip) {
      return '<button type="button" class="plaza-chip" data-plaza-clear="' + chip.key + '">' +
        esc(chip.label) + '<span aria-hidden="true">×</span></button>';
    }).join('') + '<button type="button" class="plaza-chip plaza-chip-clear" data-plaza-clear="all">清除筛选</button>';
    host.querySelectorAll('[data-plaza-clear]').forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.getAttribute('data-plaza-clear');
        if (key === 'all') {
          _state.q = ''; _state.materialType = null; _state.teacher = ''; _state.format = ''; _state.favorites = false;
        } else if (key === 'q') {
          _state.q = '';
        } else if (key === 'materialType') {
          _state.materialType = null;
        } else if (key === 'format') {
          _state.format = '';
        } else if (key === 'teacher') {
          _state.teacher = '';
        } else if (key === 'favorites') {
          _state.favorites = false;
        }
        _state.page = 1;
        renderChrome();
        loadMaterials();
      });
    });
  }

  function updateFacets(facets) {
    var typeSelect = document.getElementById('plazaTypeSelect');
    var formatSelect = document.getElementById('plazaFormatSelect');
    if (typeSelect) {
      var typeValue = _state.materialType ? String(_state.materialType) : '';
      typeSelect.innerHTML = '<option value="">全部</option>' + (facets.material_types || []).map(function (type) {
        return '<option value="' + type.id + '" data-pill="' + esc(type.name) + '">' + esc(type.name) + '（' + type.count + '）</option>';
      }).join('');
      typeSelect.value = typeValue;
      syncSelectPill(typeSelect);
    }
    if (formatSelect) {
      formatSelect.innerHTML = '<option value="">全部</option>' + (facets.formats || []).map(function (format) {
        return '<option value="' + esc(format.value) + '" data-pill="' + esc(format.name) + '">' + esc(format.name) + '（' + format.count + '）</option>';
      }).join('');
      formatSelect.value = _state.format || '';
      syncSelectPill(formatSelect);
    }
    var sortSelect = document.getElementById('plazaSortSelect');
    if (sortSelect) {
      sortSelect.value = _state.sort;
      syncSelectPill(sortSelect);
    }
  }

  function loadMaterials() {
    if (!_state.categoryId) return Promise.resolve();
    var seq = ++_requestSeq;
    var currentSignature = signatureOf(_state);
    return api('/api/materials/?' + materialsQuery())
      .then(function (data) {
        if (seq !== _requestSeq || !_active) return;
        _groups = (data.items || []).filter(function (item) { return item.kind === 'group'; });
        _items = (data.items || []).reduce(function (all, item) { return all.concat(item.kind === 'group' ? item.items : [item]); }, []);
        _state.page = data.page || 1;
        _lastSignature = signatureOf(_state);
        updateFacets(data.facets || { material_types: [], formats: [] });
        renderResults(data);
        renderChrome();
        if (typeof patchViewState === 'function') patchViewState(historyState());
        saveSession();
      })
      .catch(function (error) {
        if (seq !== _requestSeq || !_active) return;
        renderError(error);
      });
  }

  function renderLoading() {
    var grid = document.getElementById('plazaGrid');
    if (!grid) return;
    grid.innerHTML = Array.from({ length: 6 }).map(function () {
      return '<div class="plaza-card plaza-card-skeleton" aria-hidden="true">' +
        '<span class="pc-skeleton-line w70"></span><span class="pc-skeleton-line w90"></span>' +
        '<span class="pc-skeleton-line w40"></span><span class="pc-skeleton-line w60"></span></div>';
    }).join('');
    var pager = document.getElementById('plazaPager');
    if (pager) pager.innerHTML = '';
    var count = document.getElementById('plazaCount');
    if (count) count.textContent = '正在加载…';
  }

  function renderError(error) {
    var grid = document.getElementById('plazaGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="plaza-state">' +
      '<p>资料加载失败：' + esc(error && error.message ? error.message : '请稍后重试') + '</p>' +
      '<button type="button" class="plaza-state-btn" id="plazaRetry">重试</button></div>';
    var retry = document.getElementById('plazaRetry');
    if (retry) retry.addEventListener('click', function () {
      if (_nav) { loadMaterials(); return; }
      show({ categoryId: _state.categoryId });
    });
    var count = document.getElementById('plazaCount');
    if (count) count.textContent = '';
  }

  function emptyStateHtml() {
    var filtered = !!(_state.q || _state.materialType || _state.teacher || _state.format || _state.favorites);
    if (filtered) {
      return '<div class="plaza-state"><p>当前筛选条件下没有资料。</p>' +
        '<button type="button" class="plaza-state-btn" data-plaza-clear="all">清除筛选</button></div>';
    }
    if (_nav && _nav.course_type === 'major' && _nav.can_expand_tree &&
        !_nav.children.length && currentUser && currentUser.identity_education === '硕士') {
      return '<div class="plaza-state"><p>这里还没有课程。</p>' +
        '<button type="button" class="plaza-state-btn" data-plaza-create>创建课程</button></div>';
    }
    return '<div class="plaza-state"><p>这个范围还没有资料。</p>' +
      '<p class="plaza-state-hint">可以展开课程树换一个目录，或分享第一份资料。</p></div>';
  }

  function renderResults(data) {
    var grid = document.getElementById('plazaGrid');
    var count = document.getElementById('plazaCount');
    if (count) count.textContent = '共 ' + data.total + ' 份资料';
    if (!grid) return;
    if (!data.items || !data.items.length) {
      grid.innerHTML = emptyStateHtml();
      var clear = grid.querySelector('[data-plaza-clear="all"]');
      if (clear) clear.addEventListener('click', function () {
        _state.q = ''; _state.materialType = null; _state.teacher = ''; _state.format = ''; _state.favorites = false;
        _state.page = 1; renderChrome(); loadMaterials();
      });
      var create = grid.querySelector('[data-plaza-create]');
      if (create) create.addEventListener('click', openCreateCourse);
    } else {
      grid.innerHTML = data.items.map(function (item) { return item.kind === 'group' ? groupHtml(item, _groups.indexOf(item)) : cardHtml(item); }).join('');
    }
    renderPager(data.page, data.total_pages);
  }

  function contributorHtml(item) {
    var name = item.uploader || '匿名';
    var initial = name.trim().charAt(0) || '匿';
    var image = item.uploader_avatar
      ? '<img src="' + esc(item.uploader_avatar) + '" alt="" loading="lazy" onerror="this.hidden=true">'
      : '';
    return '<span class="pc-contributor"><span class="pc-avatar" aria-hidden="true">' +
      esc(initial) + image + '</span><span class="pc-uploader">' + esc(name) + '</span></span>';
  }

  function closeGroup(restoreFocus) {
    clearTimeout(_groupTimer);
    clearTimeout(_groupCloseTimer);
    _groupCloseTimer = null;
    _groupIntent = null;
    _groupTimer = null;
    if (!_openGroup) return;
    var trigger = _openGroup.querySelector('[data-plaza-group-open]');
    _openGroup.classList.remove('is-open');
    _openGroup.querySelector('.plaza-stack-preview').inert = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    _openGroup = null;
    _groupByHover = false;
    if (restoreFocus && trigger) { _suppressGroupFocus = true; trigger.focus(); _suppressGroupFocus = false; }
  }

  function openGroup(stack, byHover) {
    if (!stack || _openGroup === stack) return;
    closeGroup();
    _openGroup = stack;
    _groupByHover = !!byHover;
    var rect = stack.querySelector('[data-plaza-group-open]').getBoundingClientRect();
    var cards = stack.querySelectorAll('.plaza-stack-cards .plaza-card');
    var narrow = window.innerWidth <= 640;
    var width = Math.min(narrow ? Math.max(150, window.innerWidth * .46) : 260, window.innerWidth - 24);
    var height = 166;
    var startX = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + (rect.width - width) / 2));
    var startY = Math.max(12, Math.min(window.innerHeight - height - 12, rect.top + (rect.height - height) / 2));
    var leftSpace = Math.max(0, startX - 24);
    var rightSpace = Math.max(0, window.innerWidth - width - 24 - startX);
    var topSpace = Math.max(0, startY - 24);
    var bottomSpace = Math.max(0, window.innerHeight - height - 24 - startY);
    var horizontal = rightSpace >= leftSpace ? 1 : -1;
    var sideSpace = horizontal > 0 ? rightSpace : leftSpace;
    var upCount = 0;
    var downCount = 0;
    var slots = [{ vertical: 0, rank: 0 }];
    for (var slot = 1; slot < cards.length; slot++) {
      var nextUp = topSpace / (upCount + 1);
      var nextDown = bottomSpace / (downCount + 1);
      var vertical = downCount > upCount && nextUp >= 75 ? -1
        : upCount > downCount && nextDown >= 75 ? 1
        : nextDown >= nextUp ? 1 : -1;
      slots.push({ vertical: vertical, rank: vertical > 0 ? ++downCount : ++upCount });
    }
    var upStep = upCount ? Math.min(narrow ? 125 : 140, topSpace / upCount) : 0;
    var downStep = downCount ? Math.min(narrow ? 125 : 140, bottomSpace / downCount) : 0;
    var maxDistance = Math.max(upCount * upStep, downCount * downStep);
    var radius = Math.max(180, maxDistance * 1.15);
    cards.forEach(function (card, index) {
      var vertical = slots[index].vertical;
      var rank = slots[index].rank;
      var distance = rank * (vertical > 0 ? downStep : upStep);
      var curveOffset = radius - Math.sqrt(Math.max(0, radius * radius - distance * distance));
      var targetX = startX + horizontal * Math.min(sideSpace, curveOffset);
      var targetY = startY + vertical * distance;
      card.style.setProperty('--fan-left', startX + 'px');
      card.style.setProperty('--fan-top', startY + 'px');
      card.style.setProperty('--fan-width', width + 'px');
      card.style.setProperty('--fan-dx', (targetX - startX) + 'px');
      card.style.setProperty('--fan-dy', (targetY - startY) + 'px');
      card.style.setProperty('--fan-angle', (horizontal * vertical * rank * 4) + 'deg');
      card.style.setProperty('--fan-delay', (index * 35) + 'ms');
      card.style.setProperty('--fan-layer', 1004 - rank);
    });
    stack.querySelector('.plaza-stack-preview').inert = false;
    stack.classList.add('is-open');
    stack.querySelector('[data-plaza-group-open]').setAttribute('aria-expanded', 'true');
  }

  function groupHtml(group, index) {
    var first = group.items[0];
    return '<div class="plaza-stack">' +
      '<button type="button" class="plaza-stack-trigger" data-plaza-group-open aria-expanded="false" aria-label="展开 ' + esc(first.course_name + ' ' + first.teacher + ' ' + first.material_type) + '，共 ' + group.count + ' 份">' +
        '<span class="plaza-stack-sheet plaza-stack-sheet-back" aria-hidden="true"></span><span class="plaza-stack-sheet plaza-stack-sheet-mid" aria-hidden="true"></span>' +
        '<span class="plaza-stack-front"><span class="pc-course"><span class="pc-course-name">' + esc(first.course_name) + '</span><span class="pc-teacher"> · ' + esc(first.teacher.trim()) + '</span></span>' +
        '<span class="pc-type">' + esc(first.material_type) + '</span><strong>' + esc(first.material_type) + '资料</strong><span>共 ' + group.count + ' 份</span>' +
        '<span class="plaza-stack-titles">' + group.items.slice(0, 2).map(function (item) { return esc(item.title); }).join('<br>') + '</span></span></button>' +
      '<button type="button" class="plaza-stack-hint" data-plaza-group-more="' + index + '" aria-label="查看 ' + esc(first.course_name + ' ' + first.teacher.trim() + ' ' + first.material_type) + '的全部资料">查看全部 ›</button>' +
      '<div class="plaza-stack-preview" inert><div class="plaza-stack-backdrop" data-plaza-group-close></div>' +
        '<div class="plaza-stack-cards" aria-label="资料预览">' + group.items.map(function (item, i) { return cardHtml(item, i === 0 ? { index: index, count: group.count } : null); }).join('') + '</div></div></div>';
  }

  function cardHtml(item, group) {
    var favorite = item.is_favorited;
    var teacher = item.teacher ? ' · ' + esc(item.teacher) : '';
    var courseName = item.course_name || '未关联课程';
    var course = item.course_category_id
      ? '<button type="button" class="pc-course-btn" data-plaza-course="' + item.course_category_id + '">' + esc(courseName) + '</button>'
      : '<span class="pc-course-name">' + esc(courseName) + '</span>';
    return '<article class="plaza-card" data-id="' + item.id + '" tabindex="0" role="link" aria-label="查看资料：' + esc(item.title) + '">' +
      '<div class="pc-head">' +
        '<div class="pc-course">' + course + (item.teacher ? '<span class="pc-teacher">' + teacher + '</span>' : '') + '</div>' +
        '<div class="pc-tags"><span class="pc-type">' + esc(item.material_type || '其他') + '</span>' +
          (item.format ? '<span class="pc-format">' + esc(item.format.toUpperCase()) + '</span>' : '') +
          (item.is_pinned ? '<span class="pc-pin">' + iconSvg('pin') + '置顶</span>' : '') +
        '</div>' +
      '</div>' +
      '<h3 class="pc-title">' + esc(item.title) + '</h3>' +
      (group ? '<button type="button" class="plaza-stack-more" data-plaza-group-more="' + group.index + '">查看全部 ' + group.count + ' 份 <span aria-hidden="true">→</span></button>' : '') +
      (item.description ? '<p class="pc-desc">' + esc(item.description) + '</p>' : '') +
      '<div class="pc-meta">' + contributorHtml(item) +
        '<span class="pc-date">' + esc(item.created_at) + '</span>' +
        '<div class="pc-actions">' +
          '<button type="button" class="pc-action" data-plaza-download="' + item.id + '" aria-label="下载 ' + esc(item.title) + '">' +
            FD_ICONS.download + '<span>' + item.download_count + '</span></button>' +
          '<button type="button" class="pc-action pc-fav' + (favorite ? ' is-on' : '') + '" data-plaza-fav="' + item.id + '" aria-pressed="' + favorite + '" aria-label="' + (favorite ? '取消收藏' : '收藏') + ' ' + esc(item.title) + '">' +
            (favorite ? FD_ICONS.starFilled : FD_ICONS.star) + '<span>' + item.favorite_count + '</span></button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function renderPager(page, totalPages) {
    var host = document.getElementById('plazaPager');
    if (!host) return;
    if (!totalPages || totalPages <= 1) { host.innerHTML = ''; return; }
    var pages = typeof getPageNumbers === 'function' ? getPageNumbers(page, totalPages) : [1, totalPages];
    host.innerHTML =
      '<button type="button" class="fp-btn fp-prev' + (page <= 1 ? ' fp-disabled' : '') + '" data-plaza-page="' + (page - 1) + '" aria-label="上一页"' + (page <= 1 ? ' disabled' : '') + '>' + iconSvg('chevron-left') + '</button>' +
      pages.map(function (value) {
        if (value === '…') return '<span class="fp-btn fp-ellipsis" aria-hidden="true">…</span>';
        return '<button type="button" class="fp-btn fp-num' + (value === page ? ' fp-active' : '') + '" data-plaza-page="' + value + '" aria-current="' + (value === page ? 'page' : 'false') + '">' + value + '</button>';
      }).join('') +
      '<button type="button" class="fp-btn fp-next' + (page >= totalPages ? ' fp-disabled' : '') + '" data-plaza-page="' + (page + 1) + '" aria-label="下一页"' + (page >= totalPages ? ' disabled' : '') + '>' + iconSvg('chevron-right') + '</button>';
  }

  function renderBreadcrumb() {
    var host = document.getElementById('plazaBreadcrumb');
    if (!host || !_nav) return;
    host.innerHTML = '';
    host.classList.remove('bc-expanded');
    var home = document.createElement('a');
    home.href = '/';
    home.textContent = '首页';
    home.addEventListener('click', function (event) { event.preventDefault(); showHome(); });
    host.appendChild(home);

    var lastMid = _nav.path.length - 2;
    var ellipsis = null;
    if (lastMid >= 0) {
      ellipsis = document.createElement('button');
      ellipsis.type = 'button';
      ellipsis.className = 'bc-ellipsis';
      ellipsis.textContent = '⋯';
      ellipsis.title = '显示完整路径';
      ellipsis.setAttribute('aria-label', '显示完整路径');
      ellipsis.addEventListener('click', function () { host.classList.add('bc-expanded'); });
    }

    _nav.path.forEach(function (level, index) {
      var isLast = index === _nav.path.length - 1;
      var separator = document.createElement('span');
      separator.className = 'bc-sep' + (!isLast && index > 0 ? ' bc-mid' : '');
      separator.textContent = ' / ';
      host.appendChild(separator);

      if (isLast) {
        var current = document.createElement('span');
        current.className = 'bc-current';
        current.textContent = level.name;
        host.appendChild(current);
      } else {
        var link = document.createElement('button');
        link.type = 'button';
        link.className = 'plaza-crumb-link bc-mid';
        link.textContent = level.name;
        link.setAttribute('aria-label', '返回' + level.name);
        link.addEventListener('click', function () { navigateCategory(level.id); });
        host.appendChild(link);
      }

      if (level.siblings && level.siblings.length > 1) {
        var switchWrap = document.createElement('span');
        switchWrap.className = 'plaza-crumb-switch' + (isLast ? '' : ' bc-mid');
        var arrow = document.createElement('span');
        arrow.className = 'plaza-crumb-toggle';
        arrow.setAttribute('aria-hidden', 'true');
        var select = document.createElement('select');
        select.className = 'plaza-crumb-select';
        select.setAttribute('aria-label', index === 0 ? '切换课程范围' : '切换' + level.name + '同级目录');
        (level.siblings || []).forEach(function (sibling) {
          var option = document.createElement('option');
          option.value = sibling.id;
          option.textContent = sibling.name || '未命名目录';
          if (sibling.is_current) option.selected = true;
          select.appendChild(option);
        });
        select.addEventListener('change', function () {
          var id = parseInt(select.value, 10);
          if (!id || id === level.id) return;
          if (index === 0) switchPlazaRange(select.options[select.selectedIndex].textContent);
          else navigateCategory(id);
        });
        switchWrap.appendChild(arrow);
        switchWrap.appendChild(select);
        host.appendChild(switchWrap);
      }
      if (index === lastMid && ellipsis) host.appendChild(ellipsis);
    });
  }

  function renderTreeHost() {
    var host = document.getElementById('plazaBreadcrumb');
    if (!host) return;
    var old = host.querySelector('.plaza-tree-btn');
    if (old) old.remove();
    if (!_nav || !_nav.can_expand_tree) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'plaza-tree-btn';
    button.setAttribute('aria-label', '展开课程树');
    button.innerHTML = iconSvg('layers') + '<span>展开课程树</span>';
    button.addEventListener('click', openCourseTree);
    host.appendChild(button);
  }

  function navigateCategory(categoryId, replace) {
    if (!categoryId || categoryId === _state.categoryId) return;
    saveSession();
    show({ categoryId: categoryId, keepFilters: true, page: 1, replace: !!replace });
  }

  function returnToPlazaState() {
    var path = (_nav && _nav.path ? _nav.path : []).map(function (level) {
      return { id: level.id, name: level.name };
    });
    if (!path.length && _state.categoryId) {
      path = [{ id: _state.categoryId, name: _nav ? _nav.name : '资料广场' }];
    }
    return { categoryId: _state.categoryId, path: path };
  }

  function openDetail(fileId) {
    if (!currentUser) { showLoginModal(); return; }
    var item = _items.filter(function (row) { return row.id === fileId; })[0];
    if (typeof showFileDetail !== 'function') return;
    showFileDetail({
      id: fileId,
      title: item ? item.title : '',
      course_code: item ? item.course_code : '',
      course_name: item ? item.course_name : '',
    }, { returnPlaza: returnToPlazaState() });
  }

  function toggleFavorite(fileId, button) {
    if (!currentUser) { showLoginModal(); return; }
    api('/api/files/' + fileId + '/favorite/', { method: 'POST' }).then(function (data) {
      var item = _items.filter(function (row) { return row.id === fileId; })[0];
      if (item) {
        item.is_favorited = !!data.favorited;
        item.favorite_count = Math.max(0, (item.favorite_count || 0) + (data.favorited ? 1 : -1));
      }
      button.classList.toggle('is-on', !!data.favorited);
      button.setAttribute('aria-pressed', data.favorited ? 'true' : 'false');
      button.innerHTML = (data.favorited ? FD_ICONS.starFilled : FD_ICONS.star) +
        '<span>' + (item ? item.favorite_count : '') + '</span>';
      if (_state.favorites) loadMaterials();
    }).catch(function (error) {
      alert(error && error.message ? error.message : '收藏失败，请稍后重试');
    });
  }

  // ── 浮层：同级菜单 / 课程树 / 筛选 / 分享选课 ──
  function openOverlay(kind, html, options) {
    closeOverlay(true);
    var overlay = document.createElement('div');
    overlay.className = 'plaza-overlay plaza-overlay--' + kind;
    overlay.innerHTML = '<div class="plaza-dialog" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(overlay);
    _overlay = overlay;
    var initialFocus = overlay.querySelector('[autofocus]') || overlay.querySelector('.plaza-close');
    if (initialFocus) initialFocus.setAttribute('autofocus', '');
    lockScroll();
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeOverlay();
    });
    overlay.querySelectorAll('.plaza-close').forEach(function (button) {
      button.addEventListener('click', function () { closeOverlay(); });
    });
    if (typeof _pushModalHistory === 'function') _pushModalHistory(overlay);
    else if (typeof activateDialog === 'function') activateDialog(overlay);
    if (options && options.onMount) options.onMount(overlay);
    return overlay;
  }

  function closeOverlay(fromHistory) {
    if (!_overlay) return;
    var overlay = _overlay;
    _overlay = null;
    _tree = null;
    overlay.remove();
    unlockScroll();
    if (fromHistory) {
      if (typeof deactivateDialog === 'function') deactivateDialog(overlay);
    } else if (typeof _popModalHistory === 'function') {
      _popModalHistory(overlay);
    }
  }

  function openCourseTree() {
    if (!_nav || !_nav.can_expand_tree) return;
    _tree = { selectedId: _nav.category_id, nav: _nav, seq: 0 };
    openOverlay('tree', '<div class="plaza-overlay-head"><div><span class="plaza-kicker">课程树</span><h3>展开课程树</h3></div>' +
      '<button type="button" class="plaza-close" aria-label="关闭">' + iconSvg('close') + '</button></div>' +
      '<div class="plaza-tree-body" id="plazaTreeBody"></div>' +
      '<div class="plaza-overlay-foot"><button type="button" class="plaza-secondary" data-tree-apply>查看此目录资料</button></div>',
      { onMount: function (overlay) {
        overlay.querySelector('[data-tree-apply]').addEventListener('click', function () {
          var id = _tree && _tree.selectedId;
          if (id) navigateCategory(id, true);
        });
        renderCourseTree(false);
      } });
  }

  function renderCourseTree(focusFirst) {
    var body = document.getElementById('plazaTreeBody');
    if (!body || !_tree) return;
    var nav = _tree.nav;
    var pathButtons = nav.path.map(function (level, index) {
      var label = index === nav.path.length - 1 ? '<strong>' + esc(level.name) + '</strong>' : esc(level.name);
      return '<button type="button" class="plaza-tree-crumb" data-tree-jump="' + level.id + '">' + label + '</button>';
    }).join('<span class="plaza-tree-sep">/</span>');
    var parent = nav.path.length > 1 ? nav.path[nav.path.length - 2] : null;
    body.innerHTML =
      '<div class="plaza-tree-path">' + pathButtons + '</div>' +
      '<div class="plaza-tree-parent">' +
        (parent ? '<button type="button" class="plaza-tree-up" data-tree-jump="' + parent.id + '">← 返回' + esc(parent.name) + '</button>' : '') +
      '</div>' +
      (nav.children && nav.children.length
        ? '<div class="plaza-tree-list">' + nav.children.map(function (child) {
            if (child.is_course) {
              return '<button type="button" class="plaza-tree-row is-course" data-tree-course="' + child.id + '">' +
                '<span class="plaza-tree-row-name">' + esc(child.name || '未命名课程') + '</span><span class="plaza-tree-row-kind">课程</span></button>';
            }
            if (child.has_children) {
              return '<button type="button" class="plaza-tree-row" data-tree-folder="' + child.id + '">' +
                '<span class="plaza-tree-row-name">' + esc(child.name || '未命名目录') + '</span><span class="plaza-tree-row-kind">目录</span></button>';
            }
            return '<button type="button" class="plaza-tree-row is-empty" data-tree-folder="' + child.id + '">' +
              '<span class="plaza-tree-row-name">' + esc(child.name || '未命名目录') + '</span><span class="plaza-tree-row-kind">空目录</span></button>';
          }).join('') + '</div>'
        : '<div class="plaza-tree-empty">' + (nav.can_expand_tree ? '此目录暂无下级目录。' : '已经是具体课程。') + '</div>');

    body.querySelectorAll('[data-tree-jump]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectTreeNode(parseInt(button.getAttribute('data-tree-jump'), 10));
      });
    });
    body.querySelectorAll('[data-tree-folder]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectTreeNode(parseInt(button.getAttribute('data-tree-folder'), 10));
      });
    });
    body.querySelectorAll('[data-tree-course]').forEach(function (button) {
      button.addEventListener('click', function () {
        navigateCategory(parseInt(button.getAttribute('data-tree-course'), 10), true);
      });
    });
    var apply = document.querySelector('[data-tree-apply]');
    if (apply) apply.textContent = nav.name ? '查看「' + nav.name + '」的资料' : '查看此目录资料';
    if (focusFirst) {
      var focusTarget = body.querySelector('.plaza-tree-row') || body.querySelector('.plaza-tree-up');
      if (focusTarget) focusTarget.focus();
    }
  }

  function selectTreeNode(categoryId) {
    if (!_tree || !categoryId) return;
    var seq = ++_tree.seq;
    var body = document.getElementById('plazaTreeBody');
    if (body) body.innerHTML = '<div class="plaza-tree-empty">正在加载…</div>';
    fetchNavigation(categoryId, null).then(function (nav) {
      if (!_tree || seq !== _tree.seq) return;
      _tree.selectedId = nav.category_id;
      _tree.nav = nav;
      renderCourseTree(true);
    }).catch(function () {
      if (!_tree || seq !== _tree.seq) return;
      if (body) body.innerHTML = '<div class="plaza-tree-empty">目录加载失败，请重试。</div>';
    });
  }

  function openFilterSheet() {
    var facets = {
      material_types: Array.from(document.querySelectorAll('#plazaTypeSelect option')).slice(1).map(function (option) {
        return { id: option.value, name: option.textContent.replace(/（\d+）$/, '') };
      }),
      formats: Array.from(document.querySelectorAll('#plazaFormatSelect option')).slice(1).map(function (option) {
        return { value: option.value, name: option.textContent.replace(/（\d+）$/, '') };
      }),
    };
    var body = '<div class="plaza-overlay-head"><h3>筛选与排序</h3>' +
      '<button type="button" class="plaza-close" aria-label="关闭">' + iconSvg('close') + '</button></div>' +
      '<div class="plaza-sheet-fields">' +
        filterPillHtml({
          block: true, label: '类型', id: 'plazaSheetType', aria: '资料类型筛选',
          options: '<option value="">全部</option>' +
            facets.material_types.map(function (type) { return '<option value="' + type.id + '">' + esc(type.name) + '</option>'; }).join('')
        }) +
        filterPillHtml({
          block: true, label: '格式', id: 'plazaSheetFormat', aria: '文件格式筛选',
          options: '<option value="">全部</option>' +
            facets.formats.map(function (format) { return '<option value="' + format.value + '">' + esc(format.name) + '</option>'; }).join('')
        }) +
        filterPillHtml({
          block: true, label: '排序', id: 'plazaSheetSort', aria: '排序方式', value: '智能推荐',
          options: '<option value="smart">智能推荐</option><option value="latest">最新上传</option><option value="downloads">下载最多</option><option value="favorites">收藏最多</option>'
        }) +
      '</div>' +
      '<div class="plaza-overlay-foot"><button type="button" class="plaza-secondary" data-sheet-reset>重置</button>' +
      '<button type="button" class="plaza-primary" data-sheet-apply>应用筛选</button></div>';
    openOverlay('sheet', body, { onMount: function (overlay) {
      var type = overlay.querySelector('#plazaSheetType');
      var format = overlay.querySelector('#plazaSheetFormat');
      var sort = overlay.querySelector('#plazaSheetSort');
      type.value = _state.materialType || '';
      format.value = _state.format || '';
      sort.value = _state.sort;
      [type, format, sort].forEach(syncSelectPill);
      overlay.querySelector('[data-sheet-reset]').addEventListener('click', function () {
        type.value = ''; format.value = ''; sort.value = 'smart';
        [type, format, sort].forEach(syncSelectPill);
      });
      overlay.querySelector('[data-sheet-apply]').addEventListener('click', function () {
        _state.materialType = type.value ? parseInt(type.value, 10) : null;
        _state.format = format.value || '';
        _state.sort = sort.value;
        _state.page = 1;
        closeOverlay();
        renderChrome();
        loadMaterials();
      });
    } });
  }

  function openCreateCourse() {
    var context = _nav && _nav.course_type === 'major' ? _nav.path : null;
    closeOverlay(true);
    if (history.state && history.state._modal) {
      history.replaceState(Object.assign({ _bnusparks: true, view: 'plaza' }, historyState()), '', location.href);
    }
    if (typeof openNewCourseEntry === 'function') openNewCourseEntry({ path: context });
  }

  function openUploadEntry() {
    if (!currentUser) { showLoginModal(); return; }
    var ensureUpload = typeof showUploadModal === 'function'
      ? Promise.resolve()
      : (typeof ensureFeature === 'function' ? ensureFeature('plaza') : Promise.resolve());
    ensureUpload.then(function () {
      if (_nav && !_nav.can_expand_tree && _nav.course_code) {
        fetchNavigation(_nav.category_id, _nav.course_type).then(function (nav) {
          _nav = nav;
          showUploadModal(nav.course_code, nav.name, nav.category_id);
        }).catch(function () { showUploadModal(_nav.course_code, _nav.name, _nav.category_id); });
        return;
      }
      if (!_nav) return;
      api('/api/courses/navigation/?category_id=' + _nav.category_id + '&courses=1').then(function (nav) {
        var courses = nav.courses || [];
        var body = '<div class="plaza-overlay-head"><div><span class="plaza-kicker">上传文件</span><h3>选择课程</h3></div>' +
          '<button type="button" class="plaza-close" aria-label="关闭">' + iconSvg('close') + '</button></div>' +
          (courses.length
            ? '<label class="plaza-menu-search">' + iconSvg('search') + '<input type="search" id="plazaCourseSearch" autofocus placeholder="搜索课程名称或代码" aria-label="搜索课程"></label>' +
              '<div class="plaza-course-list" id="plazaCourseList">' + courses.map(function (course) {
                return '<button type="button" class="plaza-course-row" data-course-code="' + esc(course.code) + '" data-course-name="' + esc(course.name) + '" data-course-cat="' + (course.category_id || '') + '">' +
                  '<span class="plaza-course-row-name">' + esc(course.name) + '</span><span class="plaza-course-row-code">' + (/^BNUX[0-9A-F]{32}$/i.test(course.code || '') ? '代码待补充' : esc(course.code)) + '</span></button>';
              }).join('') + '</div>'
            : '<div class="plaza-state"><p>当前范围还没有课程。</p><button type="button" class="plaza-upload" id="plazaCreateCourse">创建课程</button></div>');
        openOverlay('picker', body, { onMount: function (overlay) {
          var createCourse = overlay.querySelector('#plazaCreateCourse');
          if (createCourse) createCourse.addEventListener('click', openCreateCourse);
          var search = overlay.querySelector('#plazaCourseSearch');
          if (search) {
            search.addEventListener('input', function () {
              var value = search.value.trim().toLowerCase();
              overlay.querySelectorAll('[data-course-code]').forEach(function (row) {
                var haystack = (row.getAttribute('data-course-code') + ' ' + row.getAttribute('data-course-name')).toLowerCase();
                row.hidden = !!value && haystack.indexOf(value) === -1;
              });
            });
          } else {
            var firstCourse = overlay.querySelector('[data-course-code]');
            if (firstCourse) setTimeout(function () { firstCourse.focus(); }, 0);
          }
          overlay.querySelectorAll('[data-course-code]').forEach(function (row) {
            row.addEventListener('click', function () {
              var code = row.getAttribute('data-course-code');
              var name = row.getAttribute('data-course-name');
              var cat = row.getAttribute('data-course-cat');
              closeOverlay(true);
              showUploadModal(code, name, cat ? parseInt(cat, 10) : null);
            });
          });
        } });
      }).catch(function (error) {
        alert(error && error.message ? error.message : '课程加载失败');
      });
    });
  }

  window.addEventListener('bnuauthchange', function () {
    var view = document.getElementById('plazaView');
    if (!_active || !view || !view.classList.contains('active')) return;
    if (!currentUser && _state.favorites) {
      _state.favorites = false;
      _state.page = 1;
      renderChrome();
    }
    loadMaterials();
  });

  window.BnuPlaza = {
    show: show,
    getState: function () { return Object.assign({}, _state); },
    getCategoryId: function () { return _state.categoryId; },
    getRange: function () { return rangeOfNav(); },
    switchToDirectory: switchToDirectory,
    reload: loadMaterials,
  };
  window.closePlazaOverlay = closeOverlay;
})();
