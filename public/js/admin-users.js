/* BNU Sparks · admin-users.js —— 用户管理+辖区树+异议回复+分流+自动托管：renderAdminUsers/onRoleChange/treeCheckPropagate 等。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
  // ── 用户管理（仅 super_admin） ──
  var _userPage = 1;
  var _userRoleFilter = ''; // '' | 'admin' | 'user'
  function renderAdminUsers(content, search, page) {
    _userPage = page || 1;
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    var params = [];
    if (search) params.push('search=' + encodeURIComponent(search));
    if (_userRoleFilter) params.push('role=' + encodeURIComponent(_userRoleFilter));
    params.push('page=' + _userPage);
    var url = '/api/admin/users/?' + params.join('&');
    api(url).then(function(resp) {
      var users = resp.users || [];
      if (!users.length) {
        content.innerHTML = '<div class="admin-empty">未找到用户</div>';
        return;
      }
      var html = '<div class="admin-section-label">👥 用户管理</div>' +
        '<div class="admin-search-box">' +
        '<input type="text" id="adminUserSearch" placeholder="搜索昵称 / 邮箱…" value="' + escapeHtml(search) + '" onkeydown="if(event.key===\'Enter\')adminSearchUsers()">' +
        '<select class="admin-role-filter" onchange="adminFilterUsers(this.value)">' +
          '<option value=""' + (!_userRoleFilter ? ' selected' : '') + '>全部角色</option>' +
          '<option value="admin"' + (_userRoleFilter === 'admin' ? ' selected' : '') + '>管理员（版主/小版主）</option>' +
          '<option value="user"' + (_userRoleFilter === 'user' ? ' selected' : '') + '>普通用户</option>' +
        '</select>' +
        '<button onclick="adminSearchUsers()">搜索</button>' +
        '</div>';
      var isSuperAdmin = currentUser && currentUser.role === 'super_admin';
      html += '<div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr>' +
          '<th></th><th>昵称</th><th>邮箱</th><th>角色</th><th>管辖板块</th>' + (isSuperAdmin ? '<th>自动托管</th>' : '') + '<th>资料数</th><th>下载数</th><th>注册时间</th>' +
        '</tr></thead><tbody>';
      users.forEach(function(u) {
        var canChange = u.id !== (currentUser ? currentUser.id : -1) && u.role !== 'super_admin';
        var roleOptions = '<select class="admin-role-select" data-user-id="' + u.id + '" data-original="' + u.role + '"' + (canChange ? ' onchange="onRoleChange(' + u.id + ', this.value, \'' + escJs(u.nickname) + '\')"' : ' disabled') + '>' +
          '<option value="user"' + (u.role === 'user' ? ' selected' : '') + '>普通用户</option>' +
          '<option value="sub_moderator"' + (u.role === 'sub_moderator' ? ' selected' : '') + '>小版主</option>' +
          '<option value="moderator"' + (u.role === 'moderator' ? ' selected' : '') + '>版主</option>' +
          (u.role === 'super_admin' ? '<option value="super_admin" selected>总管理员</option>' : '') +
        '</select>';
        var sections = '—';
        if (u.role === 'moderator') {
          var names = [...new Set((u.managed_majors_info || []).map(function(s) { return s.name; }))];
          if (u.can_moderate_general) {
            names.push('通识课');
          } else if (u.moderated_sections_info && u.moderated_sections_info.length) {
            var secNames = [...new Set(u.moderated_sections_info.map(function(s) { return s.name; }))];
            names = names.concat(secNames);
          }
          var display = names.length ? names.join('、') : '—';
          if (u.can_moderate_qa) display = (display === '—' ? '' : display + '、') + '💬 问答区';
          if (canChange) {
            sections = '<a href="javascript:void(0)" class="section-link" onclick="onRoleChange(' + u.id + ',\'moderator\',\'' + escJs(u.nickname) + '\')">' + display + '</a>';
          } else {
            sections = display;
          }
        } else if (u.role === 'sub_moderator') {
          var info = u.moderated_sections_info || [];
          var allIds = info.map(function(s) { return s.id; });
          // 仅显示最高层级的节点（父节点不在管辖范围内则不显示子节点）
          var display = [...new Set(info.filter(function(s) { return allIds.indexOf(s.parent_id) === -1; }).map(function(s) { return s.name; }))].join('、') || '—';
          if (u.can_moderate_qa) display = (display === '—' ? '' : display + '、') + '💬 问答区';
          if (canChange) {
            sections = '<a href="javascript:void(0)" class="section-link" onclick="onRoleChange(' + u.id + ',\'sub_moderator\',\'' + escJs(u.nickname) + '\')">' + display + '</a>';
          } else {
            sections = display;
          }
        }
        var autoApproveCell = '';
        if (isSuperAdmin) {
          if (u.role === 'moderator' || u.role === 'sub_moderator') {
            var aaState = u.auto_approve ? '🟢 开' : '🔴 关';
            var caaState = u.can_auto_approve ? '允许' : '禁止';
            autoApproveCell = '<td class="td-muted">' +
              '<span>' + aaState + '</span>' +
              '<br><button class="admin-btn admin-btn-sm caa-btn" data-caa="' + (u.can_auto_approve ? 1 : 0) + '" onclick="toggleAdminAutoApprove(' + u.id + ', this)">' + caaState + '</button>' +
            '</td>';
          } else {
            autoApproveCell = '<td class="td-muted">—</td>';
          }
        }
        // 头像 + 点击昵称跳转公开页
        var avatarCell = u.avatar_url
          ? '<img src="' + escapeHtml(u.avatar_url) + '" class="admin-user-avatar" onclick="showUserPublic(' + u.id + ')" title="查看公开主页">'
          : '<div class="admin-user-avatar-placeholder" onclick="showUserPublic(' + u.id + ')" title="查看公开主页">' + escapeHtml((u.nickname || '?').charAt(0).toUpperCase()) + '</div>';
        html += '<tr>' +
          '<td>' + avatarCell + '</td>' +
          '<td><a href="javascript:void(0)" class="admin-user-name" onclick="showUserPublic(' + u.id + ')" title="查看公开主页">' + escapeHtml(u.nickname) + '</a></td>' +
          '<td class="td-muted">' + escapeHtml(u.email) + '</td>' +
          '<td>' + roleOptions + '</td>' +
          '<td class="td-muted">' + sections + '</td>' +
          autoApproveCell +
          '<td>' + (u.material_count || 0) + '</td>' +
          '<td>' + (u.download_count || 0) + '</td>' +
          '<td>' + u.date_joined + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
      // 分页控件
      var totalPages = resp.total_pages || 1;
      if (totalPages > 1) {
        html += '<div class="admin-pagination">';
        if (_userPage > 1) {
          html += '<button onclick="renderAdminUsers(document.getElementById(\'adminContent\'), \'' + escJs(search) + '\', ' + (_userPage - 1) + ')">← 上一页</button>';
        } else {
          html += '<button disabled>← 上一页</button>';
        }
        html += '<span class="page-info">第 ' + _userPage + ' / ' + totalPages + ' 页（共 ' + resp.total + ' 条）</span>';
        if (_userPage < totalPages) {
          html += '<button onclick="renderAdminUsers(document.getElementById(\'adminContent\'), \'' + escJs(search) + '\', ' + (_userPage + 1) + ')">下一页 →</button>';
        } else {
          html += '<button disabled>下一页 →</button>';
        }
        html += '</div>';
      }
      content.innerHTML = html;
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">加载失败：' + esc(err.message) + '</div>';
    });
  }

  function adminSearchUsers() {
    var q = document.getElementById('adminUserSearch');
    renderAdminUsers(document.getElementById('adminContent'), q ? q.value.trim() : '', 1);
  }

  function adminFilterUsers(value) {
    _userRoleFilter = value;
    var q = document.getElementById('adminUserSearch');
    renderAdminUsers(document.getElementById('adminContent'), q ? q.value.trim() : '', 1);
  }

  function onRoleChange(uid, newRole, nickname) {
    // 统一取消回调：取消时还原 select
    function cancelWithRevert() {
      revertRoleSelect(uid);
    }
    // 通用关闭处理：overlay 点击背景关闭
    function setupOverlayClose(overlay, uid2) {
      overlay.onclick = function(e) {
        if (e.target === overlay) { _removeOverlay(overlay); revertRoleSelect(uid2); }
      };
    }

    if (newRole === 'moderator') {
      // 版主：选择学院 + 通识课（含可选子类）
      Promise.all([
        api('/api/colleges/'),
        api('/api/admin/sections/')
      ]).then(function(results) {
        var colleges = results[0];
        var sections = results[1].tree || [];
        if (!colleges || !colleges.length) {
          alert('当前没有可用学院，请在后台添加学院后再分配');
          revertRoleSelect(uid);
          return;
        }
        var html = '<div class="admin-reject-dialog"><h3>选择「' + nickname + '」的管辖范围</h3><p class="dlg-hint">版主可审核所选学院/大类下所有课程的资料。<br>选中上级分类将自动勾选其所有下级分类。</p>';
        html += '<div class="college-check-list">';
        // 通识课（父复选框 + 子复选框列表，无需展开）
        var genSection = sections.find(function(s) { return s.name === '通识课'; });
        html += '<div class="mod-gen-block">';
        html += '<label class="college-check-item is-parent"><input type="checkbox" id="modGenCheck_' + uid + '" value="general" onchange="modGenToggle(this,' + uid + ')"> 📖 通识课（全部）</label>';
        if (genSection && genSection.children) {
          genSection.children.forEach(function(child) {
            if (child.is_divider) return;
            html += '<label class="college-check-item is-child"><input type="checkbox" class="gen-sub-cat" value="' + child.id + '" onchange="genSubCatToggle(this,' + uid + ')"> ' + esc(child.name) + '</label>';
          });
        }
        html += '</div>';
        // 问答区（独立大类，不进课程树；版主勾选即授予问答区审核权，v175 视觉提级）
        html += '<div class="mod-qa-block mod-qa-block--major">';
        html += '<div class="mod-qa-head">' +
          '<span class="mod-qa-title">💬 问答区</span>' +
          '<span class="mod-qa-desc">审核问答区（新生指南）内容，勾选后该版主同时管理问答区</span>' +
        '</div>';
        html += '<label class="college-check-item is-parent"><input type="checkbox" id="modQaCheck_' + uid + '" value="qa"> 问答区（全部）</label>';
        html += '</div>';
        // 学院列表
        colleges.forEach(function(c) {
          html += '<label class="college-check-item"><input type="checkbox" value="' + c.id + '"> ' + esc(c.name) + '</label>';
        });
        html += '</div>';
        html += '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" onclick="confirmModeratorRole(' + uid + ', this)">确认设置</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="this.closest(\'.admin-reject-overlay\').remove();revertRoleSelect(' + uid + ')">取消</button>' +
        '</div></div>';

        var overlay = document.createElement('div');
        overlay.className = 'admin-reject-overlay';
        overlay.innerHTML = html;
        document.body.appendChild(overlay);
        overlay.onclick = function(e) { if (e.target === overlay) { _removeOverlay(overlay); revertRoleSelect(uid); } };
      }).catch(function() {
        alert('加载数据失败');
        revertRoleSelect(uid);
      });
      return;
    }
    if (newRole === 'sub_moderator') {
      // 小版主：从课程树选择具体专业/课程（CourseCategory 节点）
      api('/api/admin/sections/').then(function(resp) {
        var sections = resp.tree || [];
        if (!sections || !sections.length) {
          alert('当前没有可选的课程分类节点');
          revertRoleSelect(uid);
          return;
        }
        var html = '<div class="admin-reject-dialog"><h3>选择「' + nickname + '」的管辖范围</h3><p class="dlg-hint">小版主可审核具体专业层级及以下目录的资料。<br>📌 上级分类节点仅作导航，具体专业层级以下可选。<br>💡 选中上级分类将自动勾选所有下级，防止冲突。</p>';
        // 问答区（独立大类，置于课程树上方，不混入自动抓取；v175 视觉提级）
        html += '<div class="mod-qa-block mod-qa-block--major" style="margin-bottom:10px">';
        html += '<div class="mod-qa-head">' +
          '<span class="mod-qa-title">💬 问答区</span>' +
          '<span class="mod-qa-desc">审核问答区（新生指南）内容，勾选后该小版主同时管理问答区</span>' +
        '</div>';
        html += '<label class="college-check-item is-parent"><input type="checkbox" id="subQaCheck_' + uid + '" value="qa"> 问答区（全部）</label>';
        html += '</div>';
        html += '<div class="section-check-list" style="max-height:min(60vh,350px);overflow-y:auto">';
        // 递归渲染可展开树（v=144 视觉重构：结构不变，.section-tree-node 后紧跟 .tree-children 兄弟节点）
        function renderSectionTree(nodes, indent) {
          nodes.forEach(function(s) {
            if (s.is_divider) return;
            var hasChildren = !!(s.children && s.children.length);
            var selectable = indent >= 1;  // 具体专业级及以上可选
            html += '<div class="section-tree-node' + (selectable ? '' : ' is-guide') + '">';
            if (hasChildren) {
              html += '<span class="tree-expand-btn" onclick="sectionTreeToggle(this)">▸</span>';
            } else {
              html += '<span class="tree-expand-btn is-leaf">·</span>';
            }
            html += '<span class="tree-node-icon">' + (hasChildren ? '📁' : '📄') + '</span>';
            if (selectable) {
              html += '<input type="checkbox" value="' + s.id + '" onchange="treeCheckPropagate(this)"> ';
              html += '<label>' + esc(s.name) + '</label>';
            } else {
              html += '<span class="tree-node-guide">' + esc(s.name) + '</span>';
            }
            html += '</div>';
            if (hasChildren) {
              html += '<div class="tree-children" style="display:none">';
              renderSectionTree(s.children, indent + 1);
              html += '</div>';
            }
          });
        }
        // 根节点渲染
        sections.forEach(function(root) {
          var rootId = 'secroot_' + uid + '_' + root.id;
          html += '<div class="section-tree-root"><span>' + esc(root.name) + '</span>';
          if (root.children) {
            html += '<a href="javascript:void(0)" class="tree-toggle-link" onclick="sectionRootToggle(this)">展开分类 ▾</a>';
          }
          html += '</div>';
          if (root.children) {
            html += '<div class="tree-children" style="display:none">';
            renderSectionTree(root.children, 0);
            html += '</div>';
          }
        });
        html += '</div>';
        html += '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" onclick="confirmSubModeratorRole(' + uid + ', this)">确认设置</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="this.closest(\'.admin-reject-overlay\').remove();revertRoleSelect(' + uid + ')">取消</button>' +
        '</div></div>';

        var overlay = document.createElement('div');
        overlay.className = 'admin-reject-overlay';
        overlay.innerHTML = html;
        document.body.appendChild(overlay);
        overlay.onclick = function(e) { if (e.target === overlay) { _removeOverlay(overlay); revertRoleSelect(uid); } };
      }).catch(function() {
        alert('加载课程分类失败');
        revertRoleSelect(uid);
      });
      return;
    }
    // 普通用户：直接确认
    var roleLabel = '普通用户';
    if (!confirm('确定将「' + nickname + '」的角色改为「' + roleLabel + '」？')) {
      revertRoleSelect(uid);
      return;
    }
    api('/api/admin/users/' + uid + '/role/', {
      method: 'POST',
      body: { role: newRole }
    }).then(function() {
      renderAdminUsers(document.getElementById('adminContent'), '');
    }).catch(function(err) {
      alert('操作失败：' + err.message);
      // 失败也要还原
      revertRoleSelect(uid);
      renderAdminUsers(document.getElementById('adminContent'), '');
    });
  }

  function revertRoleSelect(uid) {
    var select = document.querySelector('.admin-role-select[data-user-id="' + uid + '"]');
    if (select) {
      select.value = select.getAttribute('data-original') || 'user';
    }
  }

  // ── 树形复选框自动勾选下级 ──
  function treeCheckPropagate(cb) {
    var node = cb.closest('.section-tree-node');
    if (!node) return;
    var next = node.nextElementSibling;
    if (next && next.classList.contains('tree-children')) {
      next.querySelectorAll('input[type=checkbox]').forEach(function(c) { c.checked = cb.checked; });
    }
  }

  // ── 辖区分配树：展开/收起（v=144 视觉重构配套，结构与功能不变） ──
  function sectionTreeToggle(btn) {
    var node = btn.closest('.section-tree-node');
    var next = node && node.nextElementSibling;
    if (next && next.classList.contains('tree-children')) {
      var open = next.style.display !== 'none';
      next.style.display = open ? 'none' : 'block';
      btn.textContent = open ? '▸' : '▾';
    }
  }

  function sectionRootToggle(link) {
    var root = link.closest('.section-tree-root');
    var next = root && root.nextElementSibling;
    if (next && next.classList.contains('tree-children')) {
      var open = next.style.display !== 'none';
      next.style.display = open ? 'none' : 'block';
      link.textContent = open ? '展开分类 ▾' : '收起分类 ▴';
    }
  }

  // ── 通识课全选/取消 ──
  function modGenToggle(cb, uid) {
    var block = cb.closest('.mod-gen-block');
    if (!block) return;
    block.querySelectorAll('.gen-sub-cat').forEach(function(c) { c.checked = cb.checked; });
  }

  // ── 通识课子类切换时联动父复选框（注意：子类仅可"取消"父类，不会因勾选子类而自动勾选父类）
  //    因为父类 can_moderate_general 有特殊语义（允许所有通识课），勾选子类不应自动开启全部权限
  function genSubCatToggle(cb, uid) {
    var parent = document.getElementById('modGenCheck_' + uid);
    if (!parent) return;
    // 仅当子类全部取消时自动取消父类
    if (!cb.checked) {
      var block = cb.closest('.mod-gen-block');
      var all = block.querySelectorAll('.gen-sub-cat');
      var any = false;
      all.forEach(function(c) { if (c.checked) any = true; });
      if (!any) parent.checked = false;
    }
  }

  function confirmSubModeratorRole(uid, btn) {
    var dialog = btn.closest('.admin-reject-dialog');
    var checked = dialog.querySelectorAll('.section-check-list input:checked');
    var catIds = Array.from(checked).map(function(cb) { return parseInt(cb.value); });
    var qaCheck = dialog.querySelector('#subQaCheck_' + uid);
    var canQA = qaCheck ? qaCheck.checked : false;
    if (!catIds.length && !canQA) {
      alert('请至少选择一个管辖范围（专业/课程节点或问答区）');
      return;
    }
    var overlay = btn.closest('.admin-reject-overlay');
    api('/api/admin/users/' + uid + '/role/', {
      method: 'POST',
      body: { role: 'sub_moderator', moderated_sections: catIds, can_moderate_qa: canQA }
    }).then(function() {
      if (overlay) overlay.remove();
      var si = document.getElementById('adminUserSearch');
      renderAdminUsers(document.getElementById('adminContent'), si ? si.value.trim() : '');
    }).catch(function(err) {
      alert('操作失败：' + err.message);
      if (overlay) overlay.remove();
      var si = document.getElementById('adminUserSearch');
      renderAdminUsers(document.getElementById('adminContent'), si ? si.value.trim() : '');
    });
  }

  function confirmModeratorRole(uid, btn) {
    var dialog = btn.closest('.admin-reject-dialog');
    var genCheck = dialog.querySelector('#modGenCheck_' + uid);
    var canGen = genCheck ? genCheck.checked : false;
    var qaCheck = dialog.querySelector('#modQaCheck_' + uid);
    var canQA = qaCheck ? qaCheck.checked : false;
    var checked = dialog.querySelectorAll('.college-check-list input[type=checkbox]:checked:not([id^=modGenCheck]):not(.gen-sub-cat):not([value="qa"])');
    var collegeIds = Array.from(checked).map(function(cb) { return parseInt(cb.value); });
    // 通识课子类 ID
    var genChildChecked = dialog.querySelectorAll('.gen-sub-cat:checked');
    var sectionIds = Array.from(genChildChecked).map(function(cb) { return parseInt(cb.value); });
    // 如果有 .section-check-list（版主也可能有额外分类）
    var otherSections = dialog.querySelectorAll('.section-check-list input:checked');
    Array.from(otherSections).forEach(function(cb) { sectionIds.push(parseInt(cb.value)); });
    if (!collegeIds.length && !canGen && !sectionIds.length && !canQA) {
      alert('请至少选择一项管辖范围（学院、通识课大类、具体子类或问答区）');
      return;
    }
    var overlay = btn.closest('.admin-reject-overlay');
    api('/api/admin/users/' + uid + '/role/', {
      method: 'POST',
      body: { role: 'moderator', managed_majors: collegeIds, can_moderate_general: canGen, moderated_sections: sectionIds, can_moderate_qa: canQA }
    }).then(function() {
      if (overlay) overlay.remove();
      var si = document.getElementById('adminUserSearch');
      renderAdminUsers(document.getElementById('adminContent'), si ? si.value.trim() : '');
    }).catch(function(err) {
      alert('操作失败：' + err.message);
      if (overlay) overlay.remove();
      var si = document.getElementById('adminUserSearch');
      renderAdminUsers(document.getElementById('adminContent'), si ? si.value.trim() : '');
    });
  }

  // ── 审核异议（一次性通知弹窗，而非评论区） ──
  function showObjectionDialog(fileId, title) {
    var old = document.querySelector('.objection-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.className = 'admin-reject-overlay objection-overlay';
    overlay.innerHTML =
      '<div class="admin-reject-dialog">' +
        '<h3>💬 对资料提出异议</h3>' +
        '<p class="dlg-hint">该异议将发送给原审核人，并在审核记录中留存。</p>' +
        '<p class="obj-title">' + escapeHtml(title) + '</p>' +
        '<textarea id="objInput" placeholder="请说明异议原因…（必填）" rows="3"></textarea>' +
        '<div class="ar-error" id="objError" style="display:none">请填写异议原因</div>' +
        '<div class="ar-actions">' +
          '<button class="admin-btn admin-btn-primary" onclick="submitObjection(' + fileId + ')">提交异议</button>' +
          '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
    lockScroll();
    setTimeout(function() { document.getElementById('objInput').focus(); }, 100);
  }

  function submitObjection(fileId) {
    var input = document.getElementById('objInput');
    if (!input) return;
    var content = input.value.trim();
    if (!content) {
      document.getElementById('objError').style.display = 'block';
      return;
    }
    document.getElementById('objError').style.display = 'none';
    var overlay = document.querySelector('.objection-overlay');
    api('/api/moderation/' + fileId + '/comments/', { method: 'POST', body: { content: content } }).then(function() {
      _removeOverlay(overlay);
      alert('异议已提交，原审核人将收到通知。');
    }).catch(function(err) {
      alert('提交失败：' + err.message);
    });
  }

  // 历史页查看已有异议（只读，不发表）
  function toggleComments(fileId, btn, isHistory) {
    var commentsDiv;
    if (isHistory) {
      var row = document.getElementById('hc-comments-row-' + fileId);
      if (row) {
        if (row.style.display === 'table-row') { row.style.display = 'none'; return; }
        row.style.display = 'table-row';
        commentsDiv = document.getElementById('hc-comments-' + fileId);
      }
    }
    if (!commentsDiv) return;
    commentsDiv.innerHTML = '<div class="pc-comments-loading">加载中…</div>';
    api('/api/moderation/' + fileId + '/comments/').then(function(data) {
      var html = '';
      if (data.comments && data.comments.length) {
        // 先渲染顶层评论，再按 parent_id 挂子评论
        var topLevel = data.comments.filter(function(c) { return !c.parent_id; });
        var replies = {};
        data.comments.forEach(function(c) {
          if (c.parent_id) {
            if (!replies[c.parent_id]) replies[c.parent_id] = [];
            replies[c.parent_id].push(c);
          }
        });
        topLevel.forEach(function(c) {
          html += '<div class="pc-comment-item">' +
            '<span class="pcc-name">' + esc(c.commenter_name) + '</span>' +
            '<span class="pcc-time">' + esc(c.created_at) + '</span>' +
            '<div class="pcc-content">' + esc(c.content) + '</div>' +
            '<button class="pcc-reply-btn" onclick="showReplyForm(' + fileId + ', ' + c.id + ', this)">↩ 回复</button>' +
            '</div>';
          // 渲染子评论（回复）
          if (replies[c.id]) {
            replies[c.id].forEach(function(r) {
              html += '<div class="pc-comment-item pc-comment-reply"><span class="pcc-name">' + esc(r.commenter_name) + '</span><span class="pcc-time">' + esc(r.created_at) + '</span><div class="pcc-content">' + esc(r.content) + '</div></div>';
            });
          }
        });
      } else {
        html += '<div class="pc-comment-empty">暂无异议</div>';
      }
      commentsDiv.innerHTML = html;
    }).catch(function() {
      commentsDiv.innerHTML = '<div class="pc-comment-empty">加载失败</div>';
    });
  }

  // ── 回复异议 ──
  function showReplyForm(fileId, parentId, btn) {
    // 移除已有的回复输入框
    var existingForm = document.querySelector('.pcc-reply-form');
    if (existingForm) existingForm.remove();
    var form = document.createElement('div');
    form.className = 'pcc-reply-form';
    form.innerHTML =
      '<textarea rows="2" placeholder="输入回复…"></textarea>' +
      '<div class="pcc-reply-actions">' +
        '<button class="admin-btn admin-btn-sm admin-btn-primary" onclick="submitReply(' + fileId + ', ' + parentId + ', this)">发送</button>' +
        '<button class="admin-btn admin-btn-sm admin-btn-secondary" onclick="this.closest(\'.pcc-reply-form\').remove()">取消</button>' +
      '</div>';
    // 插入到按钮后面
    if (btn && btn.parentNode) {
      btn.parentNode.insertAdjacentElement('afterend', form);
    }
    form.querySelector('textarea').focus();
  }

  function submitReply(fileId, parentId, btn) {
    var form = btn.closest('.pcc-reply-form');
    var textarea = form ? form.querySelector('textarea') : null;
    if (!textarea) return;
    var content = textarea.value.trim();
    if (!content) { alert('回复内容不能为空'); return; }
    var overlay = document.querySelector('.admin-reject-overlay');
    api('/api/moderation/' + fileId + '/comments/', {
      method: 'POST',
      body: { content: content, parent_id: parentId }
    }).then(function() {
      // 刷新评论列表
      var commentsDiv = document.getElementById('hc-comments-' + fileId);
      if (commentsDiv) toggleComments(fileId, null, true);
      textarea.value = '';
    }).catch(function(err) {
      alert('回复失败：' + err.message);
    });
  }

  // ── 手动分流（指派审核人） ──
  function showReassignDialog(fileId) {
    var existing = document.querySelector('.reassign-overlay');
    if (existing) existing.remove();
    // 后端按角色返回可指派对象：超管=全部版主+小版主；版主=覆盖该课程的小版主
    api('/api/moderation/' + fileId + '/assignable/').then(function(res) {
      var mods = res.users || [];
      if (!mods.length) {
        alert('当前没有可指派的审核员（版主/小版主）');
        return;
      }
      var html = '<div class="admin-reject-dialog"><h3>指派审核人</h3><p class="dlg-hint">选择后仅该审核员和总管理员可看到此待审资料</p>';
      html += '<select id="reassignSelect">';
      html += '<option value="">— 取消指派（回归自动路由） —</option>';
      mods.forEach(function(u) {
        var roleLabel = u.role === 'moderator' ? '版主' : '小版主';
        html += '<option value="' + u.id + '">' + esc(u.nickname) + ' (' + roleLabel + ')</option>';
      });
      html += '</select>';
      html += '<div class="ar-actions">' +
        '<button class="admin-btn admin-btn-primary" onclick="confirmReassign(' + fileId + ')">确认指派</button>' +
        '<button class="admin-btn admin-btn-secondary" onclick="_removeOverlay(this.closest(\'.admin-reject-overlay\'))">取消</button>' +
      '</div></div>';

      var overlay = document.createElement('div');
      overlay.className = 'admin-reject-overlay reassign-overlay';
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
      overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
      lockScroll();
    }).catch(function() {
      alert('加载用户列表失败');
    });
  }

  function confirmReassign(fileId) {
    var select = document.getElementById('reassignSelect');
    if (!select) return;
    var assignedMod = select.value ? parseInt(select.value) : null;
    var overlay = document.querySelector('.reassign-overlay');
    api('/api/moderation/' + fileId + '/reassign/', {
      method: 'POST',
      body: { assigned_moderator: assignedMod }
    }).then(function() {
      _removeOverlay(overlay);
      // 刷新待审核列表
      renderAdminPending(document.getElementById('adminContent'));
    }).catch(function(err) {
      alert('指派失败：' + err.message);
    });
  }

  // ── 自动托管管理（super_admin 授予/回收「可自开」权 can_auto_approve） ──
  function toggleAdminAutoApprove(uid, btn) {
    // 从按钮 data-caa 属性直接读取当前 gate 状态
    var currentOn = btn && btn.getAttribute('data-caa') === '1';
    var newVal = !currentOn;
    api('/api/admin/users/' + uid + '/auto-approve/', {
      method: 'POST',
      body: { can_auto_approve: newVal }
    }).then(function(result) {
      // 直接修改所在 <td> 的 DOM，无需重渲染
      if (!btn) return;
      var td = btn.closest('td');
      if (td) {
        // 更新 🟢🔴 标识（回收授权时后端会强制关 auto_approve）
        var span = td.querySelector('span');
        if (span) span.textContent = result.auto_approve ? '🟢 开' : '🔴 关';
      }
      // 更新按钮本身（gate 状态）
      btn.textContent = result.can_auto_approve ? '允许' : '禁止';
      btn.setAttribute('data-caa', result.can_auto_approve ? '1' : '0');
    }).catch(function(err) {
      btn.textContent = currentOn ? '允许' : '禁止';
      btn.setAttribute('data-caa', currentOn ? '1' : '0');
      alert('操作失败：' + err.message);
    });
  }

  // ── 工具函数 ──
