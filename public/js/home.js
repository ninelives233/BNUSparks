/* BNU Sparks · 紧凑首页
 * 首页只消费真实接口；请求按用户 ID + 认证代次隔离，失败态与真实空数据分开显示。
 */
(function () {
  'use strict';

  var _compactRequest = null;
  // 同一账号的首页二次进入使用 stale-while-revalidate：保留已有内容，
  // 后台刷新只校准数据，不再把推荐/榜单当成新内容重新闪入。
  var _compactReadyKey = null;
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

  function restoreCompactViewState() {
    var state = typeof getPersistedViewState === 'function' ? getPersistedViewState() : null;
    if (!state || state.view !== 'home') return;
    if (state.homeDiscoveryKind === 'recent' || state.homeDiscoveryKind === 'download' || state.homeDiscoveryKind === 'favorite') {
      _compactData.discoveryKind = state.homeDiscoveryKind;
    }
    if (state.homeHotKind === 'download' || state.homeHotKind === 'favorite') {
      _compactData.hotKind = state.homeHotKind;
    }
    if (typeof state.homeCampusExpanded === 'boolean') _compactData.campusExpanded = state.homeCampusExpanded;
  }

  window.getCompactHomeViewState = function () {
    return {
      homeDiscoveryKind: _compactData.discoveryKind,
      homeHotKind: _compactData.hotKind,
      homeCampusExpanded: !!_compactData.campusExpanded,
    };
  };

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
    host.removeAttribute('aria-busy');
    host.innerHTML = '<div class="compact-error"><span>' + htmlEscape(label) + '</span><button type="button" data-compact-retry="' + htmlEscape(retryKind) + '">重试</button></div>';
  }

  // v306：渲染结果与当前 DOM 一致时跳过赋值（回首页/resize 不重播动效）；
  // 有变化才替换，并在替换「之前」探测骨架预态（数据首到→无动画直接呈现，
  // 内容→内容→整块 swap），探测逻辑见 app.js revealListItems。
  function renderHtmlWithMotion(host, html, animate) {
    if (!host) return;
    if (host.innerHTML === html) return;
    var isInitialLoad = !!host.querySelector('.h8-skeleton-card, .h8-skeleton-row, .compact-loading');
    host.innerHTML = html;
    if (animate !== false && typeof revealListItems === 'function') revealListItems(host, isInitialLoad);
    else host.removeAttribute('aria-busy');
  }

  function renderCompactStats(stats, error, options) {
    var animate = !options || options.animate !== false;
    var fields = ['total_courses', 'total_files', 'total_users', 'college_with_data_count'];
    document.querySelectorAll('#compactHomeLayout [data-stat]').forEach(function (element) {
      var value = stats && stats[element.getAttribute('data-stat')];
      if (typeof value === 'number' && typeof animateCount === 'function') animateCount(element, value, animate);
      else element.textContent = typeof value === 'number' ? value : '—';
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

  function syncCompactTopState() {
    var top = document.getElementById('compactTopPanel');
    var moreLink = document.getElementById('compactCampusMore');
    var expanded = !!_compactData.campusExpanded;
    if (top) {
      top.classList.toggle('is-expanded', expanded);
      top.dataset.expanded = expanded ? 'true' : 'false';
    }
    if (moreLink && !moreLink.hidden) {
      moreLink.textContent = expanded ? '收起入口 →' : '展开入口 →';
      moreLink.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
  }

  function setCompactTopExpanded(expanded) {
    _compactData.campusExpanded = !!expanded;
    if (typeof patchViewState === 'function') patchViewState({ homeCampusExpanded: _compactData.campusExpanded });
    syncCompactTopState();
    renderCompactAnnouncement({ value: { items: _compactData.announcements }, error: null });
    renderCompactCampus({ value: _compactData.campusPayload || { items: _compactData.campus }, error: null });
  }

  // ── 公告卡头条轮换：首帧 = 最新公告（复用公告行解剖），后两帧 = 交流群/反馈常青内容 ──
  // 无缝循环：轨道首尾各克隆一帧，越过边缘后瞬间归位到真实帧，正反向都不回跳；
  // 支持指针拖拽换页（touch-action: pan-y，纵向滚动不受影响）。展开面板、数据刷新
  // 都会重走渲染：轮播 DOM 只在帧内容变化时重建，当前帧序号跨渲染保留（展开后
  // 轮播仍在卡片顶部原位继续）；点击促销帧跳「关于 → 联系我们」。
  var _carouselIndex = 0;
  var _carouselTimer = null;
  var _carouselHover = false;
  var _carouselBoundDoc = false;
  var _carouselReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var _carouselInterval = 5500;
  var _carouselSnapTimer = null;
  var _carouselSuppressClick = false;

  function compactCarouselSlides(items) {
    var slides = [];
    if (items.length) {
      var item = items[0];
      var id = Number(item.id || 0);
      slides.push('<a class="h8-carousel-slide h8-carousel-notice compact-announcement-link" href="/announcements#announcement-' + id + '" data-announcement-id="' + id + '"><span class="h8-label">' + htmlEscape(String(item.created_at || '').slice(0, 10)) + '</span><strong>' + htmlEscape(item.title) + '</strong><span class="h8-carousel-excerpt">' + htmlEscape(plainText(item.content).slice(0, 100)) + '</span></a>');
    }
    slides.push(
      '<a class="h8-carousel-slide h8-carousel-promo compact-announcement-link" href="/about" data-about-contact="1"><span class="h8-carousel-body"><span class="h8-label">用户群</span><strong>加入用户交流群</strong><span class="h8-carousel-text">微信扫码进群，和同学、维护者直接交流。</span></span><img class="h8-carousel-qr" src="/static/group-qr.png?v=312" width="56" height="56" alt="用户交流群二维码" loading="lazy"></a>',
      '<a class="h8-carousel-slide h8-carousel-promo compact-announcement-link" href="/about" data-about-contact="1"><span class="h8-carousel-body"><span class="h8-label">反馈问卷</span><strong>意见反馈</strong><span class="h8-carousel-text">一分钟填完，问题和建议都会被认真看到。</span></span></a>'
    );
    return slides;
  }

  function _carouselHost() {
    return document.querySelector('#compactAnnouncement .h8-carousel');
  }

  // 轨道 DOM = [克隆末帧, 真实帧×N, 克隆首帧]；domIndex = 真实序号 + 1
  function _carouselRealCount(track) {
    return Math.max(track.children.length - 2, 0);
  }

  function _carouselCancelSnap() {
    if (_carouselSnapTimer) { clearTimeout(_carouselSnapTimer); _carouselSnapTimer = null; }
  }

  function _carouselSyncAria(host, track) {
    var realCount = _carouselRealCount(track);
    Array.prototype.forEach.call(track.children, function (slide, i) {
      var isClone = i === 0 || i === realCount + 1;
      var current = !isClone && i - 1 === _carouselIndex;
      slide.setAttribute('aria-hidden', isClone || !current ? 'true' : 'false');
      if (current) slide.removeAttribute('tabindex');
      else slide.setAttribute('tabindex', '-1');
    });
    Array.prototype.forEach.call(host.querySelectorAll('.h8-carousel-ticks button'), function (tick, i) {
      if (i === _carouselIndex) tick.setAttribute('aria-current', 'true');
      else tick.removeAttribute('aria-current');
    });
  }

  // 边缘越界后的瞬间归位：关过渡 → 跳到真实帧 → 强制回流 → 恢复过渡。
  // 期间若用户开始拖拽，拖拽侧会先同步冲销这份挂起归位，不会跳帧。
  function _carouselQueueEdgeSnap(track) {
    _carouselCancelSnap();
    _carouselSnapTimer = setTimeout(function () {
      _carouselSnapTimer = null;
      track.style.transition = 'none';
      _carouselMoveTo(track, _carouselIndex + 1);
      void track.offsetWidth;
      track.style.transition = '';
    }, 370);
  }

  function _carouselMoveTo(track, domIndex) {
    track.style.transform = 'translateX(-' + domIndex * 100 + '%)';
  }

  function compactCarouselGo(index) {
    var host = _carouselHost();
    var track = host && host.querySelector('.h8-carousel-track');
    if (!track || !track.children.length) return;
    var realCount = _carouselRealCount(track);
    if (!realCount) return;
    _carouselCancelSnap();
    var prev = _carouselIndex;
    _carouselIndex = ((index % realCount) + realCount) % realCount;
    var atDom;
    if (prev === realCount - 1 && _carouselIndex === 0) {
      atDom = realCount + 1;            // 末帧再前进 → 滑入克隆首帧，落定后归位
      _carouselMoveTo(track, atDom);
      _carouselQueueEdgeSnap(track);
    } else if (prev === 0 && _carouselIndex === realCount - 1) {
      atDom = 0;                        // 首帧再后退 → 滑入克隆末帧，落定后归位
      _carouselMoveTo(track, atDom);
      _carouselQueueEdgeSnap(track);
    } else {
      atDom = _carouselIndex + 1;
      _carouselMoveTo(track, atDom);
    }
    _carouselSyncAria(host, track);
  }

  function compactCarouselRestartTimer() {
    if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
    var host = _carouselHost();
    if (!host || !host.isConnected) return;
    var track = host.querySelector('.h8-carousel-track');
    if (!track || track.children.length < 3) return;
    // reduced-motion 用户不自动轮换，只经刻度线/拖拽手动切换
    if (_carouselReduced.matches || _carouselHover || document.hidden) return;
    _carouselTimer = setInterval(function () { compactCarouselGo(_carouselIndex + 1); }, _carouselInterval);
  }

  // 指针拖拽换页：超过 6px 才算拖拽（期间接管指针、暂停自动轮换），
  // 按宽度 15%（≤72px）阈值决定翻页或弹回；拖拽后的点击一律吞掉防误触。
  function compactCarouselBindDrag(carousel, track) {
    var startX = 0, dx = 0, pointerId = null, dragging = false, baseDom = 0;
    carousel.addEventListener('dragstart', function (e) { e.preventDefault(); });
    carousel.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointerId = e.pointerId; startX = e.clientX; dx = 0; dragging = false;
      baseDom = _carouselIndex + 1;
    });
    carousel.addEventListener('pointermove', function (e) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      dx = e.clientX - startX;
      if (!dragging && Math.abs(dx) > 6) {
        dragging = true;
        carousel.classList.add('is-dragging');
        // 冲销挂起的边缘归位，让拖拽基准落在真实帧上
        if (_carouselSnapTimer) {
          _carouselCancelSnap();
          track.style.transition = 'none';
          _carouselMoveTo(track, _carouselIndex + 1);
          void track.offsetWidth;
          track.style.transition = '';
        }
        track.style.transition = 'none';
        if (carousel.setPointerCapture) { try { carousel.setPointerCapture(e.pointerId); } catch (err) {} }
        if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
      }
      if (dragging) track.style.transform = 'translateX(calc(' + (-baseDom * 100) + '% + ' + dx + 'px))';
    });
    function endDrag(e) {
      if (pointerId === null || (e.pointerId !== undefined && e.pointerId !== pointerId)) return;
      pointerId = null;
      if (!dragging) return;
      dragging = false;
      carousel.classList.remove('is-dragging');
      track.style.transition = '';
      var w = carousel.clientWidth || 1;
      var moved = Math.abs(dx) > Math.min(72, w * 0.15) ? (dx < 0 ? 1 : -1) : 0;
      _carouselSuppressClick = true;
      compactCarouselGo(_carouselIndex + moved);
      compactCarouselRestartTimer();
    }
    carousel.addEventListener('pointerup', endDrag);
    carousel.addEventListener('pointercancel', endDrag);
    carousel.addEventListener('click', function (e) {
      if (_carouselSuppressClick) { e.preventDefault(); e.stopPropagation(); _carouselSuppressClick = false; }
    }, true);
  }

  // 触控板双指横扫 / 横向滚轮走的是 wheel 事件（没有 pointerdown），横向占优时
  // 翻帧并 preventDefault（同时挡掉 macOS 触控板横扫误触浏览器前进/后退）；
  // 纵向占优放行页面滚动。每次手势只翻一帧：惯性尾巴由 latch 拦截，
  // 200ms 无事件视为手势结束，累积量清零后可接下一次滑动。
  function compactCarouselBindWheel(carousel) {
    var acc = 0, latch = false, idle = null;
    carousel.addEventListener('wheel', function (e) {
      var dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (Math.abs(dx) < 4 || Math.abs(dx) <= Math.abs(dy)) {
        acc = 0; latch = false;
        if (idle) { clearTimeout(idle); idle = null; }
        return;
      }
      e.preventDefault();
      if (idle) clearTimeout(idle);
      idle = setTimeout(function () { acc = 0; latch = false; idle = null; }, 200);
      if (latch) return;
      acc += dx;
      if (Math.abs(acc) >= 60) {
        var dir = acc > 0 ? 1 : -1;
        latch = true; acc = 0;
        compactCarouselGo(_carouselIndex + dir);
        compactCarouselRestartTimer();
      }
    }, { passive: false });
  }

  function compactCarouselBind(carousel) {
    carousel.addEventListener('mouseenter', function () { _carouselHover = true; compactCarouselRestartTimer(); });
    carousel.addEventListener('mouseleave', function () { _carouselHover = false; compactCarouselRestartTimer(); });
    carousel.addEventListener('focusin', function () { _carouselHover = true; compactCarouselRestartTimer(); });
    carousel.addEventListener('focusout', function (event) {
      if (!carousel.contains(event.relatedTarget)) { _carouselHover = false; compactCarouselRestartTimer(); }
    });
    compactCarouselBindDrag(carousel, carousel.querySelector('.h8-carousel-track'));
    compactCarouselBindWheel(carousel);
    Array.prototype.forEach.call(carousel.querySelectorAll('.h8-carousel-ticks button'), function (tick) {
      tick.addEventListener('click', function () {
        compactCarouselGo(Number(tick.getAttribute('data-index')) || 0);
        compactCarouselRestartTimer();
      });
    });
    if (_carouselBoundDoc) return;
    _carouselBoundDoc = true;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
      } else {
        compactCarouselRestartTimer();
      }
    });
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
    // 常青帧（交流群/反馈）兜底：卡内始终有内容，公告为空也不再隐藏整卡
    if (block) block.hidden = false;
    var slides = compactCarouselSlides(items);
    var signature = slides.join('|');
    var carousel = host.querySelector('.h8-carousel');
    if (!carousel || carousel.dataset.signature !== signature) {
      _carouselIndex = 0;
      var ticks = slides.map(function (_, i) {
        return '<button type="button" data-index="' + i + '" aria-label="切换到第 ' + (i + 1) + ' 帧"></button>';
      }).join('');
      host.innerHTML =
        '<div class="h8-carousel" aria-roledescription="轮播" aria-label="公告与联系入口">' +
          '<div class="h8-carousel-track">' + slides.join('') + '</div>' +
          '<div class="h8-carousel-ticks" role="group" aria-label="轮换内容切换">' + ticks + '</div>' +
        '</div>' +
        '<div class="h8-notice-rest"></div>';
      carousel = host.querySelector('.h8-carousel');
      carousel.dataset.signature = signature;
      // 首尾克隆帧实现无缝循环：克隆去交互属性，仅作越界过渡的画面
      var track = carousel.querySelector('.h8-carousel-track');
      var stripClone = function (node) {
        node.classList.add('h8-carousel-clone');
        node.setAttribute('aria-hidden', 'true');
        node.setAttribute('tabindex', '-1');
        ['href', 'data-announcement-id', 'data-about-contact'].forEach(function (attr) { node.removeAttribute(attr); });
      };
      if (track.children.length >= 2) {
        var cloneLast = track.lastElementChild.cloneNode(true);
        stripClone(cloneLast);
        track.insertBefore(cloneLast, track.firstChild);
        var cloneFirst = track.children[1].cloneNode(true);
        stripClone(cloneFirst);
        track.appendChild(cloneFirst);
      }
      compactCarouselBind(carousel);
    }
    compactCarouselGo(_carouselIndex);
    // 展开区：头条轮播之外的公告（第 2、3 条），收起时清空
    var rest = host.querySelector('.h8-notice-rest');
    if (rest) {
      var restItems = _compactData.campusExpanded ? items.slice(1, 3) : [];
      var restHtml = restItems.map(function (item) {
        var id = Number(item.id || 0);
        return '<a href="/announcements#announcement-' + id + '" data-announcement-id="' + id + '" class="h8-notice-row compact-announcement-link"><span class="h8-label">' + htmlEscape(String(item.created_at || '').slice(0, 10)) + '</span><strong>' + htmlEscape(item.title) + '</strong><span class="h8-carousel-excerpt">' + htmlEscape(plainText(item.content).slice(0, 100)) + '</span></a>';
      }).join('');
      if (rest.innerHTML !== restHtml) rest.innerHTML = restHtml;
    }
    compactCarouselRestartTimer();
    updateHelperVisibility();
  }

  function canManageCampus() {
    var user = typeof currentUser !== 'undefined' ? currentUser : null;
    var active = typeof isMgmtActive === 'function' ? isMgmtActive() : true;
    return !!(user && user.role === 'super_admin' && active);
  }

  function renderCompactCampus(result, options) {
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
    var visibleItems = _compactData.campusExpanded ? items : items.slice(0, 6);
    renderHtmlWithMotion(host, items.length
      ? visibleItems.map(function (item) {
          return '<a href="' + htmlEscape(item.url) + '" target="_blank" rel="noopener noreferrer" class="h8-campus-link compact-campus-link"><span>' + htmlEscape(item.name) + '</span><span aria-hidden="true">↗</span></a>';
        }).join('')
      : '<p class="h8-shortcut-note">还没有配置校园入口。</p>', options && options.animate);
    // 「展开入口」收进区块头部，并与公告面板共享同一个展开状态。
    if (moreLink) {
      var hasMore = items.length > 6 || _compactData.announcements.length > 1;
      moreLink.hidden = !hasMore;
    }
    syncCompactTopState();
    updateHelperVisibility();
  }

  function renderCompactRecommendations(result, options) {
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
      host.removeAttribute('aria-busy');
      host.innerHTML = '<div class="compact-empty"><span>' + emptyText + '</span><a href="/explorer/通识课" data-home-action="courses">查看全部课程</a></div>';
      return;
    }
    renderRecommendationItems(!options || options.animate !== false);
  }

  function renderRecommendationItems(animate) {
    var host = document.getElementById('compactRecommendations');
    if (!host) return;
    var items = _compactData.recommendations || [];
    var html = items.slice(0, 4).map(function (item) { return materialMarkup(item, true); }).join('');
    if (host.innerHTML === html) return;
    var isInitialLoad = !!host.querySelector('.h8-skeleton-card, .h8-skeleton-row, .compact-loading');
    host.innerHTML = html;
    // 仅数据到达路径触发动画决策；resize 触发的重建（animate=false）静默替换
    if (animate !== false && typeof revealListItems === 'function') revealListItems(host, isInitialLoad);
    else host.removeAttribute('aria-busy');
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

  function renderCompactHot(kind, animate) {
    var host = document.getElementById('compactHotList');
    var more = document.getElementById('compactHotMore');
    var note = document.getElementById('compactHotNote');
    if (!host) return;
    var stats = _compactData.stats || {};
    var key = kind === 'favorite' ? 'top_favorited' : 'top_downloaded';
    var items = Array.isArray(stats[key]) ? stats[key].slice(0, 8) : [];
    _compactData.hotKind = kind === 'favorite' ? 'favorite' : 'download';
    if (typeof patchViewState === 'function') patchViewState({ homeHotKind: _compactData.hotKind });
    document.querySelectorAll('.h8-rank-tabs [data-hot]').forEach(function (tab) {
      var active = tab.getAttribute('data-hot') === _compactData.hotKind;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (note) note.textContent = _compactData.hotKind === 'favorite' ? '按收藏量排序' : '按下载量排序';
    if (more) more.dataset.rankingType = _compactData.hotKind;
    if (!items.length) {
      host.removeAttribute('aria-busy');
      host.innerHTML = '<p class="compact-empty">暂无可展示的真实资料</p>';
      return;
    }
    renderHtmlWithMotion(host, items.map(function (item, index) {
      var id = Number(item.id) || 0;
      var count = _compactData.hotKind === 'favorite' ? (item.favorite_count || 0) : (item.download_count || 0);
      return '<article class="h8-rank-row compact-rank-row"><span class="h8-rank-num">' + String(index + 1).padStart(2, '0') + '</span><div><a href="/file/' + id + '" data-material-link="' + id + '">' + htmlEscape(item.title || '未命名资料') + '</a><small>' + htmlEscape(item.course_name || '') + '</small></div><span class="h8-metric">' + htmlEscape(count) + '<small>' + (_compactData.hotKind === 'favorite' ? '收藏' : '下载') + '</small></span></article>';
    }).join(''), animate);
  }

  function renderCompactRecent(animate) {
    var host = document.getElementById('compactRecentList');
    if (!host) return;
    var stats = _compactData.stats || {};
    var items = Array.isArray(stats.recent_uploads) ? stats.recent_uploads.slice(0, 8) : [];
    if (!items.length) {
      host.removeAttribute('aria-busy');
      host.innerHTML = '<p class="compact-empty">暂无可展示的真实资料</p>';
      return;
    }
    renderHtmlWithMotion(host, items.map(function (item) {
      var id = Number(item.id) || 0;
      var date = String(item.created_at || '').slice(0, 10).slice(5).replace('-', ' / ');
      return '<article class="h8-rank-row compact-rank-row"><div><a href="/file/' + id + '" data-material-link="' + id + '">' + htmlEscape(item.title || '未命名资料') + '</a><small>' + recentMetaMarkup(item) + '</small></div><time>' + htmlEscape(date) + '</time></article>';
    }).join(''), animate);
  }

  function renderCompactDesktopLists(stats, error, options) {
    var hotHost = document.getElementById('compactHotList');
    var recentHost = document.getElementById('compactRecentList');
    if (!hotHost || !recentHost) return;
    if (error) {
      setHostError(hotHost, '热门资料暂时无法读取。', 'stats');
      setHostError(recentHost, '最近上传暂时无法读取。', 'stats');
      return;
    }
    renderCompactHot(_compactData.hotKind || 'download', options && options.animate);
    renderCompactRecent(options && options.animate);
  }

  function renderCompactDiscovery(kind, error, animate) {
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
    if (typeof patchViewState === 'function') patchViewState({ homeDiscoveryKind: _compactData.discoveryKind });
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
      host.removeAttribute('aria-busy');
      host.innerHTML = '<p class="compact-empty">暂无可展示的真实资料</p>';
      return;
    }
    renderHtmlWithMotion(host, items.map(function (item, index) {
      var marker = kind === 'recent' ? '' : '<span class="compact-discovery-rank">' + String(index + 1).padStart(2, '0') + '</span>';
      var count = kind === 'favorite' ? ((item.favorite_count || 0) + ' 收藏') : kind === 'download' ? ((item.download_count || 0) + ' 下载') : String(item.created_at || '').slice(0, 10);
      return '<button type="button" class="compact-discovery-item" data-material-id="' + (Number(item.id) || 0) + '">' + marker + '<span class="compact-discovery-info"><strong>' + htmlEscape(item.title || '未命名资料') + '</strong><small>' + (kind === 'recent' ? recentMetaMarkup(item) : htmlEscape(item.course_name || '')) + '</small></span><span class="compact-discovery-count">' + htmlEscape(count) + '</span></button>';
    }).join(''), animate);
  }

  function clearCompactData() {
    _compactReadyKey = null;
    _compactData.stats = null;
    _compactData.announcements = [];
    _compactData.campus = [];
    _compactData.campusPayload = null;
    _compactData.campusExpanded = false;
    syncCompactTopState();
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
    restoreCompactViewState();
    var context = currentContext();
    var key = contextKey(context);
    // 首次打开需要把真实内容和区块入场编排合在一起；回到首页时内容已在屏幕上，
    // 只做后台校准，避免推荐接口晚到又单独触发一次 swap。
    var animateResponse = _compactReadyKey !== key;
    // 没有可靠的后端身份字段时保守隐藏 2026 新生入口，不根据用户名猜测。
    var entry = document.getElementById('compact2026Link');
    if (entry) entry.style.display = 'none';
    if (_compactRequest && _compactRequest.key === key) return _compactRequest.promise;
    // 推荐与首屏刚需数据并行请求：互不阻塞，慢接口只延迟自己那块的渲染。
    // （此前推荐链在刚需数据之后，导致推荐永远最后到达、在整页动效结束后才换内容。）
    var recommendationPromise = requestPart('/api/recommendations/?limit=4').then(function (recommendations) {
      if (!isCurrent(context) || (document.body && document.body.dataset.homeLayout !== 'compact')) return false;
      renderCompactRecommendations(recommendations, { animate: animateResponse });
      return !recommendations.error;
    });
    var criticalPromise = Promise.all([
      requestPart('/api/stats/?limit=8'), requestPart('/api/announcements/?limit=3'),
      requestPart('/api/campus-links/'),
    ]).then(function (result) {
      if (!isCurrent(context) || (document.body && document.body.dataset.homeLayout !== 'compact')) return false;
      var stats = result[0], announcements = result[1], campus = result[2];
      _compactData.stats = stats.value;
      renderCompactStats(stats.value, stats.error, { animate: animateResponse });
      renderCompactDesktopLists(stats.value, stats.error, { animate: animateResponse });
      renderCompactAnnouncement(announcements);
      renderCompactCampus(campus, { animate: animateResponse });
      renderCompactDiscovery(_compactData.discoveryKind || 'recent', stats.error, animateResponse);
      var note = document.getElementById('compactDataNote');
      var failed = result.some(function (part) { return !!part.error; });
      if (note && !stats.error) note.innerHTML = failed ? '<span>部分数据暂时无法读取，页面未使用估算值。</span> <button type="button" data-compact-retry="all">重试</button>' : '';
      return true;
    });
    var promise = Promise.all([criticalPromise, recommendationPromise]).then(function (result) {
      if (isCurrent(context) && document.body && document.body.dataset.homeLayout === 'compact') {
        _compactReadyKey = key;
      }
      // 首屏数据（含推荐）渲染完毕：放行被 data-motion-hold 扣住的入场编排，
      // 让级联动画带着真实内容起播，而不是演完骨架再等内容弹入。
      if (typeof releaseHeldReveals === 'function') releaseHeldReveals();
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
          setCompactTopExpanded(!_compactData.campusExpanded);
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
      // 公告卡轮播的常青帧（交流群/反馈问卷）：点击进「关于 → 联系我们」
      var aboutContact = event.target.closest('[data-about-contact]');
      if (aboutContact && typeof showAbout === 'function') { event.preventDefault(); showAbout('contact'); return; }
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
          // 收藏成功的一次性奖励反馈：星标过冲弹跳（reduced-motion 下自动跳过）
          if (data.favorited && typeof replayClass === 'function') replayClass(favorite, 'star-pop', 320);
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
      if (document.body && document.body.dataset.homeLayout === 'compact') renderRecommendationItems(false);
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
  // 外观切换（宽松/紧凑布局）后补拉当前布局数据，并放行可能仍被扣住的编排
  window.addEventListener('bnuappearancechange', function () {
    if (document.body && document.body.dataset.homeLayout === 'compact' && document.getElementById('homeView') && document.getElementById('homeView').classList.contains('active')) loadCompactHome();
  });
  document.addEventListener('DOMContentLoaded', function () { setupCompactEvents(); });
})();
