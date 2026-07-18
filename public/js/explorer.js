  function findPathByCourseId(code) {
    function walk(nodes, path) {
      for (const n of nodes) {
        if (n.courseId === code) return [...path, n.name];
        if (n.children) {
          const found = walk(n.children, [...path, n.name]);
          if (found) return found;
        }
      }
      return null;
    }
    for (const [key, val] of Object.entries(courseTree || {})) {
      if (val.children) {
        const found = walk(val.children, [key]);
        if (found) return found;
      }
    }
    return null;
  }

  function navToLast(code) {
    const path = findPathByCourseId(code);
    if (!path) return;
    expPath = path;
    pushViewState('explorer', { expPath: [...expPath] }, true);
    renderExplorer();
  }

  /* ═══════════════════════════════════════════════════════════
     API：课程文件
     ═══════════════════════════════════════════════════════════ */

  async function getFiles(courseCode) {
    try { return await api('/api/courses/' + encodeURIComponent(courseCode) + '/files/'); }
    catch { return []; }
  }

  /* ═══════════════════════════════════════════════════════════
     上传 / 模态框
     ═══════════════════════════════════════════════════════════ */

  let uploadCourseCode = '';
  let _uploadMode = 'file'; // 'file' | 'text'

  function autoFillUploadTitle() {
    var fileInput = document.getElementById('uploadFile');
    var titleInput = document.getElementById('uploadTitle');
    if (!fileInput || !titleInput) return;
    if (titleInput.value.trim()) return;
    if (fileInput.files.length === 1) {
      titleInput.value = fileInput.files[0].name.replace(/\.[^.]+$/, '');
    }
  }

  function switchUploadMode(mode) {
    _uploadMode = mode;
    document.getElementById('uploadModeFile').style.display = mode === 'file' ? '' : 'none';
    document.getElementById('uploadModeText').style.display = mode === 'text' ? '' : 'none';
    document.querySelectorAll('.um-tab').forEach(function(t) {
      t.classList.toggle('um-tab-active', t.dataset.mode === mode);
    });
    // 切换模式更新标题占位符 + 清空标题
    var titleInput = document.getElementById('uploadTitle');
    if (titleInput) {
      titleInput.value = '';
      titleInput.placeholder = mode === 'text' ? '留空则自动取内容前20字' : '留空则自动使用文件名';
    }
    // 切换模式自动清空错误
    document.getElementById('uploadError').style.display = 'none';
  }

  function showUploadModal(code, name) {
    if (!currentUser) { showLoginModal(); return; }
    uploadCourseCode = code;
    _uploadMode = 'file';
    document.getElementById('uploadCourse').value = name + ' (' + code + ')';
    var ri = document.getElementById('reuploadInfo');
    if (ri) ri.style.display = 'none';
    _reuploadOldId = null;
    // 重置到文件模式
    switchUploadMode('file');
    document.getElementById('uploadModal').style.display = 'flex';
    lockScroll();
    _pushModalHistory();
  }

  function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('uploadForm').reset();
    document.getElementById('uploadError').style.display = 'none';
    document.getElementById('uploadProgress').style.display = 'none';
    var ri = document.getElementById('reuploadInfo');
    if (ri) ri.style.display = 'none';
    _reuploadOldId = null;
    unlockScroll();
    _popModalHistory();
  }

  async function handleUpload(e) {
    e.preventDefault();
    const el = document.getElementById('uploadError');
    const progress = document.getElementById('uploadProgress');
    const fill = document.getElementById('uploadProgressFill');
    const text = document.getElementById('uploadProgressText');

    el.style.display = 'none';

    var title = document.getElementById('uploadTitle').value;
    var description = document.getElementById('uploadDesc').value;
    var teacher = document.getElementById('uploadTeacher').value;
    if (!teacher.trim()) {
      el.textContent = '请填写任课教师姓名';
      el.style.display = 'block';
      progress.style.display = 'none';
      return false;
    }

    // ── 文字录入模式 ──
    if (_uploadMode === 'text') {
      var content = document.getElementById('uploadTextContent').value;
      if (!content.trim()) {
        el.textContent = '请输入文字内容';
        el.style.display = 'block';
        return false;
      }
      progress.style.display = 'flex';
      fill.style.width = '30%';
      text.textContent = '正在提交文字内容…';

      try {
        var token = sessionStorage.getItem('token') || localStorage.getItem('token');
        const resp = await fetch('/api/files/upload-text/', {
          method: 'POST',
          headers: token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course_code: uploadCourseCode,
            title: title,
            content: content,
            description: description,
            teacher: teacher,
          }),
        });
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error || '上传失败');

        fill.style.width = '100%';
        text.textContent = '✅ 文字录入成功！';
        setTimeout(function() { closeUploadModal(); renderExplorer(); }, 1500);
      } catch (err) {
        fill.style.width = '100%';
        text.textContent = '❌ 失败: ' + err.message;
      }
      return false;
    }

    // ── 文件上传模式 ──
    const files = document.getElementById('uploadFile').files;
    if (!files || !files.length) { el.textContent = '请选择文件'; el.style.display = 'block'; return false; }

    progress.style.display = 'flex';
    var successCount = 0, failCount = 0;
    var token = sessionStorage.getItem('token') || localStorage.getItem('token');

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (file.size > 50 * 1024 * 1024) {
        failCount++;
        text.textContent = (i + 1) + '/' + files.length + ' ' + file.name + ' 超过 50MB，跳过';
        continue;
      }

      var fileTitle = title || file.name.replace(/\.[^.]+$/, '');
      if (files.length > 1) fileTitle += ' (' + (i + 1) + ')';
      var pct = Math.round(((i + 1) / files.length) * 70) + 5;
      fill.style.width = pct + '%';
      text.textContent = (i + 1) + '/' + files.length + ' 上传中: ' + file.name;

      try {
        const formData = new FormData();
        formData.append('course_code', uploadCourseCode);
        formData.append('title', fileTitle);
        formData.append('file', file);
        formData.append('description', description);
        formData.append('teacher', teacher);

        const resp = await fetch('/api/files/upload/', {
          method: 'POST',
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
          body: formData,
        });
        const data = await resp.json();
        if (!data.ok) throw new Error(data.error || '上传失败');
        successCount++;
      } catch (err) {
        failCount++;
        text.textContent = (i + 1) + '/' + files.length + ' ' + file.name + ' 失败: ' + err.message;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (successCount > 0 && _reuploadOldId) {
      try {
        await api('/api/files/' + _reuploadOldId + '/delete/', { method: 'DELETE' });
      } catch(e) { /* 静默失败 */ }
      _reuploadOldId = null;
    }

    fill.style.width = '100%';
    text.textContent = '完成！成功 ' + successCount + ' 个' + (failCount > 0 ? '，失败 ' + failCount + ' 个' : '');
    setTimeout(function() { closeUploadModal(); renderExplorer(); }, 1500);
    return false;
  }


  /* ═══════════════════════════════════════════════════════════
     EXPLORER — 课程浏览器（文件管理器风格）
     ═══════════════════════════════════════════════════════════ */

  // 课程导航树现在由后端 API /api/courses/tree 提供
  // ── Card SVG Icons ─────────────────────────
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
  };

  // ── State ──
  let expPath = [];
  // 文件计数已嵌入课程树响应（fileCount），无需单独请求
  let courseTree = null;  // 从 API 动态加载
  let highlightFileId = null;  // 从排行榜/最近上传跳转时高亮目标文件
  var returnState = null;      // { view:'home'|'rankings'|'recentAll', scrollY } 供"返回"按钮使用

  // ── 浏览器历史导航 ──
  let _suppressingPushState = false;
  let _initialNav = true;  // 首次加载用 replaceState 代替 pushState，避免按返回退出网站

  function pushViewState(view, extra, replace) {
    if (_suppressingPushState) return;
    const state = { _bnusparks: true, view, scrollY: window.scrollY, ...extra };
    if (replace) {
      history.replaceState(state, '');
    } else {
      history.pushState(state, '');
    }
    // 同时写入 sessionStorage，刷新后可恢复
    try { sessionStorage.setItem('bnusparks_view', JSON.stringify(state)); } catch(e) {}
  }

  // ── 从后端加载课程导航树 ──
  async function loadCourseTree() {
    try {
      courseTree = await api('/api/courses/tree/');
    } catch(e) {
      console.warn('课程树加载失败，使用备用空树', e);
      courseTree = {};
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

    // 从数据库补充
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

  function extBadge(fileName) {
    if (!fileName) return '';
    const ext = fileName.split('.').pop().toLowerCase();
    const label = {pdf:'PDF', ppt:'PPT', pptx:'PPT', doc:'DOC', docx:'DOC', xls:'XLS', xlsx:'XLS',
                   jpg:'IMG', jpeg:'IMG', png:'IMG', gif:'IMG', webp:'IMG', md:'MD', txt:'TXT',
                   zip:'ZIP', rar:'RAR', py:'PY', js:'JS', html:'HTML', css:'CSS'}[ext] || ext.toUpperCase().slice(0,4);
    return '<span class="ext-badge">' + esc(label) + '</span>';
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

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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

  // ── Breadcrumb ──
  function renderBC() {
    const el = document.getElementById('breadcrumb');
    el.innerHTML = '';
    const home = document.createElement('a');
    home.textContent = '首页'; home.onclick = showHome;
    el.appendChild(home);
    for (let i = 0; i < expPath.length; i++) {
      const sep = document.createElement('span');
      sep.className = 'bc-sep'; sep.textContent = ' / ';
      el.appendChild(sep);
      if (i === expPath.length - 1) {
        const cur = document.createElement('span');
        cur.className = 'bc-current'; cur.textContent = expPath[i];
        el.appendChild(cur);
      } else {
        const a = document.createElement('a');
        a.textContent = expPath[i]; a.onclick = () => navTo(i + 1);
        el.appendChild(a);
      }
    }
    // 管理模式：在面包屑同一行最右侧加「新建」按钮
    if (isMgmtActive()) {
      var node = getNode(expPath);
      var hasCourse = node && (node.courseId || (node.children && node.children.some(function(c) { return c.courseId; })));
      var showNewBtn = true;
      // 最后一层（有course关联的节点）不显示
      if (node && node.courseId) showNewBtn = false;
      // 小版主在管辖范围外的层级不显示
      if (currentUser && currentUser.role === 'sub_moderator' && !_userInScope(expPath)) showNewBtn = false;
      if (showNewBtn) {
        var newBtn = document.createElement('button');
        newBtn.className = 'mgmt-new-btn';
        newBtn.textContent = '＋ 新建';
        newBtn.onclick = function(e) { e.stopPropagation(); showNewFolderDialog(node && node.id); };
        el.appendChild(newBtn);
      }
    }
  }

  function showNewFolderDialog(parentId) {
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay';
    overlay.innerHTML =
      '<div class="admin-reject-dialog" style="max-width:380px">' +
        '<h3>📁 新建文件夹</h3>' +
        '<div style="margin:12px 0"><label style="font-size:0.85rem;display:block;margin-bottom:4px">文件夹名称</label>' +
          '<input type="text" id="newFolderName" placeholder="输入名称" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem;box-sizing:border-box"></div>' +
        '<div style="margin-bottom:12px"><label style="font-size:0.85rem;display:block;margin-bottom:4px">文件夹类型</label>' +
          '<select id="newFolderType" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem">' +
            '<option value="">普通文件夹（内部可再建文件夹）</option>' +
            '<option value="leaf">底层文件夹（内部可上传文件，不可再建文件夹）</option>' +
          '</select></div>' +
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" onclick="confirmNewFolder(' + (parentId || 'null') + ')">创建</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
    setTimeout(function() { document.getElementById('newFolderName').focus(); }, 100);
  }

  function confirmNewFolder(parentId) {
    var name = document.getElementById('newFolderName').value.trim();
    var type = document.getElementById('newFolderType').value;
    if (!name) { alert('请输入文件夹名称'); return; }
    var overlay = document.querySelector('.admin-reject-overlay');
    api('/api/folders/create/', { method: 'POST', body: { name: name, parent_id: parentId, folder_type: type } }).then(function() {
      _removeOverlay(overlay);
      renderExplorer(); // 刷新视图
    }).catch(function(err) {
      alert('创建失败：' + err.message);
    });
  }

  function _userInScope(path) {
    // 检查当前用户的管辖范围是否包含给定路径
    if (!currentUser) return false;
    if (currentUser.role === 'super_admin') return true;
    if (currentUser.role === 'user') return false;
    // 从 path 推断所属的一级分类（专业课/通识课）
    if (!path || !path.length) return false;
    var rootCategory = path[0]; // '通识课' 或 '专业课'
    // 版主/小版主需要权限
    if (currentUser.role === 'moderator') {
      // 版主：检查 managed_majors + can_moderate_general + moderated_sections
      // 通识课全域：有 can_moderate_general 权限
      if (rootCategory === '通识课' && currentUser.can_moderate_general) return true;
      // 检查 moderated_sections（通识课子类等）
      if (currentUser.moderated_sections && currentUser.moderated_sections.length) {
        // 如果能匹配到任何管辖分类的路径，返回 true
        // 简化处理：有管辖板块的版主在通识课/专业课的二级目录有权限
        return true;
      }
      // 检查 managed_majors（管辖学院）
      if (currentUser.managed_majors && currentUser.managed_majors.length) {
        // 在专业课根下有管辖学院的版主有权限
        if (rootCategory === '专业课') return true;
      }
      return false;
    }
    if (currentUser.role === 'sub_moderator') {
      // 小版主：仅可在管辖的 CourseCategory 路径下操作
      if (!courseTree) return false;
      // 小版主只在具体专业层级及以下才可操作
      // 在一级目录（专业课/通识课）下不应看到新建按钮
      if (path.length <= 1) return false;
      // 如果有 moderated_sections 数据，尝试匹配
      if (!currentUser.moderated_sections || !currentUser.moderated_sections.length) return false;
      // 小版主在二级及以下有管辖权
      return true;
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
  function renderGrid(items) {
    const parent = document.getElementById('explorerContent');
    const mathItem = items.find(i => i.mathCard);
    const regularItems = items.filter(i => !i.divider && !i.mathCard);
    let html = '';

    html += '<div class="folder-grid">' +
      regularItems.map(item =>
        '<div class="folder-card" data-n="' + esc(item.name) + '">' +
          '<div class="fc-icon">' + (CARD_ICONS[item.iconClass] || CARD_ICONS['folder']) + '</div>' +
          '<div class="fc-name">' + esc(item.name) + '</div>' +
          '<div class="fc-count">' + (item.children ? getEffectiveChildCount(item) + ' 项' : '') + '</div>' +
        '</div>'
      ).join('') +
    '</div>';

    // Divider before math section
    if (mathItem) {
      html += '<div class="grid-divider-wrap"><hr class="grid-divider"></div>';
      html += '<div class="folder-grid">' +
        '<div class="folder-card" data-n="数学类">' +
          '<div class="fc-icon">' + (CARD_ICONS[mathItem.iconClass] || CARD_ICONS['folder']) + '</div>' +
          '<div class="fc-name">数学类</div>' +
          '<div class="fc-count">' + mathItem.children.length + ' 项</div>' +
        '</div>' +
      '</div>';
    }

    parent.innerHTML = html;
    parent.querySelectorAll('.folder-card').forEach(el => {
      el.addEventListener('click', () => navIn(el.dataset.n));
    });
  }

  function renderList(items) {
    const parent = document.getElementById('explorerContent');
    let html = '<div class="folder-list">';
    items.forEach(item => { html += listHtml(item); });
    html += '</div>';
    parent.innerHTML = html;
    parent.querySelectorAll('.folder-list-item').forEach(el => {
      el.addEventListener('click', () => navIn(el.dataset.n));
    });
  }

  function listHtml(item) {
    const hasSub = !!(item.children && item.children.length);
    const cId = item.courseId;
    let badge = '';
    if (cId) {
      const fCount = item.fileCount !== undefined ? item.fileCount : null;
      badge = fCount !== null && fCount > 0
        ? '<span class="fli-badge has-data">' + fCount + ' 个文件</span>'
        : '<span class="fli-badge no-data">暂无资料</span>';
    } else if (hasSub) {
      badge = '<span class="fli-badge has-data">' + getEffectiveChildCount(item) + ' 项</span>';
    }
    const meta = cId ? '课程代码 ' + cId : (hasSub ? getEffectiveChildCount(item) + ' 项' : '');
    return '<div class="folder-list-item" data-n="' + esc(item.name) + '">' +
      '<span class="fli-icon">' + (hasSub ? '▸' : '·') + '</span>' +
      '<div class="fli-info"><div class="fli-name">' + esc(item.name) + '</div><div class="fli-meta">' + meta + '</div></div>' +
      badge + '</div>';
  }

  var _multiSelectMode = false;

  function toggleMultiSelect() {
    var tbody = document.getElementById('fileTableBody');
    if (!tbody || !tbody.querySelector('tr[data-file-id]')) return;
    _multiSelectMode = !_multiSelectMode;
    var btn = document.getElementById('multiSelectToggle');
    var mgmt = isMgmtActive();
    btn.textContent = _multiSelectMode ? '✕ 取消' : (mgmt ? '📋 批量操作' : '⬇ 批量下载');
    if (!_multiSelectMode) {
      // 退出模式时清空选择
      _selectedIds = {};
      document.querySelectorAll('.dl-chk').forEach(function(c) { c.checked = false; });
      var allChk = document.getElementById('selectAllChkHead');
      if (allChk) allChk.checked = false;
    }
    syncMultiSelectUI();
  }

  function syncMultiSelectUI() {
    var ft = document.getElementById('fileTable');
    if (!ft) return;
    var tbody = document.getElementById('fileTableBody');
    var mgmt = isMgmtActive();
    // 管理模式显示额外按钮
    var delBtn = document.getElementById('batchDeleteBtn');
    var editBtn = document.getElementById('batchEditBtn');
    if (mgmt) {
      if (delBtn) delBtn.style.display = '';
      if (editBtn) editBtn.style.display = '';
    } else {
      if (delBtn) delBtn.style.display = 'none';
      if (editBtn) editBtn.style.display = 'none';
    }
    if (_multiSelectMode) {
      ft.classList.add('multi-select');
      var batchBar = document.getElementById('batchDlBar');
      if (batchBar) { batchBar.classList.add('is-visible'); batchBar.style.display = 'flex'; }
      // 从 _selectedIds 恢复可见行勾选状态
      var visibleChk = 0, visibleChecked = 0;
      if (tbody) {
        tbody.querySelectorAll('.dl-chk').forEach(function(c) {
          var fid = parseInt(c.getAttribute('data-fid'));
          if (fid) {
            var isChecked = !!_selectedIds[fid];
            c.checked = isChecked;
            visibleChk++;
            if (isChecked) visibleChecked++;
          }
        });
      }
      var allChk = document.getElementById('selectAllChkHead');
      if (allChk) allChk.checked = visibleChk > 0 && visibleChecked === visibleChk;
      updateBatchDlBar();
    } else {
      ft.classList.remove('multi-select');
      var batchBar = document.getElementById('batchDlBar');
      if (batchBar) { batchBar.classList.remove('is-visible'); batchBar.style.display = ''; }
    }
  }

  function cancelMultiSelect() {
    _multiSelectMode = false;
    _selectedIds = {};
    var btn = document.getElementById('multiSelectToggle');
    if (btn) btn.textContent = '⬇ 批量下载';
    var allChk = document.getElementById('selectAllChkHead');
    if (allChk) allChk.checked = false;
    syncMultiSelectUI();
  }

  function renderFiles(course) {
    // 切换课程时退出多选模式
    _multiSelectMode = false; _selectedIds = {};
    const code = course.courseId;
    const container = document.getElementById('explorerContent');

    // 通配符课程代码（如 GEN02***）只显示提示
    if (code && code.includes('*')) {
      container.innerHTML =
        '<div class="file-area">' +
          '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + '</h3></div>' +
          '<div class="empty-state"><div class="es-text">该课程由多个模块组成</div><div class="es-sub">请在上层分类中查看具体课程</div></div>' +
        '</div>';
      return;
    }

    // 无课程代码 → 展示空状态（避免表格永久停留在"加载中"）
    if (!code) {
      container.innerHTML =
        '<div class="file-area">' +
          '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + '</h3></div>' +
          '<div class="empty-state"><div class="es-text">该课程暂无资料</div><div class="es-sub">可能是课程尚未开始，或资料正在征集中</div></div>' +
        '</div>';
      return;
    }

    // 查找同名课程
    const sameNameEntries = sameNameMap[course.name] || [];
    const sameNameOthers = sameNameEntries.filter(e => e.courseId !== code);
    // 按 courseId 分组，合并同一代码的不同专业名
    const sameNameGroups = {};
    sameNameOthers.forEach(e => {
      if (!sameNameGroups[e.courseId]) {
        sameNameGroups[e.courseId] = { courseId: e.courseId, programs: [], type: e.type };
      }
      if (e.program && !sameNameGroups[e.courseId].programs.includes(e.program)) {
        sameNameGroups[e.courseId].programs.push(e.program);
      }
    });

    container.innerHTML =
        '<div class="file-area-main">' +
          (returnState ? '<div class="fa-back-bar"><a href="#" onclick="returnToPreviousView();return false">← 返回' + (returnState.view === 'rankings' ? '排行榜' : returnState.view === 'home' ? '首页' : '最近上传') + '</a></div>' : '') +
          '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + ' — 资料列表</h3><span class="fa-count" id="fileCount">加载中...</span><span class="fa-per-page" id="perPageControl"></span>' + (code ? '<div class="fa-upload-header-btn">' + (currentUser ? '<button class="fa-upload-btn" onclick="showUploadModal(\'' + esc(code) + '\',\'' + esc(course.name) + '\')">+ 上传资料</button><button class="fa-upload-btn fa-batch-dl-btn" id="multiSelectToggle" onclick="toggleMultiSelect()">' + (isMgmtActive() ? '📋 批量操作' : '⬇ 批量下载') + '</button>' : '<button class="fa-upload-btn dl-login-prompt" onclick="event.stopPropagation();showLoginModal()" style="border-style:dashed">🔒 登录后上传</button>') + '</div>' : '') + '</div>' +
          '<div class="file-table-wrap"><div class="batch-dl-bar" id="batchDlBar"><span id="selectedCount">已选 0 个</span>' +
            '<button class="admin-btn admin-btn-sm" onclick="batchDeleteSelected()" id="batchDeleteBtn" style="display:none">🗑 删除选中</button>' +
            '<button class="admin-btn admin-btn-sm" onclick="showBatchEditDialog()" id="batchEditBtn" style="display:none">✏️ 编辑选中</button>' +
            '<button class="admin-btn admin-btn-sm" onclick="batchDownloadSelected()" id="batchDlBtn" style="margin-left:auto">⬇ 下载选中</button>' +
          '</div>' +
          '<div class="file-table-scroll"><table class="file-table" id="fileTable"><thead><tr><th class="th-name">文件名</th><th class="th-type">类型</th><th class="th-size">大小</th><th class="th-uploader">上传者</th><th class="th-teacher">任课教师</th><th class="th-dlcount">下载次数</th><th class="th-download"><span class="dl-normal">下载</span><span class="dl-check"><input type="checkbox" id="selectAllChkHead" onchange="toggleSelectAll(this)"> <span id="selectedCountHead"></span></span></th></tr></thead><tbody id="fileTableBody">' +
          '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint);padding:40px">加载中...</td></tr>' +
          '</tbody></table></div></div>' +
        '</div>' +
        (Object.keys(sameNameGroups).length ? '<div class="file-area-side-bottom"><div class="fasb-title">📚 同名课程（相同名称的不同课程代码）</div><div class="fasb-list">' +
          Object.values(sameNameGroups).map(g =>
            '<span class="fasb-item" onclick="showExplorer(\'' + g.type + '\');setTimeout(function(){navToLast(\'' + esc(g.courseId) + '\')},60)">' +
              '<span class="fasb-code">' + esc(g.courseId) + '</span>' +
              (g.programs.length ? '<span class="fasb-programs">（' + esc(g.programs.join(' / ')) + '）</span>' : '') +
            '</span>'
          ).join(' · ') +
        '</div></div>' : '');

    if (!code) return;

    getFiles(code).then(allFiles => {
      const totalFiles = allFiles.length;
      document.getElementById('fileCount').textContent = totalFiles + ' 个文件';

      // 初始化每页条数选择器
      var ppc = document.getElementById('perPageControl');
      if (ppc) {
        ppc.innerHTML = ' 每页 <select class="ppc-select" id="ppcSelect"><option value="10">10</option><option value="15">15</option><option value="20">20</option></select> 条';
        ppc.style.display = '';
        document.getElementById('ppcSelect').addEventListener('change', function() {
          pageSize = parseInt(this.value);
          currentPage = 1;
          renderPage();
        });
      }

      let pageSize = 10;
      let currentPage = 1;

      // 从排行榜/最近上传跳转 → 定位到目标文件所在页
      let firstHighlight = true;
      if (highlightFileId) {
        const targetIdx = allFiles.findIndex(f => f.id === highlightFileId);
        if (targetIdx >= 0) {
          currentPage = Math.floor(targetIdx / pageSize) + 1;
        }
      }
      const targetHighlightFileId = highlightFileId;
      highlightFileId = null;

      function renderPage() {
        const tbody = document.getElementById('fileTableBody');
        if (!allFiles.length) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint);padding:40px">暂无资料，欢迎上传</td></tr>';
          hidePagination();
          if (_multiSelectMode) { _multiSelectMode = false; _selectedIds = {}; var mBtn = document.getElementById('multiSelectToggle'); if (mBtn) mBtn.textContent = '⬇ 批量下载'; }
          var batchBar = document.getElementById('batchDlBar');
          if (batchBar) { batchBar.classList.remove('is-visible'); batchBar.style.display = ''; }
          var ft = document.getElementById('fileTable');
          if (ft) ft.classList.remove('multi-select');
          return;
        }

        const totalPages = Math.ceil(totalFiles / pageSize);
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * pageSize;
        const pageFiles = allFiles.slice(start, start + pageSize);

        const fileLookup = {};
        pageFiles.forEach(f => { fileLookup[f.id] = f; });
        window._fileLookup = fileLookup;
        tbody.innerHTML = pageFiles.map(function(f) {
          var badgeHtml = '';
          if (f.is_uploader && f.review_status !== 'approved') {
            var badgeLabel = f.review_status === 'pending' ? '审核中' : '已驳回';
            var badgeClass = f.review_status === 'pending' ? 'review-badge-pending' : 'review-badge-rejected';
            badgeHtml = '<span class="review-badge ' + badgeClass + '">' + badgeLabel + '</span>';
          }
          var dlLink = currentUser
            ? (f.can_download !== false
                ? '<a href="javascript:void(0)" class="dl-link" onclick="handleDownloadClick(' + f.id + ',this,event)">⬇ 下载</a><a href="javascript:void(0)" class="pv-link" onclick="event.stopPropagation();showPreview(' + f.id + ')">预览</a>'
                : '<span class="dl-link dl-disabled" title="审核通过后可下载">⏳ 待审核</span>')
            : '<a href="javascript:void(0)" class="dl-link dl-login-prompt" onclick="event.stopPropagation();showLoginModal()">🔒 登录下载</a>';
          var isChecked = !!_selectedIds[f.id];
          var mgmt = isMgmtActive();
          // 管理模式：文件名和教师旁加铅笔（屏幕宽度 > 768px），仅在可编辑时显示
          var selfOrInScope = mgmt && (f.is_uploader || f.can_delete);
          var mgmtPens = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen" onclick="event.stopPropagation();quickEditField(' + f.id + ',\'title\',\'' + esc(f.title) + '\')">✏️</span>')
            : '';
          var teacherPen = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen mgmt-pen-sm" onclick="event.stopPropagation();quickEditField(' + f.id + ',\'teacher\',\'' + esc(f.teacher || '') + '\')">✏️</span>')
            : '';
          var mgmtDel = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen mgmt-del" onclick="event.stopPropagation();deleteFileConfirm(' + f.id + ',this)" title="删除此文件">🗑️</span>')
            : '';
          return '<tr data-file-id="' + f.id + '"><td class="ft-name"><span class="fn-wrap">' + extBadge(f.file_name) + '<span class="fn-text" title="' + esc(f.title) + '">' + esc(f.title) + '</span>' + badgeHtml + mgmtPens + mgmtDel + '</span></td>' +
            '<td class="ft-type-cell">' + esc(f.file_type) + '</td>' +
            '<td class="ft-size-cell">' + formatSize(f.file_size) + '</td>' +
            '<td class="ft-uploader">' + esc(f.uploader) + '</td>' +
            '<td class="ft-teacher">' + esc(f.teacher || '') + teacherPen + '</td>' +
            '<td class="ft-dlcount">' + f.download_count + ' 次</td>' +
            '<td class="ft-download"><span class="dl-normal">' + dlLink + '</span><span class="dl-check"><input type="checkbox" class="dl-chk" data-fid="' + f.id + '"' + (isChecked ? ' checked' : '') + ' onchange="onDlChkChange(this)"></span></td></tr>';
        }).join('');
        // 点击行显示文件简介
        Array.from(tbody.children).forEach(tr => {
          tr.addEventListener('click', function(e) {
            if (e.target.closest('.dl-link, .dl-chk, .dl-check, .pv-link')) return;
            const fileId = parseInt(this.dataset.fileId);
            if (fileLookup[fileId]) showFileInfoModal(fileLookup[fileId]);
          });
        });
        renderPagination(currentPage, totalPages);
        // 同名课程侧栏存在时折叠次要列
        const mainArea = document.querySelector('.file-area-main');
        const sidePanel = document.querySelector('.file-area-side');
        if (mainArea && sidePanel) mainArea.classList.add('file-area-compact');
        else if (mainArea) mainArea.classList.remove('file-area-compact');

        // ── 同步多选模式 UI（下载列 ↔ 复选框，CSS 控制可见性，无布局抖动） ──
        if (_multiSelectMode) {
          syncMultiSelectUI();
        } else {
          var ft = document.getElementById('fileTable');
          if (ft) ft.classList.remove('multi-select');
          var batchBar = document.getElementById('batchDlBar');
          if (batchBar) batchBar.style.display = 'none';
        }

        // 来自排行榜/最近上传 → 高亮并滚动到目标行
        if (firstHighlight && targetHighlightFileId) {
          firstHighlight = false;
          requestAnimationFrame(function() {
            const row = tbody.querySelector('tr[data-file-id="' + targetHighlightFileId + '"]');
            if (row) {
              row.scrollIntoView({ behavior: 'smooth', block: 'center' });
              row.classList.add('highlight-row');
              setTimeout(function() {
                row.classList.remove('highlight-row');
              }, 2500);
            }
          });
        }
      }

      function renderPagination(page, total) {
        let pag = document.getElementById('filePagination');
        if (total <= 1) {
          if (pag) pag.style.display = 'none';
          return;
        }
        if (!pag) {
          pag = document.createElement('div');
          pag.id = 'filePagination';
          pag.className = 'file-pagination';
          document.querySelector('.file-table-scroll').after(pag);
        }

        const numbers = getPageNumbers(page, total);

        let html = '<button class="fp-btn fp-prev' + (page <= 1 ? ' fp-disabled' : '') + '" data-page="' + (page - 1) + '">◀</button>';

        numbers.forEach(function(n) {
          if (n === '…') {
            html += '<button class="fp-btn fp-ellipsis">⋯</button>';
          } else {
            html += '<button class="fp-btn fp-num' + (n === page ? ' fp-active' : '') + '" data-page="' + n + '">' + n + '</button>';
          }
        });

        html += '<button class="fp-btn fp-next' + (page >= total ? ' fp-disabled' : '') + '" data-page="' + (page + 1) + '">▶</button>';

        pag.innerHTML = html;
        pag.style.display = 'flex';

        // Page number / prev / next clicks
        pag.querySelectorAll('.fp-num, .fp-prev, .fp-next').forEach(function(btn) {
          btn.addEventListener('click', function() {
            const p = parseInt(this.dataset.page);
            if (p && p >= 1 && p <= total && p !== currentPage) {
              currentPage = p;
              renderPage();
            }
          });
        });

        // Ellipsis → show jump popup
        pag.querySelectorAll('.fp-ellipsis').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            showJumpPopup(e, total);
          });
        });
      }

      function getPageNumbers(current, total) {
        const pages = [];
        if (total <= 5) {
          for (let i = 1; i <= total; i++) pages.push(i);
          return pages;
        }
        pages.push(1);
        if (current - 1 > 2) pages.push('…');
        var start = Math.max(2, current - 1);
        var end = Math.min(total - 1, current + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (current + 1 < total - 1) pages.push('…');
        pages.push(total);
        return pages;
      }

      function showJumpPopup(event, total) {
        var existing = document.querySelector('.fp-jump-popup');
        if (existing) existing.remove();

        var btn = event.currentTarget;
        var rect = btn.getBoundingClientRect();

        var popup = document.createElement('div');
        popup.className = 'fp-jump-popup';

        let gridHtml = '<div class="fp-jump-grid">';
        for (let i = 1; i <= total; i++) {
          gridHtml += '<button class="fp-jump-num' + (i === currentPage ? ' fp-active' : '') + '" data-page="' + i + '">' + i + '</button>';
        }
        gridHtml += '</div>';
        popup.innerHTML = gridHtml;

        popup.addEventListener('click', function(e) {
          var targetBtn = e.target.closest('.fp-jump-num');
          if (targetBtn) {
            var p = parseInt(targetBtn.dataset.page);
            if (p && p >= 1 && p <= total && p !== currentPage) {
              currentPage = p;
              renderPage();
            }
            popup.remove();
          }
        });

        // Close on click outside
        requestAnimationFrame(function() {
          document.addEventListener('click', function closeHandler(ev) {
            if (popup && !popup.contains(ev.target) && !btn.contains(ev.target)) {
              popup.remove();
              document.removeEventListener('click', closeHandler);
            }
          });
        });

        // Position relative to the ellipsis button
        popup.style.position = 'fixed';
        popup.style.zIndex = '1000';
        document.body.appendChild(popup);

        // Position after append so we can measure
        var popupRect = popup.getBoundingClientRect();
        var topPos = rect.bottom + 4;
        var leftPos = Math.max(8, rect.left + rect.width / 2 - popupRect.width / 2);
        // Keep within viewport
        if (leftPos + popupRect.width > window.innerWidth - 8) {
          leftPos = window.innerWidth - popupRect.width - 8;
        }
        popup.style.top = topPos + 'px';
        popup.style.left = leftPos + 'px';
      }

      function hidePagination() {
        const pag = document.getElementById('filePagination');
        if (pag) pag.style.display = 'none';
      }

      renderPage();
    });
  }

  // ── 文件简介模态框 ──
  var _fileInfoOverlay = null;

  function showFileInfoModal(file) {
    var existing = document.querySelector('.file-info-overlay');
    if (existing) existing.remove();

    // 根据文件名长度决定标题字号
    var titleLen = (file.title || '').length;
    var titleFontSize = titleLen > 20 ? '1.0rem' : (titleLen > 10 ? '1.15rem' : '1.3rem');

    // 权限检测：是否可编辑（上传者本人或不越界的管理员）
    // can_delete 由后端 api_course_files 基于管辖范围计算得出
    // 平民模式下隐藏所有编辑/删除功能
    var canEdit = currentUser && !_civilianMode && (
      file.is_uploader
      || (file.can_delete && currentUser.role !== 'user')
    );

    var penIcon = '<span class="fi-pen" onclick="fiEditField(this)" title="点击编辑">✏️</span>';
    var titleHtml = canEdit
      ? '<span class="fi-editable" data-field="title" data-fid="' + file.id + '">' + esc(file.title) + '</span>' + penIcon
      : esc(file.title);
    var teacherHtml = canEdit
      ? '<span class="fi-editable" data-field="teacher" data-fid="' + file.id + '">' + esc(file.teacher || '未填写') + '</span>' + penIcon
      : esc(file.teacher || '未填写');
    var descHtml = canEdit
      ? '<span class="fi-editable" data-field="description" data-fid="' + file.id + '">' + esc(file.description || '暂无简介') + '</span>' + penIcon
      : esc(file.description || '暂无简介');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay file-info-overlay';
    overlay.innerHTML =
      '<div class="modal-card file-info-card">' +
        '<button class="modal-close" onclick="closeFileInfoModal(event)">✕</button>' +
        '<h2 class="modal-title" style="font-size:' + titleFontSize + ';padding-right:28px;word-break:break-word">' + titleHtml + '</h2>' +
        '<div class="file-info-content">' +
          '<div class="fi-row"><span class="fi-label">课程名称</span><span class="fi-value">' + esc(file.course_name || file.course_code || '') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">文件名称</span><span class="fi-value">' + esc(file.file_name || '') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">文件类型</span><span class="fi-value">' + esc(file.file_type || '') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">文件大小</span><span class="fi-value">' + formatSize(file.file_size) + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">上传者</span><span class="fi-value">' + esc(file.uploader || '匿名') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">任课教师</span><span class="fi-value">' + teacherHtml + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">下载次数</span><span class="fi-value">' + file.download_count + ' 次</span></div>' +
          '<div class="fi-row"><span class="fi-label">上传日期</span><span class="fi-value">' + esc(file.created_at || '') + '</span></div>' +
          '<div class="fi-row fi-row-desc"><span class="fi-label">简介</span><span class="fi-value">' + descHtml + '</span></div>' +
          '<div class="fi-actions">' +
            (currentUser
              ? '<button class="fi-preview-btn" onclick="event.stopPropagation();showPreview(' + file.id + ')">预览文件</button><button class="fi-download-btn" onclick="handleDownloadClick(' + file.id + ',this,event)">⬇ 下载文件</button>'
              : '<a href="javascript:void(0)" class="fi-download-btn" onclick="event.stopPropagation();showLoginModal()" style="opacity:0.6">🔒 登录后下载</a>') +
            (file.can_delete && !_civilianMode ? '<button class="admin-btn admin-btn-reject" onclick="deleteFileConfirm(' + file.id + ',this)">🗑️ 删除此资料</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    overlay.addEventListener('click', function(e) {
      if (e.target === this) closeFileInfoModal(e);
    });
    document.body.appendChild(overlay);
    lockScroll();
    _fileInfoOverlay = overlay + 1; // 标记有弹窗
    _pushModalHistory();
  }

  // ── 文件详情内联编辑 ──
  function fiEditField(penEl) {
    var parent = penEl.parentElement;
    var span = parent.querySelector('.fi-editable');
    if (!span || span.querySelector('input')) return;
    var field = span.getAttribute('data-field');
    var fid = parseInt(span.getAttribute('data-fid'));
    var currentVal = span.textContent;
    if (!currentVal || currentVal === '未填写' || currentVal === '暂无简介') currentVal = '';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'fi-edit-input';
    input.value = currentVal;
    input.placeholder = field === 'title' ? '输入标题' : (field === 'teacher' ? '输入任课教师' : '输入简介');
    var original = span.textContent;
    span.textContent = '';
    span.appendChild(input);
    input.focus();
    input.select();
    penEl.textContent = '💾';
    penEl.onclick = function(e) {
      e.stopPropagation();
      fiSaveField(span, fid, field, input, penEl);
    };
    input.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') { fiSaveField(span, fid, field, input, penEl); }
      if (ev.key === 'Escape') { span.textContent = original; penEl.textContent = '✏️'; penEl.onclick = function(){fiEditField(penEl);}; }
    });
    input.addEventListener('blur', function() {
      // small delay to allow click on save button
      setTimeout(function() {
        if (!penEl.textContent.includes('✅')) {
          span.textContent = original;
          penEl.textContent = '✏️';
          penEl.onclick = function(){fiEditField(penEl);};
        }
      }, 200);
    });
  }

  function fiSaveField(spanEl, fid, field, input, penEl) {
    var val = input.value.trim();
    api('/api/files/' + fid + '/update/', { method: 'PATCH', body: (function(){var o={};o[field]=val;return o;})() }).then(function(data) {
      spanEl.textContent = data[field] || val || '未填写';
      penEl.textContent = '✅';
      penEl.onclick = function(){};
      setTimeout(function() { penEl.textContent = '✏️'; penEl.onclick = function(){fiEditField(penEl);}; }, 1500);
    }).catch(function(err) {
      alert('保存失败：' + err.message);
    });
  }

  // ── 管理模式表格行内快速编辑 ──
  function quickEditField(fid, field, currentVal) {
    var labels = {'title': '标题', 'teacher': '任课教师', 'description': '简介'};
    var newVal = prompt('请输入新的' + (labels[field] || '值'), currentVal);
    if (newVal === null || newVal === currentVal) return;
    api('/api/files/' + fid + '/update/', { method: 'PATCH', body: (function(){var o={};o[field]=newVal.trim();return o;})() }).then(function() {
      renderExplorer();
    }).catch(function(err) {
      alert('保存失败：' + err.message);
    });
  }

  // ── 关闭文件简介弹窗 ──
  function closeFileInfoModal(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    var overlay = document.querySelector('.file-info-overlay');
    if (!overlay) return;
    unlockScroll();
    overlay.remove();
    _fileInfoOverlay = null;
    if (history.state && history.state._modal) {
      history.back();
    }
  }

  // ── 文件预览 ──
  var _previewModal = null;

  function _previewUrl(fileId) {
    // 使用短时下载令牌（异步获取后生成 URL）
    return _getDownloadToken(fileId).then(function(dtoken) {
      return '/api/files/' + fileId + '/download/?dtoken=' + encodeURIComponent(dtoken) + '&preview=1';
    });
  }

  // 获取短时下载令牌（供 _previewUrl 和 doDirectDownload 使用）
  async function _getDownloadToken(fileId) {
    var token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (!token) { throw new Error('请先登录'); }
    var resp = await fetch('/api/files/' + fileId + '/download-token/', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var data = await resp.json();
    if (!data.ok) throw new Error(data.error || '获取下载令牌失败');
    return data.data.token;
  }

  function _isPreviewableExt(fileName) {
    if (!fileName) return 'other';
    var ext = fileName.split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) return 'pdf';
    if (['ppt','pptx'].includes(ext)) return 'ppt';
    if (['jpg','jpeg','png','gif','webp','bmp','svg','ico'].includes(ext)) return 'image';
    if (['txt','md','py','js','ts','jsx','tsx','css','html','json','xml','yaml','yml','sh','bash','zsh','conf','ini','cfg','log','csv','sql','c','cpp','h','hpp','java','go','rs','rb','php','pl','lua','r','kt','swift','m','mm','tex','rst','asciidoc','bat','ps1','env','gitignore','dockerfile','makefile'].includes(ext)) return 'text';
    return 'other';
  }

  function showPreview(fileId) {
    // 关闭已有预览弹窗
    var existing = document.querySelector('.preview-overlay');
    if (existing) existing.remove();

    // 获取文件详情
    // 尝试从表格行 data 取信息
    var tr = document.querySelector('tr[data-file-id="' + fileId + '"]');
    var fileName = '', fileTitle = '';
    if (tr) {
      var fnText = tr.querySelector('.fn-text');
      if (fnText) fileTitle = fnText.textContent || '';
      // 从 data 属性或文本
    }
    // 若无行信息，尝试从 fileLookup（可能不存在）
    // 降级：调用 API
    var promise;
    if (window._fileLookup && window._fileLookup[fileId]) {
      var f = window._fileLookup[fileId];
      promise = Promise.resolve(f);
    } else {
      // 无缓存数据时，直接用文件名信息（预览只需文件 ID 和下载 token）
      promise = Promise.resolve({ id: fileId, title: '#' + fileId, file_name: '' });
    }

    promise.then(function(f) {
      if (!f) f = { id: fileId, title: '文件', file_name: '' };
      var fn = f.file_name || f.title || '';
      var extType = _isPreviewableExt(fn);
      var extBadgeHtml = extBadge(fn);

      // 异步获取预览 URL（短时下载令牌）
      _previewUrl(fileId).then(function(previewUrl) {
        var bodyHtml = '';
        if (extType === 'pdf') {
          bodyHtml = '<embed src="' + previewUrl + '" type="application/pdf" style="width:100%;height:100%;border:none;border-radius:var(--radius-md)" class="pv-viewer">';
        } else if (extType === 'image') {
          bodyHtml = '<img src="' + previewUrl + '" alt="' + esc(fn) + '" class="pv-viewer" style="max-width:95%;max-height:95%;object-fit:contain;border-radius:var(--radius-md);box-shadow:0 4px 32px oklch(0 0 0 / 0.3)">';
        } else if (extType === 'text') {
          bodyHtml = '<div class="pv-text-wrap"><pre class="pv-text" id="pvTextContent">加载中…</pre></div>';
        } else if (extType === 'ppt') {
          bodyHtml = '<div class="pv-unsupported">' +
            '<div class="pv-unsupported-icon">📊</div>' +
            '<div class="pv-unsupported-text">此功能对服务器性能要求过高，暂不支持</div>' +
            '<div class="pv-unsupported-sub">' + esc(fn || '') + '</div>' +
            '<button class="pv-dl-btn" onclick="closePreview();doDirectDownload(' + fileId + ')">⬇ 下载文件</button>' +
          '</div>';
        } else {
          bodyHtml = '<div class="pv-unsupported">' +
            '<div class="pv-unsupported-icon">📄</div>' +
            '<div class="pv-unsupported-text">此功能对服务器性能要求过高，暂不支持</div>' +
            '<div class="pv-unsupported-sub">' + esc(fn || '') + '</div>' +
            '<button class="pv-dl-btn" onclick="closePreview();doDirectDownload(' + fileId + ')">⬇ 下载文件</button>' +
          '</div>';
        }

        var overlay = document.createElement('div');
        overlay.className = 'preview-overlay';
        overlay.innerHTML =
          '<button class="preview-close" onclick="closePreview()">✕</button>' +
          '<div class="preview-header">' +
            '<span class="pv-badge">' + extBadgeHtml + '</span>' +
            '<span class="pv-title" title="' + esc(fn) + '">' + esc(fileTitle || fn || '文件预览') + '</span>' +
            '<button class="pv-dl-btn pv-dl-btn-hdr" onclick="doDirectDownload(' + fileId + ')">⬇ 下载</button>' +
          '</div>' +
          '<div class="preview-body" id="previewBody">' + bodyHtml + '</div>';
        overlay.addEventListener('click', function(e) {
          if (e.target === overlay) closePreview();
        });
        document.body.appendChild(overlay);
        lockScroll();
        _previewModal = overlay;
        _pushModalHistory();

        // 文本文件：fetch 内容
        if (extType === 'text') {
          fetch(previewUrl).then(function(r) {
            if (!r.ok) throw new Error('加载失败');
            return r.text();
          }).then(function(text) {
            var pre = document.getElementById('pvTextContent');
            if (pre) {
              pre.textContent = text;
              var ext = fn.split('.').pop().toLowerCase();
              if (['py','js','ts','jsx','tsx','css','html','json','xml','sh','bash','c','cpp','java','go','rs','rb','php','sql','md'].includes(ext)) {
                pre.className = 'pv-text pv-text-code';
              }
            }
          }).catch(function() {
            var pre = document.getElementById('pvTextContent');
            if (pre) pre.textContent = '⚠️ 无法加载文件内容';
          });
        }
      }).catch(function() {
        alert('获取预览链接失败，请重试');
      });
    });
  }

  function closePreview() {
    var overlay = document.querySelector('.preview-overlay');
    if (!overlay) return;
    unlockScroll();
    overlay.remove();
    _previewModal = null;
    if (history.state && history.state._modal) {
      history.back();
    }
  }

  /* renderEmpty moved to views.js */
