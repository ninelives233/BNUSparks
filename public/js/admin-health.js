/* BNU Sparks · admin-health.js —— 运行状态只读决策面板。
 * 只消费已有上传、预览、正式下载、课表导入、审核/举报/课程申请记录；
 * 不创建埋点，不提供重启、删除、清缓存或发信等运维动作。
 */
(function() {
  'use strict';

  var PERIODS = [
    ['day', '近 24 小时'],
    ['week', '近 7 天'],
    ['month', '近 30 天']
  ];
  var _healthPeriod = 'week';
  var _healthAutoRefresh = true;
  var _healthTimer = null;
  var _healthContent = null;
  var _healthData = null;
  var _healthLastSuccess = '';
  var _healthRequest = 0;
  var _healthVisibilityBound = false;

  (function restoreHealthState() {
    var state = typeof getPersistedViewState === 'function' ? getPersistedViewState() : null;
    if (!state || state.view !== 'admin') return;
    if (PERIODS.some(function(item) { return item[0] === state.adminHealthPeriod; })) {
      _healthPeriod = state.adminHealthPeriod;
    }
    if (typeof state.adminHealthAutoRefresh === 'boolean') {
      _healthAutoRefresh = state.adminHealthAutoRefresh;
    }
  })();

  function _escape(value) {
    if (typeof esc === 'function') return esc(value == null ? '' : String(value));
    return String(value == null ? '' : value).replace(/[&<>"'`]/g, function(ch) {
      return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '`':'&#96;'}[ch];
    });
  }

  function _number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function _formatNumber(value) {
    return _number(value).toLocaleString('zh-CN');
  }

  function _formatBytes(value) {
    var bytes = _number(value);
    if (!bytes) return '尚未采集';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function _formatAge(seconds) {
    if (seconds === null || seconds === undefined || seconds === '') return '尚未采集';
    var value = Math.max(0, _number(seconds));
    if (value < 60) return '刚刚';
    if (value < 3600) return Math.floor(value / 60) + ' 分钟';
    if (value < 86400) return Math.floor(value / 3600) + ' 小时';
    return Math.floor(value / 86400) + ' 天';
  }

  function _activity(value) {
    if (!value || value === '暂无' || value === '未知') return '尚未采集';
    return String(value);
  }

  function _periodLabel(period) {
    var found = PERIODS.filter(function(item) { return item[0] === period; })[0];
    return found ? found[1] : '当前范围';
  }

  function _persist() {
    if (typeof patchViewState === 'function') {
      patchViewState({
        adminHealthPeriod: _healthPeriod,
        adminHealthAutoRefresh: _healthAutoRefresh
      });
    }
  }

  function _notify(message) {
    if (typeof showToast === 'function') {
      showToast(message);
      return;
    }
    var existing = document.querySelector('.health-console-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'health-console-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(function() { if (toast.parentNode) toast.remove(); }, 2600);
  }

  function _clearTimer() {
    if (_healthTimer) {
      window.clearInterval(_healthTimer);
      _healthTimer = null;
    }
  }

  function _canRefresh() {
    return _healthAutoRefresh && document.visibilityState !== 'hidden' &&
      _healthContent && document.body.contains(_healthContent) &&
      !!_healthContent.querySelector('.health-console');
  }

  function _startTimer() {
    _clearTimer();
    if (!_canRefresh()) return;
    _healthTimer = window.setInterval(function() {
      if (!_canRefresh()) {
        _clearTimer();
        return;
      }
      _fetchHealth(_healthContent, true);
    }, 60000);
  }

  function _bindVisibility() {
    if (_healthVisibilityBound) return;
    _healthVisibilityBound = true;
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        _clearTimer();
      } else {
        _startTimer();
      }
    });
  }

  function _stateForData(data) {
    var app = data.application || {};
    var db = data.database || {};
    var storage = data.storage || {};
    var activity = data.activity || {};
    var trend = data.trend || {};
    var labels = trend.labels || [];
    var critical = data.overall === 'critical' || app.ok === false || db.ok === false ||
      (storage.exists === false || storage.writable === false);
    if (critical) return { key: 'danger', label: '服务异常', note: '网站或资料文件夹目前读不到，请先处理基础服务。' };
    var warning = data.overall === 'warning' || db.query_ok === false || activity.ok === false;
    if (warning) return { key: 'attention', label: '需要关注', note: '网站能打开，但数据库读取或活动记录有异常。' };
    if (!labels.length || activity.recorded_users_status === 'empty') {
      return { key: 'neutral', label: '数据不足', note: '这段时间还没有足够记录，暂时不能判断活跃情况。' };
    }
    return { key: 'normal', label: '运行正常', note: '网站可以正常使用，已有记录可供核对。' };
  }

  function _stateIcon(key) {
    var symbol = key === 'danger' ? '!' : key === 'attention' ? '△' : key === 'neutral' ? '·' : '✓';
    return '<span class="health-console-state-icon health-console-state-icon--' + key + '" aria-hidden="true">' + symbol + '</span>';
  }

  function _node(label, caption, key, intent) {
    return '<button type="button" class="health-console-node health-console-node--' + key + '" data-health-intent="' + intent + '" aria-label="' + _escape(label + '：' + caption) + '">' +
      '<span class="health-console-node-mark" aria-hidden="true"></span><span class="health-console-node-copy"><strong>' + _escape(label) + '</strong><small>' + _escape(caption) + '</small></span></button>';
  }

  function _nodeState(hasData, failed, hasIssue) {
    if (failed) return 'attention';
    if (hasIssue) return 'attention';
    return hasData ? 'normal' : 'neutral';
  }

  function _metric(value, label, note) {
    return '<div class="health-console-metric"><strong>' + _formatNumber(value) + '</strong><span>' + _escape(label) + '</span>' + (note ? '<small>' + _escape(note) + '</small>' : '') + '</div>';
  }

  function _linePath(values, width, height, left, top, right, bottom, maxValue) {
    var list = Array.isArray(values) ? values : [];
    if (!list.length) return '';
    var innerW = width - left - right;
    var innerH = height - top - bottom;
    return list.map(function(value, index) {
      var x = left + (list.length === 1 ? innerW / 2 : index * innerW / (list.length - 1));
      var y = top + innerH - (_number(value) / maxValue) * innerH;
      return (index ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
  }

  function _trendChart(trend, periodLabel) {
    trend = trend || {};
    var labels = Array.isArray(trend.labels) ? trend.labels : [];
    var uploads = Array.isArray(trend.uploads) ? trend.uploads : [];
    var downloads = Array.isArray(trend.downloads) ? trend.downloads : [];
    var previews = Array.isArray(trend.previews) ? trend.previews : [];
    if (!labels.length) {
      return '<div class="health-console-empty"><span class="health-console-empty-mark" aria-hidden="true">—</span><strong>这段时间还没有上传、预览或下载记录</strong><small>这里只读取真实操作记录。</small></div>';
    }
    var width = 920, height = 250, left = 38, right = 18, top = 18, bottom = 37;
    var maxValue = Math.max(1, Math.max.apply(null, uploads.concat(downloads, previews).map(_number)));
    var grid = '';
    var tickCount = 3;
    for (var tick = 0; tick <= tickCount; tick += 1) {
      var y = top + (height - top - bottom) * tick / tickCount;
      var value = Math.round(maxValue * (tickCount - tick) / tickCount);
      grid += '<line x1="' + left + '" y1="' + y.toFixed(1) + '" x2="' + (width - right) + '" y2="' + y.toFixed(1) + '"></line>';
      grid += '<text x="' + (left - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + value + '</text>';
    }
    var labelsSvg = '';
    var step = Math.max(1, Math.ceil(labels.length / 6));
    labels.forEach(function(label, index) {
      if (index % step !== 0 && index !== labels.length - 1) return;
      var x = left + (labels.length === 1 ? (width - left - right) / 2 : index * (width - left - right) / (labels.length - 1));
      labelsSvg += '<text x="' + x.toFixed(1) + '" y="' + (height - 12) + '" text-anchor="middle">' + _escape(label) + '</text>';
    });
    return '<div class="health-console-trend-plot"><div class="health-console-legend" aria-label="趋势图例">' +
      '<span><i class="health-console-legend-dot health-console-legend-dot--upload"></i>上传</span>' +
      '<span><i class="health-console-legend-dot health-console-legend-dot--preview"></i>预览</span>' +
      '<span><i class="health-console-legend-dot health-console-legend-dot--download"></i>下载资料</span></div>' +
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + _escape(periodLabel) + '上传、预览与下载资料次数变化">' +
      '<g class="health-console-chart-grid">' + grid + labelsSvg + '</g>' +
      '<path class="health-console-chart-line health-console-chart-line--upload" d="' + _linePath(uploads, width, height, left, top, right, bottom, maxValue) + '"></path>' +
      '<path class="health-console-chart-line health-console-chart-line--preview" d="' + _linePath(previews, width, height, left, top, right, bottom, maxValue) + '"></path>' +
      '<path class="health-console-chart-line health-console-chart-line--download" d="' + _linePath(downloads, width, height, left, top, right, bottom, maxValue) + '"></path>' +
      '</svg></div>';
  }

  function _periodControls() {
    var buttons = PERIODS.map(function(item) {
      return '<button type="button" class="health-console-period' + (_healthPeriod === item[0] ? ' is-active' : '') + '" role="tab" aria-selected="' + (_healthPeriod === item[0] ? 'true' : 'false') + '" onclick="setHealthPeriod(\'' + item[0] + '\')">' + item[1] + '</button>';
    }).join('');
    return '<div class="health-console-controls"><div class="health-console-periods" role="tablist" aria-label="运行状态时间范围">' + buttons + '</div>' +
      '<label class="health-console-refresh"><input type="checkbox" ' + (_healthAutoRefresh ? 'checked' : '') + ' onchange="toggleHealthAutoRefresh(this.checked)"><span>自动刷新</span><small>60 秒</small></label></div>';
  }

  function _renderHeader(data, state, error, refreshing) {
    var last = data && (data.checked_at || _healthLastSuccess) ? (data.checked_at || _healthLastSuccess) : '';
    var alert = '';
    if (error) {
      alert = '<div class="health-console-alert health-console-alert--stale" role="status"><span>暂时读不到状态数据，先显示上一次成功读取的结果' + (last ? '（' + _escape(last) + '）' : '') + '</span><button type="button" data-health-retry>重试</button></div>';
    } else if (refreshing) {
      alert = '<div class="health-console-alert health-console-alert--refreshing" role="status">正在更新状态，原有数据仍保留…</div>';
    }
    return '<header class="health-console-head"><div><span class="health-console-eyebrow">网站状态 · 只读查看</span><h2>网站运行状态</h2><p>先看网站能不能正常工作，再看用户最近做了什么、还有哪些事情待处理。</p></div>' +
      '<div class="health-console-head-tools">' + _periodControls() + '<small class="health-console-checked">' + (last ? '最近成功读取：' + _escape(last) : '等待第一次读取') + '</small></div></header>' + alert;
  }

  function _renderDecision(data, state) {
    var trend = data.trend || {};
    var summary = trend.summary || {};
    var activity = data.activity || {};
    return '<section class="health-console-decision" aria-labelledby="health-console-decision-title"><div class="health-console-decision-main">' +
      _stateIcon(state.key) + '<div><span class="health-console-kicker">当前判断</span><h3 id="health-console-decision-title">' + _escape(state.label) + '</h3><p>' + _escape(state.note) + '</p></div></div>' +
      '<div class="health-console-metrics">' +
      _metric(summary.download_count, '下载成功', '这段时间') +
      _metric(summary.preview_count, '打开预览', '这段时间') +
      _metric(summary.upload_count, '上传资料', '这段时间') +
      _metric(activity.recorded_users, '有过记录的用户', '按人去重') +
      '</div></section>';
  }

  function _renderRails(data) {
    var app = data.application || {};
    var db = data.database || {};
    var storage = data.storage || {};
    var activity = data.activity || {};
    var trend = data.trend || {};
    var summary = trend.summary || {};
    var backlog = data.backlog || {};
    var hasVisits = _number(summary.download_count) + _number(summary.preview_count) > 0;
    var hasUploads = _number(summary.upload_count) > 0;
    var serviceDb = _nodeState(!!db.ok, !db.ok, db.query_ok === false);
    var serviceStorage = _nodeState(storage.exists && storage.writable, false, storage.exists === false || storage.writable === false);
    var userVisit = _nodeState(activity.recorded_users_status === 'available' && hasVisits, activity.ok === false, false);
    var userPreview = _nodeState(_number(summary.preview_count) > 0, activity.ok === false, false);
    var userDownload = _nodeState(_number(summary.download_count) > 0, activity.ok === false, false);
    var userUpload = _nodeState(hasUploads, activity.ok === false, false);
    var pending = _number(backlog.pending_materials) + _number(backlog.pending_reports) + _number(backlog.pending_course_requests);
    var backlogState = pending > 0 ? 'attention' : (data.backlog ? 'normal' : 'neutral');
    var rails = '<section class="health-console-rails" aria-labelledby="health-console-rails-title"><div class="health-console-section-head"><div><span class="health-console-kicker">两组检查</span><h3 id="health-console-rails-title">网站是否正常、用户最近做了什么</h3></div><span class="health-console-section-note">点开任一项可看详细说明</span></div>' +
      '<div class="health-console-rail-grid"><div class="health-console-rail"><div class="health-console-rail-title"><span>网站基础状态</span><small>网站能不能正常回应</small></div>' +
      _node('网站回应', app.ok === false ? '回应失败' : '回应正常', app.ok === false ? 'danger' : 'normal', 'application') + _node('数据库读取', db.ok ? ('约 ' + _number(db.latency_ms).toFixed(1) + ' 毫秒') : '读取失败', serviceDb, 'database') +
      _node('资料文件夹', storage.exists && storage.writable ? '存在且可写' : '不可用', serviceStorage, 'storage') +
      '</div><div class="health-console-rail"><div class="health-console-rail-title"><span>用户做过什么</span><small>只统计已有的上传、预览、下载等记录</small></div>' +
      _node('有人使用', activity.recorded_users_status === 'available' ? '已有记录' : '尚未采集', userVisit, 'visits') +
      _node('打开预览', _number(summary.preview_count) ? _formatNumber(summary.preview_count) + ' 次' : '尚未采集', userPreview, 'previews') +
      _node('下载资料', _number(summary.download_count) ? _formatNumber(summary.download_count) + ' 次' : '尚未采集', userDownload, 'downloads') +
      _node('上传资料', hasUploads ? _formatNumber(summary.upload_count) + ' 份' : '尚未采集', userUpload, 'uploads') +
      _node('待处理事项', pending ? _formatNumber(pending) + ' 件待处理' : '当前没有待办', backlogState, 'backlog') +
      '</div></div><div class="health-console-diagnostic" data-health-diagnostic role="status">点开任一项，看清楚它检查了什么、现在是什么状态。</div></section>';
    return rails;
  }

  function _renderActivity(data) {
    var activity = data.activity || {};
    var timetable = data.timetable || {};
    var summary = timetable.summary || {};
    var labels = [
      ['最近有人上传', _activity(activity.last_upload_at)],
      ['最近有人打开预览', _activity(activity.last_preview_at)],
      ['最近有人下载资料', _activity(activity.last_download_at)],
      ['最近有人导入课表', _activity(activity.last_timetable_import_at || summary.last_import_at)]
    ];
    return '<section class="health-console-evidence" aria-labelledby="health-console-evidence-title"><div class="health-console-section-head"><div><span class="health-console-kicker">最近活动</span><h3 id="health-console-evidence-title">最近发生了什么</h3></div><span class="health-console-section-note">只显示确实发生过的事情</span></div><div class="health-console-activity-grid">' +
      labels.map(function(item) { return '<div class="health-console-activity"><span>' + _escape(item[0]) + '</span><strong>' + _escape(item[1]) + '</strong><small>来自真实操作记录</small></div>'; }).join('') +
      '</div><div class="health-console-recorded"><strong>' + _formatNumber(activity.recorded_users) + '</strong><span>有过操作的用户</span><small>按人去重：在这段时间上传、预览、下载或导入过课表的人；不等于“当天活跃人数”。</small></div></section>';
  }

  function _renderBacklog(data) {
    var backlog = data.backlog || {};
    var rows = [
      ['等你审核的资料', backlog.pending_materials, 'pending_materials'],
      ['等你处理的举报', backlog.pending_reports, 'pending_reports'],
      ['等你审核的课程申请', backlog.pending_course_requests, 'pending_course_requests']
    ];
    var total = rows.reduce(function(sum, row) { return sum + _number(row[1]); }, 0);
    return '<section class="health-console-backlog" aria-labelledby="health-console-backlog-title"><div class="health-console-section-head"><div><span class="health-console-kicker">还要处理的事</span><h3 id="health-console-backlog-title">审核和待办</h3></div><span class="health-console-section-note">只显示数量和最早一条的时间</span></div><div class="health-console-backlog-list">' +
      rows.map(function(row) { return '<button type="button" class="health-console-backlog-row" data-health-intent="' + row[2] + '"><span><strong>' + _escape(row[0]) + '</strong><small>点击查看诊断口径</small></span><b>' + _formatNumber(row[1]) + '</b><span class="health-console-row-arrow" aria-hidden="true">→</span></button>'; }).join('') +
      '</div><div class="health-console-backlog-foot"><span>' + (total ? '现在共有 ' + _formatNumber(total) + ' 件待处理' : '现在没有待处理事项') + '</span><span>' + (backlog.oldest_pending_at ? '最早一件：' + _escape(backlog.oldest_pending_at) + ' · ' + _formatAge(backlog.oldest_pending_seconds) : '最早时间：尚未采集') + '</span></div></section>';
  }

  function _renderDependencies(data) {
    var db = data.database || {};
    var storage = data.storage || {};
    var app = data.application || {};
    var dbEvidence = db.ok ? ('读取约 ' + _number(db.latency_ms).toFixed(1) + ' 毫秒 · 数据库文件 ' + _formatBytes(db.size_bytes)) : '数据库暂时读不到';
    return '<section class="health-console-dependencies" aria-labelledby="health-console-dependencies-title"><div class="health-console-section-head"><div><span class="health-console-kicker">基础检查</span><h3 id="health-console-dependencies-title">网站需要的东西是否正常</h3></div><span class="health-console-section-note">这里只检查网站、数据库和资料文件夹</span></div><div class="health-console-dependency-grid">' +
      '<div class="health-console-dependency"><span class="health-console-dependency-mark health-console-dependency-mark--' + (app.ok === false ? 'danger' : 'normal') + '"></span><div><strong>网站回应</strong><small>' + (app.ok === false ? '网站没有回应' : '网站可以回应') + '</small></div></div>' +
      '<div class="health-console-dependency"><span class="health-console-dependency-mark health-console-dependency-mark--' + (db.ok ? 'normal' : 'danger') + '"></span><div><strong>数据库读取</strong><small>' + _escape(dbEvidence) + '</small></div></div>' +
      '<div class="health-console-dependency"><span class="health-console-dependency-mark health-console-dependency-mark--' + (storage.exists && storage.writable ? 'normal' : 'danger') + '"></span><div><strong>资料文件夹</strong><small>' + (storage.exists && storage.writable ? '文件夹存在且能写入' : '文件夹不存在或不能写入') + '</small></div></div>' +
      '</div></section>';
  }

  function _renderScope() {
    return '<section class="health-console-scope" aria-labelledby="health-console-scope-title"><div class="health-console-section-head"><div><span class="health-console-kicker">这页能看什么</span><h3 id="health-console-scope-title">真实用户统计已启用</h3></div><span class="health-console-section-note">只展示已经记录的事情</span></div><p>下面的“用户活动记录”会告诉你当天有多少人真正做过操作，并分开显示登录用户和匿名访客；这里不统计接口快慢排名、服务历史、磁盘分区占用、缓存、邮件或文件交付情况，也不会保存原始 IP、完整网址、搜索词、文件名或登录令牌。</p></section>';
  }

  function _bindInteractions(content, data) {
    var diagnostic = content.querySelector('[data-health-diagnostic]');
    var messages = {
      application: '网站回应：只确认网站能不能正常回应，不会在这里修改任何东西。',
      database: '数据库读取：只确认数据库能不能读到，并显示读取用了多久；不会显示 SQL 内容。',
      storage: '资料文件夹：只检查文件夹是否存在、能不能写入，不显示整块磁盘还剩多少空间。',
      visits: '有人使用：把这段时间已有的预览、下载和课表导入记录按人去重。',
      previews: '打开预览：只统计已经留下的预览记录。',
      downloads: '下载资料：只统计已经留下的下载记录。',
      uploads: '上传资料：只统计现有资料的上传时间，不额外记录新的操作。',
      timetable: '导入课表：只读取已有的导入记录；没有记录时显示“尚未采集”。',
      backlog: '待处理事项：显示等你审核的资料、举报和课程申请的数量，以及最早一件的时间。',
      pending_materials: '等你审核的资料：只统计状态为“待审核”的资料。这里不会直接执行审核。',
      pending_reports: '等你处理的举报：只统计状态为“待处理”的举报。这里不会直接处理举报。',
      pending_course_requests: '等你审核的课程申请：只统计状态为“待审核”的申请。这里不会直接处理申请。'
    };
    content.querySelectorAll('[data-health-intent]').forEach(function(node) {
      node.addEventListener('click', function() {
        var key = node.getAttribute('data-health-intent');
        if (diagnostic) diagnostic.textContent = messages[key] || '该节点只展示已有数据口径，不提供写入操作。';
      });
    });
    var retry = content.querySelector('[data-health-retry]');
    if (retry) retry.addEventListener('click', function() { _fetchHealth(content, false); });
  }

  function _renderData(content, data, error, refreshing) {
    var state = _stateForData(data);
    content.innerHTML = '<div class="health-console health-console--' + state.key + '">' + _renderHeader(data, state, error, refreshing) +
      _renderDecision(data, state) + _renderRails(data) +
      '<section class="health-console-trend" aria-labelledby="health-console-trend-title"><div class="health-console-section-head"><div><span class="health-console-kicker">上传和下载变化</span><h3 id="health-console-trend-title">' + _escape((data.trend || {}).period_label || _periodLabel(_healthPeriod)) + '</h3></div><span class="health-console-section-note">三条线显示同一段时间</span></div>' + _trendChart(data.trend, (data.trend || {}).period_label || _periodLabel(_healthPeriod)) + '</section>' +
      _renderActivity(data) + _renderBacklog(data) + _renderDependencies(data) + _renderScope() +
      '<footer class="health-console-footer">只读查看 · 最近成功读取 ' + _escape(data.checked_at || _healthLastSuccess || '尚未采集') + '</footer></div>' +
      '<div id="adminBehaviorEventsMount"></div>';
    _bindInteractions(content, data);
    if (typeof renderAdminBehaviorEvents === 'function') {
      renderAdminBehaviorEvents(document.getElementById('adminBehaviorEventsMount'));
    }
  }

  function _renderLoading(content) {
    content.innerHTML = '<div class="health-console health-console--loading"><div class="health-console-loading-mark" aria-hidden="true">···</div><h2>读取运行状态</h2><p>正在检查网站、数据库、资料文件夹和已有操作记录。</p></div>';
  }

  function _renderFailure(content, message) {
    content.innerHTML = '<div class="health-console health-console--failure"><div class="health-console-failure-mark" aria-hidden="true">!</div><h2>暂时读不到网站状态</h2><p>' + _escape(message || '暂时无法读取运行状态。') + '</p><button type="button" class="health-console-retry" data-health-retry>重试</button></div>';
    var retry = content.querySelector('[data-health-retry]');
    if (retry) retry.addEventListener('click', function() { _fetchHealth(content, false); });
  }

  function _fetchHealth(content, refreshing) {
    if (!content) return;
    var request = ++_healthRequest;
    var hasCurrent = _healthData && _healthData.period === _healthPeriod;
    if (!hasCurrent) _renderLoading(content);
    else _renderData(content, _healthData, false, true);
    api('/api/admin/monitoring/?section=health&period=' + encodeURIComponent(_healthPeriod)).then(function(data) {
      if (request !== _healthRequest) return;
      _healthData = data || {};
      _healthLastSuccess = _healthData.checked_at || new Date().toLocaleString('zh-CN');
      _renderData(content, _healthData, false, false);
      _startTimer();
    }).catch(function(err) {
      if (request !== _healthRequest) return;
      if (_healthData && _healthData.period === _healthPeriod) {
        _renderData(content, _healthData, true, false);
      } else {
        _renderFailure(content, err && err.message ? err.message : '暂时无法读取运行状态。');
      }
      _startTimer();
    });
  }

  function setHealthPeriod(period) {
    if (!PERIODS.some(function(item) { return item[0] === period; })) return;
    _healthPeriod = period;
    _healthData = null;
    _persist();
    _fetchHealth(_healthContent || document.getElementById('adminUserSectionContent'), false);
  }

  function toggleHealthAutoRefresh(value) {
    _healthAutoRefresh = typeof value === 'boolean' ? value : !_healthAutoRefresh;
    _persist();
    if (_healthContent && _healthData) _renderData(_healthContent, _healthData, false, false);
    if (_healthAutoRefresh) {
      _startTimer();
    } else {
      _clearTimer();
    }
  }

  function renderAdminSiteHealth(content) {
    if (!content) return;
    _healthContent = content;
    _bindVisibility();
    _fetchHealth(content, false);
  }

  window.renderAdminSiteHealth = renderAdminSiteHealth;
  window.setHealthPeriod = setHealthPeriod;
  window.toggleHealthAutoRefresh = toggleHealthAutoRefresh;
})();
