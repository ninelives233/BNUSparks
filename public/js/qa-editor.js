// ═══════════════════════════════════════════════════════════════
// 问答区富文本编辑器（轻量 contenteditable，零依赖）
// 工具栏：段落 / 小标题H2 / 小标题H3 / 加粗 / 斜体 / 下划线
//         无序列表 / 有序列表 / 插图 / 清除格式
// v175：占位符（.is-empty 类，比 :empty 稳）+ 实时字数统计 + 插图 alt/https 预检
// 输出净化前的 HTML 字符串（服务端 /api/admin/qa/... 会再次白名单净化）
// ═══════════════════════════════════════════════════════════════

var _qaEditorTarget = null;   // 当前正在编辑的 contenteditable（插图用）

// 服务端白名单之外再加一层浏览器侧防御：历史脏数据或接口回归也不能直接进入 innerHTML。
function qaSafeHtml(raw) {
  var template = document.createElement('template');
  template.innerHTML = raw || '';
  var allowed = {
    p: [], br: [], strong: [], em: [], u: [], s: [], ul: [], ol: [], li: [], h2: [], h3: [],
    img: ['src', 'alt'], a: ['href', 'title', 'rel', 'target']
  };
  var active = { script: true, style: true, iframe: true, object: true, embed: true, svg: true, math: true };

  Array.from(template.content.querySelectorAll('*')).forEach(function(el) {
    var tag = el.tagName.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(allowed, tag)) {
      if (active[tag]) el.remove();
      else el.replaceWith.apply(el, Array.from(el.childNodes));
      return;
    }
    Array.from(el.attributes).forEach(function(attr) {
      var name = attr.name.toLowerCase();
      if (name.indexOf('on') === 0 || allowed[tag].indexOf(name) < 0) el.removeAttribute(attr.name);
    });
    ['src', 'href'].forEach(function(name) {
      if (!el.hasAttribute(name)) return;
      var value = (el.getAttribute(name) || '').trim();
      var compact = value.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
      var safe = false;
      if (tag === 'img' && name === 'src') {
        safe = (value.indexOf('/media/') === 0 && value.indexOf('//') !== 0) ||
          compact.indexOf('https://') === 0 || compact.indexOf('http://') === 0;
      } else if (tag === 'a' && name === 'href') {
        safe = value.indexOf('#') === 0 || (value.indexOf('/') === 0 && value.indexOf('//') !== 0) ||
          compact.indexOf('https://') === 0 || compact.indexOf('http://') === 0 || compact.indexOf('mailto:') === 0;
      }
      if (!safe) el.removeAttribute(name);
    });
    if (tag === 'a' && el.hasAttribute('target')) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return template.innerHTML;
}

// 可见字数（等价后端 _strip_html：去标签 + 反转义），用于前端实时统计
function qaEditorVisibleLen(html) {
  var div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || '').replace(/\s+/g, '').length;
}

function _qaEditorSyncPlaceholder(editable) {
  var empty = !(editable.textContent || '').trim();
  editable.classList.toggle('is-empty', empty);
}

function _qaEditorSyncCount(editable) {
  var wrap = editable.closest('.qa-editor-wrap');
  if (!wrap) return;
  var numEl = wrap.querySelector('.qa-editor-count-num');
  if (!numEl) return;
  var len = qaEditorVisibleLen(getQaEditorHtml(editable));
  numEl.textContent = len;
  var max = parseInt(wrap.getAttribute('data-max') || '0', 10);
  if (max > 0) {
    var countEl = numEl.closest('.qa-editor-count');
    if (countEl) countEl.classList.toggle('over', len > max);
  }
}

// 在 container 内构建工具栏 + 编辑区，返回 contenteditable 元素
// opts: { placeholder, maxCount }
function buildQaEditor(container, initialHtml, opts) {
  opts = opts || {};
  var placeholder = opts.placeholder || '输入正文…';
  var maxCount = parseInt(opts.maxCount || '0', 10);

  var countHtml = maxCount > 0
    ? '<div class="qa-editor-count"><span class="qa-editor-count-num">0</span> / ' + maxCount + '</div>'
    : '';

  container.innerHTML =
    '<div class="qa-editor-wrap" data-max="' + maxCount + '">' +
      '<div class="qa-editor-toolbar" role="toolbar">' +
        '<button type="button" class="qe-btn" data-cmd="formatBlock" data-value="p" title="正文段落"><span class="qe-paragraph">¶</span></button>' +
        '<button type="button" class="qe-btn qe-h" data-cmd="formatBlock" data-value="h2" title="小标题一">H2</button>' +
        '<button type="button" class="qe-btn qe-h" data-cmd="formatBlock" data-value="h3" title="小标题二">H3</button>' +
        '<span class="qe-sep"></span>' +
        '<button type="button" class="qe-btn qe-bold" data-cmd="bold" title="加粗"><b>B</b></button>' +
        '<button type="button" class="qe-btn qe-italic" data-cmd="italic" title="斜体"><i>I</i></button>' +
        '<button type="button" class="qe-btn qe-underline" data-cmd="underline" title="下划线"><u>U</u></button>' +
        '<span class="qe-sep"></span>' +
        '<button type="button" class="qe-btn" data-cmd="insertUnorderedList" title="无序列表">• ≡</button>' +
        '<button type="button" class="qe-btn" data-cmd="insertOrderedList" title="有序列表">1. ≡</button>' +
        '<span class="qe-sep"></span>' +
        '<button type="button" class="qe-btn" data-cmd="insertImage" title="插入图片">🖼</button>' +
        '<button type="button" class="qe-btn" data-cmd="removeFormat" title="清除格式">⌫</button>' +
      '</div>' +
      '<div class="qa-editor-content" contenteditable="true" data-placeholder="' + placeholder + '">' +
        qaSafeHtml(initialHtml || '') +
      '</div>' +
      countHtml +
    '</div>';

  var editable = container.querySelector('.qa-editor-content');
  container.querySelectorAll('.qe-btn').forEach(function(btn) {
    // mousedown preventDefault：保持选区不被工具栏点击破坏
    btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
    btn.addEventListener('click', function() { handleQaEditorCmd(btn, editable); });
  });
  // 占位符 + 字数实时同步
  editable.addEventListener('input', function() {
    _qaEditorSyncPlaceholder(editable);
    _qaEditorSyncCount(editable);
  });
  _qaEditorSyncPlaceholder(editable);
  _qaEditorSyncCount(editable);
  return editable;
}

function handleQaEditorCmd(btn, editable) {
  var cmd = btn.getAttribute('data-cmd');
  if (cmd === 'insertImage') {
    openQaImageModal(editable);
    return;
  }
  editable.focus();
  try {
    if (cmd === 'formatBlock') {
      document.execCommand('formatBlock', false, btn.getAttribute('data-value'));
    } else {
      document.execCommand(cmd, false, null);
    }
  } catch (e) { /* 忽略不受支持的命令 */ }
}

function getQaEditorHtml(editable) {
  if (!editable) return '';
  return (editable.innerHTML || '').trim();
}

// ── 插图 ──
function openQaImageModal(editable) {
  _qaEditorTarget = editable;
  var old = document.querySelector('.qe-img-overlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay qe-img-overlay';
  overlay.innerHTML =
    '<div class="modal-card qe-img-card">' +
      '<button type="button" class="modal-close" aria-label="关闭插图窗口" onclick="_removeOverlay(this.closest(\'.qe-img-overlay\'))">✕</button>' +
      '<h3 class="modal-title">插入图片</h3>' +
      '<p class="qa-gate-desc">支持上传 JPG/PNG/WebP/GIF，或粘贴图片链接。</p>' +
      '<label class="qe-img-file-label"><span>选择图片文件</span><input type="file" id="qeImgFile" accept="image/*" class="qe-img-file"></label>' +
      '<input type="text" id="qeImgUrl" class="qa-gate-input" style="margin-top:10px" placeholder="或粘贴图片链接 https://…" autocomplete="off">' +
      '<div id="qeImgError" class="qa-gate-error" style="display:none"></div>' +
      '<div class="qa-gate-actions"><button class="qa-gate-btn" onclick="submitQaImageInsert()">插入</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  lockScroll();
  _pushModalHistory(overlay);
  var urlInput = document.getElementById('qeImgUrl');
  if (urlInput) urlInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') submitQaImageInsert(); });
}

function submitQaImageInsert() {
  var fileInput = document.getElementById('qeImgFile');
  var urlInput = document.getElementById('qeImgUrl');
  var errEl = document.getElementById('qeImgError');
  var overlay = document.querySelector('.qe-img-overlay');
  var finish = function(url) {
    if (!url) return;
    if (_qaEditorTarget) {
      _qaEditorTarget.focus();
      try {
        document.execCommand('insertHTML', false, '<img src="' + url.replace(/"/g, '&quot;') + '" alt="图片">');
      } catch (e) {}
      _qaEditorSyncCount(_qaEditorTarget);
    }
    if (overlay) overlay.remove();
    unlockScroll();
    _qaEditorTarget = null;
  };
  if (fileInput && fileInput.files && fileInput.files.length) {
    var fd = new FormData();
    fd.append('image', fileInput.files[0]);
    api('/api/admin/qa/upload-image/', { method: 'POST', body: fd }).then(function(data) {
      finish(data.url);
    }).catch(function(err) {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = (err && (err.message || err.error)) || '上传失败'; }
    });
    return;
  }
  var url = (urlInput ? urlInput.value : '').trim();
  if (url) {
    // v175：链接预检（与服务端白名单一致：/media/ 或 http(s)://）
    if (!/^(\/media\/|https?:\/\/)/i.test(url)) {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = '仅支持本站 /media/ 或 http(s):// 开头的图片链接'; }
      return;
    }
    finish(url);
    return;
  }
  if (errEl) { errEl.style.display = 'block'; errEl.textContent = '请选择图片或输入图片链接'; }
}
