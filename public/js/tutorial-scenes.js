/* BNU Sparks · tutorial-scenes.js —— 动画使用教程：25 个分镜（演示组件库）。
   懒加载模块（feature-loader: tutorial）。只操作教程舞台，不触碰业务 DOM、
   不调用业务函数、不绑定任何业务事件；示例数据全部为固定虚构内容。

   演示界面口径（2026-10-03 二次修订）：「真实界面经过取舍的局部展示」。
   演示 DOM 直接使用站点真实 class（.search-box、.sg-*、.file-table、.fa-*、.fd-*、
   .modal-card、.um-tab、.mf-*、.tt-*、.pc-seg、.nc-*、.notif-drawer、.dm-item、
   .mu-tabs、.pc-item、.review-badge、.qa-*、.qe-*、.preview-overlay、
   .filter-dropdown），由对应业务 CSS 渲染（course/qa/timetable.css 由 tutorial
   特性一并加载）；本文件不重新发明产品外观。tutorial.css 只负责：覆盖层
   fixed 到舞台内 absolute 的覆盖关系、舞台尺寸适配、以及 is-hidden/td-* 与
   is-hot 等教程专属状态类。

   转场口径（2026-10-03 三次修订）：弹层显隐用 setHidden（display 切换会继承
   业务 CSS 自带的 modalIn / notifSlideIn / ttPop 入场动画）；场景内页面导航用
   swapPage（旧页离位淡出叠放 + 新页 td-slide）；同页标签/内容切换用 td-fade；
   自绘菜单用 td-pop；状态变化（星标/勾选/采纳）就地完成不加动画。

   强调口径（2026-10-03 四次修订）：默认无模拟鼠标。targets[i] 语义是
   「第 i 步的焦点对象」——播放器在解说出现时把 is-hot 焦点环放到该对象上
   （一次一个），动作反馈由控件自身承担（td-act 脉动）；场景内部不再自加
   is-hot（结果态的强调交给状态本身）。clicks[i] = 该步是否为按压动作
   （决定是否播 td-act）。

   编排模型：build() 返回 {
     root: 场景根（.tutorial-demo-frame，一次性建好全部对象）
     steps: 步骤总数（含第 0 步“建立场景”）
     targets: 每步指针目标 data-mark 名（null = 该步无指针）
     clicks: 每步指针是否产生点击反馈
     go(i): 就地推进到第 i 步（绝对状态；增量执行见文件尾 build 包装）
   } */
(function () {
  'use strict';

  // ── 基础工具 ──────────────────────────────────────────────
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function mark(name, n) {
    if (n) n.setAttribute('data-mark', name);
    return n;
  }
  function setHidden(n, hidden) {
    if (n) n.classList.toggle('is-hidden', !!hidden);
  }
  // 预留占位但不可见：元素出现前后不改变周围布局
  function ghost(n) {
    if (n) n.classList.add('td-ghost');
    return n;
  }
  // 元素（重新）显现：一次性入场动画，不做整页错峰重入
  function reveal(n, kind) {
    setHidden(n, false);
    n.classList.remove('td-ghost');
    n.classList.remove('td-in');
    n.classList.remove('td-slide');
    void n.offsetWidth;
    n.classList.add(kind || 'td-in');
    return n;
  }
  // 真实输入控件的“填入”：只写入内容并做一次轻高亮（td-typed 只动
  // box-shadow），框体位置、边框、背景全程稳定；无逐字动画、无定时器，
  // 暂停/重播/减少动态效果下行为一致。
  function typedInto(input, text) {
    if (!input) return null;
    input.value = String(text == null ? '' : text);
    input.classList.remove('td-typed');
    void input.offsetWidth;
    input.classList.add('td-typed');
    return input;
  }
  // 场景内页面导航：旧页离位（绝对定位叠放在新页之上）淡出，新页滑入；
  // 短暂重叠（约 150ms）且互不挤压。守门桩没有定时器：直接隐藏旧页。
  function swapPage(oldEl, newEl, kind) {
    if (oldEl && oldEl !== newEl) {
      if (typeof window.setTimeout === 'function') {
        oldEl.classList.add('td-leaving');
        oldEl.classList.add('td-out');
        window.setTimeout(function () {
          oldEl.classList.remove('td-leaving');
          oldEl.classList.remove('td-out');
          oldEl.classList.add('is-hidden');
        }, 240);
      } else {
        setHidden(oldEl, true);
      }
    }
    return reveal(newEl, kind || 'td-slide');
  }

  // ── 图标：与站点同源的内联 SVG（避免依赖懒加载模块的常量） ──
  // path 数据逐字取自 utils.js ICONS / explorer-core.js FD_ICONS / qa.js 局部图标。
  var TICONS = {
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    starFilled: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    fdStar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    fdStarFilled: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#F5A623" stroke="#F5A623" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.5" r="3.5"/><path d="M5 21c1-3.5 4-5 7-5s6 1.5 7 5"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V5"/><path d="M6 11l6-6 6 6"/><path d="M4 20h16"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v11"/><path d="M6 11l6 6 6-6"/><path d="M4 20h16"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="10" x2="14" y2="10"/></svg>',
    doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>',
    thumb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.9L14 10h5a2 2 0 0 1 2 2.5l-1.7 7A2 2 0 0 1 17.3 21H8a1 1 0 0 1-1-1V11a1 1 0 0 1 .6-.9L12 8l1.2-4.3A2 2 0 0 1 15 5.9z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>'
  };
  function svgEl(cls, svg) {
    var s = el('span', cls);
    s.innerHTML = svg;
    return s;
  }

  // 演示内的按钮/输入：真实 class + tabindex=-1（不进 Tab 序）
  function btnEl(cls, label, markName) {
    var b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.className = cls;
    if (label != null) b.textContent = label;
    if (markName) mark(markName, b);
    return b;
  }
  function inputEl(cls, opts) {
    opts = opts || {};
    var i = document.createElement(opts.tag || 'input');
    i.className = cls;
    i.tabIndex = -1;
    if (opts.tag === 'textarea') i.setAttribute('readonly', '');
    else i.readOnly = true;
    if (opts.placeholder) i.placeholder = opts.placeholder;
    if (opts.value) i.value = opts.value;
    if (opts.mark) mark(opts.mark, i);
    return i;
  }
  // 顶部条：站点头部的最小上下文（搜索框 / 头像），不是完整站壳
  function topStrip(children) {
    var t = el('div', 'td-topstrip');
    (children || []).forEach(function (c) { t.appendChild(c); });
    return t;
  }
  // 头像触发器（真实 class：user-avatar-trigger/user-avatar-circle）
  function avatar(markName) {
    var b = btnEl('user-avatar-trigger');
    b.appendChild(el('span', 'user-avatar-circle', '示'));
    if (markName) mark(markName, b);
    return b;
  }
  // 装饰 PDF 纸张（本地绘制，非站点组件；正文为装饰行）
  function sheet(title, heading, lineCount, foot) {
    var s = el('div', 'tutorial-demo-sheet');
    s.appendChild(el('div', 'tutorial-demo-sheet-title', title));
    if (heading) s.appendChild(el('div', 'tutorial-demo-sheet-heading', heading));
    for (var i = 0; i < (lineCount || 4); i++) s.appendChild(el('div', 'tutorial-demo-sheet-line'));
    if (foot) s.appendChild(el('div', 'tutorial-demo-sheet-foot', foot));
    return s;
  }

  // ── 真实组件片段 ──────────────────────────────────────────
  // 站点头部搜索框（index.html .search-box：input + 「→」按钮）
  function searchBox(markName, placeholder) {
    var box = el('div', 'search-box');
    mark('search-box', box);
    var input = inputEl('', { placeholder: placeholder || '搜索课程、资料、课程代码…', mark: markName });
    box.appendChild(input);
    var go = btnEl('', '→', 'search-go');
    go.setAttribute('aria-label', '搜索');
    box.appendChild(go);
    return box;
  }
  // 搜索/问答搜索结果浮层（utils.js searchQuery / qa.js 的 .search-overlay）
  function searchOverlay(q, subtitle, sections) {
    var ov = el('div', 'search-overlay');
    var inner = el('div', 'search-overlay-inner sg-inner');
    var head = el('div', 'sg-header');
    head.appendChild(btnEl('sg-close', '✕')).setAttribute('aria-label', '关闭');
    var tr = el('div', 'sg-title-row');
    tr.appendChild(svgEl('sg-title-icon', TICONS.search));
    tr.appendChild(el('h3', 'sg-title', q));
    head.appendChild(tr);
    head.appendChild(el('p', 'sg-subtitle', subtitle));
    inner.appendChild(head);
    var body = el('div', 'sg-body');
    sections.forEach(function (sec) {
      var s = el('div', 'sg-section');
      var sh = el('div', 'sg-section-header');
      sh.appendChild(svgEl('sg-section-svg', sec.icon || TICONS.book));
      sh.appendChild(el('span', 'sg-section-label', sec.label));
      sh.appendChild(el('span', 'sg-section-badge', String(sec.items.length)));
      s.appendChild(sh);
      var sb = el('div', 'sg-section-body');
      sec.items.forEach(function (it) {
        var item = el('div', 'sg-item' + (it.cls ? ' ' + it.cls : ''));
        if (it.mark) mark(it.mark, item);
        var ib = el('div', 'sg-item-body');
        ib.appendChild(el('span', 'sg-item-name', it.name));
        if (it.snippet) ib.appendChild(el('span', 'sg-item-snippet', it.snippet));
        var meta = el('span', 'sg-item-meta');
        if (it.pill) meta.appendChild(el('span', 'sg-pill ' + it.pill.cls, it.pill.text));
        if (it.hit) meta.appendChild(el('span', 'sg-item-hit', it.hit));
        if (it.meta) meta.appendChild(el('span', 'sg-item-code', it.meta));
        ib.appendChild(meta);
        item.appendChild(ib);
        item.appendChild(el('span', 'sg-item-arrow', '→'));
        sb.appendChild(item);
      });
      s.appendChild(sb);
      body.appendChild(s);
    });
    inner.appendChild(body);
    ov.appendChild(inner);
    return ov;
  }
  // 课程资料页头（explorer-render.js renderFiles 的 .file-area-header）
  function filesHeader(opts) {
    opts = opts || {};
    var h = el('div', 'file-area-header');
    var t = el('h3', 'section-accent', (opts.course || '学习方法导论') + ' — 资料列表');
    h.appendChild(t);
    h.appendChild(el('span', 'fa-count', (opts.count || 2) + ' 个文件'));
    if (opts.filter) {
      var bar = el('span', 'fa-filter-bar');
      bar.appendChild(btnEl('fa-filter-btn', '类型：全部 ▽', opts.typeMark || null));
      bar.appendChild(btnEl('fa-filter-btn', '排序：上传时间 ▽', opts.sortMark || null));
      h.appendChild(bar);
    }
    if (opts.upload || opts.batch) {
      var ub = el('div', 'fa-upload-header-btn');
      if (opts.upload) ub.appendChild(btnEl('fa-upload-btn', '+ 上传资料', opts.uploadMark || null));
      if (opts.batch) {
        var bb = btnEl('fa-upload-btn fa-batch-dl-btn', null, opts.batchMark || null);
        bb.appendChild(svgEl('', TICONS.down));
        bb.appendChild(document.createTextNode(' 批量下载'));
        ub.appendChild(bb);
      }
      h.appendChild(ub);
    }
    return h;
  }
  // 面包屑（explorer 页头）
  function breadcrumb(parts) {
    var b = el('div', 'breadcrumb');
    parts.forEach(function (p, i) {
      if (i) b.appendChild(el('span', 'bc-sep', '›'));
      b.appendChild(el('span', i === parts.length - 1 ? 'bc-current' : 'bc-item', p));
    });
    return b;
  }
  // 文件表（renderFiles 的 .file-table；列做取舍：文件名/类型/下载）
  function fileTable(rows, opts) {
    opts = opts || {};
    var wrap = el('div', 'file-table-wrap');
    if (opts.batchBar) {
      var bar = el('div', 'batch-dl-bar');
      var countEl = el('span', null, '已选 0 个');
      bar.appendChild(countEl);
      var db = btnEl('admin-btn admin-btn-sm', null, opts.dlSelMark || null);
      db.style.marginLeft = 'auto';
      db.appendChild(svgEl('', TICONS.down));
      db.appendChild(document.createTextNode(' 下载选中'));
      bar.appendChild(db);
      wrap.appendChild(bar);
      wrap._batchBar = bar;
      wrap._countEl = countEl;
    }
    var scroll = el('div', 'file-table-scroll');
    var table = el('table', 'file-table' + (opts.multi ? ' multi-select' : ''));
    if (opts.mark) mark(opts.mark, table);
    var thead = el('thead');
    var htr = el('tr');
    function th(cls, child) {
      var n = el('th', cls);
      if (typeof child === 'string') n.textContent = child;
      else if (child) n.appendChild(child);
      htr.appendChild(n);
      return n;
    }
    th('th-name', '文件名');
    th('th-type', '类型');
    var dth = th('th-download', null);
    dth.appendChild(el('span', 'dl-normal', '下载'));
    dth.appendChild(el('span', 'dl-check'));
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(fileRow(r));
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    wrap._tbody = tbody;
    return wrap;
  }
  function fileRow(r) {
    var tr = el('tr');
    if (r.mark) mark(r.mark, tr);
    var nameTd = el('td', 'ft-name');
    var wrapEl = el('span', 'fn-wrap');
    var ext = (r.name.split('.').pop() || '').toUpperCase().slice(0, 4);
    wrapEl.appendChild(el('span', 'ext-badge', ext));
    wrapEl.appendChild(el('span', 'fn-text', r.name));
    nameTd.appendChild(wrapEl);
    tr.appendChild(nameTd);
    tr.appendChild(el('td', 'ft-type', r.type || ''));
    var dlTd = el('td', 'ft-download');
    var normal = el('span', 'dl-normal');
    var dl = el('a', 'dl-link');
    dl.tabIndex = -1;
    dl.appendChild(svgEl('', TICONS.down));
    dl.appendChild(document.createTextNode(' 下载'));
    normal.appendChild(dl);
    if (r.preview !== false) {
      var pv = btnEl('pv-link', '预览', r.previewMark || null);
      normal.appendChild(pv);
    }
    dlTd.appendChild(normal);
    var chkWrap = el('span', 'dl-check');
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'dl-chk';
    chk.tabIndex = -1;
    if (r.chkMark) mark(r.chkMark, chk);
    chkWrap.appendChild(chk);
    dlTd.appendChild(chkWrap);
    tr.appendChild(dlTd);
    return tr;
  }
  // 类型/排序下拉（explorer-file.js 的 .filter-dropdown；演示内锚定在页头下）
  function filterDropdown(title, items, activeIdx) {
    var dd = el('div', 'filter-dropdown');
    dd.appendChild(el('div', 'filter-dd-header', title));
    items.forEach(function (it, i) {
      var n = el('div', 'filter-dd-item' + (i === (activeIdx || 0) ? ' filter-dd-active' : ''), it.label);
      if (it.mark) mark(it.mark, n);
      dd.appendChild(n);
    });
    return dd;
  }
  // 预览浮层（explorer-preview.js 的 .preview-overlay）
  function previewOverlay(fileName, extLabel, bodyChildren, opts) {
    opts = opts || {};
    var ov = el('div', 'preview-overlay');
    ov.appendChild(btnEl('preview-close', '✕')).setAttribute('aria-label', '关闭预览');
    var head = el('div', 'preview-header');
    head.appendChild(el('span', 'pv-badge', extLabel || 'PDF'));
    head.appendChild(el('span', 'pv-title', fileName));
    var dl = btnEl('pv-dl-btn pv-dl-btn-hdr', null, opts.dlMark || null);
    dl.appendChild(svgEl('', TICONS.down));
    dl.appendChild(document.createTextNode(' 下载'));
    head.appendChild(dl);
    ov.appendChild(head);
    var body = el('div', 'preview-body');
    (bodyChildren || []).forEach(function (c) { body.appendChild(c); });
    ov.appendChild(body);
    return ov;
  }
  // 手机 PDF 预览卡（explorer-preview.js 的 .pv-unsupported.pv-mobile-pdf，原文照录）
  function mobilePdfCard(markName) {
    var card = el('div', 'pv-unsupported pv-mobile-pdf');
    card.appendChild(svgEl('pv-unsupported-icon', TICONS.doc));
    card.appendChild(el('div', 'pv-unsupported-text', '手机浏览器暂不支持内嵌 PDF 预览'));
    card.appendChild(el('div', 'pv-unsupported-sub', '请点击下方按钮，由系统查看器打开或下载文件'));
    var b = btnEl('pv-dl-btn', null, markName);
    b.appendChild(svgEl('', TICONS.down));
    b.appendChild(document.createTextNode(' 下载 PDF'));
    card.appendChild(b);
    return card;
  }
  // ZIP 目录树（renderZipTree 的只读目录；行为装饰行）
  function zipTree(items) {
    var tree = el('div', 'tutorial-demo-ziptree');
    items.forEach(function (it) {
      var r = el('div', 'tutorial-demo-ziptree-row' + (it.folder ? ' is-folder' : '') + (it.dim ? ' is-dim' : ''));
      if (it.mark) mark(it.mark, r);
      r.appendChild(el('span', 'tutorial-demo-ziptree-glyph', it.folder ? '▸' : '·'));
      r.appendChild(el('span', 'tutorial-demo-ziptree-name', it.name));
      if (it.size) r.appendChild(el('span', 'tutorial-demo-ziptree-size', it.size));
      tree.appendChild(r);
    });
    return tree;
  }
  // 上传弹窗（index.html:1514 的 #uploadModal 结构）
  // opts.compact：文字录入教学的最小取舍——保留上传弹窗的识别线索（标题、
  // 「上传文件 / 文字录入」标签页、内容、资料标题与提交），略去课程与
  // 长提示行，让卡片完整落进舞台（不出现滚动切割）；完整口径（含必填的
  // 类型/任课教师）由 share-file 演示。
  function uploadModal(opts) {
    opts = opts || {};
    var ov = el('div', 'modal-overlay');
    var card = el('div', 'modal-card modal-card-wide' + (opts.compact ? ' td-compact' : ''));
    card.appendChild(btnEl('modal-close', '✕')).setAttribute('aria-label', '关闭');
    card.appendChild(el('h2', 'modal-title', '上传资料'));
    var tabs = el('div', 'upload-mode-tabs');
    var tabFile = btnEl('um-tab' + (opts.mode !== 'text' ? ' um-tab-active' : ''), null, opts.tabFileMark);
    tabFile.appendChild(svgEl('', TICONS.upload));
    tabFile.appendChild(document.createTextNode(' 上传文件'));
    var tabText = btnEl('um-tab' + (opts.mode === 'text' ? ' um-tab-active' : ''), null, opts.tabTextMark);
    tabText.appendChild(svgEl('', TICONS.doc));
    tabText.appendChild(document.createTextNode(' 文字录入'));
    tabs.appendChild(tabFile);
    tabs.appendChild(tabText);
    card.appendChild(tabs);

    function group(label, control, hint, required) {
      var g = el('div', 'mf-group');
      var l = el('label', null, label + (required ? ' ' : ''));
      if (required) l.appendChild(el('span', 'label-required', '*'));
      g.appendChild(l);
      g.appendChild(control);
      if (hint) g.appendChild(el('div', 'mf-hint', hint));
      return g;
    }
    if (!opts.compact) {
      card.appendChild(group('课程', inputEl('mf-input', { value: '学习方法导论' })));
    }
    var paneFile = el('div', 'upload-mode-pane');
    if (opts.mode === 'text') paneFile.classList.add('is-hidden');
    paneFile.appendChild(group('文件', inputEl('mf-input', { value: '期末复习提纲.pdf' }),
      '支持多选文件 · 单个文件大小不超过 50MB'));
    card.appendChild(paneFile);
    var paneText = el('div', 'upload-mode-pane');
    if (opts.mode !== 'text') paneText.classList.add('is-hidden');
    paneText.appendChild(group('内容', inputEl('mf-input mf-textarea mf-textarea-lg',
      { tag: 'textarea', placeholder: '在此粘贴或输入文字内容…考试题目、笔记、知识点整理等', mark: opts.contentMark }),
      opts.compact ? null : '录入的文字将保存为 .txt 文件，若字数较多建议生成文档后上传'));
    card.appendChild(paneText);
    card.appendChild(group('资料标题', inputEl('mf-input', { placeholder: opts.mode === 'text' ? '留空则自动取内容前20字' : '留空则自动使用文件名', mark: opts.titleMark })));
    var typeSel = null;
    if (!opts.compact) {
      typeSel = document.createElement('select');
      typeSel.className = 'mf-input';
      typeSel.tabIndex = -1;
      ['请选择类型…', '课本', '习题', '真题', '课件', '笔记', '汇总', '其他'].forEach(function (t) {
        var o = document.createElement('option');
        o.textContent = t;
        typeSel.appendChild(o);
      });
      if (opts.typeMark) mark(opts.typeMark, typeSel);
      card.appendChild(group('类型', typeSel, null, true));
      card.appendChild(group('任课教师', inputEl('mf-input', { placeholder: '如：张老师', mark: opts.teacherMark }), null, true));
    }
    card.appendChild(btnEl('mf-btn', '开始上传', opts.submitMark));
    ov.appendChild(card);
    return { overlay: ov, tabs: tabs, paneFile: paneFile, paneText: paneText,
      title: card.querySelector('[data-mark="' + (opts.titleMark || '') + '"]'),
      typeSel: typeSel,
      teacher: card.querySelector('[data-mark="' + (opts.teacherMark || '') + '"]') };
  }
  // 头像抽屉（notifications.js renderDrawerMenu 的 .notif-drawer）
  function drawer(items, markIdx) {
    var ov = el('div', 'notif-drawer-overlay');
    var dr = el('div', 'notif-drawer');
    var menu = el('div', null);
    var head = el('div', 'notif-drawer-header notif-drawer-header--menu');
    head.appendChild(el('span', 'dm-eyebrow', '我的账户'));
    head.appendChild(btnEl('notif-drawer-close', '✕')).setAttribute('aria-label', '关闭');
    menu.appendChild(head);
    var body = el('div', 'drawer-menu-body');
    var user = el('div', 'dm-user');
    user.appendChild(el('div', 'dm-avatar', '示'));
    var info = el('div', 'dm-info');
    info.appendChild(el('div', 'dm-name', '示例同学'));
    info.appendChild(el('div', 'dm-role', '用户'));
    user.appendChild(info);
    body.appendChild(user);
    body.appendChild(el('div', 'dm-divider'));
    items.forEach(function (it, i) {
      var a = document.createElement('a');
      a.className = 'dm-item';
      a.tabIndex = -1;
      if (i === markIdx) mark(it.mark, a);
      var ico = el('span', 'dm-ico dm-ico-' + (it.ico || 'user'));
      ico.innerHTML = TICONS[it.icoName || 'user'] || '';
      a.appendChild(ico);
      a.appendChild(document.createTextNode(it.label));
      body.appendChild(a);
    });
    menu.appendChild(body);
    dr.appendChild(menu);
    ov.appendChild(dr);
    return ov;
  }
  // 标签页行（user.css .mu-tabs/.mu-tab）
  function muTabs(names, activeIdx, marks) {
    var t = el('div', 'mu-tabs');
    names.forEach(function (n, i) {
      var b = btnEl('mu-tab' + (i === (activeIdx || 0) ? ' active' : ''), n, marks && marks[i]);
      t.appendChild(b);
    });
    return t;
  }
  // 收藏/上传列表行（profile.js _pcItem 的 .pc-item）
  function pcItem(opts) {
    var it = el('div', 'pc-item');
    if (opts.mark) mark(opts.mark, it);
    it.appendChild(el('span', 'pc-glyph ' + (opts.glyphCls || 'pc-glyph-star'), opts.glyphText || ''));
    var body = el('div', 'pc-item-body');
    var title = el('div', 'pc-item-title');
    title.appendChild(document.createTextNode(opts.title));
    if (opts.badge) title.appendChild(opts.badge);
    body.appendChild(title);
    if (opts.meta) body.appendChild(el('div', 'pc-item-meta', opts.meta));
    it.appendChild(body);
    if (opts.side) {
      var side = el('div', 'pc-item-side');
      side.appendChild(opts.side);
      it.appendChild(side);
    }
    return it;
  }
  function reviewBadge(kind, text) {
    return el('span', 'review-badge review-badge-' + kind, text);
  }
  // 「我的课程」页骨架（timetable.js ttInitShell）
  function ttShell(opts) {
    opts = opts || {};
    var shell = el('div', 'tt-shell');
    var top = el('div', 'tt-top');
    var title = el('div', 'tt-title', '我的课程');
    title.appendChild(el('small'));
    top.appendChild(title);
    var actions = el('div', 'tt-actions');
    actions.appendChild(btnEl('tt-btn', '管理', opts.manageMark));
    top.appendChild(actions);
    shell.appendChild(top);
    if (opts.viewbar !== false) {
      var vb = el('div', 'tt-viewbar');
      var seg = el('div', 'pc-seg');
      var b1 = btnEl('pc-seg-btn' + (opts.view === 'grid' ? '' : ' active'), null, opts.segListMark);
      b1.appendChild(el('span', 'seg-l', '课程列表'));
      var b2 = btnEl('pc-seg-btn' + (opts.view === 'grid' ? ' active' : ''), null, opts.segWeekMark);
      b2.appendChild(el('span', 'seg-l', '周课表'));
      seg.appendChild(b1);
      seg.appendChild(b2);
      vb.appendChild(seg);
      shell.appendChild(vb);
    }
    shell._seg = shell.querySelector('.pc-seg');
    return shell;
  }
  // 课程列表行（timetable.js ttRenderList 的 .tt-lrow）
  function ttRow(opts) {
    var li = el('li', 'tt-lrow ' + (opts.hue || 'ttp1') + (opts.dim ? ' is-dim' : ''));
    if (opts.mark) mark(opts.mark, li);
    var head = el('div', 'tt-lhead');
    head.appendChild(el('span', 'nm', opts.name));
    if (opts.tag) head.appendChild(el('span', 'tt-tag ' + opts.tag.cls, opts.tag.text));
    if (opts.openBtn) head.appendChild(btnEl('tt-open', '查看资料 ›', opts.openMark));
    li.appendChild(head);
    var meta = el('div', 'tt-lmeta', opts.meta || '');
    if (opts.sched) meta.appendChild(el('span', 'tt-lsched', opts.sched));
    li.appendChild(meta);
    return li;
  }
  // 简化周课表：真实 .tt-card 放进演示网格（课卡样式同源，网格为演示布局）
  function miniWeek(cards) {
    var wrap = el('div', 'tutorial-demo-tweek');
    var head = el('div', 'tutorial-demo-tweek-head');
    ['周一', '周二', '周三', '周四', '周五'].forEach(function (d) { head.appendChild(el('span', null, d)); });
    wrap.appendChild(head);
    var grid = el('div', 'tutorial-demo-tweek-grid');
    cards.forEach(function (c) {
      var card = el('div', 'tt-card ' + (c.hue || 'ttp1') + (c.hot ? ' is-hot' : ''));
      if (c.mark) mark(c.mark, card);
      card.style.gridColumn = String(c.day);
      card.style.gridRow = c.row + ' / span ' + (c.span || 1);
      card.appendChild(el('div', 'tt-card-name', c.name));
      var meta = el('div', 'tt-card-meta');
      if (c.room) meta.appendChild(el('span', 'r', c.room));
      if (c.teacher) meta.appendChild(el('span', 't', c.teacher));
      card.appendChild(meta);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    return wrap;
  }
  // 确认导入弹窗（timetable.js ttRenderConfirmModal 的 .tt-modal.tt-tut）
  function ttConfirmModal(rows, opts) {
    opts = opts || {};
    var ov = el('div', 'tt-overlay');
    var m = el('div', 'tt-modal tt-tut');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', '确认导入课表');
    var head = el('header');
    head.appendChild(el('h3', null, '确认导入'));
    head.appendChild(btnEl('tt-btn is-ghost', '✕')).setAttribute('aria-label', '关闭');
    m.appendChild(head);
    var body = el('div', 'tt-mbody');
    var sum = el('div', 'tt-msummary');
    sum.appendChild(el('span', null, '已识别 '));
    var b = el('b', null, String(rows.length));
    sum.appendChild(b);
    sum.appendChild(el('span', null, ' 门课程'));
    body.appendChild(sum);
    body.appendChild(el('div', 'tt-privacy-note',
      '本地解析，课表默认仅自己可见：教务导出文件仅在你的浏览器里解析；只有解析出的课表数据会同步到你的账号。'));
    var list = el('div', 'tt-mlist');
    rows.forEach(function (r) {
      var row = el('div', 'tt-mrow');
      row.appendChild(el('span', 'dot'));
      row.appendChild(el('span', 'nm', r.name));
      row.appendChild(el('span', 'tm', r.time));
      list.appendChild(row);
    });
    body.appendChild(list);
    m.appendChild(body);
    var foot = el('footer');
    foot.appendChild(btnEl('tt-btn', '取消'));
    foot.appendChild(btnEl('tt-btn primary', '导入课表（' + rows.length + ' 门）', opts.confirmMark));
    m.appendChild(foot);
    ov.appendChild(m);
    return ov;
  }
  // 手动添加课程弹窗（timetable.js ttRenderCourseModal 的 .tt-modal.tt-edit）
  function ttEditModal(opts) {
    var ov = el('div', 'tt-overlay');
    var m = el('div', 'tt-modal tt-edit');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', '新增课程');
    var head = el('header');
    head.appendChild(el('h3', null, '新增课程'));
    head.appendChild(btnEl('tt-btn is-ghost', '✕')).setAttribute('aria-label', '关闭');
    m.appendChild(head);
    var body = el('div', 'tt-mbody');
    function fld(label, control, hint) {
      var f = el('div', 'tt-fld');
      var l = el('span', null, label);
      f.appendChild(l);
      f.appendChild(control);
      if (hint) f.appendChild(el('div', 'tt-fld-hint', hint));
      return f;
    }
    body.appendChild(fld('课程名称 *', inputEl('', { placeholder: '如：书法入门', mark: opts.nameMark })));
    body.appendChild(fld('上课时间段', el('span', 'tt-fld-ph', '留空')));
    body.appendChild(el('p', 'tt-fld-hint', '自学 / 补修课程可不填上课时间：只出现在课程列表，不出现在周课表。'));
    m.appendChild(body);
    var foot = el('footer');
    foot.appendChild(btnEl('tt-btn', '取消'));
    foot.appendChild(btnEl('tt-btn primary', '保存', opts.saveMark));
    m.appendChild(foot);
    ov.appendChild(m);
    return ov;
  }
  // 课表槽位弹层（timetable.js ttShowSlotPop 的 .tt-slot-pop）
  function slotPop(opts) {
    var pop = el('div', 'tt-slot-pop');
    var head = el('div', 'tt-slot-head');
    head.appendChild(el('span', null, '切换课表'));
    head.appendChild(el('span', 'tt-slot-count', '1 / 3'));
    pop.appendChild(head);
    var rowOld = el('div', 'tt-slot-row is-active');
    mark(opts.oldMark, rowOld);
    var mainOld = el('div', 'tt-slot-main');
    mainOld.appendChild(el('div', 'tt-slot-name', '上学期'));
    mainOld.appendChild(el('i', 'tt-slot-cur', '当前'));
    mainOld.appendChild(el('div', 'tt-slot-sub', '3 门课程'));
    rowOld.appendChild(mainOld);
    pop.appendChild(rowOld);
    var foot = el('div', 'tt-slot-foot');
    foot.appendChild(btnEl('tt-btn is-ghost', '＋ 导入为新课表', opts.newMark));
    pop.appendChild(foot);
    pop.appendChild(el('div', 'tt-slot-hint', '最多存 3 份，先删除不用的学期再导入'));
    return pop;
  }
  // 新建课程页（newcourse.js 的 .nc-card）
  function newCourseCard(opts) {
    var card = el('div', 'nc-card');
    var head = el('div', 'nc-card-head');
    head.appendChild(el('div', 'nc-card-title', '新建课程'));
    head.appendChild(el('div', 'nc-card-sub', '填写开课信息，提交后由管理员审核创建课程文件夹'));
    card.appendChild(head);
    var seg = el('div', 'nc-seg');
    seg.appendChild(btnEl('nc-seg-btn active', '通识课'));
    seg.appendChild(btnEl('nc-seg-btn', '专业课'));
    card.appendChild(seg);
    var step = el('div', 'nc-step');
    step.appendChild(el('span', 'nc-step-no', '01'));
    step.appendChild(el('span', 'nc-step-title', '课程信息'));
    card.appendChild(step);
    function group(label, control, hint) {
      var g = el('div', 'mf-group');
      g.appendChild(el('label', null, label));
      g.appendChild(control);
      if (hint) g.appendChild(el('div', 'mf-hint', hint));
      return g;
    }
    var sel = document.createElement('select');
    sel.className = 'mf-input';
    sel.tabIndex = -1;
    ['请选择课程类型…', '通识核心', '艺术与体育', '国际视野'].forEach(function (t) {
      var o = document.createElement('option');
      o.textContent = t;
      sel.appendChild(o);
    });
    if (opts.typeMark) mark(opts.typeMark, sel);
    card.appendChild(group('课程类型', sel));
    card.appendChild(group('课程名称', inputEl('mf-input', { placeholder: '如：学术英语写作', mark: opts.nameMark })));
    card.appendChild(group('课程代码', inputEl('mf-input', { placeholder: '如：GEN02201', mark: opts.codeMark }),
      '请确保课程代码无误，可在教务管理网站查询'));
    card.appendChild(btnEl('nc-submit', '提交新建课程申请', opts.submitMark));
    return { card: card, sel: sel };
  }
  // 问答工具栏（qa.js _qaFilterBarHtml 的 .qa-toolbar-row）
  function qaToolbar(opts) {
    opts = opts || {};
    var row = el('div', 'qa-toolbar-row');
    var title = el('span', 'qa-toolbar-title', '全部问题');
    title.appendChild(el('span', 'qa-toolbar-total', ' · ' + (opts.total || 12)));
    row.appendChild(title);
    var actions = el('div', 'qa-toolbar-actions');
    var sort = el('div', 'qa-sort-group');
    sort.appendChild(btnEl('qa-sort-btn', '默认排序'));
    actions.appendChild(sort);
    var fb = btnEl('qa-filter-btn', null, opts.filterMark);
    fb.setAttribute('aria-expanded', opts.expanded ? 'true' : 'false');
    fb.appendChild(svgEl('', TICONS.filter));
    fb.appendChild(el('span', 'qa-filter-btn-label', opts.filterLabel || '筛选'));
    actions.appendChild(fb);
    row.appendChild(actions);
    return row;
  }
  // 问答筛选面板（.qa-filter-panel）
  function qaFilterPanel(opts) {
    var p = el('div', 'qa-filter-panel' + (opts.collapsed ? ' qa-filter-collapsed' : ''));
    var inner = el('div', 'qa-filter-panel-inner');
    function rowOf(label, pills) {
      var r = el('div', 'qa-filter-row');
      r.appendChild(el('span', 'qa-filter-label', label));
      var box = el('div', 'qa-pills ' + (pills.l2 ? 'qa-pills-l2' : 'qa-pills-l1'));
      pills.items.forEach(function (it) {
        var b = btnEl('qa-pill ' + (pills.l2 ? 'qa-pill-l2' : 'qa-pill-l1') + (it.on ? ' on' : ''), it.label, it.mark);
        box.appendChild(b);
      });
      r.appendChild(box);
      return r;
    }
    inner.appendChild(rowOf('分类', { items: [{ label: '全部', on: true }, { label: '课程学习', mark: opts.l1Mark }, { label: '校园生活' }] }));
    inner.appendChild(rowOf('话题', { l2: true, items: [{ label: '全部', on: true }, { label: '期末复习', mark: opts.l2Mark }, { label: '笔记方法' }] }));
    p.appendChild(inner);
    return p;
  }
  // 问题列表行（qa.js _qaItemHtml 的 .qa-item）
  function qaItem(opts) {
    var it = el('div', 'qa-item');
    if (opts.mark) mark(opts.mark, it);
    var stats = el('div', 'qa-item-stats');
    var count = el('span', 'qa-item-count');
    count.appendChild(el('b', null, String(opts.answers)));
    count.appendChild(el('i', null, ' 回答'));
    stats.appendChild(count);
    it.appendChild(stats);
    var main = el('div', 'qa-item-main');
    var a = document.createElement('a');
    a.className = 'qa-item-title';
    a.tabIndex = -1;
    a.textContent = opts.title;
    main.appendChild(a);
    if (opts.preview) main.appendChild(el('div', 'qa-item-preview', opts.preview));
    var meta = el('div', 'qa-item-meta');
    var tags = el('span', 'qa-item-tags');
    (opts.tags || []).forEach(function (t) { tags.appendChild(el('span', 'qa-tag', t)); });
    meta.appendChild(tags);
    var by = el('span', 'qa-item-byline');
    by.appendChild(el('span', 'qa-item-author', opts.author || '示例同学'));
    by.appendChild(el('span', 'qa-item-date', opts.date || '3 天前'));
    meta.appendChild(by);
    main.appendChild(meta);
    it.appendChild(main);
    return it;
  }
  // 问题详情骨架（qa.js 渲染详情的 .qa-detail）
  function qaDetail(opts) {
    var d = el('div', 'qa-detail');
    var thread = el('div', 'qa-thread');
    var q = el('article', 'qa-q-section');
    var qbody = el('div', 'qa-article-body');
    qbody.appendChild(el('h1', 'qa-q-title', opts.title));
    var meta = el('div', 'qa-detail-meta');
    var tags = el('span', 'qa-detail-tags');
    (opts.tags || []).forEach(function (t) { tags.appendChild(el('span', 'qa-tag', t)); });
    meta.appendChild(tags);
    qbody.appendChild(meta);
    var rich = el('div', 'qa-rich', opts.body || '期末复习应该怎么分配时间？按章节还是按题型？');
    qbody.appendChild(rich);
    q.appendChild(qbody);
    if (opts.owner) {
      var qActs = el('div', 'qa-q-actions');
      qActs.appendChild(btnEl('qa-owner-btn', '编辑'));
      q.appendChild(qActs);
    }
    thread.appendChild(q);
    var head = el('div', 'qa-answers-head');
    head.appendChild(el('h2', 'qa-answers-title', (opts.answers || 0) + ' 个回答'));
    if (opts.writeMark) head.appendChild(btnEl('qa-write-btn', '写回答', opts.writeMark));
    thread.appendChild(head);
    var box = el('div', 'qa-answers');
    thread.appendChild(box);
    d.appendChild(thread);
    d._answers = box;
    return d;
  }
  // 回答卡（.qa-answer）
  function qaAnswerCard(opts) {
    var a = el('article', 'qa-answer' + (opts.accepted ? ' qa-answer--accepted' : ''));
    if (opts.mark) mark(opts.mark, a);
    var body = el('div', 'qa-article-body');
    var rowEl = el('div', 'qa-answer-author-row');
    rowEl.appendChild(el('span', 'qa-avatar qa-avatar--answer', (opts.author || '示').charAt(0)));
    rowEl.appendChild(el('span', 'qa-answer-author', opts.author || '示例同学'));
    rowEl.appendChild(el('span', 'qa-answer-date', opts.date || '3 天前'));
    if (opts.accepted) rowEl.appendChild(qaAcceptedFlag());
    body.appendChild(rowEl);
    body.appendChild(el('div', 'qa-rich', opts.text));
    var acts = el('div', 'qa-answer-actions');
    if (opts.like) {
      var like = btnEl('qa-like-btn');
      like.appendChild(svgEl('', TICONS.thumb));
      like.appendChild(el('span', null, '赞'));
      like.appendChild(el('b', 'qa-count', String(opts.like)));
      acts.appendChild(like);
    }
    if (opts.favMark || opts.fav) {
      var fav = btnEl('qa-fav-btn', null, opts.favMark);
      fav.appendChild(svgEl('', TICONS.star));
      fav.appendChild(el('span', null, opts.favText || '收藏'));
      fav.appendChild(el('b', 'qa-count', String(opts.favCount != null ? opts.favCount : 0)));
      acts.appendChild(fav);
    }
    if (opts.acceptMark) acts.appendChild(btnEl('qa-accept-btn', opts.acceptText || '采纳为最佳回答', opts.acceptMark));
    if (acts.childNodes.length) body.appendChild(acts);
    a.appendChild(body);
    a._favBtn = acts.querySelector('.qa-fav-btn');
    a._acceptBtn = acts.querySelector('.qa-accept-btn');
    a._authorRow = rowEl;
    return a;
  }
  function qaAcceptedFlag() {
    var f = el('span', 'qa-accepted-flag');
    f.appendChild(svgEl('', TICONS.check));
    f.appendChild(document.createTextNode(' 已采纳'));
    return f;
  }
  // 提问/回答表单（qa-compose.js 的 .qa-compose-card + qa-editor.js 的 .qa-editor-wrap）
  function qaCompose(opts) {
    var page = el('div', 'qa-compose-page');
    var card = el('div', 'qa-compose-card');
    if (opts.context) {
      var ctx = el('div', 'qc-answer-context');
      ctx.appendChild(el('span', 'qc-answer-context-label', '回答此问题'));
      ctx.appendChild(el('div', 'qc-answer-qtitle', opts.context.title));
      ctx.appendChild(el('div', 'qc-answer-qdesc', opts.context.desc || ''));
      card.appendChild(ctx);
    }
    if (!opts.answerMode) {
      var g = el('div', 'mf-group');
      var l = el('label', null, '标题 ');
      l.appendChild(el('span', 'qc-hint', '一句话概括问题，最长 100 字'));
      g.appendChild(l);
      g.appendChild(inputEl('mf-input', { placeholder: '例如：新生报到需要准备哪些材料？', mark: opts.titleMark }));
      card.appendChild(g);
      var tagSec = el('div', 'qc-tag-section');
      var blk1 = el('div', 'qc-tag-block');
      blk1.appendChild(el('div', 'qc-tag-label', '一级标签 '));
      var l1row = el('div', 'qa-compose-l1');
      l1row.appendChild(btnEl('qa-l1-chip', '课程学习', opts.l1Mark));
      l1row.appendChild(btnEl('qa-l1-chip', '校园生活'));
      blk1.appendChild(l1row);
      tagSec.appendChild(blk1);
      var blk2 = el('div', 'qc-tag-block');
      blk2.appendChild(el('div', 'qc-tag-label', '二级标签 '));
      var l2row = el('div', 'qa-compose-l2');
      l2row.appendChild(qaThemeCard('期末复习', opts.l2Mark));
      l2row.appendChild(qaThemeCard('笔记方法'));
      blk2.appendChild(l2row);
      tagSec.appendChild(blk2);
      var summary = el('div', 'qc-tag-summary', '已选：课程学习 · 期末复习');
      if (opts.summaryHidden) summary.classList.add('td-ghost');
      tagSec.appendChild(summary);
      card.appendChild(tagSec);
    }
    var gBody = el('div', 'mf-group');
    var lb = el('label', null, opts.answerMode ? '回答正文 ' : '正文 ');
    lb.appendChild(el('span', 'qc-hint', opts.answerMode ? '富文本，最长 2 万字' : '富文本，最长 1000 字'));
    gBody.appendChild(lb);
    var editor = el('div', 'qa-editor-wrap');
    editor.setAttribute('data-max', opts.answerMode ? '20000' : '1000');
    var tb = el('div', 'qa-editor-toolbar');
    ['¶', 'H2', 'H3', 'B', 'I', 'U'].forEach(function (t) {
      tb.appendChild(btnEl('qe-btn' + (t === 'B' ? ' qe-bold' : t === 'I' ? ' qe-italic' : t === 'U' ? ' qe-underline' : ''), t));
    });
    editor.appendChild(tb);
    var content = el('div', 'qa-editor-content');
    content.setAttribute('contenteditable', 'false');
    content.setAttribute('data-placeholder', opts.answerMode ? '回答正文…（支持加粗、列表、小标题、插图）' : '正文内容…（支持加粗、列表、小标题、插图）');
    if (opts.contentMark) mark(opts.contentMark, content);
    editor.appendChild(content);
    var cnt = el('div', 'qa-editor-count');
    cnt.appendChild(el('span', 'qa-editor-count-num', '0'));
    cnt.appendChild(document.createTextNode(' / ' + (opts.answerMode ? '20000' : '1000')));
    editor.appendChild(cnt);
    gBody.appendChild(editor);
    card.appendChild(gBody);
    page.appendChild(card);
    var acts = el('div', 'qc-actions');
    acts.appendChild(btnEl('admin-btn admin-btn-secondary', '取消'));
    acts.appendChild(btnEl('qa-gate-btn qc-submit', '提交审核', opts.submitMark));
    page.appendChild(acts);
    page._content = content;
    page._count = cnt.querySelector('.qa-editor-count-num');
    return page;
  }
  function qaThemeCard(name, markName) {
    var c = btnEl('qa-theme-card');
    if (markName) mark(markName, c);
    c.appendChild(el('span', 'qa-theme-name', name));
    c.appendChild(el('span', 'qa-theme-desc', '选中才显示'));
    return c;
  }
  // 资料详情（explorer-file.js _renderFileDetail 的 .fd-*）
  function fdDetail(opts) {
    opts = opts || {};
    var box = el('div', 'fd-container');
    var layout = el('div', 'fd-layout');
    var info = el('div', 'fd-info-area');
    info.appendChild(el('h1', 'fd-title', opts.name));
    var m1 = el('div', 'fd-meta1');
    m1.appendChild(el('span', 'fd-meta-item', '类型 笔记'));
    m1.appendChild(el('span', 'fd-meta-sep', '|'));
    m1.appendChild(el('span', 'fd-meta-item', '2.1 MB'));
    m1.appendChild(el('span', 'fd-meta-sep', '|'));
    m1.appendChild(el('span', 'fd-meta-item', '上传 示例同学'));
    info.appendChild(m1);
    layout.appendChild(info);
    var actions = el('div', 'fd-actions');
    var inner = el('div', 'fd-actions-inner');
    var dl = btnEl('fd-btn fd-btn-primary');
    dl.appendChild(svgEl('', TICONS.down));
    dl.appendChild(document.createTextNode(' 下载'));
    inner.appendChild(dl);
    var fav = btnEl('fd-btn fd-btn-secondary fd-btn-fav', null, opts.favMark);
    fav.appendChild(svgEl('', TICONS.fdStar));
    fav.appendChild(el('span', null, '收藏'));
    inner.appendChild(fav);
    inner.appendChild(btnEl('fd-btn fd-btn-secondary fd-btn-report', '举报'));
    actions.appendChild(inner);
    layout.appendChild(actions);
    box.appendChild(layout);
    if (opts.preview !== false) {
      var pv = el('div', 'fd-preview-area');
      var phead = el('div', 'fd-preview-header');
      phead.appendChild(el('span', 'pv-badge', 'PDF'));
      phead.appendChild(document.createTextNode(' 文件预览'));
      phead.appendChild(el('span', 'pv-hint', '预览最多显示前三页'));
      pv.appendChild(phead);
      var pbody = el('div', 'fd-preview-body');
      pbody.appendChild(sheet('期末复习提纲', '第一章 学习方法概述', 4, '示例预览 · 第 1 页'));
      pv.appendChild(pbody);
      box.appendChild(pv);
    }
    box._favBtn = box.querySelector('[data-mark="' + (opts.favMark || '') + '"]');
    return box;
  }
  // 课程目录列表（explorer-render.js listHtml 的 .folder-list）
  function folderList(rows) {
    var list = el('div', 'folder-list');
    rows.forEach(function (r) {
      var item = el('div', 'folder-list-item' + (r.dim ? ' is-dim' : ''));
      if (r.mark) mark(r.mark, item);
      item.appendChild(el('span', 'fli-icon', '·'));
      var info = el('div', 'fli-info');
      info.appendChild(el('div', 'fli-name', r.name));
      info.appendChild(el('div', 'fli-meta', '课程代码 ' + r.code));
      item.appendChild(info);
      item.appendChild(el('span', 'fli-badge has-data', r.files + ' 个文件'));
      var starEl = el('span', 'fli-fav-star' + (r.favorited ? ' favorited' : ''));
      starEl.innerHTML = r.favorited ? TICONS.fdStarFilled : TICONS.fdStar;
      if (r.starMark) mark(r.starMark, starEl);
      item.appendChild(starEl);
      list.appendChild(item);
    });
    return list;
  }

  // ═══ 分镜工厂 ═════════════════════════════════════════════

  // find-search · 建立搜索框 → 输入 → 按「→」提交 → 分类结果（单屏，结果浮层）
  // 提交是真实动作（回车或「→」按钮），不是输入后自动出结果；
  // 每组只保留一条代表结果，突出「课程 / 资料」两个分组。
  function findSearch() {
    var root = el('div', 'tutorial-demo-frame');
    var strip = topStrip([searchBox('search-input')]);
    root.appendChild(strip);
    // 页面其余部分弱化为装饰，突出搜索框本体
    var deco = el('div', 'td-deco-rows');
    for (var i = 0; i < 3; i++) deco.appendChild(el('div', 'td-deco-row'));
    root.appendChild(deco);
    var overlay = searchOverlay('学习方法', '搜索结果', [
      { label: '课程', items: [
        { name: '学习方法导论', pill: { cls: 'sg-pill-major', text: '专业' }, meta: 'DEMO101', mark: 'res-course' }
      ] },
      { label: '资料', items: [
        { name: '期末复习提纲.pdf', meta: '学习方法导论' }
      ] }
    ]);
    root.appendChild(overlay);
    setHidden(overlay, true);
    var input = strip.querySelector('[data-mark="search-input"]');
    var sbox = strip.querySelector('[data-mark="search-box"]');
    return {
      root: root, steps: 4,
      targets: [null, 'search-input', 'search-go', null],
      clicks: [false, false, true, false],
      apply: [
        function () {},
        function () {
          sbox.classList.add('td-focus');
          typedInto(input, '学习方法');
        },
        function () { setHidden(overlay, false); },
        function () {}
      ]
    };
  }

  // find-filter · 文件表 → 类型下拉 → 选试卷 → 排序下拉 → 收藏量（单屏）
  function findFilter() {
    var root = el('div', 'tutorial-demo-frame');
    root.appendChild(filesHeader({
      count: 4, filter: true, typeMark: 'chip-type', sortMark: 'chip-sort'
    }));
    var paper1 = { name: '2022 期末试卷.pdf', type: '试卷' };
    var paper2 = { name: '2023 期末试卷.pdf', type: '试卷' };
    var note1 = { name: '课堂笔记.pdf', type: '笔记' };
    var hand1 = { name: '复习讲义.pdf', type: '讲义' };
    var tableWrap = fileTable([paper1, paper2, note1, hand1]);
    root.appendChild(tableWrap);
    var tbody = tableWrap._tbody;
    var header = root.querySelector('.file-area-header');
    header.style.position = 'relative';
    var typeMenu = filterDropdown('类型：', [
      { label: '全部' }, { label: '笔记', mark: 'opt-note' }, { label: '试卷', mark: 'opt-paper' }, { label: '课件' }
    ], 0);
    typeMenu.style.left = '0';
    var sortMenu = filterDropdown('排序：', [
      { label: '上传时间' }, { label: '下载量' }, { label: '收藏量', mark: 'opt-fav' }
    ], 0);
    sortMenu.style.right = '0';
    header.appendChild(typeMenu);
    header.appendChild(sortMenu);
    setHidden(typeMenu, true);
    setHidden(sortMenu, true);
    var chipType = root.querySelector('[data-mark="chip-type"]');
    var chipSort = root.querySelector('[data-mark="chip-sort"]');
    return {
      root: root, steps: 5,
      targets: [null, 'chip-type', 'opt-paper', 'chip-sort', 'opt-fav'],
      clicks: [false, true, true, true, true],
      apply: [
        function () {},
        function () {
          // 锚定到「类型」chip 正下方（构建时场景未挂载拿不到 offsetLeft，
          // 打开下拉这一步场景已在文档里）
          if (chipType.offsetLeft) typeMenu.style.left = chipType.offsetLeft + 'px';
          reveal(typeMenu, 'td-pop');
        },
        function () {
          setHidden(typeMenu, true);
          chipType.textContent = '类型：试卷 ▽';
          setHidden(tbody.children[2], true);
          setHidden(tbody.children[3], true);
          var c = root.querySelector('.fa-count');
          if (c) c.textContent = '2 个文件';
        },
        function () {
          if (chipSort.offsetLeft) { sortMenu.style.left = chipSort.offsetLeft + 'px'; sortMenu.style.right = 'auto'; }
          reveal(sortMenu, 'td-pop');
        },
        function () {
          setHidden(sortMenu, true);
          chipSort.textContent = '排序：收藏量 ▽';
          // 收藏量排序：2023（28）提到 2022（41）之前演示原位对调
          tbody.insertBefore(tbody.children[1], tbody.children[0]);
        }
      ]
    };
  }

  // find-same-name · 课程页 + 底部同名区块 → 突出 → 切换（真实整页跳转）→ 归属
  function findSameName() {
    var root = el('div', 'tutorial-demo-frame');
    var bc = breadcrumb(['全部课程', '专业课', '学习方法导论（DEMO101）']);
    root.appendChild(bc);
    root.appendChild(filesHeader({ count: 2 }));
    var tableWrap = fileTable([
      { name: '期末复习提纲.pdf', type: '提纲' },
      { name: '课程大纲.pdf', type: '大纲' }
    ]);
    root.appendChild(tableWrap);
    var tbody = tableWrap._tbody;
    var bottom = el('div', 'file-area-side-bottom');
    var ftitle = el('div', 'fasb-title');
    ftitle.appendChild(svgEl('', TICONS.book));
    ftitle.appendChild(document.createTextNode(' 同名课程（相同名称的不同课程代码）'));
    bottom.appendChild(ftitle);
    var flist = el('div', 'fasb-list');
    var cur = el('span', 'fasb-item is-current');
    cur.appendChild(el('span', 'fasb-code', 'DEMO101'));
    var alt = el('span', 'fasb-item');
    mark('alt-course', alt);
    alt.appendChild(el('span', 'fasb-code', 'DEMO201'));
    alt.appendChild(el('span', 'fasb-programs', '（示例学院）'));
    flist.appendChild(cur);
    flist.appendChild(document.createTextNode(' · '));
    flist.appendChild(alt);
    bottom.appendChild(flist);
    root.appendChild(bottom);
    var bcCurrent = bc.querySelector('.bc-current');
    mark('bc-cur', bcCurrent);
    return {
      root: root, steps: 4,
      targets: [null, 'alt-course', null, 'bc-cur'],
      clicks: [false, true, true, false],
      apply: [
        function () {},
        function () {},
        function () {
          // 真实行为是整页跳转：课程名锚点不变，代码与资料换成 DEMO201，
          // 页面回到顶部（面包屑是连续锚点）；演示页同步回顶
          bcCurrent.textContent = '学习方法导论（DEMO201）';
          tbody.textContent = '';
          tbody.appendChild(fileRow({ name: '海洋科学导论复习要点.pdf', type: '笔记' }));
          tbody.appendChild(fileRow({ name: '课程大纲.pdf', type: '大纲' }));
          reveal(tableWrap, 'td-fade');
          cur.classList.remove('is-current');
          alt.classList.add('is-current');
          if (root.scrollTop) root.scrollTop = 0;
        },
        function () {}
      ]
    };
  }

  // find-preview · 桌面：行内预览 → 浮层第 1 页 → 滚动第 2 页 → 头部下载
  function findPreview(ctx) {
    var root = el('div', 'tutorial-demo-frame');
    root.appendChild(filesHeader({ count: 2 }));
    var tableWrap = fileTable([
      { name: '期末复习提纲.pdf', type: '提纲', previewMark: 'btn-preview' },
      { name: '平时作业参考.pdf', type: '习题', previewMark: null }
    ]);
    root.appendChild(tableWrap);
    var page1 = sheet('期末复习提纲', '第一章 学习方法概述', 5, '示例预览 · 第 1 页');
    var page2 = sheet('期末复习提纲', '三、常见题型与答题思路', 5, '示例预览 · 第 2 页');
    var pages = el('div', 'td-preview-pages');
    pages.appendChild(page1);
    pages.appendChild(page2);
    var overlay = previewOverlay('期末复习提纲.pdf', 'PDF', [pages], { dlMark: 'btn-dl' });
    root.appendChild(overlay);
    setHidden(overlay, true);
    if (ctx.mobile) {
      var mCard = mobilePdfCard('btn-dlpdf');
      var mOverlay = previewOverlay('期末复习提纲.pdf', 'PDF', [mCard], {});
      root.appendChild(mOverlay);
      setHidden(mOverlay, true);
      return {
        root: root, steps: 4,
        targets: [null, 'btn-preview', 'btn-dlpdf', null],
        clicks: [false, true, true, false],
        apply: [
          function () {},
          function () { setHidden(mOverlay, false); },
          function () {
            var b = mOverlay.querySelector('[data-mark="btn-dlpdf"]');
            b.textContent = '✓ 已开始下载';
            b.classList.add('pv-dl-done');
          },
          function () {}
        ]
      };
    }
    return {
      root: root, steps: 4,
      targets: [null, 'btn-preview', null, 'btn-dl'],
      clicks: [false, true, false, false],
      apply: [
        function () {},
        function () { setHidden(overlay, false); },
        function () { pages.classList.add('td-scrolled'); },
        function () {}
      ]
    };
  }

  // find-zip · 压缩包行 → 预览清单 → 展开条目 → 说明
  function findZip() {
    var root = el('div', 'tutorial-demo-frame');
    root.appendChild(filesHeader({ count: 1 }));
    var tableWrap = fileTable([
      { name: '复习资料.zip', type: '合集', previewMark: 'btn-preview' }
    ]);
    root.appendChild(tableWrap);
    var tree = zipTree([{ folder: true, name: '复习资料/', mark: 'zip-folder' }]);
    var overlay = previewOverlay('复习资料.zip', 'ZIP', [tree], {});
    root.appendChild(overlay);
    setHidden(overlay, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-preview', 'zip-folder', null],
      clicks: [false, true, true, false],
      apply: [
        function () {},
        function () { setHidden(overlay, false); },
        function () {
          tree.appendChild(zipTree([
            { name: '提纲.pdf', size: '312 KB' },
            { name: '练习题.txt', size: '8 KB' },
            { name: '历年真题合集.pdf', size: '1.2 MB' }
          ]));
        },
        function () {}
      ]
    };
  }

  // find-download · 批量入口 → 复选框 → 勾两份 → 下载选中
  function findDownload() {
    var root = el('div', 'tutorial-demo-frame');
    root.appendChild(filesHeader({
      count: 3, upload: true, batch: true, uploadMark: 'btn-upload-dim', batchMark: 'btn-batch'
    }));
    var wrap = fileTable([
      { name: '期末复习提纲.pdf', type: '提纲', chkMark: 'chk-1' },
      { name: '平时作业参考.pdf', type: '习题', chkMark: 'chk-2' },
      { name: '课程讲义合集.zip', type: '合集' }
    ], { batchBar: true, dlSelMark: 'btn-dl' });
    root.appendChild(wrap);
    var table = wrap.querySelector('.file-table');
    var bar = wrap._batchBar;
    var countEl = wrap._countEl;
    var dimUpload = root.querySelector('[data-mark="btn-upload-dim"]');
    if (dimUpload) dimUpload.classList.add('is-dim');
    return {
      root: root, steps: 5,
      targets: [null, 'btn-batch', 'chk-1', 'chk-2', 'btn-dl'],
      clicks: [false, true, true, true, true],
      apply: [
        function () {},
        function () {
          table.classList.add('multi-select');
          bar.classList.add('is-visible');
          bar.style.display = 'flex';
        },
        function () {
          wrap.querySelector('[data-mark="chk-1"]').checked = true;
          countEl.textContent = '已选 1 个';
        },
        function () {
          wrap.querySelector('[data-mark="chk-2"]').checked = true;
          countEl.textContent = '已选 2 个';
        },
        function () {
          var rows = wrap._tbody.children;
          [0, 1].forEach(function (i) {
            var cell = rows[i].querySelector('.dl-normal');
            cell.textContent = '✓ 已开始下载';
            cell.classList.add('dl-done');
          });
        }
      ]
    };
  }

  // courses-import · 空课程页 → 选文件 → 确认导入弹窗 → 课程列表（不再跳进课程）
  function coursesImport() {
    var root = el('div', 'tutorial-demo-frame');
    var shell = ttShell({ manageMark: 'btn-manage-dim' });
    root.appendChild(shell);
    var empty = el('div', 'tutorial-demo-empty');
    empty.appendChild(el('div', 'tutorial-demo-empty-title', '还没有课程'));
    empty.appendChild(el('div', 'tutorial-demo-empty-sub', '导入教务系统导出的列表式课表，或手动添加。'));
    var eActs = el('div', 'tutorial-demo-empty-actions');
    eActs.appendChild(btnEl('tt-btn primary', '选择教务导出文件', 'btn-import'));
    eActs.appendChild(btnEl('tt-btn', '手动添加课程'));
    empty.appendChild(eActs);
    root.appendChild(empty);
    var manageBtn = root.querySelector('[data-mark="btn-manage-dim"]');
    if (manageBtn) manageBtn.classList.add('is-dim');
    var modal = ttConfirmModal([
      { name: '学习方法导论（DEMO101）', time: '周一 3—4 节' },
      { name: '高等数学 B（DEMO102）', time: '周二 1—2 节' },
      { name: '体育（三）（DEMO103）', time: '周四 3—4 节' }
    ], { confirmMark: 'btn-confirm' });
    root.appendChild(modal);
    setHidden(modal, true);
    var list = el('ul', 'tt-list');
    list.appendChild(ttRow({ name: '学习方法导论', hue: 'ttp2', tag: { cls: 'tt-tag-warm', text: '12 份资料' }, meta: '示例老师 · 3 学分', sched: '周一 3—4 节', mark: 'row-1' }));
    list.appendChild(ttRow({ name: '高等数学 B', hue: 'ttp4', tag: { cls: 'tt-tag-warm', text: '5 份资料' }, meta: '另一位老师 · 6 学分', sched: '周二 1—2 节' }));
    list.appendChild(ttRow({ name: '体育（三）', hue: 'ttp6', tag: { cls: 'tt-tag-cold', text: '暂无资料' }, meta: '体育部 · 1 学分', sched: '周四 3—4 节' }));
    root.appendChild(list);
    setHidden(list, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-import', 'btn-confirm', null],
      clicks: [false, true, true, false],
      apply: [
        function () {},
        // 弹窗以真实覆盖层出现（ttPop），空状态仍在背后，与真实页面一致
        function () { setHidden(modal, false); },
        function () { setHidden(modal, true); setHidden(empty, true); reveal(list); },
        function () {}
      ]
    };
  }

  // courses-views · 列表 → 周课表 → 突出某天 → 切回（同页视图切换）
  function coursesViews() {
    var root = el('div', 'tutorial-demo-frame');
    var shell = ttShell({ segListMark: 'seg-list', segWeekMark: 'seg-week' });
    root.appendChild(shell);
    var list = el('ul', 'tt-list');
    list.appendChild(ttRow({ name: '学习方法导论', hue: 'ttp2', tag: { cls: 'tt-tag-warm', text: '12 份资料' }, meta: '示例老师 · 3 学分', sched: '周一 3—4 节' }));
    list.appendChild(ttRow({ name: '高等数学 B', hue: 'ttp4', tag: { cls: 'tt-tag-warm', text: '5 份资料' }, meta: '另一位老师 · 6 学分', sched: '周二 1—2 节' }));
    list.appendChild(ttRow({ name: '体育（三）', hue: 'ttp6', tag: { cls: 'tt-tag-cold', text: '暂无资料' }, meta: '体育部 · 1 学分', sched: '周四 3—4 节' }));
    root.appendChild(list);
    var week = miniWeek([
      { name: '高等数学 B', hue: 'ttp4', day: 2, row: 1, room: '教三 201', teacher: '另一位老师' },
      { name: '学习方法导论', hue: 'ttp2', day: 3, row: 2, room: '教二 105', teacher: '示例老师', mark: 'wk-loc', hot: false },
      { name: '体育（三）', hue: 'ttp6', day: 4, row: 1, room: '体育馆', teacher: '体育部' }
    ]);
    root.appendChild(week);
    setHidden(week, true);
    var seg = shell._seg;
    var placeEl = week.querySelector('[data-mark="wk-loc"] .tt-card-meta');
    return {
      root: root, steps: 4,
      targets: [null, 'seg-week', 'wk-loc', 'seg-list'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () {
          seg.children[0].classList.remove('active');
          seg.children[1].classList.add('active');
          setHidden(list, true);
          reveal(week, 'td-fade');
        },
        function () {
          week.classList.add('is-focus');
          if (placeEl) placeEl.textContent = '周三 3—4 节 · 教二 105';
        },
        function () {
          seg.children[1].classList.remove('active');
          seg.children[0].classList.add('active');
          setHidden(week, true);
          setHidden(list, false);
          reveal(list, 'td-fade');
        }
      ]
    };
  }

  // courses-open · 课程行 → 「查看资料 ›」/ 点开课程行 → 资料目录或课程详情
  // link / generic：有资料的课帶「查看资料 ›」，进入同名课程资料目录（名称锚点）；
  // nolink：无关联课表，点开课程行查看上课时间与地点。
  function coursesOpen(ctx) {
    var nolink = ctx.capability === 'nolink';
    var root = el('div', 'tutorial-demo-frame');
    var shell = ttShell({});
    root.appendChild(shell);
    var list = el('ul', 'tt-list');
    list.appendChild(ttRow({ name: '高等数学 B', hue: 'ttp4', dim: true, tag: { cls: 'tt-tag-warm', text: '5 份资料' }, meta: '另一位老师 · 6 学分', sched: '周二 1—2 节' }));
    list.appendChild(ttRow({
      name: '学习方法导论', hue: 'ttp2', mark: 'row-course',
      tag: nolink ? { cls: 'tt-tag-cold', text: '暂无资料' } : { cls: 'tt-tag-warm', text: '12 份资料' },
      meta: '示例老师 · 3 学分', sched: '周一 3—4 节',
      openBtn: !nolink, openMark: nolink ? null : 'tt-open-btn'
    }));
    list.appendChild(ttRow({ name: '体育（三）', hue: 'ttp6', dim: true, tag: { cls: 'tt-tag-cold', text: '暂无资料' }, meta: '体育部 · 1 学分', sched: '周四 3—4 节' }));
    root.appendChild(list);
    var dest = el('div', 'td-col');
    dest.appendChild(breadcrumb(['我的课程', '学习方法导论']));
    if (nolink) {
      var card = el('div', 'td-detailcard');
      function dRow(label, value) {
        var r = el('div', 'td-detail-row');
        r.appendChild(el('span', 'td-detail-label', label));
        r.appendChild(el('span', 'td-detail-value', value));
        return r;
      }
      card.appendChild(dRow('上课时间', '周一 3—4 节'));
      card.appendChild(dRow('上课地点', '教二 105'));
      card.appendChild(dRow('课程代码', 'DEMO101'));
      dest.appendChild(card);
    } else {
      dest.appendChild(filesHeader({ count: 2 }));
      dest.appendChild(fileTable([
        { name: '期末复习提纲.pdf', type: '提纲' },
        { name: '平时作业参考.pdf', type: '习题' }
      ]));
    }
    root.appendChild(dest);
    setHidden(dest, true);
    return {
      root: root, steps: 4,
      targets: [null, nolink ? 'row-course' : 'tt-open-btn', null, null],
      clicks: [false, true, false, false],
      apply: [
        function () {},
        function () {},
        function () { swapPage(list, dest); },
        function () {}
      ]
    };
  }

  // courses-manual · 「＋ 添加课程」→ 表单 → 填名 → 保存（时间可不填）
  function coursesManual() {
    var root = el('div', 'tutorial-demo-frame');
    var shell = ttShell({});
    root.appendChild(shell);
    var list = el('ul', 'tt-list');
    list.appendChild(ttRow({ name: '高等数学 B', hue: 'ttp4', tag: { cls: 'tt-tag-warm', text: '5 份资料' }, meta: '另一位老师 · 6 学分', sched: '周二 1—2 节' }));
    root.appendChild(list);
    var foot = el('div', 'tt-foot');
    var footCount = el('span', null, '共 1 门课程');
    foot.appendChild(footCount);
    foot.appendChild(btnEl('tt-btn is-ghost', '＋ 添加课程', 'btn-add'));
    root.appendChild(foot);
    var modal = ttEditModal({ nameMark: 'inp-name', saveMark: 'btn-save' });
    root.appendChild(modal);
    setHidden(modal, true);
    var newCalled = false;
    return {
      root: root, steps: 4,
      targets: [null, 'btn-add', null, 'btn-save'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () { setHidden(modal, false); },
        function () {
          var inp = modal.querySelector('[data-mark="inp-name"]');
          if (inp && inp.value !== '书法入门') typedInto(inp, '书法入门');
          newCalled = true;
        },
        function () {
          setHidden(modal, true);
          var li = ttRow({ name: '书法入门', hue: 'ttp8', tag: { cls: 'tt-tag-cold', text: '暂无资料' }, meta: '自学课程 · 不出现在周课表' });
          list.insertBefore(li, list.firstChild);
          reveal(li);
          footCount.textContent = '共 2 门课程';
        }
      ]
    };
  }

  // courses-terms · 管理 → 切换课表弹层 → 导入为新课表 → 切回（单屏）
  function coursesTerms() {
    var root = el('div', 'tutorial-demo-frame');
    var shell = ttShell({ manageMark: 'btn-manage' });
    root.appendChild(shell);
    // 槽位弹层挂进 tt-top（演示 CSS 给 tt-top position:relative），
    // 真实 CSS 的 absolute 锚定（top: calc(100% + 6px); right: 0）直接生效
    var top = shell.querySelector('.tt-top');
    var pop = slotPop({ oldMark: 'slot-old', newMark: 'btn-newslot' });
    top.appendChild(pop);
    setHidden(pop, true);
    var oldCourses = el('ul', 'tt-list');
    [['学习方法导论', 'ttp2'], ['高等数学 B', 'ttp4'], ['体育（三）', 'ttp6']].forEach(function (p) {
      oldCourses.appendChild(ttRow({ name: p[0], hue: p[1], tag: { cls: 'tt-tag-warm', text: '3 份资料' }, meta: '上学期 · 示例老师', sched: '周一 3—4 节' }));
    });
    root.appendChild(oldCourses);
    var newCourses = el('ul', 'tt-list');
    [['概率论与数理统计', 'ttp10'], ['大学物理', 'ttp12'], ['数据结构', 'ttp14']].forEach(function (p) {
      newCourses.appendChild(ttRow({ name: p[0], hue: p[1], tag: { cls: 'tt-tag-warm', text: '3 份资料' }, meta: '新学期 · 另一位老师', sched: '周三 1—2 节' }));
    });
    root.appendChild(newCourses);
    setHidden(newCourses, true);
    var countEl = pop.querySelector('.tt-slot-count');
    return {
      root: root, steps: 5,
      targets: [null, 'btn-manage', 'btn-newslot', null, 'slot-old'],
      clicks: [false, true, true, false, true],
      apply: [
        function () {},
        function () { setHidden(pop, false); },
        function () {
          // 导入为新课表：新槽位出现并生效，弹层背后的列表换成新课
          var rowNew = el('div', 'tt-slot-row is-active');
          var mainNew = el('div', 'tt-slot-main');
          mainNew.appendChild(el('div', 'tt-slot-name', '新学期'));
          mainNew.appendChild(el('i', 'tt-slot-cur', '当前'));
          mainNew.appendChild(el('div', 'tt-slot-sub', '3 门课程'));
          rowNew.appendChild(mainNew);
          pop.insertBefore(rowNew, pop.querySelector('.tt-slot-foot'));
          var oldRow = root.querySelector('[data-mark="slot-old"]');
          oldRow.classList.remove('is-active');
          var oldCur = oldRow.querySelector('.tt-slot-cur');
          if (oldCur) oldCur.parentNode.removeChild(oldCur);
          countEl.textContent = '2 / 3';
          setHidden(oldCourses, true);
          setHidden(newCourses, false);
          reveal(newCourses, 'td-fade');
        },
        function () {},
        function () {
          // 点「上学期」切回：当前标记移动，列表换回
          var oldRow = root.querySelector('[data-mark="slot-old"]');
          var newRow = pop.querySelector('.tt-slot-row.is-active');
          if (newRow) {
            newRow.classList.remove('is-active');
            var c = newRow.querySelector('.tt-slot-cur');
            if (c) c.parentNode.removeChild(c);
          }
          oldRow.classList.add('is-active');
          oldRow.querySelector('.tt-slot-main').appendChild(el('i', 'tt-slot-cur', '当前'));
          setHidden(newCourses, true);
          setHidden(oldCourses, false);
          reveal(oldCourses, 'td-fade');
        }
      ]
    };
  }

  // save-course · 核心 · 课程行星标 → 点亮（结束保持原位）
  function saveCourse() {
    var root = el('div', 'tutorial-demo-frame');
    var bc = breadcrumb(['全部课程', '专业课 / 示例专业']);
    root.appendChild(bc);
    var list = folderList([
      { name: '课程设计与开发', code: 'EDU220', files: 8, dim: true },
      { name: '学习方法导论', code: 'DEMO101', files: 12, starMark: 'star' },
      { name: '教育心理学基础', code: 'PSY105', files: 6, dim: true }
    ]);
    root.appendChild(list);
    var starEl = list.querySelector('[data-mark="star"]');
    return {
      root: root, steps: 3,
      targets: [null, 'star', null],
      clicks: [false, true, false],
      apply: [
        function () {},
        function () {
          starEl.innerHTML = TICONS.fdStarFilled;
          starEl.classList.add('favorited');
        },
        function () {}
      ]
    };
  }

  // save-file · 详情「收藏」按钮 → 已收藏
  function saveFile() {
    var root = el('div', 'tutorial-demo-frame');
    var detail = fdDetail({ name: '期末复习提纲.pdf', favMark: 'fav-btn' });
    root.appendChild(detail);
    var favBtn = detail.querySelector('[data-mark="fav-btn"]');
    return {
      root: root, steps: 3,
      targets: [null, 'fav-btn', null],
      clicks: [false, true, false],
      apply: [
        function () {},
        function () {
          // 真实行为：favorited class + 实心星 + 文字「已收藏」（整体重建避免残留旧标签）
          favBtn.classList.add('favorited');
          favBtn.innerHTML = TICONS.fdStarFilled + '<span>已收藏</span>';
        },
        function () {}
      ]
    };
  }

  // save-answer · 两条回答 → 收藏其中一条
  function saveAnswer() {
    var root = el('div', 'tutorial-demo-frame');
    var detail = qaDetail({ title: '如何安排期末复习？', tags: ['课程学习', '期末复习'], answers: 2 });
    root.appendChild(detail);
    var a1 = qaAnswerCard({
      author: '示例同学', text: '先按章节整理错题，再按优先级复习；考前两周开始过第二遍。',
      like: 6, favMark: 'ans-fav', favCount: 2
    });
    var a2 = qaAnswerCard({
      author: '另一位同学', text: '建议组队互相讲题，效率更高。', date: '1 周前', like: 3, fav: true, favCount: 0
    });
    detail._answers.appendChild(a1);
    detail._answers.appendChild(a2);
    var favBtn = a1.querySelector('[data-mark="ans-fav"]');
    return {
      root: root, steps: 3,
      targets: [null, 'ans-fav', null],
      clicks: [false, true, false],
      apply: [
        function () {},
        function () {
          // 真实行为：on class + 实心星 + 「已收藏」+ 计数 +1
          favBtn.classList.add('on');
          favBtn.innerHTML = TICONS.starFilled + '<span>已收藏</span><b class="qa-count">3</b>';
        },
        function () {}
      ]
    };
  }

  // save-retrieve · 头像 → 抽屉 → 我的收藏 → 文件 → 帖子
  function saveRetrieve() {
    var root = el('div', 'tutorial-demo-frame');
    var strip = topStrip([avatar('avatar')]);
    root.appendChild(strip);
    var dr = drawer([
      { label: '个人中心', ico: 'user' },
      { label: '通知中心', ico: 'bell' },
      { label: '我的上传', ico: 'upload' },
      { label: '我的收藏', ico: 'star', mark: 'mi-fav' }
    ], 3);
    root.appendChild(dr);
    setHidden(dr, true);
    var favPage = el('div', 'td-col');
    var tabs = muTabs(['课程', '文件', '帖子'], 0, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']);
    favPage.appendChild(tabs);
    var courseRow = pcItem({ title: '学习方法导论', meta: 'DEMO101 · 示例学院' });
    var fileRowEl = pcItem({ glyphCls: 'pc-glyph-pdf', glyphText: 'PDF', title: '期末复习提纲.pdf', meta: '学习方法导论 · DEMO101' });
    var postRowEl = pcItem({ title: '如何安排期末复习？', meta: '示例同学 的回答：先按章节整理错题…' });
    favPage.appendChild(courseRow);
    favPage.appendChild(fileRowEl);
    favPage.appendChild(postRowEl);
    root.appendChild(favPage);
    setHidden(favPage, true);
    setHidden(fileRowEl, true);
    setHidden(postRowEl, true);
    return {
      root: root, steps: 5,
      targets: [null, 'avatar', 'mi-fav', 'fav-tab-file', 'fav-tab-post'],
      clicks: [false, true, true, true, true],
      apply: [
        function () {},
        function () { setHidden(dr, false); },
        function () { swapPage(dr, favPage); },
        function () {
          tabs.children[0].classList.remove('active');
          tabs.children[1].classList.add('active');
          setHidden(courseRow, true);
          reveal(fileRowEl, 'td-fade');
        },
        function () {
          tabs.children[1].classList.remove('active');
          tabs.children[2].classList.add('active');
          setHidden(fileRowEl, true);
          reveal(postRowEl, 'td-fade');
        }
      ]
    };
  }

  // share-file · 上传入口 → 弹窗（文件已选）→ 必填项 → 停在提交（不伪造提交）
  function shareFile() {
    var root = el('div', 'tutorial-demo-frame');
    root.appendChild(filesHeader({ count: 2, upload: true, uploadMark: 'btn-upload' }));
    var tableWrap = fileTable([
      { name: '期末复习提纲.pdf', type: '提纲' },
      { name: '课程大纲.pdf', type: '大纲' }
    ]);
    root.appendChild(tableWrap);
    var modal = uploadModal({ mode: 'file', typeMark: 'sel-type', teacherMark: 'inp-teacher', submitMark: 'btn-submit' });
    root.appendChild(modal.overlay);
    setHidden(modal.overlay, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-upload', null, 'btn-submit'],
      clicks: [false, true, false, false],
      apply: [
        function () {},
        // 弹窗以真实覆盖层出现（modalIn），文件表留在背后被遮罩压暗（真实关系）
        function () { setHidden(modal.overlay, false); },
        function () {
          modal.typeSel.value = '笔记';
          typedInto(modal.teacher, '示例老师');
          // 高表单走真实内部滚动：把必填项与提交按钮滚入视野
          var card = modal.overlay.querySelector('.modal-card');
          if (card) card.scrollTop = card.scrollHeight;
        },
        function () {}
      ]
    };
  }

  // share-text · 核心 · 上传窗（识别线索：上传标签页）→ 原位切文字录入 →
  // 填标题与内容 → 指向真实提交（不伪造提交成功）
  function shareText() {
    var root = el('div', 'tutorial-demo-frame');
    var modal = uploadModal({ mode: 'file', compact: true, tabTextMark: 'tab-text', titleMark: 'inp-title', contentMark: 'inp-content', submitMark: 'btn-submit' });
    root.appendChild(modal.overlay);
    var tabText = modal.overlay.querySelector('[data-mark="tab-text"]');
    var tabFile = modal.tabs.children[0];
    var titleInput = modal.overlay.querySelector('[data-mark="inp-title"]');
    var contentInput = modal.overlay.querySelector('[data-mark="inp-content"]');
    return {
      root: root, steps: 4,
      targets: [null, 'tab-text', null, 'btn-submit'],
      clicks: [false, true, false, false],
      apply: [
        function () {},
        function () {
          tabFile.classList.remove('um-tab-active');
          tabText.classList.add('um-tab-active');
          setHidden(modal.paneFile, true);
          setHidden(modal.paneText, false);
          reveal(modal.paneText, 'td-fade');
          if (titleInput) titleInput.placeholder = '留空则自动取内容前20字';
        },
        function () {
          if (titleInput) typedInto(titleInput, '我的复习顺序');
          if (contentInput) typedInto(contentInput, '先整理错题，再按优先级过第二遍。');
        },
        function () {}
      ]
    };
  }

  // share-course · 新建课程申请 → 名称代码 → 类型 → 停在提交
  function shareCourse() {
    var root = el('div', 'tutorial-demo-frame');
    var card = newCourseCard({ typeMark: 'sel-type', nameMark: 'inp-name', codeMark: 'inp-code', submitMark: 'btn-submit' });
    root.appendChild(card.card);
    return {
      root: root, steps: 4,
      targets: [null, 'inp-name', 'sel-type', 'btn-submit'],
      clicks: [false, false, false, false],
      apply: [
        function () {},
        function () {
          typedInto(card.card.querySelector('[data-mark="inp-name"]'), '学术英语写作');
          typedInto(card.card.querySelector('[data-mark="inp-code"]'), 'GEN02201');
        },
        function () { card.sel.value = '通识核心'; },
        function () {}
      ]
    };
  }

  // share-review · 头像 → 我的上传（已发布）→ 审核中
  function shareReview() {
    var root = el('div', 'tutorial-demo-frame');
    var strip = topStrip([avatar('avatar')]);
    root.appendChild(strip);
    var dr = drawer([
      { label: '个人中心', ico: 'user' },
      { label: '通知中心', ico: 'bell' },
      { label: '我的上传', ico: 'upload', mark: 'mi-up' },
      { label: '我的下载', ico: 'download' },
      { label: '我的收藏', ico: 'star' }
    ], 2);
    root.appendChild(dr);
    setHidden(dr, true);
    var uploads = el('div', 'td-col');
    var tabs = muTabs(['已发布', '审核中', '已驳回'], 0, ['mu-tab-pub', 'mu-tab-pend', null]);
    uploads.appendChild(tabs);
    var pubRow = pcItem({
      glyphCls: 'pc-glyph-pdf', glyphText: 'PDF', title: '课堂笔记.pdf',
      meta: '2026-09-28 · 学习方法导论'
    });
    var pendRow = pcItem({
      glyphCls: 'pc-glyph-pdf', glyphText: 'PDF', title: '期末复习提纲.pdf',
      badge: reviewBadge('pending', '审核中'),
      meta: '2026-10-02 · 学习方法导论'
    });
    uploads.appendChild(pubRow);
    uploads.appendChild(pendRow);
    root.appendChild(uploads);
    setHidden(uploads, true);
    setHidden(pendRow, true);
    return {
      root: root, steps: 4,
      targets: [null, 'avatar', 'mi-up', 'mu-tab-pend'],
      clicks: [false, true, true, true],
      apply: [
        function () {},
        function () { setHidden(dr, false); },
        function () { swapPage(dr, uploads); },
        function () {
          tabs.children[0].classList.remove('active');
          tabs.children[1].classList.add('active');
          setHidden(pubRow, true);
          reveal(pendRow, 'td-fade');
        }
      ]
    };
  }

  // share-resubmit · 已驳回行（原因内联）→ 重新上传 → 补说明 → 提交回审核中
  function shareResubmit() {
    var root = el('div', 'tutorial-demo-frame');
    var uploads = el('div', 'td-col');
    var tabs = muTabs(['已发布', '审核中', '已驳回'], 2, [null, null, 'mu-tab-rej']);
    uploads.appendChild(tabs);
    var reBtn = btnEl('reupload-btn', '↻ 重新上传', 'btn-resub');
    var rejRow = pcItem({
      glyphCls: 'pc-glyph-pdf', glyphText: 'PDF', title: '期末复习提纲.pdf',
      badge: reviewBadge('rejected', '已驳回'),
      meta: '驳回原因：请补充资料说明',
      side: reBtn
    });
    uploads.appendChild(rejRow);
    root.appendChild(uploads);
    var modal = el('div', 'modal-overlay');
    var card = el('div', 'modal-card');
    card.appendChild(btnEl('modal-close', '✕')).setAttribute('aria-label', '关闭');
    card.appendChild(el('h2', 'modal-title', '重新上传'));
    card.appendChild(el('p', 'td-reupload-note', '上次驳回原因：请补充资料说明'));
    var g = el('div', 'mf-group');
    g.appendChild(el('label', null, '资料描述'));
    g.appendChild(inputEl('mf-input mf-textarea', { tag: 'textarea', placeholder: '简述资料内容...', mark: 'inp-desc' }));
    card.appendChild(g);
    card.appendChild(btnEl('mf-btn', '提交', 'btn-resubmit'));
    modal.appendChild(card);
    root.appendChild(modal);
    setHidden(modal, true);
    var desc = modal.querySelector('[data-mark="inp-desc"]');
    return {
      root: root, steps: 4,
      targets: [null, 'btn-resub', null, 'btn-resubmit'],
      clicks: [false, true, false, true],
      apply: [
        function () {},
        function () { setHidden(modal, false); },
        function () { typedInto(desc, '按周整理的复习要点，覆盖第 1—8 周。'); },
        function () {
          setHidden(modal, true);
          var badge = rejRow.querySelector('.review-badge');
          var newBadge = reviewBadge('pending', '审核中');
          rejRow.querySelector('.pc-item-title').replaceChild(newBadge, badge);
        }
      ]
    };
  }

  // qa-search · 问答列表 → 输入 → 搜索 → 结果浮层（命中摘要可辨认）
  function qaSearch() {
    var root = el('div', 'tutorial-demo-frame');
    var strip = topStrip([searchBox('qa-input', '搜索问题、回答…')]);
    root.appendChild(strip);
    root.appendChild(qaToolbar({ total: 12 }));
    root.appendChild(qaItem({
      title: '如何安排期末复习？', answers: 12,
      preview: '想问问大家考前两周都是怎么安排的……',
      tags: ['课程学习', '期末复习']
    }));
    root.appendChild(qaItem({
      title: '怎么选通识课？', answers: 8, date: '1 周前',
      preview: '下学期想选一门轻松一点的通识课……',
      tags: ['校园生活', '选课'], author: '另一位同学'
    }));
    var overlay = searchOverlay('期末复习', '问答区搜索结果', [
      { label: '问答', icon: TICONS.doc, items: [
        { name: '如何安排期末复习？', snippet: '先按章节整理错题，再按优先级复习…', hit: '命中回答', meta: '期末复习 · 示例同学', mark: 'qa-res' },
        { name: '期末复习资料哪里找？', snippet: ' 各位学长学姐一般从哪里找复习资料…', hit: '命中问题', meta: '期末复习 · 另一位同学' }
      ] }
    ]);
    root.appendChild(overlay);
    setHidden(overlay, true);
    var input = strip.querySelector('[data-mark="qa-input"]');
    var go = strip.querySelector('[data-mark="search-go"]');
    return {
      root: root, steps: 4,
      targets: [null, 'qa-input', 'search-go', null],
      clicks: [false, true, true, false],
      apply: [
        function () {},
        function () { typedInto(input, '期末复习'); },
        function () {},
        function () { setHidden(overlay, false); }
      ]
    };
  }

  // qa-tags · 筛选面板 → 一级 → 二级 → 收窄（再点可取消）
  function qaTags() {
    var root = el('div', 'tutorial-demo-frame');
    var toolbar = qaToolbar({ total: 12, filterMark: 'qa-filter' });
    root.appendChild(toolbar);
    // 真实折叠机制：0fr 收起（不占高度、不可见），展开继承业务 CSS 的 180ms 过渡
    var panel = qaFilterPanel({ l1Mark: 'qa-l1', l2Mark: 'qa-l2', collapsed: true });
    root.appendChild(panel);
    var q1 = qaItem({ title: '如何安排期末复习？', answers: 12, preview: '想问问大家考前两周都是怎么安排的……', tags: ['课程学习', '期末复习'] });
    var q2 = qaItem({ title: '怎么选通识课？', answers: 8, date: '1 周前', preview: '下学期想选一门轻松一点的通识课……', tags: ['课程学习', '选课'], author: '另一位同学' });
    root.appendChild(q1);
    root.appendChild(q2);
    var filterBtn = toolbar.querySelector('[data-mark="qa-filter"]');
    var filterLabel = filterBtn.querySelector('.qa-filter-btn-label');
    var titleEl = toolbar.querySelector('.qa-toolbar-total');
    return {
      root: root, steps: 5,
      targets: [null, 'qa-filter', 'qa-l1', 'qa-l2', null],
      clicks: [false, true, true, true, false],
      apply: [
        function () {},
        function () { panel.classList.remove('qa-filter-collapsed'); filterBtn.setAttribute('aria-expanded', 'true'); },
        function () {
          panel.querySelector('.qa-pills-l1').children[0].classList.remove('on');
          panel.querySelector('[data-mark="qa-l1"]').classList.add('on');
        },
        function () {
          panel.querySelector('.qa-pills-l2').children[0].classList.remove('on');
          panel.querySelector('[data-mark="qa-l2"]').classList.add('on');
          setHidden(q2, true);
          filterLabel.textContent = '筛选 · 2';
          titleEl.textContent = ' · 1';
        },
        function () {}
      ]
    };
  }

  // qa-ask · 我要提问 → 标题+标签 → 正文 → 停在提交审核
  function qaAsk() {
    var root = el('div', 'tutorial-demo-frame');
    var head = el('div', 'td-qahead');
    head.appendChild(el('span', 'qa-toolbar-title', '全部问题'));
    head.appendChild(btnEl('qa-ask-btn', '我要提问', 'btn-ask'));
    root.appendChild(head);
    var headEl = head;
    var ctxItem = qaItem({ title: '怎么选通识课？', answers: 8, preview: '下学期想选一门轻松一点的通识课……', tags: ['校园生活', '选课'], author: '另一位同学' });
    root.appendChild(ctxItem);
    var compose = qaCompose({ titleMark: 'inp-title', l1Mark: 'chip-l1', l2Mark: 'chip-l2', contentMark: 'inp-body', summaryHidden: true });
    root.appendChild(compose);
    setHidden(compose, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-ask', 'inp-title', null],
      clicks: [false, true, false, false],
      apply: [
        function () {},
        function () { setHidden(headEl, true); swapPage(ctxItem, compose); },
        function () {
          typedInto(compose.querySelector('[data-mark="inp-title"]'), '期末复习应该如何分配时间？');
          compose.querySelector('[data-mark="chip-l1"]').classList.add('on');
          compose.querySelector('[data-mark="chip-l2"]').classList.add('on');
          var summary = compose.querySelector('.qc-tag-summary');
          if (summary) reveal(summary, 'td-fade');
        },
        function () {
          var c = compose.querySelector('[data-mark="inp-body"]');
          if (c) {
            c.textContent = '我先把错题过了一遍，但时间还是不够用，大家考前两周都是怎么安排的？';
            var num = compose.querySelector('.qa-editor-count-num');
            if (num) num.textContent = String(c.textContent.length);
          }
        }
      ]
    };
  }

  // qa-answer · 写回答 → 编辑器保留问题 → 写正文 → 停在提交审核
  function qaAnswer() {
    var root = el('div', 'tutorial-demo-frame');
    var detail = qaDetail({ title: '如何安排期末复习？', tags: ['课程学习', '期末复习'], answers: 1, writeMark: 'btn-write' });
    detail._answers.appendChild(qaAnswerCard({ author: '另一位同学', text: '建议组队互相讲题，效率更高。', like: 3, fav: true, favCount: 1 }));
    root.appendChild(detail);
    var compose = qaCompose({
      answerMode: true, contentMark: 'inp-body',
      context: { title: '如何安排期末复习？', desc: '期末复习应该怎么分配时间？按章节还是按题型？' }
    });
    root.appendChild(compose);
    setHidden(compose, true);
    return {
      root: root, steps: 4,
      targets: [null, 'btn-write', null, null],
      clicks: [false, true, false, false],
      apply: [
        function () {},
        function () { swapPage(detail, compose); },
        function () {
          var c = compose.querySelector('[data-mark="inp-body"]');
          if (c) {
            c.textContent = '先按章节整理错题，再按优先级复习；适合考前两周开始过第二遍。';
            var num = compose.querySelector('.qa-editor-count-num');
            if (num) num.textContent = String(c.textContent.length);
          }
        },
        function () {}
      ]
    };
  }

  // qa-accept · 你的问题 → 指认采纳按钮 → 采纳 → 绿条+已采纳
  function qaAccept() {
    var root = el('div', 'tutorial-demo-frame');
    var detail = qaDetail({ title: '如何安排期末复习？', tags: ['课程学习', '期末复习'], answers: 2, owner: true });
    var a1 = qaAnswerCard({
      author: '示例同学', text: '先按章节整理错题，再按优先级复习；考前两周开始过第二遍。',
      like: 6, acceptMark: 'accept-btn'
    });
    var a2 = qaAnswerCard({ author: '另一位同学', date: '1 周前', text: '建议组队互相讲题，效率更高。', like: 3, fav: true, favCount: 0 });
    detail._answers.appendChild(a1);
    detail._answers.appendChild(a2);
    root.appendChild(detail);
    var acceptBtn = a1.querySelector('[data-mark="accept-btn"]');
    return {
      root: root, steps: 4,
      targets: [null, 'accept-btn', 'accept-btn', null],
      clicks: [false, false, true, false],
      apply: [
        function () {},
        function () {},
        function () {
          acceptBtn.classList.remove('is-hot');
          acceptBtn.textContent = '取消采纳';
          a1.classList.add('qa-answer--accepted');
          a1._authorRow.appendChild(qaAcceptedFlag());
        },
        function () {}
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
      // 增量（apply[已应用+1..i]），避免“追加类/追加行”操作重复执行；新实例
      // 从头执行全部 apply（静态降级视图与守门依赖这一性质）。
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
