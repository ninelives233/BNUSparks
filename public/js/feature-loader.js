/* BNU Sparks · feature-loader.js —— 按视图懒加载非核心前端模块 */
(function() {
  var VERSION = '195';
  var loadedScripts = Object.create(null);
  var loadedStyles = Object.create(null);
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
    ]
  };

  var featureStyles = {
    explorer: ['course.css'],
    qa: ['qa.css'],
    admin: ['admin.css', 'qa.css']
  };

  function loadStyle(name) {
    if (loadedStyles[name]) return Promise.resolve();
    return new Promise(function(resolve) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/static/css/' + name + '?v=' + VERSION;
      link.onload = function() { loadedStyles[name] = true; resolve(); };
      link.onerror = function() { resolve(); };
      document.head.appendChild(link);
    });
  }

  function loadScript(name) {
    var src = '/static/js/' + name + '?v=' + VERSION;
    if (loadedScripts[src]) return Promise.resolve();
    return new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = function() { loadedScripts[src] = true; resolve(); };
      script.onerror = function() { reject(new Error('模块加载失败：' + name)); };
      document.head.appendChild(script);
    });
  }

  function loadFeature(feature) {
    if (featurePromises[feature]) return featurePromises[feature];
    var styles = (featureStyles[feature] || []).map(loadStyle);
    var scripts = featureScripts[feature] || [];
    featurePromises[feature] = Promise.all(styles).then(function() {
      return scripts.reduce(function(chain, name) {
        return chain.then(function() { return loadScript(name); });
      }, Promise.resolve());
    }).then(function() {
      window._bnusparksFeatureReady = window._bnusparksFeatureReady || {};
      window._bnusparksFeatureReady[feature] = true;
    });
    return featurePromises[feature];
  }

  window.ensureFeature = loadFeature;
})();
