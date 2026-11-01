/* BNU Sparks · search.js —— 独立搜索结果页（v=350）
   顶栏搜索与问答搜索的结果页：三类内容聚合、分类列表、真实计数、
   筛选排序、分页、账号隔离与完整错误生命周期。
   公开能力：BnuSearch.render(state, opts) / suspend() / reset()
   依赖：utils.js（api/esc/escJs/iconSvg/scrollToInstant/getPageNumbers）、
        views.js（showSearch/pushViewState/patchViewState）、
        explorer-core.js（navToCoursePath，课程结果按需等待）、qa.js（qaOpenDetail，按需加载）。
*/
(function () {
  'use strict';

  var TYPES = ['all', 'course', 'material', 'qa'];
  var TYPE_LABELS = { all: '全部', course: '课程', material: '资料', qa: '问答' };
  var ALL_PREVIEW = { course: 3, material: 3, qa: 2 };
  var PAGE_SIZE = { course: 20, material: 20, qa: 10 };
  var SORTS = {
    course: [['relevance', '相关度'], ['name', '名称']],
    material: [['relevance', '相关度'], ['latest', '最新上传'], ['downloads', '下载最多']],
    qa: [['default', '默认'], ['latest', '最新']],
  };
  var MAX_SNAPSHOTS = 12;

  // ── 模块状态 ──
  var renderGen = 0;            // 渲染代次：render/suspend/reset 递增，过期回调全部丢弃
  var controllers = [];         // 本代次在途请求
  var snapshots = new Map();    // 请求签名 → { data, ts, ownerId, gen }（仅当前账号内存）
  var countsCache = new Map();  // 关键词 → { ownerId, gen, course, material, qa }
  var current = null;           // 当前渲染的搜索状态
  var currentEntryId = null;
  var monitoredExecute = null;  // 已记录无结果的一次提交（entryId）
  var qaTagsPromise = null;     // 问答两级标签（/api/qa/tags/ 公开）
  var guestModalShown = false;
  var toolbarFocusKey = null;   // 筛选控件焦点保持
  var filterExpanded = null;    // 窄屏筛选展开态（null=按视口默认折叠；true=用户展开）
  var groupState = {};          // type → {status, data, error}

  // ── 小工具 ──
  function escValue(v) { return v == null ? '' : String(v); }

  function accountGen() { return window._bnuAuthGeneration || 0; }

  function ownerId() { return currentUser && currentUser.id ? currentUser.id : null; }

  function defaultFilters() {
    return {
      course_type: '', college: null,
      material_type: null, format: '',
      tag_l1: null, tag_l2: null,
    };
  }

  function normalizeState(raw) {
    var st = raw && raw._bnusparks ? raw : {};
    var type = TYPES.indexOf(st.searchType) >= 0 ? st.searchType : 'all';
    var filters = Object.assign(defaultFilters(), st.searchFilters || {});
    return {
      view: 'search',
      searchQuery: String(st.searchQuery || '').trim().slice(0, 200),
      searchType: type,
      searchPage: parseInt(st.searchPage, 10) >= 1 ? parseInt(st.searchPage, 10) : 1,
      searchSort: st.searchSort || (type === 'qa' ? 'default' : 'relevance'),
      searchFilters: filters,
      searchEntryId: st.searchEntryId || null,
      searchOwnerId: st.searchOwnerId === undefined ? null : st.searchOwnerId,
      searchSource: st.searchSource || null,
      searchFocusKey: st.searchFocusKey || null,
      scrollY: parseInt(st.scrollY, 10) || 0,
      _seq: st._seq,
    };
  }

  function filtersFor(type, filters) {
    // 全部页不携带分类筛选；分类页只保留本类型适用的键
    var out = defaultFilters();
    if (type !== 'course' && type !== 'material') return out;
    out.course_type = filters.course_type === 'major' || filters.course_type === 'general' ? filters.course_type : '';
    out.college = parseInt(filters.college, 10) >= 1 ? parseInt(filters.college, 10) : null;
    if (out.course_type === 'general') out.college = null; // 通识与学院不兼容：前端主动清除
    if (type === 'material') {
      out.material_type = parseInt(filters.material_type, 10) >= 1 ? parseInt(filters.material_type, 10) : null;
      out.format = String(filters.format || '').toLowerCase().replace(/^\./, '').slice(0, 20);
    }
    return out;
  }

  function signature(state) {
    var f = state.searchFilters;
    return [state.searchQuery, state.searchType, state.searchPage,
      state.searchSort, f.course_type || '', f.college || '', f.material_type || '',
      f.format || '', f.tag_l1 || '', f.tag_l2 || ''].join('|');
  }

  function countsSignature(q) { return String(q); }

  function rememberSnapshot(key, data) {
    snapshots.set(key, { data: data, ts: Date.now(), ownerId: ownerId(), gen: accountGen() });
    if (snapshots.size > MAX_SNAPSHOTS) {
      var first = snapshots.keys().next();
      if (!first.done) snapshots.delete(first.value);
    }
  }

  function snapshotFor(key) {
    var hit = snapshots.get(key);
    if (!hit) return null;
    if (hit.ownerId !== ownerId() || hit.gen !== accountGen()) {
      snapshots.delete(key);
      return null;
    }
    return hit;
  }

  // ── 请求 ──
  function trackRequest(ctrl) { controllers.push(ctrl); }

  function fetchGroup(type, state, pageSize, gen) {
    var q = state.searchQuery;
    var filters = filtersFor(type, state.searchFilters);
    var sort = type === 'qa'
      ? (state.searchSort === 'latest' ? 'latest' : 'default')
      : (SORTS[type].some(function (s) { return s[0] === state.searchSort; }) ? state.searchSort : 'relevance');
    var page = Math.max(1, parseInt(state.searchPage, 10) || 1);
    var ctrl = new AbortController();
    trackRequest(ctrl);
    var url;
    if (type === 'qa') {
      url = '/api/qa/search/?v=2&q=' + encodeURIComponent(q) + '&page=' + page + '&pageSize=' + pageSize;
      if (sort === 'latest') url += '&sort=latest';
      if (filters.tag_l1) url += '&tag_l1=' + filters.tag_l1;
      if (filters.tag_l2) url += '&tag_l2=' + filters.tag_l2;
    } else {
      url = '/api/search/?v=2&type=' + type + '&q=' + encodeURIComponent(q) +
        '&page=' + page + '&page_size=' + pageSize;
      if (sort !== 'relevance') url += '&sort=' + encodeURIComponent(sort);
      if (filters.course_type) url += '&course_type=' + filters.course_type;
      if (filters.college) url += '&college=' + filters.college;
      if (type === 'material') {
        if (filters.material_type) url += '&material_type=' + filters.material_type;
        if (filters.format) url += '&format=' + encodeURIComponent(filters.format);
      }
    }
    var genAtStart = accountGen();
    return api(url, { signal: ctrl.signal }).then(
      function (data) {
        if (gen !== renderGen || accountGen() !== genAtStart) { throw { __stale: true }; }
        return data;
      },
      function (err) {
        if (gen !== renderGen || accountGen() !== genAtStart) { throw { __stale: true }; }
        throw err;
      });
  }

  function fetchCounts(q, gen) {
    // Tab 计数：轻量请求（每页 1 条）取未附加筛选总数；同关键词复用
    var key = countsSignature(q);
    var hit = countsCache.get(key);
    if (hit && hit.ownerId === ownerId() && hit.gen === accountGen()) return Promise.resolve(hit);
    var entry = { ownerId: ownerId(), gen: accountGen(), course: null, material: null, qa: null };
    countsCache.set(key, entry);
    var state = { searchQuery: q, searchFilters: defaultFilters(), searchPage: 1, searchSort: 'relevance' };
    var types = ['course', 'material', 'qa'];
    return Promise.all(types.map(function (type) {
      return fetchGroup(type, state, 1, gen).then(function (data) {
        entry[type] = typeof data.keyword_total === 'number' ? data.keyword_total : 0;
      }, function () {
        entry[type] = 'error';
      });
    })).then(function () {
      if (gen !== renderGen) return entry;
      return entry;
    });
  }

  function cachedCounts(q) {
    var hit = countsCache.get(countsSignature(q));
    if (hit && hit.ownerId === ownerId() && hit.gen === accountGen()) return hit;
    return null;
  }

  function loadQaTags() {
    if (qaTagsPromise) return qaTagsPromise;
    qaTagsPromise = api('/api/qa/tags/').then(function (data) {
      return { l1: data.l1 || [], l2: data.l2 || [] };
    }).catch(function () {
      qaTagsPromise = null;
      return { l1: [], l2: [], error: true };
    });
    return qaTagsPromise;
  }

  // ── 高亮（文本节点分段插入 <mark>，不经 HTML 拼接）──
  function highlightInto(el, text, query) {
    var raw = escValue(text);
    var ql = query.toLowerCase();
    if (!raw) return;
    if (!ql) { el.appendChild(document.createTextNode(raw)); return; }
    var lower = raw.toLowerCase();
    var idx = 0, hit;
    while ((hit = lower.indexOf(ql, idx)) >= 0) {
      if (hit > idx) el.appendChild(document.createTextNode(raw.slice(idx, hit)));
      var mark = document.createElement('mark');
      mark.className = 'sr-mark';
      mark.textContent = raw.slice(hit, hit + query.length);
      el.appendChild(mark);
      idx = hit + query.length;
    }
    if (idx < raw.length) el.appendChild(document.createTextNode(raw.slice(idx)));
  }

  function highlightSpan(text, query) {
    var span = document.createElement('span');
    highlightInto(span, text, query);
    return span;
  }

  // ── 课程路径选择：本人专业 → 本人学院 → 默认首条（与 findPathByCourseId 一致）──
  function pickPath(paths) {
    if (!paths || !paths.length) return null;
    var idMaj = currentUser && currentUser.identity_major;
    var idCol = currentUser && currentUser.identity_college;
    var p, i;
    if (idMaj) {
      for (i = 0; i < paths.length; i++) {
        p = paths[i];
        if (p.segments[0] === '专业课' && p.segments.length >= 4 && p.segments[2] === idMaj) return p;
      }
    }
    if (idCol) {
      for (i = 0; i < paths.length; i++) {
        p = paths[i];
        if (p.segments[0] === '专业课' && p.segments.length >= 3 && p.segments[1] === idCol) return p;
      }
    }
    return paths[0];
  }

  function explorerHref(segments) {
    return '/explorer/' + segments.map(encodeURIComponent).join('/');
  }

  function formatDay(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso || '');
    try {
      if (String(new Date().getFullYear()) === m[1]) return m[2] + '-' + m[3];
    } catch (e) { /* 保持完整 */ }
    return m[1] + '-' + m[2] + '-' + m[3];
  }

  // ── 结果行构建（真实 <a href>；普通左键拦截为 SPA 导航）──
  function courseItemEl(item, q, opts) {
    opts = opts || {};
    var path = pickPath(item.paths);
    var row = document.createElement('div');
    row.className = 'sr-item sr-item--course';
    row.setAttribute('data-focus-key', 'course:' + item.id);

    var main = document.createElement('div');
    main.className = 'sr-item-main';
    var title = document.createElement('a');
    title.className = 'sr-item-title';
    if (path) title.href = explorerHref(path.segments);
    else title.href = 'javascript:void(0)';
    title.setAttribute('data-sr-course', String(item.id));
    if (path) title.setAttribute('data-sr-path', JSON.stringify(path.segments));
    highlightInto(title, item.name || item.code || '（未命名课程）', q);
    main.appendChild(title);

    var meta = document.createElement('div');
    meta.className = 'sr-item-meta';
    var badge = document.createElement('span');
    badge.className = 'sr-badge ' + (item.course_type === 'general' ? 'sr-badge--general' : 'sr-badge--major');
    badge.textContent = item.course_type === 'general' ? '通识课' : '专业课';
    meta.appendChild(badge);
    var codes = (item.codes && item.codes.length ? item.codes : [item.code]).join(' · ');
    var codeEl = document.createElement('span');
    codeEl.className = 'sr-item-code';
    codeEl.textContent = codes;
    meta.appendChild(codeEl);
    if (item.college && item.college.name) {
      var colEl = document.createElement('span');
      colEl.className = 'sr-item-dim';
      colEl.textContent = item.college.name;
      meta.appendChild(colEl);
    }
    var cnt = document.createElement('span');
    cnt.className = 'sr-item-dim' + (item.approved_material_count ? '' : ' sr-item-dim--empty');
    cnt.textContent = item.approved_material_count ? item.approved_material_count + ' 份资料' : '暂无资料';
    meta.appendChild(cnt);
    main.appendChild(meta);

    // 搜索命中另一个显示名：解释匹配目录，不让结果看上去无关
    if (path && item.name && path.segments[path.segments.length - 1] !== item.name) {
      var aliasNote = document.createElement('div');
      aliasNote.className = 'sr-item-note';
      aliasNote.textContent = '匹配目录：' + path.segments[path.segments.length - 1];
      main.appendChild(aliasNote);
    } else if (item.matched_fields && item.matched_fields.length === 1 &&
               item.matched_fields[0] === 'code' && q &&
               (item.name || '').toLowerCase().indexOf(q.toLowerCase()) < 0) {
      var codeNote = document.createElement('div');
      codeNote.className = 'sr-item-note';
      codeNote.textContent = '按课程代码命中';
      main.appendChild(codeNote);
    }

    // 多归属：内联展开目录列表（不只依赖 hover）
    if (item.paths && item.paths.length > 1) {
      var more = document.createElement('div');
      more.className = 'sr-paths';
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'sr-paths-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = '更多目录（' + item.paths.length + '）';
      var list = document.createElement('div');
      list.className = 'sr-paths-list';
      list.hidden = true;
      item.paths.forEach(function (p) {
        var link = document.createElement('a');
        link.className = 'sr-path-link';
        link.href = explorerHref(p.segments);
        link.setAttribute('data-sr-course', String(item.id));
        link.setAttribute('data-sr-path', JSON.stringify(p.segments));
        link.textContent = p.segments.join(' / ');
        list.appendChild(link);
      });
      toggle.addEventListener('click', function () {
        var open = list.hidden;
        list.hidden = !open;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.textContent = open ? '收起目录' : '更多目录（' + item.paths.length + '）';
      });
      more.appendChild(toggle);
      more.appendChild(list);
      main.appendChild(more);
    }

    row.appendChild(main);
    var arrow = document.createElement('span');
    arrow.className = 'sr-item-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    row.appendChild(arrow);
    return row;
  }

  function materialItemEl(item, q) {
    var row = document.createElement('div');
    row.className = 'sr-item sr-item--material';
    row.setAttribute('data-focus-key', 'material:' + item.id);
    var main = document.createElement('div');
    main.className = 'sr-item-main';
    var title = document.createElement('a');
    title.className = 'sr-item-title';
    title.href = '/file/' + parseInt(item.id, 10);
    title.setAttribute('data-sr-file', String(item.id));
    highlightInto(title, item.title || '（未命名资料）', q);
    main.appendChild(title);

    if (item.snippet) {
      var sn = document.createElement('div');
      sn.className = 'sr-item-snippet';
      highlightInto(sn, item.snippet, q);
      main.appendChild(sn);
    }

    var meta = document.createElement('div');
    meta.className = 'sr-item-meta';
    if (item.material_type && item.material_type.name) {
      var t = document.createElement('span');
      t.className = 'sr-badge sr-badge--type';
      t.textContent = item.material_type.name;
      meta.appendChild(t);
    }
    if (item.file_type) {
      var f = document.createElement('span');
      f.className = 'sr-badge sr-badge--format';
      f.textContent = item.file_type.toUpperCase();
      meta.appendChild(f);
    }
    if (item.course && (item.course.name || item.course.code)) {
      var c = document.createElement('span');
      c.className = 'sr-item-dim';
      c.textContent = item.course.name || item.course.code;
      meta.appendChild(c);
    }
    if (item.matched_fields && item.matched_fields.indexOf('teacher') >= 0 && item.teacher) {
      var tm = document.createElement('span');
      tm.className = 'sr-item-note sr-item-note--inline';
      tm.textContent = '命中教师：' + item.teacher;
      meta.appendChild(tm);
    } else if (item.teacher) {
      var th = document.createElement('span');
      th.className = 'sr-item-dim';
      th.textContent = item.teacher;
      meta.appendChild(th);
    }
    var d = document.createElement('span');
    d.className = 'sr-item-dim';
    d.textContent = formatDay(item.created_at);
    meta.appendChild(d);
    main.appendChild(meta);
    row.appendChild(main);
    var arrow = document.createElement('span');
    arrow.className = 'sr-item-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    row.appendChild(arrow);
    return row;
  }

  function qaItemEl(item, q) {
    var row = document.createElement('div');
    row.className = 'sr-item sr-item--qa';
    row.setAttribute('data-focus-key', 'qa:' + item.id);
    var main = document.createElement('div');
    main.className = 'sr-item-main';
    var title = document.createElement('a');
    title.className = 'sr-item-title';
    var qaHref = '/qa/questions/' + parseInt(item.id, 10);
    if (item.hit === 'answer' && item.answer_id) qaHref += '#answer-' + parseInt(item.answer_id, 10);
    title.href = qaHref;
    title.setAttribute('data-sr-qa', String(item.id));
    title.setAttribute('data-sr-qa-answer', item.hit === 'answer' && item.answer_id ? String(item.answer_id) : '');
    highlightInto(title, item.title || '（未命名问题）', q);
    main.appendChild(title);

    if (item.snippet) {
      var sn = document.createElement('div');
      sn.className = 'sr-item-snippet';
      highlightInto(sn, item.snippet, q);
      main.appendChild(sn);
    }

    var meta = document.createElement('div');
    meta.className = 'sr-item-meta';
    var hit = document.createElement('span');
    hit.className = 'sr-badge sr-badge--hit';
    hit.textContent = item.hit === 'answer' ? '命中回答' : '命中问题';
    meta.appendChild(hit);
    if (item.tag_l1) {
      var t1 = document.createElement('span');
      t1.className = 'sr-item-dim';
      t1.textContent = item.tag_l1;
      meta.appendChild(t1);
    }
    if (item.tag_l2) {
      var t2 = document.createElement('span');
      t2.className = 'sr-item-dim';
      t2.textContent = item.tag_l2;
      meta.appendChild(t2);
    }
    if (item.author) {
      var a = document.createElement('span');
      a.className = 'sr-item-dim';
      a.textContent = item.author;
      meta.appendChild(a);
    }
    var d = document.createElement('span');
    d.className = 'sr-item-dim';
    d.textContent = formatDay(item.created_at);
    meta.appendChild(d);
    main.appendChild(meta);
    row.appendChild(main);
    var arrow = document.createElement('span');
    arrow.className = 'sr-item-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    row.appendChild(arrow);
    return row;
  }

  function itemEl(type, item, q) {
    if (type === 'course') return courseItemEl(item, q);
    if (type === 'material') return materialItemEl(item, q);
    return qaItemEl(item, q);
  }

  // ── 区块渲染 ──
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function groupCard(type, count, countState) {
    var card = el('section', 'sr-group');
    card.setAttribute('data-sr-group', type);
    var head = el('div', 'sr-group-head');
    var label = el('h2', 'sr-group-title', TYPE_LABELS[type]);
    head.appendChild(label);
    var badge = el('span', 'sr-group-count',
      countState === 'loading' ? '…' : (countState === 'error' ? '—' : String(count)));
    if (countState === 'error') badge.title = '计数加载失败';
    head.appendChild(badge);
    card.appendChild(head);
    return card;
  }

  function errorCard(message, retryAttr) {
    var card = el('div', 'sr-error');
    card.setAttribute('role', 'alert');
    card.appendChild(el('div', 'sr-error-icon', iconSvg('alert') || '⚠'));
    card.appendChild(el('div', 'sr-error-title', '加载失败'));
    card.appendChild(el('div', 'sr-error-desc', message || '请检查网络后重试'));
    var retry = el('button', 'sr-retry-btn', '重试');
    retry.type = 'button';
    if (retryAttr) retry.setAttribute('data-sr-retry', retryAttr);
    card.appendChild(retry);
    return card;
  }

  function emptyCard(title, desc, action) {
    var card = el('div', 'sr-empty');
    card.appendChild(el('div', 'sr-empty-icon', iconSvg('search') || '⌕'));
    card.appendChild(el('div', 'sr-empty-title', title));
    if (desc) card.appendChild(el('div', 'sr-empty-desc', desc));
    if (action) card.appendChild(action);
    return card;
  }

  function paginationEl(page, totalPages, q) {
    if (totalPages <= 1) return null;
    var wrap = el('nav', 'sr-pagination');
    wrap.setAttribute('aria-label', '搜索结果分页');
    var pages = getPageNumbers(page, totalPages);
    var prev = el('button', 'sr-page-btn' + (page <= 1 ? ' sr-page-disabled' : ''));
    prev.type = 'button';
    prev.setAttribute('aria-label', '上一页');
    prev.setAttribute('data-sr-page', String(page - 1));
    prev.disabled = page <= 1;
    prev.textContent = '‹';
    wrap.appendChild(prev);
    pages.forEach(function (n) {
      if (n === '…') {
        wrap.appendChild(el('span', 'sr-page-ellipsis', '⋯'));
        return;
      }
      var b = el('button', 'sr-page-btn sr-page-num' + (n === page ? ' sr-page-active' : ''), String(n));
      b.type = 'button';
      if (n === page) b.setAttribute('aria-current', 'page');
      else b.setAttribute('data-sr-page', String(n));
      wrap.appendChild(b);
    });
    var next = el('button', 'sr-page-btn' + (page >= totalPages ? ' sr-page-disabled' : ''));
    next.type = 'button';
    next.setAttribute('aria-label', '下一页');
    next.setAttribute('data-sr-page', String(page + 1));
    next.disabled = page >= totalPages;
    next.textContent = '›';
    wrap.appendChild(next);
    return wrap;
  }

  // ── 页面骨架渲染（顶栏输入保留；不为响应替换整页 DOM）──
  function renderShell(state) {
    var title = document.getElementById('searchTitle');
    if (title) {
      title.textContent = '';
      if (state.searchQuery) {
        title.appendChild(document.createTextNode('「'));
        title.appendChild(highlightSpan(state.searchQuery, state.searchQuery));
        title.appendChild(document.createTextNode('」的搜索结果'));
      } else {
        title.textContent = '搜索';
      }
    }
    var sourceBtn = document.getElementById('searchSourceBtn');
    if (sourceBtn) {
      var src = state.searchSource;
      var valid = !!(src && src.view && src.view !== 'search' &&
        (!state.searchOwnerId || !currentUser || state.searchOwnerId === currentUser.id));
      sourceBtn.hidden = !valid;
      sourceBtn.onclick = function () { returnToSourceView(); };
    }
    renderTabs(state);
  }

  function renderTabs(state) {
    var host = document.getElementById('searchTabs');
    if (!host) return;
    host.textContent = '';
    var counts = state.searchQuery ? cachedCounts(state.searchQuery) : null;
    TYPES.forEach(function (type) {
      var a = document.createElement('a');
      a.className = 'sr-tab' + (state.searchType === type ? ' sr-tab--active' : '');
      a.href = 'javascript:void(0)';
      a.setAttribute('data-sr-tab', type);
      if (state.searchType === type) a.setAttribute('aria-current', 'page');
      a.appendChild(document.createTextNode(TYPE_LABELS[type]));
      if (type !== 'all') {
        var n = document.createElement('span');
        n.className = 'sr-tab-count';
        n.setAttribute('data-sr-count', type);
        if (!state.searchQuery) n.textContent = '';
        else if (!counts) n.textContent = '…';
        else {
          var v = counts[type];
          n.textContent = v === 'error' ? '—' : String(v == null ? '…' : v);
          if (v === 'error') n.title = '计数加载失败，点击重试';
        }
        a.appendChild(n);
      }
      host.appendChild(a);
    });
  }

  function renderToolbar(state) {
    var host = document.getElementById('searchToolbar');
    if (!host) return;
    var type = state.searchType;
    if (type === 'all' || !state.searchQuery) {
      host.textContent = '';
      host.hidden = true;
      return;
    }
    host.hidden = false;
    var prevFocus = toolbarFocusKey;
    var filters = filtersFor(type, state.searchFilters);
    var group = groupState[type];
    var facets = (group && group.data && group.data.facets) || {};
    host.textContent = '';

    var bar = el('div', 'sr-filter-bar');
    // 窄屏默认折叠筛选（§10：筛选在结果页内折叠展开）；用户展开后在本页保持
    var narrow = !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    if (narrow && filterExpanded !== true) {
      bar.classList.add('sr-filter-bar--collapsed');
    }

    function addSelect(key, label, options, value) {
      var wrap = el('label', 'sr-filter');
      var name = el('span', 'sr-filter-label', label);
      var sel = document.createElement('select');
      sel.className = 'sr-filter-select';
      sel.setAttribute('data-sr-filter', key);
      options.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt[0];
        o.textContent = opt[1];
        sel.appendChild(o);
      });
      sel.value = value == null ? '' : String(value);
      if (sel.selectedIndex < 0) sel.selectedIndex = 0;
      sel.addEventListener('change', function () {
        changeFilter(key, sel.value);
      });
      wrap.appendChild(name);
      wrap.appendChild(sel);
      bar.appendChild(wrap);
    }

    if (type === 'course' || type === 'material') {
      addSelect('course_type', '类别', [['', '全部'], ['major', '专业课'], ['general', '通识课']], filters.course_type);
      var colleges = facets.colleges || [];
      if (!filters.course_type || filters.course_type === 'major') {
        var colOpts = [['', '全部学院']].concat(colleges.map(function (c) {
          return [String(c.id), c.name];
        }));
        // 当前筛选值可能不在 facets（响应异常兜底）
        if (filters.college && !colleges.some(function (c) { return String(c.id) === String(filters.college); })) {
          colOpts.push([String(filters.college), '学院 #' + filters.college]);
        }
        addSelect('college', '学院', colOpts, filters.college);
      }
    }
    if (type === 'material') {
      var mts = facets.material_types || [];
      var mtOpts = [['', '全部类型']].concat(mts.map(function (t) {
        return [String(t.id), t.name];
      }));
      if (filters.material_type && !mts.some(function (t) { return String(t.id) === String(filters.material_type); })) {
        mtOpts.push([String(filters.material_type), '类型 #' + filters.material_type]);
      }
      addSelect('material_type', '内容类型', mtOpts, filters.material_type);
      var fts = facets.file_types || [];
      var ftOpts = [['', '全部格式']].concat(fts.map(function (f) { return [f, f.toUpperCase()]; }));
      if (filters.format && fts.indexOf(filters.format) < 0) ftOpts.push([filters.format, filters.format.toUpperCase()]);
      addSelect('format', '文件格式', ftOpts, filters.format);
    }
    if (type === 'qa') {
      var tags = (window._bnuSearchQaTags) || { l1: [], l2: [] };
      var l1Opts = [['', '全部分类']].concat(tags.l1.map(function (t) { return [String(t.id), t.name]; }));
      if (filters.tag_l1 && !tags.l1.some(function (t) { return String(t.id) === String(filters.tag_l1); })) {
        l1Opts.push([String(filters.tag_l1), '分类 #' + filters.tag_l1]);
      }
      addSelect('tag_l1', '分类', l1Opts, filters.tag_l1);
      var l2Opts = [['', '全部话题']].concat(tags.l2.map(function (t) { return [String(t.id), t.name]; }));
      if (filters.tag_l2 && !tags.l2.some(function (t) { return String(t.id) === String(filters.tag_l2); })) {
        l2Opts.push([String(filters.tag_l2), '话题 #' + filters.tag_l2]);
      }
      addSelect('tag_l2', '话题', l2Opts, filters.tag_l2);
    }

    var sorts = SORTS[type];
    var sortOpts = sorts.map(function (s) { return [s[0], s[1]]; });
    addSelect('sort', '排序', sortOpts, state.searchSort);

    host.appendChild(bar);

    // 移动端折叠开关 + 筛选后计数
    var tools = el('div', 'sr-toolbar-tools');
    var toggle = el('button', 'sr-filter-toggle', '筛选');
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', 'searchToolbar');
    toggle.setAttribute('aria-expanded', (narrow && filterExpanded !== true) ? 'false' : 'true');
    toggle.classList.toggle('sr-filter-toggle--open', !(narrow && filterExpanded !== true));
    toggle.addEventListener('click', function () {
      var collapsed = bar.classList.toggle('sr-filter-bar--collapsed');
      filterExpanded = !collapsed;
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.classList.toggle('sr-filter-toggle--open', !collapsed);
    });
    tools.appendChild(toggle);
    var total = group && group.data && typeof group.data.total === 'number' ? group.data.total : null;
    var totalEl = el('span', 'sr-filtered-total');
    if (group && group.status === 'success' && total != null) {
      totalEl.textContent = '筛选后 ' + total + ' 条';
    } else if (group && group.status === 'error') {
      totalEl.textContent = '筛选后 —';
    }
    tools.appendChild(totalEl);
    host.appendChild(tools);

    // 焦点保持：类型切换/筛选变更后回到原控件
    if (prevFocus) {
      var target = host.querySelector('[data-sr-filter="' + prevFocus + '"]');
      if (target) target.focus({ preventScroll: true });
      toolbarFocusKey = null;
    }
  }

  // ── 全部页 ──
  function renderAllView(state, gen) {
    var body = document.getElementById('searchBody');
    if (!body) return;
    body.textContent = '';
    body.setAttribute('aria-busy', 'true');
    var types = ['course', 'material', 'qa'];
    var cards = {};
    var lists = {};
    types.forEach(function (type) {
      var card = groupCard(type, 0, 'loading');
      var list = el('div', 'sr-group-body');
      card.appendChild(list);
      body.appendChild(card);
      cards[type] = card;
      lists[type] = list;
      groupState[type] = { status: 'loading' };
    });
    announce('正在搜索');

    var counts = state.searchQuery ? cachedCounts(state.searchQuery) : null;
    var results = {};
    var failures = {};
    var settled = 0;

    types.forEach(function (type) {
      var pageSize = ALL_PREVIEW[type];
      fetchGroup(type, state, pageSize, gen).then(function (data) {
        if (gen !== renderGen || !isSearchActive()) return;
        results[type] = data;
        groupState[type] = { status: 'success', data: data };
        // 预览是部分数据（每页 3/3/2 条），不写入分类页快照，避免冒充分页首页
        renderGroupList(type, lists[type], data, state);
        updateGroupHead(type, cards[type], data);
        checkSettled();
      }, function (err) {
        if (gen !== renderGen || !isSearchActive()) return;
        if (err && err.__stale) return;
        failures[type] = err;
        groupState[type] = { status: 'error', error: err };
        lists[type].textContent = '';
        lists[type].appendChild(errorCard(authMessage(err), type));
        updateGroupHead(type, cards[type], null, 'error');
        checkSettled();
      });
    });

    function checkSettled() {
      settled++;
      if (settled < types.length) return;
      body.removeAttribute('aria-busy');
      var allOk = types.every(function (t) { return groupState[t].status === 'success'; });
      if (allOk) {
        var total = types.reduce(function (sum, t) {
          return sum + (results[t] && typeof results[t].keyword_total === 'number' ? results[t].keyword_total : 0);
        }, 0);
        if (total === 0) {
          body.appendChild(emptyCard('未找到相关结果', '试试其他关键词，或使用课程代码搜索'));
        }
        announceOnceNoResult(total);
      } else {
        announce('部分结果加载失败');
      }
      // 计数缓存入账（全部页的响应自带未筛选总数）
      if (state.searchQuery) {
        var entry = { ownerId: ownerId(), gen: accountGen(), course: null, material: null, qa: null };
        var anyValue = false;
        types.forEach(function (t) {
          if (groupState[t].status === 'success') {
            entry[t] = groupState[t].data.keyword_total;
            anyValue = true;
          } else {
            entry[t] = 'error';
          }
        });
        if (anyValue) countsCache.set(countsSignature(state.searchQuery), entry);
        renderTabs(current || state);
      }
      maybeRestoreFocusAndScroll(state);
    }
  }

  function updateGroupHead(type, card, data, errState) {
    var badge = card.querySelector('.sr-group-count');
    if (!badge) return;
    if (errState === 'error') {
      badge.textContent = '—';
      return;
    }
    var n = data && typeof data.keyword_total === 'number' ? data.keyword_total : null;
    badge.textContent = n == null ? '…' : String(n);
    // 「查看全部 N 门课程 / 份资料 / 条问答」
    var head = card.querySelector('.sr-group-head');
    var existing = head.querySelector('.sr-group-more');
    if (existing) existing.remove();
    if (n != null && n > (ALL_PREVIEW[type] || 0)) {
      var more = document.createElement('a');
      more.className = 'sr-group-more';
      more.href = 'javascript:void(0)';
      more.setAttribute('data-sr-view-all', type);
      more.textContent = '查看全部 ' + n + ' ' + ({ course: '门课程', material: '份资料', qa: '条问答' }[type]);
      head.appendChild(more);
    }
  }

  function renderGroupList(type, host, data, state) {
    host.textContent = '';
    var items = data.items || [];
    if (!items.length) {
      host.appendChild(el('div', 'sr-group-empty', '没有相关' + TYPE_LABELS[type] + ''));
      return;
    }
    var q = state.searchQuery;
    items.forEach(function (item) {
      host.appendChild(itemEl(type, item, q));
    });
    if (data.total > items.length) {
      var more = document.createElement('a');
      more.className = 'sr-group-morelink';
      more.href = 'javascript:void(0)';
      more.setAttribute('data-sr-view-all', type);
      more.textContent = '查看全部 ' + data.keyword_total + ' ' + ({ course: '门课程', material: '份资料', qa: '条问答' }[type]);
      host.appendChild(more);
    }
  }

  // ── 分类页 ──
  function renderCategoryView(state, gen) {
    var body = document.getElementById('searchBody');
    if (!body) return;
    var type = state.searchType;
    body.textContent = '';
    body.setAttribute('aria-busy', 'true');
    var host = el('div', 'sr-list');
    host.setAttribute('data-sr-list', type);
    body.appendChild(host);
    groupState[type] = { status: 'loading' };
    announce('正在搜索');

    var snap = snapshotFor(signature(state));
    renderToolbar(state);
    if (snap) {
      // 返回恢复：先立即呈现快照，再后台重新验证
      applyCategoryData(type, host, snap.data, state, true);
      groupState[type] = { status: 'success', data: snap.data, fromSnapshot: true };
      body.removeAttribute('aria-busy');
    }

    function loadMain() {
      fetchGroup(type, state, PAGE_SIZE[type], gen).then(function (data) {
        if (gen !== renderGen || !isSearchActive()) return;
        // 服务端收敛页码后与 URL 不一致：replace 修正
        if (typeof data.page === 'number' && data.page !== state.searchPage) {
          state.searchPage = data.page;
          patchSearchState(state);
        }
        groupState[type] = { status: 'success', data: data };
        rememberSnapshot(signature(state), data);
        applyCategoryData(type, host, data, state, false);
        body.removeAttribute('aria-busy');
        announce(type + ' 结果加载完成');
        refreshTabCounts(state, gen);
        maybeRestoreFocusAndScroll(state);
      }, function (err) {
        if (gen !== renderGen || !isSearchActive()) return;
        if (err && err.__stale) return;
        groupState[type] = { status: 'error', error: err };
        body.removeAttribute('aria-busy');
        host.textContent = '';
        host.appendChild(errorCard(authMessage(err), 'main'));
        announce('加载失败');
        refreshTabCounts(state, gen);
      });
    }
    loadMain();
  }

  function applyCategoryData(type, host, data, state, fromSnapshot) {
    host.textContent = '';
    // 「筛选后 N 条」就地更新，不重建工具栏（保留控件焦点）
    var totalEl = document.querySelector('#searchToolbar .sr-filtered-total');
    if (totalEl) {
      totalEl.textContent = typeof data.total === 'number' ? '筛选后 ' + data.total + ' 条' : '筛选后 —';
    }
    var items = data.items || [];
    if (!items.length) {
      var filters = filtersFor(type, state.searchFilters);
      var hasFilter = !!(filters.course_type || filters.college || filters.material_type ||
        filters.format || filters.tag_l1 || filters.tag_l2);
      var action = null;
      if (hasFilter) {
        action = el('button', 'sr-retry-btn', '清除筛选');
        action.type = 'button';
        action.setAttribute('data-sr-clear-filters', '1');
      }
      host.appendChild(emptyCard(
        '没有相关' + TYPE_LABELS[type],
        hasFilter ? '当前筛选条件下没有内容，已保留关键词' : '换个关键词试试',
        action));
      return;
    }
    var q = state.searchQuery;
    items.forEach(function (item) {
      host.appendChild(itemEl(type, item, q));
    });
    var pag = paginationEl(data.page, data.total_pages, q);
    if (pag) host.appendChild(pag);
    if (fromSnapshot) {
      var note = el('div', 'sr-snapshot-note', '正在更新结果…');
      host.appendChild(note);
    }
  }

  function refreshTabCounts(state, gen) {
    if (!state.searchQuery) return;
    var cached = cachedCounts(state.searchQuery);
    if (cached && cached[state.searchType] !== null && cached[state.searchType] !== undefined &&
        cached.course !== null && cached.material !== null && cached.qa !== null) {
      renderTabs(state);
      return;
    }
    fetchCounts(state.searchQuery, gen).then(function () {
      if (gen !== renderGen || !isSearchActive()) return;
      renderTabs(current || state);
    });
  }

  function authMessage(err) {
    if (err && (err.status === 401 || err.status === 403)) {
      return '登录状态已失效，请重新登录后再搜索';
    }
    return (err && err.message) || '请检查网络后重试';
  }

  // ── 状态变更入口 ──
  function patchSearchState(state) {
    var full = Object.assign({ _bnusparks: true }, history.state || {}, {
      view: 'search',
      searchQuery: state.searchQuery,
      searchType: state.searchType,
      searchPage: state.searchPage,
      searchSort: state.searchSort,
      searchFilters: state.searchFilters,
      searchEntryId: state.searchEntryId,
      searchOwnerId: state.searchOwnerId,
      searchSource: state.searchSource,
      searchFocusKey: state.searchFocusKey || null,
    });
    if (typeof patchViewState === 'function') patchViewState(full);
  }

  function changeFilter(key, value) {
    if (!current) return;
    var next = Object.assign({}, current);
    next.searchFilters = Object.assign({}, current.searchFilters);
    next.searchPage = 1;
    if (key === 'sort') {
      next.searchSort = value || (current.searchType === 'qa' ? 'default' : 'relevance');
    } else if (key === 'course_type') {
      next.searchFilters.course_type = value;
      if (value === 'general') next.searchFilters.college = null; // 不兼容组合主动清除
    } else if (key === 'college') {
      next.searchFilters.college = value ? parseInt(value, 10) : null;
      if (value && next.searchFilters.course_type === 'general') next.searchFilters.course_type = '';
    } else if (key === 'material_type') {
      next.searchFilters.material_type = value ? parseInt(value, 10) : null;
    } else if (key === 'format') {
      next.searchFilters.format = value || '';
    } else if (key === 'tag_l1') {
      next.searchFilters.tag_l1 = value ? parseInt(value, 10) : null;
      next.searchFilters.tag_l2 = null; // 切一级清二级（沿用问答区 UI 行为）
    } else if (key === 'tag_l2') {
      next.searchFilters.tag_l2 = value ? parseInt(value, 10) : null;
    }
    toolbarFocusKey = key;
    patchSearchState(next);
    current = normalizeState(Object.assign({}, history.state));
    applyChange('inpage');
  }

  function switchType(type) {
    if (!current || TYPES.indexOf(type) < 0 || type === current.searchType) return;
    var next = Object.assign({}, current);
    next.searchType = type;
    next.searchPage = 1;
    next.searchSort = type === 'qa' ? 'default' : 'relevance';
    next.searchFilters = defaultFilters();
    patchSearchState(next);
    current = normalizeState(Object.assign({}, history.state));
    applyChange('inpage');
  }

  function goPage(page) {
    if (!current) return;
    var next = Object.assign({}, current);
    next.searchPage = Math.max(1, parseInt(page, 10) || 1);
    patchSearchState(next);
    current = normalizeState(Object.assign({}, history.state));
    applyChange('inpage');
  }

  function clearFilters() {
    if (!current) return;
    var next = Object.assign({}, current);
    next.searchFilters = defaultFilters();
    next.searchPage = 1;
    patchSearchState(next);
    current = normalizeState(Object.assign({}, history.state));
    applyChange('inpage');
  }

  function submitQuery(q) {
    // 搜索页内提交新关键词：保留当前类型与有效筛选，页码归 1；继承最初来源
    var trimmed = String(q || '').trim().slice(0, 200);
    if (!trimmed || !current) return;
    var next = Object.assign({}, current);
    next.searchQuery = trimmed;
    next.searchPage = 1;
    next.searchEntryId = 'se' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    next.searchOwnerId = ownerId();
    next.searchFocusKey = null;
    patchSearchState(next);
    current = normalizeState(Object.assign({}, history.state));
    if (window.BnuMonitoring && typeof window.BnuMonitoring.track === 'function') {
      window.BnuMonitoring.track('search.execute');
    }
    applyChange('entry');
  }

  function applyChange(reason) {
    var gen = ++renderGen;
    abortRequests();
    renderShell(current);
    renderBody(current, gen, reason);
    normalizeUrl(current);
    if (reason === 'inpage') {
      // 类型切换/筛选/翻页：回到结果区起点（类型导航行）
      var tabs = document.getElementById('searchTabs');
      if (tabs) {
        var top = tabs.getBoundingClientRect().top + window.scrollY - 64;
        scrollToInstant(Math.max(0, top));
      }
    }
  }

  // ── URL 规范化（replace）：缺省省略、非法参数回退后对齐地址栏 ──
  function normalizeUrl(state) {
    var url = routeToPath('search', state);
    var target = url || '/search';
    if (location.pathname + location.search !== target) {
      var full = Object.assign({ _bnusparks: true }, history.state || {});
      history.replaceState(full, '', target);
    }
  }

  // ── 渲染主入口 ──
  function render(rawState, opts) {
    opts = opts || {};
    var gen = ++renderGen;
    abortRequests();
    var state = normalizeState(rawState);

    // 账号不一致的旧条目：丢弃旧结果/焦点/来源快照，按 URL 为当前账号重载
    if (state.searchOwnerId !== null && state.searchOwnerId !== ownerId()) {
      state.searchOwnerId = ownerId();
      state.searchEntryId = 'se' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      state.searchSource = null;
      state.searchFocusKey = null;
      patchSearchState(state);
    }
    if (!state.searchOwnerId && ownerId()) {
      // 深链到达后才完成登录：条目归属当前账号
      state.searchOwnerId = ownerId();
      patchSearchState(state);
    }

    current = state;
    currentEntryId = state.searchEntryId;
    renderShell(state);

    if (!currentUser) {
      renderGuestState(state);
      normalizeUrl(state);
      return;
    }

    if (state.searchType === 'qa') loadQaTags().then(function (tags) {
      window._bnuSearchQaTags = tags;
      // 标签到达后刷新筛选控件；用户正聚焦工具栏控件时不打断
      if (gen === renderGen && current && current.searchType === 'qa' &&
          !(document.activeElement && document.getElementById('searchToolbar') &&
            document.getElementById('searchToolbar').contains(document.activeElement))) {
        renderToolbar(current);
      }
    });
    // 监测：一次用户提交只计一次（页内切换/翻页/恢复不重复计数）
    if (!opts.restore && state.searchQuery && window.BnuMonitoring &&
        typeof window.BnuMonitoring.track === 'function') {
      window.BnuMonitoring.track('search.execute');
    }
    renderBody(state, gen, opts.restore ? 'restore' : 'entry');
    normalizeUrl(state);
  }

  function renderBody(state, gen, reason) {
    groupState = {};
    var sub = document.getElementById('searchSub');
    if (sub) sub.textContent = '';
    if (!state.searchQuery) {
      var body = document.getElementById('searchBody');
      if (body) {
        body.removeAttribute('aria-busy');
        body.textContent = '';
        body.appendChild(emptyCard('输入关键词开始搜索',
          '支持课程名、课程代码、资料标题、教师、简介与问答内容'));
      }
      return;
    }
    if (state.searchType === 'all') renderAllView(state, gen);
    else renderCategoryView(state, gen, reason);

    if (reason === 'entry') {
      scrollToInstant(0);
      var title = document.getElementById('searchTitle');
      if (title) title.focus({ preventScroll: true });
    }
  }

  function renderGuestState(state) {
    var body = document.getElementById('searchBody');
    if (!body) return;
    body.removeAttribute('aria-busy');
    body.textContent = '';
    var card = el('div', 'sr-empty sr-empty--auth');
    card.appendChild(el('div', 'sr-empty-icon', iconSvg('lock') || '🔒'));
    card.appendChild(el('div', 'sr-empty-title', '登录后搜索'));
    card.appendChild(el('div', 'sr-empty-desc', '登录后可搜索课程、资料与问答内容'));
    var btn = el('button', 'sr-retry-btn', '登录');
    btn.type = 'button';
    btn.addEventListener('click', function () { showLoginModal(); });
    card.appendChild(btn);
    body.appendChild(card);
    if (!guestModalShown) {
      guestModalShown = true;
      showLoginModal();
    }
  }

  function maybeRestoreFocusAndScroll(state) {
    // 仅恢复场景：数据就绪后恢复保存的滚动与焦点（scrollY=0 也有效）
    if (!current || current.searchEntryId !== state.searchEntryId) return;
    var key = current.searchFocusKey;
    if (key) {
      var target = document.querySelector('[data-focus-key="' + key + '"]');
      var el2 = target && target.querySelector('.sr-item-title');
      if (el2) {
        el2.setAttribute('tabindex', '-1');
        el2.focus({ preventScroll: true });
      } else {
        // 目标结果已不存在：聚焦结果区标题
        var host = document.querySelector('[data-sr-list]') || document.getElementById('searchBody');
        if (host) {
          host.setAttribute('tabindex', '-1');
          host.focus({ preventScroll: true });
        }
      }
    }
    requestAnimationFrame(function () {
      scrollToInstant(current.scrollY || 0);
    });
  }

  // ── 结果点击（事件委托：真实链接 + 普通左键拦截）──
  function bindEvents() {
    var view = document.getElementById('searchView');
    if (!view || view.dataset.srBound) return;
    view.dataset.srBound = '1';

    view.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-sr-tab]');
      if (tab) { switchType(tab.getAttribute('data-sr-tab')); return; }
      var viewAll = e.target.closest('[data-sr-view-all]');
      if (viewAll) { switchType(viewAll.getAttribute('data-sr-view-all')); return; }
      var pageBtn = e.target.closest('[data-sr-page]');
      if (pageBtn && !pageBtn.disabled) { goPage(pageBtn.getAttribute('data-sr-page')); return; }
      var retry = e.target.closest('[data-sr-retry]');
      if (retry) { retryGroup(retry.getAttribute('data-sr-retry')); return; }
      var clear = e.target.closest('[data-sr-clear-filters]');
      if (clear) { clearFilters(); return; }
      var sourceBtn = e.target.closest('#searchSourceBtn');
      if (sourceBtn) { returnToSourceView(); return; }

      // 课程结果 → 显式路径定位
      var courseLink = e.target.closest('[data-sr-path]');
      if (courseLink) {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        handleCourseClick(courseLink);
        return;
      }
      // 资料结果 → 详情
      var fileLink = e.target.closest('[data-sr-file]');
      if (fileLink) {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        handleFileClick(fileLink);
        return;
      }
      // 问答结果 → 详情
      var qaLink = e.target.closest('[data-sr-qa]');
      if (qaLink) {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        handleQaClick(qaLink);
        return;
      }
    });
  }

  function guardSnapshot() {
    // 捕获点击时刻的搜索条目/代次/账号；await 后逐项核对
    return {
      gen: renderGen,
      accountGen: accountGen(),
      entryId: currentEntryId,
      seq: history.state && history.state._seq,
    };
  }

  function guardValid(guard) {
    return guard && guard.gen === renderGen && guard.accountGen === accountGen() &&
      guard.entryId === currentEntryId && history.state &&
      history.state.view === 'search' && history.state._seq === guard.seq;
  }

  function saveSearchFocus(focusKey) {
    // 保存搜索滚动与焦点键到当前条目，再进行详情/目录导航
    patchSearchState(Object.assign({}, current, {
      scrollY: window.scrollY,
      searchFocusKey: focusKey || null,
    }));
    current = normalizeState(Object.assign({}, history.state));
  }

  function buildReturnSearch(focusKey) {
    var st = history.state || {};
    return {
      ownerId: ownerId(),
      entryId: st.searchEntryId || currentEntryId,
      focusKey: focusKey || null,
      snapshot: {
        _bnusparks: true,
        view: 'search',
        searchQuery: current.searchQuery,
        searchType: current.searchType,
        searchPage: current.searchPage,
        searchSort: current.searchSort,
        searchFilters: Object.assign({}, current.searchFilters),
        searchEntryId: current.searchEntryId,
        searchOwnerId: current.searchOwnerId,
        scrollY: window.scrollY,
        searchSource: current.searchSource || null,
      },
    };
  }

  function handleCourseClick(link) {
    var guard = guardSnapshot();
    var segments;
    try { segments = JSON.parse(link.getAttribute('data-sr-path')); } catch (err) { segments = null; }
    if (!segments || !segments.length) return;
    // 先等 explorer 特性和课程树就绪，再验证仍停留在原搜索条目；
    // 用户已改关键词、离页或换账号时放弃旧点击，模块迟到加载也不得把用户带走。
    var ready = typeof ensureFeature === 'function'
      ? ensureFeature('explorer')
      : Promise.resolve();
    ready.then(function () {
      return typeof _ensureCourseTreeReady === 'function'
        ? _ensureCourseTreeReady()
        : Promise.reject(new Error('课程模块未就绪'));
    }).then(function () {
      if (!guardValid(guard)) return;
      if (typeof navToCoursePath !== 'function') return;
      navToCoursePath(segments).then(function (ok) {
        if (ok) return;
        if (!guardValid(guard)) return;
        var host = document.querySelector('[data-sr-list], #searchBody');
        if (!host) return;
        var note = el('div', 'sr-error sr-error--inline');
        note.setAttribute('role', 'alert');
        note.appendChild(el('span', 'sr-error-desc', '该课程目录已失效或尚未加载完成'));
        var refreshBtn = el('button', 'sr-retry-btn', '刷新结果');
        refreshBtn.type = 'button';
        refreshBtn.addEventListener('click', function () { retryGroup('main'); });
        note.appendChild(refreshBtn);
        host.insertBefore(note, host.firstChild);
      });
    }).catch(function () {
      if (!guardValid(guard)) return;
      var host = document.querySelector('[data-sr-list], #searchBody');
      if (host) host.insertBefore(errorCard('课程模块加载失败，请重试', 'main'), host.firstChild);
    });
  }

  function handleFileClick(link) {
    var fid = parseInt(link.getAttribute('data-sr-file'), 10);
    if (!fid) return;
    var focusKey = 'material:' + fid;
    saveSearchFocus(focusKey);
    if (typeof showFileDetail === 'function') {
      showFileDetail({ id: fid, title: '' }, { returnSearch: buildReturnSearch(focusKey) });
    }
  }

  function handleQaClick(link) {
    var guard = guardSnapshot();
    var qid = parseInt(link.getAttribute('data-sr-qa'), 10);
    if (!qid) return;
    var answerId = parseInt(link.getAttribute('data-sr-qa-answer'), 10) || 0;
    var focusKey = 'qa:' + qid;
    var ready = typeof ensureFeature === 'function' ? ensureFeature('qa') : Promise.resolve();
    ready.then(function () {
      // 等待模块/视图期间用户可能已离页/改条件/换账号：放弃旧点击
      if (!guardValid(guard)) return;
      if (typeof qaOpenDetail !== 'function') return;
      saveSearchFocus(focusKey); // 在置顶之前保存离开滚动
      switchView('qa', true);
      updateSidebar('qa');
      qaOpenDetail(qid, {
        answerId: answerId || undefined,
        returnSearch: buildReturnSearch(focusKey),
      });
    }).catch(function () {
      if (!guardValid(guard)) return;
      var host = document.querySelector('[data-sr-list], #searchBody');
      if (!host) return;
      host.insertBefore(errorCard('问答模块加载失败，请重试', 'main'), host.firstChild);
    });
  }

  function retryGroup(which) {
    if (!current) return;
    if (current.searchType === 'all' && which !== 'main') {
      // 全部页：只重试失败组，保留成功组
      var gen = ++renderGen;
      abortRequests();
      var type = which;
      var card = document.querySelector('[data-sr-group="' + type + '"]');
      var list = card && card.querySelector('.sr-group-body');
      if (!card || !list) { applyChange('inpage'); return; }
      groupState[type] = { status: 'loading' };
      list.textContent = '';
      list.appendChild(el('div', 'sr-group-empty', '加载中…'));
      fetchGroup(type, current, ALL_PREVIEW[type], gen).then(function (data) {
        if (gen !== renderGen || !isSearchActive()) return;
        groupState[type] = { status: 'success', data: data };
        renderGroupList(type, list, data, current);
        updateGroupHead(type, card, data);
      }, function (err) {
        if (gen !== renderGen || !isSearchActive()) return;
        if (err && err.__stale) return;
        groupState[type] = { status: 'error', error: err };
        list.textContent = '';
        list.appendChild(errorCard(authMessage(err), type));
        updateGroupHead(type, card, null, 'error');
      });
      return;
    }
    applyChange('inpage');
  }

  // ── 返回来源页（replace 当前搜索条目，不制造来源↔搜索往返）──
  function returnToSourceView() {
    var st = history.state || {};
    var src = current && current.searchSource ? current.searchSource : st.searchSource;
    var target;
    if (src && src.view && src.view !== 'search' &&
        (!st.searchOwnerId || !currentUser || st.searchOwnerId === currentUser.id)) {
      target = Object.assign({ _bnusparks: true }, src);
    } else {
      target = { _bnusparks: true, view: 'home', scrollY: 0 };
    }
    suspend();
    var url = routeToPath(target.view, target);
    history.replaceState(target, '', url || location.pathname);
    try { sessionStorage.setItem('bnusparks_view', JSON.stringify(target)); } catch (e) { /* 忽略 */ }
    renderForeignView(target);
  }

  // 来源视图恢复：复用各视图既有入口（内部 pushViewState 被 _suppressingPushState 压掉）
  function renderForeignView(st) {
    if (typeof _suppressingPushState === 'undefined') { location.href = '/'; return; }
    _suppressingPushState = true;
    try {
      switchView(st.view, true);
      switch (st.view) {
        case 'home': showHome(st.scrollY || 0); break;
        case 'explorer':
          expPath = (st.expPath && st.expPath.length) ? st.expPath.slice() : ['专业课'];
          renderExplorer();
          if (typeof updateSidebar === 'function') updateSidebar('allCourses');
          break;
        case 'qa':
          if (typeof showQa === 'function') showQa(st.qaId || null, st);
          else showHome();
          break;
        case 'fileDetail':
          if (st.fileId && typeof showFileDetail === 'function') showFileDetail({ id: st.fileId, title: '' });
          else showHome();
          break;
        case 'rankings': showTopDownloaded(undefined, st.rankingType); break;
        case 'recentAll': showRecentAll(); break;
        case 'recommendations': if (typeof showRecommendations === 'function') showRecommendations(); else showHome(); break;
        case 'leaderboard': showLeaderboard(st.leaderboardType); break;
        case 'about': showAbout(st.aboutSection || 'introduction'); break;
        case 'announcements': showAnnouncements(st.announcementId); break;
        case 'broad': showBroad(); break;
        case 'other': showOther(); break;
        case 'profile': showProfile(); break;
        case 'notif': showNotifFull(); break;
        case 'userPublic': if (st.userId) showUserPublic(st.userId); else showHome(); break;
        case 'timetable':
          if (typeof ttNavTimetable === 'function') ttNavTimetable(st.userId || null);
          else showHome();
          break;
        case 'myuploads': showMyUploadsPage(st.myUploadTab); break;
        case 'mydownloads': showMyDownloadsPage(); break;
        case 'myfavorites': showMyFavoritesPage(st.myFavoriteTab); break;
        default: showHome();
      }
      var y = st.scrollY || 0;
      requestAnimationFrame(function () { scrollToInstant(y); });
    } finally {
      _suppressingPushState = false;
    }
  }

  // ── 无障碍播报 ──
  function announce(text) {
    var live = document.getElementById('searchLive');
    if (live) live.textContent = text;
  }

  function announceOnceNoResult(total) {
    if (total !== 0) {
      announce('搜索完成');
      return;
    }
    announce('没有找到相关结果');
    if (window.BnuMonitoring && typeof window.BnuMonitoring.track === 'function' &&
        current && monitoredExecute !== current.searchEntryId) {
      monitoredExecute = current.searchEntryId;
      window.BnuMonitoring.track('search.no_result');
    }
  }

  // ── 生命周期 ──
  function abortRequests() {
    controllers.forEach(function (c) {
      try { c.abort(); } catch (e) { /* 忽略 */ }
    });
    controllers = [];
  }

  function isSearchActive() {
    var view = document.getElementById('searchView');
    return !!(view && view.classList.contains('active'));
  }

  function suspend() {
    // 离页：作废请求，不清除可安全返回的当前账号快照
    renderGen++;
    abortRequests();
  }

  function reset() {
    // 身份变化：作废请求、清结果/计数/焦点/来源快照
    renderGen++;
    abortRequests();
    snapshots.clear();
    countsCache.clear();
    groupState = {};
    current = null;
    currentEntryId = null;
    monitoredExecute = null;
    var body = document.getElementById('searchBody');
    if (body) body.textContent = '';
  }

  // 认证事件：登出/账号变化立即清空；登录后仍在搜索路由则继续加载
  window.addEventListener('bnuauthchange', function () {
    reset();
    guestModalShown = false;
    if (isSearchActive()) {
      render(history.state, { restore: true });
    }
  });

  // 离页感知：切走即挂起（不动快照）
  document.addEventListener('bnuviewchange', function (e) {
    if (e && e.detail && e.detail.view !== 'search') suspend();
  });

  function init() {
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.BnuSearch = {
    render: render,
    suspend: suspend,
    reset: reset,
  };
})();
