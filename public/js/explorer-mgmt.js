/* BNU Sparks · explorer-mgmt.js —— 管理模式。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
  function extBadge(fileName) {
    if (!fileName) return '';
    const ext = fileName.split('.').pop().toLowerCase();
    const label = {pdf:'PDF', ppt:'PPT', pptx:'PPT', doc:'DOC', docx:'DOC', xls:'XLS', xlsx:'XLS',
                   jpg:'IMG', jpeg:'IMG', png:'IMG', gif:'IMG', webp:'IMG', md:'MD', txt:'TXT',
                   zip:'ZIP', rar:'RAR', py:'PY', js:'JS', html:'HTML', css:'CSS'}[ext] || ext.toUpperCase().slice(0,4);
    return '<span class="ext-badge">' + esc(label) + '</span>';
  }

  // ═══════════════════════════════════════════════════════════
  // 管理模式：三点菜单 + 操作弹窗
  // ═══════════════════════════════════════════════════════════

  function _mgmtMenuItemsHtml(node) {
    if (!node) return '';
    var isCourse = !!(node.courseId);
    var items = isCourse ? ['rename', 'set_course', 'delete']
                         : ['rename', 'delete'];
    return items.map(function(a) {
      var label = { rename: '✏️ 重命名', set_course: '📎 修改课程代码', delete: '🗑 删除' }[a] || a;
      var cls = a === 'delete' ? 'fc-menu-item danger' : 'fc-menu-item';
      return '<div class="' + cls + '" data-action="' + a + '">' + label + '</div>';
    }).join('');
  }

  function _openMgmtMenu(btn) {
    _closeAllMgmtMenus();
    var catId = btn.getAttribute('data-cat-id');
    var menu = document.querySelector('.fc-card-menu[data-cat-id="' + catId + '"]');
    if (!menu) return;
    var rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 160) + 'px';
    menu.style.display = 'block';
    btn.classList.add('is-open');
    var overlay = document.createElement('div');
    overlay.className = 'fc-menu-overlay';
    overlay.id = 'mgmtMenuOverlay';
    overlay.onclick = _closeAllMgmtMenus;
    document.body.appendChild(overlay);
  }

  function _closeAllMgmtMenus() {
    document.querySelectorAll('.fc-card-menu').forEach(function(m) { m.style.display = 'none'; });
    document.querySelectorAll('.fc-card-menu-btn.is-open').forEach(function(b) { b.classList.remove('is-open'); });
    var ov = document.getElementById('mgmtMenuOverlay');
    if (ov) ov.remove();
  }

  // ── 管理模式：错误提示（管辖范围外友好提示）──
  function _showScopeError(prefix, err) {
    var msg = err && (err.message || err.error);
    if (msg && (msg.indexOf('无权') !== -1 || msg.indexOf('权限不足') !== -1)) {
      alert(prefix + '：此操作在管辖范围之外且非本人上传');
    } else {
      alert(prefix + '：' + msg);
    }
  }

  // ── 管理模式：操作弹窗 ──

  function _showRenameDialog(catId, currentName) {
    var name = prompt('输入新名称', currentName || '');
    if (!name || name === currentName) return;
    api('/api/folders/' + catId + '/rename/', { method: 'POST', body: { name: name } })
      .then(function() { refreshCourseTree(); })
      .catch(function(err) { _showScopeError('重命名失败', err); });
  }

  function _showSetCourseDialog(catId) {
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay';
    overlay.innerHTML =
      '<div class="admin-reject-dialog" style="max-width:440px">' +
        '<h3>📎 修改课程代码</h3>' +
        '<p style="font-size:0.82rem;color:var(--ink-mid);margin:2px 0 10px">输入新的课程代码。若已存在同代码的课程文件夹，将自动合并其中的文件；否则仅在原文件夹上修改课程代码。</p>' +
        '<div style="margin:10px 0"><label>新课程代码</label>' +
          '<input type="text" id="mgmtCourseCode" maxlength="20" placeholder="如 PSY30201" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem;box-sizing:border-box">' +
          '<div style="font-size:0.75rem;color:var(--ink-faint);margin-top:4px">仅允许字母和数字</div></div>' +
        '<input type="hidden" id="mgmtCatId" value="' + catId + '">' +
        '<div id="mgmtSituationArea"></div>' +
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" id="mgmtSetCourseBtn">确认</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
    setTimeout(function() { var el = document.getElementById('mgmtCourseCode'); if (el) el.focus(); }, 100);
  }

  // 事件委托：监听 #explorerContent 上的三点菜单和弹窗操作
  document.addEventListener('click', function(e) {
    var target = e.target;

    // 三点菜单按钮
    if (target.classList.contains('fc-card-menu-btn')) {
      e.stopPropagation();
      _openMgmtMenu(target);
      return;
    }

    // 三点菜单项
    if (target.classList.contains('fc-menu-item') || target.closest('.fc-menu-item')) {
      var item = target.classList.contains('fc-menu-item') ? target : target.closest('.fc-menu-item');
      var action = item.getAttribute('data-action');
      var menu = item.closest('.fc-card-menu');
      var catId = parseInt(menu.getAttribute('data-cat-id'));
      _closeAllMgmtMenus();

      // 从当前路径节点中找到匹配的节点数据
      var node = getNode(expPath);
      var currentNode = node && node.children ? node.children.find(function(c) { return c.id === catId; }) : null;

      if (action === 'rename') { _showRenameDialog(catId, currentNode ? currentNode.name : ''); }
      else if (action === 'set_course') { _showSetCourseDialog(catId); }
      else if (action === 'delete') { _showDeleteDialog(catId, currentNode); }
      return;
    }

    // 修改课程代码 — 主按钮（查询 → 自动重命名/合并；多课程时选择后执行）
    var setCourseBtn = e.target.closest('#mgmtSetCourseBtn');
    if (setCourseBtn) {
      var codeEl = document.getElementById('mgmtCourseCode');
      var code = codeEl ? codeEl.value.trim() : '';
      if (!code) { alert('请输入课程代码'); return; }
      if (!/^[A-Za-z0-9]+$/.test(code)) { alert('课程代码仅允许字母和数字'); return; }
      var catIdInput = document.getElementById('mgmtCatId');
      var targetCatId = catIdInput ? parseInt(catIdInput.value) : 0;
      if (!targetCatId) { alert('缺少目标节点'); return; }
      if (setCourseBtn.dataset.mode === 'pick') {
        // 多课程已展示选择列表 → 确认执行链接
        var sel = document.querySelector('input[name="mgmtTargetCourse"]:checked');
        if (!sel) { alert('请选择要指向的课程'); return; }
        var codeNow = codeEl.value.trim();
        _mgmtSetCourseExec(targetCatId, codeNow, 'link', parseInt(sel.value));
      } else {
        _mgmtSetCoursePhase1(targetCatId, code, setCourseBtn);
      }
      return;
    }
  });

  // 阶段1：查询课程代码存在情况 → 自动执行（重命名/合并/链接），多课程时展示选择列表
  function _mgmtSetCoursePhase1(catId, code, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
    api('/api/folders/' + catId + '/set-course/', { method: 'POST', body: { course_code: code } })
      .then(function(r) {
        if (r.situation === 'new_code') {
          // 无同代码文件夹 → 原文件夹上仅改课程代码（重命名 + 文件路径迁移）
          _mgmtSetCourseExec(catId, code, 'rename_self', null);
        } else if (r.situation === 'exists_single') {
          // 存在同代码课程 → 自动合并（有文件迁移）；无可合并时链接到已有课程
          var hasMerge = (r.options || []).some(function(o) { return o.id === 'merge'; });
          var targetId = r.existing_course && r.existing_course.id;
          _mgmtSetCourseExec(catId, code, hasMerge ? 'merge' : 'link', targetId);
        } else if (r.situation === 'exists_multiple') {
          // 同代码对应多个课程 → 展示列表让管理员选择指向哪个
          _renderSetCoursePicker(r);
        } else {
          if (btn) { btn.disabled = false; btn.textContent = '确认'; }
          alert(r.note || '查询失败');
        }
      })
      .catch(function(err) {
        _showScopeError('查询失败', err);
        if (btn) { btn.disabled = false; btn.textContent = '确认'; }
      });
  }

  function _renderSetCoursePicker(r) {
    var area = document.getElementById('mgmtSituationArea');
    if (!area) return;
    var html = '<div class="mgmt-situation">' + esc(r.note) + '</div>';
    html += '<div class="mgmt-course-list">';
    (r.matching_courses || []).forEach(function(c, idx) {
      html += '<div class="mgmt-course-item" onclick="this.querySelector(\'input\').checked=true">' +
        '<input type="radio" name="mgmtTargetCourse" value="' + c.id + '"' + (idx === 0 ? ' checked' : '') + '>' +
        ' <strong>' + esc(c.name) + '</strong>' +
        ' <span style="color:var(--ink-faint)">' + esc(c.code) + ' · ' + esc(c.college || '无学院') + ' · ' + c.file_count + '个文件</span>' +
      '</div>';
    });
    html += '</div>';
    html += '<div style="margin-top:8px;font-size:0.82rem;color:var(--ink-mid)">该代码对应多个课程，请选择要指向的课程后点击「确认执行」</div>';
    area.innerHTML = html;
    var btn = document.getElementById('mgmtSetCourseBtn');
    if (btn) { btn.disabled = false; btn.textContent = '确认执行'; btn.dataset.mode = 'pick'; }
  }

  // 阶段2：执行修改/合并/链接
  function _mgmtSetCourseExec(catId, code, actionId, targetId) {
    var body = { course_code: code, action_id: actionId };
    if (targetId) body.target_course_id = targetId;
    var overlay = document.querySelector('.admin-reject-overlay');
    api('/api/folders/' + catId + '/set-course/', { method: 'POST', body: body })
      .then(function() {
        if (overlay) _removeOverlay(overlay);
        refreshCourseTree();
      })
      .catch(function(err) {
        _showScopeError('操作失败', err);
        var btn = document.getElementById('mgmtSetCourseBtn');
        if (btn) { btn.disabled = false; btn.textContent = '确认'; delete btn.dataset.mode; }
      });
  }

  function _showDeleteDialog(catId, node) {
    var name = (node && node.name) || '未命名';
    var hasChildren = node && node.children && node.children.length > 0;
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay';
    var peelNote = hasChildren
      ? '<p style="font-size:0.85rem;color:var(--ink-mid);margin-top:8px">其下 ' + node.children.length + ' 个子节点将上移至父节点位置</p>'
      : '';
    overlay.innerHTML =
      '<div class="admin-reject-dialog" style="max-width:360px">' +
        '<h3>🗑 确认删除</h3>' +
        '<p>将删除文件夹 <strong>' + esc(name) + '</strong></p>' +
        peelNote +
        '<p style="font-size:0.8rem;color:var(--ink-faint)">仅删除目录节点，关联课程和文件不受影响</p>' +
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" onclick="_doDeleteFolder(' + catId + ', this.closest(\'.admin-reject-overlay\'))">确认删除</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
  }

  // 从内存课程树中移除节点（删除成功后立即反馈，不等服务端缓存生效）
  function _removeNodeFromTree(catId) {
    function walk(nodes) {
      if (!nodes) return false;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id === catId) { nodes.splice(i, 1); return true; }
        if (walk(nodes[i].children)) return true;
      }
      return false;
    }
    walk(Object.values(courseTree || {}));
  }

  function _doDeleteFolder(catId, overlay) {
    api('/api/folders/' + catId + '/delete/', { method: 'DELETE' })
      .then(function() {
        if (overlay) _removeOverlay(overlay);
        _removeNodeFromTree(catId);
        // 若当前导航路径指向被删子树，向上回到最近有效祖先
        while (expPath.length && !getNode(expPath)) expPath.pop();
        if (expPath.length) pushViewState('explorer', { expPath: [...expPath] });
        renderExplorer();
        refreshCourseTree();
      })
      .catch(function(err) { _showScopeError('删除失败', err); });
  }

  function showNewFolderDialog(parentId) {
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay';
    overlay.innerHTML =
      '<div class="admin-reject-dialog" style="max-width:420px">' +
        '<h3>📁 新建文件夹</h3>' +
        '<div style="margin-bottom:8px"><label style="font-size:0.85rem;display:block;margin-bottom:4px">文件夹类型</label>' +
          '<select id="newFolderType" onchange="updateNewFolderFields()" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem">' +
            '<option value="intermediate">中间节点（可建子文件夹，不绑定课程）</option>' +
            '<option value="course">课程节点（需填课程代码，可上传文件）</option>' +
            '<option value="custom">自建文件夹（自动编号 UNB，可上传文件）</option>' +
          '</select></div>' +
        '<div id="newFolderFields"></div>' +
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" onclick="confirmNewFolder(' + (parentId || 'null') + ')">创建</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
    // 注册字段更新函数
    window.updateNewFolderFields = function() {
      var type = document.getElementById('newFolderType').value;
      var container = document.getElementById('newFolderFields');
      if (type === 'intermediate') {
        container.innerHTML = '<div style="margin:12px 0"><label style="font-size:0.85rem;display:block;margin-bottom:4px">文件夹名称</label>' +
          '<input type="text" id="newFolderName" placeholder="输入名称" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem;box-sizing:border-box"></div>';
        setTimeout(function() { var el = document.getElementById('newFolderName'); if (el) el.focus(); }, 100);
      } else if (type === 'course') {
        container.innerHTML =
          '<div style="margin:12px 0 8px"><label style="font-size:0.85rem;display:block;margin-bottom:4px">课程名称</label>' +
            '<input type="text" id="newFolderCourseName" placeholder="如 普通心理学" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem;box-sizing:border-box"></div>' +
          '<div style="margin-bottom:8px"><label style="font-size:0.85rem;display:block;margin-bottom:4px">课程代码</label>' +
            '<input type="text" id="newFolderCode" placeholder="三个字母加五位数字，如 PSY30201" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem;box-sizing:border-box"></div>' +
          '<div style="font-size:0.75rem;color:var(--ink-faint);margin-bottom:4px">课程名称将作为文件夹显示名称 · 课程代码仅允许字母和数字</div>';
        setTimeout(function() { var el = document.getElementById('newFolderCourseName'); if (el) el.focus(); }, 100);
      } else if (type === 'custom') {
        container.innerHTML =
          '<div style="margin:12px 0"><label style="font-size:0.85rem;display:block;margin-bottom:4px">文件夹名称</label>' +
            '<input type="text" id="newFolderName" placeholder="如 普通心理学补充资料" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-light);font-size:0.9rem;box-sizing:border-box"></div>' +
          '<div style="margin:8px 0"><label style="font-size:0.85rem;display:block;margin-bottom:4px">自动编号（创建时生成）</label>' +
            '<div class="mgmt-auto-code">UNBxxxxx（创建后自动分配）</div></div>';
        setTimeout(function() { var el = document.getElementById('newFolderName'); if (el) el.focus(); }, 100);
      }
    };
    updateNewFolderFields();
    setTimeout(function() { var el = document.getElementById('newFolderName'); if (el) el.focus(); }, 100);
  }

  function confirmNewFolder(parentId) {
    var type = document.getElementById('newFolderType').value;
    var body = { parent_id: parentId, folder_type: type };

    if (type === 'intermediate') {
      var name = document.getElementById('newFolderName').value.trim();
      if (!name) { alert('请输入文件夹名称'); return; }
      body.name = name;
    } else if (type === 'course') {
      var code = document.getElementById('newFolderCode').value.trim();
      var cname = document.getElementById('newFolderCourseName').value.trim();
      if (!code) { alert('请填写课程代码'); return; }
      if (!cname) { alert('请填写课程名称'); return; }
      if (!/^[A-Za-z0-9]+$/.test(code)) { alert('课程代码仅允许字母和数字'); return; }  // v=158 加固
      body.name = cname;       // 课程名称作为文件夹显示名
      body.course_code = code;
      body.course_name = cname;
    } else if (type === 'custom') {
      var name = document.getElementById('newFolderName').value.trim();
      if (!name) { alert('请输入文件夹名称'); return; }
      body.name = name;
    }

    var overlay = document.querySelector('.admin-reject-overlay');
    api('/api/folders/create/', { method: 'POST', body: body }).then(function(res) {
      _removeOverlay(overlay);
      // v=165：课程代码已存在且目标位置已有入口 → 后端复用叶子并带 message
      if (res && res.message) alert(res.message);
      refreshCourseTree();
    }).catch(function(err) {
      _showScopeError('创建失败', err);
    });
  }

