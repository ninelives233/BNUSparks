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
  // 文件详情弹窗
  var fiOverlay = document.querySelector('.file-info-overlay');
  if (fiOverlay) {
    closeFileInfoModal(null);
    return;
  }
  // 预览弹窗
  var pvOverlay = document.querySelector('.preview-overlay');
  if (pvOverlay) {
    closePreview();
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
      expPath = state.expPath.slice();
      renderExplorer();
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

  // 恢复刷新前的视图
  try {
    var saved = JSON.parse(sessionStorage.getItem('bnusparks_view'));
    if (saved && saved._bnusparks) {
      _suppressingPushState = true;
      history.replaceState(saved, '');
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
        default: showHome();
      }
      _suppressingPushState = false;
      return;
    }
  } catch(e) {}
  // 默认首页
  showHome();

  // 每 30 秒刷新通知徽章
  setInterval(function() {
    if (currentUser) loadNotifCount();
  }, 30000);
});
