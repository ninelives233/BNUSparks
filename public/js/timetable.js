// ═══════════════════════════════════════════════════════════════
// 我的课表 · timetable.js
// 解析北师大教务「学生选课课程表」导出文件（GBK 编码的 HTML 伪装 .xls），
// 渲染「纸墨 × 中国色」周课表。依赖 utils.js（esc / api / lockScroll）、
// explorer-core.js（courseTree / findPathByCourseId / navToLast）、
// views.js（showExplorer / switchView）。
//
// 教务文件结构（所有教务导出一致）：
//   · 标题「北京师范大学学生选课课程表」+（XXXX-XXXX学年XX学期）
//   · 学号/姓名/所在班级/选课课程门数/总学分
//   · 表头：[课程号]课程名|总学时|学分|上课班号|任课教师|上课时间、地点|修读性质|...
//   · 时间格语法：`1-16周(单) 五[7-8] 邱季端体武馆-109(30),9-16周(双) 六[11-12] 网上自学(400)`
//     即 周次段(可单/双) + 星期([一二三四五六日]，可带周/星期前缀) + [起-止节] + 教室(容量)，逗号分段
//
// 课程链接：导入时保留课程代码（不展示）。每门课通过代码在课程树中定位：
//   · 已建课 → 卡片可点击，按用户身份标签优先从对应课程树入口跳到资料列表
//   · 未建课 → 导入确认时由用户选择位置（GEN* 归通识课选分类；其余归专业课
//     选学院+层级），确认后自动提交新课程申请，批准前点击不可跳转
// ═══════════════════════════════════════════════════════════════

// 课表数据按账号隔离存储（此前用全局 key，同一浏览器换账号会看到别人的课表）
function ttStoreKey() {
  return 'bnusparks_timetable_v1_u' + (currentUser && currentUser.id ? currentUser.id : 'anon');
}
function ttSchemeKey() {
  return 'bnusparks_timetable_scheme_u' + (currentUser && currentUser.id ? currentUser.id : 'anon');
}
// 视图偏好（课表网格 / 课程列表）同样按账号本地记忆，不随云端同步（设备级 UI 偏好）
function ttViewKey() {
  return 'bnusparks_timetable_view_u' + (currentUser && currentUser.id ? currentUser.id : 'anon');
}

// 配色方案（默认「暖秋」即 CSS 基础变量；均为暖色系衍生，仅色相倾向不同）
var TT_SCHEMES = [
  { id: 'zhongguo', name: '暖秋' },
  { id: 'nuan',     name: '海棠' },
  { id: 'qing',     name: '蜜茶' },
  { id: 'zi',       name: '绛纱' }
];

// BNU 标准作息（12 节）
var TT_PERIODS = [
  ['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['10:55', '11:40'],
  ['13:30', '14:15'], ['14:25', '15:10'], ['15:30', '16:15'], ['16:25', '17:10'],
  ['18:00', '18:45'], ['18:55', '19:40'], ['19:50', '20:35'], ['20:45', '21:30']
];
var TT_DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// 12 节 → 网格行号（1=表头，2-5=上午1-4节，6=午休，7-10=下午5-8节，11=傍晚，12-15=晚上9-12节）
var TT_ROW_OF_PERIOD = [2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15];

var ttState = { data: null, week: 1, maxWeek: 20, start: '', scheme: 'zhongguo', view: 'grid', editing: false, links: {} };

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

// ── 颜色：课程名稳定哈希 → 8 个色相 ──
function ttCourseTone(name) {
  var h = 5381;
  for (var i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return (h % 8) + 1;
}

// ── 数据存取 ──
// 兼容迁移：早期版本用全局 key（同一浏览器多账号互相可见），此处仅在
// 文件内学号与当前账号一致时迁入账号专属 key，否则忽略不迁移
function ttMigrateLegacyStore() {
  try {
    var raw = localStorage.getItem('bnusparks_timetable_v1');
    if (!raw || !currentUser) return;
    var data = JSON.parse(raw);
    if (data && data.meta && data.meta.studentId &&
        String(data.meta.studentId) === String(currentUser.username)) {
      localStorage.setItem(ttStoreKey(), raw);
      localStorage.removeItem('bnusparks_timetable_v1');
    }
  } catch (e) {}
}

function ttLoadStore() {
  try {
    var raw = localStorage.getItem(ttStoreKey());
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (!data || !Array.isArray(data.courses)) return null;
    if (!data.pendingCodes || typeof data.pendingCodes !== 'object') data.pendingCodes = {};
    return data;
  } catch (e) { return null; }
}
function ttSaveStore(data) {
  try { localStorage.setItem(ttStoreKey(), JSON.stringify(data)); } catch (e) {}
}

// ── 云端同步：课表数据（解析结果，不含文件）随账号跨设备 ──
// 冲突规则：本地与云端按 importedAt 取较新者；仅一方有时直接采用并补齐另一方
function ttSyncUpload() {
  if (!ttState.data || typeof api !== 'function') return;
  api('/api/user/timetable/', { method: 'PUT', body: { data: ttState.data } })
    .then(function () { ttState.cloudSynced = true; })
    .catch(function () {
      ttState.cloudSynced = false;
      ttToast('课表云端同步失败，本次改动仅保存在本机');
    });
}

function ttSyncPull() {
  if (typeof api !== 'function') return;
  var uidAtCall = ttState.uid;
  api('/api/user/timetable/').then(function (res) {
    // 请求期间切换了账号：丢弃结果
    if (ttState.uid !== uidAtCall) return;
    var cloud = (res && res.data) ? res.data : null;
    if (!cloud || !Array.isArray(cloud.courses)) {
      // 云端为空：本地有则推上去
      if (ttState.data) ttSyncUpload();
      return;
    }
    if (!cloud.pendingCodes || typeof cloud.pendingCodes !== 'object') cloud.pendingCodes = {};
    var local = ttState.data;
    var localAt = local ? (local.importedAt || 0) : -1;
    var cloudAt = cloud.importedAt || 0;
    if (cloudAt >= localAt) {
      // 云端较新（或本地没有）→ 采用云端
      ttState.data = cloud;
      if (!ttState.data.start) ttState.data.start = ttGuessSemesterStart(ttState.data.meta && ttState.data.meta.semester);
      ttSaveStore(ttState.data);
      ttComputeWeek();
      ttApplyScheme();
      ttRenderAll();
      // 关键：ttLoadUserData 里检查 data 时云端还没回来（本地为 null）会跳过
      // 树预载，这里补上，否则链接永远解析不了（全部误显「未建目录」且点击无效）
      ttEnsureCourseTree();
    } else {
      // 本地较新 → 推云端
      ttSyncUpload();
    }
  }).catch(function () {});
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
  if (!shell) return;
  if (shell.dataset.ready) {
    // 同一页面内切换账号（登出再登录）：按新账号重载数据与配色
    if (ttState.uid !== (currentUser ? currentUser.id : null)) ttLoadUserData();
    else {
      ttMigrateLegacyStore();
      ttRenderAll();
      if (ttState.data) ttEnsureCourseTree(); // 上次树加载失败时借重开视图重试
    }
    return;
  }
  shell.dataset.ready = '1';
  shell.innerHTML =
    '<div class="tt-top">' +
      '<div class="tt-title">我的课表<small id="ttSubTitle"></small></div>' +
      '<div class="tt-actions">' +
        '<button type="button" class="tt-btn" id="ttSchemeBtn" aria-haspopup="true" aria-expanded="false">配色</button>' +
        '<button type="button" class="tt-btn" id="ttEditBtn" aria-pressed="false">编辑</button>' +
        '<button type="button" class="tt-btn" id="ttReimportBtn">重新导入</button>' +
      '</div>' +
    '</div>' +
    '<div class="tt-viewbar">' +
      '<div class="pc-seg" id="ttViewSeg" role="tablist" aria-label="视图切换">' +
        '<button type="button" class="pc-seg-btn" data-view="grid" aria-pressed="true">周课表</button>' +
        '<button type="button" class="pc-seg-btn" data-view="list" aria-pressed="false">课程列表</button>' +
      '</div>' +
    '</div>' +
    '<div id="ttBody"></div>' +
    '<input type="file" id="ttFileInput" accept=".xls,.xlsx,.html,.htm" hidden />';

  document.getElementById('ttSchemeBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    ttToggleSchemePop();
  });
  document.getElementById('ttViewSeg').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-view]');
    if (!btn) return;
    ttSetView(btn.getAttribute('data-view'));
  });
  document.getElementById('ttEditBtn').addEventListener('click', ttToggleEdit);
  document.getElementById('ttReimportBtn').addEventListener('click', function () {
    document.getElementById('ttFileInput').click();
  });
  document.getElementById('ttFileInput').addEventListener('change', ttOnFilePicked);

  ttLoadUserData();
}

// 按当前账号载入课表数据与配色（账号切换时重新调用）
function ttLoadUserData() {
  ttState.uid = currentUser ? currentUser.id : null;
  ttState.editing = false;
  ttApplyEditMode();
  ttMigrateLegacyStore();
  ttState.data = ttLoadStore();
  if (ttState.data && !ttState.data.courses.length) ttState.data = null;
  if (ttState.data) {
    if (!ttState.data.start) ttState.data.start = ttGuessSemesterStart(ttState.data.meta && ttState.data.meta.semester);
    ttComputeWeek();
  }
  try {
    ttState.scheme = localStorage.getItem(ttSchemeKey()) ||
      localStorage.getItem('bnusparks_timetable_scheme') || 'zhongguo';
    if (localStorage.getItem(ttSchemeKey()) === null && localStorage.getItem('bnusparks_timetable_scheme')) {
      localStorage.setItem(ttSchemeKey(), ttState.scheme);
      localStorage.removeItem('bnusparks_timetable_scheme');
    }
  } catch (e) { ttState.scheme = 'zhongguo'; }
  try { ttState.view = localStorage.getItem(ttViewKey()) === 'list' ? 'list' : 'grid'; }
  catch (e) { ttState.view = 'grid'; }
  ttApplyScheme();
  ttApplyViewMode();
  ttRenderAll();
  if (ttState.data) {
    // 课程树未就绪时加载并解析链接（树有内存单例缓存，失败后重开视图会重试）
    ttEnsureCourseTree();
    // 预热课程浏览器懒加载脚本：点课程卡直达资料列表时无需现场下载
    if (typeof ensureFeature === 'function') {
      ensureFeature('explorer').catch(function () {});
    }
  }
  // 云端同步：拉取账号下的课表，按 importedAt 合并（跨设备）
  ttSyncPull();
}

function ttApplyScheme() {
  var shell = document.getElementById('ttShell');
  if (!shell) return;
  TT_SCHEMES.forEach(function (s) { shell.classList.remove('tt-sch-' + s.id); });
  if (ttState.scheme && ttState.scheme !== 'zhongguo') shell.classList.add('tt-sch-' + ttState.scheme);
}

// ── 视图切换：周课表 ⇄ 课程列表（分段控件 .pc-seg，样式同 v4 原型） ──
// shell 上的模式类供移动端满屏布局区分网格/列表
function ttApplyViewMode() {
  var shell = document.getElementById('ttShell');
  var seg = document.getElementById('ttViewSeg');
  if (shell) shell.classList.toggle('tt-mode-list', ttState.view === 'list');
  if (seg) {
    seg.querySelectorAll('[data-view]').forEach(function (b) {
      var on = b.getAttribute('data-view') === ttState.view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
}

function ttSetView(view) {
  if (view !== 'grid' && view !== 'list') return;
  if (view === ttState.view) return;
  ttState.view = view;
  try { localStorage.setItem(ttViewKey(), ttState.view); } catch (e) {}
  ttApplyViewMode();
  ttRenderAll();
}

// ── 编辑模式（参照 APK「开启编辑/完成编辑」）：编辑态下点击课程=编辑、点空格=新增 ──
function ttApplyEditMode() {
  var shell = document.getElementById('ttShell');
  var btn = document.getElementById('ttEditBtn');
  if (shell) shell.classList.toggle('tt-editing', !!ttState.editing);
  if (btn) {
    btn.textContent = ttState.editing ? '完成' : '编辑';
    btn.setAttribute('aria-pressed', ttState.editing ? 'true' : 'false');
    btn.classList.toggle('is-active', !!ttState.editing);
  }
}

function ttToggleEdit() {
  ttState.editing = !ttState.editing;
  if (ttState.editing && ttEnsureIds()) {
    // 存量数据补课程 id（编辑/删除/配色的定位键），顺带版本化并同步
    ttSaveStore(ttState.data);
    ttSyncUpload();
  }
  ttApplyEditMode();
  ttRenderAll();
}

// 稳定 id：'ttc' + 时间戳36进制 + 两位随机；只增不改
function ttNewId() {
  return 'ttc' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

function ttEnsureIds() {
  var data = ttState.data;
  if (!data) return false;
  var changed = false;
  data.courses.forEach(function (c) {
    if (!c.id) { c.id = ttNewId(); changed = true; }
  });
  if (changed) data.importedAt = Date.now();
  return changed;
}

// 课程色相：手动覆盖优先，否则按名称哈希（暖冷两套色相成对跟随覆盖）
function ttToneOf(course) {
  return (course && course.color) ? course.color : ttCourseTone(course ? course.name : '');
}

function ttToggleSchemePop() {
  var actions = document.querySelector('#ttShell .tt-actions');
  var exist = document.getElementById('ttSchemePop');
  if (exist) { exist.remove(); return; }
  var pop = document.createElement('div');
  pop.id = 'ttSchemePop';
  pop.className = 'tt-scheme-pop';
  pop.innerHTML = TT_SCHEMES.map(function (s) {
    var hueShift = { zhongguo: [28, 48, 68, 15], nuan: [355, 20, 40, 5], qing: [55, 75, 95, 40], zi: [0, 18, 340, 8] }[s.id] || [28, 48, 68, 15];
    var dots = hueShift.map(function (h) {
      return '<i style="background:oklch(0.86 0.07 ' + h + ')"></i>';
    }).join('');
    return '<button type="button" class="tt-sch-opt' + (ttState.scheme === s.id ? ' is-active' : '') + '" data-scheme="' + s.id + '">' +
      '<span class="tt-sch-dots">' + dots + '</span>' + s.name + '</button>';
  }).join('');
  actions.appendChild(pop);
  pop.addEventListener('click', function (e) {
    var opt = e.target.closest('[data-scheme]');
    if (!opt) return;
    ttState.scheme = opt.getAttribute('data-scheme');
    try { localStorage.setItem(ttSchemeKey(), ttState.scheme); } catch (err) {}
    ttApplyScheme();
    ttToggleSchemePop();
  });
  // 点击其他区域关闭
  setTimeout(function () {
    document.addEventListener('click', function close(e2) {
      if (pop.isConnected && !pop.contains(e2.target)) { pop.remove(); document.removeEventListener('click', close); }
    });
  }, 0);
}

function ttRenderAll() {
  var body = document.getElementById('ttBody');
  if (!body) return;
  if (!ttState.data || !ttState.data.courses.length) {
    if (ttState.editing) ttRenderEditEmpty(body);
    else ttRenderEmpty(body);
    return;
  }
  if (ttState.view === 'list') ttRenderList(body);
  else ttRenderGrid(body);
}

// 编辑模式下的空课表：不推导入，改推手动建课（课表本质是课程列表）
function ttRenderEditEmpty(body) {
  var sub = document.getElementById('ttSubTitle');
  if (sub) sub.textContent = '';
  body.innerHTML =
    '<div class="tt-empty">' +
      '<div class="glyph">编</div>' +
      '<h2>手动建立课程列表</h2>' +
      '<p>逐门添加课程：填名称和上课时间即可，不依赖教务导出文件。填了课程代码的课程会自动链接到资料目录，未建目录的可提交建课申请。</p>' +
      '<button type="button" class="tt-btn primary" id="ttManualAddBtn">＋ 添加课程</button>' +
      '<button type="button" class="tt-btn" id="ttTutorialBtn2" style="margin-left:8px">改用教务导入</button>' +
    '</div>';
  document.getElementById('ttManualAddBtn').addEventListener('click', function () { ttOpenCourseEditor(null); });
  document.getElementById('ttTutorialBtn2').addEventListener('click', ttShowTutorial);
}

// ── 空状态：导入引导 ──
function ttRenderEmpty(body) {
  var sub = document.getElementById('ttSubTitle');
  if (sub) sub.textContent = '';
  body.innerHTML =
    '<div class="tt-empty">' +
      '<div class="glyph">课</div>' +
      '<h2>导入你的选课课表</h2>' +
      '<p>从教务系统「学生选课」导出课程表文件（.xls），在这里生成整学期的周课表。文件仅在浏览器本地解析，课表数据会同步到你的账号，仅自己可见。</p>' +
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

// ── 课程目录匹配：code → { state: linked|pending|missing, path?, fileCount? } ──

// 课程树是否就绪（树加载失败时 _loadCourseTree 会置空对象 {}，同样视为未就绪）
function ttTreeReady() {
  return !!(courseTree && Object.keys(courseTree).length);
}

// 确保课程树就绪后解析链接并重绘当前视图。
// 自愈入口：云端拉取课表后 / 树加载失败后 / 用户点击时树尚未就绪，
// 都会走到这里重新拉树（loadCourseTree 失败会清掉内部缓存 Promise，可重试）
function ttEnsureCourseTree() {
  if (ttTreeReady()) {
    ttResolveCourseLinks();
    ttRepaintCurrent();
    return Promise.resolve();
  }
  if (typeof loadCourseTree !== 'function') return Promise.resolve();
  ttState._treeTryAt = Date.now();
  return loadCourseTree().then(function () {
    ttResolveCourseLinks();
    ttRepaintCurrent();
  }).catch(function () {});
}

// 区段课程代码匹配：目录节点 courseId 形如「GEN09001-GEN09008」（或 GEN09001-008）
function ttInRange(rangeId, code) {
  var m = String(rangeId || '').match(/^([A-Za-z]+)(\d+)\s*-\s*([A-Za-z]*)(\d+)$/);
  if (!m) return false;
  if (m[3] && m[3] !== m[1]) return false;
  var a = parseInt(m[2], 10);
  var bRaw = m[4];
  var b = (bRaw.length <= m[2].length)
    ? parseInt(m[2].slice(0, m[2].length - bRaw.length) + bRaw, 10)
    : parseInt(bRaw, 10);
  var cm = code.match(/^([A-Za-z]+)(\d+)$/);
  if (!cm || cm[1] !== m[1]) return false;
  var n = parseInt(cm[2], 10);
  return n >= a && n <= b;
}

// 课表专用目录查找：精确代码 → 区段代码 → 「形势与政策」系列名称特例
// （凡课名以「形势与政策」开头，不论代码尾号，统一指向同名目录）。
// 多个匹配时与搜索一致：本人专业 → 本人学院 → 默认首条。
function ttFindPathByCode(code, courseName) {
  if (!courseTree) return null;
  var matches = [];
  function walk(nodes, path) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var hit = (n.courseId === code) ||
        (n.courseId && String(n.courseId).indexOf('-') >= 0 && ttInRange(n.courseId, code));
      // 特例：形势与政策系列 → 同名目录（仅认叶子条目，不误挂到同名分类）
      if (!hit && courseName && courseName.indexOf('形势与政策') === 0 &&
          /GEN09/.test(code) && n.name && n.name.indexOf('形势与政策') === 0 && !n.children) {
        hit = true;
      }
      if (hit) matches.push(path.concat(n.name));
      if (n.children) walk(n.children, path.concat(n.name));
    }
  }
  Object.keys(courseTree).forEach(function (key) {
    if (courseTree[key] && courseTree[key].children) walk(courseTree[key].children, [key]);
  });
  if (!matches.length) return null;
  var idMaj = currentUser && currentUser.identity_major;
  var idCol = currentUser && currentUser.identity_college;
  if (idMaj || idCol) {
    for (var m = 0; m < matches.length; m++) {
      var p = matches[m];
      if (p[0] === '专业课' && idMaj && p.length >= 4 && p[2] === idMaj) return p;
    }
    for (var n2 = 0; n2 < matches.length; n2++) {
      var q = matches[n2];
      if (q[0] === '专业课' && idCol && q.length >= 3 && q[1] === idCol) return q;
    }
  }
  return matches[0];
}

function ttResolveCourseLinks() {
  var map = {};
  ttState.links = map;
  // 树未就绪（含加载失败置 {}）时保持链接表为空：UI 显示「加载中」而非误报「未建目录」
  if (!ttState.data || !ttTreeReady()) return map;
  ttState.data.courses.forEach(function (c) {
    if (!c.code || map[c.code]) return;
    var path = ttFindPathByCode(c.code, c.name);
    if (path) {
      var node = ttNodeByPath(path);
      map[c.code] = {
        state: 'linked', path: path, type: path[0],
        fileCount: node && typeof node.fileCount === 'number' ? node.fileCount : null
      };
    } else {
      map[c.code] = { state: (ttState.data.pendingCodes && ttState.data.pendingCodes[c.code]) ? 'pending' : 'missing' };
    }
  });
  return map;
}

function ttNodeByPath(path) {
  if (!courseTree || !path || !path.length) return null;
  var node = courseTree[path[0]];
  for (var i = 1; node && i < path.length; i++) {
    var next = null;
    if (node.children) {
      for (var j = 0; j < node.children.length; j++) {
        if (node.children[j].name === path[i]) { next = node.children[j]; break; }
      }
    }
    node = next;
  }
  return node;
}

function ttCourseNameByCode(code) {
  var c = ttState.data && ttState.data.courses.find(function (x) { return x.code === code; });
  return c ? c.name : code;
}

// ── 确认弹窗（汇总 + 课程清单 + 未建课位置选择） ──
function ttShowConfirmModal(parsed) {
  // 课程树用于判断已建课 / 提供位置选择；失败时降级为纯导入。
  // 先清 api() 内存缓存（树 TTL 10 分钟），保证已建课判定是新鲜的
  if (typeof clearApiCache === 'function') clearApiCache('/api/courses/tree/');
  var ready = (typeof loadCourseTree === 'function') ? Promise.resolve(loadCourseTree()).catch(function () {}) : Promise.resolve();
  ready.then(function () { ttRenderConfirmModal(parsed); });
}

function ttRenderConfirmModal(parsed) {
  var meta = parsed.meta || {};
  var courses = parsed.courses;
  var existing = ttModalOverlay();
  var credits = meta.credits || courses.reduce(function (a, c) { return a + (parseFloat(c.credits) || 0); }, 0).toFixed(2);

  // 按代码去重判断建课状态（含区段目录与形势与政策特例）
  var statusByCode = {};
  courses.forEach(function (c) {
    if (!c.code || statusByCode[c.code]) return;
    statusByCode[c.code] = ttFindPathByCode(c.code, c.name) ? 'linked' : 'missing';
  });
  var missing = courses.filter(function (c) { return c.code && statusByCode[c.code] === 'missing'; });
  var genCount = missing.filter(function (c) { return /^GEN/i.test(c.code); }).length;

  var locRendered = {};
  var rows = courses.map(function (c) {
    var tone = ttCourseTone(c.name);
    var times = c.meetings.map(function (mt) {
      return TT_DAY_NAMES[mt.day - 1] + mt.ps + '-' + mt.pe + '节';
    }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' ');
    var st = c.code ? statusByCode[c.code] : null;
    var extra = '';
    if (st === 'linked') {
      extra = '<span class="tt-ok-tag">✓ 已有目录</span>';
    } else if (st === 'missing' && !locRendered[c.code]) {
      locRendered[c.code] = true;
      extra = ttLocationControls(c);
    }
    return '<div class="tt-mrow ttp' + tone + '">' +
      '<span class="dot"></span>' +
      '<span class="nm">' + esc(c.name) + '</span>' +
      extra +
      '<span class="tm">' + esc(times || '未排课') + '</span>' +
    '</div>';
  }).join('');

  existing.innerHTML =
    '<div class="tt-modal tt-tut" role="dialog" aria-modal="true" aria-label="确认导入课表">' +
      '<header><h3>确认导入</h3><button type="button" class="tt-btn is-ghost" data-close aria-label="关闭">✕</button></header>' +
      '<div class="tt-mbody">' +
        '<div class="tt-msummary">' +
          (meta.studentName ? '<span><b>' + esc(meta.studentName) + '</b>' + (meta.className ? ' · ' + esc(meta.className) : '') + '</span>' : '') +
          (meta.semester ? '<span>' + esc(meta.semester) + '</span>' : '') +
          '<span><b>' + courses.length + '</b> 门课程</span>' +
          (credits ? '<span>共 <b>' + esc(String(credits)) + '</b> 学分</span>' : '') +
        '</div>' +
        '<div class="tt-privacy-note">🔒 本地解析，仅自己可见：文件本身不会上传；解析出的课表数据会同步到你的账号，换设备登录即可查看。</div>' +
        (ttState.data && ttState.data.courses.length
          ? '<div class="tt-privacy-note">⚠ 导入将整表覆盖现有课表（含手动编辑和手动添加的课程）。</div>'
          : '') +
        (missing.length
          ? '<div class="tt-privacy-note">ℹ 有 <b>' + missing.length + '</b> 门课程尚未建立资料目录' +
            '（通识 ' + genCount + ' 门）。请为它们选择位置，导入后将自动提交新课程申请，管理员批准前点击课程不会跳转。</div>'
          : '<div class="tt-privacy-note">✓ 全部课程都已建立资料目录，导入后点击课程卡即可直达资料列表。</div>') +
        '<div class="tt-mlist">' + rows + '</div>' +
      '</div>' +
      '<footer>' +
        '<button type="button" class="tt-btn" data-close>取消</button>' +
        '<button type="button" class="tt-btn primary" id="ttConfirmImport">导入课表' +
          (missing.length ? '（并申请建课 ' + missing.length + ' 门）' : '') + '</button>' +
      '</footer>' +
    '</div>';

  existing.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { ttCloseModal(existing); });
  });
  existing.addEventListener('click', function (e) { if (e.target === existing) ttCloseModal(existing); });

  // 学院变更 → 级联刷新层级下拉
  existing.querySelectorAll('select[data-role="college"]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var catSel = existing.querySelector('select[data-role="cat"][data-code="' + sel.getAttribute('data-code') + '"]');
      if (catSel) ttFillCategoryOptions(catSel, sel.value);
    });
  });

  existing.querySelector('#ttConfirmImport').addEventListener('click', function () {
    var requests = [];
    var unchosen = 0;
    missing.forEach(function (c) {
      var isGen = /^GEN/i.test(c.code);
      if (isGen) {
        var sel = existing.querySelector('select[data-role="gen"][data-code="' + c.code + '"]');
        if (sel && sel.value) {
          requests.push({ code: c.code, body: { course_type: 'general', course_name: c.name, course_code: c.code, general_category_id: parseInt(sel.value, 10) } });
        } else unchosen++;
      } else {
        var colSel = existing.querySelector('select[data-role="college"][data-code="' + c.code + '"]');
        var catSel = existing.querySelector('select[data-role="cat"][data-code="' + c.code + '"]');
        if (colSel && colSel.value && catSel && catSel.value) {
          requests.push({ code: c.code, body: { course_type: 'major', course_name: c.name, course_code: c.code, college_id: parseInt(colSel.value, 10), target_category_id: parseInt(catSel.value, 10) } });
        } else unchosen++;
      }
    });
    if (unchosen) {
      ttToast('还有 ' + unchosen + ' 门未建课程未选择位置，选择后才能导入');
      return;
    }
    if (!parsed.pendingCodes || typeof parsed.pendingCodes !== 'object') parsed.pendingCodes = {};
    ttApplyImport(parsed, requests);
  });
  lockScroll();
}

// 未建课课程的位置选择控件（GEN→通识分类；其余→学院+层级）
function ttLocationControls(course) {
  var codeAttr = esc(course.code);
  if (/^GEN/i.test(course.code)) {
    var cats = (courseTree && courseTree['通识课'] && courseTree['通识课'].children || [])
      .filter(function (n) { return n.id && !n.divider; });
    var opts = cats.map(function (n) {
      return '<option value="' + n.id + '">' + esc(n.name) + '</option>';
    }).join('');
    return '<span class="loc"><select class="tt-loc-sel" data-role="gen" data-code="' + codeAttr + '">' +
      '<option value="">选择通识分类…</option>' + opts + '</select></span>';
  }
  var colleges = (courseTree && courseTree['专业课'] && courseTree['专业课'].children || [])
    .filter(function (n) { return n.id; });
  var colOpts = colleges.map(function (n) {
    return '<option value="' + (n.collegeId || '') + '" data-node="' + n.id + '">' + esc(n.name) + '</option>';
  }).join('');
  return '<span class="loc">' +
    '<select class="tt-loc-sel" data-role="college" data-code="' + codeAttr + '">' +
      '<option value="">选择学院…</option>' + colOpts + '</select>' +
    '<select class="tt-loc-sel" data-role="cat" data-code="' + codeAttr + '">' +
      '<option value="">先选学院…</option></select>' +
  '</span>';
}

function ttFillCategoryOptions(sel, collegeId) {
  var colleges = (courseTree && courseTree['专业课'] && courseTree['专业课'].children || []);
  var college = colleges.find(function (n) { return String(n.collegeId || '') === String(collegeId); });
  var cats = (college && college.children || []).filter(function (n) { return n.id && !n.divider; });
  sel.innerHTML = '<option value="">选择专业 / 层级…</option>' +
    cats.map(function (n) { return '<option value="' + n.id + '">' + esc(n.name) + '</option>'; }).join('');
}

// ── 应用导入：本地保存 + 为未建课课程自动提交新课程申请 ──
// 后端辖区逻辑（v=153）：管理员 + 目标位置在辖区内 → auto_approved 直接建课；
// 否则走审核。直接建课的不标 pending，重新拉树后立即可点击跳转。
function ttApplyImport(parsed, requests) {
  parsed.importedAt = Date.now();
  ttSaveStore(parsed);
  ttState.data = parsed;
  ttComputeWeek();
  ttCloseModal();
  ttRenderAll();
  if (!requests.length) return;
  var direct = 0, sent = 0, failed = 0, treeDirty = false;
  var jobs = requests.map(function (r) {
    return api('/api/courses/request/', { method: 'POST', body: r.body })
      .then(function (res) {
        if (res && res.auto_approved) { direct++; treeDirty = true; return; }
        sent++;
        parsed.pendingCodes[r.code] = true;
      })
      .catch(function (err) {
        // 「已在目标位置」= 缓存过期导致的重复申请，课程其实已建好
        if (err && err.message && err.message.indexOf('已在') >= 0) { direct++; treeDirty = true; return; }
        failed++;
        parsed.pendingCodes[r.code] = true;
      });
  });
  Promise.all(jobs).then(function () {
    ttSaveStore(parsed);
    ttSyncUpload();
    if (treeDirty && typeof loadCourseTree === 'function') {
      // 后端建课已清服务端树缓存；前端 api() 内存缓存（树 TTL 10 分钟）
      // 必须手动清除，否则重拉的仍是旧树，直建课程不会立即变为可跳转
      if (typeof clearApiCache === 'function') clearApiCache('/api/courses/tree/');
      Promise.resolve(loadCourseTree()).catch(function () {}).then(function () {
        ttResolveCourseLinks();
        ttRepaintCurrent();
        ttToastImportResult(direct, sent, failed);
      });
    } else {
      ttResolveCourseLinks();
      ttRepaintCurrent();
      ttToastImportResult(direct, sent, failed);
    }
  });
}

function ttToastImportResult(direct, sent, failed) {
  var parts = [];
  if (direct) parts.push(direct + ' 门在辖区内已直接建课');
  if (sent) parts.push(sent + ' 门申请已送审');
  if (failed) parts.push(failed + ' 门提交失败');
  var tail = sent ? '，批准后点击课程即可跳转' : (direct ? '，点击课程即可查看资料' : '');
  ttToast(parts.join('；') + tail);
}

// ── 课程卡点击：跳转 / 状态提示 ──
function ttOpenCourse(code) {
  var info = ttState.links[code];
  // 树未就绪（如刚从云端拉取、或树加载失败）时链接还没解析：
  // 先加载课程树再重试一次；5 秒内不重复尝试，避免加载失败时死循环
  if ((!info || info.state !== 'linked') && !ttTreeReady() &&
      typeof loadCourseTree === 'function' &&
      (!ttState._treeTryAt || Date.now() - ttState._treeTryAt > 5000)) {
    ttEnsureCourseTree().then(function () { ttOpenCourse(code); }).catch(function () {});
    return;
  }
  if (!info) return;
  if (info.state === 'linked') {
    if (typeof showExplorer !== 'function') return;
    var go = function () {
      // 优先用课表自己的解析结果（支持区段目录/形势与政策特例，
      // navToLast 只认精确代码会停在板块根）；身份优先级已在解析时应用
      if (info.path && info.path.length >= 2) {
        expPath = info.path;
        pushViewState('explorer', { expPath: [...expPath] });
        switchView('explorer');
        renderExplorer();
        updateSidebar(info.path[0] === '通识课' ? 'general' : 'major');
      } else if (typeof navToLast === 'function') {
        showExplorer(info.type === '通识课' ? '通识课' : '专业课');
        navToLast(code);
      }
    };
    // explorer-render 等是懒加载模块：就绪后再渲染，避免落进
    // renderExplorer 的「课程目录加载中…」二次异步路径（首跳特别慢的根因）
    if (typeof ensureFeature === 'function') {
      ensureFeature('explorer').then(go, go);
    } else {
      go();
    }
  } else if (info.state === 'pending') {
    ttToast('「' + ttCourseNameByCode(code) + '」的新课程申请审核中，批准后即可跳转');
  } else {
    ttToast('「' + ttCourseNameByCode(code) + '」还没有资料目录，重新导入可为它选择位置');
  }
}

// ── 课程编辑器（编辑模式；字段集参照 APK AddCourseView） ──
var TT_SWATCH_H = { 1: 28, 2: 48, 3: 68, 4: 98, 5: 15, 6: 40, 7: 85, 8: 335 };
var TT_SWATCH_NAMES = { 1: '柿', 2: '缃', 3: '秋香', 4: '官青', 5: '檀', 6: '杏', 7: '苍绿', 8: '海棠' };

function ttOpenCourseEditor(cid, preset) {
  var isNew = !cid;
  var src = null;
  if (!isNew) {
    src = (ttState.data && ttState.data.courses) ? ttState.data.courses.find(function (c) { return c.id === cid; }) : null;
    if (!src) return;
  }
  // 工作副本：弹层内所有增删改都作用于副本，保存才落库
  var wc = isNew
    ? { id: ttNewId(), code: '', name: '', teachers: [], color: null, meetings: [] }
    : JSON.parse(JSON.stringify(src));
  if (isNew && preset) {
    wc.meetings = [{ ws: 1, we: Math.max(ttState.maxWeek, 16), parity: 0, day: preset.day, ps: preset.ps, pe: preset.ps, room: '' }];
  }
  ttRenderCourseModal(wc, isNew);
}

function ttRenderCourseModal(wc, isNew) {
  var existing = ttModalOverlay();
  var swatches = '<button type="button" class="tt-swatch' + (!wc.color ? ' is-active' : '') + '" data-color="">自动</button>';
  for (var n = 1; n <= 8; n++) {
    swatches += '<button type="button" class="tt-swatch' + (wc.color === n ? ' is-active' : '') + '" data-color="' + n + '"' +
      ' title="' + TT_SWATCH_NAMES[n] + '"><i style="--h:' + TT_SWATCH_H[n] + '"></i></button>';
  }

  existing.innerHTML =
    '<div class="tt-modal tt-edit" role="dialog" aria-modal="true" aria-label="' + (isNew ? '新增课程' : '编辑课程') + '">' +
      '<header><h3>' + (isNew ? '新增课程' : '编辑课程') + '</h3><button type="button" class="tt-btn is-ghost" data-close aria-label="关闭">✕</button></header>' +
      '<div class="tt-mbody">' +
        '<label class="tt-fld"><span>课程名称<i>*</i></span>' +
          '<input id="ttEdName" maxlength="60" value="' + esc(wc.name) + '" placeholder="如：线性代数"></label>' +
        '<label class="tt-fld"><span>任课教师</span>' +
          '<input id="ttEdTeachers" maxlength="80" value="' + esc((wc.teachers || []).join('、')) + '" placeholder="多人用「、」分隔"></label>' +
        '<label class="tt-fld"><span>课程代码</span>' +
          '<input id="ttEdCode" maxlength="24" value="' + esc(wc.code || '') + '" placeholder="选填，如 GEN09001；填写后链接资料目录"></label>' +
        '<div class="tt-edit-link" id="ttEdLink"></div>' +
        '<div class="tt-fld"><span>课程颜色</span><div class="tt-swatches" id="ttEdColors">' + swatches + '</div></div>' +
        '<div class="tt-fld tt-fld-top"><span>上课时间段</span></div>' +
        '<div class="tt-segs" id="ttEdSegs"></div>' +
        '<button type="button" class="tt-btn tt-add-seg" id="ttEdAddSeg">＋ 添加时间段</button>' +
      '</div>' +
      '<footer>' +
        '<span class="tt-foot-left">' +
          (isNew ? '' : '<button type="button" class="tt-btn danger" id="ttEdDel">删除课程</button>') +
          (isNew ? '' : '<button type="button" class="tt-btn" id="ttEdStrip" style="display:none">从本周移除</button>') +
        '</span>' +
        '<button type="button" class="tt-btn" data-close>取消</button>' +
        '<button type="button" class="tt-btn primary" id="ttEdSave">保存</button>' +
      '</footer>' +
    '</div>';

  existing.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { ttCloseModal(existing); });
  });
  existing.addEventListener('click', function (e) { if (e.target === existing) ttCloseModal(existing); });

  // 颜色覆盖（工作副本即时生效，保存落库）
  existing.querySelectorAll('.tt-swatch').forEach(function (sw) {
    sw.addEventListener('click', function () {
      var v = sw.getAttribute('data-color');
      wc.color = v ? parseInt(v, 10) : null;
      existing.querySelectorAll('.tt-swatch').forEach(function (s2) { s2.classList.toggle('is-active', s2 === sw); });
    });
  });

  // 时间段：结构操作先从 DOM 同步回工作副本，再变换、再重渲染（保住未保存的文本编辑）
  var segsEl = existing.querySelector('#ttEdSegs');
  segsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var row = btn.closest('.tt-seg');
    if (!row) return;
    ttEditSyncFromDom(wc);
    var i = parseInt(row.getAttribute('data-i'), 10);
    var act = btn.getAttribute('data-act');
    if (act === 'thisweek' && wc.meetings[i]) {
      wc.meetings[i].ws = wc.meetings[i].we = ttState.week;
    } else if (act === 'dup' && wc.meetings[i]) {
      wc.meetings.splice(i + 1, 0, JSON.parse(JSON.stringify(wc.meetings[i])));
    } else if (act === 'del') {
      wc.meetings.splice(i, 1);
    }
    ttEditRenderSegs(wc);
  });
  existing.querySelector('#ttEdAddSeg').addEventListener('click', function () {
    ttEditSyncFromDom(wc);
    wc.meetings.push({ ws: 1, we: Math.max(ttState.maxWeek, 16), parity: 0, day: 1, ps: 1, pe: 1, room: '' });
    ttEditRenderSegs(wc);
  });

  // 课程代码变化 → 重解析链接状态（含位置选择控件）
  var codeEl = existing.querySelector('#ttEdCode');
  codeEl.addEventListener('change', function () { ttEditRenderLink(wc); });

  // 从本周移除：工作副本内拆段，行上可见，保存才落库
  var stripBtn = existing.querySelector('#ttEdStrip');
  if (stripBtn) {
    stripBtn.addEventListener('click', function () {
      ttEditSyncFromDom(wc);
      ttStripCurrentWeek(wc);
      ttEditRenderSegs(wc);
      stripBtn.style.display = ttMeetsWeek(wc) ? '' : 'none';
    });
    stripBtn.style.display = ttMeetsWeek(wc) ? '' : 'none';
  }

  // 删除课程（两步确认）
  var delBtn = existing.querySelector('#ttEdDel');
  if (delBtn) {
    delBtn.addEventListener('click', function () {
      if (delBtn.classList.contains('armed')) { ttEditDelete(wc); return; }
      delBtn.classList.add('armed');
      delBtn.textContent = '确认删除？';
      setTimeout(function () {
        if (delBtn.isConnected) { delBtn.classList.remove('armed'); delBtn.textContent = '删除课程'; }
      }, 3000);
    });
  }

  existing.querySelector('#ttEdSave').addEventListener('click', function () { ttEditSave(wc, isNew); });

  ttEditRenderSegs(wc);
  ttEditRenderLink(wc);
  lockScroll();
}

// 从弹层 DOM 收集工作副本（文本框 + 每行时间段）；结构操作与保存前都会调用
function ttEditSyncFromDom(wc) {
  var nameEl = document.getElementById('ttEdName');
  var tEl = document.getElementById('ttEdTeachers');
  var cEl = document.getElementById('ttEdCode');
  if (nameEl) wc.name = nameEl.value.trim();
  if (tEl) wc.teachers = tEl.value.split(/[;；,，、]/).map(function (s) { return s.trim(); }).filter(Boolean);
  if (cEl) wc.code = cEl.value.trim().toUpperCase();
  var segsEl = document.getElementById('ttEdSegs');
  var out = [];
  if (segsEl) {
    segsEl.querySelectorAll('.tt-seg').forEach(function (row) {
      var gv = function (f) { var el = row.querySelector('[data-f="' + f + '"]'); return el ? el.value : ''; };
      var ps = parseInt(gv('ps'), 10) || 1;
      var pe = parseInt(gv('pe'), 10) || ps;
      var ws = parseInt(gv('ws'), 10) || 1;
      var we = parseInt(gv('we'), 10) || ws;
      if (pe < ps) { var t = ps; ps = pe; pe = t; }
      if (we < ws) { var t2 = ws; ws = we; we = t2; }
      out.push({
        ws: Math.max(1, Math.min(60, ws)), we: Math.max(ws, Math.min(60, we)),
        parity: parseInt(gv('parity'), 10) || 0,
        day: parseInt(gv('day'), 10) || 1,
        ps: Math.max(1, Math.min(12, ps)), pe: Math.max(ps, Math.min(12, pe)),
        room: String(gv('room')).trim().slice(0, 40)
      });
    });
  }
  wc.meetings = out;
}

function ttEditRenderSegs(wc) {
  var segsEl = document.getElementById('ttEdSegs');
  if (!segsEl) return;
  if (!wc.meetings.length) {
    segsEl.innerHTML = '<div class="tt-seg-empty">暂无上课时间——这门课将只出现在课程列表里（可添加时间段或直接保存）</div>';
    return;
  }
  segsEl.innerHTML = wc.meetings.map(function (mt, i) {
    var dayOpts = '', psOpts = '', peOpts = '';
    for (var d = 1; d <= 7; d++) {
      dayOpts += '<option value="' + d + '"' + (mt.day === d ? ' selected' : '') + '>周' + TT_DAY_NAMES[d - 1].slice(1) + '</option>';
    }
    for (var p = 1; p <= 12; p++) {
      psOpts += '<option value="' + p + '"' + (mt.ps === p ? ' selected' : '') + '>' + p + '</option>';
      peOpts += '<option value="' + p + '"' + (mt.pe === p ? ' selected' : '') + '>' + p + '</option>';
    }
    return '<div class="tt-seg" data-i="' + i + '">' +
      '<select class="tt-sel" data-f="day">' + dayOpts + '</select>' +
      '<span class="tt-seg-l">第</span>' +
      '<select class="tt-sel tt-sel-n" data-f="ps">' + psOpts + '</select>' +
      '<span class="tt-seg-l">–</span>' +
      '<select class="tt-sel tt-sel-n" data-f="pe">' + peOpts + '</select>' +
      '<span class="tt-seg-l">节</span>' +
      '<input class="tt-num" data-f="ws" type="number" min="1" max="60" value="' + mt.ws + '">' +
      '<span class="tt-seg-l">–</span>' +
      '<input class="tt-num" data-f="we" type="number" min="1" max="60" value="' + mt.we + '">' +
      '<span class="tt-seg-l">周</span>' +
      '<select class="tt-sel" data-f="parity">' +
        '<option value="0"' + (!mt.parity ? ' selected' : '') + '>全部周</option>' +
        '<option value="1"' + (mt.parity === 1 ? ' selected' : '') + '>单周</option>' +
        '<option value="2"' + (mt.parity === 2 ? ' selected' : '') + '>双周</option>' +
      '</select>' +
      '<input class="tt-room" data-f="room" maxlength="40" placeholder="教室" value="' + esc(mt.room || '') + '">' +
      '<button type="button" class="tt-chip" data-act="thisweek" title="把这段的周次设为仅当前周">仅本周</button>' +
      '<button type="button" class="tt-ico" data-act="dup" title="复制此段">⧉</button>' +
      '<button type="button" class="tt-ico" data-act="del" title="删除此段">✕</button>' +
    '</div>';
  }).join('');
}

// 链接状态 + 未建课的位置选择（复用导入确认弹窗的控件与辖区直建/送审逻辑）
function ttEditRenderLink(wc) {
  var el = document.getElementById('ttEdLink');
  if (!el) return;
  var codeEl = document.getElementById('ttEdCode');
  var nameEl = document.getElementById('ttEdName');
  var code = codeEl ? codeEl.value.trim().toUpperCase() : '';
  var name = nameEl ? nameEl.value.trim() : wc.name;
  if (!ttTreeReady()) {
    el.innerHTML = '<span class="tt-edit-hint">课程目录加载中…</span>';
    return;
  }
  if (!code) {
    el.innerHTML = '<span class="tt-edit-hint">未填代码：保存后不链接资料目录，随时可回来补填</span>';
    return;
  }
  var pending = ttState.data && ttState.data.pendingCodes && ttState.data.pendingCodes[code];
  if (pending) {
    el.innerHTML = '<span class="tt-edit-hint">该代码的新课程申请审核中，批准后自动可跳转</span>';
    return;
  }
  var path = ttFindPathByCode(code, name);
  if (path) {
    el.innerHTML = '<span class="tt-ok-tag">✓ 已有资料目录</span>';
    return;
  }
  var isGen = /^GEN/i.test(code);
  el.innerHTML =
    '<span class="tt-edit-hint">目录未建立' + (isGen ? '（GEN 开头归通识课）' : '（归专业课）') +
    '。选择位置后，保存时将自动提交新课程申请，管理员批准前点击不跳转；也可留空跳过：</span><span class="loc">' +
    ttLocationControls({ code: code, name: name }) + '</span>';
  var colSel = el.querySelector('select[data-role="college"]');
  if (colSel) {
    colSel.addEventListener('change', function () {
      var catSel = el.querySelector('select[data-role="cat"]');
      if (catSel) ttFillCategoryOptions(catSel, colSel.value);
    });
  }
}

// 从链接区读位置选择 → 建课申请 body；未选则返回 null（跳过申请）
function ttCollectRequestFromModal(code, name) {
  var gen = document.querySelector('#ttEdLink select[data-role="gen"]');
  if (gen && gen.value) {
    return { course_type: 'general', course_name: name, course_code: code, general_category_id: parseInt(gen.value, 10) };
  }
  var col = document.querySelector('#ttEdLink select[data-role="college"]');
  var cat = document.querySelector('#ttEdLink select[data-role="cat"]');
  if (col && col.value && cat && cat.value) {
    return { course_type: 'major', course_name: name, course_code: code, college_id: parseInt(col.value, 10), target_category_id: parseInt(cat.value, 10) };
  }
  return null;
}

function ttMeetsWeek(wc) {
  var w = ttState.week;
  return (wc.meetings || []).some(function (mt) { return ttMeetingInWeek(mt, w); });
}

// 单周调课（APK「删除本周」）：把当前周从所有命中时间段中摘除，必要时拆段。
// 拆出的两段完整继承单双周/教室/星期/节次；段删空则移除该段。
function ttStripCurrentWeek(wc) {
  var w = ttState.week;
  var out = [];
  wc.meetings.forEach(function (mt) {
    if (!ttMeetingInWeek(mt, w)) { out.push(mt); return; }
    if (mt.ws === mt.we) return; // 整段就这一周 → 移除该段
    if (w === mt.ws) { out.push(Object.assign({}, mt, { ws: mt.ws + 1 })); return; }
    if (w === mt.we) { out.push(Object.assign({}, mt, { we: mt.we - 1 })); return; }
    out.push(Object.assign({}, mt, { we: w - 1 }));
    out.push(Object.assign({}, mt, { ws: w + 1 }));
  });
  wc.meetings = out;
}

function ttEditSave(wc, isNew) {
  ttEditSyncFromDom(wc);
  if (!wc.name) {
    ttToast('请先填写课程名称');
    var nEl = document.getElementById('ttEdName');
    if (nEl) nEl.focus();
    return;
  }
  var data = ttState.data;
  if (!data) {
    data = ttState.data = { meta: {}, courses: [], pendingCodes: {}, start: ttGuessSemesterStart(''), importedAt: 0 };
  }
  ttEnsureIds();
  var idx = data.courses.findIndex(function (c) { return c.id === wc.id; });
  var oldCode = idx >= 0 ? (data.courses[idx].code || '') : '';
  wc.color = wc.color || null;
  if (idx >= 0) data.courses[idx] = wc;
  else data.courses.push(wc);
  // 旧代码不再被任何课程使用时，清理其申请中标记
  if (oldCode && oldCode !== wc.code && !data.courses.some(function (c) { return c.code === oldCode; })) {
    delete data.pendingCodes[oldCode];
  }
  // 建课申请要在关弹层前收集（位置选择控件在弹层 DOM 里）
  var code = wc.code;
  var needsRequest = code && ttTreeReady() && !data.pendingCodes[code] && !ttFindPathByCode(code, wc.name);
  var body = needsRequest ? ttCollectRequestFromModal(code, wc.name) : null;
  data.importedAt = Date.now();
  ttComputeWeek();
  ttSaveStore(data);
  ttCloseModal();
  ttRenderAll();
  ttSyncUpload();
  ttResolveCourseLinks();
  ttRepaintCurrent();

  if (!body) {
    ttToast('已保存「' + wc.name + '」');
    return;
  }
  api('/api/courses/request/', { method: 'POST', body: body }).then(function (res) {
    if (res && res.auto_approved) {
      if (typeof clearApiCache === 'function') clearApiCache('/api/courses/tree/');
      Promise.resolve(loadCourseTree()).then(function () {
        ttResolveCourseLinks();
        ttRepaintCurrent();
      }).catch(function () {});
      ttToast('已保存「' + wc.name + '」，并在辖区内直接建课');
    } else {
      data.pendingCodes[code] = true;
      ttSaveStore(data);
      ttResolveCourseLinks();
      ttRepaintCurrent();
      ttToast('已保存「' + wc.name + '」，建课申请已送审');
    }
  }).catch(function (err) {
    if (err && err.message && err.message.indexOf('已在') >= 0) {
      if (typeof clearApiCache === 'function') clearApiCache('/api/courses/tree/');
      Promise.resolve(loadCourseTree()).then(function () {
        ttResolveCourseLinks();
        ttRepaintCurrent();
      }).catch(function () {});
      ttToast('已保存「' + wc.name + '」，目录已存在');
    } else {
      ttToast('课程已保存，但建课申请失败：' + (err && err.message || '请稍后重试'));
    }
  });
}

function ttEditDelete(wc) {
  var data = ttState.data;
  if (!data) return;
  data.courses = data.courses.filter(function (c) { return c.id !== wc.id; });
  if (wc.code && !data.courses.some(function (c) { return c.code === wc.code; })) {
    delete data.pendingCodes[wc.code];
  }
  data.importedAt = Date.now();
  ttComputeWeek();
  ttSaveStore(data);
  ttCloseModal();
  ttRenderAll();
  ttSyncUpload();
  ttToast('已删除「' + wc.name + '」');
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
    sub.textContent = meta.semester || '';
    sub.style.display = meta.semester ? '' : 'none';
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
    '<div class="tt-foot" id="ttFoot"></div>';

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
    ttSyncUpload();
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

// 课程树异步就绪后重绘当前视图（链接状态可能已变化）
function ttRepaintCurrent() {
  if (!ttState.data) return;
  if (ttState.view === 'list') {
    var body = document.getElementById('ttBody');
    if (body && document.getElementById('ttList')) ttRenderList(body);
  } else if (document.getElementById('ttGrid')) {
    ttPaintGrid();
  }
}

// 资料丰度档位：null/未知 → 标准；0 → 无资料；1-9 → 有资料；10+ → 资料丰富
function ttRichClass(fileCount) {
  if (fileCount === null || fileCount === undefined) return '';
  if (fileCount <= 0) return ' tt-rich-0';
  if (fileCount >= 10) return ' tt-rich-2';
  return '';
}

function ttPaintGrid() {
  var grid = document.getElementById('ttGrid');
  var week = ttState.week;
  if (!grid) return;

  ttResolveCourseLinks();

  // 学期内没有周末课 → 收掉周六/周日空列（移动端行宽更充裕，桌面同理）
  var hasWeekend = ttState.data.courses.some(function (c) {
    return c.meetings.some(function (mt) { return mt.day >= 6; });
  });
  grid.classList.toggle('tt-w5', !hasWeekend);
  var dayCount = hasWeekend ? 7 : 5;

  var startMonday = ttParseDate(ttState.start);
  var todayMonday = ttMondayOf(new Date());
  var isCurrentWeek = todayMonday.getTime() === startMonday.getTime() + (week - 1) * 7 * 86400000;
  var todayWd = (new Date().getDay() === 0 ? 7 : new Date().getDay());

  var html = '';

  // 角格：周次大数码（签名元素）
  html += '<div class="tt-corner"><b>' + week + '</b><span>周</span></div>';

  // 星期表头
  for (var d = 1; d <= dayCount; d++) {
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

  // 午休 / 傍晚分隔条（纯色带，无文字）
  html += '<div class="tt-break" style="grid-row:6"></div>';
  html += '<div class="tt-break" style="grid-row:11"></div>';

  // 编辑模式：为每个格子铺一层「＋」空位（先渲染，课程卡自然叠在其上）
  if (ttState.editing) {
    for (var sd = 1; sd <= dayCount; sd++) {
      for (var sp = 1; sp <= 12; sp++) {
        html += '<div class="tt-slot" data-day="' + sd + '" data-ps="' + sp + '"' +
          ' style="grid-column:' + (sd + 1) + ';grid-row:' + TT_ROW_OF_PERIOD[sp - 1] + '"' +
          ' title="在 ' + TT_DAY_NAMES[sd - 1] + '第' + sp + '节添加课程"><span>＋</span></div>';
      }
    }
  }

  // 收集本周课程 → 按 星期+起始节 分组（同格多课堆叠）
  var groups = {};
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
      groups[key].items.push({ name: c.name, teachers: c.teachers, room: mt.room, code: c.code, cid: c.id, color: c.color });
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
      var tone = ttToneOf(it);
      var link = it.code ? ttState.links[it.code] : null;
      var linkClass = link && link.state === 'linked' ? ' is-link' : '';
      var pendClass = link && link.state === 'pending' ? ' is-pending' : '';
      // 未建课/审核中必然无资料 → 同「暂无资料」灰系
      var rich = link && link.state === 'linked' ? ttRichClass(link.fileCount) : ' tt-rich-0';
      var tip = it.name + (it.room ? ' · ' + it.room : '') + (it.teachers.length ? ' · ' + it.teachers.join('、') : '') +
        ' · 第' + ttState.week + '周';
      if (ttState.editing) tip += ' · 编辑模式：点击修改';
      else if (link && link.state === 'linked') tip += ' · 点击查看课程资料';
      else if (link && link.state === 'pending') tip += ' · 新课程申请审核中，批准后可跳转';
      cell += '<div class="tt-card ttp' + tone + rich + linkClass + pendClass + '" data-code="' + esc(it.code || '') + '"' +
        ' data-cid="' + esc(it.cid || '') + '"' +
        ' data-tip="' + esc(tip) + '" title="' + esc(tip) + '">' +
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

  // 网格点击（事件委托）：普通模式=跳转/状态提示；编辑模式=编辑课程/空位新建
  grid.onclick = function (e) {
    if (ttState.editing) {
      var ecard = e.target.closest('.tt-card');
      if (ecard) {
        var ecid = ecard.getAttribute('data-cid');
        if (ecid) ttOpenCourseEditor(ecid);
        return;
      }
      var slot = e.target.closest('.tt-slot');
      if (slot) {
        ttOpenCourseEditor(null, {
          day: parseInt(slot.getAttribute('data-day'), 10) || 1,
          ps: parseInt(slot.getAttribute('data-ps'), 10) || 1
        });
      }
      return;
    }
    var card = e.target.closest('.tt-card');
    if (!card) return;
    var code = card.getAttribute('data-code');
    if (code) ttOpenCourse(code);
  };

  // 周标签 + 统计 + 图例
  var label = document.getElementById('ttWeekLabel');
  if (label) label.textContent = '第 ' + week + ' 周';
  var prev = document.getElementById('ttPrevW');
  var next = document.getElementById('ttNextW');
  if (prev) prev.disabled = week <= 1;
  if (next) next.disabled = week >= ttState.maxWeek;
  var foot = document.getElementById('ttFoot');
  if (foot) {
    foot.innerHTML = '<span>本周 ' + weekCourseCount + ' 门课 · ' + weekPeriodCount + ' 节</span>' +
      '<span class="tt-legend"><i class="lg2"></i> 资料丰富 <i class="lg1"></i> 有资料 <i class="lg0"></i> 暂无资料</span>';
  }

  // 入场动效（尊重 reduced-motion，由 CSS 关闭）
  grid.classList.remove('swap');
  void grid.offsetWidth;
  grid.classList.add('swap');
}

// ── 列表视图：整学期课程一览（网格的姊妹视图：网格扫一眼，列表查细节） ──
// 单段排课时间：周三[5-7]节 1-16周(单) · 教室
function ttFmtMeeting(mt) {
  var wk = mt.ws === mt.we ? String(mt.ws) + '周'
    : mt.ws + '-' + mt.we + '周' + (mt.parity === 1 ? '(单)' : mt.parity === 2 ? '(双)' : '');
  var sec = mt.ps === mt.pe ? String(mt.ps) : mt.ps + '-' + mt.pe;
  return TT_DAY_NAMES[mt.day - 1] + '[' + sec + ']节 ' + wk + (mt.room ? ' · ' + mt.room : '');
}

// 资料状态签：与课表卡同一冷暖语言（无=冷、有=暖、丰富=更深）
// 树未就绪时不能断言「未建目录」，先显示加载中（树到达后 ttEnsureCourseTree 会重绘）
function ttStatusTag(link) {
  if (!ttTreeReady()) return '<span class="tt-tag">目录加载中…</span>';
  if (!link || link.state === 'missing') return '<span class="tt-tag tt-tag-cold">未建目录</span>';
  if (link.state === 'pending') return '<span class="tt-tag tt-tag-cold">申请审核中</span>';
  var n = link.fileCount;
  if (n === null || n === undefined) return '<span class="tt-tag">已有目录</span>';
  if (n >= 10) return '<span class="tt-tag tt-tag-warm2">资料丰富</span>';
  if (n >= 1) return '<span class="tt-tag tt-tag-warm">' + n + ' 份资料</span>';
  return '<span class="tt-tag tt-tag-cold">暂无资料</span>';
}

function ttRenderList(body) {
  var data = ttState.data;
  ttResolveCourseLinks();
  var sub = document.getElementById('ttSubTitle');
  if (sub) {
    sub.textContent = (data.meta && data.meta.semester) || '';
    sub.style.display = sub.textContent ? '' : 'none';
  }

  // 按第一次上课时间（星期 → 节次）排序；未排课的排在最后
  var rows = data.courses.map(function (c) {
    var first = null;
    c.meetings.forEach(function (mt) {
      if (!first || mt.day < first.day || (mt.day === first.day && mt.ps < first.ps)) first = mt;
    });
    return { c: c, first: first };
  }).sort(function (a, b) {
    var da = a.first ? a.first.day : 99, db = b.first ? b.first.day : 99;
    var pa = a.first ? a.first.ps : 99, pb = b.first ? b.first.ps : 99;
    return (da - db) || (pa - pb);
  });

  var html = '<ul class="tt-list" id="ttList">';
  rows.forEach(function (r, idx) {
    var c = r.c;
    var tone = ttToneOf(c);
    var link = c.code ? ttState.links[c.code] : null;
    var linkClass = link && link.state === 'linked' ? ' is-link' : '';
    var pendClass = link && link.state === 'pending' ? ' is-pending' : '';
    var rich = link && link.state === 'linked' ? ttRichClass(link.fileCount) : ' tt-rich-0';
    var meta = [];
    if (c.teachers.length) meta.push(esc(c.teachers.join('、')));
    if (c.credits) meta.push(c.credits + ' 学分');
    var sched = c.meetings.map(ttFmtMeeting).join('；');
    var tip = c.name + (sched ? ' · ' + sched : ' · 未排课');
    if (link && link.state === 'linked') tip += ' · 点击查看课程资料';
    else if (link && link.state === 'pending') tip += ' · 新课程申请审核中，批准后可跳转';
    html += '<li class="tt-lrow ttp' + tone + rich + linkClass + pendClass + '" data-code="' + esc(c.code || '') + '"' +
      ' data-cid="' + esc(c.id || '') + '"' +
      ' title="' + esc(tip) + '" style="--li:' + idx + '">' +
        '<div class="tt-lhead">' +
          '<span class="nm">' + esc(c.name) + '</span>' +
          ttStatusTag(link) +
        '</div>' +
        (meta.length ? '<div class="tt-lmeta">' + meta.join(' · ') + '</div>' : '') +
        '<div class="tt-lsched">' + (sched ? esc(sched) : '未排课') + '</div>' +
      '</li>';
  });
  html += '</ul>' +
    '<div class="tt-foot" id="ttFoot"><span>共 ' + data.courses.length + ' 门课程</span>' +
      '<span class="tt-legend"><i class="lg2"></i> 资料丰富 <i class="lg1"></i> 有资料 <i class="lg0"></i> 暂无资料</span></div>';
  body.innerHTML = html;

  // 行点击（事件委托）：普通模式=跳转/提示；编辑模式=编辑课程
  list.onclick = function (e) {
    var row = e.target.closest('.tt-lrow');
    if (!row) return;
    if (ttState.editing) {
      var cid = row.getAttribute('data-cid');
      if (cid) ttOpenCourseEditor(cid);
      return;
    }
    var code = row.getAttribute('data-code');
    if (code) ttOpenCourse(code);
  };

  list.classList.remove('swap');
  void list.offsetWidth;
  list.classList.add('swap');
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
        '<p class="tt-tut-note">本地解析，仅自己可见：教务导出文件仅在你的浏览器里解析；只有解析出的课表数据会同步到你的账号，换设备登录同账号即可查看。</p>' +
      '</div>' +
      '<footer><button type="button" class="tt-btn primary" data-close>知道了</button></footer>' +
    '</div>';

  existing.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { ttCloseModal(existing); });
  });
  existing.addEventListener('click', function (e) { if (e.target === existing) ttCloseModal(existing); });
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

// ── 轻提示 ──
function ttToast(msg) {
  var t = document.createElement('div');
  t.className = 'tt-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function () { t.classList.add('show'); });
  setTimeout(function () {
    t.classList.remove('show');
    setTimeout(function () { t.remove(); }, 300);
  }, 2600);
}

// 调试钩子：控制台可注入任意教务 HTML 文本验证解析
function __ttLoadHtmlText(text) {
  var parsed = ttParseImport(text);
  if (!parsed.start) parsed.start = ttGuessSemesterStart(parsed.meta && parsed.meta.semester);
  if (!parsed.pendingCodes) parsed.pendingCodes = {};
  parsed.importedAt = Date.now();
  ttSaveStore(parsed);
  ttState.data = parsed;
  ttComputeWeek();
  ttRenderAll();
  return parsed;
}
