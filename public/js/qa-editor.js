// ═══════════════════════════════════════════════════════════════
// 问答区富文本编辑器（轻量 contenteditable，零依赖）
// 工具栏：加粗 / 斜体 / 下划线 / 无序列表 / 有序列表 / 插图 / 清除格式
// 输出净化前的 HTML 字符串（服务端 /api/admin/qa/... 会再次白名单净化）
// ═══════════════════════════════════════════════════════════════

var _qaEditorTarget = null;   // 当前正在编辑的 contenteditable（插图用）

// 在 container 内构建工具栏 + 可编辑区，返回 contenteditable 元素
function buildQaEditor(container, initialHtml) {
  container.innerHTML =
    '<div class="qa-editor-toolbar" role="toolbar">' +
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
    '<div class="qa-editor-content" contenteditable="true" data-placeholder="输入正文…">' +
      (initialHtml || '') +
    '</div>';
  var editable = container.querySelector('.qa-editor-content');
  container.querySelectorAll('.qe-btn').forEach(function(btn) {
    // mousedown preventDefault：保持选区不被工具栏点击破坏
    btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
    btn.addEventListener('click', function() { handleQaEditorCmd(btn, editable); });
  });
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
    document.execCommand(cmd, false, null);
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
    '<div class="modal-card qa-gate-card">' +
      '<button class="modal-close" onclick="this.closest(\'.qe-img-overlay\').remove();unlockScroll()">✕</button>' +
      '<h3 class="modal-title">插入图片</h3>' +
      '<p class="qa-gate-desc">支持上传 JPG/PNG/WebP/GIF，或粘贴图片链接。</p>' +
      '<input type="file" id="qeImgFile" accept="image/*" class="qe-img-file">' +
      '<input type="text" id="qeImgUrl" class="qa-gate-input" style="margin-top:10px" placeholder="或粘贴图片链接 https://…" autocomplete="off">' +
      '<div id="qeImgError" class="qa-gate-error" style="display:none"></div>' +
      '<div class="qa-gate-actions"><button class="qa-gate-btn" onclick="submitQaImageInsert()">插入</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  lockScroll();
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
        document.execCommand('insertHTML', false, '<img src="' + url.replace(/"/g, '&quot;') + '" alt="">');
      } catch (e) {}
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
  if (url) { finish(url); return; }
  if (errEl) { errEl.style.display = 'block'; errEl.textContent = '请选择图片或输入图片链接'; }
}
