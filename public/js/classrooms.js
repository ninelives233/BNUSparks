/* My Courses classroom view. Own DOM, listeners and private preferences per account. */
(function(){
'use strict';
let instance=null;
const markup=`<div class="shell cr-main">
<section class="currenthead"><div><h2 id="cr-pageTitle">现在，找间教室。</h2><p id="cr-contextLabel" class="context">加载全天教室安排</p></div><div class="autostatus"><span id="cr-statusDot" class="statusdot"></span><span id="cr-sourceMessage" role="status" aria-live="polite">正在连接教务…</span><div class="cr-query-actions"><button id="cr-settings" class="quiet" hidden>筛选与设置</button><button id="cr-refresh" class="refresh" aria-label="立即刷新教务名单" title="立即刷新"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 7a7 7 0 0 1 12-1L20 9M4 15l2.5 3a7 7 0 0 0 12-1"/></svg></button></div></div></section>
<section class="timepanel" aria-label="选择学习时间">
 <div class="intentrow"><div class="seg" role="group" aria-label="查询日期"><button id="cr-now" aria-pressed="true">今天</button><button id="cr-plan" aria-pressed="false">选日期</button></div><div class="time-tools"><span id="cr-followLabel" class="followlabel">自动跟随时间</span><label class="timetable-switch"><input id="cr-linkTimetable" type="checkbox" checked><span class="switch-track" aria-hidden="true"></span><span>课表联动</span></label></div></div>
 <div id="cr-durationButtons" class="durationrow" role="group" aria-label="学习时长"></div>
 <details id="cr-timeDisclosure" class="time-disclosure"><summary><span class="compact-time"><strong id="cr-compactRange"></strong><small id="cr-compactRangeHint">调整时间</small></span><span class="disclosure-chevron" aria-hidden="true">⌄</span></summary><div class="time-options"><div class="axishead"><span id="cr-axisDate"></span><button id="cr-rangePicker" class="range-trigger" aria-haspopup="dialog" aria-controls="cr-rangeDialog">连续选到… ▾</button></div><div id="cr-timeAxis" class="timeaxis" role="group" aria-label="逐节多选，点已选节次取消"></div><div class="selection-footer"><div><strong id="cr-selectionCount" role="status" aria-live="polite"></strong><p id="cr-selectionHelp"></p></div><div class="selection-tools"><button id="cr-selectAllPeriods" aria-pressed="false">全天</button><button id="cr-clearPeriods">清空</button><button id="cr-finishTime" class="primary">完成选择</button></div></div></div></details>
 <p id="cr-rangeNote" class="range-note" hidden></p>
</section>
<section class="buildings" aria-labelledby="cr-buildingTitle"><div class="sectionhead"><div class="overview-heading"><h2 id="cr-buildingTitle">楼宇概况</h2><span id="cr-overviewSummary" class="subtle" role="status"></span></div><div class="overview-tools"><button id="cr-browseAll" class="edit-combo" aria-label="查看当前范围全部教学楼" hidden>全部楼宇</button><button id="cr-browseMode" class="edit-combo" aria-label="按楼浏览全部教室，不限制空闲时段">看全部教室</button><button id="cr-editCustomMain" class="edit-combo" hidden>编辑组合</button></div></div><div id="cr-buildingOverview" class="buildingoverview" role="group" aria-label="点击教学楼直接查看教室"></div><p id="cr-customNotice" class="subtle" role="status" hidden></p></section>
<section id="cr-roomsSection" class="roomssection" aria-labelledby="cr-roomsTitle"><div class="sectionhead roomheading"><div><h2 id="cr-roomsTitle">正在找教室…</h2><p id="cr-roomSubtitle" class="subtle"></p></div><span id="cr-prefetchStatus" class="subtle" role="status"></span></div><div id="cr-results" aria-live="off"></div><div id="cr-roomLegend" class="roomlegend" hidden>每个状态块标注具体节次；空闲 / 占用按教务查询显示。点教室自动查询全天。</div></section>
<footer><span>教室状态来自教务 · 课程来自已导入课表。</span><button id="cr-about" class="linkbutton">数据说明</button></footer>
</div><dialog id="cr-dateDialog" aria-labelledby="cr-dateTitle"><div class="dialoginner"><div class="dialoghead"><h2 id="cr-dateTitle">想哪天去？</h2><button class="close" data-close="dateDialog" aria-label="关闭日期选择">×</button></div><div id="cr-dateShortcuts" class="dateshortcuts"></div><label class="field">其他日期（选好即查询）<input id="cr-date" type="date" required></label><p class="subtle">换日期会保留已选课节；点「今天」回到今天。</p></div></dialog>
<dialog id="cr-rangeDialog" aria-labelledby="cr-rangeTitle"><div class="dialoginner"><div class="dialoghead"><div><h2 id="cr-rangeTitle">连续选到第几节？</h2><p id="cr-rangeStart" class="subtle"></p></div><button class="close" data-close="rangeDialog" aria-label="关闭结束时间选择">×</button></div><div id="cr-rangeEnds" class="range-ends" role="group" aria-label="选择结束节次，选好即查询"></div><button id="cr-wholeDay" class="whole-day"><strong>找全天都空闲的同一间教室</strong><span>第1–12节 · 08:00–21:30</span></button><p class="subtle">选择结束课节后自动查询；全天查询覆盖第1–12节。</p></div></dialog>
<dialog id="cr-settingsDialog" aria-labelledby="cr-settingsTitle"><div class="dialoginner"><div class="dialoghead"><h2 id="cr-settingsTitle">筛选与设置</h2><button class="close" data-close="settingsDialog" aria-label="关闭筛选设置">×</button></div><div class="settingsgrid"><label class="field">查找教室或教学楼<input id="cr-search" type="search" placeholder="例如：七207" maxlength="60"></label><div class="field"><div class="scope-label"><label for="cr-scope">查找范围</label><button id="cr-editCustomSettings" class="edit-combo" hidden>编辑组合</button></div><select id="cr-scope"><option value="common">六栋常见教学楼</option><option value="ten">十栋常用教学楼</option><option value="custom">自定义…</option><option value="all">教务全部场所（含其他园区）</option></select></div><label class="field">场所类型<select id="cr-kind"><option value="general">教学教室（含讨论、教改）</option><option value="all">全部类型（含专用场所）</option></select></label><label class="field">校区<select id="cr-campus"><option value="beijing">北京 · 教务源标记「本部」</option><option value="zhuhai">珠海 · 暂无接入</option></select></label></div><div class="switches"><label><input id="cr-auto" type="checkbox" checked>自动更新（前台每30分钟，跨节次自动跟随）</label><label><input id="cr-lookahead" type="checkbox" checked>自动补查后两节，看哪些教室可连着选</label></div><p class="subtle">选择的教学楼会记住。教学楼组合和显示偏好会保存在当前浏览器。</p><div class="dialogactions"><button class="primary" data-close="settingsDialog">完成</button><button id="cr-theme" hidden>切换深色</button></div></div></dialog>
<dialog id="cr-customDialog" aria-labelledby="cr-customTitle"><div class="dialoginner custom-inner"><div class="dialoghead"><div><h2 id="cr-customTitle">我的楼宇组合</h2><p class="subtle">勾选想看的楼，保存后自动记住。</p></div><button class="close" data-close="customDialog" aria-label="取消编辑楼宇组合">×</button></div><div id="cr-customChoices" class="custom-choices"></div><p class="subtle custom-help">组合按教学楼筛选，日期、课节和教室类型可独立调整。</p><div class="custom-footer"><span id="cr-customCount" class="subtle" role="status"></span><div class="dialogactions"><button data-close="customDialog">取消</button><button id="cr-saveCustom" class="primary">保存并使用</button></div></div></div></dialog>
<dialog id="cr-roomDialog" aria-labelledby="cr-roomTitle"><div class="dialoginner"><div class="dialoghead"><div><p id="cr-roomBuilding" class="subtle"></p><h2 id="cr-roomTitle"></h2></div><button class="close" data-close="roomDialog" aria-label="关闭教室详情">×</button></div><div id="cr-roomContent"></div><div class="dialogactions"><button id="cr-copy" class="primary">复制教室信息</button><button data-close="roomDialog">关闭</button></div><textarea id="cr-manualCopy" aria-label="手动复制教室信息" readonly hidden></textarea><p id="cr-copyStatus" role="status" class="subtle"></p></div></dialog>
<dialog id="cr-infoDialog" aria-labelledby="cr-infoTitle"><div class="dialoginner info"><div class="dialoghead"><h2 id="cr-infoTitle">课表与教室查询</h2><button class="close" data-close="infoDialog" aria-label="关闭数据说明">×</button></div><h3>课表联动</h3><p>当日课程沿用课表颜色，连续课节连成一块，显示课程名与上课地点。点击对应位置可逐节选择；顶部开关可切回普通时间轴。线上教学、自学时段保留普通课节显示。</p><h3>选择时间</h3><p>今天与选日期只切换日期，已选课节会保留。点课节加入或取消，也可用后两节、到21:30和全天快速选择。结果列出在所有已选课节都空闲的同一间教室。</p><h3>查看全天</h3><p>打开即显示全天安排，默认不选择课节。优先选当天时间最近的课程所在楼；当天无课时恢复上次选楼。所选日期的上课教室在各楼内置顶，正在上课的教室优先；手动选楼后保留选择。看全部教室也可进入全天安排。课程名和地点显示在表头，对应列沿用课程色。空闲、占用、查询中通过文字和状态点标明。全部教学楼可集中查看当前范围的教室。</p><h3>更新数据</h3><p>状态来自教务公开查询，页面显示获取时间。每30分钟自动更新，右上角可立即刷新。已有数据直接复用，增减课节即时筛选；点开教室可重新核对全天。</p><h3>显示偏好</h3><p>课表联动、教学楼组合和自动更新设置会保存在当前浏览器。容量显示教室登记人数。</p><a href="http://zyfw.prsc.bnu.edu.cn/public/dykb.kxjsi.html" target="_blank" rel="noopener noreferrer">查看教务来源</a><button class="primary" data-close="infoDialog">知道了</button></div></dialog>
`;
function create(host,config){
 const root=window.document.createElement('section');root.className='cr-app';root.innerHTML=markup;host.replaceChildren(root);
 let disposed=false,timetableVersion=0;const cleanup=[],lifetime=new AbortController(),preferenceKey='bnusparks_classrooms_v1_u'+config.uid;
 function listen(target,type,fn,options){target.addEventListener(type,fn,options);cleanup.push(()=>target.removeEventListener(type,fn,options));}
 const nativeDocument=window.document;
 const document={getElementById:id=>root.querySelector('#'+CSS.escape(id)),querySelector:s=>root.querySelector(s),querySelectorAll:s=>root.querySelectorAll(s),get activeElement(){return nativeDocument.activeElement;},get hidden(){return nativeDocument.hidden||!config.isActive();},documentElement:root,addEventListener(type,fn,opts){listen(type==='click'?root:nativeDocument,type,fn,opts);}};

const $=id=>root.querySelector('#cr-'+id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const times=[['08:00','08:45'],['08:55','09:40'],['10:00','10:45'],['10:55','11:40'],['13:30','14:15'],['14:25','15:10'],['15:30','16:15'],['16:25','17:10'],['18:00','18:45'],['18:55','19:40'],['19:50','20:35'],['20:45','21:30']];
const AUTO_REFRESH_MS=30*60*1000;
const days=['周一','周二','周三','周四','周五','周六','周日'];
const common=['教二楼','教三楼','教四楼','教七楼','教八楼','教九楼'];
const ten=[...common,'化学楼','生地楼','艺术楼','电子楼'];
const knownBuildings=new Set(ten);
let customDraft=new Set();
let detailTask=null;
let browseStarting=true,clockReady=false,courseBuilding='',browseClassStamp='';
const catalogs=new Map(),timetables=new Map(),timetableRequests=new Map();
const lessonNarrow=matchMedia("(max-width: 1000px)");
let catalogRequest=null,catalogWarmup=null,browseTask=null,browseReadyAt=0,browseTimer=null;
const general=new Set(['多媒体教室','智慧教室','讨论教室','教学改革创新试验教室']);
const collator=new Intl.Collator('zh-CN',{numeric:true});
const id=r=>JSON.stringify([r[0],r[1]]);
const records=new Map(),pending=new Map(),inflightSingles=new Map();
const narrow=matchMedia('(max-width: 720px)');
let overviewSelection='';
$('timeDisclosure').open=!narrow.matches;
let prefs={};try{const value=JSON.parse(localStorage.getItem(preferenceKey)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))prefs=value;}catch{}
const savedCustom=Array.isArray(prefs.customBuildings)?[...new Set(prefs.customBuildings.filter(x=>typeof x==='string'&&x.trim()&&x.length<=120).map(x=>x.trim()))].slice(0,200):[];
savedCustom.forEach(x=>knownBuildings.add(x));
const savedScope=['common','ten','all','custom'].includes(prefs.scope)&&!(prefs.scope==='custom'&&!savedCustom.length)?prefs.scope:'common';
const s={date:'',period:1,duration:0,periods:[],spanIntent:'custom',mode:'custom',campus:config.campus==='zhuhai'?'zhuhai':'beijing',scope:savedScope,customBuildings:savedCustom,kind:'general',query:'',linkTimetable:prefs.linkTimetable!==false,building:'',buildingManual:false,browseAll:false,status:'idle',data:null,error:'',auto:prefs.auto!==false,lookahead:prefs.lookahead!==false,preferred:typeof prefs.building==='string'?prefs.building:'',anchor:'',autoSuspended:false};
let serial=0,controller=null,serverOffset=0,refreshAt=0,selected=null,origin=null,debounce=null;
const dateObject=iso=>new Date(iso+'T12:00:00+08:00');
const weekday=iso=>(dateObject(iso).getUTCDay()+6)%7;
function addDays(iso,n){const d=dateObject(iso);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(Date.now()+serverOffset));
const clock=iso=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(iso));
const sequence=(start,n)=>Array.from({length:n},(_,i)=>start+i);
const continuous=ps=>ps.length>0&&ps.every((p,i)=>p===ps[0]+i);
const samePeriods=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((p,i)=>p===b[i]);
const end=()=>s.periods.at(-1)||s.period;
function periodLabel(ps){const groups=[];for(const p of ps){const last=groups.at(-1);if(last&&last[1]+1===p)last[1]=p;else groups.push([p,p]);}return groups.length?'第'+groups.map(([a,b])=>a===b?a:a+'–'+b).join('、')+'节':'未选节次';}
const learningLength=ps=>{const minutes=ps.reduce((n,p)=>{const [a,b]=times[p-1].map(t=>Number(t.slice(0,2))*60+Number(t.slice(3)));return n+b-a;},0);return minutes>=60?`${Math.floor(minutes/60)}小时${minutes%60?minutes%60+'分钟':''}`:`${minutes}分钟`;};
function setPeriods(ps,intent='custom'){s.periods=[...new Set(ps)].sort((a,b)=>a-b);s.period=s.periods[0]||s.period;s.duration=s.periods.length;s.spanIntent=intent;}
function queryParams(q,force){const params={date:q.date,period:q.period,duration:q.duration,force:force?'1':'0'};if(q.periods&&!continuous(q.periods))params.periods=q.periods.join(',');return new URLSearchParams(params);}
const blockEnd=()=>Math.min(12,(Math.floor((s.period-1)/4)+1)*4);
const horizonEnd=()=>Math.max(end(),Math.min(blockEnd(),s.period+2));
const key=(date,p,d=1,ps)=>`${date}:${ps&&!continuous(ps)?ps.join(','):p+':'+d}`;
const fresh=data=>Boolean(data&&Date.parse(data.expires_at)>Date.now());
const current=()=>s.status==='ok'&&fresh(s.data)&&s.data.query.date===s.date&&samePeriods(s.data.query.periods,s.periods);
function persist(){try{localStorage.setItem(preferenceKey,JSON.stringify({auto:s.auto,lookahead:s.lookahead,building:s.preferred,scope:s.scope,customBuildings:s.customBuildings,linkTimetable:s.linkTimetable}));return true;}catch{return false;}}
function scopeBuildings(){const names=s.scope==='all'?null:s.scope==='ten'?ten:s.scope==='custom'?s.customBuildings:common;return names&&courseBuilding?[...new Set([...names,courseBuilding])]:names;}
function customLabels(){$('scope').querySelector('[value=custom]').textContent=s.customBuildings.length?`自定义（${s.customBuildings.length}栋）`:'自定义…';$('editCustomSettings').hidden=s.scope!=='custom';$('editCustomMain').hidden=s.scope!=='custom';}
function matches(r,building=true,ignoreKind=false){return (!scopeBuildings()||scopeBuildings().includes(r[0]))&&(ignoreKind||s.kind==='all'||general.has(r[2]))&&(!s.query||`${r[0]} ${r[1]}`.toLowerCase().includes(s.query.toLowerCase()))&&(!building||!s.building||r[0]===s.building);}
const allRooms=()=>current()?s.data.rooms.filter(r=>matches(r,false)):[];
const hiddenByKind=()=>current()&&s.kind!=='all'?s.data.rooms.filter(r=>matches(r,false,true)&&!general.has(r[2])):[];
function selectionLabel(){return !s.duration?'直接看教室':continuous(s.periods)?`${times[s.period-1][0]}–${times[end()-1][1]}`:`${periodLabel(s.periods)}（分段）`;}
function context(){return `${s.date} ${s.date?days[weekday(s.date)]:''} · ${selectionLabel()}`;}
function contextLabel(){return `${s.date===today()?'今天':s.date} ${s.date?days[weekday(s.date)]:''}${s.spanIntent==='allday'?' · 全天连续':''} · ${selectionLabel()}${current()?' · 第'+s.data.query.week+'周':''}`;}
function sync(){customLabels();for(const name of ['date','scope','kind','campus'])$(name).value=s[name];$('search').value=s.query;$('auto').checked=s.auto;$('lookahead').checked=s.lookahead;$('linkTimetable').checked=s.linkTimetable;}
function focusSnapshot(){const e=document.activeElement;for(const attr of ['data-room','data-building','data-period','data-duration','data-end'])if(e?.hasAttribute(attr))return [attr,e.getAttribute(attr)];return null;}
function restoreFocus(snapshot){if(snapshot){const [attr,value]=snapshot;[...document.querySelectorAll('button')].find(e=>e.getAttribute(attr)===value)?.focus({preventScroll:true});}}
function message(title,body,action='retry',label='重新查询'){return `<div class="statebox"><h3>${esc(title)}</h3><p>${esc(body)}</p>${action?`<button class="primary" data-action="${action}">${esc(label)}</button>`:''}</div>`;}
function chooseBuilding(){
 if(!s.duration){const course=browseCourse();if(!s.buildingManual&&course){courseBuilding=course.building;knownBuildings.add(course.building);s.building=course.building;}const names=scopeBuildings()||[...knownBuildings];if(!names.includes(s.building))s.building=names.includes(s.preferred)?s.preferred:names[0]||'';return;}
 if(!current())return;
 const rooms=allRooms(),counts=new Map();rooms.forEach(r=>counts.set(r[0],(counts.get(r[0])||0)+1));
 const rank=[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a)||collator.compare(a,b));
 if(!s.building){const allowed=scopeBuildings();s.building=counts.get(s.preferred)>0?s.preferred:rank[0]||(allowed?.includes(s.preferred)?s.preferred:allowed?.[0])||common[0];}
}
function periodState(room,p){
 const record=records.get(key(s.date,p));
 const inWindow=current()&&s.periods.includes(p)&&s.data.rooms.some(r=>id(r)===id(room));
 if(fresh(record)&&(!inWindow||Date.parse(record.fetched_at)>=Date.parse(s.data.fetched_at)))return record.rooms.some(r=>id(r)===id(room))?'in':'out';
 if(inWindow)return 'in';
 return pending.get(key(s.date,p))?.kind==='pending'?'pending':'unknown';
}
function confirmedEnd(room){let last=s.period-1;for(let p=s.period;p<=12;p++){if(periodState(room,p)!=='in')break;last=p;}return last;}

function collapseTime(){
 if(narrow.matches&&$('timeDisclosure').open){$('timeDisclosure').open=false;$('timeDisclosure').querySelector('summary').focus({preventScroll:true});}
}
function keepBuildingInView(){
 if(!narrow.matches)return;
 const box=$('buildingOverview'),selected=box.querySelector('[aria-pressed="true"]');if(!selected)return;
 const left=selected.getBoundingClientRect().left-box.getBoundingClientRect().left+box.scrollLeft;
 if(left<box.scrollLeft)box.scrollLeft=Math.max(0,left-3);
 else if(left+selected.offsetWidth>box.scrollLeft+box.clientWidth)box.scrollLeft=left+selected.offsetWidth-box.clientWidth+3;
}
listen(narrow,'change',event=>{$('timeDisclosure').open=!event.matches;keepBuildingInView();renderTime();});
listen(lessonNarrow,"change",()=>renderTime());
function dayLessons(){return s.linkTimetable?(timetables.get(s.date)?.lessons||[]).filter(x=>x.onsite):[];}
function lessonAt(p){return dayLessons().find(c=>c.ps<=p&&p<=c.pe);}
function applyLessonStyles(scope){
 const lessons=new Map(dayLessons().map(c=>[c.key,c]));
 for(const node of scope.querySelectorAll('[data-lesson-key]')){const c=lessons.get(node.dataset.lessonKey);if(c){node.style.setProperty('--lesson-bg',c.bg);node.style.setProperty('--lesson-ink',c.ink);const building=node.closest('[data-row-building]')?.dataset.rowBuilding||(!s.duration&&s.browseAll?'':s.building),place=coursePlace(c.room);node.classList.toggle('lesson-away',Boolean(building&&place&&place.building!==building));}}
 for(const node of scope.querySelectorAll('[data-axis-span]')){const span=Number(node.dataset.axisSpan);node.style.gridColumn='span '+span;node.style.setProperty('--lesson-span',span);}
}
async function ensureTimetable(){
 if(disposed||(browseStarting&&!clockReady)||!s.linkTimetable||!s.date||timetables.has(s.date)||timetableRequests.has(s.date)||location.protocol==='file:')return;
 const date=s.date,version=timetableVersion;const request=api('/api/timetable?'+new URLSearchParams({date})).then(data=>{
  if(disposed||version!==timetableVersion)return;
  if(data.date!==date||!Array.isArray(data.lessons))throw new Error('课表日期不符');
  const lessons=data.lessons.filter(c=>typeof c.name==='string'&&typeof c.room==='string'&&Number.isInteger(c.ps)&&Number.isInteger(c.pe)&&c.ps>=1&&c.pe<=12&&c.ps<=c.pe&&typeof c.key==='string'&&/^oklch\([\d. ]+\)$/.test(c.bg)&&/^oklch\([\d. ]+\)$/.test(c.ink));
  timetables.set(date,{...data,lessons});if(s.date===date&&s.linkTimetable){render();}
 }).catch(error=>{if(!disposed&&version===timetableVersion&&error.name!=='AbortError')timetables.set(date,{available:false,lessons:[]});}).finally(()=>{timetableRequests.delete(date);if(!disposed&&version!==timetableVersion&&config.isActive())void ensureTimetable();});timetableRequests.set(date,request);await request;
}
// Timetable context chooses a default building; it never changes selected periods.
function coursePlace(value){
 const text=String(value||'').trim(),n=text.match(/^(?:教)?(十|[一二三四五六七八九]|10|[1-9])(?:教学楼|楼)?\s*[-－]?\s*(\d[\w-]*)$/u);
 if(n){const cn=/^\d+$/.test(n[1])?['','一','二','三','四','五','六','七','八','九','十'][Number(n[1])]:n[1];return {building:cn==='十'?'教十楼(物理楼)':`教${cn}楼`,room:cn+n[2].toUpperCase()};}
 const named=text.match(/^(化学楼|生地楼|艺术楼|电子楼)\s*[-－]?\s*(\d[\w-]*)$/u);return named?{building:named[1],room:named[1]+named[2].toUpperCase()}:null;
}
function browseCourse(activeOnly=false){
 if(!clockReady||!s.linkTimetable||s.campus!=='beijing'||s.duration)return null;
 const data=timetables.get(s.date);if(!data?.available)return null;
 const known=records.get(key(s.date,browseStart()));if(fresh(known)&&Number.isInteger(data.week)&&known.query.week!==data.week)return null;
 const sec=t=>Number(t.slice(0,2))*3600+Number(t.slice(3,5))*60+Number(t.slice(6,8)||0),now=sec(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(Date.now()+serverOffset)));
 const lessons=data.lessons.map(c=>({...c,start:sec(times[c.ps-1][0]),finish:sec(times[c.pe-1][1])}));
 let candidates=[];
 if(s.date===today())candidates=lessons.filter(c=>sequence(c.ps,c.pe-c.ps+1).some(p=>sec(times[p-1][0])<=now&&now<sec(times[p-1][1])));
 if(!candidates.length){if(activeOnly)return null;const distance=c=>s.date===today()?Math.max(c.start-now,now-c.finish,0):c.start;
  const ranked=[...lessons].sort((a,b)=>distance(a)-distance(b)||Number(b.start>=now)-Number(a.start>=now)||a.start-b.start);
  if(!ranked.length)return null;candidates=ranked.filter(c=>c.start===ranked[0].start&&c.finish===ranked[0].finish);
 }
 const places=candidates.map(c=>c.onsite?coursePlace(c.room):null);if(places.some(p=>!p)||new Set(places.map(p=>p.building)).size!==1)return null;
 const rooms=new Set(places.map(p=>p.room));return {building:places[0].building,room:rooms.size===1?places[0].room:null};
}
function browseCourseStamp(){return JSON.stringify([s.date,browseCourse(),browseCourse(true)]);}
async function startBrowse(){
 if(location.protocol==='file:'){browseStarting=false;render();return;}
 const generation=serial;
 try{const c=await api('/api/context');const ms=Date.parse(c.now);if(!Number.isFinite(ms))throw new Error('时钟无效');serverOffset=ms-Date.now();clockReady=true;
  if(serial===generation&&!s.duration){s.date=today();const t=deriveTarget('now');s.period=t.date===s.date?t.period:12;}
  await ensureTimetable();
 }catch{}finally{if(!disposed){browseStarting=false;sync();render();browseClassStamp=browseCourseStamp();}}
}
function plainTimeCell(p){
 const t=times[p-1],record=records.get(key(s.date,p)),known=fresh(record),isPending=pending.get(key(s.date,p))?.kind==='pending',active=s.periods.includes(p);
 const count=known?record.rooms.filter(r=>matches(r,false)).length+'间':isPending?'补查中':active&&s.status==='loading'?'查询中':active&&current()?'整段已查':'未单独查询';
 return `<button class="timecell ${isPending?'pending':''}" data-period="${p}" aria-pressed="${active}" aria-label="${active?'取消':'选择'}第${p}节，${t[0]}至${t[1]}，${count}"><strong>${t[0]}</strong><span class="clock">第${p}节<span class="selection-mark" aria-hidden="true">${active?' ✓':''}</span></span></button>`;
}
function renderLinkedAxis(){
 const columns=lessonNarrow.matches?4:12;let html='';
 for(let p=1;p<=12;){const c=lessonAt(p),rowEnd=Math.min(12,(Math.floor((p-1)/columns)+1)*columns);
  if(c){const finish=Math.min(c.pe,rowEnd),length=finish-p+1;
   html+=`<div class="lesson-band" data-lesson-key="${esc(c.key)}" data-axis-span="${length}"><div class="lesson-hits">${sequence(p,length).map(n=>`<button class="timecell lesson-hit" data-period="${n}" aria-pressed="${s.periods.includes(n)}" aria-label="${s.periods.includes(n)?'取消':'选择'}第${n}节，${esc(c.name)}，${esc(c.room)}，${times[n-1][0]}至${times[n-1][1]}" title="第${n}节 ${times[n-1][0]}–${times[n-1][1]} · ${esc(c.name)}"></button>`).join('')}</div><div class="lesson-caption" aria-hidden="true"><strong>${esc(c.name)}</strong><span>${esc(c.room)}</span></div></div>`;p=finish+1;
  }else{const length=p%2===1&&p<rowEnd&&!lessonAt(p+1)?2:1;html+=`<div class="timegroup${length===1?' solo':''}" data-axis-span="${length}">${sequence(p,length).map(plainTimeCell).join('')}</div>`;p+=length;}
 }
 $('timeAxis').classList.add('lesson-axis');$('timeAxis').style.setProperty('--axis-cols',columns);$('timeAxis').innerHTML=html;applyLessonStyles($('timeAxis'));
}
function timetableHeaders(){
 let html='';for(let p=1;p<=12;){const c=lessonAt(p);
 if(c){const finish=c.pe;html+=`<th class="lesson-head" scope="colgroup" colspan="${finish-p+1}" data-period-start="${p}" data-lesson-key="${esc(c.key)}" title="${esc(c.name+' · '+c.room)}"><div class="lesson-head-label"><strong>${esc(c.name)}</strong><small>${esc(c.room)}</small></div></th>`;p=finish+1;}
 else{html+=`<th scope="col" data-period-start="${p}" title="${times[p-1][0]}–${times[p-1][1]}">${p}节<small>${times[p-1][0]}</small></th>`;p++;}}
 return html;
}
function renderTime(){
 const dateLabel=s.date===today()?'今天':s.date===addDays(today(),1)?'明天':s.date.slice(5);
 $('compactRange').textContent=`${dateLabel} · ${!s.duration?'直接看教室':continuous(s.periods)?selectionLabel():`分段 ${s.duration} 节`}`;
 $('compactRangeHint').textContent=(s.duration?periodLabel(s.periods)+' · '+learningLength(s.periods):'不选时间，也可选楼看全天')+` · ${$('timeDisclosure').open?'收起':'调整时间'}`;
 $('axisDate').textContent=(s.date===today()?'今天':s.date.slice(5))+' · 点选课节，可多选';
 $('selectionCount').textContent=s.duration?`已选 ${s.duration} 节 · ${learningLength(s.periods)}`:'未选课节 · 浏览全天安排';
 $('selectionHelp').textContent=s.duration?'点已选课节取消，点未选课节加入；自动查询。':'直接选楼看全天；选课节则只找空闲教室。';
 $('clearPeriods').disabled=!s.duration;$('selectAllPeriods').setAttribute('aria-pressed',String(s.duration===12));
 if(dayLessons().length){renderLinkedAxis();$('axisDate').textContent=(s.date===today()?'今天':s.date.slice(5))+' · 课表与自习时段';}
 else{$('timeAxis').classList.remove('lesson-axis');$('timeAxis').innerHTML=[1,3,5,7,9,11].map(start=>`<div class="timegroup" role="group" aria-label="第${start}–${start+1}节">${[start,start+1].map(plainTimeCell).join('')}</div>`).join('');}
 const remaining=13-s.period;
 const choices=[{n:2,intent:'two',label:'后两节'},{n:remaining,intent:'night',label:'到21:30'}];
 $('durationButtons').innerHTML='<span class="caption">快速选</span>'+choices.map(c=>`<button data-duration="${c.n}" data-intent="${c.intent}" aria-pressed="${s.spanIntent===c.intent}" ${c.n>remaining?'disabled':''}>${c.label}<small>${times[s.period-1][0]}–${times[Math.min(12,s.period+c.n-1)-1][1]}</small></button>`).join('');
 $('rangePicker').textContent='连续选到… ▾';
 $('rangePicker').classList.toggle('selected',s.spanIntent==='custom'||s.spanIntent==='allday');
 const crosses=s.duration&&((s.period<=4&&end()>=5)||(s.period<=8&&end()>=9));
 $('rangeNote').hidden=!s.duration||(!crosses&&continuous(s.periods));
 $('rangeNote').textContent=continuous(s.periods)?'已选'+periodLabel(s.periods)+' · 含课间时段':'分段选择 · 同一教室在全部已选课节空闲。';
 const isToday=s.date===today();$('now').setAttribute('aria-pressed',String(isToday));$('plan').setAttribute('aria-pressed',String(!isToday));
 $('followLabel').textContent=s.auto?(s.mode==='custom'?'所选时间 · 自动更新':'自动跟随 · 每30分钟更新'):'已暂停自动更新';
}

function renderOverview(){
 $('browseMode').hidden=!s.duration;$('browseAll').hidden=Boolean(s.duration);$('browseAll').setAttribute('aria-pressed',String(s.browseAll));
 if(!s.duration){renderBrowseOverview();return;}
 const before=s.building;
 const rooms=allRooms(),counts=new Map();rooms.forEach(r=>counts.set(r[0],(counts.get(r[0])||0)+1));
 const names=scopeBuildings()||[...knownBuildings];
 const hiddenCounts=new Map();hiddenByKind().forEach(r=>hiddenCounts.set(r[0],(hiddenCounts.get(r[0])||0)+1));
 const max=Math.max(1,...counts.values());
 $('overviewSummary').textContent=current()?`${rooms.length}间空闲`:(s.status==='loading'?'正在查询…':'暂无有效结果');
 $('buildingOverview').innerHTML=names.map(b=>{const n=counts.get(b)||0,known=current(),hidden=known&&!n?(hiddenCounts.get(b)||0):0;return `<button class="buildingtile" data-building="${esc(b)}" aria-pressed="${s.building===b}" ${known?'':'disabled'} aria-label="${esc(b)}，${known?n+'间匹配'+(hidden?'，另'+hidden+'间被类型筛选隐藏':'')+'，点击查看':'尚未获取数据'}"><span class="tilename" title="${esc(b)}">${esc(buildingLabel(b))}${s.preferred===b?'<small>常用</small>':''}</span><span class="tilevalue"><b>${known?n:'—'}</b>${known?'间':'待查'}${hidden?`<span class="type-hidden">另${hidden}间被筛选</span>`:''}</span><svg class="tilechart" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="5" rx="2"/><rect class="bar" width="${known?Math.round(n/max*100):0}" height="5" rx="2"/></svg></button>`;}).join('');
 if(before!==overviewSelection){keepBuildingInView();overviewSelection=before;}
}
function renderRooms(){
 $('roomLegend').hidden=true;
 if(!s.duration){renderBrowseRooms();return;}
 if(s.status==='loading'||s.status==='selecting'){$('roomsTitle').textContent='正在找教室…';$('roomSubtitle').textContent='查找全部所选课节都空闲的教室';$('results').innerHTML='<div class="roomgrid" aria-label="正在获取教室">'+Array.from({length:6},()=>'<div class="skeletonroom" aria-hidden="true"></div>').join('')+'</div>';return;}
 if(!current()){
  $('roomsTitle').textContent='暂时无法确认空闲';$('roomSubtitle').textContent='';
  const messages={file:['启动本地服务即可实时查询','双击同目录的「启动实时查询.command」，再打开 http://127.0.0.1:8766/。'],unsupported:['珠海校区尚未接入','切回北京查看教室状态。'],stale:['结果已过期','点击刷新获取当前结果。'],error:['查询未完成',s.error],invalid:['请换一个时间',s.error]};const [title,body]=messages[s.status]||['准备查询','正在定位北京时间当前节次。'];
  $('results').innerHTML=message(title,body,s.status==='unsupported'?'beijing':'retry');return;
 }
 const rooms=allRooms().filter(r=>r[0]===s.building).sort((a,b)=>collator.compare(a[1],b[1]));
 $('roomsTitle').textContent=s.building+' · '+rooms.length+'间';$('roomSubtitle').textContent='已自动展开 · 按教室号排列';
 if(!rooms.length){const hidden=hiddenByKind().filter(r=>r[0]===s.building);if(hidden.length){$('results').innerHTML=message(`另有${hidden.length}间被类型筛选隐藏`,`所选节次的原始名单有${[...new Set(hidden.map(r=>r[2]))].join('、')}。当前仅显示教学教室，可直接查看全部类型。`,'all-types','显示这些教室');return;}}
 if(!rooms.length){const empty=s.data.count===0;if(empty&&s.duration>1){$('results').innerHTML=message('没有教室满足全部所选节次',`${periodLabel(s.periods)}需要同一间教室均列入名单。可调整课节继续查找。`,'shorten','只查开始这一节');}else $('results').innerHTML=message(empty?'这个窗口的空闲名单为空':'这栋楼暂时没有匹配教室','可以直接点其他楼，或清除筛选查看更多场所。','clear','自动找有候选的楼');return;}
 $('roomLegend').hidden=false;
 const statuses={'in':'空闲','out':'占用','pending':'查询中','unknown':'未查'};
 $('results').innerHTML='<div class="roomgrid">'+rooms.map(r=>{const last=confirmedEnd(r),finish=last>=s.period?times[last-1][1]:'未确认';const selectedStates=s.periods.map(p=>periodState(r,p));const selectedState=selectedStates.every(x=>x==='in')?'in':selectedStates.includes('out')?'out':selectedStates.includes('pending')?'pending':'unknown';const buckets=[{start:s.period,finish:end(),st:selectedState,label:continuous(s.periods)?periodLabel(s.periods):'已选'+s.duration+'节'},...Array.from({length:horizonEnd()-end()},(_,i)=>({start:end()+i+1,finish:end()+i+1,st:periodState(r,end()+i+1)}))];const segments=buckets.map(x=>`<span class="slot-badge ${x.st}"><span class="slot-period">${x.label||'第'+x.start+'节'}</span><span class="slot-label">${statuses[x.st]}</span></span>`).join('');return `<button class="roombtn" data-room="${esc(id(r))}" aria-label="${esc(r[0]+' '+r[1])}，连续节次名单已确认至${finish}，${buckets.map(x=>(x.label||'第'+x.start+'节')+statuses[x.st]).join('，')}，点击查询全天，登记容量${r[3]??'未知'}"><span class="roomname">${esc(r[1])}</span><span class="roomrow"><span class="roomuntil">${selectedState!=='in'?'所选时段待确认':continuous(s.periods)?'教务空闲至 '+finish:'所选'+s.duration+'节均空闲'}</span><span class="roomcap">容量 ${r[3]??'—'}</span></span><span class="room-slots">${segments}</span></button>`;}).join('')+'</div>';
}
function renderPrefetch(){
 if(!s.duration){$('prefetchStatus').textContent='全天安排';return;}
 const extra=[];for(let p=end()+1;p<=horizonEnd();p++)extra.push(p);
 if(!current()){$('prefetchStatus').textContent='';return;}
 if(!s.lookahead){$('prefetchStatus').textContent='后续自动查询已暂停';return;}
 const loaded=extra.filter(p=>fresh(records.get(key(s.date,p)))).length;
 const failed=extra.some(p=>pending.get(key(s.date,p))?.kind==='failed');
 $('prefetchStatus').textContent=extra.length?(loaded===extra.length?`后续${loaded}节已查`:failed?'后续暂未确认':`自动补查后${extra.length}节 · ${loaded}/${extra.length}`):'所选完整窗口已查';
}
function render(){if(disposed)return;const snapshot=focusSnapshot();chooseBuilding();$('pageTitle').textContent=s.mode==='now'?'现在，找间教室。':'选好时间，找间教室。';$('contextLabel').textContent=contextLabel();$('statusDot').classList.toggle('ok',current());$('refresh').disabled=s.status==='loading'||s.status==='selecting';
 $('sourceMessage').textContent=current()?`${clock(s.data.fetched_at)} 更新${s.data.cache_hit?' · 缓存':''}${s.auto&&!s.autoSuspended?' · 自动':' · 已暂停'}`:s.status==='selecting'?'选择已更新 · 即将查询':s.status==='empty'?'请选择学习课节':s.status==='loading'?'正在获取最新名单…':s.status==='error'?'连接失败 · 点右上角刷新':s.status==='stale'?'结果过期 · 等待更新':'尚未取得有效结果';
 customLabels();renderTime();renderOverview();renderRooms();renderPrefetch();if(!s.duration){$('pageTitle').textContent='按楼看教室。';$('sourceMessage').textContent=browseProgress();$('refresh').disabled=browseStarting||Boolean(browseTask?.active);queueMicrotask(ensureBrowse);}void ensureTimetable();if($('roomDialog').open&&selected)renderRoomContent();restoreFocus(snapshot);}
async function api(path,signal){
 if(disposed||!config.isActive())throw new DOMException('Aborted','AbortError');
 if(path.startsWith('/api/timetable?'))return config.getLessons(new URLSearchParams(path.split('?')[1]).get('date'));
 const combined=signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal;
 const url=path.replace('/api/context','/api/classrooms/context/').replace('/api/catalog?','/api/classrooms/catalog/?').replace('/api/query?','/api/classrooms/query/?');
 for(let attempt=0;attempt<8;attempt++){
  try {const data=await window.api(url,{signal:combined,timeout:60000});if(disposed||!config.isActive())throw new DOMException('Aborted','AbortError');return data;}
  catch(error){if(combined.aborted)throw new DOMException('Aborted','AbortError');if(error.status!==429||attempt===7)throw error;await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1000);combined.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});}
 }
}

function validate(data,q){if(data.query?.date!==q.date||data.query?.period!==q.period||data.query?.duration!==q.duration||!samePeriods(data.query?.periods,q.periods||sequence(q.period,q.duration))||!Array.isArray(data.rooms)||data.count!==data.rooms.length)throw new Error('返回结果与所选时间不符。');}
function querySingle(date,p,force,signal){
 const k=key(date,p),existing=inflightSingles.get(k);if(existing&&!existing.signal.aborted)return existing.promise;
 const q={date,period:p,duration:1};const job={signal,promise:null};
 job.promise=api('/api/query?'+new URLSearchParams({...q,force:force?'1':'0'}),signal).then(data=>{validate(data,q);const previous=records.get(k);if(fresh(data)&&(!fresh(previous)||Date.parse(data.fetched_at)>=Date.parse(previous.fetched_at)))records.set(k,data);data.rooms.forEach(r=>knownBuildings.add(r[0]));pending.delete(k);return data;}).catch(error=>{if(error.name!=='AbortError'){records.delete(k);pending.set(k,{kind:'failed',at:Date.now()});}throw error;}).finally(()=>{if(inflightSingles.get(k)===job)inflightSingles.delete(k);});
 inflightSingles.set(k,job);return job.promise;
}
function invalidate(){stopCatalogWarmup();clearTimeout(browseTimer);browseTimer=null;stopDetail();stopBrowse(true);if(catalogRequest){catalogRequest.controller.abort();catalogs.delete(catalogRequest.building);catalogRequest=null;}serial++;controller?.abort();clearTimeout(debounce);for(const [k,v]of pending)if(v.kind==='pending')pending.delete(k);if($('roomDialog').open)$('roomDialog').close();s.data=null;}
async function prefetch(generation,signal){
 if(!s.lookahead||!current())return;
 const date=s.date,first=end()+1,last=horizonEnd();
 for(let p=first;p<=last;p++){
  if(generation!==serial||!s.lookahead||document.hidden)return;
  const k=key(date,p),previous=pending.get(k);
  if(fresh(records.get(k))||(previous?.kind==='failed'&&Date.now()-previous.at<300000))continue;
  pending.set(k,{kind:'pending',at:Date.now()});render();
  try{await querySingle(date,p,false,signal);if(generation!==serial)return;pending.delete(k);}
  catch(error){if(generation!==serial||error.name==='AbortError')return;records.delete(k);pending.set(k,{kind:'failed',at:Date.now()});}
  if(generation===serial)render();
 }
}
function cachedSelection(q){
 const singles=sequence(1,12).map(p=>records.get(key(q.date,p)));
 if(singles.some((d,i)=>!fresh(d)||pending.get(key(q.date,i+1))?.kind==='failed'))return null;
 const selected=q.periods.map(p=>singles[p-1]),first=selected[0];
 if(selected.some(d=>d.query.week!==first.query.week||d.query.day!==first.query.day||JSON.stringify(d.query.term)!==JSON.stringify(first.query.term)))return null;
 const sets=selected.map(d=>new Set(d.rooms.map(id))),newest=selected.reduce((a,b)=>Date.parse(a.fetched_at)>Date.parse(b.fetched_at)?a:b);
 const rooms=newest.rooms.filter(r=>sets.every(ids=>ids.has(id(r))));
 return {...first,query:{...first.query,...q,periods:[...q.periods]},rooms,count:rooms.length,
  fetched_at:new Date(Math.min(...selected.map(d=>Date.parse(d.fetched_at)))).toISOString(),
  expires_at:new Date(Math.min(...selected.map(d=>Date.parse(d.expires_at)))).toISOString(),cache_hit:true};
}
async function load(force=true,automatic=false){
 invalidate();const generation=serial;s.autoSuspended=false;s.error='';
 if(!s.duration){s.status='empty';render();return;}
 if(!automatic)for(const [k,v]of pending)if(v.kind==='failed')pending.delete(k);
 if(location.protocol==='file:'){s.status='file';render();return;}
 if(s.campus!=='beijing'){s.status='unsupported';render();return;}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||end()>12||s.duration<1){s.status='invalid';s.error='请选择有效日期及当天的节次。';render();return;}
 const q={date:s.date,period:s.period,duration:s.duration,periods:[...s.periods]};const k=key(q.date,q.period,q.duration,q.periods);
 const cached=!force?cachedSelection(q):null;
 if(cached){s.data=cached;s.status='ok';records.set(k,cached);refreshAt=Math.max(Date.now(),Date.parse(cached.fetched_at)+AUTO_REFRESH_MS);render();return;}
 records.delete(k);s.status='loading';render();controller=new AbortController();const signal=controller.signal;
 try{const data=await api('/api/query?'+queryParams(q,force),signal);if(generation!==serial)return;validate(data,q);data.rooms.forEach(r=>knownBuildings.add(r[0]));s.data=data;s.status=fresh(data)?'ok':'stale';records.set(k,data);refreshAt=Math.max(Date.now(),Date.parse(data.fetched_at)+AUTO_REFRESH_MS);render();void prefetch(generation,signal);}
 catch(error){if(generation!==serial||error.name==='AbortError')return;s.status='error';s.autoSuspended=true;s.error=error.message==='Failed to fetch'?'查询连接中断，请稍后刷新。':error.message;render();}
}
function deriveTarget(mode){const now=new Date(Date.now()+serverOffset),date=today(),hm=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);let targetDate=date,p=1;const index=times.findIndex(t=>hm<t[1]);if(index<0){targetDate=addDays(date,1);p=1;}else p=index+1;return {date:targetDate,period:p};}
async function goNow(mode='now',reset=true,automatic=false,force=true){
 invalidate();const generation=serial;s.mode=mode;s.status='loading';render();if(location.protocol==='file:'){s.status='file';render();return;}controller=new AbortController();
 try{const c=await api('/api/context',controller.signal);if(generation!==serial)return;serverOffset=Date.parse(c.now)-Date.now();let date=c.target_date,p=c.period;const changedDay=s.date!==date,changedStart=s.period!==p;if(changedDay||changedStart||reset)s.building='';s.date=date;s.period=p;s.anchor=key(date,p);s.campus='beijing';let duration=s.duration||1,intent=s.spanIntent;if(reset||changedDay){duration=1;intent='single';}else if(intent==='night')duration=13-p;else if(intent==='two'){duration=Math.min(2,13-p);if(duration===1)intent='single';}else duration=Math.min(duration,13-p);setPeriods(sequence(p,duration),intent);sync();await load(force,automatic);}
 catch(error){if(generation!==serial||error.name==='AbortError')return;s.status='error';s.autoSuspended=true;s.error='无法连接查询服务，请稍后重试。';render();}
}
function editPeriods(ps,intent='custom'){
 invalidate();if(!ps.length){s.buildingManual=false;courseBuilding='';}setPeriods(ps,intent);browseReadyAt=s.duration?0:Date.now()+450;s.mode='custom';if(s.duration)s.building='';s.autoSuspended=false;s.status=s.duration?'selecting':'empty';sync();render();
 if(s.duration){const q={date:s.date,period:s.period,duration:s.duration,periods:s.periods};if(cachedSelection(q))void load(false);else debounce=setTimeout(()=>{debounce=null;void load(false);},450);}
}
function chooseTime(p){editPeriods(s.periods.includes(p)?s.periods.filter(n=>n!==p):[...s.periods,p]);}
function applyRange(start,finish,intent='custom'){
 if(start<1||finish>12||finish<start)return;
 setPeriods(sequence(start,finish-start+1),intent);s.mode='custom';s.building='';
 $('rangeDialog').close();sync();void load(false);
}
function showRange(){
 $('rangeStart').textContent=`${s.date===today()?'今天':s.date}，从第${s.period}节 ${times[s.period-1][0]}连续选到…；填好后仍可逐节增减。`;
 $('rangeEnds').innerHTML=times.map((t,i)=>`<button data-end="${i+1}" aria-pressed="${end()===i+1}" ${i+1<s.period?'disabled':''} aria-label="学到第${i+1}节 ${t[1]}为止"><strong>第${i+1}节</strong><small>${t[1]}</small></button>`).join('');
 $('rangeDialog').showModal();
}
$('timeDisclosure').addEventListener('toggle',()=>{const hint=$('compactRangeHint');hint.textContent=hint.textContent.replace(/ · (调整时间|收起)$/,` · ${$('timeDisclosure').open?'收起':'调整时间'}`);});
$('rangePicker').addEventListener('click',showRange);
$('wholeDay').addEventListener('click',()=>applyRange(1,12,'allday'));
$('browseAll').addEventListener('click',()=>{s.browseAll=true;render();});
$('browseMode').addEventListener('click',()=>{editPeriods([]);collapseTime();$('buildingOverview').querySelector('[aria-pressed=true]')?.focus({preventScroll:true});});
$('selectAllPeriods').addEventListener('click',()=>editPeriods(sequence(1,12),'allday'));
$('clearPeriods').addEventListener('click',()=>editPeriods([]));
$('finishTime').addEventListener('click',()=>{if(debounce){clearTimeout(debounce);debounce=null;void load(false);}collapseTime();});
function chooseDate(date){s.date=date;s.mode='custom';s.building='';s.buildingManual=false;courseBuilding='';sync();$('dateDialog').close();collapseTime();void load(false);}
function showDates(){const date=today();$('dateShortcuts').innerHTML=['今天','明天','后天'].map((label,i)=>`<button data-date="${addDays(date,i)}">${label}</button>`).join('');$('dateDialog').showModal();}
$('now').addEventListener('click',()=>{if(s.date!==today())chooseDate(today());else collapseTime();});$('plan').addEventListener('click',showDates);$('refresh').addEventListener('click',()=>!s.duration?ensureBrowse(true):s.mode==='custom'?load(true):goNow(s.mode,false));
$('date').addEventListener('change',()=>chooseDate($('date').value));$('settings').addEventListener('click',()=>{stopCatalogWarmup();$('settingsDialog').showModal();});$('about').addEventListener('click',()=>$('infoDialog').showModal());
function customCount(){
 $('customCount').textContent=customDraft.size?`已选 ${customDraft.size} 栋`:'至少选择一栋';$('saveCustom').disabled=customDraft.size===0;
}
function openCustom(){
 customDraft=new Set(s.customBuildings.length?s.customBuildings:(scopeBuildings()||ten));
 const extra=[...knownBuildings].filter(b=>!ten.includes(b)).sort(collator.compare);
 const group=(title,names)=>`<fieldset class="custom-group"><legend>${title}</legend><div class="custom-grid">${names.map(b=>`<label class="custom-choice"><input type="checkbox" data-custom-building="${esc(b)}" ${customDraft.has(b)?'checked':''}><span>${esc(b)}</span></label>`).join('')}</div></fieldset>`;
 $('customChoices').innerHTML=group('十栋常用教学楼',ten)+(extra.length?group('其他已查询到的场所',extra):'');customCount();$('customDialog').showModal();
}
$('customChoices').addEventListener('change',event=>{const input=event.target;if(!input.matches('[data-custom-building]'))return;input.checked?customDraft.add(input.dataset.customBuilding):customDraft.delete(input.dataset.customBuilding);customCount();});
$('customDialog').addEventListener('cancel',()=>{$('scope').value=s.scope;});
$('customDialog').addEventListener('close',()=>{$('scope').value=s.scope;});
$('saveCustom').addEventListener('click',()=>{
 if(!customDraft.size)return;s.customBuildings=[...customDraft];s.scope='custom';s.building='';s.buildingManual=true;courseBuilding='';const saved=persist();sync();render();
 $('customDialog').close();if($('settingsDialog').open)$('settingsDialog').close();
 $('customNotice').hidden=saved;$('customNotice').textContent=saved?'':'组合已用于本次查询，但浏览器未允许本机保存。';$('editCustomMain').focus({preventScroll:true});
});
$('editCustomMain').addEventListener('click',openCustom);$('editCustomSettings').addEventListener('click',openCustom);
$('kind').addEventListener('change',()=>{s.kind=$('kind').value;s.building='';render();});
$('scope').addEventListener('change',()=>{const next=$('scope').value;if(next==='custom'&&!s.customBuildings.length){openCustom();return;}s.scope=next;s.building='';s.buildingManual=true;courseBuilding='';persist();render();});
$('campus').addEventListener('change',()=>{s.campus=$('campus').value;$('settingsDialog').close();void load(false);});
$('search').addEventListener('input',()=>{s.query=$('search').value.trim();s.building='';render();});
$('linkTimetable').addEventListener('change',()=>{s.linkTimetable=$('linkTimetable').checked;persist();render();});
$('auto').addEventListener('change',()=>{s.auto=$('auto').checked;s.autoSuspended=false;refreshAt=Date.now()+AUTO_REFRESH_MS;persist();render();});
$('lookahead').addEventListener('change',()=>{s.lookahead=$('lookahead').checked;persist();render();if(s.lookahead&&controller)void prefetch(serial,controller.signal);});
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-building')){s.browseAll=false;if(!s.duration){if(catalogWarmup?.building!==b.dataset.building)stopCatalogWarmup();stopBrowse(false);browseReadyAt=0;}s.building=b.dataset.building;s.buildingManual=true;s.preferred=s.building;persist();render();}
 else if(b.hasAttribute('data-period'))chooseTime(Number(b.dataset.period));
 else if(b.hasAttribute('data-end'))applyRange(s.period,Number(b.dataset.end));
 else if(b.hasAttribute('data-duration')){setPeriods(sequence(s.period,Number(b.dataset.duration)),b.dataset.intent);s.building='';void load(false);}
 else if(b.hasAttribute('data-date'))chooseDate(b.dataset.date);
 else if(b.hasAttribute('data-room')){const r=(s.duration?s.data?.rooms:browseRooms())?.find(r=>id(r)===b.dataset.room);if(r&&(!s.duration||current()))openRoom(r,b,!s.duration);}
 else if(b.hasAttribute('data-detail-period'))requestDetailPeriod(Number(b.dataset.detailPeriod));
 else if(b.hasAttribute('data-detail-retry'))retryDetail();
 else if(b.hasAttribute('data-detail-refresh'))refreshDetail();
 else if(b.hasAttribute('data-close')){if(b.dataset.close==='customDialog')$('scope').value=s.scope;$(b.dataset.close).close();}
 else if(b.hasAttribute('data-action')){if(b.dataset.action==='browse-retry'){catalogs.delete(s.building);void ensureBrowse(true);}else if(b.dataset.action==='shorten'){setPeriods([s.period],'single');void load(true);}else if(b.dataset.action==='beijing'){s.campus='beijing';sync();void load(true);}else if(b.dataset.action==='all-types'){s.kind='all';sync();render();$('results').querySelector('.roombtn')?.focus({preventScroll:true});}else if(b.dataset.action==='clear'){Object.assign(s,{scope:'all',kind:'all',building:'',query:''});sync();render();}else void load(true);}
});
function browseStart(){const target=deriveTarget('now');return s.date===today()?(target.date===s.date?target.period:12):1;}
function stopBrowse(abort=true){if(!browseTask)return;browseTask.active=false;if(abort)browseTask.controller.abort();}
function browseProgress(){
 const entry=catalogs.get(s.building);if(entry?.status==='error')return '目录获取失败 · 可重试';if(entry?.status!=='ok')return '正在加载教室目录…';
 const count=sequence(1,12).filter(p=>fresh(records.get(key(s.date,p)))&&pending.get(key(s.date,p))?.kind!=='failed').length;
 return browseTask?.active&&browseTask.date===s.date?`全天 ${count}/12 节已有结果 · 正在查询第${browseTask.pending||browseStart()}节`:`全天 ${count}/12 节已查${s.autoSuspended?' · 部分失败，点刷新重试':s.auto?' · 每30分钟更新':' · 自动更新已关闭'}`;
}
function browseNames(){return scopeBuildings()||[...knownBuildings];}
function browseRooms(){return (s.browseAll?browseNames():[s.building]).flatMap(b=>{const e=catalogs.get(b);return e?.status==='ok'&&fresh(e.data)?e.data.rooms:[];});}
function validateCatalog(data,building){
 if(data.building!==building||!Array.isArray(data.rooms)||data.count!==data.rooms.length||!fresh(data)||data.rooms.some(r=>!Array.isArray(r)||r.length!==4||r[0]!==building||typeof r[1]!=='string'||!r[1]||typeof r[2]!=='string'||(r[3]!==null&&!Number.isInteger(r[3])))||new Set(data.rooms.map(id)).size!==data.count)throw new Error('教室目录与所选教学楼不符。');
}
function storeCatalog(data,building){validateCatalog(data,building);catalogs.set(building,{status:'ok',data});if(Array.isArray(data.buildings))data.buildings.filter(x=>typeof x==='string'&&x.length<=120).forEach(x=>knownBuildings.add(x));}
function stopCatalogWarmup(){if(!catalogWarmup)return;const task=catalogWarmup;catalogWarmup=null;task.controller.abort();if(catalogs.get(task.building)?.owner===task)catalogs.delete(task.building);}
async function warmBrowseCatalogs(){
 if(catalogWarmup||s.duration||s.campus!=='beijing'||modalOpen()||document.hidden||browseTask?.active)return;
 const task={controller:new AbortController(),building:''};catalogWarmup=task;
 try{for(const building of browseNames()){
  if(catalogWarmup!==task||s.duration||modalOpen()||document.hidden||browseTask?.active)break;
  const entry=catalogs.get(building);if(entry?.status==='loading'||entry?.status==='error'||entry?.status==='ok'&&fresh(entry.data))continue;
  task.building=building;catalogs.set(building,{status:'loading',owner:task});renderBrowseOverview();
  try{const data=await api('/api/catalog?'+new URLSearchParams({building}),task.controller.signal);if(catalogWarmup!==task)return;storeCatalog(data,building);}
  catch(error){if(catalogWarmup!==task||error.name==='AbortError')return;catalogs.set(building,{status:'error',error:error.message});}
  if(!s.duration&&!modalOpen()){renderBrowseOverview();if(s.browseAll)renderBrowseRooms();else if(s.building===building)render();}
 }}finally{if(catalogWarmup===task)catalogWarmup=null;}
}
const buildingLabel=b=>b==='教十楼(物理楼)'?'教十楼':b;
function renderBrowseOverview(){
 const snapshot=focusSnapshot(),names=browseNames();const known=names.filter(b=>catalogs.get(b)?.status==='ok'&&fresh(catalogs.get(b).data));
 const total=known.reduce((n,b)=>n+catalogs.get(b).data.rooms.filter(r=>matches(r,false)).length,0);
 $('overviewSummary').textContent=`${total}间教室${known.length<names.length?' · '+(names.length-known.length)+'栋目录待补':''}`;
 const max=Math.max(1,...known.map(b=>catalogs.get(b).data.rooms.filter(r=>matches(r,false)).length));
 const record=records.get(key(s.date,browseStart())),statesKnown=fresh(record)&&pending.get(key(s.date,browseStart()))?.kind!=='failed';
 $('buildingOverview').innerHTML=names.map(b=>{const entry=catalogs.get(b),known=entry?.status==='ok'&&fresh(entry.data),count=known?entry.data.rooms.filter(r=>matches(r,false)).length:null;
  const free=statesKnown?record.rooms.filter(r=>r[0]===b&&matches(r,false)).length:null;
  const status=count===null?(entry?.status==='error'?'目录失败':entry?.status==='loading'?'正在加载目录':'目录待补'):`${count}间教室`,detail=free===null?'':`，第${browseStart()}节${free}间空闲`;
  return `<button class="buildingtile browse-building" data-building="${esc(b)}" aria-pressed="${!s.browseAll&&s.building===b}" title="${esc(b+'，'+status+detail)}" aria-label="${esc(b+'，'+status+detail)}，浏览全天安排"><span class="tilename">${esc(buildingLabel(b))}</span><span class="tilevalue">${count===null?(entry?.status==='error'?'失败':entry?.status==='loading'?'…':'—'):`<b>${count}</b><span class="tile-unit">间教室</span>`}</span><svg class="tilechart" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="5" rx="2"/><rect class="bar" width="${count===null?0:Math.round(count/max*100)}" height="5" rx="2"/></svg></button>`;
 }).join('');if(s.building!==overviewSelection){keepBuildingInView();overviewSelection=s.building;}restoreFocus(snapshot);
}
function browseLessonRoomPins(){
 const pins=new Map(),data=timetables.get(s.date),known=records.get(key(s.date,browseStart()));
 if(!data?.available||!s.linkTimetable)return pins;
 if(fresh(known)&&Number.isInteger(data.week)&&known.query.week!==data.week)return pins;
 const active=browseCourse(true);
 for(const lesson of dayLessons()){
  const place=coursePlace(lesson.room);if(!place)continue;
  const current=Boolean(active?.room&&active.building===place.building&&active.room===place.room);
  const roomKey=id([place.building,place.room]),rank=current?-1:lesson.ps;
  if(!pins.has(roomKey)||rank<pins.get(roomKey).rank)pins.set(roomKey,{rank,label:current?'本节教室':'上课教室'});
 }
 return pins;
}
function renderBrowseRooms(){
 const label=s.browseAll?'全部教学楼':s.building;
 $('roomsTitle').textContent=label||'按楼浏览教室';$('roomSubtitle').textContent='无需选时间 · 点教室查看详情';
 if(location.protocol==='file:'){$('results').innerHTML=message('请通过站点访问','在我的课程中打开教室查询。','','');return;}
 if(s.campus!=='beijing'){$('results').innerHTML=message('珠海校区尚未接入','切回北京查看教务教室目录。','beijing','切回北京');return;}
 const available=browseRooms(),entry=s.browseAll?((available.length||browseNames().some(b=>catalogs.get(b)?.status==='ok'))?{status:'ok',data:{rooms:available,count:available.length}}:browseNames().some(b=>catalogs.get(b)?.status!=='error')?{status:'loading'}:{status:'error',error:'教学楼目录未能取得，可重试。'}):catalogs.get(s.building);
 if(!entry||entry.status==='loading'){$('results').innerHTML=message('正在加载教室目录…','按教室编号排列，全天状态会逐步填入。','','');return;}
 if(entry.status==='error'){$('results').innerHTML=message('教室目录暂未取得',entry.error,'browse-retry','重试目录');return;}
 const order=new Map(browseNames().map((b,i)=>[b,i])),pins=browseLessonRoomPins();
 const pinned=r=>pins.get(id([r[0],coursePlace(r[1])?.room||r[1]]));
 const rooms=entry.data.rooms.filter(r=>matches(r,false)).sort((a,b)=>(s.browseAll?order.get(a[0])-order.get(b[0]):0)||((pinned(a)?.rank??13)-(pinned(b)?.rank??13))||collator.compare(a[1],b[1]));
 $('roomsTitle').textContent=`${label} · ${rooms.length}间教室`;
 if(s.browseAll){const missing=browseNames().filter(b=>catalogs.get(b)?.status!=='ok'||!fresh(catalogs.get(b)?.data)).length;$('roomSubtitle').textContent=missing?`${missing}栋目录待补 · 已取得的全天状态直接共享`:'当前范围全部教室 · 按教学楼、教室号排列';}
 if(!rooms.length){const hidden=entry.data.rooms.filter(r=>matches(r,false,true));$('results').innerHTML=hidden.length?message(`另有${hidden.length}间被类型筛选隐藏`,'可放开类型查看，时间和楼宇保持不变。','all-types','显示这些教室'):message('没有匹配的教室',entry.data.count?'调整搜索或教学楼范围。':'教务目录没有返回这栋楼的教室。','','');return;}
 const headers=sequence(1,12);
 $('results').innerHTML=`<p class="browse-progress" role="status">${esc(browseProgress())}</p><div class="browse-scroll" tabindex="0" role="region" aria-label="${esc(label)}全天安排，横向滚动查看其他节次"><table class="browse-table${dayLessons().length?' timetable-table':''}"><colgroup><col class="matrix-name-col"><col span="12"></colgroup><thead><tr><th scope="col">教室</th>${timetableHeaders()}</tr></thead><tbody>${rooms.map(r=>`<tr data-row-building="${esc(r[0])}"><th scope="row"><button class="matrix-room" data-room="${esc(id(r))}" title="${esc(r[2])} · 登记容量${r[3]??'未知'}">${esc(r[1])}${pinned(r)?`<small class="current-course-room">${esc(pinned(r).label)}</small>`:''}${s.browseAll?`<small class="matrix-building">${esc(buildingLabel(r[0]))}</small>`:''}</button></th>${headers.map(p=>{const c=lessonAt(p);return `<td${c?` class="lesson-column" data-lesson-key="${esc(c.key)}"`: ''}><span class="browse-status" data-browse-period="${p}" data-browse-room="${esc(id(r))}"></span></td>`;}).join('')}</tr>`).join('')}</tbody></table></div><p class="browse-legend">空＝空闲　占＝占用　…＝查询中　—＝未查　!＝失败。${rooms.some(r=>r[3]>800)?'?＝超出当前查询范围。':''}状态按教务查询显示；横滑可看完整12节。</p>`;
 applyLessonStyles($('results'));renderBrowseStates();
}
function renderBrowseStates(){
 if(s.duration)return;const capacities=new Map(browseRooms().map(r=>[id(r),r[3]]));const sets=new Map();for(let p=1;p<=12;p++){const data=records.get(key(s.date,p));if(fresh(data))sets.set(p,new Set(data.rooms.map(id)));}
 for(const cell of $('results').querySelectorAll('[data-browse-period]')){const p=Number(cell.dataset.browsePeriod),pendingState=pending.get(key(s.date,p))?.kind,set=sets.get(p);const st=pendingState==='failed'?'failed':set?(set.has(cell.dataset.browseRoom)?'in':capacities.get(cell.dataset.browseRoom)>800?'range':'out'):pendingState==='pending'?'pending':'unknown';const labels={in:'空',out:'占',range:'?',failed:'!',pending:'…',unknown:'—'};cell.className='browse-status '+st+(pendingState==='pending'&&set?' updating':'');cell.textContent=labels[st];cell.title=`第${p}节 ${times[p-1][0]}–${times[p-1][1]}，${{in:'空闲',out:'占用',range:'超出查询容量范围（0–800），无法确认',failed:'查询失败',pending:'查询中',unknown:'未查询'}[st]}`;if(set)cell.title+='，获取于'+clock(records.get(key(s.date,p)).fetched_at);if(pendingState==='pending')cell.title+='，更新中';cell.setAttribute('aria-label',cell.title);cell.setAttribute('aria-busy',String(pendingState==='pending'));}
 const progress=$('results').querySelector('.browse-progress');if(progress)progress.textContent=browseProgress();renderBrowseOverview();$('statusDot').classList.toggle('ok',sets.size>0);$('sourceMessage').textContent=browseProgress();$('refresh').disabled=browseStarting||Boolean(browseTask?.active);
}
async function ensureBrowse(force=false){
 if(disposed||document.hidden||!config.isActive()||browseStarting||s.duration||$('roomDialog').open||s.campus!=='beijing'||location.protocol==='file:'||!s.building||!/^\d{4}-\d{2}-\d{2}$/.test(s.date))return;
 if(!force&&Date.now()<browseReadyAt){if(!browseTimer)browseTimer=setTimeout(()=>{browseTimer=null;void ensureBrowse(force);},browseReadyAt-Date.now());return;}
 const building=s.building,entry=catalogs.get(building);
 if(entry?.status==='loading')return;if(entry?.status==='error'&&!force)return;
 if(entry?.status!=='ok'||!fresh(entry.data)){
  stopBrowse(false);
  if(catalogRequest){catalogRequest.controller.abort();if(catalogs.get(catalogRequest.building)?.status==='loading')catalogs.delete(catalogRequest.building);}
  const request={building,controller:new AbortController()};catalogRequest=request;catalogs.set(building,{status:'loading'});
  try{const data=await api('/api/catalog?'+new URLSearchParams({building}),request.controller.signal);if(catalogRequest!==request)return;
   storeCatalog(data,building);
  }catch(error){if(catalogRequest!==request||error.name==='AbortError')return;catalogs.set(building,{status:'error',error:error.message});}
  finally{if(catalogRequest===request)catalogRequest=null;}
  if(!s.duration&&s.building===building){render();if(force&&catalogs.get(building)?.status==='ok')void ensureBrowse(true);}return;
 }

 if(!entry.data.rooms.some(r=>matches(r,false))&&!s.browseAll){stopBrowse(false);void warmBrowseCatalogs();return;}
 if(browseTask?.active&&browseTask.date===s.date)return;
 const first=browseStart(),order=sequence(first,13-first).concat(sequence(1,first-1).reverse());
 const queue=order.filter(p=>force||(!fresh(records.get(key(s.date,p)))&&!(pending.get(key(s.date,p))?.kind==='failed'&&Date.now()-pending.get(key(s.date,p)).at<300000)));
 if(!queue.length){if(!refreshAt)refreshAt=Date.now()+AUTO_REFRESH_MS;renderBrowseStates();void warmBrowseCatalogs();return;}
 stopBrowse(false);const task={date:s.date,controller:new AbortController(),active:true,pending:null};browseTask=task;if(force)s.autoSuspended=false;
 try{for(const p of queue){if(!task.active||browseTask!==task||s.duration||s.date!==task.date||$('roomDialog').open||document.hidden)break;
   if(!force&&fresh(records.get(key(task.date,p))))continue;task.pending=p;pending.set(key(task.date,p),{kind:'pending',at:Date.now()});renderBrowseStates();
   try{const data=await querySingle(task.date,p,force,task.controller.signal);if(!fresh(data))throw new Error('返回记录已过期');}
   catch(error){if(error.name==='AbortError')break;pending.set(key(task.date,p),{kind:'failed',at:Date.now()});s.autoSuspended=true;}
   if(task.active&&browseTask===task&&!s.duration)renderBrowseStates();
  }}finally{task.active=false;task.pending=null;const known=sequence(1,12).map(p=>records.get(key(task.date,p))).filter(fresh);refreshAt=known.length?Math.max(Date.now(),Math.min(...known.map(d=>Date.parse(d.fetched_at)))+AUTO_REFRESH_MS):Date.now()+AUTO_REFRESH_MS;if(browseTask===task&&!s.duration&&!$('roomDialog').open){renderBrowseStates();void warmBrowseCatalogs();}}
}

function stopDetail(){
 if(!detailTask)return;const task=detailTask;detailTask=null;task.queue.length=0;task.controller.abort();
}
function detailOrder(task){return [...new Set([...task.query.periods,...sequence(task.query.period,13-task.query.period),...sequence(1,task.query.period-1).reverse()])];}
function detailRecord(task,p){
 const record=records.get(key(task.date,p));
 const base=task.query.periods.includes(p)&&fresh(task.base)?task.base:null;
 return fresh(record)&&(!base||Date.parse(record.fetched_at)>=Date.parse(base.fetched_at))?record:base||record;
}
function detailState(task,p){
 if(task.failed.has(p))return 'failed';
 const record=detailRecord(task,p);if(fresh(record))return record.rooms.some(r=>id(r)===id(task.room))?'in':task.room[3]>800?'range':'out';
 if(task.pending===p)return 'pending';
 const queued=task.queue.find(item=>item.p===p);
 return queued?'queued':record?'stale':'unknown';
}
function detailEnd(task){let last=task.query.period-1;for(let p=task.query.period;p<=12;p++){if(detailState(task,p)!=='in')break;last=p;}return last;}
function buildRoomContent(task){
 const names=['上午','下午','晚间'];
 const parts=sequence(0,3);
 $('roomContent').innerHTML=`<div id="cr-detailSummary" class="detail-summary"></div><div class="detailfacts"><span>${esc(task.date)} ${days[weekday(task.date)]}</span><span>${task.browsing?'全天安排':'所选'+periodLabel(task.query.periods)}</span><span>登记容量 ${task.room[3]??'未知'}</span><span>${esc(task.room[2])}</span></div><div class="detail-toolbar"><p id="cr-detailProgress" class="subtle" role="status" aria-live="polite"></p><div><button data-detail-retry hidden>重试失败节次</button><button data-detail-refresh>刷新全天</button></div></div>${parts.map(i=>`<section class="detail-part"><h3>${names[i]}<small>${times[i*4][0]}–${times[i*4+3][1]}</small></h3><div class="detail-period-grid">${times.slice(i*4,i*4+4).map((t,j)=>{const p=i*4+j+1;return `<button class="detail-daycell" data-detail-period="${p}"><strong>第${p}节</strong><span class="detail-clock">${t[0]}–${t[1]}</span><span class="detail-state"></span></button>`;}).join('')}</div></section>`).join('')}<p class="detail-explanation">空闲 / 占用来自教务。点击任一节可重新查询。</p>`;
}
function renderRoomContent(){
 const task=detailTask;if(!task||!$('roomDialog').open)return;
 const labels={in:'✓ 空闲',out:'× 占用',range:'超出查询范围',pending:'… 查询中',queued:'等待查询',failed:'! 查询失败',stale:'记录已过期',unknown:'尚未查询'};
 const selectedStates=task.query.periods.map(p=>detailState(task,p));
 const summary=$('detailSummary');
 if(selectedStates.every(st=>st==='in')){const last=detailEnd(task);summary.className='detail-summary in';summary.textContent=task.browsing?`第${task.query.period}节空闲 · 连续已确认至 ${times[last-1][1]}`:continuous(task.query.periods)?`所选时段在空闲名单内 · 连续已确认至 ${times[last-1][1]}`:`所选 ${task.query.duration} 节均在空闲名单内（分段选择）`;}
 else if(selectedStates.includes('range')){summary.className='detail-summary out';summary.textContent='该教室超出当前查询容量范围，无法确认状态';}
 else if(selectedStates.includes('out')){summary.className='detail-summary out';summary.textContent=task.browsing?`第${task.query.period}节占用，可查看其他时段`:'所选时段有节次被占用';}
 else if(selectedStates.includes('failed')){summary.className='detail-summary failed';summary.textContent=task.browsing?'部分时段查询失败，可重试':'所选时段部分查询失败，可重试';}
 else{summary.className='detail-summary pending';summary.textContent=task.running||task.queue.length?(task.browsing?'正在查询全天安排…':'正在核对所选时段…'):'记录需要重新查询';}
 let completed=0;
 for(let p=1;p<=12;p++){
  const st=detailState(task,p),cell=$('roomContent').querySelector(`[data-detail-period="${p}"]`),record=detailRecord(task,p),updating=task.pending===p;
  if(st==='in'||st==='out'||st==='range')completed++;
  cell.className='detail-daycell '+st+(updating?' updating':'');cell.querySelector('.detail-state').textContent=labels[st]+(updating&&(st==='in'||st==='out')?' · 更新中':'');
  const source=(st==='in'||st==='out')&&record?'，获取于'+clock(record.fetched_at):st==='failed'?'，'+task.failed.get(p):'';
  cell.title=`第${p}节 ${labels[st]}${source}；点击重新查询`;
  cell.setAttribute('aria-label',`第${p}节 ${times[p-1][0]}至${times[p-1][1]}，${labels[st]}${source}，点击重新查询`);
  cell.setAttribute('aria-busy',String(updating));
 }
 const latest=Math.max(...sequence(1,12).map(p=>detailRecord(task,p)).filter(fresh).map(r=>Date.parse(r.fetched_at)),0);
 const phase=task.query.periods.includes(task.pending)?'所选节次':task.pending>=task.query.period?'后续节次':'前面节次';
 $('detailProgress').textContent=task.running?`正在核对${phase}${task.pending?' · 第'+task.pending+'节':''} · ${completed}/12 节有结果`:`全天 ${completed}/12 节已查${task.failed.size?' · '+task.failed.size+'节失败':latest?' · '+clock(latest):''}`;
 const retry=$('roomContent').querySelector('[data-detail-retry]'),retryFocused=document.activeElement===retry;retry.hidden=!task.failed.size;retry.disabled=task.running;retry.textContent=`重试 ${task.failed.size} 节`;
 $('roomContent').querySelector('[data-detail-refresh]').disabled=task.running;
 if(retryFocused&&retry.hidden)$('roomContent').querySelector(`[data-detail-period="${task.lastRequested||task.query.period}"]`)?.focus();
}
async function runDetail(task){
 if(task.running)return;task.running=true;
 try{while(task.queue.length&&detailTask===task&&$('roomDialog').open){
  const item=task.queue.shift();if(!item.force&&fresh(records.get(key(task.date,item.p))))continue;task.pending=item.p;task.failed.delete(item.p);renderRoomContent();
  try{const shared=inflightSingles.get(key(task.date,item.p));if(!item.force&&shared&&!shared.signal.aborted){try{await shared.promise;}catch{}if(detailTask!==task||!$('roomDialog').open)return;}
   if(!item.force&&fresh(records.get(key(task.date,item.p)))){task.pending=null;renderRoomContent();continue;}
   const data=await querySingle(task.date,item.p,item.force,task.controller.signal);
   if(detailTask!==task||!$('roomDialog').open)return;if(!fresh(data))throw new Error('返回记录已过期');records.set(key(task.date,item.p),data);data.rooms.forEach(r=>knownBuildings.add(r[0]));task.failed.delete(item.p);
  }catch(error){if(detailTask!==task||error.name==='AbortError')return;task.failed.set(item.p,error.message||'查询失败');}
  task.pending=null;if(detailTask===task)renderRoomContent();
 }}finally{task.running=false;task.pending=null;if(detailTask===task)renderRoomContent();}
}
function openRoom(room,button,browsing=false){
 stopDetail();stopBrowse(false);serial++;for(const [k,v]of pending)if(v.kind==='pending')pending.delete(k);
 const start=browseStart();const query=browsing?{date:s.date,period:start,duration:1,periods:[start]}:{...s.data.query};
 selected={room,data:browsing?null:s.data,browsing,query};origin=button;
 const task={room,query,browsing,base:browsing?null:s.data,date:query.date,controller:new AbortController(),queue:[],pending:null,failed:new Map(),running:false};
 for(const p of detailOrder(task)){const failed=pending.get(key(task.date,p))?.kind==='failed';if(failed)task.failed.set(p,'上次查询失败');if(p===query.period||!fresh(records.get(key(task.date,p)))||failed)task.queue.push({p,force:p===query.period||failed});}
 detailTask=task;$('roomTitle').textContent=room[1];$('roomBuilding').textContent=room[0];$('manualCopy').hidden=true;$('copyStatus').textContent='';buildRoomContent(task);$('roomDialog').showModal();renderRoomContent();void runDetail(task);
}
function requestDetailPeriod(p){
 const task=detailTask;if(!task||p<1||p>12||task.pending===p)return;
 task.queue=task.queue.filter(item=>item.p!==p);task.queue.unshift({p,force:true});task.failed.delete(p);renderRoomContent();void runDetail(task);
}
function retryDetail(){
 const task=detailTask;if(!task||task.running)return;
 task.queue=detailOrder(task).filter(p=>task.failed.has(p)).map(p=>({p,force:true}));task.lastRequested=task.queue[0]?.p;task.failed.clear();void runDetail(task);
}
function refreshDetail(){
 const task=detailTask;if(!task||task.running)return;
 task.failed.clear();task.queue=detailOrder(task).map(p=>({p,force:true}));void runDetail(task);
}
$('roomDialog').addEventListener('close',()=>{
 const task=detailTask;
 const changed=task&&!task.browsing&&task.query.periods.some(p=>{const record=records.get(key(task.date,p));return fresh(record)&&Date.parse(record.fetched_at)>=Date.parse(selected.data.fetched_at)&&!record.rooms.some(r=>id(r)===id(task.room));});
 stopDetail();
 if(changed&&task.date===s.date&&samePeriods(task.query.periods,s.periods)){s.building='';$('now').focus({preventScroll:true});void load(true);return;}
 render();
 const target=[...document.querySelectorAll('[data-room]')].find(e=>e.dataset.room===id(selected?.room||[]));
 if(target)target.focus({preventScroll:true});else if(origin?.isConnected)origin.focus({preventScroll:true});
});
$('copy').addEventListener('click',async()=>{
 if(!selected)return;const r=selected.room,last=confirmedEnd(r);
 if(selected.browsing){const text=`${r[0]} ${r[1]}\n${s.date} 全天安排\n`+sequence(1,12).map(p=>`第${p}节：${{in:'空闲',out:'占用',range:'超出查询范围',pending:'查询中',queued:'等待查询',failed:'查询失败',stale:'已过期',unknown:'未查询'}[detailState(detailTask,p)]}`).join('\n');try{await navigator.clipboard.writeText(text);$('copyStatus').textContent='已复制教室与全天状态。';}catch{const t=$('manualCopy');t.hidden=false;t.value=text;t.focus();t.select();$('copyStatus').textContent='请手动复制已选中的文字。';}return;}
 const text=`${r[0]} ${r[1]}\n${context()}\n${continuous(s.periods)?'教务连续空闲已确认至 '+(last>=s.period?times[last-1][1]:'待确认'):'分段选择，仅核对'+periodLabel(s.periods)}；所选窗口原获取于 ${selected.data.fetched_at}，全天各节单独更新。\n登记容量 ${r[3]??'未知'}。`;
 try{await navigator.clipboard.writeText(text);$('copyStatus').textContent='已复制教室与获取时间。';}catch{const t=$('manualCopy');t.hidden=false;t.value=text;t.focus();t.select();$('copyStatus').textContent='请手动复制上方已选中的文字。';}
});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const items=[...dialog.querySelectorAll('button,a[href],input,select,textarea')].filter(e=>!e.disabled&&e.getClientRects().length),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
function theme(value){document.documentElement.dataset.theme=value;document.documentElement.dataset.bnuTheme=value==='dark'?'dark':'warm';$('theme').textContent=value==='dark'?'切换浅色':'切换深色';}syncTheme();$('theme').addEventListener('click',()=>theme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
for(const dialog of document.querySelectorAll('dialog'))if(dialog.id!=='cr-roomDialog')dialog.addEventListener('close',()=>{if(!s.duration&&!modalOpen())void ensureBrowse(false);});
function modalOpen(){return Boolean(document.querySelector('dialog[open]'));}
async function tick(){
 if(disposed||document.hidden)return;
 if(s.status==='ok'&&!fresh(s.data)){s.status='stale';render();}
 if(!s.duration){const stamp=browseCourseStamp();if(stamp!==browseClassStamp&&!modalOpen()){browseClassStamp=stamp;render();}if(s.auto&&!s.autoSuspended&&!modalOpen()&&!browseTask?.active&&refreshAt&&Date.now()>=refreshAt)void ensureBrowse(true);return;}
 if(!s.auto||s.autoSuspended||s.status==='loading'||modalOpen()||(narrow.matches&&$('timeDisclosure').open)||['empty','selecting','error','unsupported','file','invalid'].includes(s.status)||document.activeElement?.matches('input,select,textarea')||document.activeElement?.closest('#cr-results'))return;
 if(s.mode!=='custom'){const t=deriveTarget(s.mode);if(key(t.date,t.period)!==s.anchor){await goNow(s.mode,false,true);return;}}
 if(refreshAt&&Date.now()>=refreshAt){if(s.mode==='custom')await load(true,true);else await goNow(s.mode,false,true);}
}
listen(window,'pagehide',()=>{stopCatalogWarmup();stopDetail();stopBrowse(true);});
const ticker=setInterval(tick,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(!clockReady){void startBrowse();return;}if(!s.duration&&sequence(1,12).some(p=>!records.has(key(s.date,p))))void ensureBrowse();void tick();}else stopCatalogWarmup();});
s.date=today();sync();render();void startBrowse();

function syncTheme(){theme(window.document.documentElement.dataset.bnuTheme==='dark'?'dark':'light');}
function pause(){if(catalogRequest){const request=catalogRequest;catalogRequest=null;request.controller.abort();if(catalogs.get(request.building)?.status==='loading')catalogs.delete(request.building);}stopCatalogWarmup();stopDetail();stopBrowse(true);controller?.abort();for(const d of root.querySelectorAll('dialog[open]'))d.close();}
const activeObserver=new MutationObserver(()=>{if(!config.isActive())pause();else if(!clockReady)void startBrowse();else if(!s.duration)void ensureBrowse(false);else if(!current())void load(false);});
activeObserver.observe(window.document.getElementById('timetableView'),{attributes:true,attributeFilter:['class']});
const themeObserver=new MutationObserver(()=>{syncTheme();timetableVersion++;timetables.clear();render();});
themeObserver.observe(window.document.documentElement,{attributes:true,attributeFilter:['data-bnu-theme']});
listen(window,'bnuappearancechange',()=>{syncTheme();timetableVersion++;timetables.clear();render();});
return {root,uid:config.uid,update(next){config=next;timetableVersion++;timetables.clear();syncTheme();render();},openSettings(){$('settings').click();},destroy(){if(disposed)return;disposed=true;pause();lifetime.abort();clearInterval(ticker);clearTimeout(debounce);clearTimeout(browseTimer);activeObserver.disconnect();themeObserver.disconnect();cleanup.forEach(fn=>fn());root.remove();}};

}
window.BnuClassrooms={mount(host,config){if(instance&&instance.root.parentElement===host&&instance.uid===config.uid){instance.update(config);return;}this.destroy();instance=create(host,config);},destroy(){if(instance){instance.destroy();instance=null;}},openSettings(){instance?.openSettings();}};
})();
