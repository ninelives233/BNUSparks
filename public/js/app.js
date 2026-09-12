// ── 未登录权限收紧（v=164）────────────────────────────
// 未登录用户仅能观看网站外壳：tab 栏 / 登录按钮与认证弹窗 / 移动底栏 / Footer 备案外链 /
// Logo / 首页卡片（教程·公告·关于）与「更多 →」直达可点；其余任何点击都唤起登录弹窗。
// 登录用户（currentUser 非空）完全不受影响。capture 阶段拦截，优先于各视图的冒泡 handler。
document.addEventListener('click', function(e) {
  if (currentUser) return;
  var lm = document.getElementById('loginModal');
  if (lm && lm.style.display === 'flex') return; // 登录弹窗已开：不重复拦截其交互
  var t = e.target;
  if (t.closest('.side-nav a, .login-btn, '
      + '#loginModal, #registerModal, #forgotPwdModal, #resetPwdModal, .site-footer a, '
      + '.header-logo-area, .hl-burger, #navDrawer, .home-nav-card, .hc-more, #qaView, #courseNavBar, #mobileBottomNav, #otherView, #notifDrawer, .appearance-panel, '
      + '.guest-appearance-trigger, .compact-campus-link, .compact-campus-more, .compact-announcement-link, '
      + '.compact-recommend-more, .recommendations-page')) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  showLoginModal();
}, true);

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
  var dynOverlay = document.querySelector('.search-overlay, .admin-reject-overlay, .announcement-editor-overlay, .course-switch-overlay, .campus-manager-overlay, .campus-more-overlay');
  if (dynOverlay) {
    if (dynOverlay.classList.contains('course-switch-overlay') && typeof closeCourseSwitchPanel === 'function') closeCourseSwitchPanel();
    else if (dynOverlay.classList.contains('campus-manager-overlay') && typeof closeCampusManager === 'function') closeCampusManager();
    else if (dynOverlay.classList.contains('campus-more-overlay') && typeof closeCampusLinksPanel === 'function') closeCampusLinksPanel();
    else _removeOverlay(dynOverlay);
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

  // ── 汉堡导航抽屉：开启状态下后退先关抽屉；回到该状态则重开 ──
  var _nv = document.getElementById('navDrawer');
  if (_nv && _nv.style.display === 'flex' && (!state || state.view !== 'navDrawer')) {
    closeNavDrawer();
    return;
  }
  if (state && state.view === 'navDrawer') {
    if (_nv && _nv.style.display !== 'flex') {
      // popstate 内重开不能走 openNavDrawer（其会 push 新历史条目）
      switchView('home');
      updateSidebar('home');
      renderNavDrawer();
      _nv.style.display = 'flex';
      lockScroll();
      var _nb = document.getElementById('hlBurger');
      if (_nb) _nb.setAttribute('aria-expanded', 'true');
    } else {
      closeNavDrawer();
    }
    return;
  }

  // ── 抽屉状态：智能判断层级 ──
  if (state && state.view === 'drawer') {
    var _dc = document.getElementById('notifDrawer');
    var _ne = document.getElementById('drawerNotif');
    var _ae = document.getElementById('drawerAppearance');

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

    // 抽屉处于通知/外观子视图 → 回到菜单
    if (_ne && getComputedStyle(_ne).display !== 'none') {
      showDrawerMenu();
      return;
    }
    if (_ae && getComputedStyle(_ae).display !== 'none') {
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
  var _nd2 = document.getElementById('navDrawer');
  if (_nd2 && _nd2.style.display === 'flex') closeNavDrawer();

  // ── 正常视图切换 + 恢复内部状态 ──
  if (state && state.view && typeof switchView === 'function') {
    switchView(state.view, true);
    if (state.view === 'rankings' && typeof renderTopDownloaded === 'function') renderTopDownloaded(state.scrollY, state.rankingType);
    if (state.view === 'recentAll' && typeof renderRecentAll === 'function') renderRecentAll(state.scrollY);
    if (state.view === 'recommendations' && typeof loadRecommendationsPage === 'function') loadRecommendationsPage();
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
        updateSidebar('allCourses');
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
    // 问答区：返回时重新渲染
    if (state.view === 'qa' && typeof renderQaView === 'function') renderQaView();
    // 问答区发布/编辑：从历史状态恢复 mode 后重渲染（v175）
    if (state.view === 'qaCompose' && typeof renderQaCompose === 'function') {
      if (typeof _qaComposeMode !== 'undefined') {
        _qaComposeMode = { type: state.type || 'question', action: state.action || 'create', qid: state.qid, aid: state.aid };
      }
      renderQaCompose();
      if (state.scrollY) requestAnimationFrame(function(){ window.scrollTo({top: state.scrollY}); });
    }
    if (state.view === 'timetable' && typeof ttNavTimetable === 'function') {
      ttNavTimetable(state.userId || null);
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
document.addEventListener('DOMContentLoaded', () => {
  // 关闭浏览器原生滚动恢复，滚动位置完全由 JS 显式控制，
  // 避免其与视图切换的平滑滚动竞争导致刷新后页面自动下滑
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  // 先确定要恢复的视图。公共页面不再等待认证、统计或课程树。
  var saved = null;
  var route = parseRoute(location.pathname);
  if (route && route.view === 'rankings' && new URLSearchParams(location.search).get('type') === 'favorite') route.rankingType = 'favorite';
  if (route) {
    // 保留动态路由的全部参数（尤其 qaCompose 的 type/action/qid/aid）。
    saved = Object.assign({ _bnusparks: true }, route);
  } else {
    try { saved = JSON.parse(sessionStorage.getItem('bnusparks_view')); } catch(e) {}
  }
  var initialView = saved && saved._bnusparks ? saved.view : 'home';
  var authViews = ['profile', 'notif', 'admin', 'myuploads', 'mydownloads', 'myfavorites', 'newCourse', 'qaCompose', 'timetable'];
  var needsAuth = authViews.indexOf(initialView) !== -1;
  var isRootLanding = location.pathname === '/';
  var hasToken = sessionStorage.getItem('token') || localStorage.getItem('token');
  // 根路径是“打开网站”的默认入口；有会话时等认证完成，才能按账号偏好决定首页或我的课程。
  var needsLandingAuth = isRootLanding && !!hasToken;

  var viewFeaturePromise = Promise.resolve();
  if (initialView === 'explorer' || initialView === 'newCourse' || initialView === 'fileDetail') {
    viewFeaturePromise = ensureFeature('explorer');
  } else if (initialView === 'qa' || initialView === 'qaCompose') {
    viewFeaturePromise = ensureFeature('qa');
  } else if (initialView === 'admin') {
    viewFeaturePromise = ensureFeature('admin');
  } else if (initialView === 'timetable') {
    viewFeaturePromise = ensureFeature('timetable');
  }

  // 刷新课表时先保留目标视图，避免认证/懒加载期间短暂显示首页，
  // 也避免模块请求失败时被兜底逻辑带回首页。
  if (initialView === 'timetable' && typeof switchView === 'function') {
    switchView('timetable', true);
    if (typeof updateSidebar === 'function') updateSidebar('timetable');
  }

  // 课程树只在首次视图确实需要时加载；进入 explorer 时 renderExplorer 会兜底按需加载。
  const needsCourseTree = initialView === 'explorer' || initialView === 'newCourse';
  const treePromise = needsCourseTree
    ? viewFeaturePromise.then(() => loadCourseTree()).then(() => buildSameNameMap())
    : viewFeaturePromise;
  const authPromise = checkAuth().then(() => {
    if (currentUser) loadNotifCount();
    if (typeof isMgmtActive === 'function') document.body.classList.toggle('mgmt-active', isMgmtActive());
    // 课程树先到时可能以访客状态渲染；认证完成后补一次权限/身份相关渲染。
    if (initialView === 'explorer') {
      if (currentUser && typeof loadCourseFavorites === 'function') {
        loadCourseFavorites().then(function() {
          var loadedExplorer = document.getElementById('explorerView');
          if (loadedExplorer && loadedExplorer.classList.contains('active')) renderExplorer();
        });
      }
      var explorer = document.getElementById('explorerView');
      if (explorer && explorer.classList.contains('active')) renderExplorer();
    }
  });
  // 受保护视图入口（尤其移动端底栏）可能早于认证请求完成；
  // 暴露同一条认证 Promise，让入口等待“认证中”而不是误判为未登录。
  window._bnusparksAuthReady = authPromise;

  // 有 token 时先显示两个受保护入口，避免认证请求完成前侧栏没有响应；
  // 最终的管理员角色判断仍由 updateAuthUI 完成。
  if (hasToken) {
    document.querySelectorAll('#sideAdminLink').forEach(function(link) {
      link.style.display = '';
    });
    document.querySelectorAll('#sideTimetableLink').forEach(function(link) {
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
              if (typeof setAuthenticatedUser === 'function') setAuthenticatedUser(data.user);
              else currentUser = data.user;
            }
            history.replaceState(null, '', '/');
            alert('✅ ' + (data.message || '邮箱验证成功！'));
            showHome();
            updateAuthUI();
          })
          .catch(function(err) {
            history.replaceState(null, '', '/');
            showHome();
            updateAuthUI();
            var verifyMessage = err.message || '验证失败';
            if (/已完成验证|直接登录/.test(verifyMessage)) {
              alert(verifyMessage);
              showLoginModal();
            } else if (/过期|无效/.test(verifyMessage) && typeof showVerificationResend === 'function') {
              showVerificationResend(verifyMessage + '。填写学号后可直接重新发送，无需重填其他注册信息。');
            } else {
              alert('验证失败：' + verifyMessage + '\n请稍后重试或联系管理员。');
            }
          });
      }
    })();
  } catch(e) {}

  setupSearch();

  function renderInitialView() {
    function showDefaultLanding(restoreScrollY) {
      var appearance = typeof getBnuAppearance === 'function' ? getBnuAppearance() : null;
      if (isRootLanding && currentUser && appearance && appearance.default_view === 'timetable' &&
          typeof ttNavTimetable === 'function') {
        return ttNavTimetable();
      }
      return showHome(restoreScrollY);
    }

    // 恢复刷新前的视图：URL 路由优先（可分享深链直达），sessionStorage 兜底（旧逻辑）
    if (saved && saved._bnusparks) {
      _suppressingPushState = true;
      // 兜底恢复时顺带把地址栏写成对应路径，让 URL 与视图一致
      history.replaceState(saved, '', routeToPath(saved.view, saved) || '');
      switch (saved.view) {
        case 'home': showDefaultLanding(saved.scrollY); break;
        case 'explorer':
          expPath = saved.expPath || ['专业课'];
          renderExplorer();
          switchView('explorer', true);
          updateSidebar('allCourses');
          if (saved.scrollY) requestAnimationFrame(function(){ window.scrollTo({top: saved.scrollY}); });
          break;
        // rankings/recentAll 不恢复 scrollY：刷新时停在顶部，
        // 避免恢复成首页点击「更多」时的滚动位置导致自动下滑
        case 'rankings': showTopDownloaded(undefined, saved.rankingType); break;
        case 'qa': showQa(); break;
        case 'qaCompose': if (typeof showQaCompose === 'function') showQaCompose(saved); else showQa(); break;
        case 'leaderboard': showLeaderboard(); break;
        case 'other': showOther(); break;
        case 'recentAll': showRecentAll(); break;
        case 'recommendations': showRecommendations(); break;
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
        case 'timetable': ttNavTimetable(saved.userId || null); break;
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
    showDefaultLanding();
  }

  // 只有课程树或受保护视图需要等待；首页/静态页在此之前即可交互。
  Promise.all([treePromise, (needsAuth || needsLandingAuth) ? authPromise : Promise.resolve()])
    .then(renderInitialView)
    .catch(function() { renderInitialView(); });

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

// ── 汉堡导航抽屉：栏目与桌面侧边栏保持同一份事实源（可见性/高亮随侧栏联动） ──
function renderNavDrawer() {
  var body = document.getElementById('navDrawerBody');
  if (!body) return;
  body.innerHTML = '';
  document.querySelectorAll('.side-nav a').forEach(function (a) {
    var view = a.getAttribute('data-view');
    if (!view) return;
    // 隐藏的侧栏入口（未登录的「我的课程」/非管理员的「管理后台」）不同步进抽屉
    if (a.style.display === 'none' || getComputedStyle(a).display === 'none') return;
    var use = a.querySelector('use');
    // 复用 dm-item 类：与用户抽屉条目在任意设备上渲染完全一致
    var item = document.createElement('a');
    item.href = 'javascript:void(0)';
    item.className = 'dm-item' + (a.classList.contains('active') ? ' is-active' : '');
    item.setAttribute('data-view', view);
    item.innerHTML = '<span class="dm-ico"><svg class="sn-icon sidebar-icon" aria-hidden="true"><use href="' +
      (use ? use.getAttribute('href') : '') + '"></use></svg></span><span>' + a.textContent.trim() + '</span>';
    item.addEventListener('click', function () {
      closeNavDrawer();
      if (view === 'home') showHome();
      else if (view === 'allCourses') showAllCourses();
      else if (view === 'qa') showQa();
      else if (view === 'about') showAbout('introduction');
      else if (view === 'admin') showAdminPanel();
      else if (view === 'leaderboard') showLeaderboard();
      else if (view === 'timetable') ttNavTimetable();
    });
    body.appendChild(item);
  });
}

function openNavDrawer() {
  var drawer = document.getElementById('navDrawer');
  if (!drawer) return;
  renderNavDrawer();
  drawer.style.display = 'flex';
  lockScroll();
  var burger = document.getElementById('hlBurger');
  if (burger) burger.setAttribute('aria-expanded', 'true');
  if (typeof pushViewState === 'function') pushViewState('navDrawer', {});
}

function closeNavDrawer(e) {
  if (e && e.target !== e.currentTarget) return;
  var drawer = document.getElementById('navDrawer');
  if (!drawer || drawer.style.display !== 'flex') return;
  drawer.style.display = 'none';
  unlockScroll();
  var burger = document.getElementById('hlBurger');
  if (burger) burger.setAttribute('aria-expanded', 'false');
}
