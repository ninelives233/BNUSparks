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

  // ── 正常视图切换 + 恢复内部状态 ──
  if (state && state.view && typeof switchView === 'function') {
    switchView(state.view, true);
    // 课程浏览器：恢复导航路径
    if (state.view === 'explorer' && state.expPath && Array.isArray(state.expPath)) {
      expPath = state.expPath.slice();
      renderExplorer();
      if (state.scrollY) requestAnimationFrame(function(){ window.scrollTo({top: state.scrollY}); });
    }
    // 更新侧栏高亮
    if (typeof updateSidebar === 'function') updateSidebar(state.view);
    return;
  }
  if (typeof showHome === 'function') showHome(true);
});

// ── 启动 ──
document.addEventListener('DOMContentLoaded', async () => {
  await loadCourseTree();
  buildSameNameMap();
  var hasToken = sessionStorage.getItem('token') || localStorage.getItem('token');
  if (hasToken) {
    document.querySelectorAll('#sideAdminLink, #mobAdminLink').forEach(function(link) {
      link.style.display = '';
    });
  }
  await checkAuth();

  // 邮箱验证链接检查
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

  setupSearch(); loadStats();
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
        case 'rankings': showTopDownloaded(saved.scrollY); break;
        case 'leaderboard': showLeaderboard(); break;
        case 'recentAll': showRecentAll(saved.scrollY); break;
        case 'profile': showProfile(); break;
        case 'notif': showNotifFull(); break;
        case 'admin': showAdminPanel(); break;
        case 'about': showAbout(saved.aboutSection || 'introduction'); break;
        case 'tutorial': showTutorial(); break;
        case 'announcements': showAnnouncements(); break;
        case 'broad': showBroad(); break;
        case 'myuploads': showMyUploadsPage(); break;
        case 'mydownloads': showMyDownloadsPage(); break;
        case 'userPublic': showUserPublic(saved.userId); break;
        default: showHome();
      }
      _suppressingPushState = false;
      return;
    }
  } catch(e) {}
  // 默认首页
  showHome();
});
