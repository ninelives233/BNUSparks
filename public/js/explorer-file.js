/* BNU Sparks · explorer-file.js —— 文件简介/详情/举报/内联编辑。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
  var _fileInfoOverlay = null;

  function showFileInfoModal(file) {
    window._currentInfoFile = file; // 供模式切换时即时重渲染弹窗
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
          '<div class="fi-row"><span class="fi-label">资料类型</span><span class="fi-value">' + esc(file.user_material_type || file.file_type || '其他') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">文件大小</span><span class="fi-value">' + formatSize(file.file_size) + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">上传者</span><span class="fi-value">' + esc(file.uploader || '匿名') + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">任课教师</span><span class="fi-value">' + teacherHtml + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">下载量</span><span class="fi-value">' + file.download_count + '</span></div>' +
          '<div class="fi-row"><span class="fi-label">上传日期</span><span class="fi-value">' + esc(file.created_at || '') + '</span></div>' +
          '<div class="fi-row fi-row-desc"><span class="fi-label">简介</span><span class="fi-value">' + descHtml + '</span></div>' +
          '<div class="fi-actions">' +
            (currentUser
              ? '<button class="fi-preview-btn" onclick="event.stopPropagation();showPreview(' + file.id + ')">预览文件</button><button class="fi-download-btn" onclick="handleDownloadClick(' + file.id + ',this,event)">⬇ 下载文件</button>'
              : '<button class="fi-download-btn" onclick="event.stopPropagation();handleDownloadClick(' + file.id + ',this,event)">⬇ 下载文件</button>') +
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

  // ── 管理模式：文件置顶/取消置顶（v177）──
  function toggleFilePin(fid, currentlyPinned) {
    var next = !currentlyPinned;
    var msg = next ? '置顶该文件到目录顶部？' : '取消置顶？';
    if (!window.confirm(msg)) return;
    api('/api/files/' + fid + '/pin/', { method: 'POST', body: { pinned: next } }).then(function() {
      renderExplorer();
    }).catch(function(err) {
      alert('操作失败：' + (err && err.message ? err.message : '未知错误'));
    });
  }


  // 管理模式表格行内快速改类型
  function mgmtChangeType(fileId, selectEl) {
    var val = selectEl.value;
    if (!val) return;
    api('/api/files/' + fileId + '/update/', {
      method: 'PATCH',
      body: { material_type_id: parseInt(val) }
    }).then(function() {
      // 刷新视图
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

  // ── 筛选排序 ──
  function _getFilteredSortedFiles() {
    var files = _allFilesCache.slice();
    // 类型筛选
    if (_typeFilter) {
      files = files.filter(function(f) {
        return (f.user_material_type || f.file_type) === _typeFilter;
      });
    }
    // 排序
    if (_sortBy === 'download') {
      files.sort(function(a, b) { return (b.download_count || 0) - (a.download_count || 0); });
    } else if (_sortBy === 'favorite') {
      files.sort(function(a, b) { return (b.favorite_count || 0) - (a.favorite_count || 0); });
    } else if (_sortBy === 'teacher') {
      files.sort(function(a, b) {
        var ta = (a.teacher || '').toLowerCase();
        var tb = (b.teacher || '').toLowerCase();
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        return 0;
      });
    }
    // 默认：上传时间倒序（文件已按 -created_at 排序）
    return files;
  }

  function _renderFilterSortLabels() {
    var typeBtn = document.getElementById('typeFilterBtn');
    if (typeBtn) {
      typeBtn.textContent = '类型：' + (_typeFilter || '全部') + ' ▾';
    }
    var sortBtn = document.getElementById('sortFilterBtn');
    if (sortBtn) {
      var labels = { 'date': '上传时间', 'download': '下载量', 'favorite': '收藏量', 'teacher': '任课教师' };
      sortBtn.textContent = '排序：' + (labels[_sortBy] || '上传时间') + ' ▾';
    }
  }

  function _closeFilterSortDropdowns() {
    document.querySelectorAll('.filter-dropdown').forEach(function(el) { el.remove(); });
  }

  function toggleTypeFilterDropdown(event) {
    event.stopPropagation();
    _closeFilterSortDropdowns();
    var btn = document.getElementById('typeFilterBtn');
    var rect = btn.getBoundingClientRect();
    var dropdown = document.createElement('div');
    dropdown.className = 'filter-dropdown';
    var html = '<div class="filter-dd-header">类型：</div>';
    html += '<div class="filter-dd-item' + (!_typeFilter ? ' filter-dd-active' : '') + '" data-value="">全部</div>';
    MATERIAL_TYPES.forEach(function(t) {
      html += '<div class="filter-dd-item' + (_typeFilter === t.name ? ' filter-dd-active' : '') + '" data-value="' + esc(t.name) + '">' + esc(t.name) + '</div>';
    });
    dropdown.innerHTML = html;
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.left = Math.max(8, rect.left) + 'px';
    dropdown.style.zIndex = '1000';
    dropdown.addEventListener('click', function(e) {
      var item = e.target.closest('.filter-dd-item');
      if (item) {
        var val = item.dataset.value;
        _typeFilter = val;
        _filterSortPage = 1;
        _renderFilterSortLabels();
        _closeFilterSortDropdowns();
        // 重新渲染页面
        if (typeof _renderCurrentPage === 'function') _renderCurrentPage();
      }
    });
    document.body.appendChild(dropdown);
  }

  function toggleSortDropdown(event) {
    event.stopPropagation();
    _closeFilterSortDropdowns();
    var btn = document.getElementById('sortFilterBtn');
    var rect = btn.getBoundingClientRect();
    var dropdown = document.createElement('div');
    dropdown.className = 'filter-dropdown';
    var labels = { 'date': '上传时间', 'download': '下载量', 'favorite': '收藏量', 'teacher': '任课教师' };
    var html = '';
    ['date', 'download', 'favorite', 'teacher'].forEach(function(key) {
      html += '<div class="filter-dd-item' + (_sortBy === key ? ' filter-dd-active' : '') + '" data-value="' + key + '">' + labels[key] + '</div>';
    });
    dropdown.innerHTML = html;
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.left = Math.max(8, rect.left) + 'px';
    dropdown.style.zIndex = '1000';
    dropdown.addEventListener('click', function(e) {
      var item = e.target.closest('.filter-dd-item');
      if (item) {
        var val = item.dataset.value;
        _sortBy = val;
        _filterSortPage = 1;
        _renderFilterSortLabels();
        _closeFilterSortDropdowns();
        if (typeof _renderCurrentPage === 'function') _renderCurrentPage();
      }
    });
    document.body.appendChild(dropdown);
  }

  // 点击页面其他地方关闭筛选排序下拉
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.filter-dropdown') && !e.target.closest('.fa-filter-btn')) {
      _closeFilterSortDropdowns();
    }
  });


  // ============================================================
  // 文件详情页（替换弹窗）
  // ============================================================

  function _showFileDetailSkeleton() {
    document.querySelectorAll('.view-section').forEach(function(v) { v.style.display = 'none'; v.classList.remove('active'); });
    var v = document.getElementById('fileDetailView');
    if (v) { v.style.display = 'block'; v.classList.add('active'); }
    var titleEl = document.getElementById('fdTitle');
    if (titleEl) titleEl.innerHTML = '<span style="color:var(--ink-faint)">加载中…</span>';
    var meta1 = document.querySelector('.fd-meta1');
    if (meta1) meta1.innerHTML = '<span style="color:var(--ink-faint);font-size:0.82rem">加载中…</span>';
    var meta2 = document.querySelector('.fd-meta2');
    if (meta2) meta2.innerHTML = '';
    var descEl = document.querySelector('.fd-desc-area');
    if (descEl) descEl.innerHTML = '';
    var uploaderEl = document.querySelector('.fd-uploader-card');
    if (uploaderEl) uploaderEl.innerHTML = '';
    var actionsEl = document.getElementById('fdActions');
    if (actionsEl) actionsEl.innerHTML = '';
    window.scrollTo({ top: 0 });
  }

  var _currentDetailFile = null;

  var _fdPrevSidebar = null; // 保存进入文件详情前的侧边栏状态

  function showFileDetail(file) {
    // 文件详情可从搜索、通知或管理追溯页直接打开；这些入口可能尚未加载 explorer 核心。
    if (typeof expPath === 'undefined' && typeof ensureFeature === 'function') {
      ensureFeature('explorer').then(function() { showFileDetail(file); });
      return;
    }
    // 保存当前侧边栏状态，保持高亮不丢失
    var al = document.querySelector('.side-nav a.active');
    _fdPrevSidebar = al ? al.getAttribute('data-view') : null;

    // 如果数据不完整，从 API 获取
    if (!file.file_name && file.id) {
      if (window._fileLookup && window._fileLookup[file.id]) {
        file = window._fileLookup[file.id];
      } else {
        // 异步从 API 获取完整数据
        var fid = file.id;
        var fTitle = file.title || '';
        // 先渲染骨架屏
        _showFileDetailSkeleton();
        updateSidebar(_fdPrevSidebar);
        pushViewState('fileDetail', { fileId: fid, prevView: _fdPrevSidebar });
        api('/api/files/' + fid + '/').then(function(fullFile) {
          _currentDetailFile = fullFile;
          var v = document.getElementById('fileDetailView');
          if (v) { v.style.display = 'block'; v.classList.add('active'); }
          _renderFileDetail(fullFile);
        }).catch(function() {
          // API 失败时回退到课程页
          if (file.course_code) {
            var t = file.course_code.startsWith('GEN') ? '通识课' : '专业课';
            showExplorer(t);
            requestAnimationFrame(function() {
              requestAnimationFrame(function() { navToLast(file.course_code); });
            });
          } else { showHome(); }
        });
        return;
      }
    }
    _currentDetailFile = file;
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.style.display = 'none';
      v.classList.remove('active');
    });
    var v = document.getElementById('fileDetailView');
    if (v) { v.style.display = 'block'; v.classList.add('active'); }
    updateSidebar(_fdPrevSidebar);
    window.scrollTo({ top: 0 });
    pushViewState('fileDetail', { fileId: file.id, prevView: _fdPrevSidebar });
    _renderFileDetail(file);
  }

  function _renderFileDetail(file) {
    var bc = document.getElementById('fdBreadcrumb');
    if (bc) {
      var treePath = null;
      // 优先用当前导航上下文（expPath），验证最后一个节点是否匹配课程
      if (expPath && expPath.length > 0) {
        var lastNode = getNode(expPath);
        if (lastNode && lastNode.courseId === file.course_code) {
          treePath = expPath.slice();
        }
      }
      // 回退到全局树搜索
      if (!treePath) {
        treePath = findPathByCourseId(file.course_code || '');
      }
      if (treePath && treePath.length > 0) {
        _fdBreadcrumbPath = treePath;
        _renderBreadcrumb(bc, treePath, {
          onNavigate: function(depth) { navToFdBreadcrumbDepth(depth); }
        });
        // 追加静态的"文件详情"（不与课程名重叠）
        var sep = document.createElement('span');
        sep.className = 'bc-sep'; sep.textContent = ' / ';
        bc.appendChild(sep);
        var cur = document.createElement('span');
        cur.className = 'bc-current'; cur.textContent = '文件详情';
        bc.appendChild(cur);
      } else {
        var type = file.course_code && file.course_code.startsWith('GEN') ? '通识课' : '专业课';
        _fdBreadcrumbPath = [type, file.course_name || ''];
        _renderBreadcrumb(bc, _fdBreadcrumbPath, {
          onNavigate: function(depth) { navToFdBreadcrumbDepth(depth); }
        });
        // 追加静态的"文件详情"
        var sep = document.createElement('span');
        sep.className = 'bc-sep'; sep.textContent = ' / ';
        bc.appendChild(sep);
        var cur = document.createElement('span');
        cur.className = 'bc-current'; cur.textContent = '文件详情';
        bc.appendChild(cur);
      }
    }
    var canEdit = currentUser && !_civilianMode && (file.is_uploader || (file.can_delete && currentUser.role !== 'user'));
    var penIcon = '<button class="fd-pen" onclick="fdEditField(this)" title="点击编辑">\u270f\ufe0f</button>';
    var typeDropdownHtml = canEdit
      ? '<span class="fd-type-dropdown-wrap"><select class="fd-type-select" onchange="fdChangeType(' + (file.id || 0) + ',this)">' +
          MATERIAL_TYPES.map(function(t) {
            var selected = (file.user_material_type || '') === t.name ? ' selected' : '';
            return '<option value="' + t.id + '"' + selected + '>' + t.name + '</option>';
          }).join('') +
        '</select></span>'
      : '';
    var titleEl = document.getElementById('fdTitle');
    if (titleEl) {
      var titleHtml = canEdit
        ? '<span class="fd-editable" data-field="title" data-fid="' + (file.id || 0) + '">' + esc(file.title || '') + '</span>' + penIcon
        : esc(file.title || '');
      if (file.is_pinned) titleHtml += ' <span class="file-pin-badge" title="已置顶">📌</span>';
      titleEl.innerHTML = titleHtml;
    }
    var meta1 = document.querySelector('.fd-meta1');
    if (meta1) {
      var fileNameHtml = '<span class="fd-meta-item"><span class="fd-meta-icon">' + FD_ICONS.file + '</span> ' + esc(file.file_name || '') + '</span>';
      var typeHtml = '<span class="fd-meta-item"><span class="fd-meta-icon">' + FD_ICONS.tag + '</span> ' + esc(file.user_material_type || '其他') + typeDropdownHtml + '</span>';
      var dateHtml = '<span class="fd-meta-item"><span class="fd-meta-icon">' + FD_ICONS.calendar + '</span> ' + esc(file.created_at || '') + '</span>';
      var sizeHtml = '<span class="fd-meta-item"><span class="fd-meta-icon">' + FD_ICONS.storage + '</span> ' + formatSize(file.file_size) + '</span>';
      var teacherHtml = '<span class="fd-meta-item"><span class="fd-meta-icon">' + FD_ICONS.teacher + '</span> ' + (canEdit
        ? '<span class="fd-editable" data-field="teacher" data-fid="' + (file.id || 0) + '">' + esc(file.teacher || '未填写') + '</span>' + penIcon
        : esc(file.teacher || '未填写')) + '</span>';
      meta1.innerHTML = '<div class="fd-meta-row">' + fileNameHtml + '<span class="fd-meta-sep">|</span>' + typeHtml + '<span class="fd-meta-sep">|</span>' + dateHtml + '<span class="fd-meta-sep">|</span>' + sizeHtml + '<span class="fd-meta-sep">|</span>' + teacherHtml + '</div>';
    }
    var meta2 = document.querySelector('.fd-meta2');
    if (meta2) {
      var dlHtml = '<span class="fd-meta-item"><span class="fd-meta-icon">' + FD_ICONS.download + '</span> 下载量：' + (file.download_count || 0) + '</span>';
      var favHtml = '<span class="fd-meta-item"><span class="fd-meta-icon">' + FD_ICONS.star + '</span> 收藏量：' + (file.favorite_count || 0) + '</span>';
      meta2.innerHTML = '<div class="fd-meta-row">' + dlHtml + '<span class="fd-meta-sep">|</span>' + favHtml + '</div>';
    }
    var descEl = document.querySelector('.fd-desc-area');
    if (descEl) {
      var descContent = canEdit
        ? '<span class="fd-editable" data-field="description" data-fid="' + (file.id || 0) + '">' + esc(file.description || '暂无简介') + '</span>' + penIcon
        : esc(file.description || '暂无简介');
      descEl.innerHTML = '<div class="fd-desc-card">' + descContent + '</div>';
    }
    var uploaderEl = document.querySelector('.fd-uploader-card');
    if (uploaderEl) {
      var initial = (file.uploader || '?').charAt(0).toUpperCase();
      var userId = file.uploader_id || 0;
      var avatarHtml = file.uploader_avatar
        ? '<img src="' + esc(file.uploader_avatar) + '" class="fdu-avatar-img" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<div class="fdu-avatar" style="display:none">' + esc(initial) + '</div>'
        : '<div class="fdu-avatar">' + esc(initial) + '</div>';
      uploaderEl.innerHTML =
        '<div class="fdu-card" onclick="showUserPublic(' + userId + ')">' +
          avatarHtml +
          '<div class="fdu-info">' +
            '<div class="fdu-name">' + esc(file.uploader || '匿名') + '</div>' +
            '<div class="fdu-label">上传者</div>' +
          '</div>' +
        '</div>';
    }
    var actionsEl = document.getElementById('fdActions');
    if (actionsEl) {
      var dlBtn = '<button class="fd-btn fd-btn-primary" onclick="handleDownloadClick(' + (file.id || 0) + ',this,event)">' + FD_ICONS.download + ' 下载</button>';
      var favBtn = currentUser
        ? '<button class="fd-btn fd-btn-secondary fd-btn-fav" id="fdFavBtn" onclick="toggleFdFavorite(' + (file.id || 0) + ')">' + FD_ICONS.star + ' 收藏</button>'
        : '';
      // 举报按钮：低调 ghost，收藏按钮右侧；大小与收藏一致（同 .fd-btn 基类）
      var repBtn = currentUser
        ? '<button class="fd-btn fd-btn-secondary fd-btn-report" id="fdRepBtn" onclick="openReportModal(' + (file.id || 0) + ', ' + (file.uploader_id || 0) + ')" title="举报资料问题">' + FD_ICONS.report + ' 举报</button>'
        : '';
      var delBtn = (file.can_delete && !_civilianMode)
        ? '<button class="fd-btn fd-btn-danger" onclick="deleteFileConfirm(' + (file.id || 0) + ',this)">' + FD_ICONS.trash + ' 删除</button>'
        : '';
      actionsEl.innerHTML = '<div class="fd-actions-inner">' + dlBtn + favBtn + repBtn + delBtn + '</div>';
      // 加载初始收藏状态
      if (currentUser) {
        if (file.is_favorited !== undefined) {
          var fb = document.getElementById('fdFavBtn');
          if (fb) {
            fb.innerHTML = file.is_favorited ? FD_ICONS.starFilled + ' 已收藏' : FD_ICONS.star + ' 收藏';
            fb.classList.toggle('favorited', file.is_favorited);
          }
        } else {
          api('/api/files/' + (file.id || 0) + '/favorite-status/').then(function(fs) {
            var fb = document.getElementById('fdFavBtn');
            if (fb) {
              fb.innerHTML = fs.favorited ? FD_ICONS.starFilled + ' 已收藏' : FD_ICONS.star + ' 收藏';
              fb.classList.toggle('favorited', fs.favorited);
            }
          }).catch(function(){});
        }
        // 加载初始举报状态：已举报 → 按钮禁用「已举报」
        api('/api/files/' + (file.id || 0) + '/report-status/').then(function(rs) {
          var rb = document.getElementById('fdRepBtn');
          if (rb && rs.reported) {
            rb.classList.add('reported');
            rb.disabled = true;
            rb.innerHTML = FD_ICONS.report + ' 已举报';
          }
        }).catch(function(){});
      }
    }
    var badgeEl = document.getElementById('fdPreviewBadge');
    if (badgeEl) {
      badgeEl.innerHTML = extBadge(file.file_name);
    }
    // 预览提示文字：PDF 显示"预览最多显示前三页"
    var fdh = document.querySelector('.fd-preview-header');
    if (fdh) {
      var hint = fdh.querySelector('.pv-hint');
      if (!hint) {
        hint = document.createElement('span');
        hint.className = 'pv-hint';
        fdh.appendChild(hint);
      }
      var extType = _isPreviewableExt(file.file_name);
      hint.textContent = extType === 'pdf' ? '预览最多显示前三页' : (extType === 'zip' ? '文件清单' : '');
    }
    _loadFdPreview(file.id, file.file_name);
  }

  async function _loadFdPreview(fileId, fileName) {
    var body = document.getElementById('fdPreviewBody');
    if (!body) return;
    var area = document.getElementById('fdPreviewArea');
    var extType = _isPreviewableExt(fileName);

    // Zip 文件：读取内部结构并展示文件树
    if (extType === 'zip') {
      if (area) area.style.display = '';
      body.innerHTML = '<div class="pv-zip-loading">正在读取压缩包内的文件列表…</div>';
      try {
        var zdata = await _loadZipStructure(fileId);
        if (zdata && Array.isArray(zdata.items)) {
          renderZipTree(body, zdata.items, fileId, fileName, zdata.truncated);
          return;
        }
      } catch(e) {}
      body.innerHTML = '<div class="pv-unsupported"><div class="pv-unsupported-icon">📦</div><div class="pv-unsupported-text">压缩包文件结构读取失败，文件可能已损坏</div></div>';
      return;
    }

    // 非可预览类型 — 隐藏整个预览区域，干净利落
    if (extType === 'other' || extType === 'ppt') {
      if (area) area.style.display = 'none';
      return;
    }

    // 可预览类型：确保预览区域可见
    if (area) area.style.display = '';

    body.innerHTML = '<div class="pv-unsupported"><div class="pv-unsupported-icon" style="font-size:1rem">\u27f3</div><div class="pv-unsupported-text" style="font-size:0.85rem">正在加载预览…</div></div>';
    try {
      var previewUrl = await _previewUrl(fileId);
      if (extType === 'pdf') {
        body.innerHTML = '<iframe src="' + previewUrl + '" style="width:100%;height:85vh;border:none;border-radius:var(--radius-md)" class="pv-viewer"></iframe>';
      } else if (extType === 'image') {
        body.innerHTML = '<img src="' + previewUrl + '" alt="预览" class="pv-viewer" style="max-width:95%;max-height:95%;object-fit:contain;border-radius:var(--radius-md);box-shadow:0 4px 32px oklch(0 0 0 / 0.3)">';
      } else if (extType === 'text') {
        body.innerHTML = '<div class="pv-text-wrap"><pre class="pv-text" id="fdPvTextContent">加载中…</pre></div>';
        fetch(previewUrl).then(function(r) {
          if (!r.ok) throw new Error('加载失败');
          return r.text();
        }).then(function(text) {
          var pre = document.getElementById('fdPvTextContent');
          if (pre) {
            pre.textContent = text.slice(0, 500);
            var ext = (fileName || '').split('.').pop().toLowerCase();
            if (['py','js','ts','css','html','json','xml','sh','md','c','cpp','java','go','rs'].includes(ext)) {
              pre.className = 'pv-text pv-text-code';
            }
          }
        }).catch(function() {
          var pre = document.getElementById('fdPvTextContent');
          if (pre) pre.textContent = '无法加载文件内容';
        });
      }
    } catch(e) {
      body.innerHTML = '<div class="pv-unsupported"><div class="pv-unsupported-icon">\u26a0\ufe0f</div><div class="pv-unsupported-text">预览加载失败，请尝试下载后查看</div></div>';
    }
  }

  async function toggleFdFavorite(fileId) {
    try {
      var data = await api('/api/files/' + fileId + '/favorite/', { method: 'POST' });
      var btn = document.getElementById('fdFavBtn');
      if (btn) {
        btn.innerHTML = data.favorited ? FD_ICONS.starFilled + ' 已收藏' : FD_ICONS.star + ' 收藏';
        btn.classList.toggle('favorited', data.favorited);
      }
    } catch(e) {
      alert('操作失败：' + e.message);
    }
  }

  // ═══════════════════ 举报（v172） ═══════════════════
  function openReportModal(fileId, uploaderId) {
    // 先查状态：已举报/超限 → 仅提示，不进入举报界面
    api('/api/files/' + fileId + '/report-status/').then(function(rs) {
      if (rs.reported) { alert('你已举报过该资料'); return; }
      if (rs.can_report === false) { alert('今日举报次数过多'); return; }
      _renderReportModal(fileId, uploaderId);
    }).catch(function() {
      _renderReportModal(fileId, uploaderId);
    });
  }

  function _renderReportModal(fileId, uploaderId) {
    var old = document.querySelector('.report-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.className = 'report-overlay';
    var groupsHtml = _REPORT_GROUPS.map(function(g) {
      var itemsHtml = g.items.map(function(v) {
        var meta = _REPORT_ITEM_META[v];
        if (!meta) return '';
        var fieldHtml = meta.field
          ? '<div class="rd-field" id="' + meta.field.id + '" style="display:none"><label>' + meta.field.label + '</label>' +
            '<input type="text" id="' + meta.field.inputId + '" placeholder="' + meta.field.ph + '"></div>'
          : '';
        return '<div class="report-option" data-value="' + v + '" onclick="toggleReportOption(this)">' +
          '<span class="ro-cb"></span>' +
          '<span class="ro-text"><span class="ro-label">' + meta.label + '</span>' +
          (meta.desc ? '<span class="ro-desc">' + meta.desc + '</span>' : '') + '</span>' +
          fieldHtml + '</div>';
      }).join('');
      return '<div class="report-group"><div class="rg-head">' + g.title + '</div><div class="rg-options">' + itemsHtml + '</div></div>';
    }).join('');

    var uploaderExists = !!uploaderId;
    var joinHtml = uploaderExists
      ? '<label class="rd-check"><input type="checkbox" id="rdReportUser"> ' +
        '<span><strong>连带举报该用户</strong><br><span class="rd-check-desc">如果此人上传了大量有问题的资料，将一并提请管理员核查该账号</span></span></label>'
      : '';

    overlay.innerHTML =
      '<div class="report-dialog" role="dialog" aria-modal="true">' +
        '<div class="rd-head">' +
          '<div class="rd-title">资料举报</div>' +
          '<div class="rd-sub">请选择至少一个举报原因（可多选），审核员将在 1–3 个工作日内处理</div>' +
          '<button class="rd-close" onclick="closeReportModal(event)" aria-label="关闭">✕</button>' +
        '</div>' +
        '<div class="rd-body">' +
          groupsHtml +
          '<div class="report-group rd-detail-group">' +
            '<div class="rg-head">详细说明（可选）</div>' +
            '<textarea id="rdDetail" placeholder="可以提供更详细的举报原因说明，以帮助审核员更好地判断资料的违规情况"></textarea>' +
            '<div class="rd-hint" id="rdDetailHint">如果选择了「其他原因」，则必须填写详细说明。</div>' +
          '</div>' +
          joinHtml +
        '</div>' +
        '<div class="rd-error" id="rdError" style="display:none"></div>' +
        '<div class="rd-actions">' +
          '<button class="admin-btn admin-btn-primary" id="rdSubmitBtn" onclick="submitReport(' + fileId + ')" disabled>提交举报</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="closeReportModal(event)">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) closeReportModal(null); };
    lockScroll();
    _pushModalHistory();
  }

  function closeReportModal(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    var overlay = document.querySelector('.report-overlay');
    if (overlay) { overlay.remove(); unlockScroll(); _popModalHistory(); }
  }

  function toggleReportOption(el) {
    el.classList.toggle('selected');
    var v = el.getAttribute('data-value');
    var meta = _REPORT_ITEM_META[v];
    if (meta && meta.field) {
      var f = document.getElementById(meta.field.id);
      if (f) f.style.display = el.classList.contains('selected') ? '' : 'none';
    }
    _updateReportState();
  }

  function _getSelectedReport() {
    return Array.from(document.querySelectorAll('.report-option.selected'))
      .map(function(el) { return el.getAttribute('data-value'); });
  }

  function _updateReportState() {
    var sel = _getSelectedReport();
    var btn = document.getElementById('rdSubmitBtn');
    if (btn) btn.disabled = sel.length === 0;
    var hint = document.getElementById('rdDetailHint');
    if (hint) {
      var hasOther = sel.indexOf('other') >= 0;
      hint.classList.toggle('rd-hint-error', hasOther);
      hint.textContent = hasOther ? '已选择「其他原因」，必须填写详细说明。' : '如果选择了「其他原因」，则必须填写详细说明。';
    }
  }

  function _showReportError(msg) {
    var e = document.getElementById('rdError');
    if (e) { e.textContent = msg; e.style.display = ''; }
  }

  function submitReport(fileId) {
    var sel = _getSelectedReport();
    if (!sel.length) { _showReportError('请至少选择一个举报原因'); return; }
    var detail = (document.getElementById('rdDetail') || {}).value ? document.getElementById('rdDetail').value.trim() : '';
    if (sel.indexOf('other') >= 0 && !detail) {
      _showReportError('选择「其他原因」时，必须填写详细说明');
      var d = document.getElementById('rdDetail');
      if (d) d.focus();
      return;
    }
    // 动态字段并入详细说明
    var fErr = document.getElementById('rdInputError');
    if (sel.indexOf('error') >= 0 && fErr && fErr.value.trim()) {
      detail = (detail ? detail + '\n' : '') + '具体错误位置：' + fErr.value.trim();
    }
    var fIr = document.getElementById('rdInputIrrelevant');
    if (sel.indexOf('irrelevant') >= 0 && fIr && fIr.value.trim()) {
      detail = (detail ? detail + '\n' : '') + '实际课程：' + fIr.value.trim();
    }
    var reportUser = false;
    var ru = document.getElementById('rdReportUser');
    if (ru) reportUser = ru.checked;
    var btn = document.getElementById('rdSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
    api('/api/files/' + fileId + '/report/', { method: 'POST', body: { reasons: sel, detail: detail, report_user: reportUser } })
      .then(function() {
        closeReportModal(null);
        var rb = document.getElementById('fdRepBtn');
        if (rb) { rb.classList.add('reported'); rb.disabled = true; rb.innerHTML = FD_ICONS.report + ' 已举报'; }
        alert('举报已提交，审核员将在 1-3 个工作日内处理');
      })
      .catch(function(err) {
        _showReportError(err.message || '提交失败，请稍后重试');
        if (btn) { btn.disabled = false; btn.textContent = '提交举报'; }
      });
  }

  function fdEditField(penEl) {
    var parent = penEl.parentElement;
    var span = parent.querySelector('.fd-editable');
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
    penEl.textContent = '\U0001f4be';
    penEl.onclick = function(e) {
      e.stopPropagation();
      fdSaveField(span, fid, field, input, penEl);
    };
    input.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') { fdSaveField(span, fid, field, input, penEl); }
      if (ev.key === 'Escape') { span.textContent = original; penEl.textContent = '\u270f\ufe0f'; penEl.onclick = function(){fdEditField(penEl);}; }
    });
    input.addEventListener('blur', function() {
      setTimeout(function() {
        if (!penEl.textContent.includes('\u2705')) {
          span.textContent = original;
          penEl.textContent = '\u270f\ufe0f';
          penEl.onclick = function(){fdEditField(penEl);};
        }
      }, 200);
    });
  }

  function fdSaveField(spanEl, fid, field, input, penEl) {
    var val = input.value.trim();
    api('/api/files/' + fid + '/update/', { method: 'PATCH', body: (function(){var o={};o[field]=val;return o;})() }).then(function(data) {
      spanEl.textContent = data[field] || val || '未填写';
      penEl.textContent = '\u2705';
      penEl.onclick = function(){};
      setTimeout(function() { penEl.textContent = '\u270f\ufe0f'; penEl.onclick = function(){fdEditField(penEl);}; }, 1500);
    }).catch(function(err) {
      alert('保存失败：' + err.message);
    });
  }

  function fdChangeType(fileId, selectEl) {
    var val = selectEl.value;
    if (!val) return;
    api('/api/files/' + fileId + '/update/', {
      method: 'PATCH',
      body: { material_type_id: parseInt(val) }
    }).then(function() {
      if (_currentDetailFile) {
        _currentDetailFile.user_material_type = selectEl.options[selectEl.selectedIndex].text;
      }
    }).catch(function(err) {
      alert('保存失败：' + err.message);
    });
  }
  // ── 文件预览 ──
