/* BNU Sparks · feature-loader.js —— 按视图懒加载非核心前端模块 */
(function() {
  var VERSION = '239';
  var loadedScripts = Object.create(null);
  var loadedStyles = Object.create(null);
  var scriptPromises = Object.create(null);
  var stylePromises = Object.create(null);
  var featurePromises = Object.create(null);

  var featureScripts = {
    explorer: [
      'explorer-upload.js',
      'explorer-mgmt.js',
      'explorer-render.js',
      'newcourse.js'
    ],
    qa: [
      'qa.js',
      'qa-editor.js',
      'qa-compose.js'
    ],
    admin: [
      'qa.js',
      'qa-editor.js',
      'qa-compose.js',
      'admin-pending.js',
      'admin-records.js',
      'admin-users.js',
      'qa-admin.js'
    ],
    timetable: [
      'timetable.js'
    ]
  };

  var featureStyles = {
    explorer: ['course.css'],
    qa: ['qa.css'],
    admin: ['admin.css', 'qa.css'],
    timetable: ['timetable.css']
  };

  function loadStyle(name) {
    if (loadedStyles[name]) return Promise.resolve();
    if (stylePromises[name]) return stylePromises[name];
    stylePromises[name] = new Promise(function(resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/static/css/' + name + '?v=' + VERSION;
      link.onload = function() {
        loadedStyles[name] = true;
        delete stylePromises[name];
        resolve();
      };
      link.onerror = function() {
        delete stylePromises[name];
        console.warn('样式加载失败：' + name);
        reject(new Error('样式加载失败：' + name));
      };
      document.head.appendChild(link);
    });
    return stylePromises[name];
  }

  function loadScript(name) {
    var src = '/static/js/' + name + '?v=' + VERSION;
    if (loadedScripts[src]) return Promise.resolve();
    if (scriptPromises[src]) return scriptPromises[src];
    scriptPromises[src] = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = function() {
        loadedScripts[src] = true;
        delete scriptPromises[src];
        resolve();
      };
      script.onerror = function() {
        delete scriptPromises[src];
        reject(new Error('模块加载失败：' + name));
      };
      document.head.appendChild(script);
    });
    return scriptPromises[src];
  }

  function loadFeature(feature) {
    if (featurePromises[feature]) return featurePromises[feature];
    var styles = (featureStyles[feature] || []).map(loadStyle);
    var scripts = featureScripts[feature] || [];
    var featurePromise = Promise.all(styles).then(function() {
      return scripts.reduce(function(chain, name) {
        return chain.then(function() { return loadScript(name); });
      }, Promise.resolve());
    }).then(function() {
      window._bnusparksFeatureReady = window._bnusparksFeatureReady || {};
      window._bnusparksFeatureReady[feature] = true;
    });
    var retryablePromise = featurePromise.catch(function(err) {
      // 失败只影响本次加载；下一次进入页面/视图可以重新尝试失败的资源。
      if (featurePromises[feature] === retryablePromise) delete featurePromises[feature];
      throw err;
    });
    featurePromises[feature] = retryablePromise;
    return retryablePromise;
  }

  window.ensureFeature = loadFeature;
})();
