// ═══════════════════════════════════════════════════════════════
// 我的课表 · timetable.js
// 解析北师大教务「学生选课课程表」导出文件（GBK 编码的 HTML 伪装 .xls），
// 渲染「纸墨 × 中国色」周课表。依赖 utils.js（esc / lockScroll）。
//
// 教务文件结构（所有教务导出一致）：
//   · 标题「北京师范大学学生选课课程表」+（XXXX-XXXX学年XX学期）
//   · 学号/姓名/所在班级/选课课程门数/总学分
//   · 表头：[课程号]课程名|总学时|学分|上课班号|任课教师|上课时间、地点|修读性质|...
//   · 时间格语法：`1-16周(单) 五[7-8] 邱季端体武馆-109(30),9-16周(双) 六[11-12] 网上自学(400)`
//     即 周次段(可单/双) + 星期([一二三四五六日]，可带周/星期前缀) + [起-止节] + 教室(容量)，逗号分段
// ═══════════════════════════════════════════════════════════════

var TT_STORE_KEY = 'bnusparks_timetable_v1';
var TT_THEME_KEY = 'bnusparks_timetable_theme';

// BNU 标准作息（12 节）
var TT_PERIODS = [
  ['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['10:55', '11:40'],
  ['13:30', '14:15'], ['14:25', '15:10'], ['15:30', '16:15'], ['16:25', '17:10'],
  ['18:00', '18:45'], ['18:55', '19:40'], ['19:50', '20:35'], ['20:45', '21:30']
];
var TT_DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// 12 节 → 网格行号（1=表头，2-5=上午1-4节，6=午休，7-10=下午5-8节，11=傍晚，12-15=晚上9-12节）
var TT_ROW_OF_PERIOD = [2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15];

var ttState = { data: null, week: 1, maxWeek: 20, start: '', theme: 'light' };

// ── 解析：字节 → 文本（教务文件是 GBK；UTF-8 优先探测） ──
function ttDecodeBuffer(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch (e) { return new TextDecoder('gbk').decode(buffer); }
}

// ── 解析：HTML 文本 → { meta, courses } ──
function ttParseImport(htmlText) {
  var doc = new DOMParser().parseFromString(htmlText, 'text/html');
  var plain = (doc.body && doc.body.textContent) || '';
  var meta = { semester: '', studentName: '', studentId: '', className: '', courseCount: 0, credits: '' };
  var m;
  if ((m = plain.match(/[（(]((?:19|20)\d{2}[^（）()]*?学年[^（）()]*?学期)[）)]/))) meta.semester = m[1];
  if ((m = plain.match(/学号[:：]\s*(\S+)/))) meta.studentId = m[1];
  if ((m = plain.match(/姓名[:：]\s*(\S+)/))) meta.studentName = m[1];
  if ((m = plain.match(/所在班级[:：]\s*(\S+)/))) meta.className = m[1];
  if ((m = plain.match(/选课课程门数[:：]\s*(\d+)/))) meta.courseCount = parseInt(m[1], 10);
  if ((m = plain.match(/总学分[:：]\s*([\d.]+)/))) meta.credits = m[1];

  // 定位课程表：表头需同时含「课程名」和「上课时间」
  var table = null, col = null;
  var tables = Array.prototype.slice.call(doc.querySelectorAll('table'));
  for (var i = 0; i < tables.length && !table; i++) {
    var ths = tables[i].querySelectorAll('thead td, thead th');
    if (!ths.length) continue;
    var idx = {};
    Array.prototype.forEach.call(ths, function (td, k) {
      var lb = (td.textContent || '').replace(/\s+/g, '');
      if (lb.indexOf('课程名') >= 0) idx.name = k;
      else if (lb.indexOf('学时') >= 0) idx.hours = k;
      else if (lb.indexOf('学分') >= 0) idx.credits = k;
      else if (lb.indexOf('班号') >= 0) idx.classNo = k;
      else if (lb.indexOf('教师') >= 0) idx.teachers = k;
      else if (lb.indexOf('上课时间') >= 0 || (lb.indexOf('时间') >= 0 && lb.indexOf('地点') >= 0)) idx.time = k;
      else if (lb.indexOf('性质') >= 0) idx.nature = k;
    });
    if (idx.name !== undefined && idx.time !== undefined) { table = tables[i]; col = idx; }
  }
  if (!table) return { meta: meta, courses: [] };

  var courses = [];
  var rows = table.querySelectorAll('tbody tr');
  Array.prototype.forEach.call(rows, function (tr) {
    var tds = tr.querySelectorAll('td');
    if (tds.length <= col.name || tds.length <= col.time) return;
    var cellText = function (k) {
      if (k === undefined || !tds[k]) return '';
      // <br> 转换为分隔符再取文本，避免多行内容粘连
      var clone = tds[k].cloneNode(true);
      var brs = clone.querySelectorAll('br');
      Array.prototype.forEach.call(brs, function (br) {
        br.parentNode && br.parentNode.replaceChild(document.createTextNode(','), br);
      });
      return (clone.textContent || '').replace(/\u00a0/g, ' ').trim();
    };
    var rawName = cellText(col.name);
    if (!rawName) return;
    var parsed = ttSplitCourseName(rawName);
    if (!parsed.name) return;
    var timeRaw = cellText(col.time);
    var meetings = ttParseMeetings(timeRaw);
    courses.push({
      code: parsed.code,
      name: parsed.name,
      teachers: cellText(col.teachers).split(/[;；,，、]/).map(function (s) { return s.trim(); }).filter(Boolean),
      hours: cellText(col.hours),
      credits: cellText(col.credits),
      classNo: cellText(col.classNo),
      nature: cellText(col.nature),
      timeRaw: timeRaw,
      meetings: meetings
    });
  });
  return { meta: meta, courses: courses };
}

// 「[ECO12004]中级微观经济学」→ { code, name }
function ttSplitCourseName(raw) {
  var m = raw.match(/^\s*[\[【]?\s*([A-Za-z]{2,5}\d[A-Za-z0-9]*)\s*[\]】]?\s*(.+)$/);
  if (m) return { code: m[1], name: m[2].trim() };
  return { code: '', name: raw.trim() };
}

// 「1-16周 三[5-7] 八402(60),9-16周 二[7-8] 九304(102)」→ meetings[]
function ttParseMeetings(raw) {
  var out = [];
  String(raw || '').split(/[，,;；\n\r]+/).forEach(function (seg) {
    seg = seg.trim();
    if (!seg) return;
    var mt = ttParseMeeting(seg);
    if (mt) out.push(mt);
  });
  return out;
}

// 单段：周次段 + 星期 + [起-止节] + 教室(容量)
function ttParseMeeting(seg) {
  var s = seg.replace(/\s+/g, '');
  var m;
  var mt = { ws: 1, we: 16, parity: 0, day: 0, ps: 0, pe: 0, room: '' };

  // 周次：1-16周 / 7周 / 1-16周(单) / 1-16周（双）
  if ((m = s.match(/(\d+)(?:-(\d+))?周(?:[（(](单|双)[）)])?/))) {
    mt.ws = parseInt(m[1], 10);
    mt.we = m[2] !== undefined ? parseInt(m[2], 10) : mt.ws;
    if (mt.we < mt.ws) { var t = mt.ws; mt.ws = mt.we; mt.we = t; }
    if (m[3] === '单') mt.parity = 1;
    else if (m[3] === '双') mt.parity = 2;
  }
  var rest = s.replace(/(\d+)(?:-(\d+))?周(?:[（(](单|双)[）)])?/, '');

  // 星期：五 / 周五 / 星期五 / 天
  if ((m = rest.match(/(?:(?:周|星期)([一二三四五六日天]))|([一二三四五六日天])/))) {
    var ch = m[1] || m[2];
    mt.day = ch === '日' || ch === '天' ? 7 : '一二三四五六'.indexOf(ch) + 1;
  }

  // 节次：[7-8] / [5] / [9-11]
  if ((m = rest.match(/\[(\d+)(?:-(\d+))?\]/))) {
    mt.ps = parseInt(m[1], 10);
    mt.pe = m[2] !== undefined ? parseInt(m[2], 10) : mt.ps;
    if (mt.pe < mt.ps) { var t2 = mt.ps; mt.ps = mt.pe; mt.pe = t2; }
  }

  // 教室：] 之后的部分，剥掉尾部容量括号 (60)
  var ri = rest.indexOf(']');
  if (ri >= 0) {
    mt.room = rest.slice(ri + 1).replace(/[（(]\d+[）)]\s*$/, '').trim();
  }

  if (!mt.day || !mt.ps || mt.ps > 12) return null;
  mt.pe = Math.min(Math.max(mt.pe, mt.ps), 12);
  mt.ws = Math.max(mt.ws, 1); mt.we = Math.min(mt.we, 60);
  return mt;
}

// ── 学期第一周周一推断：秋季→9月起第一个周一；春季→次年2/22起第一个周一 ──
function ttGuessSemesterStart(semester) {
  var m = String(semester || '').match(/((?:19|20)\d{2})[^0-9]*(?:19|20)\d{2}学年(秋季|春季|第[12一二]学期)?/);
  var y = m ? parseInt(m[1], 10) : new Date().getFullYear();
  var autumn = m ? (m[2] || '').indexOf('秋') >= 0 || m[2] === '第一学期' : (new Date().getMonth() >= 7);
  function firstMonday(date) { var d = new Date(date); while (d.getDay() !== 1) d.setDate(d.getDate() + 1); return d; }
  var d = autumn ? firstMonday(new Date(y, 8, 1)) : firstMonday(new Date(y + 1, 1, 22));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function ttParseDate(s) {
  var p = String(s || '').split('-').map(function (x) { return parseInt(x, 10); });
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
}
function ttFmtDate(d) {
  return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function ttMondayOf(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var wd = x.getDay() === 0 ? 7 : x.getDay();
  x.setDate(x.getDate() - wd + 1);
  return x;
}

// ── 颜色：课程名稳定哈希 → 8 个传统色 ──
function ttCourseTone(name) {
  var h = 5381;
  for (var i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return (h % 8) + 1;
}

// ── 数据存取 ──
function ttLoadStore() {
  try {
    var raw = localStorage.getItem(TT_STORE_KEY);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (!data || !Array.isArray(data.courses)) return null;
    return data;
  } catch (e) { return null; }
}
function ttSaveStore(data) {
  try { localStorage.setItem(TT_STORE_KEY, JSON.stringify(data)); } catch (e) {}
}

// ── 视图入口（供导航/恢复调用；仅对管理员开放，与侧边栏入口同条件） ──
function showTimetable() {
  if (!currentUser || currentUser.role === 'user') { if (!currentUser) showLoginModal(); return; }
  var view = document.getElementById('timetableView');
  if (!view) return;
  document.querySelectorAll('.view-section').forEach(function (v) { v.style.display = ''; v.classList.remove('active'); });
  view.classList.add('active');
  updateSidebar('timetable');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  pushViewState('timetable', {});
  _updateFooterVisibility('timetable');
  ttInitShell();
}

function ttInitShell() {
  var shell = document.getElementById('ttShell');
  if (!shell || shell.dataset.ready) { ttRenderAll(); return; }
  shell.dataset.ready = '1';
  shell.innerHTML =
    '<div class="tt-top">' +
      '<div class="tt-title">我的课表<small id="ttSubTitle"></small></div>' +
      '<div class="tt-actions">' +
        '<button type="button" class="tt-btn is-ghost" id="ttThemeBtn" aria-label="切换浅色或墨色主题"></button>' +
        '<button type="button" class="tt-btn" id="ttReimportBtn">重新导入</button>' +
      '</div>' +
    '</div>' +
    '<div id="ttBody"></div>' +
    '<input type="file" id="ttFileInput" accept=".xls,.xlsx,.html,.htm" hidden />';

  document.getElementById('ttThemeBtn').addEventListener('click', function () {
    ttState.theme = ttState.theme === 'ink' ? 'light' : 'ink';
    try { localStorage.setItem(TT_THEME_KEY, ttState.theme); } catch (e) {}
    ttApplyTheme();
  });
  document.getElementById('ttReimportBtn').addEventListener('click', function () {
    document.getElementById('ttFileInput').click();
  });
  document.getElementById('ttFileInput').addEventListener('change', ttOnFilePicked);

  ttState.data = ttLoadStore();
  if (ttState.data && !ttState.data.courses.length) ttState.data = null;
  if (ttState.data) {
    if (!ttState.data.start) ttState.data.start = ttGuessSemesterStart(ttState.data.meta && ttState.data.meta.semester);
    ttComputeWeek();
  }
  ttState.theme = (function () { try { return localStorage.getItem(TT_THEME_KEY) || 'light'; } catch (e) { return 'light'; } })();
  ttApplyTheme();
  ttRenderAll();
}

function ttApplyTheme() {
  var shell = document.getElementById('ttShell');
  if (!shell) return;
  shell.classList.toggle('ink', ttState.theme === 'ink');
  var btn = document.getElementById('ttThemeBtn');
  if (btn) btn.textContent = ttState.theme === 'ink' ? '浅色' : '墨色';
}

function ttRenderAll() {
  var body = document.getElementById('ttBody');
  if (!body) return;
  if (!ttState.data || !ttState.data.courses.length) {
    ttRenderEmpty(body);
    return;
  }
  ttRenderGrid(body);
}

// ── 空状态：导入引导 ──
function ttRenderEmpty(body) {
  var sub = document.getElementById('ttSubTitle');
  if (sub) sub.textContent = '';
  body.innerHTML =
    '<div class="tt-empty">' +
      '<div class="glyph">课</div>' +
      '<h2>导入你的选课课表</h2>' +
      '<p>从教务系统「学生选课」导出课程表文件（.xls），在这里生成整学期的周课表。文件仅在浏览器本地解析，不会上传。</p>' +
      '<div class="steps">' +
        '<span class="step"><b>①</b> 教务系统 → 选课 → 个人课表</span>' +
        '<span class="step"><b>②</b> 导出 / 另存为「学生选课课程表」</span>' +
        '<span class="step"><b>③</b> 在这里选择该文件</span>' +
      '</div>' +
      '<button type="button" class="tt-btn primary" id="ttImportBtn">选择教务导出文件</button>' +
      '<button type="button" class="tt-btn" id="ttTutorialBtn" style="margin-left:8px">使用教程</button>' +
      '<div class="tt-error" id="ttError" role="alert"></div>' +
    '</div>';
  document.getElementById('ttImportBtn').addEventListener('click', function () {
    document.getElementById('ttFileInput').click();
  });
  document.getElementById('ttTutorialBtn').addEventListener('click', ttShowTutorial);
}

// ── 文件选择 → 解析 → 确认弹窗 ──
function ttOnFilePicked(ev) {
  var input = ev.target;
  var file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    var text = ttDecodeBuffer(reader.result);
    var parsed = ttParseImport(text);
    if (!parsed.courses.length) {
      ttShowImportError('没有识别到课程表格：请确认这是教务系统导出的「学生选课课程表」文件。');
      return;
    }
    ttShowConfirmModal(parsed);
  };
  reader.onerror = function () { ttShowImportError('文件读取失败，请重试。'); };
  reader.readAsArrayBuffer(file);
}

function ttShowImportError(msg) {
  var el = document.getElementById('ttError');
  if (el) el.textContent = msg;
  else alert(msg);
}

// ── 确认弹窗（汇总 + 课程清单） ──
function ttShowConfirmModal(parsed) {
  var meta = parsed.meta || {};
  var courses = parsed.courses;
  var existing = ttModalOverlay();
  var credits = meta.credits || courses.reduce(function (a, c) { return a + (parseFloat(c.credits) || 0); }, 0).toFixed(2);

  var rows = courses.map(function (c) {
    var tone = ttCourseTone(c.name);
    var times = c.meetings.map(function (mt) {
      return TT_DAY_NAMES[mt.day - 1] + mt.ps + '-' + mt.pe + '节';
    }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' ');
    return '<div class="tt-mrow ttp' + tone + '">' +
      '<span class="dot"></span>' +
      '<span class="nm">' + esc(c.name) + '</span>' +
      '<span class="tm">' + esc(times || '未排课') + '</span>' +
    '</div>';
  }).join('');

  existing.innerHTML =
    '<div class="tt-modal" role="dialog" aria-modal="true" aria-label="确认导入课表">' +
      '<header><h3>确认导入</h3><button type="button" class="tt-btn is-ghost" data-close aria-label="关闭">✕</button></header>' +
      '<div class="tt-mbody">' +
        '<div class="tt-msummary">' +
          (meta.studentName ? '<span><b>' + esc(meta.studentName) + '</b>' + (meta.className ? ' · ' + esc(meta.className) : '') + '</span>' : '') +
          (meta.semester ? '<span>' + esc(meta.semester) + '</span>' : '') +
          '<span><b>' + courses.length + '</b> 门课程</span>' +
          (credits ? '<span>共 <b>' + esc(String(credits)) + '</b> 学分</span>' : '') +
        '</div>' +
        '<div class="tt-mlist">' + rows + '</div>' +
      '</div>' +
      '<footer>' +
        '<button type="button" class="tt-btn" data-close>取消</button>' +
        '<button type="button" class="tt-btn primary" id="ttConfirmImport">导入并替换现有课表</button>' +
      '</footer>' +
    '</div>';

  existing.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { ttCloseModal(existing); });
  });
  existing.addEventListener('click', function (e) { if (e.target === existing) ttCloseModal(existing); });
  existing.querySelector('#ttConfirmImport').addEventListener('click', function () {
    if (!parsed.start) parsed.start = ttGuessSemesterStart(meta.semester);
    ttSaveStore(parsed);
    ttState.data = parsed;
    ttComputeWeek();
    ttCloseModal(existing);
    ttRenderAll();
  });
  lockScroll();
}

function ttModalOverlay() {
  var id = 'ttOverlay';
  var el = document.getElementById(id);
  if (el) el.remove();
  el = document.createElement('div');
  el.id = id;
  el.className = 'tt-overlay';
  document.body.appendChild(el);
  el.addEventListener('keydown', function (e) { if (e.key === 'Escape') ttCloseModal(el); });
  return el;
}
function ttCloseModal(el) {
  el = el || document.getElementById('ttOverlay');
  if (el) { el.remove(); unlockScroll(); }
}

// ── 周次计算 ──
function ttComputeWeek() {
  var data = ttState.data;
  if (!data) return;
  if (!data.start) data.start = ttGuessSemesterStart(data.meta && data.meta.semester);
  ttState.start = data.start;
  var maxM = 1;
  data.courses.forEach(function (c) {
    c.meetings.forEach(function (mt) { if (mt.we > maxM) maxM = mt.we; });
  });
  ttState.maxWeek = Math.max(maxM, 16);
  var diff = Math.floor((ttMondayOf(new Date()) - ttParseDate(ttState.start)) / (7 * 86400000)) + 1;
  ttState.week = Math.min(Math.max(diff, 1), ttState.maxWeek);
}

function ttMeetingInWeek(mt, week) {
  if (week < mt.ws || week > mt.we) return false;
  if (mt.parity === 1 && week % 2 === 0) return false;
  if (mt.parity === 2 && week % 2 === 1) return false;
  return true;
}

// ── 主网格渲染 ──
function ttRenderGrid(body) {
  var data = ttState.data;
  var meta = data.meta || {};
  var sub = document.getElementById('ttSubTitle');
  if (sub) {
    sub.textContent = (meta.semester ? meta.semester + ' · ' : '') +
      (meta.studentName ? meta.studentName + ' · ' : '') + '本地解析，仅自己可见';
  }

  body.innerHTML =
    '<div class="tt-weekbar">' +
      '<div class="tt-weeknav">' +
        '<button type="button" class="tt-wbtn" id="ttPrevW" aria-label="上一周">‹</button>' +
        '<span class="tt-week-label" id="ttWeekLabel"></span>' +
        '<button type="button" class="tt-wbtn" id="ttNextW" aria-label="下一周">›</button>' +
        '<button type="button" class="tt-now-btn" id="ttNowBtn">回到本周</button>' +
      '</div>' +
      '<label class="tt-start-edit">第一周周一 <input type="date" id="ttStartDate" value="' + esc(ttState.start) + '" /></label>' +
    '</div>' +
    '<div class="tt-scroll"><div class="tt-grid" id="ttGrid"></div></div>' +
    '<div class="tt-foot" id="ttFoot"></div>' +
    '<div id="ttUnplaced"></div>';

  document.getElementById('ttPrevW').addEventListener('click', function () { ttStepWeek(-1); });
  document.getElementById('ttNextW').addEventListener('click', function () { ttStepWeek(1); });
  document.getElementById('ttNowBtn').addEventListener('click', function () {
    ttComputeWeek();
    ttRenderGrid(body);
  });
  document.getElementById('ttStartDate').addEventListener('change', function (e) {
    var v = e.target.value;
    if (!v) return;
    ttState.start = v;
    ttState.data.start = v;
    ttSaveStore(ttState.data);
    ttComputeWeek();
    ttRenderGrid(body);
  });

  ttPaintGrid();
}

function ttStepWeek(d) {
  var next = ttState.week + d;
  if (next < 1 || next > ttState.maxWeek) return;
  ttState.week = next;
  ttPaintGrid();
}

function ttPaintGrid() {
  var grid = document.getElementById('ttGrid');
  var week = ttState.week;
  if (!grid) return;

  var startMonday = ttParseDate(ttState.start);
  var todayMonday = ttMondayOf(new Date());
  var isCurrentWeek = todayMonday.getTime() === startMonday.getTime() + (week - 1) * 7 * 86400000;
  var todayWd = (new Date().getDay() === 0 ? 7 : new Date().getDay());

  var html = '';

  // 角格：周次大数码（签名元素）
  html += '<div class="tt-corner"><b>' + week + '</b><span>周</span></div>';

  // 星期表头
  for (var d = 1; d <= 7; d++) {
    var dayDate = new Date(startMonday.getTime() + (week - 1) * 7 * 86400000 + (d - 1) * 86400000);
    var isToday = isCurrentWeek && todayWd === d;
    html += '<div class="tt-day' + (isToday ? ' is-today' : '') + '">' +
      '<span class="d">' + TT_DAY_NAMES[d - 1] + '</span>' +
      '<span class="dt">' + ttFmtDate(dayDate) + '</span>' +
      '<span class="dj">今</span>' +
    '</div>';
  }

  // 时间轴
  for (var p = 1; p <= 12; p++) {
    var rowNo = TT_ROW_OF_PERIOD[p - 1];
    html += '<div class="tt-time" style="grid-row:' + rowNo + ';grid-column:1">' +
      '<b>' + p + '</b><span>' + TT_PERIODS[p - 1][0] + '<br>' + TT_PERIODS[p - 1][1] + '</span></div>';
  }

  // 午休 / 傍晚分隔行
  html += '<div class="tt-break" style="grid-row:6"><i>午 休</i></div>';
  html += '<div class="tt-break" style="grid-row:11"><i>傍 晚</i></div>';

  // 收集本周课程 → 按 星期+起始节 分组（同格多课堆叠）
  var groups = {};
  var seenTone = {};
  var weekCourseCount = 0;
  var weekPeriodCount = 0;
  ttState.data.courses.forEach(function (c) {
    var hit = false;
    c.meetings.forEach(function (mt) {
      if (!ttMeetingInWeek(mt, week)) return;
      hit = true;
      var key = mt.day + '-' + mt.ps;
      if (!groups[key]) groups[key] = { day: mt.day, ps: mt.ps, pe: mt.pe, items: [] };
      groups[key].pe = Math.max(groups[key].pe, mt.pe);
      groups[key].items.push({ name: c.name, teachers: c.teachers, room: mt.room, code: c.code });
    });
    if (hit) weekCourseCount++;
  });

  Object.keys(groups).sort(function (a, b) {
    var ga = groups[a], gb = groups[b];
    return (ga.day - gb.day) || (ga.ps - gb.ps);
  }).forEach(function (key) {
    var g = groups[key];
    var span = g.pe - g.ps + 1;
    var rowStart = TT_ROW_OF_PERIOD[g.ps - 1];
    var isTodayCol = isCurrentWeek && todayWd === g.day;
    var cell = '<div class="tt-cell' + (isTodayCol ? ' is-today-col' : '') + '" style="grid-column:' + (g.day + 1) + ';grid-row:' + rowStart + ' / span ' + span + '">';
    g.items.forEach(function (it) {
      var tone = ttCourseTone(it.name);
      seenTone[it.name] = 1;
      var tip = it.name + (it.room ? ' · ' + it.room : '') + (it.teachers.length ? ' · ' + it.teachers.join('、') : '') +
        ' · 第' + ttState.week + '周';
      cell += '<div class="tt-card ttp' + tone + '" data-tip="' + esc(tip) + '" title="' + esc(tip) + '">' +
        '<div class="tt-card-name">' + esc(it.name) + '</div>' +
        '<div class="tt-card-meta">' +
          (it.room ? '<span class="r">' + esc(it.room) + '</span>' : '') +
          (it.teachers.length ? '<span class="t">' + esc(it.teachers.join('、')) + '</span>' : '') +
        '</div>' +
      '</div>';
      weekPeriodCount += span;
    });
    cell += '</div>';
    html += cell;
  });

  grid.innerHTML = html;

  // 周标签 + 统计
  var label = document.getElementById('ttWeekLabel');
  if (label) label.textContent = '第 ' + week + ' 周';
  var prev = document.getElementById('ttPrevW');
  var next = document.getElementById('ttNextW');
  if (prev) prev.disabled = week <= 1;
  if (next) next.disabled = week >= ttState.maxWeek;
  var foot = document.getElementById('ttFoot');
  if (foot) {
    foot.innerHTML = '<span>本周 ' + weekCourseCount + ' 门课 · ' + weekPeriodCount + ' 节</span>' +
      '<span>共 ' + ttState.data.courses.length + ' 门课程' +
      (ttState.data.meta && ttState.data.meta.credits ? ' · ' + esc(ttState.data.meta.credits) + ' 学分' : '') +
      '</span>';
  }

  // 入场动效（尊重 reduced-motion，由 CSS 关闭）
  grid.classList.remove('swap');
  void grid.offsetWidth;
  grid.classList.add('swap');
}

// ── 使用教程弹层（图文步骤，链接可点；图片仅在本弹层打开时加载） ──
function ttShowTutorial() {
  var existing = ttModalOverlay();
  var img = function (n, alt) {
    return '<img src="/static/tt_tutorial/step' + n + '.webp" alt="' + alt + '" loading="lazy" />';
  };
  existing.innerHTML =
    '<div class="tt-modal tt-tut" role="dialog" aria-modal="true" aria-label="课表导入教程">' +
      '<header><h3>课表导入教程</h3><button type="button" class="tt-btn is-ghost" data-close aria-label="关闭">✕</button></header>' +
      '<div class="tt-mbody">' +
        '<ol class="tt-steps">' +
          '<li>' +
            '<p>访问数字京师 <a href="https://one.bnu.edu.cn" target="_blank" rel="noopener noreferrer">one.bnu.edu.cn</a>，登录自己的账号，来到教务管理系统。</p>' +
            img(1, '数字京师登录页') +
          '</li>' +
          '<li>' +
            '<p>在「网上选课」里找到「我的课表」。</p>' +
            img(2, '网上选课中的我的课表入口') +
          '</li>' +
          '<li>' +
            '<p>在默认的「按列表方式显示」下点击「导出」，将生成的 xls 文件在本站上传，解析成功后自动生成你的课表；重新导入会覆盖现有课表。</p>' +
            img(3, '我的课表导出按钮') +
          '</li>' +
        '</ol>' +
        '<p class="tt-tut-note">教务导出文件仅在你自己的浏览器里解析，不会经过本站服务器。</p>' +
      '</div>' +
      '<footer><button type="button" class="tt-btn primary" data-close>知道了</button></footer>' +
    '</div>';

  existing.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { ttCloseModal(existing); });
  });
  existing.addEventListener('click', function (e) { if (e.target === existing) ttCloseModal(existing); });
  lockScroll();
}

// 调试钩子：控制台可注入任意教务 HTML 文本验证解析
function __ttLoadHtmlText(text) {
  var parsed = ttParseImport(text);
  if (!parsed.start) parsed.start = ttGuessSemesterStart(parsed.meta && parsed.meta.semester);
  ttSaveStore(parsed);
  ttState.data = parsed;
  ttComputeWeek();
  ttRenderAll();
  return parsed;
}
