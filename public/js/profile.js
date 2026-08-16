  function showProfile() {
    // 关闭所有视图
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.style.display = 'none';
      v.classList.remove('active');
    });
    // 显示个人资料
    var pv = document.getElementById('profileView');
    if (pv) { pv.style.display = 'block'; pv.classList.add('active'); }
    updateSidebar(null);
    window.scrollTo({ top: 0 });
    pushViewState('profile', {});
    // 加载数据
    loadProfile();
    _updateFooterVisibility('profile');
  }

  async function loadProfile() {
    const emailEl = document.getElementById('profileEmail');
    const nickEl = document.getElementById('profileNickname');
    const roleEl = document.getElementById('profileRole');
    const joinedEl = document.getElementById('profileJoined');
    const quotaEl = document.getElementById('profileQuota');
    const avatarEl = document.getElementById('profileAvatar');
    if (!emailEl) return;
    try {
      const data = await api('/api/auth/profile/');
      emailEl.textContent = data.email;
      nickEl.textContent = data.nickname;
      roleEl.textContent = data.role_label;
      joinedEl.textContent = data.date_joined;
      // 头像：有真实图片则显示 img，否则首字母
      var initial = data.nickname.charAt(0) || '🧑';
      if (data.avatar_url) {
        avatarEl.innerHTML = '<img src="' + esc(data.avatar_url) + '" alt="avatar" style="width:80px;height:80px;border-radius:50%;object-fit:cover">';
      } else {
        avatarEl.textContent = initial;
      }
      quotaEl.textContent = data.daily_download_limit < 0 ? '不限' : (data.daily_download_used || 0) + ' / ' + data.daily_download_limit + ' 次';
      // 管辖板块
      var sectionsRow = document.getElementById('profileSectionsRow');
      var sectionsEl = document.getElementById('profileSections');
      if (sectionsRow && sectionsEl) {
        if (data.sections_display && data.sections_display.length) {
          sectionsEl.textContent = data.sections_display.join('、');
          sectionsRow.style.display = '';
        } else {
          sectionsRow.style.display = 'none';
        }
      }
      // ── v183 身份标签：有身份才显示该行 ──
      var identityRow = document.getElementById('profileIdentityRow');
      var identityEl = document.getElementById('profileIdentity');
      if (identityRow && identityEl) {
        var iCol = data.identity_college || '';
        var iMaj = data.identity_major || '';
        if (iCol || iMaj) {
          identityEl.textContent = iCol + (iCol && iMaj ? ' · ' : '') + iMaj;
          identityRow.style.display = '';
        } else {
          identityRow.style.display = 'none';
        }
      }
      // ── Iter 7: 用户数据 ──
      var statUploads = document.getElementById('statUploads');
      var statDownloads = document.getElementById('statDownloads');
      var statCollections = document.getElementById('statCollections');
      if (statUploads) statUploads.textContent = data.upload_count || 0;
      if (statDownloads) statDownloads.textContent = data.download_count || 0;
      if (statCollections) statCollections.textContent = data.collection_count != null ? data.collection_count : '-';

      // ── Iter 7: 公开资料 ──
      var contactEmailEl = document.getElementById('pubContactEmail');
      var contactWayEl = document.getElementById('pubContactWay');
      var bioEl = document.getElementById('pubBio');
      if (contactEmailEl) contactEmailEl.value = data.contact_email || '';
      if (contactWayEl) contactWayEl.value = data.contact_way || '';
      // v183：公开资料身份开关恢复
      var tCol = document.getElementById('toggleShowCollege');
      var tMaj = document.getElementById('toggleShowMajor');
      if (tCol) tCol.classList.toggle('ios-toggle-on', !!data.show_college_public);
      if (tMaj) tMaj.classList.toggle('ios-toggle-on', !!data.show_major_public);
      if (bioEl) {
        bioEl.value = data.bio || '';
        var countEl = document.getElementById('pubBioCount');
        if (countEl) countEl.textContent = (data.bio || '').length;
      }
    } catch (err) {
      emailEl.textContent = '加载失败';
    }
  }

  // ── v183 身份标签编辑 ──
  function editIdentity() {
    var overlay = document.getElementById('identityEditor');
    var errEl = document.getElementById('identityError');
    if (!overlay) return;
    // 每日限改（普通用户）：服务端兜底，前端先提示
    if (currentUser && currentUser.identity_can_edit === false) {
      alert('身份标签一天仅可更改一次，请明天再试');
      return;
    }
    if (errEl) errEl.style.display = 'none';
    overlay.style.display = 'flex';
    lockScroll();
    var col = (currentUser && currentUser.identity_college) || '';
    var maj = (currentUser && currentUser.identity_major) || '';
    populateIdentitySelects('_idnCollege', '_idnMajor', { college: col, major: maj });
  }

  function onIdentityCollegeChange() {
    fillIdentityMajors('_idnCollege', '_idnMajor', '');
  }

  function closeIdentityEditor() {
    var overlay = document.getElementById('identityEditor');
    if (overlay) overlay.style.display = 'none';
    unlockScroll();
  }

  async function saveIdentity() {
    var errEl = document.getElementById('identityError');
    var college = (document.getElementById('_idnCollege') || { value: '' }).value || '';
    var major = (document.getElementById('_idnMajor') || { value: '' }).value || '';
    try {
      var data = await api('/api/auth/profile/', { method: 'PATCH', body: {
        identity_college: college,
        identity_major: major,
      }});
      // 即时刷新当前用户（供专业课置顶/搜索跳转）与资料卡
      if (currentUser) {
        currentUser.identity_college = (data && data.identity_college) || '';
        currentUser.identity_major = (data && data.identity_major) || '';
        currentUser.identity_can_edit = data && data.identity_can_edit;
      }
      closeIdentityEditor();
      loadProfile();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
    }
  }

  // ── v183 公开资料身份开关（本地翻转视觉，随「保存公开资料」一起提交） ──
  function toggleIdentityPublic(kind) {
    var el = document.getElementById(kind === 'college' ? 'toggleShowCollege' : 'toggleShowMajor');
    if (el) el.classList.toggle('ios-toggle-on');
  }

  // ── 头像上传 ──
  function triggerAvatarUpload() {
    var input = document.getElementById('avatarUploadInput');
    if (input) input.click();
  }

  async function handleAvatarUpload(e) {
    var file = e.target && e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('图片不能超过 2MB');
      return;
    }
    var fd = new FormData();
    fd.append('avatar', file);
    try {
      var token = sessionStorage.getItem('token') || localStorage.getItem('token');
      var resp = await fetch('/api/auth/avatar/', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd,
      });
      var data = null;
      try { data = await resp.json(); } catch (e) { data = null; } // 429 限流/网关页非 JSON → 可读报错
      if (!resp.ok || !data || !data.ok) {
        throw new Error((data && data.error) || (resp.status === 429 ? '上传过于频繁，请稍后重试' : '上传失败（' + resp.status + '）'));
      }
      // 刷新头像显示
      if (currentUser) currentUser.avatar_url = data.data.avatar_url;
      loadProfile();
      updateAuthUI();
      alert('头像已更新');
    } catch (err) {
      alert('头像上传失败：' + err.message);
    }
    e.target.value = ''; // 重置 input 可重复选同一文件
  }

  // ── 我的上传独立页面（Iter 6） ──
  function showMyUploadsPage() {
    closeNotifDrawer();
    // 彻底清除所有视图
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.style.display = 'none';
      v.classList.remove('active');
    });
    var v = document.getElementById('myUploadsView');
    if (v) { v.style.display = 'block'; v.classList.add('active'); }
    updateSidebar(null);
    window.scrollTo({ top: 0 });
    pushViewState('myuploads', {});
    renderMyUploadsPage();
    _updateFooterVisibility('myuploads');
  }

  var _myUploadTab = 'approved';

  // ── v=147 档案目录：类型 glyph / 行模板 / 空状态 / 图标 ──
  var _IC_DOWN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M6 11l6 6 6-6"/><path d="M4 21h16"/></svg>';
  var _IC_STAR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.26 6.86.6-5.18 4.56 1.55 6.72L12 16.6l-6.13 3.54 1.55-6.72L2.24 8.86l6.86-.6z"/></svg>';

  function _fileGlyph(fileName, typeHint) {
    var fn = String(fileName || '');
    var dot = fn.lastIndexOf('.');
    var ext = dot > -1 ? fn.slice(dot + 1).toLowerCase() : '';
    // v=164.1：文件名无扩展名时，从 typeHint 推导。公开页 file_type 是脏值
    // （中文类别名 课件/文档/图片/其他、大写 PDF、空串），中文类别名映射到对应图标
    var typeClass = '', typeLabel = '';
    if (!ext && typeHint) {
      var hint = String(typeHint).replace(/^\./, '').toLowerCase();
      var cnMap = { '课件': ['ppt', '课件'], '文档': ['doc', '文档'], '图片': ['img', '图片'], '其他': ['other', '文件'] };
      var mapped = cnMap[hint];
      if (mapped) { typeClass = mapped[0]; typeLabel = mapped[1]; }
      else ext = hint;
    }
    var map = {
      pdf: 'pdf', ppt: 'ppt', pptx: 'ppt', doc: 'doc', docx: 'doc',
      xls: 'xls', xlsx: 'xls', csv: 'xls', zip: 'zip', rar: 'zip',
      '7z': 'zip', tar: 'zip', gz: 'zip', png: 'img', jpg: 'img',
      jpeg: 'img', gif: 'img', webp: 'img', svg: 'img', bmp: 'img',
      heic: 'img', tiff: 'img', mp3: 'audio', wav: 'audio', flac: 'audio',
      m4a: 'audio', aac: 'audio', mp4: 'video', mov: 'video',
      avi: 'video', mkv: 'video', wmv: 'video', webm: 'video'
    };
    var cls = typeClass || map[ext] || 'other';
    var label = typeLabel || (ext ? ext.slice(0, 4).toUpperCase() : 'FILE');
    label = label.replace(/[^A-Z0-9一-鿿]/g, '') || 'FILE';
    return '<span class="pc-glyph pc-glyph-' + cls + '">' + label + '</span>';
  }

  function _pcItem(tile, titleHtml, metaHtml, actionsHtml, sideHtml, onClick) {
    var row = '<div class="pc-item"' + (onClick ? ' style="cursor:pointer" onclick="' + onClick + '"' : '') + '>';
    var actions = actionsHtml ? '<div class="pc-item-actions">' + actionsHtml + '</div>' : '';
    var side = sideHtml ? '<div class="pc-item-side">' + sideHtml + '</div>' : '';
    return row +
      tile +
      '<div class="pc-item-body">' +
        '<div class="pc-item-title">' + titleHtml + '</div>' +
        '<div class="pc-item-meta">' + metaHtml + '</div>' +
        actions +
      '</div>' +
      side +
    '</div>';
  }

  function _pcEmpty(title, hint, ctaHtml) {
    return '<div class="pc-empty">' +
      '<div class="pc-empty-crate"></div>' +
      '<div class="pc-empty-title">' + title + '</div>' +
      (hint ? '<div class="pc-empty-hint">' + hint + '</div>' : '') +
      (ctaHtml ? ctaHtml : '') +
    '</div>';
  }

  function renderMyUploadsPage() {
    var list = document.getElementById('myUploadsPageList');
    if (!list) return;
    list.innerHTML = '<div class="admin-loading">加载中…</div>';
    // 更新 tab 高亮
    document.querySelectorAll('.mu-tab').forEach(function(t) { t.classList.remove('active'); });
    var activeTab = document.querySelector('.mu-tab[data-tab="' + _myUploadTab + '"]');
    if (activeTab) activeTab.classList.add('active');

    api('/api/user/uploads/').then(function(uploads) {
      if (!uploads || !uploads.length) {
        list.innerHTML = _pcEmpty('还没有上传过资料', '去课程目录上传你的第一份课程资料，管理员审核通过后即可发布。',
          '<button class="pc-empty-cta" onclick="showHome()">去上传资料</button>');
        return;
      }
      var filtered = uploads.filter(function(m) {
        if (_myUploadTab === 'approved') return m.review_status === 'approved';
        if (_myUploadTab === 'pending') return m.review_status === 'pending';
        if (_myUploadTab === 'rejected') return m.review_status === 'rejected';
        if (_myUploadTab === 'deleted') return false; // 需从删除记录单独加载
        return true;
      });
      var tabNames = { approved: '已发布', pending: '审核中', rejected: '已驳回', deleted: '已删除' };
      if (!filtered.length) {
        if (_myUploadTab === 'deleted') { renderMyDeletedTab(list); return; }
        list.innerHTML = _pcEmpty('暂无' + tabNames[_myUploadTab] + '的记录', '切换上方分类，或去课程目录上传新资料。');
        return;
      }
      var html = '';
      filtered.forEach(function(m) {
        var badgeLabel = '', badgeClass = '';
        if (m.review_status === 'pending') { badgeLabel = '审核中'; badgeClass = 'review-badge-pending'; }
        else if (m.review_status === 'rejected') { badgeLabel = '已驳回'; badgeClass = 'review-badge-rejected'; }
        else { badgeLabel = '已发布'; badgeClass = 'review-badge-approved'; }
        var badgeHtml = '<span class="review-badge ' + badgeClass + '">' + badgeLabel + '</span>';
        var actions = '';
        if (m.review_status === 'rejected') {
          actions = '<button class="reupload-btn" onclick="event.stopPropagation();showReUploadDialog(' + m.id + ',\'' + escJs(m.course_code) + '\',\'' + escJs(m.course_name) + '\',\'' + escJs(m.title) + '\',\'' + escJs(m.review_notes||'') + '\',\'' + escJs(m.teacher||'') + '\')">↻ 重新上传</button>' +
            '<button class="delete-rejected-btn" onclick="event.stopPropagation();deleteRejected(' + m.id + ', this)">🗑 删除记录</button>';
        }
        var ctype = m.course_type === 'general' ? '通识课' : '专业课';
        var meta = esc(m.course_name) + ' · ' + formatSize(m.file_size) + ' · ' + m.download_count + ' 次下载' +
          (m.review_status === 'rejected' && m.review_notes ? ' · <span style="color:oklch(0.5 0.12 25)">驳回原因：' + esc(m.review_notes) + '</span>' : '');
        html += _pcItem(
          _fileGlyph(m.file_name),
          esc(m.title) + badgeHtml,
          meta,
          actions,
          esc(m.created_at),
          'showExplorer(\'' + escJs(ctype) + '\');navToLast(\'' + escJs(m.course_code) + '\')'
        );
      });
      list.innerHTML = html;
    }).catch(function(err) {
      list.innerHTML = _pcEmpty('加载失败', '请检查网络后重试。');
    });
  }

  function switchMyUploadsTab(tab) {
    _myUploadTab = tab;
    renderMyUploadsPage();
  }

  // ── 我的下载独立页面 ═══
  function showMyDownloadsPage() {
    closeNotifDrawer();
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.style.display = 'none';
      v.classList.remove('active');
    });
    var v = document.getElementById('myDownloadsView');
    if (v) { v.style.display = 'block'; v.classList.add('active'); }
    updateSidebar(null);
    window.scrollTo({ top: 0 });
    pushViewState('mydownloads', {});
    renderMyDownloadsPage();
    _updateFooterVisibility('mydownloads');
  }

  function renderMyDownloadsPage() {
    var list = document.getElementById('myDownloadsPageList');
    if (!list) return;
    list.innerHTML = '<div class="admin-loading">加载中…</div>';
    api('/api/user/downloads/').then(function(data) {
      if (!data || !data.length) {
        list.innerHTML = _pcEmpty('还没有下载记录', '去课程目录找到需要的资料，下载过的文件会记录在这里。',
          '<button class="pc-empty-cta" onclick="showExplorer(\'通识课\')">去课程目录</button>');
        return;
      }
      list.innerHTML = data.map(function(r) {
        return _pcItem(
          _fileGlyph(r.file_name),
          esc(r.material_title),
          esc(r.course_name) + ' · ' + esc(r.course_code) + ' · ' + esc(r.created_at),
          '',
          '<span class="pc-side-icon">' + _IC_DOWN + '</span>',
          'navToMaterial(' + r.material_id + ',\'' + escJs(r.course_code) + '\',\'' + escJs(r.course_name) + '\')'
        );
      }).join('');
    }).catch(function(err) {
      list.innerHTML = _pcEmpty('加载失败', '请检查网络后重试。');
    });
  }


  function showMyFavoritesPage() {
    closeNotifDrawer();
    document.querySelectorAll('.view-section').forEach(function(v) {
      v.style.display = 'none';
      v.classList.remove('active');
    });
    var v = document.getElementById('myFavoritesView');
    if (v) { v.style.display = 'block'; v.classList.add('active'); }
    updateSidebar(null);
    window.scrollTo({ top: 0 });
    pushViewState('myfavorites', {});
    renderMyFavoritesPage();
    _updateFooterVisibility('myfavorites');
  }

  var _myFavTab = 'course';

  function switchMyFavTab(tab) {
    _myFavTab = tab;
    document.querySelectorAll('.mu-tab[data-favtab]').forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-favtab') === tab);
    });
    renderMyFavoritesPage();
  }

  function renderMyFavoritesPage() {
    var list = document.getElementById('myFavoritesPageList');
    if (!list) return;
    // 重新断言胶囊选中态（从其他页面进入时恢复）
    document.querySelectorAll('.mu-tab[data-favtab]').forEach(function(b) {
      b.classList.toggle('active', b.getAttribute('data-favtab') === _myFavTab);
    });
    if (_myFavTab === 'course') {
      _renderMyCourseFavorites(list);
    } else if (_myFavTab === 'post') {
      _renderMyPostFavorites(list);
    } else {
      _renderMyFileFavorites(list);
    }
  }

  function _renderMyPostFavorites(list) {
    list.innerHTML = '<div class="admin-loading">加载中...</div>';
    api('/api/qa/user/favorites/').then(function(data) {
      var items = data.items || [];
      if (!items.length) {
        list.innerHTML = _pcEmpty('还没有收藏帖子', '在问答区的问题或回答上点击星星，就能收藏到这里。',
          '<button class="pc-empty-cta" onclick="showQa()">去问答区逛逛</button>');
        return;
      }
      list.innerHTML = items.map(function(r) {
        var statusHtml = r.status === 'deleted'
          ? '<span class="pc-dead-label" style="margin-left:6px;font-size:0.7rem;color:var(--ink-faint)">（已删除）</span>' : '';
        var meta = [r.tag_l1, r.tag_l2].filter(Boolean).join(' · ') + ' · ' + esc(r.favorited_at);
        return _pcItem(
          '<span class="pc-glyph pc-glyph-star">★</span>',
          esc(r.title) + statusHtml, meta, '',
          '<span class="pc-side-icon">' + _IC_STAR + '</span>',
          'qaOpenDetail(' + r.id + ')'
        );
      }).join('');
    }).catch(function() { list.innerHTML = _pcEmpty('加载失败', '请检查网络后重试。'); });
  }

  function _renderMyCourseFavorites(list) {
    list.innerHTML = '<div class="admin-loading">加载中...</div>';
    api('/api/user/course-favorites/').then(function(data) {
      var items = data.items || [];
      if (!items.length) {
        list.innerHTML = _pcEmpty('还没有收藏课程', '在课程目录里点击课程行上的星星，就能收藏到这里。',
          '<button class="pc-empty-cta" onclick="showExplorer(\'通识课\')">去收藏课程</button>');
        return;
      }
      list.innerHTML = items.map(function(r) {
        var meta = esc(r.course_code) + (r.college_name ? ' · ' + esc(r.college_name) : '') + ' · ' + esc(r.favorited_at);
        return _pcItem(
          '<span class="pc-glyph pc-glyph-star">★</span>',
          esc(r.course_name),
          meta,
          '',
          '<span class="pc-side-icon">' + _IC_STAR + '</span>',
          'showExplorer(\'' + (r.course_type === 'major' ? '专业课' : '通识课') + '\');navToLast(\'' + escJs(r.course_code) + '\')'
        );
      }).join('');
    }).catch(function() {
      list.innerHTML = _pcEmpty('加载失败', '请检查网络后重试。');
    });
  }

  function _renderMyFileFavorites(list) {
    list.innerHTML = '<div class="admin-loading">加载中...</div>';
    api('/api/user/favorites/').then(function(data) {
      var items = data.items || [];
      if (!items.length) {
        list.innerHTML = _pcEmpty('还没有收藏的文件', '打开文件详情页，点击 ⭐ 就能收藏这份资料。',
          '<button class="pc-empty-cta" onclick="showExplorer(\'通识课\')">去课程目录</button>');
        return;
      }
      list.innerHTML = items.map(function(r) {
        return _pcItem(
          _fileGlyph(r.file_name),
          esc(r.title),
          esc(r.course_name) + ' · ' + esc(r.favorited_at),
          '',
          '<span class="pc-side-icon">' + _IC_STAR + '</span>',
          'navToMaterial(' + r.id + ',\'' + escJs(r.course_code) + '\',\'' + escJs(r.course_name) + '\')'
        );
      }).join('');
    }).catch(function() {
      list.innerHTML = _pcEmpty('加载失败', '请检查网络后重试。');
    });
  }

  function renderMyDeletedTab(listEl) {

    // 从删除记录 API 加载当前用户相关的删除记录
    api('/api/moderation/deletions/?page=1&per_page=100').then(function(data) {
      if (!data.items || !data.items.length) {
        listEl.innerHTML = _pcEmpty('暂无已删除的记录');
        return;
      }
      // 只显示当前用户自己的删除记录
      var mine = data.items.filter(function(r) { return r.deleted_by_id === (currentUser ? currentUser.id : -1); });
      if (!mine.length) {
        listEl.innerHTML = _pcEmpty('暂无已删除的记录');
        return;
      }
      var html = '';
      mine.forEach(function(r) {
        var canRestore = r.can_restore && !r.is_restored;
        var titleHtml = esc(r.title) + (r.is_restored
          ? ' <span class="review-badge review-badge-approved">已恢复</span>'
          : ' <span class="review-badge review-badge-rejected">已删除</span>');
        var actions = canRestore
          ? '<button class="admin-btn admin-btn-approve" onclick="restoreMyDeletion(' + r.id + ', this)">↩ 撤销删除</button>'
          : '';
        var side = (!canRestore && !r.is_restored) ? '已过期' : '';
        html += _pcItem(
          '<span class="pc-glyph pc-glyph-dead">✕</span>',
          titleHtml,
          esc(r.course_name) + ' · ' + formatSize(r.file_size) + ' · 删除于 ' + esc(r.deleted_at),
          actions,
          side
        );
      });
      listEl.innerHTML = html;
    }).catch(function() {
      listEl.innerHTML = _pcEmpty('加载失败');
    });
  }

  async function restoreMyDeletion(delId, btn) {
    var reason = '';
    if (btn) btn.disabled = true;
    try {
      await api('/api/moderation/deletions/' + delId + '/restore/', { method: 'POST', body: { reason: reason } });
      alert('✅ 文件已恢复');
      renderMyUploadsPage();
    } catch(err) {
      alert('恢复失败：' + err.message);
      if (btn) btn.disabled = false;
    }
  }

  // ── 删除驳回记录 ──
  async function deleteRejected(materialId, btn) {
    if (!confirm('确定删除这条已驳回的记录？删除后不可恢复。')) return;
    if (btn) btn.disabled = true;
    try {
      await api('/api/files/' + materialId + '/delete/', { method: 'DELETE' });
      // 刷新我的上传页面
      renderMyUploadsPage();
    } catch (err) {
      alert('删除失败：' + err.message);
      if (btn) btn.disabled = false;
    }
  }

  // ── 驳回重新上传 ──
  let _reuploadOldId = null;

  function showReUploadDialog(materialId, courseCode, courseName, title, reviewNotes, teacher) {
    if (!currentUser) { showLoginModal(); return; }
    _reuploadOldId = materialId;
    showUploadModal(courseCode, courseName);
    document.getElementById('uploadTitle').value = title;
    if (teacher) document.getElementById('uploadTeacher').value = teacher;
    // 显示上次驳回原因提示
    var notesEl = document.getElementById('reuploadInfo');
    if (!notesEl) {
      notesEl = document.createElement('div');
      notesEl.id = 'reuploadInfo';
      notesEl.className = 'reupload-info';
      document.querySelector('#uploadForm .mf-group').before(notesEl);
    }
    notesEl.innerHTML = '📌 上次驳回原因：' + esc(reviewNotes) + '<br><small>修改后重新提交，将重新进入审核流程。旧驳回记录将自动删除。</small>';
    notesEl.style.display = 'block';
  }

  function editNickname() {
    const input = document.getElementById('nicknameInput');
    const current = document.getElementById('profileNickname').textContent;
    if (input) input.value = current;
    document.getElementById('nicknameEditor').style.display = 'flex';
    document.getElementById('nicknameError').style.display = 'none';
    if (input) input.focus();
    lockScroll();
  }

  function cancelEditNickname() {
    document.getElementById('nicknameEditor').style.display = 'none';
    unlockScroll();
  }

  async function saveNickname() {
    const input = document.getElementById('nicknameInput');
    const name = input.value.trim();
    const errEl = document.getElementById('nicknameError');
    if (!name) { errEl.textContent = '昵称不能为空'; errEl.style.display = 'block'; return; }
    if (name.length > 50) { errEl.textContent = '昵称不能超过 50 字'; errEl.style.display = 'block'; return; }
    try {
      const data = await api('/api/auth/profile/', { method: 'PATCH', body: { nickname: name } });
      // 兜底：即使后端响应缺 nickname 字段也不会抛错
      const nick = (data && data.nickname) || name;
      document.getElementById('profileNickname').textContent = nick;
      // 有真实头像时保留 <img>，否则更新首字母
      const avatarEl = document.getElementById('profileAvatar');
      if (avatarEl && !avatarEl.querySelector('img')) {
        avatarEl.textContent = nick.charAt(0) || '🧑';
      }
      cancelEditNickname();
      // 更新全局 currentUser 和头部显示
      if (currentUser) { currentUser.nickname = nick; }
      updateAuthUI();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }

  function showChangePwdOverlay() {
    document.getElementById('changePwdEditor').style.display = 'flex';
    document.getElementById('changePwdError').style.display = 'none';
    document.getElementById('changePwdSuccess').style.display = 'none';
    document.getElementById('cpOldPwd').value = '';
    document.getElementById('cpNewPwd').value = '';
    document.getElementById('cpConfirmPwd').value = '';
    lockScroll();
  }

  function closeChangePwdOverlay() {
    document.getElementById('changePwdEditor').style.display = 'none';
    unlockScroll();
  }

  async function saveChangePwd() {
    const errEl = document.getElementById('changePwdError');
    const successEl = document.getElementById('changePwdSuccess');
    const oldPwd = document.getElementById('cpOldPwd').value;
    const newPwd = document.getElementById('cpNewPwd').value;
    const confirmPwd = document.getElementById('cpConfirmPwd').value;

    if (!oldPwd) { errEl.textContent = '请输入当前密码'; errEl.style.display = 'block'; return; }
    if (newPwd.length < 8) { errEl.textContent = '新密码长度至少 8 位'; errEl.style.display = 'block'; return; }
    if (newPwd !== confirmPwd) { errEl.textContent = '两次输入的新密码不一致'; errEl.style.display = 'block'; return; }

    try {
      await api('/api/auth/change-password/', { method: 'POST', body: { old_password: oldPwd, new_password: newPwd } });
      errEl.style.display = 'none';
      successEl.style.display = 'block';
      setTimeout(function() { closeChangePwdOverlay(); }, 1500);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }

  // ── 通知已读状态 localStorage 缓存 ──
  // ── Iter 7: 保存公开资料 ──
  async function savePublicProfile() {
    var contactEmail = document.getElementById('pubContactEmail').value.trim();
    var contactWay = document.getElementById('pubContactWay').value.trim();
    var bio = document.getElementById('pubBio').value.trim();
    var msgEl = document.getElementById('pubProfileMsg');
    if (bio.length > 200) { alert('个人简介不能超过 200 字'); return; }
    // v183：公开资料身份开关随保存一起提交
    var showCollege = !!(document.getElementById('toggleShowCollege') || {}).classList &&
      document.getElementById('toggleShowCollege').classList.contains('ios-toggle-on');
    var showMajor = !!(document.getElementById('toggleShowMajor') || {}).classList &&
      document.getElementById('toggleShowMajor').classList.contains('ios-toggle-on');
    try {
      await api('/api/auth/profile/', { method: 'PATCH', body: {
        contact_email: contactEmail,
        contact_way: contactWay,
        bio: bio,
        show_college_public: showCollege,
        show_major_public: showMajor,
      }});
      if (msgEl) { msgEl.style.display = 'block'; setTimeout(function(){ msgEl.style.display = 'none'; }, 2000); }
    } catch (err) { alert('保存失败：' + err.message); }
  }

  // ── 公开资料实时字数统计 ──
  document.addEventListener('input', function(e) {
    if (e.target && e.target.id === 'pubBio') {
      var countEl = document.getElementById('pubBioCount');
      if (countEl) countEl.textContent = e.target.value.length;
    }
  });
