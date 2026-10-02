/* BNU Sparks · tutorial-scenes.js —— 动画使用教程：演示舞台组件库与 25 个分镜的四帧工厂。
   只操作教程舞台，不触碰业务 DOM、不调用业务函数。全部示例数据为固定虚构内容。
   每个分镜工厂返回 { frames: [fn(ctx)→Element ×4], moves: [×4] }：
   - frames[i] 构建第 i 个镜头（A/B/C/D）的静态 DOM，可直接渲染（renderFrame(0..3)）；
   - moves[i] 描述第 i 个镜头内指针的动作 { target: data-mark 名, hover: 仅悬停 }，
     null 表示该镜头没有指针。玩家（tutorial-player）负责时间槽、切换与暂停。 */
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
  // 输入示例以词组/短句淡入，不逐字模拟键盘。
  function typed(text) {
    return sp('typed', text);
  }

  // ── 通用小件 ──────────────────────────────────────────────
  function btn(label, opts) {
    opts = opts || {};
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tutorial-demo-btn' + (opts.primary ? ' is-primary' : '') + (opts.small ? ' is-small' : '') + (opts.dim ? ' is-dim' : '');
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
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z');
    svg.appendChild(path);
    if (filled) svg.setAttribute('aria-hidden', 'true');
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
  function noteLine(text) {
    return d('cap-note', text);
  }
  function checkRow(label, checked) {
    var row = d('checkrow');
    row.appendChild(checkbox(checked));
    row.appendChild(sp('checkrow-label', label));
    return row;
  }

  // ── 布局骨架 ──────────────────────────────────────────────
  // 站点外壳：顶栏（logo + 搜索框 + 头像）+ 可选侧栏 + 主区。
  function appbar(opts) {
    opts = opts || {};
    var bar = d('appbar');
    var logo = d('appbar-logo');
    logo.appendChild(sp('appbar-mark', '✦'));
    logo.appendChild(sp('appbar-name', '木铎星火'));
    bar.appendChild(logo);
    if (!opts.noSearch) {
      var box = d('searchbox');
      box.appendChild(sp('searchbox-icon', '⌕'));
      var input = d('searchbox-input');
      if (opts.searchText != null) input.appendChild(typed(opts.searchText));
      else if (opts.placeholder) input.appendChild(sp('searchbox-ph', opts.placeholder));
      box.appendChild(input);
      box.appendChild(btn(opts.searchLabel || '搜索', { small: true, mark: opts.searchMark }));
      bar.appendChild(box);
    }
    bar.appendChild(avatar(opts.avatarMark));
    return bar;
  }
  function sidenav(activeIdx) {
    var items = ['首页', '我的课程', '全部课程', '问答区'];
    var nav = d('sidenav');
    items.forEach(function (label, i) {
      nav.appendChild(sp('sidenav-item' + (i === activeIdx ? ' is-active' : ''), label));
    });
    return nav;
  }
  function shell(opts, mainChildren) {
    var root = d('app');
    root.appendChild(appbar(opts || {}));
    var body = d('appbody');
    if (!opts || !opts.mobile) body.appendChild(sidenav(opts ? opts.nav : -1));
    var main = d('main');
    (mainChildren || []).forEach(function (c) { main.appendChild(c); });
    body.appendChild(main);
    root.appendChild(body);
    return root;
  }
  // 手机局部界面：仅当前列/卡片，不缩放整套桌面 UI。
  function phone(mainChildren) {
    var root = d('phone');
    var screen = d('phone-screen');
    (mainChildren || []).forEach(function (c) { screen.appendChild(c); });
    root.appendChild(screen);
    return root;
  }
  function frame(isMobile, desktopChildren, mobileChildren) {
    return isMobile ? phone(mobileChildren || desktopChildren) : shell({}, desktopChildren);
  }
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
  // 资料行（卡片式，窄屏自动堆叠）
  function fileRow(opts) {
    opts = opts || {};
    var row = d('frow' + (opts.dim ? ' is-dim' : '') + (opts.hot ? ' is-hot' : ''));
    if (opts.selectMode) row.appendChild(checkbox(opts.checked, opts.mark ? null : null));
    if (opts.mark && !opts.selectMode) mark(opts.mark, row);
    row.appendChild(exGlyph(opts.ext || 'pdf'));
    var info = d('frow-info');
    info.appendChild(d('frow-title', opts.title));
    info.appendChild(d('frow-meta', opts.meta || ''));
    row.appendChild(info);
    if (opts.pill) row.appendChild(opts.pill);
    if (opts.starEl) row.appendChild(opts.starEl);
    if (opts.favorited) row.appendChild(star(true));
    if (opts.downloads != null) {
      var right = d('frow-right');
      if (opts.downloads) right.appendChild(sp('frow-count', opts.downloads));
      right.appendChild(btn('下载', { small: true }));
      row.appendChild(right);
    }
    if (opts.checkMark) mark(opts.checkMark, row.querySelector('.tutorial-demo-checkbox') || row);
    return row;
  }
  // 分段控件（课程列表 / 周课表 等）
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
  // 弹出菜单（头像菜单 / 管理菜单）
  function menuPanel(items, opts) {
    opts = opts || {};
    var panel = d('menu');
    items.forEach(function (it, i) {
      var row = sp('menu-item' + (i === opts.activeIdx ? ' is-active' : ''), it);
      if (opts.marks && opts.marks[i]) mark(opts.marks[i], row);
      panel.appendChild(row);
    });
    return panel;
  }
  // 纸张（PDF 预览页）
  function pdfSheet(title, lines, opts) {
    opts = opts || {};
    var sheet = d('sheet');
    sheet.appendChild(d('sheet-title', title));
    lines.forEach(function (line) {
      sheet.appendChild(d('sheet-line' + (line === ' ' ? ' is-blank' : ''), line === ' ' ? '' : line));
    });
    if (opts.foot) sheet.appendChild(sp('sheet-foot', opts.foot));
    return sheet;
  }
  // ZIP 文件清单
  function zipTree(items) {
    var tree = d('ziptree');
    items.forEach(function (it) {
      var row = d('ziptree-row' + (it.folder ? ' is-folder' : '') + (it.dim ? ' is-dim' : ''));
      if (it.mark) mark(it.mark, row);
      row.appendChild(sp('ziptree-glyph', it.folder ? '▸' : '·'));
      row.appendChild(sp('ziptree-name', it.name));
      if (it.size) row.appendChild(sp('ziptree-size', it.size));
      tree.appendChild(row);
    });
    return tree;
  }
  // 迷你周课表
  function weekGrid(opts) {
    opts = opts || {};
    var grid = d('week' + (opts.mini ? ' is-mini' : ''));
    var days = ['一', '二', '三', '四', '五'];
    var head = d('week-head');
    days.forEach(function (day) { head.appendChild(sp('week-day', day)); });
    grid.appendChild(head);
    var cells = d('week-grid');
    for (var i = 0; i < 15; i++) cells.appendChild(d('week-cell'));
    (opts.blocks || []).forEach(function (b) {
      var block = d('week-block' + (b.hot ? ' is-hot' : ''));
      block.style.gridColumn = String(b.day);
      block.style.gridRow = b.period + ' / span ' + (b.span || 1);
      block.appendChild(d('week-block-name', b.label));
      if (b.place) block.appendChild(d('week-block-place', b.place));
      cells.appendChild(block);
    });
    grid.appendChild(cells);
    return grid;
  }
  // 表单行
  function formRow(label, value, opts) {
    opts = opts || {};
    var row = d('formrow' + (opts.dim ? ' is-dim' : ''));
    row.appendChild(sp('formrow-label', label));
    var input = d('formrow-input' + (opts.area ? ' is-area' : ''));
    if (value != null) input.appendChild(typed(value));
    else if (opts.placeholder) input.appendChild(sp('formrow-ph', opts.placeholder));
    row.appendChild(input);
    if (opts.note) row.appendChild(sp('formrow-note', opts.note));
    if (opts.mark) mark(opts.mark, row);
    return row;
  }
  // 收藏页标签（课程 / 文件 / 帖子）
  function favTabs(activeIdx, marks) {
    return seg(['课程', '文件', '帖子'], activeIdx, marks);
  }
  // 问答卡片
  function qCard(opts) {
    var card = d('qcard' + (opts.hot ? ' is-hot' : ''));
    if (opts.mark) mark(opts.mark, card);
    card.appendChild(d('qcard-title', opts.title));
    if (opts.meta) card.appendChild(d('qcard-meta', opts.meta));
    if (opts.snippet) card.appendChild(d('qcard-snippet', opts.snippet));
    if (opts.pill) card.appendChild(opts.pill);
    return card;
  }
  function answerCard(opts) {
    var card = d('answer' + (opts.hot ? ' is-hot' : ''));
    if (opts.mark) mark(opts.mark, card);
    var head = d('answer-head');
    head.appendChild(sp('answer-author', opts.author));
    if (opts.badge) head.appendChild(opts.badge);
    card.appendChild(head);
    (opts.lines || []).forEach(function (line) { card.appendChild(d('answer-line', line)); });
    var actions = d('answer-actions');
    (opts.actions || []).forEach(function (a) {
      var b = btn(a.label, { small: true, ghost: !a.primary, primary: a.primary, mark: a.mark });
      if (a.on) b.classList.add('is-on');
      actions.appendChild(b);
    });
    card.appendChild(actions);
    return card;
  }
  function emptyState(title, sub, actions) {
    var box = d('empty');
    box.appendChild(d('empty-title', title));
    box.appendChild(d('empty-sub', sub));
    var row = d('empty-actions');
    (actions || []).forEach(function (a) { row.appendChild(a); });
    box.appendChild(row);
    return box;
  }
  function overlayPanel(title, children, footActions) {
    var panel = d('panel');
    panel.appendChild(d('panel-title', title));
    (children || []).forEach(function (c) { panel.appendChild(c); });
    if (footActions) {
      var row = d('panel-actions');
      footActions.forEach(function (a) { row.appendChild(a); });
      panel.appendChild(row);
    }
    return panel;
  }


  // 把筛选 chip 条插到演示列表之前（列表嵌在 main/screen 容器内，不是根的直接子节点）
  function insertChipbar(root, bar) {
    var hostEl = root.querySelector('.tutorial-demo-main') || root.querySelector('.tutorial-demo-phone-screen') || root;
    hostEl.insertBefore(bar, hostEl.querySelector('.tutorial-demo-list'));
  }

  // ── 分镜工厂 ──────────────────────────────────────────────
  var SCENES = {

    // find-search · 10s · A 输入 → B 两类结果 → C 课程资料列表 → D 资料详情
    findSearch: function () {
      return {
        moves: [{ target: 'search-go' }, { target: 'res-course' }, { target: 'f-review' }, null],
        frames: [
          function (ctx) {
            if (ctx.mobile) {
              return phone([
                appbar({ searchText: '学习方法', searchMark: 'search-go' }),
                d('lead', '在顶部搜索框输入课程名、代码或关键词'),
                fileRow({ title: '学习方法导论 · 期末经验贴', meta: '问答区 · 示例同学', ext: 'txt', dim: true }),
                fileRow({ title: '学习方法讲座通知', meta: '公告 · 2025-09', ext: 'txt', dim: true })
              ]);
            }
            return shell({ searchText: '学习方法', searchMark: 'search-go', nav: -1 }, [
              d('lead', '在顶部搜索框输入课程名、代码或关键词'),
              fileRow({ title: '学习方法导论 · 期末经验贴', meta: '问答区 · 示例同学', ext: 'txt', dim: true }),
              fileRow({ title: '学习方法讲座通知', meta: '公告 · 2025-09', ext: 'txt', dim: true })
            ]);
          },
          function (ctx) {
            var courseRes = d('result is-course');
            mark('res-course', courseRes);
            courseRes.appendChild(d('result-title', '学习方法导论'));
            courseRes.appendChild(d('result-meta', 'DEMO101 · 专业课 · 3 份资料'));
            var fileRes = d('result');
            fileRes.appendChild(d('result-title', '期末复习提纲.pdf'));
            fileRes.appendChild(d('result-meta', '资料 · 学习方法导论'));
            return frame(ctx.mobile, [
              appbar({ searchText: '学习方法', mobile: ctx.mobile }),
              sp('cap-label', '课程'),
              courseRes,
              sp('cap-label', '资料'),
              fileRes
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              courseHead('学习方法导论', 'DEMO101'),
              seg(['全部', '试卷', '笔记', '讲义'], 0),
              fileRow({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', mark: 'f-review', hot: true, downloads: '86' }),
              fileRow({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', downloads: '40' }),
              fileRow({ title: '课程讲义合集.zip', meta: '示例同学 · 收藏 3', ext: 'zip', downloads: '21' })
            ], null);
          },
          function (ctx) {
            var detail = d('detail');
            var head = d('detail-head');
            head.appendChild(exGlyph('pdf'));
            var info = d('detail-info');
            info.appendChild(d('detail-title', '期末复习提纲.pdf'));
            info.appendChild(d('detail-meta', '学习方法导论 · DEMO101 · 示例同学 上传'));
            head.appendChild(info);
            detail.appendChild(head);
            detail.appendChild(d('detail-desc', '按周整理的复习要点与例题提示，覆盖全部考核章节。'));
            var actions = d('detail-actions');
            actions.appendChild(btn('预览', { small: true }));
            actions.appendChild(btn('下载', { small: true, primary: true }));
            detail.appendChild(actions);
            var sheet = pdfSheet('期末复习提纲', ['第一章 学习方法概述', '第二章 时间安排与优先级', '……'], { foot: '示例预览 · 第 1 页' });
            sheet.classList.add('is-fadein');
            return frame(ctx.mobile, [detail, sheet], null);
          }
        ]
      };
    },

    // find-filter · 10s · A 列表与入口 → B 类型筛选 → C 排序 → D 状态保持
    findFilter: function () {
      function rows(paperOnly, sortByFav) {
        var list = d('list');
        var paper1 = fileRow({ title: '2022 期末试卷.pdf', meta: '示例同学 · 收藏 41', ext: 'pdf', dim: !paperOnly });
        var paper2 = fileRow({ title: '2023 期末试卷.pdf', meta: '示例同学 · 收藏 28', ext: 'pdf', dim: !paperOnly });
        var others = paperOnly ? [] : [
          fileRow({ title: '课堂笔记.pdf', meta: '另一位同学 · 收藏 9', ext: 'pdf', dim: true }),
          fileRow({ title: '复习讲义.pdf', meta: '示例同学 · 收藏 6', ext: 'pdf', dim: true })
        ];
        var items = sortByFav ? [paper1, paper2] : [paper2, paper1];
        items.forEach(function (r) { list.appendChild(r); });
        others.forEach(function (r) { list.appendChild(r); });
        return list;
      }
      function typeMenu() {
        var m = menuPanel(['全部', '笔记', '试卷', '讲义'], { activeIdx: 2, marks: [null, null, 'opt-paper', null] });
        m.classList.add('is-open');
        return m;
      }
      function sortMenu() {
        var m = menuPanel(['上传时间', '下载量', '收藏量'], { activeIdx: 2, marks: [null, null, 'opt-fav'] });
        m.classList.add('is-open');
        return m;
      }
      return {
        moves: [{ target: 'chip-type' }, { target: 'opt-paper' }, { target: 'opt-fav' }, null],
        frames: [
          function (ctx) {
            var root = frame(ctx.mobile, [
              courseHead('学习方法导论', 'DEMO101'),
              rows(false, false)
            ], null);
            var bar = d('chipbar');
            bar.appendChild(chip('类型 ⌄', { mark: 'chip-type' }));
            bar.appendChild(chip('排序 ⌄', { mark: 'chip-sort' }));
            insertChipbar(root, bar);
            return root;
          },
          function (ctx) {
            var root = frame(ctx.mobile, [
              courseHead('学习方法导论', 'DEMO101'),
              rows(true, false)
            ], null);
            var bar = d('chipbar');
            bar.appendChild(chip('类型：试卷', { active: true, mark: 'chip-type' }));
            bar.appendChild(chip('排序 ⌄', {}));
            insertChipbar(root, bar);
            root.appendChild(typeMenu());
            return root;
          },
          function (ctx) {
            var root = frame(ctx.mobile, [
              courseHead('学习方法导论', 'DEMO101'),
              rows(true, true)
            ], null);
            var bar = d('chipbar');
            bar.appendChild(chip('类型：试卷', { active: true }));
            bar.appendChild(chip('排序：收藏量', { active: true, mark: 'chip-sort' }));
            insertChipbar(root, bar);
            root.appendChild(sortMenu());
            return root;
          },
          function (ctx) {
            var root = frame(ctx.mobile, [
              courseHead('学习方法导论', 'DEMO101'),
              rows(true, true)
            ], null);
            var bar = d('chipbar');
            bar.appendChild(chip('类型：试卷', { active: true }));
            bar.appendChild(chip('排序：收藏量', { active: true }));
            insertChipbar(root, bar);
            root.appendChild(noteLine('筛选状态持续可见，列表按当前条件显示。'));
            return root;
          }
        ]
      };
    },

    // find-same-name · 8s · A 同名区块 → B 突出另一条 → C 切换后代码变化 → D 归属信息
    findSameName: function () {
      function head(code) {
        return courseHead('学习方法导论', code);
      }
      function sameNameSection(hot) {
        var box = d('samename');
        box.appendChild(sp('cap-label', '同名课程'));
        var cur = d('samename-row is-current');
        cur.appendChild(d('samename-name', '学习方法导论'));
        cur.appendChild(sp('codechip', 'DEMO101'));
        cur.appendChild(sp('samename-note', '当前课程'));
        box.appendChild(cur);
        var alt = d('samename-row' + (hot ? ' is-hot' : ''));
        if (hot) mark('alt-course', alt);
        alt.appendChild(d('samename-name', '学习方法导论'));
        alt.appendChild(sp('codechip', 'DEMO201'));
        alt.appendChild(sp('samename-note', '另一个学院开设'));
        box.appendChild(alt);
        return box;
      }
      return {
        moves: [null, { target: 'alt-course' }, null, null],
        frames: [
          function (ctx) { return frame(ctx.mobile, [head('DEMO101'), sameNameSection(false)], null); },
          function (ctx) { return frame(ctx.mobile, [head('DEMO101'), sameNameSection(true)], null); },
          function (ctx) {
            return frame(ctx.mobile, [
              head('DEMO201'),
              fileRow({ title: '海洋科学导论复习要点.pdf', meta: '示例同学 · 收藏 8', downloads: '30' }),
              fileRow({ title: '课程大纲.pdf', meta: '另一位同学 · 收藏 2', downloads: '12' })
            ], null);
          },
          function (ctx) {
            var extra = sp('samename-note', '归属：示例学院');
            return frame(ctx.mobile, [
              courseHead('学习方法导论', 'DEMO201', extra),
              noteLine('名称相同、代码不同：留意课程归属再下载资料。')
            ], null);
          }
        ]
      };
    },

    // find-preview · 10s · A 详情 → B 预览第 1 页 → C 第 2 页 → D 回详情突出下载
    findPreview: function () {
      function detail(highlightDownload) {
        var detail = d('detail');
        var head = d('detail-head');
        head.appendChild(exGlyph('pdf'));
        var info = d('detail-info');
        info.appendChild(d('detail-title', '期末复习提纲.pdf'));
        info.appendChild(d('detail-meta', '学习方法导论 · DEMO101 · 2.1 MB'));
        head.appendChild(info);
        detail.appendChild(head);
        var actions = d('detail-actions');
        actions.appendChild(btn('预览', { small: true, primary: !highlightDownload, mark: 'btn-preview' }));
        actions.appendChild(btn('下载', { small: true, primary: !!highlightDownload }));
        detail.appendChild(actions);
        return detail;
      }
      function viewer(page) {
        var box = d('viewer');
        var bar = d('viewer-bar');
        var close = btn('✕ 关闭', { small: true, mark: 'btn-close' });
        bar.appendChild(close);
        bar.appendChild(sp('viewer-title', '预览 · 最多前三页'));
        if (page === 1) bar.appendChild(btn('下一页 →', { small: true, mark: 'btn-next' }));
        else bar.appendChild(sp('viewer-page', '第 ' + page + ' / 3 页'));
        box.appendChild(bar);
        box.appendChild(page === 1
          ? pdfSheet('期末复习提纲', ['摘要：本提纲覆盖第 1—8 周内容。', '一、学习方法概述', '二、时间安排与优先级'], { foot: '示例预览 · 第 1 页' })
          : pdfSheet('期末复习提纲', ['三、常见题型与答题思路', '四、往年重点回顾', '……'], { foot: '示例预览 · 第 2 页' }));
        return box;
      }
      return {
        moves: [{ target: 'btn-preview' }, { target: 'btn-next' }, { target: 'btn-close' }, null],
        frames: [
          function (ctx) { return frame(ctx.mobile, [detail(false)], null); },
          function (ctx) { return frame(ctx.mobile, [detail(false), viewer(1)], null); },
          function (ctx) { return frame(ctx.mobile, [detail(false), viewer(2)], null); },
          function (ctx) { return frame(ctx.mobile, [detail(true), noteLine('确认内容后再下载；PPT/PPTX 暂不支持在线预览。')], null); }
        ]
      };
    },

    // find-zip · 8s · A ZIP 详情 → B 清单出现 → C 展开 → D 说明
    findZip: function () {
      function detail() {
        var detail = d('detail');
        var head = d('detail-head');
        head.appendChild(exGlyph('zip'));
        var info = d('detail-info');
        info.appendChild(d('detail-title', '复习资料.zip'));
        info.appendChild(d('detail-meta', '学习方法导论 · DEMO101 · 4.6 MB'));
        head.appendChild(info);
        detail.appendChild(head);
        var actions = d('detail-actions');
        actions.appendChild(btn('预览', { small: true, primary: true, mark: 'btn-zip-preview' }));
        actions.appendChild(btn('下载', { small: true }));
        detail.appendChild(actions);
        return detail;
      }
      function tree(expanded) {
        return zipTree(expanded
          ? [{ folder: true, name: '复习资料/', mark: 'zip-folder' },
             { name: '提纲.pdf', size: '312 KB' },
             { name: '练习题.txt', size: '8 KB' },
             { name: '历年真题合集.pdf', size: '1.2 MB' }]
          : [{ folder: true, name: '复习资料/', mark: 'zip-folder' }]);
      }
      return {
        moves: [{ target: 'btn-zip-preview' }, { target: 'zip-folder' }, null, null],
        frames: [
          function (ctx) { return frame(ctx.mobile, [detail()], null); },
          function (ctx) { return frame(ctx.mobile, [detail(), overlayPanel('文件清单', [tree(false)])], null); },
          function (ctx) { return frame(ctx.mobile, [detail(), overlayPanel('文件清单', [tree(true)])], null); },
          function (ctx) {
            return frame(ctx.mobile, [detail(), overlayPanel('文件清单', [tree(true), noteLine('这里查看目录，不打开包内文件。')])], null);
          }
        ]
      };
    },

    // find-download · 10s · A 批量入口 → B 复选框出现 → C 勾选并下载 → D 各自下载
    findDownload: function () {
      function list(opts) {
        opts = opts || {};
        var list = d('list');
        list.appendChild(fileRow({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', checkMark: 'chk-1', selectMode: opts.select, checked: opts.checked1, downloads: opts.select ? null : '86' }));
        list.appendChild(fileRow({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', checkMark: 'chk-2', selectMode: opts.select, checked: opts.checked2, downloads: opts.select ? null : '40' }));
        list.appendChild(fileRow({ title: '课程讲义合集.zip', meta: '示例同学 · 收藏 3', ext: 'zip', selectMode: opts.select, checked: false, downloads: opts.select ? null : '21' }));
        return list;
      }
      function bar(selected, withDl) {
        var bar = d('toolbar');
        bar.appendChild(btn('批量下载', { small: true, primary: !selected, mark: 'btn-batch' }));
        if (selected != null) bar.appendChild(sp('toolbar-count', '已选 ' + selected + ' 个'));
        if (withDl) bar.appendChild(btn('下载选中', { small: true, primary: true, mark: 'btn-dl' }));
        return bar;
      }
      function doneView() {
        var box = d('dlfeed');
        ['期末复习提纲.pdf', '平时作业参考.pdf'].forEach(function (name) {
          var row = d('dlfeed-row');
          row.appendChild(exGlyph('pdf'));
          row.appendChild(d('dlfeed-name', name));
          row.appendChild(sp('dlfeed-state', '已开始下载 ↓'));
          box.appendChild(row);
        });
        return box;
      }
      return {
        moves: [{ target: 'btn-batch' }, { target: 'chk-1' }, { target: 'btn-dl' }, null],
        frames: [
          function (ctx) { return frame(ctx.mobile, [bar(null, false), list({})], null); },
          function (ctx) { return frame(ctx.mobile, [bar(0, false), list({ select: true })], null); },
          function (ctx) { return frame(ctx.mobile, [bar(2, true), list({ select: true, checked1: true, checked2: true })], null); },
          function (ctx) { return frame(ctx.mobile, [doneView(), noteLine('两份资料分别下载，不合并为压缩包。')], null); }
        ]
      };
    },

    // courses-import · 12s · 核心 · A 空状态 → B 解析确认 → C 课程卡片 → D 按能力分支
    coursesImport: function () {
      function cards(withLinkBadge) {
        var list = d('ccards');
        var c1 = d('ccard');
        mark('card-course', c1);
        c1.appendChild(d('ccard-name', '学习方法导论'));
        c1.appendChild(sp('codechip', 'DEMO101'));
        if (withLinkBadge) c1.appendChild(pill('有资料', 'success'));
        var c2 = d('ccard');
        c2.appendChild(d('ccard-name', '高等数学 B'));
        c2.appendChild(sp('codechip', 'DEMO102'));
        var c3 = d('ccard');
        c3.appendChild(d('ccard-name', '体育（三）'));
        c3.appendChild(sp('codechip', 'DEMO103'));
        [c1, c2, c3].forEach(function (c) { list.appendChild(c); });
        return list;
      }
      return {
        moves: [{ target: 'btn-import' }, { target: 'btn-confirm' }, { target: 'card-course' }, null],
        frames: [
          function (ctx) {
            return frame(ctx.mobile, [
              emptyState('还没有课程', '导入教务系统导出的列表式课表，或手动添加。', [
                btn('导入课表', { primary: true, mark: 'btn-import' }),
                btn('手动添加课程', {})
              ])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('确认导入', [
                sp('cap-label', '已识别 3 门课程（列表式课表）'),
                checkRow('学习方法导论 · DEMO101', true),
                checkRow('高等数学 B · DEMO102', true),
                checkRow('体育（三） · DEMO103', true),
                noteLine('导入文件只在浏览器本地解析，可见范围以导入页提示为准。')
              ], [btn('取消', {}), btn('确认导入', { primary: true, mark: 'btn-confirm' })])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              seg(['课程列表', '周课表'], 0, ['seg-list', 'seg-week']),
              cards(true)
            ], null);
          },
          function (ctx) {
            var cap = ctx.capability || 'generic';
            if (cap === 'link') {
              return frame(ctx.mobile, [
                courseHead('学习方法导论', 'DEMO101'),
                noteLine('匹配到资料目录的课程，可以直接查看资料。'),
                fileRow({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', downloads: '86' }),
                fileRow({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', downloads: '40' })
              ], null);
            }
            return frame(ctx.mobile, [
              courseHead('学习方法导论', 'DEMO101'),
              overlayPanel('课程详情', [
                formRow('上课时间', '周一 3—4 节'),
                formRow('地点', '教二 105'),
                noteLine('资料关联取决于培养层次、课表格式和课程匹配。')
              ])
            ], null);
          }
        ]
      };
    },

    // courses-views · 8s · A 列表 → B 周课表 → C 突出某天 → D 切回列表
    coursesViews: function () {
      function courseCards() {
        var list = d('ccards');
        ['学习方法导论 · DEMO101', '高等数学 B · DEMO102', '体育（三） · DEMO103'].forEach(function (s) {
          var parts = s.split(' · ');
          var c = d('ccard');
          c.appendChild(d('ccard-name', parts[0]));
          c.appendChild(sp('codechip', parts[1]));
          list.appendChild(c);
        });
        return list;
      }
      function listFrame(ctx, activeSeg) {
        var root = frame(ctx.mobile, [courseCards()], null);
        var bar = seg(['课程列表', '周课表'], activeSeg, ['seg-list', 'seg-week']);
        root.insertBefore(bar, root.firstChild);
        return root;
      }
      return {
        moves: [{ target: 'seg-week' }, null, { target: 'seg-list' }, null],
        frames: [
          function (ctx) { return listFrame(ctx, 0); },
          function (ctx) {
            return frame(ctx.mobile, [
              seg(['课程列表', '周课表'], 1, ['seg-list', 'seg-week']),
              weekGrid({ blocks: [
                { day: 1, period: 1, label: '高等数学 B' },
                { day: 3, period: 2, label: '学习方法导论', place: '教二 105', hot: true },
                { day: 4, period: 1, label: '体育（三）' }
              ] })
            ], null);
          },
          function (ctx) {
            var grid = weekGrid({ blocks: [
              { day: 1, period: 1, label: '高等数学 B' },
              { day: 3, period: 2, label: '学习方法导论', place: '周三 · 3—4 节 · 教二 105', hot: true },
              { day: 4, period: 1, label: '体育（三）' }
            ] });
            grid.classList.add('is-focus');
            return frame(ctx.mobile, [
              seg(['课程列表', '周课表'], 1, ['seg-list', 'seg-week']),
              grid,
              noteLine('突出显示某天的上课时间与地点。')
            ], null);
          },
          function (ctx) { return listFrame(ctx, 0); }
        ]
      };
    },

    // courses-open · 8s · 能力分支：link 进入资料目录；nolink/generic 查看详情
    coursesOpen: function () {
      function card(withBadge) {
        var c = d('ccard is-solo');
        mark('card-course', c);
        c.appendChild(d('ccard-name', '学习方法导论'));
        c.appendChild(sp('codechip', 'DEMO101'));
        if (withBadge) c.appendChild(pill('有资料', 'success'));
        return c;
      }
      return {
        moves: [{ target: 'card-course', hover: true }, { target: 'card-course' }, null, null],
        frames: [
          function (ctx) {
            var cap = ctx.capability || 'generic';
            return frame(ctx.mobile, [
              d('lead', cap === 'link' ? '课程卡片显示“有资料”' : '在课程列表中找到这门课'),
              card(cap === 'link')
            ], null);
          },
          function (ctx) {
            var cap = ctx.capability || 'generic';
            return frame(ctx.mobile, [
              d('lead', '点击课程卡片'),
              card(cap === 'link')
            ], null);
          },
          function (ctx) {
            var cap = ctx.capability || 'generic';
            if (cap === 'link') {
              return frame(ctx.mobile, [
                courseHead('学习方法导论', 'DEMO101'),
                fileRow({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', downloads: '86' }),
                fileRow({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', downloads: '40' })
              ], null);
            }
            return frame(ctx.mobile, [
              courseHead('学习方法导论', 'DEMO101'),
              overlayPanel('课程详情', [formRow('上课时间', '周一 3—4 节'), formRow('地点', '教二 105')])
            ], null);
          },
          function (ctx) {
            var cap = ctx.capability || 'generic';
            if (cap === 'link') {
              var bc = d('breadcrumb');
              bc.appendChild(sp('bc-item', '首页'));
              bc.appendChild(sp('bc-sep', '/'));
              bc.appendChild(sp('bc-item is-hot', '学习方法导论'));
              return frame(ctx.mobile, [bc, courseHead('学习方法导论', 'DEMO101')], null);
            }
            return frame(ctx.mobile, [
              courseHead('学习方法导论', 'DEMO101'),
              overlayPanel('课程详情', [
                formRow('上课时间', '周一 3—4 节'),
                formRow('地点', '教二 105'),
                noteLine('能否直达资料取决于培养层次、课表格式和课程匹配。')
              ])
            ], null);
          }
        ]
      };
    },

    // courses-manual · 10s · A 管理菜单 → B 表单 → C 时间留空 + 保存 → D 新卡片
    coursesManual: function () {
      return {
        moves: [{ target: 'mi-manual' }, null, { target: 'btn-save-course' }, null],
        frames: [
          function (ctx) {
            return frame(ctx.mobile, [
              seg(['课程列表', '周课表'], 0),
              (function () {
                var list = d('ccards');
                var c = d('ccard');
                c.appendChild(d('ccard-name', '高等数学 B'));
                c.appendChild(sp('codechip', 'DEMO102'));
                list.appendChild(c);
                return list;
              })(),
              menuPanel(['导入课表', '手动添加课程', '外观设置'], { activeIdx: 1, marks: [null, 'mi-manual', null] })
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('手动添加课程', [
                formRow('课程名称', '书法入门'),
                formRow('学期', '2025 秋季'),
                formRow('上课时间', null, { placeholder: '可不填' })
              ])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('手动添加课程', [
                formRow('课程名称', '书法入门'),
                formRow('上课时间', null, { placeholder: '留空', note: '自学 / 补修可不填' }),
                noteLine('没有排课时间的课程，也能加入课程列表。')
              ], [btn('保存', { primary: true, mark: 'btn-save-course' })])
            ], null);
          },
          function (ctx) {
            var list = d('ccards');
            var c1 = d('ccard');
            c1.appendChild(d('ccard-name', '书法入门'));
            c1.appendChild(sp('codechip', '自学'));
            c1.appendChild(pill('已添加', 'success'));
            c1.classList.add('is-new');
            list.appendChild(c1);
            var c2 = d('ccard');
            c2.appendChild(d('ccard-name', '高等数学 B'));
            c2.appendChild(sp('codechip', 'DEMO102'));
            list.appendChild(c2);
            return frame(ctx.mobile, [
              seg(['课程列表', '周课表'], 0),
              list,
              noteLine('自学课程不会出现在周课表中。')
            ], null);
          }
        ]
      };
    },

    // courses-terms · 10s · A 切换面板 → B 点导入为新课表 → C 新课表生效 → D 切回旧课表
    coursesTerms: function () {
      function termPanel(activeOld, withNew, hotOld) {
        var box = d('terms');
        var old = d('term-row' + (activeOld ? ' is-active' : '') + (hotOld ? ' is-hot' : ''));
        mark('term-old', old);
        old.appendChild(d('term-name', '上学期'));
        old.appendChild(sp('term-note', '示例名称'));
        box.appendChild(old);
        if (withNew) {
          var nw = d('term-row' + (activeOld ? '' : ' is-active'));
          nw.appendChild(d('term-name', '新课表'));
          box.appendChild(nw);
        }
        var actions = d('term-actions');
        actions.appendChild(btn('重新导入', { small: true, dim: true }));
        actions.appendChild(btn('导入为新课表', { small: true, primary: true, mark: 'btn-newterm' }));
        box.appendChild(actions);
        return box;
      }
      function cardsFor(kind) {
        var list = d('ccards');
        (kind === 'new' ? ['概率论与数理统计 · DEMO104', '大学物理 · DEMO105', '数据结构 · DEMO106'] : ['学习方法导论 · DEMO101', '高等数学 B · DEMO102', '体育（三） · DEMO103'])
          .forEach(function (s) {
            var parts = s.split(' · ');
            var c = d('ccard');
            c.appendChild(d('ccard-name', parts[0]));
            c.appendChild(sp('codechip', parts[1]));
            list.appendChild(c);
          });
        return list;
      }
      return {
        moves: [{ target: 'btn-newterm' }, null, { target: 'term-old' }, null],
        frames: [
          function (ctx) { return frame(ctx.mobile, [termPanel(true, false, false), cardsFor('old')], null); },
          function (ctx) { return frame(ctx.mobile, [termPanel(true, true, false), cardsFor('old'), noteLine('选择“导入为新课表”，而不是重新导入。')], null); },
          function (ctx) { return frame(ctx.mobile, [termPanel(false, true, false), cardsFor('new')], null); },
          function (ctx) { return frame(ctx.mobile, [termPanel(true, true, true), cardsFor('old')], null); }
        ]
      };
    },

    // save-course · 10s · 核心 · A 星标 → B 已收藏 → C 我的收藏 → D 打开课程
    saveCourse: function () {
      function treeLeaf(filled) {
        var box = d('treeleaf');
        box.appendChild(sp('treeleaf-path', '专业课 / 示例学院 / 示例专业'));
        var row = d('frow is-hot');
        row.appendChild(d('frow-title', '学习方法导论'));
        row.appendChild(sp('codechip', 'DEMO101'));
        row.appendChild(star(filled, 'star'));
        box.appendChild(row);
        return box;
      }
      function favRow(markName, withPill) {
        var row = d('frow is-hot');
        if (markName) mark(markName, row);
        row.appendChild(exGlyph('pdf'));
        row.appendChild(d('frow-title', '学习方法导论'));
        row.appendChild(sp('codechip', 'DEMO101'));
        if (withPill) row.appendChild(pill('已收藏', 'star'));
        return row;
      }
      return {
        moves: [{ target: 'star' }, { target: 'avatar' }, { target: 'fav-course-row' }, null],
        frames: [
          function (ctx) { return frame(ctx.mobile, [treeLeaf(false), d('lead', '课程旁有一颗空心星标')], null); },
          function (ctx) {
            var content = [treeLeaf(true), pill('已收藏', 'star'), d('lead', '再点一次可取消收藏')];
            if (ctx.mobile) {
              var head = d('favhead');
              head.appendChild(avatar('avatar'));
              head.appendChild(d('favhead-name', '示例同学'));
              return phone([head].concat(content));
            }
            return shell({ avatarMark: 'avatar', nav: -1 }, content);
          },
          function (ctx) {
            var head = d('favhead');
            head.appendChild(avatar('avatar'));
            head.appendChild(d('favhead-name', '示例同学'));
            return frame(ctx.mobile, [
              head,
              favTabs(0, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']),
              favRow('fav-course-row', true)
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              courseHead('学习方法导论', 'DEMO101'),
              fileRow({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', downloads: '86' }),
              fileRow({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', downloads: '40' }),
              noteLine('从“我的收藏 → 课程”随时回到这里。')
            ], null);
          }
        ]
      };
    },

    // save-file · 8s · A 详情 → B 已收藏 → C 收藏页文件 → D 回到详情
    saveFile: function () {
      function detail(favorited) {
        var detail = d('detail');
        var head = d('detail-head');
        head.appendChild(exGlyph('pdf'));
        var info = d('detail-info');
        info.appendChild(d('detail-title', '期末复习提纲.pdf'));
        info.appendChild(d('detail-meta', '学习方法导论 · DEMO101'));
        head.appendChild(info);
        head.appendChild(favorited ? star(true, null) : star(false, 'star'));
        detail.appendChild(head);
        if (favorited) detail.appendChild(pill('已收藏', 'star'));
        return detail;
      }
      return {
        moves: [{ target: 'star' }, { target: 'avatar' }, { target: 'fav-file-row' }, null],
        frames: [
          function (ctx) { return frame(ctx.mobile, [detail(false), d('lead', '觉得有用，先收藏起来')], null); },
          function (ctx) {
            var content = [detail(true), d('lead', '状态变为“已收藏”')];
            if (ctx.mobile) {
              var head = d('favhead');
              head.appendChild(avatar('avatar'));
              head.appendChild(d('favhead-name', '示例同学'));
              return phone([head].concat(content));
            }
            return shell({ avatarMark: 'avatar', nav: -1 }, content);
          },
          function (ctx) {
            var head = d('favhead');
            head.appendChild(avatar('avatar'));
            head.appendChild(d('favhead-name', '示例同学'));
            var row = d('frow is-hot');
            mark('fav-file-row', row);
            row.appendChild(exGlyph('pdf'));
            row.appendChild(d('frow-title', '期末复习提纲.pdf'));
            row.appendChild(d('frow-meta', '学习方法导论 · DEMO101'));
            return frame(ctx.mobile, [head, favTabs(1, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']), row], null);
          },
          function (ctx) { return frame(ctx.mobile, [detail(true), noteLine('点开收藏的资料，回到详情。')], null); }
        ]
      };
    },

    // save-answer · 10s · A 两条回答 → B 收藏回答 → C 收藏页帖子 → D 回到回答位置
    saveAnswer: function () {
      function answers(favorited) {
        var a1 = answerCard({
          author: '示例同学', mark: 'ans-fav', hot: favorited,
          lines: ['先按章节整理错题，再按优先级复习。', '考前两周开始过第二遍。'],
          actions: [{ label: favorited ? '已收藏' : '收藏', mark: 'ans-fav', on: favorited }, { label: '点赞 6' }]
        });
        var a2 = answerCard({
          author: '另一位同学',
          lines: ['建议组队互相讲题，效率更高。'],
          actions: [{ label: '收藏' }, { label: '点赞 3' }]
        });
        return [a1, a2];
      }
      return {
        moves: [{ target: 'ans-fav' }, { target: 'avatar' }, { target: 'fav-post-row' }, null],
        frames: [
          function (ctx) {
            var items = answers(false);
            return frame(ctx.mobile, [
              qCard({ title: '如何安排期末复习？', meta: '示例同学 提问 · 2 条回答' }),
              d('lead', '同一条问题下有多条回答')
            ].concat(items), null);
          },
          function (ctx) {
            var head = d('favhead');
            head.appendChild(avatar('avatar'));
            head.appendChild(d('favhead-name', '示例同学'));
            var items = answers(true);
            return frame(ctx.mobile, [head, items[0], items[1], noteLine('只收藏这一条回答，而不是整个问题。')], null);
          },
          function (ctx) {
            var row = d('frow is-hot');
            mark('fav-post-row', row);
            row.appendChild(exGlyph('txt'));
            var info = d('frow-info');
            info.appendChild(d('frow-title', '如何安排期末复习？'));
            info.appendChild(d('frow-meta', '示例同学 的回答：先按章节整理错题……'));
            row.appendChild(info);
            var head = d('favhead');
            head.appendChild(avatar('avatar'));
            head.appendChild(d('favhead-name', '示例同学'));
            return frame(ctx.mobile, [head, favTabs(2, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']), row], null);
          },
          function (ctx) {
            var items = answers(true);
            return frame(ctx.mobile, [
              qCard({ title: '如何安排期末复习？', meta: '示例同学 提问 · 2 条回答' }),
              items[0],
              items[1],
              noteLine('点开收藏，回到回答所在位置。')
            ], null);
          }
        ]
      };
    },

    // save-retrieve · 10s · A 菜单 → B 课程标签 → C 文件标签 → D 帖子标签
    saveRetrieve: function () {
      function favhead() {
        var head = d('favhead');
        head.appendChild(avatar('avatar'));
        head.appendChild(d('favhead-name', '示例同学'));
        return head;
      }
      function favRowOf(kind) {
        var row = d('frow is-hot');
        if (kind === 'course') {
          row.appendChild(d('frow-title', '学习方法导论'));
          row.appendChild(sp('codechip', 'DEMO101'));
        } else if (kind === 'file') {
          row.appendChild(exGlyph('pdf'));
          row.appendChild(d('frow-title', '期末复习提纲.pdf'));
          row.appendChild(d('frow-meta', '学习方法导论 · DEMO101'));
        } else {
          row.appendChild(exGlyph('txt'));
          row.appendChild(d('frow-title', '如何安排期末复习？'));
          row.appendChild(d('frow-meta', '示例同学 的回答摘要'));
        }
        return row;
      }
      return {
        moves: [{ target: 'mi-fav2' }, { target: 'fav-tab-file' }, { target: 'fav-tab-post' }, null],
        frames: [
          function (ctx) {
            return frame(ctx.mobile, [
              favhead(),
              menuPanel(['通知中心', '我的上传', '我的收藏', '个人中心'], { activeIdx: 2, marks: [null, null, 'mi-fav2', null] })
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [favhead(), favTabs(0, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']), favRowOf('course')], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [favhead(), favTabs(1, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']), favRowOf('file')], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [favhead(), favTabs(2, ['fav-tab-course', 'fav-tab-file', 'fav-tab-post']), favRowOf('post'), noteLine('课程、资料和问答收藏都在这里。')], null);
          }
        ]
      };
    },

    // share-file · 12s · A 上传入口 → B 选择文件 → C 补齐字段 → D 待审核
    shareFile: function () {
      return {
        moves: [{ target: 'btn-upload' }, null, { target: 'btn-upload-submit' }, null],
        frames: [
          function (ctx) {
            var head = courseHead('学习方法导论', 'DEMO101');
            head.appendChild(btn('上传资料', { primary: true, small: true, mark: 'btn-upload' }));
            return frame(ctx.mobile, [
              head,
              fileRow({ title: '期末复习提纲.pdf', meta: '示例同学 · 收藏 12', downloads: '86' }),
              fileRow({ title: '平时作业参考.pdf', meta: '另一位同学 · 收藏 5', downloads: '40' })
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('上传资料 · 学习方法导论', [
                formRow('文件', '期末复习提纲.pdf'),
                noteLine('示例使用已选好的文件；真实上传时会打开文件选择器。')
              ])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('上传资料 · 学习方法导论', [
                formRow('文件', '期末复习提纲.pdf'),
                formRow('资料类型', '笔记'),
                formRow('任课教师', '示例老师'),
                formRow('简介', '按周整理的复习要点。', { area: true })
              ], [btn('开始上传', { primary: true, mark: 'btn-upload-submit' })])
            ], null);
          },
          function (ctx) {
            var ok = overlayPanel('已提交', [
              pill('待审核', 'pending'),
              d('panel-text', '普通用户上传后进入审核队列，通过后对所有人可见。'),
              noteLine('审核进度可在“我的上传”查看。')
            ], [btn('查看我的上传', { small: true })]);
            return frame(ctx.mobile, [ok], null);
          }
        ]
      };
    },

    // share-text · 10s · 核心 · A 上传窗口 → B 文字录入 → C 输入内容 → D 待审核
    shareText: function () {
      return {
        moves: [{ target: 'tab-text' }, null, { target: 'btn-text-submit' }, null],
        frames: [
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('上传资料 · 学习方法导论', [
                seg(['上传文件', '文字录入'], 0, ['tab-file', 'tab-text']),
                formRow('文件', null, { placeholder: '选择文件…' })
              ])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('上传资料 · 学习方法导论', [
                seg(['上传文件', '文字录入'], 1, ['tab-file', 'tab-text']),
                formRow('标题', null, { placeholder: '给这份资料起个标题…' }),
                formRow('内容', null, { placeholder: '在此输入文字内容…', area: true })
              ])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('上传资料 · 学习方法导论', [
                seg(['上传文件', '文字录入'], 1),
                formRow('标题', '我的复习顺序'),
                formRow('内容', '先整理错题，再按优先级过第二遍。', { area: true }),
                formRow('资料类型', '笔记'),
                formRow('任课教师', '示例老师')
              ], [btn('开始上传', { primary: true, mark: 'btn-text-submit' })])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('已提交', [
                pill('待审核', 'pending'),
                d('panel-text', '文字会保存为 .txt 资料，同样进入审核队列。')
              ], [btn('查看我的上传', { small: true })])
            ], null);
          }
        ]
      };
    },

    // share-course · 12s · A 新建入口 → B 名称代码 → C 归属选择 → D 待审核摘要
    shareCourse: function () {
      return {
        moves: [{ target: 'btn-newcourse' }, null, { target: 'btn-course-submit' }, null],
        frames: [
          function (ctx) {
            var panel = overlayPanel('上传资料', [
              formRow('课程', null, { placeholder: '搜索课程名称或代码…' }),
              d('panel-text', '没有要找的课程？可以申请新建。')
            ], [btn('新建课程', { primary: true, mark: 'btn-newcourse' })]);
            return frame(ctx.mobile, [panel], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('新建课程申请', [
                formRow('课程名称', '海洋科学导论'),
                formRow('课程代码', 'DEMO202')
              ])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('新建课程申请', [
                formRow('课程类型', '专业课'),
                formRow('学院', '示例学院'),
                formRow('专业', '示例专业'),
                formRow('归属层级', '专业课'),
                noteLine('随附资料为选填；如果课程已存在，会提示进入已有课程。')
              ], [btn('提交申请', { primary: true, mark: 'btn-course-submit' })])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('申请已提交', [
                pill('待审核', 'pending'),
                checkRow('海洋科学导论 · DEMO202', true),
                checkRow('归属：示例学院 / 示例专业', true),
                d('panel-text', '管理员审核通过后，课程会出现在目录中。')
              ])
            ], null);
          }
        ]
      };
    },

    // share-review · 8s · A 我的上传 → B 审核中 → C 已发布 → D 通知提示
    shareReview: function () {
      function uploadRow(title, kind, markName) {
        var row = d('frow' + (markName ? ' is-hot' : ''));
        if (markName) mark(markName, row);
        row.appendChild(exGlyph('pdf'));
        row.appendChild(d('frow-title', title));
        row.appendChild(pill(kind === 'pending' ? '待审核' : (kind === 'published' ? '已发布' : '已驳回'), kind));
        return row;
      }
      function favhead() {
        var head = d('favhead');
        head.appendChild(avatar('avatar'));
        head.appendChild(d('favhead-name', '示例同学'));
        return head;
      }
      return {
        moves: [{ target: 'mi-uploads' }, { target: 'mu-tab-published' }, null, null],
        frames: [
          function (ctx) {
            return frame(ctx.mobile, [
              favhead(),
              menuPanel(['通知中心', '我的上传', '我的收藏'], { activeIdx: 1, marks: [null, 'mi-uploads', null] })
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              favhead(),
              seg(['已发布', '审核中', '已驳回'], 1, ['mu-tab-published', 'mu-tab-pending', null]),
              uploadRow('期末复习提纲.pdf', 'pending', 'mu-row-pending'),
              noteLine('“审核中”显示等待审核的资料。')
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              favhead(),
              seg(['已发布', '审核中', '已驳回'], 0, ['mu-tab-published', 'mu-tab-pending', null]),
              uploadRow('课堂笔记.pdf', 'published'),
              noteLine('“已发布”是另一份资料——审核不是自动通过的。')
            ], null);
          },
          function (ctx) {
            var head = favhead();
            var bell = sp('bell is-hot', '🔔');
            head.appendChild(bell);
            return frame(ctx.mobile, [
              head,
              seg(['已发布', '审核中', '已驳回'], 0, ['mu-tab-published', 'mu-tab-pending', null]),
              uploadRow('课堂笔记.pdf', 'published'),
              noteLine('审核消息也会发到通知中心。')
            ], null);
          }
        ]
      };
    },

    // share-resubmit · 10s · A 已驳回 → B 展开原因 → C 修改重交 → D 回到待审核
    shareResubmit: function () {
      function row(hot) {
        var r = d('frow' + (hot ? ' is-hot' : ''));
        if (hot) mark('row-reject', r);
        r.appendChild(exGlyph('pdf'));
        r.appendChild(d('frow-title', '期末复习提纲.pdf'));
        r.appendChild(pill('已驳回', 'danger'));
        return r;
      }
      return {
        moves: [{ target: 'row-reject' }, { target: 'btn-resubmit' }, { target: 'btn-resubmit-submit' }, null],
        frames: [
          function (ctx) {
            return frame(ctx.mobile, [
              seg(['已发布', '审核中', '已驳回'], 2),
              row(true),
              noteLine('切到“已驳回”标签查看被退回的资料。')
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              seg(['已发布', '审核中', '已驳回'], 2),
              row(true),
              overlayPanel('驳回原因', [
                d('panel-text', '请补充资料说明。'),
                noteLine('原因保持可读，按提示修改即可重新提交。')
              ], [btn('重新上传', { primary: true, small: true, mark: 'btn-resubmit' })])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('重新上传 · 期末复习提纲.pdf', [
                formRow('资料说明', '按周整理的复习要点，覆盖第 1—8 周。', { area: true })
              ], [btn('提交', { primary: true, mark: 'btn-resubmit-submit' })])
            ], null);
          },
          function (ctx) {
            var r = d('frow is-hot');
            r.appendChild(exGlyph('pdf'));
            r.appendChild(d('frow-title', '期末复习提纲.pdf'));
            r.appendChild(pill('待审核', 'pending'));
            return frame(ctx.mobile, [
              seg(['已发布', '审核中', '已驳回'], 1),
              r,
              noteLine('状态恢复为待审核，不演示自动通过。')
            ], null);
          }
        ]
      };
    },

    // qa-search · 10s · A 搜索 → B 结果 → C 详情 → D 命中位置
    qaSearch: function () {
      return {
        moves: [{ target: 'qa-search-go' }, { target: 'qa-res-1' }, null, null],
        frames: [
          function (ctx) {
            return frame(ctx.mobile, [
              appbar({ placeholder: '搜索问题、回答…', searchText: '期末复习', searchMark: 'qa-search-go', mobile: ctx.mobile, noSearch: false }),
              d('lead', '进入问答区后，搜索框会自动切换为搜索问题和回答')
            ], null);
          },
          function (ctx) {
            var r1 = qCard({ title: '如何安排期末复习？', meta: '12 条回答 · 3 天前', mark: 'qa-res-1', hot: true });
            var r2 = qCard({ title: '期末复习资料哪里找？', meta: '5 条回答 · 1 周前' });
            return frame(ctx.mobile, [sp('cap-label', '问题'), r1, r2], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              qCard({ title: '如何安排期末复习？', meta: '示例同学 提问 · 12 条回答' }),
              answerCard({
                author: '示例同学', hot: true,
                lines: ['先按章节整理错题，再按优先级复习。'],
                actions: [{ label: '点赞 6' }]
              }),
              answerCard({ author: '另一位同学', lines: ['组队互相讲题效率更高。'], actions: [{ label: '点赞 3' }] })
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              qCard({ title: '如何安排期末复习？', meta: '示例同学 提问 · 12 条回答' }),
              answerCard({
                author: '示例同学', hot: true,
                lines: ['先按章节整理错题，再按优先级复习。', '命中“期末复习”的回答在此突出显示。'],
                actions: [{ label: '点赞 6' }]
              }),
              answerCard({ author: '另一位同学', lines: ['组队互相讲题效率更高。'], actions: [{ label: '点赞 3' }] })
            ], null);
          }
        ]
      };
    },

    // qa-tags · 8s · A 筛选展开 → B 一级 → 二级 → C 列表收窄 → D 清除筛选
    qaTags: function () {
      return {
        moves: [{ target: 'qa-filter' }, { target: 'qa-l1' }, { target: 'qa-l2' }, null],
        frames: [
          function (ctx) {
            var bar = d('chipbar');
            bar.appendChild(chip('筛选 ⌄', { mark: 'qa-filter' }));
            bar.appendChild(chip('最新提问', {}));
            return frame(ctx.mobile, [bar, qCard({ title: '如何安排期末复习？', meta: '12 条回答' }), qCard({ title: '怎么选通识课？', meta: '8 条回答' })], null);
          },
          function (ctx) {
            var bar = d('chipbar');
            bar.appendChild(chip('筛选 ⌄', { active: true, mark: 'qa-filter' }));
            bar.appendChild(chip('最新提问', {}));
            var tags = d('tagpanel');
            tags.appendChild(sp('cap-label', '一级标签'));
            tags.appendChild(chip('课程学习', { active: true, mark: 'qa-l1' }));
            tags.appendChild(chip('校园生活'));
            tags.appendChild(chip('选课'));
            tags.appendChild(sp('cap-label', '二级标签'));
            tags.appendChild(chip('期末复习'));
            tags.appendChild(chip('笔记方法'));
            return frame(ctx.mobile, [bar, tags], null);
          },
          function (ctx) {
            var bar = d('chipbar');
            bar.appendChild(chip('筛选 ⌄', { active: true }));
            bar.appendChild(chip('最新提问', { active: true }));
            var tags = d('tagpanel');
            tags.appendChild(sp('cap-label', '已选'));
            tags.appendChild(chip('课程学习 / 期末复习', { active: true, mark: 'qa-l2' }));
            return frame(ctx.mobile, [bar, tags, qCard({ title: '如何安排期末复习？', meta: '12 条回答' }), noteLine('列表只剩相关讨论。')], null);
          },
          function (ctx) {
            var bar = d('chipbar');
            bar.appendChild(chip('清除筛选', { mark: 'qa-clear', active: false }));
            bar.appendChild(chip('课程学习 / 期末复习', { active: true }));
            bar.appendChild(chip('最新提问', { active: true }));
            return frame(ctx.mobile, [bar, qCard({ title: '如何安排期末复习？', meta: '12 条回答' }), noteLine('已选标签与排序同时可见，随时可清除。')], null);
          }
        ]
      };
    },

    // qa-ask · 12s · A 入口 → B 标题 → C 正文与标签 → D 待审核
    qaAsk: function () {
      return {
        moves: [{ target: 'btn-ask' }, null, { target: 'btn-ask-submit' }, null],
        frames: [
          function (ctx) {
            var head = d('qahead');
            head.appendChild(d('qahead-title', '问答区'));
            head.appendChild(btn('我要提问', { primary: true, small: true, mark: 'btn-ask' }));
            return frame(ctx.mobile, [
              head,
              qCard({ title: '怎么选通识课？', meta: '8 条回答' }),
              qCard({ title: '图书馆怎么预约？', meta: '4 条回答' })
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('发布问题', [
                formRow('标题', '期末复习应该如何分配时间？')
              ])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('发布问题', [
                formRow('标题', '期末复习应该如何分配时间？'),
                formRow('正文', '我先把错题过了一遍，但时间还是不够用，大家怎么安排？', { area: true }),
                (function () {
                  var tags = d('tagpanel');
                  tags.appendChild(sp('cap-label', '标签'));
                  tags.appendChild(chip('课程学习 / 期末复习', { active: true }));
                  return tags;
                })()
              ], [btn('提交', { primary: true, mark: 'btn-ask-submit' })])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('已提交', [
                pill('待审核', 'pending'),
                d('panel-text', '普通用户发布的问题会先进入审核，通过后其他人才能看到。')
              ])
            ], null);
          }
        ]
      };
    },

    // qa-answer · 10s · A 写回答 → B 编辑器 → C 内容 → D 待审核
    qaAnswer: function () {
      return {
        moves: [{ target: 'btn-answer' }, null, { target: 'btn-answer-submit' }, null],
        frames: [
          function (ctx) {
            return frame(ctx.mobile, [
              qCard({ title: '如何安排期末复习？', meta: '示例同学 提问 · 12 条回答' }),
              answerCard({ author: '另一位同学', lines: ['组队互相讲题效率更高。'], actions: [{ label: '点赞 3' }] }),
              btn('写回答', { primary: true, mark: 'btn-answer' })
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('写回答 · 如何安排期末复习？', [
                formRow('内容', null, { placeholder: '写下你的做法…', area: true })
              ])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('写回答 · 如何安排期末复习？', [
                formRow('内容', '先按章节整理错题，再按优先级复习；适合考前两周开始。', { area: true })
              ], [btn('提交回答', { primary: true, mark: 'btn-answer-submit' })])
            ], null);
          },
          function (ctx) {
            return frame(ctx.mobile, [
              overlayPanel('已提交', [
                pill('待审核', 'pending'),
                d('panel-text', '回答进入审核队列，通过后显示在问题下。')
              ])
            ], null);
          }
        ]
      };
    },

    // qa-accept · 8s · A 采纳入口 → B 强调 → C 已采纳 → D 标记保留
    qaAccept: function () {
      function answers(adopted) {
        return [
          answerCard({
            author: '示例同学', hot: adopted, badge: adopted ? pill('已采纳 · 最佳回答', 'success') : null,
            lines: ['先按章节整理错题，再按优先级复习。'],
            actions: adopted ? [] : [{ label: '采纳为最佳回答', mark: 'adopt-btn', primary: true }, { label: '点赞 6' }]
          }),
          answerCard({
            author: '另一位同学',
            lines: ['组队互相讲题效率更高。'],
            actions: [{ label: '点赞 3' }]
          })
        ];
      }
      return {
        moves: [{ target: 'adopt-btn' }, { target: 'adopt-btn', hover: true }, null, null],
        frames: [
          function (ctx) {
            var q = qCard({ title: '如何安排期末复习？', meta: '你提出的问题 · 2 条回答', pill: pill('你提出的问题', 'pending') });
            var items = answers(false);
            return frame(ctx.mobile, [q, items[0], items[1]], null);
          },
          function (ctx) {
            var q = qCard({ title: '如何安排期末复习？', meta: '你提出的问题 · 2 条回答', pill: pill('你提出的问题', 'pending') });
            var items = answers(false);
            items[0].classList.add('is-focus');
            return frame(ctx.mobile, [q, items[0], items[1], noteLine('只有提问者本人能看到采纳按钮。')], null);
          },
          function (ctx) {
            var q = qCard({ title: '如何安排期末复习？', meta: '你提出的问题 · 2 条回答', pill: pill('已采纳', 'success') });
            var items = answers(true);
            return frame(ctx.mobile, [q, items[0], items[1]], null);
          },
          function (ctx) {
            var q = qCard({ title: '如何安排期末复习？', meta: '你提出的问题 · 2 条回答', pill: pill('已采纳', 'success') });
            var items = answers(true);
            return frame(ctx.mobile, [q, items[0], items[1], noteLine('回答顺序保持不变，只添加采纳标记。')], null);
          }
        ]
      };
    }
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
      var scene = factory();
      if (!scene || !scene.frames || scene.frames.length !== 4) return null;
      return scene;
    },
    thumb: thumbSvg
  };
})();
