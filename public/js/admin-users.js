/* BNU Sparks · admin-users.js —— 用户监测+用户管理+辖区树+角色与自动托管。顶层函数为跨文件契约。 */
  // ── 用户管理（仅 super_admin） ──
  var _userPage = 1;
  var _userRoleFilter = ''; // '' | 'admin' | 'user'
  var _adminUserSection = 'trend';
  var _monitorPeriod = 'week';
  var _downloadActivity = 'all';
  var _identityMonitorData = null;

  function _adminUserSectionButton(section, label) {
    return '<button class="pc-seg-btn' + (_adminUserSection === section ? ' active' : '') + '" ' +
      'role="tab" aria-selected="' + (_adminUserSection === section ? 'true' : 'false') + '" ' +
      'onclick="switchAdminUserSection(\'' + section + '\')">' + label + '</button>';
  }

  function renderAdminUsers(content, search, page) {
    if (!content) return;
    content.innerHTML = '<div class="pc-type-bar admin-user-monitor-nav">' +
        '<span class="pc-type-label">功能分区</span>' +
        '<div class="pc-seg" role="tablist" aria-label="用户管理功能分区">' +
          _adminUserSectionButton('trend', '活动趋势') +
          _adminUserSectionButton('identity', '身份分布') +
          _adminUserSectionButton('downloads', '访问流水') +
          _adminUserSectionButton('health', '运行状态') +
          _adminUserSectionButton('users', '用户名单') +
        '</div>' +
      '</div>' +
      '<div id="adminUserSectionContent" class="admin-user-section-content"></div>';
    var sectionContent = document.getElementById('adminUserSectionContent');
    if (_adminUserSection === 'trend') renderAdminMonitoringTrend(sectionContent);
    else if (_adminUserSection === 'identity') renderAdminIdentityDistribution(sectionContent);
    else if (_adminUserSection === 'downloads') renderAdminDownloadStream(sectionContent, page || 1);
    else if (_adminUserSection === 'health') renderAdminSiteHealth(sectionContent);
    else renderAdminUserList(sectionContent, search || '', page || 1);
  }

  function switchAdminUserSection(section) {
    _adminUserSection = section;
    renderAdminUsers(document.getElementById('adminContent'), '', 1);
  }

  function setMonitoringPeriod(period) {
    _monitorPeriod = period;
    renderAdminMonitoringTrend(document.getElementById('adminUserSectionContent'));
  }

  function _monitorPeriodButtons() {
    var periods = [
      ['day', '近 24 小时'], ['week', '近 7 天'],
      ['month', '近 30 天'], ['all', '全部时间']
    ];
    return '<div class="pc-seg monitor-period-seg" role="tablist" aria-label="趋势时间范围">' + periods.map(function(p) {
      return '<button class="pc-seg-btn' + (_monitorPeriod === p[0] ? ' active' : '') + '" role="tab" ' +
        'aria-selected="' + (_monitorPeriod === p[0] ? 'true' : 'false') + '" onclick="setMonitoringPeriod(\'' + p[0] + '\')">' + p[1] + '</button>';
    }).join('') + '</div>';
  }

  function _monitorStat(value, label, tone) {
    return '<div class="monitor-stat-card ' + (tone || '') + '">' +
      '<div class="monitor-stat-value">' + Number(value || 0).toLocaleString('zh-CN') + '</div>' +
      '<div class="monitor-stat-label">' + label + '</div></div>';
  }

  function _monitorLinePath(values, width, height, left, top, right, bottom, maxValue) {
    var innerW = width - left - right;
    var innerH = height - top - bottom;
    return values.map(function(value, index) {
      var x = left + (values.length <= 1 ? innerW / 2 : index * innerW / (values.length - 1));
      var y = top + innerH - (Number(value || 0) / maxValue) * innerH;
      return (index ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
  }

  function _monitorTrendChart(data) {
    var labels = data.labels || [];
    var uploads = data.uploads || [];
    var downloads = data.downloads || [];
    var width = 960, height = 300, left = 48, right = 18, top = 20, bottom = 42;
    var maxValue = Math.max(1, Math.max.apply(null, uploads.concat(downloads)));
    var grid = '', yLabels = '';
    var tickCount = Math.min(4, Math.ceil(maxValue));
    for (var t = 0; t <= tickCount; t++) {
      var y = top + (height - top - bottom) * t / tickCount;
      var tickValue = Math.round(maxValue * (tickCount - t) / tickCount);
      grid += '<line x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '" />';
      yLabels += '<text x="' + (left - 10) + '" y="' + (y + 4) + '" text-anchor="end">' + tickValue + '</text>';
    }
    var xLabels = '';
    var labelStep = Math.max(1, Math.ceil(labels.length / 7));
    labels.forEach(function(label, index) {
      if (index % labelStep !== 0 && index !== labels.length - 1) return;
      var x = left + (labels.length <= 1 ? (width - left - right) / 2 : index * (width - left - right) / (labels.length - 1));
      xLabels += '<text x="' + x + '" y="' + (height - 13) + '" text-anchor="middle">' + esc(label) + '</text>';
    });
    return '<div class="monitor-chart-card">' +
      '<div class="monitor-chart-legend"><span class="legend-upload"><i></i>上传</span><span class="legend-download"><i></i>下载</span></div>' +
      '<div class="monitor-chart-wrap"><svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(data.period_label) + '上传与下载趋势">' +
        '<g class="monitor-grid">' + grid + '</g><g class="monitor-axis-labels">' + yLabels + xLabels + '</g>' +
        '<path class="monitor-line monitor-line-upload" d="' + _monitorLinePath(uploads, width, height, left, top, right, bottom, maxValue) + '" />' +
        '<path class="monitor-line monitor-line-download" d="' + _monitorLinePath(downloads, width, height, left, top, right, bottom, maxValue) + '" />' +
      '</svg></div></div>';
  }

  function renderAdminMonitoringTrend(content) {
    if (!content) return;
    content.innerHTML = '<div class="admin-loading">加载活动趋势…</div>';
    api('/api/admin/monitoring/?section=trend&period=' + encodeURIComponent(_monitorPeriod)).then(function(data) {
      var summary = data.summary || {};
      content.innerHTML = '<div class="monitor-section-head"><div><h3>文件流动趋势</h3>' +
        '<p>下载曲线仅统计正式下载；文件预览单独计数，不再抬高下载量。</p></div>' + _monitorPeriodButtons() + '</div>' +
        '<div class="monitor-stats-grid">' +
          _monitorStat(summary.upload_count, '期间上传', 'tone-upload') +
          _monitorStat(summary.download_count, '正式下载', 'tone-download') +
          _monitorStat(summary.preview_count, '文件预览') +
          _monitorStat(summary.unique_downloaders, '下载用户') +
        '</div>' + _monitorTrendChart(data);
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">活动趋势加载失败：' + esc(err.message) + '</div>';
    });
  }

  function _distributionBars(rows, selectedIndex, onclickName) {
    // “其他”是兜底值，不作为看板的可视化类别；保留真实归属，减少噪音。
    rows = (rows || []).filter(function(row) {
      return row && row.name && row.name !== '其他' && row.name !== '其它';
    });
    if (!rows || !rows.length) return '<div class="monitor-sub-empty">暂无可统计的身份标签</div>';
    var max = Math.max.apply(null, rows.map(function(row) { return row.count || 0; })) || 1;
    return '<div class="identity-bars">' + rows.map(function(row, index) {
      var selected = index === selectedIndex;
      var attrs = onclickName ? ' onclick="' + onclickName + '(' + index + ')"' : '';
      return '<button type="button" class="identity-bar-row' + (selected ? ' active' : '') + '"' + attrs + '>' +
        '<span class="identity-bar-label">' + esc(row.name) + '</span>' +
        '<span class="identity-bar-track"><span style="width:' + Math.max(2, (row.count || 0) / max * 100) + '%"></span></span>' +
        '<strong>' + (row.count || 0) + '</strong></button>';
    }).join('') + '</div>';
  }

  function selectIdentityCollege(index) {
    if (!_identityMonitorData) return;
    _identityMonitorData.selectedIndex = index;
    var colleges = _identityMonitorData.colleges || [];
    var collegeList = document.getElementById('identityCollegeBars');
    var majorPanel = document.getElementById('identityMajorPanel');
    if (collegeList) collegeList.innerHTML = _distributionBars(colleges, index, 'selectIdentityCollege');
    if (majorPanel) {
      var selected = colleges[index];
      majorPanel.innerHTML = selected
        ? '<div class="monitor-card-head"><h4>' + esc(selected.name) + ' · 专业</h4><span>' + (selected.majors && selected.majors.length ? selected.count + ' 人' : '暂无具体专业标签') + '</span></div>' + _distributionBars(selected.majors || [], -1, '')
        : '<div class="monitor-sub-empty">选择左侧学院查看专业分布</div>';
    }
  }

  function renderAdminIdentityDistribution(content) {
    if (!content) return;
    content.innerHTML = '<div class="admin-loading">加载身份分布…</div>';
    api('/api/admin/monitoring/?section=identity').then(function(data) {
      data.selectedIndex = data.colleges && data.colleges.length ? 0 : -1;
      _identityMonitorData = data;
      var coverage = data.total_users ? Math.round(data.tagged_users / data.total_users * 100) : 0;
      content.innerHTML = '<div class="monitor-section-head"><div><h3>入站身份分布</h3>' +
        '<p>聚合统计培养层次、学院与专业；“已完整”要求三项均有值。</p></div></div>' +
        '<div class="monitor-stats-grid monitor-stats-grid--three">' +
          _monitorStat(data.total_users, '有效用户') + _monitorStat(data.tagged_users, '身份已完整', 'tone-upload') +
          _monitorStat(coverage, '身份覆盖率（%）', 'tone-download') + '</div>' +
        '<div class="identity-monitor-grid">' +
          '<section class="monitor-data-card"><div class="monitor-card-head"><h4>培养层次</h4><span>' + (data.untagged_users || 0) + ' 人未补全</span></div>' +
            _distributionBars(data.education_levels || [], -1, '') + '</section>' +
          '<section class="monitor-data-card"><div class="monitor-card-head"><h4>学院分布</h4><span>' + (data.untagged_users || 0) + ' 人未填写</span></div><div id="identityCollegeBars">' +
            _distributionBars(data.colleges || [], data.selectedIndex, 'selectIdentityCollege') + '</div></section>' +
          '<section class="monitor-data-card" id="identityMajorPanel"></section></div>';
      selectIdentityCollege(data.selectedIndex);
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">身份分布加载失败：' + esc(err.message) + '</div>';
    });
  }

  function _monitorPagination(page, totalPages, callbackName) {
    if (totalPages <= 1) return '';
    return '<div class="admin-pagination">' +
      '<button ' + (page <= 1 ? 'disabled' : 'onclick="' + callbackName + '(' + (page - 1) + ')"') + '>← 上一页</button>' +
      '<span class="page-info">第 ' + page + ' / ' + totalPages + ' 页</span>' +
      '<button ' + (page >= totalPages ? 'disabled' : 'onclick="' + callbackName + '(' + (page + 1) + ')"') + '>下一页 →</button></div>';
  }

  function monitorDownloadPage(page) {
    renderAdminDownloadStream(document.getElementById('adminUserSectionContent'), page);
  }

  function setDownloadActivity(activity) {
    _downloadActivity = activity;
    renderAdminDownloadStream(document.getElementById('adminUserSectionContent'), 1);
  }

  function _downloadActivityButtons() {
    var options = [['all', '全部'], ['download', '正式下载'], ['preview', '预览'], ['legacy', '旧记录']];
    return '<div class="pc-seg download-activity-seg" role="tablist" aria-label="文件访问行为类型">' + options.map(function(option) {
      return '<button class="pc-seg-btn' + (_downloadActivity === option[0] ? ' active' : '') + '" role="tab" aria-selected="' +
        (_downloadActivity === option[0] ? 'true' : 'false') + '" onclick="setDownloadActivity(\'' + option[0] + '\')">' + option[1] + '</button>';
    }).join('') + '</div>';
  }

  function renderAdminDownloadStream(content, page) {
    if (!content) return;
    content.innerHTML = '<div class="admin-loading">加载访问流水…</div>';
    api('/api/admin/monitoring/?section=downloads&page=' + (page || 1) + '&activity=' + encodeURIComponent(_downloadActivity)).then(function(data) {
      var items = data.items || [];
      var html = '<div class="monitor-section-head"><div><h3>文件访问流水</h3>' +
        '<p>预览与正式下载分别留痕；旧记录因历史口径无法再反推类型。</p></div><div class="monitor-stream-tools">' +
        _downloadActivityButtons() + '<span class="monitor-total-note">共 ' + (data.total || 0) + ' 条</span></div></div>';
      if (!items.length) {
        content.innerHTML = html + '<div class="admin-empty">当前筛选下暂无文件访问行为</div>';
        return;
      }
      html += '<div class="download-stream">';
      var lastDate = '';
      items.forEach(function(item) {
        if (item.date !== lastDate) {
          lastDate = item.date;
          html += '<div class="download-stream-date">' + esc(lastDate) + '</div>';
        }
        var avatar = item.avatar_url
          ? '<img src="' + esc(item.avatar_url) + '" alt="">'
          : '<span>' + esc((item.nickname || '?').charAt(0).toUpperCase()) + '</span>';
        var identity = [item.education, item.college, item.major].filter(Boolean).join(' · ');
        var material = item.can_open
          ? '<button class="download-stream-file" onclick="showFileDetail({id:' + item.material_id + ',title:\'' + escJs(item.material_title) + '\',course_code:\'' + escJs(item.course_code) + '\',course_name:\'' + escJs(item.course_name) + '\'})">' + esc(item.material_title) + '</button>'
          : '<span class="download-stream-file is-deleted">' + esc(item.material_title) + '（资料已删除）</span>';
        html += '<div class="download-stream-row">' +
          '<time>' + esc(item.created_at.slice(11)) + '</time>' +
          '<button class="download-stream-user" onclick="showUserPublic(' + item.user_id + ')">' + avatar + '<span><strong>' + esc(item.nickname) + '</strong>' +
            (identity ? '<small>' + esc(identity) + '</small>' : '<small>身份未填写</small>') + '</span></button>' +
          '<span class="download-stream-action activity-' + esc(item.activity_type || 'legacy') + '">' + esc(item.activity_label || '访问了') + '</span><div class="download-stream-target">' + material +
            '<small>' + esc(item.course_name || '课程信息缺失') + (item.course_code ? ' · ' + esc(item.course_code) : '') + '</small></div></div>';
      });
      html += '</div>' + _monitorPagination(data.page, data.total_pages, 'monitorDownloadPage');
      content.innerHTML = html;
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">访问流水加载失败：' + esc(err.message) + '</div>';
    });
  }

  function _healthStatusLabel(status) {
    if (status === 'healthy') return '运行正常';
    if (status === 'warning') return '需要关注';
    return '存在异常';
  }

  function _formatStorageSize(bytes) {
    var value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    var scaled = value / Math.pow(1024, unitIndex);
    var decimals = unitIndex >= 3 ? 1 : (scaled < 10 && unitIndex > 0 ? 1 : 0);
    return scaled.toFixed(decimals) + ' ' + units[unitIndex];
  }

  function renderAdminSiteHealth(content) {
    if (!content) return;
    content.innerHTML = '<div class="admin-loading">检查网站运行状态…</div>';
    api('/api/admin/monitoring/?section=health').then(function(data) {
      var db = data.database || {}, storage = data.storage || {}, activity = data.activity || {};
      var used = Math.max(0, Math.min(100, Number(storage.used_percent || 0)));
      content.innerHTML = '<div class="monitor-section-head"><div><h3>网站运行状态</h3><p>实时检查当前请求所在服务进程、数据库与资料存储。</p></div>' +
        '<button class="admin-btn admin-btn-secondary" onclick="renderAdminSiteHealth(document.getElementById(\'adminUserSectionContent\'))">刷新状态</button></div>' +
        '<div class="health-overall health-' + esc(data.overall) + '"><span class="health-dot"></span><div><strong>' + _healthStatusLabel(data.overall) + '</strong>' +
          '<small>检查于 ' + esc(data.checked_at) + '</small></div></div>' +
        '<div class="health-grid">' +
          '<section class="health-card"><div class="health-card-title"><span class="health-dot is-ok"></span>应用服务</div><strong>响应正常</strong><small>监测接口已成功完成本次请求</small></section>' +
          '<section class="health-card"><div class="health-card-title"><span class="health-dot ' + (db.ok ? 'is-ok' : 'is-bad') + '"></span>数据库</div><strong>' + (db.ok ? '连接正常' : '连接异常') + '</strong><small>' + esc((db.vendor || 'database').toUpperCase()) + ' · ' + (db.latency_ms == null ? '延迟未知' : db.latency_ms + ' ms') + ' · ' + _formatStorageSize(db.size_bytes || 0) + '</small></section>' +
          '<section class="health-card health-card--wide"><div class="health-card-title"><span class="health-dot ' + (storage.ok ? 'is-ok' : 'is-bad') + '"></span>资料存储</div>' +
            '<strong>' + (storage.ok ? '目录可写' : '目录不可用') + '</strong><small>剩余 ' + _formatStorageSize(storage.free_bytes || 0) + ' / ' + _formatStorageSize(storage.total_bytes || 0) + '</small>' +
            '<div class="storage-meter"><span style="width:' + used + '%"></span></div><small>已使用 ' + used + '%</small></section>' +
          '<section class="health-card health-card--wide"><div class="health-card-title"><span class="health-dot is-neutral"></span>最近活动</div>' +
            '<div class="health-activity"><span>最近上传<strong>' + esc(activity.last_upload_at || '暂无') + '</strong></span><span>最近下载<strong>' + esc(activity.last_download_at || '暂无') + '</strong></span></div></section>' +
        '</div>';
    }).catch(function(err) {
      content.innerHTML = '<div class="admin-empty">运行状态检查失败：' + esc(err.message) + '</div>';
    });
  }

  function renderAdminUserList(content, search, page) {
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
      var html = '<div class="monitor-section-head"><div><h3>用户名单</h3><p>搜索用户并配置角色、管辖板块与自动托管权限。</p></div><span class="monitor-total-note">共 ' + (resp.total || 0) + ' 人</span></div>' +
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
      html += '<div class="admin-table-card"><div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr>' +
          '<th></th><th>昵称</th><th>邮箱</th><th>角色</th><th>管辖板块</th>' + (isSuperAdmin ? '<th>自动托管</th>' : '') + '<th>资料数</th><th>下载数</th><th>预览数</th><th>注册时间</th>' +
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
        var identity = [u.education, u.college, u.major].filter(function(value) {
          return value && value !== '其他' && value !== '其它';
        }).join(' · ');
        var nameCell = '<span class="admin-user-name-stack"><a href="javascript:void(0)" class="admin-user-name" onclick="showUserPublic(' + u.id + ')" title="查看公开主页">' + escapeHtml(u.nickname) + '</a>' +
          (identity ? '<small class="admin-user-identity">' + escapeHtml(identity) + '</small>' : '') + '</span>';
        html += '<tr>' +
          '<td>' + avatarCell + '</td>' +
          '<td>' + nameCell + '</td>' +
          '<td class="td-muted">' + escapeHtml(u.email) + '</td>' +
          '<td>' + roleOptions + '</td>' +
          '<td class="td-muted">' + sections + '</td>' +
          autoApproveCell +
          '<td>' + (u.material_count || 0) + '</td>' +
          '<td>' + (u.download_count || 0) + '</td>' +
          '<td>' + (u.preview_count || 0) + '</td>' +
          '<td>' + u.date_joined + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div></div>';
      // 分页控件
      var totalPages = resp.total_pages || 1;
      if (totalPages > 1) {
        html += '<div class="admin-pagination">';
        if (_userPage > 1) {
          html += '<button onclick="renderAdminUserList(document.getElementById(\'adminUserSectionContent\'), \'' + escJs(search) + '\', ' + (_userPage - 1) + ')">← 上一页</button>';
        } else {
          html += '<button disabled>← 上一页</button>';
        }
        html += '<span class="page-info">第 ' + _userPage + ' / ' + totalPages + ' 页（共 ' + resp.total + ' 条）</span>';
        if (_userPage < totalPages) {
          html += '<button onclick="renderAdminUserList(document.getElementById(\'adminUserSectionContent\'), \'' + escJs(search) + '\', ' + (_userPage + 1) + ')">下一页 →</button>';
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
    renderAdminUserList(document.getElementById('adminUserSectionContent'), q ? q.value.trim() : '', 1);
  }

  function adminFilterUsers(value) {
    _userRoleFilter = value;
    var q = document.getElementById('adminUserSearch');
    renderAdminUserList(document.getElementById('adminUserSectionContent'), q ? q.value.trim() : '', 1);
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
        // v=181 回表格：历史异议区为 <tr>，display 用 table-row
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
