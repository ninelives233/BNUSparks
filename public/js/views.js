  function renderEmpty(course) {
    document.getElementById('explorerContent').innerHTML =
      '<div class="empty-state"><div class="es-icon"><span class="gi gi-empty"></span></div><div class="es-text">「' + esc(course.name) + '」暂无资料</div><div class="es-sub">可能是课程尚未开始，或资料正在征集中</div></div>';
  }

  function renderExplorer() {
    // 课程树和 explorer 渲染器按需加载，避免公共页面首屏被 751KB 树数据及非核心代码阻塞。
    if (!courseTree || typeof renderGrid !== 'function' || typeof renderList !== 'function' || typeof renderFiles !== 'function') {
      var loading = document.getElementById('explorerContent');
      if (loading) loading.innerHTML = '<div class="empty-state compact">课程目录加载中…</div>';
      var ready = typeof ensureFeature === 'function' ? ensureFeature('explorer') : Promise.resolve();
      ready.then(function() { return loadCourseTree(); }).then(function() {
        var explorer = document.getElementById('explorerView');
        if (explorer && explorer.classList.contains('active')) renderExplorer();
      }).catch(function() {
        if (loading) loading.innerHTML = '<div class="empty-state compact">课程模块加载失败，请刷新重试。</div>';
      });
      return;
    }
    // 自动跳过单文件夹中间层（防止恢复历史路径时落到中间节点）
    const origLen = expPath.length;
    while (true) {
      const node = getNode(expPath);
      if (!node || !node.children || node.children.length !== 1) break;
      const child = node.children[0];
      if (!child.children) break; // 叶子课程，不跳过
      expPath.push(child.name);
    }
    if (expPath.length !== origLen) {
      pushViewState('explorer', { expPath: [...expPath] }, true);
    }

    renderBC();
    const node = getNode(expPath);
    if (!node) return;
    if (node.children) {
      expPath.length === 1 ? renderGrid(node.children) : renderList(node.children);
    } else {
      renderFiles(node);
    }
  }

  // ── View Switching ──
  function switchView(name, skipScroll) {
    document.querySelectorAll('.view-section').forEach(el => {
      el.style.display = '';
      el.classList.toggle('active', el.id === name + 'View');
    });
    if (!skipScroll) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // Iter 7: Footer 仅在首页显示
    _updateFooterVisibility(name);
  }

  function updateSidebar(viewName) {
    document.querySelectorAll('.side-nav a').forEach(a => a.classList.remove('active'));
    const link = document.querySelector('.side-nav a[data-view="' + viewName + '"]');
    if (link) link.classList.add('active');
  }

  // ── About Content Data (易编辑) ──
  const aboutContent = {
    introduction: {
      title: '平台介绍',
      sections: [
        { heading: '🌟 我们的使命', text: '致力于贯彻开源精神，抹平信息差，让每一位北师大同学都能免费获取优质学习资源。' },
        { heading: '📚 平台内容', text: '课程笔记、复习资料、考试真题、学术论文、软件教程等一切对学习有帮助的资源。' },
        { heading: '🤝 贡献方式', text: '任何同学都可以上传资料。我们鼓励每人都贡献一份自己的力量——星星之火，可以燎原！' },
      ]
    },
    help: {
      title: '使用帮助',
      sections: [
        { heading: '📖 浏览资料', text: '通过左侧导航栏选择通识课或专业课分类，逐层进入课程页面，即可浏览和下载资料。' },
        { heading: '🔍 搜索功能', text: '在顶栏搜索框输入课程名、课程代码或资料标题，按回车或点击搜索按钮即可快速查找。' },
        { heading: '📤 上传资料', text: '登录后在任意课程页面点击"上传资料"按钮，填写信息并选择文件即可分享你的学习资源。' },
      ]
    },
    contact: {
      title: '联系我们',
      sections: [
        { heading: '📬 邮箱', text: 'bnusparks@163.com — 欢迎投稿、建议与合作。' },
        { heading: '🐙 GitHub', text: '在 <a href="https://github.com/ninelives233/BNUSparks" target="_blank">github.com/ninelives233/BNUSparks</a> 提交 Issue 或 PR。' },
        { heading: '💬 意见反馈', text: '任何问题或建议都可以通过邮箱或 GitHub 告诉我们。' },
      ]
    },
    privacy: {
      title: '隐私政策',
      sections: [
        { heading: '🔒 信息收集', text: '我们仅收集必要的账号信息（校内邮箱、昵称）用于平台身份识别。' },
        { heading: '🛡️ 信息使用', text: '收集的信息仅用于平台功能（如资料上传身份标识），不会分享给任何第三方。' },
        { heading: '🗑️ 数据删除', text: '如你需要删除账号数据，请通过邮箱联系我们，我们将在 7 个工作日内处理。' },
      ]
    }
  };

  function renderAboutContent(sectionKey) {
    const data = aboutContent[sectionKey] || aboutContent.introduction;
    const container = document.getElementById('aboutSectionContent');
    container.innerHTML = data.sections.map(s =>
      '<section class="about-section"><h3>' + esc(s.heading) + '</h3><p>' + s.text + '</p></section>'
    ).join('');
    // Update tabs
    document.querySelectorAll('.about-tab').forEach(function(t) {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    const tab = document.querySelector('.about-tab[onclick*="' + sectionKey + '"]');
    if (tab) {
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
    }
  }

  function showAbout(section) {
    pushViewState('about', { aboutSection: section || 'introduction' });
    switchView('about');
    updateSidebar('about');
    renderAboutContent(section || 'introduction');
  }

  // ── Static Pages Content Data (易编辑) ──
  const staticPages = {
    tutorial: {
      title: '使用教程',
      sections: [
        { heading: '👋 欢迎', text: '欢迎使用 BNU Sparks（木铎星火），北京师范大学同学的课程资料共享平台。你可以在这里查找、下载、分享课程教材、笔记、讲义、PPT、试卷、论文和软件教程，也可以在问答区交流新生指南类问题。未登录时可以浏览课程、搜索资料、查看公告和排行榜；注册并验证北师大邮箱后，才能上传、下载、收藏、参与问答和使用个人中心。' },
        { heading: '🔑 注册与登录', text: '平台使用北师大校内邮箱注册：点击「注册」，填写 @bnu.edu.cn 或 @mail.bnu.edu.cn 邮箱、昵称和至少 8 位密码。提交后前往校园邮箱查收验证邮件，点击邮件链接激活账号。登录时可以输入完整邮箱或学号；勾选「记住我」可以延长登录状态。忘记密码时点击「忘记密码」，按邮件中的链接设置新密码；修改或重置密码后需要重新登录。' },
        { heading: '🔍 搜索课程和资料', text: '顶部搜索框支持按课程名称、课程代码、资料标题、任课教师或资料描述搜索。点击课程结果进入课程目录，点击资料结果直接打开资料详情；记不清代码时直接搜索课程名即可，通识课代码通常以 GEN 开头。进入问答区后，搜索框会自动切换为搜索问题和回答。' },
        { heading: '📁 浏览课程', text: '从首页或左侧导航进入「通识课」或「专业课」，按课程树逐层展开：通识课通常是「通识分类 → 课程 → 资料」，专业课通常是「学院 → 专业/方向 → 课程 → 资料」。课程资料列表支持按资料类型筛选，并按上传时间、下载量、收藏量或任课教师排序；管理员置顶资料会优先显示。' },
        { heading: '📄 查看、预览和收藏', text: '点击资料行或文件名可查看标题、课程、文件大小、资料类型、教师、上传者、简介、下载量和收藏量。可在线预览 PDF、图片和常见文本/代码文件；ZIP 文件可以查看内部目录结构。PPT/PPTX 等暂不支持在线渲染，可直接下载。觉得资料有用时点击「收藏」，之后从右上角头像菜单 →「我的收藏」查看课程、资料和问答帖子。' },
        { heading: '⬇️ 下载资料', text: '登录后点击资料右侧「下载」即可保存。普通用户每天最多下载 15 个不同资料，管理员角色不限额；待审核资料通过后才会对其他用户开放。一次要下多份时，可在列表中勾选多行后点「批量下载」。部分浏览器（如 Edge）会限制连续多文件下载，建议允许本站的多文件下载权限，或使用 Chrome、分小批下载。' },
        { heading: '⬆️ 上传资料', text: '登录后进入课程页面，点击「上传资料」；首页的「上传文件」按钮会先搜索课程。上传时选择资料类型并填写任课教师，可补充简介；单个文件不超过 50 MB，也可以切换到「文字录入」模式提交文本。普通用户上传后进入审核队列，通过后对所有人可见；被驳回时，通知和「我的上传」会显示原因，点击「重新上传」即可修改后再次提交。' },
        { heading: '🆕 找不到课程？申请新建课程', text: '在上传入口中点击「新建课程」。通识课需要填写课程名称、课程代码和通识分类；专业课需要选择学院、专业和课程归属层级。可以在申请中附带文件或文字资料。系统会检查课程代码：如果该位置已有课程，应直接进入课程上传；如果课程已在其他位置存在，申请通过后会链接到原有课程。普通用户的新建课程申请需要管理员审核。' },
        { heading: '🔔 通知中心和个人中心', text: '点击右上角头像：「通知中心」会显示审核、资料删除、举报处理、公告和问答互动等消息；「我的上传」可按已发布、审核中、已驳回、已删除查看资料；「我的下载」可查看正式下载记录；「我的收藏」可管理课程、资料和问答收藏；「个人中心」可修改昵称、简介、联系方式、头像、培养层次/学院/专业身份标签和密码。普通用户每天可修改一次完整身份标签，也可以决定这些身份是否显示在公开主页。' },
        { heading: '💬 问答区', text: '进入左侧「问答区」后，首次访问的未登录访客需要填写学号完成当前标签页验证。登录用户可以在站点开放提问/回答时参与内容创作。问答区支持两级标签筛选、默认/最新/最热排序、搜索、精选置顶、收藏问题或回答、回答点赞和采纳最佳回答。普通用户发布的问题和回答会先进入审核；被驳回后编辑内容即可重新提交。作者删除内容时需要填写理由，已有回答、点赞或收藏的内容会转为管理员审核的删除申请。' },
        { heading: '🚩 举报与反馈', text: '资料详情和问答内容中都有「举报」入口。至少选择一个举报原因；选择「其他原因」时必须填写详细说明。普通用户每天最多提交 15 次举报。网站问题、课程树缺失、课程申请建议或合作事项，可通过 bnusparks@163.com 联系维护者，也可以在 GitHub 项目提交 Issue 或 PR。' },
        { heading: '📱 移动端', text: '手机上点击左上角 ☰ 打开导航抽屉，即可浏览课程、搜索、查看资料、上传和下载。资料筛选、批量操作、问答编辑和文件预览在电脑或平板上显示更完整；批量下载也更适合在电脑浏览器中使用。' },
      ]
    },
    announcements: {
      title: '公告',
      sections: [
        { heading: '🎉 平台上线', text: 'BNU Sparks 现已正式上线！欢迎访问 bnu.icu，获取和分享学习资料。' },
        { heading: '📢 招募贡献者', text: '我们正在招募平台维护者和内容贡献者。如果你对开源、教育资源开放感兴趣，欢迎通过邮箱联系我们。' },
        { heading: '📋 后续规划', text: '平台将持续更新课程数据，逐步覆盖全校所有专业的培养方案课程。同时将开发更多实用功能，如个人收藏、资料评论等。' },
      ]
    },
    broad: {
      title: '关于大类招生',
      sections: [
        { heading: '', text: '大类招生一般在大一的第一期学期末分流，基本都能够满足第一志愿，而在此期间的课程安排需要参考所属学院发布的大类招生专用培养方案，并主要依靠意向专业的培养方案进行选课。比如说，如果你确定了自己要在社会科学实验班中分流到法学专业，那么直接参照法学的培养方案来进行选课和资料搜集是最方便的做法。' }
      ]
    }
  };

  function renderStaticView(viewKey) {
    const data = staticPages[viewKey];
    const container = document.getElementById(viewKey + 'Content');
    if (!container) return;
    container.innerHTML = data.sections.map(s =>
      '<section class="about-section">' + (s.heading ? '<h3>' + esc(s.heading) + '</h3>' : '') + '<p>' + esc(s.text) + '</p></section>'
    ).join('');
  }

  function showTutorial() {
    pushViewState('tutorial', {});
    switchView('tutorial');
    updateSidebar('home');
    renderStaticView('tutorial');
  }

  function showAnnouncements() {
    pushViewState('announcements', {});
    switchView('announcements');
    updateSidebar('home');
    renderStaticView('announcements');
  }

  function showBroad() {
    pushViewState('broad', {});
    switchView('broad');
    updateSidebar('home');
    renderStaticView('broad');
  }

  // ── Rankings & Recent All Views ──
  async function renderTopDownloaded(restoreScrollY) {
    const container = document.getElementById('rankingsContent');
    container.innerHTML = '<div class="empty-state compact">加载中...</div>';
    try {
      const s = await api('/api/stats/?limit=100');
      const allItems = s.top_downloaded || [];

      function renderList(filterCollege, filterType) {
        var filtered = allItems;
        if (filterType === 'general') {
          filtered = filtered.filter(function(m){ return m.course_code.startsWith('GEN'); });
        }
        if (filterCollege) {
          filtered = filtered.filter(function(m){ return m.college === filterCollege; });
        }
        if (!filterType && !filterCollege) {
          filtered = allItems;
        }

        var colleges = [];
        allItems.forEach(function(m){
          if (m.college && colleges.indexOf(m.college) === -1) colleges.push(m.college);
        });
        colleges.sort();

        var html = '<div class="filter-bar">';
        html += '<button class="fb-pill' + (!filterCollege && !filterType ? ' fb-active' : '') + '" data-filter-college="" data-filter-type="">全部</button>';
        html += '<button class="fb-pill' + (filterType === 'general' ? ' fb-active' : '') + '" data-filter-college="" data-filter-type="general">通识课</button>';
        colleges.forEach(function(c){
          html += '<button class="fb-pill' + (c === filterCollege && !filterType ? ' fb-active' : '') + '" data-filter-college="' + esc(c) + '" data-filter-type="">' + esc(c) + '</button>';
        });
        html += '</div>';

        if (!filtered.length) {
          html += '<div class="rankings-item" style="justify-content:center;color:var(--ink-faint);border:none;background:none">暂无该学院的资料</div>';
        } else {
          html += filtered.map(function(m, i){
            var idx = allItems.indexOf(m) + 1;
            return '<a href="#" class="rankings-item" onclick="event.preventDefault();highlightFileId=' + m.id + ';returnState={view:\'rankings\',scrollY:pageYOffset};navToCourse(\'' +
                (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\',\'' + esc(m.course_code) + '\')">' +
              '<span class="ri-rank">#' + idx + '</span>' +
              '<div class="ri-info"><div class="ri-name">' + esc(m.title) + '</div><div class="ri-meta">' + esc(m.course_name) + '</div></div>' +
              '<span class="ri-stat">' + m.download_count + ' 次下载</span>' +
            '</a>';
          }).join('');
        }

        container.innerHTML = html;
        container.querySelectorAll('.fb-pill').forEach(function(btn){
          btn.addEventListener('click', function(){
            renderList(this.dataset.filterCollege, this.dataset.filterType);
          });
        });
        if (restoreScrollY) requestAnimationFrame(function(){ window.scrollTo({top:restoreScrollY}); });
      }

      renderList(null, null);
    } catch(e) {
      container.innerHTML = '<div class="rankings-item" style="justify-content:center;color:var(--ink-faint)">加载失败</div>';
    }
  }

  async function renderRecentAll(restoreScrollY) {
    const container = document.getElementById('recentAllContent');
    container.innerHTML = '<div class="empty-state compact">加载中...</div>';
    try {
      const s = await api('/api/stats/?limit=100');
      const allItems = s.recent_uploads || [];

      function renderList(filterCollege, filterType) {
        var filtered = allItems;
        if (filterType === 'general') {
          filtered = filtered.filter(function(m){ return m.course_code.startsWith('GEN'); });
        }
        if (filterCollege) {
          filtered = filtered.filter(function(m){ return m.college === filterCollege; });
        }
        if (!filterType && !filterCollege) {
          filtered = allItems;
        }

        var colleges = [];
        allItems.forEach(function(m){
          if (m.college && colleges.indexOf(m.college) === -1) colleges.push(m.college);
        });
        colleges.sort();

        var html = '<div class="filter-bar">';
        html += '<button class="fb-pill' + (!filterCollege && !filterType ? ' fb-active' : '') + '" data-filter-college="" data-filter-type="">全部</button>';
        html += '<button class="fb-pill' + (filterType === 'general' ? ' fb-active' : '') + '" data-filter-college="" data-filter-type="general">通识课</button>';
        colleges.forEach(function(c){
          html += '<button class="fb-pill' + (c === filterCollege && !filterType ? ' fb-active' : '') + '" data-filter-college="' + esc(c) + '" data-filter-type="">' + esc(c) + '</button>';
        });
        html += '</div>';

        if (!filtered.length) {
          html += '<div class="rankings-item" style="justify-content:center;color:var(--ink-faint);border:none;background:none">暂无该学院的资料</div>';
        } else {
          html += filtered.map(function(m){
            return '<a href="#" class="rankings-item" onclick="event.preventDefault();highlightFileId=' + m.id + ';returnState={view:\'recentAll\',scrollY:pageYOffset};navToCourse(\'' +
                (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\',\'' + esc(m.course_code) + '\')">' +
              '<div class="ri-info"><div class="ri-name">' + esc(m.title) + '</div><div class="ri-meta">' + m.created_at + ' · ' + esc(m.course_name) + '</div></div>' +
              '<span class="ri-stat">' + esc(m.uploader_name) + '</span>' +
            '</a>';
          }).join('');
        }

        container.innerHTML = html;
        container.querySelectorAll('.fb-pill').forEach(function(btn){
          btn.addEventListener('click', function(){
            renderList(this.dataset.filterCollege, this.dataset.filterType);
          });
        });
        if (restoreScrollY) requestAnimationFrame(function(){ window.scrollTo({top:restoreScrollY}); });
      }

      renderList(null, null);
    } catch(e) {
      container.innerHTML = '<div class="rankings-item" style="justify-content:center;color:var(--ink-faint)">加载失败</div>';
    }
  }

  function showTopDownloaded(restoreScrollY) {
    pushViewState('rankings', {});
    switchView('rankings', !!restoreScrollY);
    updateSidebar('home');
    renderTopDownloaded(restoreScrollY);
  }

  function showRecentAll(restoreScrollY) {
    pushViewState('recentAll', {});
    switchView('recentAll', !!restoreScrollY);
    updateSidebar('home');
    renderRecentAll(restoreScrollY);
  }

  /* ═══════════════════════════════════════════════════════════
     Iter 7: 用户排行榜
     ═══════════════════════════════════════════════════════════ */

  var _lbType = 'upload';
  var _lbPage = 1;

  // v=164：用户公开页联系/注册信息 SVG 图标（去 emoji）
  var _IC_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
  var _IC_MSG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var _IC_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  var _IC_ID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h4M7 13h4M15 9h2M15 13h2"/></svg>';

  function showLeaderboard() {
    pushViewState('leaderboard', {});
    switchView('leaderboard');
    updateSidebar('leaderboard');
    _lbType = 'upload';
    _lbPage = 1;
    renderLeaderboard('upload', 1);
  }

  function showQa() {
    pushViewState('qa', {});
    switchView('qa');
    updateSidebar('qa');
    if (typeof renderQaView === 'function') {
      renderQaView();
      return;
    }
    var content = document.getElementById('qaContent');
    if (content) content.innerHTML = '<div class="empty-state compact">问答区加载中…</div>';
    if (typeof ensureFeature === 'function') {
      ensureFeature('qa').then(function() {
        var qaView = document.getElementById('qaView');
        if (qaView && qaView.classList.contains('active')) renderQaView();
      }).catch(function() {
        if (content) content.innerHTML = '<div class="empty-state compact">问答模块加载失败，请刷新重试。</div>';
      });
    }
  }

  function switchLeaderboardTab(type) {
    _lbType = type;
    _lbPage = 1;
    document.querySelectorAll('.lb-tab').forEach(function(t) { t.classList.remove('active'); });
    var tab = document.querySelector('.lb-tab[data-type="' + type + '"]');
    if (tab) tab.classList.add('active');
    renderLeaderboard(type, 1);
  }

  async function renderLeaderboard(type, page) {
    var container = document.getElementById('leaderboardContent');
    if (!container) return;
    container.innerHTML = '<div class="empty-state compact">加载中...</div>';
    try {
      var data = await api('/api/user/rankings/?type=' + encodeURIComponent(type) + '&page=' + page);
      var items = data.items || [];
      if (!items.length) {
        container.innerHTML = '<div class="empty-state compact">暂无数据</div>';
        return;
      }
      // v=164：卡片列表 + 前三名印章徽章（金/银/铜），弃表格
      var metricName = type === 'download' ? '被下载次数' : (type === 'collection' ? '被收藏次数' : '上传文件数');
      var html = '<div class="lb-list">';
      items.forEach(function(u) {
        var rowClass = 'lb-row';
        if (u.rank === 1) rowClass += ' top-1';
        else if (u.rank === 2) rowClass += ' top-2';
        else if (u.rank === 3) rowClass += ' top-3';
        var sealClass = 'lb-rank-seal' + (u.rank <= 3 ? ' top-' + u.rank : '');
        var avatarHtml = u.avatar_url
          ? '<img src="' + esc(u.avatar_url) + '" class="lb-avatar" onclick="showUserPublic(' + u.user_id + ')">'
          : '<span class="lb-avatar-placeholder" onclick="showUserPublic(' + u.user_id + ')">' + esc((u.nickname || '?').charAt(0).toUpperCase()) + '</span>';
        html += '<div class="' + rowClass + '">' +
          '<span class="' + sealClass + '">' + u.rank + '</span>' +
          '<div class="lb-user-cell">' + avatarHtml + '<span class="lb-user-name" onclick="showUserPublic(' + u.user_id + ')">' + esc(u.nickname) + '</span></div>' +
          '<div class="lb-stat"><span class="lb-count">' + u.count + '</span><span class="lb-metric">' + metricName + '</span></div>' +
        '</div>';
      });
      html += '</div>';

      // 翻页
      var totalPages = data.total_pages || 1;
      html += '<div class="leaderboard-pagination">';
      html += '<button onclick="renderLeaderboard(\'' + type + '\',' + Math.max(1, page - 1) + ')" ' + (page <= 1 ? 'disabled' : '') + '>‹</button>';
      for (var p = 1; p <= totalPages; p++) {
        html += '<button class="' + (p === page ? 'active' : '') + '" onclick="renderLeaderboard(\'' + type + '\',' + p + ')">' + p + '</button>';
      }
      html += '<button onclick="renderLeaderboard(\'' + type + '\',' + Math.min(totalPages, page + 1) + ')" ' + (page >= totalPages ? 'disabled' : '') + '>›</button>';
      html += '</div>';

      container.innerHTML = html;
    } catch(e) {
      container.innerHTML = '<div class="empty-state compact">加载失败</div>';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     Iter 7: 用户公开页
     ═══════════════════════════════════════════════════════════ */

  var _userPublicId = null;
  var _userPublicPage = 1;
  var _userPublicDetailTab = 'uploads';
  var _userPublicDownloadPage = 1;

  var _userPublicViewSource = null; // 'leaderboard' | null

  function showUserPublic(userId) {
    _userPublicId = userId;
    _userPublicPage = 1;
    _userPublicDetailTab = 'uploads';
    _userPublicDownloadPage = 1;
    // 记录来源视图用于面包屑
    var sourceView = history.state && history.state.view;
    _userPublicViewSource = sourceView === 'leaderboard' ? 'leaderboard' : (sourceView === 'admin' ? 'admin' : null);
    // 渲染动态面包屑
    renderUserPublicBreadcrumb(_userPublicViewSource);
    pushViewState('userPublic', { userId: userId });
    switchView('userPublic');
    updateSidebar(null);
    renderUserPublic(userId, 1);
  }

  function renderUserPublicBreadcrumb(source) {
    var el = document.querySelector('#userPublicView .breadcrumb');
    if (!el) return;
    if (source === 'leaderboard') {
      el.innerHTML = '<a onclick="showHome()">首页</a><span class="bc-sep"> / </span>' +
        '<a onclick="showLeaderboard()">用户排行榜</a><span class="bc-sep"> / </span>' +
        '<span class="bc-current">用户主页</span>';
    } else if (source === 'admin') {
      el.innerHTML = '<a onclick="showHome()">首页</a><span class="bc-sep"> / </span>' +
        '<a onclick="showAdminPanel()">管理后台</a><span class="bc-sep"> / </span>' +
        '<span class="bc-current">用户主页</span>';
    } else {
      el.innerHTML = '<a onclick="showHome()">首页</a><span class="bc-sep"> / </span>' +
        '<span class="bc-current">用户主页</span>';
    }
  }

  var _userPublicCache = {}; // {userId: {page: {ts, data}}} — 60s 前端缓存

  // 文件删除/资料变更后调用，清空公开页前端缓存，避免删除自传后仍残留显示
  function clearUserPublicCache() {
    _userPublicCache = {};
  }

  function switchUserPublicDetailTab(tab) {
    _userPublicDetailTab = tab === 'downloads' ? 'downloads' : 'uploads';
    _userPublicDownloadPage = 1;
    renderUserPublic(_userPublicId, 1);
  }

  function renderAdminUserPublicDownloads(userId, page) {
    var target = document.getElementById('userPublicActivityContent');
    if (!target) return;
    _userPublicDownloadPage = page || 1;
    target.innerHTML = '<div class="admin-loading">加载访问记录…</div>';
    api('/api/admin/users/' + userId + '/downloads/?page=' + _userPublicDownloadPage).then(function(data) {
      var items = data.items || [];
      if (!items.length) {
        target.innerHTML = _pcEmpty('该用户还没有访问记录', '预览或下载行为发生后会按时间倒序显示在这里。');
        return;
      }
      var html = '<div class="user-trace-head"><span>文件访问记录</span><small>共 ' + (data.total || 0) + ' 条，仅总管理员管理模式可见</small></div><div class="pc-list user-download-trace-list">';
      items.forEach(function(record) {
        var deleted = !record.can_open;
        var title = esc(record.material_title) + (deleted ? '<span class="trace-deleted-badge">资料已删除</span>' : '');
        var meta = esc(record.activity_label || '访问了') + ' · ' + esc(record.course_name || '课程信息缺失') + (record.course_code ? ' · ' + esc(record.course_code) : '') + ' · ' + esc(record.created_at);
        var onClick = deleted ? '' : 'showFileDetail({id:' + record.material_id + ',title:\'' + escJs(record.material_title) + '\',course_code:\'' + escJs(record.course_code) + '\',course_name:\'' + escJs(record.course_name) + '\'})';
        html += _pcItem(_fileGlyph(record.file_name), title, meta, '', deleted ? '留痕' : '<span class="pc-side-icon">' + _IC_DOWN + '</span>', onClick);
      });
      html += '</div>';
      if (data.total_pages > 1) {
        html += '<div class="leaderboard-pagination" style="margin-top:var(--space-md)">' +
          '<button onclick="renderAdminUserPublicDownloads(' + userId + ',' + Math.max(1, data.page - 1) + ')" ' + (data.page <= 1 ? 'disabled' : '') + '>‹</button>' +
          '<span class="user-trace-page">第 ' + data.page + ' / ' + data.total_pages + ' 页</span>' +
          '<button onclick="renderAdminUserPublicDownloads(' + userId + ',' + Math.min(data.total_pages, data.page + 1) + ')" ' + (data.page >= data.total_pages ? 'disabled' : '') + '>›</button></div>';
      }
      target.innerHTML = html;
    }).catch(function(err) {
      target.innerHTML = _pcEmpty('访问记录加载失败', esc(err.message || '请稍后重试。'));
    });
  }

  function _renderUserPublicHTML(container, userId, page, data) {
    var u = data.user;
    if (!u) { container.innerHTML = '<div class="empty-state compact">用户不存在</div>'; return; }

    // 用户名片
    var initial = (u.nickname || '?').charAt(0).toUpperCase();
    var avatarHtml = u.avatar_url
      ? '<img src="' + esc(u.avatar_url) + '" class="user-public-avatar">'
      : '<div class="user-public-avatar-placeholder">' + esc(initial) + '</div>';
    var contactHtml = '';
    if (u.contact_email || u.contact_way) {
      contactHtml = '<div class="upi-contact">';
      if (u.contact_email) contactHtml += '<span class="upi-ico">' + _IC_MAIL + '</span> ' + esc(u.contact_email) + ' ';
      if (u.contact_way) contactHtml += '<span class="upi-ico">' + _IC_MSG + '</span> ' + esc(u.contact_way);
      contactHtml += '</div>';
    }
    // 注册时间（member_since 形如 "2026-08"）
    var memberHtml = '';
    if (u.member_since && /^\d{4}-\d{2}$/.test(u.member_since)) {
      var ms = u.member_since.split('-');
      memberHtml = '<div class="upi-member"><span class="upi-ico">' + _IC_CLOCK + '</span> 注册于 ' + ms[0] + ' 年 ' + parseInt(ms[1], 10) + ' 月</div>';
    }
    // 身份标签：后端已按三个公开开关分别过滤。
    var identityHtml = '';
    if (u.education || u.college || u.major) {
      identityHtml = '<div class="upi-identity"><span class="upi-ico">' + _IC_ID + '</span> ' +
        [u.education, u.college, u.major].filter(Boolean).map(esc).join(' · ') + '</div>';
    }
    var html = '<div class="user-public-card">' + avatarHtml +
      '<div class="user-public-info">' +
        '<div class="upi-name">' + esc(u.nickname) + '</div>' +
        '<div class="upi-bio">' + esc(u.bio || '此人神秘，未留简介') + '</div>' +
        identityHtml +
        memberHtml +
        contactHtml +
      '</div></div>';

    // 统计数据
    html += '<div class="user-stats-row">' +
      '<div class="user-stat-card"><div class="usc-value">' + (u.upload_count || 0) + '</div><div class="usc-label">上传文件</div></div>' +
      '<div class="user-stat-card"><div class="usc-value">' + (u.download_count || 0) + '</div><div class="usc-label">被下载次数</div></div>' +
      '<div class="user-stat-card"><div class="usc-value">' + (u.collection_count || 0) + '</div><div class="usc-label">被收藏次数</div></div>' +
    '</div>';

    var canTraceDownloads = currentUser && currentUser.role === 'super_admin' &&
      typeof isMgmtActive === 'function' && isMgmtActive();
    if (canTraceDownloads) {
      html += '<div class="pc-type-bar user-public-admin-tabs"><span class="pc-type-label">管理视图</span>' +
        '<div class="pc-seg" role="tablist" aria-label="用户行为记录">' +
          '<button class="pc-seg-btn' + (_userPublicDetailTab === 'uploads' ? ' active' : '') + '" onclick="switchUserPublicDetailTab(\'uploads\')">上传资料</button>' +
          '<button class="pc-seg-btn' + (_userPublicDetailTab === 'downloads' ? ' active' : '') + '" onclick="switchUserPublicDetailTab(\'downloads\')">访问记录</button>' +
        '</div></div>';
    } else {
      _userPublicDetailTab = 'uploads';
    }
    html += '<div id="userPublicActivityContent">';

    if (canTraceDownloads && _userPublicDetailTab === 'downloads') {
      html += '<div class="admin-loading">加载访问记录…</div></div>';
      container.innerHTML = html;
      renderAdminUserPublicDownloads(userId, _userPublicDownloadPage);
      return;
    }

    // 文件列表（v=164 与收藏/下载/上传统一用 _pcItem/_fileGlyph 组件）
    if (data.materials && data.materials.length) {
      html += '<h3 class="user-files-head">上传的文件</h3>';
      html += '<div class="pc-list">';
      data.materials.forEach(function(m) {
        // 点击直接打开文件详情（修复此前 showHome();navToLast 落到首页）
        var side = '<span class="pc-side-icon">' + _IC_DOWN + '</span>' + m.download_count + ' 次下载';
        html += _pcItem(
          // v=164.1：优先用真实文件名推导扩展名（file_type 为脏值兜底）
          _fileGlyph(m.file_name, m.file_type),
          esc(m.title),
          esc(m.course_name) + ' · ' + m.created_at,
          '',
          side,
          'event.preventDefault();showFileDetail({id:' + m.id + ',title:\'' + escJs(m.title) + '\',course_code:\'' + escJs(m.course_code) + '\',course_name:\'' + escJs(m.course_name) + '\'})'
        );
      });
      html += '</div>';

      // 翻页
      var totalPages = data.total_pages || 1;
      if (totalPages > 1) {
        html += '<div class="leaderboard-pagination" style="margin-top:var(--space-md)">';
        html += '<button onclick="renderUserPublic(' + userId + ',' + Math.max(1, page - 1) + ')" ' + (page <= 1 ? 'disabled' : '') + '>‹</button>';
        for (var p = 1; p <= totalPages; p++) {
          html += '<button class="' + (p === page ? 'active' : '') + '" onclick="renderUserPublic(' + userId + ',' + p + ')">' + p + '</button>';
        }
        html += '<button onclick="renderUserPublic(' + userId + ',' + Math.min(totalPages, page + 1) + ')" ' + (page >= totalPages ? 'disabled' : '') + '>›</button>';
        html += '</div>';
      }
    } else {
      html += _pcEmpty('该用户尚未上传资料', '等 TA 上传第一份课程资料，这里就会热闹起来。');
    }

    html += '</div>';
    container.innerHTML = html;
  }

  async function renderUserPublic(userId, page) {
    var container = document.getElementById('userPublicContent');
    if (!container) return;
    // 前端缓存命中（60s 内）直接渲染，跳过网络请求
    var entry = _userPublicCache[userId] && _userPublicCache[userId][page];
    if (entry && Date.now() - entry.ts < 60000) {
      _renderUserPublicHTML(container, userId, page, entry.data);
      return;
    }
    container.innerHTML = '<div class="empty-state compact">加载中...</div>';
    try {
      var data = await api('/api/user/public/' + userId + '/?page=' + page);
      if (!_userPublicCache[userId]) _userPublicCache[userId] = {};
      _userPublicCache[userId][page] = { ts: Date.now(), data: data };
      _renderUserPublicHTML(container, userId, page, data);
    } catch(e) {
      container.innerHTML = '<div class="empty-state compact">加载失败</div>';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     Iter 7: 公告系统
     ═══════════════════════════════════════════════════════════ */

  function showAnnouncements() {
    pushViewState('announcements', {});
    switchView('announcements');
    updateSidebar('home');
    loadAnnouncements();
  }

  async function loadAnnouncements() {
    var list = document.getElementById('announcementsList');
    if (!list) return;
    list.innerHTML = '<div class="empty-state compact">加载中...</div>';

    // 发布公告按钮权限
    var createBtn = document.getElementById('createAnnouncementBtn');
    if (createBtn && currentUser && currentUser.role === 'super_admin') {
      createBtn.style.display = '';
    } else if (createBtn) {
      createBtn.style.display = 'none';
    }

    try {
      var data = await api('/api/announcements/');
      if (!data || !data.items || !data.items.length) {
        list.innerHTML = '<div class="empty-state compact">暂无公告</div>';
        return;
      }
      var html = '';
      data.items.forEach(function(a) {
        var avatarHtml = a.publisher_avatar
          ? '<img src="' + esc(a.publisher_avatar) + '" class="ai-avatar" onclick="showUserPublic(' + a.publisher_id + ')" title="查看发布者主页">'
          : '<span class="ai-avatar-placeholder" onclick="showUserPublic(' + a.publisher_id + ')" title="查看发布者主页">' + esc((a.publisher_name || '?').charAt(0).toUpperCase()) + '</span>';
        var canDelete = currentUser && (currentUser.id === a.publisher_id || currentUser.role === 'super_admin');
        var deleteBtn = canDelete ? '<button class="ai-delete" onclick="deleteAnnouncement(' + a.id + ')" title="删除公告">🗑</button>' : '';
        html += '<div class="announcement-item">' +
          '<div class="ai-header">' +
            avatarHtml +
            '<span class="ai-title">' + esc(a.title) + '</span>' +
            deleteBtn +
          '</div>' +
          '<div class="ai-content">' + esc(a.content) + '</div>' +
          '<div class="ai-time">' + a.created_at + '</div>' +
        '</div>';
      });
      list.innerHTML = html;
    } catch(e) {
      list.innerHTML = '<div class="empty-state compact">加载失败</div>';
    }
  }

  function showAnnouncementEditor() {
    var overlay = document.createElement('div');
    overlay.className = 'announcement-editor-overlay';
    overlay.innerHTML =
      '<div class="announcement-editor-dialog">' +
        '<h3>发布公告</h3>' +
        '<div class="ae-error" id="aeError" style="display:none"></div>' +
        '<input type="text" id="aeTitle" placeholder="公告标题" maxlength="200">' +
        '<textarea id="aeContent" placeholder="公告内容..."></textarea>' +
        '<div class="ae-actions">' +
          '<button class="ae-publish" onclick="submitAnnouncement(this)">📢 发布</button>' +
          '<button class="ae-cancel" onclick="_removeOverlay(this.closest(\'.announcement-editor-overlay\'))">取消</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    lockScroll();
  }

  async function submitAnnouncement(btn) {
    var title = document.getElementById('aeTitle').value.trim();
    var content = document.getElementById('aeContent').value.trim();
    var errEl = document.getElementById('aeError');
    if (!title) { errEl.textContent = '请输入公告标题'; errEl.style.display = 'block'; return; }
    if (!content) { errEl.textContent = '请输入公告内容'; errEl.style.display = 'block'; return; }
    if (btn) btn.disabled = true;
    try {
      await api('/api/announcements/', { method: 'POST', body: { title: title, content: content } });
      _removeOverlay(btn.closest('.announcement-editor-overlay'));
      loadAnnouncements();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      if (btn) btn.disabled = false;
    }
  }

  async function deleteAnnouncement(aid) {
    if (!confirm('确定删除此公告？')) return;
    try {
      await api('/api/announcements/' + aid + '/', { method: 'DELETE' });
      loadAnnouncements();
    } catch (err) {
      alert('删除失败：' + err.message);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     Iter 7: 首页上传按钮 + 物质支持
     ═══════════════════════════════════════════════════════════ */

  // 首页可以在 explorer 尚未加载时打开上传弹窗；新建课程入口需要等待完整 feature。
  function openNewCourse() {
    var ready = Promise.resolve();
    if (typeof showNewCourse !== 'function' && typeof ensureFeature === 'function') {
      ready = ensureFeature('explorer');
    }
    ready.then(function() {
      if (typeof loadCourseTree === 'function' && (typeof courseTree === 'undefined' || !courseTree)) {
        return loadCourseTree();
      }
    }).then(function() {
      if (typeof showNewCourse !== 'function') throw new Error('新建课程模块未就绪');
      showNewCourse();
    }).catch(function() {
      alert('新建课程模块加载失败，请刷新重试。');
    });
  }

  // 从搜索浮层切换到新建课程时，不能调用 _removeOverlay：它会 history.back()，
  // 而懒加载完成后的 showNewCourse() 又会 pushState，二者竞态会把新建课程页切回首页。
  function openNewCourseFromSearch(button) {
    var overlay = button && button.closest('.search-overlay');
    if (overlay) {
      var returnState = overlay._bnusparksReturnState;
      overlay.remove();
      unlockScroll();
      if (typeof deactivateDialog === 'function') deactivateDialog(overlay);
      // 当前仍停在浮层 history entry，直接替换回进入浮层前的页面，避免异步 popstate。
      if (history.state && history.state._modal) {
        var restored = returnState && returnState._bnusparks
          ? returnState
          : { _bnusparks: true, view: 'home', scrollY: 0 };
        var restoredUrl = typeof routeToPath === 'function'
          ? routeToPath(restored.view, restored) : null;
        history.replaceState(restored, '', restoredUrl || location.pathname);
      }
    }
    openNewCourse();
  }

  function openCourseSearchUpload() {
    if (!currentUser) { showLoginModal(); return; }
    var overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.innerHTML =
      '<div class="search-overlay-inner" onclick="event.stopPropagation()">' +
        '<button type="button" class="search-overlay-close" aria-label="关闭课程搜索" onclick="_removeOverlay(this.closest(\'.search-overlay\'))">✕</button>' +
        '<div class="so-header">' +
          '<div class="so-icon">📤</div>' +
          '<div class="so-title">上传资料</div>' +
          '<div class="so-sub">搜索课程，找到你希望贡献资料的课程</div>' +
        '</div>' +
        '<div class="so-input-group">' +
          '<span class="so-input-icon">🔍</span>' +
          '<input type="text" id="courseSearchInput" placeholder="课程名称或代码…" autofocus>' +
        '</div>' +
        '<div class="so-new-course">' +
          '<div class="so-new-hint">没有要找的学院/专业/课程？点击↓</div>' +
          '<button class="so-new-btn" onclick="openNewCourseFromSearch(this)">新建课程</button>' +
        '</div>' +
        '<div class="search-overlay-results" id="courseSearchResults">' +
          '<div class="so-hint">' +
            '<div class="so-hint-text">💡 支持按课程名称或代码搜索，如「高等数学」「GEN01」「心理学导论」</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    lockScroll();
    // 记录浮层打开前的 SPA 状态，导航到新建课程时就地恢复，不再异步回退。
    overlay._bnusparksReturnState = history.state;
    _pushModalHistory(overlay);
    document.getElementById('courseSearchInput').focus();

    var timer;
    var searchSeq = 0;
    document.getElementById('courseSearchInput').addEventListener('input', function() {
      clearTimeout(timer);
      var seq = ++searchSeq;
      var q = this.value.trim();
      if (q.length < 1) {
        document.getElementById('courseSearchResults').innerHTML =
          '<div class="so-hint"><div class="so-hint-text">💡 支持按课程名称或代码搜索，如「高等数学」「GEN01」「心理学导论」</div></div>';
        return;
      }
      timer = setTimeout(function() { searchCourses(q, overlay, seq, function() { return searchSeq; }); }, 300);
    });
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
  }

  async function searchCourses(q, overlay, requestSeq, currentSeq) {
    var resultsEl = overlay ? overlay.querySelector('#courseSearchResults') : document.getElementById('courseSearchResults');
    if (!resultsEl) return;
    try {
      var data = await api('/api/search/?q=' + encodeURIComponent(q));
      if (!resultsEl.isConnected || (currentSeq && requestSeq !== currentSeq())) return;
      var courses = data.courses || [];
      if (!courses.length) {
        resultsEl.innerHTML = '<div class="so-empty"><div class="so-empty-icon">🔍</div><div class="so-empty-text">未找到相关课程，试试其他关键词</div></div>';
        return;
      }
      var html = '<div class="so-results-list">';
      courses.forEach(function(c) {
        var typeLabel = c.course_type === 'general' ? '通识课' : '专业课';
        html += '<a href="#" class="so-result-item" onclick="event.preventDefault();_removeOverlay(this.closest(\'.search-overlay\'));navToCourse(\'' + (c.course_type === 'general' ? '通识课' : '专业课') + '\',\'' + escJs(c.code) + '\')">' +
          '<span class="so-ri-name">' + esc(c.name) + '</span>' +
          '<span class="so-ri-code">' + esc((c.codes && c.codes.length > 1 ? c.codes : [c.code]).join(' · ')) + ' · ' + typeLabel + '</span>' +
          '<span class="so-ri-arrow">→</span></a>';
      });
      html += '</div>';
      resultsEl.innerHTML = html;
    } catch(e) {
      if (!resultsEl.isConnected || (currentSeq && requestSeq !== currentSeq())) return;
      resultsEl.innerHTML = '<div class="so-empty"><div class="so-empty-icon">⚠️</div><div class="so-empty-text">搜索失败</div></div>';
    }
  }

  function showSupportMessage() {
    alert('当前还没有准备收款码，您对网站的合理使用就是对我们最大的支持！');
  }

  /* ═══════════════════════════════════════════════════════════
     Iter 7: Footer 显示控制
     ═══════════════════════════════════════════════════════════ */

  function _updateFooterVisibility(viewName) {
    // v=160：仅首页显示完整 footer（品牌+三列+备案号行）；
    // 其余页面只保留备案号一行（compact），footer 元素仍占位 → sticky 钉底不受影响
    var footer = document.getElementById('siteFooter');
    if (!footer) return;
    var isHome = viewName === 'home';
    footer.classList.toggle('compact', !isHome);
    // v=163：非首页 footer 再往下沉——内容不足一屏时沉到首屏之下，
    // 正常浏览不向下翻动就看不到，下滑即出现（给短页面滚动反馈）
    document.body.classList.toggle('footer-pushed', !isHome);
  }

  function returnToPreviousView() {
    if (!returnState) return;
    const sv = returnState.scrollY;
    const view = returnState.view;
    returnState = null;
    if (view === 'rankings') showTopDownloaded(sv);
    else if (view === 'recentAll') showRecentAll(sv);
    else showHome(sv);
  }

  function showHome(restoreScrollY) {
    // 首页统计不再阻塞视图展示；切回首页时复用 API 内存缓存/进行中的请求。
    if (typeof loadStats === 'function') loadStats();
    pushViewState('home', {}, _initialNav);
    _initialNav = false;
    returnState = null;
    if (restoreScrollY) {
      switchView('home', true);
      requestAnimationFrame(function(){ window.scrollTo({top: restoreScrollY}); });
    } else {
      switchView('home');
    }
    updateSidebar('home');
  }

  function showExplorer(type) {
    pushViewState('explorer', { expPath: [type] });
    switchView('explorer');
    updateSidebar(type === '通识课' ? 'general' : 'major');
    var render = function() {
      expPath = [type];
      renderExplorer();
      if (currentUser && typeof loadCourseFavorites === 'function') {
        loadCourseFavorites().then(function() {
          var explorer = document.getElementById('explorerView');
          if (explorer && explorer.classList.contains('active')) renderExplorer();
        });
      }
    };
    var content = document.getElementById('explorerContent');
    if (content) content.innerHTML = '<div class="empty-state compact">课程目录加载中…</div>';
    var ready = Promise.resolve();
    if (typeof ensureFeature === 'function' &&
        !(window._bnusparksFeatureReady && window._bnusparksFeatureReady.explorer)) {
      ready = ensureFeature('explorer');
    }
    return ready.then(function() {
      if (typeof loadCourseTree === 'function' && (typeof courseTree === 'undefined' || !courseTree)) {
        return loadCourseTree();
      }
    }).then(function() {
      render();
      return true;
    }).catch(function() {
      if (content) content.innerHTML = '<div class="empty-state compact">课程模块加载失败，请刷新重试。</div>';
      return false;
    });
  }

  // 我的课表：timetable.js 为懒加载模块，这里统一做「认证 → 激活视图 → 确保加载」
  // 先激活路由再等懒加载，避免手机首次从汉堡菜单进入时看起来没有响应。
  var _ttNavPromise = null;

  function ttActivateRoute(writeHistory) {
    if (typeof switchView === 'function') switchView('timetable');
    if (typeof updateSidebar === 'function') updateSidebar('timetable');
    if (writeHistory && typeof pushViewState === 'function') pushViewState('timetable', {});
    if (typeof _updateFooterVisibility === 'function') _updateFooterVisibility('timetable');
  }

  function ttShowModuleError() {
    ttActivateRoute(false);
    var shell = document.getElementById('ttShell');
    if (shell) shell.innerHTML = '<div class="empty-state compact">课表模块加载失败，请刷新重试。</div>';
  }

  function ttEnterTimetableModule() {
    if (typeof showTimetable === 'function') {
      showTimetable();
      return Promise.resolve(true);
    }
    ttActivateRoute(true);
    if (typeof ensureFeature !== 'function') {
      ttShowModuleError();
      return Promise.resolve(false);
    }
    return ensureFeature('timetable').then(function () {
      if (typeof showTimetable === 'function') {
        // 路由已经在懒加载开始时写入，避免重复压入一条 timetable 历史记录。
        showTimetable(true);
        return true;
      }
      ttShowModuleError();
      return false;
    }).catch(function () {
      ttShowModuleError();
      return false;
    });
  }

  function ttNavTimetable() {
    var hasToken = sessionStorage.getItem('token') || localStorage.getItem('token');
    var authReady = window._bnusparksAuthReady;
    if (!currentUser && hasToken && authReady) {
      if (!_ttNavPromise) {
        _ttNavPromise = Promise.resolve(authReady).then(ttEnterTimetableModule);
        _ttNavPromise.then(function () { _ttNavPromise = null; }, function () { _ttNavPromise = null; });
      }
      return _ttNavPromise;
    }
    return ttEnterTimetableModule();
  }

  // ── Sidebar ──
  document.querySelectorAll('.side-nav a').forEach(a => {
    a.addEventListener('click', (e) => {
      const view = a.dataset.view;
      if (!view) return;
      e.preventDefault();
      if (view === 'home') showHome();
      else if (view === 'general') showExplorer('通识课');
      else if (view === 'major') showExplorer('专业课');
      else if (view === 'qa') showQa();
      else if (view === 'about') showAbout('introduction');
      else if (view === 'admin') showAdminPanel();
      else if (view === 'leaderboard') showLeaderboard();
      else if (view === 'timetable') ttNavTimetable();
    });
  });

  // ── Mobile Drawer links ──
  document.querySelectorAll('.mobile-drawer a').forEach(a => {
    a.addEventListener('click', (e) => {
      const view = a.dataset.view;
      if (!view) return;
      e.preventDefault();
      if (view === 'home') showHome();
      else if (view === 'general') showExplorer('通识课');
      else if (view === 'major') showExplorer('专业课');
      else if (view === 'qa') showQa();
      else if (view === 'about') showAbout('introduction');
      else if (view === 'admin') showAdminPanel();
      else if (view === 'leaderboard') showLeaderboard();
      else if (view === 'timetable') ttNavTimetable();
      drawer.classList.remove('open');
    });
  });
