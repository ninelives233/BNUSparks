/* BNU Sparks 教程播放器。每个队列项目讲完整操作，唯一虚拟时钟驱动
   解说、对象动画、镜头、结果观察与换项。教程不调用业务动作，只有白名单
   “去试试”交给 entry。拖动冻结教学时钟；控制节点在自动换项时保持稳定。 */
(function () {
  'use strict';

  var Data = window.BnuTutorialData;
  var Scenes = window.BnuTutorialScenes;

  var STALL_MS = 4000;
  var moduleRate = 1;

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
    // 新流程 revision 不再补交旧版本，避免旧 pending 阻塞当前已看同步。
    local.pending = local.pending.filter(function (p) {
      return p && Data.lessons[p.lesson_id] && p.revision === Data.lessons[p.lesson_id].revision;
    });
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
    var host = opts.host, progress = opts.progress;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var mqMobile = window.matchMedia('(max-width: 600px)');
    var waapiOk = typeof Element.prototype.animate === 'function';
    var view = 'catalog', coreMode = opts.mode === 'core', enteredFromCore = coreMode;
    var groupId = null, currentLesson = null, variant = null;
    var queue = [], activeIndex = 0, catalogScroll = 0;
    var state = 'idle', runToken = 0, intent = true, reasons = new Set();
    var clock = { raf: 0, last: 0, elapsed: 0 };
    var scene = null, timeline = null, beatIndex = 0, stepIndex = -1;
    var stageClip = null, track = null, cameraLayer = null, captionText = null;
    var camera = { x: 0, y: 0, scale: 1 }, cameraTween = null, scrollTween = null;
    var animations = new Map(), transition = null, drag = null, pointers = new Set(), suppressClick = false;
    var navOpen = false, sawReduce = reduceMotion.matches, halted = false;
    var root = el('div', 'tutorial-root');
    var topbar = el('div', 'tutorial-topbar');
    function icon(button, name, label) {
      var paths = {
        back: '<path d="m14 5-7 7 7 7M7 12h13"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
        more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
        prev: '<path d="m14 6-6 6 6 6"/>', next: '<path d="m10 6 6 6-6 6"/>',
        play: '<path d="m8 5 11 7-11 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
        replay: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>'
      };
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
      button.setAttribute('aria-label', label); button.title = label;
    }
    var backBtn = btnb('tutorial-back'); icon(backBtn, 'back', '返回全部教程');
    var titleEl = el('div', 'tutorial-topbar-title'); titleEl.tabIndex = -1;
    var counterEl = el('span', 'tutorial-counter');
    var skipBtn = btnb('tutorial-skip', '跳过介绍');
    var navBtn = btnb('tutorial-nav-toggle'); icon(navBtn, 'more', '更多：说明、目录与去试试');
    navBtn.setAttribute('aria-controls', 'tutorialToc'); navBtn.setAttribute('aria-expanded', 'false');
    var closeBtn = btnb('tutorial-close'); icon(closeBtn, 'close', '关闭教程');
    [backBtn,titleEl,counterEl,skipBtn,navBtn,closeBtn].forEach(function (n) { topbar.appendChild(n); });
    var announce = el('div', 'tutorial-sr'); announce.setAttribute('role', 'status'); announce.setAttribute('aria-live','polite');
    var reading = el('div', 'tutorial-sr'); reading.id = 'tutorialReading';
    var body = el('div', 'tutorial-body');
    var navPanel = el('div', 'tutorial-nav-panel'); navPanel.id = 'tutorialToc'; navPanel.hidden = true;
    var footer = el('div', 'tutorial-footer'); footer.hidden = true;
    footer.setAttribute('role','group'); footer.setAttribute('aria-label','操作队列导航');
    var dots = el('div', 'tutorial-dots');
    var playBtn = btnb('tutorial-ctl tutorial-ctl-play');
    var replayBtn = btnb('tutorial-replay'); icon(replayBtn,'replay','重播本项');
    var prevBtn = btnb('tutorial-arrow tutorial-arrow-prev'); icon(prevBtn,'prev','上一操作');
    var nextBtn = btnb('tutorial-arrow tutorial-arrow-next'); icon(nextBtn,'next','下一操作');
    var tryBtn = btnb('tutorial-nav-link');
    footer.appendChild(dots); footer.appendChild(playBtn); footer.appendChild(replayBtn);
    [topbar,announce,reading,navPanel,body,footer].forEach(function (n) { root.appendChild(n); });
    host.appendChild(root);
    var dialogTitle = el('h2','tutorial-sr'); dialogTitle.id = 'tutorialDialogTitle'; host.appendChild(dialogTitle);
    function say(text) { announce.textContent = text || ''; }
    function lessonTitle(lesson) { return Data.lessonVariant(lesson,mqMobile.matches).title; }
    function currentSceneCtx() { return {mobile:mqMobile.matches,capability:Data.capability()}; }
    function stopClock() { if (clock.raf) window.cancelAnimationFrame(clock.raf); clock.raf = 0; }
    function stopPlayback() {
      runToken++; stopClock();
      animations.forEach(function (_,a) { try { a.cancel(); } catch (e) {} }); animations.clear();
      if (stageClip) stageClip.getAnimations({subtree:true}).forEach(function (a) { a.cancel(); });
      cameraTween = scrollTween = transition = drag = null; pointers.clear();
      clock.elapsed = 0; beatIndex = 0; stepIndex = -1; state = 'idle';
    }
    function playingAllowed() { return !halted && intent && !reasons.size && !document.hidden && !reduceMotion.matches; }
    function startClock() {
      stopClock(); if (!playingAllowed()) return;
      clock.last = performance.now(); var token = runToken;
      clock.raf = window.requestAnimationFrame(function frame(now) {
        clock.raf = 0;
        if (token !== runToken || !playingAllowed()) return;
        var dt = Math.max(0, now-clock.last); clock.last = now;
        if (dt > STALL_MS) { autoPause('播放已暂停，点播放继续。','stall'); return; }
        advance(dt * moduleRate);
        if (token === runToken && playingAllowed() && (state === 'playing' || state === 'switching')) clock.raf = window.requestAnimationFrame(frame);
      });
    }
    function syncAnimations(startAt) {
      if (!stageClip) return;
      stageClip.getAnimations({subtree:true}).forEach(function (a) {
        if (!animations.has(a)) { a.pause(); animations.set(a, startAt == null ? clock.elapsed : startAt); }
      });
      animations.forEach(function (at,a) {
        try { a.currentTime = Math.max(0,clock.elapsed-at); } catch (e) { animations.delete(a); }
      });
    }
    function renderTopbar() {
      var lessonView = view === 'lesson';
      root.classList.toggle('is-playing-view',lessonView);
      backBtn.hidden = view === 'catalog'; navBtn.hidden = !lessonView;
      skipBtn.hidden = !(lessonView && coreMode); counterEl.hidden = !lessonView;
      counterEl.textContent = (activeIndex+1)+' / '+queue.length;
      titleEl.textContent = view === 'catalog' ? '' : view === 'guide' ? '文字使用说明' : coreMode ? '快速介绍' : (Data.groupById(groupId)||{}).title;
      dialogTitle.textContent = '木铎星火使用教程：'+(lessonView && currentLesson ? lessonTitle(currentLesson) : view === 'guide' ? '文字使用说明' : '全部教程目录');
    }
    function closeNav(focus) {
      navOpen = false; navPanel.hidden = true; navBtn.setAttribute('aria-expanded','false');
      // 阅读面板主动暂停，关闭后等用户选择继续；不要偷偷启动队列。
      if (focus) navBtn.focus({preventScroll:true});
    }
    function openNav() {
      autoPause('', 'navigation'); renderNav(); navOpen = true; navPanel.hidden = false; navBtn.setAttribute('aria-expanded','true');
    }
    function renderNav() {
      navPanel.textContent = '';
      var head = el('div','tutorial-nav-head');
      head.appendChild(el('span','tutorial-nav-group',coreMode ? '快速介绍' : (Data.groupById(groupId)||{}).title));
      head.appendChild(el('span','tutorial-nav-count','操作 '+(activeIndex+1)+' / '+queue.length+' · 已看 '+progress.seenCount(queue.map(function(l){return l.id;}))));
      navPanel.appendChild(head);
      var list = el('ol','tutorial-nav-list');
      queue.forEach(function(l,i) {
        var li = el('li','tutorial-nav-item'), b = btnb('tutorial-nav-btn'+(i===activeIndex?' is-active':''));
        b.appendChild(el('span','tutorial-nav-num',String(i+1))); b.appendChild(el('span','tutorial-nav-name',lessonTitle(l)));
        if(progress.has(l.id)) b.appendChild(el('span','tutorial-nav-seen','已看过'));
        b.addEventListener('click',function(){ closeNav(true); selectIndex(i,false); }); li.appendChild(b); list.appendChild(li);
      }); navPanel.appendChild(list);
      var sec = el('div','tutorial-nav-sec'); sec.appendChild(el('div','tutorial-nav-sec-title','本操作完整说明'));
      var steps = el('ol','tutorial-nav-steps'); variant.steps.forEach(function(text){ steps.appendChild(el('li','tutorial-nav-step',text)); }); sec.appendChild(steps);
      if(variant.note) sec.appendChild(el('p','tutorial-nav-note',variant.note)); navPanel.appendChild(sec);
      var links=el('div','tutorial-nav-links');
      var replay=btnb('tutorial-nav-link','重播本项'); replay.addEventListener('click',function(){closeNav(true);replayLesson();}); links.appendChild(replay);
      var restart=btnb('tutorial-nav-link','重看本组'); restart.addEventListener('click',function(){closeNav(true);intent=true;reasons.clear();selectIndex(0,false,true);});links.appendChild(restart);
      var guide=btnb('tutorial-nav-link','文字使用说明');guide.addEventListener('click',function(){closeNav();openGuide();});links.appendChild(guide);
      if(currentLesson.action) { tryBtn.textContent='去试试 · '+tryActionLabel(currentLesson.action);links.appendChild(tryBtn); }
      navPanel.appendChild(links);
    }
    function notifyNavigate() {
      if(opts.onNavigate) opts.onNavigate({view:view,groupId:groupId,lessonId:currentLesson?currentLesson.id:null,core:coreMode});
    }
    function swapView(kind,fn) { fn(); }
    function renderCatalog() {
      coreMode = false;
      reading.textContent = '';
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


    function openGroup(gId) {
      coreMode=false; queue=Data.lessonsInGroup(gId); groupId=gId;
      var first=queue.findIndex(function(l){return !progress.has(l.id);});
      enterQueue(first<0?0:first);
    }
    function openLesson(gId,idx) { coreMode=false; groupId=gId; queue=Data.lessonsInGroup(gId); enterQueue(idx); }
    function openCore() { coreMode=true; enteredFromCore=true; queue=Data.coreLessons(); enterQueue(0); }
    function enterQueue(idx) {
      if(view==='catalog') catalogScroll=body.scrollTop;
      closeNav(); stopPlayback(); reasons.clear(); intent=true; halted=false;
      view='lesson'; activeIndex=Math.max(0,Math.min(queue.length-1,idx)); buildLessonView(); loadActive(); notifyNavigate();
    }
    function leaveCore(reason) {
      var wasCore=coreMode; coreMode=false;
      if(wasCore && opts.onCoreLeave) opts.onCoreLeave(reason);
      renderCatalog(); if(reason!=='finished') focusGroupCard(groupId);
    }
    function buildLessonView() {
      body.textContent=''; var wrap=el('div','tutorial-play');
      var stage=el('div','tutorial-stage');
      stageClip=el('div','tutorial-stage-clip'); stageClip.setAttribute('aria-hidden','true');
      track=el('div','tutorial-track'); stageClip.appendChild(track); stage.appendChild(stageClip);
      stage.appendChild(prevBtn); stage.appendChild(nextBtn);
      wrap.appendChild(stage); body.appendChild(wrap); footer.hidden=false;
      installGestures(stageClip);
    }
    function makePanel(l,index) {
      var ctx=currentSceneCtx(), inst=Scenes.build(l.scene,ctx);
      var panel=el('div','tutorial-queue-item'); panel.dataset.index=String(index); panel.setAttribute('aria-hidden','true'); panel.inert=true;
      var windowEl=el('div','tutorial-camera-window'); panel.appendChild(windowEl);
      var cam=el('div','tutorial-camera'); windowEl.appendChild(cam);
      var note=el('p','tutorial-narration'); note.textContent=Data.timelineOf(l,ctx.mobile,ctx.capability).beats[0].text; panel.appendChild(note);
      var lab=el('span','tutorial-demo-label','示例演示');panel.appendChild(lab);
      if(inst) {cam.appendChild(inst.root); inst.go(0);}
      return {panel:panel,cam:cam,note:note,scene:inst};
    }
    function buildTrack() {
      track.textContent=''; var active=null;
      [activeIndex-1,activeIndex,activeIndex+1].forEach(function(i){
        if(i<0 || i>=queue.length)return;
        var p=makePanel(queue[i],i);p.panel.style.left=((i-activeIndex)*100)+'%';track.appendChild(p.panel);
        if(i===activeIndex)active=p; else p.panel.classList.add('td-noanim');
      });
      if(!active || !active.scene) {renderError();return false;}
      cameraLayer=active.cam;captionText=active.note;scene=active.scene;scene.root.dataset.mobile=String(mqMobile.matches);
      track.style.transform='translateX(0px)'; camera={x:0,y:0,scale:1};
      return true;
    }
    function loadActive() {
      currentLesson=queue[activeIndex];
      groupId=currentLesson.groupId;
      variant=Data.lessonVariant(currentLesson,mqMobile.matches);
      timeline=Data.timelineOf(currentLesson,mqMobile.matches,Data.capability());
      renderTopbar(); renderDots();
      reading.textContent=variant.title+'。'+variant.steps.join('。')+'。'+variant.note;
      if(reduceMotion.matches || !waapiOk) {renderStatic();return;}
      if(!buildTrack())return;
      state=playingAllowed()?'playing':'paused'; runTimeline();updateControls();startClock();
    }
    function renderDots() {
      // Keep queue controls mounted: switching only changes attributes, progress and labels.
      if(dots.children.length!==queue.length || dots.dataset.queue!==queue.map(function(l){return l.id;}).join(',')) {
        dots.textContent=''; dots.dataset.queue=queue.map(function(l){return l.id;}).join(',');
        queue.forEach(function(l,i){
          var b=btnb('tutorial-dot'); b.appendChild(el('span','tutorial-dot-mark'));
          b.addEventListener('click',function(){selectIndex(i,false);});dots.appendChild(b);
        });
      }
      queue.forEach(function(l,i){
        var b=dots.children[i];b.setAttribute('aria-label','第 '+(i+1)+' 项，共 '+queue.length+' 项：'+lessonTitle(l)+(progress.has(l.id)?'，已看过':''));
        b.setAttribute('aria-current',i===activeIndex?'step':'false');b.classList.toggle('is-seen',progress.has(l.id));
        b.classList.toggle('is-active',i===activeIndex);b.style.setProperty('--progress',i===activeIndex?Math.min(1,clock.elapsed/(timeline?timeline.end:1)):0);
      });
    }
    function updateControls() {
      footer.hidden=view!=='lesson'; if(view!=='lesson')return;
      var staticMode=reduceMotion.matches||!waapiOk;
      prevBtn.disabled=activeIndex===0;nextBtn.disabled=activeIndex===queue.length-1;
      playBtn.hidden=staticMode;replayBtn.hidden=staticMode;
      var playing=state==='playing'||state==='switching';icon(playBtn,playing?'pause':'play',playing?'暂停演示':'播放演示');
      var label=el('span',null,playing?'暂停':'播放');playBtn.appendChild(label);
      playBtn.disabled=state==='ended';playBtn.setAttribute('aria-pressed',playing?'false':'true');renderDots();
    }
    function targetEl(name) { return scene && name ? scene.root.querySelector('[data-mark="'+name+'"]'):null; }
    function cameraGoal(spec) {
      var scale=mqMobile.matches?Math.min(spec.scale,1.12):spec.scale;
      var w=cameraLayer.clientWidth,h=cameraLayer.clientHeight,target=targetEl(spec.target);
      if(!target || target.offsetWidth===0) return {x:0,y:0,scale:scale};
      // Offset coordinates are layout coordinates and do not include the active camera transform.
      var x=target.offsetWidth/2,y=target.offsetHeight/2,n=target;
      while(n && n!==cameraLayer) {x+=n.offsetLeft;y+=n.offsetTop;n=n.offsetParent;}
      return {scale:scale,x:Math.max(w*(1-scale),Math.min(0,w/2-x*scale)),y:spec.keepTop?0:Math.max(h*(1-scale),Math.min(0,h*.4-y*scale))};
    }
    function moveCamera(spec,at) {
      if(!spec || reduceMotion.matches)return;
      cameraTween={from:Object.assign({},camera),to:cameraGoal(spec),at:at,dur:spec.ms};
    }
    function paintCamera() {
      if(cameraTween) {
        var p=Math.min(1,Math.max(0,(clock.elapsed-cameraTween.at)/cameraTween.dur)),e=easeInOut(p);
        ['x','y','scale'].forEach(function(k){camera[k]=cameraTween.from[k]+(cameraTween.to[k]-cameraTween.from[k])*e;});
        if(p===1)cameraTween=null;
      }
      if(cameraLayer)cameraLayer.style.transform='translate('+camera.x+'px,'+camera.y+'px) scale('+camera.scale+')';
    }
    function easeInOut(p) {return p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2;}
    function scrollToTarget(target,at) {
      if(!target)return false;
      var n=target.parentElement,tweens=[];
      while(n && n!==cameraLayer) {
        if(n.scrollHeight>n.clientHeight+1 && /auto|scroll/.test(window.getComputedStyle(n).overflowY)) {
          var tr=target.getBoundingClientRect(),cr=n.getBoundingClientRect();
          var delta=tr.top<cr.top?tr.top-cr.top-12:tr.bottom>cr.bottom?tr.bottom-cr.bottom+12:0;
          if(delta)tweens.push({el:n,from:n.scrollTop,to:n.scrollTop+delta/camera.scale});
        } n=n.parentElement;
      }
      if(tweens.length)scrollTween={at:at,dur:400,tweens:tweens};return !!tweens.length;
    }
    function actBeat(b,i) {
      // Stable row identities allow continuous sorting instead of replacing a whole table.
      var rows=Array.from(scene.root.querySelectorAll('tr[data-mark], .tt-lrow'));
      var before=rows.map(function(n){return {n:n,y:n.offsetTop};});
      var target=targetEl(scene.targets[i]);
      if(scene.clicks[i] && target){target.classList.remove('td-act');void target.offsetWidth;target.classList.add('td-act');}
      scene.go(i);
      before.forEach(function(r){var delta=r.y-r.n.offsetTop;if(delta && !reduceMotion.matches)r.n.animate([{transform:'translateY('+delta+'px)'},{transform:'translateY(0)'}],{duration:420,easing:'ease-in-out',fill:'both'});});
      // New overlays are measured only after their content becomes visible.
      if(b.camera && b.camera.target && !targetEl(b.camera.target))return;
      syncAnimations(b.act);
    }
    function runTimeline() {
      while(beatIndex<timeline.beats.length) {
        var b=timeline.beats[beatIndex];
        if(!b.begun && clock.elapsed>=b.at) {
          b.begun=true;stepIndex=beatIndex;captionText.textContent=b.text;
          var scrolling=scrollToTarget(targetEl(scene.targets[beatIndex]),b.at);
          // Coordinate scrolling and camera moves: scroll keeps a neutral camera.
          moveCamera(scrolling?{scale:1,ms:400}:b.camera,b.at);
        }
        if(!b.prepared && clock.elapsed>=b.act-160) { b.prepared=true;scene.prepare(beatIndex);syncAnimations(Math.max(b.at,b.act-160)); }
        if(clock.elapsed<b.act)break;
        actBeat(b,beatIndex);beatIndex++;
      }
      if(scrollTween) {
        var p=Math.min(1,Math.max(0,(clock.elapsed-scrollTween.at)/scrollTween.dur));
        scrollTween.tweens.forEach(function(t){t.el.scrollTop=t.from+(t.to-t.from)*easeInOut(p);});if(p===1)scrollTween=null;
      }
      paintCamera();syncAnimations();
      var active=dots.children[activeIndex];if(active)active.style.setProperty('--progress',Math.min(1,clock.elapsed/timeline.end));
      if(state==='playing' && clock.elapsed>=timeline.end && beatIndex===timeline.beats.length && !cameraTween && !scrollTween)finishLesson();
    }
    function advance(ms) {
      if(state==='switching' && transition) {
        transition.elapsed+=ms;var p=Math.min(1,transition.elapsed/transition.dur);
        track.style.transform='translateX('+(transition.from+(transition.to-transition.from)*easeInOut(p))+'px)';
        if(p===1) { if(transition.restore) {transition=null;state='playing';updateControls();} else commitIndex(transition.index); }
      } else if(state==='playing') {clock.elapsed+=ms;runTimeline();}
    }
    function finishLesson() {
      if(!playingAllowed() || view!=='lesson')return;
      progress.mark(currentLesson.id,currentLesson.revision);
      if(activeIndex<queue.length-1)selectIndex(activeIndex+1,true);
      else if(coreMode)leaveCore('finished');
      else {
        state='ended';stopClock();updateControls();
        var card=el('div','tutorial-group-end');
        card.appendChild(el('h3',null,'这一组播放结束'));
        card.appendChild(el('p',null,'已看 '+progress.seenCount(queue.map(function(l){return l.id;}))+' / '+queue.length+' 项'));
        var again=btnb('tutorial-nav-link','重看本组');again.addEventListener('click',function(){intent=true;reasons.clear();selectIndex(0,false,true);});
        var all=btnb('tutorial-nav-link','返回全部教程');all.addEventListener('click',function(){renderCatalog();focusGroupCard(groupId);});
        card.appendChild(again);card.appendChild(all);body.querySelector('.tutorial-play').appendChild(card);
        say('本组播放结束。已看记录按每项计算，可重看本组或返回目录。');
      }
    }
    function commitIndex(index) {
      var keepIntent=intent;var keepReasons=new Set(reasons);
      stopPlayback();intent=keepIntent;reasons=keepReasons;activeIndex=index;
      var end=body.querySelector('.tutorial-group-end');if(end)end.remove();
      if(!body.querySelector('.tutorial-play'))buildLessonView();
      loadActive();notifyNavigate();
    }
    function selectIndex(index,automatic,force) {
      if(index<0 || index>=queue.length || (index===activeIndex && !force && !transition))return;
      if(transition) {commitIndex(transition.index);}
      if(index===activeIndex && !force)return;
      if(navOpen)closeNav();
      if(reduceMotion.matches || !waapiOk || force || !track || !scene){commitIndex(index);return;}
      var w=stageClip.clientWidth,dir=index>activeIndex?1:-1;
      var target=track.querySelector('[data-index="'+index+'"]');
      if(!target) {var p=makePanel(queue[index],index);target=p.panel;target.classList.add('td-noanim');track.appendChild(target);}
      target.style.left=(dir*100)+'%';
      var from=drag?drag.offset:0;drag=null;reasons.delete('drag');
      transition={index:index,from:from,to:-dir*w,elapsed:0,dur:reduceMotion.matches?0:300};
      state=playingAllowed()?'switching':'paused';stopClock();updateControls();
      if(playingAllowed())startClock();else {commitIndex(index);}
      if(!automatic)say('第 '+(index+1)+' 项：'+lessonTitle(queue[index]));
    }
    function navigateBy(delta){selectIndex(activeIndex+delta,false);}
    function autoPause(text,reason) {
      reasons.add(reason||'external');if(state==='playing'||state==='switching'){state='paused';stopClock();updateControls();}
      if(text)say(text);
    }
    function togglePlay() {
      if(state==='ended')return;
      if(state==='playing'||state==='switching'){intent=false;autoPause('演示已暂停。','user');}
      else {closeNav();intent=true;reasons.clear();if(document.hidden)reasons.add('hidden');state=transition?'switching':'playing';updateControls();startClock();say('继续播放。');}
    }
    function replayLesson(){closeNav();intent=true;reasons.clear();commitIndex(activeIndex);say('重播本项。');}
    function finishDrag(cancel) {
      if(!drag)return;
      var d=drag;drag=null;
      try {stageClip.releasePointerCapture(d.id);} catch(e){}
      reasons.delete('drag');
      if(!d.horizontal)return;
      suppressClick=true;
      var direction=d.offset<0?1:-1,target=activeIndex+direction;
      var committed=!cancel && target>=0 && target<queue.length && (Math.abs(d.offset)>stageClip.clientWidth*.22 || (Math.abs(d.velocity)>.45 && Math.abs(d.offset)>24));
      if(committed){drag=d;selectIndex(target,false);}
      else {
        // Snap-back uses the same cancellable clock; the teaching timeline stays frozen.
        transition={index:activeIndex,from:d.offset,to:0,elapsed:0,dur:220,restore:true};
        state=playingAllowed()?'switching':'paused';
        if(playingAllowed())startClock();else {track.style.transform='translateX(0px)';transition=null;updateControls();}
      }
    }
    function installGestures(clip) {
      clip.addEventListener('pointerdown',function(e){
        pointers.add(e.pointerId);
        if(pointers.size>1){autoPause('', 'multitouch');finishDrag(true);return;}
        if(e.button!==0 || navOpen || reduceMotion.matches || transition || e.target.closest('button,a,input,select,textarea,[contenteditable="true"]'))return;
        suppressClick=false;drag={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastAt:performance.now(),offset:0,velocity:0,horizontal:false};
      });
      clip.addEventListener('pointermove',function(e){
        if(!drag || drag.id!==e.pointerId)return;
        var dx=e.clientX-drag.x,dy=e.clientY-drag.y;
        if(!drag.horizontal) {
          if(Math.max(Math.abs(dx),Math.abs(dy))<8)return;
          if(Math.abs(dy)>Math.abs(dx)*1.1){drag=null;return;}
          drag.horizontal=true;autoPause('', 'drag');try{clip.setPointerCapture(e.pointerId);}catch(err){}
        }
        if(e.cancelable)e.preventDefault();
        var now=performance.now(),deltaTime=Math.max(1,now-drag.lastAt);
        drag.velocity=(e.clientX-drag.lastX)/deltaTime;drag.lastX=e.clientX;drag.lastAt=now;
        if((activeIndex===0 && dx>0)||(activeIndex===queue.length-1&&dx<0))dx*=.28;
        drag.offset=dx;track.style.transform='translateX('+dx+'px)';
      });
      function releasePointer(e,cancel) {
        pointers.delete(e.pointerId);finishDrag(cancel);
        if(!pointers.size && reasons.has('multitouch')) {
          reasons.delete('multitouch');
          if(playingAllowed()){state=transition?'switching':'playing';updateControls();startClock();}
        }
      }
      clip.addEventListener('pointerup',function(e){releasePointer(e,false);});
      clip.addEventListener('pointercancel',function(e){releasePointer(e,true);});
      clip.addEventListener('lostpointercapture',function(){finishDrag(true);});
      clip.addEventListener('click',function(e){if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;}},true);
    }
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
      var staticNav = el('div', 'tutorial-static-nav');
      staticNav.appendChild(prevBtn); staticNav.appendChild(nextBtn); wrap.appendChild(staticNav);
      var actions = el('div', 'tutorial-static-actions');
      var markBtn = btnb('tutorial-static-mark', progress.has(currentLesson.id) ? '已看过' : '标记已看过');
      if (progress.has(currentLesson.id)) markBtn.disabled = true;
      markBtn.addEventListener('click', function () {
        progress.mark(currentLesson.id, currentLesson.revision);
        markBtn.disabled = true;
        markBtn.textContent = '已看过';
        say('已把《' + variant.title + '》标记为已看过。');
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
          intent=true;reasons.clear();
          buildLessonView();
          commitIndex(activeIndex);
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
        commitIndex(activeIndex);
      });
      wrap.appendChild(retry);
      body.appendChild(wrap);
      try { retry.focus({ preventScroll: true }); } catch (e) {}
    }


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

    root.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&navOpen){e.stopPropagation();closeNav(true);return;}
      if(view==='lesson'&&!navOpen && (footer.contains(e.target)||e.target===prevBtn||e.target===nextBtn) && /ArrowLeft|ArrowRight/.test(e.key)) {
        e.preventDefault();navigateBy(e.key==='ArrowLeft'?-1:1);
      }
    });
    navBtn.addEventListener('click',function(){if(navOpen)closeNav(true);else openNav();});
    backBtn.addEventListener('click',function(){if(coreMode)leaveCore('skip');else{renderCatalog();focusGroupCard(groupId);}});
    closeBtn.addEventListener('click',function(){if(coreMode&&opts.onCoreLeave)opts.onCoreLeave('close');opts.onClose('close');});
    skipBtn.addEventListener('click',function(){leaveCore('skip');});
    prevBtn.addEventListener('click',function(){navigateBy(-1);});nextBtn.addEventListener('click',function(){navigateBy(1);});
    playBtn.addEventListener('click',togglePlay);replayBtn.addEventListener('click',replayLesson);
    tryBtn.addEventListener('click',function(){if(currentLesson.action)opts.onTryIt(currentLesson.action);});
    function onVisibility(){if(document.hidden){finishDrag(true);autoPause('页面切到后台，演示已暂停。','hidden');}}
    function onBlur(){finishDrag(true);pointers.clear();autoPause('窗口失去焦点，演示已暂停。','blur');}
    function onReduceChange(){if(reduceMotion.matches===sawReduce)return;sawReduce=reduceMotion.matches;if(view==='lesson'){intent=false;renderStatic();}}
    function onResize(){
      if(view!=='lesson'||!scene||reduceMotion.matches)return;
      // Resize remeasures stable coordinates without changing the teaching time or watched state.
      if(mqMobile.matches!==(scene.root.dataset.mobile==='true')){var time=clock.elapsed;commitIndex(activeIndex);clock.elapsed=time;runTimeline();}
      else { cameraTween=null; var last=timeline.beats.slice(0,Math.max(1,stepIndex+1)).reverse().find(function(b){return b.camera;}); camera=last?cameraGoal(last.camera):{x:0,y:0,scale:1};paintCamera(); }
    }
    document.addEventListener('visibilitychange',onVisibility);window.addEventListener('blur',onBlur);window.addEventListener('resize',onResize);
    reduceMotion.addEventListener('change',onReduceChange);
    progress.onChange(function(){if(halted || !root.isConnected)return;if(view==='catalog')renderCatalog();else renderDots();});
    if(opts.mode==='core')openCore();else if(opts.groupId&&Data.groupById(opts.groupId)) {
      var ls=Data.lessonsInGroup(opts.groupId),idx=ls.findIndex(function(l){return l.id===opts.lessonId;});openLesson(opts.groupId,Math.max(0,idx));
    } else renderCatalog();
    var api={
      el:root,dialogTitle:dialogTitle,
      focusInitial:function(){var n=view==='lesson'?backBtn:body.querySelector('.tutorial-group-card, .tutorial-guide-title');if(n)n.focus({preventScroll:true});},
      showCatalog:function(){renderCatalog();focusGroupCard(groupId);},
      halt:function(){halted=true;stopPlayback();},
      setRate:function(r){moduleRate=r>0&&r<=4?r:1;},getRate:function(){return moduleRate;},
      debugAdvance:function(ms){if(state==='playing'||state==='switching')advance(Math.max(0,ms));return this.debugState();},
      debugState:function(){return {state:state,view:view,elapsed:Math.round(clock.elapsed),stepIndex:stepIndex,lessonId:currentLesson?currentLesson.id:null,queue:queue.map(function(l){return l.id;}),activeIndex:activeIndex,pauseReasons:Array.from(reasons),camera:Object.assign({},camera),runToken:runToken};},
      destroy:function(){halted=true;stopPlayback();document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('blur',onBlur);window.removeEventListener('resize',onResize);reduceMotion.removeEventListener('change',onReduceChange);root.remove();dialogTitle.remove();if(window.BnuTutorialPlayer._active===api)window.BnuTutorialPlayer._active=null;}
    };
    window.BnuTutorialPlayer._active=api;return api;
  }
  window.BnuTutorialPlayer = {
    mount: mount,
    createProgress: createProgress,
    _active: null,     // 当前挂载的实例（QA 控制台用，如 _active.setRate(0.4)）
    _rate: function (r) { if (this._active) this._active.setRate(r); }
  };
})();
