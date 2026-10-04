/* BNU Sparks · tutorial-player.js —— 动画使用教程：控制器、唯一时钟、暂停/销毁、
   进度合并、主题目录与可访问性。懒加载模块（feature-loader: tutorial，在
   data → scenes 之后加载）。只操作教程浮窗内部 DOM；导航、历史与认证归
   tutorial-entry.js 管。

   播放模型（2026-10-03 四次修订：稳定视觉中心）：
   - 三种状态各司其职：目录（选主题）／播放（看懂一个操作）／完成（继续、
     重看或去实际操作）。播放态顶栏只有「目录」导航入口、当前操作名称与
     关闭；主题名、操作计数、组内列表与本操作完整步骤都收进导航面板；
     主动打开导航面板即暂停播放。
   - 解说进入舞台构图：舞台底部是固定解说条，一次一句，位置稳定不随对象
     游走，不遮挡演示内容。舞台对读屏保持 aria-hidden，解说经 aria-live
     区域按顺序完整播报，完整文字列表在导航面板中可达。
   - 默认无模拟鼠标：步骤由真实控件自身表达——定位用焦点环（is-hot），
     动作就地发生（输入填入、菜单自入口展开、状态就地切换），按压反馈是
     控件自身的轻微脉动（td-act）。只有场景数据声明需要时才表达移动本身。
   - 唯一时间基准：一个 rAF 驱动的虚拟时钟推进步骤、焦点、滚动与解说；
     对象级微动画用 WAAPI/CSS，暂停时经 getAnimations(subtree) 一并冻结；
     场景超出演示框时按“真实页面滚动”语义平滑滚入目标（随虚拟时钟走，
     暂停即冻结）。页面隐藏即明确暂停。
   - 结束守门：最后一步的动作与结果停留都完成后才切换完成态、记“已看”；
     完成态主按钮只有一个（去试试），重播与下一项保持安静。
   - 离开播放视图的所有路径（返回目录、文字说明、错误、关闭、销毁）统一走
     stopPlayback()：递增运行令牌、取消 rAF 与场景动画、清空焦点与滚动。
   - 控制节点全程稳定：单行控制栏（上一项/主控/下一项），主控位在暂停/
     继续/重播三态间只换文字，min-width 固定，无宽度跳动。 */
(function () {
  'use strict';

  var Data = window.BnuTutorialData;
  var Scenes = window.BnuTutorialScenes;

  // 步骤节奏（虚拟毫秒）：默认均匀节奏仅作兜底；正式节奏由 data 的 pace 数组
  // 逐步声明（pace[k] = 第 k+1 步字幕与前一步字幕的间隔），与
  // tools/check_tutorial_scenes.js 的下限一致。动作在字幕出现并留出阅读时间后
  // 就地发生。
  var LEAD_MS = 1100;
  var TAIL_MS = 1500;
  var READ_MIN_MS = 500;    // 字幕出现到动作发生的最短阅读时间
  var READ_MAX_MS = 900;    // 阅读时间上限（再长的文案也不无限推迟动作）
  var RESULT_MIN_MS = 800;  // 动作结果到下一句解说之间的最短停留
  var SCROLL_MS = 320;      // 定位滚动时长（虚拟时钟驱动，暂停即冻结）
  var STALL_MS = 4000;      // 单帧间隔超过此值 = 环境停跳（而非一次普通卡顿），明确暂停
  var VIEW_SWAP_MS = 280;   // 视图切换旧层清理兜底（动画 170–220ms）

  var moduleRate = 1;       // 仅 QA 调试接口可改（慢速观察），正常恒为 1

  function cueTimes(durationMs, steps, pace) {
    if (steps <= 1) return [0];
    // pace[k]：第 k+1 步与前一步的间隔（ms）。缺失或非法时回退到均匀分布。
    if (Array.isArray(pace) && pace.length === steps - 1 &&
        pace.every(function (v) { return typeof v === 'number' && v > 0; })) {
      var pCues = [0];
      for (var p = 1; p < steps; p++) pCues.push(pCues[p - 1] + Math.round(pace[p - 1]));
      return pCues;
    }
    var span = (durationMs - LEAD_MS - TAIL_MS) / (steps - 1);
    var cues = [0];
    for (var i = 1; i < steps; i++) cues.push(Math.round(LEAD_MS + (i - 1) * span));
    return cues;
  }

  // 阅读时长按文案长度走：短句快点动身，长句留足读的时间；设上限，
  // 不把所有步骤统一拉长（导出给守门脚本复算时长公式）。
  function readLead(text) {
    var len = (text || '').length;
    return Math.max(READ_MIN_MS, Math.min(READ_MAX_MS, 380 + 32 * Math.max(0, len - 8)));
  }

  // ── 进度仓库（§8.3） ─────────────────────────────────────
  // 登录用户以服务端 seen 为准；本地按 origin 隔离缓存 UI 状态与待同步队列；
  // 访客仅本地记录，永不请求账号状态接口。
  function createProgress(accountId, genFn) {
    var isAccount = !!accountId;
    var storageKey = isAccount
      ? 'bnu:tutorial:account:' + accountId + ':v1'
      : 'bnu:tutorial:guest:v1';
    var storage = (function () {
      try {
        var t = window.localStorage;
        var probe = '__bnu_tut_probe__';
        t.setItem(probe, '1');
        t.removeItem(probe);
        return t;
      } catch (e) { return null; }
    })();
    var local = load() || { seen: {}, pending: [] };
    var serverSeen = {};
    var listeners = [];
    var flushing = false;

    function load() {
      if (!storage) return null;
      try {
        var raw = storage.getItem(storageKey);
        var parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') return null;
        return { seen: parsed.seen || {}, pending: Array.isArray(parsed.pending) ? parsed.pending : [] };
      } catch (e) { return null; }
    }
    function save() {
      if (!storage) return;
      try { storage.setItem(storageKey, JSON.stringify(local)); } catch (e) { /* 空间满等：保持内存态 */ }
    }
    function revisionOf(id) {
      return Data.lessons[id] ? Data.lessons[id].revision : 1;
    }
    function has(id) {
      var rev = revisionOf(id);
      return (local.seen[id] || 0) >= rev || (serverSeen[id] || 0) >= rev;
    }
    function seenCount(ids) {
      var n = 0;
      (ids || []).forEach(function (id) { if (has(id)) n++; });
      return n;
    }
    function mark(id, rev) {
      if (!Data.lessons[id]) return;
      rev = rev || revisionOf(id);
      if ((local.seen[id] || 0) >= rev && (!isAccount || (serverSeen[id] || 0) >= rev)) return;
      if ((local.seen[id] || 0) < rev) { local.seen[id] = rev; save(); }
      if (isAccount) enqueueSync(id, rev);
      emit();
    }
    function enqueueSync(id, rev) {
      if ((serverSeen[id] || 0) >= rev) return;
      for (var i = 0; i < local.pending.length; i++) {
        if (local.pending[i].lesson_id === id && local.pending[i].revision === rev) return;
      }
      local.pending.push({ lesson_id: id, revision: rev });
      save();
      flush();
    }
    // 待同步队列逐条幂等补交；换号（认证代次变化）立即停止，只能该账号再次登录后发送。
    var openGen = genFn ? genFn() : 0;
    function stopped() {
      return !genFn || genFn() !== openGen;
    }
    function flush() {
      if (flushing || !isAccount || !local.pending.length) return;
      if (typeof window.api !== 'function') return;
      flushing = true;
      var item = local.pending[0];
      window.api('/api/auth/tutorial/', {
        method: 'POST',
        body: { action: 'mark_seen', lesson_id: item.lesson_id, revision: item.revision }
      }).then(function (res) {
        if (stopped()) { flushing = false; return; }
        (res && res.seen || []).forEach(function (row) {
          serverSeen[row.lesson_id] = Math.max(serverSeen[row.lesson_id] || 0, row.revision);
        });
        local.pending = local.pending.filter(function (p) {
          return (serverSeen[p.lesson_id] || 0) < p.revision;
        });
        save();
        flushing = false;
        emit();
        flush();
      }).catch(function () {
        // 请求失败：保留待同步项与“进度暂存在此设备”说明
        flushing = false;
      });
    }
    // 用服务端权威 seen 初始化（仅登录用户；entry 已做过认证代次校验）。
    function initFromServer(payload) {
      if (!isAccount || !payload) return;
      serverSeen = {};
      (payload.seen || []).forEach(function (row) {
        if (Data.lessons[row.lesson_id]) {
          serverSeen[row.lesson_id] = Math.max(serverSeen[row.lesson_id] || 0, row.revision);
        }
      });
      local.pending = local.pending.filter(function (p) {
        return (serverSeen[p.lesson_id] || 0) < p.revision;
      });
      save();
      emit();
    }
    function onChange(fn) { listeners.push(fn); }
    function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
    function unsyncedCount() { return local.pending.length; }

    return {
      isAccount: isAccount,
      has: has,
      seenCount: seenCount,
      mark: mark,
      initFromServer: initFromServer,
      onChange: onChange,
      unsyncedCount: unsyncedCount
    };
  }

  // ── DOM 小工具 ────────────────────────────────────────────
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btnb(cls, label) {
    var n = el('button', cls, label);
    n.type = 'button';
    return n;
  }

  // ── 播放器 ────────────────────────────────────────────────
  // opts: {
  //   host: 对话框内容宿主元素
  //   mode: 'catalog' | 'core'
  //   groupId?, lessonId?         主动进入时可指定落点
  //   progress: createProgress 实例
  //   gen: 认证代次读取函数
  //   onClose(reason)             关闭整个教程（reason: 'close'|'escape'）
  //   onTryIt(actionId)           去试试
  //   onCoreLeave()               核心导览被跳过/关闭（dismiss_offer）
  //   onNavigate(state)           内部视图变化（entry 用来 patchViewState）
  // }
  function mount(opts) {
    var host = opts.host;
    var progress = opts.progress;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var mqMobile = window.matchMedia('(max-width: 600px)');
    var waapiOk = typeof (Element && Element.prototype.animate) === 'function';

    // 内存导航状态：不写历史，仅 patchViewState 通知 entry
    var view = 'catalog';           // catalog | lesson | guide
    var coreMode = opts.mode === 'core';
    var coreIdx = 0;
    var groupId = null;
    var lessonIdx = 0;
    var catalogScroll = 0;
    var navOpen = false;
    var enteredFromCore = opts.mode === 'core';

    // 播放运行时
    var state = 'idle';            // idle | playing | paused | ended
    var runToken = 0;
    var clock = { raf: 0, last: 0, elapsed: 0 };
    var currentLesson = null;
    var variant = null;
    var scene = null;
    var cues = [];
    var cueIdx = 0;
    var stepIndex = -1;
    var step = null;               // { idx, actionAt, applied }
    var scrollAnim = null;         // { el, from, to, startedAt, dur }
    var focusEl = null;            // 当前焦点环（is-hot）所在节点
    var stageClip = null;
    var captionText = null;
    var startTimer = 0;
    var announceTimer = 0;
    var sawReduce = reduceMotion.matches;

    // ── 壳 DOM ──
    var root = el('div', 'tutorial-root');
    var topbar = el('div', 'tutorial-topbar');
    var navBtn = btnb('tutorial-nav-toggle', '目录');
    navBtn.setAttribute('aria-expanded', 'false');
    navBtn.setAttribute('aria-controls', 'tutorialToc');
    var titleEl = el('div', 'tutorial-topbar-title');
    titleEl.tabIndex = -1;
    var counterEl = el('span', 'tutorial-counter');
    var backBtn = btnb('tutorial-back', '← 返回目录');
    backBtn.setAttribute('aria-label', '返回全部教程');
    var skipBtn = btnb('tutorial-skip', '跳过介绍');
    var closeBtn = btnb('tutorial-close', '✕');
    closeBtn.setAttribute('aria-label', '关闭教程');
    topbar.appendChild(navBtn);
    topbar.appendChild(titleEl);
    topbar.appendChild(counterEl);
    topbar.appendChild(backBtn);
    topbar.appendChild(skipBtn);
    topbar.appendChild(closeBtn);

    var announce = el('div', 'tutorial-sr');
    announce.setAttribute('aria-live', 'polite');
    announce.setAttribute('role', 'status');

    var body = el('div', 'tutorial-body');
    // 导航面板：主题名、操作计数、组内列表与本操作完整步骤（主动打开即暂停）
    var navPanel = el('div', 'tutorial-nav-panel');
    navPanel.id = 'tutorialToc';
    navPanel.hidden = true;

    // 控制栏：单行紧凑。节点只建一次，之后只更新文字/属性/状态（焦点不丢）；
    // 播放态只有安静的上一项/主控/下一项；完成态主控位变重播、
    // 「去试试」作为唯一主按钮出现在右侧。
    var footer = el('div', 'tutorial-footer');
    footer.hidden = true;
    var prevBtn = btnb('tutorial-ctl tutorial-ctl-prev', '上一项');
    var playBtn = btnb('tutorial-ctl tutorial-ctl-play', '暂停');
    playBtn.setAttribute('aria-label', '暂停演示');
    var nextBtn = btnb('tutorial-ctl tutorial-ctl-next', '下一项');
    var tryBtn = btnb('tutorial-try-btn', '去试试');
    footer.appendChild(prevBtn);
    footer.appendChild(playBtn);
    footer.appendChild(nextBtn);
    footer.appendChild(tryBtn);

    root.appendChild(topbar);
    root.appendChild(announce);
    root.appendChild(navPanel);
    root.appendChild(body);
    root.appendChild(footer);
    host.appendChild(root);

    // 对话框可访问名称（entry 负责把 aria-labelledby 指到这里）
    var dialogTitle = el('h2', 'tutorial-sr');
    dialogTitle.id = 'tutorialDialogTitle';
    host.appendChild(dialogTitle);

    // Esc 先收起导航面板，再交给对话框的关闭链
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navOpen) {
        e.stopPropagation();
        closeNav();
      }
    });
    // 指向面板外部的指针按下收起面板（面板自身与开关按钮除外）
    root.addEventListener('pointerdown', function (e) {
      if (!navOpen) return;
      var t = e.target;
      if (navPanel.contains(t) || navBtn.contains(t)) return;
      closeNav();
    });

    // ── 场景动画的暂停/恢复/取消（舞台子树，覆盖 CSS+WAAPI） ──
    function stageAnims() {
      if (!stageClip) return [];
      try { return stageClip.getAnimations({ subtree: true }); } catch (e) { return []; }
    }
    function pauseStage() {
      stageAnims().forEach(function (a) { try { a.pause(); } catch (e) {} });
    }
    function resumeStage() {
      stageAnims().forEach(function (a) { try { a.play(); } catch (e) {} });
    }
    function cancelStage() {
      stageAnims().forEach(function (a) { try { a.cancel(); } catch (e) {} });
    }

    function say(text) {
      announce.textContent = '';
      if (announceTimer) window.clearTimeout(announceTimer);
      announceTimer = window.setTimeout(function () {
        announceTimer = 0;
        if (announce.isConnected) announce.textContent = text;
      }, 30);
    }

    // ── 生命周期：离开播放视图的唯一出口 ─────────────────────
    function stopPlayback() {
      runToken++;
      if (startTimer) { window.clearTimeout(startTimer); startTimer = 0; }
      if (announceTimer) { window.clearTimeout(announceTimer); announceTimer = 0; }
      stopClock();
      cancelStage();
      step = null;
      scrollAnim = null;
      clearFocus();
      if (stageClip) {
        Array.prototype.forEach.call(stageClip.querySelectorAll('.td-act'), function (n) {
          n.classList.remove('td-act');
        });
      }
      stepIndex = -1;
      clock.elapsed = 0;
      cueIdx = 0;
      state = 'idle';
    }
    function stopClock() {
      if (clock.raf) { window.cancelAnimationFrame(clock.raf); clock.raf = 0; }
    }

    // ── 顶栏（元素稳定，只切换可见性与文字） ─────────────────
    function renderTopbar() {
      var inCatalog = view === 'catalog';
      // 播放态顶栏：目录入口 + 当前操作名称 + 关闭；核心导览保留跳过介绍；
      // 目录页顶栏只留关闭（标题在正文里）；文字说明返回目录。
      navBtn.hidden = inCatalog || coreMode || view !== 'lesson';
      navBtn.setAttribute('aria-expanded', navOpen ? 'true' : 'false');
      skipBtn.hidden = !coreMode || view !== 'lesson';
      backBtn.hidden = view !== 'guide';
      counterEl.hidden = !(coreMode && view === 'lesson');
      if (inCatalog) {
        titleEl.textContent = '';
      } else if (view === 'guide') {
        titleEl.textContent = '文字使用说明';
      } else if (coreMode) {
        titleEl.textContent = '快速认识木铎星火';
        counterEl.textContent = (coreIdx + 1) + ' / 4';
      } else {
        titleEl.textContent = currentLesson ? currentLesson.title : '';
      }
      var viewName = view === 'catalog' ? '全部教程目录'
        : view === 'guide' ? '文字使用说明'
        : coreMode ? '快速认识木铎星火'
        : (Data.groupById(groupId) || {}).title || '';
      dialogTitle.textContent = '木铎星火使用教程' + (view === 'lesson' && currentLesson ? '：' + currentLesson.title : '') + (viewName && view !== 'lesson' ? '：' + viewName : '');
    }

    // ── 导航面板 ─────────────────────────────────────────────
    function renderNav() {
      if (coreMode || view !== 'lesson' || !groupId) return;
      var lessons = Data.lessonsInGroup(groupId);
      var group = Data.groupById(groupId);
      var seen = progress.seenCount(lessons.map(function (l) { return l.id; }));
      navPanel.textContent = '';
      var head = el('div', 'tutorial-nav-head');
      head.appendChild(el('span', 'tutorial-nav-group', group ? group.title : ''));
      head.appendChild(el('span', 'tutorial-nav-count',
        '操作 ' + (lessonIdx + 1) + ' / ' + lessons.length + ' · 已看 ' + seen));
      navPanel.appendChild(head);

      var list = el('ol', 'tutorial-nav-list');
      lessons.forEach(function (l, i) {
        var item = el('li', 'tutorial-nav-item');
        var b = btnb('tutorial-nav-btn' + (i === lessonIdx ? ' is-active' : ''));
        b.appendChild(el('span', 'tutorial-nav-num', String(i + 1)));
        b.appendChild(el('span', 'tutorial-nav-name', l.title));
        if (progress.has(l.id)) b.appendChild(el('span', 'tutorial-nav-seen', '已看过'));
        b.addEventListener('click', function () {
          closeNav();
          openLesson(groupId, i, i > lessonIdx ? 'fwd' : 'back');
        });
        item.appendChild(b);
        list.appendChild(item);
      });
      navPanel.appendChild(list);

      // 本操作完整步骤与说明（从舞台下方移入导航面板）
      if (variant) {
        var sec = el('div', 'tutorial-nav-sec');
        sec.appendChild(el('div', 'tutorial-nav-sec-title', '本操作完整步骤'));
        var steps = el('ol', 'tutorial-nav-steps');
        variant.steps.forEach(function (s) {
          steps.appendChild(el('li', 'tutorial-nav-step', s));
        });
        sec.appendChild(steps);
        if (variant.note) sec.appendChild(el('p', 'tutorial-nav-note', variant.note));
        navPanel.appendChild(sec);
      }

      var links = el('div', 'tutorial-nav-links');
      var restart = btnb('tutorial-nav-link', '从头观看本组');
      restart.addEventListener('click', function () {
        closeNav();
        openLesson(groupId, 0, 'fwd');
      });
      links.appendChild(restart);
      var guideBtn = btnb('tutorial-nav-link', '文字使用说明');
      guideBtn.addEventListener('click', function () {
        closeNav();
        swapView('fade', openGuide);
      });
      links.appendChild(guideBtn);
      var allBtn = btnb('tutorial-nav-link', '返回全部教程');
      allBtn.addEventListener('click', function () {
        closeNav();
        var g = groupId;
        swapView('fade', function () { renderCatalog(); focusGroupCard(g); });
      });
      links.appendChild(allBtn);
      navPanel.appendChild(links);
    }
    function openNav() {
      if (navBtn.hidden) return;
      renderNav();
      navOpen = true;
      navPanel.hidden = false;
      navBtn.setAttribute('aria-expanded', 'true');
      // 主动打开导航面板：暂停当前演示；收起后由用户点「继续播放」
      autoPause();
    }
    function closeNav() {
      if (!navOpen) return;
      navOpen = false;
      navPanel.hidden = true;
      navBtn.setAttribute('aria-expanded', 'false');
      try { navBtn.focus({ preventScroll: true }); } catch (e) {}
    }

    // ── 目录视图 ──
    function renderCatalog() {
      stopPlayback();
      if (view === 'catalog') catalogScroll = body.scrollTop;
      view = 'catalog';
      footer.hidden = true;
      closeNav();
      navPanel.hidden = true;
      renderTopbar();
      body.textContent = '';
      var wrap = el('div', 'tutorial-catalog');
      var head = el('div', 'tutorial-catalog-head');
      var h = el('h2', 'tutorial-catalog-title', '使用教程');
      h.id = 'tutorialCatalogTitle';
      head.appendChild(h);
      head.appendChild(el('p', 'tutorial-catalog-lead',
        coreMode || enteredFromCore ? '已经认识基本用法了，还有这些小技巧。' : '选一个主题，看看这些功能怎么用。'));
      var aux = el('div', 'tutorial-catalog-aux');
      var replayCore = btnb('tutorial-aux-btn', '重看快速介绍');
      replayCore.addEventListener('click', function () { openCore(); });
      var guideBtn = btnb('tutorial-aux-btn', '文字使用说明');
      guideBtn.addEventListener('click', function () { swapView('fade', openGuide); });
      aux.appendChild(replayCore);
      aux.appendChild(guideBtn);
      head.appendChild(aux);
      if (progress.unsyncedCount() > 0) {
        head.appendChild(el('p', 'tutorial-sync-note', '部分进度暂存在此设备，下次联网时自动同步。'));
      }
      wrap.appendChild(head);

      var grid = el('div', 'tutorial-groups');
      Data.groups.forEach(function (group) {
        var lessons = Data.lessonsInGroup(group.id);
        var seen = progress.seenCount(lessons.map(function (l) { return l.id; }));
        var total = lessons.length;
        var mins = Math.max(1, Math.round(Data.groupDuration(group.id) / 60000));
        var cardEl = btnb('tutorial-group-card');
        cardEl.setAttribute('data-group', group.id);
        cardEl.setAttribute('aria-label', group.title + '，' + total + ' 个操作，约 ' + mins + ' 分钟，已看 ' + seen + ' / ' + total);
        var thumb = el('span', 'tutorial-group-thumb');
        thumb.setAttribute('aria-hidden', 'true');
        thumb.innerHTML = Scenes.thumb(group.id);
        cardEl.appendChild(thumb);
        var info = el('span', 'tutorial-group-info');
        info.appendChild(el('span', 'tutorial-group-title', group.title));
        info.appendChild(el('span', 'tutorial-group-blurb', group.blurb));
        var meta = el('span', 'tutorial-group-meta');
        meta.appendChild(el('span', 'tutorial-group-count', total + ' 个操作 · 约 ' + mins + ' 分钟'));
        var prog = el('span', 'tutorial-group-progress' + (seen >= total ? ' is-done' : ''));
        prog.textContent = seen >= total ? '已看完' : (seen > 0 ? '已看 ' + seen + ' / ' + total : '未开始');
        meta.appendChild(prog);
        info.appendChild(meta);
        cardEl.appendChild(info);
        cardEl.appendChild(el('span', 'tutorial-group-arrow', '→'));
        cardEl.addEventListener('click', function () { openGroup(group.id); });
        grid.appendChild(cardEl);
      });
      wrap.appendChild(grid);
      body.appendChild(wrap);
      body.scrollTop = catalogScroll;
      notifyNavigate();
    }

    // 返回目录时把焦点放回来源组卡（键盘连续性）
    function focusGroupCard(gId) {
      var cardEl = body.querySelector('.tutorial-group-card[data-group="' + gId + '"]') ||
        body.querySelector('.tutorial-group-card');
      if (cardEl) {
        try { cardEl.focus({ preventScroll: true }); } catch (e) { cardEl.focus(); }
      }
    }

    // ── 文字说明视图 ──
    function openGuide() {
      if (view === 'catalog') catalogScroll = body.scrollTop;
      stopPlayback();
      view = 'guide';
      footer.hidden = true;
      closeNav();
      navPanel.hidden = true;
      renderTopbar();
      body.textContent = '';
      var wrap = el('div', 'tutorial-guide');
      var data = window.BnuTutorialTextGuide;
      if (data && data.sections) {
        var h = el('h2', 'tutorial-guide-title', data.title || '使用教程');
        h.tabIndex = -1;
        wrap.appendChild(h);
        data.sections.forEach(function (s) {
          var sec = el('section', 'tutorial-guide-section');
          if (s.heading) sec.appendChild(el('h3', 'tutorial-guide-heading', s.heading));
          var p = el('p', 'tutorial-guide-text');
          p.textContent = s.text || '';
          sec.appendChild(p);
          wrap.appendChild(sec);
        });
        body.appendChild(wrap);
        try { h.focus({ preventScroll: true }); } catch (e) {}
      } else {
        wrap.appendChild(el('p', 'tutorial-guide-text', '文字说明暂时没有加载出来。'));
        body.appendChild(wrap);
      }
      body.scrollTop = 0;
      notifyNavigate();
    }

    // ── 视图切换（换分镜 / 目录 / 文字说明） ──────────────────
    // 旧视图离位（绝对定位叠放）淡出，新视图按方向入画：前进向左、
    // 返回向右、目录/说明往返纯淡入淡出。旧层动画结束后移除（有兜底定时）；
    // 减少动态效果或 WAAPI 不可用时直接替换。快速连续切换时旧层由
    // 各自的兜底定时清理，不互相等待。
    function swapView(kind, buildFn) {
      var oldNode = body.querySelector(
        '.tutorial-play:not(.tutorial-leave), .tutorial-catalog:not(.tutorial-leave), ' +
        '.tutorial-guide:not(.tutorial-leave), .tutorial-static:not(.tutorial-leave)');
      if (oldNode) oldNode.parentNode.removeChild(oldNode);
      buildFn();
      if (!oldNode || reduceMotion.matches || !waapiOk) return;
      var newNode = body.firstElementChild;
      if (!newNode) return;
      oldNode.classList.remove('tutorial-enter', 'is-back', 'is-fade');
      oldNode.classList.add('tutorial-leave');
      newNode.classList.add('tutorial-enter');
      if (kind === 'back') {
        oldNode.classList.add('is-back');
        newNode.classList.add('is-back');
      } else if (kind === 'fade') {
        oldNode.classList.add('is-fade');
        newNode.classList.add('is-fade');
      }
      body.insertBefore(oldNode, body.firstChild);
      // 每次切换的旧层由自己的兜底定时清理（动画被减少动态效果等环境
      // 吞掉时也能移除）；快速连续切换互不等待，只清理各自的层。
      window.setTimeout(function () {
        if (oldNode.parentNode) oldNode.parentNode.removeChild(oldNode);
        if (newNode) newNode.classList.remove('tutorial-enter', 'is-back', 'is-fade');
      }, VIEW_SWAP_MS);
    }

    // ── 播放视图 ──
    function openLesson(gId, idx, dir) {
      var lessons = Data.lessonsInGroup(gId);
      if (!lessons.length) return;
      idx = Math.max(0, Math.min(lessons.length - 1, idx));
      if (view === 'catalog') catalogScroll = body.scrollTop;
      stopPlayback();
      coreMode = false;
      groupId = gId;
      lessonIdx = idx;
      currentLesson = lessons[lessonIdx];
      view = 'lesson';
      renderTopbar();
      swapView(dir || 'fwd', buildLessonView);
      notifyNavigate();
      startLesson();
    }

    // 播放页静态结构：舞台即主视觉（演示区 + 台内解说条）。
    // 不再有第二套标题、可见步骤编号或常驻步骤区块——完整步骤在导航面板里。
    function buildLessonView() {
      footer.hidden = false;
      body.textContent = '';
      var wrap = el('div', 'tutorial-play');
      variant = Data.lessonVariant(currentLesson, mqMobile.matches);

      var stage = el('div', 'tutorial-stage' + (mqMobile.matches ? ' tutorial-stage--mobile' : ''));
      stage.setAttribute('aria-hidden', 'true');
      stageClip = el('div', 'tutorial-stage-clip');
      var stageView = el('div', 'tutorial-stage-view');
      stageClip.appendChild(stageView);
      var caption = el('p', 'tutorial-caption');
      captionText = el('span', 'tutorial-caption-text');
      caption.appendChild(captionText);
      stageClip.appendChild(caption);
      stage.appendChild(stageClip);
      wrap.appendChild(stage);

      body.appendChild(wrap);
      body.scrollTop = 0;
      setCaption(variant.steps[0] || '');
      // 焦点落到顶栏操作名称：进入分镜后键盘/读屏从这里开始
      try { titleEl.focus({ preventScroll: true }); } catch (e) {}
    }

    function currentSceneCtx() {
      return { mobile: mqMobile.matches, capability: Data.capability() };
    }

    function startLesson() {
      stopPlayback();
      if (!currentLesson) return;
      updateControls();
      if (reduceMotion.matches || !waapiOk) { renderStatic(); return; }
      scene = Scenes.build(currentLesson.scene, currentSceneCtx());
      if (!scene) { renderError(); return; }
      cues = cueTimes(currentLesson.durationMs, scene.steps, variant.pace);
      var viewEl = stageClip ? stageClip.querySelector('.tutorial-stage-view') : null;
      if (viewEl) {
        viewEl.textContent = '';
        var lab = el('span', 'tutorial-demo-label', '示例演示');
        viewEl.appendChild(lab);
        viewEl.appendChild(scene.root);
      }
      // 首帧样式就绪：强制回流 + 可取消的短延时（rAF 在节流环境可能不回调）
      void stageClip.offsetWidth;
      state = 'playing';
      updateControls();
      var startToken = runToken;
      startTimer = window.setTimeout(function () {
        startTimer = 0;
        if (startToken !== runToken || state !== 'playing') return;
        startClock();
      }, 60);
    }

    // ── 唯一时钟 ──
    function startClock() {
      stopClock();
      clock.last = performance.now();
      clock.raf = window.requestAnimationFrame(tickFrame);
    }
    function tickFrame(now) {
      clock.raf = 0;
      if (state !== 'playing') return;
      var dt = now - clock.last;
      clock.last = now;
      if (dt > STALL_MS) {
        // 明显卡顿（长停跳）：明确暂停等用户继续，不默默丢弃时间
        autoPause('播放暂时停住了，点「继续播放」接着看。');
        return;
      }
      if (dt < 0) dt = 0;
      clock.elapsed += dt * moduleRate;
      runTimeline();
      if (state === 'playing') clock.raf = window.requestAnimationFrame(tickFrame);
    }

    function runTimeline() {
      // 定位滚动：随虚拟时钟推进，暂停即冻结（可能同时滚动弹窗内部容器与场景根）
      if (scrollAnim) {
        var sp = Math.min(1, (clock.elapsed - scrollAnim.startedAt) / scrollAnim.dur);
        scrollAnim.tweens.forEach(function (tw) {
          tw.el.scrollTop = tw.from + (tw.to - tw.from) * easeInOut(sp);
        });
        if (sp >= 1) scrollAnim = null;
      }
      while (cueIdx < cues.length && clock.elapsed >= cues[cueIdx]) {
        beginStep(cueIdx);
        cueIdx++;
      }
      if (step && !step.applied && clock.elapsed >= step.actionAt) applyStep();
      if (state === 'playing' && clock.elapsed >= currentLesson.durationMs && timelineSettled()) {
        finishLesson();
      }
    }

    // 结束守门：最后一步的阅读、动作与结果停留都完成后才算播完。
    // 不能在动作进行中就切结束态、记“已看”。
    function timelineSettled() {
      return !step || step.applied;
    }

    // ── 步骤执行：字幕（台内解说）→ 定位（焦点环 + 平滑滚动）→
    //    动作（控件自身脉动 + 状态就地变化）→ 结果停留 ──
    function beginStep(i) {
      // 保险：上一步的变化尚未落地就跨到下一步时（大幅推进/调试跳播），先落地
      if (step && !step.applied) applyStep();
      stepIndex = i;
      setCaption(variant.steps[i]);
      say('第 ' + (i + 1) + ' 步：' + variant.steps[i]);
      setFocus(i);
      var target = scene.targets[i] ? targetEl(scene.targets[i]) : null;
      if (target && !targetHidden(target)) scrollToTarget(target);
      // 动作时刻：字幕出现后留出阅读时间，并为结果保留观察停留；
      // 数值边界与 tools/check_tutorial_scenes.js 的时长公式一致。
      var lead = readLead(variant.steps[i]);
      var gap = i < cues.length - 1 ? cues[i + 1] - cues[i] : 0;
      var delay = gap
        ? Math.max(READ_MIN_MS, Math.min(lead, gap - RESULT_MIN_MS))
        : Math.min(lead, READ_MAX_MS);
      step = { idx: i, actionAt: clock.elapsed + delay, applied: false };
    }

    function applyStep() {
      if (!scene || !currentLesson || !step) return;
      step.applied = true;
      // 按压反馈落在控件自身：轻微脉动，无光标、无扩散圆环
      if (scene.clicks[step.idx] && focusEl) {
        focusEl.classList.remove('td-act');
        void focusEl.offsetWidth;
        focusEl.classList.add('td-act');
      }
      try { scene.go(step.idx); } catch (e) { renderError(); return; }
      // 焦点的去留：动作后目标被场景隐藏（点击导航/菜单收起）时同步收环，
      // 不能把强调环留在已消失的对象上
      if (focusEl && (targetHidden(focusEl) || focusEl.classList.contains('is-hidden'))) {
        clearFocus();
      }
    }

    // ── 焦点环（is-hot）：一次一个，随解说指向当前对象 ──────
    function setFocus(i) {
      clearFocus();
      var t = scene.targets[i] ? targetEl(scene.targets[i]) : null;
      if (t && !targetHidden(t)) {
        focusEl = t;
        t.classList.add('is-hot');
      }
    }
    function clearFocus() {
      if (focusEl) {
        focusEl.classList.remove('is-hot');
        focusEl.classList.remove('td-act');
        focusEl = null;
      }
    }

    // ── 台内解说条 ──
    function setCaption(text) {
      if (!captionText) return;
      captionText.classList.remove('td-cap-in');
      void captionText.offsetWidth;
      captionText.textContent = text || '';
      captionText.classList.add('td-cap-in');
    }

    // 场景页或弹窗内部内容超出演示框时，按“真实页面滚动”语义把当前对象滚入
    // 视野：逐层收集场景根内可滚动的祖先（如 modal-card）连同场景根一起平滑
    // 滚动（虚拟时钟驱动，暂停即冻结），不是瞬间跳变。
    function scrollToTarget(target) {
      if (!target || !stageClip || !scene || !scene.root) return;
      if (typeof target.getBoundingClientRect !== 'function') return; // 守门桩
      var tweens = [];
      var n = target.parentNode;
      while (n && n !== stageClip) {
        if (n === scene.root) { addScrollTween(n, target, tweens); break; }
        if (n.nodeType === 1) addScrollTween(n, target, tweens);
        n = n.parentNode;
      }
      if (!tweens.length) return;
      scrollAnim = { startedAt: clock.elapsed, dur: SCROLL_MS, tweens: tweens };
    }
    function addScrollTween(container, target, tweens) {
      var cs = window.getComputedStyle(container);
      if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') return;
      var tr = target.getBoundingClientRect();
      var cr = container.getBoundingClientRect();
      if (!tr.height || !cr.height) return;
      var delta = 0;
      if (tr.top < cr.top + 8) delta = tr.top - cr.top - 16;
      else if (tr.bottom > cr.bottom - 8) delta = tr.bottom - cr.bottom + 16;
      if (delta) tweens.push({ el: container, from: container.scrollTop, to: container.scrollTop + delta });
    }

    function targetEl(name) {
      if (!name || !stageClip) return null;
      try { return stageClip.querySelector('[data-mark="' + name + '"]'); } catch (e) { return null; }
    }
    // 目标是否已被场景隐藏（导航/菜单收起后强调环不能悬在原地）
    function targetHidden(el) {
      var n = el;
      while (n && n !== stageClip) {
        if (n.classList && n.classList.contains('is-hidden')) return true;
        n = n.parentNode;
      }
      return !n; // 已脱离场景根同样视为消失
    }
    function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

    function finishLesson() {
      state = 'ended';
      clearFocus();
      scrollAnim = null;
      updateControls();
      // 记“已看”守门：确实完整播放到末步、仍在本分镜视图、页面可见。
      // 提前离开的路径都先经过 stopPlayback()（state→idle），到不了这里。
      if (document.visibilityState === 'visible' && view === 'lesson' && currentLesson) {
        progress.mark(currentLesson.id, currentLesson.revision);
        say('已看完《' + currentLesson.title + '》，可以选择继续或返回目录。');
      }
    }

    // ── 控制栏（节点稳定，只更新文字/状态） ──────────────────
    function tryActionLabel(actionId) {
      var labels = {
        'browse-courses': '打开全部课程', 'my-courses': '打开我的课程', 'favorites': '打开我的收藏',
        'favorites-course': '打开我的收藏 · 课程', 'favorites-file': '打开我的收藏 · 资料',
        'favorites-post': '打开我的收藏 · 帖子', 'upload-picker': '打开上传入口',
        'new-course': '打开新建课程', 'my-uploads': '打开我的上传',
        'my-uploads-rejected': '打开我的上传 · 已驳回', 'qa': '进入问答区'
      };
      return labels[actionId] || '去试试';
    }
    function nextLabel() {
      var total = coreMode ? 4 : Data.lessonsInGroup(groupId).length;
      var idx = coreMode ? coreIdx : lessonIdx;
      if (idx >= total - 1) return '完成';
      return '下一项';
    }
    function updateControls() {
      var isLesson = view === 'lesson' && !!currentLesson;
      footer.hidden = !isLesson;
      if (!isLesson) return;
      // 静态降级（减少动态效果 / WAAPI 不可用）没有可播放的时间轴：
      // 不显示主控位，避免语义不清的控制
      var staticMode = reduceMotion.matches || !waapiOk;
      playBtn.hidden = staticMode;
      prevBtn.disabled = (coreMode ? coreIdx : lessonIdx) === 0;
      nextBtn.textContent = nextLabel();
      // 「去试试」只在完成态出现，且是唯一的视觉主按钮；
      // 播放期间下一项保持安静，不与任何入口争夺注意力
      var ended = state === 'ended';
      nextBtn.classList.toggle('is-quiet', !staticMode && ended);
      tryBtn.hidden = staticMode || !ended || !currentLesson.action;
      if (!tryBtn.hidden) {
        tryBtn.textContent = '去试试 · ' + tryActionLabel(currentLesson.action);
        tryBtn.setAttribute('aria-label', '去试试：' + tryActionLabel(currentLesson.action));
      }
      if (staticMode) return;
      if (state === 'playing') {
        playBtn.textContent = '暂停';
        playBtn.setAttribute('aria-label', '暂停演示');
        playBtn.disabled = false;
      } else if (state === 'paused') {
        playBtn.textContent = '继续播放';
        playBtn.setAttribute('aria-label', '继续播放');
        playBtn.disabled = false;
      } else if (state === 'ended') {
        // 结束后不放语义不清的禁用按钮：主控位变成重播
        playBtn.textContent = '重播';
        playBtn.setAttribute('aria-label', '重播本项');
        playBtn.disabled = false;
      } else {
        playBtn.textContent = '播放';
        playBtn.setAttribute('aria-label', '播放演示');
        playBtn.disabled = false;
      }
    }

    function step(delta) {
      var total = coreMode ? 4 : Data.lessonsInGroup(groupId).length;
      var idx = coreMode ? coreIdx : lessonIdx;
      if (delta > 0 && idx >= total - 1) {
        if (coreMode) { leaveCore('finished'); return; }
        stopPlayback();
        var g = groupId;
        swapView('fade', function () { renderCatalog(); focusGroupCard(g); });
        say('已看完这一组，返回全部教程。');
        return;
      }
      var nextIdx = Math.max(0, Math.min(total - 1, idx + delta));
      if (coreMode) openCoreLesson(nextIdx, delta > 0 ? 'fwd' : 'back');
      else openLesson(groupId, nextIdx, delta > 0 ? 'fwd' : 'back');
      say('第 ' + (nextIdx + 1) + ' 项，共 ' + total + ' 项：《' + currentLesson.title + '》');
    }

    function togglePlay() {
      if (reduceMotion.matches || !waapiOk) { renderStatic(); return; }
      if (state === 'ended') { replayLesson(); return; }
      if (state === 'playing') {
        state = 'paused';
        stopClock();
        pauseStage();
        updateControls();
        say('演示已暂停。');
        return;
      }
      if (state === 'paused') {
        state = 'playing';
        resumeStage();
        updateControls();
        startClock();
        say('继续播放。');
      }
    }

    function autoPause(announceText) {
      if (state !== 'playing') return;
      state = 'paused';
      stopClock();
      pauseStage();
      updateControls();
      say(announceText || '演示已暂停，点「继续播放」接着看。');
    }

    function replayLesson() {
      if (!currentLesson) return;
      // 重播不重复增加已看记录：mark 幂等（服务端唯一约束 + 本地 revision 比较）
      if (reduceMotion.matches || !waapiOk) { renderStatic(); return; }
      // 重建播放视图：能力/视口分支变化后，标题与步骤文案随之更新
      buildLessonView();
      startLesson();
      say('重播《' + currentLesson.title + '》。');
    }

    // ── 静态步骤视图（reduced-motion / WAAPI 不可用） ──
    // 每步渲染该步的完整场景状态（可读尺寸，不缩成小图），文字并列。
    function renderStatic() {
      stopPlayback();
      state = 'paused';
      updateControls();
      if (!currentLesson) return;
      variant = Data.lessonVariant(currentLesson, mqMobile.matches);
      var playWrap = body.querySelector('.tutorial-play');
      if (playWrap) playWrap.remove();
      var existing = body.querySelector('.tutorial-static');
      if (existing) existing.remove();
      var wrap = el('div', 'tutorial-static td-noanim');
      wrap.appendChild(el('p', 'tutorial-static-note', '已减少动态效果：下面按步骤静态展示这个操作的完整过程。'));
      // 操作按钮置顶：不滚动就能标记已看 / 去试试；步骤图在下方滚动阅读
      var actions = el('div', 'tutorial-static-actions');
      var markBtn = btnb('tutorial-static-mark', progress.has(currentLesson.id) ? '已看过' : '标记已看过');
      if (progress.has(currentLesson.id)) markBtn.disabled = true;
      markBtn.addEventListener('click', function () {
        progress.mark(currentLesson.id, currentLesson.revision);
        markBtn.disabled = true;
        markBtn.textContent = '已看过';
        say('已把《' + currentLesson.title + '》标记为已看过。');
      });
      actions.appendChild(markBtn);
      // 静态模式同样能在读完后来到真实入口（完成态语义）
      if (currentLesson.action) {
        var tryBtn2 = btnb('tutorial-static-try', '去试试 · ' + tryActionLabel(currentLesson.action));
        tryBtn2.addEventListener('click', function () {
          if (currentLesson && currentLesson.action) opts.onTryIt(currentLesson.action);
        });
        actions.appendChild(tryBtn2);
      }
      if (!reduceMotion.matches && waapiOk) {
        var playBtn2 = btnb('tutorial-static-play', '播放演示');
        playBtn2.addEventListener('click', function () {
          var s = body.querySelector('.tutorial-static');
          if (s) s.remove();
          buildLessonView();
          startLesson();
        });
        actions.appendChild(playBtn2);
      }
      wrap.appendChild(actions);
      var steps = el('ol', 'tutorial-static-steps');
      variant.steps.forEach(function (text, i) {
        var li = el('li', 'tutorial-static-step');
        var thumbBox = el('div', 'tutorial-static-thumb');
        thumbBox.setAttribute('aria-hidden', 'true');
        var inst = Scenes.build(currentLesson.scene, currentSceneCtx());
        if (inst) {
          try {
            inst.go(Math.min(i, inst.steps - 1));
            thumbBox.appendChild(inst.root);
          } catch (e) { /* 静态帧构建失败时保留文字步骤 */ }
        }
        li.appendChild(thumbBox);
        li.appendChild(el('div', 'tutorial-static-text', (i + 1) + '. ' + text));
        steps.appendChild(li);
      });
      wrap.appendChild(steps);
      body.insertBefore(wrap, body.firstChild);
      // 插入文档后再测量缩放：游离节点没有布局（offsetHeight 为 0），
      // 纯适配缩放把场景整体缩进缩略图，不裁断文字
      Array.prototype.forEach.call(body.querySelectorAll('.tutorial-static-thumb'), function (tb) {
        var f = tb.querySelector('.tutorial-demo-frame');
        if (!f) return;
        var avail = tb.clientHeight - 16;
        var nat = f.offsetHeight;
        if (nat > avail && nat > 0) {
          f.style.transform = 'scale(' + avail / nat + ')';
          f.style.transformOrigin = 'top center';
        }
      });
    }

    function renderError() {
      stopPlayback();
      footer.hidden = true;
      var playWrap = body.querySelector('.tutorial-play');
      if (playWrap) playWrap.remove();
      body.textContent = '';
      var wrap = el('div', 'tutorial-error');
      wrap.appendChild(el('p', 'tutorial-error-text', '这个演示暂时没有加载出来。'));
      var retry = btnb('tutorial-error-retry', '重试');
      retry.addEventListener('click', function () {
        buildLessonView();
        startLesson();
      });
      wrap.appendChild(retry);
      body.appendChild(wrap);
      try { retry.focus({ preventScroll: true }); } catch (e) {}
    }

    // ── 核心导览 ──
    function openCore() {
      coreMode = true;
      coreIdx = 0;
      enteredFromCore = true;
      openCoreLesson(0);
    }
    function openCoreLesson(idx, dir) {
      var cores = Data.coreLessons();
      if (!cores.length) return;
      idx = Math.max(0, Math.min(cores.length - 1, idx));
      coreIdx = idx;
      currentLesson = cores[idx];
      groupId = currentLesson.groupId;
      lessonIdx = Data.lessonsInGroup(groupId).indexOf(currentLesson);
      view = 'lesson';
      stopPlayback();
      closeNav();
      navPanel.hidden = true;
      renderTopbar();
      swapView(dir || 'fwd', buildLessonView);
      notifyNavigate();
      startLesson();
    }
    function leaveCore(reason) {
      var wasCore = coreMode;
      coreMode = false;
      stopPlayback();
      if (wasCore && opts.onCoreLeave) opts.onCoreLeave(reason);
      swapView('fade', function () {
        renderCatalog();
        focusGroupCard(Data.coreLessons()[0] ? Data.coreLessons()[0].groupId : null);
      });
    }

    function openGroup(gId) {
      coreMode = false;
      var lessons = Data.lessonsInGroup(gId);
      var startIdx = 0;
      for (var i = 0; i < lessons.length; i++) {
        if (!progress.has(lessons[i].id)) { startIdx = i; break; }
        if (i === lessons.length - 1) startIdx = 0; // 整组看过 → 从第一项播放
      }
      openLesson(gId, startIdx);
    }

    function notifyNavigate() {
      if (typeof opts.onNavigate === 'function') {
        opts.onNavigate({
          view: view,
          groupId: groupId,
          lessonId: currentLesson ? currentLesson.id : null,
          core: coreMode
        });
      }
    }

    // ── 事件 ──
    navBtn.addEventListener('click', function () {
      if (navOpen) closeNav();
      else openNav();
    });
    backBtn.addEventListener('click', function () {
      if (view === 'guide') {
        swapView('back', function () { renderCatalog(); focusGroupCard(groupId); });
      }
    });
    closeBtn.addEventListener('click', function () {
      if (coreMode && opts.onCoreLeave) opts.onCoreLeave('close');
      opts.onClose('close');
    });
    skipBtn.addEventListener('click', function () { leaveCore('skip'); });
    prevBtn.addEventListener('click', function () { step(-1); });
    nextBtn.addEventListener('click', function () { step(1); });
    playBtn.addEventListener('click', function () { togglePlay(); });
    tryBtn.addEventListener('click', function () { if (currentLesson && currentLesson.action) opts.onTryIt(currentLesson.action); });

    function onVisibility() {
      if (document.hidden) autoPause('页面切到后台，演示已暂停。');
    }
    function onReduceChange() {
      if (reduceMotion.matches === sawReduce) return;
      sawReduce = reduceMotion.matches;
      if (view !== 'lesson') return;
      // 销毁当前时间轴，展示静态步骤；恢复偏好后仍等待用户“播放演示”
      renderStatic();
    }
    function onMqChange() {
      // 视口跨断点：重建当前分镜视图（确定性重播），不只 mount 时判断一次
      renderTopbar();
      if (view !== 'lesson' || !currentLesson) return;
      if (reduceMotion.matches || !waapiOk) { renderStatic(); return; }
      buildLessonView();
      startLesson();
    }
    document.addEventListener('visibilitychange', onVisibility);
    if (typeof reduceMotion.addEventListener === 'function') {
      reduceMotion.addEventListener('change', onReduceChange);
    } else if (typeof reduceMotion.addListener === 'function') {
      reduceMotion.addListener(onReduceChange);
    }
    if (typeof mqMobile.addEventListener === 'function') {
      mqMobile.addEventListener('change', onMqChange);
    } else if (typeof mqMobile.addListener === 'function') {
      mqMobile.addListener(onMqChange);
    }

    progress.onChange(function () {
      if (view === 'catalog') renderCatalog();
      else if (view === 'lesson' && navOpen) renderNav();
    });

    // ── 启动 ──
    if (opts.mode === 'core') {
      openCore();
    } else if (opts.groupId && Data.groupById(opts.groupId)) {
      coreMode = false;
      enteredFromCore = false;
      renderCatalog();
      var lessons = Data.lessonsInGroup(opts.groupId);
      var gi = -1;
      for (var i = 0; i < lessons.length; i++) {
        if (lessons[i].id === opts.lessonId) { gi = i; break; }
      }
      openLesson(opts.groupId, gi >= 0 ? gi : 0);
    } else {
      renderCatalog();
    }

    var api = {
      el: root,
      dialogTitle: dialogTitle,
      // 对话框焦点陷阱初始化后调用：把焦点放回本视图的语义起点，
      // 而不是焦点陷阱默认命中的第一个控件（顶栏「目录」按钮）
      focusInitial: function () {
        var t = null;
        if (view === 'lesson') t = titleEl;
        else if (view === 'guide') t = body.querySelector('.tutorial-guide-title');
        else t = body.querySelector('.tutorial-group-card');
        if (t) { try { t.focus({ preventScroll: true }); } catch (e) {} }
      },
      showCatalog: function () {
        swapView('fade', function () { renderCatalog(); focusGroupCard(groupId); });
      },
      // 立即停止教学计时（关闭浮窗、切换账号等路径用）：
      // 停表、取消场景动画与滚动，之后的进度写入不再发生。
      halt: function () { stopPlayback(); },
      // QA 专用：慢速观察（不影响正常用户的播放速度）
      setRate: function (r) { moduleRate = (r > 0 && r <= 4) ? r : 1; },
      getRate: function () { return moduleRate; },
      // QA 专用：在 rAF 被完全节流的验收环境里手动推进虚拟时钟并执行时间线。
      // 暂停态下也可驱动（验收逐帧观察用）；只影响显式调用它的会话。
      debugAdvance: function (ms) {
        if (!currentLesson || !scene) return null;
        clock.elapsed += Math.max(0, ms);
        if (state === 'playing' || state === 'paused') runTimeline();
        return this.debugState();
      },
      debugState: function () {
        return {
          state: state,
          view: view,
          elapsed: Math.round(clock.elapsed),
          stepIndex: stepIndex,
          stepTarget: scene && stepIndex >= 0 ? (scene.targets[stepIndex] || null) : null,
          stepPhase: step ? (step.applied ? 'acted' : 'wait') : null,
          lessonId: currentLesson ? currentLesson.id : null
        };
      },
      destroy: function () {
        stopPlayback();
        if (window.BnuTutorialPlayer && window.BnuTutorialPlayer._active === api) {
          window.BnuTutorialPlayer._active = null;
        }
        document.removeEventListener('visibilitychange', onVisibility);
        if (typeof reduceMotion.removeEventListener === 'function') {
          reduceMotion.removeEventListener('change', onReduceChange);
        } else if (typeof reduceMotion.removeListener === 'function') {
          reduceMotion.removeListener(onReduceChange);
        }
        if (typeof mqMobile.removeEventListener === 'function') {
          mqMobile.removeEventListener('change', onMqChange);
        } else if (typeof mqMobile.removeListener === 'function') {
          mqMobile.removeListener(onMqChange);
        }
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
    window.BnuTutorialPlayer._active = api;
    return api;
  }

  window.BnuTutorialPlayer = {
    mount: mount,
    createProgress: createProgress,
    cueTimes: cueTimes,
    readLead: readLead,
    _active: null,     // 当前挂载的实例（QA 控制台用，如 _active.setRate(0.4)）
    _rate: function (r) { if (this._active) this._active.setRate(r); }
  };
})();
