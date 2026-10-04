#!/usr/bin/env node
'use strict';
/* 教程分镜守门：在最小 DOM 桩中加载 tutorial-data/scenes/player，
   验证前端分镜契约（不替代浏览器体验验收）：
   1. 25 个分镜全部能构建，步骤数与 tutorial-data.js 的 steps 一一对应；
   2. 每步 go(i) 可从初始状态直接推进（静态降级视图依赖此性质）；
   3. 每步焦点对象（targets[i]，播放器加 is-hot 焦点环）在该步开始前
      已存在于场景根内；
   4. 时长满足节奏公式：pace[k]（第 k+1 步与前一步字幕的间隔）全部 ≥1.5s；
      durationMs = 末步 cue + readLead(末步文案) + 1.5s（readLead 见
      tutorial-player.js，动作在字幕后留阅读时间、结果留观察停留）；
      无 pace 时按均匀分布兜底检查；
   5. capability 保守分支：无会话信息时为 generic。 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    childNodes: [],
    attributes: {},
    style: {},
    className: '',
    textContent: '',
    type: '',
    disabled: false,
    hidden: false,
    tabIndex: -1,
    offsetWidth: 0,
    parentNode: null,
    isConnected: true,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      // 与真实 DOM 一致：class 属性反映到 className/classList
      if (name === 'class') this.className = String(value);
    },
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    removeAttribute(name) { delete this.attributes[name]; },
    hasAttribute(name) { return name in this.attributes; },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    },
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.removeChild(child);
      if (!ref) return this.appendChild(child);
      const i = this.childNodes.indexOf(ref);
      child.parentNode = this;
      if (i === -1) this.childNodes.push(child);
      else this.childNodes.splice(i, 0, child);
      return child;
    },
    replaceChild(next, prev) {
      const i = this.childNodes.indexOf(prev);
      if (i === -1) throw new Error('replaceChild: ref not found');
      if (next.parentNode) next.parentNode.removeChild(next);
      this.childNodes[i] = next;
      next.parentNode = this;
      prev.parentNode = null;
      return prev;
    },
    removeChild(child) {
      const i = this.childNodes.indexOf(child);
      if (i !== -1) this.childNodes.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    matches() { return false; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        n.childNodes.forEach((c) => {
          if (matchSel(c, sel)) out.push(c);
          walk(c);
        });
      };
      walk(this);
      return out;
    },
  };
  Object.defineProperty(node, 'children', { get() { return node.childNodes; } });
  Object.defineProperty(node, 'firstChild', { get() { return node.childNodes[0] || null; } });
  const classes = new Set();
  Object.defineProperty(node, 'className', {
    get() { return Array.from(classes).join(' '); },
    set(v) {
      classes.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
  });
  node.classList = {
    add(...cs) { cs.forEach((c) => classes.add(c)); },
    remove(...cs) { cs.forEach((c) => classes.delete(c)); },
    toggle(c, force) {
      const want = force === undefined ? !classes.has(c) : !!force;
      if (want) classes.add(c); else classes.delete(c);
      return want;
    },
    contains(c) { return classes.has(c); },
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return ''; },
    set() { node.childNodes = []; },
  });
  Object.defineProperty(node, 'textContent', {
    get() {
      return node.childNodes.map((c) => c.textContent).join('');
    },
    set(v) {
      node.childNodes = [];
      node.__text = String(v);
    },
  });
  return node;
}

function matchSel(n, sel) {
  sel = sel.trim();
  const attr = sel.match(/^\[data-mark="([^"]+)"\]$/);
  if (attr) return n.attributes['data-mark'] === attr[1];
  if (sel.charAt(0) === '.') {
    return sel.slice(1).split(/\s+/).every((cls) => n.classList.contains(cls));
  }
  return false;
}

function makeDocument() {
  return {
    createElement: (t) => makeNode(t),
    createElementNS: (ns, t) => makeNode(t),
    createTextNode: (t) => {
      const n = makeNode('#text');
      n.textContent = String(t);
      return n;
    },
  };
}

function loadModule(file, sandbox) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

const sandbox = { document: makeDocument(), console };
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

loadModule('public/js/tutorial-data.js', sandbox);
loadModule('public/js/tutorial-scenes.js', sandbox);
loadModule('public/js/tutorial-player.js', sandbox);

const D = sandbox.window.BnuTutorialData;
const S = sandbox.window.BnuTutorialScenes;
const P = sandbox.window.BnuTutorialPlayer;

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error('  ✗ ' + msg);
  }
}

// 1. 契约：能力保守分支
check(D.capability() === 'generic', 'capability()：无会话信息应为 generic');

const lessons = D.allLessonIds();
check(lessons.length === 25, '分镜总数应为 25，实际 ' + lessons.length);

for (const id of lessons) {
  const lesson = D.lessons[id];
  const label = id;

  check(S.has(lesson.scene), label + '：场景 ' + lesson.scene + ' 不存在');

  // 桌面与窄屏两套上下文都要能构建
  for (const mobile of [false, true]) {
    const ctx = { mobile, capability: 'link' };
    let scene = null;
    try { scene = S.build(lesson.scene, ctx); } catch (e) {
      check(false, label + (mobile ? '（手机）' : '') + '：构建抛错 ' + e.message);
      continue;
    }
    check(!!scene, label + (mobile ? '（手机）' : '') + '：构建失败');
    if (!scene) continue;

    // 2. 步骤数与数据一致（手机 variants 生效时按 variant 口径）
    const variant = D.lessonVariant(lesson, mobile);
    check(scene.steps === variant.steps.length,
      label + (mobile ? '（手机）' : '') + '：场景步数 ' + scene.steps +
      ' ≠ steps.length ' + variant.steps.length);

    // 3. go(i) 从初始状态直接推进不抛错；焦点对象在该步开始前存在
    for (let i = 0; i < scene.steps; i++) {
      const inst = S.build(lesson.scene, ctx);
      try {
        if (i > 0) inst.go(i - 1);
        const t = scene.targets[i];
        if (t) {
          const el = inst.root.querySelector('[data-mark="' + t + '"]');
          check(!!el, label + (mobile ? '（手机）' : '') + '：第 ' + i + ' 步焦点对象 #' + t + ' 不存在');
        }
        inst.go(i);
      } catch (e) {
        check(false, label + (mobile ? '（手机）' : '') + '：go(' + i + ') 抛错 ' + e.message);
      }
    }

    // 4. 时长满足节奏公式：优先 data.pace（逐步声明），否则均匀分布兜底。
    //    硬下限：pace[k] 全部 ≥1.5s（字幕阅读 + 结果停留的最小预算）；
    //    durationMs = 末步 cue + readLead(末步文案) + 1.5s（按基础步骤文案计，
    //    pace 与 durationMs 都属于基础口径，与能力/视口分支无关）。
    const n = scene.steps;
    const cues = P.cueTimes(lesson.durationMs, n, lesson.pace);
    check(cues.length === n, label + '：cueTimes 长度不符');
    if (Array.isArray(lesson.pace)) {
      check(lesson.pace.length === n - 1,
        label + '：pace 长度应为 ' + (n - 1) + '，实际 ' + lesson.pace.length);
      lesson.pace.forEach(function (v, k) {
        check(typeof v === 'number' && v >= 1500,
          label + '：pace[' + k + '] 低于下限 1500ms');
      });
      const baseSteps = lesson.steps;
      const lastLead = P.readLead(baseSteps[baseSteps.length - 1]);
      const expectDur = cues[n - 1] + lastLead + 1500;
      check(Math.abs(lesson.durationMs - expectDur) <= 1,
        label + '：durationMs ' + lesson.durationMs + ' ≠ 末步 cue ' + cues[n - 1] +
        ' + 阅读时长 ' + lastLead + ' + 1500');
    } else {
      const minDur = 1500 * (n - 1) + 1500;
      check(lesson.durationMs >= minDur,
        label + '：durationMs ' + lesson.durationMs + ' 低于 ' + n + ' 步下限 ' + minDur);
    }
    if (cues.length > 1) {
      check(cues[1] >= 1500, label + '：建立步骤停留不足 1.5s');
    }
    for (let i = 2; i < cues.length; i++) {
      check(cues[i] - cues[i - 1] >= 1500, label + '：第 ' + i + ' 步间隔不足 1.5s');
    }
  }
}

// 5. 目录组时长可计算（目录上的“约 n 分钟”来源）
for (const g of D.groups) {
  const dur = D.groupDuration(g.id);
  check(dur > 0, '组 ' + g.id + ' 时长为 0');
}

if (failures) {
  console.error('tutorial-scenes 守门未通过：' + failures + ' 处');
  process.exit(1);
}
console.log('tutorial-scenes 守门通过：25 个分镜 ×（桌面+手机）构建、步骤、焦点对象、节奏全部一致');
