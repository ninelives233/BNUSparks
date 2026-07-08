// ── Mobile Drawer ──
  const drawer = document.getElementById('mobileDrawer');
  document.getElementById('menuOpen').addEventListener('click', () => drawer.classList.add('open'));
  document.getElementById('menuClose').addEventListener('click', () => drawer.classList.remove('open'));
  drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.classList.remove('open'); });

  // ── Header scroll shadow ──
  const header = document.getElementById('siteHeader');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        header.classList.toggle('scrolled', window.scrollY > 10);
        ticking = false;
      });
      ticking = true;
    }
  });

  /* ═══════════════════════════════════════════════════════════
     API 工具
     ═══════════════════════════════════════════════════════════ */

  async function api(url, opts = {}) {
    const token = localStorage.getItem('token');
    const headers = { ...opts.headers };
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && !(opts.body instanceof FormData)) opts.body = JSON.stringify(opts.body);
    const resp = await fetch(url, { ...opts, headers });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || '请求失败');
    return data.data;
  }

  function formatSize(bytes) {
    if (!bytes) return '未知';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024/1024).toFixed(1) + ' MB';
  }

  /* ═══════════════════════════════════════════════════════════
     用户认证
     ═══════════════════════════════════════════════════════════ */

  let currentUser = null;

  function updateAuthUI() {
    const btn = document.querySelector('.login-btn');
    if (!btn) return;
    if (currentUser) {
      btn.innerHTML = '<span class="login-icon">👤</span><span class="login-text">' + esc(currentUser.nickname || currentUser.username) + '</span>';
      btn.onclick = (e) => { e.preventDefault(); if (confirm('退出登录？')) logout(); };
    } else {
      btn.innerHTML = '<span class="login-icon gi gi-login"></span><span class="login-text">登录</span>';
      btn.onclick = (e) => { e.preventDefault(); showLoginModal(); };
    }
  }

  function showLoginModal() { document.getElementById('loginModal').style.display = 'flex'; }
  function showRegister() { document.getElementById('loginModal').style.display = 'none'; document.getElementById('registerModal').style.display = 'flex'; }
  function showLogin() { document.getElementById('registerModal').style.display = 'none'; document.getElementById('loginModal').style.display = 'flex'; }
  function closeAuthModal() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('registerModal').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('registerError').style.display = 'none';
    document.getElementById('registerSuccess').style.display = 'none';
  }

  async function handleLogin(e) {
    e.preventDefault();
    const el = document.getElementById('loginError');
    try {
      const data = await api('/api/auth/login/', { method: 'POST',
        body: { username: document.getElementById('loginUsername').value, password: document.getElementById('loginPassword').value } });
      localStorage.setItem('token', data.token);
      currentUser = data.user;
      closeAuthModal(); updateAuthUI();
    } catch (err) { el.textContent = err.message; el.style.display = 'block'; }
    return false;
  }

  async function handleRegister(e) {
    e.preventDefault();
    const el = document.getElementById('registerError');
    const success = document.getElementById('registerSuccess');
    try {
      const data = await api('/api/auth/register/', { method: 'POST',
        body: { email: document.getElementById('regEmail').value.trim(),
                nickname: document.getElementById('regNickname').value.trim() } });
      localStorage.setItem('token', data.token);
      currentUser = data.user;
      document.getElementById('generatedPassword').textContent = data.generated_password;
      el.style.display = 'none';
      success.style.display = 'block';
    } catch (err) { el.textContent = err.message; el.style.display = 'block'; success.style.display = 'none'; }
    return false;
  }

  function logout() { localStorage.removeItem('token'); currentUser = null; location.reload(); }

  async function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) return;
    try { currentUser = await api('/api/auth/me/'); updateAuthUI(); }
    catch { localStorage.removeItem('token'); }
  }

  /* ═══════════════════════════════════════════════════════════
     搜索
     ═══════════════════════════════════════════════════════════ */

  function setupSearch() {
    const input = document.querySelector('.search-box input');
    const btn = document.querySelector('.search-box button');
    if (!input) return;
    function go() { const q = input.value.trim(); if (q) searchQuery(q); }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    if (btn) btn.addEventListener('click', go);
  }

  async function searchQuery(q) {
    try {
      const results = await api('/api/search/?q=' + encodeURIComponent(q));
      const overlay = document.createElement('div');
      overlay.className = 'search-overlay';
      let html = '<div class="search-overlay-inner"><button class="search-overlay-close" onclick="this.parentElement.parentElement.remove()">✕</button><h3>搜索「' + esc(q) + '」</h3>';
      if (results.courses.length) {
        html += '<div class="search-section"><h4>课程 ' + results.courses.length + '</h4>';
        results.courses.forEach(c => { html += '<div class="search-item" onclick="this.closest(\'.search-overlay\').remove();showExplorer(\'' + (c.course_type === 'general' ? '通识课' : '专业课') + '\');navToLast(\'' + esc(c.code) + '\')"><span class="si-name">' + esc(c.name) + '</span> <span class="si-code">' + esc(c.code || '') + '</span></div>'; });
        html += '</div>';
      }
      if (results.materials.length) {
        html += '<div class="search-section"><h4>资料 ' + results.materials.length + '</h4>';
        results.materials.forEach(m => { html += '<a href="/api/files/' + m.id + '/download/" class="search-item" style="text-decoration:none" onclick="this.closest(\'.search-overlay\').remove()"><span class="si-name">' + esc(m.title) + '</span> <span class="si-code">' + esc(m.course_name) + '</span></a>'; });
        html += '</div>';
      }
      if (!results.courses.length && !results.materials.length) html += '<p class="search-empty">没有找到相关结果</p>';
      html += '</div>';
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
    } catch(e) { /* ignore */ }
  }

  /* ═══════════════════════════════════════════════════════════
     统计
     ═══════════════════════════════════════════════════════════ */

  async function loadStats() {
    try {
      const s = await api('/api/stats/');
      const pills = document.querySelectorAll('.stat-pill');
      if (pills.length >= 3) {
        pills[0].innerHTML = '<strong>' + s.college_count + '</strong> 个学院';
        pills[1].innerHTML = '<strong>' + s.general_count + '</strong> 门通识课';
        pills[2].innerHTML = '<strong>' + s.major_count + '</strong> 门专业课';
      }
      // 下载最多（左列）
      const topEl = document.getElementById('topDownloadedList');
      if (topEl && s.top_downloaded && s.top_downloaded.length) {
        topEl.innerHTML = s.top_downloaded.map(m =>
          '<a href="#" class="hc-item" onclick="event.preventDefault();showExplorer(\'' + (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\');navToLast(\'' + esc(m.course_code) + '\')">' +
            '<div class="hc-item-left"><div class="hc-item-name">' + esc(m.title) + '</div><div class="hc-item-meta">' + esc(m.course_name) + '</div></div>' +
            '<span class="hc-item-count">' + m.download_count + ' 次</span>' +
          '</a>'
        ).join('');
      } else {
        topEl.innerHTML = '<div class="hc-empty">暂无热门资料，做第一个上传者吧！</div>';
      }
      // 最近上传（右列）
      const recentEl = document.getElementById('recentUploadsList');
      if (recentEl && s.recent_uploads && s.recent_uploads.length) {
        recentEl.innerHTML = s.recent_uploads.map(m =>
          '<a href="#" class="hc-item" onclick="event.preventDefault();showExplorer(\'' + (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\');navToLast(\'' + esc(m.course_code) + '\')">' +
            '<div class="hc-item-left"><div class="hc-item-name">' + esc(m.title) + '</div><div class="hc-item-meta">' + m.created_at + ' · ' + esc(m.course_name) + '</div></div>' +
            '<span class="hc-item-count">' + esc(m.uploader) + '</span>' +
          '</a>'
        ).join('');
      } else {
        recentEl.innerHTML = '<div class="hc-empty">暂无上传记录，快来上传第一份资料！</div>';
      }
    } catch(e) {}
  }

  // 递归搜索整棵树，找到 courseId 对应的路径
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
    renderExplorer();
  }

  /* ═══════════════════════════════════════════════════════════
     API：课程文件
     ═══════════════════════════════════════════════════════════ */

  async function getFiles(courseCode) {
    try { return await api('/api/courses/' + encodeURIComponent(courseCode) + '/files/'); }
    catch { return []; }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await loadCourseTree();
    buildSameNameMap();
    checkAuth(); setupSearch(); loadStats(); loadCourseFileCounts();
  });
  /* ═══════════════════════════════════════════════════════════
     上传 / 模态框
     ═══════════════════════════════════════════════════════════ */

  let uploadCourseCode = '';

  function showUploadModal(code, name) {
    if (!currentUser) { showLoginModal(); return; }
    uploadCourseCode = code;
    document.getElementById('uploadCourse').value = name + ' (' + code + ')';
    document.getElementById('uploadModal').style.display = 'flex';
  }

  function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('uploadForm').reset();
    document.getElementById('uploadError').style.display = 'none';
    document.getElementById('uploadProgress').style.display = 'none';
  }

  async function handleUpload(e) {
    e.preventDefault();
    const el = document.getElementById('uploadError');
    const progress = document.getElementById('uploadProgress');
    const fill = document.getElementById('uploadProgressFill');
    const text = document.getElementById('uploadProgressText');

    const file = document.getElementById('uploadFile').files[0];
    if (!file) { el.textContent = '请选择文件'; el.style.display = 'block'; return false; }
    if (file.size > 50 * 1024 * 1024) { el.textContent = '文件大小不能超过 50MB'; el.style.display = 'block'; return false; }

    el.style.display = 'none';
    progress.style.display = 'flex';
    fill.style.width = '10%';
    text.textContent = '上传中...';

    try {
      const formData = new FormData();
      formData.append('course_code', uploadCourseCode);
      formData.append('title', document.getElementById('uploadTitle').value);
      formData.append('file', file);
      formData.append('description', document.getElementById('uploadDesc').value);
      formData.append('teacher', document.getElementById('uploadTeacher').value);

      const token = localStorage.getItem('token');
      const resp = await fetch('/api/files/upload/', {
        method: 'POST',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        body: formData,
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || '上传失败');

      fill.style.width = '100%';
      text.textContent = '上传成功！';
      setTimeout(() => { closeUploadModal(); renderExplorer(); }, 1000);
    } catch (err) {
      el.textContent = err.message;
      el.style.display = 'block';
      progress.style.display = 'none';
    }
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
  };

  // ── State ──
  let expPath = [];
  let courseFileCounts = {};
  let courseTree = null;  // 从 API 动态加载

  // ── 从后端加载课程导航树 ──
  async function loadCourseTree() {
    try {
      courseTree = await api('/api/courses/tree/');
    } catch(e) {
      console.warn('课程树加载失败，使用备用空树', e);
      courseTree = {};
    }
  }

  async function loadCourseFileCounts() {
    try {
      const courses = await api('/api/courses/');
      courses.forEach(c => { courseFileCounts[c.code] = c.material_count; });
    } catch(e) { /* ignore */ }
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
  function navTo(depth) { expPath = expPath.slice(0, depth); renderExplorer(); }
  function navIn(name) {
    const node = getNode(expPath);
    if (!node || !node.children) return;
    const child = node.children.find(c => c.name === name);
    if (!child) return;
    expPath.push(name);
    renderExplorer();
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
  }

  // ── Renderers ──
  function renderGrid(items) {
    const parent = document.getElementById('explorerContent');
    const gridItems = items.filter(i => !i.divider && !i.mathCard);
    const mathItem = items.find(i => i.mathCard);
    let html = '<div class="folder-grid">' +
      gridItems.map(item =>
        '<div class="folder-card" data-n="' + esc(item.name) + '">' +
          '<div class="fc-icon">' + (CARD_ICONS[item.iconClass] || CARD_ICONS['folder']) + '</div>' +
          '<div class="fc-name">' + esc(item.name) + '</div>' +
          '<div class="fc-count">' + (item.children ? item.children.length + ' 项' : '') + '</div>' +
        '</div>'
      ).join('') +
    '</div>';

    // Divider before math section
    if (items.some(i => i.divider)) {
      html += '<div class="grid-divider-wrap"><hr class="grid-divider"></div>';
    }

    // Math card — centered
    if (mathItem) {
      html += '<div class="math-section-wrap">' +
        '<div class="folder-card math-card" data-n="数学类">' +
          '<div class="fc-icon">' + (CARD_ICONS[mathItem.iconClass] || CARD_ICONS['folder']) + '</div>' +
          '<div class="fc-name">数学类</div>' +
          '<div class="fc-count">' + mathItem.children.length + ' 项</div>' +
        '</div></div>';
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
    const fCount = cId && courseFileCounts[cId] !== undefined ? courseFileCounts[cId] : null;
    let badge = '';
    if (cId) {
      badge = fCount > 0
        ? '<span class="fli-badge has-data">' + fCount + ' 个文件</span>'
        : '<span class="fli-badge no-data">暂无资料</span>';
    } else if (hasSub) {
      badge = '<span class="fli-badge has-data">' + item.children.length + ' 项</span>';
    }
    const meta = cId ? '课程代码 ' + cId : (hasSub ? item.children.length + ' 项' : '');
    return '<div class="folder-list-item" data-n="' + esc(item.name) + '">' +
      '<span class="fli-icon">' + (hasSub ? '▸' : '·') + '</span>' +
      '<div class="fli-info"><div class="fli-name">' + esc(item.name) + '</div><div class="fli-meta">' + meta + '</div></div>' +
      badge + '</div>';
  }

  function renderFiles(course) {
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
      '<div class="file-area-row">' +
        '<div class="file-area-main">' +
          '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + ' — 资料列表</h3><span class="fa-count" id="fileCount">加载中...</span></div>' +
          (code ? '<div class="fa-upload-bar"><button class="fa-upload-btn" onclick="showUploadModal(\'' + esc(code) + '\',\'' + esc(course.name) + '\')">+ 上传资料</button></div>' : '') +
          '<table class="file-table"><thead><tr><th>文件名</th><th>类型</th><th>大小</th><th>上传者</th><th>任课教师</th><th>下载</th></tr></thead><tbody id="fileTableBody">' +
          '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);padding:40px">加载中...</td></tr>' +
          '</tbody></table>' +
        '</div>' +
        (Object.keys(sameNameGroups).length ? '<div class="file-area-side"><div class="fas-title">同名课程</div>' +
          Object.values(sameNameGroups).map(g =>
            '<div class="fas-item" onclick="showExplorer(\'' + g.type + '\');setTimeout(function(){navToLast(\'' + esc(g.courseId) + '\')},60)">' +
              '<div class="fas-code">' + esc(g.courseId) + '</div>' +
              '<div class="fas-course">' + esc(course.name) + '</div>' +
            '</div>'
          ).join('') +
        '</div>' : '') +
      '</div>';

    if (!code) return;

    getFiles(code).then(files => {
      document.getElementById('fileCount').textContent = files.length + ' 个文件';
      const tbody = document.getElementById('fileTableBody');
      if (!files.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);padding:40px">暂无资料，欢迎上传</td></tr>';
        return;
      }
      tbody.innerHTML = files.map(f =>
        '<tr><td class="ft-name"><span class="fn-wrap">' + extBadge(f.file_name) + '<span>' + esc(f.title) + '</span></span></td>' +
        '<td class="ft-type-cell">' + esc(f.file_type) + '</td>' +
        '<td class="ft-size-cell">' + formatSize(f.file_size) + '</td>' +
        '<td class="ft-uploader">' + esc(f.uploader) + '</td>' +
        '<td class="ft-teacher">' + esc(f.teacher || '') + '</td>' +
        '<td class="ft-download"><a href="/api/files/' + f.id + '/download/" class="dl-link">⬇ 下载</a></td></tr>'
      ).join('');
      // 点击行高亮
      Array.from(tbody.children).forEach((tr, idx) => {
        tr.addEventListener('click', function(e) {
          if (e.target.closest('.dl-link')) return;
          Array.from(tbody.children).forEach(r => r.classList.remove('selected'));
          this.classList.add('selected');
        });
      });
    });
  }

  function renderEmpty(course) {
    document.getElementById('explorerContent').innerHTML =
      '<div class="empty-state"><div class="es-icon"><span class="gi gi-empty"></span></div><div class="es-text">「' + esc(course.name) + '」暂无资料</div><div class="es-sub">可能是课程尚未开始，或资料正在征集中</div></div>';
  }

  function renderExplorer() {
    renderBC();
    const node = getNode(expPath);
    if (!node) return;
    if (node.children) {
      expPath.length === 1 ? renderGrid(node.children) : renderList(node.children);
    } else {
      renderFiles(node);
    }
  }

  // ── View Switching ──
  function switchView(name) {
    document.getElementById('homeView').classList.toggle('active', name === 'home');
    document.getElementById('explorerView').classList.toggle('active', name === 'explorer');
    document.getElementById('aboutView').classList.toggle('active', name === 'about');
  }

  function showHome() {
    switchView('home');
    document.querySelectorAll('.side-nav a').forEach(a => a.classList.remove('active'));
    const homeLink = document.querySelector('.side-nav a[data-view="home"]');
    if (homeLink) homeLink.classList.add('active');
  }

  function showExplorer(type) {
    expPath = [type];
    renderExplorer();
    switchView('explorer');
  }

  function showAbout() {
    switchView('about');
    document.querySelectorAll('.side-nav a').forEach(a => a.classList.remove('active'));
    const aboutLink = document.querySelector('.side-nav a[data-view="about"]');
    if (aboutLink) aboutLink.classList.add('active');
  }

  // ── Sidebar ──
  document.querySelectorAll('.side-nav a').forEach(a => {
    a.addEventListener('click', (e) => {
      const view = a.dataset.view;
      if (!view) return;
      e.preventDefault();
      document.querySelectorAll('.side-nav a').forEach(x => x.classList.remove('active'));
      a.classList.add('active');
      if (view === 'home') showHome();
      else if (view === 'general') showExplorer('通识课');
      else if (view === 'major') showExplorer('专业课');
      else if (view === 'about') showAbout();
    });
  });

  // ── Mobile Drawer links ──
  document.querySelectorAll('.mobile-drawer a').forEach(a => {
    a.addEventListener('click', (e) => {
      const view = a.dataset.view;
      if (!view) return;
      e.preventDefault();
      if (view === 'home') showHome();
      else if (view === 'general') showExplorer('通识课');
      else if (view === 'major') showExplorer('专业课');
      else if (view === 'about') showAbout();
      drawer.classList.remove('open');
    });
  });

  // ── Init ──
  updateAuthUI();