import { supabase } from "./supabase.js";
import {
  ensureGoogleCalendarRange,
  googleCalendarEventsForDate,
  isGoogleCalendarEvent,
} from "./google-calendar.js?v=1";

const $=(selector,root=document)=>root?.querySelector?.(selector)||null;
const $$=(selector,root=document)=>[...(root?.querySelectorAll?.(selector)||[])];
const pad=value=>String(value).padStart(2,"0");
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
const key=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
const fromKey=value=>new Date(`${value}T12:00:00`);
const addDays=(date,days)=>{const next=new Date(date);next.setDate(next.getDate()+days);return next};
const todayKey=()=>{const date=new Date();date.setHours(date.getHours()-3);return key(date)};

const SLOT=30;
let START=360;
let END=1320;
let state=null;
let user=null;
let pageMode="calendar";
let listTab="all";
let calendarView="month";
let calendarLayout="board";
let calendarCursor=fromKey(todayKey());
let renderQueued=false;
let savingKinds=Promise.resolve();
let mutationObserver=null;
let currentTimeTimer=null;

const EYE_OPEN='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.6"></circle></svg>';
const EYE_OFF='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 6.1A10.3 10.3 0 0 1 12 6c6.1 0 9.5 6 9.5 6a15.9 15.9 0 0 1-2.1 2.7"></path><path d="M6.2 6.3C3.8 8 2.5 12 2.5 12s3.4 6 9.5 6a9.8 9.8 0 0 0 3-.5"></path></svg>';

function ensureStylesheet(){
  if(document.querySelector('link[data-schedule-task-merge-style]'))return;
  const link=document.createElement("link");link.rel="stylesheet";link.href="./css/schedule-task-merge.css?v=1";link.dataset.scheduleTaskMergeStyle="1";document.head.appendChild(link);
}

function normalizeKinds(value){
  if(!Array.isArray(value))return["event","task"];
  return["event","task"].filter(kind=>value.includes(kind));
}

function normalize(next){
  next=next&&typeof next==="object"?next:{};
  next.tasks=Array.isArray(next.tasks)?next.tasks:[];
  next.events=Array.isArray(next.events)?next.events:[];
  next.sessions=Array.isArray(next.sessions)?next.sessions:[];
  next.eventGroups=Array.isArray(next.eventGroups)&&next.eventGroups.length?next.eventGroups:[{id:"default",name:"기본",color:"#8fa9c4"}];
  next.taskOverrides=next.taskOverrides&&typeof next.taskOverrides==="object"?next.taskOverrides:{};
  next.eventOverrides=next.eventOverrides&&typeof next.eventOverrides==="object"?next.eventOverrides:{};
  next.timeBlocks=Array.isArray(next.timeBlocks)?next.timeBlocks:[];
  next.ui=next.ui&&typeof next.ui==="object"?next.ui:{};
  next.ui.visibleScheduleKinds=normalizeKinds(next.ui.visibleScheduleKinds);
  next.ui.showSessionsOnTimeline=next.ui.showSessionsOnTimeline!==false;
  const range=next.ui.timelineRange&&typeof next.ui.timelineRange==="object"?next.ui.timelineRange:{};
  START=Math.max(0,Math.min(1350,Math.round((+range.start||360)/SLOT)*SLOT));
  END=Math.max(START+SLOT,Math.min(1440,Math.round((+range.end||1320)/SLOT)*SLOT));
  return next;
}

function visibleKinds(){return normalizeKinds(state?.ui?.visibleScheduleKinds)}
function kindVisible(kind){return visibleKinds().includes(kind)}
function group(item){return state.eventGroups.find(entry=>entry.id===item?.groupId)||state.eventGroups[0]}
function groupStyle(item){return`--uw-group:${isGoogleCalendarEvent(item)?item.externalColor:group(item).color}`}
function manualOrderValue(item){const value=Number(item?.manualOrder);return Number.isFinite(value)?value:1000000000}
function dayLabel(date,long=false){return new Intl.DateTimeFormat("ko-KR",long?{month:"long",day:"numeric",weekday:"short"}:{month:"numeric",day:"numeric",weekday:"short"}).format(date)}
function timeOf(iso){if(!iso)return"";const date=new Date(iso);return`${pad(date.getHours())}:${pad(date.getMinutes())}`}
function dayDistance(first,last){const a=fromKey(first),b=fromKey(last);return Math.round((Date.UTC(b.getFullYear(),b.getMonth(),b.getDate())-Date.UTC(a.getFullYear(),a.getMonth(),a.getDate()))/86400000)}
function timelineHeight(){return((END-START)/SLOT)*20}

function recurrenceOn(item,baseDate,targetDate){
  if(!baseDate||!targetDate)return false;
  const recurrence=item?.recurrence;
  if(!recurrence||!recurrence.frequency||recurrence.frequency==="none")return targetDate===baseDate;
  if(targetDate<baseDate||recurrence.until&&targetDate>recurrence.until)return false;
  const interval=Math.max(1,+recurrence.interval||1),diff=dayDistance(baseDate,targetDate);
  if(recurrence.frequency==="daily")return diff%interval===0;
  const base=fromKey(baseDate),target=fromKey(targetDate);
  if(recurrence.frequency==="weekly"){
    const weekdays=Array.isArray(recurrence.weekdays)&&recurrence.weekdays.length?recurrence.weekdays:[base.getDay()];
    return Math.floor(diff/7)%interval===0&&weekdays.includes(target.getDay());
  }
  if(recurrence.frequency==="monthly"){
    const months=(target.getFullYear()-base.getFullYear())*12+target.getMonth()-base.getMonth();
    const wanted=Math.min(+recurrence.dayOfMonth||base.getDate(),new Date(target.getFullYear(),target.getMonth()+1,0).getDate());
    return months>=0&&months%interval===0&&target.getDate()===wanted;
  }
  return targetDate===baseDate;
}

function recurrenceLabel(item,kind=""){
  const recurrence=item?.recurrence,frequency=recurrence?.frequency,interval=Math.max(1,+recurrence?.interval||1);
  if(kind==="task"&&frequency){
    if(frequency==="daily")return interval===1?"완료 후 1일":`완료 후 ${interval}일`;
    if(frequency==="weekly"){const weekdays=Array.isArray(recurrence.weekdays)?recurrence.weekdays:[];if(weekdays.length>1)return"완료 후 다음 지정 요일";return interval===1?"완료 후 1주":`완료 후 ${interval}주`}
    if(frequency==="monthly")return interval===1?"완료 후 1개월":`완료 후 ${interval}개월`;
  }
  if(frequency==="daily")return interval===1?"매일":`${interval}일마다`;
  if(frequency==="weekly"){
    const weekdays=Array.isArray(recurrence.weekdays)?[...recurrence.weekdays].sort((a,b)=>a-b):[];
    if(interval===1&&weekdays.join(",")==="1,2,3,4,5")return"평일";
    const names=weekdays.map(day=>["일","월","화","수","목","금","토"][day]).join("·");
    return names?(interval===1?`${names}요일`:`${interval}주마다 · ${names}요일`):(interval===1?"매주":`${interval}주마다`);
  }
  if(frequency==="monthly")return interval===1?"매월":`${interval}개월마다`;
  return"";
}

function taskDoneOn(item,date){
  if(item?.recurrence?.completionBased)return!!item.done;
  const occurrenceDate=item?._occurrenceSource||date;
  return item?.recurrence?.frequency?!!item.recurrenceDone?.[occurrenceDate]:!!item?.done;
}

function taskOverride(date,id){return state.taskOverrides?.[date]?.[id]||null}
function eventOverride(date,id){return state.eventOverrides?.[date]?.[id]||null}

function taskOccurrenceTime(task,override,targetDate){
  if(override&&Object.prototype.hasOwnProperty.call(override,"startMinute"))return override.startMinute===null?null:Number(override.startMinute);
  if(task.notionStart){const start=new Date(task.notionStart);return start.getHours()*60+start.getMinutes()}
  const block=state.timeBlocks.find(item=>item.taskId===task.id&&(item.date===targetDate||item.date===task.date));
  return block?Number(block.startMinute):null;
}
function taskOccurrenceDuration(task,override){
  if(override&&Number.isFinite(Number(override.duration)))return Math.max(SLOT,Number(override.duration));
  if(task.notionStart&&task.notionEnd)return Math.max(SLOT,Math.round((new Date(task.notionEnd)-new Date(task.notionStart))/60000/SLOT)*SLOT);
  const block=state.timeBlocks.find(item=>item.taskId===task.id);
  return Math.max(SLOT,Number(block?.duration)||SLOT);
}
function effectiveTaskOccurrence(task,sourceDate,override=null){
  const targetDate=override&&Object.prototype.hasOwnProperty.call(override,"date")?override.date:sourceDate;
  const item={...task,title:override?.title??task.title,date:targetDate,_occurrenceSource:sourceDate,_occurrenceDate:targetDate};
  const startMinute=taskOccurrenceTime(task,override,targetDate),duration=taskOccurrenceDuration(task,override);
  delete item.notionStart;delete item.notionEnd;
  if(targetDate&&startMinute!==null&&Number.isFinite(startMinute)){
    const start=new Date(`${targetDate}T${pad(Math.floor(startMinute/60))}:${pad(startMinute%60)}:00`);
    item.notionStart=start.toISOString();item.notionEnd=new Date(start.getTime()+duration*60000).toISOString();
  }
  return item;
}
function taskOccurrencesForDate(date){
  const rows=[];
  for(const task of state.tasks){
    if(task.isHabit)continue;
    if(task.recurrence?.completionBased){if(task.date===date)rows.push(task);continue}
    if(!task.recurrence?.frequency){if(task.date===date)rows.push(task);continue}
    const added=new Set();
    if(task.date&&recurrenceOn(task,task.date,date)){
      const override=taskOverride(date,task.id);
      if(!override?.hidden&&(!override||!Object.prototype.hasOwnProperty.call(override,"date")||override.date===date)){rows.push(effectiveTaskOccurrence(task,date,override));added.add(date)}
    }
    for(const[sourceDate,byTask]of Object.entries(state.taskOverrides||{})){
      const override=byTask?.[task.id];
      if(!added.has(sourceDate)&&override&&!override.hidden&&Object.prototype.hasOwnProperty.call(override,"date")&&override.date===date)rows.push(effectiveTaskOccurrence(task,sourceDate,override));
    }
  }
  return rows;
}
function taskRowsForDate(date){return taskOccurrencesForDate(date).sort((a,b)=>+taskDoneOn(a,date)-+taskDoneOn(b,date)||String(a.notionStart||"").localeCompare(String(b.notionStart||""))||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko"))}

function eventOccurrenceSourceForDate(event,date){
  if(!event?.recurrence?.frequency)return null;
  const start=key(new Date(event.start)),end=event.allDay&&event.end?key(new Date(event.end)):start,span=Math.max(0,dayDistance(start,end));
  for(let offset=0;offset<=span;offset++){const sourceDate=key(addDays(fromKey(date),-offset));if(recurrenceOn(event,start,sourceDate))return sourceDate}
  return null;
}
function effectiveEventOccurrence(event,sourceDate,override=null){
  const targetDate=override&&Object.prototype.hasOwnProperty.call(override,"date")?override.date:sourceDate;
  const masterStart=new Date(event.start),masterEnd=new Date(event.end||event.start);
  const allDay=override&&Object.prototype.hasOwnProperty.call(override,"allDay")?Boolean(override.allDay):Boolean(event.allDay);
  const item={...event,title:override?.title??event.title,allDay,_occurrenceSource:sourceDate,_occurrenceDate:targetDate};
  if(allDay){
    const masterStartKey=key(masterStart),masterEndKey=event.allDay&&event.end?key(masterEnd):masterStartKey,span=Math.max(0,dayDistance(masterStartKey,masterEndKey));
    item.start=new Date(`${targetDate}T12:00:00`).toISOString();item.end=new Date(`${key(addDays(fromKey(targetDate),span))}T12:00:00`).toISOString();return item;
  }
  const startMinute=override&&Object.prototype.hasOwnProperty.call(override,"startMinute")?Number(override.startMinute):masterStart.getHours()*60+masterStart.getMinutes();
  const duration=override&&Number.isFinite(Number(override.duration))?Math.max(SLOT,Number(override.duration)):Math.max(SLOT,Math.round((masterEnd-masterStart)/60000/SLOT)*SLOT);
  const start=new Date(`${targetDate}T${pad(Math.floor(startMinute/60))}:${pad(startMinute%60)}:00`);
  item.start=start.toISOString();item.end=new Date(start.getTime()+duration*60000).toISOString();return item;
}
function eventOccurrenceCoversDate(event,date){const start=key(new Date(event.start)),end=event.allDay&&event.end?key(new Date(event.end)):start;return date>=start&&date<=end}
function eventOccurrencesForDate(date){
  const rows=[];
  for(const event of state.events){
    if(!event.recurrence?.frequency){if(eventOccurrenceCoversDate(event,date))rows.push(event);continue}
    const normalSource=eventOccurrenceSourceForDate(event,date);
    if(normalSource){const override=eventOverride(normalSource,event.id);if(!override?.hidden){const item=effectiveEventOccurrence(event,normalSource,override);if(eventOccurrenceCoversDate(item,date))rows.push(item)}}
    for(const[sourceDate,byEvent]of Object.entries(state.eventOverrides||{})){
      if(sourceDate===normalSource)continue;
      const override=byEvent?.[event.id];
      if(!override||override.hidden||!Object.prototype.hasOwnProperty.call(override,"date"))continue;
      const item=effectiveEventOccurrence(event,sourceDate,override);if(eventOccurrenceCoversDate(item,date))rows.push(item);
    }
  }
  return rows;
}
function schedules(date){return[...eventOccurrencesForDate(date),...googleCalendarEventsForDate(date)].sort((a,b)=>Number(b.allDay)-Number(a.allDay)||new Date(a.start)-new Date(b.start))}
function eventDoneAt(event,now=new Date()){if(!event?.start)return false;if(event.allDay)return key(new Date(event.end||event.start))<todayKey();const end=new Date(event.end||event.start);return!Number.isNaN(end.getTime())&&end<=now}

function checkMarkup(kind,item,date){
  if(kind==="event"&&isGoogleCalendarEvent(item))return'<span class="uw-google-mark" aria-label="Google 캘린더">G</span>';
  if(kind==="event")return'<span class="uw-event-dot" aria-hidden="true"></span>';
  const done=taskDoneOn(item,date),occurrence=item._occurrenceSource?` data-occurrence-source="${esc(item._occurrenceSource)}"`:"";
  return`<button class="uw-check${done?" checked":""}" style="--uw-check-color:var(--timeline-task-color)" data-uw-check="task" data-id="${esc(item.id)}" data-date="${date}"${occurrence} type="button">${done?"✓":""}</button>`;
}
function itemMarkup(kind,item,date,compact=false,manual=false,listDateLabel=""){
  const google=kind==="event"&&isGoogleCalendarEvent(item),done=kind==="task"&&taskDoneOn(item,date),time=kind==="event"&&!item.allDay?timeOf(item.start):kind==="task"&&item.notionStart?timeOf(item.notionStart):"",repeat=recurrenceLabel(item,kind),occurrence=item._occurrenceSource?` data-occurrence-source="${esc(item._occurrenceSource)}"`:"",manualAttrs=manual&&!google?` data-manual-row data-manual-kind="${kind}" data-manual-id="${esc(item.id)}"`:"",googleAttrs=google?` data-google-calendar-event data-google-calendar-url="${esc(item.htmlLink||"")}" title="${esc(item.calendarName||"Google 캘린더")}"`:"";
  const move=google?"":'<button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button" aria-label="선택"></button>';
  return`<div class="uw-item uw-${kind}${done?" done":""}${compact?" compact":""}${google?" uw-google-event":""}" style="${groupStyle(item)}" data-uw-kind="${kind}" data-id="${esc(item.id)}" data-date="${date||""}"${occurrence}${manualAttrs}${googleAttrs} draggable="false">${checkMarkup(kind,item,date)}<span class="uw-item-title">${esc(item.title)}</span>${repeat?`<span class="uw-repeat-badge" title="${esc(repeat)}" aria-label="반복 · ${esc(repeat)}">↻</span>`:""}${listDateLabel?`<span class="merged-schedule-list-date">${esc(listDateLabel)}</span>`:""}${time?`<span class="uw-item-time">${time}</span>`:""}${move}</div>`;
}

function addButton(kind,date,compact=false,withTime=false){
  const label=kind==="event"?"일정":"할일";
  return`<button class="uw-empty-hit merged-schedule-add${compact?" compact":""}" data-uw-add-kind="${kind}" data-date="${date||""}"${withTime?' data-with-time="1"':""} type="button" aria-label="${label} 입력">${compact?"＋":`＋ ${label}`}</button>`;
}
function addButtons(date,{compact=false,withTime=false}={}){
  const buttons=[];
  if(kindVisible("event"))buttons.push(addButton("event",date,compact,withTime));
  if(kindVisible("task"))buttons.push(addButton("task",date,compact,false));
  return buttons.length?`<div class="merged-schedule-add-row">${buttons.join("")}</div>`:"";
}
function rowEntries(date){
  const entries=[];
  if(kindVisible("event"))schedules(date).forEach(item=>entries.push({kind:"event",item}));
  if(kindVisible("task"))taskRowsForDate(date).forEach(item=>entries.push({kind:"task",item}));
  return entries.sort((a,b)=>{
    const at=a.kind==="event"?(a.item.allDay?-1:new Date(a.item.start).getHours()*60+new Date(a.item.start).getMinutes()):(a.item.notionStart?new Date(a.item.notionStart).getHours()*60+new Date(a.item.notionStart).getMinutes():-1);
    const bt=b.kind==="event"?(b.item.allDay?-1:new Date(b.item.start).getHours()*60+new Date(b.item.start).getMinutes()):(b.item.notionStart?new Date(b.item.notionStart).getHours()*60+new Date(b.item.notionStart).getMinutes():-1);
    return at-bt||manualOrderValue(a.item)-manualOrderValue(b.item)||String(a.item.title||"").localeCompare(String(b.item.title||""),"ko");
  });
}

function monthBoard(){
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),first=new Date(y,m,1),start=addDays(first,-first.getDay()),preferred=kindVisible("event")?"event":"task";
  return`<div class="uw-task-month-grid merged-schedule-month">${["일","월","화","수","목","금","토"].map(text=>`<div class="uw-task-dow">${text}</div>`).join("")}${Array.from({length:42},(_,index)=>{const dateObj=addDays(start,index),date=key(dateObj),rows=rowEntries(date);return`<section class="uw-task-month-cell uw-month-cell${dateObj.getMonth()!==m?" outside":""}${date===todayKey()?" today":""}" data-uw-add-kind="${preferred}" data-date="${date}"><span class="uw-task-day-number">${dateObj.getDate()}</span><div class="uw-list" data-date="${date}" data-task-drop-date="${date}">${rows.slice(0,6).map(row=>itemMarkup(row.kind,row.item,date,true)).join("")}${rows.length>6?`<span class="merged-schedule-more">+${rows.length-6}</span>`:""}${addButtons(date,{compact:true})}</div></section>`}).join("")}</div>`;
}
function boardDay(dateObj){
  const date=key(dateObj),rows=rowEntries(date);
  return`<section class="uw-task-board-day${date===todayKey()?" today":""}"><div class="uw-day-head"><strong>${dayLabel(dateObj,true)}</strong></div><div class="uw-list" data-date="${date}" data-task-drop-date="${date}">${rows.map(row=>itemMarkup(row.kind,row.item,date)).join("")}${addButtons(date)}</div></section>`;
}
function board(){const count=calendarView==="week"?7:1,start=calendarView==="week"?addDays(calendarCursor,-calendarCursor.getDay()):calendarCursor;return`<div class="uw-task-board-grid" style="--uw-task-days:${count}">${Array.from({length:count},(_,index)=>boardDay(addDays(start,index))).join("")}</div>`}

function timelineEntries(date){
  const entries=[];
  if(kindVisible("event")){
    schedules(date).forEach(item=>{const timed=!item.allDay,start=new Date(item.start),end=new Date(item.end||item.start);entries.push({kind:"event",item,timed,time:timed?start.getHours()*60+start.getMinutes():null,duration:timed?Math.max(SLOT,Math.round((end-start)/60000/SLOT)*SLOT):null})});
  }
  if(kindVisible("task")){
    taskRowsForDate(date).forEach(item=>{let start=null,duration=SLOT;if(item.notionStart){const begin=new Date(item.notionStart);start=begin.getHours()*60+begin.getMinutes();if(item.notionEnd)duration=Math.max(SLOT,Math.round((new Date(item.notionEnd)-begin)/60000/SLOT)*SLOT)}else{const block=state.timeBlocks.find(entry=>entry.taskId===item.id&&entry.date===date);if(block){start=Number(block.startMinute);duration=Math.max(SLOT,Number(block.duration)||SLOT)}}const timed=start!==null&&Number.isFinite(start);entries.push({kind:"task",item,timed,time:timed?start:null,duration:timed?duration:null})});
  }
  if(state.ui.showSessionsOnTimeline){state.sessions.filter(session=>session.start&&session.end&&key(new Date(session.start))===date&&new Date(session.end)>new Date(session.start)).forEach(session=>{const start=new Date(session.start);entries.push({kind:"session",item:session,timed:true,time:start.getHours()*60+start.getMinutes(),duration:Math.max(SLOT,Math.round((new Date(session.end)-start)/60000/SLOT)*SLOT)})})}
  return entries;
}
function layoutTimedItems(items){
  const sorted=[...items].sort((a,b)=>a.time-b.time||b.duration-a.duration);let cluster=[],clusterEnd=-Infinity;
  const flush=()=>{if(!cluster.length)return;const laneEnds=[];cluster.forEach(entry=>{let lane=laneEnds.findIndex(end=>end<=entry.time);if(lane<0)lane=laneEnds.length;entry._lane=lane;laneEnds[lane]=entry.time+entry.duration});const columns=Math.max(1,laneEnds.length);cluster.forEach(entry=>entry._columns=columns);cluster=[];clusterEnd=-Infinity};
  sorted.forEach(entry=>{if(cluster.length&&entry.time>=clusterEnd)flush();cluster.push(entry);clusterEnd=Math.max(clusterEnd,entry.time+entry.duration)});flush();return sorted;
}
function timedColumnStyle(entry){const columns=Math.max(1,entry._columns||1),lane=Math.max(0,entry._lane||0);if(columns===1)return"";const width=100/columns,left=lane*width;return`left:calc(${left}% + 1px);width:calc(${width}% - 2px);right:auto;`}
function currentTimeMarkup(date){const now=new Date(),minute=now.getHours()*60+now.getMinutes(),visible=date===key(now)&&minute>=START&&minute<=END,top=Math.max(0,Math.min(timelineHeight(),((minute-START)/SLOT)*20));return`<div class="uw-current-time${visible?" active":""}" data-current-date="${date}" style="top:${top}px${visible?"":";display:none"}"><span></span></div>`}
function allDayPanel(date,items){
  const shown=items.slice(0,5),hidden=items.slice(5),extra=hidden.length;
  return`<div class="uw-all-day" data-date="${date}" data-uw-all-day-drop><span class="uw-all-day-label">하루종일</span><div class="uw-all-day-list" data-date="${date}">${shown.map(row=>itemMarkup(row.kind,row.item,date,true)).join("")}${addButtons(date,{compact:true})}</div>${extra?`<button class="uw-all-day-more" data-uw-all-day-more type="button" aria-expanded="false">+${extra}개 더보기</button><div class="uw-all-day-popover"><div class="uw-list">${hidden.map(row=>itemMarkup(row.kind,row.item,date,true)).join("")}</div></div>`:""}</div>`;
}
function timelineDay(dateObj){
  const date=key(dateObj),items=timelineEntries(date),untimed=items.filter(row=>!row.timed),timed=layoutTimedItems(items.filter(row=>row.timed&&row.time>=START&&row.time<END));let labels="",hits="";const preferred=kindVisible("event")?"event":"task";
  for(let minute=START;minute<END;minute+=SLOT){if(minute%60===0)labels+=`<span class="uw-time-label" style="top:${((minute-START)/SLOT)*20}px">${pad(minute/60)}:00</span>`;hits+=`<div class="uw-time-hit" style="top:${((minute-START)/SLOT)*20}px" data-uw-add-kind="${preferred}" data-with-time="1" data-date="${date}" data-time="${minute}"></div>`}
  const blocks=timed.map(row=>{
    if(row.kind==="session")return`<div class="uw-time-entry uw-session-entry" style="top:${((row.time-START)/SLOT)*20+1}px;height:${Math.max(18,(row.duration/SLOT)*20-2)}px;${timedColumnStyle(row)}" data-context-kind="session" data-context-id="${esc(row.item.id)}" data-date="${date}" title="시간 추적 기록"><span class="uw-session-dot" aria-hidden="true"></span><strong class="uw-item-title">${esc(row.item.title||"시간 기록")}</strong><small>실제</small></div>`;
    const google=row.kind==="event"&&isGoogleCalendarEvent(row.item),done=row.kind==="task"&&taskDoneOn(row.item,date),occurrence=row.item._occurrenceSource?` data-occurrence-source="${esc(row.item._occurrenceSource)}"`:"",external=google?` data-google-calendar-event data-google-calendar-url="${esc(row.item.htmlLink||"")}" title="${esc(row.item.calendarName||"Google 캘린더")}"`:"";
    return`<div class="uw-time-entry uw-item${done?" done":""}${google?" uw-google-event":""}" style="top:${((row.time-START)/SLOT)*20+1}px;height:${Math.max(18,(row.duration/SLOT)*20-2)}px;${timedColumnStyle(row)}${groupStyle(row.item)}" data-uw-kind="${row.kind}" data-id="${esc(row.item.id)}" data-date="${date}"${occurrence} data-time="${row.time}" data-duration="${row.duration}"${external}>${google?"":'<button class="uw-resize-handle top" data-uw-resize="top" type="button"></button>'}${checkMarkup(row.kind,row.item,date)}<span class="uw-item-title">${esc(row.item.title)}</span>${google?"":'<button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button" aria-label="선택"></button><button class="uw-resize-handle bottom" data-uw-resize="bottom" type="button"></button>'}</div>`;
  }).join("");
  return`<section class="uw-day${date===todayKey()?" uw-today":""}" data-date="${date}"><div class="uw-day-head"><strong>${dayLabel(dateObj,true)}</strong></div>${allDayPanel(date,untimed)}<div class="uw-timeline" style="height:${timelineHeight()}px"><div class="uw-time-labels">${labels}</div><div class="uw-time-lane">${hits}${currentTimeMarkup(date)}${blocks}</div></div></section>`;
}
function timeline(){const count=calendarView==="week"?7:1,start=calendarView==="week"?addDays(calendarCursor,-calendarCursor.getDay()):calendarCursor;return`<div class="uw-task-timeline-scroll"><div class="uw-planner-days" style="--uw-days:${count}">${Array.from({length:count},(_,index)=>timelineDay(addDays(start,index))).join("")}</div></div>`}

function taskListDate(task){if(task.done){if(task.completedDate)return task.completedDate;if(task.completedAt){const completed=new Date(task.completedAt);if(!Number.isNaN(completed.getTime()))return key(completed)}}return task._occurrenceDate||task.date||""}
function visibleTasks(tab){
  const today=todayKey(),tasks=state.tasks.filter(task=>!task.isHabit);let rows=[];
  if(tab==="done")rows=tasks.filter(task=>task.done);
  else if(tab==="someday")rows=tasks.filter(task=>!task.done&&!task.date);
  else if(tab==="upcoming")rows=tasks.filter(task=>!task.done&&task.date&&task.date>=today);
  else rows=[...tasks];
  return rows.sort((a,b)=>{const ad=taskListDate(a),bd=taskListDate(b);if(tab==="upcoming")return String(ad||"9999").localeCompare(String(bd||"9999"))||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko");return String(bd||"").localeCompare(String(ad||""))||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko")});
}
function scheduleListRows(tab){
  if(tab==="someday")return[];
  const today=todayKey(),dateSet=new Set();
  for(const event of state.events){if(event?.start)dateSet.add(key(new Date(event.start)))}
  for(let offset=-365;offset<=370;offset++){const date=key(addDays(fromKey(today),offset));if(schedules(date).length)dateSet.add(date)}
  const seen=new Set(),rows=[];
  for(const date of dateSet)for(const event of schedules(date)){const source=event._occurrenceSource||date,token=`${event.id}:${source}:${date}`;if(seen.has(token))continue;seen.add(token);const done=eventDoneAt(event);if(tab==="upcoming"&&(done||date<today))continue;if(tab==="done"&&!done)continue;rows.push({date,item:event,done})}
  return rows;
}
function listSortDate(tab,a,b){return tab==="upcoming"?String(a).localeCompare(String(b)):String(b).localeCompare(String(a))}
function combinedListRows(tab){
  const rows=[];
  if(kindVisible("event")&&tab!=="someday")scheduleListRows(tab).forEach(row=>rows.push({kind:"event",date:row.date,item:row.item}));
  if(kindVisible("task"))visibleTasks(tab).forEach(item=>rows.push({kind:"task",date:taskListDate(item),item}));
  return rows.sort((a,b)=>listSortDate(tab,a.date||"",b.date||"")||manualOrderValue(a.item)-manualOrderValue(b.item)||String(a.item.title||"").localeCompare(String(b.item.title||""),"ko"));
}
function somedayList(){
  if(!kindVisible("task"))return'<div class="merged-schedule-empty">할일 보기를 켜면 언젠가 할일이 보여요.</div>';
  const rows=visibleTasks("someday"),grouped=state.eventGroups.map(groupInfo=>({groupInfo,rows:rows.filter(task=>group(task).id===groupInfo.id)})).filter(entry=>entry.rows.length);
  const add=`<div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="" data-uw-someday-drop>${addButton("task","",false)}</div>`;
  if(!grouped.length)return`${add}<div class="merged-schedule-empty compact">언젠가 할일이 없어요.</div>`;
  return`${add}<div class="uw-task-grouped-list">${grouped.map(({groupInfo,rows:groupRows})=>`<section class="uw-task-group-section" style="--uw-group:${groupInfo.color}"><div class="uw-task-group-heading"><span class="uw-task-group-dot"></span><strong>${esc(groupInfo.name)}</strong></div><div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="" data-group-id="${groupInfo.id}" data-uw-someday-drop data-manual-list>${groupRows.map(task=>itemMarkup("task",task,"",false,true)).join("")}</div></section>`).join("")}</div>`;
}
function flatAllList(){
  const rows=combinedListRows("all");
  const add=`<div class="merged-schedule-list-add">${addButtons(todayKey())}</div>`;
  if(!rows.length)return`${add}<div class="merged-schedule-empty compact">표시할 항목이 없어요.</div>`;
  return`${add}<div class="uw-list uw-task-main-list uw-flat-all-list">${rows.map(row=>itemMarkup(row.kind,row.item,row.date||"",false,false,row.date?dayLabel(fromKey(row.date)):"언젠가")).join("")}</div>`;
}
function groupedList(tab){
  const rows=combinedListRows(tab);
  if(!rows.length)return'<div class="merged-schedule-empty compact">표시할 항목이 없어요.</div>';
  const groups=new Map();
  rows.forEach(row=>{const date=row.date||"";if(!groups.has(date))groups.set(date,[]);groups.get(date).push(row)});
  const dates=[...groups.keys()].sort((a,b)=>listSortDate(tab,a,b));
  return`<div class="uw-task-grouped-list">${dates.map(date=>{const groupRows=groups.get(date),manual=groupRows.every(row=>row.kind==="task");return`<section class="uw-date-group"><div class="uw-date-label"><span>${date?dayLabel(fromKey(date),true):"언젠가"}</span></div><div class="uw-list uw-task-main-list" data-date="${date}" data-task-drop-date="${date}"${manual?' data-manual-list data-uw-add-kind="task"':""}>${groupRows.map(row=>itemMarkup(row.kind,row.item,date,false,manual)).join("")}${tab==="upcoming"&&date?addButtons(date):""}</div></section>`}).join("")}</div>`;
}
function listView(){if(listTab==="someday")return somedayList();if(listTab==="all")return flatAllList();return groupedList(listTab)}

function calendarTitle(){if(calendarView==="month")return`${calendarCursor.getFullYear()}년 ${calendarCursor.getMonth()+1}월`;if(calendarView==="week"){const start=addDays(calendarCursor,-calendarCursor.getDay());return`${dayLabel(start)} – ${dayLabel(addDays(start,6))}`}return dayLabel(calendarCursor,true)}
function kindToggle(kind,label){const active=kindVisible(kind);return`<button class="merged-kind-toggle${active?" active":""}" data-merged-kind-toggle="${kind}" type="button" aria-pressed="${active}" title="${label} ${active?"숨기기":"보기"}">${active?EYE_OPEN:EYE_OFF}<span>${label}</span></button>`}
function modeControls(){return`<div class="seg merged-schedule-mode" aria-label="일정 보기"><button class="${pageMode==="calendar"?"active":""}" data-merged-mode="calendar" type="button">캘린더</button><button class="${pageMode==="list"?"active":""}" data-merged-mode="list" type="button">목록</button></div><div class="merged-schedule-kind-controls" aria-label="표시할 항목">${kindToggle("event","일정")}${kindToggle("task","할일")}</div>`}
function subnavMarkup(){
  if(pageMode==="list")return`<div class="uw-task-list-tabs"><div class="seg">${[["all","전체"],["upcoming","예정"],["someday","언젠가"],["done","완료"]].map(([id,label])=>`<button class="${listTab===id?"active":""}" data-merged-list-tab="${id}" type="button">${label}</button>`).join("")}</div></div>`;
  const month=calendarView==="month",label=month?"월은 보드 보기":calendarLayout==="board"?"타임라인으로 보기":"보드로 보기";
  return`<div class="uw-task-calendar-tabs"><div class="seg">${[["month","월"],["week","주"],["day","일"]].map(([id,text])=>`<button class="${calendarView===id?"active":""}" data-merged-cal-view="${id}" type="button">${text}</button>`).join("")}</div><button class="uw-layout-toggle" data-merged-layout-toggle type="button"${month?' disabled title="월 보기는 보드로 고정돼요"':""}>${label}</button></div>`;
}
function navMarkup(){return`<div class="merged-schedule-calendar-nav"><button class="uw-icon-btn" data-merged-prev type="button" aria-label="이전 기간">‹</button><strong>${calendarTitle()}</strong><div class="merged-schedule-nav-actions">${calendarView!=="month"&&calendarLayout==="timeline"?`<button class="uw-session-toggle" data-uw-toggle-sessions type="button" aria-pressed="${state.ui.showSessionsOnTimeline}">시간 추적 ${state.ui.showSessionsOnTimeline?"숨기기":"보기"}</button>`:""}<button class="uw-task-today" data-merged-today type="button">오늘</button><button class="uw-icon-btn" data-merged-next type="button" aria-label="다음 기간">›</button></div></div>`}
function ensureGoogleRange(){if(!kindVisible("event"))return;if(pageMode==="list"){const start=todayKey();ensureGoogleCalendarRange(start,key(addDays(fromKey(start),120)));return}if(calendarView==="month"){const first=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1),start=addDays(first,-first.getDay());ensureGoogleCalendarRange(key(start),key(addDays(start,41)));return}if(calendarView==="week"){const start=addDays(calendarCursor,-calendarCursor.getDay());ensureGoogleCalendarRange(key(start),key(addDays(start,6)));return}ensureGoogleCalendarRange(key(calendarCursor))}

function render(){
  if(!state)return;
  const page=$("#page-calendar"),body=$("#calendarBody"),subnav=$("#calendarViewSeg"),oldNav=$("#scheduleCalendarNav"),head=page?.querySelector(".page-head");
  if(!page||!body||!subnav||!head)return;
  ensureGoogleRange();
  page.classList.add("merged-schedule-page");
  $("#page-tasks")?.setAttribute("hidden","");
  const oldControls=head.querySelector(".uw-task-mode-controls");if(oldControls)oldControls.hidden=true;
  let controls=head.querySelector(".merged-schedule-head-controls");
  if(!controls){controls=document.createElement("div");controls.className="merged-schedule-head-controls";head.appendChild(controls)}
  controls.innerHTML=modeControls();
  subnav.hidden=false;subnav.innerHTML=subnavMarkup();
  if(oldNav)oldNav.hidden=true;
  if(!visibleKinds().length){body.innerHTML='<div data-merged-schedule-root class="merged-schedule-empty">일정과 할일이 모두 숨겨져 있어요.<small>위의 눈 버튼을 눌러 다시 표시할 수 있어요.</small></div>';return}
  if(pageMode==="list")body.innerHTML=`<div data-merged-schedule-root class="merged-schedule-content merged-schedule-list">${listView()}</div>`;
  else{const layout=calendarView==="month"?"board":calendarLayout,content=calendarView==="month"?monthBoard():layout==="timeline"?timeline():board();body.innerHTML=`<div data-merged-schedule-root class="merged-schedule-content">${navMarkup()}${content}</div>`}
}

async function readState(){
  if(!user){const{data:{session}}=await supabase.auth.getSession();user=session?.user||null}
  if(!user)return null;
  const{data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();
  if(error)throw error;
  state=normalize(data?.data||{});return state;
}
function adopt(payload){if(!payload||typeof payload!=="object")return false;state=normalize(structuredClone(payload));return true}
function queueRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;render()})}
async function refresh(){try{await readState();render()}catch(error){console.error("일정·할일 통합 화면 불러오기 실패",error)}}
async function persistKinds(nextKinds){
  const previous=[...visibleKinds()];state.ui.visibleScheduleKinds=normalizeKinds(nextKinds);render();
  savingKinds=savingKinds.then(async()=>{
    try{const{error}=await supabase.from("onekan_state").upsert({user_id:user.id,data:state},{onConflict:"user_id"});if(error)throw error;document.dispatchEvent(new CustomEvent("onekan:state-changed",{detail:{source:"schedule-task-merge",state:structuredClone(state)}}))}
    catch(error){console.error("일정 표시 설정 저장 실패",error);state.ui.visibleScheduleKinds=previous;render()}
  });
  return savingKinds;
}

function bindControls(){
  document.addEventListener("click",event=>{
    const mode=event.target.closest?.("[data-merged-mode]"),tab=event.target.closest?.("[data-merged-list-tab]"),view=event.target.closest?.("[data-merged-cal-view]"),layout=event.target.closest?.("[data-merged-layout-toggle]"),prev=event.target.closest?.("[data-merged-prev]"),today=event.target.closest?.("[data-merged-today]"),next=event.target.closest?.("[data-merged-next]"),kindButton=event.target.closest?.("[data-merged-kind-toggle]");
    if(!mode&&!tab&&!view&&!layout&&!prev&&!today&&!next&&!kindButton)return;
    event.preventDefault();event.stopPropagation();
    if(kindButton){const kind=kindButton.dataset.mergedKindToggle,kinds=new Set(visibleKinds());kinds.has(kind)?kinds.delete(kind):kinds.add(kind);persistKinds([...kinds]);return}
    if(mode)pageMode=mode.dataset.mergedMode;
    if(tab)listTab=tab.dataset.mergedListTab;
    if(view)calendarView=view.dataset.mergedCalView;
    if(layout&&!layout.disabled)calendarLayout=calendarLayout==="board"?"timeline":"board";
    if(prev)calendarCursor=calendarView==="month"?new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1):addDays(calendarCursor,calendarView==="week"?-7:-1);
    if(next)calendarCursor=calendarView==="month"?new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1):addDays(calendarCursor,calendarView==="week"?7:1);
    if(today)calendarCursor=fromKey(todayKey());
    render();
  },true);
}
function bindState(){
  document.addEventListener("onekan:state-changed",event=>{
    if(event.detail?.source==="schedule-task-merge")return;
    if(event.detail?.state&&adopt(event.detail.state)){queueRender();return}
    setTimeout(refresh,30);
  });
  document.addEventListener("onekan:google-calendar-changed",()=>queueRender());
}
function ownCalendarBody(){
  const body=$("#calendarBody");if(!body||mutationObserver)return;
  mutationObserver=new MutationObserver(()=>{if(!state||$(".uw-inline-form",body))return;if(!body.querySelector(":scope > [data-merged-schedule-root]"))queueRender()});
  mutationObserver.observe(body,{childList:true});
}
function updateCurrentTime(){
  const now=new Date(),today=key(now),minute=now.getHours()*60+now.getMinutes();
  $$("#calendarBody .uw-current-time").forEach(line=>{const visible=line.dataset.currentDate===today&&minute>=START&&minute<=END;line.style.display=visible?"":"none";if(visible)line.style.top=`${Math.max(0,Math.min(timelineHeight(),((minute-START)/SLOT)*20))}px`});
}
async function init(){
  if(document.documentElement.dataset.scheduleTaskMerge)return;
  document.documentElement.dataset.scheduleTaskMerge="1";
  ensureStylesheet();bindControls();bindState();ownCalendarBody();
  await refresh();
  updateCurrentTime();currentTimeTimer=setInterval(updateCurrentTime,60000);
}

supabase.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;if(user)setTimeout(init,0)});
const{data:{session}}=await supabase.auth.getSession();
if(session?.user){user=session.user;setTimeout(init,0)}
