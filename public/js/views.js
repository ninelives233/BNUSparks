  function renderEmpty(course) {
    document.getElementById('explorerContent').innerHTML =
      '<div class="empty-state"><div class="es-icon"><span class="gi gi-empty"></span></div><div class="es-text">「' + esc(course.name) + '」暂无资料</div><div class="es-sub">可能是课程尚未开始，或资料正在征集中</div></div>';
  }

  function renderExplorer() {
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
    document.querySelectorAll('.about-tab').forEach(t => t.classList.remove('active'));
    const tab = document.querySelector('.about-tab[onclick*="' + sectionKey + '"]');
    if (tab) tab.classList.add('active');
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
        { heading: '👋 欢迎', text: '欢迎使用 BNU Sparks（木铎星火），北京师范大学同学的课程资料共享平台。你可以在这里查找、下载、分享各门课程的教材、讲义、PPT、试卷等学习资料。以下按使用顺序介绍常用功能。' },
        { heading: '🔑 注册与登录', text: '平台用北师大校内邮箱注册：在「注册」页填写学号（系统自动补全 @mail.bnu.edu.cn）、昵称，并设置至少 8 位的密码。提交后去校内邮箱查收验证邮件，点击链接激活账号后才能登录。登录时只需输入学号，勾选「记住我」可保持登录状态；忘记密码时在登录页点「忘记密码」，按邮件链接重置即可。如果新生不知道如何使用师大邮箱，一般来说直接登录数字京师，首页即有直达入口；若无，可能需按照录取通知书随附的指示进行激活。' },
        { heading: '🔎 搜索资料', text: '顶栏搜索框支持按课程名称、课程代码或资料标题查找。输入关键词回车，结果会同时列出匹配的课程和资料：点课程直达课程目录，点资料直接打开文件详情页。记不清代码时直接搜课程名即可（通识课代码以 GEN 开头）。' },
        { heading: '📁 浏览课程', text: '从首页或左侧导航进入「浏览课程」，选择「通识课」或「专业课」，按「学院 → 专业 → 课程」逐层展开。进入课程后可见该课程的全部资料，顶部可按类型筛选、按上传时间/下载量/收藏量排序。' },
        { heading: '⬇️ 下载资料', text: '每份资料右侧都有「下载」按钮，点击即可保存。每位用户每天有 15 次下载额度，建议合理安排。一次要下多份时，可在列表中勾选多行后点「⬇ 批量下载」。注意：部分浏览器（如 Edge）对批量下载有限制，可能出现漏下，建议用 Chrome 或分小批下载。' },
        { heading: '📄 文件详情与收藏', text: '点击文件所在行进入详情页，可查看资料类型、大小、任课教师、上传者、下载量与收藏量。觉得有用的资料可点「收藏」，之后在右上角头像菜单 →「我的收藏」里随时查看，无需重复搜索。手机浏览器天然不支持预览PDF文件，出现显示问题请谅解。' },
        { heading: '⬆️ 上传资料', text: '登录后进入任意课程页面，点「+ 上传资料」，填写标题、任课教师并选择文件即可提交。资料进入审核队列，通过后对所有人可见；被驳回时可在通知中查看原因并重新上传。建议上传前确认文件归属课程正确、命名清晰，审核会更快通过。' },
        { heading: '🔔 通知中心', text: '点击右上角头像打开菜单，即可进入「通知中心」。审核通过/驳回、文件被删除等消息都会推送在这里，点击通知可直接跳转到对应课程或文件处理。' },
        { heading: '📱 移动端', text: '在手机上点击左上角的 ☰ 菜单按钮，即可像桌面端一样浏览课程、搜索、上传和下载全部功能。更加推荐使用电脑或平板进行浏览，信息显示更全，操作更加方便。' },
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
            return '<a href="#" class="rankings-item" onclick="event.preventDefault();highlightFileId=' + m.id + ';returnState={view:\'rankings\',scrollY:pageYOffset};showExplorer(\'' +
                (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\');navToLast(\'' + esc(m.course_code) + '\')">' +
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
            return '<a href="#" class="rankings-item" onclick="event.preventDefault();highlightFileId=' + m.id + ';returnState={view:\'recentAll\',scrollY:pageYOffset};showExplorer(\'' +
                (m.course_code.startsWith('GEN') ? '通识课' : '专业课') + '\');navToLast(\'' + esc(m.course_code) + '\')">' +
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

  function showLeaderboard() {
    pushViewState('leaderboard', {});
    switchView('leaderboard');
    updateSidebar('leaderboard');
    _lbType = 'upload';
    _lbPage = 1;
    renderLeaderboard('upload', 1);
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

  var _userPublicViewSource = null; // 'leaderboard' | null

  function showUserPublic(userId) {
    _userPublicId = userId;
    _userPublicPage = 1;
    // 记录来源视图用于面包屑
    _userPublicViewSource = history.state && history.state.view === 'leaderboard' ? 'leaderboard' : null;
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
    var html = '<div class="user-public-card">' + avatarHtml +
      '<div class="user-public-info">' +
        '<div class="upi-name">' + esc(u.nickname) + '</div>' +
        '<div class="upi-bio">' + esc(u.bio || '此人神秘，未留简介') + '</div>' +
        memberHtml +
        contactHtml +
      '</div></div>';

    // 统计数据
    html += '<div class="user-stats-row">' +
      '<div class="user-stat-card"><div class="usc-value">' + (u.upload_count || 0) + '</div><div class="usc-label">上传文件</div></div>' +
      '<div class="user-stat-card"><div class="usc-value">' + (u.download_count || 0) + '</div><div class="usc-label">被下载次数</div></div>' +
      '<div class="user-stat-card"><div class="usc-value">' + (u.collection_count || 0) + '</div><div class="usc-label">被收藏次数</div></div>' +
    '</div>';

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

  function openCourseSearchUpload() {
    if (!currentUser) { showLoginModal(); return; }
    var overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.innerHTML =
      '<div class="search-overlay-inner" onclick="event.stopPropagation()">' +
        '<button class="search-overlay-close" onclick="_removeOverlay(this.closest(\'.search-overlay\'))">✕</button>' +
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
          '<button class="so-new-btn" onclick="_removeOverlay(this.closest(\'.search-overlay\'));showNewCourse()">新建课程</button>' +
        '</div>' +
        '<div class="search-overlay-results" id="courseSearchResults">' +
          '<div class="so-hint">' +
            '<div class="so-hint-text">💡 支持按课程名称或代码搜索，如「高等数学」「GEN01」「心理学导论」</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    lockScroll();
    document.getElementById('courseSearchInput').focus();

    var timer;
    document.getElementById('courseSearchInput').addEventListener('input', function() {
      clearTimeout(timer);
      var q = this.value.trim();
      if (q.length < 1) {
        document.getElementById('courseSearchResults').innerHTML =
          '<div class="so-hint"><div class="so-hint-text">💡 支持按课程名称或代码搜索，如「高等数学」「GEN01」「心理学导论」</div></div>';
        return;
      }
      timer = setTimeout(function() { searchCourses(q); }, 300);
    });
    overlay.onclick = function(e) { if (e.target === overlay) _removeOverlay(overlay); };
  }

  async function searchCourses(q) {
    var resultsEl = document.getElementById('courseSearchResults');
    if (!resultsEl) return;
    try {
      var data = await api('/api/search/?q=' + encodeURIComponent(q));
      var courses = data.courses || [];
      if (!courses.length) {
        resultsEl.innerHTML = '<div class="so-empty"><div class="so-empty-icon">🔍</div><div class="so-empty-text">未找到相关课程，试试其他关键词</div></div>';
        return;
      }
      var html = '<div class="so-results-list">';
      courses.forEach(function(c) {
        var typeLabel = c.course_type === 'general' ? '通识课' : '专业课';
        html += '<a href="#" class="so-result-item" onclick="event.preventDefault();_removeOverlay(this.closest(\'.search-overlay\'));showExplorer(\'' + (c.course_type === 'general' ? '通识课' : '专业课') + '\');navToLast(\'' + escJs(c.code) + '\')">' +
          '<span class="so-ri-name">' + esc(c.name) + '</span>' +
          '<span class="so-ri-code">' + esc(c.code) + ' · ' + typeLabel + '</span>' +
          '<span class="so-ri-arrow">→</span></a>';
      });
      html += '</div>';
      resultsEl.innerHTML = html;
    } catch(e) {
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
    expPath = [type];
    pushViewState('explorer', { expPath: [type] });
    renderExplorer();
    switchView('explorer');
    updateSidebar(type === '通识课' ? 'general' : 'major');
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
      else if (view === 'about') showAbout('introduction');
      else if (view === 'admin') showAdminPanel();
      else if (view === 'leaderboard') showLeaderboard();
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
      else if (view === 'about') showAbout('introduction');
      else if (view === 'admin') showAdminPanel();
      else if (view === 'leaderboard') showLeaderboard();
      drawer.classList.remove('open');
    });
  });

