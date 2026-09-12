/* BNU Sparks · 外观偏好
 * 预览、待保存和已保存值分开管理；账号写入串行化，旧响应不能越过账号/认证代次。
 * 游客只保存到本设备，账号以服务端返回值为准。
 */
(function () {
  'use strict';

  var DEFAULTS = { home_layout: 'loose', color_theme: 'warm', mobile_nav: 'bottom', default_view: 'home' };
  var LAYOUTS = { loose: true, compact: true };
  var THEMES = { warm: true, cool: true, dark: true, system: true };
  var NAVS = { bottom: true, burger: true };
  var DEFAULT_VIEWS = { home: true, timetable: true };
  var GUEST_KEY = 'bnusparks_appearance_guest';
  var SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';
  var _appearanceContext = null;
  var _systemThemeMediaQuery = null;

  function normalize(raw) {
    raw = raw || {};
    return {
      home_layout: LAYOUTS[raw.home_layout] ? raw.home_layout : DEFAULTS.home_layout,
      color_theme: THEMES[raw.color_theme] ? raw.color_theme : DEFAULTS.color_theme,
      mobile_nav: NAVS[raw.mobile_nav] ? raw.mobile_nav : DEFAULTS.mobile_nav,
      default_view: DEFAULT_VIEWS[raw.default_view] ? raw.default_view : DEFAULTS.default_view
    };
  }

  function sameValue(left, right) {
    return !!left && !!right && left.home_layout === right.home_layout &&
      left.color_theme === right.color_theme && left.mobile_nav === right.mobile_nav &&
      left.default_view === right.default_view;
  }

  function readGuest() {
    try { return normalize(JSON.parse(localStorage.getItem(GUEST_KEY) || '{}')); }
    catch (e) { return normalize(); }
  }

  function writeGuest(value) {
    try {
      localStorage.setItem(GUEST_KEY, JSON.stringify(normalize(value)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function accountKey(user) {
    return user && user.id ? 'bnusparks_appearance_user_' + String(user.id) : '';
  }

  function readAccount(user) {
    var key = accountKey(user);
    if (!key) return null;
    try {
      var cached = JSON.parse(localStorage.getItem(key) || '');
      return cached && cached.home_layout && cached.color_theme ? normalize(cached) : null;
    } catch (e) {
      return null;
    }
  }

  function writeAccount(user, value) {
    var key = accountKey(user);
    if (!key) return false;
    try {
      localStorage.setItem(key, JSON.stringify(normalize(value)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function authSnapshot(user) {
    return {
      userId: user && user.id ? String(user.id) : null,
      generation: Number(window._bnuAuthGeneration || 0)
    };
  }

  function isCurrentContext(context, snapshot) {
    if (_appearanceContext !== context) return false;
    var currentId = typeof currentUser !== 'undefined' && currentUser && currentUser.id ? String(currentUser.id) : null;
    return currentId === snapshot.userId && Number(window._bnuAuthGeneration || 0) === snapshot.generation;
  }

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia(SYSTEM_THEME_QUERY).matches);
  }

  function resolveTheme(theme) {
    return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'warm') : theme;
  }

  function apply(value) {
    var next = normalize(value);
    var previous = normalize(window._bnuAppearance || DEFAULTS);
    var effectiveTheme = resolveTheme(next.color_theme);
    var root = document.documentElement;
    root.dataset.bnuTheme = effectiveTheme;
    root.dataset.bnuThemePreference = next.color_theme;
    root.dataset.bnuLayout = next.home_layout;
    root.dataset.bnuNav = next.mobile_nav;
    if (document.body) {
      document.body.dataset.homeLayout = next.home_layout;
      document.body.classList.toggle('home-layout-compact', next.home_layout === 'compact');
    }
    window._bnuAppearance = next;
    window.dispatchEvent(new CustomEvent('bnuappearancechange', {
      detail: {
        home_layout: next.home_layout,
        color_theme: next.color_theme,
        effective_theme: effectiveTheme,
        mobile_nav: next.mobile_nav,
        default_view: next.default_view,
        previous: previous,
      }
    }));
    return next;
  }

  function current() {
    return normalize(_appearanceContext ? _appearanceContext.pending : (window._bnuAppearance || readGuest()));
  }

  function updatePersistenceNote() {
    var note = document.getElementById('appearancePersistNote');
    if (!note || !_appearanceContext) return;
    // 持久状态（已保存/待保存）只在这一处显示；下方 status 行仅承载瞬时过程与错误。
    if (_appearanceContext.kind === 'guest') {
      note.textContent = _appearanceContext.error ? '预览已应用 · 尚未保存' : '已保存到本设备';
    } else if (_appearanceContext.error) {
      note.textContent = '预览已应用 · 尚未保存';
    } else if (_appearanceContext.inFlight || _appearanceContext.dirty) {
      note.textContent = '预览已应用 · 等待保存';
    } else {
      note.textContent = '已保存到账户';
    }
    var saved = !_appearanceContext.error && !_appearanceContext.inFlight && !_appearanceContext.dirty;
    note.classList.toggle('is-saved', saved);
  }

  function setStatus(message, kind) {
    var status = document.getElementById('appearanceSaveStatus');
    if (!status) return;
    status.textContent = message || '';
    status.className = 'appearance-save-status' + (kind ? ' is-' + kind : '');
    status.removeAttribute('data-state');
    var retry = status.querySelector('[data-appearance-retry]');
    if (retry) retry.remove();
    if (kind === 'error') {
      status.setAttribute('data-state', 'failed');
      retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'appearance-retry';
      retry.setAttribute('data-appearance-retry', '1');
      retry.textContent = '重试';
      retry.addEventListener('click', retryAppearance);
      status.appendChild(retry);
    }
    updatePersistenceNote();
  }

  function updateChoiceStates() {
    var panel = document.getElementById('appearancePanel');
    if (!panel) return;
    var value = current();
    panel.querySelectorAll('[data-appearance-layout]').forEach(function (button) {
      var selected = value.home_layout === button.getAttribute('data-appearance-layout');
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    panel.querySelectorAll('[data-appearance-theme]').forEach(function (button) {
      var selected = value.color_theme === button.getAttribute('data-appearance-theme');
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    panel.querySelectorAll('[data-appearance-nav]').forEach(function (button) {
      var selected = value.mobile_nav === button.getAttribute('data-appearance-nav');
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    panel.querySelectorAll('[data-appearance-default-view]').forEach(function (button) {
      var selected = value.default_view === button.getAttribute('data-appearance-default-view');
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    updatePersistenceNote();
  }

  function renderPanel() {
    var panel = document.getElementById('appearancePanel');
    if (!panel) return;
    var value = current();
    var layoutButton = function (id, title, description) {
      return '<button type="button" class="appearance-choice appearance-layout-choice' +
        (value.home_layout === id ? ' is-selected' : '') + '" data-appearance-layout="' + id + '" aria-pressed="' +
        (value.home_layout === id ? 'true' : 'false') + '">' +
        '<span class="appearance-layout-preview appearance-layout-preview--' + id + '"><i></i><i></i><i></i></span>' +
        '<span><strong>' + title + '</strong><small>' + description + '</small></span></button>';
    };
    var navButton = function (id, title, description) {
      return '<button type="button" class="appearance-choice appearance-nav-choice' +
        (value.mobile_nav === id ? ' is-selected' : '') + '" data-appearance-nav="' + id + '" aria-pressed="' +
        (value.mobile_nav === id ? 'true' : 'false') + '">' +
        '<span class="appearance-nav-preview appearance-nav-preview--' + id + '"><i></i><i></i><i></i></span>' +
        '<span><strong>' + title + '</strong><small>' + description + '</small></span></button>';
    };
    var defaultViewButton = function (id, title, description, icon) {
      return '<button type="button" class="appearance-choice appearance-entry-choice' +
        (value.default_view === id ? ' is-selected' : '') + '" data-appearance-default-view="' + id + '" aria-pressed="' +
        (value.default_view === id ? 'true' : 'false') + '">' +
        '<span class="appearance-entry-preview"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#' + icon + '"></use></svg></span>' +
        '<span><strong>' + title + '</strong><small>' + description + '</small></span></button>';
    };
    var themeButton = function (id, title, colors) {
      return '<button type="button" class="appearance-choice appearance-theme-choice' +
        (value.color_theme === id ? ' is-selected' : '') + '" data-appearance-theme="' + id + '" aria-pressed="' +
        (value.color_theme === id ? 'true' : 'false') + '">' +
        '<span class="appearance-swatch appearance-swatch--' + id + '"><i></i><b></b></span>' +
        '<span><strong>' + title + '</strong><small>' + colors + '</small></span></button>';
    };
    panel.innerHTML =
      '<div class="appearance-intro"><span class="appearance-kicker">界面偏好</span>' +
        '<p>设置会即时预览；保存状态会在这里明确显示。</p></div>' +
      '<fieldset class="appearance-fieldset"><legend>信息密度</legend><div class="appearance-choice-grid">' +
        layoutButton('loose', '松散', '留白更充足，适合慢慢浏览') +
        layoutButton('compact', '紧凑', '信息更集中，快速进入资料') +
      '</div></fieldset>' +
      '<fieldset class="appearance-fieldset"><legend>打开时进入</legend><div class="appearance-choice-grid appearance-entry-grid">' +
        defaultViewButton('home', '首页', '先看公告、入口和资料推荐', 'ni-home') +
        defaultViewButton('timetable', '我的课程', '直接查看课程与资料', 'ni-timetable') +
      '</div></fieldset>' +
      '<fieldset class="appearance-fieldset"><legend>色彩氛围</legend><div class="appearance-choice-grid appearance-theme-grid">' +
        themeButton('warm', '暖色', '米白 · 铜色') +
        themeButton('cool', '冷色', '纸白 · 靛蓝') +
        themeButton('dark', '暗色', '深墨 · 琥珀') +
        themeButton('system', '跟随系统', '随浏览器自动切换') +
      '</div></fieldset>' +
      '<fieldset class="appearance-fieldset"><legend>移动端导航</legend><div class="appearance-choice-grid">' +
        navButton('bottom', '底部导航', '拇指易达的底部标签栏') +
        navButton('burger', '汉堡菜单', '顶部左上入口，侧滑列出全部栏目') +
      '</div></fieldset>' +
      '<div class="appearance-panel-actions"><button type="button" class="appearance-reset" data-appearance-reset>恢复默认</button>' +
      '<p class="appearance-persist-note" id="appearancePersistNote"></p></div>' +
      '<div class="appearance-save-status" id="appearanceSaveStatus" role="status" aria-live="polite"></div>';
    panel.querySelectorAll('[data-appearance-layout]').forEach(function (button) {
      button.addEventListener('click', function () {
        setAppearance('home_layout', button.getAttribute('data-appearance-layout'));
      });
    });
    panel.querySelectorAll('[data-appearance-theme]').forEach(function (button) {
      button.addEventListener('click', function () {
        setAppearance('color_theme', button.getAttribute('data-appearance-theme'));
      });
    });
    panel.querySelectorAll('[data-appearance-nav]').forEach(function (button) {
      button.addEventListener('click', function () {
        setAppearance('mobile_nav', button.getAttribute('data-appearance-nav'));
      });
    });
    panel.querySelectorAll('[data-appearance-default-view]').forEach(function (button) {
      button.addEventListener('click', function () {
        setAppearance('default_view', button.getAttribute('data-appearance-default-view'));
      });
    });
    var reset = panel.querySelector('[data-appearance-reset]');
    if (reset) reset.addEventListener('click', function () { setAppearanceValue(DEFAULTS); });
    updateChoiceStates();
    if (_appearanceContext && _appearanceContext.error) setStatus('保存失败：' + _appearanceContext.error, 'error');
  }

  function setAppearanceValue(value) {
    var next = normalize(value);
    var context = _appearanceContext || beginContext(typeof currentUser !== 'undefined' ? currentUser : null);
    context.pending = next;
    context.error = null;
    context.dirty = context.kind === 'account';
    apply(next);
    updateChoiceStates();
    if (context.kind === 'guest') {
      if (writeGuest(next)) {
        context.saved = next;
        setStatus('');
      } else {
        context.error = '本设备暂时无法写入设置';
        setStatus('保存失败：本设备暂时无法写入设置', 'error');
      }
      return;
    }
    setStatus('正在保存到账户…', 'saving');
    processAccountQueue(context);
  }

  function setAppearance(field, value) {
    if (field !== 'home_layout' && field !== 'color_theme' && field !== 'mobile_nav' && field !== 'default_view') return;
    if (field === 'home_layout' && !LAYOUTS[value]) return;
    if (field === 'color_theme' && !THEMES[value]) return;
    if (field === 'mobile_nav' && !NAVS[value]) return;
    if (field === 'default_view' && !DEFAULT_VIEWS[value]) return;
    var next = current();
    next[field] = value;
    setAppearanceValue(next);
  }

  function processAccountQueue(context) {
    if (!context || context.kind !== 'account' || context.inFlight || !context.dirty) return;
    var snapshot = authSnapshot(currentUser);
    if (!isCurrentContext(context, snapshot)) return;
    context.dirty = false;
    context.inFlight = snapshot;
    var sentValue = normalize(context.pending);
    api('/api/auth/profile/', { method: 'PATCH', body: sentValue }).then(function (fresh) {
      if (!isCurrentContext(context, snapshot)) return;
      context.inFlight = null;
      context.saved = normalize(fresh);
      writeAccount(currentUser, context.saved);
      if (sameValue(context.pending, sentValue)) {
        context.pending = context.saved;
        apply(context.pending);
      } else {
        context.dirty = true;
      }
      if (typeof setAuthenticatedUser === 'function' && fresh && fresh.id === currentUser.id) {
        setAuthenticatedUser(fresh, { preserveGeneration: true });
      } else if (fresh && currentUser && fresh.id === currentUser.id) {
        currentUser = fresh;
      }
      updateChoiceStates();
      if (context.dirty) {
        setStatus('正在保存到账户…', 'saving');
        processAccountQueue(context);
      } else {
        setStatus('');
      }
    }).catch(function (error) {
      if (!isCurrentContext(context, snapshot)) return;
      context.inFlight = null;
      context.dirty = true;
      context.error = error && error.message ? error.message : '请稍后重试';
      setStatus('保存失败：' + context.error, 'error');
    });
  }

  function retryAppearance() {
    if (!_appearanceContext) return;
    if (_appearanceContext.kind === 'guest') {
      setAppearanceValue(_appearanceContext.pending);
      return;
    }
    _appearanceContext.error = null;
    _appearanceContext.dirty = true;
    setStatus('正在保存到账户…', 'saving');
    processAccountQueue(_appearanceContext);
  }

  function beginContext(user) {
    var snapshot = authSnapshot(user);
    if (user && user.id) {
      // 只读取明确以当前用户 ID 命名的缓存；服务端返回值始终覆盖缓存，缓存不会长期压住服务器。
      var cached = readAccount(user);
      var serverValue = normalize(user);
      _appearanceContext = {
        kind: 'account', userId: snapshot.userId, generation: snapshot.generation,
        saved: cached && sameValue(cached, serverValue) ? cached : serverValue,
        pending: serverValue, inFlight: null, dirty: false, error: null,
      };
      apply(serverValue);
      writeAccount(user, serverValue);
    } else {
      var guest = readGuest();
      _appearanceContext = {
        kind: 'guest', userId: null, generation: snapshot.generation,
        saved: guest, pending: guest, inFlight: null, dirty: false, error: null,
      };
      apply(guest);
    }
    updateChoiceStates();
    return _appearanceContext;
  }

  function applyForUser(user) {
    return beginContext(user);
  }

  function showDrawerAppearance() {
    var drawer = document.getElementById('notifDrawer');
    var drawerMenu = document.getElementById('drawerMenu');
    var drawerNotif = document.getElementById('drawerNotif');
    var drawerAppearance = document.getElementById('drawerAppearance');
    if (!drawer || !drawerAppearance) return;
    var guest = !(typeof currentUser !== 'undefined' && currentUser);
    if (drawerMenu) drawerMenu.style.display = 'none';
    if (drawerNotif) drawerNotif.style.display = 'none';
    drawerAppearance.style.display = '';
    var back = drawerAppearance.querySelector('.notif-nav-back');
    if (back) back.style.display = guest ? 'none' : '';
    var title = drawerAppearance.querySelector('h3');
    if (title) title.textContent = guest ? '外观设置' : '外观调整';
    renderPanel();
    if (guest && drawer.style.display !== 'flex') {
      drawer.style.display = 'flex';
      lockScroll();
    }
    if (typeof activateDialog === 'function') activateDialog(drawerAppearance);
    if (!guest && typeof pushViewState === 'function') pushViewState('drawer', { sub: 'appearance' });
  }

  function init() {
    var user = typeof currentUser !== 'undefined' ? currentUser : null;
    beginContext(user);
  }

  function handleSystemThemeChange() {
    if (current().color_theme !== 'system') return;
    apply(current());
    updateChoiceStates();
  }

  function bindSystemThemeListener() {
    if (!window.matchMedia || _systemThemeMediaQuery) return;
    try {
      _systemThemeMediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
      if (_systemThemeMediaQuery.addEventListener) {
        _systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange);
      } else if (_systemThemeMediaQuery.addListener) {
        _systemThemeMediaQuery.addListener(handleSystemThemeChange);
      }
    } catch (e) {
      _systemThemeMediaQuery = null;
    }
  }

  window.applyAppearanceForUser = applyForUser;
  window.resetAppearanceToGuest = function () { beginContext(null); };
  window.showDrawerAppearance = showDrawerAppearance;
  window.showGuestAppearance = showDrawerAppearance;
  window.renderAppearancePanel = renderPanel;
  window.setAppearance = setAppearance;
  window.getBnuAppearance = current;
  window.addEventListener('bnuauthchange', function (event) {
    var user = event && event.detail && event.detail.userId ? currentUser : null;
    beginContext(user);
  });
  window.addEventListener('bnuappearancechange', function (event) {
    var detail = event && event.detail || {};
    // 换色只改 token；布局切换时补拉当前布局所需的数据，避免紧凑首页切回松散首页后仍停留在空壳。
    var home = document.getElementById('homeView');
    if (!detail.previous || detail.home_layout === detail.previous.home_layout ||
        !home || !home.classList.contains('active')) return;
    if (detail.home_layout === 'compact' && typeof loadCompactHome === 'function') loadCompactHome();
    if (detail.home_layout === 'loose' && typeof loadStats === 'function') loadStats();
  });
  bindSystemThemeListener();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
