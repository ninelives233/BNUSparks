/* BNU Sparks · tutorial-entry.js —— 动画使用教程：统一打开入口、首次资格调度、
   加载中/失败壳、认证代次检查与全局去重。轻量静态加载（index.html 直接引用）；
   完整分镜模块（data/scenes/player + tutorial.css）按需经 feature-loader 拉取。
   全局命名空间 window.BnuTutorial：open/close/maybeOffer/destroy。

   背景与历史（2026-10-03 四次修订）：教程是真实页面之上的浮窗。打开时只压
   一条 tutorial 历史条目（后退=关闭），不再 switchView('tutorial')——来源页
   （首页/课程/问答…）保持可见，经 inert + 焦点陷阱 + 滚动锁变为不可交互；
   直达或刷新 /tutorial 时由 app.js 先渲染真实首页作背景再开浮窗。关闭经
   history.back 交还历史，由 popstate 的常规恢复路径还原来源页与滚动位置；
   无可信来源（新标签直达）时关闭把该条目原地替换为首页。 */
(function () {
  'use strict';

  // ── 运行状态 ──
  var overlay = null;          // .tutorial-overlay 根节点
  var dialog = null;           // .tutorial-dialog
  var player = null;           // BnuTutorialPlayer 实例
  var phase = 'closed';        // closed | loading | open | error | closing
  var openPromise = null;
  var closeTimer = 0;          // 关闭退场动画的移除兜底
  var openerEl = null;         // 打开教程的入口元素（关闭后焦点回归）
  var sourceState = null;      // 进入教程前的可信站内历史状态
  var inerted = [];            // 被设为 inert 的背景节点
  var openGen = 0;             // 打开时的认证代次
  var openAccountKey = null;   // 打开时的账号标识
  var pendingIntent = null;    // 未登录点“去试试”后的明确入口动作（仅内存）
  var intentPoll = null;
  var statusCache = null;      // { gen, userId, promise } 当前账号状态请求去重

  var Data = function () { return window.BnuTutorialData; };

  function gen() { return window._bnuAuthGeneration || 0; }
  // _suppressingPushState 是 explorer-core.js 的顶层 let（全局词法绑定，不在 window 上），
  // 必须以裸标识符赋值才能命中 pushViewState 的同一个绑定。
  function suppressPush(value) {
    try { _suppressingPushState = value; } catch (e) { window._suppressingPushState = value; }
  }
  function accountKey() {
    try { return window.currentUser && window.currentUser.id ? String(window.currentUser.id) : ''; }
    catch (e) { return ''; }
  }

  // ── 背景 inert（保留原始状态供还原） ──
  function applyInert() {
    inerted = [];
    Array.prototype.forEach.call(document.body.children, function (node) {
      if (node === overlay) return;
      var tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'TEMPLATE') return;
      if (node.hasAttribute('inert')) return;
      node.setAttribute('inert', '');
      inerted.push(node);
    });
  }
  function restoreInert() {
    inerted.forEach(function (node) { node.removeAttribute('inert'); });
    inerted = [];
  }

  // ── 焦点回归 ──
  function restoreFocus() {
    var active = document.activeElement;
    if (openerEl && openerEl.isConnected) {
      try { openerEl.focus({ preventScroll: true }); } catch (e) { openerEl.focus(); }
      return;
    }
    if (!active || active === document.body) {
      var main = document.getElementById('mainContent');
      if (main) main.focus();
    }
  }

  function emitOpenClose() {
    document.dispatchEvent(new CustomEvent(phase === 'open' ? 'bnututorialopen' : 'bnututorialclose'));
  }

  // ── 清理（不动历史） ──
  function cleanupOverlay() {
    if (phase === 'closed' && !overlay) return;
    // closing 也是“曾经打开”：关闭事件照常广播，外部监听者不丢信号
    var wasOpen = phase === 'open' || phase === 'closing';
    if (closeTimer) { window.clearTimeout(closeTimer); closeTimer = 0; }
    if (player) { try { player.destroy(); } catch (e) {} player = null; }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    dialog = null;
    restoreInert();
    if (typeof unlockScroll === 'function') unlockScroll();
    if (typeof deactivateDialog === 'function') deactivateDialog();
    restoreFocus();
    phase = 'closed';
    openPromise = null;
    openAccountKey = null;
    if (wasOpen) emitOpenClose();
  }

  // ── 壳 DOM ──
  function buildShell() {
    overlay = document.createElement('div');
    overlay.className = 'tutorial-overlay';
    dialog = document.createElement('div');
    dialog.className = 'tutorial-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'tutorialDialogTitle');
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function renderLoading() {
    dialog.textContent = '';
    var box = document.createElement('div');
    box.className = 'tutorial-shell';
    box.innerHTML =
      '<div class="tutorial-shell-spinner" aria-hidden="true"></div>' +
      '<p class="tutorial-shell-text">正在准备教程…</p>';
    // 关闭按钮在加载期间持续可用（Escape 也经 .tutorial-close 命中）
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'tutorial-shell-btn tutorial-close';
    close.textContent = '关闭';
    close.addEventListener('click', function () { closeRequested(); });
    box.appendChild(close);
    dialog.appendChild(box);
    // 可访问名称占位（挂载后由 player 接管）
    var t = document.createElement('h2');
    t.id = 'tutorialDialogTitle';
    t.className = 'tutorial-sr';
    t.textContent = '木铎星火使用教程';
    dialog.appendChild(t);
  }

  // 显式入口的加载失败壳：重试 / 文字说明 / 关闭；自动触发保持安静。
  function renderLoadError(onRetry) {
    phase = 'error';
    dialog.textContent = '';
    var box = document.createElement('div');
    box.className = 'tutorial-shell is-error';
    var p = document.createElement('p');
    p.className = 'tutorial-shell-text';
    p.textContent = '教程暂时没加载出来，可以重试，或先看文字使用说明。';
    box.appendChild(p);
    var actions = document.createElement('div');
    actions.className = 'tutorial-shell-actions';
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'tutorial-shell-btn is-primary';
    retry.textContent = '重试';
    retry.addEventListener('click', function () {
      phase = 'loading';
      renderLoading();
      loadFeature().then(function () {
        mountPlayer({ mode: 'catalog', source: 'retry' });
      }).catch(function () {
        renderLoadError(onRetry);
      });
    });
    var guide = document.createElement('button');
    guide.type = 'button';
    guide.className = 'tutorial-shell-btn';
    guide.textContent = '文字使用说明';
    guide.addEventListener('click', function () { renderFallbackGuide(); });
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'tutorial-shell-btn tutorial-close';
    close.textContent = '关闭';
    close.addEventListener('click', function () { closeRequested(); });
    actions.appendChild(retry);
    actions.appendChild(guide);
    actions.appendChild(close);
    box.appendChild(actions);
    dialog.appendChild(box);
    var t = document.createElement('h2');
    t.id = 'tutorialDialogTitle';
    t.className = 'tutorial-sr';
    t.textContent = '木铎星火使用教程';
    dialog.appendChild(t);
  }

  // 模块加载失败时的文字兜底：直接渲染 views.js 暴露的 staticPages.tutorial 内容。
  function renderFallbackGuide() {
    var data = window.BnuTutorialTextGuide;
    dialog.textContent = '';
    var box = document.createElement('div');
    box.className = 'tutorial-shell is-guide';
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'tutorial-shell-btn';
    back.textContent = '← 返回';
    back.addEventListener('click', function () { renderLoadError(true); });
    box.appendChild(back);
    if (data && data.sections) {
      var h = document.createElement('h2');
      h.textContent = data.title || '使用教程';
      h.className = 'tutorial-guide-fallback-title';
      box.appendChild(h);
      data.sections.forEach(function (s) {
        var sec = document.createElement('section');
        sec.className = 'tutorial-guide-fallback-sec';
        if (s.heading) {
          var h3 = document.createElement('h3');
          h3.textContent = s.heading;
          sec.appendChild(h3);
        }
        var p = document.createElement('p');
        p.textContent = s.text || '';
        sec.appendChild(p);
        box.appendChild(sec);
      });
    }
    var actions = document.createElement('div');
    actions.className = 'tutorial-shell-actions';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'tutorial-shell-btn tutorial-close';
    close.textContent = '关闭';
    close.addEventListener('click', function () { closeRequested(); });
    actions.appendChild(close);
    box.appendChild(actions);
    dialog.appendChild(box);
  }

  function loadFeature() {
    if (typeof ensureFeature !== 'function') return Promise.reject(new Error('feature loader 未就绪'));
    return ensureFeature('tutorial');
  }

  function mountPlayer(mountOpts) {
    var Player = window.BnuTutorialPlayer;
    var D = Data();
    if (!Player || !D) throw new Error('教程模块不完整');
    var accountId = accountKey();
    var progress = Player.createProgress(accountId, gen);
    if (accountId) {
      if (statusCache && statusCache.userId === accountId) {
        statusCache.promise.then(function (payload) {
          if (gen() === openGen && phase === 'open') progress.initFromServer(payload);
        }).catch(function () { /* 服务端不可达：先用本地进度 */ });
      } else {
        // 显式打开且本轮尚未取过状态：补一次服务端权威 seen
        fetchAccountStatus().then(function (payload) {
          if (gen() === openGen && phase === 'open') progress.initFromServer(payload);
        }).catch(function () { /* 先用本地进度 */ });
      }
    }
    dialog.textContent = '';
    player = Player.mount({
      host: dialog,
      mode: mountOpts.mode || 'catalog',
      groupId: mountOpts.groupId,
      lessonId: mountOpts.lessonId,
      // 手机舞台断点由播放器内部监听视口变化（跨断点重建场景），
      // 这里不再传入一次性快照
      progress: progress,
      gen: gen,
      onClose: function () { closeRequested(); },
      onTryIt: function (actionId) { runTryIt(actionId); },
      onCoreLeave: function () { dismissOffer(); },
      onNavigate: function (nav) {
        if (typeof patchViewState !== 'function') return;
        var extra = { tutorialView: nav.view };
        if (nav.groupId) extra.tutorialGroup = nav.groupId;
        if (nav.lessonId) extra.tutorialLesson = nav.lessonId;
        patchViewState(extra);
      }
    });
    phase = 'open';
    emitOpenClose();
    // 加载壳被播放器替换后重新建立焦点陷阱；activateDialog 内部经 rAF 聚焦
    // 第一个可聚焦控件（顶栏「目录」）。语义焦点必须排在它之后：双 rAF 严格
    // 保持 FIFO 顺序（含 rAF 被节流合并到同一帧的环境），最终落点为
    // 播放视图的操作名称 / 目录的首组卡。
    if (typeof activateDialog === 'function') activateDialog(dialog);
    var reassertFocus = function () { try { player.focusInitial(); } catch (e) {} };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () { requestAnimationFrame(reassertFocus); });
    } else {
      reassertFocus();
    }
  }

  // ── 打开 ──
  // opts: { mode: 'catalog'|'core', source, groupId?, lessonId?, fromHistory?, silent? }
  function open(opts) {
    opts = opts || {};
    if (phase === 'open' || phase === 'loading') {
      // 全局去重：重复调用不得增加第二层浮窗
      return openPromise || Promise.resolve();
    }
    if (phase === 'closing') {
      // 快速关闭再打开：立即完成上一次退出（移除节点、恢复背景），再全新打开
      cleanupOverlay();
    }
    var mode = opts.mode === 'core' ? 'core' : 'catalog';
    var explicit = !opts.silent;
    // 注意：懒加载完成前 BnuTutorialData 尚未就绪，这里不能据此降级模式——
    // 核心分镜是数据的常量，加载成功后必然存在（见 loadFeature 之后的 mountPlayer）。
    if (Data() && Data().coreLessons && !Data().coreLessons().length) mode = 'catalog';
    if (Data() && opts.groupId && !Data().groupById(opts.groupId)) opts.groupId = null;

    openGen = gen();
    openAccountKey = accountKey();
    openerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!opts.fromHistory) {
      // 可信站内来源：教程条目自身不算（新标签直达 /tutorial 或刷新恢复时为 null）
      sourceState = (history.state && history.state._bnusparks && !history.state._modal && history.state.view !== 'tutorial')
        ? history.state : null;
    }
    // 教程路由自身就是唯一历史项：只压教程条目（后退=关闭教程），背景页面
    // 保持不动——来源页在浮窗后面保持可见（inert + 滚动锁由 buildShell 之后的
    // applyInert/lockScroll 建立），不再 switchView('tutorial') 把空教程页当前景。
    // 从历史恢复（前进/刷新）进入时历史已就位，连条目也不压。
    if (!opts.fromHistory && typeof pushViewState === 'function') pushViewState('tutorial', {});
    buildShell();
    applyInert();
    lockScroll();
    activateDialog(dialog);
    phase = 'loading';
    renderLoading();
    emitOpenClose();

    openPromise = loadFeature().then(function () {
      if (gen() !== openGen || openAccountKey !== accountKey()) {
        // 加载期间退出/换号：不重新打开已关闭的浮窗
        if (phase !== 'closed') cleanupOverlay();
        return null;
      }
      // 懒加载期间用户可能已关闭（popstate 分支 cleanupOverlay）
      if (phase !== 'loading') return null;
      mountPlayer({ mode: mode, groupId: opts.groupId, lessonId: opts.lessonId, source: opts.source });
      return true;
    }).catch(function () {
      if (gen() !== openGen) { if (phase !== 'closed') cleanupOverlay(); return false; }
      if (explicit) {
        renderLoadError(true);
      } else {
        // 自动触发加载失败保持安静
        cleanupOverlay();
      }
      return false;
    });
    return openPromise;
  }

  // ── 关闭 ──
  // opts: { fromPopstate } — 浏览器后退已由历史处理，这里只做即时清理。
  // 普通关闭：请求到达即停表（halt，之后的进度写入不再发生），窗口播放
  // 160ms 退场动画，动画结束（或 220ms 兜底）后移除节点、交还历史，再恢复
  // 焦点、滚动与背景交互。减少动态效果与加载中直接清理，保持即时、清晰。
  function close(opts) {
    opts = opts || {};
    if (phase === 'closed') return Promise.resolve();
    if (phase === 'closing') return openPromise || Promise.resolve();
    if (opts.fromPopstate) {
      // 退场动画期间到达的 popstate（✕ 关闭内部触发了 history.back）：
      // 不重复清理，让进行中的退场动画走完；背景视图由 popstate 正常恢复
      if (phase === 'open' || phase === 'loading' || phase === 'error') cleanupOverlay();
      return Promise.resolve();
    }
    if (player) { try { player.halt(); } catch (e) {} }
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduce || !dialog || phase === 'loading' || phase === 'error') {
      cleanupOverlay();
      navigateBackFromClose();
      return Promise.resolve();
    }
    phase = 'closing';
    var finished = false;
    var finish = function () {
      if (finished) return;
      finished = true;
      dialog.removeEventListener('animationend', finish);
      cleanupOverlay();
      // 历史交还放在退场结束后：若退场被快速重开打断（cleanupOverlay），
      // 排队的 history.back 不会再到达并把新会话的历史条目弹掉
      navigateBackFromClose();
    };
    dialog.classList.add('is-closing');
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(finish, 220);
    dialog.addEventListener('animationend', finish);
    return Promise.resolve();
  }

  // 关闭按钮：返回进入前的站内历史项；无可信站内来源（新标签直达）→ 替换为首页。
  // 历史交还发生在退场动画结束之后（见 close 内 finish）：背景本就保持来源页，
  // 无视觉代价；动画被打断时不再触发，避免弹掉重开会话的新条目。
  function navigateBackFromClose() {
    var st = history.state;
    if (st && st.view === 'tutorial') {
      if (sourceState) {
        history.back();
      } else {
        showHomeReplacing();
      }
    }
  }

  function closeRequested() {
    return close({});
  }

  function showHomeReplacing() {
    if (typeof showHome !== 'function') return;
    suppressPush(true);
    try { showHome(); } finally { suppressPush(false); }
    if (typeof pushViewState === 'function') pushViewState('home', {}, true);
  }

  // ── “去试试”（§7.2） ──
  // 动作白名单分发：不接受任意 URL 或函数名字符串。
  // 写操作与下载仍由真实业务 UI 确认；教程只负责合法的业务入口导航。
  var ACTION_RUNNERS = {
    'browse-courses': function () {
      showAllCourses();
      // 待页面就绪再聚焦站点搜索框：不填入示例关键词、不执行搜索
      window.setTimeout(function () {
        var input = document.querySelector('.search-box input');
        if (input && document.activeElement !== input) {
          try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
        }
      }, 350);
      return { view: 'explorer', extra: { expPath: (typeof expPath !== 'undefined' && expPath && expPath.slice) ? expPath.slice() : ['通识课'] } };
    },
    'my-courses': function () {
      ttNavTimetable();
      return { view: 'timetable', extra: {} };
    },
    'favorites': function () { showMyFavoritesPage(); return { view: 'myfavorites', extra: {} }; },
    'favorites-course': function () { showMyFavoritesPage('course'); return { view: 'myfavorites', extra: {} }; },
    'favorites-file': function () { showMyFavoritesPage('file'); return { view: 'myfavorites', extra: {} }; },
    'favorites-post': function () { showMyFavoritesPage('post'); return { view: 'myfavorites', extra: {} }; },
    'my-uploads': function () { showMyUploadsPage(); return { view: 'myuploads', extra: {} }; },
    'my-uploads-rejected': function () { showMyUploadsPage('rejected'); return { view: 'myuploads', extra: {} }; },
    'qa': function () { showQa(); return { view: 'qa', extra: {} }; },
    // 弹层/延迟导航型动作：先恢复进入教程前的页面，再打开业务入口（内部自行压历史）
    'upload-picker': function () { openCourseSearchUpload(); return null; },
    'new-course': function () { openNewCourse(); return null; }
  };

  function runTryIt(actionId) {
    var D = Data();
    var spec = D && D.actions && D.actions[actionId];
    var runner = ACTION_RUNNERS[actionId];
    if (!spec || !runner) return;
    if (spec.requiresAuth && !window.currentUser) {
      // 未登录：先关闭教程、打开现有登录窗口，不叠两层模态；
      // 登录成功后只恢复这个明确点击的入口动作（只读入口，不执行写操作）。
      pendingIntent = actionId;
      close({});
      showLoginModal();
      armIntentResume();
      return;
    }
    // 离开教程前停止时间轴；先清理，再以目标视图替换教程历史项
    cleanupOverlay();
    var wasTutorialEntry = history.state && history.state.view === 'tutorial';
    if (spec.feature && typeof ensureFeature === 'function' &&
        !(window._bnusparksFeatureReady && window._bnusparksFeatureReady[spec.feature])) {
      // 目标模块未加载：先把教程历史项还原为来源页，等模块就绪后再进入
      // （openNewCourse/openCourseSearchUpload 内部自行处理加载与历史）。
      restoreSourceEntry();
      ensureFeature(spec.feature).then(function () { runner(); }).catch(function () {
        alert('功能模块加载失败，请稍后重试。');
      });
      return;
    }
    suppressPush(true);
    var result = null;
    try { result = runner(); } finally { suppressPush(false); }
    if (wasTutorialEntry && result && typeof pushViewState === 'function') {
      // 以目标业务视图替换教程历史项：前一项仍是进入教程前的页面
      pushViewState(result.view, result.extra || {}, true);
    } else if (wasTutorialEntry) {
      restoreSourceEntry();
    }
  }

  function restoreSourceEntry() {
    var st = history.state;
    if (!st || st.view !== 'tutorial') return;
    var restored = sourceState && sourceState._bnusparks
      ? sourceState
      : { _bnusparks: true, view: 'home', scrollY: 0 };
    var url = typeof routeToPath === 'function' ? routeToPath(restored.view, restored) : null;
    history.replaceState(restored, '', url || location.pathname);
    try { sessionStorage.setItem('bnusparks_view', JSON.stringify(restored)); } catch (e) {}
    if (typeof switchView === 'function' && restored.view) {
      switchView(restored.view, true);
      if (typeof updateSidebar === 'function') updateSidebar(restored.view);
    }
  }

  // ── 登录意图恢复 ──
  function armIntentResume() {
    if (intentPoll) window.clearInterval(intentPoll);
    var tries = 0;
    intentPoll = window.setInterval(function () {
      tries++;
      var modal = document.getElementById('loginModal');
      var register = document.getElementById('registerModal');
      var modalOpen = (modal && modal.style.display === 'flex') || (register && register.style.display === 'flex');
      if (!pendingIntent) { window.clearInterval(intentPoll); intentPoll = null; return; }
      if (!window.currentUser || modalOpen) {
        if (tries > 40) { // 有界：约 20s 后放弃
          window.clearInterval(intentPoll);
          intentPoll = null;
          pendingIntent = null;
        }
        return;
      }
      window.clearInterval(intentPoll);
      intentPoll = null;
      var actionId = pendingIntent;
      pendingIntent = null;
      var runner = ACTION_RUNNERS[actionId];
      var D = Data();
      var spec = D && D.actions && D.actions[actionId];
      if (!runner || !spec) return;
      if (spec.feature && typeof ensureFeature === 'function') {
        ensureFeature(spec.feature).then(runner).catch(function () {});
      } else {
        runner();
      }
    }, 500);
  }

  // ── 服务端状态（§8.2 GET） ──
  function fetchAccountStatus() {
    var userId = accountKey();
    if (!userId || typeof window.api !== 'function') return Promise.reject(new Error('未登录'));
    if (statusCache && statusCache.userId === userId && gen() === statusCache.gen) return statusCache.promise;
    var promise = window.api('/api/auth/tutorial/').catch(function (err) {
      if (statusCache && statusCache.promise === promise) statusCache = null;
      throw err;
    });
    statusCache = { userId: userId, gen: gen(), promise: promise };
    return promise;
  }

  function dismissOffer() {
    // “跳过介绍”或核心浏览中关闭：pending/offered → dismissed；
    // 已 offered 时即使本次未同步成功，之后也不再自动弹（服务端条件更新）。
    if (!accountKey() || typeof window.api !== 'function') return;
    var captured = gen();
    window.api('/api/auth/tutorial/', { method: 'POST', body: { action: 'dismiss_offer' } })
      .catch(function () { /* 静默：网络失败时服务端仍为 pending，由下次登录再处理 */ });
    if (statusCache) statusCache = null;
    void captured;
  }

  // ── 首次登录调度（§7.3） ──
  var sched = {
    eligible: false,      // 服务端资格（本轮登录）
    stopped: false,       // 服务端判定无资格后停止
    settleTimer: 0,
    retries: 0,
    maxRetries: 14,
    retryTimer: 0
  };

  // 有界事件调度：不无限轮询。
  var TASK_SELECTOR = [
    '#loginModal', '#registerModal', '#forgotPwdModal', '#resetPwdModal', '#uploadModal',
    '#navDrawer', '#notifDrawer',
    '.search-overlay', '.file-info-overlay', '.preview-overlay', '.admin-reject-overlay',
    '.announcement-editor-overlay', '.course-switch-overlay', '.profile-edit-overlay',
    '.campus-manager-overlay', '.tt-overlay', '.tt-detail-overlay'
  ].join(',');

  function hasForegroundTask() {
    var nodes = document.querySelectorAll(TASK_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var style = window.getComputedStyle(n);
      if (style.display !== 'none' && style.visibility !== 'hidden' && n.offsetParent !== null) return true;
    }
    // 课表导入/编辑等教程外的进行中任务
    if (document.querySelector('.tt-import-panel, .tt-editing')) return true;
    return false;
  }

  function activeReadingView() {
    var st = history.state;
    if (st && st._bnusparks && !st._modal) return st.view === 'home' || st.view === 'timetable';
    var activeEl = document.querySelector('.view-section.active');
    return !!activeEl && (activeEl.id === 'homeView' || activeEl.id === 'timetableView');
  }

  function offerConditionsMet() {
    if (!window.currentUser) return false;
    if (!sched.eligible || sched.stopped) return false;
    if (pendingIntent) return false;
    if (phase !== 'closed') return false;
    if (!window._bnusparksReady) return false;
    if (document.hidden) return false;
    if (!activeReadingView()) return false;
    if (hasForegroundTask()) return false;
    return true;
  }

  function cancelSettle() {
    if (sched.settleTimer) { window.clearTimeout(sched.settleTimer); sched.settleTimer = 0; }
  }

  function scheduleOfferCheck() {
    if (!sched.eligible || sched.stopped) return;
    if (offerConditionsMet()) {
      if (!sched.settleTimer) {
        // 连续 600ms 满足才领取自动展示
        sched.settleTimer = window.setTimeout(function () {
          sched.settleTimer = 0;
          if (offerConditionsMet()) claimAndOpen();
        }, 600);
      }
      return;
    }
    cancelSettle();
    // 条件未满足：有界重试（事件驱动为主，计时兜底为辅）
    if (sched.retries < sched.maxRetries && !sched.retryTimer) {
      sched.retries++;
      sched.retryTimer = window.setTimeout(function () {
        sched.retryTimer = 0;
        scheduleOfferCheck();
      }, 1600);
    }
  }

  function claimAndOpen() {
    if (!accountKey() || typeof window.api !== 'function') return;
    // 领取前再核一次条件：条件破坏时不领取（资格保持 pending，等未来合适的空闲点）
    if (!offerConditionsMet()) return;
    var capturedGen = gen();
    window.api('/api/auth/tutorial/', { method: 'POST', body: { action: 'claim_offer' } })
      .then(function (res) {
        if (gen() !== capturedGen) return;
        if (!res || res.claimed !== true) { sched.stopped = true; return; }
        // 领取成功：只有这个会话显示核心导览
        open({ mode: 'core', source: 'auto' }).then(function (ok) {
          if (ok === false) cleanupOverlay(); // 模块失败保持安静
        });
      })
      .catch(function () {
        // 状态接口失败：本次不自动弹，也不冒泡成登录失败
        sched.stopped = true;
      });
  }

  function maybeOffer() {
    if (!window.currentUser) { sched.eligible = false; return; }
    if (phase !== 'closed' || pendingIntent) return;
    fetchAccountStatus().then(function (data) {
      if (gen() !== statusCacheGen()) return;
      if (!data || data.eligible !== true) { sched.eligible = false; sched.stopped = true; return; }
      sched.eligible = true;
      sched.stopped = false;
      sched.retries = 0;
      scheduleOfferCheck();
    }).catch(function () { /* 状态接口失败：本次不自动弹 */ });
  }

  function statusCacheGen() { return statusCache ? statusCache.gen : -1; }

  // 用户开始输入/点击业务动作 → 取消本轮 settle，稍后空闲点重新检查
  document.addEventListener('click', function () { cancelSettle(); scheduleOfferCheck(); }, true);
  document.addEventListener('keydown', function () { cancelSettle(); }, true);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { sched.retries = 0; scheduleOfferCheck(); }
    else cancelSettle();
  });
  window.addEventListener('popstate', function () { cancelSettle(); sched.retries = 0; scheduleOfferCheck(); });
  document.addEventListener('bnuviewchange', function () { sched.retries = 0; scheduleOfferCheck(); });

  // 认证触发点：密码登录、邮箱验证后自动登录、有效会话启动恢复都经
  // setAuthenticatedUser 派发 bnuauthchange（auth.js）。
  window.addEventListener('bnuauthchange', function (event) {
    var detail = event && event.detail || {};
    // 退出/换号：立即清理教程和调度；后续请求以 userId + 代次判定归属
    statusCache = null;
    if (phase !== 'closed') {
      cleanupOverlay();
      if (history.state && history.state.view === 'tutorial') {
        open({ mode: 'catalog', fromHistory: true, silent: true });
      }
    }
    if (!detail.userId) { sched.eligible = false; sched.stopped = true; cancelSettle(); return; }
    // 换号后旧账号响应不能打开新账号的教程（fetchAccountStatus 内按 userId 去重）
    cancelSettle();
    sched.retries = 0;
    maybeOffer();
  });

  // ── 对外接口 ──
  window.BnuTutorial = {
    open: function (opts) { return open(opts || {}); },
    close: function (opts) { return close(opts || {}); },
    isOpen: function () { return phase === 'open' || phase === 'loading' || phase === 'error' || phase === 'closing'; },
    maybeOffer: function () { maybeOffer(); },
    destroy: function () {
      cancelSettle();
      if (sched.retryTimer) window.clearTimeout(sched.retryTimer);
      if (intentPoll) window.clearInterval(intentPoll);
      pendingIntent = null;
      cleanupOverlay();
    }
  };
})();
