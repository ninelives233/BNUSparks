  // ═══════════════════════════════════════════════════════════
  // 新建课程视图（v=142）
  // 首页上传弹窗 →「新建课程」→ 本视图；通识课/专业课分段表单，
  // 提交新建课程申请（可随附文件），管理员审核后创建课程文件夹。
  // ═══════════════════════════════════════════════════════════

  var _ncState = {
    college: null,      // 选中的学院 { id, name }
    majorNode: null,    // 选中的专业节点（课程树节点）
    targetCatId: null,  // 选中的目标 CourseCategory id
    targetPath: '',     // 目标路径字符串
  };
  var _ncColleges = [];   // 学院列表缓存

  function _ncEl(id) { return document.getElementById(id); }

  function showNewCourse() {
    pushViewState('newCourse', {});
    switchView('newCourse');
    updateSidebar(null);
    _renderNewCourseBreadcrumb();
    switchNewCourseType('general');
    window.scrollTo({ top: 0 });
    _updateFooterVisibility('newCourse');
  }

  // 会话恢复时只渲染不压栈
  function renderNewCourseView() {
    switchView('newCourse');
    updateSidebar(null);
    _renderNewCourseBreadcrumb();
    switchNewCourseType('general');
    _updateFooterVisibility('newCourse');
  }

  function _renderNewCourseBreadcrumb() {
    var el = _ncEl('ncBreadcrumb');
    if (el && typeof _renderBreadcrumb === 'function') {
      _renderBreadcrumb(el, [''], { lastStatic: '新建课程' });
    }
  }

  // ── 分段控制器 ──
  function switchNewCourseType(type) {
    var isGeneral = type === 'general';
    document.querySelectorAll('.nc-seg-btn').forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-nc-type') === type);
    });
    var g = _ncEl('ncGeneralPane'), m = _ncEl('ncMajorPane');
    if (g) g.style.display = isGeneral ? '' : 'none';
    if (m) m.style.display = isGeneral ? 'none' : '';
    _populateMaterialTypeSelect(_ncEl('ncGMaterialType'));
    _populateMaterialTypeSelect(_ncEl('ncMMaterialType'));
    if (isGeneral) _populateGeneralCategories();
    else _populateColleges();
  }

  // ── 通识课：课程类型下拉（10 类 + 数学类）──
  function _populateGeneralCategories() {
    var sel = _ncEl('ncGeneralCategory');
    if (!sel || sel.options.length > 1) return;
    var cats = [];
    var root = courseTree && courseTree['通识课'];
    if (root && root.children) {
      root.children.forEach(function(c) {
        if (c.divider || !c.id) return;
        cats.push({ id: c.id, name: c.name, math: !!c.mathCard });
      });
    }
    sel.innerHTML = '<option value="">请选择课程类型…</option>';
    cats.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      opt.setAttribute('data-math', c.math ? '1' : '');
      sel.appendChild(opt);
    });
  }

  function onGeneralCategoryChange() {
    var sel = _ncEl('ncGeneralCategory');
    var hint = _ncEl('ncMathHint');
    if (!hint) return;
    var opt = sel.selectedOptions && sel.selectedOptions[0];
    hint.style.display = (opt && opt.getAttribute('data-math') === '1') ? '' : 'none';
  }

  // ── 专业课：学院搜索补全 ──
  function _populateColleges() {
    if (_ncColleges.length) return;
    api('/api/colleges/').then(function(list) {
      _ncColleges = Array.isArray(list) ? list : [];
    }).catch(function() { _ncColleges = []; });
  }

  function onCollegeFocus() {
    _populateColleges();
    _renderCollegeOptions();
  }

  function onCollegeSearchInput() {
    _renderCollegeOptions();
  }

  function _renderCollegeOptions() {
    var box = _ncEl('ncMCollegeOptions');
    if (!box) return;
    var q = (_ncEl('ncMCollegeSearch').value || '').trim();
    var matches = _ncColleges.filter(function(c) {
      return !q || (c.name || '').indexOf(q) !== -1 || (c.short_name || '').indexOf(q) !== -1;
    });
    box.style.display = matches.length ? '' : 'none';
    box.innerHTML = matches.map(function(c) {
      return '<div class="nc-combo-item" data-id="' + c.id + '" data-name="' + esc(c.name) + '" onclick="_selectCollege(this)">' +
        esc(c.name) + '<span class="nc-combo-item-sub">' + esc(c.short_name || '') + '</span></div>';
    }).join('');
  }

  function _selectCollege(item) {
    _ncState.college = {
      id: parseInt(item.getAttribute('data-id')),
      name: item.getAttribute('data-name'),
    };
    _ncEl('ncMCollegeSearch').value = _ncState.college.name;
    _ncEl('ncMCollegeOptions').style.display = 'none';
    _populateMajors();
  }

  // ── 专业课：专业下拉 ──
  function _populateMajors() {
    var majorSel = _ncEl('ncMMajor');
    var levelBtn = _ncEl('ncMLevelBtn');
    var colNode = _findCollegeNode();
    if (!colNode) {
      majorSel.innerHTML = '<option value="">该学院暂无课程目录</option>';
      levelBtn.disabled = true;
      _ncState.majorNode = null;
      return;
    }
    var majors = (colNode.children || []).filter(function(c) { return !c.divider; });
    majorSel.innerHTML = '<option value="">请选择专业…</option>' + majors.map(function(m) {
      return '<option value="' + m.id + '" data-id="' + m.id + '">' + esc(m.name) + '</option>';
    }).join('');
    levelBtn.disabled = true;
  }

  function _findCollegeNode() {
    if (!_ncState.college || !courseTree || !courseTree['专业课']) return null;
    var children = courseTree['专业课'].children || [];
    return children.find(function(c) {
      return (c.collegeId === _ncState.college.id) || (c.name === _ncState.college.name);
    }) || null;
  }

  function onMajorChange() {
    var majorSel = _ncEl('ncMMajor');
    var opt = majorSel.selectedOptions && majorSel.selectedOptions[0];
    var levelBtn = _ncEl('ncMLevelBtn');
    _ncState.targetCatId = null;
    _ncState.targetPath = '';
    _ncEl('ncMTargetPath').textContent = '';
    if (!opt || !opt.getAttribute('data-id')) {
      _ncState.majorNode = null;
      levelBtn.disabled = true;
      return;
    }
    var mid = parseInt(opt.getAttribute('data-id'));
    var colNode = _findCollegeNode();
    _ncState.majorNode = colNode && colNode.children
      ? (colNode.children.find(function(c) { return c.id === mid; }) || null)
      : null;
    levelBtn.disabled = !_ncState.majorNode;
  }

  // ── 专业课：层级选择弹窗（真实课程树）──
  function _openLevelPicker() {
    var major = _ncState.majorNode;
    if (!major) { alert('请先选择专业'); return; }
    var overlay = document.createElement('div');
    overlay.className = 'search-overlay lp-overlay';
    overlay.id = 'ncLevelPicker';
    overlay.innerHTML =
      '<div class="search-overlay-inner lp-inner">' +
        '<button class="search-overlay-close" onclick="_closeLevelPicker()">✕</button>' +
        '<div class="so-header"><div class="so-icon">🗂️</div>' +
          '<div class="so-title">选择课程层级</div>' +
          '<div class="so-sub">选择该课程所属的模块（必修/选修/实践环节…）</div>' +
        '</div>' +
        '<div class="lp-tree" id="ncLevelTree"></div>' +
        '<div class="lp-actions">' +
          '<button class="admin-btn admin-btn-secondary" onclick="_closeLevelPicker()">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    lockScroll();
    _renderLevelTree(_ncEl('ncLevelTree'), major.children || [], 0, null, []);
  }

  function _closeLevelPicker() {
    var ov = _ncEl('ncLevelPicker');
    if (ov) { ov.remove(); unlockScroll(); }
  }

  function _renderLevelTree(container, nodes, depth, parent, pathNames) {
    (nodes || []).forEach(function(n) {
      if (n.divider) return;
      var hasChildren = !!(n.children && n.children.length);
      var isLeafCourse = !!(n.courseId && n.courseId.indexOf('*') === -1);
      var row = document.createElement('div');
      row.className = 'lp-node' + (hasChildren ? ' lp-parent' : ' lp-leaf');
      row.style.paddingLeft = (14 + depth * 18) + 'px';
      var icon = hasChildren ? '▸' : (isLeafCourse ? '·' : '▪');
      row.innerHTML =
        '<span class="lp-node-icon">' + icon + '</span>' +
        '<span class="lp-node-name">' + esc(n.name) + '</span>' +
        (isLeafCourse ? '<span class="lp-node-code">' + esc(n.courseId) + '</span>' : '');
      var childPath = pathNames.concat([n.name || ('#' + n.id)]);
      if (hasChildren) {
        var childWrap = document.createElement('div');
        childWrap.className = 'lp-children';
        childWrap.style.display = 'none';
        row.appendChild(childWrap);
        row.querySelector('.lp-node-name').onclick = function(e) {
          e.stopPropagation();
          var open = childWrap.style.display !== 'none';
          childWrap.style.display = open ? 'none' : '';
          row.querySelector('.lp-node-icon').textContent = open ? '▸' : '▾';
        };
        _renderLevelTree(childWrap, n.children, depth + 1, n, childPath);
        row.classList.add('lp-selectable');
      } else {
        // 叶子课程节点：目标 = 其父节点
        row.classList.add('lp-selectable');
      }
      row.onclick = function() {
        // 选中该节点（叶子取其父）为目标
        var target = hasChildren ? n : parent;
        if (!target || !target.id) { alert('该位置不可选，请选择文件夹层级'); return; }
        _ncState.targetCatId = target.id;
        _ncState.targetPath = childPath.join(' / ');
        _ncEl('ncMLevelBtn').textContent = '已选层级';
        _ncEl('ncMTargetPath').textContent = _ncState.targetPath;
        _closeLevelPicker();
      };
      container.appendChild(row);
    });
  }

  // ── 专业课：新建学院/专业 分支 ──
  function onMajorModeChange() {
    var mode = _ncEl('ncMajorMode').value;
    _ncEl('ncMajorCoursePane').style.display = mode === 'course' ? '' : 'none';
    _ncEl('ncMajorCollegePane').style.display = mode === 'college' ? '' : 'none';
  }

  function submitToDeveloper() {
    var mail = 'mailto:bnusparks@163.com?subject=' + encodeURIComponent('课程树收录申请');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText('Rsun1949').then(function() {
        alert('已复制开发者微信 Rsun1949，即将打开邮件');
      }).catch(function() {});
    }
    window.location.href = mail;
  }

  // ── 上传模式切换（文件 / 文字录入）──
  function switchNewCourseUploadMode(mode, pane) {
    var prefix = pane === 'G' ? 'G' : 'M';
    var isFile = mode === 'file';
    _ncEl('nc' + prefix + 'ModeFile').style.display = isFile ? '' : 'none';
    _ncEl('nc' + prefix + 'ModeText').style.display = isFile ? 'none' : '';
    document.querySelectorAll('.upload-mode-tabs .um-tab[data-pane="' + prefix + '"]').forEach(function(b) {
      b.classList.toggle('um-tab-active', b.getAttribute('data-mode') === mode);
    });
  }

  // ── 提交 ──
  async function submitCourseRequest(type) {
    var isGeneral = type === 'general';
    var errEl = _ncEl(isGeneral ? 'ncGError' : 'ncMError');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    var name = (_ncEl(isGeneral ? 'ncGeneralName' : 'ncMName').value || '').trim();
    var code = (_ncEl(isGeneral ? 'ncGeneralCode' : 'ncMCode').value || '').trim();
    if (!name) return _ncFail(errEl, '请填写课程名称');
    if (!code) return _ncFail(errEl, '请填写课程代码（可在教务管理网站查询）');

    var body = {
      course_type: isGeneral ? 'general' : 'major',
      course_name: name,
      course_code: code,
    };
    if (isGeneral) {
      var gc = _ncEl('ncGeneralCategory');
      if (!gc.value) return _ncFail(errEl, '请选择课程类型');
      body.general_category_id = parseInt(gc.value);
    } else {
      if (!_ncState.college) return _ncFail(errEl, '请选择学院');
      if (!_ncState.majorNode) return _ncFail(errEl, '请选择专业');
      if (!_ncState.targetCatId) return _ncFail(errEl, '请点击选择具体层级');
      body.college_id = _ncState.college.id;
      body.target_category_id = _ncState.targetCatId;
    }

    var btn = event && event.target;
    if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
    try {
      var req = await api('/api/courses/request/', { method: 'POST', body: body });
      await _uploadAttached(isGeneral, req.id);
      alert('提交成功！新建课程申请已送审，通过后将创建课程文件夹。');
      showHome();
    } catch (err) {
      _ncFail(errEl, (err && (err.message || err.error)) || '提交失败，请稍后再试');
      if (btn) { btn.disabled = false; btn.textContent = '提交新建课程申请'; }
    }
  }

  function _ncFail(errEl, msg) {
    if (errEl) { errEl.style.display = ''; errEl.textContent = msg; }
    return false;
  }

  async function _uploadAttached(isGeneral, reqId) {
    var prefix = isGeneral ? 'G' : 'M';
    var files = _ncEl('nc' + prefix + 'File').files || [];
    var text = (_ncEl('nc' + prefix + 'Text').value || '').trim();
    var title = (_ncEl('nc' + prefix + 'Title').value || '').trim();
    var teacher = (_ncEl('nc' + prefix + 'Teacher').value || '').trim();
    var matType = _ncEl('nc' + prefix + 'MaterialType').value || '';
    var desc = (_ncEl('nc' + prefix + 'Desc').value || '').trim();

    var filesToSend = [];
    for (var i = 0; i < files.length; i++) filesToSend.push(files[i]);
    if (!filesToSend.length && text) {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      filesToSend.push(new File([blob], (title || '文字资料') + '.txt', { type: 'text/plain' }));
    }
    for (var j = 0; j < filesToSend.length; j++) {
      var f = filesToSend[j];
      var stem = (f.name || '资料').replace(/\.[^.]+$/, '');
      var fd = new FormData();
      fd.append('file', f);
      fd.append('title', filesToSend.length > 1 ? ((title || stem) + ' (' + (j + 1) + ')') : (title || stem));
      fd.append('teacher', teacher);
      fd.append('description', desc);
      if (matType) fd.append('material_type_id', matType);
      await api('/api/courses/request/' + reqId + '/files/', { method: 'POST', body: fd });
    }
  }

  // ── 资料类型下拉填充 ──
  function _populateMaterialTypeSelect(sel) {
    if (!sel || sel.options.length > 1) return;
    sel.innerHTML = '<option value="">请选择类型…</option>';
    (typeof MATERIAL_TYPES !== 'undefined' ? MATERIAL_TYPES : []).forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
  }
