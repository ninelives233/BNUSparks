/* BNU Sparks · explorer-render.js —— 渲染器+文件列表。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
  function renderGrid(items) {
    const parent = document.getElementById('explorerContent');
    // 所有大类/学院卡片统一进同一个 folder-grid，由 CSS flex-wrap + clamp 自适应列数
    // （不再有「第三行特排」：国际视野与文明对话/数学类/实用文件 与其余通识大类一起排布）。
    const regularItems = items.filter(i => !i.divider);
    const mgmt = isMgmtActive();
    let html = '';

    html += '<div class="folder-grid">' +
      regularItems.map(item => _cardHtml(item, mgmt)).join('') +
    '</div>';

    parent.innerHTML = html;
    parent.querySelectorAll('.folder-card').forEach(el => {
      el.addEventListener('click', function(e) {
        if (e.target.closest('.fc-card-menu-btn, .fc-card-menu')) return;
        navIn(el.dataset.n);
      });
    });
  }

  function _cardHtml(item, mgmt) {
    const canMgmt = mgmt && item.id &&
      (_userInScope(expPath) || _nodeInScope(item, expPath[0], expPath.length === 1));
    return '<div class="folder-card" data-n="' + esc(item.name) + '">' +
      '<div class="fc-icon">' + (CARD_ICONS[item.iconClass] || CARD_ICONS['folder']) + '</div>' +
      '<div class="fc-name">' + esc(item.name) + '</div>' +
      '<div class="fc-count">' + (item.children ? getEffectiveChildCount(item) + ' 项' : '') + '</div>' +
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
    const meta = cId ? '课程代码 ' + cId : (hasSub ? getEffectiveChildCount(item) + ' 项' : '');
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
      '<div class="fli-info"><div class="fli-name">' + esc(item.name) + '</div><div class="fli-meta">' + meta + '</div></div>' +
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
          '<div class="file-area-header"><h3 class="section-accent">' + esc(course.name) + ' — 资料列表</h3><span class="fa-count" id="fileCount">加载中...</span><span class="fa-per-page" id="perPageControl"></span><span class="fa-filter-bar" id="filterBar"><button class="fa-filter-btn" id="typeFilterBtn" onclick="toggleTypeFilterDropdown(event)">类型：全部 ▽</button><button class="fa-filter-btn" id="sortFilterBtn" onclick="toggleSortDropdown(event)">排序：上传时间 ▽</button></span>' + (code ? '<div class="fa-upload-header-btn">' + (currentUser ? '<button class="fa-upload-btn" onclick="showUploadModal(\'' + escJs(code) + '\',\'' + escJs(course.name) + '\',' + (course.id ? course.id : 'null') + ')">+ 上传资料</button><button class="fa-upload-btn fa-batch-dl-btn" id="multiSelectToggle" onclick="toggleMultiSelect()">' + (isMgmtActive() ? '📋 批量操作' : '⬇ 批量下载') + '</button>' : '<button class="fa-upload-btn" onclick="showUploadModal(\'' + escJs(code) + '\',\'' + escJs(course.name) + '\',' + (course.id ? course.id : 'null') + ')">+ 上传资料</button>') + '</div>' : '') + '</div>' +
          '<div class="file-table-wrap"><div class="batch-dl-bar" id="batchDlBar"><span id="selectedCount">已选 0 个</span>' +
            '<button class="admin-btn admin-btn-sm" onclick="batchDeleteSelected()" id="batchDeleteBtn" style="display:none">🗑 删除选中</button>' +
            '<button class="admin-btn admin-btn-sm" onclick="showBatchEditDialog()" id="batchEditBtn" style="display:none">✏️ 编辑选中</button>' +
            '<button class="admin-btn admin-btn-sm" onclick="batchDownloadSelected()" id="batchDlBtn" style="margin-left:auto">⬇ 下载选中</button>' +
          '</div>' +
          '<div class="file-table-scroll"><table class="file-table" id="fileTable"><thead><tr><th class="th-name">文件名</th><th class="th-type">类型</th><th class="th-size">大小</th><th class="th-uploader">上传者</th><th class="th-teacher">任课教师</th><th class="th-favcount">收藏量</th><th class="th-dlcount">下载量</th><th class="th-download"><span class="dl-normal">下载</span><span class="dl-check"><input type="checkbox" id="selectAllChkHead" onchange="toggleSelectAll(this)"> <span id="selectedCountHead"></span></span></th></tr></thead><tbody id="fileTableBody">' +
          '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint);padding:40px">加载中...</td></tr>' +
          '</tbody></table></div></div>' +
        '</div>' +
        (Object.keys(sameNameGroups).length ? '<div class="file-area-side-bottom"><div class="fasb-title">📚 同名课程（相同名称的不同课程代码）</div><div class="fasb-list">' +
          Object.values(sameNameGroups).map(g =>
            '<span class="fasb-item" onclick="showExplorer(\'' + escJs(g.type) + '\');setTimeout(function(){navToLast(\'' + escJs(g.courseId) + '\')},60)">' +
              '<span class="fasb-code">' + esc(g.courseId) + '</span>' +
              (g.programs.length ? '<span class="fasb-programs">（' + esc(g.programs.join(' / ')) + '）</span>' : '') +
            '</span>'
          ).join(' · ') +
        '</div></div>' : '');

    if (!code) return;

    getFiles(code).then(allFiles => {
      // 缓存全量数据供筛选排序使用
      _allFilesCache = allFiles;
      _typeFilter = '';
      _sortBy = 'date';
      _filterSortPage = 1;  // 切换课程时重置页码，避免翻页状态残留
      _renderFilterSortLabels();

      const totalFiles = allFiles.length;
      document.getElementById('fileCount').textContent = totalFiles + ' 个文件';

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
        const tbody = document.getElementById('fileTableBody');
        if (!filteredFiles.length) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint);padding:40px">暂无资料，欢迎上传</td></tr>';
          hidePagination();
          if (_multiSelectMode) { _multiSelectMode = false; _selectedIds = {}; var mBtn = document.getElementById('multiSelectToggle'); if (mBtn) mBtn.textContent = '⬇ 批量下载'; }
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
                ? '<a href="javascript:void(0)" class="dl-link" onclick="handleDownloadClick(' + f.id + ',this,event)">⬇ 下载</a><a href="javascript:void(0)" class="pv-link" onclick="event.stopPropagation();showPreview(' + f.id + ')">预览</a>'
                : '<span class="dl-link dl-disabled" title="审核通过后可下载">⏳ 待审核</span>')
            : '<a href="javascript:void(0)" class="dl-link" onclick="handleDownloadClick(' + f.id + ',this,event)">⬇ 下载</a>';
          var isChecked = !!_selectedIds[f.id];
          var mgmt = isMgmtActive();
          // 管理模式：文件名和教师旁加铅笔（屏幕宽度 > 768px），仅在可编辑时显示
          var selfOrInScope = mgmt && (f.is_uploader || f.can_delete);
          var mgmtPens = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen" onclick="event.stopPropagation();quickEditField(' + f.id + ',\'title\',\'' + escJs(f.title) + '\')">✏️</span>')
            : '';
          var teacherPen = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen mgmt-pen-sm" onclick="event.stopPropagation();quickEditField(' + f.id + ',\'teacher\',\'' + escJs(f.teacher || '') + '\')">✏️</span>')
            : '';
          var mgmtDel = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen mgmt-del" onclick="event.stopPropagation();deleteFileConfirm(' + f.id + ',this)" title="删除此文件">🗑️</span>')
            : '';
          // 置顶：徽章对全体用户可见；图钉仅管理模式（铅笔左侧）
          var pinBadge = f.is_pinned ? '<span class="file-pin-badge" title="已置顶">📌</span>' : '';
          var mgmtPin = mgmt && selfOrInScope && window.innerWidth > 768
            ? ('<span class="mgmt-pen mgmt-pin" onclick="event.stopPropagation();toggleFilePin(' + f.id + ',' + (f.is_pinned ? 1 : 0) + ',this)" title="' + (f.is_pinned ? '取消置顶' : '置顶此文件') + '">📌</span>')
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
      }

      renderPage();
    });
  }

  // ── 文件简介模态框 ──

