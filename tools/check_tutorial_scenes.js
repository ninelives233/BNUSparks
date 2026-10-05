#!/usr/bin/env node
'use strict';
/* 分镜与播放器回归：所有分支可确定性构建；解说/动作/镜头时间合法，
   结果有观察时间；队列完成、跳过、暂停、取消和手势遵循用户可见行为。
   DOM 桩只验证契约，视觉与动态质量仍需浏览器实际播放验收。 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    childNodes: [],
    attributes: {},
    style: { setProperty(k,v) { this[k]=v; } },
    dataset: {},
    _events: {},
    clientWidth: 640, clientHeight: 320, offsetHeight: 40, offsetTop: 0, offsetLeft: 0, scrollTop: 0,
    className: '',
    textContent: '',
    type: '',
    disabled: false,
    hidden: false,
    tabIndex: -1,
    offsetWidth: 60,
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
    addEventListener(type,fn) { (this._events[type] ||= []).push(fn); },
    removeEventListener(type,fn) { this._events[type]=(this._events[type]||[]).filter(x=>x!==fn); },
    dispatch(type,props={}) { const e={target:this,button:0,preventDefault(){},stopPropagation(){},...props}; for(const fn of this._events[type]||[])fn(e); },
    focus() { sandbox.document.activeElement=this; },
    matches(sel) { return matchSel(this,sel); },
    closest(sel) { let n=this;while(n){if(matchSel(n,sel))return n;n=n.parentNode;}return null; },
    contains(n) { while(n){if(n===this)return true;n=n.parentNode;}return false; },
    getAnimations() { return []; },
    animate() { return {cancel(){},pause(){},currentTime:0}; },
    getBoundingClientRect() { return {top:0,bottom:40,left:0,right:60,width:60,height:40}; },
    setPointerCapture() {}, releasePointerCapture() {},
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
      return (node.__text || '') + node.childNodes.map((c) => c.textContent).join('');
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
  if(sel.includes(','))return sel.split(',').some(x=>matchSel(n,x));
  const attr = sel.match(/^\[([\w-]+)="([^"]+)"\]$/);
  if(attr) return n.attributes[attr[1]]===attr[2] || (attr[1].startsWith('data-') && n.dataset[attr[1].slice(5)]===attr[2]);
  if(/^[a-z]+\[data-mark\]$/.test(sel)) return n.tagName===sel.split('[')[0].toUpperCase() && n.hasAttribute('data-mark');
  if(/^[a-z]+$/.test(sel))return n.tagName===sel.toUpperCase();
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

let rafId=0;
const rafs=new Map(), medias=new Map();
const sandbox = { document: makeDocument(), console, Element: function(){}, performance:{now:()=>1000} };
sandbox.Element.prototype.animate=function(){};
sandbox.document.visibilityState='visible';sandbox.document.hidden=false;
sandbox.document._events={};
sandbox.document.addEventListener=function(type,fn){(this._events[type] ||= []).push(fn);};
sandbox.document.removeEventListener=function(type,fn){this._events[type]=(this._events[type]||[]).filter(x=>x!==fn);};
sandbox.addEventListener=sandbox.document.addEventListener.bind(sandbox.document);
sandbox.removeEventListener=sandbox.document.removeEventListener.bind(sandbox.document);
sandbox.matchMedia=function(q){if(!medias.has(q))medias.set(q,{matches:false,listeners:[],addEventListener(type,fn){this.listeners.push(fn);},removeEventListener(type,fn){this.listeners=this.listeners.filter(x=>x!==fn);}});return medias.get(q);};
sandbox.requestAnimationFrame=fn=>{rafs.set(++rafId,fn);return rafId;};sandbox.cancelAnimationFrame=id=>rafs.delete(id);
sandbox.getComputedStyle=()=>({overflowY:'auto'});
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
  for (const mobile of [false, true]) for(const capability of ['link','nolink','generic']) {
    sandbox.currentUser=capability==='generic'?null:{identity_education:capability==='link'?'本科':'硕士'};
    sandbox.ttState={data:{noLink:capability==='nolink'}};
    const ctx = { mobile, capability };
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

    const timeline=D.timelineOf(lesson,mobile,capability);
    check(timeline.beats.length===scene.steps,label+'：时间线动作数与场景不符');
    check(timeline.end===lesson.durationMs,label+'：目录时长与时间线不符');
    let prior=-1;
    for(const [i,beat] of timeline.beats.entries()) {
      check(Number.isFinite(beat.at)&&beat.at>prior,label+'：解说时间必须递增');
      check(Number.isFinite(beat.act)&&beat.act>=beat.at,label+'：动作不能早于解说');
      check(!!beat.text,label+'：缺少解说');
      if(i+1<timeline.beats.length)check(beat.act<=timeline.beats[i+1].at,label+'：动作不能跨过下一节拍');
      if(beat.camera) {
        check(beat.camera.scale>=1&&beat.camera.scale<=1.35,label+'：镜头比例非法');
        check(beat.camera.ms>=0&&beat.camera.ms<=1000,label+'：镜头时长非法');
        if(beat.camera.target)check(!!scene.root.querySelector('[data-mark="'+beat.camera.target+'"]'),label+'：镜头目标不存在 '+beat.camera.target);
      }
      prior=beat.at;
    }
    const last=timeline.beats[timeline.beats.length-1];
    check(timeline.end-last.act>=1000,label+'：最终结果没有足够观察时间');
    check(timeline.end>=Math.max(...timeline.beats.map(b=>Math.max(b.act+500,b.at+(b.camera?b.camera.ms:0)))),label+'：结束早于最后动作/镜头');
    if(id==='courses-import') {
      scene.go(scene.steps-1);
      check(!!scene.root.querySelector('[data-mark="btn-confirm"]')===(capability==='link'),'导入确认窗必须与能力一致');
      if(capability!=='link')check(!scene.root.querySelector('.tt-tag-warm'),'无关联导入不能承诺资料');
    }
    if(id==='find-filter') {
      scene.go(scene.steps-1);const rows=scene.root.querySelectorAll('tr[data-mark]');
      check(rows[0].attributes['data-mark']==='paper-2023','收藏量排序应为 41 > 28');
    }
    if(/^courses-/.test(id) && capability!=='link') {
      scene.go(scene.steps-1);check(!scene.root.querySelector('.tt-tag, .tt-open'),'无关联分支不显示资料数量与直达承诺：'+id);
    }

  }
}

// 5. 目录组时长可计算（目录上的“约 n 分钟”来源）
for (const g of D.groups) {
  const dur = D.groupDuration(g.id);
  check(dur > 0, '组 ' + g.id + ' 时长为 0');
}

// Exercise public controls and real player clock, rather than duplicating its state machine.
sandbox.currentUser=null;sandbox.ttState=null;
const marks=[];let navigation=null,coreLeave=[];
const progress={has:id=>marks.includes(id),seenCount:ids=>ids.filter(id=>marks.includes(id)).length,mark:id=>marks.push(id),unsyncedCount:()=>0,onChange(){}};
function mount(extra={}) {
  return P.mount({host:makeNode('div'),mode:'core',progress,onCoreLeave:r=>coreLeave.push(r),onNavigate:n=>navigation=n,onClose(){},...extra});
}
function click(p,cls){const n=p.el.querySelector(cls);check(!!n,'控件存在 '+cls);if(n)n.dispatch('click');}
let player=mount();
check(player.debugState().queue.join(',')===D.coreIds.join(','),'核心顺序独立于找资料组');
const stablePlay=player.el.querySelector('.tutorial-ctl-play');stablePlay.focus();
player.debugAdvance(8999);check(!marks.includes('find-search'),'结果停留结束前不能记已看');
player.debugAdvance(1);check(marks.includes('find-search'),'完整播放后记已看');
player.debugAdvance(300);check(player.debugState().lessonId==='courses-import','完成触发下一项');
check(player.el.querySelector('.tutorial-ctl-play')===stablePlay && sandbox.document.activeElement===stablePlay,'自动换项保持控制节点与焦点');
click(player,'.tutorial-ctl-play');const paused=player.debugState();player.debugAdvance(30000);
check(player.debugState().elapsed===paused.elapsed && !marks.includes('courses-import'),'暂停冻结时间且不记已看');
click(player,'.tutorial-arrow-next');check(player.debugState().lessonId==='save-course'&&player.debugState().state==='paused','暂停后切项保持暂停');
click(player,'.tutorial-ctl-play');player.debugAdvance(2000);
let clip=player.el.querySelector('.tutorial-stage-clip');
clip.dispatch('pointerdown',{pointerId:1,clientX:300,clientY:100});clip.dispatch('pointermove',{pointerId:1,clientX:340,clientY:100,cancelable:true});
const dragTime=player.debugState().elapsed;player.debugAdvance(5000);check(player.debugState().elapsed===dragTime,'拖动冻结教学时钟');
clip.dispatch('pointercancel',{pointerId:1});player.debugAdvance(220);
check(player.debugState().lessonId==='save-course'&&player.debugState().elapsed===dragTime,'取消拖动恢复当前时间、不重播');
clip.dispatch('pointerdown',{pointerId:2,clientX:500,clientY:100});clip.dispatch('pointermove',{pointerId:2,clientX:150,clientY:100,cancelable:true});clip.dispatch('pointerup',{pointerId:2});player.debugAdvance(300);
check(player.debugState().lessonId==='share-text'&&!marks.includes('save-course'),'拖动切项不误记跳过的项目');
player.debugAdvance(D.lessons['share-text'].durationMs);
check(player.debugState().view==='catalog' && coreLeave.includes('finished'),'核心到末项返回目录');
check(!marks.includes('courses-import')&&!marks.includes('save-course'),'核心走到末尾不代表跳过项目已看');player.destroy();
player=mount({mode:'catalog',groupId:'find',lessonId:'find-download'});player.debugAdvance(D.lessons['find-download'].durationMs);
check(player.debugState().state==='ended'&&player.debugState().view==='lesson','普通组到末项停止');check(!!player.el.querySelector('.tutorial-group-end'),'组末提供结束动作');player.destroy();
player=mount();click(player,'.tutorial-nav-toggle');player.debugAdvance(20000);check(player.debugState().elapsed===0,'更多面板阻止自动推进');player.destroy();
player=mount();sandbox.document.hidden=true;sandbox.document.visibilityState='hidden';for(const fn of sandbox.document._events.visibilitychange||[])fn();player.debugAdvance(20000);check(player.debugState().state==='paused'&&player.debugState().elapsed===0,'后台冻结');sandbox.document.hidden=false;sandbox.document.visibilityState='visible';player.destroy();
player=mount();let dotNodes=player.el.querySelectorAll('.tutorial-dot');dotNodes[2].dispatch('click');dotNodes[1].dispatch('click');dotNodes[3].dispatch('click');player.debugAdvance(300);check(player.debugState().lessonId==='share-text','快速圆点切换由最后选择决定');player.halt();player.debugAdvance(50000);check(player.debugState().state==='idle','关闭后旧时钟不能推进');player.destroy();
player=mount();player.debugAdvance(1800);
const cameraBefore=player.debugState().camera;clip=player.el.querySelector('.tutorial-stage-clip');
const objectAnimation={currentTime:0,paused:false,cancelled:false,pause(){this.paused=true;},cancel(){this.cancelled=true;}};
clip.getAnimations=()=>[objectAnimation];player.debugAdvance(40);
check(objectAnimation.paused,'对象动画交给统一时钟、不能自行运行');
click(player,'.tutorial-ctl-play');const objectTime=objectAnimation.currentTime;
const cameraPaused=player.debugState().camera;player.debugAdvance(800);
check(objectAnimation.currentTime===objectTime && JSON.stringify(player.debugState().camera)===JSON.stringify(cameraPaused),'镜头运动中暂停同时冻结对象与镜头');
click(player,'.tutorial-ctl-play');player.debugAdvance(100);
check(player.debugState().camera.scale>cameraBefore.scale && objectAnimation.currentTime>objectTime,'恢复后镜头与对象沿原时间继续');
player.destroy();check(objectAnimation.cancelled,'关闭取消对象动画');
player=mount();clip=player.el.querySelector('.tutorial-stage-clip');
clip.dispatch('pointerdown',{pointerId:1,clientX:200,clientY:100});clip.dispatch('pointermove',{pointerId:1,clientX:205,clientY:140,cancelable:true});player.debugAdvance(100);
check(player.debugState().elapsed===100 && !player.debugState().pauseReasons.includes('drag'),'纵向手势保留原生滚动，不冻结播放');clip.dispatch('pointerup',{pointerId:1});
clip.dispatch('pointerdown',{pointerId:2,clientX:200,clientY:100});clip.dispatch('pointermove',{pointerId:2,clientX:300,clientY:100,cancelable:true});
const boundaryOffset=parseFloat(clip.querySelector('.tutorial-track').style.transform.slice(11));
check(boundaryOffset>0 && boundaryOffset<100,'首项拖向边界有阻尼');
clip.dispatch('pointerdown',{pointerId:3,clientX:250,clientY:110});player.debugAdvance(300);
check(player.debugState().elapsed===100 && player.debugState().pauseReasons.includes('multitouch'),'多指冻结播放且取消拖动');
clip.dispatch('pointercancel',{pointerId:2});clip.dispatch('pointercancel',{pointerId:3});player.debugAdvance(100);
check(player.debugState().elapsed===200 && player.debugState().activeIndex===0,'多指均取消后恢复原播放意图，不切项');
player.el.dispatch('keydown',{key:'ArrowRight',target:player.el.querySelector('.tutorial-topbar-title')});player.debugAdvance(1);
check(player.debugState().activeIndex===0,'阅读区域方向键不接管');
player.el.dispatch('keydown',{key:'ArrowRight',target:player.el.querySelector('.tutorial-dot')});player.debugAdvance(300);
check(player.debugState().activeIndex===1,'导航区域方向键可切项');player.destroy();
const progressCache=new Map();sandbox.localStorage={getItem:k=>progressCache.get(k),setItem:(k,v)=>progressCache.set(k,v),removeItem:k=>progressCache.delete(k)};
progressCache.set('bnu:tutorial:account:test:v1',JSON.stringify({seen:{'courses-import':2},pending:[{lesson_id:'courses-import',revision:2},{lesson_id:'removed-lesson',revision:1},{lesson_id:'courses-import',revision:D.lessons['courses-import'].revision}]}));
const cachedProgress=P.createProgress('test',()=>1);
check(!cachedProgress.has('courses-import') && cachedProgress.unsyncedCount()===1,'改版旧进度不当作已看，过期补交不能阻塞当前版本');
const reducePreference=medias.get('(prefers-reduced-motion: reduce)');reducePreference.matches=true;player=mount();player.debugAdvance(30000);check(player.debugState().state==='paused'&&player.debugState().activeIndex===0,'减少动态效果使用用户控制阅读，不自动翻走');check(player.el.querySelectorAll('.tutorial-dot').length===4,'静态模式保留操作定位');
reducePreference.matches=false;for(const fn of reducePreference.listeners)fn();click(player,'.tutorial-static-play');player.debugAdvance(100);check(player.debugState().state==='playing'&&player.debugState().elapsed===100,'退出减少动态效果后可主动恢复播放');player.destroy();
sandbox.currentUser={identity_education:'硕士'};player=mount({mode:'catalog',groupId:'courses',lessonId:'courses-open'});
check(!player.el.querySelectorAll('.tutorial-dot').some(n=>n.getAttribute('aria-label').includes('直达资料')),'分支操作名称不承诺无关联资料');player.destroy();
if (failures) {console.error('tutorial 守门未通过：'+failures+' 处');process.exit(1);}
console.log('tutorial 守门通过：全部操作 × 桌面/窄屏 × link/nolink/generic 时间线与队列/暂停/手势回归');
