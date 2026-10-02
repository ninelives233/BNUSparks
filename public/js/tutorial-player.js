/* BNU Sparks · tutorial-player.js —— 动画使用教程：控制器、唯一时钟、暂停/销毁、
   进度合并、主题目录与可访问性。懒加载模块（feature-loader: tutorial，在
   data → scenes 之后加载）。只操作教程浮窗内部 DOM；导航、历史与认证归
   tutorial-entry.js 管。

   播放模型（2026-10 重制）：
   - 唯一时间基准：一个 rAF 驱动的虚拟时钟推进步骤、指针与字幕；对象级微动画
     用 WAAPI/CSS，暂停时经 getAnimations(subtree) 一并冻结。页面隐藏即明确
     暂停，回前台等待用户继续；rAF 长时间停跳（明显卡顿）同样明确暂停，
     不丢弃时间、不变形播放速度。
   - 离开播放视图的所有路径（返回目录、文字说明、错误、关闭、销毁）统一走
     stopPlayback()：递增运行令牌、取消 rAF 与场景动画、隐藏指针。只有完整
     播放到最后一步且页面可见才记“已看过”。
   - 控制节点全程稳定：暂停/继续/重播/上一项/下一项只更新文字与状态，
     不重建 DOM，焦点不丢。
   - 指针时序固定为：看清入口（建立）→ 指针移入 → 点击反馈 → 界面变化 →
     结果停留。指针只定位当前场景根内的目标。 */
(function () {
  'use strict';

  var Data = window.BnuTutorialData;
  var Scenes = window.BnuTutorialScenes;

  // 步骤节奏（虚拟毫秒）：建立 1.5s、收尾 1.6s，中间各步均分剩余时间。
  var LEAD_MS = 1500;
  var TAIL_MS = 1600;
  var POINTER_MOVE_MS = 340;   // 指针移动
  var POINTER_PRESS_MS = 150;  // 点击反馈
  var NO_TARGET_DELAY = 260;   // 无指针步骤：短暂停留后变化
  var STALL_MS = 1000;         // 单帧间隔超过此值 = 明显卡顿，明确暂停

  var moduleRate = 1;          // 仅 QA 调试接口可改（慢速观察），正常恒为 1

  function cueTimes(durationMs, steps) {
    if (steps <= 1) return [0];
    var span = (durationMs - LEAD_MS - TAIL_MS) / (steps - 1);
    var cues = [0];
    for (var i = 1; i < steps; i++) cues.push(Math.round(LEAD_MS + (i - 1) * span));
    return cues;
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
    var pointer = null;            // { idx, phase, startedAt, from, to, applied }
    var pointerEl = null;
    var pointerPlaced = false;     // 本次运行内指针是否已有落点（首次直接出现在目标旁）
    var stageClip = null;
    var startTimer = 0;
    var announceTimer = 0;
    var sawReduce = reduceMotion.matches;

    // ── 壳 DOM ──
    var root = el('div', 'tutorial-root');
    var topbar = el('div', 'tutorial-topbar');
    var backBtn = btnb('tutorial-back', '← 全部教程');
    backBtn.setAttribute('aria-label', '返回全部教程');
    var titleEl = el('div', 'tutorial-topbar-title');
    var counterEl = el('span', 'tutorial-counter');
    var tocBtn = btnb('tutorial-toc-toggle', '目录 ⌄');
    tocBtn.setAttribute('aria-expanded', 'false');
    tocBtn.setAttribute('aria-controls', 'tutorialToc');
    var skipBtn = btnb('tutorial-skip', '跳过介绍');
    var closeBtn = btnb('tutorial-close', '✕');
    closeBtn.setAttribute('aria-label', '关闭教程');
    topbar.appendChild(backBtn);
    topbar.appendChild(titleEl);
    topbar.appendChild(counterEl);
    topbar.appendChild(tocBtn);
    topbar.appendChild(skipBtn);
    topbar.appendChild(closeBtn);

    var announce = el('div', 'tutorial-sr');
    announce.setAttribute('aria-live', 'polite');
    announce.setAttribute('role', 'status');

    var body = el('div', 'tutorial-body');
    var toc = el('div', 'tutorial-toc');
    toc.id = 'tutorialToc';
    toc.hidden = true;

    // 控制栏：节点只建一次，之后只更新文字/属性/状态（焦点不丢）
    var footer = el('div', 'tutorial-footer');
    footer.hidden = true;
    var navRow = el('div', 'tutorial-nav-row');
    var auxRow = el('div', 'tutorial-aux-row');
    var prevBtn = btnb('tutorial-ctl tutorial-ctl-prev', '上一项');
    var nextBtn = btnb('tutorial-ctl tutorial-ctl-next', '下一项');
    var playBtn = btnb('tutorial-ctl tutorial-ctl-play', '暂停');
    playBtn.setAttribute('aria-label', '暂停演示');
    var replayBtn = btnb('tutorial-ctl tutorial-ctl-replay', '重播');
    var tryBtn = btnb('tutorial-try-btn', '去试试');
    navRow.appendChild(prevBtn);
    navRow.appendChild(nextBtn);
    auxRow.appendChild(playBtn);
    auxRow.appendChild(replayBtn);
    auxRow.appendChild(tryBtn);
    footer.appendChild(navRow);
    footer.appendChild(auxRow);

    root.appendChild(topbar);
    root.appendChild(announce);
    root.appendChild(toc);
    root.appendChild(body);
    root.appendChild(footer);
    host.appendChild(root);

    // 对话框可访问名称（entry 负责把 aria-labelledby 指到这里）
    var dialogTitle = el('h2', 'tutorial-sr');
    dialogTitle.id = 'tutorialDialogTitle';
    host.appendChild(dialogTitle);

    // ── 场景动画的暂停/恢复/取消（子树级，覆盖 CSS+WAAPI） ──
    function stageAnims() {
      if (!stageClip) return [];
      try { return stageClip.getAnimations({ subtree: true }); } catch (e) { return []; }
    }
    function pauseStage() { stageAnims().forEach(function (a) { try { a.pause(); } catch (e) {} }); }
    function resumeStage() { stageAnims().forEach(function (a) { try { a.play(); } catch (e) {} }); }
    function cancelStage() { stageAnims().forEach(function (a) { try { a.cancel(); } catch (e) {} }); }

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
      pointer = null;
      pointerPlaced = false;
      stepIndex = -1;
      if (pointerEl) pointerEl.style.opacity = '0';
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
      // 目录页顶栏只留关闭（标题在正文里，避免重复的“使用教程”）；
      // 核心导览不显示返回（跳过介绍承担离开）；文字说明返回目录。
      backBtn.hidden = inCatalog || (coreMode && view === 'lesson');
      backBtn.textContent = view === 'guide' ? '← 返回目录' : '← 全部教程';
      tocBtn.hidden = inCatalog || coreMode || view !== 'lesson';
      skipBtn.hidden = !coreMode || view !== 'lesson';
      counterEl.hidden = inCatalog || view === 'guide';
      titleEl.classList.toggle('is-label', coreMode && view === 'lesson');
      if (inCatalog || view === 'guide') {
        titleEl.textContent = view === 'guide' ? '文字使用说明' : '';
      } else if (coreMode) {
        titleEl.textContent = '快速认识木铎星火';
        counterEl.textContent = (coreIdx + 1) + ' / 4';
      } else {
        var group = Data.groupById(groupId);
        titleEl.textContent = group ? group.title : '';
        counterEl.textContent = '操作 ' + (lessonIdx + 1) + ' / ' + Data.lessonsInGroup(groupId).length;
      }
      var viewName = view === 'catalog' ? '全部教程目录'
        : view === 'guide' ? '文字使用说明'
        : coreMode ? '快速认识木铎星火'
        : (Data.groupById(groupId) || {}).title || '';
      dialogTitle.textContent = '木铎星火使用教程' + (view === 'lesson' && currentLesson ? '：' + currentLesson.title : '') + (viewName && view !== 'lesson' ? '：' + viewName : '');
    }

    // ── 目录视图 ──
    function renderCatalog() {
      stopPlayback();
      if (view === 'catalog') catalogScroll = body.scrollTop;
      view = 'catalog';
      footer.hidden = true;
      toc.hidden = true;
      tocBtn.setAttribute('aria-expanded', 'false');
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
      guideBtn.addEventListener('click', function () { openGuide(); });
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
      toc.hidden = true;
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

    // ── 组内操作目录（浮窗内展开区） ──
    function renderToc() {
      if (coreMode || view !== 'lesson') return;
      var lessons = Data.lessonsInGroup(groupId);
      toc.textContent = '';
      var head = el('div', 'tutorial-toc-head');
      head.appendChild(el('span', 'tutorial-toc-title', Data.groupById(groupId).title + ' · 全部操作'));
      var restart = btnb('tutorial-toc-restart', '从头观看');
      restart.addEventListener('click', function () {
        toc.hidden = true;
        tocBtn.setAttribute('aria-expanded', 'false');
        openLesson(groupId, 0);
      });
      head.appendChild(restart);
      toc.appendChild(head);
      var list = el('ol', 'tutorial-toc-list');
      lessons.forEach(function (l, i) {
        var item = el('li', 'tutorial-toc-item');
        var b = btnb('tutorial-toc-btn' + (i === lessonIdx ? ' is-active' : ''));
        b.appendChild(el('span', 'tutorial-toc-num', String(i + 1)));
        b.appendChild(el('span', 'tutorial-toc-name', l.title));
        if (progress.has(l.id)) b.appendChild(el('span', 'tutorial-toc-seen', '已看过'));
        b.addEventListener('click', function () {
          toc.hidden = true;
          tocBtn.setAttribute('aria-expanded', 'false');
          openLesson(groupId, i);
        });
        item.appendChild(b);
        list.appendChild(item);
      });
      toc.appendChild(list);
    }

    // ── 播放视图 ──
    function openLesson(gId, idx) {
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
      toc.hidden = true;
      tocBtn.setAttribute('aria-expanded', 'false');
      renderTopbar();
      renderToc();
      buildLessonView();
      notifyNavigate();
      startLesson();
    }

    // 播放页静态结构：舞台（主视觉）→ 操作标题 + 当前说明 → 可展开的完整步骤
    function buildLessonView() {
      footer.hidden = false;
      body.textContent = '';
      var wrap = el('div', 'tutorial-play');
      var stage = el('div', 'tutorial-stage' + (mqMobile.matches ? ' tutorial-stage--mobile' : ''));
      stage.setAttribute('aria-hidden', 'true');
      var label = el('span', 'tutorial-demo-label', '示例演示');
      stageClip = el('div', 'tutorial-stage-clip');
      pointerEl = el('div', 'tutorial-pointer');
      pointerEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 7.5-6.2 1.7L9.5 19z" fill="currentColor" stroke="var(--surface)" stroke-width="1.2" stroke-linejoin="round"/></svg>';
      pointerEl.style.opacity = '0';
      stage.appendChild(label);
      stage.appendChild(stageClip);
      stage.appendChild(pointerEl);
      wrap.appendChild(stage);

      variant = Data.lessonVariant(currentLesson, mqMobile.matches);
      var now = el('div', 'tutorial-now');
      var h3 = el('h3', 'tutorial-now-title', variant.title);
      h3.tabIndex = -1;
      now.appendChild(h3);
      now.appendChild(el('p', 'tutorial-now-line', ''));
      wrap.appendChild(now);

      var more = el('details', 'tutorial-more');
      var summary = el('summary', 'tutorial-more-summary', '完整步骤与说明');
      more.appendChild(summary);
      var steps = el('ol', 'tutorial-more-steps');
      variant.steps.forEach(function (s, i) {
        var li = el('li', 'tutorial-more-step');
        li.appendChild(el('span', 'tutorial-more-stepnum', String(i + 1)));
        li.appendChild(el('span', 'tutorial-more-steptext', s));
        steps.appendChild(li);
      });
      more.appendChild(steps);
      if (variant.note) more.appendChild(el('p', 'tutorial-lesson-note', variant.note));
      wrap.appendChild(more);

      body.appendChild(wrap);
      body.scrollTop = 0;
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
      cues = cueTimes(currentLesson.durationMs, scene.steps);
      stageClip.textContent = '';
      stageClip.appendChild(scene.root);
      // 首帧样式就绪后再起表：强制回流 + 可取消的短延时（rAF 在节流环境可能不回调）
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
      while (cueIdx < cues.length && clock.elapsed >= cues[cueIdx]) {
        beginStep(cueIdx);
        cueIdx++;
      }
      advancePointer();
      if (state === 'playing' && clock.elapsed >= currentLesson.durationMs) {
        finishLesson();
      }
    }

    function beginStep(i) {
      // 保险：上一步的变化尚未落地就跨到下一步时，先落地（正常节奏不会发生）
      if (pointer && !pointer.applied) applyStep();
      stepIndex = i;
      var targetName = scene.targets[i];
      pointer = { idx: i, phase: 'none', startedAt: clock.elapsed, target: targetName, click: scene.clicks[i], applied: false, from: null, to: null, pressAt: 0 };
      if (targetName) {
        var target = targetEl(targetName);
        if (target) {
          pointer.phase = 'move';
          // 首次出现直接定位到目标旁，不从角落横穿整个舞台
          pointer.from = pointerPlaced ? currentPointerPoint() : { x: 0, y: 0, fresh: true };
          pointer.to = pointFor(target);
          pointerEl.style.opacity = '1';
        }
      }
    }

    function targetEl(name) {
      if (!name || !stageClip) return null;
      try { return stageClip.querySelector('[data-mark="' + name + '"]'); } catch (e) { return null; }
    }
    function currentPointerPoint() {
      var r = pointerEl.getBoundingClientRect();
      var c = stageClip.getBoundingClientRect();
      return { x: r.left - c.left + r.width / 2, y: r.top - c.top + r.height / 2 };
    }
    function pointFor(target) {
      var r = target.getBoundingClientRect();
      var c = stageClip.getBoundingClientRect();
      var off = mqMobile.matches ? 10 : 14;
      return { x: r.left - c.left + r.width / 2 + off, y: r.top - c.top + r.height / 2 + off };
    }
    function setPointerAt(x, y, scale) {
      pointerPlaced = true;
      pointerEl.style.transform = 'translate(' + (x - 11) + 'px,' + (y - 11) + 'px)' + (scale && scale !== 1 ? ' scale(' + scale + ')' : '');
    }
    function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

    function advancePointer() {
      if (!pointer || pointer.applied) return;
      if (pointer.phase === 'none') {
        if (clock.elapsed - pointer.startedAt >= NO_TARGET_DELAY) applyStep();
        return;
      }
      if (pointer.phase === 'move') {
        var t = (clock.elapsed - pointer.startedAt) / POINTER_MOVE_MS;
        if (pointer.from.fresh) {
          // 指针此前隐藏：直接出现在目标旁，不播放横穿
          setPointerAt(pointer.to.x, pointer.to.y);
          pointer.from = { x: pointer.to.x, y: pointer.to.y };
        } else {
          var p = Math.min(1, t);
          var e = easeInOut(p);
          setPointerAt(pointer.from.x + (pointer.to.x - pointer.from.x) * e,
                       pointer.from.y + (pointer.to.y - pointer.from.y) * e);
        }
        if (t >= 1) {
          if (pointer.click) {
            pointer.phase = 'press';
            pointer.pressAt = clock.elapsed;
          } else {
            applyStep();
          }
        }
        return;
      }
      if (pointer.phase === 'press') {
        var q = Math.min(1, (clock.elapsed - pointer.pressAt) / POINTER_PRESS_MS);
        setPointerAt(pointer.to.x, pointer.to.y, 1 - 0.22 * Math.sin(Math.PI * q));
        if (q >= 1) {
          setPointerAt(pointer.to.x, pointer.to.y, 1);
          applyStep();
        }
      }
    }

    function applyStep() {
      if (!scene || !currentLesson) return;
      if (pointer) pointer.applied = true;
      try { scene.go(stepIndex); } catch (e) { renderError(); return; }
      updateNowLine();
      if (pointer && !scene.targets[stepIndex]) pointerEl.style.opacity = '0';
      if (variant.steps[stepIndex] != null) {
        say('第 ' + (stepIndex + 1) + ' 步：' + variant.steps[stepIndex]);
      }
    }

    function updateNowLine() {
      var line = body.querySelector('.tutorial-now-line');
      if (!line) return;
      var total = variant.steps.length;
      var text = stepIndex >= 0 && variant.steps[stepIndex] != null ? variant.steps[stepIndex] : variant.steps[0];
      line.textContent = (total > 1 ? '第 ' + (Math.max(0, stepIndex) + 1) + ' / ' + total + ' 步 · ' : '') + text;
      var items = body.querySelectorAll('.tutorial-more-step');
      Array.prototype.forEach.call(items, function (li, i) {
        li.classList.toggle('is-active', i <= Math.max(0, stepIndex));
      });
    }

    function finishLesson() {
      state = 'ended';
      pointerEl.style.opacity = '0';
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
      if (idx >= total - 1) {
        if (coreMode) return '看看其他用法';
        return '完成，返回全部教程';
      }
      return '下一项';
    }
    function updateControls() {
      var isLesson = view === 'lesson' && !!currentLesson;
      footer.hidden = !isLesson;
      if (!isLesson) return;
      // 静态降级（减少动态效果 / WAAPI 不可用）没有可播放的时间轴：
      // 不显示「继续播放」「重播」，避免语义不清的控制
      var staticMode = reduceMotion.matches || !waapiOk;
      playBtn.hidden = staticMode;
      replayBtn.hidden = staticMode;
      prevBtn.disabled = (coreMode ? coreIdx : lessonIdx) === 0;
      nextBtn.textContent = nextLabel();
      if (staticMode) return;
      if (state === 'playing') {
        playBtn.textContent = '暂停';
        playBtn.setAttribute('aria-label', '暂停演示');
        playBtn.disabled = false;
        replayBtn.hidden = false;
      } else if (state === 'paused') {
        playBtn.textContent = '继续播放';
        playBtn.setAttribute('aria-label', '继续播放');
        playBtn.disabled = false;
        replayBtn.hidden = false;
      } else if (state === 'ended') {
        // 结束后不放语义不清的禁用按钮：主控位变成重播
        playBtn.textContent = '重播';
        playBtn.setAttribute('aria-label', '重播本项');
        playBtn.disabled = false;
        replayBtn.hidden = true;
      } else {
        playBtn.textContent = '播放';
        playBtn.setAttribute('aria-label', '播放演示');
        playBtn.disabled = false;
        replayBtn.hidden = false;
      }
      var actionId = currentLesson.action;
      tryBtn.hidden = !actionId;
      if (actionId) {
        tryBtn.textContent = '去试试 · ' + tryActionLabel(actionId);
        tryBtn.setAttribute('aria-label', '去试试：' + tryActionLabel(actionId));
      }
    }

    function step(delta) {
      var total = coreMode ? 4 : Data.lessonsInGroup(groupId).length;
      var idx = coreMode ? coreIdx : lessonIdx;
      if (delta > 0 && idx >= total - 1) {
        if (coreMode) { leaveCore('finished'); return; }
        stopPlayback();
        var g = groupId;
        renderCatalog();
        focusGroupCard(g);
        say('已看完这一组，返回全部教程。');
        return;
      }
      var nextIdx = Math.max(0, Math.min(total - 1, idx + delta));
      if (coreMode) openCoreLesson(nextIdx);
      else openLesson(groupId, nextIdx);
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
      body.insertBefore(wrap, body.firstChild);
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
    function openCoreLesson(idx) {
      var cores = Data.coreLessons();
      if (!cores.length) return;
      idx = Math.max(0, Math.min(cores.length - 1, idx));
      coreIdx = idx;
      currentLesson = cores[idx];
      groupId = currentLesson.groupId;
      lessonIdx = Data.lessonsInGroup(groupId).indexOf(currentLesson);
      view = 'lesson';
      stopPlayback();
      toc.hidden = true;
      toc.textContent = '';
      tocBtn.setAttribute('aria-expanded', 'false');
      renderTopbar();
      buildLessonView();
      renderToc();
      notifyNavigate();
      startLesson();
    }
    function leaveCore(reason) {
      var wasCore = coreMode;
      coreMode = false;
      stopPlayback();
      if (wasCore && opts.onCoreLeave) opts.onCoreLeave(reason);
      renderCatalog();
      focusGroupCard(Data.coreLessons()[0] ? Data.coreLessons()[0].groupId : null);
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
    backBtn.addEventListener('click', function () {
      if (view === 'guide' || (view === 'lesson' && !coreMode)) {
        var g = groupId;
        renderCatalog();
        focusGroupCard(g);
      }
    });
    closeBtn.addEventListener('click', function () {
      if (coreMode && opts.onCoreLeave) opts.onCoreLeave('close');
      opts.onClose('close');
    });
    skipBtn.addEventListener('click', function () { leaveCore('skip'); });
    tocBtn.addEventListener('click', function () {
      toc.hidden = !toc.hidden;
      tocBtn.setAttribute('aria-expanded', toc.hidden ? 'false' : 'true');
      if (!toc.hidden) {
        renderToc();
        // 打开操作目录时暂停当前演示；关闭后由用户点「继续播放」
        autoPause();
      }
    });
    prevBtn.addEventListener('click', function () { step(-1); });
    nextBtn.addEventListener('click', function () { step(1); });
    playBtn.addEventListener('click', function () { togglePlay(); });
    replayBtn.addEventListener('click', function () { replayLesson(); });
    tryBtn.addEventListener('click', function () { if (currentLesson && currentLesson.action) opts.onTryIt(currentLesson.action); });

    function onVisibility() {
      if (document.hidden) autoPause('页面切到后台，演示已暂停。');
    }
    function onReduceChange() {
      if (reduceMotion.matches === sawReduce) return;
      sawReduce = reduceMotion.matches;
      if (view !== 'lesson') return;
      if (reduceMotion.matches) {
        // 销毁当前时间轴，展示静态步骤，不自动记已看
        renderStatic();
      } else {
        // 恢复偏好后等待用户“播放演示”（静态视图带播放按钮）
        renderStatic();
      }
    }
    function onMqChange() {
      // 视口跨断点：重建当前分镜视图（确定性重播），不只 mount 时判断一次
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
      else if (view === 'lesson') renderToc();
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
      showCatalog: function () {
        renderCatalog();
        focusGroupCard(groupId);
      },
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
    _active: null,     // 当前挂载的实例（QA 控制台用，如 _active.setRate(0.4)）
    _rate: function (r) { if (this._active) this._active.setRate(r); }
  };
})();
