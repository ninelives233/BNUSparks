/* BNU Sparks · tutorial-data.js —— 动画使用教程：分组目录、分镜脚本与动作白名单。
   懒加载模块（feature-loader 的 tutorial 特性，data → scenes → player），
   不发起任何业务请求。演示内容全部使用固定虚构示例（学习方法导论 /
   期末复习提纲.pdf / 复习资料.zip / 示例同学 / DEMO101），演示 DOM 中的
   课程代码只存在于教程节点，不传入业务函数。

   时长口径（2026-10 重制）：每个分镜只有一个学习目标，按具体操作分步
   （steps.length = 场景步骤数，含第 0 步“建立场景”），通常 5～10 秒，
   复杂操作更长；不再使用固定的 8/10/12 秒四镜头模板。步骤文案与
   tutorial-scenes.js 的分镜步骤一一对应（tools/check_tutorial_scenes.js 守门）。 */
(function () {
  'use strict';

  // 内容版本：修文案、调动画不提升 revision；操作入口/步骤实质变化才提升。
  var CONTENT_VERSION = 1;

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
      id: 'find-search', groupId: 'find', revision: 1,
      title: '找到你需要的资料',
      caption: '先找到课程，再挑一份合适的资料。',
      note: '也可以搜索课程代码、资料标题或任课教师。手机浏览器看 PDF 需下载后查看。',
      durationMs: 8600, coreOrder: 1, scene: 'findSearch',
      action: 'browse-courses',
      steps: ['顶部搜索框就在这里', '输入课程名、代码或关键词', '结果分成课程和资料两组', '点开课程，浏览它的资料列表', '打开资料详情，确认内容']
    },
    'find-filter': {
      id: 'find-filter', groupId: 'find', revision: 1,
      title: '资料太多，先筛一下',
      caption: '按类型缩小范围，再选择适合自己的排序。',
      durationMs: 8600, scene: 'findFilter',
      action: 'browse-courses',
      steps: ['资料列表和「类型」「排序」入口', '打开类型选择', '选中「试卷」，列表只剩试卷', '打开排序选择', '按收藏量排列，状态保持可见']
    },
    'find-same-name': {
      id: 'find-same-name', groupId: 'find', revision: 1,
      title: '同名课程，也可以再看看',
      caption: '同名课程可能有不同代码，查看时留意课程归属。',
      note: '只有真实存在未合并的同名课程时才有这个入口；已合并的别名代码不会显示为独立课程。',
      durationMs: 7100, scene: 'findSameName',
      action: 'browse-courses',
      steps: ['课程页底部有「同名课程」区块', '另一条同名课程突出显示，代码不同', '点击切换，名称不变、代码变化', '确认课程代码与资料归属']
    },
    'find-preview': {
      id: 'find-preview', groupId: 'find', revision: 1,
      title: '先看看，再决定下载',
      caption: '先确认内容，再决定是否下载。',
      note: '电脑上 PDF 最多预览前三页；图片和文本可直接预览；PPT/PPTX 暂不支持在线预览；手机浏览器看 PDF 请下载后查看。',
      durationMs: 7100, scene: 'findPreview',
      action: 'browse-courses',
      steps: ['资料详情里有「预览」和「下载」', '点击预览，翻看第一页', '切换到下一页示例（最多前三页）', '回到详情，确认内容后再下载'],
      variants: {
        mobile: {
          steps: ['资料详情里有「预览」和「下载」', '手机上点预览：不支持内嵌 PDF', '点「下载 PDF」，下载后查看', '图片和文本可以直接预览']
        }
      }
    },
    'find-zip': {
      id: 'find-zip', groupId: 'find', revision: 1,
      title: '下载压缩包前，看看里面有什么',
      caption: '先看文件清单，再决定是否下载。',
      note: '预览只展示文件目录，不打开包内文件。',
      durationMs: 7100, scene: 'findZip',
      action: 'browse-courses',
      steps: ['压缩包详情有「预览」入口', '点「预览」查看文件清单', '展开文件夹，看到全部条目', '这里只看目录，不打开包内文件']
    },
    'find-download': {
      id: 'find-download', groupId: 'find', revision: 1,
      title: '一次下载多份资料',
      caption: '需要多份资料时，可以一起选择。',
      note: '批量下载更适合电脑浏览器；浏览器可能需要允许连续下载。真实下载仍受权限、配额与浏览器限制。',
      durationMs: 8600, scene: 'findDownload',
      action: 'browse-courses',
      steps: ['单份「下载」之外，还有「批量下载」', '点「批量下载」，行首出现复选框', '勾选第一份资料', '再勾选一份，点「下载选中」', '两份资料分别下载，不合并成压缩包']
    },

    // ── 整理我的课程（courses） ─────────────────────────────
    'courses-import': {
      id: 'courses-import', groupId: 'courses', revision: 1,
      title: '把课表变成自己的课程入口',
      caption: '导入本学期课表，建立自己的课程入口。',
      note: '仅支持教务系统导出的“按列表方式显示”课表；导入文件只在浏览器本地解析，课程数据的可见范围以导入页提示为准。',
      variants: {
        link: { note: '匹配到资料目录的课程，还能直接查看资料。' },
        nolink: { note: '资料关联取决于培养层次、课表格式和课程匹配；未关联的课程可查看时间与地点。' },
        generic: { note: '资料关联取决于培养层次、课表格式和课程匹配；未关联的课程可查看时间与地点。' }
      },
      durationMs: 7100, coreOrder: 2, scene: 'coursesImport',
      action: 'my-courses',
      steps: ['「我的课程」支持导入课表或手动添加', '选择列表式课表文件，核对课程名称', '确认导入，生成课程卡片', '点开课程：有目录的直接看资料']
    },
    'courses-views': {
      id: 'courses-views', groupId: 'courses', revision: 1,
      title: '课程列表与周课表，随时切换',
      caption: '找课程看列表，看安排用周课表。',
      durationMs: 7100, scene: 'coursesViews',
      action: 'my-courses',
      steps: ['已导入的课程在课程列表里', '切换到「周课表」', '突出显示某天的上课时间与地点', '切回列表，课程都还在']
    },
    'courses-open': {
      id: 'courses-open', groupId: 'courses', revision: 1,
      title: '从课程卡片继续查看',
      caption: '从自己的课程，直接进入对应资料。',
      variants: {
        link: { title: '从课程卡片继续查看', caption: '从自己的课程，直接进入对应资料。', steps: ['在「我的课程」找到这门课', '课程卡片显示「有资料」', '点击卡片，进入同名课程目录', '课程名与目录位置保持一致'] },
        nolink: { title: '查看课程时间与地点', caption: '点开课程卡片，查看具体安排。', steps: ['在「我的课程」找到这门课', '点击课程卡片', '查看课程详情', '确认上课时间与地点'] },
        generic: { title: '从课程卡片继续查看', caption: '点开课程卡片；能否直达资料取决于课程匹配。', steps: ['在「我的课程」找到这门课', '点击课程卡片', '查看课程详情', '按匹配情况查看资料或安排'] }
      },
      durationMs: 7100, scene: 'coursesOpen',
      action: 'my-courses',
      steps: ['在「我的课程」找到这门课', '点击课程卡片', '进入同名课程目录，课程名保持一致', '从课程卡片直达课程内容']
    },
    'courses-manual': {
      id: 'courses-manual', groupId: 'courses', revision: 1,
      title: '把自学课程也整理进来',
      caption: '没有排课时间的课程，也能加入课程列表。',
      note: '自学课程不会出现在周课表；添加个人课程不影响公共课程目录。',
      durationMs: 7100, scene: 'coursesManual',
      action: 'my-courses',
      steps: ['「我的课程」右上角有「管理」', '打开管理菜单，选手动添加课程', '填写课程名，上课时间可不填', '保存后出现在课程列表']
    },
    'courses-terms': {
      id: 'courses-terms', groupId: 'courses', revision: 1,
      title: '新学期来了，保留旧课表',
      caption: '新学期另存一张课表，旧课表仍可查看。',
      note: '「上学期」只是示例名称，不代表自动识别学期；重新导入与导入为新课表是不同操作，课表数量上限以实际页面为准。',
      durationMs: 7100, scene: 'coursesTerms',
      action: 'my-courses',
      steps: ['课表面板里是上学期的课表', '点「导入为新课表」（不是重新导入）', '新课表生效，新的课程列表出现', '随时切回旧课表，原课程还在']
    },

    // ── 把有用的内容留下来（save） ──────────────────────────
    'save-course': {
      id: 'save-course', groupId: 'save', revision: 1,
      title: '收藏整门课程，下次直接打开',
      caption: '常用的课程，收藏一次就好。',
      note: '下次从头像菜单的“我的收藏 → 课程”进入。',
      durationMs: 8600, coreOrder: 3, scene: 'saveCourse',
      action: 'favorites-course',
      steps: ['课程旁有一颗空心星标', '点击星标，收藏这门课程', '打开头像菜单', '进入「我的收藏 → 课程」找到它', '点击直接进入课程资料目录']
    },
    'save-file': {
      id: 'save-file', groupId: 'save', revision: 1,
      title: '把有用的资料留到下次',
      caption: '暂时用不上，也可以先收藏起来。',
      durationMs: 7100, scene: 'saveFile',
      action: 'favorites-file',
      steps: ['资料详情旁有收藏星标', '点击收藏，状态变为「已收藏」', '在「我的收藏 → 文件」找到它', '点开回到资料详情']
    },
    'save-answer': {
      id: 'save-answer', groupId: 'save', revision: 1,
      title: '只收藏那条有帮助的回答',
      caption: '值得留下来的，有时就是其中一个回答。',
      note: '收藏按现有页面叫“帖子”归类；收藏项会带回答摘要，点开回到回答所在位置。',
      durationMs: 7100, scene: 'saveAnswer',
      action: 'favorites-post',
      steps: ['同一条问题下有多条回答', '只收藏这条有帮助的回答', '在「我的收藏 → 帖子」找到它', '点开回到回答所在位置']
    },
    'save-retrieve': {
      id: 'save-retrieve', groupId: 'save', revision: 1,
      title: '收藏以后，从这里找回来',
      caption: '课程、资料和问答收藏，都在这里。',
      durationMs: 8600, scene: 'saveRetrieve',
      action: 'favorites',
      steps: ['头像菜单里有「我的收藏」', '打开头像菜单', '「课程」标签里是收藏的课程', '切换到「文件」', '再切换到「帖子」，三类收藏都在这']
    },

    // ── 分享资料与学习经验（share） ─────────────────────────
    'share-file': {
      id: 'share-file', groupId: 'share', revision: 1,
      title: '上传一份课程资料',
      caption: '选对课程，补充信息，让资料更容易被找到。',
      note: '普通用户上传后进入审核队列；文件大小与格式限制以实际上传页为准。',
      durationMs: 7100, scene: 'shareFile',
      action: 'upload-picker',
      steps: ['课程资料页有「上传资料」入口', '打开上传窗，文件已选好', '补齐类型、教师和简介', '提交后等待审核，在「我的上传」查看']
    },
    'share-text': {
      id: 'share-text', groupId: 'share', revision: 1,
      title: '不用准备文件，也能分享经验',
      caption: '几行学习经验，也可以成为一份资料。',
      note: '切换到“文字录入”，直接写下想分享的内容。',
      durationMs: 7100, coreOrder: 4, scene: 'shareText',
      action: 'upload-picker',
      steps: ['上传窗口里有「文字录入」选项', '切换到文字录入', '写下标题和几行短经验', '提交后等待审核']
    },
    'share-course': {
      id: 'share-course', groupId: 'share', revision: 1,
      title: '找不到课程，申请补上它',
      caption: '目录里还没有的课程，可以申请补充。',
      note: '如果课程已存在，会提示进入已有课程，不会重复创建；申请需要管理员审核。',
      durationMs: 7100, scene: 'shareCourse',
      action: 'new-course',
      steps: ['找不到课程时，可以申请新建', '填写课程名称与课程代码', '按课程类型选择学院、专业归属', '提交申请，等待审核']
    },
    'share-review': {
      id: 'share-review', groupId: 'share', revision: 1,
      title: '查看资料的审核进度',
      caption: '审核进度和结果，都能在这里找到。',
      durationMs: 8600, scene: 'shareReview',
      action: 'my-uploads',
      steps: ['头像菜单里有「我的上传」', '打开头像菜单', '「审核中」显示待审的资料', '「已发布」是另一份已通过的资料', '审核消息也会发到通知中心']
    },
    'share-resubmit': {
      id: 'share-resubmit', groupId: 'share', revision: 1,
      title: '修改后，再提交一次',
      caption: '查看原因，修改后可以重新提交。',
      durationMs: 7100, scene: 'shareResubmit',
      action: 'my-uploads-rejected',
      steps: ['在「我的上传」切到「已驳回」', '展开驳回原因', '点「重新上传」补充说明', '再次提交后回到待审核']
    },

    // ── 参与问答交流（qa） ─────────────────────────────────
    'qa-search': {
      id: 'qa-search', groupId: 'qa', revision: 1,
      title: '先搜搜有没有相关讨论',
      caption: '先搜一搜，也许已经有人分享过答案。',
      durationMs: 7100, scene: 'qaSearch',
      action: 'qa',
      steps: ['问答区的搜索框搜问题和回答', '输入「期末复习」', '出现匹配的问题列表', '点开问题，命中的回答可辨认']
    },
    'qa-tags': {
      id: 'qa-tags', groupId: 'qa', revision: 1,
      title: '用标签缩小讨论范围',
      caption: '按主题筛选，更快找到相关讨论。',
      durationMs: 8600, scene: 'qaTags',
      action: 'qa',
      steps: ['问答列表有「筛选」入口', '展开筛选区，看到一级标签', '选择「课程学习」，出现二级标签', '选择「期末复习」，列表收窄', '已选标签保持可见，可随时清除']
    },
    'qa-ask': {
      id: 'qa-ask', groupId: 'qa', revision: 1,
      title: '把问题说清楚',
      caption: '写清背景和困惑，更容易得到有帮助的回答。',
      note: '站点未开放提问时会提示“当前站点暂未开放提问”；教程仍可学习，入口会回到问答列表。',
      durationMs: 7100, scene: 'qaAsk',
      action: 'qa',
      steps: ['问答区有「我要提问」入口', '写一个具体的标题', '补充已做的尝试，并选择标签', '提交后等待审核']
    },
    'qa-answer': {
      id: 'qa-answer', groupId: 'qa', revision: 1,
      title: '留下你的经验与答案',
      caption: '把你的做法写下来，也可能帮到别人。',
      note: '站点未开放回答时，实际入口会说明限制；提交后同样进入审核。',
      durationMs: 7100, scene: 'qaAnswer',
      action: 'qa',
      steps: ['问题详情有「写回答」入口', '回答编辑器保留问题标题', '写下做法和适用条件', '提交后等待审核']
    },
    'qa-accept': {
      id: 'qa-accept', groupId: 'qa', revision: 1,
      title: '标记解决问题的回答',
      caption: '问题得到解决后，标记有帮助的回答。',
      note: '只有提问者本人可以采纳自己问题的回答；浏览者没有这个按钮。',
      durationMs: 7100, scene: 'qaAccept',
      action: 'qa',
      steps: ['这是你提出的问题，下面有两条回答', '找到解决了问题的那条回答', '点「采纳为最佳回答」', '问题出现已采纳标记，顺序不变']
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
        capability: cap
      };
    }
    return { title: lesson.title, caption: lesson.caption, note: lesson.note || '', steps: lesson.steps, capability: cap };
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
