/* BNU Sparks · explorer-preview.js —— 预览/ZIP。定义全局符号见本文件内函数名（跨文件公共契约勿改名） */
  var _previewModal = null;

  function _previewUrl(fileId) {
    // 使用短时下载令牌（异步获取后生成 URL）
    return _getDownloadToken(fileId).then(function(dtoken) {
      return '/api/files/' + fileId + '/download/?dtoken=' + encodeURIComponent(dtoken) + '&preview=1&max_pages=3';
    });
  }

  // 获取短时下载令牌（供 _previewUrl 和 doDirectDownload 使用）
  async function _getDownloadToken(fileId) {
    var token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (!token) { throw new Error('请先登录'); }
    var resp = await fetch('/api/files/' + fileId + '/download-token/', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var data = await resp.json();
    if (!data.ok) throw new Error(data.error || '获取下载令牌失败');
    return data.data.token;
  }

  function _isPreviewableExt(fileName) {
    if (!fileName) return 'other';
    var ext = fileName.split('.').pop().toLowerCase();
    if (['zip'].includes(ext)) return 'zip';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['ppt','pptx'].includes(ext)) return 'ppt';
    if (['jpg','jpeg','png','gif','webp','bmp','svg','ico'].includes(ext)) return 'image';
    if (['txt','md','py','js','ts','jsx','tsx','css','html','json','xml','yaml','yml','sh','bash','zsh','conf','ini','cfg','log','csv','sql','c','cpp','h','hpp','java','go','rs','rb','php','pl','lua','r','kt','swift','m','mm','tex','rst','asciidoc','bat','ps1','env','gitignore','dockerfile','makefile'].includes(ext)) return 'text';
    return 'other';
  }

  // 移动端浏览器通常不会在 iframe 内渲染 PDF，而是把 inline 响应交给系统
  // 下载/文档查看器。详情页不能在用户只想查看资料时隐式触发这个行为。
  function _isMobilePdfPreview() {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 768 ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  function _mobilePdfFallbackHtml(fileId, fileName) {
    return '<div class="pv-unsupported pv-mobile-pdf">' +
      '<div class="pv-unsupported-icon">📄</div>' +
      '<div class="pv-unsupported-text">手机浏览器暂不支持内嵌 PDF 预览</div>' +
      '<div class="pv-unsupported-sub">请点击下方按钮，由系统查看器打开或下载文件</div>' +
      '<button class="pv-dl-btn" onclick="doDirectDownload(' + fileId + ')">⬇ 下载 PDF</button>' +
      '</div>';
  }

  function showPreview(fileId) {
    // 关闭已有预览弹窗
    var existing = document.querySelector('.preview-overlay');
    if (existing) existing.remove();

    // 获取文件详情
    // 尝试从表格行 data 取信息
    var tr = document.querySelector('tr[data-file-id="' + fileId + '"]');
    var fileName = '', fileTitle = '';
    if (tr) {
      var fnText = tr.querySelector('.fn-text');
      if (fnText) fileTitle = fnText.textContent || '';
      // 从 data 属性或文本
    }
    // 若无行信息，尝试从 fileLookup（可能不存在）
    // 降级：调用 API
    var promise;
    if (window._fileLookup && window._fileLookup[fileId]) {
      var f = window._fileLookup[fileId];
      promise = Promise.resolve(f);
    } else {
      // 无缓存数据时，直接用文件名信息（预览只需文件 ID 和下载 token）
      promise = Promise.resolve({ id: fileId, title: '#' + fileId, file_name: '' });
    }

    promise.then(function(f) {
      if (!f) f = { id: fileId, title: '文件', file_name: '' };
      var fn = f.file_name || f.title || '';
      var extType = _isPreviewableExt(fn);
      var extBadgeHtml = extBadge(fn);

      // 仅对真正需要内容的类型获取预览令牌；移动端 PDF 改为显式兜底，
      // 不创建 iframe，也不让浏览器在进入详情时自动弹出下载提示。
      var needsPreviewUrl = ['pdf', 'image', 'text'].includes(extType);
      var previewPromise = needsPreviewUrl && !(extType === 'pdf' && _isMobilePdfPreview())
        ? _previewUrl(fileId)
        : Promise.resolve(null);
      previewPromise.then(function(previewUrl) {
        var bodyHtml = '';
        if (extType === 'pdf') {
          bodyHtml = previewUrl
            ? '<iframe src="' + previewUrl + '" style="width:100%;height:100%;border:none;border-radius:var(--radius-md)" class="pv-viewer"></iframe>'
            : _mobilePdfFallbackHtml(fileId, fn);
        } else if (extType === 'image') {
          bodyHtml = '<img src="' + previewUrl + '" alt="' + esc(fn) + '" class="pv-viewer" style="max-width:95%;max-height:95%;object-fit:contain;border-radius:var(--radius-md);box-shadow:0 4px 32px oklch(0 0 0 / 0.3)">';
        } else if (extType === 'text') {
          bodyHtml = '<div class="pv-text-wrap"><pre class="pv-text" id="pvTextContent">加载中…</pre></div>';
        } else if (extType === 'ppt') {
          bodyHtml = '<div class="pv-unsupported">' +
            '<div class="pv-unsupported-icon">📊</div>' +
            '<div class="pv-unsupported-text">此格式暂不支持在线预览</div>' +
            '<div class="pv-unsupported-sub">' + esc(fn || '') + '</div>' +
            '<button class="pv-dl-btn" onclick="closePreview();doDirectDownload(' + fileId + ')">⬇ 下载文件</button>' +
          '</div>';
        } else if (extType === 'zip') {
          bodyHtml = '<div class="pv-zip-loading">正在读取压缩包内的文件列表…</div>';
          // Zip 结构稍后填充（带客户端内存缓存，重复打开不重复请求）
          _loadZipStructure(fileId).then(function(zdata) {
            var pv = document.getElementById('previewBody');
            if (pv && zdata && Array.isArray(zdata.items)) {
              renderZipTree(pv, zdata.items, fileId, fn, zdata.truncated);
            }
          }).catch(function() {});
        } else {
          bodyHtml = '<div class="pv-unsupported">' +
            '<div class="pv-unsupported-icon">📄</div>' +
            '<div class="pv-unsupported-text">此格式暂不支持在线预览</div>' +
            '<div class="pv-unsupported-sub">' + esc(fn || '') + '</div>' +
            '<button class="pv-dl-btn" onclick="closePreview();doDirectDownload(' + fileId + ')">⬇ 下载文件</button>' +
          '</div>';
        }

        var overlay = document.createElement('div');
        overlay.className = 'preview-overlay';
        overlay.innerHTML =
          '<button class="preview-close" onclick="closePreview()">✕</button>' +
          '<div class="preview-header">' +
            '<span class="pv-badge">' + extBadgeHtml + '</span>' +
            '<span class="pv-title" title="' + esc(fn) + '">' + esc(fileTitle || fn || '文件预览') + '</span>' +
            '<button class="pv-dl-btn pv-dl-btn-hdr" onclick="doDirectDownload(' + fileId + ')">⬇ 下载</button>' +
          '</div>' +
          '<div class="preview-body" id="previewBody">' + bodyHtml + '</div>';
        overlay.addEventListener('click', function(e) {
          if (e.target === overlay) closePreview();
        });
        document.body.appendChild(overlay);
        lockScroll();
        _previewModal = overlay;
        _pushModalHistory();

        // 文本文件：fetch 内容
        if (extType === 'text') {
          fetch(previewUrl).then(function(r) {
            if (!r.ok) throw new Error('加载失败');
            return r.text();
          }).then(function(text) {
            var pre = document.getElementById('pvTextContent');
            if (pre) {
              pre.textContent = text.slice(0, 500);
              var ext = fn.split('.').pop().toLowerCase();
              if (['py','js','ts','jsx','tsx','css','html','json','xml','sh','bash','c','cpp','java','go','rs','rb','php','sql','md'].includes(ext)) {
                pre.className = 'pv-text pv-text-code';
              }
            }
          }).catch(function() {
            var pre = document.getElementById('pvTextContent');
            if (pre) pre.textContent = '⚠️ 无法加载文件内容';
          });
        }
      }).catch(function() {
        alert('获取预览链接失败，请重试');
      });
    });
  }

  function closePreview() {
    var overlay = document.querySelector('.preview-overlay');
    if (!overlay) return;
    unlockScroll();
    overlay.remove();
    _previewModal = null;
    if (history.state && history.state._modal) {
      history.back();
    }
  }


  // ── ZIP 结构读取（客户端内存缓存：同一会话内重复打开不重复请求） ──
  var _zipCache = {};
  async function _loadZipStructure(fileId) {
    if (_zipCache[fileId]) return _zipCache[fileId];
    var data = await api('/api/files/' + fileId + '/zip-structure/');
    if (data && Array.isArray(data.items)) {
      _zipCache[fileId] = data;   // 缓存整个响应（含 truncated 标记）
      return data;
    }
    throw new Error('压缩包结构数据为空');
  }

  // ── ZIP 文件结构树渲染（可折叠目录树） ──
  function renderZipTree(container, items, fileId, fileName, truncated) {
    // 构建目录树，插入时顺带累计每个目录的文件数/大小（单趟完成，无重复遍历）
    var root = { __children: {}, __count: 0, __size: 0 };
    var fileCount = 0, totalSize = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      fileCount += 1;
      totalSize += it.size || 0;
      var parts = String(it.name).split('/').filter(function(p) { return p; });
      var cur = root;
      for (var j = 0; j < parts.length - 1; j++) {
        var d = parts[j];
        if (!cur.__children[d]) cur.__children[d] = { __children: {}, __count: 0, __size: 0 };
        cur = cur.__children[d];
        cur.__count += 1;
        cur.__size += it.size || 0;
      }
      var leaf = parts[parts.length - 1];
      if (leaf) cur.__children[leaf] = { __size: it.size || 0, __compressed: it.compressed_size || 0 };
    }

    var inOverlay = !!document.querySelector('.preview-overlay');

    // 空压缩包
    if (!fileCount) {
      container.innerHTML =
        '<div class="pv-zip-header"><span class="pv-zip-filename">📦 ' + esc(fileName || '') + '</span></div>' +
        '<div class="pv-zip-empty">压缩包内没有文件</div>';
      return;
    }

    // 目录优先、不区分大小写字母序
    function sortKeys(node) {
      return Object.keys(node).sort(function(a, b) {
        var aIsDir = !!node[a].__children, bIsDir = !!node[b].__children;
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        var la = a.toLowerCase(), lb = b.toLowerCase();
        return la < lb ? -1 : (la > lb ? 1 : 0);
      });
    }

    var html = '<div class="pv-zip-header">' +
      '<span class="pv-zip-filename" title="' + esc(fileName || '') + '">📦 ' + esc(fileName || '') + '</span>' +
      '<span class="pv-zip-stats">' + fileCount + ' 个文件 · 共 ' + formatSize(totalSize) + '</span>' +
      (truncated ? '<span class="pv-zip-trunc">仅显示前 ' + items.length + ' 项</span>' : '') +
    '</div><div class="pv-zip-tree">';

    function renderNode(node, depth) {
      var out = '';
      var keys = sortKeys(node);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var val = node[key];
        if (val.__children) {
          // 目录：<details> 原生折叠，顶层两级默认展开
          out += '<details class="pv-zip-dir"' + (depth < 2 ? ' open' : '') + '>' +
            '<summary><span class="pzd-arrow">▸</span>' +
            '<span class="pzd-icon">📁</span><span class="pzd-name">' + esc(key) + '</span>' +
            '<span class="pzd-meta">' + val.__count + ' 项 · ' + formatSize(val.__size) + '</span></summary>' +
            '<div class="pzd-children">' + renderNode(val.__children, depth + 1) + '</div>' +
          '</details>';
        } else {
          out += '<div class="pv-zip-file" title="' + esc(key) + '">' +
            '<span class="pzf-icon">📄</span>' +
            '<span class="pv-zip-fname">' + esc(key) + '</span>' +
            '<span class="pv-zip-fsize">' + formatSize(val.__size) + '</span>' +
          '</div>';
        }
      }
      return out;
    }

    html += renderNode(root.__children, 0);
    html += '</div>' +
      '<div class="pv-zip-footer"><button class="pv-dl-btn" onclick="' +
        (inOverlay ? 'closePreview();' : '') + 'doDirectDownload(' + fileId + ')">⬇ 下载文件</button></div>';

    container.innerHTML = html;
  }


  /* renderEmpty moved to views.js */
