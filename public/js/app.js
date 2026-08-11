// ── 未登录权限收紧（v=164）────────────────────────────
// 未登录用户仅能观看网站外壳：tab 栏 / 登录按钮与认证弹窗 / 移动抽屉开关 / Footer 备案外链 /
// Logo / 首页卡片（教程·公告·关于）与「更多 →」直达可点；其余任何点击都唤起登录弹窗。
// 登录用户（currentUser 非空）完全不受影响。capture 阶段拦截，优先于各视图的冒泡 handler。
document.addEventListener('click', function(e) {
  if (currentUser) return;
  var lm = document.getElementById('loginModal');
  if (lm && lm.style.display === 'flex') return; // 登录弹窗已开：不重复拦截其交互
  var t = e.target;
  if (t.closest('.side-nav a, #mobileDrawer, #menuOpen, #menuClose, .login-btn, '
      + '#loginModal, #registerModal, #forgotPwdModal, #resetPwdModal, .site-footer a, '
      + '.header-logo-area, .home-nav-card, .hc-more')) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  showLoginModal();
}, true);

// ── Mobile Drawer ──
var drawer = document.getElementById('mobileDrawer');
document.getElementById('menuOpen').addEventListener('click', () => drawer.classList.add('open'));
document.getElementById('menuClose').addEventListener('click', () => drawer.classList.remove('open'));
drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.classList.remove('open'); });

// ── Header scroll shadow ──
var header = document.getElementById('siteHeader');
var ticking = false;
window.addEventListener('scroll', () => {
  if (!ticking) {
    requestAnimationFrame(() => {
      header.classList.toggle('scrolled', window.scrollY > 10);
      ticking = false;
    });
    ticking = true;
  }
});

// ── 浏览器前进/后退 ──
window.addEventListener('popstate', async function(e) {
  const state = e.state;

  // ── 如果有浮层/弹窗打开，先关闭它 ──
  // 预览弹窗（最上层：可能叠在文件详情浮层之上，优先关闭）
  var pvOverlay = document.querySelector('.preview-overlay');
  if (pvOverlay) {
    closePreview();
    return;
  }
  // 文件详情弹窗
  var fiOverlay = document.querySelector('.file-info-overlay');
  if (fiOverlay) {
    closeFileInfoModal(null);
    return;
  }
  // 上传弹窗
  var uploadEl = document.getElementById('uploadModal');
  if (uploadEl && uploadEl.style.display === 'flex') {
    closeUploadModal();
    return;
  }
  // 搜索覆层 / 驳回覆层 / 公告编辑器
  var dynOverlay = document.querySelector('.search-overlay, .admin-reject-overlay, .announcement-editor-overlay');
  if (dynOverlay) {
    _removeOverlay(dynOverlay);
    return;
  }
  // 登录/注册/忘记密码/重置密码弹窗
  var authIds = ['loginModal', 'registerModal', 'forgotPwdModal', 'resetPwdModal'];
  var openAuth = authIds.find(function(id) {
    var el = document.getElementById(id);
    return el && el.style.display === 'flex';
  });
  if (openAuth) {
    closeAuthModal();
    return;
  }

  // ── 遇到残留的 _modal 状态，回退跳过 ──
  if (state && state._modal) {
    history.back();
    return;
  }

  // ── 抽屉状态：智能判断层级 ──
  if (state && state.view === 'drawer') {
    var _dc = document.getElementById('notifDrawer');
    var _ne = document.getElementById('drawerNotif');

    // 抽屉已关闭（从二级页面返回）→ 打开抽屉回到首页
    if (_dc && _dc.style.display !== 'flex') {
      switchView('home');
      updateSidebar('home');
      _dc.style.display = 'flex';
      showDrawerMenu();
      renderDrawerMenu();
      if (typeof refreshCurrentUser === 'function' && currentUser) refreshCurrentUser();
      lockScroll();
      return;
    }

    // 抽屉处于通知子视图 → 回到菜单
    if (_ne && _ne.style.display !== 'none' && _ne.style.display !== '') {
      showDrawerMenu();
      return;
    }

    // 抽屉菜单层级 → 关闭抽屉
    closeNotifDrawer();
    return;
  }

  // ── 导航到非抽屉状态时，关闭打开的抽屉 ──
  var _dc2 = document.getElementById('notifDrawer');
  if (_dc2 && _dc2.style.display === 'flex') closeNotifDrawer();

  // ── 正常视图切换 + 恢复内部状态 ──
  if (state && state.view && typeof switchView === 'function') {
    switchView(state.view, true);
    // 课程浏览器：恢复导航路径
    if (state.view === 'explorer' && state.expPath && Array.isArray(state.expPath)) {
      // 关闭上传等弹窗后 popstate 回到同一视图：expPath 未变且视图已激活 → 跳过冗余重渲染
      // （避免文件列表重新拉取 + 侧边栏高亮丢失）
      var _samePath = expPath.length === state.expPath.length &&
        expPath.every(function(p, i) { return p === state.expPath[i]; });
      var _expEl = document.getElementById('explorerView');
      var _expActive = _expEl && _expEl.classList.contains('active');
      if (!(_samePath && _expActive)) {
        expPath = state.expPath.slice();
        renderExplorer();
      }
      // 恢复侧边栏高亮：侧边栏无 data-view="explorer"，需映射到 通识课/专业课
      if (typeof updateSidebar === 'function') {
        updateSidebar(state.expPath[0] === '通识课' ? 'general' : 'major');
      }
      if (state.scrollY) requestAnimationFrame(function(){ window.scrollTo({top: state.scrollY}); });
    }
    // 文件详情页：重新加载（优先缓存，否则 API）
    if (state.view === 'fileDetail' && state.fileId) {
      // 尝试从文件缓存恢复
      if (window._fileLookup && window._fileLookup[state.fileId]) {
        showFileDetail(window._fileLookup[state.fileId]);
      } else {
        showFileDetail({ id: state.fileId, title: '' });
      }
      if (state.scrollY) requestAnimationFrame(function(){ window.scrollTo({top: state.scrollY}); });
    }
    // 新建课程页：重渲染面包屑与表单
    if (state.view === 'newCourse' && typeof renderNewCourseView === 'function') {
      renderNewCourseView();
      if (state.scrollY) requestAnimationFrame(function(){ window.scrollTo({top: state.scrollY}); });
    }
    // 个人中心三视图：返回时重新渲染（数据可能已变化，且 popstate 路径此前未恢复）
    if (state.view === 'myuploads' && typeof renderMyUploadsPage === 'function') renderMyUploadsPage();
    if (state.view === 'mydownloads' && typeof renderMyDownloadsPage === 'function') renderMyDownloadsPage();
    if (state.view === 'myfavorites' && typeof renderMyFavoritesPage === 'function') renderMyFavoritesPage();
    // 更新侧栏高亮
    if (state.view === 'fileDetail' && state.prevView) {
      if (typeof updateSidebar === 'function') updateSidebar(state.prevView);
    } else if (typeof updateSidebar === 'function') {
      updateSidebar(state.view);
    }
    return;
  }
  if (typeof showHome === 'function') showHome(true);
});

// ── 启动 ──
document.addEventListener('DOMContentLoaded', async () => {
  // 关闭浏览器原生滚动恢复，滚动位置完全由 JS 显式控制，
  // 避免其与视图切换的平滑滚动竞争导致刷新后页面自动下滑
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  // 并行触发所有独立请求（串行 800ms → 并行 ~200ms）
  const treePromise = loadCourseTree();
  const authPromise = checkAuth().then(() => {
    loadNotifCount();
    if (typeof loadCourseFavorites === 'function') loadCourseFavorites();
    if (typeof isMgmtActive === 'function') document.body.classList.toggle('mgmt-active', isMgmtActive());
  });
  const statsPromise = loadStats();

  // 树加载后构建同名映射
  treePromise.then(() => buildSameNameMap());

  // Admin 侧栏链接基于 token 存储立即显示，不等待 auth API
  var hasToken = sessionStorage.getItem('token') || localStorage.getItem('token');
  if (hasToken) {
    document.querySelectorAll('#sideAdminLink, #mobAdminLink').forEach(function(link) {
      link.style.display = '';
    });
  }

  // 邮箱验证链接检查（不阻塞其他加载，用 then/catch 非阻塞）
  try {
    (function() {
      var params = new URLSearchParams(window.location.search);
      var uid = params.get('uid');
      var vtoken = params.get('vtoken');
      if (uid && vtoken) {
        _suppressingPushState = true;
        api('/api/auth/verify-email/', { method: 'POST', body: { uid: parseInt(uid), vtoken: vtoken } })
          .then(function(data) {
            if (data.token) {
              _persistToken(data.token, false, data.user && data.user.id);
              currentUser = data.user;
            }
            history.replaceState(null, '', '/');
            alert('✅ ' + (data.message || '邮箱验证成功！'));
            showHome();
            updateAuthUI();
          })
          .catch(function(err) {
            history.replaceState(null, '', '/');
            alert('验证失败：' + err.message + '\n请重新注册或联系管理员。');
            showHome();
            updateAuthUI();
          });
      }
    })();
  } catch(e) {}

  setupSearch();

  // 等待关键数据就绪后再恢复视图
  await Promise.all([treePromise, authPromise, statsPromise]).catch(function(){});

  // 恢复刷新前的视图：URL 路由优先（可分享深链直达），sessionStorage 兜底（旧逻辑）
  var saved = null;
  var route = parseRoute(location.pathname);
  if (route) {
    saved = { _bnusparks: true, view: route.view };
    if (route.expPath && route.expPath.length) saved.expPath = route.expPath;
    if (route.userId) saved.userId = route.userId;
    if (route.fileId) saved.fileId = route.fileId;
  } else {
    try { saved = JSON.parse(sessionStorage.getItem('bnusparks_view')); } catch(e) {}
  }
  if (saved && saved._bnusparks) {
    _suppressingPushState = true;
    // 兜底恢复时顺带把地址栏写成对应路径，让 URL 与视图一致
    history.replaceState(saved, '', routeToPath(saved.view, saved) || '');
    switch (saved.view) {
      case 'home': showHome(saved.scrollY); break;
      case 'explorer':
        expPath = saved.expPath || ['专业课'];
        renderExplorer();
        switchView('explorer', true);
        updateSidebar(expPath[0] === '通识课' ? 'general' : 'major');
        if (saved.scrollY) requestAnimationFrame(function(){ window.scrollTo({top: saved.scrollY}); });
        break;
      // rankings/recentAll 不恢复 scrollY：刷新时停在顶部，
      // 避免恢复成首页点击「更多」时的滚动位置导致自动下滑
      case 'rankings': showTopDownloaded(); break;
      case 'leaderboard': showLeaderboard(); break;
      case 'recentAll': showRecentAll(); break;
      case 'profile': showProfile(); break;
      case 'notif': showNotifFull(); break;
      case 'admin': showAdminPanel(); break;
      case 'about': showAbout(saved.aboutSection || 'introduction'); break;
      case 'tutorial': showTutorial(); break;
      case 'announcements': showAnnouncements(); break;
      case 'broad': showBroad(); break;
      case 'myuploads': showMyUploadsPage(); break;
      case 'mydownloads': showMyDownloadsPage(); break;
      case 'myfavorites': showMyFavoritesPage(); break;
      case 'fileDetail':
        // 尝试从文件缓存恢复，否则从 API 获取
        if (window._fileLookup && saved.fileId && window._fileLookup[saved.fileId]) {
          showFileDetail(window._fileLookup[saved.fileId]);
        } else if (saved.fileId) {
          showFileDetail({ id: saved.fileId, title: '' });
        } else {
          showHome();
        }
        break;
      case 'userPublic': showUserPublic(saved.userId); break;
      case 'newCourse': renderNewCourseView(); break;
      default: showHome();
    }
    _suppressingPushState = false;
    return;
  }
  // 未知路径深链：既无路由也无保存视图 → 地址栏对齐根路径再显示首页
  if (location.pathname !== '/' && !/^\/(verify-email|reset-password)\//.test(location.pathname)) {
    history.replaceState(null, '', '/');
  }
  // 默认首页
  showHome();

  // 每 20 秒刷新通知徽章 + 切回页面/聚焦时立即刷新（v=148 红点同步）
  setInterval(function() {
    if (currentUser) loadNotifCount();
  }, 20000);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && currentUser) loadNotifCount();
  });
  window.addEventListener('focus', function() {
    if (currentUser) loadNotifCount();
  });
});
