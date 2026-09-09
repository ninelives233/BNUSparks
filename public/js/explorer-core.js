/* BNU Sparks · explorer-core.js —— 共享核心：状态/常量/课程树/收藏/面包屑/导航。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
  function findPathByCourseId(code) {
    // v183：收集全部匹配路径，按「本人专业 → 本人学院 → 默认首条」优先。
    // path 结构：专业课 = [专业课, 学院, 专业, 课程]；通识课 = [通识课, 分类, 课程]。
    var matches = [];
    function walk(nodes, path) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        // courseCodes：同名同位不同码合并叶子的全部代码（任一代码都指向主目录）
        if (n.courseId === code || (n.courseCodes && n.courseCodes.indexOf(code) >= 0)) {
          matches.push(path.concat(n.name));
        }
        if (n.children) walk(n.children, path.concat(n.name));
      }
    }
    for (var key in (courseTree || {})) {
      if (courseTree[key] && courseTree[key].children) {
        walk(courseTree[key].children, [key]);
      }
    }
    if (!matches.length) return null;
    // 身份优先：仅对专业课路径生效；未设身份或匹配不到则回退默认首条
    var idMaj = currentUser && currentUser.identity_major;
    var idCol = currentUser && currentUser.identity_college;
    if (idMaj || idCol) {
      for (var m = 0; m < matches.length; m++) {
        var p = matches[m];
        if (p[0] === '专业课' && idMaj && p.length >= 4 && p[2] === idMaj) return p;
      }
      for (var n2 = 0; n2 < matches.length; n2++) {
        var q = matches[n2];
        if (q[0] === '专业课' && idCol && q.length >= 3 && q[1] === idCol) return q;
      }
    }
    return matches[0];
  }

  function navToLast(code) {
    // explorer-render 是懒加载模块：renderExplorer 就绪前定位会直接
    // ReferenceError（搜索结果/首页卡片点不动的根因），统一等模块就绪再定位。
    // 就绪回调按注册顺序执行：showExplorer 先注册的根渲染先跑，定位后跑，
    // 天然避免定位被「课程目录加载中…」的异步根渲染覆盖。
    var locate = function () {
      _ensureCourseTreeReady().then(function () {
        const path = findPathByCourseId(code);
        if (!path) return;
        expPath = path;
        pushViewState('explorer', { expPath: [...expPath] }, true);
        renderExplorer();
      }).catch(function () {});
    };
    if (typeof ensureFeature === 'function') {
      ensureFeature('explorer').then(locate, locate);
    } else {
      locate();
    }
  }

  // 「打开板块 + 定位课程」一步式入口（搜索结果/首页卡片/同名课程侧栏等外部跳转）。
  // 树中能定位到课程时直接进入资料列表，不走 showExplorer 的板块根渲染——
  // 两者的异步渲染会互相覆盖（后注册的根渲染会把已定位的 expPath 冲回根）。
  // 首次从首页/排行榜进入时，必须先等 explorer 和课程树都就绪再查路径。
  function navToCourse(type, code) {
    var rootType = type === '通识课' ? '通识课' : '专业课';
    var fallback = function () {
      if (typeof showExplorer === 'function') showExplorer(rootType);
      navToLast(code);
    };
    var go = function () {
      var path = null;
      try { path = findPathByCourseId(code); } catch (e) { path = null; }
      if (!path) { fallback(); return; }
      expPath = path;
      pushViewState('explorer', { expPath: [...expPath] });
      switchView('explorer');
      renderExplorer();
      if (typeof updateSidebar === 'function') {
        updateSidebar(path[0] === '通识课' ? 'general' : 'major');
      }
    };
    // explorer-render 是懒加载模块；课程树也只在进入 explorer 时按需加载。
    // 两者都准备好后再执行 go，避免首点时 findPathByCourseId 在 null 上查询，
    // 随后又被 showExplorer 的异步根渲染覆盖。
    var ready = typeof ensureFeature === 'function'
      ? ensureFeature('explorer')
      : Promise.resolve();
    ready.then(function () {
      return _ensureCourseTreeReady();
    }).then(go, fallback);
  }

  var _fdBreadcrumbPath = null;

  function navToFdBreadcrumbDepth(depth) {
    var path = _fdBreadcrumbPath;
    if (!path || !path.length) return;
    expPath = path.slice(0, depth);
    // 验证路径在课程树中是否存在
    var node = getNode(expPath);
    if (!node) {
      // 路径无效时，尝试通过课程代码在树中找到正确路径
      var code = _currentDetailFile && _currentDetailFile.course_code;
      if (code) {
        var found = findPathByCourseId(code);
        if (found && found.length >= depth) {
          expPath = found.slice(0, depth);
          node = getNode(expPath);
        }
      }
      // 仍无效，回退到根分类
      if (!node && path.length > 0) {
        expPath = [path[0]];
      }
    }
    pushViewState('explorer', { expPath: [...expPath] }, true);
    switchView('explorer');
    renderExplorer();
  }

  /* ═══════════════════════════════════════════════════════════
     API：课程文件
     ═══════════════════════════════════════════════════════════ */

  const MATERIAL_TYPES = [
    { id: 1, name: '课本' },
    { id: 2, name: '习题' },
    { id: 3, name: '真题' },
    { id: 4, name: '课件' },
    { id: 5, name: '笔记' },
    { id: 6, name: '汇总' },
    { id: 7, name: '其他' },
  ];

  // 文件详情页 SVG 图标
  const FD_ICONS = {
    file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    tag: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    storage: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    teacher: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 3 3 6 3s6-1 6-3v-5"/></svg>',
    download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    star: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    starFilled: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#F5A623" stroke="#F5A623" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    report: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  };

  // 举报原因（与后端 REPORT_REASON_LABELS 一致）
  var _REPORT_GROUPS = [
    { title: '安全与合规', items: ['political', 'privacy', 'malware'] },
    { title: '学术诚信', items: ['cheating', 'impersonation', 'suspicious'] },
    { title: '内容质量', items: ['duplicate', 'incomplete', 'error', 'irrelevant', 'outdated', 'scan-quality'] },
    { title: '版权与广告', items: ['copyright', 'ads', 'watermark'] },
    { title: '其他', items: ['other'] },
  ];
  var _REPORT_ITEM_META = {
    political: { label: '内容违规', desc: '含有政治敏感或违规信息' },
    privacy: { label: '隐私泄露', desc: '包含个人敏感信息（姓名、学号、成绩等）' },
    malware: { label: '恶意文件', desc: '文件无法打开、疑似病毒或含有钓鱼链接' },
    cheating: { label: '作弊风险', desc: '涉及未结束考试内容或疑似泄题' },
    impersonation: { label: '冒充身份', desc: '非本人/非教学团队冒充老师、助教或学长发布' },
    suspicious: { label: '来源可疑', desc: '资料来源不明确，无法验证真实性' },
    duplicate: { label: '重复低质', desc: '与已有资料重复或质量低下' },
    incomplete: { label: '资料不完整', desc: '文件缺页、内容残缺或章节缺失' },
    error: { label: '内容错误', desc: '存在明显学术性错误（公式、概念、答案等）', field: { id: 'rdFieldError', inputId: 'rdInputError', label: '请指出具体错误位置（页码/题号/公式编号等）', ph: '例如：第3页第2题，答案应为...' } },
    irrelevant: { label: '与课程无关', desc: '资料与标注的课程、老师或学期不符', field: { id: 'rdFieldIrrelevant', inputId: 'rdInputIrrelevant', label: '该资料实际属于哪个课程？', ph: '例如：高等数学A（2024春）' } },
    outdated: { label: '版本过时', desc: '教材已更新多版，内容严重滞后可能误导同学' },
    'scan-quality': { label: '扫描/排版极差', desc: '字迹模糊、缺页乱序、OCR错误严重到影响阅读' },
    copyright: { label: '版权侵权', desc: '涉及未经授权的版权内容' },
    ads: { label: '含有广告', desc: '包含引流、推广或商业二维码' },
    watermark: { label: '商业水印', desc: '存在第三方平台标识或机构推广信息' },
    other: { label: '其他原因', desc: '不属于以上任何类别，请在下方详细说明' },
  };

  const CARD_ICONS = {
    'folder': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h7l2 3h9v11H3V5z"/></svg>',
    'book': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/><path d="M8 8h3M8 11h3"/></svg>',
    'runner': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="8" width="6" height="8" rx="1.5"/><rect x="4" y="5" width="5" height="14" rx="2"/><rect x="15" y="5" width="5" height="14" rx="2"/></svg>',
    'shield': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l7-3 7 3v6c0 5-4 8-7 10-3-2-7-5-7-10V5z"/><line x1="12" y1="8" x2="12" y2="13"/></svg>',
    'globe': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3" y1="12" x2="21" y2="12"/></svg>',
    'board': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14v9H5z"/><path d="M5 8l7-3 7 3"/><path d="M16 17l2 4"/><path d="M8 17l-2 4"/><line x1="8" y1="11" x2="11" y2="11"/><line x1="8" y1="14" x2="13" y2="14"/></svg>',
    'star': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.5,8.5 22,9.5 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9.5 8.5,8.5"/></svg>',
    'diamond': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,3 21,12 12,21 3,12" opacity="0.3"/><polygon points="12,7 17,12 12,17 7,12"/></svg>',
    'graph': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16"/><path d="M8 20v-6h4v6M14 20v-9h4v9"/></svg>',
    'hands': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h18"/><path d="M5 13V5h14v8"/><path d="M9 13v4h6v-4"/><rect x="10" y="9" width="4" height="4" rx="1"/></svg>',
    'scroll': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3h8V3M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 9h8M8 13h5"/></svg>',
    'columns': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="3" rx="0.5"/><rect x="3" y="10" width="18" height="1.5" rx="0.3"/><rect x="5.5" y="11.5" width="3" height="7.5" rx="0.3"/><rect x="10.5" y="11.5" width="3" height="7.5" rx="0.3"/><rect x="15.5" y="11.5" width="3" height="7.5" rx="0.3"/><rect x="3" y="19" width="18" height="2" rx="0.3"/><rect x="2" y="21" width="20" height="2" rx="0.3"/></svg>',
    'scales': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="9"/><line x1="4" y1="9" x2="20" y2="9"/><path d="M4 9L1 17"/><path d="M20 9l3 8"/><path d="M-1 17C-1 20 3 20 3 17"/><path d="M21 17c0 3 4 3 4 0"/></svg>',
    'brush': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18l12-12"/><path d="M18 6l4-4"/><path d="M5 19h8"/><path d="M8 15l-4 4"/></svg>',
    'network': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L22 20H2z"/></svg>',
    'brain': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5L17 5L20 10L16 17L12 23L8 17L4 10L7 5Z"/></svg>',
    'hourglass': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14"/><path d="M5 21h14"/><path d="M6 3v2c0 2 3 4 6 6 3-2 6-4 6-6V3"/><path d="M6 21v-2c0-2 3-4 6-6 3 2 6 4 6 6v2"/></svg>',
    'ai': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20L9.5 4L14 20"/><path d="M7 13L12 13"/><path d="M19 4V20"/><path d="M17 4H21"/><path d="M17 20H21"/></svg>',
    'atom': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2" fill="currentColor"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(-60 12 12)"/></svg>',
    'sigma': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 7V5H6l6 7-6 7h12v-2"/></svg>',
    'cap': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5c0 2 3 3 6 3s6-1 6-3v-5"/><path d="M22 9v5"/></svg>',
    'flask': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 3v4l-5 12a2 2 0 002 2h10a2 2 0 002-2l-5-12V3"/></svg>',
    'dna': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4c4 2 4 6 0 8c4 2 4 6 0 8"/><path d="M16 4c-4 2 -4 6 0 8c-4 2 -4 6 0 8"/><line x1="10" y1="6" x2="14" y2="6"/><line x1="10" y1="11" x2="14" y2="11"/><line x1="10" y1="17" x2="14" y2="17"/></svg>',
    'key': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3.5"/><line x1="12" y1="8.5" x2="12" y2="21"/><line x1="12" y1="21" x2="9" y2="21"/><line x1="12" y1="18" x2="9" y2="18"/><line x1="12" y1="15" x2="10" y2="15"/></svg>',
    'leaf': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20C4 12 9 6 17 4c0 9-6 15-13 16z"/><path d="M4 20c7-4 11-8 13-11"/></svg>',
    'trophy': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.2 4h7.6v3.6c0 3.3-1.8 5.6-3.8 5.6s-3.8-2.3-3.8-5.6z"/><path d="M8.2 5.8H6.4c-.8 0-1.2.8-.7 1.6L6.9 9.4"/><path d="M15.8 5.8h1.8c.8 0 1.2.8.7 1.6l-1.2 2"/><path d="M12 13.2v2.6"/><path d="M10.2 15.8h3.6"/><path d="M12 15.8l-1.2 3.6"/><path d="M12 15.8l1.2 3.6"/><path d="M9.4 19.4h5.2"/></svg>',
    'clapper': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7.5a1.5 1.5 0 0 1 1.5-1.5H18a1.5 1.5 0 0 1 1.5 1.5V11H4.5z"/><path d="M4.5 11h15v6.5A1.5 1.5 0 0 1 18 19H6a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M6.5 9.5 5 11"/><path d="M9.5 9.5 8 11"/><path d="M12.5 9.5 11 11"/><path d="M15.5 9.5 14 11"/><path d="M8.5 14.5h5"/></svg>',
  };

  // 已确认的顶层通识分类与学院图标；下级课程卡片继续使用后端 iconClass。
  const CARD_ICON_SYMBOLS = {
    '思想政治理论类': 'ci-ideology',
    '体育与健康类': 'ci-sports',
    '军事理论与军事技能': 'ci-military',
    '大学外语类': 'ci-language',
    '教师素养类': 'ci-teaching',
    '家国情怀与价值理想': 'ci-values',
    '艺术鉴赏与审美体验': 'ci-art',
    '数理基础与科学素养': 'ci-science',
    '社会发展与公民责任': 'ci-society',
    '经典研读与文化传承': 'ci-classics',
    '国际视野与文明对话': 'ci-international',
    '数学类': 'ci-math',
    '实用文件': 'ci-practical',
    '经济与工商管理学院': 'college-economics',
    '法学院': 'college-law',
    '文学院': 'college-literature',
    '社会学院': 'college-sociology',
    '心理学部': 'college-psychology',
    '历史学院': 'college-history',
    '人工智能学院': 'college-ai',
    '物理与天文学院': 'college-physics',
    '化学学院': 'college-chemistry',
    '生命科学学院': 'college-life',
    '政府管理学院': 'college-government',
    '数学科学学院': 'college-math',
    '统计学院': 'college-statistics',
    '地理科学学部': 'college-geography',
    '教育学部': 'college-education',
    '环境学院': 'college-environment',
    '外国语言文学学院': 'college-languages',
    '新闻传播学院': 'college-journalism',
    '哲学学院': 'college-philosophy',
    '马克思主义学院': 'college-marxism',
    '艺术与传媒学院': 'college-media',
    '体育与运动学院': 'college-athletics',
  };

  function cardIconHtml(item) {
    const symbolId = CARD_ICON_SYMBOLS[item.name];
    if (symbolId) {
      return '<svg class="course-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#' + symbolId + '"></use></svg>';
    }
    return CARD_ICONS[item.iconClass] || CARD_ICONS.folder;
  }

  // ── State ──
  let expPath = [];
  // 文件计数已嵌入课程树响应（fileCount），无需单独请求
  let courseTree = null;  // 从 API 动态加载
  let _pendingNavToLastCode = null;
  let highlightFileId = null;  // 从排行榜/最近上传跳转时高亮目标文件
  var returnState = null;      // { view:'home'|'rankings'|'recentAll', scrollY } 供"返回"按钮使用
  // 我收藏的课程代码集合（不进课程树缓存，前端单独拉取）
  let _favoritedCourses = new Set();

  // ── 浏览器历史导航 ──
  let _suppressingPushState = false;
  let _initialNav = true;  // 首次加载用 replaceState 代替 pushState，避免按返回退出网站

  function pushViewState(view, extra, replace) {
    if (_suppressingPushState) return;
    const state = { _bnusparks: true, view, scrollY: window.scrollY, ...extra };
    // 同步写入 URL（v=171 SPA 路由）：每个视图一个可分享/可刷新/可返回的干净路径；
    // drawer 等浮层返回 null → 保持当前 URL
    const url = routeToPath(view, state);
    if (replace) {
      url ? history.replaceState(state, '', url) : history.replaceState(state, '');
    } else {
      url ? history.pushState(state, '', url) : history.pushState(state, '');
    }
    // 同时写入 sessionStorage，刷新后可恢复
    try { sessionStorage.setItem('bnusparks_view', JSON.stringify(state)); } catch(e) {}
  }

  // ── 从后端加载课程导航树 ──
  var _courseTreePromise = null;

  function _courseTreeReady() {
    return !!(courseTree && Object.keys(courseTree).length);
  }

  // 所有外部跳转共用同一条就绪链，避免首次点击时读取到 null/空树。
  function _ensureCourseTreeReady() {
    if (_courseTreeReady()) return Promise.resolve(courseTree);
    return Promise.resolve(loadCourseTree()).then(function () {
      if (!_courseTreeReady()) throw new Error('课程目录为空');
      return courseTree;
    });
  }

  // 首屏与进入课程浏览器可能同时触发加载，避免同页发送两个 751KB 的树请求。
  function loadCourseTree() {
    if (_courseTreePromise) return _courseTreePromise;
    var promise = _loadCourseTree();
    _courseTreePromise = promise;
    promise.then(function() {
      if (_courseTreePromise === promise) _courseTreePromise = null;
    }, function() {
      if (_courseTreePromise === promise) _courseTreePromise = null;
    });
    return promise;
  }

  async function _loadCourseTree() {
    try {
      courseTree = await api('/api/courses/tree/');
      if (typeof buildSameNameMap === 'function') buildSameNameMap();
      if (_pendingNavToLastCode && _courseTreeReady()) {
        var pendingCode = _pendingNavToLastCode;
        _pendingNavToLastCode = null;
        navToLast(pendingCode);
      }
    } catch(e) {
      console.warn('课程树加载失败，使用备用空树', e);
      courseTree = {};
    }
  }

  // 上传/删除/审核等变更后强制刷新课程树：清内存缓存 → 重新拉取 →
  // 重建同名映射 → 若浏览器视图可见则重渲染，目录「暂无资料」即时更新
  async function refreshCourseTree() {
    try {
      clearApiCache('/api/courses/tree/');
      courseTree = await api('/api/courses/tree/');
      if (typeof buildSameNameMap === 'function') buildSameNameMap();
      var expView = document.getElementById('explorerView');
      if (expView && expView.classList.contains('active')) renderExplorer();
    } catch(e) {
      console.warn('课程树刷新失败，保留旧树', e);
    }
  }

  // ── 我的课程收藏 ──
  // 登录后加载收藏课程代码集合；星星状态在本地 Set 维护，树缓存不变
  var _courseFavoritesPromise = null;
  var _courseFavoritesLoaded = false;

  function loadCourseFavorites() {
    if (_courseFavoritesLoaded) return Promise.resolve();
    if (_courseFavoritesPromise) return _courseFavoritesPromise;
    var promise = _loadCourseFavorites();
    _courseFavoritesPromise = promise;
    promise.then(function() {
      _courseFavoritesLoaded = true;
      if (_courseFavoritesPromise === promise) _courseFavoritesPromise = null;
    }, function() {
      if (_courseFavoritesPromise === promise) _courseFavoritesPromise = null;
    });
    return promise;
  }

  async function _loadCourseFavorites() {
    try {
      var d = await api('/api/user/course-favorites/');
      _favoritedCourses = new Set((d.items || []).map(i => i.course_code));
    } catch(e) { _favoritedCourses = new Set(); }
  }

  async function toggleCourseFavorite(starEl) {
    var code = starEl.getAttribute('data-code');
    if (!code) return;
    try {
      var r = await api('/api/courses/' + encodeURIComponent(code) + '/favorite/', { method: 'POST' });
      if (r.favorited) _favoritedCourses.add(code); else _favoritedCourses.delete(code);
      starEl.classList.toggle('favorited', !!r.favorited);
      starEl.innerHTML = FD_ICONS[r.favorited ? 'starFilled' : 'star'];
    } catch(err) {
      alert('操作失败：' + (err && (err.message || err.error) || '请稍后再试'));
    }
  }

  // ── 同名课程映射 ──
  let sameNameMap = {};

  // 手动补充已知的同名课程
  // 如果你知道某门课在不同专业有不同代码，在这里加上：
  // sameNameExtra["课程名"] = [ { courseId, program, type }, ... ]
  const sameNameExtra = {
  };

  async function buildSameNameMap() {
    const items = [];

    // 遍历课程树，搜集 { name, courseId, type, program }
    // walk 从 val.children 开始：
    //   通识课 depth=0 = 分类（思想政治理论类）
    //   专业课 depth=0 = 学院（经管学院），depth=1 = 专业（金融学）
    function walk(nodes, topType, depth, program) {
      for (const n of nodes) {
        // 叶子：有 courseId 的课程
        if (n.name && n.courseId && !n.courseId.includes('*')) {
          items.push({ name: n.name, courseId: n.courseId, type: topType, program: program || '' });
        }
        // 有子节点且不是数学类 → 继续遍历
        if (n.children && !n.mathCard) {
          let nextProgram = program;
          // 通识课：分类节点在 depth=0
          if (depth === 0 && topType === '通识课' && n.name) {
            nextProgram = n.name;
          // 专业课：专业节点在 depth=1（depth=0 是学院）
          } else if (depth === 1 && topType === '专业课' && n.name) {
            nextProgram = n.name;
          }
          walk(n.children, topType, depth + 1, nextProgram);
        }
      }
    }

    for (const [key, val] of Object.entries(courseTree || {})) {
      const t = key === '通识课' ? '通识课' : '专业课';
      walk(val.children || [], t, 0, '');
    }

    // 补充手动配置
    for (const [name, extras] of Object.entries(sameNameExtra)) {
      extras.forEach(e => {
        if (!items.some(i => i.courseId === e.courseId)) {
          items.push({ name, courseId: e.courseId, type: e.type, program: e.program || '' });
        }
      });
    }

    // 分组 + 去重：同名 >1 不同代码 的保留
    const finalize = (itemList) => {
      const groups = {};
      itemList.forEach(item => {
        if (!groups[item.name]) groups[item.name] = [];
        groups[item.name].push(item);
      });
      const map = {};
      for (const [name, list] of Object.entries(groups)) {
        // 去重（同一课程代码可能出现多次）
        const seen = new Set();
        const deduped = list.filter(i => !seen.has(i.courseId) && seen.add(i.courseId));
        if (deduped.length > 1) {
          deduped.sort((a, b) => a.courseId.localeCompare(b.courseId));
          map[name] = deduped;
        }
      }
      return map;
    };

    sameNameMap = finalize(items);

    // 兜底：仅当课程树为空（未加载/无数据）时才请求 /api/courses/，
    // 正常情况树遍历已覆盖全部课程，省去每次启动的冗余拉取（P3.6）
    if (items.length === 0) {
      try {
        const courses = await api('/api/courses/');
        courses.forEach(c => {
          if (!items.some(i => i.courseId === c.code)) {
            items.push({
              name: c.name, courseId: c.code,
              type: c.course_type === 'general' ? '通识课' : '专业课',
              program: c.college || '',
            });
          }
        });
        sameNameMap = finalize(items);
      } catch(e) { /* ignore */ }
    }
  }

  function getNode(path) {
    if (!path.length || !courseTree) return null;
    let node = courseTree[path[0]];
    if (!node) return null;
    for (let i = 1; i < path.length; i++) {
      if (!node.children) return null;
      node = node.children.find(c => c.name === path[i]);
      if (!node) return null;
    }
    return node;
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;'); }

  // ── Navigation ──
  function navTo(depth) { expPath = expPath.slice(0, depth); pushViewState('explorer', { expPath: [...expPath] }); renderExplorer(); window.scrollTo({ top: 0 }); }
  function navIn(name) {
    const node = getNode(expPath);
    if (!node || !node.children) return;
    const child = node.children.find(c => c.name === name);
    if (!child) return;
    expPath.push(name);
    // 自动跳过单文件夹中间层（专业选修课→专业方向课 → 直接显示方向课的内容）
    let skipNode = child;
    while (skipNode.children && skipNode.children.length === 1 && skipNode.children[0].children) {
      skipNode = skipNode.children[0];
      expPath.push(skipNode.name);
    }
    pushViewState('explorer', { expPath: [...expPath] });
    renderExplorer();
    window.scrollTo({ top: 0 });
  }

  // ── 共享面包屑渲染（renderBC / 文件详情统一使用）──
  function _renderBreadcrumb(el, path, options) {
    el.innerHTML = '';
    var homeLink = document.createElement('a');
    homeLink.textContent = '首页';
    homeLink.onclick = function(e) { e.preventDefault(); (options && options.homeOnClick || showHome)(); };
    el.appendChild(homeLink);
    for (var i = 0; i < path.length; i++) {
      var sep = document.createElement('span');
      sep.className = 'bc-sep'; sep.textContent = ' / ';
      el.appendChild(sep);
      var isLast = (i === path.length - 1);
      if (isLast && options && options.lastStatic) {
        var cur = document.createElement('span');
        cur.className = 'bc-current'; cur.textContent = options.lastStatic;
        el.appendChild(cur);
      } else if (options && options.onNavigate) {
        (function(text, depth) {
          var link = document.createElement('a');
          link.textContent = text;
          link.onclick = function(e) { e.preventDefault(); options.onNavigate(depth); };
          el.appendChild(link);
        })(path[i], i + 1);
      }
    }
  }

  // ── Breadcrumb ──
  function renderBC() {
    const el = document.getElementById('breadcrumb');
    _renderBreadcrumb(el, expPath, { onNavigate: function(depth) { navTo(depth); } });
    // 管理模式：在面包屑同一行最右侧加「新建」按钮
    if (isMgmtActive()) {
      var node = getNode(expPath);
      var showNewBtn = true;
      // 最后一层（有course关联的节点）不显示
      if (node && node.courseId) showNewBtn = false;
      // 管辖范围外不显示
      if (showNewBtn && currentUser && !_userInScope(expPath)) showNewBtn = false;
      if (showNewBtn) {
        var newBtn = document.createElement('button');
        newBtn.className = 'mgmt-new-btn';
        newBtn.textContent = '＋ 新建';
        newBtn.onclick = function(e) { e.stopPropagation(); showNewFolderDialog(node && node.id); };
        el.appendChild(newBtn);
      }
    }
  }

  function _nodeInScope(item, rootCategory, isCollegeLevel) {
    // 检查单个课程树节点是否在用户管辖范围内
    // isCollegeLevel：当前渲染的是「专业课」一级目录（学院节点）时由 renderGrid/renderList 传入 true
    if (!currentUser || !item) return false;
    if (currentUser.role === 'super_admin') return true;
    if (currentUser.role === 'user') return false;

    var moderatedSections = currentUser.moderated_sections || [];

    if (currentUser.role === 'moderator') {
      // 通识课：有 can_moderate_general 权限即可
      if (rootCategory === '通识课') return !!currentUser.can_moderate_general;
      var managedMajors = currentUser.managed_majors || [];
      // 专业课一级目录（学院节点）：版主无权编辑——统一「版主可管辖学院下全部内容但不含学院节点本身」
      if (isCollegeLevel && item.collegeId && managedMajors.indexOf(item.collegeId) !== -1) {
        return false;
      }
      // 专业课：检查 collegeId 是否在 managed_majors
      if (item.collegeId && managedMajors.indexOf(item.collegeId) !== -1) return true;
      // 检查 category id 是否在 moderated_sections
      if (item.id && moderatedSections.indexOf(item.id) !== -1) return true;
      return false;
    }

    if (currentUser.role === 'sub_moderator') {
      if (!moderatedSections.length) return false;
      // 小版主：只检查 category id
      if (item.id && moderatedSections.indexOf(item.id) !== -1) return true;
      return false;
    }

    return false;
  }

  function _userInScope(path) {
    // 检查当前导航路径是否在用户管辖范围内
    if (!currentUser) return false;
    if (currentUser.role === 'super_admin') return true;
    if (currentUser.role === 'user') return false;
    if (!path || !path.length) return false;

    var rootCategory = path[0];
    var managedMajors = currentUser.managed_majors || [];
    var moderatedSections = currentUser.moderated_sections || [];
    var depth = path.length;

    // 逐层遍历路径上的节点
    for (var i = 0; i < depth; i++) {
      var partPath = path.slice(0, i + 1);
      var node = getNode(partPath);
      if (!node) continue;

      if (currentUser.role === 'moderator') {
        // 通识课
        if (rootCategory === '通识课') {
          if (currentUser.can_moderate_general) return true;
        }
        // 专业课根节点（i===0）：collegeId 是从子节点向上传播的，不代表管辖范围。
        // 版主对「专业课」根本身永远无编辑权（后端同样只放行 super_admin），
        // 必须跳过，否则根节点的传播 collegeId 一旦命中管辖学院，会让整棵专业课树
        // （含所有学院卡片）都被判定在管辖内。
        if (rootCategory === '专业课' && i === 0) {
          if (node.id && moderatedSections.indexOf(node.id) !== -1) return true;
          continue;
        }
        // managed_majors：版主可管辖学院下全部内容。路径处于学院一级节点那一行时
        // 也视为在管辖内 → 面包屑「＋ 新建」可见，可在学院下新建专业文件夹。
        // （学院卡片本身的编辑仍由 _nodeInScope 的 isCollegeLevel 拦截，不受影响）
        if (node.collegeId && managedMajors.indexOf(node.collegeId) !== -1) {
          return true;
        }
        // moderated_sections
        if (node.id && moderatedSections.indexOf(node.id) !== -1) return true;
      }

      if (currentUser.role === 'sub_moderator') {
        if (!moderatedSections.length) return false;
        if (node.id && moderatedSections.indexOf(node.id) !== -1) return true;
      }
    }
    return false;
  }

  // ── 跳过单节点后的有效子节点数 ──
  function getEffectiveChildCount(node) {
    if (!node || !node.children) return 0;
    // 递归跳过只有一个子节点的中间层
    while (node.children.length === 1 && node.children[0].children) {
      node = node.children[0];
    }
    return node.children.length;
  }

  // ── Renderers ──
