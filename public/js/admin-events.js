/* BNU Sparks · admin-events.js —— 行为账本与真实 DAU（v=300） */
(function() {
  'use strict';

  var PERIODS = [
    ['day', '今天'], ['week', '近 7 天'], ['month', '近 30 天'], ['all', '从开始记录']
  ];
  var period = 'week';
  var selectedDate = '';
  var content = null;
  var data = null;
  var requestSeq = 0;

  (function restore() {
    var state = typeof getPersistedViewState === 'function' ? getPersistedViewState() : null;
    if (!state || state.view !== 'admin') return;
    if (PERIODS.some(function(item) { return item[0] === state.adminEventsPeriod; })) period = state.adminEventsPeriod;
    if (/^\d{4}-\d{2}-\d{2}$/.test(state.adminEventsDate || '')) selectedDate = state.adminEventsDate;
  })();

  function escValue(value) {
    if (typeof esc === 'function') return esc(value == null ? '' : String(value));
    return String(value == null ? '' : value).replace(/[&<>"'`]/g, function(ch) {
      return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '`':'&#96;'}[ch];
    });
  }

  function num(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function format(value) { return num(value).toLocaleString('zh-CN'); }

  function friendlyEventLabel(row) {
    var labels = {
      '登录成功': '登录成功',
      '登录失败': '登录没成功',
      '页面打开': '打开页面',
      '执行搜索': '搜索资料',
      '搜索无结果': '搜索没有结果',
      '预览成功': '打开预览',
      '预览失败': '预览没打开',
      '下载成功': '下载资料成功',
      '下载配额拒绝': '达到每日下载上限',
      '下载失败': '下载没成功',
      '上传成功': '上传资料成功',
      '上传失败': '上传没成功',
      '课表导入成功': '导入课表成功',
      '课表导入失败': '导入课表没成功',
      '审核决定': '完成审核'
    };
    return labels[row && row.label] || labels[row && row.event_name] || (row && row.label) || '其他操作';
  }

  function persist() {
    if (typeof patchViewState === 'function') {
      patchViewState({ adminEventsPeriod: period, adminEventsDate: selectedDate });
    }
  }

  function periodControls() {
    return '<div class="behavior-console-periods" role="tablist" aria-label="查看哪段时间">' + PERIODS.map(function(item) {
      return '<button type="button" class="behavior-console-period' + (period === item[0] ? ' is-active' : '') +
        '" role="tab" aria-selected="' + (period === item[0] ? 'true' : 'false') + '" onclick="setBehaviorPeriod(\'' + item[0] + '\')">' + item[1] + '</button>';
    }).join('') + '</div>';
  }

  function metric(value, label, note, tone) {
    return '<div class="behavior-console-metric behavior-console-metric--' + (tone || 'plain') + '"><strong>' + format(value) + '</strong><span>' + escValue(label) + '</span><small>' + escValue(note || '') + '</small></div>';
  }

  function dailyChart(rows, selected) {
    if (!rows || !rows.length) return '<div class="behavior-console-empty">这段时间还没有可展示的操作记录。</div>';
    var max = Math.max(1, Math.max.apply(null, rows.map(function(row) { return num(row.all); })));
    return '<div class="behavior-console-daily-bars" role="list" aria-label="每天有多少人来过"><div class="behavior-console-axis-note">人数 · 点日期查看当天每小时</div>' + rows.map(function(row) {
      var active = row.date === selected;
      var height = Math.max(row.all ? 7 : 2, num(row.all) / max * 100);
      return '<button type="button" role="listitem" class="behavior-day-bar' + (active ? ' is-active' : '') + '" onclick="selectBehaviorDate(\'' + escValue(row.date) + '\')" aria-label="' + escValue(row.date + '，' + row.all + ' 人') + '">' +
        '<span class="behavior-day-bar-value">' + format(row.all) + '</span><span class="behavior-day-bar-fill" style="height:' + height.toFixed(1) + '%"></span><span class="behavior-day-bar-label">' + escValue(row.label) + '</span></button>';
    }).join('') + '</div>';
  }

  function dailyTable(rows, selected) {
    if (!rows || !rows.length) return '';
    return '<div class="behavior-console-daily-table"><div class="behavior-table-head"><span>日期</span><span>登录用户</span><span>匿名访客</span><span>当天活跃人数</span><span>操作次数</span></div>' + rows.slice().reverse().map(function(row) {
      return '<button type="button" class="behavior-table-row' + (row.date === selected ? ' is-active' : '') + '" onclick="selectBehaviorDate(\'' + escValue(row.date) + '\')"><span>' + escValue(row.date) + '</span><span>' + format(row.logged_in) + '</span><span>' + format(row.anonymous) + '</span><strong>' + format(row.all) + '</strong><span>' + format(row.event_count) + '</span></button>';
    }).join('') + '</div>';
  }

  function hourlyTable(rows) {
    rows = rows || [];
    return '<div class="behavior-console-hourly"><div class="behavior-table-head"><span>时间</span><span>登录用户</span><span>匿名访客</span><span>活跃人数</span><span>操作次数</span></div>' + rows.map(function(row) {
      var width = Math.min(100, num(row.all) ? Math.max(5, num(row.all) / Math.max.apply(null, rows.map(function(item) { return num(item.all); }).concat([1])) * 100) : 0);
      return '<div class="behavior-table-row"><span>' + escValue(row.hour) + '</span><span>' + format(row.logged_in) + '</span><span>' + format(row.anonymous) + '</span><strong><i class="behavior-hour-meter" style="width:' + width.toFixed(1) + '%"></i>' + format(row.all) + '</strong><span>' + format(row.event_count) + '</span></div>';
    }).join('') + '</div>';
  }

  function composition(rows) {
    if (!rows || !rows.length) return '<div class="behavior-console-empty">这段时间还没有可展示的操作类型。</div>';
    return '<div class="behavior-console-composition"><div class="behavior-table-head"><span>做了什么</span><span>涉及人数</span><span>发生次数</span></div>' + rows.map(function(row) {
      return '<div class="behavior-table-row"><span><strong>' + escValue(friendlyEventLabel(row)) + '</strong><small>按实际操作次数统计</small></span><span>' + format(row.people) + '</span><strong>' + format(row.count) + '</strong></div>';
    }).join('') + '</div>';
  }

  function renderFailure(message) {
    if (!content) return;
    content.innerHTML = '<section class="behavior-console behavior-console--failure"><div class="behavior-console-failure-mark">!</div><h3>用户活动暂时读不到</h3><p>' + escValue(message || '请稍后重试。') + '</p><button type="button" onclick="renderAdminBehaviorEvents(document.getElementById(\'adminBehaviorEventsMount\'))">重试</button></section>';
  }

  function renderEmptyState(payload) {
    return '<section class="behavior-console behavior-console--empty"><header class="behavior-console-head"><div><span class="behavior-console-eyebrow">用户活动 · 看得懂的统计</span><h2>还没有足够的活动记录</h2><p>' + escValue(payload.message || '从部署后开始记录，不补算以前的数据。') + '</p></div><div>' + periodControls() + '</div></header><div class="behavior-console-empty-block"><strong>等待第一批真实操作</strong><span>打开页面、搜索、预览、下载、上传、导入课表和审核，都会在这里留下记录。</span></div></section>';
  }

  function renderData(payload) {
    var selected = payload.selected || {};
    selectedDate = payload.selected_date || selectedDate;
    var daily = payload.daily || [];
    var dateLabel = selected.date || selectedDate || '当前日期';
    content.innerHTML = '<section class="behavior-console"><header class="behavior-console-head"><div><span class="behavior-console-eyebrow">用户活动 · 看得懂的统计</span><h2>用户最近做了什么</h2><p>当天做过至少一次操作的人数；登录用户和匿名访客分开显示。</p></div><div class="behavior-console-head-tools">' + periodControls() + '<small>选中 ' + escValue(dateLabel) + '</small></div></header>' +
      '<div class="behavior-console-rule"></div><div class="behavior-console-metrics">' +
      metric(selected.all, '当天活跃人数', '登录用户 + 匿名访客', 'primary') + metric(selected.logged_in, '登录用户', '同一个人只算一次', 'user') + metric(selected.anonymous, '匿名访客', '同一天同一访客只算一次', 'anon') + metric(selected.event_count, '操作次数', '同一人多次操作会分别计数', 'count') + '</div>' +
      '<section class="behavior-console-section"><div class="behavior-console-section-head"><div><span class="behavior-console-kicker">每天有多少人</span><h3>' + escValue(payload.period_label || '日分布') + '</h3></div><small>人数和操作次数分开显示</small></div><div class="behavior-console-daily-layout">' + dailyChart(daily, selectedDate) + dailyTable(daily, selectedDate) + '</div></section>' +
      '<section class="behavior-console-section"><div class="behavior-console-section-head"><div><span class="behavior-console-kicker">选中日期的每小时</span><h3>' + escValue(dateLabel) + ' · 每小时有多少人</h3></div><small>点上面的日期切换</small></div>' + hourlyTable(payload.hourly) + '</section>' +
      '<section class="behavior-console-section"><div class="behavior-console-section-head"><div><span class="behavior-console-kicker">做了哪些事</span><h3>大家主要做了什么</h3></div><small>人数按人去重，次数是实际操作总数</small></div>' + composition(payload.composition) + '</section>' +
      '<footer class="behavior-console-footer">详细操作记录保留 ' + format(payload.raw_retention_days || 30) + ' 天，之后只保留每天/每小时的汇总；开始记录：' + escValue(payload.launched_at || '尚未采集') + '。不保存搜索词、文件名、完整网址、原始 IP 或登录令牌。</footer></section>';
  }

  function fetchData() {
    if (!content) return;
    var seq = ++requestSeq;
    content.innerHTML = '<section class="behavior-console behavior-console--loading"><div class="behavior-console-loading-mark">···</div><h3>整理用户活动</h3><p>正在整理人数、操作次数和每小时变化。</p></section>';
    var url = '/api/admin/monitoring/?section=events&period=' + encodeURIComponent(period);
    if (selectedDate) url += '&date=' + encodeURIComponent(selectedDate);
    api(url).then(function(payload) {
      if (seq !== requestSeq || !content) return;
      data = payload || {};
      if (!data.has_events) content.innerHTML = renderEmptyState(data);
      else renderData(data);
    }).catch(function(err) {
      if (seq !== requestSeq) return;
      renderFailure(err && err.message);
    });
  }

  function setBehaviorPeriod(next) {
    if (!PERIODS.some(function(item) { return item[0] === next; })) return;
    period = next;
    selectedDate = '';
    persist();
    fetchData();
  }

  function selectBehaviorDate(next) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next || '')) return;
    selectedDate = next;
    persist();
    fetchData();
  }

  function renderAdminBehaviorEvents(target) {
    if (!target) return;
    content = target;
    fetchData();
  }

  window.renderAdminBehaviorEvents = renderAdminBehaviorEvents;
  window.setBehaviorPeriod = setBehaviorPeriod;
  window.selectBehaviorDate = selectBehaviorDate;
})();
