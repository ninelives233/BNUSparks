/* BNU Sparks · feature-loader.js —— 按视图懒加载非核心前端模块 */
(function() {
  // v270：课表目录链接修复——精确/别名代码优先于区段目录（历史遗留「三自选项课程」
  // GEN01203-GEN01250 大区段不再吞掉区段内体育课的链接，后端数据迁移已删该目录）。
  // v271：配色组内区分度调优——每套方案组内色相弧拉宽至 ≥90°，另叠八档
  // 「水洗」明度/彩度阶梯（--tdl/--tdc，卡/签/列表条/圆点均叠加）；
  // TT_SCHEMES 色相表与 CSS .tt-sch-* 同步更新。
  // v272：同名合并叶子行展示全部代码——后端主叶子 courseCodes 携带全部别名代码
  // （不再要求别名叶子同层共现），explorer-render 列表行渲染多代码 + 省略号截断。
  // v273：移动端课表网格纵向放开——行高改固定舒适值（74px/节），画布总高超过一屏、
  // 页面自然下滑，统计/图例撑出首屏；container-type 移除，cqh 回退视口单位。
  // v275：午休/傍晚分隔再收敛——去掉隔行签底色与题签，只留一条低调的
  // 发丝虚线（虚线=时段软分隔，与实线结构线区分）；带高桌面 28→22px、移动 24→18px。
  // index.html 的 feature-loader 引用键必须同步推进（30 天缓存链）。
  // v276：配色冷暖安全区——组内色相弧收回 [322,85]（暖）/ [158,305]（冷），
  // 组间色相间隔 ≥22°（多数 ≥35°），修 v271 弧拉过宽导致冷暖难辨的问题；
  // 组内区分度仍由八档水洗阶梯承担，TT_SCHEMES 与 CSS 同步更新。
  // v277：课表网格删掉午休/傍晚分隔行（TT_ROW_OF_PERIOD 连续化 2-13，
  // 虚线/空洞全移除，时段靠时间列数字自明，对齐主流课表 App）；
  // 移动端回退满屏一屏显示全部 12 节（撤 v273 纵向放开，实用性优先）。
  // v278：移动端课表统计/图例（次级信息）绝对定位挂到满屏画布正下方（视口外，
  // 下滑可见），画布独占整屏；课名取消行数钳制（line-clamp 在部分内核下渲染
  // 假省略号且浪费连堂卡片空间），自然换行、超长由卡片裁切。
  // v279：课表视图底部预留悬挂 footer 的实体高度（+64px），
  // 修图例滑到底时叠在全局站点页脚上的瑕疵。
  // index.html 的 feature-loader 引用键必须同步推进（30 天缓存链）。
  // v281：移动端时间列 24→30px，恢复每节起止时间小字（7-8px，对齐主流课表 App），
  // 课程列每列仅让出 <1px。
  // v282：编辑弹层「＋ 添加时间段」改幽灵文字按钮（原粗虚线框太抢眼）。
  // v283：管理后台按 Tab 按需加载；进入用户管理不再等待问答、待审、记录等无关模块。
  // v284：noLink 课表课程卡点击打开详情面板；课表外观增加课程卡片文字靠左/居中/靠右。
  // v285：将课程卡片文字对齐选项直接放入课表「管理 → 外观」菜单，避免用户找不到全局外观抽屉。
  // v286：课表导入、空状态和教程提示明确课表默认可见范围及授权总管理员只读查看。
  // v287：管理菜单（外观）新增移动端「节次时间」开关——关=隐藏时间列小字并
  // 收窄时间列回 24px（localStorage 设备级偏好，缺省显示）。
  // v288：移动端「管理」弹层收紧——限宽、缩内边距、降字号、
  // 限高 72vh 内部滚动，设置面板不再占掉大半张课表。
  // v289：弹层宽度 272→236px。
  // v300：行为事件账本接入运行状态；页面/搜索批量采集，服务端事件幂等落库，
  // 运行状态增加真实 DAU、主体拆分、活动构成和点击日查看小时分布。
  // v301：运行状态与用户活动指标改用管理员可直接理解的中文文案，不改变统计口径。
  // v302：问答区视觉重构（索引卡方向）——回答叫号牌三态、卡片 hover 标题染墨蓝、
  // 排序分段控件、最佳回答常青左缘轨、回答展开 0fr→1fr 高度过渡；仅展示层。
  // v292：运行状态生产接入拆出 admin-health.js；同一缓存键串行加载，接口失败
  // 保留上次成功数据，页面隐藏时暂停自动刷新。
  // v303：移动端审核分段控件/论坛筛选 chips 不再竖排（.pc-seg 换行 + 按钮禁折行），
  //       课程列表行移动端收紧（图标 28px/间距 10px/标题单行省略号）。
  // v304：关于页「联系我们」新增用户交流群二维码入口与反馈问卷卡片；
  //       footer「投稿与建议」改为「意见反馈」指向问卷；group-qr.png 进部署包。
  // v318：宽屏管理后台放宽内容轨道；用户名单桌面端固定列宽并在单元格内省略，
  //       避免宽屏仍出现不必要的表格横向滚动。
  // v319：校园入口开放账号级自定义；个人入口与总管理员精选分层，缓存键同步推进。
  var VERSION = '319';
  var loadedScripts = Object.create(null);
  var loadedStyles = Object.create(null);
  var scriptPromises = Object.create(null);
  var stylePromises = Object.create(null);
  var featurePromises = Object.create(null);

  var featureScripts = {
    explorer: [
      'explorer-upload.js',
      'explorer-mgmt.js',
      'explorer-render.js',
      'newcourse.js'
    ],
    qa: [
      'qa.js',
      'qa-editor.js',
      'qa-compose.js'
    ],
    // admin-core.js 已静态加载；这里仅负责后台公共样式。
    // 各个后台 Tab 的脚本在 admin-core.js 中按当前 Tab 延迟加载。
    admin: [],
    'admin-users': ['admin-users.js', 'admin-health.js', 'admin-events.js'],
    'admin-pending': ['admin-pending.js', 'admin-users.js', 'admin-health.js', 'admin-events.js'],
    'admin-records': ['admin-pending.js', 'admin-users.js', 'admin-health.js', 'admin-events.js', 'admin-records.js'],
    'admin-qa': [
      'qa.js',
      'qa-editor.js',
      'qa-compose.js',
      'admin-pending.js',
      'admin-users.js',
      'admin-health.js',
      'admin-events.js',
      'admin-records.js',
      'qa-admin.js'
    ],
    timetable: [
      'timetable.js'
    ]
  };

  var featureStyles = {
    explorer: ['course.css'],
    qa: ['qa.css'],
    admin: ['admin.css'],
    'admin-users': ['admin.css'],
    'admin-pending': ['admin.css'],
    'admin-records': ['admin.css'],
    'admin-qa': ['admin.css', 'qa.css'],
    timetable: ['timetable.css']
  };

  function loadStyle(name) {
    if (loadedStyles[name]) return Promise.resolve();
    if (stylePromises[name]) return stylePromises[name];
    stylePromises[name] = new Promise(function(resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/static/css/' + name + '?v=' + VERSION;
      link.onload = function() {
        loadedStyles[name] = true;
        delete stylePromises[name];
        resolve();
      };
      link.onerror = function() {
        delete stylePromises[name];
        console.warn('样式加载失败：' + name);
        reject(new Error('样式加载失败：' + name));
      };
      document.head.appendChild(link);
    });
    return stylePromises[name];
  }

  function loadScript(name) {
    var src = '/static/js/' + name + '?v=' + VERSION;
    if (loadedScripts[src]) return Promise.resolve();
    if (scriptPromises[src]) return scriptPromises[src];
    scriptPromises[src] = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = function() {
        loadedScripts[src] = true;
        delete scriptPromises[src];
        resolve();
      };
      script.onerror = function() {
        delete scriptPromises[src];
        reject(new Error('模块加载失败：' + name));
      };
      document.head.appendChild(script);
    });
    return scriptPromises[src];
  }

  function loadFeature(feature) {
    if (featurePromises[feature]) return featurePromises[feature];
    var styles = (featureStyles[feature] || []).map(loadStyle);
    var scripts = featureScripts[feature] || [];
    var featurePromise = Promise.all(styles).then(function() {
      return scripts.reduce(function(chain, name) {
        return chain.then(function() { return loadScript(name); });
      }, Promise.resolve());
    }).then(function() {
      window._bnusparksFeatureReady = window._bnusparksFeatureReady || {};
      window._bnusparksFeatureReady[feature] = true;
    });
    var retryablePromise = featurePromise.catch(function(err) {
      // 失败只影响本次加载；下一次进入页面/视图可以重新尝试失败的资源。
      if (featurePromises[feature] === retryablePromise) delete featurePromises[feature];
      throw err;
    });
    featurePromises[feature] = retryablePromise;
    return retryablePromise;
  }

  window.ensureFeature = loadFeature;
})();
