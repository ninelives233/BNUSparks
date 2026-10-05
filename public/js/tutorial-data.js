/* BNU Sparks · tutorial-data.js —— 动画使用教程：分组目录、分镜脚本与动作白名单。
   懒加载模块（feature-loader 的 tutorial 特性，data → scenes → player），
   不发起任何业务请求。演示内容全部使用固定虚构示例（学习方法导论 /
   期末复习提纲.pdf / 复习资料.zip / 示例同学 / DEMO101），演示 DOM 中的
   课程代码只存在于教程节点，不传入业务函数。

   一个操作是一幕。timeline 声明解说、动作、镜头和结果停留的绝对虚拟时间；
   steps 只供完整说明与静态阅读，不再约束每个节拍的间隔。 */
(function () {
  'use strict';

  // 内容版本：修文案、调动画不提升 revision；操作入口/步骤实质变化才提升。
  var CONTENT_VERSION = 3;

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
      id: 'find-search', groupId: 'find', revision: 3,
      title: '一个搜索框，找课程也找资料',
      caption: '顶部一个搜索框，课程和资料都能搜。',
      note: '也可以搜索课程代码、资料标题或任课教师。手机浏览器看 PDF 需下载后查看。',
      durationMs: 9000, coreOrder: 1, scene: 'findSearch',
      action: 'browse-courses',
      steps: ['顶部一个搜索框，课程和资料都从这里找', '输入课程名或关键词', '按回车或点「→」开始搜索', '结果分成「课程」和「资料」两组']
    },
    'find-filter': {
      id: 'find-filter', groupId: 'find', revision: 2,
      title: '资料太多，先筛一下',
      caption: '按类型缩小范围，再选择适合自己的排序。',
      durationMs: 8400, scene: 'findFilter',
      action: 'browse-courses',
      steps: ['这门课的资料都在这里筛选', '点「类型」，缩小资料类型', '选「试卷」，列表只剩试卷', '再点「排序」，换个排法', '按「收藏量」排，最常用的排前面']
    },
    'find-same-name': {
      id: 'find-same-name', groupId: 'find', revision: 2,
      title: '同名课程，留意课程归属',
      caption: '同名课程可能有不同代码，查看时留意课程归属。',
      note: '只有真实存在未合并的同名课程时才有这个入口；已合并的别名代码不会显示为独立课程。',
      durationMs: 7900, scene: 'findSameName',
      action: 'browse-courses',
      steps: ['课程页底部有「同名课程」区块', '同名的另一门课，代码不同', '点击它，直接切到那门课', '课程名不变，资料已换成 DEMO201 的']
    },
    'find-preview': {
      id: 'find-preview', groupId: 'find', revision: 2,
      title: '先看看，再决定下载',
      caption: '先确认内容，再决定是否下载。',
      note: '电脑上 PDF 最多预览前三页；图片和文本可直接预览；PPT/PPTX 暂不支持在线预览；手机浏览器看 PDF 请下载后查看。',
      durationMs: 8168, scene: 'findPreview',
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
      durationMs: 7672, scene: 'findZip',
      action: 'browse-courses',
      steps: ['压缩包可以先看看里面有什么', '点「预览」，浮层里是文件清单', '点开文件夹，看全部条目', '这里只看目录，不打开包内文件']
    },
    'find-download': {
      id: 'find-download', groupId: 'find', revision: 2,
      title: '一次下载多份资料',
      caption: '需要多份资料时，可以一起选择。',
      note: '批量下载更适合电脑浏览器；浏览器可能需要允许连续下载。真实下载仍受权限、配额与浏览器限制。',
      durationMs: 9472, scene: 'findDownload',
      action: 'browse-courses',
      steps: ['每份资料右侧都能单独「下载」', '要一次拿多份，点「批量下载」', '勾选第一份需要的资料', '再勾一份，工具栏显示「已选 2 个」', '点「下载选中」，两份分别下载']
    },

    // ── 整理我的课程（courses） ─────────────────────────────
    'courses-import': {
      id: 'courses-import', groupId: 'courses', revision: 3,
      title: '把课表变成自己的课程列表',
      caption: '导入本学期课表，建立自己的课程入口。',
      note: '仅支持教务系统导出的“按列表方式显示”课表；导入文件只在浏览器本地解析，课程数据的可见范围以导入页提示为准。',
      variants: {
        link: { note: '仅支持教务导出的列表式课表；文件在浏览器本地解析，课程数据同步到账号，默认仅自己可见。匹配到资料目录的课程可以查看资料。' },
        nolink: { steps: ['在我的课程导入课表', '选择教务导出的列表式课表文件', '示例文件在本地解析', '此类课表跳过确认窗，直接导入', '课程可查看时间与地点'], note: '非本科或 noLink 格式直接导入，不展示目录关联确认窗。文件只在浏览器本地解析，课表数据同步到账号，默认仅自己可见。' },
        generic: { steps: ['在我的课程导入课表', '选择教务导出的列表式课表文件', '示例文件在本地解析', '按页面提示完成导入，是否需确认取决于课表能力', '课程可查看时间与地点'], note: '仅支持教务导出的列表式课表。文件在浏览器本地解析，课表数据同步到账号，默认仅自己可见；资料关联与确认流程取决于培养层次、格式和匹配情况。' }
      },
      durationMs: 11000, coreOrder: 2, scene: 'coursesImport',
      action: 'my-courses',
      steps: ['在我的课程导入课表', '选择教务导出的列表式课表文件', '示例文件在本地解析', '核对课程名单，确认导入', '课程可查看时间与地点']
    },
    'courses-views': {
      id: 'courses-views', groupId: 'courses', revision: 2,
      title: '课程列表与周课表，随时切换',
      caption: '找课程看列表，看安排用周课表。',
      durationMs: 7400, scene: 'coursesViews',
      action: 'my-courses',
      steps: ['导入的课程都在课程列表里', '切到「周课表」，看整周安排', '上课时间和教室一目了然', '切回列表，课程都还在']
    },
    'courses-open': {
      id: 'courses-open', groupId: 'courses', revision: 3,
      title: '从自己的课程直达资料',
      caption: '从自己的课程，直接进入对应资料。',
      variants: {
        link: { title: '从自己的课程直达资料', caption: '从自己的课程，直接进入对应资料。', steps: ['在「我的课程」找到这门课', '点行尾的「查看资料 ›」', '课程名不变，直接进入资料目录', '从这里开始看这门课的资料'] },
        nolink: { title: '查看课程时间与地点', caption: '点开课程行，查看具体安排。', steps: ['在「我的课程」找到这门课', '点开课程行', '查看上课时间与地点', '资料关联取决于课程匹配情况'] },
        generic: { title: '查看自己的课程', caption: '资料关联取决于培养层次、课表格式和课程匹配。', steps: ['在我的课程找到这门课', '示例：点开课程行', '查看时间与地点；具体入口以页面为准', '能否查看资料取决于课程关联'] }
      },
      durationMs: 7608, scene: 'coursesOpen',
      action: 'my-courses',
      steps: ['在「我的课程」找到这门课', '点行尾的「查看资料 ›」', '课程名不变，直接进入资料目录', '从这里开始看这门课的资料']
    },
    'courses-manual': {
      id: 'courses-manual', groupId: 'courses', revision: 2,
      title: '把自学课程也整理进来',
      caption: '没有排课时间的课程，也能加入课程列表。',
      note: '自学课程不会出现在周课表；添加个人课程不影响公共课程目录。教师、代码、颜色等字段按页面提示补全即可。',
      durationMs: 8072, scene: 'coursesManual',
      action: 'my-courses',
      steps: ['自学课程也能加进课程列表', '点列表底部的「＋ 添加课程」', '写上课程名；上课时间可以不填', '保存后，它就出现在课程列表里']
    },
    'courses-terms': {
      id: 'courses-terms', groupId: 'courses', revision: 2,
      title: '新学期来了，保留旧课表',
      caption: '新学期另存一张课表，旧课表仍可查看。',
      note: '「上学期」只是示例名称，不代表自动识别学期；重新导入与导入为新课表是不同操作，最多存 3 份课表。',
      durationMs: 9208, scene: 'coursesTerms',
      action: 'my-courses',
      steps: ['一份课表用一个学期，旧的不会丢', '点「管理」，找到「切换课表」', '在弹层里点「＋ 导入为新课表」', '新课表生效，上学期课表仍在列表', '点「上学期」，随时切回去']
    },

    // ── 把有用的内容留下来（save） ──────────────────────────
    'save-course': {
      id: 'save-course', groupId: 'save', revision: 2,
      title: '课程行右侧的星标，点亮即收藏',
      caption: '常用的课程，收藏一次就好。',
      note: '收藏后从头像菜单的「我的收藏 → 课程」随时找回来。',
      durationMs: 6100, coreOrder: 3, scene: 'saveCourse',
      action: 'favorites-course',
      steps: ['课程行尾的星标就是收藏入口', '点星标，收藏这门课', '星标点亮，已进「我的收藏」']
    },
    'save-file': {
      id: 'save-file', groupId: 'save', revision: 2,
      title: '把有用的资料留到下次',
      caption: '暂时用不上，也可以先收藏起来。',
      note: '已收藏的资料在「我的收藏 → 文件」里。',
      durationMs: 6336, scene: 'saveFile',
      action: 'favorites-file',
      steps: ['资料详情旁边有「收藏」按钮', '点「收藏」，先把资料留下来', '按钮变成「已收藏」，随时能找回来']
    },
    'save-answer': {
      id: 'save-answer', groupId: 'save', revision: 2,
      title: '只收藏那条有帮助的回答',
      caption: '值得留下来的，有时就是其中一个回答。',
      note: '收藏按现有页面叫“帖子”归类；收藏项会带回答摘要，点开回到回答所在位置。',
      durationMs: 6300, scene: 'saveAnswer',
      action: 'favorites-post',
      steps: ['同一条问题下，回答不止一条', '只收藏这条有帮助的回答', '这条回答已经进你的收藏']
    },
    'save-retrieve': {
      id: 'save-retrieve', groupId: 'save', revision: 2,
      title: '收藏以后，从这里找回来',
      caption: '课程、资料和问答收藏，都在这里。',
      durationMs: 9100, scene: 'saveRetrieve',
      action: 'favorites',
      steps: ['收藏过的内容，从头像菜单找回来', '点头像，打开菜单', '打开「我的收藏」', '切到「文件」，收藏的资料在这', '「帖子」里是收藏的回答']
    },

    // ── 分享资料与学习经验（share） ─────────────────────────
    'share-file': {
      id: 'share-file', groupId: 'share', revision: 2,
      title: '上传一份课程资料',
      caption: '选对课程，补充信息，让资料更容易被找到。',
      note: '标题留空会自动使用文件名；描述选填。普通用户上传后进入审核队列；文件大小与格式限制以实际上传页为准。',
      durationMs: 8236, scene: 'shareFile',
      action: 'upload-picker',
      steps: ['在课程资料页找到「+ 上传资料」', '打开上传窗，文件已经选好', '资料类型和任课教师是必填项', '补全信息后提交，通过审核大家可见']
    },
    'share-text': {
      id: 'share-text', groupId: 'share', revision: 3,
      title: '不用准备文件，也能分享经验',
      caption: '几行学习经验，也可以成为一份资料。',
      note: '录入的文字会保存为 .txt 资料；资料类型、任课教师等其余字段补全后提交，进入审核。',
      durationMs: 8472, coreOrder: 4, scene: 'shareText',
      action: 'upload-picker',
      steps: ['没有文件也可以分享经验', '在上传窗里切到「文字录入」', '写个标题，正文两三行就够', '补全其他信息后提交，进入审核']
    },
    'share-course': {
      id: 'share-course', groupId: 'share', revision: 2,
      title: '找不到课程，申请补上它',
      caption: '目录里还没有的课程，可以申请补充。',
      note: '如果课程已存在，会提示进入已有课程，不会重复创建；申请需要管理员审核。随附资料为选填。',
      durationMs: 8536, scene: 'shareCourse',
      action: 'new-course',
      steps: ['找不到课程？可以申请补上它', '填写课程名称与课程代码', '通识课选类型；专业课选学院专业', '提交申请，管理员审核后出现在目录']
    },
    'share-review': {
      id: 'share-review', groupId: 'share', revision: 2,
      title: '查看资料的审核进度',
      caption: '审核进度和结果，都能在这里找到。',
      note: '审核不是自动通过的；审核结果也会发到通知中心。',
      durationMs: 7736, scene: 'shareReview',
      action: 'my-uploads',
      steps: ['上传之后的进度，在头像菜单里', '点头像，打开菜单，进「我的上传」', '「已发布」是通过审核的资料', '点「审核中」，等待审核的资料在这']
    },
    'share-resubmit': {
      id: 'share-resubmit', groupId: 'share', revision: 2,
      title: '修改后，再提交一次',
      caption: '查看原因，修改后可以重新提交。',
      note: '重新提交后回到「审核中」，仍需等待审核；驳回原因会保留在上传记录里。',
      durationMs: 8136, scene: 'shareResubmit',
      action: 'my-uploads-rejected',
      steps: ['被驳回的资料带着驳回原因', '点「↻ 重新上传」', '按原因补上说明，再次提交', '状态回到「审核中」，等待下次审核']
    },

    // ── 参与问答交流（qa） ─────────────────────────────────
    'qa-search': {
      id: 'qa-search', groupId: 'qa', revision: 2,
      title: '先搜搜有没有相关讨论',
      caption: '先搜一搜，也许已经有人分享过答案。',
      durationMs: 7800, scene: 'qaSearch',
      action: 'qa',
      steps: ['问答区的搜索框搜问题和回答', '点搜索框，输入「期末复习」', '点「→」搜索', '命中的问题带着摘要出现']
    },
    'qa-tags': {
      id: 'qa-tags', groupId: 'qa', revision: 2,
      title: '用标签缩小讨论范围',
      caption: '按主题筛选，更快找到相关讨论。',
      durationMs: 9140, scene: 'qaTags',
      action: 'qa',
      steps: ['问题太多？先按标签筛选', '点「筛选」，展开标签面板', '选一级分类「课程学习」', '再选话题「期末复习」', '列表收窄了；再点标签可取消']
    },
    'qa-ask': {
      id: 'qa-ask', groupId: 'qa', revision: 2,
      title: '把问题说清楚',
      caption: '写清背景和困惑，更容易得到有帮助的回答。',
      note: '站点未开放提问时会提示“当前站点暂未开放提问”；教程仍可学习，入口会回到问答列表。',
      durationMs: 8108, scene: 'qaAsk',
      action: 'qa',
      steps: ['有问题就点「我要提问」', '标题一句话说清你的困惑', '选上分类和话题，别人更好找到', '写清背景和尝试，提交审核']
    },
    'qa-answer': {
      id: 'qa-answer', groupId: 'qa', revision: 2,
      title: '留下你的经验与答案',
      caption: '把你的做法写下来，也可能帮到别人。',
      note: '站点未开放回答时，实际入口会说明限制；提交后同样进入审核。',
      durationMs: 8104, scene: 'qaAnswer',
      action: 'qa',
      steps: ['看到会答的问题，点「写回答」', '编辑器顶部保留着问题原文', '写下你的做法和适用条件', '提交审核，通过后出现在回答列表']
    },
    'qa-accept': {
      id: 'qa-accept', groupId: 'qa', revision: 2,
      title: '标记解决问题的回答',
      caption: '问题得到解决后，标记有帮助的回答。',
      note: '只有提问者本人可以采纳自己问题的回答；浏览者没有这个按钮。',
      durationMs: 7904, scene: 'qaAccept',
      action: 'qa',
      steps: ['这是你提出的问题，下面有两条回答', '只有提问者能看到「采纳」按钮', '点「采纳为最佳回答」', '绿条加「已采纳」，顺序保持不变']
    }
  };

  // 绝对时间线：at 解说出现，act 对象动作，camera 教学构图，end 最后结果停留。
  var TIMELINES = {
    "find-search": {"end": 9000, "beats": [{"at": 0, "act": 0, "text": "课程和资料，一起搜。", "camera": {"scale": 1, "ms": 620}}, {"at": 1600, "act": 2050, "text": "输入关键词。", "camera": {"scale": 1.18, "ms": 620, "target": "search-box"}}, {"at": 3550, "act": 4000, "text": "点 →，开始搜索。", "camera": {"scale": 1, "ms": 620}}, {"at": 4950, "act": 4950, "text": "课程、资料，都能找到。", "camera": {"scale": 1, "ms": 620}}]},
    "find-filter": {"end": 8400, "beats": [{"at": 0, "act": 0, "text": "资料太多，先筛一下。"}, {"at": 1400, "act": 1850, "text": "按类型筛选。", "camera": {"scale": 1.12, "ms": 620, "target": "chip-type"}}, {"at": 2850, "act": 3300, "text": "只看试卷。", "camera": {"scale": 1, "ms": 620}}, {"at": 4200, "act": 4650, "text": "再选排序。", "camera": {"scale": 1.1, "ms": 620, "target": "chip-sort"}}, {"at": 5700, "act": 6150, "text": "收藏多的排在前面。", "camera": {"scale": 1, "ms": 620}}]},
    "find-same-name": {"end": 7900, "beats": [{"at": 0, "act": 0, "text": "同名课程，代码可能不同。"}, {"at": 1600, "act": 2050, "text": "找到同名入口。", "camera": {"scale": 1.12, "ms": 620, "target": "alt-course"}}, {"at": 3200, "act": 3650, "text": "切换到 DEMO201。", "camera": {"scale": 1, "ms": 620, "target": "bc-cur"}}, {"at": 5100, "act": 5550, "text": "同名课程，资料归属不同。", "camera": {"scale": 1, "ms": 620}}]},
    "find-preview": {"end": 8168, "beats": [{"at": 0, "act": 0, "text": "先看看内容。", "mobileText": "先看看内容。"}, {"at": 1500, "act": 1950, "text": "打开预览。", "camera": {"scale": 1, "ms": 620}, "mobileText": "手机上打开预览。"}, {"at": 3600, "act": 4050, "text": "接着看下一页。", "mobileText": "下载 PDF 后查看。"}, {"at": 6000, "act": 6450, "text": "确认后再下载。", "camera": {"scale": 1.08, "ms": 620, "target": "btn-dl"}, "mobileText": "图片、文本可直接预览。"}]},
    "find-zip": {"end": 7672, "beats": [{"at": 0, "act": 0, "text": "先看压缩包目录。"}, {"at": 1500, "act": 1950, "text": "打开文件清单。", "camera": {"scale": 1, "ms": 620}}, {"at": 3300, "act": 3750, "text": "展开文件夹。"}, {"at": 5600, "act": 6050, "text": "这里只看目录。"}]},
    "find-download": {"end": 9472, "beats": [{"at": 0, "act": 0, "text": "资料可以单独下载。"}, {"at": 1500, "act": 1950, "text": "也可以批量选择。", "camera": {"scale": 1.08, "ms": 620, "target": "btn-batch"}}, {"at": 3300, "act": 3750, "text": "选第一份。"}, {"at": 5000, "act": 5450, "text": "再选一份。"}, {"at": 7400, "act": 7850, "text": "分别开始下载。", "camera": {"scale": 1, "ms": 620}}]},
    "courses-import": {"end": 11000, "beats": [{"at": 0, "act": 0, "text": "课表导入，一次整理。", "camera": {"scale": 1, "ms": 620}}, {"at": 1900, "act": 2350, "text": "选教务导出的课表。", "camera": {"scale": 1.16, "ms": 620, "target": "btn-import"}}, {"at": 3400, "act": 3850, "text": "文件在本地解析。", "camera": {"scale": 1.12, "ms": 620, "target": "import-file"}}, {"at": 5300, "act": 5750, "text": "核对课程，确认导入。", "camera": {"scale": 1.12, "ms": 620, "target": "btn-confirm"}, "texts": {"nolink": "直接生成课程列表。", "generic": "按页面提示完成导入。"}}, {"at": 7600, "act": 8050, "text": "课程都在这里。", "camera": {"scale": 1, "ms": 620}}]},
    "courses-views": {"end": 7400, "beats": [{"at": 0, "act": 0, "text": "找课程，看列表。"}, {"at": 1500, "act": 1950, "text": "看安排，切周课表。", "camera": {"scale": 1, "ms": 620}}, {"at": 3400, "act": 3850, "text": "时间、教室一目了然。", "camera": {"scale": 1.12, "ms": 620, "target": "wk-loc"}}, {"at": 5400, "act": 5850, "text": "切回列表，课程还在。", "camera": {"scale": 1, "ms": 620}}]},
    "courses-open": {"end": 7608, "beats": [{"at": 0, "act": 0, "text": "找到自己的课程。", "texts": {"nolink": "在「我的课程」找到这门课", "generic": "在「我的课程」找到这门课"}}, {"at": 1500, "act": 1950, "text": "点开课程入口。", "texts": {"nolink": "点开课程行", "generic": "点开课程行"}}, {"at": 3200, "act": 3650, "text": "课程名保持连续。", "texts": {"nolink": "查看上课时间与地点", "generic": "示例：查看时间与地点。"}}, {"at": 5600, "act": 6050, "text": "按关联情况查看资料或安排。", "texts": {"nolink": "资料关联取决于课程匹配情况", "generic": "资料关联以页面为准。"}}]},
    "courses-manual": {"end": 8072, "beats": [{"at": 0, "act": 0, "text": "自学课程也能加入。"}, {"at": 1500, "act": 1950, "text": "添加一门课程。", "camera": {"scale": 1, "ms": 620}}, {"at": 3600, "act": 4050, "text": "写课程名，时间可留空。"}, {"at": 6000, "act": 6450, "text": "保存到课程列表。"}]},
    "courses-terms": {"end": 9208, "beats": [{"at": 0, "act": 0, "text": "每学期保留一份课表。"}, {"at": 1500, "act": 1950, "text": "管理中切换课表。"}, {"at": 3000, "act": 3450, "text": "导入为新课表。"}, {"at": 5000, "act": 5450, "text": "旧课表仍然保留。"}, {"at": 7200, "act": 7650, "text": "随时切回上学期。"}]},
    "save-course": {"end": 6100, "beats": [{"at": 0, "act": 0, "text": "常用课程，先收藏。", "camera": {"scale": 1, "ms": 620}}, {"at": 1400, "act": 1850, "text": "点亮星标。", "camera": {"scale": 1.2, "ms": 620, "target": "saved-row"}}, {"at": 2850, "act": 2850, "text": "已收藏。", "camera": {"scale": 1.08, "ms": 620, "target": "saved-row"}}]},
    "save-file": {"end": 6336, "beats": [{"at": 0, "act": 0, "text": "有用的资料，先留下。"}, {"at": 1600, "act": 2050, "text": "点收藏。", "camera": {"scale": 1.14, "ms": 620, "target": "fav-btn", "keepTop": true}}, {"at": 4200, "act": 4650, "text": "已收藏。", "camera": {"scale": 1, "ms": 620}}]},
    "save-answer": {"end": 6300, "beats": [{"at": 0, "act": 0, "text": "留下有帮助的回答。"}, {"at": 1700, "act": 2150, "text": "收藏这一条。", "camera": {"scale": 1.08, "ms": 620, "target": "ans-fav"}}, {"at": 4300, "act": 4750, "text": "回答已收藏。"}]},
    "save-retrieve": {"end": 9100, "beats": [{"at": 0, "act": 0, "text": "收藏从头像菜单找。"}, {"at": 1500, "act": 1950, "text": "打开头像菜单。", "camera": {"scale": 1, "ms": 620}}, {"at": 3200, "act": 3650, "text": "进入我的收藏。", "camera": {"scale": 1, "ms": 620}}, {"at": 5100, "act": 5550, "text": "文件在这里。"}, {"at": 7100, "act": 7550, "text": "帖子里是收藏的回答。"}]},
    "share-file": {"end": 8236, "beats": [{"at": 0, "act": 0, "text": "在课程页上传资料。"}, {"at": 1500, "act": 1950, "text": "打开上传，选择文件。"}, {"at": 3600, "act": 4050, "text": "类型与任课教师必填。"}, {"at": 6100, "act": 6550, "text": "补全信息，提交审核。"}]},
    "share-text": {"end": 8472, "beats": [{"at": 0, "act": 0, "text": "没有文件，也能分享。"}, {"at": 1600, "act": 2050, "text": "切到文字录入。", "camera": {"scale": 1, "ms": 620}}, {"at": 3800, "act": 4250, "text": "写标题和正文。"}, {"at": 6400, "act": 6850, "text": "补全信息，提交审核。"}]},
    "share-course": {"end": 8536, "beats": [{"at": 0, "act": 0, "text": "申请补充课程。"}, {"at": 1600, "act": 2050, "text": "填写名称和代码。"}, {"at": 3800, "act": 4250, "text": "选类型或学院专业。"}, {"at": 6400, "act": 6850, "text": "提交申请，等待审核。"}]},
    "share-review": {"end": 7736, "beats": [{"at": 0, "act": 0, "text": "审核进度从头像菜单找。"}, {"at": 1500, "act": 1950, "text": "进入我的上传。"}, {"at": 3200, "act": 3650, "text": "已发布：审核通过。"}, {"at": 5600, "act": 6050, "text": "审核中：等待审核。"}]},
    "share-resubmit": {"end": 8136, "beats": [{"at": 0, "act": 0, "text": "先看驳回原因。"}, {"at": 1600, "act": 2050, "text": "重新上传。"}, {"at": 3500, "act": 3950, "text": "按原因修改，再提交。"}, {"at": 6000, "act": 6450, "text": "回到审核中。"}]},
    "qa-search": {"end": 7800, "beats": [{"at": 0, "act": 0, "text": "先搜相关讨论。"}, {"at": 1500, "act": 1950, "text": "输入期末复习。"}, {"at": 3400, "act": 3850, "text": "点 → 搜索。"}, {"at": 5800, "act": 6250, "text": "问题和回答，一起找到。"}]},
    "qa-tags": {"end": 9140, "beats": [{"at": 0, "act": 0, "text": "用标签缩小范围。"}, {"at": 1500, "act": 1950, "text": "展开筛选。", "camera": {"scale": 1, "ms": 620}}, {"at": 3200, "act": 3650, "text": "选课程学习。"}, {"at": 4900, "act": 5350, "text": "选期末复习。"}, {"at": 7100, "act": 7550, "text": "再点标签可取消。"}]},
    "qa-ask": {"end": 8108, "beats": [{"at": 0, "act": 0, "text": "把问题说清楚。"}, {"at": 1500, "act": 1950, "text": "一句话写清困惑。"}, {"at": 3600, "act": 4050, "text": "选择分类和话题。"}, {"at": 6100, "act": 6550, "text": "写背景，提交审核。"}]},
    "qa-answer": {"end": 8104, "beats": [{"at": 0, "act": 0, "text": "留下你的经验。"}, {"at": 1500, "act": 1950, "text": "先看问题原文。"}, {"at": 3400, "act": 3850, "text": "写做法和适用条件。"}, {"at": 6000, "act": 6450, "text": "提交后等待审核。"}]},
    "qa-accept": {"end": 7904, "beats": [{"at": 0, "act": 0, "text": "这是你提出的问题。"}, {"at": 1500, "act": 1950, "text": "提问者才能采纳。"}, {"at": 3000, "act": 3450, "text": "标记最佳回答。", "camera": {"scale": 1.08, "ms": 620, "target": "accept-btn"}}, {"at": 5800, "act": 6250, "text": "已采纳，顺序保持。", "camera": {"scale": 1, "ms": 620}}]},
  };
  function timelineOf(lesson, mobile, cap) {
    var t = TIMELINES[lesson.id];
    return { end: t.end, beats: t.beats.map(function (b) {
      var copy = Object.assign({}, b);
      copy.text = (mobile && b.mobileText) || (b.texts && b.texts[cap]) || b.text;
      if (lesson.id === "courses-import" && cap !== "link" && b.camera && b.camera.target === "btn-confirm") copy.camera = { scale: 1, ms: 620 };
      return copy;
    }) };
  }

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
  // 时间线另由 timelineOf 选择分支短句；完整说明始终可阅读。
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
    timelineOf: timelineOf,
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
