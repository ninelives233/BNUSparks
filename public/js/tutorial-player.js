/* BNU Sparks · tutorial-player.js —— 动画使用教程：控制器、主时钟、暂停/销毁、
   进度合并、主题目录与可访问性。懒加载模块（feature-loader: tutorial，在
   data → scenes 之后加载）。只操作教程浮窗内部 DOM；导航、历史与认证归
   tutorial-entry.js 管。 */
(function () {
  'use strict';

  var Data = window.BnuTutorialData;
  var Scenes = window.BnuTutorialScenes;

  // 时间槽（§4.3）：每幕四镜头 A/B/C/D 的固定切换点（毫秒）。
  var CUE_TIMES = {
    8000: [0, 1500, 3500, 5500],
    10000: [0, 2000, 4500, 7000],
    12000: [0, 2000, 5000, 8000]
  };
  var EASE_ENTER = 'cubic-bezier(.23,1,.32,1)';
  var EASE_MOVE = 'cubic-bezier(.65,0,.35,1)';

  function cueFor(durationMs) {
    return CUE_TIMES[durationMs] || CUE_TIMES[10000];
  }

  function esc(s) {
    return typeof window.esc === 'function' ? window.esc(s)
      : String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c];
        });
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
  function btn(tag, cls, label) {
    var n = el(tag, cls, label);
    if (tag === 'button') n.type = 'button';
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
    var clock = { raf: 0, interval: 0, last: 0, elapsed: 0 };
    var cueIdx = 0;
    var currentLesson = null;
    var stageClip = null;
    var pointerEl = null;
    var pointerPos = null;         // {x, y} 持续跨帧
    var activeAnims = [];
    var pointerRun = null;         // { at, move, done }
    var currentScene = null;
    var sawReduce = reduceMotion.matches;

    // ── 壳 DOM ──
    var root = el('div', 'tutorial-root');
    var topbar = el('div', 'tutorial-topbar');
    var backBtn = btn('button', 'tutorial-back', '← 全部教程');
    backBtn.setAttribute('aria-label', '返回全部教程');
    var titleEl = el('div', 'tutorial-topbar-title');
    var counterEl = el('span', 'tutorial-counter');
    var tocBtn = btn('button', 'tutorial-toc-toggle', '目录 ⌄');
    tocBtn.setAttribute('aria-expanded', 'false');
    tocBtn.setAttribute('aria-controls', 'tutorialToc');
    var skipBtn = btn('button', 'tutorial-skip', '跳过介绍');
    var closeBtn = btn('button', 'tutorial-close', '✕');
    closeBtn.setAttribute('aria-label', '关闭教程');
    topbar.appendChild(titleEl);

    var announce = el('div', 'tutorial-sr');
    announce.setAttribute('aria-live', 'polite');
    announce.setAttribute('role', 'status');

    var body = el('div', 'tutorial-body');
    var toc = el('div', 'tutorial-toc');
    toc.id = 'tutorialToc';
    toc.hidden = true;
    var footer = el('div', 'tutorial-footer');
    footer.hidden = true;

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

    // ── 通用 ──
    function animate(node, keyframes, options) {
      if (!waapiOk || reduceMotion.matches) return null;
      var anim = node.animate(keyframes, options);
      activeAnims.push(anim);
      anim.addEventListener('finish', function () {
        var i = activeAnims.indexOf(anim);
        if (i !== -1) activeAnims.splice(i, 1);
      });
      return anim;
    }
    function pauseAllAnims() {
      activeAnims.forEach(function (a) { try { a.pause(); } catch (e) {} });
      if (stageClip) {
        try { stageClip.getAnimations({ subtree: true }).forEach(function (a) { a.pause(); }); } catch (e) {}
      }
    }
    function resumeAllAnims() {
      activeAnims.forEach(function (a) { try { a.play(); } catch (e) {} });
      if (stageClip) {
        try { stageClip.getAnimations({ subtree: true }).forEach(function (a) { a.play(); }); } catch (e) {}
      }
    }
    function cancelAllAnims() {
      activeAnims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
      activeAnims = [];
      if (stageClip) {
        try { stageClip.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); }); } catch (e) {}
      }
    }
    function say(text) { announce.textContent = ''; window.setTimeout(function () { announce.textContent = text; }, 30); }

    // ── 顶栏 ──
    function renderTopbar() {
      titleEl.textContent = '';
      counterEl.textContent = '';
      Array.prototype.forEach.call(topbar.querySelectorAll('.tutorial-back, .tutorial-counter, .tutorial-toc-toggle, .tutorial-skip, .tutorial-close'), function (n) { n.remove(); });
      if (view === 'catalog' || view === 'guide') {
        topbar.appendChild(titleEl);
        topbar.appendChild(closeBtn);
        titleEl.textContent = view === 'guide' ? '使用教程 · 文字说明' : '使用教程';
      } else if (coreMode) {
        backBtn.textContent = '快速认识木铎星火';
        backBtn.disabled = true;
        backBtn.classList.add('is-label');
        topbar.appendChild(backBtn);
        topbar.appendChild(counterEl);
        topbar.appendChild(skipBtn);
        topbar.appendChild(closeBtn);
        counterEl.textContent = (coreIdx + 1) + ' / 4';
        titleEl.textContent = '快速认识木铎星火';
      } else {
        backBtn.textContent = '← 全部教程';
        backBtn.disabled = false;
        backBtn.classList.remove('is-label');
        topbar.appendChild(backBtn);
        topbar.appendChild(counterEl);
        topbar.appendChild(tocBtn);
        topbar.appendChild(closeBtn);
        var group = Data.groupById(groupId);
        titleEl.textContent = group ? group.title : '';
        counterEl.textContent = '操作 ' + (lessonIdx + 1) + ' / ' + Data.lessonsInGroup(groupId).length;
      }
      dialogTitle.textContent = '木铎星火使用教程' + (view === 'lesson' && currentLesson ? '：' + currentLesson.title : '');
    }

    // ── 目录视图 ──
    function renderCatalog() {
      view = 'catalog';
      footer.hidden = true;
      toc.hidden = true;
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
      var replayCore = btn('button', 'tutorial-aux-btn', '重看快速介绍');
      replayCore.addEventListener('click', function () { openCore(); });
      var guideBtn = btn('button', 'tutorial-aux-btn', '文字使用说明');
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
        var card = btn('button', 'tutorial-group-card');
        card.setAttribute('aria-label', group.title + '，' + total + ' 个操作，约 ' + mins + ' 分钟，已看 ' + seen + ' / ' + total);
        var thumb = el('div', 'tutorial-group-thumb');
        thumb.setAttribute('aria-hidden', 'true');
        thumb.innerHTML = Scenes.thumb(group.id);
        card.appendChild(thumb);
        var info = el('div', 'tutorial-group-info');
        info.appendChild(el('div', 'tutorial-group-title', group.title));
        info.appendChild(el('p', 'tutorial-group-blurb', group.blurb));
        var meta = el('div', 'tutorial-group-meta');
        meta.appendChild(el('span', 'tutorial-group-count', total + ' 个操作 · 约 ' + mins + ' 分钟'));
        var prog = el('span', 'tutorial-group-progress' + (seen >= total ? ' is-done' : ''));
        prog.textContent = seen >= total ? '已看完' : (seen > 0 ? '已看 ' + seen + ' / ' + total : '未开始');
        meta.appendChild(prog);
        info.appendChild(meta);
        card.appendChild(info);
        card.appendChild(el('span', 'tutorial-group-arrow', '→'));
        card.addEventListener('click', function () { openGroup(group.id); });
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
      body.appendChild(wrap);
      body.scrollTop = catalogScroll;
      notifyNavigate();
    }

    // ── 文字说明视图 ──
    function openGuide() {
      catalogScroll = view === 'catalog' ? body.scrollTop : catalogScroll;
      view = 'guide';
      footer.hidden = true;
      toc.hidden = true;
      renderTopbar();
      body.textContent = '';
      var wrap = el('div', 'tutorial-guide');
      var back = btn('button', 'tutorial-guide-back', '← 返回目录');
      back.addEventListener('click', function () { renderCatalog(); });
      wrap.appendChild(back);
      var data = window.BnuTutorialTextGuide;
      if (data && data.sections) {
        wrap.appendChild(el('h2', 'tutorial-guide-title', data.title || '使用教程'));
        data.sections.forEach(function (s) {
          var sec = el('section', 'tutorial-guide-section');
          if (s.heading) sec.appendChild(el('h3', 'tutorial-guide-heading', s.heading));
          var p = el('p', 'tutorial-guide-text');
          p.textContent = s.text || '';
          sec.appendChild(p);
          wrap.appendChild(sec);
        });
      } else {
        wrap.appendChild(el('p', 'tutorial-guide-text', '文字说明暂时没有加载出来。'));
      }
      body.appendChild(wrap);
      body.scrollTop = 0;
      notifyNavigate();
    }

    // ── 目录（组内操作列表，浮窗内展开区） ──
    function renderToc() {
      if (coreMode || view !== 'lesson') return;
      var lessons = Data.lessonsInGroup(groupId);
      toc.textContent = '';
      var head = el('div', 'tutorial-toc-head');
      head.appendChild(el('span', 'tutorial-toc-title', Data.groupById(groupId).title + ' · 全部操作'));
      var restart = btn('button', 'tutorial-toc-restart', '从头观看');
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
        var b = btn('button', 'tutorial-toc-btn' + (i === lessonIdx ? ' is-active' : ''));
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
    function stopClock() {
      if (clock.raf) { window.cancelAnimationFrame(clock.raf); clock.raf = 0; }
      if (clock.interval) { window.clearInterval(clock.interval); clock.interval = 0; }
    }
    function destroyTimeline() {
      runToken++;
      stopClock();
      cancelAllAnims();
      pointerRun = null;
      pointerPos = null;
      if (pointerEl) { pointerEl.style.opacity = '0'; }
      clock.elapsed = 0;
      cueIdx = 0;
    }

    function openLesson(gId, idx) {
      var lessons = Data.lessonsInGroup(gId);
      if (!lessons.length) return;
      idx = Math.max(0, Math.min(lessons.length - 1, idx));
      if (coreMode) {
        coreIdx = idx;
        currentLesson = Data.coreLessons()[coreIdx];
      } else {
        groupId = gId;
        lessonIdx = idx;
        currentLesson = lessons[lessonIdx];
      }
      view = 'lesson';
      toc.hidden = true;
      tocBtn.setAttribute('aria-expanded', 'false');
      renderTopbar();
      renderFooter();
      renderToc();
      body.textContent = '';
      var wrap = el('div', 'tutorial-play');
      var stage = el('div', 'tutorial-stage' + (opts.mobileStage ? ' tutorial-stage--mobile' : ''));
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

      var variant = Data.lessonVariant(currentLesson);
      var text = el('div', 'tutorial-lesson-text');
      var h3 = el('h3', 'tutorial-lesson-title', variant.title);
      text.appendChild(h3);
      text.appendChild(el('p', 'tutorial-lesson-caption', variant.caption));
      if (variant.note) text.appendChild(el('p', 'tutorial-lesson-note', variant.note));
      var steps = el('ol', 'tutorial-lesson-steps');
      variant.steps.forEach(function (s, i) {
        var li = el('li', 'tutorial-lesson-step' + (i === 0 ? ' is-active' : ''));
        li.appendChild(el('span', 'tutorial-lesson-stepnum', String(i + 1)));
        li.appendChild(el('span', 'tutorial-lesson-steptext', s));
        steps.appendChild(li);
      });
      text.appendChild(steps);
      wrap.appendChild(text);
      body.appendChild(wrap);
      body.scrollTop = 0;
      notifyNavigate();
      startLesson();
    }

    function startLesson() {
      destroyTimeline();
      if (reduceMotion.matches || !waapiOk) { renderStatic(); return; }
      var scene = Scenes.build(currentLesson.scene, {
        mobile: !!opts.mobileStage,
        capability: Data.capability()
      });
      if (!scene) { renderError(); return; }
      currentScene = scene;
      state = 'playing';
      renderFooter();
      // 第一帧和样式准备完成后才开始计时：强制回流确保首帧样式就绪，
      // 用 setTimeout 而非 rAF 启动——rAF 在被节流的标签页里可能永不回调。
      showFrame(0, false);
      if (stageClip) void stageClip.offsetWidth;
      var startToken = runToken;
      window.setTimeout(function () {
        // 令牌校验：期间被切换/销毁的旧运行不得再启动时钟，
        // 否则会累积多份 interval，在节流环境下叠加加速播放
        if (startToken !== runToken || state !== 'playing') return;
        clock.last = performance.now();
        clock.raf = window.requestAnimationFrame(tickLoop);
        // rAF 被节流时的低频兜底源：同一主时钟、performance.now 差值计时，
        // 双源不会重复累计；配合 250ms 步长钳制，节流场景不会加速伪造完成。
        clock.interval = window.setInterval(function () {
          if (state === 'playing') tickLoop();
        }, 400);
      }, 60);
    }

    function tickLoop() {
      if (state !== 'playing') return;
      tick();
      if (state === 'playing') {
        if (clock.raf) window.cancelAnimationFrame(clock.raf);
        clock.raf = window.requestAnimationFrame(tickLoop);
      }
    }

    function tick() {
      if (state !== 'playing') return;
      var now = performance.now();
      var dt = now - clock.last;
      clock.last = now;
      // 钳制单次步长：长时间被节流后恢复不跳帧，后台不加速播放伪造完成
      if (dt > 250) dt = 250;
      if (dt < 0) dt = 0;
      clock.elapsed += dt;
      var dur = currentLesson.durationMs;
      var cues = cueFor(dur);
      while (cueIdx < cues.length && clock.elapsed >= cues[cueIdx]) {
        if (cueIdx > 0) showFrame(cueIdx, true);
        cueIdx++;
      }
      maybeRunPointer();
      if (clock.elapsed >= dur) {
        clock.elapsed = dur;
        finishLesson();
      }
    }

    function slotStart(cueIdxNow, cues) {
      return cues[cueIdxNow - 1] || 0;
    }
    function maybeRunPointer() {
      if (!pointerRun || pointerRun.done) return;
      if (clock.elapsed < pointerRun.at) return;
      pointerRun.done = true;
      runPointer(pointerRun.move);
    }
    function schedulePointer(frameIdx) {
      pointerRun = null;
      var move = currentScene && currentScene.moves && currentScene.moves[frameIdx];
      if (!move || !move.target) return;
      var cues = cueFor(currentLesson.durationMs);
      var start = frameIdx === 0 ? 0 : cues[frameIdx - 1];
      var slotDur = (frameIdx < 3 ? cues[frameIdx] : currentLesson.durationMs) - start;
      pointerRun = { at: start + Math.max(500, slotDur * 0.45), move: move, done: false };
    }

    function runPointer(move) {
      var target = stageClip && stageClip.querySelector('[data-mark="' + move.target + '"]');
      if (!target || !pointerEl) return;
      var clipRect = stageClip.getBoundingClientRect();
      var rect = target.getBoundingClientRect();
      var x = rect.left - clipRect.left + rect.width / 2 + 14;
      var y = rect.top - clipRect.top + rect.height / 2 + 12;
      pointerEl.style.opacity = '1';
      if (!pointerPos) { pointerEl.style.transform = 'translate(' + x + 'px,' + y + 'px)'; pointerPos = { x: x, y: y }; return; }
      var dx = x - pointerPos.x;
      var dy = y - pointerPos.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        var anim = animate(pointerEl,
          [{ transform: 'translate(' + pointerPos.x + 'px,' + pointerPos.y + 'px)' },
           { transform: 'translate(' + x + 'px,' + y + 'px)' }],
          { duration: 320, easing: EASE_MOVE, fill: 'forwards' });
        pointerPos = { x: x, y: y };
        if (anim) {
          anim.addEventListener('finish', function () { clickPulse(); });
        } else {
          clickPulse();
        }
      } else {
        clickPulse();
      }
      function clickPulse() {
        if (move.hover) return;
        var pulse = animate(pointerEl,
          [{ transform: 'translate(' + x + 'px,' + y + 'px) scale(1)' },
           { transform: 'translate(' + x + 'px,' + y + 'px) scale(.8)', offset: 0.55 },
           { transform: 'translate(' + x + 'px,' + y + 'px) scale(1)' }],
          { duration: 140, easing: 'ease-out' });
        if (pulse) {
          pulse.addEventListener('finish', function () {
            activeAnims = activeAnims.filter(function (a) { return a !== anim; });
          });
        }
      }
    }

    function showFrame(idx, animateSwap) {
      if (!stageClip || !currentScene) return;
      var ctx = { mobile: !!opts.mobileStage, capability: Data.capability() };
      var node;
      try { node = currentScene.frames[idx](ctx); } catch (e) { renderError(); return; }
      if (!node) { renderError(); return; }
      node.classList.add('tutorial-demo-frame', 'td-stagger');
      var old = stageClip.firstChild;
      stageClip.appendChild(node);
      if (animateSwap && !reduceMotion.matches && waapiOk) {
        node.style.opacity = '0';
        animate(node, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 180, easing: EASE_ENTER, fill: 'forwards' });
        if (old) {
          animate(old, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: EASE_ENTER, fill: 'forwards' })
            .addEventListener('finish', function () { if (old.parentNode) old.parentNode.removeChild(old); });
        }
      } else if (old) {
        stageClip.removeChild(old);
      }
      // 步骤列表同步高亮
      var stepItems = body.querySelectorAll('.tutorial-lesson-step');
      Array.prototype.forEach.call(stepItems, function (li, i) {
        li.classList.toggle('is-active', i <= idx);
      });
      schedulePointer(idx);
    }

    function finishLesson() {
      state = 'ended';
      renderFooter();
      if (document.visibilityState === 'visible') {
        progress.mark(currentLesson.id, currentLesson.revision);
        say('已看完《' + currentLesson.title + '》，可以选择继续或返回目录。');
      }
    }

    function renderFooter() {
      footer.textContent = '';
      footer.hidden = view !== 'lesson';
      if (view !== 'lesson' || !currentLesson) return;
      var row = el('div', 'tutorial-controls');
      var prev = btn('button', 'tutorial-ctl tutorial-ctl-prev', '上一项');
      var play = btn('button', 'tutorial-ctl tutorial-ctl-play', state === 'playing' ? '暂停演示' : '继续播放');
      var replay = btn('button', 'tutorial-ctl tutorial-ctl-replay', '重播');
      var next = btn('button', 'tutorial-ctl tutorial-ctl-next', nextLabel());
      prev.disabled = currentIndex() === 0;
      if (state === 'ended') play.disabled = true;
      play.setAttribute('aria-label', state === 'playing' ? '暂停演示' : '继续播放');
      prev.addEventListener('click', function () { step(-1); });
      play.addEventListener('click', function () { togglePlay(); });
      replay.addEventListener('click', function () { replayLesson(); });
      next.addEventListener('click', function () { step(1); });
      row.appendChild(prev);
      row.appendChild(play);
      row.appendChild(replay);
      row.appendChild(next);
      footer.appendChild(row);
      if (currentLesson.action) {
        var tryRow = el('div', 'tutorial-try-row');
        var tryBtn = btn('button', 'tutorial-try-btn', '去试试');
        tryBtn.setAttribute('aria-label', '去试试：' + tryActionLabel(currentLesson.action));
        tryBtn.addEventListener('click', function () { opts.onTryIt(currentLesson.action); });
        tryRow.appendChild(tryBtn);
        footer.appendChild(tryRow);
      }
    }
    function tryActionLabel(actionId) {
      var labels = {
        'browse-courses': '进入全部课程', 'my-courses': '进入我的课程', 'favorites': '打开我的收藏',
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
    function currentIndex() { return coreMode ? coreIdx : lessonIdx; }

    function step(delta) {
      var total = coreMode ? 4 : Data.lessonsInGroup(groupId).length;
      var idx = currentIndex();
      if (delta > 0 && idx >= total - 1) {
        // 核心末 → 目录（说明文案切换）；组末 → 目录并保留位置
        leaveCore('finished');
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
        pauseAllAnims();
        renderFooter();
        return;
      }
      if (state === 'paused') {
        state = 'playing';
        clock.last = performance.now();
        resumeAllAnims();
        renderFooter();
        clock.raf = window.requestAnimationFrame(tickLoop);
        clock.interval = window.setInterval(function () {
          if (state === 'playing') tickLoop();
        }, 400);
      }
    }

    function replayLesson() {
      if (!currentLesson) return;
      // 重播不重复增加已看记录：mark 幂等（服务端唯一约束 + 本地 Set）
      if (reduceMotion.matches || !waapiOk) { renderStatic(); return; }
      state = 'playing';
      renderFooter();
      startLesson();
    }

    // ── 静态步骤视图（reduced-motion / WAAPI 不可用） ──
    function renderStatic() {
      state = 'paused';
      destroyTimeline();
      if (!currentLesson) return;
      renderFooter();
      var variant = Data.lessonVariant(currentLesson);
      var playWrap = body.querySelector('.tutorial-play');
      if (playWrap) playWrap.remove();
      var existing = body.querySelector('.tutorial-static');
      if (existing) existing.remove();
      var wrap = el('div', 'tutorial-static');
      wrap.appendChild(el('p', 'tutorial-static-note', '已减少动态效果：下面按步骤静态展示这个操作的完整过程。'));
      var steps = el('ol', 'tutorial-static-steps');
      var scene = Scenes.build(currentLesson.scene, { mobile: !!opts.mobileStage, capability: Data.capability() });
      variant.steps.forEach(function (text, i) {
        var li = el('li', 'tutorial-static-step');
        var thumbBox = el('div', 'tutorial-static-thumb');
        thumbBox.setAttribute('aria-hidden', 'true');
        if (scene) {
          try {
            var frameNode = scene.frames[i]({ mobile: !!opts.mobileStage, capability: Data.capability() });
            frameNode.classList.add('tutorial-demo-frame');
            thumbBox.appendChild(frameNode);
          } catch (e) { /* 静态帧构建失败时保留文字步骤 */ }
        }
        li.appendChild(thumbBox);
        li.appendChild(el('div', 'tutorial-static-text', (i + 1) + '. ' + text));
        steps.appendChild(li);
      });
      wrap.appendChild(steps);
      var markBtn = btn('button', 'tutorial-static-mark', progress.has(currentLesson.id) ? '已看过' : '标记已看过');
      if (progress.has(currentLesson.id)) markBtn.disabled = true;
      markBtn.addEventListener('click', function () {
        progress.mark(currentLesson.id, currentLesson.revision);
        markBtn.disabled = true;
        markBtn.textContent = '已看过';
        say('已把《' + currentLesson.title + '》标记为已看过。');
      });
      wrap.appendChild(markBtn);
      var playBtn = btn('button', 'tutorial-static-play', '播放演示');
      playBtn.addEventListener('click', function () {
        if (reduceMotion.matches || !waapiOk) return;
        wrap.remove();
        startLesson();
      });
      if (!reduceMotion.matches && waapiOk) wrap.appendChild(playBtn);
      body.insertBefore(wrap, body.firstChild);
    }

    function renderError() {
      state = 'error';
      footer.hidden = true;
      body.textContent = '';
      var wrap = el('div', 'tutorial-error');
      wrap.appendChild(el('p', 'tutorial-error-text', '这个演示暂时没有加载出来。'));
      var retry = btn('button', 'tutorial-error-retry', '重试');
      retry.addEventListener('click', function () { startLesson(); });
      wrap.appendChild(retry);
      body.appendChild(wrap);
    }

    // ── 核心导览 ──
    function openCore() {
      coreMode = true;
      coreIdx = 0;
      enteredFromCore = true;
      openCoreLesson(0);
    }
    function openCoreLesson(idx) {
      destroyTimeline();
      var cores = Data.coreLessons();
      currentLesson = cores[idx];
      coreIdx = idx;
      view = 'lesson';
      renderTopbar();
      // 复用 openLesson 的视图构建，但保持核心序号
      var lessonView = currentLesson;
      groupId = lessonView.groupId;
      var groupLessons = Data.lessonsInGroup(groupId);
      lessonIdx = groupLessons.indexOf(lessonView);
      var savedCore = coreMode;
      coreMode = false;
      openLesson(groupId, lessonIdx);
      coreMode = savedCore;
      // 核心模式没有“操作目录”展开区
      toc.hidden = true;
      toc.textContent = '';
      tocBtn.setAttribute('aria-expanded', 'false');
      renderTopbar();
      renderFooter();
    }
    function leaveCore(reason) {
      var wasCore = coreMode;
      coreMode = false;
      destroyTimeline();
      if (wasCore && opts.onCoreLeave) opts.onCoreLeave(reason);
      renderCatalog();
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
      if (view === 'guide') { renderCatalog(); return; }
      if (view === 'lesson' && !coreMode) { renderCatalog(); return; }
    });
    closeBtn.addEventListener('click', function () {
      if (coreMode && opts.onCoreLeave) opts.onCoreLeave('close');
      opts.onClose('close');
    });
    skipBtn.addEventListener('click', function () { leaveCore('skip'); });
    tocBtn.addEventListener('click', function () {
      toc.hidden = !toc.hidden;
      tocBtn.setAttribute('aria-expanded', toc.hidden ? 'false' : 'true');
      if (!toc.hidden) renderToc();
    });

    function onVisibility() {
      if (document.hidden && state === 'playing') {
        // 切后台：保持暂停，回前台后等待用户点击继续
        state = 'paused';
        stopClock();
        pauseAllAnims();
        renderFooter();
      }
    }
    function onReduceChange() {
      if (reduceMotion.matches === sawReduce) return;
      sawReduce = reduceMotion.matches;
      if (view !== 'lesson') return;
      if (reduceMotion.matches) {
        // 销毁当前时间轴，展示静态步骤，不自动记已看
        renderStatic();
      } else {
        // 恢复偏好后等待用户“播放演示”
        state = 'paused';
        renderStatic();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    if (typeof reduceMotion.addEventListener === 'function') {
      reduceMotion.addEventListener('change', onReduceChange);
    } else if (typeof reduceMotion.addListener === 'function') {
      reduceMotion.addListener(onReduceChange);
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
      var gi = lessons.findIndex ? lessons.findIndex(function (l) { return l.id === opts.lessonId; }) : -1;
      openLesson(opts.groupId, gi >= 0 ? gi : 0);
    } else {
      renderCatalog();
    }

    return {
      el: root,
      dialogTitle: dialogTitle,
      showCatalog: function () { destroyTimeline(); renderCatalog(); },
      destroy: function () {
        destroyTimeline();
        document.removeEventListener('visibilitychange', onVisibility);
        if (typeof reduceMotion.removeEventListener === 'function') {
          reduceMotion.removeEventListener('change', onReduceChange);
        } else if (typeof reduceMotion.removeListener === 'function') {
          reduceMotion.removeListener(onReduceChange);
        }
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  window.BnuTutorialPlayer = {
    mount: mount,
    createProgress: createProgress
  };
})();
