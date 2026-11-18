/* ═══════════════════════════════════════════════════════════
   BNU Sparks · upload-workspace.js —— Plib 风格双栏独立上传工作区（/upload）
   ═══════════════════════════════════════════════════════════ */
(function () {
  var MAX_FILE_BYTES = 50 * 1024 * 1024;
  var SIZE_ERR_MSG = '文件大小超出限制，建议使用文件瘦身、压缩、拆分等方式处理后上传';
  var PLACEHOLDER_RE = /^BNUX[0-9A-F]{32}$/i;

  var _state = {
    rendered: false,
    mode: 'file',            // 'file' | 'text'
    collegeQuery: '',
    selectedCollege: '',     // '' = 全部; '通识课' = 通识/公共根; 其他为学院名
    courseQuery: '',
    selectedCourse: null,    // { code, codes, name, isPlaceholder, placements }
    selectedPlacement: null, // { categoryId, path, rootType, collegeName, branchPath, fullPath }
    files: [],               // File[]
    submitting: false,
    coursesIndex: [],
    coursesByCode: Object.create(null),
    collegesList: [],        // [{ name, short_name, isGeneral }]
    myCourses: [],           // [{ code, name, teachers, source, collegeName }]
    myCoursesLoadedFor: null,
    myNote: null,
    collegeHighlight: -1,
    courseHighlight: -1,
    lastUploadResult: null,
    locateOverlay: null,
    locateRootTab: '专业课',
    locateQuery: '',
    locateExpanded: Object.create(null),
  };

  function _el(id) {
    return document.getElementById(id);
  }

  function _isPlaceholder(code) {
    return PLACEHOLDER_RE.test(String(code || '').trim());
  }

  function _formatCodeBadge(code) {
    return _isPlaceholder(code) ? '代码待补充' : String(code || '');
  }

  function _norm(str) {
    return String(str || '').trim().toLowerCase().replace(/[\s*＊]/g, '');
  }

  function _formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function _generalLabel() {
    return typeof getGeneralRootLabel === 'function' ? getGeneralRootLabel() : '通识课';
  }

  function _displaySeg(name) {
    return typeof displayCategoryLabel === 'function' ? displayCategoryLabel(name) : name;
  }

  // 从当前有效 courseTree 扁平构建可选课程索引（同 code 多挂靠合并为 placements）
  function _rebuildCourseIndex() {
    var byCode = Object.create(null);
    var tree = typeof courseTree !== 'undefined' && courseTree ? courseTree : {};
    var genLabel = _generalLabel();

    function walk(nodes, path) {
      if (!Array.isArray(nodes)) return;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n || n.divider) continue;
        if (Array.isArray(n.children)) {
          walk(n.children, path.concat(n.name));
        } else if (n.courseId) {
          var code = String(n.courseId);
          var entry = byCode[code];
          if (!entry) {
            var allCodes = [code];
            if (Array.isArray(n.courseCodes)) {
              n.courseCodes.forEach(function (c) {
                if (c && allCodes.indexOf(c) === -1) allCodes.push(c);
              });
            }
            entry = {
              code: code,
              codes: allCodes,
              name: n.name || code,
              isPlaceholder: _isPlaceholder(code),
              placements: [],
            };
            byCode[code] = entry;
          }
          var rootType = path[0] || '专业课';
          var collegeName = rootType === '专业课' ? (path[1] || '') : '通识课';
          var branchSegs = path.slice(1).map(_displaySeg);
          var fullSegs = path.map(_displaySeg);
          var dup = entry.placements.some(function (p) { return p.categoryId === n.id; });
          if (!dup) {
            entry.placements.push({
              categoryId: n.id,
              path: path.concat(n.name),
              rootType: rootType,
              collegeName: collegeName,
              collegeDisplay: rootType === '专业课' ? (path[1] || '') : genLabel,
              branchPath: branchSegs.join(' › ') || _displaySeg(rootType),
              fullPath: fullSegs.join(' › '),
              fileCount: n.fileCount || 0,
            });
          }
        }
      }
    }

    ['通识课', '专业课'].forEach(function (rootKey) {
      if (tree[rootKey] && Array.isArray(tree[rootKey].children)) {
        walk(tree[rootKey].children, [rootKey]);
      }
    });

    // 本人专业/学院放置靠前，提升默认选中准确度
    var idMaj = currentUser && currentUser.identity_major;
    var idCol = currentUser && currentUser.identity_college;
    Object.keys(byCode).forEach(function (code) {
      var c = byCode[code];
      c.placements.sort(function (a, b) {
        var scoreA = _placementIdentityScore(a, idMaj, idCol);
        var scoreB = _placementIdentityScore(b, idMaj, idCol);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.fullPath.localeCompare(b.fullPath, 'zh-Hans-CN');
      });
    });

    _state.coursesByCode = byCode;
    _state.coursesIndex = Object.keys(byCode).map(function (k) { return byCode[k]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-Hans-CN'); });
  }

  function _placementIdentityScore(p, idMaj, idCol) {
    var score = 0;
    if (idMaj && p.path.indexOf(idMaj) >= 0) score += 10;
    if (idCol && p.collegeName === idCol) score += 4;
    return score;
  }

  function _buildCollegesList(apiColleges) {
    var genLabel = _generalLabel();
    var list = [{
      name: '通识课',
      displayName: genLabel,
      short_name: genLabel === '公共课' ? '通识 公共 研究生公共课' : '通识 公共',
      isGeneral: true,
    }];
    var seen = { '通识课': true };
    (Array.isArray(apiColleges) ? apiColleges : []).forEach(function (c) {
      if (!c || !c.name || seen[c.name]) return;
      seen[c.name] = true;
      list.push({
        name: c.name,
        displayName: c.name,
        short_name: c.short_name || '',
        isGeneral: false,
      });
    });
    // 兜底补齐树中存在但未在 /api/colleges/ 中的学院节点
    var tree = typeof courseTree !== 'undefined' && courseTree ? courseTree : {};
    var majorChildren = (tree['专业课'] && tree['专业课'].children) || [];
    majorChildren.forEach(function (node) {
      if (!node || !node.name || seen[node.name]) return;
      seen[node.name] = true;
      list.push({ name: node.name, displayName: node.name, short_name: '', isGeneral: false });
    });
    _state.collegesList = list;
  }

  function _renderSkeleton() {
    var view = _el('uploadView');
    if (!view || _state.rendered) return;
    view.innerHTML =
      '<nav class="page-navigation" aria-label="当前位置">' +
        '<div class="breadcrumb" id="uploadBreadcrumb"></div>' +
      '</nav>' +
      '<div class="up-page">' +
        '<div class="up-header">' +
          '<h1 class="up-title">上传课程资料</h1>' +
          '<p class="up-sub" id="upSubContext"></p>' +
        '</div>' +
        '<div class="up-mode-tabs" role="tablist" aria-label="上传方式">' +
          '<button type="button" class="up-mode-tab is-active" role="tab" aria-selected="true" data-up-mode="file">上传文件</button>' +
          '<button type="button" class="up-mode-tab" role="tab" aria-selected="false" data-up-mode="text">文字录入</button>' +
        '</div>' +
        '<div class="up-grid">' +
          '<form class="up-card" id="upForm" novalidate>' +
            '<div class="up-row-2">' +
              '<div class="up-field">' +
                '<label class="up-label" for="upCollegeInput">所属院系 <span class="up-opt">（可选）</span></label>' +
                '<div class="up-input-wrap" id="upCollegeWrap">' +
                  '<input type="text" id="upCollegeInput" class="up-input up-input-has-clear" role="combobox" aria-expanded="false" aria-controls="upCollegeList" autocomplete="off" placeholder="输入院系名称或公共课搜索">' +
                  '<button type="button" id="upCollegeClear" class="up-clear-btn" aria-label="清空院系筛选" style="display:none">×</button>' +
                  '<div class="up-combo-list" id="upCollegeList" role="listbox" style="display:none"></div>' +
                '</div>' +
              '</div>' +
              '<div class="up-field">' +
                '<label class="up-label" for="upCourseInput">课程名称 <span class="up-req">*</span></label>' +
                '<div class="up-input-wrap" id="upCourseWrap">' +
                  '<input type="text" id="upCourseInput" class="up-input up-input-has-clear" role="combobox" aria-expanded="false" aria-controls="upCourseList" autocomplete="off" placeholder="输入课程名称或代码搜索">' +
                  '<button type="button" id="upCourseClear" class="up-clear-btn" aria-label="清空已选课程" style="display:none">×</button>' +
                  '<div class="up-combo-list" id="upCourseList" role="listbox" style="display:none"></div>' +
                '</div>' +
                '<p class="up-field-hint" id="upCourseIdleHint">先搜课程也行，院系会自动填上</p>' +
              '</div>' +
            '</div>' +
            '<div class="up-locate-row-idle" id="upLocateIdleRow">' +
              '<span>不确定课程在哪个专业目录下？</span>' +
              '<button type="button" class="up-locate-btn" id="upLocateIdleBtn">' + iconSvg('folder') + ' 从课程树精准定位</button>' +
            '</div>' +
            '<div class="up-course-meta-bar" id="upCourseMetaBar" style="display:none">' +
              '<div class="up-course-meta-body">' +
                '<div class="up-course-selected-line" id="upCourseSelectedLine"></div>' +
                '<div class="up-majors-line" id="upMajorsLine"></div>' +
              '</div>' +
              '<button type="button" class="up-locate-btn" id="upLocateBtn">' + iconSvg('folder') + ' 精准定位</button>' +
            '</div>' +
            '<div class="up-field">' +
              '<label class="up-label" for="upTitle">资料标题 <span class="up-opt">（可选）</span></label>' +
              '<input type="text" id="upTitle" class="up-input" placeholder="留空则自动使用文件名">' +
            '</div>' +
            '<div class="up-row-2">' +
              '<div class="up-field">' +
                '<label class="up-label" for="upMaterialType">资料类型 <span class="up-req">*</span></label>' +
                '<select id="upMaterialType" class="up-select" required>' +
                  '<option value="">选择资料类型…</option>' +
                '</select>' +
              '</div>' +
              '<div class="up-field">' +
                '<label class="up-label" for="upTeacher">任课教师 <span class="up-req">*</span></label>' +
                '<input type="text" id="upTeacher" class="up-input" required placeholder="如：张老师">' +
              '</div>' +
            '</div>' +
            '<div class="up-field" id="upModeFile">' +
              '<label class="up-label" for="upFileInput">选择文件 <span class="up-req">*</span></label>' +
              '<div class="up-dropzone" id="upDropzone">' +
                '<button type="button" class="up-file-trigger" id="upFileTrigger">选择文件</button>' +
                '<span class="up-file-summary" id="upFileSummary">未选择文件（可点击或拖拽到此处）</span>' +
                '<input type="file" id="upFileInput" multiple style="display:none">' +
              '</div>' +
              '<ul class="up-file-list" id="upFileList" style="display:none"></ul>' +
              '<p class="up-field-hint">支持 pdf、doc(x)、ppt(x)、xls(x)、zip、txt、md、png、jpg 等常见格式，支持多选，单个文件不超过 50MB。</p>' +
            '</div>' +
            '<div class="up-field" id="upModeText" style="display:none">' +
              '<label class="up-label" for="upTextContent">文字内容 <span class="up-req">*</span></label>' +
              '<textarea id="upTextContent" class="up-textarea" placeholder="在此粘贴或输入文字内容…考试题目、笔记、知识点整理等"></textarea>' +
              '<p class="up-field-hint">录入的文字将保存为 .txt 文件，若字数较多建议生成文档后上传。</p>' +
            '</div>' +
            '<details class="up-extra" id="upExtraDetails">' +
              '<summary>补充信息（可选）</summary>' +
              '<div class="up-extra-body">' +
                '<div class="up-field" id="upTeachingCodeGroup" style="display:none">' +
                  '<label class="up-label" for="upTeachingCode">教务课程代码 <span class="up-opt">（选填，代码待补充课程可顺手补全）</span></label>' +
                  '<input type="text" id="upTeachingCode" class="up-input" placeholder="如：ECO20201（留空也可正常上传）">' +
                '</div>' +
                '<div class="up-field" style="margin-bottom:0">' +
                  '<label class="up-label" for="upDesc">资料描述 <span class="up-opt">（选填）</span></label>' +
                  '<textarea id="upDesc" class="up-textarea up-textarea-sm" placeholder="简述适用学期、版本、试卷回忆完整度等…"></textarea>' +
                '</div>' +
              '</div>' +
            '</details>' +
            '<div class="up-error" id="upError" role="alert" style="display:none"></div>' +
            '<div class="mf-progress" id="upProgress" role="status" aria-live="polite" style="display:none;margin-bottom:12px">' +
              '<div class="mf-progress-bar"><div class="mf-progress-fill" id="upProgressFill"></div></div>' +
              '<span id="upProgressText">上传中...</span>' +
            '</div>' +
            '<div class="up-success-box" id="upSuccessBox" style="display:none"></div>' +
            '<div class="up-actions">' +
              '<button type="button" class="up-btn-ghost" id="upCancelBtn">取消</button>' +
              '<button type="submit" class="up-btn-primary" id="upSubmitBtn">确认上传</button>' +
            '</div>' +
          '</form>' +
          '<aside class="up-side-card" aria-label="我的课程">' +
            '<h2 class="up-side-title">我的课程</h2>' +
            '<p class="up-side-desc">点击已导入课表或收藏的课程，可一键填入左侧所属院系与课程名称。</p>' +
            '<div class="up-my-list" id="upMyList"></div>' +
            '<div class="up-my-note" id="upMyNote" style="display:none"></div>' +
          '</aside>' +
        '</div>' +
      '</div>';

    _bindEvents();
    _state.rendered = true;
  }

  function _bindEvents() {
    // 模式切换
    document.querySelectorAll('.up-mode-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        _setUploadMode(tab.getAttribute('data-up-mode') || 'file');
      });
    });

    // 所属院系 combobox
    var colInput = _el('upCollegeInput');
    var colClear = _el('upCollegeClear');
    colInput.addEventListener('focus', function () {
      _renderCollegeList();
    });
    colInput.addEventListener('input', function () {
      _state.collegeQuery = colInput.value;
      if (!colInput.value.trim() && _state.selectedCollege) {
        _state.selectedCollege = '';
      }
      _updateClearButtons();
      _renderCollegeList();
    });
    colInput.addEventListener('keydown', function (e) {
      _handleComboKeydown(e, 'upCollegeList', 'college');
    });
    colClear.addEventListener('click', function () {
      _selectCollege('');
      colInput.focus();
    });

    // 课程名称 combobox
    var crsInput = _el('upCourseInput');
    var crsClear = _el('upCourseClear');
    crsInput.addEventListener('focus', function () {
      _renderCourseList();
    });
    crsInput.addEventListener('input', function () {
      _state.courseQuery = crsInput.value;
      if (_state.selectedCourse && crsInput.value.trim() !== _state.selectedCourse.name) {
        _state.selectedCourse = null;
        _state.selectedPlacement = null;
        _renderSelectedCourseBar();
      }
      _updateClearButtons();
      _renderCourseList();
    });
    crsInput.addEventListener('keydown', function (e) {
      _handleComboKeydown(e, 'upCourseList', 'course');
    });
    crsClear.addEventListener('click', function () {
      _clearCourseSelection();
      crsInput.focus();
    });

    // 点击空白关闭下拉
    document.addEventListener('click', function (e) {
      var colWrap = _el('upCollegeWrap');
      if (colWrap && !colWrap.contains(e.target)) _closeCombo('upCollegeList', 'upCollegeInput');
      var crsWrap = _el('upCourseWrap');
      if (crsWrap && !crsWrap.contains(e.target)) _closeCombo('upCourseList', 'upCourseInput');
    });

    // 精准定位入口
    _el('upLocateIdleBtn').addEventListener('click', _openLocateOverlay);
    _el('upLocateBtn').addEventListener('click', _openLocateOverlay);

    // 资料类型课件提示
    _el('upMaterialType').addEventListener('change', function () {
      if (typeof warnIfCoursewareType === 'function') warnIfCoursewareType(this);
    });

    // 文件拖拽 & 选择
    var fileInput = _el('upFileInput');
    var dropzone = _el('upDropzone');
    _el('upFileTrigger').addEventListener('click', function (e) {
      e.stopPropagation();
      fileInput.click();
    });
    dropzone.addEventListener('click', function () {
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      _addFiles(fileInput.files);
      fileInput.value = '';
    });
    dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave', function () {
      dropzone.classList.remove('is-dragover');
    });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      if (e.dataTransfer && e.dataTransfer.files) _addFiles(e.dataTransfer.files);
    });

    // 提交与取消
    _el('upForm').addEventListener('submit', _handleSubmit);
    _el('upCancelBtn').addEventListener('click', function () {
      if (history.length > 1) history.back();
      else if (typeof showHome === 'function') showHome();
    });
  }

  function _populateMaterialTypes() {
    var sel = _el('upMaterialType');
    if (!sel || sel.options.length > 1) return;
    var types = typeof MATERIAL_TYPES !== 'undefined' && Array.isArray(MATERIAL_TYPES) ? MATERIAL_TYPES : [];
    types.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
  }

  function _setUploadMode(mode) {
    _state.mode = mode === 'text' ? 'text' : 'file';
    document.querySelectorAll('.up-mode-tab').forEach(function (t) {
      var active = t.getAttribute('data-up-mode') === _state.mode;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    _el('upModeFile').style.display = _state.mode === 'file' ? '' : 'none';
    _el('upModeText').style.display = _state.mode === 'text' ? '' : 'none';
    var titleInput = _el('upTitle');
    if (titleInput) {
      titleInput.placeholder = _state.mode === 'text' ? '留空则自动取内容前20字' : '留空则自动使用文件名';
    }
    _hideError();
  }

  function _updateClearButtons() {
    var colInput = _el('upCollegeInput');
    var colClear = _el('upCollegeClear');
    if (colClear && colInput) {
      colClear.style.display = (colInput.value || _state.selectedCollege) ? '' : 'none';
    }
    var crsInput = _el('upCourseInput');
    var crsClear = _el('upCourseClear');
    if (crsClear && crsInput) {
      crsClear.style.display = (crsInput.value || _state.selectedCourse) ? '' : 'none';
    }
  }

  function _closeCombo(listId, inputId) {
    var box = _el(listId);
    var inp = _el(inputId);
    if (box) box.style.display = 'none';
    if (inp) inp.setAttribute('aria-expanded', 'false');
  }

  function _handleComboKeydown(e, listId, kind) {
    var box = _el(listId);
    if (!box || box.style.display === 'none') {
      if (e.key === 'ArrowDown') {
        if (kind === 'college') _renderCollegeList();
        else _renderCourseList();
      }
      return;
    }
    var items = Array.prototype.slice.call(box.querySelectorAll('.up-combo-item'));
    if (!items.length) {
      if (e.key === 'Escape') _closeCombo(listId, kind === 'college' ? 'upCollegeInput' : 'upCourseInput');
      return;
    }
    var cur = kind === 'college' ? _state.collegeHighlight : _state.courseHighlight;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cur = (cur + 1) % items.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cur = cur <= 0 ? items.length - 1 : cur - 1;
    } else if (e.key === 'Enter' && cur >= 0 && items[cur]) {
      e.preventDefault();
      items[cur].click();
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _closeCombo(listId, kind === 'college' ? 'upCollegeInput' : 'upCourseInput');
      return;
    } else {
      return;
    }
    if (kind === 'college') _state.collegeHighlight = cur;
    else _state.courseHighlight = cur;
    items.forEach(function (el, idx) {
      el.classList.toggle('is-active', idx === cur);
      if (idx === cur) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function _renderCollegeList() {
    var box = _el('upCollegeList');
    var inp = _el('upCollegeInput');
    if (!box || !inp) return;
    var q = _norm(inp.value);
    var matches = _state.collegesList.filter(function (c) {
      if (!q) return true;
      return _norm(c.name).indexOf(q) >= 0
        || _norm(c.displayName).indexOf(q) >= 0
        || _norm(c.short_name).indexOf(q) >= 0;
    });
    _state.collegeHighlight = -1;
    if (!matches.length) {
      box.innerHTML = '<div class="up-combo-empty">没有匹配的院系，可直接搜索课程名称</div>';
    } else {
      box.innerHTML = matches.map(function (c) {
        return '<button type="button" class="up-combo-item" role="option" data-college="' + esc(c.name) + '">' +
          '<span class="up-combo-main">' +
            '<span class="up-combo-name">' + esc(c.displayName) + '</span>' +
            (c.isGeneral ? '<span class="up-combo-meta">包含全校公共/通识课程</span>' : (c.short_name ? '<span class="up-combo-meta">' + esc(c.short_name) + '</span>' : '')) +
          '</span>' +
        '</button>';
      }).join('');
      box.querySelectorAll('[data-college]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          _selectCollege(btn.getAttribute('data-college'));
        });
      });
    }
    box.style.display = '';
    inp.setAttribute('aria-expanded', 'true');
  }

  function _selectCollege(collegeName) {
    _state.selectedCollege = collegeName || '';
    var colInp = _el('upCollegeInput');
    if (colInp) {
      var found = _state.collegesList.find(function (c) { return c.name === _state.selectedCollege; });
      colInp.value = found ? found.displayName : _state.selectedCollege;
    }
    _state.collegeQuery = colInp ? colInp.value : '';
    _closeCombo('upCollegeList', 'upCollegeInput');

    // 若当前已选课程不属于切换后的院系，清空已选课程并提示重新选择
    if (_state.selectedCourse && _state.selectedCollege) {
      var matchPlacement = _state.selectedCourse.placements.find(function (p) {
        return p.collegeName === _state.selectedCollege;
      });
      if (matchPlacement) {
        _state.selectedPlacement = matchPlacement;
        _renderSelectedCourseBar();
      } else {
        _clearCourseSelection();
      }
    }
    _updateClearButtons();
  }

  function _matchingCourses() {
    var q = _norm(_el('upCourseInput') ? _el('upCourseInput').value : _state.courseQuery);
    var col = _state.selectedCollege;
    var results = [];
    for (var i = 0; i < _state.coursesIndex.length; i++) {
      var c = _state.coursesIndex[i];
      var scopedPlacements = col
        ? c.placements.filter(function (p) { return p.collegeName === col; })
        : c.placements;
      if (col && !scopedPlacements.length) continue;

      if (!q) {
        results.push({ course: c, placement: scopedPlacements[0], score: 1 });
        continue;
      }

      var nName = _norm(c.name);
      var codeMatch = c.codes.some(function (cd) { return !_isPlaceholder(cd) && _norm(cd).indexOf(q) >= 0; });
      var pathMatch = scopedPlacements.some(function (p) { return _norm(p.fullPath).indexOf(q) >= 0; });
      var nameIdx = nName.indexOf(q);
      if (nameIdx === -1 && !codeMatch && !pathMatch) continue;

      var score = 0;
      if (nName === q) score += 100;
      else if (nameIdx === 0) score += 60;
      else if (nameIdx > 0) score += 30;
      if (codeMatch) score += 45;
      if (pathMatch) score += 10;
      results.push({ course: c, placement: scopedPlacements[0], score: score });
    }
    results.sort(function (a, b) {
      if (a.score !== b.score) return b.score - a.score;
      return a.course.name.localeCompare(b.course.name, 'zh-Hans-CN');
    });
    return results.slice(0, 40);
  }

  function _renderCourseList() {
    var box = _el('upCourseList');
    var inp = _el('upCourseInput');
    if (!box || !inp) return;
    var list = _matchingCourses();
    _state.courseHighlight = -1;

    var html = '';
    if (!list.length) {
      html += '<div class="up-combo-empty">' +
        (_state.selectedCollege
          ? '该院系下暂无匹配课程，可清空院系筛选或申请新建课程'
          : '未在当前可见课程目录中找到匹配课程') +
      '</div>';
    } else {
      html += list.map(function (item) {
        var c = item.course;
        var p = item.placement;
        var codeText = _formatCodeBadge(c.code);
        var codeCls = c.isPlaceholder ? 'up-combo-code is-placeholder' : 'up-combo-code';
        return '<button type="button" class="up-combo-item" role="option" data-course-code="' + esc(c.code) + '" data-cat-id="' + esc(String(p.categoryId || '')) + '">' +
          '<span class="up-combo-main">' +
            '<span class="up-combo-name">' + esc(c.name) + '</span>' +
            '<span class="up-combo-meta">' + esc(p.branchPath) + '</span>' +
          '</span>' +
          '<span class="' + codeCls + '">' + esc(codeText) + '</span>' +
        '</button>';
      }).join('');
    }
    html += '<div class="up-combo-foot">' +
      '<span>没找到想要上传的课程？</span>' +
      '<button type="button" class="up-link-btn" id="upNewCourseLink">去新建课程</button>' +
    '</div>';

    box.innerHTML = html;
    box.querySelectorAll('[data-course-code]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var code = btn.getAttribute('data-course-code');
        var catId = parseInt(btn.getAttribute('data-cat-id'), 10) || null;
        _selectCourseByCode(code, catId, { autoFillCollege: true });
        _closeCombo('upCourseList', 'upCourseInput');
      });
    });
    var newLink = box.querySelector('#upNewCourseLink');
    if (newLink) {
      newLink.addEventListener('click', function () {
        _jumpToNewCourse({
          courseName: (_el('upCourseInput') ? _el('upCourseInput').value.trim() : ''),
          collegeName: _state.selectedCollege,
        });
      });
    }

    box.style.display = '';
    inp.setAttribute('aria-expanded', 'true');
  }

  function _selectCourseByCode(code, catId, opts) {
    var course = _state.coursesByCode[code];
    if (!course) return;
    var placement = null;
    if (catId) {
      placement = course.placements.find(function (p) { return p.categoryId === catId; });
    }
    if (!placement && _state.selectedCollege) {
      placement = course.placements.find(function (p) { return p.collegeName === _state.selectedCollege; });
    }
    if (!placement) placement = course.placements[0];

    _state.selectedCourse = course;
    _state.selectedPlacement = placement;

    var crsInp = _el('upCourseInput');
    if (crsInp) {
      crsInp.value = course.name;
      _state.courseQuery = course.name;
    }

    if (opts && opts.autoFillCollege && placement && placement.collegeName) {
      var shouldFillCollege = opts.forceCollege || !_state.selectedCollege;
      if (shouldFillCollege) {
        _state.selectedCollege = placement.collegeName;
        var colInp = _el('upCollegeInput');
        if (colInp) {
          var matched = _state.collegesList.find(function (c) { return c.name === placement.collegeName; });
          colInp.value = matched ? matched.displayName : placement.collegeName;
        }
      }
    }

    _syncTeachingCodeVisibility();
    _renderSelectedCourseBar();
    _syncMyListHighlight();
    _updateClearButtons();
    _hideError();
  }

  function _clearCourseSelection() {
    _state.selectedCourse = null;
    _state.selectedPlacement = null;
    _state.courseQuery = '';
    var crsInp = _el('upCourseInput');
    if (crsInp) crsInp.value = '';
    _syncTeachingCodeVisibility();
    _renderSelectedCourseBar();
    _syncMyListHighlight();
    _updateClearButtons();
  }

  function _syncTeachingCodeVisibility() {
    var grp = _el('upTeachingCodeGroup');
    var tcInp = _el('upTeachingCode');
    var details = _el('upExtraDetails');
    if (!grp || !tcInp) return;
    var show = !!(_state.selectedCourse && _state.selectedCourse.isPlaceholder);
    grp.style.display = show ? '' : 'none';
    if (!show) {
      tcInp.value = '';
    } else if (details) {
      details.open = true;
    }
  }

  function _renderSelectedCourseBar() {
    var bar = _el('upCourseMetaBar');
    var idleRow = _el('upLocateIdleRow');
    var idleHint = _el('upCourseIdleHint');
    if (!bar) return;

    if (!_state.selectedCourse) {
      bar.style.display = 'none';
      if (idleRow) idleRow.style.display = '';
      if (idleHint) idleHint.style.display = '';
      return;
    }

    bar.style.display = '';
    if (idleRow) idleRow.style.display = 'none';
    if (idleHint) idleHint.style.display = 'none';

    var c = _state.selectedCourse;
    var p = _state.selectedPlacement || c.placements[0];
    var codeStr = _formatCodeBadge(c.code);
    var codeCls = c.isPlaceholder ? 'up-combo-code is-placeholder' : 'up-combo-code';

    _el('upCourseSelectedLine').innerHTML =
      '<span>已选：' + esc(c.name) + '</span>' +
      '<span class="' + codeCls + '">' + esc(codeStr) + '</span>';

    // 展示「包含此课程的专业」，多个挂靠时支持点击切换归属位置
    var majorsEl = _el('upMajorsLine');
    var chips = c.placements.map(function (pl) {
      var isCurrent = p && pl.categoryId === p.categoryId;
      return '<button type="button" class="up-major-chip' + (isCurrent ? ' is-current' : '') + '" data-pick-cat="' + esc(String(pl.categoryId)) + '">' +
        esc(pl.branchPath) +
      '</button>';
    }).join('');
    majorsEl.innerHTML = '<span>包含此课程的专业：</span>' + chips;
    majorsEl.querySelectorAll('[data-pick-cat]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cid = parseInt(btn.getAttribute('data-pick-cat'), 10);
        var next = c.placements.find(function (pl) { return pl.categoryId === cid; });
        if (!next) return;
        _state.selectedPlacement = next;
        _selectCourseByCode(c.code, cid, { autoFillCollege: true, forceCollege: true });
      });
    });
  }

  // ── 课程树「精准定位」弹窗 ──
  function _openLocateOverlay() {
    _closeLocateOverlay();
    _state.locateQuery = '';
    _state.locateExpanded = Object.create(null);

    if (_state.selectedPlacement) {
      _state.locateRootTab = _state.selectedPlacement.rootType === '通识课' ? '通识课' : '专业课';
      _expandPath(_state.selectedPlacement.path);
    } else if (_state.selectedCollege) {
      if (_state.selectedCollege === '通识课') {
        _state.locateRootTab = '通识课';
      } else {
        _state.locateRootTab = '专业课';
        _state.locateExpanded['专业课/' + _state.selectedCollege] = true;
      }
    } else {
      _state.locateRootTab = '专业课';
    }
    if (_state.selectedCourse) {
      _state.selectedCourse.placements.forEach(function (pl) {
        _expandPath(pl.path);
      });
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'upTreeLocateOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'upLocateTitle');
    overlay.style.display = 'flex';
    overlay.innerHTML =
      '<div class="modal-dialog up-tree-dialog">' +
        '<div class="modal-header">' +
          '<h2 class="modal-title" id="upLocateTitle">在课程树中精准定位</h2>' +
          '<button type="button" class="modal-close" id="upLocateCloseBtn" aria-label="关闭定位弹窗">✕</button>' +
        '</div>' +
        '<p class="up-field-hint" style="margin-top:0">选择课程所在的确切目录叶子，确保资料进入对应培养层次与专业审核队列。</p>' +
        '<div class="up-tree-tabs" role="tablist">' +
          '<button type="button" class="up-tree-tab' + (_state.locateRootTab === '专业课' ? ' is-active' : '') + '" data-tree-tab="专业课">专业课</button>' +
          '<button type="button" class="up-tree-tab' + (_state.locateRootTab === '通识课' ? ' is-active' : '') + '" data-tree-tab="通识课">' + esc(_generalLabel()) + '</button>' +
        '</div>' +
        '<input type="search" id="upLocateSearchInput" class="up-input" placeholder="在当前目录下筛选学院、专业或课程名…">' +
        '<div class="up-tree-box" id="upLocateTreeBox"></div>' +
        '<div class="lp-actions" style="margin-top:12px">' +
          '<button type="button" class="up-btn-ghost" id="upLocateCancelBtn">关闭</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    _state.locateOverlay = overlay;
    if (typeof lockScroll === 'function') lockScroll();

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _closeLocateOverlay();
    });
    overlay.querySelector('#upLocateCloseBtn').addEventListener('click', _closeLocateOverlay);
    overlay.querySelector('#upLocateCancelBtn').addEventListener('click', _closeLocateOverlay);
    overlay.querySelectorAll('[data-tree-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _state.locateRootTab = btn.getAttribute('data-tree-tab');
        overlay.querySelectorAll('[data-tree-tab]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        _renderLocateTree();
      });
    });
    overlay.querySelector('#upLocateSearchInput').addEventListener('input', function () {
      _state.locateQuery = this.value;
      _renderLocateTree();
    });

    overlay._escHandler = function (e) {
      if (e.key === 'Escape') _closeLocateOverlay();
    };
    document.addEventListener('keydown', overlay._escHandler);

    _renderLocateTree();
    if (typeof activateDialog === 'function') activateDialog(overlay);
  }

  function _expandPath(segs) {
    if (!Array.isArray(segs)) return;
    for (var i = 1; i < segs.length; i++) {
      _state.locateExpanded[segs.slice(0, i + 1).join('/')] = true;
    }
  }

  function _closeLocateOverlay() {
    var overlay = _state.locateOverlay;
    if (!overlay) return;
    if (overlay._escHandler) document.removeEventListener('keydown', overlay._escHandler);
    if (typeof deactivateDialog === 'function') deactivateDialog(overlay);
    overlay.remove();
    _state.locateOverlay = null;
    if (typeof unlockScroll === 'function') unlockScroll();
  }

  function _subtreeMatchesQuery(node, q) {
    if (!q) return true;
    if (!node || node.divider) return false;
    if (_norm(node.name).indexOf(q) >= 0) return true;
    if (node.courseId && !_isPlaceholder(node.courseId) && _norm(node.courseId).indexOf(q) >= 0) return true;
    if (Array.isArray(node.children)) {
      return node.children.some(function (child) { return _subtreeMatchesQuery(child, q); });
    }
    return false;
  }

  function _renderLocateTree() {
    var box = _el('upLocateTreeBox');
    if (!box) return;
    var tree = typeof courseTree !== 'undefined' && courseTree ? courseTree : {};
    var rootNode = tree[_state.locateRootTab];
    var q = _norm(_state.locateQuery);
    var selectedCode = _state.selectedCourse ? _state.selectedCourse.code : '';
    var selectedCatId = _state.selectedPlacement ? _state.selectedPlacement.categoryId : null;

    if (!rootNode || !Array.isArray(rootNode.children) || !rootNode.children.length) {
      box.innerHTML = '<div class="up-combo-empty">当前目录树暂无节点</div>';
      return;
    }

    function renderNodes(nodes, parentSegs) {
      var out = '';
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n || n.divider) continue;
        if (q && !_subtreeMatchesQuery(n, q)) continue;
        var segs = parentSegs.concat(n.name);
        var key = segs.join('/');
        if (Array.isArray(n.children)) {
          var isOpen = !!q || !!_state.locateExpanded[key];
          out += '<div class="up-tree-group">' +
            '<div class="up-tree-node is-folder" role="button" tabindex="0" data-folder-key="' + esc(key) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
              '<span class="up-tree-caret">' + (isOpen ? '▾' : '▸') + '</span>' +
              '<span>' + esc(_displaySeg(n.name)) + '</span>' +
            '</div>' +
            (isOpen ? '<div class="up-tree-children">' + renderNodes(n.children, segs) + '</div>' : '') +
          '</div>';
        } else if (n.courseId) {
          var isCurrentLeaf = (selectedCatId && n.id === selectedCatId) || (!selectedCatId && n.courseId === selectedCode);
          var isSameCourse = !!selectedCode && n.courseId === selectedCode;
          var cls = 'up-tree-node is-leaf' + (isCurrentLeaf ? ' is-current-leaf' : (isSameCourse ? ' is-match-highlight' : ''));
          var codeText = _formatCodeBadge(n.courseId);
          out += '<div class="' + cls + '" role="button" tabindex="0" data-leaf-code="' + esc(n.courseId) + '" data-leaf-cat="' + esc(String(n.id || '')) + '">' +
            '<span>' + esc(n.name) + '</span>' +
            '<span class="up-combo-code' + (_isPlaceholder(n.courseId) ? ' is-placeholder' : '') + '">' + esc(codeText) + '</span>' +
          '</div>';
        }
      }
      return out;
    }

    var rendered = renderNodes(rootNode.children, [_state.locateRootTab]);
    box.innerHTML = rendered || '<div class="up-combo-empty">没有符合关键词的课程</div>';

    box.querySelectorAll('[data-folder-key]').forEach(function (el) {
      var toggle = function () {
        var k = el.getAttribute('data-folder-key');
        _state.locateExpanded[k] = !_state.locateExpanded[k];
        _renderLocateTree();
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });

    box.querySelectorAll('[data-leaf-code]').forEach(function (el) {
      var pick = function () {
        var code = el.getAttribute('data-leaf-code');
        var catId = parseInt(el.getAttribute('data-leaf-cat'), 10) || null;
        _closeLocateOverlay();
        _selectCourseByCode(code, catId, { autoFillCollege: true, forceCollege: true });
      };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
    });
  }

  // ── 右侧：我的课程（课表 + 收藏） ──
  function _loadMyCourses() {
    var uid = currentUser && currentUser.id;
    var listEl = _el('upMyList');
    if (!uid || !listEl) return;
    if (_state.myCoursesLoadedFor === uid) {
      _renderMyCourses();
      return;
    }
    listEl.innerHTML = '<div class="up-field-hint">正在加载你的课表与收藏课程…</div>';
    Promise.all([
      api('/api/user/timetable/').catch(function () { return null; }),
      api('/api/user/course-favorites/').catch(function () { return null; }),
    ]).then(function (results) {
      if (!currentUser || currentUser.id !== uid) return;
      var tt = results[0];
      var fav = results[1];
      var merged = [];
      var seenKey = Object.create(null);

      var ttCourses = tt && tt.data && Array.isArray(tt.data.courses) ? tt.data.courses : [];
      ttCourses.forEach(function (c) {
        if (!c || !c.name) return;
        var key = (c.code && !_isPlaceholder(c.code)) ? ('code:' + _norm(c.code)) : ('name:' + _norm(c.name));
        if (seenKey[key]) return;
        seenKey[key] = true;
        merged.push({
          code: c.code || '',
          name: c.name,
          teachers: Array.isArray(c.teachers) ? c.teachers.join('、') : (c.teacher || c.teachers || ''),
          collegeName: c.college_name || '',
          source: '课表',
        });
      });

      var favItems = fav && Array.isArray(fav.items) ? fav.items : [];
      favItems.forEach(function (item) {
        if (!item || !item.course_name) return;
        var key = item.course_code ? ('code:' + _norm(item.course_code)) : ('name:' + _norm(item.course_name));
        if (seenKey[key]) return;
        seenKey[key] = true;
        merged.push({
          code: item.course_code || '',
          name: item.course_name,
          teachers: '',
          collegeName: item.college_name || '',
          source: '收藏',
        });
      });

      _state.myCourses = merged;
      _state.myCoursesLoadedFor = uid;
      _renderMyCourses();
    });
  }

  function _findTreeCourseForPersonal(item) {
    if (item.code && _state.coursesByCode[item.code]) {
      return _state.coursesByCode[item.code];
    }
    var nCode = _norm(item.code);
    if (nCode && !_isPlaceholder(item.code)) {
      for (var i = 0; i < _state.coursesIndex.length; i++) {
        var c = _state.coursesIndex[i];
        if (c.codes.some(function (cd) { return _norm(cd) === nCode; })) return c;
      }
    }
    var nName = _norm(item.name);
    if (nName) {
      for (var j = 0; j < _state.coursesIndex.length; j++) {
        if (_norm(_state.coursesIndex[j].name) === nName) return _state.coursesIndex[j];
      }
    }
    return null;
  }

  function _renderMyCourses() {
    var listEl = _el('upMyList');
    var noteEl = _el('upMyNote');
    if (!listEl) return;
    if (noteEl && !_state.myNote) noteEl.style.display = 'none';

    if (!_state.myCourses.length) {
      listEl.innerHTML =
        '<div class="up-my-note" style="margin-top:0">' +
          '暂未找到课表或收藏课程。导入课表或收藏常看课程后，这里可以一键填入。<br>' +
          '<button type="button" class="up-link-btn" id="upGoTimetableBtn">去课表导入</button>' +
        '</div>';
      var goBtn = listEl.querySelector('#upGoTimetableBtn');
      if (goBtn) {
        goBtn.addEventListener('click', function () {
          if (typeof ttNavTimetable === 'function') ttNavTimetable();
        });
      }
      return;
    }

    listEl.innerHTML = _state.myCourses.map(function (item, idx) {
      var codeDisp = item.code && !_isPlaceholder(item.code) ? item.code : '';
      var subParts = [];
      if (codeDisp) subParts.push(codeDisp);
      if (item.teachers) subParts.push(item.teachers);
      if (!subParts.length && item.collegeName) subParts.push(item.collegeName);
      return '<button type="button" class="up-my-item" data-my-idx="' + idx + '">' +
        '<span class="up-my-top">' +
          '<span class="up-my-name">' + esc(item.name) + '</span>' +
          '<span class="up-my-badge">' + esc(item.source) + '</span>' +
        '</span>' +
        (subParts.length ? '<span class="up-my-sub">' + esc(subParts.join(' · ')) + '</span>' : '') +
      '</button>';
    }).join('');

    listEl.querySelectorAll('[data-my-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-my-idx'), 10);
        var item = _state.myCourses[idx];
        if (!item) return;
        var found = _findTreeCourseForPersonal(item);
        if (!found) {
          _showMyNote(item);
          return;
        }
        _hideMyNote();
        _selectCourseByCode(found.code, found.placements[0] && found.placements[0].categoryId, {
          autoFillCollege: true,
          forceCollege: true,
        });
        var teacherInp = _el('upTeacher');
        if (teacherInp && item.teachers && !teacherInp.value.trim()) {
          teacherInp.value = item.teachers;
        }
      });
    });
    _syncMyListHighlight();
  }

  function _syncMyListHighlight() {
    var listEl = _el('upMyList');
    if (!listEl) return;
    var curCode = _state.selectedCourse ? _state.selectedCourse.code : '';
    var curName = _state.selectedCourse ? _norm(_state.selectedCourse.name) : '';
    listEl.querySelectorAll('[data-my-idx]').forEach(function (btn) {
      var idx = parseInt(btn.getAttribute('data-my-idx'), 10);
      var item = _state.myCourses[idx];
      var match = !!item && !!curCode && (
        item.code === curCode ||
        (_state.selectedCourse.codes && _state.selectedCourse.codes.indexOf(item.code) >= 0) ||
        (_norm(item.name) === curName)
      );
      btn.classList.toggle('is-selected', match);
    });
  }

  function _showMyNote(item) {
    var noteEl = _el('upMyNote');
    if (!noteEl) return;
    _state.myNote = item;
    noteEl.innerHTML =
      '<div>「' + esc(item.name) + '」暂未收录到当前可见目录中。</div>' +
      '<div style="margin-top:4px"><button type="button" class="up-link-btn" id="upMyNewCourseBtn">带着课程信息去新建课程</button></div>';
    noteEl.style.display = '';
    var btn = noteEl.querySelector('#upMyNewCourseBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        _jumpToNewCourse({
          courseName: item.name,
          courseCode: item.code,
          collegeName: item.collegeName || _state.selectedCollege,
        });
      });
    }
  }

  function _hideMyNote() {
    _state.myNote = null;
    var noteEl = _el('upMyNote');
    if (noteEl) noteEl.style.display = 'none';
  }

  function _jumpToNewCourse(prefill) {
    if (typeof openNewCourseEntry !== 'function') return;
    openNewCourseEntry({
      courseName: prefill && prefill.courseName ? prefill.courseName : '',
      courseCode: prefill && prefill.courseCode ? prefill.courseCode : '',
      collegeName: prefill && prefill.collegeName ? prefill.collegeName : '',
    });
  }

  // ── 文件列表处理 ──
  function _addFiles(fileList) {
    if (!fileList || !fileList.length) return;
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      var dup = _state.files.some(function (ex) {
        return ex.name === f.name && ex.size === f.size && ex.lastModified === f.lastModified;
      });
      if (!dup) _state.files.push(f);
    }
    var titleInp = _el('upTitle');
    if (titleInp && !titleInp.value.trim() && _state.files.length === 1) {
      titleInp.value = _state.files[0].name.replace(/\.[^.]+$/, '');
    }
    _renderFileList();
  }

  function _renderFileList() {
    var listEl = _el('upFileList');
    var sumEl = _el('upFileSummary');
    if (!listEl || !sumEl) return;

    if (!_state.files.length) {
      listEl.style.display = 'none';
      listEl.innerHTML = '';
      sumEl.textContent = '未选择文件（可点击或拖拽到此处）';
      _hideError();
      return;
    }
    sumEl.textContent = '已选择 ' + _state.files.length + ' 个文件';
    var hasOversize = false;
    listEl.innerHTML = _state.files.map(function (f, idx) {
      var over = f.size > MAX_FILE_BYTES;
      if (over) hasOversize = true;
      return '<li class="up-file-item' + (over ? ' is-oversize' : '') + '">' +
        '<span class="up-file-item-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
        '<span class="up-file-item-meta">' +
          '<span>' + esc(_formatBytes(f.size)) + (over ? ' · 超过 50MB' : '') + '</span>' +
          '<button type="button" class="up-file-remove" data-rm-file="' + idx + '" aria-label="移除文件 ' + esc(f.name) + '">✕</button>' +
        '</span>' +
      '</li>';
    }).join('');
    listEl.style.display = '';
    listEl.querySelectorAll('[data-rm-file]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-rm-file'), 10);
        _state.files.splice(idx, 1);
        _renderFileList();
      });
    });
    if (hasOversize) _showError(SIZE_ERR_MSG);
    else _hideError();
  }

  function _showError(msg) {
    var el = _el('upError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
  }

  function _hideError() {
    var el = _el('upError');
    if (el) el.style.display = 'none';
  }

  function _hideSuccess() {
    var el = _el('upSuccessBox');
    if (el) el.style.display = 'none';
  }

  async function _handleSubmit(e) {
    e.preventDefault();
    if (_state.submitting) return;
    _hideError();
    _hideSuccess();

    if (!_state.selectedCourse) {
      _showError('请先搜索并选择要上传资料的课程');
      var crsInp = _el('upCourseInput');
      if (crsInp) crsInp.focus();
      return;
    }

    var materialTypeId = (_el('upMaterialType').value || '').trim();
    if (!materialTypeId) {
      _showError('请选择资料类型');
      _el('upMaterialType').focus();
      return;
    }

    var teacher = (_el('upTeacher').value || '').trim();
    if (!teacher) {
      _showError('请填写任课教师');
      _el('upTeacher').focus();
      return;
    }

    var title = (_el('upTitle').value || '').trim();
    var description = (_el('upDesc').value || '').trim();
    var teachingCode = (_el('upTeachingCode').value || '').trim();
    var courseCode = _state.selectedCourse.code;
    var catId = _state.selectedPlacement ? _state.selectedPlacement.categoryId : null;

    var progress = _el('upProgress');
    var fill = _el('upProgressFill');
    var pText = _el('upProgressText');
    var submitBtn = _el('upSubmitBtn');

    if (_state.mode === 'text') {
      var content = (_el('upTextContent').value || '').trim();
      if (!content) {
        _showError('请输入文字内容');
        _el('upTextContent').focus();
        return;
      }
      _state.submitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '上传中…';
      progress.style.display = 'flex';
      fill.style.width = '50%';
      pText.textContent = '正在保存文字资料…';
      try {
        var token = typeof getAuthToken === 'function' ? getAuthToken() : '';
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        var resp = await fetch('/api/files/upload-text/', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            course_code: courseCode,
            teaching_code: teachingCode,
            category_id: catId,
            title: title,
            content: content,
            description: description,
            teacher: teacher,
            material_type_id: materialTypeId,
          }),
        });
        var data = null;
        try { data = await resp.json(); } catch (err) { data = null; }
        if (!resp.ok || !data || !data.ok) {
          if (resp.status === 429) throw new Error('上传过于频繁，请稍等一分钟后再试');
          throw new Error((data && data.error) || '上传失败，请稍后重试（' + resp.status + '）');
        }
        fill.style.width = '100%';
        pText.textContent = '文字资料录入成功！';
        _onUploadSuccess(courseCode, _state.selectedPlacement);
      } catch (err) {
        progress.style.display = 'none';
        _showError(err.message || '上传失败');
      } finally {
        _state.submitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = '确认上传';
      }
      return;
    }

    // 文件模式
    if (!_state.files.length) {
      _showError('请选择至少一个要上传的文件');
      return;
    }
    if (_state.files.some(function (f) { return f.size > MAX_FILE_BYTES; })) {
      _showError(SIZE_ERR_MSG);
      return;
    }

    _state.submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '上传中…';
    progress.style.display = 'flex';
    var okCount = 0;
    var failCount = 0;
    var lastErr = '';
    var authToken = typeof getAuthToken === 'function' ? getAuthToken() : '';

    for (var i = 0; i < _state.files.length; i++) {
      var file = _state.files[i];
      var fileTitle = title || file.name.replace(/\.[^.]+$/, '');
      if (_state.files.length > 1) fileTitle += ' (' + (i + 1) + ')';
      fill.style.width = (Math.round(((i + 1) / _state.files.length) * 70) + 10) + '%';
      pText.textContent = (i + 1) + '/' + _state.files.length + ' 上传中：' + file.name;

      try {
        var fd = new FormData();
        fd.append('course_code', courseCode);
        if (teachingCode) fd.append('teaching_code', teachingCode);
        if (catId) fd.append('category_id', catId);
        fd.append('title', fileTitle);
        fd.append('file', file);
        fd.append('description', description);
        fd.append('teacher', teacher);
        fd.append('material_type_id', materialTypeId);

        var fileResp = await fetch('/api/files/upload/', {
          method: 'POST',
          headers: authToken ? { Authorization: 'Bearer ' + authToken } : {},
          body: fd,
        });
        var fileData = null;
        try { fileData = await fileResp.json(); } catch (err) { fileData = null; }
        if (!fileResp.ok || !fileData || !fileData.ok) {
          throw new Error((fileData && fileData.error) || SIZE_ERR_MSG);
        }
        okCount++;
      } catch (err) {
        failCount++;
        lastErr = err.message || '上传失败';
      }
    }

    fill.style.width = '100%';
    pText.textContent = '完成：成功 ' + okCount + ' 个' + (failCount > 0 ? '，失败 ' + failCount + ' 个' : '');
    _state.submitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = '确认上传';

    if (okCount > 0) {
      _onUploadSuccess(courseCode, _state.selectedPlacement, failCount > 0 ? lastErr : '');
    } else if (lastErr) {
      _showError(lastErr);
    }
  }

  function _onUploadSuccess(courseCode, placement, warnErr) {
    if (warnErr) _showError('部分文件上传失败：' + warnErr);
    _state.files = [];
    _renderFileList();
    if (_el('upTextContent')) _el('upTextContent').value = '';
    if (_el('upTitle')) _el('upTitle').value = '';
    if (_el('upDesc')) _el('upDesc').value = '';
    if (_el('upTeachingCode')) _el('upTeachingCode').value = '';

    var box = _el('upSuccessBox');
    if (box) {
      var targetPath = placement && placement.path;
      box.innerHTML =
        '<span>上传已提交！感谢你的分享，刷新课程目录即可查看。</span>' +
        '<span style="display:flex;gap:8px;flex-wrap:wrap">' +
          (targetPath ? '<button type="button" class="up-link-btn" id="upGoCourseBtn">前往该课程资料页 →</button>' : '') +
        '</span>';
      box.style.display = 'flex';
      var goBtn = box.querySelector('#upGoCourseBtn');
      if (goBtn && targetPath) {
        goBtn.addEventListener('click', function () {
          if (typeof openPreferredMaterialPath === 'function') {
            openPreferredMaterialPath(targetPath);
          } else if (typeof navToCourse === 'function') {
            navToCourse(targetPath[0], courseCode);
          }
        });
      }
    }
    if (typeof refreshCourseTree === 'function') {
      refreshCourseTree();
    }
  }

  function _updateContextHeader() {
    var sub = _el('upSubContext');
    if (!sub) return;
    var peek = typeof isPeekingUndergrad === 'function' && isPeekingUndergrad();
    if (peek) {
      sub.textContent = '当前正以「本科目录视角」浏览，搜索结果为本科课程目录';
    } else {
      sub.textContent = '当前可见目录：' + _generalLabel() + ' 与 专业课（选中课程后可在下方查看包含专业并精准定位）';
    }
  }

  function _applyOpenPrefill(options) {
    if (!options || options.fromHistory) return;
    _hideError();
    _hideSuccess();
    var p = _el('upProgress');
    if (p) p.style.display = 'none';

    if (options.collegeName) {
      _selectCollege(options.collegeName);
    } else if (!options.preserveSelection) {
      _selectCollege('');
    }
    if (options.courseCode && _state.coursesByCode[options.courseCode]) {
      _selectCourseByCode(options.courseCode, options.categoryId || null, { autoFillCollege: true });
    } else if (!options.preserveSelection) {
      _clearCourseSelection();
    }
  }

  function open(options) {
    var opts = options || {};
    if (!currentUser) {
      if (typeof showLoginModal === 'function') showLoginModal();
      return Promise.resolve();
    }
    _renderSkeleton();
    _populateMaterialTypes();

    if (!opts.fromHistory && typeof pushViewState === 'function') {
      pushViewState('upload', {});
    }
    if (typeof switchView === 'function') switchView('upload', !!opts.fromHistory);
    if (typeof updateSidebar === 'function') updateSidebar(null);

    var bc = _el('uploadBreadcrumb');
    if (bc && typeof _renderBreadcrumb === 'function') {
      _renderBreadcrumb(bc, [''], { lastStatic: '上传资料' });
    }
    _updateContextHeader();
    if (typeof _updateFooterVisibility === 'function') _updateFooterVisibility('upload');

    var treeReady = typeof _ensureCourseTreeReady === 'function'
      ? _ensureCourseTreeReady().catch(function () { return null; })
      : Promise.resolve(null);
    var collegesReady = typeof api === 'function'
      ? api('/api/colleges/').catch(function () { return []; })
      : Promise.resolve([]);

    return Promise.all([treeReady, collegesReady]).then(function (res) {
      _rebuildCourseIndex();
      _buildCollegesList(res[1]);
      _applyOpenPrefill(opts);
      _renderSelectedCourseBar();
      _updateClearButtons();
      _loadMyCourses();
    });
  }

  window.addEventListener('bnuauthchange', function () {
    _state.myCoursesLoadedFor = null;
    _state.myCourses = [];
    var view = _el('uploadView');
    if (!view || !view.classList.contains('active')) return;
    if (!currentUser) {
      if (typeof showHome === 'function') showHome();
      return;
    }
    open({ fromHistory: true });
  });

  window.BnuUploadWorkspace = {
    open: open,
  };
})();
