/* BNU Sparks · explorer-render.js —— 渲染器+文件列表。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
  function renderGrid(items) {
    const parent = document.getElementById('explorerContent');
    // 所有大类/学院卡片统一进同一个 folder-grid，由布局 CSS 负责响应式列数与顺序。
    // （不再有「第三行特排」：国际视野与文明对话/数学类/实用文件 与其余通识大类一起排布。）
    const regularItems = items.filter(i => !i.divider);
    // v183：专业课顶层——本人学院卡片置顶（仅重排顺序，不改任何样式）
    let gridItems = regularItems;
    if (expPath.length === 1 && expPath[0] === '专业课' && currentUser && currentUser.identity_college) {
      const mine = regularItems.findIndex(i => i.name === currentUser.identity_college);
      if (mine > 0) {
        gridItems = [regularItems[mine]].concat(regularItems.slice(0, mine), regularItems.slice(mine + 1));
      }
    }
    const mgmt = isMgmtActive();
    let html = '';

    html += '<div class="folder-grid">' +
      gridItems.map(item => _cardHtml(item, mgmt)).join('') +
    '</div>';

    parent.innerHTML = html;
    parent.querySelectorAll('.folder-card').forEach(el => {
      el.addEventListener('click', function(e) {
        if (e.target.closest('.fc-card-menu-btn, .fc-card-menu')) return;
        navIn(el.dataset.n);
      });
      if (document.documentElement.dataset.bnuLayout === 'compact') {
        el.addEventListener('keydown', function(e) {
          if (e.target.closest('.fc-card-menu-btn, .fc-card-menu')) return;
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          navIn(el.dataset.n);
        });
      }
    });
  }

  // 外观抽屉切换布局时同步重绘当前目录，让紧凑专属标题、焦点属性和卡片结构立即更新。
  window.addEventListener('bnuappearancechange', function(event) {
    const detail = event && event.detail || {};
    if (!detail.previous || detail.home_layout === detail.previous.home_layout) return;
    const explorer = document.getElementById('explorerView');
    if (explorer && explorer.classList.contains('active') && typeof renderExplorer === 'function') renderExplorer();
  });

  function _cardHtml(item, mgmt) {
    const canMgmt = mgmt && item.id &&
      (_userInScope(expPath) || _nodeInScope(item, expPath[0], expPath.length === 1));
    const isMajorIndex = expPath.length === 1 && expPath[0] === '专业课';
    // 专业课学院卡片统计直接子节点（专业）；通识课仍统计有效课程分区。
    const count = item.children
      ? (isMajorIndex ? item.children.filter(child => !child.divider).length : getEffectiveChildCount(item))
      : 0;
    const countUnit = isMajorIndex ? '专业' : '课程分区';
    const isCompactLayout = document.documentElement.dataset.bnuLayout === 'compact';
    const countMeta = item.children && (isCompactLayout || count)
      ? '<div class="fc-count">' + count + ' 个' + countUnit + '</div>'
      : '';
    const compactA11y = isCompactLayout
      ? ' role="link" tabindex="0" aria-label="打开' + esc(item.name) + '"'
      : '';
    return '<div class="folder-card"' + compactA11y + ' data-n="' + esc(item.name) + '">' +
      '<span class="fc-spine" aria-hidden="true"></span>' +
      '<div class="fc-icon">' + cardIconHtml(item) + '</div>' +
      '<div class="fc-copy"><div class="fc-name">' + esc(item.name) + '</div>' +
      countMeta + '</div>' +
      '<span class="fc-disclosure" aria-hidden="true">›</span>' +
      (canMgmt ? _mgmtCardMenuHtml(item) : '') +
    '</div>';
  }

  function _mgmtCardMenuHtml(item) {
    return '<div class="fc-card-menu-btn" data-cat-id="' + item.id + '">⋮</div>' +
      '<div class="fc-card-menu" data-cat-id="' + item.id + '" style="display:none">' +
        _mgmtMenuItemsHtml(item) +
      '</div>';
  }

  function renderList(items) {
    const parent = document.getElementById('explorerContent');
    let html = '<div class="folder-list">';
    items.forEach(item => { html += listHtml(item); });
    html += '</div>';
    parent.innerHTML = html;
    parent.querySelectorAll('.folder-list-item').forEach(el => {
      el.addEventListener('click', function(e) {
        if (e.target.closest('.fc-card-menu-btn, .fc-card-menu, .fli-fav-star')) return;
        navIn(el.dataset.n);
      });
    });
  }

  function listHtml(item) {
    const hasSub = !!(item.children && item.children.length);
    const cId = item.courseId;
    const mgmt = isMgmtActive();
    let badge = '';
    if (cId) {
      const fCount = item.fileCount !== undefined ? item.fileCount : null;
      badge = fCount !== null && fCount > 0
        ? '<span class="fli-badge has-data">' + fCount + ' 个文件</span>'
        : '<span class="fli-badge no-data">暂无资料</span>';
    } else if (hasSub) {
      badge = '<span class="fli-badge has-data">' + getEffectiveChildCount(item) + ' 项</span>';
    }
    // 同名合并：叶子行并列展示全部代码（主代码 / 别名代码），超长由 CSS 省略号截断，
    // 完整列表放 title 悬停可查
    const codes = (cId && item.courseCodes && item.courseCodes.length > 1) ? item.courseCodes : null;
    const meta = cId
      ? '课程代码 ' + (codes ? codes.join(' / ') : cId)
      : (hasSub ? getEffectiveChildCount(item) + ' 项' : '');
    const metaTitle = cId ? ' title="' + esc(meta) + '"' : '';
    // 收藏课程星星：仅叶子课程节点（有真实课程代码，非通配符）
    let favStar = '';
    if (cId && cId.indexOf('*') === -1) {
      const fav = _favoritedCourses.has(cId);
      favStar = '<span class="fli-fav-star' + (fav ? ' favorited' : '') + '" data-code="' + esc(cId) +
        '" title="收藏课程" onclick="event.stopPropagation();toggleCourseFavorite(this)">' +
        FD_ICONS[fav ? 'starFilled' : 'star'] + '</span>';
    }
    return '<div class="folder-list-item" data-n="' + esc(item.name) + '">' +
      '<span class="fli-icon">' + (hasSub ? '▸' : '·') + '</span>' +
      '<div class="fli-info"><div class="fli-name" title="' + esc(item.name) + '">' + esc(item.name) + '</div><div class="fli-meta"' + metaTitle + '>' + meta + '</div></div>' +
      badge + favStar +
      (mgmt && item.id && (_userInScope(expPath) || _nodeInScope(item, expPath[0], expPath.length === 1)) ? _mgmtCardMenuHtml(item) : '') + '</div>';
  }

  var _multiSelectMode = false;
  var _allFilesCache = [];       // 当前课程的全部文件缓存
  var _typeFilter = '';          // 类型筛选：'' = 全部
  var _sortBy = 'date';          // 排序：date | download | favorite | teacher
  var _filterSortPage = 1;       // 筛选排序后的当前页
  var _filterSortPageSize = 10;  // 筛选排序后的每页条数
  var _renderCurrentPage = null; // 当前课程的文件列表渲染函数
  var _rerenderFilesForLayout = null; // 断点跨越重渲染（保留筛选/页码/多选状态）

  // ── 移动端（≤768px）资料列表：纵向资料行替代表格 ──
  // 桌面保留表格与全部现有功能；两套 DOM 由同一份数据与状态渲染。
  function _fileListIsMobile() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
  }
  // 横竖屏旋转/窗口拖拽跨过断点：用缓存数据按新布局重渲染当前课程。
  // media query 变化事件为主，resize 节流兜底（个别 webview 不派发 mq change）。
  (function () {
    var lastLayoutMobile = _fileListIsMobile();
    function onMaybeChanged() {
      var nowMobile = _fileListIsMobile();
      if (nowMobile === lastLayoutMobile) return;
      lastLayoutMobile = nowMobile;
      if (typeof _rerenderFilesForLayout !== 'function') return;
      var host = document.getElementById('explorerContent');
      if (host && host.querySelector('.file-area-main')) _rerenderFilesForLayout();
    }
    if (window.matchMedia) {
      var mq = window.matchMedia('(max-width: 768px)');
      if (mq.addEventListener) mq.addEventListener('change', onMaybeChanged);
      else if (mq.addListener) mq.addListener(onMaybeChanged);
    }
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onMaybeChanged, 150);
    });
    // 移动端旋转兜底：个别 webview 只派发 orientationchange
    window.addEventListener('orientationchange', function () {
      setTimeout(onMaybeChanged, 200);
    });
  })();

  function toggleMultiSelect() {
    var tbody = document.getElementById('fileTableBody');
    var hasTableRows = !!(tbody && tbody.querySelector('tr[data-file-id]'));
    var mfList = document.getElementById('mfFileList');
    var hasMobileRows = !!(mfList && mfList.querySelector('.mf-row'));
    if (!hasTableRows && !hasMobileRows) return;
    _multiSelectMode = !_multiSelectMode;
    var btn = document.getElementById('multiSelectToggle');
    var mgmt = isMgmtActive();
    if (btn) setIconText(btn, _multiSelectMode ? 'close' : (mgmt ? 'clipboard' : 'arrow-down'), _multiSelectMode ? '取消' : (mgmt ? '批量操作' : '批量下载'));
    if (!_multiSelectMode) {
      // 退出模式时清空选择
      _selectedIds = {};
      document.querySelectorAll('.dl-chk').forEach(function(c) { c.checked = false; });
      var allChk = document.getElementById('selectAllChkHead');
      if (allChk) allChk.checked = false;
      var mfAll = document.getElementById('mfSelectAllChk');
      if (mfAll) mfAll.checked = false;
    }
    if (mfList) {
      // 移动布局：行结构随模式变化（复选框替换类型图标与下载按钮），重渲染当前页
      if (typeof _renderCurrentPage === 'function') _renderCurrentPage();
      _mfSyncBatchUI();
    } else {
      syncMultiSelectUI();
    }
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
    if (btn) setIconText(btn, 'arrow-down', '批量下载');
    var allChk = document.getElementById('selectAllChkHead');
    if (allChk) allChk.checked = false;
    var mfAll = document.getElementById('mfSelectAllChk');
    if (mfAll) mfAll.checked = false;
    if (document.getElementById('mfFileList')) {
      if (typeof _renderCurrentPage === 'function') _renderCurrentPage();
      _mfSyncBatchUI();
    } else {
      syncMultiSelectUI();
    }
  }

  // ── 移动端资料行 / 批量工具同步 ─────────────────────────────
  function _mfRowHtml(f) {
    var badgeHtml = '';
    if (f.is_uploader && f.review_status !== 'approved') {
      var pending = f.review_status === 'pending';
      badgeHtml = '<span class="review-badge ' + (pending ? 'review-badge-pending' : 'review-badge-rejected') + '">' + (pending ? '审核中' : '已驳回') + '</span>';
    }
    var pinBadge = f.is_pinned ? '<span class="file-pin-badge mf-pin-badge" title="已置顶">' + iconSvg('pin') + '</span>' : '';
    var metaParts = [formatSize(f.file_size), f.user_material_type || f.file_type || ''].filter(Boolean).map(esc);
    var titleLine = '<span class="mf-title">' + esc(f.title) + pinBadge + badgeHtml + '</span>' +
      '<span class="mf-meta">' + metaParts.join(' · ') + '</span>';
    if (_multiSelectMode) {
      return '<div class="mf-row" data-file-id="' + f.id + '">' +
        '<label class="mf-chk-label"><input type="checkbox" class="dl-chk" data-fid="' + f.id + '" aria-label="选择' + esc(f.title) + '" onchange="onDlChkChange(this)"></label>' +
        '<div class="mf-text" data-file-id="' + f.id + '">' + titleLine + '</div>' +
      '</div>';
    }
    var dlHtml;
    if (currentUser && f.can_download === false) {
      dlHtml = '<span class="mf-dl mf-dl-disabled" title="审核通过后可下载">' + iconSvg('clock') + '待审核</span>';
    } else {
      dlHtml = '<button type="button" class="mf-dl" aria-label="下载' + esc(f.title) + '" onclick="handleDownloadClick(' + f.id + ',this,event)">' + iconSvg('arrow-down') + '下载</button>';
    }
    return '<div class="mf-row" data-file-id="' + f.id + '">' +
      '<span class="mf-glyph">' + extBadge(f.file_name) + '</span>' +
      '<button type="button" class="mf-text" data-file-id="' + f.id + '">' + titleLine + '</button>' +
      dlHtml +
    '</div>';
  }

  function _mfSyncBatchUI() {
    var list = document.getElementById('mfFileList');
    if (!list) return;
    var tools = document.getElementById('mfBatchTools');
    var footer = document.getElementById('mfBatchFooter');
    var toggleBtn = document.getElementById('multiSelectToggle');
    var mgmt = isMgmtActive();
    if (toggleBtn) setIconText(toggleBtn, _multiSelectMode ? 'close' : (mgmt ? 'clipboard' : 'arrow-down'), _multiSelectMode ? '取消' : (mgmt ? '批量操作' : '批量下载'));
    if (tools) tools.hidden = !_multiSelectMode;
    if (footer) footer.hidden = !_multiSelectMode;
    var endEl = document.getElementById('mfListEnd');
    if (endEl) endEl.style.display = _multiSelectMode ? 'none' : '';
    if (_multiSelectMode) {
      // 从 _selectedIds 恢复可见行勾选状态 + 全选框
      var vis = 0, on = 0;
      list.querySelectorAll('.dl-chk').forEach(function (c) {
        var fid = parseInt(c.getAttribute('data-fid'), 10);
        if (!fid) return;
        var checked = !!_selectedIds[fid];
        c.checked = checked;
        vis++;
        if (checked) on++;
      });
      var allChk = document.getElementById('mfSelectAllChk');
      if (allChk) allChk.checked = vis > 0 && on === vis;
      var delBtn = document.getElementById('mfBatchDeleteBtn');
      var editBtn = document.getElementById('mfBatchEditBtn');
      if (delBtn) delBtn.style.display = mgmt ? '' : 'none';
      if (editBtn) editBtn.style.display = mgmt ? '' : 'none';
    }
    updateBatchDlBar();
  }

  function mfToggleSelectAll(source) {
    var list = document.getElementById('mfFileList');
    if (!list) return;
    var checked = source.checked;
    list.querySelectorAll('.dl-chk').forEach(function (c) {
      c.checked = checked;
      var fid = parseInt(c.getAttribute('data-fid'), 10);
      if (fid) { if (checked) _selectedIds[fid] = true; else delete _selectedIds[fid]; }
    });
    updateBatchDlBar();
  }

  // ── 移动端筛选排序底部面板（类型 + 排序合并入口） ────────────
  var _mfSheetType = '';
  var _mfSheetSort = 'date';

  function _mfSheetOptionsHtml(kind) {
    var items = kind === 'type'
      ? [{ v: '', label: '全部类型' }].concat(MATERIAL_TYPES.map(function (t) { return { v: t.name, label: t.name }; }))
      : Object.keys(_MF_SORT_LABELS).map(function (k) { return { v: k, label: _MF_SORT_LABELS[k] }; });
    var current = kind === 'type' ? _mfSheetType : _mfSheetSort;
    return items.map(function (it) {
      return '<button type="button" class="mf-sheet-option" data-mf-' + kind + '="' + esc(it.v) + '" aria-pressed="' + (current === it.v) + '">' + esc(it.label) + '</button>';
    }).join('');
  }

  // 原地更新选中态（不重建按钮），避免键盘/读屏用户点选后焦点丢失
  function _mfRefreshSheetOptions() {
    var typeHost = document.getElementById('mfSheetTypeOpts');
    if (typeHost) _mfMarkOptions(typeHost, 'data-mf-type', _mfSheetType);
    var sortHost = document.getElementById('mfSheetSortOpts');
    if (sortHost) _mfMarkOptions(sortHost, 'data-mf-sort', _mfSheetSort);
  }

  function _mfMarkOptions(host, attr, value) {
    host.querySelectorAll('[' + attr + ']').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
    });
  }

  function openMobileFilterSheet(event) {
    if (event) event.stopPropagation();
    if (document.querySelector('.mf-sheet-overlay')) { closeMobileFilterSheet(); return; }
    _mfSheetType = _typeFilter;
    _mfSheetSort = _sortBy;
    var overlay = document.createElement('div');
    overlay.className = 'mf-sheet-overlay';
    overlay.innerHTML =
      '<div class="mf-sheet-backdrop" aria-hidden="true"></div>' +
      '<div class="mf-sheet" role="dialog" aria-modal="true" aria-label="筛选与排序">' +
        '<div class="mf-sheet-handle" aria-hidden="true"></div>' +
        '<div class="mf-sheet-head"><h2 class="mf-sheet-title">筛选与排序</h2>' +
          '<button type="button" class="mf-sheet-close" aria-label="关闭" onclick="closeMobileFilterSheet()">' + iconSvg('close') + '</button></div>' +
        '<div class="mf-sheet-label">资料类型</div>' +
        '<div class="mf-sheet-options" id="mfSheetTypeOpts">' + _mfSheetOptionsHtml('type') + '</div>' +
        '<div class="mf-sheet-label">排序方式</div>' +
        '<div class="mf-sheet-options" id="mfSheetSortOpts">' + _mfSheetOptionsHtml('sort') + '</div>' +
        '<div class="mf-sheet-footer">' +
          '<button type="button" class="mf-sheet-btn mf-sheet-reset" onclick="mfSheetReset()">重置</button>' +
          '<button type="button" class="mf-sheet-btn mf-sheet-apply" onclick="mfSheetApply()">应用</button>' +
        '</div>' +
      '</div>';
    overlay.addEventListener('click', function (e) {
      if (e.target.classList && e.target.classList.contains('mf-sheet-backdrop')) { closeMobileFilterSheet(); return; }
      var t = e.target.closest('[data-mf-type]');
      if (t) { _mfSheetType = t.getAttribute('data-mf-type') || ''; _mfRefreshSheetOptions(); return; }
      var s = e.target.closest('[data-mf-sort]');
      if (s) { _mfSheetSort = s.getAttribute('data-mf-sort') || 'date'; _mfRefreshSheetOptions(); }
    });
    document.body.appendChild(overlay);
    lockScroll();
    _pushModalHistory(overlay.querySelector('.mf-sheet'));
    // 同步聚焦关闭钮：activateDialog 的 rAF 焦点在无绘制环境（后台标签）会被挂起
    var firstCtl = overlay.querySelector('.mf-sheet-close');
    if (firstCtl) firstCtl.focus();
  }

  function closeMobileFilterSheet() {
    var overlay = document.querySelector('.mf-sheet-overlay');
    if (!overlay) return;
    var sheet = overlay.querySelector('.mf-sheet');
    overlay.remove();
    unlockScroll();
    _popModalHistory(sheet);
  }

  function mfSheetReset() {
    _mfSheetType = '';
    _mfSheetSort = 'date';
    _mfRefreshSheetOptions();
  }

  function mfSheetApply() {
    _typeFilter = _mfSheetType;
    _sortBy = _mfSheetSort;
    _filterSortPage = 1;
    closeMobileFilterSheet();
    _renderFilterSortLabels();
    if (typeof _renderCurrentPage === 'function') _renderCurrentPage();
  }

  // ── 移动端列表外壳：标题行 + 工具栏 + 列表容器 + 底部分页 ──
  function _mfHeaderHtml(course, code, mergeCodes) {
    var mgmt = isMgmtActive();
    var uploadBtn = '<button type="button" class="mf-upload-btn" onclick="showUploadModal(\'' + escJs(code) + '\',\'' + escJs(course.name) + '\',' + (course.id ? course.id : 'null') + ')">＋ 上传资料</button>';
    var batchBtn = currentUser
      ? '<button type="button" class="mf-text-btn" id="multiSelectToggle" onclick="toggleMultiSelect()">' + iconSvg(mgmt ? 'clipboard' : 'arrow-down') + (mgmt ? ' 批量操作' : ' 批量下载') + '</button>'
      : '';
    return '<div class="mf-head">' +
        '<div class="mf-head-text">' +
          '<h3 class="section-accent mf-course-name">' + esc(course.name) + '</h3>' +
          '<div class="mf-count-line"><span class="mf-count" id="fileCount">加载中…</span>' + (mergeCodes || '') + '</div>' +
        '</div>' + uploadBtn +
      '</div>' +
      '<div class="mf-toolbar">' +
        '<button type="button" class="mf-filter-btn" id="mobileFilterBtn" aria-haspopup="dialog" onclick="openMobileFilterSheet(event)">' + iconSvg('filter') + '<span class="mf-filter-label">全部类型 · 上传时间</span><span class="mf-caret" aria-hidden="true">▾</span></button>' +
        batchBtn +
      '</div>';
  }

  function _mfBodyHtml() {
    return '<div class="mf-list-wrap">' +
        '<div class="mf-batch-tools" id="mfBatchTools" hidden>' +
          '<label class="mf-select-all"><input type="checkbox" id="mfSelectAllChk" onchange="mfToggleSelectAll(this)"> 全选</label>' +
          '<span class="mf-selected-count" id="mfSelectedCount" aria-live="polite">已选 0 份</span>' +
        '</div>' +
        '<div class="mf-list" id="mfFileList"><div class="mf-empty">加载中…</div></div>' +
        '<div class="mf-batch-footer" id="mfBatchFooter" hidden>' +
          '<button type="button" class="mf-batch-mgmt" id="mfBatchDeleteBtn" style="display:none" onclick="batchDeleteSelected()">' + iconSvg('trash') + ' 删除选中</button>' +
          '<button type="button" class="mf-batch-mgmt" id="mfBatchEditBtn" style="display:none" onclick="showBatchEditDialog()">' + iconSvg('edit') + ' 编辑选中</button>' +
          '<button type="button" class="mf-batch-dl" id="mfBatchDlBtn" onclick="batchDownloadSelected()">' + iconSvg('arrow-down') + '下载所选（0）</button>' +
        '</div>' +
        '<div class="mf-list-end" id="mfListEnd"></div>' +
        '<div class="mf-bottom" id="mfBottom"><span class="fa-per-page" id="perPageControl"></span></div>' +
      '</div>';
  }

  function renderFiles(course, opts) {
    // keepState：断点跨越重渲染复用缓存数据并保留筛选/页码/多选状态
    var keepState = !!(opts && opts.keepState);
    // 切换课程时退出多选模式
    if (!keepState) { _multiSelectMode = false; _selectedIds = {}; }
    _rerenderFilesForLayout = null;
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

    // 无课程代码 → 中间节点/无课程分类：文件夹空态（管理模式可新建子文件夹）
    if (!code) {
      var _mgmt = isMgmtActive();
      var _inScope = _mgmt && _userInScope(expPath);
      container.innerHTML =
        '<div class="file-area">' +
          '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + '</h3></div>' +
          '<div class="empty-state"><div class="es-text">该分类下暂无内容</div>' +
          '<div class="es-sub">' + (_mgmt ? '可在管理模式中新建子文件夹或上传资料' : '可能是内容尚未创建，或正在征集中') + '</div>' +
          (_inScope && course.id ? '<button class="mgmt-new-btn" onclick="showNewFolderDialog(' + course.id + ')">＋ 新建文件夹</button>' : '') +
          '</div>' +
        '</div>';
      return;
    }

    // 查找同名课程（同名合并的别名代码不进侧栏：已并入当前课程的双代码展示）
    const sameNameEntries = sameNameMap[course.name] || [];
    const sameNameOthers = sameNameEntries.filter(e =>
      e.courseId !== code && !(course.courseCodes && course.courseCodes.includes(e.courseId)));
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
    // 同名合并显示：课程名下并列展示全部代码（主代码 + 别名代码）。
    // 「实践教育（思政）」例外：各学院教务代码各异且已全量并入同一目录，
    // 不渲染具体代码，显示「通用」。
    const isPracticeIdeology = (course.name || '').replace(/[（）]/g, c => c === '（' ? '(' : ')').trim() === '实践教育(思政)';
    const mergeCodes = isPracticeIdeology
      ? '<span class="fa-codes">通用</span>'
      : (course.courseCodes && course.courseCodes.length > 1)
      ? '<span class="fa-codes">' + course.courseCodes.map(c => esc(c)).join(' · ') + '</span>'
      : '';

    const isMobileLayout = _fileListIsMobile();
    var headerHtml = isMobileLayout
      ? _mfHeaderHtml(course, code, mergeCodes)
      : '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + ' — 资料列表</h3>' + mergeCodes + '<span class="fa-count" id="fileCount">加载中...</span><span class="fa-per-page" id="perPageControl"></span><span class="fa-filter-bar" id="filterBar"><button class="fa-filter-btn" id="typeFilterBtn" onclick="toggleTypeFilterDropdown(event)">类型：全部 ▽</button><button class="fa-filter-btn" id="sortFilterBtn" onclick="toggleSortDropdown(event)">排序：上传时间 ▽</button></span>' + (code ? '<div class="fa-upload-header-btn">' + (currentUser ? '<button class="fa-upload-btn" onclick="showUploadModal(\'' + escJs(code) + '\',\'' + escJs(course.name) + '\',' + (course.id ? course.id : 'null') + ')">+ 上传资料</button><button class="fa-upload-btn fa-batch-dl-btn" id="multiSelectToggle" onclick="toggleMultiSelect()">' + iconSvg(isMgmtActive() ? 'clipboard' : 'arrow-down') + (isMgmtActive() ? ' 批量操作' : ' 批量下载') + '</button>' : '<button class="fa-upload-btn" onclick="showUploadModal(\'' + escJs(code) + '\',\'' + escJs(course.name) + '\',' + (course.id ? course.id : 'null') + ')">+ 上传资料</button>') + '</div>' : '') + '</div>';
    var bodyHtml = isMobileLayout ? _mfBodyHtml() :
          '<div class="file-table-wrap"><div class="batch-dl-bar" id="batchDlBar"><span id="selectedCount">已选 0 个</span>' +
            '<button class="admin-btn admin-btn-sm" onclick="batchDeleteSelected()" id="batchDeleteBtn" style="display:none">' + iconSvg('trash') + ' 删除选中</button>' +
            '<button class="admin-btn admin-btn-sm" onclick="showBatchEditDialog()" id="batchEditBtn" style="display:none">' + iconSvg('edit') + ' 编辑选中</button>' +
            '<button class="admin-btn admin-btn-sm" onclick="batchDownloadSelected()" id="batchDlBtn" style="margin-left:auto">' + iconSvg('arrow-down') + ' 下载选中</button>' +
          '</div>' +
          '<div class="file-table-scroll"><table class="file-table" id="fileTable"><thead><tr><th class="th-name">文件名</th><th class="th-type">类型</th><th class="th-size">大小</th><th class="th-uploader">上传者</th><th class="th-teacher">任课教师</th><th class="th-favcount">收藏量</th><th class="th-dlcount">下载量</th><th class="th-download"><span class="dl-normal">下载</span><span class="dl-check"><input type="checkbox" id="selectAllChkHead" onchange="toggleSelectAll(this)"> <span id="selectedCountHead"></span></span></th></tr></thead><tbody id="fileTableBody">' +
          '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint);padding:40px">加载中...</td></tr>' +
          '</tbody></table></div></div>';

    container.innerHTML =
        '<div class="file-area-main">' +
          (returnState ? '<div class="fa-back-bar"><a href="#" onclick="returnToPreviousView();return false">← 返回' + (returnState.view === 'rankings' ? '排行榜' : returnState.view === 'home' ? '首页' : '最近上传') + '</a></div>' : '') +
          headerHtml + bodyHtml +
        '</div>' +
        (Object.keys(sameNameGroups).length ? '<div class="file-area-side-bottom"><div class="fasb-title">' + iconSvg('book') + ' 同名课程（相同名称的不同课程代码）</div><div class="fasb-list">' +
          Object.values(sameNameGroups).map(g =>
            '<span class="fasb-item" onclick="navToCourse(\'' + escJs(g.type) + '\',\'' + escJs(g.courseId) + '\')">' +
              '<span class="fasb-code">' + esc(g.courseId) + '</span>' +
              (g.programs.length ? '<span class="fasb-programs">（' + esc(g.programs.join(' / ')) + '）</span>' : '') +
            '</span>'
          ).join(' · ') +
        '</div></div>' : '');

    if (!code) return;

    var proceed = function (allFiles) {
      // 缓存全量数据供筛选排序使用（断点跨越重渲染时直接复用，不再请求）
      _allFilesCache = allFiles;
      if (!keepState) {
        _typeFilter = '';
        _sortBy = 'date';
        _filterSortPage = 1;  // 切换课程时重置页码，避免翻页状态残留
      }
      _renderFilterSortLabels();

      const totalFiles = allFiles.length;
      var fcEl = document.getElementById('fileCount');
      if (fcEl) fcEl.textContent = totalFiles + (isMobileLayout ? ' 份资料' : ' 个文件');

      // 初始化每页条数选择器
      var ppc = document.getElementById('perPageControl');
      if (ppc) {
        ppc.innerHTML = ' 每页 <select class="ppc-select" id="ppcSelect"><option value="10">10</option><option value="15">15</option><option value="20">20</option></select> 条';
        ppc.style.display = '';
        document.getElementById('ppcSelect').addEventListener('change', function() {
          _filterSortPageSize = parseInt(this.value);
          _filterSortPage = 1;
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
          _filterSortPage = currentPage;
        }
      }
      const targetHighlightFileId = highlightFileId;
      highlightFileId = null;

      function renderPage() {
        _renderCurrentPage = renderPage;
        // 使用筛选排序后的文件列表
        var filteredFiles = _getFilteredSortedFiles();

        // ── 移动端（≤768px）：纵向资料行布局 ──
        var mfList = document.getElementById('mfFileList');
        if (mfList) {
          if (!filteredFiles.length) {
            mfList.innerHTML = '<div class="mf-empty">' + (_typeFilter ? '该类型下暂无资料，换个条件试试' : '暂无资料，欢迎上传') + '</div>';
            var mfEnd0 = document.getElementById('mfListEnd');
            if (mfEnd0) mfEnd0.textContent = '';
            if (_multiSelectMode) {
              _multiSelectMode = false; _selectedIds = {};
              var mBtn = document.getElementById('multiSelectToggle');
              if (mBtn) setIconText(mBtn, isMgmtActive() ? 'clipboard' : 'arrow-down', isMgmtActive() ? '批量操作' : '批量下载');
            }
            hidePagination();
            _mfSyncBatchUI();
            return;
          }
          var mfTotalPages = Math.ceil(filteredFiles.length / _filterSortPageSize);
          if (_filterSortPage > mfTotalPages) _filterSortPage = mfTotalPages;
          var mfStart = (_filterSortPage - 1) * _filterSortPageSize;
          var mfPageFiles = filteredFiles.slice(mfStart, mfStart + _filterSortPageSize);
          var mfLookup = {};
          mfPageFiles.forEach(function (f) { mfLookup[f.id] = f; });
          window._fileLookup = mfLookup;
          mfList.innerHTML = mfPageFiles.map(_mfRowHtml).join('');
          mfList.querySelectorAll('.mf-text').forEach(function (el) {
            el.addEventListener('click', function () {
              var fid = parseInt(el.getAttribute('data-file-id'), 10);
              if (_multiSelectMode) {
                var row = el.closest('.mf-row');
                var chk = row && row.querySelector('.dl-chk');
                if (chk) { chk.checked = !chk.checked; onDlChkChange(chk); }
                return;
              }
              if (mfLookup[fid]) showFileDetail(mfLookup[fid]);
            });
          });
          renderPagination(_filterSortPage, mfTotalPages);
          var mfEnd = document.getElementById('mfListEnd');
          if (mfEnd) mfEnd.textContent = '共 ' + filteredFiles.length + ' 份资料' + (mfTotalPages <= 1 ? '，已全部显示' : ' · 第 ' + _filterSortPage + ' / ' + mfTotalPages + ' 页');
          _mfSyncBatchUI();
          if (firstHighlight && targetHighlightFileId) {
            firstHighlight = false;
            requestAnimationFrame(function () {
              var row = mfList.querySelector('.mf-row[data-file-id="' + targetHighlightFileId + '"]');
              if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.classList.add('highlight-row');
                setTimeout(function () { row.classList.remove('highlight-row'); }, 2500);
              }
            });
          }
          return;
        }

        // ── 桌面：表格布局（保持既有行为） ──
        const tbody = document.getElementById('fileTableBody');
        if (!filteredFiles.length) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint);padding:40px">暂无资料，欢迎上传</td></tr>';
          hidePagination();
          if (_multiSelectMode) { _multiSelectMode = false; _selectedIds = {}; var mBtn = document.getElementById('multiSelectToggle'); if (mBtn) setIconText(mBtn, 'arrow-down', '批量下载'); }
          var batchBar = document.getElementById('batchDlBar');
          if (batchBar) { batchBar.classList.remove('is-visible'); batchBar.style.display = ''; }
          var ft = document.getElementById('fileTable');
          if (ft) ft.classList.remove('multi-select');
          return;
        }

        const totalPages = Math.ceil(filteredFiles.length / _filterSortPageSize);
        if (_filterSortPage > totalPages) _filterSortPage = totalPages;
        const start = (_filterSortPage - 1) * _filterSortPageSize;
        const pageFiles = filteredFiles.slice(start, start + _filterSortPageSize);

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
                ? '<a href="javascript:void(0)" class="dl-link" onclick="handleDownloadClick(' + f.id + ',this,event)">' + iconSvg('arrow-down') + ' 下载</a><button type="button" class="pv-link" onclick="event.stopPropagation();showPreview(' + f.id + ')">预览</button>'
                : '<span class="dl-link dl-disabled" title="审核通过后可下载">' + iconSvg('clock') + ' 待审核</span>')
            : '<a href="javascript:void(0)" class="dl-link" onclick="handleDownloadClick(' + f.id + ',this,event)">' + iconSvg('arrow-down') + ' 下载</a>';
          var isChecked = !!_selectedIds[f.id];
          var mgmt = isMgmtActive();
          // 管理模式：文件名和教师旁加铅笔（屏幕宽度 > 768px），仅在可编辑时显示
          var selfOrInScope = mgmt && (f.is_uploader || f.can_delete);
          var mgmtPens = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen" onclick="event.stopPropagation();quickEditField(' + f.id + ',\'title\',\'' + escJs(f.title) + '\')">' + iconSvg('edit') + '</span>')
            : '';
          var teacherPen = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen mgmt-pen-sm" onclick="event.stopPropagation();quickEditField(' + f.id + ',\'teacher\',\'' + escJs(f.teacher || '') + '\')">' + iconSvg('edit') + '</span>')
            : '';
          var mgmtDel = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen mgmt-del" onclick="event.stopPropagation();deleteFileConfirm(' + f.id + ',this)" title="删除此文件">' + iconSvg('trash') + '</span>')
            : '';
          // 置顶：徽章对全体用户可见；图钉仅管理模式（铅笔左侧）
          var pinBadge = f.is_pinned ? '<span class="file-pin-badge" title="已置顶">' + iconSvg('pin') + '</span>' : '';
          var mgmtPin = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen mgmt-pin" onclick="event.stopPropagation();toggleFilePin(' + f.id + ',' + (f.is_pinned ? 1 : 0) + ',this)" title="' + (f.is_pinned ? '取消置顶' : '置顶此文件') + '">' + iconSvg('pin') + '</span>')
            : '';
          return '<tr data-file-id="' + f.id + '"' + (f.is_pinned ? ' class="file-pinned"' : '') + '><td class="ft-name"><span class="fn-wrap">' + extBadge(f.file_name) + '<span class="fn-text" title="' + esc(f.title) + '">' + esc(f.title) + '</span>' + pinBadge + badgeHtml + mgmtPin + mgmtPens + mgmtDel + '</span></td>' +
            '<td class="ft-type-cell">' + esc(f.user_material_type || f.file_type) + (mgmt && selfOrInScope ? '<span class="mgmt-type-dropdown-wrap"><select class="mgmt-type-select" onchange="mgmtChangeType(' + f.id + ',this)">' + MATERIAL_TYPES.map(function(t) { var sel = (f.user_material_type || '') === t.name ? ' selected' : ''; return '<option value="' + t.id + '"' + sel + '>' + t.name + '</option>'; }).join('') + '</select></span>' : '') + '</td>' +
            '<td class="ft-size-cell">' + formatSize(f.file_size) + '</td>' +
            '<td class="ft-uploader">' + esc(f.uploader) + '</td>' +
            '<td class="ft-teacher">' + esc(f.teacher || '') + teacherPen + '</td>' +
            '<td class="ft-favcount">' + (f.favorite_count || 0) + '</td><td class="ft-dlcount">' + f.download_count + '</td>' +
            '<td class="ft-download"><span class="dl-normal">' + dlLink + '</span><span class="dl-check"><input type="checkbox" class="dl-chk" data-fid="' + f.id + '"' + (isChecked ? ' checked' : '') + ' onchange="onDlChkChange(this)"></span></td></tr>';
        }).join('');
        // 点击行跳转到文件详情页
        Array.from(tbody.children).forEach(tr => {
          tr.addEventListener('click', function(e) {
            if (e.target.closest('.dl-link, .dl-chk, .dl-check, .pv-link')) return;
            const fileId = parseInt(this.dataset.fileId);
            if (fileLookup[fileId]) showFileDetail(fileLookup[fileId]);
          });
        });
        renderPagination(_filterSortPage, totalPages);
        // 同名课程侧栏存在时折叠次要列
        const mainArea = document.querySelector('.file-area-main');
        const sidePanel = document.querySelector('.file-area-side');
        if (mainArea && sidePanel) mainArea.classList.add('file-area-compact');
        else if (mainArea) mainArea.classList.remove('file-area-compact');

        // ── 同步多选模式 UI（下载列与复选框切换，CSS 控制可见性，无布局抖动） ──
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
        var mobileLayout = !!document.getElementById('mfFileList');
        if (total <= 1) {
          if (pag) pag.style.display = 'none';
          // 移动端：仅一页时省略分页与每页条数设置
          if (mobileLayout) {
            var ppcHide = document.getElementById('perPageControl');
            if (ppcHide) ppcHide.style.display = 'none';
          }
          return;
        }
        if (!pag) {
          pag = document.createElement('div');
          pag.id = 'filePagination';
          pag.className = 'file-pagination';
          if (mobileLayout) {
            // 移动端：分页挂载到列表底部（与每页条数设置同区，分页在前）
            var mfBottom = document.getElementById('mfBottom');
            if (mfBottom) mfBottom.insertBefore(pag, mfBottom.firstChild);
          } else {
            var scrollHost = document.querySelector('.file-table-scroll');
            if (scrollHost) scrollHost.after(pag);
          }
        }
        if (mobileLayout) {
          var ppcShow = document.getElementById('perPageControl');
          if (ppcShow) ppcShow.style.display = '';
        }

        const numbers = getPageNumbers(page, total);

        let html = '<button class="fp-btn fp-prev' + (page <= 1 ? ' fp-disabled' : '') + '" data-page="' + (page - 1) + '" aria-label="上一页">' + iconSvg('chevron-left') + '</button>';

        numbers.forEach(function(n) {
          if (n === '…') {
            html += '<button class="fp-btn fp-ellipsis">⋯</button>';
          } else {
            html += '<button class="fp-btn fp-num' + (n === page ? ' fp-active' : '') + '" data-page="' + n + '">' + n + '</button>';
          }
        });

        html += '<button class="fp-btn fp-next' + (page >= total ? ' fp-disabled' : '') + '" data-page="' + (page + 1) + '" aria-label="下一页">' + iconSvg('chevron-right') + '</button>';

        pag.innerHTML = html;
        pag.style.display = 'flex';

        // Page number / prev / next clicks
        pag.querySelectorAll('.fp-num, .fp-prev, .fp-next').forEach(function(btn) {
          btn.addEventListener('click', function() {
            const p = parseInt(this.dataset.page);
            if (p && p >= 1 && p <= total && p !== _filterSortPage) {
              _filterSortPage = p;
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

      function showJumpPopup(event, total) {
        var existing = document.querySelector('.fp-jump-popup');
        if (existing) existing.remove();

        var btn = event.currentTarget;
        var rect = btn.getBoundingClientRect();

        var popup = document.createElement('div');
        popup.className = 'fp-jump-popup';

        let gridHtml = '<div class="fp-jump-grid">';
        for (let i = 1; i <= total; i++) {
          gridHtml += '<button class="fp-jump-num' + (i === _filterSortPage ? ' fp-active' : '') + '" data-page="' + i + '">' + i + '</button>';
        }
        gridHtml += '</div>';
        popup.innerHTML = gridHtml;

        popup.addEventListener('click', function(e) {
          var targetBtn = e.target.closest('.fp-jump-num');
          if (targetBtn) {
            var p = parseInt(targetBtn.dataset.page);
            if (p && p >= 1 && p <= total && p !== _filterSortPage) {
              _filterSortPage = p;
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
        if (document.getElementById('mfFileList')) {
          const ppc = document.getElementById('perPageControl');
          if (ppc) ppc.style.display = 'none';
        }
      }

      renderPage();
      // 断点跨越（横竖屏旋转/窗口拖拽）时按新布局重渲染，保留当前状态
      _rerenderFilesForLayout = function () { renderFiles(course, { keepState: true }); };
    };
    if (keepState && _allFilesCache && _allFilesCache.length) {
      proceed(_allFilesCache);
    } else {
      getFiles(code).then(proceed);
    }
  }

  // ── 文件简介模态框 ──
