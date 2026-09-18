/* BNU Sparks · monitoring-events.js —— 低写入行为事件采集器（v=300）
 * 页面/搜索事件在浏览器内聚合后再发送；关键业务事件由服务端记录。
 * 匿名标识只在本地按日轮换，服务端仅保存对应日的 HMAC 摘要。
 */
(function() {
  'use strict';

  var STORAGE_KEY = 'bnusparks_monitoring_anon_v1';
  var BATCH_LIMIT = 20;
  var QUEUE_LIMIT = 100;
  var FLUSH_MS = 20000;
  var ALLOWED = {
    'view.open': true,
    'search.execute': true,
    'search.no_result': true
  };
  var queue = [];
  var flushing = false;
  var flushTimer = null;

  function dayKey() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function randomId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        var bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.prototype.map.call(bytes, function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
    } catch (e) { /* fall through */ }
    return String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  }

  function visitorId() {
    var today = dayKey();
    try {
      var current = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (current && current.day === today && typeof current.id === 'string' && current.id.length >= 16) return current.id;
      var next = { day: today, id: randomId() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next.id;
    } catch (e) {
      return randomId();
    }
  }

  function authenticated() {
    try {
      if (typeof currentUser !== 'undefined' && !!currentUser) return true;
      return !!(sessionStorage.getItem('token') || localStorage.getItem('token'));
    } catch (e) { return false; }
  }

  function eventId() {
    return 'cl-' + randomId();
  }

  function track(name, details) {
    if (!ALLOWED[name]) return false;
    details = details || {};
    var event = {
      event_id: eventId(),
      event_name: name,
      audience: authenticated() ? 'user' : 'anonymous',
      anonymous_id: visitorId(),
      occurred_at: new Date().toISOString()
    };
    if (name === 'view.open') {
      event.view_name = String(details.view_name || details.viewName || 'other');
    }
    queue.push(event);
    if (queue.length > QUEUE_LIMIT) queue.splice(0, queue.length - QUEUE_LIMIT);
    if (queue.length >= BATCH_LIMIT) flush(false);
    scheduleFlush();
    return true;
  }

  function scheduleFlush() {
    if (flushTimer || !queue.length) return;
    flushTimer = window.setTimeout(function() {
      flushTimer = null;
      flush(false);
    }, FLUSH_MS);
  }

  function token() {
    try { return sessionStorage.getItem('token') || localStorage.getItem('token') || ''; } catch (e) { return ''; }
  }

  function flush(keepalive) {
    if (flushing || !queue.length) return Promise.resolve(false);
    flushing = true;
    var batch = queue.splice(0, BATCH_LIMIT);
    var headers = { 'Content-Type': 'application/json', 'X-BNU-Visitor': visitorId() };
    var auth = token();
    if (auth) headers.Authorization = 'Bearer ' + auth;
    return fetch('/api/monitoring/events/', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ events: batch }),
      keepalive: !!keepalive,
      credentials: 'same-origin'
    }).then(function(resp) {
      return resp.json().then(function(data) {
        if (!resp.ok || !data || data.ok === false) throw new Error('monitoring batch rejected');
        return true;
      });
    }).catch(function() {
      queue = batch.concat(queue).slice(-QUEUE_LIMIT);
      return false;
    }).then(function(result) {
      flushing = false;
      if (queue.length) scheduleFlush();
      return result;
    });
  }

  window.BnuMonitoring = {
    track: track,
    flush: flush,
    visitorId: visitorId,
    normalizeViewName: function(name) { return String(name || 'other'); }
  };

  window.addEventListener('pagehide', function() { flush(true); });
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') flush(true);
  });
})();
