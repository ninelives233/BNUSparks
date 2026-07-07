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
    for (const [key, val] of Object.entries(COURSE_TREE)) {
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

  document.addEventListener('DOMContentLoaded', () => {
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

  // ── Data: 通识课程（按培养方案大类划分）──
  const TONGKE_CATS = [
    { name:'思想政治理论类', iconClass:'book', children:[
      { name:'思想道德与法治',                   courseId:'GEN01101', hasFiles:true },
      { name:'中国近现代史纲要',                  courseId:'GEN01102' },
      { name:'马克思主义基本原理',                courseId:'GEN01103' },
      { name:'毛泽东思想和中国特色社会主义理论体系概论', courseId:'GEN01112' },
      { name:'习近平新时代中国特色社会主义思想概论',   courseId:'GEN01113' },
      { name:'形势与政策',                        courseId:'GEN09001-GEN09008' },
    ]},
    { name:'体育与健康类', iconClass:'runner', children:[
      { name:'女子形体 / 男子健身健美', courseId:'GEN01201' },
      { name:'三自选项课程（3门）',     courseId:'GEN01203' },
    ]},
    { name:'军事理论与军事技能', iconClass:'shield', children:[
      { name:'军事理论', courseId:'GEN01108', hasFiles:true },
      { name:'军事技能', courseId:'GEN01109' },
    ]},
    { name:'大学外语类', iconClass:'globe', children:[
      { name:'通用英语进阶',     courseId:'GEN02122', hasFiles:true },
      { name:'博雅英语听说',     courseId:'GEN02123', hasFiles:true },
      { name:'思辨英语读写',     courseId:'GEN02124' },
      { name:'学术英语 / 人文通识课程群', courseId:'GEN02***' },
    ]},
    { name:'教师素养类', iconClass:'board', children:[
      { name:'教育学',            courseId:'GEN06120', hasFiles:true },
      { name:'教育心理学',         courseId:'GEN06121', hasFiles:true },
      { name:'现代教育技术',      courseId:'GEN06122' },
      { name:'中国教育改革与发展', courseId:'GEN06123' },
    ]},
    { name:'家国情怀与价值理想', iconClass:'star', children:[
      { name:'中国共产党历史', courseId:'GEN01114' },
      { name:'社会主义发展史', courseId:'GEN01115' },
      { name:'新中国史',       courseId:'GEN01116' },
      { name:'改革开放史',     courseId:'GEN01117' },
    ]},
    { name:'艺术鉴赏与审美体验', iconClass:'diamond', children:[
      { name:'艺术鉴赏与审美体验（模块课程）', courseId:'GEN02***' },
    ]},
    { name:'数理基础与科学素养', iconClass:'graph', children:[
      { name:'信息处理技术',            courseId:'GEN04221' },
      { name:'算法与程序设计（Python）', courseId:'GEN04237', hasFiles:true },
      { name:'人工智能导论',            courseId:'GEN04251' },
      { name:'数据科学导论',            courseId:'GEN04252' },
    ]},
    { name:'社会发展与公民责任', iconClass:'hands', children:[
      { name:'大学心理Ⅰ',   courseId:'GEN06124' },
      { name:'大学心理Ⅱ',   courseId:'GEN06125' },
      { name:'国家安全导论', courseId:'GEN06706' },
    ]},
    { name:'经典研读与文化传承', iconClass:'scroll', children:[
      { name:'经典研读与文化传承（模块课程）', courseId:'GEN03***' },
    ]},
    { divider: true },
    { name:'数学类', iconClass:'graph', mathCard: true, children:[
      { name:'微积分I',         courseId:'MAT01006', hasFiles:true },
      { name:'微积分II',        courseId:'MAT01007', hasFiles:true },
      { name:'线性代数',        courseId:'MAT02008' },
      { name:'概率论与数理统计', courseId:'STA02001' },
      { name:'数学分析I',       courseId:'MAT11001', hasFiles:true },
      { name:'数学分析II',      courseId:'MAT11002' },
      { name:'数学分析III',     courseId:'MAT12005' },
      { name:'高等代数I',       courseId:'MAT01004' },
      { name:'高等代数II',      courseId:'MAT01005' },
    ]},
  ];

  // ── Data: 专业课程（经济与工商管理学院）──
  const C = (n, id, hf) => ({ name:n, courseId:id, hasFiles:!!hf });

  // 金融学
  const FINANCE = {
    name:'金融学', children:[
      { name:'专业必修课', children:[
        { name:'专业基础课', children:[
          C('微积分I',              'MAT01006', true),
          C('微积分II',             'MAT01007', true),
          C('线性代数',             'MAT02008'),
          C('概率论与数理统计',       'STA02001'),
          C('统计学',               'ECO12032'),
          C('计量经济学',            'ECO12031', true),
        ]},
        { name:'专业核心课', children:[
          C('社会主义经济理论',       'ECO11001', true),
          C('微观经济学原理',         'ECO01001', true),
          C('宏观经济学原理',         'ECO01002', true),
          C('会计学',               'ECO12002', true),
          C('金融学',               'ECO12009', true),
          C('国际金融',             'ECO12011'),
          C('金融市场学',            'ECO12033'),
          C('保险学',               'ECO12034'),
          C('投资学',               'ECO23037'),
          C('公司金融',             'ECO12035'),
          C('财政学',               'ECO23063'),
        ]},
      ]},
      { name:'专业选修课Ⅰ', children:[
        { name:'专业方向课', children:[
          C('世界金融史',     'ECO21001', true),
          C('管理学',        'ECO11003'),
          C('政治经济学',     'ECO12003'),
          C('国际贸易学',     'ECO12008'),
          C('中级微观经济学',  'ECO12004'),
          C('中级宏观经济学',  'ECO12005'),
          C('商业银行学',     'ECO23036'),
          C('财务分析',       'ECO23006'),
          C('金融衍生工具',    'ECO23080'),
        ]},
      ]},
      { name:'自由选修课', children:[
        { name:'个性化发展课', children:[C('个性化发展选修', 'GEN****')]},
      ]},
      { name:'实践环节', children:[
        { name:'劳动教育',         children:[C('大学生劳动教育', 'EDU30001'), C('劳动教育实践活动', 'TLO30801')]},
        { name:'学术训练与实践',    children:[C('学术训练与实践', 'ECO33003')]},
        { name:'专业实习与社会调查', children:[C('专业实习与社会调查', 'ECO31003')]},
        { name:'毕业论文（设计）',   children:[C('毕业论文（设计）', 'ECO41001')]},
      ]},
      { name:'拔尖创新人才', children:[
        C('金融学新生研讨', 'ECO21002'),
        C('数字经济导论', 'ECO12030'),
        C('量化交易基础与实践', 'ECO21003'),
        C('国家经济安全概论', 'ECO23085'),
        C('金融科技理论与实践', 'ECO22024'),
        C('数字金融', 'ECO12036'),
        C('金融建模', 'ECO23086'),
        C('实证金融方法', 'ECO23087'),
        C('数字贸易学', 'ECO23088'),
        C('金融大数据分析', 'ECO23069'),
        C('区块链与数字资产', 'ECO23066'),
        C('创业融资', 'ECO23089'),
        C('深度学习技术与应用', 'GEN04254'),
        C('大数据技术及应用', 'GEN04255'),
        C('金融学术前沿与论文写作', 'ECO23092'),
      ]},
    ]
  };

  // 经济学（励耘项目）
  const ECONOMICS_LIYUN = {
    name:'经济学（励耘项目）', children:[
      { name:'专业必修课', children:[
        { name:'专业基础课', children:[
          C('数学分析I',        'MAT11001', true),
          C('数学分析II',       'MAT11002'),
          C('数学分析III',      'MAT12005'),
          C('高等代数I',        'MAT01004'),
          C('高等代数II',       'MAT01005'),
          C('概率论与数理统计',   'STA02001'),
          C('微观经济学原理',     'ECO01001'),
          C('宏观经济学原理',     'ECO01002'),
          C('政治经济学',        'ECO12003'),
          C('中级微观经济学',     'ECO12004'),
          C('中级宏观经济学',     'ECO12005'),
          C('计量经济学',        'ECO12031'),
        ]},
        { name:'专业核心课', children:[
          C('时间序列分析',     'ECO13005'),
          C('经济思想史',      'ECO12027', true),
          C('社会主义经济理论', 'ECO11001'),
          C('数字经济导论',    'ECO12030'),
          C('金融学',          'ECO12009'),
          C('会计学',          'ECO11002'),
          C('财政学',          'ECO23063'),
          C('实验经济学',      'ECO22002'),
          C('博弈论与信息经济学','ECO23025'),
        ]},
      ]},
      { name:'专业选修课Ⅰ', children:[
        { name:'专业方向课', children:[
          C('管理学',       'ECO11003'),
          C('国际贸易学',    'ECO12008'),
          C('国际金融',     'ECO12011'),
          C('经济史',       'ECO22026'),
          C('经济增长',     'ECO22001'),
          C('产业组织理论',  'ECO23024'),
          C('劳动经济学',    'ECO23027'),
          C('经济计量方法与应用','ECO23030'),
        ]},
      ]},
      { name:'自由选修课', children:[{ name:'个性化发展课', children:[C('个性化发展选修', 'GEN****')]}]},
      { name:'实践环节', children:[
        { name:'劳动教育',         children:[C('大学生劳动教育', 'EDU30001'), C('劳动教育实践活动', 'TLO30801')]},
        { name:'学术训练与实践',    children:[C('学术训练与实践', 'ECO33003')]},
        { name:'专业实习与社会调查', children:[C('专业实习与社会调查', 'ECO31003')]},
        { name:'毕业论文（设计）',   children:[C('毕业论文（设计）', 'ECO41001')]},
      ]},
      { name:'拔尖创新人才', children:[
        C('行为经济学（英文）', 'ECO23076'),
        C('发展经济学（英文）', 'ECO23077'),
        C('创新经济学（英文）', 'ECO23078'),
        C('动态经济学方法', 'ECO12029'),
        C('环境与资源经济学', 'ECO23020'),
        C('国民经济核算', 'ECO23079'),
        C('《资本论》研读', 'MAR20020'),
        C('常微分方程', 'MAT12003'),
        C('实变函数', 'MAT02002'),
        C('泛函分析', 'MAT23001'),
        C('随机过程初步', 'MAT23004'),
        C('数据结构与算法', 'ECO22018'),
        C('数据库原理与应用', 'ECO22017'),
        C('机器学习', 'ECO23071'),
      ]},
    ]
  };

  // 金融科技
  const FINTECH = {
    name:'金融科技', children:[
      { name:'专业必修课', children:[
        { name:'专业基础课', children:[
          C('微积分I',          'MAT01006'),
          C('微积分II',         'MAT01007'),
          C('线性代数',         'MAT02008'),
          C('概率论与数理统计',   'STA02001'),
          C('统计学',           'ECO12032'),
          C('计量经济学',        'ECO12031'),
          C('数据结构与算法',    'ECO22018', true),
        ]},
        { name:'专业核心课', children:[
          C('社会主义经济理论',     'ECO11001'),
          C('微观经济学原理',       'ECO01001'),
          C('宏观经济学原理',       'ECO01002'),
          C('会计学',             'ECO12002'),
          C('金融学',             'ECO12009'),
          C('国际金融',           'ECO12011'),
          C('金融市场学',          'ECO12033'),
          C('数字金融',           'ECO12036'),
          C('保险学',             'ECO12034'),
          C('金融大数据分析',       'ECO23069', true),
          C('数据库原理与应用',     'ECO22017'),
          C('区块链与数字资产',     'ECO23066'),
        ]},
      ]},
      { name:'专业选修课Ⅰ', children:[
        { name:'专业方向课', children:[
          C('世界金融史',     'ECO21001', true),
          C('管理学',        'ECO11003'),
          C('国际贸易学',     'ECO12008'),
          C('中级微观经济学',  'ECO12004'),
          C('中级宏观经济学',  'ECO12005'),
          C('商业银行学',     'ECO23036'),
          C('财务分析',       'ECO23006'),
          C('投资学',         'ECO23037'),
          C('公司金融',       'ECO12035'),
          C('金融衍生工具',    'ECO23080'),
          C('财政学',         'ECO23063'),
          C('行为金融学',     'ECO23074'),
          C('投资银行学',     'ECO23038'),
          C('固定收益证券',    'ECO23081'),
          C('金融风险管理',    'ECO23082'),
          C('机器学习',       'ECO23071'),
          C('金融经济学',     'ECO23084'),
        ]},
      ]},
      { name:'自由选修课', children:[{ name:'个性化发展课', children:[C('个性化发展选修', 'GEN****')]}]},
      { name:'实践环节', children:[
        { name:'劳动教育',         children:[C('大学生劳动教育', 'EDU30001'), C('劳动教育实践活动', 'TLO30801')]},
        { name:'学术训练与实践',    children:[C('学术训练与实践', 'ECO33003')]},
        { name:'专业实习与社会调查', children:[C('专业实习与社会调查', 'ECO31003')]},
        { name:'毕业论文（设计）',   children:[C('毕业论文（设计）', 'ECO41001')]},
      ]},
      { name:'拔尖创新人才', children:[
        C('金融学新生研讨', 'ECO21002'),
        C('数字经济导论', 'ECO12030'),
        C('量化交易基础与实践', 'ECO21003'),
        C('国家经济安全概论', 'ECO23085'),
        C('算法与程序设计（C++）', 'GEN04239'),
        C('金融科技理论与实践', 'ECO22024'),
        C('金融建模', 'ECO23086'),
        C('实证金融方法', 'ECO23087'),
        C('数字贸易学', 'ECO23088'),
        C('深度学习', 'ECO23072'),
        C('创业融资', 'ECO23089'),
        C('深度学习技术与应用', 'GEN04254'),
        C('大数据技术及应用', 'GEN04255'),
        C('金融科技学术前沿与论文写作', 'ECO23094'),
      ]},
    ]
  };

  // 工商管理
  const BIZ_ADMIN = {
    name:'工商管理', children:[
      { name:'专业必修课', children:[
        { name:'专业基础课', children:[
          C('微积分I',          'MAT01006'),
          C('微积分II',         'MAT01007'),
          C('线性代数',         'MAT02008'),
          C('概率论与数理统计',   'STA02001'),
          C('计量经济学',        'ECO12031'),
          C('统计学',           'ECO12032'),
          C('微观经济学原理',     'ECO01001'),
          C('管理学',           'ECO11003'),
        ]},
        { name:'专业核心课', children:[
          C('数字企业管理原理',   'ECO22022'),
          C('大数据原理和应用',   'ECO12037'),
          C('会计学',           'ECO11002'),
          C('市场营销',         'ECO12038'),
          C('组织行为学',        'ECO12039'),
          C('人力资源管理',      'ECO12040', true),
          C('战略管理',         'ECO12041'),
          C('财务管理',         'ECO12042'),
          C('公司治理',         'ECO13004'),
          C('管理思想史',        'ECO12043'),
        ]},
      ]},
      { name:'专业选修课Ⅰ', children:[
        { name:'专业方向课', children:[
          C('供应链管理',      'ECO23048'),
          C('数字商务',        'ECO23106'),
          C('数字营销',        'ECO23055', true),
          C('数字化运营管理',   'ECO22023'),
          C('管理信息系统',     'ECO22009'),
          C('数字品牌战略',     'ECO23107'),
          C('商业模式概论',     'ECO22015'),
          C('项目管理',        'ECO22011'),
          C('服务管理',        'ECO22010'),
          C('跨文化管理',      'ECO22008'),
          C('管理沟通',        'ECO23041'),
          C('职业生涯规划',    'ECO23108'),
          C('公共关系学',      'ECO23047'),
          C('创业学',          'ECO23121'),
          C('绩效与薪酬管理',  'ECO23109'),
          C('人力资源管理实证研究','ECO23075'),
        ]},
      ]},
      { name:'自由选修课', children:[{ name:'个性化发展课', children:[C('个性化发展选修', 'GEN****')]}]},
      { name:'实践环节', children:[
        { name:'劳动教育',         children:[C('大学生劳动教育', 'EDU30001'), C('劳动教育实践活动', 'TLO30801')]},
        { name:'学术训练与实践',    children:[C('学术训练与实践', 'ECO33003')]},
        { name:'专业实习与社会调查', children:[C('专业实习与社会调查', 'ECO31003')]},
        { name:'毕业论文（设计）',   children:[C('毕业论文（设计）', 'ECO41001')]},
      ]},
      { name:'拔尖创新人才', children:[
        C('数字经济导论', 'ECO12030'),
        C('产业组织', 'ECO23110'),
        C('数字创新管理', 'ECO23111'),
        C('Python数据分析与挖掘', 'ECO23112'),
        C('消费心理学', 'ECO23113'),
        C('商业伦理与企业社会责任', 'ECO23009'),
        C('金融科技理论与实践', 'ECO22024'),
        C('数据结构与算法', 'ECO22018'),
        C('经济计量方法与应用', 'ECO23030'),
        C('经济思想史', 'ECO12027'),
      ]},
    ]
  };

  // 会计学
  const ACCOUNTING = {
    name:'会计学', children:[
      { name:'专业必修课', children:[
        { name:'专业基础课', children:[
          C('微积分I',          'MAT01006'),
          C('微积分II',         'MAT01007'),
          C('线性代数',         'MAT02008'),
          C('概率论与数理统计',   'STA02001'),
          C('计量经济学',        'ECO12031'),
          C('统计学',           'ECO12032'),
          C('微观经济学原理',     'ECO01001'),
          C('管理学',           'ECO11003'),
          C('宏观经济学原理',     'ECO01002'),
        ]},
        { name:'专业核心课', children:[
          C('会计学原理',               'ECO12001'),
          C('财务会计',                'ECO12016'),
          C('财务管理',                'ECO13003'),
          C('管理会计',                'ECO12015', true),
          C('会计信息系统',             'ECO13001'),
          C('审计学',                  'ECO23001'),
          C('税法',                    'ECO12014', true),
          C('商业伦理与企业社会责任',     'ECO23009'),
        ]},
      ]},
      { name:'专业选修课Ⅰ', children:[
        { name:'专业方向课', children:[
          C('成本会计',               'ECO23114'),
          C('政府与非营利组织会计',     'ECO23005'),
          C('高级财务会计',            'ECO23115'),
          C('财务分析',               'ECO23006'),
          C('国际财务管理',            'ECO23008'),
          C('战略管理',               'ECO12041'),
          C('公司治理',               'ECO13004'),
          C('组织行为学',              'ECO12039'),
          C('人力资源管理',            'ECO12040'),
          C('供应链管理',              'ECO23048'),
          C('金融学',                 'ECO12009'),
          C('基金管理与证券投资分析',    'ECO23083'),
          C('金融风险管理',            'ECO23082'),
          C('财政学',                 'ECO23063'),
          C('国际贸易学',              'ECO12008'),
        ]},
      ]},
      { name:'自由选修课', children:[{ name:'个性化发展课', children:[C('个性化发展选修', 'GEN****')]}]},
      { name:'实践环节', children:[
        { name:'劳动教育',         children:[C('大学生劳动教育', 'EDU30001'), C('劳动教育实践活动', 'TLO30801')]},
        { name:'学术训练与实践',    children:[C('学术训练与实践', 'ECO33003')]},
        { name:'专业实习与社会调查', children:[C('专业实习与社会调查', 'ECO31003')]},
        { name:'毕业论文（设计）',   children:[C('毕业论文（设计）', 'ECO41001')]},
      ]},
      { name:'拔尖创新人才', children:[
        C('国际会计（英文）', 'ECO23116'),
        C('国际商务（英文）', 'ECO23117'),
        C('行为会计学', 'ECO23118'),
        C('大数据审计', 'ECO23119'),
        C('会计前沿专题', 'ECO23120'),
        C('数字企业管理原理', 'ECO22022'),
        C('数字经济导论', 'ECO12030'),
        C('大数据原理和应用', 'ECO12037'),
        C('金融科技理论与实践', 'ECO22024'),
        C('经济计量方法与应用', 'ECO23030'),
      ]},
    ]
  };

  // ── 法学（卓越实验班）──
  const LAW = {
    name:'法学（卓越实验班）', children:[
      { name:'专业必修课', children:[
        { name:'专业基础课', children:[
          C('法理学导论',     'LAW01001'),
          C('宪法学',         'LAW02002', true),
          C('习近平法治思想概论','LAW01003'),
        ]},
        { name:'专业核心课', children:[
          C('法理学专论',        'LAW13001'),
          C('中国法律史',        'LAW11001'),
          C('民法总论',          'LAW11002', true),
          C('债与合同法学',      'LAW11003'),
          C('刑法总论',          'LAW11004', true),
          C('刑法分论',          'LAW12001'),
          C('行政法与行政诉讼法学','LAW12002'),
          C('民事诉讼法学',      'LAW12003'),
          C('刑事诉讼法学',      'LAW12004'),
          C('国际公法学',        'LAW12005'),
          C('经济法学',          'LAW12006'),
          C('公司法学',          'LAW12007'),
          C('知识产权法学',      'LAW13002'),
          C('环境资源法学',      'LAW13003'),
          C('国际私法学',        'LAW13004'),
          C('法律职业伦理',      'LAW13005'),
        ]},
      ]},
      { name:'专业选修课Ⅰ', children:[
        { name:'专业方向课', children:[
          { name:'基础理论法学模块', children:[
            C('外国法制史',     'LAW21001'),
            C('中国法律思想史',  'LAW22002'),
            C('西方法律思想史',  'LAW22003'),
            C('现代法学思潮',    'LAW22004'),
            C('法学方法论',      'LAW22001'),
          ]},
          { name:'宪法与行政法学模块', children:[
            C('比较宪法与行政法学',    'LAW23001'),
            C('公共事业与非政府组织法', 'LAW23002'),
            C('行政法专题研究',       'LAW22006'),
            C('国家责任法',           'LAW23003'),
          ]},
          { name:'民商事法学模块', children:[
            C('物权法学',              'LAW21005'),
            C('侵权责任法学',          'LAW22005'),
            C('劳动与社会保障法学',     'LAW23004'),
            C('婚姻家庭与继承法学',     'LAW22009'),
            C('罗马私法',              'LAW23005'),
            C('证券法',                'LAW23006'),
            C('票据法',                'LAW22010'),
            C('破产法',                'LAW23007'),
            C('保险法',                'LAW23008'),
          ]},
          { name:'经济法学与环境资源法学模块', children:[
            C('财政税收法',          'LAW22007'),
            C('金融法',              'LAW22008'),
            C('竞争法',              'LAW23011'),
            C('消费者权益保护法',     'LAW22011'),
            C('法与经济学',          'LAW23010'),
          ]},
          { name:'刑法学模块', children:[
            C('犯罪学',       'LAW22012'),
            C('英美刑法',      'LAW22013'),
            C('大陆刑法',      'LAW22014'),
            C('刑事政策学',    'LAW22015'),
            C('国际刑法',      'LAW23013'),
            C('刑法新思维',    'LAW22016'),
            C('比较刑事法',    'LAW22019'),
          ]},
          { name:'诉讼法学模块', children:[
            C('强制执行法',    'LAW23015'),
            C('证据法',        'LAW23016'),
            C('仲裁法',        'LAW22017'),
          ]},
          { name:'国际法学模块', children:[
            C('国际经济法学',           'LAW22018'),
            C('世界贸易组织法',          'LAW23014'),
            C('海洋法',                'LAW23018'),
            C('国际人权法',             'LAW23019'),
            C('英美法案例研读入门',      'LAW22027'),
          ]},
          { name:'法律实务模块', children:[
            C('法律诊所',              'LAW23801'),
            C('模拟法庭实验',           'LAW23802'),
            C('法律文书写作',           'LAW23020'),
            C('律师法与律师实务',       'LAW23021'),
            C('法律英语',              'LAW22026'),
            C('法学论文写作与发表',      'LAW23022'),
            C('民法案例研讨',           'LAW22801'),
            C('刑法案例研讨',           'LAW22802'),
            C('行政法案例研讨',         'LAW22803'),
            C('商法案例研讨',           'LAW23803'),
            C('经济法案例研讨',         'LAW23804'),
            C('涉外经济贸易案例研讨',    'LAW23805'),
            C('法律实证研究方法导论',    'LAW23023'),
            C('法学理论前沿问题研究',    'LAW22804'),
            C('法律实践热点问题研究',    'LAW22805'),
          ]},
        ]},
      ]},
      { name:'自由选修课', children:[
        { name:'个性化发展课', children:[C('个性化发展选修', 'GEN****')]},
      ]},
      { name:'实践环节', children:[
        { name:'劳动教育',         children:[C('大学生劳动教育', 'EDU30001'), C('劳动教育实践活动', 'TLO30801')]},
        { name:'学术训练与实践',    children:[C('学术训练与实践', 'LAW33004')]},
        { name:'专业实习与社会调查', children:[C('专业实习与社会调查', 'LAW31002')]},
        { name:'毕业论文（设计）',   children:[C('毕业论文（设计）', 'LAW32003')]},
      ]},
      { name:'拔尖创新人才', children:[
        { name:'教育法治微专业', children:[
          C('教育法学',               'LAW23024'),
          C('未成年人法学',            'LAW23025'),
          C('教育法治与教师法律素养',  'LAW23026'),
          C('学校法律实务',            'LAW23027'),
          C('未成年人司法',            'LAW23028'),
        ]},
        { name:'网络法治微专业', children:[
          C('大数据法治',                'LAW22020'),
          C('网络与人工智能法',           'LAW23029'),
          C('比较电子商务法',             'LAW23030'),
          C('互联网平台治理',             'LAW23031'),
          C('信息刑法',                  'LAW22021'),
          C('网络知识产权前沿与案例',      'LAW23032'),
        ]},
        { name:'涉外法治微专业', children:[
          C('比较法律文化',               'LAW22022'),
          C('海商法',                     'LAW23033'),
          C('国际贸易法',                 'LAW23034'),
          C('国际民事诉讼与商事仲裁法',    'LAW23035'),
          C('国际刑事司法前沿',            'LAW23036'),
        ]},
        { name:'反腐败法治微专业', children:[
          C('反腐败法治专题研究',               'LAW22023'),
          C('国家监察法学',                     'LAW22024'),
          C('反腐败追逃追赃的理论与实务',       'LAW23037'),
          C('世界反腐法制比较研究',             'LAW23038'),
          C('《联合国反腐败公约》与中国刑事法的协调','LAW22025'),
        ]},
      ]},
    ]
  };

  // ── Compile full tree ──
  const COURSE_TREE = {
    '通识课': { children: TONGKE_CATS },
    '专业课': { children: [
      { name:'经济与工商管理学院', iconClass:'columns', children:[ FINANCE, ECONOMICS_LIYUN, FINTECH, BIZ_ADMIN, ACCOUNTING ]},
      { name:'法学院', iconClass:'scales', children:[ LAW ]},
    ]},
  };

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

    for (const [key, val] of Object.entries(COURSE_TREE)) {
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
    if (!path.length) return null;
    let node = COURSE_TREE[path[0]];
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