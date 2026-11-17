// 管理后台两张图的渲染回归：独立运行，不需要生产账号或数据。
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = {
  window: {}, sessionStorage: { getItem: () => null },
  esc: value => String(value),
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('public/js/admin-users.js', 'utf8'), context);
const chart = context._identityUserTrendChart({
  labels: ['第一天', '第二天'], total_users: [100, 200], new_users: [1, 2],
});
assert.match(chart, /累计用户 · 左轴/);
assert.match(chart, /新增用户 · 右轴/);
assert.match(chart, /class="axis-total-users"[^>]*>200<\/text>/);
assert.match(chart, /class="axis-new-users"[^>]*>4<\/text>/);
assert.match(chart, /monitor-area-total-users/);
assert.doesNotMatch(context._identityUserTrendChart({ labels: [], total_users: [], new_users: [] }), /NaN|Infinity/);

// 本院圆环覆盖 0%、100%、空站点和缺少身份学院，避免除零与实心扇形回退。
for (const [count, total] of [[0, 10], [10, 10], [0, 0], [3, 10]]) {
  const pie = context._identityCollegeShareCard({ name: '测试学院', count, total_users: total });
  assert.doesNotMatch(pie, /NaN|Infinity/);
  assert.match(pie, new RegExp((total ? count / total * 100 : 0) + '%'));
  assert.match(pie, /role="img" aria-label="测试学院占全站用户的/);
  assert.match(pie, /class="college-share-donut-fill"/);
  assert.doesNotMatch(pie, /<path/);
}
assert.match(context._identityCollegeShareCard(null), /补全学院/);
assert.doesNotMatch(context._distributionBars([{ name: '测试学院', count: 2 }], -1, ''), /<button|onclick=/);

const rows = Array.from({ length: 50 }, (_, i) => ({
  date: '2026-01-' + String(i + 1).padStart(2, '0'), label: '日' + i, all: i,
}));
context.api = () => Promise.resolve({ has_events: true, selected: {}, daily: rows });
vm.runInContext(fs.readFileSync('public/js/admin-events.js', 'utf8'), context);
const target = { innerHTML: '' };
context.window.renderAdminBehaviorEvents(target);
setImmediate(() => {
  const html = target.innerHTML;
  assert.match(html, /最高 49 人/);
  assert.strictEqual((html.match(/class="behavior-day-bar(?: |")/g) || []).length, 50);
  const labels = html.match(/class="behavior-day-bar-label"/g) || [];
  assert.ok(labels.length <= 9);
  assert.match(html, />日0<\/span>/);
  assert.match(html, />日49<\/span>/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  console.log('管理后台图表渲染回归通过');
});
