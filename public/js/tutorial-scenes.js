/* BNU Sparks · tutorial-scenes.js —— 动画使用教程：演示组件库与 25 个分镜。
   懒加载模块（feature-loader: tutorial）。只操作教程舞台，不触碰业务 DOM、
   不调用业务函数；示例数据全部为固定虚构内容。

   编排模型（2026-10 重制）：每个分镜是一次构建的持久场景，不再按“整页四帧
   截图轮换”。build() 返回 {
     root:    场景根节点（.tutorial-demo-frame，一次性建好全部对象）
     steps:   步骤总数（含第 0 步“建立场景”）
     targets: 每步指针目标 data-mark 名（null = 该步无指针）
     clicks:  每步指针是否产生点击反馈
     go(i):   就地把场景推进到第 i 步的状态。绝对状态设置（从任意 ≤i 状态
              调用结果一致），只改动相关元素：星标点亮、面板展开、文字填入
              都发生在原节点上，不做整页重新入场。
   }
   玩家（tutorial-player）负责唯一时钟、指针移动、步骤切换与暂停。 */
(function () {
  'use strict';

  // ── 基础工具 ──────────────────────────────────────────────
  function d(cls, text) {
    var el = document.createElement('div');
    if (cls) el.className = 'tutorial-demo-' + cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function sp(cls, text) {
    var el = document.createElement('span');
    if (cls) el.className = 'tutorial-demo-' + cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function mark(name, el) {
    el.setAttribute('data-mark', name);
    return el;
  }
  function setHidden(el, hidden) {
    if (el) el.classList.toggle('is-hidden', !!hidden);
  }
  // 预留占位但不可见：元素出现前后不改变周围布局（星标不会因徽标出现而移位）
  function ghost(el) {
    if (el) el.classList.add('is-ghost');
    return el;
  }
  // 元素（重新）显现：一次性入场动画，不在每步整体重播。
  // kind: 'td-in'（默认，上浮）/ 'td-slide'（前进而来的页面，右侧滑入）/
  //       'td-pop'（菜单、状态徽标等从锚点弹出）。
  function reveal(el, kind) {
    setHidden(el, false);
    el.classList.remove('is-ghost');
    el.classList.remove('td-in');
    el.classList.remove('td-slide');
    el.classList.remove('td-pop');
    void el.offsetWidth;
    el.classList.add(kind || 'td-in');
    return el;
  }
  // 输入示例：逐字浮现（纯 CSS delay，暂停时随子树动画一起冻结）
  function typed(text) {
    var wrap = sp('typed');
    var chars = String(text == null ? '' : text);
    for (var i = 0; i < chars.length; i++) {
      var c = sp('typed-ch', chars[i]);
      c.style.animationDelay = Math.min(i * 34, 640) + 'ms';
      wrap.appendChild(c);
    }
    return wrap;
  }
  function fillInput(inputEl, text) {
    inputEl.textContent = '';
    inputEl.appendChild(typed(text));
  }
  function noteLine(text) {
    return d('cap-note', text);
  }

  // ── 通用小件 ──────────────────────────────────────────────
  function btn(label, opts) {
    opts = opts || {};
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tutorial-demo-btn' + (opts.primary ? ' is-primary' : '') +
      (opts.small ? ' is-small' : '') + (opts.dim ? ' is-dim' : '');
    b.textContent = label;
    if (opts.mark) mark(opts.mark, b);
    return b;
  }
  function pill(text, kind) {
    return sp('pill' + (kind ? ' is-' + kind : ''), text);
  }
  function chip(label, opts) {
    opts = opts || {};
    var c = sp('chip' + (opts.active ? ' is-active' : '') + (opts.dim ? ' is-dim' : ''), label);
    if (opts.mark) mark(opts.mark, c);
    return c;
  }
  function star(filled, markName) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'tutorial-demo-star' + (filled ? ' is-filled' : ''));
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z');
    svg.appendChild(path);
    if (markName) mark(markName, svg);
    return svg;
  }
  function checkbox(checked, markName) {
    var box = sp('checkbox' + (checked ? ' is-checked' : ''), checked ? '✓' : '');
    if (markName) mark(markName, box);
    return box;
  }
  function avatar(markName) {
    var a = sp('avatar', '示');
    if (markName) mark(markName, a);
    return a;
  }
  function exGlyph(ext) {
    return sp('exglyph is-' + ext, ext.toUpperCase());
  }
  function checkRow(label, checked) {
    var row = d('checkrow');
    row.appendChild(checkbox(checked));
    row.appendChild(sp('checkrow-label', label));
    return row;
  }

  // ── 布局小件（局部界面，不搭整套站点外壳） ──────────────────
  // 上下文行：入口路径 + 右侧附加节点（头像 / 铃铛，由调用方构造并打标）
  function headRow(crumbParts, rightNodes) {
    var bar = d('headrow');
    if (crumbParts && crumbParts.length) {
      var crumb = d('crumb');
      crumbParts.forEach(function (p, i) {
        if (i) crumb.appendChild(sp('crumb-sep', '›'));
        crumb.appendChild(sp(i === crumbParts.length - 1 ? 'crumb-item is-hot' : 'crumb-item', p));
      });
      bar.appendChild(crumb);
    } else {
      bar.appendChild(sp('crumb', ''));
    }
    if (rightNodes && rightNodes.length) {
      var right = d('headrow-right');
      rightNodes.forEach(function (n) { right.appendChild(n); });
      bar.appendChild(right);
    }
    return bar;
  }
  // 课程锚点头：同名课程在变化前后保持的视觉锚点
  function courseHead(name, code, extra) {
    var head = d('course-head');
    var left = d('course-head-left');
    left.appendChild(d('course-head-name', name));
    var codeRow = d('course-head-code');
    codeRow.appendChild(sp('codechip', code));
    if (extra) codeRow.appendChild(extra);
    left.appendChild(codeRow);
    head.appendChild(left);
    return head;
  }
  // 列表行：资料 / 结果 / 收藏项通用
  function row(opts) {
    opts = opts || {};
    var r = d('frow' + (opts.dim ? ' is-dim' : '') + (opts.hot ? ' is-hot' : '') + (opts.selecting ? ' is-selecting' : ''));
    if (opts.mark) mark(opts.mark, r);
    if (opts.selecting) r.appendChild(checkbox(!!opts.checked, opts.checkMark));
    if (opts.ext) r.appendChild(exGlyph(opts.ext));
    var info = d('frow-info');
    info.appendChild(d('frow-title', opts.title));
    if (opts.meta) info.appendChild(d('frow-meta', opts.meta));
    r.appendChild(info);
    if (opts.pill) r.appendChild(opts.pill);
    if (opts.star === true) r.appendChild(star(true));
    else if (opts.star) r.appendChild(opts.star);
    if (opts.count) r.appendChild(sp('frow-count', opts.count));
    if (opts.dlBtn) r.appendChild(btn('下载', { small: true }));
    return r;
  }
  // 课程卡
  function card(opts) {
    opts = opts || {};
    var c = d('ccard' + (opts.hot ? ' is-hot' : '') + (opts.new ? ' is-new' : ''));
    if (opts.mark) mark(opts.mark, c);
    c.appendChild(d('ccard-name', opts.name));
    c.appendChild(sp('codechip', opts.code || ''));
    if (opts.pill) c.appendChild(opts.pill);
    return c;
  }
  function seg(options, activeIdx, marks) {
    var box = d('seg');
    options.forEach(function (label, i) {
      var b = btn(label, { small: true });
      if (i === activeIdx) b.classList.add('is-active');
      if (marks && marks[i]) mark(marks[i], b);
      box.appendChild(b);
    });
    return box;
  }
  function menu(items, opts) {
    opts = opts || {};
    var panelEl = d('menu');
    items.forEach(function (it, i) {
      var rowEl = sp('menu-item' + (i === opts.activeIdx ? ' is-active' : ''), it.label != null ? it.label : it);
      var m = (it.label != null ? it.mark : (opts.marks && opts.marks[i]));
      if (m) mark(m, rowEl);
      panelEl.appendChild(rowEl);
    });
    return panelEl;
  }
  function panel(title, children, actions) {
    var p = d('panel');
    p.appendChild(d('panel-title', title));
    (children || []).forEach(function (c) { if (c) p.appendChild(c); });
    if (actions && actions.length) {
      var ar = d('panel-actions');
      actions.forEach(function (a) { ar.appendChild(a); });
      p.appendChild(ar);
    }
    return p;
  }
  function formRow(label, value, opts) {
    opts = opts || {};
    var r = d('formrow' + (opts.dim ? ' is-dim' : ''));
    r.appendChild(sp('formrow-label', label));
    var input = d('formrow-input' + (opts.area ? ' is-area' : ''));
    if (value != null) input.appendChild(typed(value));
    else if (opts.placeholder) input.appendChild(sp('formrow-ph', opts.placeholder));
    r.appendChild(input);
    if (opts.note) r.appendChild(sp('formrow-note', opts.note));
    if (opts.mark) mark(opts.mark, r);
    return r;
  }
  // 收藏页标签（课程 / 文件 / 帖子）
  function favTabs(activeIdx, marks) {
    return seg(['课程', '文件', '帖子'], activeIdx, marks);
  }
  // PDF 纸张：标题为真实文字，正文是装饰行——“装饰”与“可读文字”分离
  function sheet(title, heading, lines, opts) {
    opts = opts || {};
    var s = d('sheet');
    s.appendChild(d('sheet-title', title));
    if (heading) s.appendChild(d('sheet-heading', heading));
    (lines || []).forEach(function () {
      s.appendChild(d('sheet-line'));
    });
    if (opts.foot) s.appendChild(sp('sheet-foot', opts.foot));
    return s;
  }
  function zipTree(items) {
    var tree = d('ziptree');
    items.forEach(function (it) {
      var r = d('ziptree-row' + (it.folder ? ' is-folder' : '') + (it.dim ? ' is-dim' : ''));
      if (it.mark) mark(it.mark, r);
      r.appendChild(sp('ziptree-glyph', it.folder ? '▸' : '·'));
      r.appendChild(sp('ziptree-name', it.name));
      if (it.size) r.appendChild(sp('ziptree-size', it.size));
      tree.appendChild(r);
    });
    return tree;
  }
  function weekGrid(opts) {
    opts = opts || {};
    var grid = d('week');
    var days = ['一', '二', '三', '四', '五'];
    var head = d('week-head');
    days.forEach(function (day) { head.appendChild(sp('week-day', day)); });
    grid.appendChild(head);
    var cells = d('week-grid');
    for (var i = 0; i < 15; i++) cells.appendChild(d('week-cell'));
    (opts.blocks || []).forEach(function (b) {
      var block = d('week-block' + (b.hot ? ' is-hot' : ''));
      if (b.mark) mark(b.mark, block);
      block.style.gridColumn = String(b.day);
      block.style.gridRow = b.period + ' / span ' + (b.span || 1);
      block.appendChild(d('week-block-name', b.label));
      if (b.placeEl) block.appendChild(b.placeEl);
      cells.appendChild(block);
    });
    grid.appendChild(cells);
    return grid;
  }
  function qCard(opts) {
    var c = d('qcard' + (opts.hot ? ' is-hot' : ''));
    if (opts.mark) mark(opts.mark, c);
    c.appendChild(d('qcard-title', opts.title));
    if (opts.meta) c.appendChild(d('qcard-meta', opts.meta));
    if (opts.pill) c.appendChild(opts.pill);
    return c;
  }
  function answer(opts) {
    var c = d('answer' + (opts.hot ? ' is-hot' : '') + (opts.focus ? ' is-focus' : ''));
    if (opts.mark) mark(opts.mark, c);
    var head = d('answer-head');
    head.appendChild(sp('answer-author', opts.author));
    if (opts.badge) head.appendChild(opts.badge);
    c.appendChild(head);
    (opts.lines || []).forEach(function (line) { c.appendChild(d('answer-line', line)); });
    if (opts.actions && opts.actions.length) {
      var actions = d('answer-actions');
      opts.actions.forEach(function (a) {
        var b = btn(a.label, { small: true, primary: a.primary, mark: a.mark });
        if (a.on) b.classList.add('is-on');
        actions.appendChild(b);
      });
      c.appendChild(actions);
    }
    return c;
  }
  function emptyState(title, sub, actions) {
    var box = d('empty');
    box.appendChild(d('empty-title', title));
    box.appendChild(d('empty-sub', sub));
    var ar = d('empty-actions');
    (actions || []).forEach(function (a) { ar.appendChild(a); });
    box.appendChild(ar);
    return box;
  }
  function searchbox(opts) {
    opts = opts || {};
    var box = d('searchbox');
    box.appendChild(sp('searchbox-icon', '⌕'));
    var input = d('searchbox-input');
    if (opts.mark) mark(opts.mark, input);
    if (opts.text) input.appendChild(typed(opts.text));
    else if (opts.placeholder) input.appendChild(sp('searchbox-ph', opts.placeholder));
    box.appendChild(input);
    box.appendChild(btn(opts.label || '搜索', { small: true, primary: true, mark: opts.btnMark }));
    return box;
  }

  // ═══ 分镜工厂 ═════════════════════════════════════════════
  // 每个工厂返回 { root, steps, targets, clicks, apply:[fn0..fnN-1] }；
  // go(i) 顺序执行 apply[0..i]（绝对状态设置，可从任意状态推进）。

  // find-search · A 建立搜索 → B 输入 → C 结果 → D 课程资料列表 → E 资料详情
  function findSearch(ctx) {
    var mobile = !!ctx.mobile;
    var root = d('frame');
    var bar = headRow(['木铎星火', '首页']);
    var search = searchbox({ placeholder: '搜索课程、资料或老师…', mark: 'search-input', btnMark: 'search-go' });
    var results = d('col');
    var resCourse = d('result is-course');
    mark('res-course', resCourse);
    resCourse.appendChild(d('result-title', '学习方法导论'));
    resCourse.appendChild(d('result-meta', '课程 · DEMO101 · 3 份资料'));
    var resFile = d('result');
    resFile.appendChild(d('result-title', '期末复习提纲.pdf'));
    resFile.appendChild(d('result-meta', '资料 · 学习方法导论'));
    results.appendChild(sp('cap-label', '课程'));
    results.appendChild(resCourse);
    results.appendChild(sp('cap-label', '资料'));
    results.appendChild(resFile);
    var coursePage = d('col');
    coursePage.appendChild(courseHead('学习方法导论', 'DEMO101'));
    coursePage.appendChild(row({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', ext: 'pdf', mark: 'f-review', count: '86', dlBtn: true }));
    coursePage.appendChild(row({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', ext: 'pdf', count: '40', dlBtn: true }));
    var detail = d('col');
    var detailCard = d('detail');
    var dhead = d('detail-head');
    dhead.appendChild(exGlyph('pdf'));
    var dinfo = d('detail-info');
    dinfo.appendChild(d('detail-title', '期末复习提纲.pdf'));
    dinfo.appendChild(d('detail-meta', '学习方法导论 · DEMO101 · 示例同学 上传'));
    dhead.appendChild(dinfo);
    detailCard.appendChild(dhead);
    detailCard.appendChild(d('detail-desc', '按周整理的复习要点与例题提示。'));
    var dactions = d('detail-actions');
    dactions.appendChild(btn('预览', { small: true }));
    dactions.appendChild(btn('下载', { small: true, primary: true }));
    detailCard.appendChild(dactions);
    detail.appendChild(detailCard);
    if (mobile) {
      detail.appendChild(noteLine('手机浏览器请下载后查看 PDF；图片和文本可直接预览。'));
    } else {
      detail.appendChild(sheet('期末复习提纲', '第一章 学习方法概述', [1, 2, 3, 4], { foot: '示例预览 · 第 1 页' }));
    }
    root.appendChild(bar);
    root.appendChild(search);
    root.appendChild(results);
    root.appendChild(coursePage);
    root.appendChild(detail);
    setHidden(results, true);
    setHidden(coursePage, true);
    setHidden(detail, true);
    return {
      root: root, steps: 5,
      targets: [null, 'search-input', 'search-go', 'res-course', 'f-review'],
      clicks: [false, true, true, true, true],
      apply: [
        function () {},
        function () { fillInput(search.querySelector('.tutorial-demo-searchbox-input'), '学习方法'); },
        function () { reveal(results); },
        function () { setHidden(results, true); reveal(coursePage, 'td-slide'); },
        function () { setHidden(coursePage, true); reveal(detail, 'td-slide'); }
      ]
    };
  }

  // find-filter · A 列表与筛选入口 → B 打开类型 → C 选试卷 → D 打开排序 → E 收藏量排序
  function findFilter(ctx) {
    var root = d('frame');
    root.appendChild(courseHead('学习方法导论', 'DEMO101'));
    var bar = d('chipbar');
    var chipType = chip('类型 ⌄', { mark: 'chip-type' });
    var chipSort = chip('排序 ⌄', { mark: 'chip-sort' });
    bar.appendChild(chipType);
    bar.appendChild(chipSort);
    root.appendChild(bar);
    // 筛选菜单锚定在各自 chip 下方（真实下拉），不再把列表往下推
    var typeMenu = menu(['全部', '笔记', { label: '试卷', mark: 'opt-paper' }, '讲义'], { activeIdx: 2 });
    var sortMenu = menu(['上传时间', '下载量', { label: '收藏量', mark: 'opt-fav' }], { activeIdx: 2 });
    typeMenu.style.left = '0';
    typeMenu.style.transformOrigin = 'top left';
    sortMenu.style.right = '0';
    sortMenu.style.transformOrigin = 'top right';
    bar.appendChild(typeMenu);
    bar.appendChild(sortMenu);
    var list = d('list');
    var paper1 = row({ title: '2022 期末试卷.pdf', meta: '示例同学 · 收藏 41', ext: 'pdf' });
    var paper2 = row({ title: '2023 期末试卷.pdf', meta: '示例同学 · 收藏 28', ext: 'pdf' });
    var note1 = row({ title: '课堂笔记.pdf', meta: '另一位同学 · 收藏 9', ext: 'pdf' });
    var note2 = row({ title: '复习讲义.pdf', meta: '示例同学 · 收藏 6', ext: 'pdf' });
    list.appendChild(paper1);
    list.appendChild(paper2);
    list.appendChild(note1);
    list.appendChild(note2);
    root.appendChild(list);
    setHidden(typeMenu, true);
    setHidden(sortMenu, true);
    return {
      root: root, steps: 5,
      targets: [null, 'chip-type', 'opt-paper', 'chip-sort', 'opt-fav'],
      clicks: [false, true, true, true, true],
      apply: [
        function () {},
        function () { reveal(typeMenu, 'td-pop'); },
        function () {
          setHidden(typeMenu, true);
          chipType.textContent = '类型：试卷';
          chipType.classList.add('is-active');
          setHidden(note1, true);
          setHidden(note2, true);
        },
        function () {
          // 排序菜单锚定在「排序」chip 当前位置下方（类型激活后宽度会变，落到打开时再取）
          if (chipSort.offsetLeft) {
            sortMenu.style.left = chipSort.offsetLeft + 'px';
            sortMenu.style.right = 'auto';
            sortMenu.style.transformOrigin = 'top left';
          }
          reveal(sortMenu, 'td-pop');
        },
        function () {
          setHidden(sortMenu, true);
          chipSort.textContent = '排序：收藏量';
          chipSort.classList.add('is-active');
          // 收藏量排序：41 → 28，行在原位置上调换
          list.insertBefore(paper2, paper1);
          reveal(paper1);
          reveal(paper2);
        }
      ]
    };
  }

  // find-same-name · A 同名区块 → B 突出另一条 → C 切换（名同码变）→ D 归属信息
  function findSameName(ctx) {
    var root = d('frame');
    var head = courseHead('学习方法导论', 'DEMO101');
    var codeChip = head.querySelector('.tutorial-demo-codechip');
    root.appendChild(head);
    var files = d('col');
    files.appendChild(row({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', ext: 'pdf' }));
    files.appendChild(row({ title: '课程大纲.pdf', meta: '另一位同学 · 收藏 2', ext: 'pdf' }));
    root.appendChild(files);
    var same = d('samename');
    same.appendChild(sp('cap-label', '同名课程'));
    var rowCur = d('samename-row is-current');
    rowCur.appendChild(d('samename-name', '学习方法导论'));
    rowCur.appendChild(sp('codechip', 'DEMO101'));
    rowCur.appendChild(sp('samename-note', '当前课程'));
    var rowAlt = d('samename-row');
    mark('alt-course', rowAlt);
    rowAlt.appendChild(d('samename-name', '学习方法导论'));
    rowAlt.appendChild(sp('codechip', 'DEMO201'));
    rowAlt.appendChild(sp('samename-note', '另一个学院开设'));
    same.appendChild(rowCur);
    same.appendChild(rowAlt);
    root.appendChild(same);
    return {
      root: root, steps: 4,
      targets: [null, 'alt-course', null, null],
      clicks: [false, true, true, false],
      apply: [
        function () {},
        function () {
          rowAlt.classList.add('is-hot');
          var n1 = noteLine('两条都叫“学习方法导论”，代码不同。');
          same.appendChild(n1);
          reveal(n1);
        },
        function () {
          codeChip.textContent = 'DEMO201';
          files.textContent = '';
          files.appendChild(row({ title: '海洋科学导论复习要点.pdf', meta: '示例同学 · 收藏 8', ext: 'pdf' }));
          files.appendChild(row({ title: '课程大纲.pdf', meta: '另一位同学 · 收藏 2', ext: 'pdf' }));
          reveal(files, 'td-slide');
          setHidden(same, true);
        },
        function () {
          codeChip.classList.add('is-hot');
          var n2 = noteLine('名称相同、代码不同：留意课程归属再下载资料。');
          root.appendChild(n2);
          reveal(n2);
        }
      ]
    };
  }

  // find-preview · 桌面：详情 → 预览第 1 页 → 第 2 页 → 回详情；手机：下载后查看
  function findPreview(ctx) {
    var root = d('frame');
    var detail = d('detail');
    var dhead = d('detail-head');
    dhead.appendChild(exGlyph('pdf'));
    var dinfo = d('detail-info');
    dinfo.appendChild(d('detail-title', '期末复习提纲.pdf'));
    dinfo.appendChild(d('detail-meta', '学习方法导论 · DEMO101 · 2.1 MB'));
    dhead.appendChild(dinfo);
    detail.appendChild(dhead);
    var dactions = d('detail-actions');
    var previewBtn = btn('预览', { small: true, primary: true, mark: 'btn-preview' });
    var dlBtn = btn('下载', { small: true });
    dactions.appendChild(previewBtn);
    dactions.appendChild(dlBtn);
    detail.appendChild(dactions);
    root.appendChild(detail);
    var viewer, sheetEl, counter, nextPageBtn, mobileHint, dlPill;
    if (ctx.mobile) {
      // 手机真实能力：PDF 不做内嵌预览，展示“下载后查看”
      mobileHint = panel('预览', [
        d('panel-text', '手机浏览器暂不支持内嵌 PDF 预览。'),
        noteLine('图片和文本可以直接预览；PPT/PPTX 暂不支持在线预览。')
      ], [btn('下载 PDF', { primary: true, mark: 'btn-dl-pdf' })]);
      root.appendChild(mobileHint);
      setHidden(mobileHint, true);
      return {
        root: root, steps: 4,
        targets: [null, 'btn-preview', 'btn-dl-pdf', null],
        clicks: [false, true, true, false],
      apply: [
        function () {},
        function () { reveal(mobileHint, 'td-slide'); },
        function () {
          dlPill = pill('已开始下载 ↓', 'success');
          detail.appendChild(dlPill);
          reveal(dlPill, 'td-pop');
        },
        function () {
          setHidden(mobileHint, true);
          var n = noteLine('下载后用手机上的应用查看 PDF。');
          detail.appendChild(n);
          reveal(n);
        }
      ]
      };
    }
    viewer = d('viewer');
    var vbar = d('viewer-bar');
    vbar.appendChild(btn('✕ 关闭', { small: true, mark: 'btn-close' }));
    vbar.appendChild(sp('viewer-title', '预览 · 最多前三页'));
    vbar.appendChild(btn('下一页 →', { small: true, mark: 'btn-next' }));
    counter = sp('viewer-page', '第 1 / 3 页');
    vbar.appendChild(counter);
    viewer.appendChild(vbar);
    sheetEl = sheet('期末复习提纲', '摘要：覆盖第 1—8 周内容', [1, 2, 3, 4, 5], { foot: '示例预览 · 第 1 页' });
    viewer.appendChild(sheetEl);
    root.appendChild(viewer);
    setHidden(viewer, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-preview', 'btn-next', 'btn-close'],
      clicks: [false, true, true, true],
      apply: [
        function () {},
        function () { reveal(viewer); },
        function () {
          sheetEl.textContent = '';
          sheetEl.appendChild(d('sheet-title', '期末复习提纲'));
          sheetEl.appendChild(d('sheet-heading', '三、常见题型与答题思路'));
          for (var i = 0; i < 5; i++) sheetEl.appendChild(d('sheet-line'));
          sheetEl.appendChild(sp('sheet-foot', '示例预览 · 第 2 页'));
          counter.textContent = '第 2 / 3 页';
          reveal(sheetEl);
        },
        function () {
          setHidden(viewer, true);
          previewBtn.classList.remove('is-primary');
          dlBtn.classList.add('is-primary');
          var n = noteLine('确认内容后再下载；PPT/PPTX 暂不支持在线预览。');
          detail.appendChild(n);
          reveal(n);
        }
      ]
    };
  }

  // find-zip · A ZIP 详情 → B 文件清单 → C 展开条目 → D 说明
  function findZip(ctx) {
    var root = d('frame');
    var detail = d('detail');
    var dhead = d('detail-head');
    dhead.appendChild(exGlyph('zip'));
    var dinfo = d('detail-info');
    dinfo.appendChild(d('detail-title', '复习资料.zip'));
    dinfo.appendChild(d('detail-meta', '学习方法导论 · DEMO101 · 4.6 MB'));
    dhead.appendChild(dinfo);
    detail.appendChild(dhead);
    var dactions = d('detail-actions');
    dactions.appendChild(btn('预览', { small: true, primary: true, mark: 'btn-zip-preview' }));
    dactions.appendChild(btn('下载', { small: true }));
    detail.appendChild(dactions);
    root.appendChild(detail);
    var treeBox = d('col');
    var folderRow = null;
    var entries = null;
    function tree(expanded) {
      var treeEl = zipTree(expanded
        ? [{ folder: true, name: '复习资料/', mark: 'zip-folder' },
           { name: '提纲.pdf', size: '312 KB' },
           { name: '练习题.txt', size: '8 KB' },
           { name: '历年真题合集.pdf', size: '1.2 MB' }]
        : [{ folder: true, name: '复习资料/', mark: 'zip-folder' }]);
      return treeEl;
    }
    var listPanel = panel('文件清单', [treeBox]);
    root.appendChild(listPanel);
    setHidden(listPanel, true);
    folderRow = tree(false);
    treeBox.appendChild(folderRow);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-zip-preview', 'zip-folder', null],
      clicks: [false, true, true, false],
      apply: [
        function () {},
        function () { reveal(listPanel, 'td-slide'); },
        function () {
          treeBox.textContent = '';
          entries = tree(true);
          treeBox.appendChild(entries);
          reveal(treeBox);
        },
        function () {
          var n = noteLine('这里查看目录，不打开包内文件。');
          listPanel.appendChild(n);
          reveal(n);
        }
      ]
    };
  }

  // find-download · A 批量入口 → B 选择模式 → C 勾选 → D 再勾选 → E 分别下载
  function findDownload(ctx) {
    var root = d('frame');
    var toolbar = d('toolbar');
    var batchBtn = btn('批量下载', { small: true, primary: true, mark: 'btn-batch' });
    var countEl = sp('toolbar-count', '已选 0 个');
    var dlSelBtn = btn('下载选中', { small: true, primary: true, mark: 'btn-dl' });
    toolbar.appendChild(batchBtn);
    toolbar.appendChild(countEl);
    toolbar.appendChild(dlSelBtn);
    root.appendChild(toolbar);
    var list = d('list');
    // 复选框从建树起就在行内（带标记），用 is-selecting 控制显隐，
    // 避免“先插入再补标记”的脆弱拼装
    var chk1 = checkbox(false, 'chk-1');
    var chk2 = checkbox(false, 'chk-2');
    var r1 = row({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', ext: 'pdf', count: '86', dlBtn: true });
    var r2 = row({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', ext: 'pdf', count: '40', dlBtn: true });
    var r3 = row({ title: '课程讲义合集.zip', meta: '示例同学 · 收藏 3', ext: 'zip', count: '21', dlBtn: true });
    r1.insertBefore(chk1, r1.firstChild);
    r2.insertBefore(chk2, r2.firstChild);
    list.appendChild(r1);
    list.appendChild(r2);
    list.appendChild(r3);
    root.appendChild(list);
    setHidden(countEl, true);
    setHidden(dlSelBtn, true);
    return {
      root: root, steps: 5,
      targets: [null, 'btn-batch', 'chk-1', 'chk-2', 'btn-dl'],
      clicks: [false, true, true, true, true],
      apply: [
        function () {},
        function () {
          [r1, r2, r3].forEach(function (r) { r.classList.add('is-selecting'); });
          setHidden(countEl, false);
          reveal(toolbar);
        },
        function () {
          chk1.classList.add('is-checked');
          chk1.textContent = '✓';
          countEl.textContent = '已选 1 个';
        },
        function () {
          chk2.classList.add('is-checked');
          chk2.textContent = '✓';
          countEl.textContent = '已选 2 个';
          setHidden(dlSelBtn, false);
        },
        function () {
          [r1, r2].forEach(function (r) {
            var feed = pill('已开始下载 ↓', 'success');
            r.appendChild(feed);
            reveal(feed, 'td-pop');
          });
          setHidden(dlSelBtn, true);
          var n = noteLine('两份资料分别下载，不合并为压缩包。');
          root.appendChild(n);
          reveal(n);
        }
      ]
    };
  }

  // courses-import · A 空状态 → B 解析确认 → C 课程卡片 → D 能力分支
  function coursesImport(ctx) {
    var link = ctx.capability === 'link';
    var root = d('frame');
    var empty = emptyState('还没有课程', '导入教务系统导出的列表式课表，或手动添加。', [
      btn('导入课表', { primary: true, mark: 'btn-import' }),
      btn('手动添加课程', {})
    ]);
    root.appendChild(empty);
    var confirm = panel('确认导入', [
      sp('cap-label', '已识别 3 门课程（列表式课表）'),
      checkRow('学习方法导论 · DEMO101', true),
      checkRow('高等数学 B · DEMO102', true),
      checkRow('体育（三） · DEMO103', true),
      noteLine('导入文件只在浏览器本地解析，可见范围以导入页提示为准。')
    ], [btn('取消', {}), btn('确认导入', { primary: true, mark: 'btn-confirm' })]);
    root.appendChild(confirm);
    setHidden(confirm, true);
    var listWrap = d('col');
    listWrap.appendChild(seg(['课程列表', '周课表'], 0, ['seg-list', 'seg-week']));
    var cards = d('col');
    var c1 = card({ name: '学习方法导论', code: 'DEMO101', mark: 'card-course' });
    if (link) c1.appendChild(pill('有资料', 'success'));
    cards.appendChild(c1);
    cards.appendChild(card({ name: '高等数学 B', code: 'DEMO102' }));
    cards.appendChild(card({ name: '体育（三）', code: 'DEMO103' }));
    listWrap.appendChild(cards);
    root.appendChild(listWrap);
    setHidden(listWrap, true);
    var dest = d('col');
    if (link) {
      dest.appendChild(courseHead('学习方法导论', 'DEMO101'));
      dest.appendChild(row({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', ext: 'pdf', count: '86', dlBtn: true }));
      dest.appendChild(row({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', ext: 'pdf', count: '40', dlBtn: true }));
      dest.appendChild(noteLine('匹配到资料目录的课程，可以直接查看资料。'));
    } else {
      dest.appendChild(courseHead('学习方法导论', 'DEMO101'));
      dest.appendChild(panel('课程详情', [
        formRow('上课时间', '周一 3—4 节'),
        formRow('地点', '教二 105'),
        noteLine('资料关联取决于培养层次、课表格式和课程匹配。')
      ]));
    }
    root.appendChild(dest);
    setHidden(dest, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-import', 'btn-confirm', 'card-course'],
      clicks: [false, true, true, true],
      apply: [
        function () {},
        function () { setHidden(empty, true); reveal(confirm, 'td-slide'); },
        function () { setHidden(confirm, true); reveal(listWrap, 'td-slide'); },
        function () { setHidden(listWrap, true); reveal(dest, 'td-slide'); }
      ]
    };
  }

  // courses-views · A 课程列表 → B 周课表 → C 突出某天 → D 切回列表
  function coursesViews(ctx) {
    var root = d('frame');
    var segEl = seg(['课程列表', '周课表'], 0, ['seg-list', 'seg-week']);
    root.appendChild(segEl);
    var listView = d('col');
    listView.appendChild(card({ name: '学习方法导论', code: 'DEMO101' }));
    listView.appendChild(card({ name: '高等数学 B', code: 'DEMO102' }));
    listView.appendChild(card({ name: '体育（三）', code: 'DEMO103' }));
    root.appendChild(listView);
    var placeEl = sp('week-block-place', '');
    var weekView = weekGrid({ blocks: [
      { day: 1, period: 1, label: '高等数学 B' },
      { day: 3, period: 2, label: '学习方法导论', mark: 'wk-loc', placeEl: placeEl },
      { day: 4, period: 1, label: '体育（三）' }
    ] });
    root.appendChild(weekView);
    setHidden(weekView, true);
    return {
      root: root, steps: 4,
      targets: [null, 'seg-week', 'wk-loc', 'seg-list'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () {
          segEl.children[0].classList.remove('is-active');
          segEl.children[1].classList.add('is-active');
          setHidden(listView, true);
          reveal(weekView, 'td-slide');
        },
        function () {
          weekView.classList.add('is-focus');
          placeEl.textContent = '周三 3—4 节 · 教二 105';
        },
        function () {
          segEl.children[1].classList.remove('is-active');
          segEl.children[0].classList.add('is-active');
          setHidden(weekView, true);
          setHidden(listView, false);
          reveal(listView, 'td-slide-back');
        }
      ]
    };
  }

  // courses-open · A 课程卡 → B 点击 → C 进入（名称连续）→ D 结果
  function coursesOpen(ctx) {
    var link = ctx.capability === 'link';
    var generic = ctx.capability === 'generic';
    var root = d('frame');
    root.appendChild(headRow(['我的课程']));
    var list = d('col');
    list.appendChild(card({ name: '高等数学 B', code: 'DEMO102', hot: false }));
    list.firstChild.classList.add('is-dim');
    var solo = card({ name: '学习方法导论', code: 'DEMO101', mark: 'card-course' });
    if (link) solo.appendChild(pill('有资料', 'success'));
    list.appendChild(solo);
    var other = card({ name: '体育（三）', code: 'DEMO103' });
    other.classList.add('is-dim');
    list.appendChild(other);
    root.appendChild(list);
    var dest = d('col');
    dest.appendChild(courseHead('学习方法导论', 'DEMO101'));
    if (link) {
      dest.appendChild(row({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', ext: 'pdf', mark: 'file-1', count: '86', dlBtn: true }));
      dest.appendChild(row({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', ext: 'pdf', count: '40', dlBtn: true }));
    } else {
      dest.appendChild(panel('课程详情', [
        formRow('上课时间', '周一 3—4 节'),
        formRow('地点', '教二 105')
      ]));
    }
    root.appendChild(dest);
    setHidden(dest, true);
    var apply = [
      function () {},
      function () { solo.classList.add('is-press'); },
      function () { setHidden(list, true); reveal(dest, 'td-slide'); },
      function () {
        var n = link
          ? noteLine('课程名与目录位置保持一致。')
          : noteLine(generic
            ? '能否直达资料取决于培养层次、课表格式和课程匹配。'
            : '此课表仅作课程表使用；课程安排以详情为准。');
        dest.appendChild(n);
        reveal(n);
        if (link) {
          var f = dest.querySelector('[data-mark="file-1"]');
          if (f) f.classList.add('is-hot');
        }
      }
    ];
    return {
      root: root, steps: 4,
      targets: [null, 'card-course', null, link ? 'file-1' : null],
      clicks: [false, true, false, false],
      apply: apply
    };
  }

  // courses-manual · A 管理 → B 菜单 → C 添加表单（时间可不填）→ D 新课程
  function coursesManual(ctx) {
    var root = d('frame');
    var bar = headRow(['我的课程'], [btn('管理', { small: true, mark: 'btn-manage' })]);
    root.appendChild(bar);
    var list = d('col');
    list.appendChild(card({ name: '高等数学 B', code: 'DEMO102' }));
    root.appendChild(list);
    // 菜单锚定在「管理」按钮下方
    var manageMenu = menu(['导入课表', { label: '手动添加课程', mark: 'mi-manual' }, '外观设置'], { activeIdx: 1 });
    bar.appendChild(manageMenu);
    setHidden(manageMenu, true);
    var form = panel('手动添加课程', [
      formRow('课程名称', '书法入门'),
      formRow('上课时间', null, { placeholder: '留空', note: '自学 / 补修可不填' }),
      noteLine('没有排课时间的课程，也能加入课程列表。')
    ], [btn('保存', { primary: true, mark: 'btn-save-course' })]);
    root.appendChild(form);
    setHidden(form, true);
    var newCard = card({ name: '书法入门', code: '自学', new: true });
    newCard.appendChild(pill('已添加', 'success'));
    return {
      root: root, steps: 4,
      targets: [null, 'btn-manage', 'mi-manual', 'btn-save-course'],
      clicks: [false, true, true, true],
      apply: [
        function () {},
        function () { reveal(manageMenu, 'td-pop'); },
        function () { setHidden(manageMenu, true); reveal(form, 'td-slide'); },
        function () {
          setHidden(form, true);
          list.insertBefore(newCard, list.firstChild);
          reveal(newCard);
          var n = noteLine('自学课程不会出现在周课表中。');
          root.appendChild(n);
          reveal(n);
        }
      ]
    };
  }

  // courses-terms · A 切换面板 → B 导入为新课表 → C 新课表生效 → D 切回旧课表
  function coursesTerms(ctx) {
    var root = d('frame');
    var terms = d('terms');
    var rowOld = d('term-row is-active');
    mark('term-old', rowOld);
    rowOld.appendChild(d('term-name', '上学期'));
    rowOld.appendChild(sp('term-note', '示例名称'));
    var rowNew = d('term-row');
    rowNew.appendChild(d('term-name', '新课表'));
    var termActions = d('term-actions');
    termActions.appendChild(btn('重新导入', { small: true, dim: true }));
    termActions.appendChild(btn('导入为新课表', { small: true, primary: true, mark: 'btn-newterm' }));
    terms.appendChild(rowOld);
    terms.appendChild(rowNew);
    terms.appendChild(termActions);
    root.appendChild(terms);
    setHidden(rowNew, true);
    var list = d('col');
    function cardsFor(kind) {
      var box = d('col');
      (kind === 'new'
        ? [['概率论与数理统计', 'DEMO104'], ['大学物理', 'DEMO105'], ['数据结构', 'DEMO106']]
        : [['学习方法导论', 'DEMO101'], ['高等数学 B', 'DEMO102'], ['体育（三）', 'DEMO103']]
      ).forEach(function (p) { box.appendChild(card({ name: p[0], code: p[1] })); });
      return box;
    }
    var oldCards = cardsFor('old');
    var newCards = cardsFor('new');
    list.appendChild(oldCards);
    root.appendChild(list);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-newterm', null, 'term-old'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () { reveal(rowNew); },
        function () {
          rowNew.classList.add('is-active');
          rowOld.classList.remove('is-active');
          list.textContent = '';
          newCards = cardsFor('new');
          list.appendChild(newCards);
          reveal(list, 'td-slide');
        },
        function () {
          rowOld.classList.add('is-active', 'is-hot');
          rowNew.classList.remove('is-active');
          list.textContent = '';
          oldCards = cardsFor('old');
          list.appendChild(oldCards);
          reveal(list, 'td-slide-back');
          var n = noteLine('旧课表仍可随时查看。');
          root.appendChild(n);
          reveal(n);
        }
      ]
    };
  }

  // save-course · 核心 · A 课程与星标 → B 收藏 → C 头像菜单 → D 我的收藏 → E 打开课程
  function saveCourse(ctx) {
    var root = d('frame');
    var bar = headRow(['全部课程', '专业课 / 示例专业'], [avatar('avatar')]);
    var barCrumb = bar.querySelector('.tutorial-demo-crumb');
    root.appendChild(bar);
    var listWrap = d('col');
    // 同层课程行做上下文：舞台是“一门课在一列表中”，不是孤立一行
    listWrap.appendChild(row({ title: '课程设计与开发', meta: 'EDU220 · 示例学院', dim: true }));
    var courseRow = d('frow is-hot');
    courseRow.appendChild(d('frow-title', '学习方法导论'));
    courseRow.appendChild(sp('codechip', 'DEMO101'));
    var starEl = star(false, 'star');
    starEl.style.marginLeft = 'auto';
    courseRow.appendChild(starEl);
    var favedPill = ghost(pill('已收藏', 'star'));
    courseRow.appendChild(favedPill);
    listWrap.appendChild(courseRow);
    listWrap.appendChild(row({ title: '教育心理学基础', meta: 'PSY105 · 示例学院', dim: true }));
    root.appendChild(listWrap);
    // 头像菜单锚定在顶栏头像下方（真实下拉），不挤在列表流里
    var favMenu = menu(['通知中心', '我的上传', { label: '我的收藏', mark: 'menu-fav' }, '个人中心'], { activeIdx: 2 });
    bar.appendChild(favMenu);
    setHidden(favMenu, true);
    var favPage = d('col');
    favPage.appendChild(favTabs(0, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']));
    favPage.appendChild(row({ title: '学习方法导论', meta: 'DEMO101', mark: 'fav-row', star: true, hot: true }));
    root.appendChild(favPage);
    setHidden(favPage, true);
    var coursePage = d('col');
    coursePage.appendChild(sp('crumb-solo', '我的收藏 › 课程 › 学习方法导论'));
    coursePage.appendChild(courseHead('学习方法导论', 'DEMO101'));
    coursePage.appendChild(row({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', ext: 'pdf', count: '86', dlBtn: true }));
    coursePage.appendChild(row({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', ext: 'pdf', count: '40', dlBtn: true }));
    coursePage.appendChild(row({ title: '课堂展示指南.pdf', meta: '第三位同学 · 收藏 3', ext: 'pdf', count: '18', dlBtn: true, dim: true }));
    coursePage.appendChild(noteLine('从“我的收藏 → 课程”随时回到这里。'));
    root.appendChild(coursePage);
    setHidden(coursePage, true);
    return {
      root: root, steps: 5,
      targets: [null, 'star', 'avatar', 'menu-fav', 'fav-row'],
      clicks: [false, true, true, true, true],
      apply: [
        function () {},
        function () {
          starEl.classList.add('is-filled');
          setHidden(favedPill, false);
          reveal(favedPill, 'td-pop');
        },
        function () { reveal(favMenu, 'td-pop'); },
        function () {
          setHidden(favMenu, true);
          setHidden(listWrap, true);
          barCrumb.textContent = '';
          barCrumb.appendChild(sp('crumb-item is-hot', '头像菜单 › 我的收藏 › 课程'));
          reveal(favPage, 'td-slide');
        },
        function () {
          setHidden(bar, true);
          setHidden(favPage, true);
          reveal(coursePage, 'td-slide');
        }
      ]
    };
  }

  // save-file · A 详情 → B 收藏 → C 我的收藏·文件 → D 回到详情
  function saveFile(ctx) {
    var root = d('frame');
    root.appendChild(headRow(['学习方法导论', '资料详情']));
    var detail = d('detail');
    var dhead = d('detail-head');
    dhead.appendChild(exGlyph('pdf'));
    var dinfo = d('detail-info');
    dinfo.appendChild(d('detail-title', '期末复习提纲.pdf'));
    dinfo.appendChild(d('detail-meta', '学习方法导论 · DEMO101'));
    dhead.appendChild(dinfo);
    var starEl = star(false, 'star');
    dhead.appendChild(starEl);
    var favedPill = ghost(pill('已收藏', 'star'));
    dhead.appendChild(favedPill);
    detail.appendChild(dhead);
    detail.appendChild(d('detail-desc', '按周整理的复习要点与例题提示。'));
    detail.appendChild(sheet('期末复习提纲', '第一章 学习方法概述', [1, 2, 3], { foot: '示例预览 · 第 1 页' }));
    root.appendChild(detail);
    var favPage = d('col');
    favPage.appendChild(sp('crumb-solo', '头像菜单 › 我的收藏 › 文件'));
    favPage.appendChild(favTabs(1, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']));
    favPage.appendChild(row({ title: '期末复习提纲.pdf', meta: '学习方法导论 · DEMO101', ext: 'pdf', mark: 'fav-row', hot: true }));
    favPage.appendChild(row({ title: '课程大纲.pdf', meta: '学习方法导论 · DEMO101', ext: 'pdf', dim: true }));
    root.appendChild(favPage);
    setHidden(favPage, true);
    return {
      root: root, steps: 4,
      targets: [null, 'star', null, 'fav-row'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () {
          starEl.classList.add('is-filled');
          reveal(favedPill, 'td-pop');
        },
        function () { setHidden(detail, true); reveal(favPage, 'td-slide'); },
        function () {
          setHidden(favPage, true);
          setHidden(detail, false);
          reveal(detail, 'td-slide-back');
          var n = noteLine('点开收藏的资料，回到详情。');
          root.appendChild(n);
          reveal(n);
        }
      ]
    };
  }

  // save-answer · A 两条回答 → B 收藏其中一条 → C 我的收藏·帖子 → D 回到回答位置
  function saveAnswer(ctx) {
    var root = d('frame');
    root.appendChild(headRow(['问答区', '如何安排期末复习？']));
    var answers = d('col');
    var a1 = answer({
      author: '示例同学', mark: 'ans-1',
      lines: ['先按章节整理错题，再按优先级复习。', '考前两周开始过第二遍。'],
      actions: [{ label: '收藏', mark: 'ans-fav' }, { label: '点赞 6' }]
    });
    var a2 = answer({
      author: '另一位同学',
      lines: ['建议组队互相讲题，效率更高。'],
      actions: [{ label: '收藏' }, { label: '点赞 3' }]
    });
    answers.appendChild(a1);
    answers.appendChild(a2);
    root.appendChild(answers);
    var favBtn = a1.querySelector('[data-mark="ans-fav"]');
    var favPage = d('col');
    favPage.appendChild(sp('crumb-solo', '头像菜单 › 我的收藏 › 帖子'));
    favPage.appendChild(favTabs(2, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']));
    favPage.appendChild(row({ title: '如何安排期末复习？', meta: '示例同学 的回答：先按章节整理错题…', ext: 'txt', mark: 'fav-row', hot: true }));
    root.appendChild(favPage);
    setHidden(favPage, true);
    return {
      root: root, steps: 4,
      targets: [null, 'ans-fav', null, 'fav-row'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () {
          favBtn.textContent = '已收藏';
          favBtn.classList.add('is-on');
          a1.classList.add('is-hot');
        },
        function () { setHidden(answers, true); reveal(favPage, 'td-slide'); },
        function () {
          setHidden(favPage, true);
          setHidden(answers, false);
          a1.classList.add('is-hot');
          reveal(answers, 'td-slide-back');
          var n = noteLine('点开收藏，回到回答所在位置。');
          root.appendChild(n);
          reveal(n);
        }
      ]
    };
  }

  // save-retrieve · A 头像 → B 菜单 → C 课程标签 → D 文件标签 → E 帖子标签
  function saveRetrieve(ctx) {
    var root = d('frame');
    var bar = headRow(null, [avatar('avatar')]);
    root.appendChild(bar);
    var favMenu = menu(['通知中心', '我的上传', { label: '我的收藏', mark: 'mi-fav' }, '个人中心'], { activeIdx: 2 });
    bar.appendChild(favMenu);
    setHidden(favMenu, true);
    var favPage = d('col');
    favPage.appendChild(sp('crumb-solo', '头像菜单 › 我的收藏'));
    var tabs = favTabs(0, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']);
    favPage.appendChild(tabs);
    var courseRow = row({ title: '学习方法导论', meta: 'DEMO101', hot: true });
    var fileRow = row({ title: '期末复习提纲.pdf', meta: '学习方法导论 · DEMO101', ext: 'pdf', hot: true });
    var postRow = row({ title: '如何安排期末复习？', meta: '示例同学 的回答摘要', ext: 'txt', hot: true });
    favPage.appendChild(courseRow);
    favPage.appendChild(fileRow);
    favPage.appendChild(postRow);
    setHidden(fileRow, true);
    setHidden(postRow, true);
    root.appendChild(favPage);
    setHidden(favPage, true);
    return {
      root: root, steps: 5,
      targets: [null, 'avatar', 'mi-fav', 'fav-tab-file', 'fav-tab-post'],
      clicks: [false, true, true, true, true],
      apply: [
        function () {},
        function () { reveal(favMenu, 'td-pop'); },
        function () {
          setHidden(favMenu, true);
          reveal(favPage, 'td-slide');
        },
        function () {
          tabs.children[0].classList.remove('is-active');
          tabs.children[1].classList.add('is-active');
          setHidden(courseRow, true);
          reveal(fileRow);
        },
        function () {
          tabs.children[1].classList.remove('is-active');
          tabs.children[2].classList.add('is-active');
          setHidden(fileRow, true);
          reveal(postRow);
          var n = noteLine('课程、资料和问答收藏都在这里。');
          favPage.appendChild(n);
          reveal(n);
        }
      ]
    };
  }

  // share-file · A 上传入口 → B 上传窗（已选文件）→ C 补齐字段 → D 待审核
  function shareFile(ctx) {
    var root = d('frame');
    var head = courseHead('学习方法导论', 'DEMO101');
    head.appendChild(btn('上传资料', { primary: true, small: true, mark: 'btn-upload' }));
    root.appendChild(head);
    var list = d('col');
    list.appendChild(row({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', ext: 'pdf', count: '86', dlBtn: true }));
    root.appendChild(list);
    var rowFile = formRow('文件', '期末复习提纲.pdf', { note: '示例使用已选好的文件' });
    var rowType = formRow('资料类型', '笔记');
    var rowTeacher = formRow('任课教师', '示例老师');
    var rowDesc = formRow('简介', '按周整理的复习要点。', { area: true });
    var dialog = panel('上传资料 · 学习方法导论', [rowFile, rowType, rowTeacher, rowDesc],
      [btn('开始上传', { primary: true, mark: 'btn-upload-submit' })]);
    root.appendChild(dialog);
    setHidden(dialog, true);
    setHidden(rowType, true);
    setHidden(rowTeacher, true);
    setHidden(rowDesc, true);
    var pending = panel('已提交', [
      pill('待审核', 'pending'),
      d('panel-text', '普通用户上传后进入审核队列，通过后对所有人可见。'),
      noteLine('审核进度可在“我的上传”查看。')
    ], [btn('查看我的上传', { small: true })]);
    root.appendChild(pending);
    setHidden(pending, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-upload', null, 'btn-upload-submit'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () { setHidden(list, true); reveal(dialog, 'td-slide'); },
        function () {
          setHidden(rowType, false); setHidden(rowTeacher, false); setHidden(rowDesc, false);
          reveal(rowType); reveal(rowTeacher); reveal(rowDesc);
        },
        function () { setHidden(dialog, true); reveal(pending, 'td-slide'); }
      ]
    };
  }

  // share-text · 核心 · A 上传窗 → B 文字录入 → C 填入内容 → D 待审核
  function shareText(ctx) {
    var root = d('frame');
    var segEl = seg(['上传文件', '文字录入'], 0, ['tab-file', 'tab-text']);
    var rowFile = formRow('文件', null, { placeholder: '选择文件…' });
    var rowTitle = formRow('标题', null, { placeholder: '给这份资料起个标题…' });
    var rowBody = formRow('内容', null, { placeholder: '在此输入文字内容…', area: true });
    var rowType = formRow('资料类型', '笔记');
    var dialog = panel('上传资料 · 学习方法导论', [segEl, rowFile, rowTitle, rowBody, rowType],
      [btn('开始上传', { primary: true, mark: 'btn-text-submit' })]);
    root.appendChild(dialog);
    setHidden(rowTitle, true);
    setHidden(rowBody, true);
    setHidden(rowType, true);
    var pending = panel('已提交', [
      pill('待审核', 'pending'),
      d('panel-text', '文字会保存为 .txt 资料，同样进入审核队列。'),
      noteLine('在“我的上传”查看进度。')
    ]);
    root.appendChild(pending);
    setHidden(pending, true);
    return {
      root: root, steps: 4,
      targets: [null, 'tab-text', null, 'btn-text-submit'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () {
          segEl.children[0].classList.remove('is-active');
          segEl.children[1].classList.add('is-active');
          setHidden(rowFile, true);
          setHidden(rowTitle, false);
          setHidden(rowBody, false);
          reveal(rowTitle);
          reveal(rowBody);
        },
        function () {
          fillInput(rowTitle.querySelector('.tutorial-demo-formrow-input'), '我的复习顺序');
          fillInput(rowBody.querySelector('.tutorial-demo-formrow-input'), '先整理错题，再按优先级过第二遍。');
          setHidden(rowType, false);
          reveal(rowType);
        },
        function () { setHidden(dialog, true); reveal(pending, 'td-slide'); }
      ]
    };
  }

  // share-course · A 新建入口 → B 名称与代码 → C 归属选择 → D 待审核摘要
  function shareCourse(ctx) {
    var root = d('frame');
    var dialog = panel('上传资料', [
      formRow('课程', null, { placeholder: '搜索课程名称或代码…' }),
      d('panel-text', '没有要找的课程？可以申请新建。')
    ], [btn('新建课程', { primary: true, mark: 'btn-newcourse' })]);
    root.appendChild(dialog);
    var rowName = formRow('课程名称', '海洋科学导论');
    var rowCode = formRow('课程代码', 'DEMO202');
    var rowType = formRow('课程类型', '专业课');
    var rowCollege = formRow('学院', '示例学院');
    var rowMajor = formRow('专业', '示例专业');
    var form = panel('新建课程申请', [
      rowName, rowCode, rowType, rowCollege, rowMajor,
      noteLine('随附资料为选填；如果课程已存在，会提示进入已有课程。')
    ], [btn('提交申请', { primary: true, mark: 'btn-course-submit' })]);
    root.appendChild(form);
    setHidden(form, true);
    setHidden(rowType, true);
    setHidden(rowCollege, true);
    setHidden(rowMajor, true);
    var pending = panel('申请已提交', [
      pill('待审核', 'pending'),
      checkRow('海洋科学导论 · DEMO202', true),
      checkRow('归属：示例学院 / 示例专业', true),
      d('panel-text', '管理员审核通过后，课程会出现在目录中。')
    ]);
    root.appendChild(pending);
    setHidden(pending, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-newcourse', null, 'btn-course-submit'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () { setHidden(dialog, true); reveal(form, 'td-slide'); },
        function () {
          setHidden(rowType, false); setHidden(rowCollege, false); setHidden(rowMajor, false);
          reveal(rowType); reveal(rowCollege); reveal(rowMajor);
        },
        function () { setHidden(form, true); reveal(pending, 'td-slide'); }
      ]
    };
  }

  // share-review · A 头像 → B 我的上传·审核中 → C 已发布 → D 通知提示
  function shareReview(ctx) {
    var root = d('frame');
    var bell = sp('bell', '🔔');
    mark('bell', bell);
    ghost(bell);
    var bar = headRow(null, [bell, avatar('avatar')]);
    root.appendChild(bar);
    var favMenu = menu(['通知中心', { label: '我的上传', mark: 'mi-up' }, '我的收藏'], { activeIdx: 1 });
    bar.appendChild(favMenu);
    setHidden(favMenu, true);
    var uploads = d('col');
    uploads.appendChild(sp('crumb-solo', '头像菜单 › 我的上传'));
    var tabs = seg(['已发布', '审核中', '已驳回'], 1, ['mu-tab-pub', 'mu-tab-pend', null]);
    uploads.appendChild(tabs);
    var rowPending = row({ title: '期末复习提纲.pdf', ext: 'pdf', pill: pill('待审核', 'pending'), hot: true });
    var rowPublished = row({ title: '课堂笔记.pdf', ext: 'pdf', pill: pill('已发布', 'success') });
    uploads.appendChild(rowPending);
    uploads.appendChild(rowPublished);
    setHidden(rowPublished, true);
    root.appendChild(uploads);
    setHidden(uploads, true);
    return {
      root: root, steps: 5,
      targets: [null, 'avatar', 'mi-up', 'mu-tab-pub', 'bell'],
      clicks: [false, true, true, true, true],
      apply: [
        function () {},
        function () { reveal(favMenu, 'td-pop'); },
        function () { setHidden(favMenu, true); reveal(uploads, 'td-slide'); },
        function () {
          tabs.children[1].classList.remove('is-active');
          tabs.children[0].classList.add('is-active');
          setHidden(rowPending, true);
          setHidden(rowPublished, false);
          reveal(rowPublished);
          var n1 = noteLine('“已发布”是另一份资料——审核不是自动通过的。');
          uploads.appendChild(n1);
          reveal(n1);
        },
        function () {
          reveal(bell, 'td-pop');
          bell.classList.add('is-hot');
          var n2 = noteLine('审核消息也会发到通知中心。');
          uploads.appendChild(n2);
          reveal(n2);
        }
      ]
    };
  }

  // share-resubmit · A 已驳回 → B 展开原因 → C 修改重交 → D 回到待审核
  function shareResubmit(ctx) {
    var root = d('frame');
    var crumbEl = sp('crumb-solo', '我的上传 › 已驳回');
    root.appendChild(crumbEl);
    var rejected = row({ title: '期末复习提纲.pdf', ext: 'pdf', pill: pill('已驳回', 'danger'), mark: 'row-rej', hot: true });
    root.appendChild(rejected);
    var reason = panel('驳回原因', [
      d('panel-text', '请补充资料说明。'),
      noteLine('原因保持可读，按提示修改即可重新提交。')
    ], [btn('重新上传', { primary: true, small: true, mark: 'btn-resub' })]);
    root.appendChild(reason);
    setHidden(reason, true);
    var descRow = formRow('资料说明', '按周整理的复习要点，覆盖第 1—8 周。', { area: true });
    var form = panel('重新上传 · 期末复习提纲.pdf', [descRow],
      [btn('提交', { primary: true, mark: 'btn-resubmit-submit' })]);
    root.appendChild(form);
    setHidden(form, true);
    return {
      root: root, steps: 4,
      targets: [null, 'row-rej', 'btn-resub', 'btn-resubmit-submit'],
      clicks: [false, true, true, true],
      apply: [
        function () {},
        function () { reveal(reason, 'td-slide'); },
        function () { setHidden(reason, true); reveal(form, 'td-slide'); },
        function () {
          setHidden(form, true);
          crumbEl.textContent = '我的上传 › 审核中';
          rejected.replaceChild(pill('待审核', 'pending'), rejected.querySelector('.tutorial-demo-pill'));
          reveal(rejected);
          var n = noteLine('状态恢复为待审核，不演示自动通过。');
          root.appendChild(n);
          reveal(n);
        }
      ]
    };
  }

  // qa-search · A 问答搜索 → B 输入 → C 结果 → D 问题详情
  function qaSearch(ctx) {
    var root = d('frame');
    root.appendChild(headRow(['问答区']));
    var search = searchbox({ placeholder: '搜索问题、回答…', mark: 'qa-input', btnMark: 'qa-go' });
    root.appendChild(search);
    var results = d('col');
    var r1 = qCard({ title: '如何安排期末复习？', meta: '12 条回答 · 3 天前', mark: 'qa-res', hot: true });
    var r2 = qCard({ title: '期末复习资料哪里找？', meta: '5 条回答 · 1 周前' });
    results.appendChild(r1);
    results.appendChild(r2);
    root.appendChild(results);
    setHidden(results, true);
    var detail = d('col');
    detail.appendChild(qCard({ title: '如何安排期末复习？', meta: '示例同学 提问 · 12 条回答' }));
    detail.appendChild(answer({
      author: '示例同学', hot: true, mark: 'ans-hit',
      lines: ['先按章节整理错题，再按优先级复习。'],
      actions: [{ label: '点赞 6' }]
    }));
    detail.appendChild(answer({
      author: '另一位同学',
      lines: ['组队互相讲题效率更高。'],
      actions: [{ label: '点赞 3' }]
    }));
    root.appendChild(detail);
    setHidden(detail, true);
    return {
      root: root, steps: 4,
      targets: [null, 'qa-input', 'qa-go', 'qa-res'],
      clicks: [false, true, true, true],
      apply: [
        function () {},
        function () { fillInput(search.querySelector('.tutorial-demo-searchbox-input'), '期末复习'); },
        function () { reveal(results); },
        function () { setHidden(results, true); reveal(detail, 'td-slide'); }
      ]
    };
  }

  // qa-tags · A 筛选 → B 一级标签 → C 二级标签收窄 → D 清除入口
  function qaTags(ctx) {
    var root = d('frame');
    var bar = d('chipbar');
    var filterChip = chip('筛选 ⌄', { mark: 'qa-filter' });
    var sortChip = chip('最新提问');
    bar.appendChild(filterChip);
    bar.appendChild(sortChip);
    root.appendChild(bar);
    var list = d('col');
    var q1 = qCard({ title: '如何安排期末复习？', meta: '12 条回答' });
    var q2 = qCard({ title: '怎么选通识课？', meta: '8 条回答' });
    list.appendChild(q1);
    list.appendChild(q2);
    root.appendChild(list);
    var tagPanel = d('tagpanel');
    tagPanel.appendChild(sp('cap-label', '一级标签'));
    var l1 = chip('课程学习', { mark: 'qa-l1' });
    tagPanel.appendChild(l1);
    tagPanel.appendChild(chip('校园生活'));
    tagPanel.appendChild(chip('选课'));
    var subLabel = sp('cap-label', '二级标签');
    tagPanel.appendChild(subLabel);
    var l2 = chip('期末复习', { mark: 'qa-l2' });
    tagPanel.appendChild(l2);
    tagPanel.appendChild(chip('笔记方法'));
    root.appendChild(tagPanel);
    setHidden(tagPanel, true);
    setHidden(subLabel, true);
    setHidden(l2, true);
    var activeChip = chip('课程学习 / 期末复习', { active: true });
    var clearChip = chip('清除筛选', { mark: 'qa-clear' });
    setHidden(activeChip, true);
    setHidden(clearChip, true);
    return {
      root: root, steps: 5,
      targets: [null, 'qa-filter', 'qa-l1', 'qa-l2', 'qa-clear'],
      clicks: [false, true, true, true, false],
      apply: [
        function () {},
        function () {
          filterChip.classList.add('is-active');
          reveal(tagPanel);
        },
        function () {
          l1.classList.add('is-active');
          setHidden(subLabel, false);
          setHidden(l2, false);
          reveal(subLabel);
          reveal(l2);
        },
        function () {
          l2.classList.add('is-active');
          setHidden(tagPanel, true);
          bar.insertBefore(activeChip, sortChip);
          setHidden(activeChip, false);
          reveal(activeChip, 'td-pop');
          bar.insertBefore(clearChip, activeChip);
          // 先占位再显现：「清除筛选」出现时不挤动旁边的排序 chip
          setHidden(clearChip, false);
          ghost(clearChip);
          setHidden(q2, true);
        },
        function () {
          reveal(clearChip, 'td-pop');
          var n = noteLine('已选标签与排序保持可见，可随时清除。');
          root.appendChild(n);
          reveal(n);
        }
      ]
    };
  }

  // qa-ask · A 提问入口 → B 编辑器（标题）→ C 正文与标签 → D 待审核
  function qaAsk(ctx) {
    var root = d('frame');
    var head = d('qahead');
    head.appendChild(d('qahead-title', '问答区'));
    head.appendChild(btn('我要提问', { primary: true, small: true, mark: 'btn-ask' }));
    root.appendChild(head);
    var list = d('col');
    list.appendChild(qCard({ title: '怎么选通识课？', meta: '8 条回答' }));
    list.appendChild(qCard({ title: '图书馆怎么预约？', meta: '4 条回答' }));
    root.appendChild(list);
    var rowTitle = formRow('标题', '期末复习应该如何分配时间？');
    var rowBody = formRow('正文', '我先把错题过了一遍，但时间还是不够用，大家怎么安排？', { area: true });
    var tagsBox = d('tagpanel');
    tagsBox.appendChild(sp('cap-label', '标签'));
    tagsBox.appendChild(chip('课程学习 / 期末复习', { active: true }));
    var editor = panel('发布问题', [rowTitle, rowBody, tagsBox],
      [btn('提交', { primary: true, mark: 'btn-ask-submit' })]);
    root.appendChild(editor);
    setHidden(editor, true);
    setHidden(rowBody, true);
    setHidden(tagsBox, true);
    var pending = panel('已提交', [
      pill('待审核', 'pending'),
      d('panel-text', '普通用户发布的问题会先进入审核，通过后其他人才能看到。')
    ]);
    root.appendChild(pending);
    setHidden(pending, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-ask', null, 'btn-ask-submit'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () { setHidden(list, true); reveal(editor, 'td-slide'); },
        function () {
          setHidden(rowBody, false);
          setHidden(tagsBox, false);
          reveal(rowBody);
          reveal(tagsBox);
        },
        function () { setHidden(editor, true); reveal(pending, 'td-slide'); }
      ]
    };
  }

  // qa-answer · A 写回答入口 → B 编辑器（标题保留）→ C 内容 → D 待审核
  function qaAnswer(ctx) {
    var root = d('frame');
    var detail = d('col');
    detail.appendChild(qCard({ title: '如何安排期末复习？', meta: '示例同学 提问 · 12 条回答' }));
    detail.appendChild(answer({
      author: '另一位同学',
      lines: ['组队互相讲题效率更高。'],
      actions: [{ label: '点赞 3' }]
    }));
    detail.appendChild(btn('写回答', { primary: true, mark: 'btn-answer' }));
    root.appendChild(detail);
    var rowBody = formRow('内容', null, { placeholder: '写下你的做法…', area: true });
    var editor = panel('写回答 · 如何安排期末复习？', [rowBody],
      [btn('提交回答', { primary: true, mark: 'btn-answer-submit' })]);
    root.appendChild(editor);
    setHidden(editor, true);
    var pending = panel('已提交', [
      pill('待审核', 'pending'),
      d('panel-text', '回答进入审核队列，通过后显示在问题下。')
    ]);
    root.appendChild(pending);
    setHidden(pending, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-answer', null, 'btn-answer-submit'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () { setHidden(detail, true); reveal(editor, 'td-slide'); },
        function () {
          fillInput(rowBody.querySelector('.tutorial-demo-formrow-input'),
            '先按章节整理错题，再按优先级复习；适合考前两周开始。');
        },
        function () { setHidden(editor, true); reveal(pending, 'td-slide'); }
      ]
    };
  }

  // qa-accept · A 你的问题与回答 → B 突出采纳按钮 → C 采纳 → D 标记保留
  function qaAccept(ctx) {
    var root = d('frame');
    var q = qCard({
      title: '如何安排期末复习？',
      meta: '你提出的问题 · 2 条回答',
      pill: pill('你提出的问题', 'pending')
    });
    root.appendChild(q);
    var badge = pill('已采纳 · 最佳回答', 'success');
    var a1 = answer({
      author: '示例同学', mark: 'ans-1',
      lines: ['先按章节整理错题，再按优先级复习。'],
      actions: [{ label: '采纳为最佳回答', mark: 'adopt-btn', primary: true }, { label: '点赞 6' }]
    });
    var a2 = answer({
      author: '另一位同学',
      lines: ['组队互相讲题效率更高。'],
      actions: [{ label: '点赞 3' }]
    });
    root.appendChild(a1);
    root.appendChild(a2);
    setHidden(badge, true);
    return {
      root: root, steps: 4,
      targets: [null, 'adopt-btn', 'adopt-btn', null],
      clicks: [false, false, true, false],
      apply: [
        function () {},
        function () {
          a1.classList.add('is-focus');
          var n1 = noteLine('只有提问者本人能看到采纳按钮。');
          root.appendChild(n1);
          reveal(n1);
        },
        function () {
          a1.classList.remove('is-focus');
          a1.classList.add('is-hot');
          var headEl = a1.querySelector('.tutorial-demo-answer-head');
          headEl.appendChild(badge);
          setHidden(badge, false);
          reveal(badge, 'td-pop');
          var adopt = a1.querySelector('[data-mark="adopt-btn"]');
          if (adopt) adopt.parentNode.removeChild(adopt);
          q.replaceChild(pill('已采纳', 'success'), q.querySelector('.tutorial-demo-pill'));
        },
        function () {
          var n2 = noteLine('回答顺序保持不变，只添加采纳标记。');
          root.appendChild(n2);
          reveal(n2);
        }
      ]
    };
  }

  var SCENES = {
    findSearch: findSearch,
    findFilter: findFilter,
    findSameName: findSameName,
    findPreview: findPreview,
    findZip: findZip,
    findDownload: findDownload,
    coursesImport: coursesImport,
    coursesViews: coursesViews,
    coursesOpen: coursesOpen,
    coursesManual: coursesManual,
    coursesTerms: coursesTerms,
    saveCourse: saveCourse,
    saveFile: saveFile,
    saveAnswer: saveAnswer,
    saveRetrieve: saveRetrieve,
    shareFile: shareFile,
    shareText: shareText,
    shareCourse: shareCourse,
    shareReview: shareReview,
    shareResubmit: shareResubmit,
    qaSearch: qaSearch,
    qaTags: qaTags,
    qaAsk: qaAsk,
    qaAnswer: qaAnswer,
    qaAccept: qaAccept
  };

  // ── 目录组卡静态缩略图（纯 SVG，无外部资源） ────────────────
  function thumbSvg(kind) {
    var common = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
    var inner = '';
    if (kind === 'find') {
      inner = '<circle cx="10.5" cy="10.5" r="5.5" ' + common + '/><path d="m15 15 4.5 4.5" ' + common + '/><path d="M8 10.5h5M8 13h3" ' + common + '/>';
    } else if (kind === 'courses') {
      inner = '<rect x="3.5" y="5" width="17" height="15" rx="2" ' + common + '/><path d="M3.5 9.5h17M8 3v4M16 3v4" ' + common + '/><rect x="6.5" y="12" width="4" height="3.5" rx=".8" ' + common + '/><rect x="13.5" y="12" width="4" height="3.5" rx=".8" ' + common + '/>';
    } else if (kind === 'save') {
      inner = '<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z" ' + common + '/><path d="M4 20.5h16" ' + common + '/>';
    } else if (kind === 'share') {
      inner = '<path d="M12 15V4M8 8l4-4 4 4" ' + common + '/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" ' + common + '/>';
    } else if (kind === 'qa') {
      inner = '<path d="M4 5h16v11h-9l-4.5 3.5V16H4z" ' + common + '/><path d="M8.5 9.5h7M8.5 12.5h4" ' + common + '/>';
    } else {
      inner = '<circle cx="12" cy="12" r="8" ' + common + '/>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }

  window.BnuTutorialScenes = {
    has: function (name) { return Object.prototype.hasOwnProperty.call(SCENES, name); },
    build: function (name, ctx) {
      var factory = SCENES[name];
      if (!factory) return null;
      var scene;
      try { scene = factory(ctx || {}); } catch (e) { return null; }
      if (!scene || !scene.root || !(scene.steps > 0)) return null;
      if (!Array.isArray(scene.targets) || scene.targets.length !== scene.steps) return null;
      if (!Array.isArray(scene.apply) || scene.apply.length !== scene.steps) return null;
      var clicks = Array.isArray(scene.clicks) ? scene.clicks : [];
      // go(i) 语义是“推进到第 i 步的绝对状态”。同一实例上顺序调用时只执行
      // 增量（apply[已应用+1..i]），避免“追加类”操作重复执行；新实例从
      // 头执行全部 apply（静态降级视图与守门依赖这一性质）。
      var lastApplied = -1;
      return {
        root: scene.root,
        steps: scene.steps,
        targets: scene.targets,
        clicks: scene.targets.map(function (t, i) { return clicks[i] !== false; }),
        go: function (i) {
          if (i < 0 || i >= scene.steps) return;
          var from = Math.max(lastApplied + 1, 0);
          for (var k = from; k <= i; k++) scene.apply[k]();
          lastApplied = Math.max(lastApplied, i);
        }
      };
    },
    thumb: thumbSvg
  };
})();
