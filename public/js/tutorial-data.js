/* BNU Sparks · tutorial-data.js —— 动画使用教程：分组目录、分镜脚本与动作白名单。
   懒加载模块（feature-loader 的 tutorial 特性，data → scenes → player），
   不发起任何业务请求。演示内容全部使用固定虚构示例（学习方法导论 /
   期末复习提纲.pdf / 复习资料.zip / 示例同学 / DEMO101），演示 DOM 中的
   课程代码只存在于教程节点，不传入业务函数。

   内容口径（2026-10-03 二次修订）：每幕一个学习目标，「真实界面经过取舍的
   局部展示」——演示 DOM 复用站点真实 class（见 docs/TUTORIAL_DESIGN_SPEC.md §5）。
   节奏按内容逐步声明：pace[k] = 第 k+1 步指针动身前与前一步的间隔（ms），
   durationMs = 末步 cue + 1500 收尾；硬下限（tools/check_tutorial_scenes.js 守门）：
   建立 ≥1.0s，其后每步 ≥1.3s。步骤文案与 tutorial-scenes.js 的分镜步骤一一对应。
   本轮操作入口/步骤实质变化，revision 全部提升为 2（materials/views/tutorial.py
   的 LESSON_REVISIONS 同步，test_tutorial.py 守门）。 */
(function () {
  'use strict';

  // 内容版本：修文案、调动画不提升 revision；操作入口/步骤实质变化才提升。
  var CONTENT_VERSION = 2;

  // 核心导览四幕：顺序固定，复用主题组内同 ID 分镜，看完计入所在组进度。
  var CORE_IDS = ['find-search', 'courses-import', 'save-course', 'share-text'];

  var GROUPS = [
    { id: 'find', title: '找到合适的资料', blurb: '从搜索到下载，少走几步。' },
    { id: 'courses', title: '整理我的课程', blurb: '导入、查看，整理每个学期。' },
    { id: 'save', title: '把有用的内容留下来', blurb: '收藏课程、资料和精彩回答。' },
    { id: 'share', title: '分享资料与学习经验', blurb: '分享一份资料，或写下几行经验。' },
    { id: 'qa', title: '参与问答交流', blurb: '找到讨论，也贡献自己的答案。' }
  ];

  var GROUP_LESSONS = {
    find: ['find-search', 'find-filter', 'find-same-name', 'find-preview', 'find-zip', 'find-download'],
    courses: ['courses-import', 'courses-views', 'courses-open', 'courses-manual', 'courses-terms'],
    save: ['save-course', 'save-file', 'save-answer', 'save-retrieve'],
    share: ['share-file', 'share-text', 'share-course', 'share-review', 'share-resubmit'],
    qa: ['qa-search', 'qa-tags', 'qa-ask', 'qa-answer', 'qa-accept']
  };

  var LESSONS = {
    // ── 找到合适的资料（find） ──────────────────────────────
    'find-search': {
      id: 'find-search', groupId: 'find', revision: 2,
      title: '一个搜索框，找课程也找资料',
      caption: '顶部一个搜索框，课程和资料都能搜。',
      note: '也可以搜索课程代码、资料标题或任课教师。手机浏览器看 PDF 需下载后查看。',
      durationMs: 7900, pace: [1500, 2300, 2600], coreOrder: 1, scene: 'findSearch',
      action: 'browse-courses',
      steps: ['页面顶部的搜索框，课程和资料都能搜', '点击搜索框，准备输入', '输入课程名、代码或关键词', '结果分成「课程」和「资料」两组']
    },
    'find-filter': {
      id: 'find-filter', groupId: 'find', revision: 2,
      title: '资料太多，先筛一下',
      caption: '按类型缩小范围，再选择适合自己的排序。',
      durationMs: 9000, pace: [1400, 1900, 1800, 2400], scene: 'findFilter',
      action: 'browse-courses',
      steps: ['这门课的资料都在这里筛选', '点「类型」，缩小资料类型', '选「试卷」，列表只剩试卷', '再点「排序」，换个排法', '按「收藏量」排，最常用的排前面']
    },
    'find-same-name': {
      id: 'find-same-name', groupId: 'find', revision: 2,
      title: '同名课程，留意课程归属',
      caption: '同名课程可能有不同代码，查看时留意课程归属。',
      note: '只有真实存在未合并的同名课程时才有这个入口；已合并的别名代码不会显示为独立课程。',
      durationMs: 7100, pace: [1500, 1700, 2400], scene: 'findSameName',
      action: 'browse-courses',
      steps: ['课程页底部有「同名课程」区块', '同名的另一门课，代码不同', '点击它，直接切到那门课', '课程名不变，资料已换成 DEMO201 的']
    },
    'find-preview': {
      id: 'find-preview', groupId: 'find', revision: 2,
      title: '先看看，再决定下载',
      caption: '先确认内容，再决定是否下载。',
      note: '电脑上 PDF 最多预览前三页；图片和文本可直接预览；PPT/PPTX 暂不支持在线预览；手机浏览器看 PDF 请下载后查看。',
      durationMs: 7400, pace: [1400, 2100, 2400], scene: 'findPreview',
      action: 'browse-courses',
      steps: ['每份资料都能先「预览」再决定', '点「预览」，内容在浮层里打开', '往下滚动，接着看第 2 页', '确认内容后，在预览头部直接「下载」'],
      variants: {
        mobile: {
          steps: ['每份资料都能先「预览」再决定', '手机上点「预览」', '不支持内嵌预览，点「下载 PDF」', '图片和文本可以直接预览，下载后查看']
        }
      }
    },
    'find-zip': {
      id: 'find-zip', groupId: 'find', revision: 2,
      title: '下载压缩包前，看看里面有什么',
      caption: '先看文件清单，再决定是否下载。',
      note: '预览只展示文件目录，不打开包内文件。',
      durationMs: 7000, pace: [1400, 1800, 2300], scene: 'findZip',
      action: 'browse-courses',
      steps: ['压缩包可以先看看里面有什么', '点「预览」，浮层里是文件清单', '点开文件夹，看全部条目', '这里只看目录，不打开包内文件']
    },
    'find-download': {
      id: 'find-download', groupId: 'find', revision: 2,
      title: '一次下载多份资料',
      caption: '需要多份资料时，可以一起选择。',
      note: '批量下载更适合电脑浏览器；浏览器可能需要允许连续下载。真实下载仍受权限、配额与浏览器限制。',
      durationMs: 8800, pace: [1400, 1800, 1700, 2400], scene: 'findDownload',
      action: 'browse-courses',
      steps: ['每份资料右侧都能单独「下载」', '要一次拿多份，点「批量下载」', '勾选第一份需要的资料', '再勾一份，工具栏显示「已选 2 个」', '点「下载选中」，两份分别下载']
    },

    // ── 整理我的课程（courses） ─────────────────────────────
    'courses-import': {
      id: 'courses-import', groupId: 'courses', revision: 2,
      title: '把课表变成自己的课程列表',
      caption: '导入本学期课表，建立自己的课程入口。',
      note: '仅支持教务系统导出的“按列表方式显示”课表；导入文件只在浏览器本地解析，课程数据的可见范围以导入页提示为准。',
      variants: {
        link: { note: '匹配到资料目录的课程，还能直接查看资料。' },
        nolink: { note: '资料关联取决于培养层次、课表格式和课程匹配；未关联的课程可查看时间与地点。' },
        generic: { note: '资料关联取决于培养层次、课表格式和课程匹配；未关联的课程可查看时间与地点。' }
      },
      durationMs: 8000, pace: [1500, 2400, 2600], coreOrder: 2, scene: 'coursesImport',
      action: 'my-courses',
      steps: ['「我的课程」先把课表导进来', '选择教务导出的列表式课表文件', '核对课程名单，确认导入', '课程列表建好了，随时可以点开']
    },
    'courses-views': {
      id: 'courses-views', groupId: 'courses', revision: 2,
      title: '课程列表与周课表，随时切换',
      caption: '找课程看列表，看安排用周课表。',
      durationMs: 6900, pace: [1500, 1900, 2000], scene: 'coursesViews',
      action: 'my-courses',
      steps: ['导入的课程都在课程列表里', '切到「周课表」，看整周安排', '上课时间和教室一目了然', '切回列表，课程都还在']
    },
    'courses-open': {
      id: 'courses-open', groupId: 'courses', revision: 2,
      title: '从自己的课程直达资料',
      caption: '从自己的课程，直接进入对应资料。',
      variants: {
        link: { title: '从自己的课程直达资料', caption: '从自己的课程，直接进入对应资料。', steps: ['在「我的课程」找到这门课', '点行尾的「查看资料 ›」', '课程名不变，直接进入资料目录', '从这里开始看这门课的资料'] },
        nolink: { title: '查看课程时间与地点', caption: '点开课程行，查看具体安排。', steps: ['在「我的课程」找到这门课', '点开课程行', '查看上课时间与地点', '资料关联取决于课程匹配情况'] },
        generic: { title: '从自己的课程直达资料', caption: '点开课程行；能否直达资料取决于课程匹配。', steps: ['在「我的课程」找到这门课', '点开课程行', '有资料的课程直达资料目录', '没关联的课程可以查看时间与地点'] }
      },
      durationMs: 7100, pace: [1500, 1700, 2400], scene: 'coursesOpen',
      action: 'my-courses',
      steps: ['在「我的课程」找到这门课', '点行尾的「查看资料 ›」', '课程名不变，直接进入资料目录', '从这里开始看这门课的资料']
    },
    'courses-manual': {
      id: 'courses-manual', groupId: 'courses', revision: 2,
      title: '把自学课程也整理进来',
      caption: '没有排课时间的课程，也能加入课程列表。',
      note: '自学课程不会出现在周课表；添加个人课程不影响公共课程目录。教师、代码、颜色等字段按页面提示补全即可。',
      durationMs: 7500, pace: [1500, 2100, 2400], scene: 'coursesManual',
      action: 'my-courses',
      steps: ['自学课程也能加进课程列表', '点列表底部的「＋ 添加课程」', '写上课程名；上课时间可以不填', '保存后，它就出现在课程列表里']
    },
    'courses-terms': {
      id: 'courses-terms', groupId: 'courses', revision: 2,
      title: '新学期来了，保留旧课表',
      caption: '新学期另存一张课表，旧课表仍可查看。',
      note: '「上学期」只是示例名称，不代表自动识别学期；重新导入与导入为新课表是不同操作，最多存 3 份课表。',
      durationMs: 8600, pace: [1400, 1500, 2000, 2200], scene: 'coursesTerms',
      action: 'my-courses',
      steps: ['一份课表用一个学期，旧的不会丢', '点「管理」，找到「切换课表」', '在弹层里点「＋ 导入为新课表」', '新课表生效，上学期课表仍在列表', '点「上学期」，随时切回去']
    },

    // ── 把有用的内容留下来（save） ──────────────────────────
    'save-course': {
      id: 'save-course', groupId: 'save', revision: 2,
      title: '课程行右侧的星标，点亮即收藏',
      caption: '常用的课程，收藏一次就好。',
      note: '收藏后从头像菜单的「我的收藏 → 课程」随时找回来。',
      durationMs: 6000, pace: [1700, 2800], coreOrder: 3, scene: 'saveCourse',
      action: 'favorites-course',
      steps: ['这门课的行尾有一颗空心星标', '点星标，收藏整门课程', '星标亮了，课程已经进「我的收藏」']
    },
    'save-file': {
      id: 'save-file', groupId: 'save', revision: 2,
      title: '把有用的资料留到下次',
      caption: '暂时用不上，也可以先收藏起来。',
      note: '已收藏的资料在「我的收藏 → 文件」里。',
      durationMs: 5700, pace: [1600, 2600], scene: 'saveFile',
      action: 'favorites-file',
      steps: ['资料详情旁边有「收藏」按钮', '点「收藏」，先把资料留下来', '按钮变成「已收藏」，随时能找回来']
    },
    'save-answer': {
      id: 'save-answer', groupId: 'save', revision: 2,
      title: '只收藏那条有帮助的回答',
      caption: '值得留下来的，有时就是其中一个回答。',
      note: '收藏按现有页面叫“帖子”归类；收藏项会带回答摘要，点开回到回答所在位置。',
      durationMs: 5800, pace: [1700, 2600], scene: 'saveAnswer',
      action: 'favorites-post',
      steps: ['同一条问题下，回答不止一条', '只收藏这条有帮助的回答', '这条回答已经进你的收藏']
    },
    'save-retrieve': {
      id: 'save-retrieve', groupId: 'save', revision: 2,
      title: '收藏以后，从这里找回来',
      caption: '课程、资料和问答收藏，都在这里。',
      durationMs: 8500, pace: [1400, 1700, 1900, 2000], scene: 'saveRetrieve',
      action: 'favorites',
      steps: ['收藏过的内容，从头像菜单找回来', '点头像，打开菜单', '打开「我的收藏」', '切到「文件」，收藏的资料在这', '「帖子」里是收藏的回答']
    },

    // ── 分享资料与学习经验（share） ─────────────────────────
    'share-file': {
      id: 'share-file', groupId: 'share', revision: 2,
      title: '上传一份课程资料',
      caption: '选对课程，补充信息，让资料更容易被找到。',
      note: '标题留空会自动使用文件名；描述选填。普通用户上传后进入审核队列；文件大小与格式限制以实际上传页为准。',
      durationMs: 7600, pace: [1500, 2100, 2500], scene: 'shareFile',
      action: 'upload-picker',
      steps: ['在课程资料页找到「+ 上传资料」', '打开上传窗，文件已经选好', '资料类型和任课教师是必填项', '补全信息后提交，通过审核大家可见']
    },
    'share-text': {
      id: 'share-text', groupId: 'share', revision: 2,
      title: '不用准备文件，也能分享经验',
      caption: '几行学习经验，也可以成为一份资料。',
      note: '录入的文字会保存为 .txt 资料；资料类型、任课教师等其余字段补全后提交，进入审核。',
      durationMs: 7900, pace: [1500, 2100, 2800], coreOrder: 4, scene: 'shareText',
      action: 'upload-picker',
      steps: ['没有文件也可以分享经验', '在上传窗里切到「文字录入」', '写个标题，正文两三行就够', '补全类型等信息后提交，进入审核']
    },
    'share-course': {
      id: 'share-course', groupId: 'share', revision: 2,
      title: '找不到课程，申请补上它',
      caption: '目录里还没有的课程，可以申请补充。',
      note: '如果课程已存在，会提示进入已有课程，不会重复创建；申请需要管理员审核。随附资料为选填。',
      durationMs: 7900, pace: [1600, 2200, 2600], scene: 'shareCourse',
      action: 'new-course',
      steps: ['找不到课程？可以申请补上它', '填写课程名称与课程代码', '通识课选类型；专业课选学院专业', '提交申请，管理员审核后出现在目录']
    },
    'share-review': {
      id: 'share-review', groupId: 'share', revision: 2,
      title: '查看资料的审核进度',
      caption: '审核进度和结果，都能在这里找到。',
      note: '审核不是自动通过的；审核结果也会发到通知中心。',
      durationMs: 7000, pace: [1400, 1700, 2400], scene: 'shareReview',
      action: 'my-uploads',
      steps: ['上传之后的进度，在头像菜单里', '点头像，打开菜单，进「我的上传」', '「已发布」是通过审核的资料', '点「审核中」，等待审核的资料在这']
    },
    'share-resubmit': {
      id: 'share-resubmit', groupId: 'share', revision: 2,
      title: '修改后，再提交一次',
      caption: '查看原因，修改后可以重新提交。',
      note: '重新提交后回到「审核中」，仍需等待审核；驳回原因会保留在上传记录里。',
      durationMs: 7500, pace: [1600, 1900, 2500], scene: 'shareResubmit',
      action: 'my-uploads-rejected',
      steps: ['被驳回的资料带着驳回原因', '点「↻ 重新上传」', '按原因补上说明，再次提交', '状态回到「审核中」，等待下次审核']
    },

    // ── 参与问答交流（qa） ─────────────────────────────────
    'qa-search': {
      id: 'qa-search', groupId: 'qa', revision: 2,
      title: '先搜搜有没有相关讨论',
      caption: '先搜一搜，也许已经有人分享过答案。',
      durationMs: 7200, pace: [1400, 1900, 2400], scene: 'qaSearch',
      action: 'qa',
      steps: ['问答区的搜索框搜问题和回答', '点搜索框，输入「期末复习」', '点「→」搜索', '命中的问题带着摘要出现']
    },
    'qa-tags': {
      id: 'qa-tags', groupId: 'qa', revision: 2,
      title: '用标签缩小讨论范围',
      caption: '按主题筛选，更快找到相关讨论。',
      durationMs: 8500, pace: [1400, 1700, 1700, 2200], scene: 'qaTags',
      action: 'qa',
      steps: ['问题太多？先按标签筛选', '点「筛选」，展开标签面板', '选一级分类「课程学习」', '再选话题「期末复习」', '列表收窄了；再点标签可取消']
    },
    'qa-ask': {
      id: 'qa-ask', groupId: 'qa', revision: 2,
      title: '把问题说清楚',
      caption: '写清背景和困惑，更容易得到有帮助的回答。',
      note: '站点未开放提问时会提示“当前站点暂未开放提问”；教程仍可学习，入口会回到问答列表。',
      durationMs: 7600, pace: [1500, 2100, 2500], scene: 'qaAsk',
      action: 'qa',
      steps: ['有问题就点「我要提问」', '标题一句话说清你的困惑', '选上分类和话题，别人更好找到', '写清背景和尝试，提交审核']
    },
    'qa-answer': {
      id: 'qa-answer', groupId: 'qa', revision: 2,
      title: '留下你的经验与答案',
      caption: '把你的做法写下来，也可能帮到别人。',
      note: '站点未开放回答时，实际入口会说明限制；提交后同样进入审核。',
      durationMs: 7500, pace: [1500, 1900, 2600], scene: 'qaAnswer',
      action: 'qa',
      steps: ['看到会答的问题，点「写回答」', '编辑器顶部保留着问题原文', '写下你的做法和适用条件', '提交审核，通过后出现在回答列表']
    },
    'qa-accept': {
      id: 'qa-accept', groupId: 'qa', revision: 2,
      title: '标记解决问题的回答',
      caption: '问题得到解决后，标记有帮助的回答。',
      note: '只有提问者本人可以采纳自己问题的回答；浏览者没有这个按钮。',
      durationMs: 7200, pace: [1400, 1500, 2800], scene: 'qaAccept',
      action: 'qa',
      steps: ['这是你提出的问题，下面有两条回答', '只有提问者能看到「采纳」按钮', '点「采纳为最佳回答」', '绿条加「已采纳」，顺序保持不变']
    }
  };

  // “去试试”动作白名单：只接受 ID 分发，不接受 URL 或函数名字符串。
  // requiresAuth=true 的动作在未登录时先关闭教程再打开登录窗口（不叠两层模态）；
  // feature 指目标函数依赖的懒加载模块（由动作执行方 ensureFeature）。
  var ACTIONS = {
    'browse-courses': { requiresAuth: false, feature: 'explorer' },
    'my-courses': { requiresAuth: true, feature: 'timetable' },
    'favorites': { requiresAuth: true },
    'favorites-course': { requiresAuth: true },
    'favorites-file': { requiresAuth: true },
    'favorites-post': { requiresAuth: true },
    'upload-picker': { requiresAuth: true, feature: 'explorer' },
    'new-course': { requiresAuth: true, feature: 'explorer' },
    'my-uploads': { requiresAuth: true },
    'my-uploads-rejected': { requiresAuth: true },
    'qa': { requiresAuth: false, feature: 'qa' }
  };

  function groupById(id) {
    for (var i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i].id === id) return GROUPS[i];
    }
    return null;
  }

  function lessonsInGroup(groupId) {
    var ids = GROUP_LESSONS[groupId] || [];
    return ids.map(function (id) { return LESSONS[id]; }).filter(Boolean);
  }

  function coreLessons() {
    return CORE_IDS.map(function (id) { return LESSONS[id]; }).filter(Boolean);
  }

  function groupDuration(groupId) {
    return lessonsInGroup(groupId).reduce(function (sum, l) { return sum + l.durationMs; }, 0);
  }

  // 能力分支：只读取已经合法取得的会话信息与已加载模块状态，不额外请求。
  // 真实口径与 timetable.js 的 ttLinksEnabled() 一致：
  //   课程目录链接 = 课表主人是本科 且 当前课表不是 noLink 格式（如珠海导出）。
  // 课表模块是懒加载的：未加载、访客或信息未知 → generic（保守分支，
  // 文字说明“资料关联取决于培养层次、课表格式和课程匹配”，不承诺直达）。
  function capability() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser) {
        var edu = currentUser.identity_education || '';
        if (edu !== '本科') return edu ? 'nolink' : 'generic';
        if (typeof ttState !== 'undefined' && ttState && ttState.data) {
          return ttState.data.noLink ? 'nolink' : 'link';
        }
        return 'generic';
      }
    } catch (e) { /* currentUser / ttState 未声明 */ }
    return 'generic';
  }

  // 分镜的分支文案：能力分支优先；窄屏分支次之（如手机 PDF 下载后查看）。
  // pace 属于场景节奏，与分支无关，始终取基础步骤数组对应值。
  function lessonVariant(lesson, isMobile) {
    if (!lesson) return null;
    var cap = capability();
    var pool = lesson.variants || {};
    var v = (isMobile && pool.mobile) || pool[cap] || null;
    if (v) {
      return {
        title: v.title || lesson.title,
        caption: v.caption || lesson.caption,
        note: v.note || lesson.note || '',
        steps: v.steps || lesson.steps,
        pace: lesson.pace || null,
        capability: cap
      };
    }
    return { title: lesson.title, caption: lesson.caption, note: lesson.note || '', steps: lesson.steps, pace: lesson.pace || null, capability: cap };
  }

  function allLessonIds() {
    var ids = [];
    GROUPS.forEach(function (g) {
      (GROUP_LESSONS[g.id] || []).forEach(function (id) { ids.push(id); });
    });
    return ids;
  }

  window.BnuTutorialData = {
    version: CONTENT_VERSION,
    groups: GROUPS,
    groupLessons: GROUP_LESSONS,
    lessons: LESSONS,
    coreIds: CORE_IDS,
    actions: ACTIONS,
    groupById: groupById,
    lessonsInGroup: lessonsInGroup,
    coreLessons: coreLessons,
    groupDuration: groupDuration,
    allLessonIds: allLessonIds,
    capability: capability,
    lessonVariant: lessonVariant
  };
})();
