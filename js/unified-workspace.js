import { supabase } from "./supabase.js";

const $=(s,r=document)=>r.querySelector(s);const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const pad=n=>String(n).padStart(2,"0");const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const key=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;const fromKey=k=>new Date(`${k}T12:00:00`);const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const todayKey=()=>{const d=new Date();d.setHours(d.getHours()-3);return key(d)};const uid=()=>crypto.randomUUID();
let START=360,END=1320;const SLOT=30,SLOT_H=20;
let user=null,state=null,homeDays=1,homeMode="timeline",homeSideTab="upcoming",homeCursor=fromKey(todayKey()),calendarView="month",calendarCursor=new Date(),renderTimer=null,rendering=false,pendingGroupRecords=[],suppressItemClickUntil=0,overdueExpanded=false,habitScopeResolve=null;
const selected=new Map();
let schedulePageMode="list",scheduleCalendarLayout="board";
let taskPageMode="list",taskListTab="all",taskCalendarView="month",taskCalendarLayout="board",taskCalendarCursor=fromKey(todayKey()),habitCursor=fromKey(todayKey());

function normalize(s){
  s=s&&typeof s==="object"?s:{};
  s.tasks=Array.isArray(s.tasks)?s.tasks:[];
  s.events=Array.isArray(s.events)?s.events:[];
  s.habitTemplates=Array.isArray(s.habitTemplates)?s.habitTemplates:[];
  s.habitDays=s.habitDays&&typeof s.habitDays==="object"?s.habitDays:{};
  s.habitOverrides=s.habitOverrides&&typeof s.habitOverrides==="object"?s.habitOverrides:{};
  s.taskOverrides=s.taskOverrides&&typeof s.taskOverrides==="object"?s.taskOverrides:{};
  s.timeBlocks=Array.isArray(s.timeBlocks)?s.timeBlocks:[];
  s.sessions=Array.isArray(s.sessions)?s.sessions:[];
  s.eventGroups=Array.isArray(s.eventGroups)&&s.eventGroups.length?s.eventGroups:[{id:"default",name:"기본",color:"#8fa9c4"}];
  s.ui=s.ui&&typeof s.ui==="object"?s.ui:{};
  s.ui.timelineColors={task:"#d8d8d5",habit:"#b9d9c3",...(s.ui.timelineColors||{})};
  s.ui.showSessionsOnTimeline=s.ui.showSessionsOnTimeline!==false;
  s.ui.themeColor=/^#[0-9a-f]{6}$/i.test(s.ui.themeColor||"")?s.ui.themeColor:"#8fa9c4";
  const range=s.ui.timelineRange&&typeof s.ui.timelineRange==="object"?s.ui.timelineRange:{};
  const start=Math.max(0,Math.min(1350,Math.round((+range.start||360)/SLOT)*SLOT));
  const end=Math.max(start+SLOT,Math.min(1440,Math.round((+range.end||1320)/SLOT)*SLOT));
  s.ui.timelineRange={start,end};
  const gid=s.eventGroups[0].id;
  s.tasks.forEach(x=>x.groupId||=gid);
  s.events.forEach(x=>x.groupId||=gid);
  s.habitTemplates.forEach(x=>x.groupId||=gid);
  return s
}
async function read(){const {data:{session}}=await supabase.auth.getSession();user=session?.user||null;if(!user)return null;const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();if(error)throw error;state=normalize(data?.data);return state}
async function write(mutator){await read();if(!state||!user)return;mutator(state);const {error}=await supabase.from("onekan_state").upsert({user_id:user.id,data:state},{onConflict:"user_id"});if(error)throw error;document.dispatchEvent(new CustomEvent("onekan:state-changed",{detail:{source:"unified"}}));$("#reloadCloudBtn")?.click();scheduleRender(130)}
function scheduleRender(ms=60){clearTimeout(renderTimer);renderTimer=setTimeout(renderAll,ms)}
function group(item){return state.eventGroups.find(g=>g.id===item.groupId)||state.eventGroups[0]}
function groupStyle(item){return `--uw-group:${group(item).color}`}
function applyColors(){
  START=state.ui.timelineRange.start;
  END=state.ui.timelineRange.end;
  const root=document.documentElement;
  root.style.setProperty("--timeline-task-color",state.ui.timelineColors.task);
  root.style.setProperty("--timeline-habit-color",state.ui.timelineColors.habit);
  root.style.setProperty("--uw-theme",state.ui.themeColor);
  root.style.setProperty("--accent",state.ui.themeColor);
}
function timelineHeight(){return((END-START)/SLOT)*SLOT_H}
function currentTimeMarkup(date){
  const now=new Date(),minute=now.getHours()*60+now.getMinutes();
  const visible=date===key(now)&&minute>=START&&minute<=END;
  const top=Math.max(0,Math.min(timelineHeight(),((minute-START)/SLOT)*SLOT_H));
  return `<div class="uw-current-time${visible?" active":""}" data-current-date="${date}" style="top:${top}px${visible?"":";display:none"}"><span></span></div>`
}
function updateCurrentTimeLines(){
  const now=new Date(),today=key(now),minute=now.getHours()*60+now.getMinutes();
  $$(".uw-current-time").forEach(line=>{
    const visible=line.dataset.currentDate===today&&minute>=START&&minute<=END;
    line.style.display=visible?"":"none";
    if(visible)line.style.top=`${Math.max(0,Math.min(timelineHeight(),((minute-START)/SLOT)*SLOT_H))}px`;
  })
}
function layoutTimedItems(items){
  const sorted=[...items].sort((a,b)=>a.time-b.time||b.duration-a.duration);
  let cluster=[],clusterEnd=-Infinity;
  const flush=()=>{
    if(!cluster.length)return;
    const laneEnds=[];
    cluster.forEach(entry=>{
      let lane=laneEnds.findIndex(end=>end<=entry.time);
      if(lane<0)lane=laneEnds.length;
      entry._lane=lane;
      laneEnds[lane]=entry.time+Math.max(SLOT,entry.duration||SLOT);
    });
    const columns=Math.max(1,laneEnds.length);
    cluster.forEach(entry=>entry._columns=columns);
    cluster=[];
    clusterEnd=-Infinity;
  };
  sorted.forEach(entry=>{
    if(cluster.length&&entry.time>=clusterEnd)flush();
    cluster.push(entry);
    clusterEnd=Math.max(clusterEnd,entry.time+Math.max(SLOT,entry.duration||SLOT));
  });
  flush();
  return sorted;
}
function timedColumnStyle(entry){
  const columns=Math.max(1,entry._columns||1),lane=Math.max(0,entry._lane||0);
  if(columns===1)return"";
  const width=100/columns,left=lane*width;
  return`left:calc(${left}% + 1px);width:calc(${width}% - 2px);right:auto;`
}
function dayLabel(d,long=false){return new Intl.DateTimeFormat("ko-KR",long?{month:"long",day:"numeric",weekday:"short"}:{month:"numeric",day:"numeric",weekday:"short"}).format(d)}
function timeOf(iso){if(!iso)return"";const d=new Date(iso);return`${pad(d.getHours())}:${pad(d.getMinutes())}`}
function dayDistance(first,last){
  const a=fromKey(first),b=fromKey(last);
  return Math.round((Date.UTC(b.getFullYear(),b.getMonth(),b.getDate())-Date.UTC(a.getFullYear(),a.getMonth(),a.getDate()))/86400000)
}
function recurrenceOn(item,baseDate,targetDate){
  if(!baseDate||!targetDate)return false;
  const recurrence=item.recurrence;
  if(!recurrence||!recurrence.frequency||recurrence.frequency==="none")return targetDate===baseDate;
  if(targetDate<baseDate||recurrence.until&&targetDate>recurrence.until)return false;
  const interval=Math.max(1,+recurrence.interval||1),diff=dayDistance(baseDate,targetDate);
  if(recurrence.frequency==="daily")return diff%interval===0;
  const base=fromKey(baseDate),target=fromKey(targetDate);
  if(recurrence.frequency==="weekly"){
    const weekdays=Array.isArray(recurrence.weekdays)&&recurrence.weekdays.length?recurrence.weekdays:[base.getDay()];
    return Math.floor(diff/7)%interval===0&&weekdays.includes(target.getDay())
  }
  if(recurrence.frequency==="monthly"){
    const months=(target.getFullYear()-base.getFullYear())*12+target.getMonth()-base.getMonth();
    const wanted=Math.min(+recurrence.dayOfMonth||base.getDate(),new Date(target.getFullYear(),target.getMonth()+1,0).getDate());
    return months>=0&&months%interval===0&&target.getDate()===wanted
  }
  return targetDate===baseDate
}
function nextOccurrence(item,afterDate,limit=370){
  const base=item.date;
  if(!base||!item.recurrence)return null;
  for(let offset=0;offset<=limit;offset++){
    const date=key(addDays(fromKey(afterDate),offset));
    if(recurrenceOn(item,base,date))return date
  }
  return null
}
function taskDoneOn(item,date){
  return item.recurrence?.frequency?!!item.recurrenceDone?.[date]:!!item.done
}
function itemDoneOn(kind,item,date){
  return kind==="task"?taskDoneOn(item,date):kind==="habit"?!!state.habitDays[date]?.[item.id]:false
}
function recurrenceLabel(item){
  const recurrence=item.recurrence,frequency=recurrence?.frequency,interval=Math.max(1,+recurrence?.interval||1);
  if(frequency==="daily")return interval===1?"매일":`${interval}일마다`;
  if(frequency==="weekly"){
    const weekdays=Array.isArray(recurrence.weekdays)?recurrence.weekdays:[];
    if(interval===1&&weekdays.length>1)return weekdays.map(day=>["일","월","화","수","목","금","토"][day]).join("·")+"요일";
    return interval===1?"매주":`${interval}주마다`
  }
  if(frequency==="monthly")return interval===1?"매월":`${interval}달마다`;
  return""
}
function eventOnDate(eventItem,date){
  const start=key(new Date(eventItem.start)),end=eventItem.allDay&&eventItem.end?key(new Date(eventItem.end)):start;
  if(!eventItem.recurrence?.frequency)return date>=start&&date<=end;
  const span=Math.max(0,dayDistance(start,end));
  for(let offset=0;offset<=span;offset++){
    const occurrenceStart=key(addDays(fromKey(date),-offset));
    if(recurrenceOn(eventItem,start,occurrenceStart))return true
  }
  return false
}
function habitOverride(source,date,id,create=false){if(!source||!date||!id)return null;if(create){source.habitOverrides||={};source.habitOverrides[date]||={};source.habitOverrides[date][id]||={}}return source.habitOverrides?.[date]?.[id]||null}
function cleanHabitOverride(source,date,id){const value=source.habitOverrides?.[date]?.[id];if(value&&Object.keys(value).length===0)delete source.habitOverrides[date][id];if(source.habitOverrides?.[date]&&Object.keys(source.habitOverrides[date]).length===0)delete source.habitOverrides[date]}
function taskOverride(source,date,id,create=false){if(!source||!date||!id)return null;if(create){source.taskOverrides||={};source.taskOverrides[date]||={};source.taskOverrides[date][id]||={}}return source.taskOverrides?.[date]?.[id]||null}
function cleanTaskOverride(source,date,id){const value=source.taskOverrides?.[date]?.[id];if(value&&Object.keys(value).length===0)delete source.taskOverrides[date][id];if(source.taskOverrides?.[date]&&Object.keys(source.taskOverrides[date]).length===0)delete source.taskOverrides[date]}
function clearTaskTimingOverrides(source,id){Object.keys(source.taskOverrides||{}).forEach(date=>{const value=source.taskOverrides?.[date]?.[id];if(!value)return;delete value.startMinute;delete value.duration;cleanTaskOverride(source,date,id)})}
function itemsForDay(k){
  const events=state.events.filter(event=>eventOnDate(event,k)).map(event=>({kind:"event",item:event,timed:!event.allDay,time:event.allDay?null:new Date(event.start).getHours()*60+new Date(event.start).getMinutes(),duration:event.allDay?null:Math.max(SLOT,Math.round((new Date(event.end||event.start)-new Date(event.start))/60000/SLOT)*SLOT)}));
  const tasks=state.tasks.filter(task=>task.date&&recurrenceOn(task,task.date,k)).map(task=>{
    const override=taskOverride(state,k,task.id)||{};
    let start=null,duration=null;
    if(Object.prototype.hasOwnProperty.call(override,"startMinute")){
      start=override.startMinute;
      duration=+override.duration||SLOT
    }else if(task.notionStart&&task.notionEnd){
      const date=new Date(task.notionStart);
      start=date.getHours()*60+date.getMinutes();
      duration=Math.max(SLOT,Math.round((new Date(task.notionEnd)-date)/60000/SLOT)*SLOT)
    }else{
      const block=state.timeBlocks.find(block=>block.taskId===task.id&&block.date===k);
      if(block){start=+block.startMinute;duration=+block.duration||SLOT}
    }
    const timed=start!==null&&start!==undefined&&Number.isFinite(Number(start));
    return{kind:"task",item:task,timed,time:timed?Number(start):null,duration:timed?(+duration||SLOT):null}
  });
  const habits=state.habitTemplates.flatMap(habit=>{const override=habitOverride(state,k,habit.id)||{};if(override.hidden)return[];const start=Object.prototype.hasOwnProperty.call(override,"startMinute")?override.startMinute:habit.startMinute;const duration=Object.prototype.hasOwnProperty.call(override,"duration")?override.duration:habit.duration;const item=Object.prototype.hasOwnProperty.call(override,"title")?{...habit,title:override.title}:habit;const timed=start!==null&&start!==undefined&&Number.isFinite(Number(start));return[{kind:"habit",item,timed,time:timed?Number(start):null,duration:+duration||SLOT}]});
  return[...events,...tasks,...habits]
}
function sessionItemsForDay(k){
  if(!state.ui.showSessionsOnTimeline)return[];
  return state.sessions.filter(session=>{
    if(!session.start||!session.end)return false;
    return key(new Date(session.start))===k&&new Date(session.end)>new Date(session.start)
  }).map(session=>{
    const start=new Date(session.start);
    const task=state.tasks.find(item=>item.id===session.taskId);
    const item={...session,groupId:task?.groupId||state.eventGroups[0]?.id||"default"};
    return{kind:"session",item,timed:true,time:start.getHours()*60+start.getMinutes(),duration:Math.max(SLOT,Math.round((new Date(session.end)-start)/60000/SLOT)*SLOT)}
  })
}
function timelineItemsForDay(k,kinds=null){
  const planned=itemsForDay(k).filter(entry=>!kinds||kinds.includes(entry.kind));
  return[...planned,...sessionItemsForDay(k)]
}
function sessionBlockMarkup(entry,date){
  return`<div class="uw-time-entry uw-session-entry" style="top:${((entry.time-START)/SLOT)*SLOT_H+1}px;height:${Math.max(18,(entry.duration/SLOT)*SLOT_H-2)}px;${timedColumnStyle(entry)}" data-context-kind="session" data-context-id="${entry.item.id}" data-date="${date}" title="시간 추적 기록"><span class="uw-session-dot" aria-hidden="true"></span><strong class="uw-item-title">${esc(entry.item.title||"시간 기록")}</strong><small>실제</small></div>`
}
function sessionToggleMarkup(){
  const visible=state.ui.showSessionsOnTimeline;
  return`<button class="uw-session-toggle" data-uw-toggle-sessions type="button" aria-pressed="${visible}">시간 추적 ${visible?"숨기기":"보기"}</button>`
}
function checkMarkup(kind,item,k){
  if(kind==="event")return'<span class="uw-event-dot" aria-hidden="true"></span>';
  const done=itemDoneOn(kind,item,k);
  const color=kind==="task"?"var(--timeline-task-color)":"var(--timeline-habit-color)";
  return`<button class="uw-check${done?" checked":""}" style="--uw-check-color:${color}" data-uw-check="${kind}" data-id="${item.id}" data-date="${k}" type="button">${done?"✓":""}</button>`
}
function itemMarkup(kind,item,k,compact=false){
  const done=itemDoneOn(kind,item,k);
  const time=kind==="event"&&!item.allDay?timeOf(item.start):"";
  const repeat=recurrenceLabel(item);
  return`<div class="uw-item uw-${kind}${done?" done":""}${compact?" compact":""}" style="${groupStyle(item)}" data-uw-kind="${kind}" data-id="${item.id}" data-date="${k}" draggable="false">${checkMarkup(kind,item,k)}<span class="uw-item-title">${esc(item.title)}</span>${repeat?`<span class="uw-repeat-badge">↻ ${repeat}</span>`:""}${time?`<span class="uw-item-time">${time}</span>`:""}<button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button" aria-label="선택"></button></div>`
}
function findAddHost(kind,date,time){const t=time!==null&&time!==undefined?`[data-time="${time}"]`:"";return $(`.uw-list[data-uw-add-kind="${kind}"][data-date="${date||""}"]${t},.uw-all-day-list[data-uw-add-kind="${kind}"][data-date="${date||""}"]${t},.uw-time-hit[data-uw-add-kind="${kind}"][data-date="${date||""}"]${t}`)}
function recurrenceEditorMarkup(old,frequency){
  const recurrence=old?.recurrence||{},interval=Math.max(1,+recurrence.interval||1),weekdays=Array.isArray(recurrence.weekdays)?recurrence.weekdays:[];
  const custom=interval>1||(frequency==="weekly"&&weekdays.length>1);
  const type=frequency==="daily"?"days":frequency==="monthly"?"months":frequency==="weekly"&&interval>1?"weeks":frequency==="weekly"&&weekdays.length>1?"weekdays":"weeks";
  return`<select class="uw-repeat-select" aria-label="반복"><option value="none"${frequency==="none"?" selected":""}>반복 없음</option><option value="daily"${frequency==="daily"&&!custom?" selected":""}>매일</option><option value="weekly"${frequency==="weekly"&&!custom?" selected":""}>매주</option><option value="monthly"${frequency==="monthly"&&!custom?" selected":""}>매월</option><option value="custom"${custom?" selected":""}>사용자 정의</option></select><div class="uw-repeat-custom"${custom?"":" hidden"}><select class="uw-repeat-custom-type" aria-label="사용자 정의 반복 방식"><option value="days"${type==="days"?" selected":""}>일마다</option><option value="weekdays"${type==="weekdays"?" selected":""}>요일마다</option><option value="weeks"${type==="weeks"?" selected":""}>주마다</option><option value="months"${type==="months"?" selected":""}>달마다</option></select><label class="uw-repeat-interval"><input type="number" min="1" max="365" value="${interval}" aria-label="반복 간격"><span class="uw-repeat-unit"></span></label><div class="uw-repeat-weekdays" hidden>${["일","월","화","수","목","금","토"].map((label,day)=>`<label><input type="checkbox" value="${day}"${weekdays.includes(day)?" checked":""}><span>${label}</span></label>`).join("")}</div></div><label class="uw-repeat-until"><span>반복 종료</span><input type="date" value="${recurrence.until||""}" aria-label="반복 종료일"></label>`
}
function wireRecurrenceEditor(form,baseDate){
  const select=$(".uw-repeat-select",form),custom=$(".uw-repeat-custom",form),type=$(".uw-repeat-custom-type",form),interval=$(".uw-repeat-interval",form),weekdays=$(".uw-repeat-weekdays",form),unit=$(".uw-repeat-unit",form);
  if(!select||!custom)return;
  const refresh=()=>{const open=select.value==="custom",mode=type.value;custom.hidden=!open;weekdays.hidden=!open||mode!=="weekdays";interval.hidden=!open||mode==="weekdays";unit.textContent=mode==="days"?"일마다":mode==="weeks"?"주마다":"달마다";if(open&&mode==="weekdays"&&!$("input:checked",weekdays)&&baseDate){const day=fromKey(baseDate).getDay();$(`input[value="${day}"]`,weekdays).checked=true}};
  select.addEventListener("change",refresh);type.addEventListener("change",refresh);refresh()
}
function openInline(host,{kind,date=null,endDate=null,time=null,duration=SLOT,editId=null,withTime=false}={}){
  if(!host||$(".uw-inline-form",host))return;
  const list=kind==="event"?state.events:kind==="habit"?state.habitTemplates:state.tasks;
  const old=editId?list.find(item=>item.id===editId):null;
  const canRepeat=(kind==="event"||kind==="task")&&!!(date||(old&&kind==="event"?key(new Date(old.start)):old?.date));
  const frequency=old?.recurrence?.frequency||"none";
  const displayTitle=old&&kind==="habit"&&date?(habitOverride(state,date,old.id)?.title||old.title):old?.title;
  const form=document.createElement("form");
  form.className="uw-inline-form";
  form.innerHTML=`${withTime?`<input type="time" value="${old&&kind==="event"&&!old.allDay?timeOf(old.start):time!==null?`${pad(Math.floor(time/60))}:${pad(time%60)}`:""}" aria-label="시간">`:""}<input type="text" value="${esc(displayTitle||"")}" placeholder="${kind==="event"?"일정":kind==="habit"?"습관":"할일"} 입력" autocomplete="off">${canRepeat?recurrenceEditorMarkup(old,frequency):""}`;
  const scroll={x:scrollX,y:scrollY},editTarget=editId?host.closest(".uw-item"):null;
  const rangeFirst=date&&endDate&&endDate<date?endDate:date;
  const rangeLast=date&&endDate&&endDate<date?date:endDate;
  const rangeCells=!editId&&rangeFirst&&rangeLast?$$(".uw-month-cell").filter(cell=>cell.dataset.date>=rangeFirst&&cell.dataset.date<=rangeLast):[];
  const clearRange=()=>rangeCells.forEach(cell=>cell.classList.remove("uw-range-editing"));
  if(rangeCells.length){
    rangeCells.forEach(cell=>cell.classList.add("uw-range-editing"));
    form.classList.add("uw-date-range-inline")
  }
  if(!editTarget&&time!==null&&host.matches(".uw-time-hit")){
    form.classList.add("uw-time-inline","uw-time-range-inline");
    form.style.setProperty("--uw-range-height",`${Math.max(SLOT_H,(duration/SLOT)*SLOT_H)}px`)
  }
  if(editTarget){
    if(editTarget.classList.contains("uw-time-entry")){
      form.classList.add("uw-time-inline");
      form.style.top=editTarget.style.top;
      form.style.left=editTarget.style.left||"1px";
      form.style.width=editTarget.style.width||"";
      form.style.right=editTarget.style.width?"auto":editTarget.style.right||"1px";
    }
    editTarget.replaceWith(form)
  }else if(host.matches(".uw-empty-hit"))host.replaceWith(form);
  else host.appendChild(form);
  const title=$("input[type=text]",form);
  const recurrenceBase=date||(old&&kind==="event"?key(new Date(old.start)):old?.date);
  wireRecurrenceEditor(form,recurrenceBase);
  let saving=false,cancelled=false;
  const recurrenceFor=baseDate=>{
    const value=$(".uw-repeat-select",form)?.value||"none";
    if(value==="none"||!baseDate)return null;
    const base=fromKey(baseDate);
    const until=$(".uw-repeat-until input",form)?.value||null;
    if(value!=="custom")return{frequency:value,interval:1,until,...(value==="weekly"?{weekdays:[base.getDay()]}:{}),...(value==="monthly"?{dayOfMonth:base.getDate()}:{})};
    const type=$(".uw-repeat-custom-type",form)?.value||"days",interval=Math.max(1,+$(".uw-repeat-interval input",form)?.value||1);
    if(type==="days")return{frequency:"daily",interval,until};
    if(type==="weekdays"){const selected=$$(".uw-repeat-weekdays input:checked",form).map(input=>+input.value);return{frequency:"weekly",interval:1,weekdays:selected.length?selected:[base.getDay()],until}}
    if(type==="weeks")return{frequency:"weekly",interval,weekdays:[base.getDay()],until};
    return{frequency:"monthly",interval,dayOfMonth:base.getDate(),until}
  };
  const commit=async next=>{
    if(saving)return;
    const value=title.value.trim();
    if(!value){clearRange();form.remove();return}
    saving=true;
    const timeValue=$("input[type=time]",form)?.value||"";
    const habitScope=old&&kind==="habit"?await askHabitScope("change",old,date||todayKey()):null;
    if(old&&kind==="habit"&&!habitScope){saving=false;scheduleRender(0);return}
    await write(current=>{
      const defaultGroup=current.eventGroups[0]?.id||"default";
      if(old){
        const target=(kind==="event"?current.events:kind==="habit"?current.habitTemplates:current.tasks).find(item=>item.id===old.id);
        if(!target)return;
        if(kind==="habit"){
          const editDate=date||todayKey();
          if(habitScope==="day")habitOverride(current,editDate,target.id,true).title=value;
          else{target.title=value;const override=habitOverride(current,editDate,target.id);if(override){delete override.title;cleanHabitOverride(current,editDate,target.id)}}
          return
        }
        target.title=value;
        const baseDate=kind==="event"?key(new Date(target.start)):target.date;
        const recurrence=recurrenceFor(baseDate);
        if(recurrence)target.recurrence=recurrence;else delete target.recurrence;
        if(kind==="event"&&withTime){
          const selectedDate=date||key(new Date(target.start));
          if(timeValue){
            const startDate=new Date(`${selectedDate}T${timeValue}:00`);
            target.start=startDate.toISOString();
            target.end=new Date(startDate.getTime()+duration*60000).toISOString();
            target.allDay=false
          }else{
            target.start=new Date(`${selectedDate}T12:00:00`).toISOString();
            target.end=new Date(`${endDate||selectedDate}T12:00:00`).toISOString();
            target.allDay=true
          }
        }
        return
      }
      if(kind==="event"){
        const startDate=timeValue?new Date(`${date}T${timeValue}:00`):new Date(`${date}T12:00:00`);
        const item={id:uid(),title:value,type:"schedule",groupId:defaultGroup,allDay:!timeValue,start:startDate.toISOString(),end:timeValue?new Date(startDate.getTime()+duration*60000).toISOString():new Date(`${endDate||date}T12:00:00`).toISOString()};
        const recurrence=recurrenceFor(date);
        if(recurrence)item.recurrence=recurrence;
        current.events.push(item)
      }else if(kind==="habit"){
        current.habitTemplates.push({id:uid(),title:value,groupId:defaultGroup})
      }else{
        const task={id:uid(),title:value,date:date||null,done:false,groupId:defaultGroup,createdAt:new Date().toISOString()};
        const recurrence=recurrenceFor(date);
        if(recurrence)task.recurrence=recurrence;
        if(time!==null){
          const startDate=new Date(`${date}T${pad(Math.floor(time/60))}:${pad(time%60)}:00`);
          task.notionStart=startDate.toISOString();
          task.notionEnd=new Date(startDate.getTime()+duration*60000).toISOString();
          current.timeBlocks.push({id:uid(),taskId:task.id,sourceTitle:value,detail:value,date,startMinute:time,duration})
        }
        current.tasks.push(task)
      }
    });
    clearRange();
    if(next)setTimeout(()=>{const nextHost=findAddHost(kind,date,time);if(nextHost)openInline(nextHost,{kind,date,endDate,time,duration,withTime})},220)
  };
  form.addEventListener("submit",event=>{event.preventDefault();commit(true)});
  form.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();cancelled=true;clearRange();form.remove()}});
  form.addEventListener("focusout",()=>setTimeout(()=>{if(!cancelled&&form.isConnected&&!saving&&!form.contains(document.activeElement))commit(false)},120));
  requestAnimationFrame(()=>{try{title.focus({preventScroll:true})}catch{title.focus()}title.select();window.scrollTo(scroll.x,scroll.y)})
}
function allDayPanel(k,items){const shown=items.slice(0,2),hidden=items.slice(2),extra=hidden.length;return`<div class="uw-all-day" data-date="${k}" data-uw-all-day-drop><span class="uw-all-day-label">하루 종일</span><div class="uw-all-day-list" data-uw-add-kind="task" data-date="${k}">${shown.map(x=>itemMarkup(x.kind,x.item,k,true)).join("")||'<div class="uw-empty-hit">＋ 할일</div>'}</div>${extra?`<button class="uw-all-day-more" data-uw-all-day-more type="button" aria-expanded="false">+${extra}개 더보기</button><div class="uw-all-day-popover"><div class="uw-list">${hidden.map(x=>itemMarkup(x.kind,x.item,k,true)).join("")}</div></div>`:""}</div>`}
function flatListMarkup(x,k){return itemMarkup(x.kind,x.item,k).replace(/<span class="uw-item-time">.*?<\/span>/,"")}
function plannerListDay(d){const k=key(d),items=itemsForDay(k);return`<section class="uw-day uw-list-day${k===todayKey()?" uw-today":""}" data-date="${k}"><div class="uw-day-head"><strong>${dayLabel(d)}</strong></div><div class="uw-list uw-flat-day-list" data-uw-add-kind="task" data-date="${k}" data-task-drop-date="${k}">${items.map(x=>flatListMarkup(x,k)).join("")||'<div class="uw-empty-hit">＋ 할일</div>'}</div></section>`}
function plannerDay(d,index=0){const k=key(d),items=timelineItemsForDay(k),untimed=items.filter(x=>!x.timed),timed=layoutTimedItems(items.filter(x=>x.timed&&x.time>=START&&x.time<END));let labels="",hits="";for(let m=START;m<END;m+=SLOT){if(m%60===0)labels+=`<span class="uw-time-label" style="top:${((m-START)/SLOT)*SLOT_H}px">${pad(m/60)}:00</span>`;hits+=`<div class="uw-time-hit" style="top:${((m-START)/SLOT)*SLOT_H}px" data-uw-add-kind="task" data-date="${k}" data-time="${m}"></div>`}const blocks=timed.map(x=>x.kind==="session"?sessionBlockMarkup(x,k):`<div class="uw-time-entry uw-item ${itemDoneOn(x.kind,x.item,k)?"done":""}" style="top:${((x.time-START)/SLOT)*SLOT_H+1}px;height:${Math.max(18,(x.duration/SLOT)*SLOT_H-2)}px;${timedColumnStyle(x)}${groupStyle(x.item)}" data-uw-kind="${x.kind}" data-id="${x.item.id}" data-date="${k}" data-time="${x.time}" data-duration="${x.duration}"><button class="uw-resize-handle top" data-uw-resize="top" type="button"></button>${checkMarkup(x.kind,x.item,k)}<span class="uw-item-title">${esc(x.item.title)}</span><button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button"></button><button class="uw-resize-handle bottom" data-uw-resize="bottom" type="button"></button></div>`).join("");return`<section class="uw-day${k===todayKey()?" uw-today":""}" data-date="${k}"><div class="uw-day-head uw-day-head-with-action"><strong>${dayLabel(d)}</strong>${index===0?sessionToggleMarkup():""}</div>${allDayPanel(k,untimed)}<div class="uw-timeline" style="height:${timelineHeight()}px"><div class="uw-time-labels">${labels}</div><div class="uw-time-lane">${hits}${currentTimeMarkup(k)}${blocks}</div></div></section>`}
function renderPlanner(){const card=$(".home-timeline-card");if(!card)return;$$("[data-uw-home-mode]").forEach(b=>b.classList.toggle("active",b.dataset.uwHomeMode===homeMode));const daySelect=$("[data-uw-home-days-select]");if(daySelect)daySelect.value=String(homeDays);const dayRenderer=homeMode==="timeline"?plannerDay:plannerListDay;card.innerHTML=`<div class="uw-home-planner"><div class="uw-planner-days ${homeMode==="list"?"uw-planner-list-days":""}" style="--uw-days:${homeDays}">${Array.from({length:homeDays},(_,i)=>dayRenderer(addDays(homeCursor,i),i)).join("")}</div></div>`}
function upcomingKeys(){return Array.from({length:7},(_,i)=>key(addDays(fromKey(todayKey()),i+1)))}
function renderUpcoming(){const root=$("#upcomingList");if(!root)return;const dates=upcomingKeys();root.innerHTML=dates.map(k=>{const rows=[...schedules(k).map(item=>({kind:"event",item})),...state.tasks.filter(task=>task.date&&recurrenceOn(task,task.date,k)&&!taskDoneOn(task,k)).map(item=>({kind:"task",item}))];return`<div class="uw-date-group"><div class="uw-date-label"><span>${dayLabel(fromKey(k),true)}</span><button class="uw-icon-btn" data-uw-add-kind="task" data-date="${k}">＋</button></div><div class="uw-list" data-uw-add-kind="task" data-date="${k}">${rows.map(x=>itemMarkup(x.kind,x.item,k)).join("")||'<div class="uw-empty-hit">일정·할일 입력</div>'}</div></div>`}).join("")}
function renderSomeday(){const root=$("#somedayHomeSlot");if(!root)return;const tasks=state.tasks.filter(t=>!t.done&&!t.date);root.innerHTML=`<div class="uw-list uw-someday-list" data-uw-add-kind="task" data-date="" data-uw-someday-drop><button class="uw-someday-add uw-empty-hit" data-uw-add-kind="task" data-date="" type="button">＋ 할일 입력</button>${tasks.map(t=>itemMarkup("task",t,"")).join("")}</div>`}
function renderSideTab(){$$('[data-uw-side-tab]').forEach(button=>{const active=button.dataset.uwSideTab===homeSideTab;button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active))});$$('[data-uw-side-panel]').forEach(panel=>{panel.hidden=panel.dataset.uwSidePanel!==homeSideTab})}
function overdueTasks(source=state){const today=todayKey();return(source?.tasks||[]).filter(task=>!task.done&&task.date&&task.date<today&&!task.recurrence?.frequency).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.title).localeCompare(String(b.title),"ko"))}
function renderOverdue(){const root=$("#overdueTaskBanner");if(!root)return;const tasks=overdueTasks();root.hidden=!tasks.length;if(!tasks.length){root.innerHTML="";overdueExpanded=false;return}const groups=new Map();tasks.forEach(task=>{if(!groups.has(task.date))groups.set(task.date,[]);groups.get(task.date).push(task)});const details=[...groups].map(([date,items])=>`<div class="uw-overdue-date"><strong>${dayLabel(fromKey(date),true)}</strong><span>${items.length}개</span><ul>${items.map(task=>`<li>${esc(task.title)}</li>`).join("")}</ul></div>`).join("");root.innerHTML=`<div class="uw-overdue-row"><strong>지연된 일이 있습니다. 오늘로 옮길까요?</strong><div class="uw-overdue-actions"><button class="soft-btn" data-uw-overdue-view type="button" aria-expanded="${overdueExpanded}">${overdueExpanded?"닫기":"보기"}</button><button class="primary-btn" data-uw-overdue-move type="button">네</button></div></div><div class="uw-overdue-details"${overdueExpanded?"":" hidden"}>${details}</div>`}
function renderHome(){renderPlanner();renderSomeday();renderUpcoming();renderSideTab();renderOverdue()}

function schedules(k){return state.events.filter(e=>eventOnDate(e,k)).sort((a,b)=>new Date(a.start)-new Date(b.start))}
function renderCalendar(){const body=$("#calendarBody");if(!body)return;$("#calendarTypeFilter")?.classList.add("uw-hidden");$("#dayModeSeg")?.classList.add("uw-hidden");const seg=$("#calendarViewSeg");if(seg)seg.innerHTML=`<button data-uw-cal-view="month" class="${calendarView==="month"?"active":""}">월</button><button data-uw-cal-view="week" class="${calendarView==="week"?"active":""}">주</button><button data-uw-cal-view="day" class="${calendarView==="day"?"active":""}">일</button>`;if(calendarView==="month"){const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),first=new Date(y,m,1),start=addDays(first,-first.getDay());$("#calTitle").textContent=`${y}년 ${m+1}월`;body.innerHTML=`<div class="uw-calendar uw-month">${["일","월","화","수","목","금","토"].map(x=>`<div class="uw-dow">${x}</div>`).join("")}${Array.from({length:42},(_,i)=>{const d=addDays(start,i),k=key(d);return`<div class="uw-month-cell${d.getMonth()!==m?" outside":""}" data-uw-add-kind="event" data-date="${k}"><span class="uw-month-num">${d.getDate()}</span><div class="uw-month-events">${schedules(k).slice(0,5).map(e=>itemMarkup("event",e,k,true)).join("")}</div></div>`}).join("")}</div>`;return}if(calendarView==="week"){const start=addDays(calendarCursor,-calendarCursor.getDay()),end=addDays(start,6);$("#calTitle").textContent=`${dayLabel(start)} – ${dayLabel(end)}`;body.innerHTML=`<div class="uw-scroll"><div class="uw-calendar uw-week">${Array.from({length:7},(_,i)=>{const d=addDays(start,i),k=key(d);return`<section class="uw-week-day"><div class="uw-week-label">${dayLabel(d,true)}</div><div class="uw-list" data-uw-add-kind="event" data-date="${k}">${schedules(k).map(e=>itemMarkup("event",e,k)).join("")||'<div class="uw-empty-hit">일정 입력</div>'}</div></section>`}).join("")}</div></div>`;return}const k=key(calendarCursor),rows=schedules(k),all=rows.filter(e=>e.allDay),timed=rows.filter(e=>!e.allDay);$("#calTitle").textContent=dayLabel(calendarCursor,true);body.innerHTML=`<div class="uw-calendar uw-day-list"><section class="uw-day-list-section"><h3>하루 종일</h3><div class="uw-list" data-uw-add-kind="event" data-date="${k}">${all.map(e=>itemMarkup("event",e,k)).join("")||'<div class="uw-empty-hit">일정 입력</div>'}</div></section><section class="uw-day-list-section"><h3>시간 일정</h3><div class="uw-list" data-uw-add-kind="event" data-date="${k}" data-with-time="1">${timed.map(e=>itemMarkup("event",e,k)).join("")||'<div class="uw-empty-hit">시간 일정 입력</div>'}</div></section></div>`}

function scheduleInput(date,compact=false){return`<button class="uw-empty-hit uw-task-inline-add" data-uw-add-kind="event" data-date="${date}" type="button" aria-label="일정 입력">${compact?"＋":"＋ 일정 입력"}</button>`}
function scheduleCalendarTitle(){if(calendarView==="month")return`${calendarCursor.getFullYear()}년 ${calendarCursor.getMonth()+1}월`;if(calendarView==="week"){const start=addDays(calendarCursor,-calendarCursor.getDay());return`${dayLabel(start)} – ${dayLabel(addDays(start,6))}`}return dayLabel(calendarCursor,true)}
function renderScheduleSubnav(){
  const nav=$("#calendarViewSeg");
  if(!nav)return;
  if(schedulePageMode==="list"){nav.innerHTML="";return}
  const month=calendarView==="month";
  const label=month?"월은 보드 보기":scheduleCalendarLayout==="board"?"타임라인으로 보기":"보드로 보기";
  nav.innerHTML=`<div class="uw-task-calendar-tabs"><div class="seg">${[["month","월"],["week","주"],["day","일"]].map(([id,text])=>`<button class="${calendarView===id?"active":""}" data-schedule-cal-view="${id}" type="button">${text}</button>`).join("")}</div><button class="uw-layout-toggle" data-schedule-cal-layout-toggle type="button"${month?' disabled title="월 보기는 보드로 고정돼요"':""}>${label}</button></div>`
}
function scheduleList(){
  const today=todayKey(),dates=new Set([today]);
  state.events.forEach(event=>{const start=key(new Date(event.start));if(start>=today)dates.add(start)});
  for(let offset=0;offset<=90;offset++){
    const date=key(addDays(fromKey(todayKey()),offset));
    if(schedules(date).length)dates.add(date)
  }
  return`<div class="uw-schedule-list">${[...dates].sort().map(date=>`<section class="uw-date-group"><div class="uw-date-label"><span>${dayLabel(fromKey(date),true)}</span></div><div class="uw-list uw-task-main-list" data-uw-add-kind="event" data-date="${date}" data-task-drop-date="${date}">${schedules(date).map(event=>itemMarkup("event",event,date)).join("")}${scheduleInput(date)}</div></section>`).join("")}</div>`
}
function scheduleMonthBoard(){const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),first=new Date(y,m,1),start=addDays(first,-first.getDay());return`<div class="uw-task-month-grid">${["일","월","화","수","목","금","토"].map(x=>`<div class="uw-task-dow">${x}</div>`).join("")}${Array.from({length:42},(_,i)=>{const d=addDays(start,i),date=key(d);return`<section class="uw-task-month-cell uw-month-cell${d.getMonth()!==m?" outside":""}${date===todayKey()?" today":""}" data-uw-add-kind="event" data-date="${date}"><span class="uw-task-day-number">${d.getDate()}</span><div class="uw-list" data-uw-add-kind="event" data-date="${date}" data-task-drop-date="${date}">${schedules(date).map(event=>itemMarkup("event",event,date,true)).join("")}${scheduleInput(date,true)}</div></section>`}).join("")}</div>`}
function scheduleBoardDay(d){const date=key(d);return`<section class="uw-task-board-day${date===todayKey()?" today":""}"><div class="uw-day-head"><strong>${dayLabel(d,true)}</strong></div><div class="uw-list" data-uw-add-kind="event" data-date="${date}" data-task-drop-date="${date}">${schedules(date).map(event=>itemMarkup("event",event,date)).join("")}${scheduleInput(date)}</div></section>`}
function scheduleBoard(){const count=calendarView==="week"?7:1,start=calendarView==="week"?addDays(calendarCursor,-calendarCursor.getDay()):calendarCursor;return`<div class="uw-task-board-grid" style="--uw-task-days:${count}">${Array.from({length:count},(_,i)=>scheduleBoardDay(addDays(start,i))).join("")}</div>`}
function scheduleAllDayPanel(date,items){return`<div class="uw-all-day" data-date="${date}" data-uw-all-day-drop><span class="uw-all-day-label">하루 종일</span><div class="uw-all-day-list" data-uw-add-kind="event" data-date="${date}">${items.map(x=>itemMarkup("event",x.item,date,true)).join("")||`<div class="uw-empty-hit" data-uw-add-kind="event" data-date="${date}">＋ 일정</div>`}</div></div>`}
function scheduleTimelineDay(d,index=0){const date=key(d),items=timelineItemsForDay(date,["event"]),untimed=items.filter(x=>!x.timed),timed=layoutTimedItems(items.filter(x=>x.timed&&x.time>=START&&x.time<END));let labels="",hits="";for(let m=START;m<END;m+=SLOT){if(m%60===0)labels+=`<span class="uw-time-label" style="top:${((m-START)/SLOT)*SLOT_H}px">${pad(m/60)}:00</span>`;hits+=`<div class="uw-time-hit" style="top:${((m-START)/SLOT)*SLOT_H}px" data-uw-add-kind="event" data-with-time="1" data-date="${date}" data-time="${m}"></div>`}const blocks=timed.map(x=>x.kind==="session"?sessionBlockMarkup(x,date):`<div class="uw-time-entry uw-item" style="top:${((x.time-START)/SLOT)*SLOT_H+1}px;height:${Math.max(18,(x.duration/SLOT)*SLOT_H-2)}px;${timedColumnStyle(x)}${groupStyle(x.item)}" data-uw-kind="event" data-id="${x.item.id}" data-date="${date}" data-time="${x.time}" data-duration="${x.duration}"><button class="uw-resize-handle top" data-uw-resize="top" type="button"></button>${checkMarkup("event",x.item,date)}<span class="uw-item-title">${esc(x.item.title)}</span><button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button"></button><button class="uw-resize-handle bottom" data-uw-resize="bottom" type="button"></button></div>`).join("");return`<section class="uw-day${date===todayKey()?" uw-today":""}" data-date="${date}"><div class="uw-day-head uw-day-head-with-action"><strong>${dayLabel(d,true)}</strong>${index===0?sessionToggleMarkup():""}</div>${scheduleAllDayPanel(date,untimed)}<div class="uw-timeline" style="height:${timelineHeight()}px"><div class="uw-time-labels">${labels}</div><div class="uw-time-lane">${hits}${currentTimeMarkup(date)}${blocks}</div></div></section>`}
function scheduleTimeline(){const count=calendarView==="week"?7:1,start=calendarView==="week"?addDays(calendarCursor,-calendarCursor.getDay()):calendarCursor;return`<div class="uw-task-timeline-scroll"><div class="uw-planner-days" style="--uw-days:${count}">${Array.from({length:count},(_,i)=>scheduleTimelineDay(addDays(start,i),i)).join("")}</div></div>`}
function renderSchedulePage(){const body=$("#calendarBody"),nav=$("#scheduleCalendarNav");if(!body)return;$$('[data-uw-schedule-mode]').forEach(button=>button.classList.toggle("active",button.dataset.uwScheduleMode===schedulePageMode));renderScheduleSubnav();if(schedulePageMode==="list"){nav.hidden=true;body.innerHTML=scheduleList();return}nav.hidden=false;$("#calTitle").textContent=scheduleCalendarTitle();const layout=calendarView==="month"?"board":scheduleCalendarLayout;body.innerHTML=calendarView==="month"?scheduleMonthBoard():layout==="timeline"?scheduleTimeline():scheduleBoard()}
function wireScheduleViewControls(){
  document.addEventListener("click",e=>{
    const mode=e.target.closest("[data-uw-schedule-mode]"),view=e.target.closest("[data-schedule-cal-view]"),layout=e.target.closest("[data-schedule-cal-layout-toggle]"),prev=e.target.closest("#calPrev"),today=e.target.closest("#calToday"),next=e.target.closest("#calNext");
    if(!mode&&!view&&!layout&&!prev&&!today&&!next)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(mode)schedulePageMode=mode.dataset.uwScheduleMode;
    if(view)calendarView=view.dataset.scheduleCalView;
    if(layout&&!layout.disabled)scheduleCalendarLayout=scheduleCalendarLayout==="board"?"timeline":"board";
    if(prev)calendarCursor=calendarView==="month"?new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1):addDays(calendarCursor,calendarView==="week"?-7:-1);
    if(next)calendarCursor=calendarView==="month"?new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1):addDays(calendarCursor,calendarView==="week"?7:1);
    if(today)calendarCursor=fromKey(todayKey());
    renderSchedulePage()
  },true)
}

function visibleTasks(tab){
  const today=todayKey(),tomorrow=key(addDays(fromKey(today),1));
  const rows=[];
  for(const task of state.tasks){
    if(tab==="done"){
      if(!task.recurrence?.frequency&&task.done)rows.push(task);
      continue
    }
    if(tab==="someday"){
      if(!task.done&&!task.date)rows.push(task);
      continue
    }
    if(tab==="today"){
      if(task.date&&recurrenceOn(task,task.date,today)&&!taskDoneOn(task,today))rows.push({...task,_occurrenceDate:today});
      continue
    }
    if(tab==="upcoming"){
      if(task.recurrence?.frequency){
        const next=nextOccurrence(task,tomorrow);
        if(next)rows.push({...task,_occurrenceDate:next})
      }else if(!task.done&&task.date&&task.date>today)rows.push(task);
      continue
    }
    if(!task.done)rows.push(task)
  }
  return rows.sort((a,b)=>+taskDoneOn(a,a._occurrenceDate||a.date)-+taskDoneOn(b,b._occurrenceDate||b.date)||String(a._occurrenceDate||a.date||"9999").localeCompare(String(b._occurrenceDate||b.date||"9999"))||String(a.title).localeCompare(String(b.title),"ko"))
}
function renderTasks(){renderTasksV2()}

function taskRowsForDate(k){return state.tasks.filter(task=>task.date&&recurrenceOn(task,task.date,k)).sort((a,b)=>+taskDoneOn(a,k)-+taskDoneOn(b,k)||String(a.notionStart||"").localeCompare(String(b.notionStart||""))||String(a.title).localeCompare(String(b.title),"ko"))}
function taskListMarkup(tasks,k,compact=false){return tasks.map(task=>itemMarkup("task",task,task._occurrenceDate||task.date||k,compact)).join("")}
function taskListInput(date,compact=false){return`<button class="uw-empty-hit uw-task-inline-add" data-uw-add-kind="task" data-date="${date||""}" type="button" aria-label="할일 입력">${compact?"＋":"＋ 할일 입력"}</button>`}
function taskCalendarTitle(){if(taskCalendarView==="month")return`${taskCalendarCursor.getFullYear()}년 ${taskCalendarCursor.getMonth()+1}월`;if(taskCalendarView==="week"){const start=addDays(taskCalendarCursor,-taskCalendarCursor.getDay());return`${dayLabel(start)} – ${dayLabel(addDays(start,6))}`}return dayLabel(taskCalendarCursor,true)}
function taskCalendarNav(){return`<div class="uw-task-calendar-nav"><button class="uw-icon-btn" data-task-cal-prev type="button" aria-label="이전 기간">‹</button><strong>${taskCalendarTitle()}</strong><div><button class="uw-task-today" data-task-cal-today type="button">오늘</button><button class="uw-icon-btn" data-task-cal-next type="button" aria-label="다음 기간">›</button></div></div>`}
function taskMonthBoard(){const y=taskCalendarCursor.getFullYear(),m=taskCalendarCursor.getMonth(),first=new Date(y,m,1),start=addDays(first,-first.getDay());return`<div class="uw-task-month-grid">${["일","월","화","수","목","금","토"].map(x=>`<div class="uw-task-dow">${x}</div>`).join("")}${Array.from({length:42},(_,i)=>{const d=addDays(start,i),k=key(d),tasks=taskRowsForDate(k);return`<section class="uw-task-month-cell${d.getMonth()!==m?" outside":""}${k===todayKey()?" today":""}"><span class="uw-task-day-number">${d.getDate()}</span><div class="uw-list" data-uw-add-kind="task" data-date="${k}" data-task-drop-date="${k}">${taskListMarkup(tasks,k,true)}${taskListInput(k,true)}</div></section>`}).join("")}</div>`}
function taskBoardDay(d){const k=key(d),tasks=taskRowsForDate(k);return`<section class="uw-task-board-day${k===todayKey()?" today":""}"><div class="uw-day-head"><strong>${dayLabel(d,true)}</strong></div><div class="uw-list" data-uw-add-kind="task" data-date="${k}" data-task-drop-date="${k}">${taskListMarkup(tasks,k)}${taskListInput(k)}</div></section>`}
function taskBoard(){const count=taskCalendarView==="week"?7:1,start=taskCalendarView==="week"?addDays(taskCalendarCursor,-taskCalendarCursor.getDay()):taskCalendarCursor;return`<div class="uw-task-board-grid" style="--uw-task-days:${count}">${Array.from({length:count},(_,i)=>taskBoardDay(addDays(start,i))).join("")}</div>`}
function taskTimelineDay(d,index=0){const k=key(d),items=timelineItemsForDay(k,["task"]),untimed=items.filter(x=>!x.timed),timed=layoutTimedItems(items.filter(x=>x.timed&&x.time>=START&&x.time<END));let labels="",hits="";for(let m=START;m<END;m+=SLOT){if(m%60===0)labels+=`<span class="uw-time-label" style="top:${((m-START)/SLOT)*SLOT_H}px">${pad(m/60)}:00</span>`;hits+=`<div class="uw-time-hit" style="top:${((m-START)/SLOT)*SLOT_H}px" data-uw-add-kind="task" data-date="${k}" data-time="${m}"></div>`}const blocks=timed.map(x=>x.kind==="session"?sessionBlockMarkup(x,k):`<div class="uw-time-entry uw-item ${taskDoneOn(x.item,k)?"done":""}" style="top:${((x.time-START)/SLOT)*SLOT_H+1}px;height:${Math.max(18,(x.duration/SLOT)*SLOT_H-2)}px;${timedColumnStyle(x)}${groupStyle(x.item)}" data-uw-kind="task" data-id="${x.item.id}" data-date="${k}" data-time="${x.time}" data-duration="${x.duration}"><button class="uw-resize-handle top" data-uw-resize="top" type="button"></button>${checkMarkup("task",x.item,k)}<span class="uw-item-title">${esc(x.item.title)}</span><button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button"></button><button class="uw-resize-handle bottom" data-uw-resize="bottom" type="button"></button></div>`).join("");return`<section class="uw-day${k===todayKey()?" uw-today":""}" data-date="${k}"><div class="uw-day-head uw-day-head-with-action"><strong>${dayLabel(d,true)}</strong>${index===0?sessionToggleMarkup():""}</div>${allDayPanel(k,untimed)}<div class="uw-timeline" style="height:${timelineHeight()}px"><div class="uw-time-labels">${labels}</div><div class="uw-time-lane">${hits}${currentTimeMarkup(k)}${blocks}</div></div></section>`}
function taskTimeline(){const count=taskCalendarView==="week"?7:1,start=taskCalendarView==="week"?addDays(taskCalendarCursor,-taskCalendarCursor.getDay()):taskCalendarCursor;return`<div class="uw-task-timeline-scroll"><div class="uw-planner-days" style="--uw-days:${count}">${Array.from({length:count},(_,i)=>taskTimelineDay(addDays(start,i),i)).join("")}</div></div>`}
function renderTaskSubnav(){
  const nav=$("#taskPageTabs");
  if(!nav)return;
  if(taskPageMode==="list"){
    nav.innerHTML=`<div class="uw-task-list-tabs"><div class="seg">${[["all","전체"],["today","오늘"],["upcoming","예정"],["someday","언젠가"],["done","완료"]].map(([id,label])=>`<button class="${taskListTab===id?"active":""}" data-task-tab="${id}" type="button">${label}</button>`).join("")}</div></div>`;
    return
  }
  const month=taskCalendarView==="month";
  const label=month?"월은 보드 보기":taskCalendarLayout==="board"?"타임라인으로 보기":"보드로 보기";
  nav.innerHTML=`<div class="uw-task-calendar-tabs"><div class="seg">${[["month","월"],["week","주"],["day","일"]].map(([id,text])=>`<button class="${taskCalendarView===id?"active":""}" data-task-cal-view="${id}" type="button">${text}</button>`).join("")}</div><button class="uw-layout-toggle" data-task-cal-layout-toggle type="button"${month?' disabled title="월 보기는 보드로 고정돼요"':""}>${label}</button></div>`
}
function renderTasksV2(){
  const root=$("#tasksPageList");
  if(!root)return;
  $$('[data-uw-task-mode]').forEach(button=>button.classList.toggle("active",button.dataset.uwTaskMode===taskPageMode));
  renderTaskSubnav();
  if(taskPageMode==="list"){
    const rows=visibleTasks(taskListTab);
    const groupedTabs=["all","today","upcoming","someday"];
    if(groupedTabs.includes(taskListTab)){
      const date=taskListTab==="today"?todayKey():"";
      const canAdd=["all","today","someday"].includes(taskListTab);
      const grouped=state.eventGroups.map((groupInfo,index)=>({groupInfo,index,rows:rows.filter(task=>group(task).id===groupInfo.id)})).filter(entry=>entry.rows.length||(canAdd&&entry.index===0));
      root.innerHTML=grouped.length?`<div class="uw-task-grouped-list">${grouped.map(({groupInfo,index,rows:groupRows})=>`<section class="uw-task-group-section" style="--uw-group:${groupInfo.color}"><div class="uw-task-group-heading"><span class="uw-task-group-dot"></span><strong>${esc(groupInfo.name)}</strong><span>${groupRows.length}</span></div><div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="${date}"${taskListTab==="someday"?" data-uw-someday-drop":""}>${taskListMarkup(groupRows,date)}${canAdd&&index===0?taskListInput(date):""}</div></section>`).join("")}</div>`:'<div class="empty">표시할 할일이 없어요.</div>';
      return
    }
    root.innerHTML=`<div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="">${taskListMarkup(rows,"")}${!rows.length?'<div class="empty">완료한 할일이 없어요.</div>':""}</div>`;
    return
  }
  const layout=taskCalendarView==="month"?"board":taskCalendarLayout;
  root.innerHTML=`<section class="uw-task-calendar-shell">${taskCalendarNav()}${taskCalendarView==="month"?taskMonthBoard():layout==="timeline"?taskTimeline():taskBoard()}</section>`
}
function wireTaskViewControls(){
  document.addEventListener("click",e=>{
    const mode=e.target.closest("[data-uw-task-mode]");
    const tab=e.target.closest("#taskPageTabs [data-task-tab]");
    const view=e.target.closest("[data-task-cal-view]");
    const layout=e.target.closest("[data-task-cal-layout-toggle]");
    const prev=e.target.closest("[data-task-cal-prev]");
    const today=e.target.closest("[data-task-cal-today]");
    const next=e.target.closest("[data-task-cal-next]");
    if(!mode&&!tab&&!view&&!layout&&!prev&&!today&&!next)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(mode)taskPageMode=mode.dataset.uwTaskMode;
    if(tab)taskListTab=tab.dataset.taskTab;
    if(view)taskCalendarView=view.dataset.taskCalView;
    if(layout&&!layout.disabled)taskCalendarLayout=taskCalendarLayout==="board"?"timeline":"board";
    if(prev)taskCalendarCursor=taskCalendarView==="month"?new Date(taskCalendarCursor.getFullYear(),taskCalendarCursor.getMonth()-1,1):addDays(taskCalendarCursor,taskCalendarView==="week"?-7:-1);
    if(next)taskCalendarCursor=taskCalendarView==="month"?new Date(taskCalendarCursor.getFullYear(),taskCalendarCursor.getMonth()+1,1):addDays(taskCalendarCursor,taskCalendarView==="week"?7:1);
    if(today)taskCalendarCursor=fromKey(todayKey());
    renderTasksV2()
  },true)
}
function renderHabits(){
  const root=$("#habitHistory");
  if(!root)return;
  const start=addDays(habitCursor,-habitCursor.getDay());
  const days=Array.from({length:7},(_,i)=>addDays(start,i));
  const ordered=[...state.habitTemplates].sort((a,b)=>{
    const at=Number.isFinite(+a.startMinute)?+a.startMinute:Infinity;
    const bt=Number.isFinite(+b.startMinute)?+b.startMinute:Infinity;
    return at-bt||String(a.title).localeCompare(String(b.title),"ko")
  });
  const byGroup=state.eventGroups.map(group=>({group,items:ordered.filter(h=>(h.groupId||state.eventGroups[0].id)===group.id)})).filter(x=>x.items.length);
  const options=state.eventGroups.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join("");
  const groupRows=byGroup.map(({group,items})=>`<div class="uw-habit-group-title" style="--uw-group:${group.color}"><span></span>${esc(group.name)}</div>${items.map(h=>`<div class="uw-habit-week-row"><div class="uw-habit-name uw-item" data-uw-kind="habit" data-id="${h.id}" data-date="${todayKey()}"><span class="uw-habit-title">${esc(h.title)}</span><small>${Number.isFinite(+h.startMinute)?`${pad(Math.floor(+h.startMinute/60))}:${pad(+h.startMinute%60)}`:"시간 없음"}</small></div>${days.map(day=>{const date=key(day),done=!!state.habitDays[date]?.[h.id];return`<button class="uw-habit-day-check${done?" checked":""}" data-uw-habit-check="${h.id}" data-date="${date}" type="button" aria-label="${dayLabel(day)} ${done?"완료 취소":"완료"}">${done?"✓":""}</button>`}).join("")}</div>`).join("")}`).join("");
  root.innerHTML=`<section class="uw-habit-week"><div class="uw-habit-week-toolbar"><div><h3>습관</h3><small>${dayLabel(start)} – ${dayLabel(addDays(start,6))}</small></div><div><button class="uw-icon-btn" data-uw-habit-prev type="button" aria-label="이전 주">‹</button><button class="uw-icon-btn" data-uw-habit-today type="button">오늘</button><button class="uw-icon-btn" data-uw-habit-next type="button" aria-label="다음 주">›</button></div></div><div class="uw-scroll"><div class="uw-habit-week-grid"><div class="uw-habit-grid-head">습관</div>${days.map(day=>`<div class="uw-habit-grid-day${key(day)===todayKey()?" today":""}"><strong>${["일","월","화","수","목","금","토"][day.getDay()]}</strong><small>${day.getMonth()+1}/${day.getDate()}</small></div>`).join("")}${groupRows||'<div class="empty uw-habit-empty">아직 습관이 없어요. 위에서 새 습관을 추가해 보세요.</div>'}</div></div></section>`;
  const select=$("#habitPageGroup");
  if(select){
    const value=select.value||state.eventGroups[0]?.id;
    select.innerHTML=options;
    select.value=state.eventGroups.some(g=>g.id===value)?value:state.eventGroups[0]?.id
  }
}
function installActionUI(){if($("#uwSelectionBar"))return;document.body.insertAdjacentHTML("beforeend",'<div class="uw-selection-bar" id="uwSelectionBar"><button data-uw-action="edit">수정</button><button data-uw-action="duplicate">복제</button><button data-uw-action="group">그룹</button><button data-uw-action="convert">전환</button><button class="danger" data-uw-action="delete">삭제</button><button data-uw-action="cancel">취소</button></div><div class="uw-context" id="uwContext"></div><dialog class="app-dialog uw-habit-scope-dialog" id="uwHabitScopeDialog"><div class="uw-scope-body"><h3 id="uwHabitScopeTitle">습관 변경</h3><p id="uwHabitScopeMessage"></p><div class="dialog-actions"><button class="soft-btn" data-uw-habit-scope="cancel" type="button">취소</button><button class="soft-btn" data-uw-habit-scope="day" type="button">이 날만</button><button class="primary-btn" data-uw-habit-scope="all" type="button">전체 반복</button></div></div></dialog>')}
function askHabitScope(mode,habit,date){const dialog=$("#uwHabitScopeDialog");if(!dialog)return Promise.resolve(null);$("#uwHabitScopeTitle").textContent=mode==="delete"?"습관 삭제":"습관 변경";$("#uwHabitScopeMessage").textContent=mode==="delete"?`${dayLabel(fromKey(date),true)}의 ‘${habit?.title||"습관"}’을 어떻게 삭제할까요?`:`${dayLabel(fromKey(date),true)}의 ‘${habit?.title||"습관"}’ 변경 범위를 선택해 주세요.`;const dayButton=dialog.querySelector('[data-uw-habit-scope="day"]'),allButton=dialog.querySelector('[data-uw-habit-scope="all"]');dayButton.textContent=mode==="delete"?"이 날만 숨기기":"이 날만 변경";allButton.textContent=mode==="delete"?"습관 전체 삭제":"전체 반복 변경";dialog.showModal();return new Promise(resolve=>{habitScopeResolve=resolve})}
function askTaskScope(task,date){const dialog=$("#uwHabitScopeDialog");if(!dialog)return Promise.resolve(null);$("#uwHabitScopeTitle").textContent="반복 할일 변경";$("#uwHabitScopeMessage").textContent=`${dayLabel(fromKey(date),true)}의 ‘${task?.title||"할일"}’ 시간을 어떻게 변경할까요?`;const dayButton=dialog.querySelector('[data-uw-habit-scope="day"]'),allButton=dialog.querySelector('[data-uw-habit-scope="all"]');dayButton.textContent="이 할일만 변경";allButton.textContent="전체 반복 변경";dialog.showModal();return new Promise(resolve=>{habitScopeResolve=resolve})}
function wireHabitScopeDialog(){const dialog=$("#uwHabitScopeDialog");if(!dialog||dialog.dataset.uwBound)return;dialog.dataset.uwBound="1";dialog.addEventListener("click",event=>{const button=event.target.closest("[data-uw-habit-scope]");if(!button)return;const value=button.dataset.uwHabitScope;dialog.close();const resolve=habitScopeResolve;habitScopeResolve=null;resolve?.(value==="cancel"?null:value)});dialog.addEventListener("cancel",event=>{event.preventDefault();dialog.close();const resolve=habitScopeResolve;habitScopeResolve=null;resolve?.(null)})}
function coarse(){return matchMedia("(hover:none),(pointer:coarse)").matches}
function toggleSelection(item){const token=`${item.dataset.uwKind}:${item.dataset.id}:${item.dataset.date||""}`;if(selected.has(token)){selected.delete(token);item.classList.remove("selected")}else{selected.set(token,{kind:item.dataset.uwKind,id:item.dataset.id,date:item.dataset.date||null});item.classList.add("selected")}document.body.classList.toggle("uw-selection-active",selected.size>0);$("#uwSelectionBar")?.classList.toggle("open",selected.size>0)}
function clearSelection(){selected.clear();document.body.classList.remove("uw-selection-active");$("#uwSelectionBar")?.classList.remove("open");$$('.uw-item.selected').forEach(x=>x.classList.remove("selected"))}
function showGroupPicker(records){pendingGroupRecords=records;const menu=$("#uwContext");menu.innerHTML=`<strong style="padding:7px 9px;font-size:11px">그룹 선택</strong>${state.eventGroups.map(g=>`<button data-uw-group-id="${g.id}"><span style="display:inline-block;width:9px;height:9px;margin-right:7px;border-radius:50%;background:${g.color}"></span>${esc(g.name)}</button>`).join("")}`;menu.style.left="auto";menu.style.right="14px";menu.style.top="auto";menu.style.bottom="64px";menu.classList.add("open")}
async function action(name,records=[...selected.values()]){
  if(name==="cancel"){clearSelection();return}
  if(name==="edit"&&records.length===1){const r=records[0],el=$(`.uw-item[data-uw-kind="${r.kind}"][data-id="${CSS.escape(r.id)}"]`);clearSelection();if(el)openInline(el,{kind:r.kind,date:r.date,editId:r.id,withTime:r.kind==="event"&&calendarView==="day"});return}
  if(name==="group"){showGroupPicker(records);return}
  if(name==="delete"){
    const habitRecords=records.filter(record=>record.kind==="habit"),otherRecords=records.filter(record=>record.kind!=="habit"),decisions=[];
    for(const record of habitRecords){const habit=state.habitTemplates.find(item=>item.id===record.id);if(!habit)continue;const scope=await askHabitScope("delete",habit,record.date||todayKey());if(scope)decisions.push({...record,date:record.date||todayKey(),scope})}
    if(decisions.length)await write(current=>decisions.forEach(record=>{if(record.scope==="day"){habitOverride(current,record.date,record.id,true).hidden=true;return}current.habitTemplates=current.habitTemplates.filter(item=>item.id!==record.id);Object.values(current.habitDays).forEach(day=>delete day[record.id]);Object.values(current.habitOverrides||{}).forEach(day=>delete day[record.id])}));
    records=otherRecords;
    if(!records.length){clearSelection();return}
  }
  if(name==="duplicate"){await write(current=>records.forEach(record=>{const list=record.kind==="event"?current.events:record.kind==="habit"?current.habitTemplates:current.tasks;const item=list.find(value=>value.id===record.id);if(item)list.push({...item,id:uid(),title:`${item.title} 복사`,done:false,completedAt:null})}))}
  else if(name==="convert"){await write(current=>records.forEach(record=>{if(record.kind==="task"){const task=current.tasks.find(item=>item.id===record.id);if(!task)return;const date=task.date||todayKey();current.events.push({id:uid(),title:task.title,type:"schedule",groupId:task.groupId,allDay:!task.notionStart,start:task.notionStart||new Date(`${date}T12:00:00`).toISOString(),end:task.notionEnd||new Date(`${date}T12:00:00`).toISOString(),...(task.recurrence?{recurrence:{...task.recurrence}}:{})});current.tasks=current.tasks.filter(item=>item.id!==record.id);current.timeBlocks=current.timeBlocks.filter(item=>item.taskId!==record.id)}else if(record.kind==="event"){const event=current.events.find(item=>item.id===record.id);if(!event)return;current.tasks.push({id:uid(),title:event.title,date:key(new Date(event.start)),done:false,groupId:event.groupId,...(!event.allDay?{notionStart:event.start,notionEnd:event.end}:{}),...(event.recurrence?{recurrence:{...event.recurrence}}:{})});current.events=current.events.filter(item=>item.id!==record.id)}}))}
  else if(name==="delete"){await write(current=>records.forEach(record=>{if(record.kind==="event")current.events=current.events.filter(item=>item.id!==record.id);if(record.kind==="task"){current.tasks=current.tasks.filter(item=>item.id!==record.id);current.timeBlocks=current.timeBlocks.filter(item=>item.taskId!==record.id);Object.values(current.taskOverrides||{}).forEach(day=>delete day[record.id])}}))}
  clearSelection()
}

function setSomedayOpen(open){homeSideTab=open?"someday":"upcoming";renderSideTab()}

function wireClicks(){installActionUI();wireHabitScopeDialog();document.addEventListener("click",async e=>{if(Date.now()<suppressItemClickUntil){e.preventDefault();e.stopImmediatePropagation();return}const somedayToggle=e.target.closest("[data-uw-someday-toggle]");if(somedayToggle){setSomedayOpen(!document.body.classList.contains("uw-someday-open"));return}if(e.target.closest("[data-uw-someday-close]")){setSomedayOpen(false);return}const sessionToggle=e.target.closest("[data-uw-toggle-sessions]");if(sessionToggle){await write(current=>{current.ui||={};current.ui.showSessionsOnTimeline=current.ui.showSessionsOnTimeline===false});return}$$(".uw-all-day.open").forEach(x=>{if(!e.target.closest(".uw-all-day"))x.classList.remove("open")});const more=e.target.closest("[data-uw-all-day-more]");if(more){const panel=more.closest(".uw-all-day"),open=!panel.classList.contains("open");$$(".uw-all-day.open").forEach(x=>x.classList.remove("open"));panel.classList.toggle("open",open);more.setAttribute("aria-expanded",String(open));return}const groupButton=e.target.closest("[data-uw-group-id]");if(groupButton){const records=[...pendingGroupRecords],groupId=groupButton.dataset.uwGroupId;pendingGroupRecords=[];$("#uwContext")?.classList.remove("open");await write(s=>records.forEach(r=>{const arr=r.kind==="event"?s.events:r.kind==="habit"?s.habitTemplates:s.tasks;const x=arr.find(v=>v.id===r.id);if(x)x.groupId=groupId}));clearSelection();return}const tab=e.target.closest("#taskPageTabs [data-task-tab]");if(tab){e.stopImmediatePropagation();taskListTab=tab.dataset.taskTab;$('#taskPageTabs [data-task-tab]').forEach(x=>x.classList.toggle("active",x===tab));renderTasks();return}const a=e.target.closest("[data-uw-action]");if(a){await action(a.dataset.uwAction);return}const homeModeButton=e.target.closest("[data-uw-home-mode]");if(homeModeButton){homeMode=homeModeButton.dataset.uwHomeMode;renderPlanner();return}if(e.target.closest("[data-uw-home-prev]")){homeCursor=addDays(homeCursor,-homeDays);renderPlanner();return}if(e.target.closest("[data-uw-home-next]")){homeCursor=addDays(homeCursor,homeDays);renderPlanner();return}if(e.target.closest("[data-uw-home-today]")){homeCursor=fromKey(todayKey());renderPlanner();return}const cv=e.target.closest("[data-uw-cal-view]");if(cv){e.stopImmediatePropagation();calendarView=cv.dataset.uwCalView;renderCalendar();return}if(e.target.closest("[data-uw-habit-prev]")){habitCursor=addDays(habitCursor,-7);renderHabits();return}
if(e.target.closest("[data-uw-habit-next]")){habitCursor=addDays(habitCursor,7);renderHabits();return}
if(e.target.closest("[data-uw-habit-today]")){habitCursor=fromKey(todayKey());renderHabits();return}
const hc=e.target.closest("[data-uw-habit-check]");if(hc){await write(s=>{s.habitDays[hc.dataset.date]||={};s.habitDays[hc.dataset.date][hc.dataset.uwHabitCheck]=!s.habitDays[hc.dataset.date][hc.dataset.uwHabitCheck]});return}const check=e.target.closest("[data-uw-check]");if(check){e.stopPropagation();await write(s=>{if(check.dataset.uwCheck==="task"){const t=s.tasks.find(x=>x.id===check.dataset.id);if(t){if(t.recurrence?.frequency){t.recurrenceDone||={};t.recurrenceDone[check.dataset.date]=!t.recurrenceDone[check.dataset.date]}else{t.done=!t.done;t.completedAt=t.done?new Date().toISOString():null}}}else{s.habitDays[check.dataset.date]||={};s.habitDays[check.dataset.date][check.dataset.id]=!s.habitDays[check.dataset.date][check.dataset.id]}});return}const del=e.target.closest("[data-uw-delete-habit]");if(del){await action("delete",[{kind:"habit",id:del.dataset.uwDeleteHabit,date:todayKey()}]);return}const dup=e.target.closest("[data-uw-duplicate-habit]");if(dup){await action("duplicate",[{kind:"habit",id:dup.dataset.uwDuplicateHabit,date:todayKey()}]);return}const item=e.target.closest(".uw-item[data-uw-kind]");if(item){if(Date.now()<suppressItemClickUntil)return;if(coarse()){toggleSelection(item);return}if(!e.target.closest(".uw-item-title,.uw-habit-title"))return;openInline(item,{kind:item.dataset.uwKind,date:item.dataset.date,editId:item.dataset.id,withTime:item.dataset.uwKind==="event"&&calendarView==="day"});return}const add=e.target.closest("[data-uw-add-kind]");if(add&&!e.target.closest(".uw-item,.uw-inline-form")){const kind=add.dataset.uwAddKind,date=add.dataset.date||null,time=add.dataset.time?+add.dataset.time:null;const empty=e.target.closest(".uw-empty-hit"),target=empty||(add.matches(".uw-list,.uw-all-day-list,.uw-time-hit,.uw-month-cell")?add:findAddHost(kind,date,time)||add.parentElement);openInline(target,{kind,date,time,withTime:add.dataset.withTime==="1"||target.dataset.withTime==="1"})}},true);
document.addEventListener("contextmenu",e=>{const item=e.target.closest(".uw-item[data-uw-kind]");if(!item)return;e.preventDefault();const menu=$("#uwContext");menu.innerHTML='<button data-c="duplicate">복제</button><button data-c="group">그룹</button>'+(item.dataset.uwKind!=="habit"?'<button data-c="convert">할일·일정 전환</button>':'')+'<button class="danger" data-c="delete">삭제</button>';menu.style.left=`${Math.min(innerWidth-170,e.clientX)}px`;menu.style.top=`${Math.min(innerHeight-190,e.clientY)}px`;menu.classList.add("open");menu.onclick=async ev=>{const b=ev.target.closest("[data-c]");if(!b)return;menu.classList.remove("open");await action(b.dataset.c,[{kind:item.dataset.uwKind,id:item.dataset.id,date:item.dataset.date}])}});document.addEventListener("pointerdown",e=>{if(!e.target.closest("#uwContext"))$("#uwContext")?.classList.remove("open")})
}

function minuteAt(lane,clientY){const rect=lane.getBoundingClientRect();return Math.max(START,Math.min(END-SLOT,START+Math.floor((clientY-rect.top)/SLOT_H)*SLOT))}
function dateTargetAt(x,y){return document.elementFromPoint(x,y)?.closest("[data-date],[data-task-drop-date]")}
async function saveTimedChange(kind,id,date,startMinute,duration){
  if(kind==="habit"){
    const habit=state?.habitTemplates.find(item=>item.id===id),scope=await askHabitScope("change",habit,date);
    if(!habit||!scope)return;
    await write(current=>{const target=current.habitTemplates.find(item=>item.id===id);if(!target)return;if(scope==="day"){const override=habitOverride(current,date,id,true);override.startMinute=startMinute;override.duration=duration}else{target.startMinute=startMinute;target.duration=duration;const override=habitOverride(current,date,id);if(override){delete override.startMinute;delete override.duration;cleanHabitOverride(current,date,id)}}});
    return
  }
  if(kind==="task"){
    const task=state?.tasks.find(item=>item.id===id);
    if(!task)return;
    if(task.recurrence?.frequency){
      const scope=await askTaskScope(task,date);
      if(!scope)return;
      await write(current=>{
        const target=current.tasks.find(item=>item.id===id);
        if(!target)return;
        if(scope==="day"){
          const override=taskOverride(current,date,id,true);
          override.startMinute=startMinute;
          override.duration=duration;
          current.timeBlocks=current.timeBlocks.filter(item=>!(item.taskId===id&&item.date===date));
          current.timeBlocks.push({id:uid(),taskId:id,sourceTitle:target.title,detail:target.title,date,startMinute,duration});
          return
        }
        const baseDate=target.date||date;
        const start=new Date(`${baseDate}T${pad(Math.floor(startMinute/60))}:${pad(startMinute%60)}:00`);
        target.notionStart=start.toISOString();
        target.notionEnd=new Date(start.getTime()+duration*60000).toISOString();
        current.timeBlocks=current.timeBlocks.filter(item=>item.taskId!==id);
        current.timeBlocks.push({id:uid(),taskId:id,sourceTitle:target.title,detail:target.title,date:baseDate,startMinute,duration});
        clearTaskTimingOverrides(current,id)
      });
      return
    }
    await write(current=>{const target=current.tasks.find(item=>item.id===id);if(!target)return;const start=new Date(`${date}T${pad(Math.floor(startMinute/60))}:${pad(startMinute%60)}:00`);target.date=date;target.notionStart=start.toISOString();target.notionEnd=new Date(start.getTime()+duration*60000).toISOString();current.timeBlocks=current.timeBlocks.filter(item=>item.taskId!==id);current.timeBlocks.push({id:uid(),taskId:id,sourceTitle:target.title,detail:target.title,date,startMinute,duration})});
    return
  }
  await write(current=>{const start=new Date(`${date}T${pad(Math.floor(startMinute/60))}:${pad(startMinute%60)}:00`);const event=current.events.find(item=>item.id===id);if(!event)return;event.start=start.toISOString();event.end=new Date(start.getTime()+duration*60000).toISOString();event.allDay=false})
}
async function saveDateMove(kind,id,date){await write(s=>{if(kind==="habit")return;if(kind==="task"){const t=s.tasks.find(x=>x.id===id);if(!t)return;t.date=date||null;delete t.notionStart;delete t.notionEnd;s.timeBlocks=s.timeBlocks.filter(x=>x.taskId!==id);return}const e=s.events.find(x=>x.id===id);if(!e)return;const oldStart=new Date(e.start),oldEnd=new Date(e.end||e.start),duration=Math.max(0,oldEnd-oldStart),clock=e.allDay?"12:00:00":`${pad(oldStart.getHours())}:${pad(oldStart.getMinutes())}:00`;const start=new Date(`${date}T${clock}`);e.start=start.toISOString();e.end=new Date(start.getTime()+duration).toISOString()})}
function wireSideTabs(){document.addEventListener("click",event=>{const button=event.target.closest("[data-uw-side-tab]");if(!button)return;homeSideTab=button.dataset.uwSideTab;renderSideTab()})}
function wireControls(){let gesture=null;
const clearGesture=(g,restore=true)=>{clearTimeout(g?.timer);g?.preview?.remove();g?.ghost?.remove();g?.item?.classList.remove("uw-drag-ready","resizing","uw-dragging");$$(".uw-range-selected,.uw-drop-target").forEach(x=>x.classList.remove("uw-range-selected","uw-drop-target"));if(restore&&g?.item&&g.originalTop!==undefined){g.item.style.top=g.originalTop;g.item.style.height=g.originalHeight}if(gesture===g)gesture=null};
const activate=g=>{if(!g||g.cancelled||gesture!==g)return;g.active=true;g.item?.classList.add("uw-drag-ready");g.source.setPointerCapture?.(g.pointerId);if(navigator.vibrate)navigator.vibrate(18);if(g.mode==="time-create"){g.preview=document.createElement("div");g.preview.className="uw-drag-selection";g.lane.appendChild(g.preview)}if(g.mode==="move"){g.item.classList.add("uw-dragging");g.ghost=g.item.cloneNode(true);g.ghost.className="uw-drag-ghost";g.ghost.style.left=`${g.x}px`;g.ghost.style.top=`${g.y}px`;document.body.appendChild(g.ghost)}};
const updateDateRange=(g,date)=>{const a=date<g.startDate?date:g.startDate,b=date<g.startDate?g.startDate:date;g.nextDate=date;$$(".uw-month-cell").forEach(c=>c.classList.toggle("uw-range-selected",c.dataset.date>=a&&c.dataset.date<=b))};
document.addEventListener("pointerdown",e=>{if(!e.isPrimary||e.button>0)return;const resizeHandle=e.target.closest("[data-uw-resize]"),moveHandle=e.target.closest(".uw-move-handle"),item=(resizeHandle||moveHandle)?.closest(".uw-item")||e.target.closest(".uw-item");let mode=null,source=null;if(resizeHandle){mode="resize";source=resizeHandle}else if(moveHandle&&(!coarse()||item?.classList.contains("selected"))){mode="move";source=moveHandle}else if(!e.target.closest(".uw-item,.uw-inline-form")){const hit=e.target.closest(".uw-time-hit");const cell=e.target.closest(".uw-month-cell");if(hit){mode="time-create";source=hit}else if(cell){mode="date-create";source=cell}}if(!mode||!source)return;const g=gesture={mode,source,item,pointerId:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,active:false,cancelled:false,coarse:e.pointerType!=="mouse"||coarse()};if(mode==="resize"){g.edge=resizeHandle.dataset.uwResize;g.start=+item.dataset.time;g.duration=+item.dataset.duration;g.nextStart=g.start;g.nextDuration=g.duration;g.originalTop=item.style.top;g.originalHeight=item.style.height}if(mode==="time-create"){g.lane=source.closest(".uw-time-lane");g.date=source.dataset.date;g.start=+source.dataset.time;g.nextStart=g.start;g.nextEnd=g.start+SLOT}if(mode==="date-create"){g.startDate=source.dataset.date;g.nextDate=g.startDate}if(mode==="move"){g.kind=item.dataset.uwKind;g.id=item.dataset.id;g.date=item.dataset.date;g.start=Number.isFinite(+item.dataset.time)?+item.dataset.time:null;g.duration=+item.dataset.duration||SLOT;g.nextDate=g.date;g.nextStart=g.start}if(g.coarse)g.timer=setTimeout(()=>activate(g),450)},true);
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
  if(kind==="habit"){
    const habit=state?.habitTemplates.find(item=>item.id===id),scope=await askHabitScope("change",habit,date);
    if(!habit||!scope)return;
    await write(current=>{const target=current.habitTemplates.find(item=>item.id===id);if(!target)return;if(scope==="day"){const override=habitOverride(current,date,id,true);override.startMinute=null;delete override.duration}else{delete target.startMinute;const override=habitOverride(current,date,id);if(override){delete override.startMinute;delete override.duration;cleanHabitOverride(current,date,id)}}});
    return
  }
  if(kind==="task"){
    const task=state?.tasks.find(item=>item.id===id);
    if(!task)return;
    if(task.recurrence?.frequency){
      const scope=await askTaskScope(task,date||task.date);
      if(!scope)return;
      await write(current=>{
        const target=current.tasks.find(item=>item.id===id);
        if(!target)return;
        if(scope==="day"){
          const override=taskOverride(current,date||target.date,id,true);
          override.startMinute=null;
          delete override.duration;
          current.timeBlocks=current.timeBlocks.filter(item=>!(item.taskId===id&&item.date===(date||target.date)));
          return
        }
        delete target.notionStart;
        delete target.notionEnd;
        current.timeBlocks=current.timeBlocks.filter(item=>item.taskId!==id);
        clearTaskTimingOverrides(current,id)
      });
      return
    }
    await write(s=>{const target=s.tasks.find(x=>x.id===id);if(!target)return;target.date=date||null;delete target.notionStart;delete target.notionEnd;s.timeBlocks=s.timeBlocks.filter(x=>x.taskId!==id)});
    return
  }
  await write(s=>{const event=s.events.find(x=>x.id===id);if(!event)return;const noon=new Date(`${date}T12:00:00`);event.start=noon.toISOString();event.end=noon.toISOString();event.allDay=true})
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
      window.getSelection?.()?.removeAllRanges();
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
    else if(moveHandle&&item?.classList.contains("selected")){mode="move";source=moveHandle}
    else if(!coarse()&&item&&e.target.closest(".uw-item-title,.uw-habit-title")){mode="move";source=e.target.closest(".uw-item-title,.uw-habit-title")}
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
      g.createKind=source.dataset.uwAddKind||"task";
      g.start=+source.dataset.time;
      g.nextStart=g.start;
      g.nextEnd=g.start+SLOT;
    }else if(mode==="date-create"){
      g.startDate=source.dataset.date;
      g.nextDate=g.startDate;
      g.createKind=source.dataset.uwAddKind||"event";
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
    const allDay=pointed?.closest("[data-uw-all-day-drop]");
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
    }else if(allDay){
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
      const kind=g.createKind||"task";
      const host=findAddHost(kind,g.date,g.nextStart);
      openInline(host,{kind,date:g.date,time:g.nextStart,duration:g.nextEnd-g.nextStart,withTime:kind==="event"});
      return;
    }
    if(g.mode==="date-create"){
      const first=g.nextDate<g.startDate?g.nextDate:g.startDate;
      const last=g.nextDate<g.startDate?g.startDate:g.nextDate;
      openInline($(`.uw-month-cell[data-date="${first}"]`),{kind:g.createKind||"event",date:first,endDate:last});
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

function wireHabitForm(){const form=$("#habitPageForm");if(!form||form.dataset.uwBound)return;form.dataset.uwBound="1";form.addEventListener("submit",async event=>{event.preventDefault();const title=$("#habitPageTitle")?.value.trim(),time=$("#habitPageTime")?.value||"",duration=Math.max(SLOT,+$("#habitPageDuration")?.value||SLOT),groupId=$("#habitPageGroup")?.value||state?.eventGroups?.[0]?.id||"default",button=form.querySelector('button[type="submit"]');if(!title)return;const original=button.dataset.defaultLabel||button.textContent;button.dataset.defaultLabel=original;button.disabled=true;button.textContent="추가 중…";try{await write(current=>{const habit={id:uid(),title,duration,groupId};if(time){const[hour,minute]=time.split(":").map(Number);habit.startMinute=hour*60+minute}current.habitTemplates.push(habit);const today=todayKey();current.habitDays[today]||={};current.habitDays[today][habit.id]=false});form.reset();$("#habitPageGroup").value=groupId}catch(error){console.error("습관 추가 실패",error);button.textContent="다시 시도"}finally{button.disabled=false;if(button.textContent!=="다시 시도")button.textContent=original}})}
function wireOverdueActions(){document.addEventListener("click",async event=>{const view=event.target.closest("[data-uw-overdue-view]"),move=event.target.closest("[data-uw-overdue-move]");if(!view&&!move)return;event.preventDefault();event.stopImmediatePropagation();if(view){overdueExpanded=!overdueExpanded;renderOverdue();return}move.disabled=true;move.textContent="이동 중…";await write(current=>{const today=todayKey(),ids=new Set();current.tasks.forEach(task=>{if(!task.done&&task.date&&task.date<today&&!task.recurrence?.frequency){ids.add(task.id);task.date=today}});(current.timeBlocks||[]).forEach(block=>{if(ids.has(block.taskId)&&block.date<today)block.date=today})});overdueExpanded=false},true)}
async function renderAll(){if(rendering)return;rendering=true;try{await read();if(!state)return;applyColors();renderHome();renderSchedulePage();renderTasks();renderHabits()}catch(e){console.error("통합 화면 렌더링 실패",e)}finally{rendering=false}}
async function init(){if(document.documentElement.dataset.unifiedWorkspace)return;document.documentElement.dataset.unifiedWorkspace="1";wireDragClickGuard();wireHabitForm();wireOverdueActions();wireTaskViewControls();wireScheduleViewControls();wireClicks();wireSideTabs();wireControlsV2();document.addEventListener("onekan:state-changed",event=>{if(event.detail?.source!=="unified")scheduleRender(40)});await renderAll();updateCurrentTimeLines();setInterval(updateCurrentTimeLines,60000)}
supabase.auth.onAuthStateChange((_e,session)=>{user=session?.user||null;if(user)setTimeout(init,300)});const {data:{session}}=await supabase.auth.getSession();if(session?.user){user=session.user;setTimeout(init,300)}
