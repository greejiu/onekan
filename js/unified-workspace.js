import { supabase } from "./supabase.js";

const $=(s,r=document)=>r.querySelector(s);const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const pad=n=>String(n).padStart(2,"0");const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const key=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;const fromKey=k=>new Date(`${k}T12:00:00`);const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const todayKey=()=>{const d=new Date();d.setHours(d.getHours()-3);return key(d)};const uid=()=>crypto.randomUUID();
const START=360,END=1320,SLOT=30,SLOT_H=20;
let user=null,state=null,homeDays=1,homeMode="timeline",homeSideTab="upcoming",homeCursor=fromKey(todayKey()),calendarView="month",calendarCursor=new Date(),renderTimer=null,rendering=false,pendingGroupRecords=[],suppressItemClickUntil=0;
const selected=new Map();

function normalize(s){s=s&&typeof s==="object"?s:{};s.tasks=Array.isArray(s.tasks)?s.tasks:[];s.events=Array.isArray(s.events)?s.events:[];s.habitTemplates=Array.isArray(s.habitTemplates)?s.habitTemplates:[];s.habitDays=s.habitDays&&typeof s.habitDays==="object"?s.habitDays:{};s.timeBlocks=Array.isArray(s.timeBlocks)?s.timeBlocks:[];s.eventGroups=Array.isArray(s.eventGroups)&&s.eventGroups.length?s.eventGroups:[{id:"default",name:"기본",color:"#8fa9c4"}];s.ui=s.ui&&typeof s.ui==="object"?s.ui:{};s.ui.timelineColors={task:"#d8d8d5",habit:"#b9d9c3",...(s.ui.timelineColors||{})};const gid=s.eventGroups[0].id;s.tasks.forEach(x=>x.groupId||=gid);s.events.forEach(x=>x.groupId||=gid);s.habitTemplates.forEach(x=>x.groupId||=gid);return s}
async function read(){const {data:{session}}=await supabase.auth.getSession();user=session?.user||null;if(!user)return null;const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();if(error)throw error;state=normalize(data?.data);return state}
async function write(mutator){await read();if(!state||!user)return;mutator(state);const {error}=await supabase.from("onekan_state").upsert({user_id:user.id,data:state},{onConflict:"user_id"});if(error)throw error;$("#reloadCloudBtn")?.click();scheduleRender(130)}
function scheduleRender(ms=60){clearTimeout(renderTimer);renderTimer=setTimeout(renderAll,ms)}
function group(item){return state.eventGroups.find(g=>g.id===item.groupId)||state.eventGroups[0]}
function groupStyle(item){return `--uw-group:${group(item).color}`}
function applyColors(){document.documentElement.style.setProperty("--timeline-task-color",state.ui.timelineColors.task);document.documentElement.style.setProperty("--timeline-habit-color",state.ui.timelineColors.habit)}
function dayLabel(d,long=false){return new Intl.DateTimeFormat("ko-KR",long?{month:"long",day:"numeric",weekday:"short"}:{month:"numeric",day:"numeric",weekday:"short"}).format(d)}
function timeOf(iso){if(!iso)return"";const d=new Date(iso);return`${pad(d.getHours())}:${pad(d.getMinutes())}`}
function eventOnDate(e,k){const a=key(new Date(e.start)),b=e.allDay&&e.end?key(new Date(e.end)):a;return k>=a&&k<=b}
function itemsForDay(k){const events=state.events.filter(e=>eventOnDate(e,k)).map(e=>({kind:"event",item:e,timed:!e.allDay,time:e.allDay?null:new Date(e.start).getHours()*60+new Date(e.start).getMinutes(),duration:e.allDay?null:Math.max(SLOT,Math.round((new Date(e.end||e.start)-new Date(e.start))/60000/SLOT)*SLOT)}));const tasks=state.tasks.filter(t=>t.date===k).map(t=>{let start=null,duration=null;if(t.notionStart&&t.notionEnd){const d=new Date(t.notionStart);start=d.getHours()*60+d.getMinutes();duration=Math.max(SLOT,Math.round((new Date(t.notionEnd)-d)/60000/SLOT)*SLOT)}else{const b=state.timeBlocks.find(b=>b.taskId===t.id&&b.date===k);if(b){start=+b.startMinute;duration=+b.duration||SLOT}}return{kind:"task",item:t,timed:start!==null,time:start,duration}});const habits=state.habitTemplates.map(h=>({kind:"habit",item:h,timed:Number.isFinite(Number(h.startMinute)),time:Number(h.startMinute),duration:+h.duration||SLOT}));return[...events,...tasks,...habits]}
function checkMarkup(kind,item,k){if(kind==="event")return'<span class="uw-event-dot" aria-hidden="true"></span>';const done=kind==="task"?!!item.done:!!state.habitDays[k]?.[item.id];const color=kind==="task"?"var(--timeline-task-color)":"var(--timeline-habit-color)";return`<button class="uw-check${done?" checked":""}" style="--uw-check-color:${color}" data-uw-check="${kind}" data-id="${item.id}" data-date="${k}" type="button">${done?"✓":""}</button>`}
function itemMarkup(kind,item,k,compact=false){const done=kind==="task"?!!item.done:kind==="habit"?!!state.habitDays[k]?.[item.id]:false;const time=kind==="event"&&!item.allDay?timeOf(item.start):"";return`<div class="uw-item uw-${kind}${done?" done":""}${compact?" compact":""}" style="${groupStyle(item)}" data-uw-kind="${kind}" data-id="${item.id}" data-date="${k}" draggable="false">${checkMarkup(kind,item,k)}<span class="uw-item-title">${esc(item.title)}</span>${time?`<span class="uw-item-time">${time}</span>`:""}<button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button" aria-label="선택"></button></div>`}

function findAddHost(kind,date,time){const t=time!==null&&time!==undefined?`[data-time="${time}"]`:"";return $(`.uw-list[data-uw-add-kind="${kind}"][data-date="${date||""}"]${t},.uw-all-day-list[data-uw-add-kind="${kind}"][data-date="${date||""}"]${t},.uw-time-hit[data-uw-add-kind="${kind}"][data-date="${date||""}"]${t}`)}
function openInline(host,{kind,date=null,endDate=null,time=null,duration=SLOT,editId=null,withTime=false}={}){if(!host||$(".uw-inline-form",host))return;const list=kind==="event"?state.events:kind==="habit"?state.habitTemplates:state.tasks;const old=editId?list.find(x=>x.id===editId):null;const form=document.createElement("form");form.className="uw-inline-form";form.innerHTML=`${withTime?`<input type="time" value="${old&&kind==="event"&&!old.allDay?timeOf(old.start):time!==null?`${pad(Math.floor(time/60))}:${pad(time%60)}`:""}" aria-label="시간">`:""}<input type="text" value="${esc(old?.title||"")}" placeholder="${kind==="event"?"일정":"할일"} 입력" autocomplete="off">`;if(editId)host.closest(".uw-item")?.replaceWith(form);else if(host.matches(".uw-empty-hit"))host.replaceWith(form);else host.appendChild(form);const title=$("input[type=text]",form);let saving=false,cancelled=false;const commit=async next=>{if(saving)return;const value=title.value.trim();if(!value){form.remove();return}saving=true;const timeValue=$("input[type=time]",form)?.value||"";await write(s=>{const defaultGroup=s.eventGroups[0]?.id||"default";if(old){old.title=value;if(kind==="event"&&withTime){const d=date||key(new Date(old.start));if(timeValue){const start=new Date(`${d}T${timeValue}:00`);old.start=start.toISOString();old.end=new Date(start.getTime()+duration*60000).toISOString();old.allDay=false}else{old.start=new Date(`${d}T12:00:00`).toISOString();old.end=new Date(`${endDate||d}T12:00:00`).toISOString();old.allDay=true}}return}if(kind==="event"){const start=timeValue?new Date(`${date}T${timeValue}:00`):new Date(`${date}T12:00:00`);s.events.push({id:uid(),title:value,type:"schedule",groupId:defaultGroup,allDay:!timeValue,start:start.toISOString(),end:timeValue?new Date(start.getTime()+duration*60000).toISOString():new Date(`${endDate||date}T12:00:00`).toISOString()})}else{const task={id:uid(),title:value,date:date||null,done:false,groupId:defaultGroup,createdAt:new Date().toISOString()};if(time!==null){const start=new Date(`${date}T${pad(Math.floor(time/60))}:${pad(time%60)}:00`);task.notionStart=start.toISOString();task.notionEnd=new Date(start.getTime()+duration*60000).toISOString();s.timeBlocks.push({id:uid(),taskId:task.id,sourceTitle:value,detail:value,date,startMinute:time,duration})}s.tasks.push(task)}});if(next)setTimeout(()=>{const nextHost=findAddHost(kind,date,time);if(nextHost)openInline(nextHost,{kind,date,endDate,time,duration,withTime})},220)};form.addEventListener("submit",e=>{e.preventDefault();commit(true)});title.addEventListener("keydown",e=>{if(e.key==="Escape"){cancelled=true;form.remove()}});title.addEventListener("blur",()=>setTimeout(()=>{if(!cancelled&&form.isConnected&&!saving)commit(false)},90));requestAnimationFrame(()=>{title.focus();title.select()})}

function allDayPanel(k,items){const shown=items.slice(0,2),hidden=items.slice(2),extra=hidden.length;return`<div class="uw-all-day" data-date="${k}"><span class="uw-all-day-label">하루 종일</span><div class="uw-all-day-list" data-uw-add-kind="task" data-date="${k}">${shown.map(x=>itemMarkup(x.kind,x.item,k,true)).join("")||'<div class="uw-empty-hit">＋ 할일</div>'}</div>${extra?`<button class="uw-all-day-more" data-uw-all-day-more type="button" aria-expanded="false">+${extra}개 더보기</button><div class="uw-all-day-popover"><div class="uw-list">${hidden.map(x=>itemMarkup(x.kind,x.item,k,true)).join("")}</div></div>`:""}</div>`}
function flatListMarkup(x,k){return itemMarkup(x.kind,x.item,k).replace(/<span class="uw-item-time">.*?<\/span>/,"")}
function plannerListDay(d){const k=key(d),items=itemsForDay(k);return`<section class="uw-day uw-list-day${k===todayKey()?" uw-today":""}" data-date="${k}"><div class="uw-day-head"><strong>${dayLabel(d)}</strong></div><div class="uw-list uw-flat-day-list" data-uw-add-kind="task" data-date="${k}" data-task-drop-date="${k}">${items.map(x=>flatListMarkup(x,k)).join("")||'<div class="uw-empty-hit">＋ 할일</div>'}</div></section>`}
function plannerDay(d){const k=key(d),items=itemsForDay(k),untimed=items.filter(x=>!x.timed),timed=items.filter(x=>x.timed&&x.time>=START&&x.time<END);let labels="",hits="";for(let m=START;m<END;m+=SLOT){if(m%60===0)labels+=`<span class="uw-time-label" style="top:${((m-START)/SLOT)*SLOT_H}px">${pad(m/60)}:00</span>`;hits+=`<div class="uw-time-hit" style="top:${((m-START)/SLOT)*SLOT_H}px" data-uw-add-kind="task" data-date="${k}" data-time="${m}"></div>`}const blocks=timed.map(x=>`<div class="uw-time-entry uw-item ${x.kind==="task"&&x.item.done?"done":""}" style="top:${((x.time-START)/SLOT)*SLOT_H+1}px;height:${Math.max(18,(x.duration/SLOT)*SLOT_H-2)}px;${groupStyle(x.item)}" data-uw-kind="${x.kind}" data-id="${x.item.id}" data-date="${k}" data-time="${x.time}" data-duration="${x.duration}"><button class="uw-resize-handle top" data-uw-resize="top" type="button"></button>${checkMarkup(x.kind,x.item,k)}<span class="uw-item-title">${esc(x.item.title)}</span><button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button"></button><button class="uw-resize-handle bottom" data-uw-resize="bottom" type="button"></button></div>`).join("");return`<section class="uw-day${k===todayKey()?" uw-today":""}" data-date="${k}"><div class="uw-day-head"><strong>${dayLabel(d)}</strong></div>${allDayPanel(k,untimed)}<div class="uw-timeline"><div class="uw-time-labels">${labels}</div><div class="uw-time-lane">${hits}${blocks}</div></div></section>`}
function renderPlanner(){const card=$(".home-timeline-card");if(!card)return;$$("[data-uw-home-mode]").forEach(b=>b.classList.toggle("active",b.dataset.uwHomeMode===homeMode));const daySelect=$("[data-uw-home-days-select]");if(daySelect)daySelect.value=String(homeDays);const dayRenderer=homeMode==="timeline"?plannerDay:plannerListDay;card.innerHTML=`<div class="uw-planner-head"><div><div class="uw-planner-title">${homeMode==="timeline"?"타임라인":"목록"}</div><small class="card-meta">${homeMode==="timeline"?"30분 단위":"시간 구분 없이 날짜별 표시"}</small></div></div><div class="uw-home-planner"><div class="uw-planner-days ${homeMode==="list"?"uw-planner-list-days":""}" style="--uw-days:${homeDays}">${Array.from({length:homeDays},(_,i)=>dayRenderer(addDays(homeCursor,i))).join("")}</div></div>`}
function upcomingKeys(){return Array.from({length:7},(_,i)=>key(addDays(fromKey(todayKey()),i+1)))}
function renderUpcoming(){const root=$("#upcomingList");if(!root)return;const dates=upcomingKeys();root.innerHTML=dates.map(k=>{const rows=[...schedules(k).map(item=>({kind:"event",item})),...state.tasks.filter(t=>!t.done&&t.date===k).map(item=>({kind:"task",item}))];return`<div class="uw-date-group"><div class="uw-date-label"><span>${dayLabel(fromKey(k),true)}</span><button class="uw-icon-btn" data-uw-add-kind="task" data-date="${k}">＋</button></div><div class="uw-list" data-uw-add-kind="task" data-date="${k}">${rows.map(x=>itemMarkup(x.kind,x.item,k)).join("")||'<div class="uw-empty-hit">일정·할일 입력</div>'}</div></div>`}).join("")}
function renderSomeday(){const root=$("#somedayHomeSlot");if(!root)return;const tasks=state.tasks.filter(t=>!t.done&&!t.date);root.innerHTML=`<div class="uw-list uw-someday-list" data-uw-add-kind="task" data-date="" data-uw-someday-drop><button class="uw-someday-add uw-empty-hit" data-uw-add-kind="task" data-date="" type="button">＋ 할일 입력</button>${tasks.map(t=>itemMarkup("task",t,"")).join("")}</div>`}
function renderSideTab(){$$('[data-uw-side-tab]').forEach(button=>{const active=button.dataset.uwSideTab===homeSideTab;button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active))});$$('[data-uw-side-panel]').forEach(panel=>{panel.hidden=panel.dataset.uwSidePanel!==homeSideTab})}
function renderHome(){renderPlanner();renderSomeday();renderUpcoming();renderSideTab()}

function schedules(k){return state.events.filter(e=>eventOnDate(e,k)).sort((a,b)=>new Date(a.start)-new Date(b.start))}
function renderCalendar(){const body=$("#calendarBody");if(!body)return;$("#calendarTypeFilter")?.classList.add("uw-hidden");$("#dayModeSeg")?.classList.add("uw-hidden");const seg=$("#calendarViewSeg");if(seg)seg.innerHTML=`<button data-uw-cal-view="month" class="${calendarView==="month"?"active":""}">월</button><button data-uw-cal-view="week" class="${calendarView==="week"?"active":""}">주</button><button data-uw-cal-view="day" class="${calendarView==="day"?"active":""}">일</button>`;if(calendarView==="month"){const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),first=new Date(y,m,1),start=addDays(first,-first.getDay());$("#calTitle").textContent=`${y}년 ${m+1}월`;body.innerHTML=`<div class="uw-calendar uw-month">${["일","월","화","수","목","금","토"].map(x=>`<div class="uw-dow">${x}</div>`).join("")}${Array.from({length:42},(_,i)=>{const d=addDays(start,i),k=key(d);return`<div class="uw-month-cell${d.getMonth()!==m?" outside":""}" data-uw-add-kind="event" data-date="${k}"><span class="uw-month-num">${d.getDate()}</span><div class="uw-month-events">${schedules(k).slice(0,5).map(e=>itemMarkup("event",e,k,true)).join("")}</div></div>`}).join("")}</div>`;return}if(calendarView==="week"){const start=addDays(calendarCursor,-calendarCursor.getDay()),end=addDays(start,6);$("#calTitle").textContent=`${dayLabel(start)} – ${dayLabel(end)}`;body.innerHTML=`<div class="uw-scroll"><div class="uw-calendar uw-week">${Array.from({length:7},(_,i)=>{const d=addDays(start,i),k=key(d);return`<section class="uw-week-day"><div class="uw-week-label">${dayLabel(d,true)}</div><div class="uw-list" data-uw-add-kind="event" data-date="${k}">${schedules(k).map(e=>itemMarkup("event",e,k)).join("")||'<div class="uw-empty-hit">일정 입력</div>'}</div></section>`}).join("")}</div></div>`;return}const k=key(calendarCursor),rows=schedules(k),all=rows.filter(e=>e.allDay),timed=rows.filter(e=>!e.allDay);$("#calTitle").textContent=dayLabel(calendarCursor,true);body.innerHTML=`<div class="uw-calendar uw-day-list"><section class="uw-day-list-section"><h3>하루 종일</h3><div class="uw-list" data-uw-add-kind="event" data-date="${k}">${all.map(e=>itemMarkup("event",e,k)).join("")||'<div class="uw-empty-hit">일정 입력</div>'}</div></section><section class="uw-day-list-section"><h3>시간 일정</h3><div class="uw-list" data-uw-add-kind="event" data-date="${k}" data-with-time="1">${timed.map(e=>itemMarkup("event",e,k)).join("")||'<div class="uw-empty-hit">시간 일정 입력</div>'}</div></section></div>`}

function visibleTasks(tab){const t=todayKey();return state.tasks.filter(x=>tab==="today"?!x.done&&x.date===t:tab==="upcoming"?!x.done&&x.date&&x.date>t:tab==="someday"?!x.done&&!x.date:tab==="done"?x.done:true).sort((a,b)=>+a.done-+b.done||String(a.date||"9999").localeCompare(String(b.date||"9999")))}
function renderTasks(){const root=$("#tasksPageList");if(!root)return;$("#page-tasks .uw-task-view-controls")?.remove();const tab=$("#taskPageTabs button.active")?.dataset.taskTab||"all",date=tab==="someday"?"":todayKey();root.innerHTML=`<div class="uw-list" data-uw-add-kind="task" data-date="${date}">${visibleTasks(tab).map(t=>itemMarkup("task",t,t.date||"")).join("")||'<div class="uw-empty-hit">할일 입력</div>'}</div>`}

function renderHabits(){const root=$("#habitHistory");if(!root)return;const today=todayKey(),days=Array.from({length:7},(_,i)=>addDays(new Date(),i-6));const opts=id=>state.eventGroups.map(g=>`<option value="${g.id}"${g.id===id?" selected":""}>${esc(g.name)}</option>`).join("");root.innerHTML=`<section class="uw-habit-today"><h3>오늘 습관</h3><div class="uw-list">${state.habitTemplates.map(h=>itemMarkup("habit",h,today)).join("")||'<div class="empty">오늘 표시할 습관이 없어요.</div>'}</div></section><section class="uw-habit-manager"><h3>습관 관리</h3>${state.habitTemplates.map(h=>`<div class="uw-habit-manager-row" data-habit-manager="${h.id}"><input data-habit-field="title" value="${esc(h.title)}" aria-label="습관 이름"><input data-habit-field="time" type="time" value="${Number.isFinite(+h.startMinute)?`${pad(Math.floor(h.startMinute/60))}:${pad(h.startMinute%60)}`:""}" aria-label="시간"><select data-habit-field="duration"><option value="30">30분</option><option value="60"${+h.duration===60?" selected":""}>1시간</option><option value="90"${+h.duration===90?" selected":""}>1시간 30분</option><option value="120"${+h.duration===120?" selected":""}>2시간</option></select><select data-habit-field="groupId">${opts(h.groupId)}</select><div class="uw-habit-actions"><button class="uw-icon-btn" data-uw-duplicate-habit="${h.id}" type="button">⧉</button><button class="uw-icon-btn" data-uw-delete-habit="${h.id}" type="button">×</button></div></div>`).join("")}</section><section class="uw-habit-history"><h3>최근 7일</h3><div class="uw-scroll"><div class="uw-habit-table"><strong>습관</strong>${days.map(d=>`<span>${dayLabel(d)}</span>`).join("")}${state.habitTemplates.map(h=>`<strong>${esc(h.title)}</strong>${days.map(d=>{const k=key(d),done=!!state.habitDays[k]?.[h.id];return`<span><button class="uw-habit-day-check${done?" checked":""}" data-uw-habit-check="${h.id}" data-date="${k}" type="button">${done?"✓":""}</button></span>`}).join("")}`).join("")}</div></div></section>`;if(!$("#habitPageGroup")){const duration=$("#habitPageDuration")?.closest("label");if(duration){const label=document.createElement("label");label.innerHTML=`<span>그룹</span><select id="habitPageGroup">${opts(state.eventGroups[0].id)}</select>`;duration.after(label)}}else $("#habitPageGroup").innerHTML=opts($("#habitPageGroup").value||state.eventGroups[0].id)}

function installActionUI(){if($("#uwSelectionBar"))return;document.body.insertAdjacentHTML("beforeend",'<div class="uw-selection-bar" id="uwSelectionBar"><button data-uw-action="edit">수정</button><button data-uw-action="duplicate">복제</button><button data-uw-action="group">그룹</button><button data-uw-action="convert">전환</button><button class="danger" data-uw-action="delete">삭제</button><button data-uw-action="cancel">취소</button></div><div class="uw-context" id="uwContext"></div>')}
function coarse(){return matchMedia("(hover:none),(pointer:coarse)").matches}
function toggleSelection(item){const token=`${item.dataset.uwKind}:${item.dataset.id}:${item.dataset.date||""}`;if(selected.has(token)){selected.delete(token);item.classList.remove("selected")}else{selected.set(token,{kind:item.dataset.uwKind,id:item.dataset.id,date:item.dataset.date||null});item.classList.add("selected")}document.body.classList.toggle("uw-selection-active",selected.size>0);$("#uwSelectionBar")?.classList.toggle("open",selected.size>0)}
function clearSelection(){selected.clear();document.body.classList.remove("uw-selection-active");$("#uwSelectionBar")?.classList.remove("open");$$('.uw-item.selected').forEach(x=>x.classList.remove("selected"))}
function showGroupPicker(records){pendingGroupRecords=records;const menu=$("#uwContext");menu.innerHTML=`<strong style="padding:7px 9px;font-size:11px">그룹 선택</strong>${state.eventGroups.map(g=>`<button data-uw-group-id="${g.id}"><span style="display:inline-block;width:9px;height:9px;margin-right:7px;border-radius:50%;background:${g.color}"></span>${esc(g.name)}</button>`).join("")}`;menu.style.left="auto";menu.style.right="14px";menu.style.top="auto";menu.style.bottom="64px";menu.classList.add("open")}
async function action(name,records=[...selected.values()]){if(name==="cancel"){clearSelection();return}if(name==="edit"&&records.length===1){const r=records[0],el=$(`.uw-item[data-uw-kind="${r.kind}"][data-id="${CSS.escape(r.id)}"]`);clearSelection();if(el)openInline(el,{kind:r.kind,date:r.date,editId:r.id,withTime:r.kind==="event"&&calendarView==="day"});return}if(name==="group"){showGroupPicker(records);return}else if(name==="duplicate"){await write(s=>records.forEach(r=>{const arr=r.kind==="event"?s.events:r.kind==="habit"?s.habitTemplates:s.tasks;const x=arr.find(v=>v.id===r.id);if(x)arr.push({...x,id:uid(),title:`${x.title} 복사`,done:false,completedAt:null})}))}else if(name==="convert"){await write(s=>records.forEach(r=>{if(r.kind==="task"){const t=s.tasks.find(x=>x.id===r.id);if(!t)return;const d=t.date||todayKey();s.events.push({id:uid(),title:t.title,type:"schedule",groupId:t.groupId,allDay:!t.notionStart,start:t.notionStart||new Date(`${d}T12:00:00`).toISOString(),end:t.notionEnd||new Date(`${d}T12:00:00`).toISOString()});s.tasks=s.tasks.filter(x=>x.id!==r.id);s.timeBlocks=s.timeBlocks.filter(x=>x.taskId!==r.id)}else if(r.kind==="event"){const e=s.events.find(x=>x.id===r.id);if(!e)return;s.tasks.push({id:uid(),title:e.title,date:key(new Date(e.start)),done:false,groupId:e.groupId,...(!e.allDay?{notionStart:e.start,notionEnd:e.end}:{})});s.events=s.events.filter(x=>x.id!==r.id)}}))}else if(name==="delete"){await write(s=>records.forEach(r=>{if(r.kind==="event")s.events=s.events.filter(x=>x.id!==r.id);if(r.kind==="task"){s.tasks=s.tasks.filter(x=>x.id!==r.id);s.timeBlocks=s.timeBlocks.filter(x=>x.taskId!==r.id)}if(r.kind==="habit"){s.habitTemplates=s.habitTemplates.filter(x=>x.id!==r.id);Object.values(s.habitDays).forEach(day=>delete day[r.id])}}))}clearSelection()}

function setSomedayOpen(open){homeSideTab=open?"someday":"upcoming";renderSideTab()}

function wireClicks(){installActionUI();document.addEventListener("click",async e=>{if(Date.now()<suppressItemClickUntil){e.preventDefault();e.stopImmediatePropagation();return}const somedayToggle=e.target.closest("[data-uw-someday-toggle]");if(somedayToggle){setSomedayOpen(!document.body.classList.contains("uw-someday-open"));return}if(e.target.closest("[data-uw-someday-close]")){setSomedayOpen(false);return}$$(".uw-all-day.open").forEach(x=>{if(!e.target.closest(".uw-all-day"))x.classList.remove("open")});const more=e.target.closest("[data-uw-all-day-more]");if(more){const panel=more.closest(".uw-all-day"),open=!panel.classList.contains("open");$$(".uw-all-day.open").forEach(x=>x.classList.remove("open"));panel.classList.toggle("open",open);more.setAttribute("aria-expanded",String(open));return}const groupButton=e.target.closest("[data-uw-group-id]");if(groupButton){const records=[...pendingGroupRecords],groupId=groupButton.dataset.uwGroupId;pendingGroupRecords=[];$("#uwContext")?.classList.remove("open");await write(s=>records.forEach(r=>{const arr=r.kind==="event"?s.events:r.kind==="habit"?s.habitTemplates:s.tasks;const x=arr.find(v=>v.id===r.id);if(x)x.groupId=groupId}));clearSelection();return}const tab=e.target.closest("#taskPageTabs [data-task-tab]");if(tab){e.stopImmediatePropagation();$$('#taskPageTabs [data-task-tab]').forEach(x=>x.classList.toggle("active",x===tab));renderTasks();return}const a=e.target.closest("[data-uw-action]");if(a){await action(a.dataset.uwAction);return}const homeModeButton=e.target.closest("[data-uw-home-mode]");if(homeModeButton){homeMode=homeModeButton.dataset.uwHomeMode;renderPlanner();return}if(e.target.closest("[data-uw-home-prev]")){homeCursor=addDays(homeCursor,-homeDays);renderPlanner();return}if(e.target.closest("[data-uw-home-next]")){homeCursor=addDays(homeCursor,homeDays);renderPlanner();return}if(e.target.closest("[data-uw-home-today]")){homeCursor=fromKey(todayKey());renderPlanner();return}const cv=e.target.closest("[data-uw-cal-view]");if(cv){e.stopImmediatePropagation();calendarView=cv.dataset.uwCalView;renderCalendar();return}const hc=e.target.closest("[data-uw-habit-check]");if(hc){await write(s=>{s.habitDays[hc.dataset.date]||={};s.habitDays[hc.dataset.date][hc.dataset.uwHabitCheck]=!s.habitDays[hc.dataset.date][hc.dataset.uwHabitCheck]});return}const check=e.target.closest("[data-uw-check]");if(check){e.stopPropagation();await write(s=>{if(check.dataset.uwCheck==="task"){const t=s.tasks.find(x=>x.id===check.dataset.id);if(t){t.done=!t.done;t.completedAt=t.done?new Date().toISOString():null}}else{s.habitDays[check.dataset.date]||={};s.habitDays[check.dataset.date][check.dataset.id]=!s.habitDays[check.dataset.date][check.dataset.id]}});return}const del=e.target.closest("[data-uw-delete-habit]");if(del){await action("delete",[{kind:"habit",id:del.dataset.uwDeleteHabit,date:todayKey()}]);return}const dup=e.target.closest("[data-uw-duplicate-habit]");if(dup){await action("duplicate",[{kind:"habit",id:dup.dataset.uwDuplicateHabit,date:todayKey()}]);return}const item=e.target.closest(".uw-item[data-uw-kind]");if(item){if(Date.now()<suppressItemClickUntil)return;if(coarse()){toggleSelection(item);return}openInline(item,{kind:item.dataset.uwKind,date:item.dataset.date,editId:item.dataset.id,withTime:item.dataset.uwKind==="event"&&calendarView==="day"});return}const add=e.target.closest("[data-uw-add-kind]");if(add&&!e.target.closest(".uw-item,.uw-inline-form")){const kind=add.dataset.uwAddKind,date=add.dataset.date||null,time=add.dataset.time?+add.dataset.time:null;const empty=e.target.closest(".uw-empty-hit"),target=empty||(add.matches(".uw-list,.uw-all-day-list,.uw-time-hit,.uw-month-cell")?add:findAddHost(kind,date,time)||add.parentElement);openInline(target,{kind,date,time,withTime:add.dataset.withTime==="1"||target.dataset.withTime==="1"})}},true);
document.addEventListener("contextmenu",e=>{const item=e.target.closest(".uw-item[data-uw-kind]");if(!item)return;e.preventDefault();const menu=$("#uwContext");menu.innerHTML='<button data-c="duplicate">복제</button><button data-c="group">그룹</button>'+(item.dataset.uwKind!=="habit"?'<button data-c="convert">할일·일정 전환</button>':'')+'<button class="danger" data-c="delete">삭제</button>';menu.style.left=`${Math.min(innerWidth-170,e.clientX)}px`;menu.style.top=`${Math.min(innerHeight-190,e.clientY)}px`;menu.classList.add("open");menu.onclick=async ev=>{const b=ev.target.closest("[data-c]");if(!b)return;menu.classList.remove("open");await action(b.dataset.c,[{kind:item.dataset.uwKind,id:item.dataset.id,date:item.dataset.date}])}});document.addEventListener("pointerdown",e=>{if(!e.target.closest("#uwContext"))$("#uwContext")?.classList.remove("open")})
}

function minuteAt(lane,clientY){const rect=lane.getBoundingClientRect();return Math.max(START,Math.min(END-SLOT,START+Math.floor((clientY-rect.top)/SLOT_H)*SLOT))}
function dateTargetAt(x,y){return document.elementFromPoint(x,y)?.closest("[data-date],[data-task-drop-date]")}
async function saveTimedChange(kind,id,date,startMinute,duration){await write(s=>{if(kind==="habit"){const h=s.habitTemplates.find(x=>x.id===id);if(h){h.startMinute=startMinute;h.duration=duration}return}const start=new Date(`${date}T${pad(Math.floor(startMinute/60))}:${pad(startMinute%60)}:00`);if(kind==="event"){const x=s.events.find(v=>v.id===id);if(!x)return;x.start=start.toISOString();x.end=new Date(start.getTime()+duration*60000).toISOString();x.allDay=false;return}const t=s.tasks.find(x=>x.id===id);if(!t)return;t.date=date;t.notionStart=start.toISOString();t.notionEnd=new Date(start.getTime()+duration*60000).toISOString();s.timeBlocks=s.timeBlocks.filter(x=>x.taskId!==id);s.timeBlocks.push({id:uid(),taskId:id,sourceTitle:t.title,detail:t.title,date,startMinute,duration})})}
async function saveDateMove(kind,id,date){await write(s=>{if(kind==="habit")return;if(kind==="task"){const t=s.tasks.find(x=>x.id===id);if(!t)return;t.date=date||null;delete t.notionStart;delete t.notionEnd;s.timeBlocks=s.timeBlocks.filter(x=>x.taskId!==id);return}const e=s.events.find(x=>x.id===id);if(!e)return;const oldStart=new Date(e.start),oldEnd=new Date(e.end||e.start),duration=Math.max(0,oldEnd-oldStart),clock=e.allDay?"12:00:00":`${pad(oldStart.getHours())}:${pad(oldStart.getMinutes())}:00`;const start=new Date(`${date}T${clock}`);e.start=start.toISOString();e.end=new Date(start.getTime()+duration).toISOString()})}
function wireSideTabs(){document.addEventListener("click",event=>{const button=event.target.closest("[data-uw-side-tab]");if(!button)return;homeSideTab=button.dataset.uwSideTab;renderSideTab()})}
function wireControls(){let gesture=null;
const clearGesture=(g,restore=true)=>{clearTimeout(g?.timer);g?.preview?.remove();g?.ghost?.remove();g?.item?.classList.remove("uw-drag-ready","resizing","uw-dragging");$$(".uw-range-selected,.uw-drop-target").forEach(x=>x.classList.remove("uw-range-selected","uw-drop-target"));if(restore&&g?.item&&g.originalTop!==undefined){g.item.style.top=g.originalTop;g.item.style.height=g.originalHeight}if(gesture===g)gesture=null};
const activate=g=>{if(!g||g.cancelled||gesture!==g)return;g.active=true;g.item?.classList.add("uw-drag-ready");g.source.setPointerCapture?.(g.pointerId);if(navigator.vibrate)navigator.vibrate(18);if(g.mode==="time-create"){g.preview=document.createElement("div");g.preview.className="uw-drag-selection";g.lane.appendChild(g.preview)}if(g.mode==="move"){g.item.classList.add("uw-dragging");g.ghost=g.item.cloneNode(true);g.ghost.className="uw-drag-ghost";g.ghost.style.left=`${g.x}px`;g.ghost.style.top=`${g.y}px`;document.body.appendChild(g.ghost)}};
const updateDateRange=(g,date)=>{const a=date<g.startDate?date:g.startDate,b=date<g.startDate?g.startDate:date;g.nextDate=date;$$(".uw-month-cell").forEach(c=>c.classList.toggle("uw-range-selected",c.dataset.date>=a&&c.dataset.date<=b))};
document.addEventListener("pointerdown",e=>{if(!e.isPrimary||e.button>0)return;const resizeHandle=e.target.closest("[data-uw-resize]"),moveHandle=e.target.closest(".uw-move-handle"),item=(resizeHandle||moveHandle)?.closest(".uw-item")||e.target.closest(".uw-item");let mode=null,source=null;if(resizeHandle){mode="resize";source=resizeHandle}else if(moveHandle&&(!coarse()||item?.classList.contains("selected"))){mode="move";source=moveHandle}else if(!coarse()&&item&&!e.target.closest("button,.uw-item-title")){mode="move";source=item}else if(!e.target.closest(".uw-item,.uw-inline-form")){const hit=e.target.closest(".uw-time-hit");const cell=e.target.closest(".uw-month-cell");if(hit){mode="time-create";source=hit}else if(cell){mode="date-create";source=cell}}if(!mode||!source)return;const g=gesture={mode,source,item,pointerId:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,active:false,cancelled:false,coarse:e.pointerType!=="mouse"||coarse()};if(mode==="resize"){g.edge=resizeHandle.dataset.uwResize;g.start=+item.dataset.time;g.duration=+item.dataset.duration;g.nextStart=g.start;g.nextDuration=g.duration;g.originalTop=item.style.top;g.originalHeight=item.style.height}if(mode==="time-create"){g.lane=source.closest(".uw-time-lane");g.date=source.dataset.date;g.start=+source.dataset.time;g.nextStart=g.start;g.nextEnd=g.start+SLOT}if(mode==="date-create"){g.startDate=source.dataset.date;g.nextDate=g.startDate}if(mode==="move"){g.kind=item.dataset.uwKind;g.id=item.dataset.id;g.date=item.dataset.date;g.start=Number.isFinite(+item.dataset.time)?+item.dataset.time:null;g.duration=+item.dataset.duration||SLOT;g.nextDate=g.date;g.nextStart=g.start}if(g.coarse)g.timer=setTimeout(()=>activate(g),450)},true);
document.addEventListener("pointermove",e=>{const g=gesture;if(!g||e.pointerId!==g.pointerId)return;g.lastX=e.clientX;g.lastY=e.clientY;const distance=Math.hypot(e.clientX-g.x,e.clientY-g.y);if(!g.active){if(g.coarse&&distance>10){g.cancelled=true;clearGesture(g);return}if(!g.coarse&&distance>5)activate(g);if(!g.active)return}e.preventDefault();e.stopImmediatePropagation();if(g.mode==="resize"){const delta=Math.round((e.clientY-g.y)/SLOT_H)*SLOT;if(g.edge==="top"){g.nextStart=Math.max(START,Math.min(g.start+delta,g.start+g.duration-SLOT));g.nextDuration=g.duration-(g.nextStart-g.start)}else{g.nextDuration=Math.max(SLOT,Math.min(g.duration+delta,END-g.start));g.nextStart=g.start}g.item.classList.add("resizing");g.item.style.top=`${((g.nextStart-START)/SLOT)*SLOT_H+1}px`;g.item.style.height=`${Math.max(18,(g.nextDuration/SLOT)*SLOT_H-2)}px`;return}if(g.mode==="time-create"){const current=minuteAt(g.lane,e.clientY),a=Math.min(g.start,current),b=Math.max(g.start,current)+SLOT;g.nextStart=a;g.nextEnd=b;g.preview.style.top=`${((a-START)/SLOT)*SLOT_H}px`;g.preview.style.height=`${((b-a)/SLOT)*SLOT_H}px`;return}if(g.mode==="date-create"){const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest(".uw-month-cell");if(cell)updateDateRange(g,cell.dataset.date);return}if(g.mode==="move"){$$(".uw-drop-target").forEach(x=>x.classList.remove("uw-drop-target"));const pointed=document.elementFromPoint(e.clientX,e.clientY),somedayTab=pointed?.closest('[data-uw-side-tab="someday"]'),lane=pointed?.closest(".uw-time-lane"),target=pointed?.closest("[data-uw-someday-drop],.uw-all-day-list,[data-task-drop-date],.uw-month-cell,.uw-list[data-date]");let drop=null;g.validTarget=false;if(somedayTab&&g.kind==="task"&&homeSideTab!=="someday"){homeSideTab="someday";renderSideTab()}if(lane){g.nextDate=lane.closest(".uw-day")?.dataset.date||g.date;g.nextStart=minuteAt(lane,e.clientY);drop=lane.querySelector(`.uw-time-hit[data-time="${g.nextStart}"]`)}else if(target&&g.kind!=="habit"&&(!target.hasAttribute("data-uw-someday-drop")||g.kind==="task")){g.nextDate=target.hasAttribute("data-uw-someday-drop")?"":target.dataset.date||target.dataset.taskDropDate||g.date;g.nextStart=null;drop=target}if(drop){drop.classList.add("uw-drop-target");g.validTarget=true}if(g.ghost){g.ghost.style.left=`${e.clientX}px`;g.ghost.style.top=`${e.clientY}px`}}},{passive:false,capture:true});
document.addEventListener("pointerup",async e=>{const g=gesture;if(!g||e.pointerId!==g.pointerId)return;if(!g.active){clearGesture(g);return}suppressItemClickUntil=Date.now()+650;clearGesture(g,g.mode!=="resize");if(g.mode==="resize"){await saveTimedChange(g.item.dataset.uwKind,g.item.dataset.id,g.item.dataset.date,g.nextStart,g.nextDuration);return}if(g.mode==="time-create"){const host=findAddHost("task",g.date,g.nextStart);openInline(host,{kind:"task",date:g.date,time:g.nextStart,duration:g.nextEnd-g.nextStart});return}if(g.mode==="date-create"){const a=g.nextDate<g.startDate?g.nextDate:g.startDate,b=g.nextDate<g.startDate?g.startDate:g.nextDate,host=$(`.uw-month-cell[data-date="${a}"]`);openInline(host,{kind:"event",date:a,endDate:b});return}if(g.mode==="move"){if(!g.validTarget)return;if(g.nextStart!==null)await saveTimedChange(g.kind,g.id,g.nextDate,g.nextStart,g.duration);else await saveDateMove(g.kind,g.id,g.nextDate)}},{capture:true});
document.addEventListener("pointercancel",()=>clearGesture(gesture));document.addEventListener("contextmenu",e=>{if(gesture?.active){e.preventDefault();e.stopImmediatePropagation()}},true);
document.addEventListener("change",async e=>{const daySelect=e.target.closest("[data-uw-home-days-select]");if(daySelect){homeDays=Math.max(1,Math.min(7,+daySelect.value||1));renderPlanner();return}const field=e.target.closest("[data-habit-field]");if(!field)return;const row=field.closest("[data-habit-manager]");await write(s=>{const h=s.habitTemplates.find(x=>x.id===row.dataset.habitManager);if(!h)return;if(field.dataset.habitField==="title"&&field.value.trim())h.title=field.value.trim();if(field.dataset.habitField==="time"){if(field.value){const[a,b]=field.value.split(":").map(Number);h.startMinute=a*60+b}else delete h.startMinute}if(field.dataset.habitField==="duration")h.duration=+field.value;if(field.dataset.habitField==="groupId")h.groupId=field.value})});
$("#calPrev")?.addEventListener("click",e=>{e.stopImmediatePropagation();calendarCursor=calendarView==="month"?new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1):addDays(calendarCursor,calendarView==="week"?-7:-1);renderCalendar()},true);$("#calNext")?.addEventListener("click",e=>{e.stopImmediatePropagation();calendarCursor=calendarView==="month"?new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1):addDays(calendarCursor,calendarView==="week"?7:1);renderCalendar()},true);$("#calToday")?.addEventListener("click",e=>{e.stopImmediatePropagation();calendarCursor=new Date();renderCalendar()},true);$("#tasksPageAdd")?.addEventListener("click",e=>{e.stopImmediatePropagation();openInline($("#tasksPageList [data-uw-add-kind=task]")||$("#tasksPageList"),{kind:"task",date:null})},true);$$('.nav-item[data-page]').forEach(b=>b.addEventListener("click",()=>scheduleRender(220)));$("#reloadCloudBtn")?.addEventListener("click",()=>scheduleRender(240))}

function wireDragClickGuard(){
  document.addEventListener("click",e=>{
    if(Date.now()>=suppressItemClickUntil)return;
    if(e.target.closest(".uw-item,.uw-inline-form")){
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    suppressItemClickUntil=0;
  },true);
}

async function saveUntimedChange(kind,id,date){
  await write(s=>{
    if(kind==="habit")return;
    if(kind==="task"){
      const task=s.tasks.find(x=>x.id===id);
      if(!task)return;
      task.date=date||null;
      delete task.notionStart;
      delete task.notionEnd;
      s.timeBlocks=s.timeBlocks.filter(x=>x.taskId!==id);
      return;
    }
    const event=s.events.find(x=>x.id===id);
    if(!event)return;
    const noon=new Date(`${date}T12:00:00`);
    event.start=noon.toISOString();
    event.end=noon.toISOString();
    event.allDay=true;
  });
}

async function saveDateOnlyChange(kind,id,date){
  await write(s=>{
    if(kind==="habit")return;
    if(kind==="task"){
      const task=s.tasks.find(x=>x.id===id);
      if(!task)return;
      task.date=date;
      if(task.notionStart){
        const oldStart=new Date(task.notionStart);
        const oldEnd=new Date(task.notionEnd||task.notionStart);
        const duration=Math.max(SLOT*60000,oldEnd-oldStart);
        const start=new Date(`${date}T${pad(oldStart.getHours())}:${pad(oldStart.getMinutes())}:00`);
        task.notionStart=start.toISOString();
        task.notionEnd=new Date(start.getTime()+duration).toISOString();
      }
      s.timeBlocks.filter(x=>x.taskId===id).forEach(x=>x.date=date);
      return;
    }
    const event=s.events.find(x=>x.id===id);
    if(!event)return;
    const oldStart=new Date(event.start);
    const oldEnd=new Date(event.end||event.start);
    const duration=Math.max(0,oldEnd-oldStart);
    const clock=event.allDay?"12:00:00":`${pad(oldStart.getHours())}:${pad(oldStart.getMinutes())}:00`;
    const start=new Date(`${date}T${clock}`);
    event.start=start.toISOString();
    event.end=new Date(start.getTime()+duration).toISOString();
  });
}

function wireControlsV2(){
  let gesture=null;
  const clear=(g,restore=true)=>{
    clearTimeout(g?.timer);
    g?.preview?.remove();
    g?.ghost?.remove();
    g?.item?.classList.remove("uw-drag-ready","resizing","uw-dragging");
    $$(".uw-range-selected,.uw-drop-target").forEach(x=>x.classList.remove("uw-range-selected","uw-drop-target"));
    if(restore&&g?.item&&g.originalTop!==undefined){
      g.item.style.top=g.originalTop;
      g.item.style.height=g.originalHeight;
    }
    if(gesture===g)gesture=null;
  };
  const activate=g=>{
    if(!g||g.cancelled||gesture!==g)return;
    g.active=true;
    g.item?.classList.add("uw-drag-ready");
    g.source.setPointerCapture?.(g.pointerId);
    if(navigator.vibrate)navigator.vibrate(18);
    if(g.mode==="time-create"){
      g.preview=document.createElement("div");
      g.preview.className="uw-drag-selection";
      g.lane.appendChild(g.preview);
    }
    if(g.mode==="move"){
      g.item.classList.add("uw-dragging");
      g.ghost=g.item.cloneNode(true);
      g.ghost.className="uw-drag-ghost";
      g.ghost.style.left=`${g.x}px`;
      g.ghost.style.top=`${g.y}px`;
      document.body.appendChild(g.ghost);
    }
  };
  const updateDateRange=(g,date)=>{
    const first=date<g.startDate?date:g.startDate;
    const last=date<g.startDate?g.startDate:date;
    g.nextDate=date;
    $$(".uw-month-cell").forEach(cell=>cell.classList.toggle("uw-range-selected",cell.dataset.date>=first&&cell.dataset.date<=last));
  };

  document.addEventListener("pointerdown",e=>{
    if(!e.isPrimary||e.button>0)return;
    const resizeHandle=e.target.closest("[data-uw-resize]");
    const moveHandle=e.target.closest(".uw-move-handle");
    const item=(resizeHandle||moveHandle)?.closest(".uw-item")||e.target.closest(".uw-item");
    let mode=null,source=null;
    if(resizeHandle){mode="resize";source=resizeHandle}
    else if(moveHandle&&(!coarse()||item?.classList.contains("selected"))){mode="move";source=moveHandle}
    else if(!coarse()&&item&&!e.target.closest("button,input,select,textarea")){mode="move";source=item}
    else if(!e.target.closest(".uw-item,.uw-inline-form")){
      const hit=e.target.closest(".uw-time-hit");
      const cell=e.target.closest(".uw-month-cell");
      if(hit){mode="time-create";source=hit}
      else if(cell){mode="date-create";source=cell}
    }
    if(!mode||!source)return;
    const g=gesture={mode,source,item,pointerId:e.pointerId,x:e.clientX,y:e.clientY,active:false,cancelled:false,coarse:e.pointerType!=="mouse"||coarse()};
    if(mode==="resize"){
      g.edge=resizeHandle.dataset.uwResize;
      g.start=+item.dataset.time;
      g.duration=+item.dataset.duration;
      g.nextStart=g.start;
      g.nextDuration=g.duration;
      g.originalTop=item.style.top;
      g.originalHeight=item.style.height;
    }else if(mode==="time-create"){
      g.lane=source.closest(".uw-time-lane");
      g.date=source.dataset.date;
      g.start=+source.dataset.time;
      g.nextStart=g.start;
      g.nextEnd=g.start+SLOT;
    }else if(mode==="date-create"){
      g.startDate=source.dataset.date;
      g.nextDate=g.startDate;
    }else{
      g.kind=item.dataset.uwKind;
      g.id=item.dataset.id;
      g.date=item.dataset.date;
      g.start=Number.isFinite(+item.dataset.time)?+item.dataset.time:null;
      g.duration=+item.dataset.duration||SLOT;
      g.nextDate=g.date;
      g.nextStart=g.start;
      g.dropType=null;
    }
    if(g.coarse)g.timer=setTimeout(()=>activate(g),450);
  },true);

  document.addEventListener("pointermove",e=>{
    const g=gesture;
    if(!g||e.pointerId!==g.pointerId)return;
    const distance=Math.hypot(e.clientX-g.x,e.clientY-g.y);
    if(!g.active){
      if(g.coarse&&distance>10){g.cancelled=true;clear(g);return}
      if(!g.coarse&&distance>=6)activate(g);
      if(!g.active)return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if(g.mode==="resize"){
      const delta=Math.round((e.clientY-g.y)/SLOT_H)*SLOT;
      if(g.edge==="top"){
        g.nextStart=Math.max(START,Math.min(g.start+delta,g.start+g.duration-SLOT));
        g.nextDuration=g.duration-(g.nextStart-g.start);
      }else{
        g.nextDuration=Math.max(SLOT,Math.min(g.duration+delta,END-g.start));
        g.nextStart=g.start;
      }
      g.item.classList.add("resizing");
      g.item.style.top=`${((g.nextStart-START)/SLOT)*SLOT_H+1}px`;
      g.item.style.height=`${Math.max(18,(g.nextDuration/SLOT)*SLOT_H-2)}px`;
      return;
    }
    if(g.mode==="time-create"){
      const current=minuteAt(g.lane,e.clientY);
      const first=Math.min(g.start,current),last=Math.max(g.start,current)+SLOT;
      g.nextStart=first;
      g.nextEnd=last;
      g.preview.style.top=`${((first-START)/SLOT)*SLOT_H}px`;
      g.preview.style.height=`${((last-first)/SLOT)*SLOT_H}px`;
      return;
    }
    if(g.mode==="date-create"){
      const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest(".uw-month-cell");
      if(cell)updateDateRange(g,cell.dataset.date);
      return;
    }
    $$(".uw-drop-target").forEach(x=>x.classList.remove("uw-drop-target"));
    const pointed=document.elementFromPoint(e.clientX,e.clientY);
    const lane=pointed?.closest(".uw-time-lane");
    const someday=pointed?.closest("[data-uw-someday-drop]");
    const allDay=pointed?.closest(".uw-all-day-list");
    const dateList=pointed?.closest("[data-task-drop-date],.uw-month-cell,.uw-list[data-date]");
    let drop=null;
    g.validTarget=false;
    g.dropType=null;
    if(lane){
      g.nextDate=lane.closest(".uw-day")?.dataset.date||g.date;
      g.nextStart=minuteAt(lane,e.clientY);
      g.dropType="time";
      drop=lane.querySelector(`.uw-time-hit[data-time="${g.nextStart}"]`);
    }else if(someday&&g.kind==="task"){
      g.nextDate="";
      g.nextStart=null;
      g.dropType="someday";
      drop=someday;
    }else if(allDay&&g.kind!=="habit"){
      g.nextDate=allDay.dataset.date||g.date;
      g.nextStart=null;
      g.dropType="all-day";
      drop=allDay;
    }else if(dateList&&g.kind!=="habit"){
      g.nextDate=dateList.dataset.date||dateList.dataset.taskDropDate||g.date;
      g.nextStart=null;
      g.dropType="date";
      drop=dateList;
    }
    if(drop){drop.classList.add("uw-drop-target");g.validTarget=true}
    if(g.ghost){g.ghost.style.left=`${e.clientX}px`;g.ghost.style.top=`${e.clientY}px`}
    if(e.clientY<70)window.scrollBy(0,-12);
    else if(e.clientY>innerHeight-70)window.scrollBy(0,12);
  },{passive:false,capture:true});

  document.addEventListener("pointerup",async e=>{
    const g=gesture;
    if(!g||e.pointerId!==g.pointerId)return;
    if(!g.active){clear(g);return}
    suppressItemClickUntil=Date.now()+650;
    clear(g,g.mode!=="resize");
    if(g.mode==="resize"){await saveTimedChange(g.item.dataset.uwKind,g.item.dataset.id,g.item.dataset.date,g.nextStart,g.nextDuration);return}
    if(g.mode==="time-create"){
      const host=findAddHost("task",g.date,g.nextStart);
      openInline(host,{kind:"task",date:g.date,time:g.nextStart,duration:g.nextEnd-g.nextStart});
      return;
    }
    if(g.mode==="date-create"){
      const first=g.nextDate<g.startDate?g.nextDate:g.startDate;
      const last=g.nextDate<g.startDate?g.startDate:g.nextDate;
      openInline($(`.uw-month-cell[data-date="${first}"]`),{kind:"event",date:first,endDate:last});
      return;
    }
    if(!g.validTarget)return;
    if(g.dropType==="time")await saveTimedChange(g.kind,g.id,g.nextDate,g.nextStart,g.duration);
    else if(g.dropType==="all-day"||g.dropType==="someday")await saveUntimedChange(g.kind,g.id,g.nextDate);
    else await saveDateOnlyChange(g.kind,g.id,g.nextDate);
  },{capture:true});
  document.addEventListener("pointercancel",()=>clear(gesture));
  document.addEventListener("contextmenu",e=>{if(gesture?.active){e.preventDefault();e.stopImmediatePropagation()}},true);
}

async function renderAll(){if(rendering)return;rendering=true;try{await read();if(!state)return;applyColors();renderHome();renderCalendar();renderTasks();renderHabits()}catch(e){console.error("통합 화면 렌더링 실패",e)}finally{rendering=false}}
async function init(){if(document.documentElement.dataset.unifiedWorkspace)return;document.documentElement.dataset.unifiedWorkspace="1";wireDragClickGuard();wireClicks();wireSideTabs();wireControlsV2();await renderAll()}
supabase.auth.onAuthStateChange((_e,session)=>{user=session?.user||null;if(user)setTimeout(init,300)});const {data:{session}}=await supabase.auth.getSession();if(session?.user){user=session.user;setTimeout(init,300)}
