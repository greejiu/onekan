import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";
import { completeRepeatingTask, normalizeCompletionRepeats, undoRepeatingTaskCompletion } from "./repeat-after-completion.js?v=1";

const $=(selector,root=document)=>root.querySelector(selector);
const pad=(value)=>String(value).padStart(2,"0");
const esc=(value)=>String(value??"").replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[character]));
const key=(date)=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
const fromKey=(value)=>new Date(`${value}T12:00:00`);
const addDays=(date,amount)=>{const next=new Date(date);next.setDate(next.getDate()+amount);return next};
const todayKey=()=>{const date=new Date();date.setHours(date.getHours()-3);return key(date)};
const uid=()=>crypto.randomUUID();
const dayLabel=(date,long=false)=>new Intl.DateTimeFormat("ko-KR",long?{month:"long",day:"numeric",weekday:"short"}:{month:"numeric",day:"numeric",weekday:"short"}).format(date);

let state=null;
let user=null;
let rendering=false;
let renderTimer=null;
let habitMode="calendar";
let habitListTab="upcoming";
let habitCalendarView="day";
let habitCalendarLayout="board";
let habitCursor=fromKey(todayKey());
const SLOT=30,SLOT_H=20;

async function readState(){
  const {data:{session}}=await supabase.auth.getSession();
  user=session?.user||null;
  if(!user)return null;
  const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();
  if(error)throw error;
  state=data?.data&&typeof data.data==="object"?data.data:{};
  state.tasks=Array.isArray(state.tasks)?state.tasks:[];
  state.timeBlocks=Array.isArray(state.timeBlocks)?state.timeBlocks:[];
  state.eventGroups=Array.isArray(state.eventGroups)&&state.eventGroups.length?state.eventGroups:[{id:"default",name:"기본",color:"#8fa9c4"}];
  state.projects=Array.isArray(state.projects)?state.projects:[];
  state.ui=state.ui&&typeof state.ui==="object"?state.ui:{};
  const range=state.ui.timelineRange&&typeof state.ui.timelineRange==="object"?state.ui.timelineRange:{};
  state.ui.timelineRange={start:Number(range.start)||360,end:Number(range.end)||1320};
  normalizeCompletionRepeats(state);
  return state
}

async function writeState(mutator,source="habit-workspace"){
  await readState();
  if(!state||!user)return false;
  mutator(state);
  const {error}=await supabase.from("onekan_state").upsert({user_id:user.id,data:state},{onConflict:"user_id"});
  if(error)throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed",{detail:{source}}));
  $("#reloadCloudBtn")?.click();
  scheduleRender(80);
  return true
}

function group(task){return state.eventGroups.find(item=>item.id===task.groupId)||state.eventGroups[0]}
function manualOrderValue(item){const value=Number(item?.manualOrder);return Number.isFinite(value)?value:1000000000}
function completionDate(task){
  if(task.completedDate)return task.completedDate;
  if(task.completedAt){const date=new Date(task.completedAt);if(!Number.isNaN(date.getTime()))return key(date)}
  return task.date||""
}
function displayDate(task){return task.done?completionDate(task):task.date||""}
function repeatRule(task){return task.recurrence||task.repeatRule||null}
function repeatLabel(task){
  const recurrence=repeatRule(task);
  if(!recurrence?.frequency)return"";
  const interval=Math.max(1,Number(recurrence.interval||1));
  if(recurrence.frequency==="daily")return interval===1?"완료 후 1일":`완료 후 ${interval}일`;
  if(recurrence.frequency==="weekly")return interval===1?"완료 후 1주":`완료 후 ${interval}주`;
  if(recurrence.frequency==="monthly")return interval===1?"완료 후 1개월":`완료 후 ${interval}개월`;
  return"반복"
}
function allHabits(){return state.tasks.filter(task=>task.isHabit)}
function habitsForDate(date){
  return allHabits()
    .filter(task=>task.done?completionDate(task)===date:task.date===date)
    .sort((a,b)=>Number(a.done)-Number(b.done)||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko"))
}
function listHabits(tab){
  const today=todayKey();
  let rows=allHabits();
  if(tab==="upcoming")rows=rows.filter(task=>!task.done&&task.date&&task.date>=today);
  else if(tab==="someday")rows=rows.filter(task=>!task.done&&!task.date);
  else if(tab==="done")rows=rows.filter(task=>task.done);
  return [...rows].sort((a,b)=>{
    const ad=displayDate(a),bd=displayDate(b);
    if(tab==="upcoming")return String(ad||"9999").localeCompare(String(bd||"9999"))||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko");
    return String(bd||"").localeCompare(String(ad||""))||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko")
  })
}
function projectName(task){return state.projects.find(project=>project.id===task.projectId)?.title||""}

function itemMarkup(task,{compact=false,manual=false,date="",dateLabel=""}={}){
  const area=group(task),repeat=repeatLabel(task),project=projectName(task),rowDate=date||displayDate(task)||"",listDate=dateLabel?String(dateLabel):"";
  const manualAttrs=manual?` data-manual-row data-manual-kind="task" data-manual-id="${esc(task.id)}"`:"";
  return `<div class="uw-item uw-task${task.done?" done":""}" style="--uw-group:${esc(area?.color||"#8fa9c4")}" data-context-kind="task" data-context-id="${esc(task.id)}" data-habit-item="1" data-uw-kind="task" data-id="${esc(task.id)}" data-date="${esc(rowDate)}"${manualAttrs}>
    <button class="uw-check${task.done?" checked":""}" style="--uw-check-color:${esc(area?.color||"#8fa9c4")}" data-habit-complete="${esc(task.id)}" type="button" aria-label="${task.done?"완료 취소":"완료"}">${task.done?"✓":""}</button>
    <span class="uw-event-dot" aria-hidden="true"></span>
    <span class="uw-item-title">${esc(task.title||"이름 없는 습관")}</span>
    ${listDate?`<span class="uw-item-time">${esc(listDate)}</span>`:""}
    ${compact?"":`${repeat?`<span class="uw-item-time">↻ ${esc(repeat)}</span>`:""}${project?`<span class="uw-item-time">${esc(project)}</span>`:""}`}
    <button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button>
  </div>`
}
function quickAdd(dateValue="",compact=false){
  return `<button class="uw-empty-hit uw-task-inline-add" data-habit-quick-add="${esc(dateValue)}" type="button" aria-label="습관 입력">${compact?"＋":"＋ 습관 입력"}</button>`
}

function listMarkup(){
  const rows=listHabits(habitListTab);
  if(habitListTab==="all"){
    const add=`<div class="uw-list uw-task-main-list" data-date="${todayKey()}">${quickAdd(todayKey())}</div>`;
    return add+(rows.length?`<div class="uw-list uw-task-main-list uw-flat-all-list">${rows.map(task=>{const date=displayDate(task);return itemMarkup(task,{date,dateLabel:date?dayLabel(fromKey(date)):"언젠가"})}).join("")}</div>`:'<div class="empty">표시할 습관이 없어요.</div>')
  }
  if(habitListTab==="someday"){
    const grouped=state.eventGroups.map(groupInfo=>({groupInfo,rows:rows.filter(task=>group(task).id===groupInfo.id)})).filter(entry=>entry.rows.length);
    const add=`<div class="uw-list uw-task-main-list" data-date="" data-uw-someday-drop>${quickAdd("")}</div>`;
    return add+(grouped.length
      ? `<div class="uw-task-grouped-list">${grouped.map(({groupInfo,rows:groupRows})=>`<section class="uw-task-group-section" style="--uw-group:${esc(groupInfo.color)}"><div class="uw-task-group-heading"><span class="uw-task-group-dot"></span><strong>${esc(groupInfo.name)}</strong></div><div class="uw-list uw-task-main-list" data-date="" data-group-id="${esc(groupInfo.id)}" data-uw-someday-drop data-manual-list>${groupRows.map(task=>itemMarkup(task,{manual:true})).join("")}</div></section>`).join("")}</div>`
      : '<div class="empty">언젠가 습관이 없어요.</div>')
  }
  const groups=new Map();
  for(const task of rows){const date=displayDate(task);if(!date)continue;if(!groups.has(date))groups.set(date,[]);groups.get(date).push(task)}
  const dates=[...groups.keys()].sort((a,b)=>habitListTab==="upcoming"?a.localeCompare(b):b.localeCompare(a));
  const undated=habitListTab==="all"?rows.filter(task=>!displayDate(task)):[];
  const add=habitListTab==="all"||habitListTab==="upcoming"?`<div class="uw-list uw-task-main-list" data-date="${todayKey()}">${quickAdd(todayKey())}</div>`:"";
  const dated=dates.map(date=>`<section class="uw-date-group"><div class="uw-date-label"><span>${dayLabel(fromKey(date),true)}</span></div><div class="uw-list uw-task-main-list" data-date="${date}" data-task-drop-date="${date}" data-manual-list>${groups.get(date).map(task=>itemMarkup(task,{manual:true,date})).join("")}</div></section>`).join("");
  const someday=undated.length?`<section class="uw-date-group"><div class="uw-date-label"><span>언젠가</span></div><div class="uw-list uw-task-main-list" data-date="" data-uw-someday-drop data-manual-list>${undated.map(task=>itemMarkup(task,{manual:true})).join("")}</div></section>`:"";
  return add+(dated||someday?`<div class="uw-task-grouped-list">${dated}${someday}</div>`:'<div class="empty">표시할 습관이 없어요.</div>')
}

function calendarTitle(){
  if(habitCalendarView==="month")return`${habitCursor.getFullYear()}년 ${habitCursor.getMonth()+1}월`;
  if(habitCalendarView==="week"){const start=addDays(habitCursor,-habitCursor.getDay());return`${dayLabel(start)} – ${dayLabel(addDays(start,6))}`}
  return dayLabel(habitCursor,true)
}
function calendarNav(){
  return `<div class="uw-task-calendar-nav"><button class="uw-icon-btn" data-habit-cal-prev type="button" aria-label="이전 기간">‹</button><strong>${esc(calendarTitle())}</strong><div><button class="uw-task-today" data-habit-cal-today type="button">오늘</button><button class="uw-icon-btn" data-habit-cal-next type="button" aria-label="다음 기간">›</button></div></div>`
}
function monthCalendar(){
  const year=habitCursor.getFullYear(),month=habitCursor.getMonth(),first=new Date(year,month,1,12),start=addDays(first,-first.getDay());
  return `<div class="uw-task-month-grid">${["일","월","화","수","목","금","토"].map(label=>`<div class="uw-task-dow">${label}</div>`).join("")}${Array.from({length:42},(_,index)=>{
    const date=addDays(start,index),dateKey=key(date),rows=habitsForDate(dateKey);
    return `<section class="uw-task-month-cell uw-month-cell${date.getMonth()!==month?" outside":""}${dateKey===todayKey()?" today":""}" data-habit-date="${dateKey}"><span class="uw-task-day-number">${date.getDate()}</span><div class="uw-list" data-date="${dateKey}" data-task-drop-date="${dateKey}">${rows.slice(0,4).map(task=>itemMarkup(task,{compact:true,date:dateKey})).join("")}${rows.length>4?`<span class="uw-item-time">+${rows.length-4}</span>`:""}${quickAdd(dateKey,true)}</div></section>`
  }).join("")}</div>`
}
function boardDay(date,showDate=true){
  const dateKey=key(date),rows=habitsForDate(dateKey),head=showDate?`<div class="uw-day-head"><strong>${dayLabel(date,true)}</strong></div>`:"";
  return `<section class="uw-task-board-day${dateKey===todayKey()?" today":""}">${head}<div class="uw-list" data-date="${dateKey}" data-task-drop-date="${dateKey}">${rows.map(task=>itemMarkup(task,{date:dateKey})).join("")}${quickAdd(dateKey)}</div></section>`
}

function habitTimelineTiming(task,date){
  if(task.notionStart){
    const start=new Date(task.notionStart),end=new Date(task.notionEnd||task.notionStart);
    if(!Number.isNaN(start.getTime()))return{timed:true,time:start.getHours()*60+start.getMinutes(),duration:Math.max(SLOT,Math.round((end-start)/60000/SLOT)*SLOT||SLOT)}
  }
  const block=state.timeBlocks.find(item=>item.taskId===task.id&&(item.date===date||item.date===task.date));
  if(block&&Number.isFinite(Number(block.startMinute)))return{timed:true,time:Number(block.startMinute),duration:Math.max(SLOT,Number(block.duration)||SLOT)};
  return{timed:false,time:null,duration:SLOT}
}
function layoutHabitTimeline(entries){
  const rows=[...entries].sort((a,b)=>a.time-b.time||b.duration-a.duration);let cluster=[],clusterEnd=-Infinity;
  const flush=()=>{if(!cluster.length)return;const laneEnds=[];for(const entry of cluster){let lane=laneEnds.findIndex(end=>end<=entry.time);if(lane<0)lane=laneEnds.length;entry.lane=lane;laneEnds[lane]=entry.time+entry.duration}const columns=Math.max(1,laneEnds.length);cluster.forEach(entry=>entry.columns=columns);cluster=[];clusterEnd=-Infinity};
  for(const entry of rows){if(cluster.length&&entry.time>=clusterEnd)flush();cluster.push(entry);clusterEnd=Math.max(clusterEnd,entry.time+entry.duration)}flush();return rows
}
function habitTimelineBlock(entry,date,start){
  const task=entry.task,area=group(task),done=Boolean(task.done),width=100/entry.columns,left=entry.lane*width;
  return`<div class="uw-time-entry uw-item uw-task${done?" done":""}" style="top:${((entry.time-start)/SLOT)*SLOT_H+1}px;height:${Math.max(18,(entry.duration/SLOT)*SLOT_H-2)}px;left:calc(${left}% + 1px);width:calc(${width}% - 2px);right:auto;--uw-group:${esc(area?.color||"#8fa9c4")}" data-context-kind="task" data-context-id="${esc(task.id)}" data-habit-item="1" data-uw-kind="task" data-id="${esc(task.id)}" data-date="${esc(date)}" data-time="${entry.time}" data-duration="${entry.duration}"><button class="uw-resize-handle top" data-uw-resize="top" type="button"></button><button class="uw-check${done?" checked":""}" style="--uw-check-color:${esc(area?.color||"#8fa9c4")}" data-habit-complete="${esc(task.id)}" type="button" aria-label="${done?"완료 취소":"완료"}">${done?"✓":""}</button><span class="uw-item-title">${esc(task.title||"이름 없는 습관")}</span><button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button><button class="uw-select-circle" type="button"></button><button class="uw-resize-handle bottom" data-uw-resize="bottom" type="button"></button></div>`
}
function habitCurrentTimeMarkup(date,start,end){
  const now=new Date(),minute=now.getHours()*60+now.getMinutes(),visible=date===key(now)&&minute>=start&&minute<=end,top=Math.max(0,Math.min(((end-start)/SLOT)*SLOT_H,((minute-start)/SLOT)*SLOT_H));
  return`<div class="uw-current-time${visible?" active":""}" data-current-date="${date}" style="top:${top}px${visible?"":";display:none"}"><span></span></div>`
}
function habitTimelineDay(date,showDate=true){
  const dateKey=key(date),start=state.ui.timelineRange.start,end=state.ui.timelineRange.end,rows=habitsForDate(dateKey).map(task=>({task,...habitTimelineTiming(task,dateKey)})),untimed=rows.filter(entry=>!entry.timed),timed=layoutHabitTimeline(rows.filter(entry=>entry.timed&&entry.time>=start&&entry.time<end));
  let labels="";for(let minute=start;minute<end;minute+=SLOT){if(minute%60===0)labels+=`<span class="uw-time-label" style="top:${((minute-start)/SLOT)*SLOT_H}px">${pad(minute/60)}:00</span>`}
  const allDay=`<div class="uw-all-day" data-date="${dateKey}" data-uw-all-day-drop><span class="uw-all-day-label">하루종일</span><div class="uw-all-day-list" data-date="${dateKey}" data-task-drop-date="${dateKey}">${untimed.map(entry=>itemMarkup(entry.task,{compact:true,date:dateKey})).join("")||quickAdd(dateKey)}</div></div>`;
  const head=showDate?`<div class="uw-day-head"><strong>${dayLabel(date,true)}</strong></div>`:"";
  return`<section class="uw-day${dateKey===todayKey()?" uw-today":""}" data-date="${dateKey}">${head}${allDay}<div class="uw-timeline" style="height:${((end-start)/SLOT)*SLOT_H}px"><div class="uw-time-labels">${labels}</div><div class="uw-time-lane">${habitCurrentTimeMarkup(dateKey,start,end)}${timed.map(entry=>habitTimelineBlock(entry,dateKey,start)).join("")}</div></div></section>`
}
function habitTimeline(){
  const count=habitCalendarView==="week"?7:1,start=habitCalendarView==="week"?addDays(habitCursor,-habitCursor.getDay()):habitCursor;
  return`<div class="uw-task-timeline-scroll"><div class="uw-planner-days" style="--uw-days:${count}">${Array.from({length:count},(_,index)=>habitTimelineDay(addDays(start,index),count>1)).join("")}</div></div>`
}
function weekCalendar(){
  const start=addDays(habitCursor,-habitCursor.getDay());
  return `<div class="uw-task-board-grid" style="--uw-task-days:7">${Array.from({length:7},(_,index)=>boardDay(addDays(start,index))).join("")}</div>`
}
function dayCalendar(){
  return `<div class="uw-task-board-grid" style="--uw-task-days:1">${boardDay(habitCursor,false)}</div>`
}
function calendarMarkup(){
  const layout=habitCalendarView==="month"?"board":habitCalendarLayout;
  const body=habitCalendarView==="month"?monthCalendar():layout==="timeline"?habitTimeline():habitCalendarView==="week"?weekCalendar():dayCalendar();
  return `<section class="uw-task-calendar-shell">${calendarNav()}${body}</section>`
}
function renderSubnav(){
  const nav=$("#habitPageSubnav");
  if(!nav)return;
  if(habitMode==="list"){
    nav.innerHTML=`<div class="uw-task-list-tabs"><div class="seg">${[["all","전체"],["upcoming","예정"],["someday","언젠가"],["done","완료"]].map(([id,label])=>`<button class="${habitListTab===id?"active":""}" data-habit-list-tab="${id}" type="button">${label}</button>`).join("")}</div></div>`;
    return
  }
  const month=habitCalendarView==="month";
  const label=month?"월은 보드 보기":habitCalendarLayout==="board"?"타임라인으로 보기":"보드로 보기";
  nav.innerHTML=`<div class="uw-task-calendar-tabs"><div class="seg">${[["month","월"],["week","주"],["day","일"]].map(([id,text])=>`<button class="${habitCalendarView===id?"active":""}" data-habit-cal-view="${id}" type="button">${text}</button>`).join("")}</div><button class="uw-layout-toggle" data-habit-cal-layout-toggle type="button"${month?' disabled title="월 보기는 보드로 고정돼요"':""}>${label}</button></div>`
}
async function render(){
  const page=$("#page-repeat"),host=$("#repeatOverviewBody");
  if(!page||!host||!page.classList.contains("active")||rendering)return;
  rendering=true;
  try{
    await readState();
    if(!state){host.innerHTML='<div class="empty">로그인 후 습관을 확인할 수 있어요.</div>';return}
    document.querySelectorAll("[data-habit-mode]").forEach(button=>button.classList.toggle("active",button.dataset.habitMode===habitMode));
    renderSubnav();
    host.innerHTML=habitMode==="calendar"?calendarMarkup():listMarkup();
  }catch(error){
    console.error("habit workspace render failed",error);
    host.innerHTML='<div class="empty">습관을 불러오지 못했어요.</div>';
  }finally{rendering=false}
}
function scheduleRender(delay=40){clearTimeout(renderTimer);renderTimer=setTimeout(render,delay)}

async function addHabit(title,date){
  const clean=String(title||"").trim();
  if(!clean)return;
  try{
    await writeState(current=>{
      const groupId=current.eventGroups?.[0]?.id||"default";
      current.tasks.push({
        id:uid(),title:clean,date:date||null,done:false,isHabit:true,groupId,
        createdAt:new Date().toISOString(),
        recurrence:{frequency:"daily",interval:1,completionBased:true}
      })
    },"habit-add")
  }catch(error){console.error("habit add failed",error);showToast("습관을 추가하지 못했어요.")}
}
function openHabitInline(button,dateValue=""){
  if(!button?.isConnected)return;
  const form=document.createElement("form");
  form.className="uw-inline-form";
  form.innerHTML='<input type="text" placeholder="습관 입력" aria-label="습관 입력" autocomplete="off">';
  button.replaceWith(form);
  const input=$("input",form);
  let saving=false,cancelled=false;
  const commit=async()=>{
    if(saving||cancelled)return;
    const title=input?.value.trim()||"";
    if(!title){cancelled=true;scheduleRender(0);return}
    saving=true;
    await addHabit(title,dateValue||null)
  };
  form.addEventListener("submit",event=>{event.preventDefault();commit()});
  form.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();cancelled=true;scheduleRender(0)}});
  form.addEventListener("focusout",()=>setTimeout(()=>{if(!cancelled&&!saving&&form.isConnected&&!form.contains(document.activeElement))commit()},120));
  requestAnimationFrame(()=>input?.focus())
}

async function toggleHabit(id){
  try{
    await writeState(current=>{
      const task=current.tasks.find(item=>item.id===id&&item.isHabit);
      if(!task)return;
      if(task.done){
        if(!undoRepeatingTaskCompletion(current,task))showToast("이후 완료 기록이 있어 이 습관은 되돌릴 수 없어요.")
      }else if(task.recurrence?.frequency){
        completeRepeatingTask(current,task,new Date())
      }else{
        task.done=true;task.completedAt=new Date().toISOString();task.completedDate=todayKey()
      }
    },"habit-complete")
  }catch(error){console.error("habit completion failed",error);showToast("완료 상태를 변경하지 못했어요.")}
}

function wire(){
  document.addEventListener("click",event=>{
    const mode=event.target.closest("[data-habit-mode]");
    if(mode){habitMode=mode.dataset.habitMode;scheduleRender(0);return}
    const tab=event.target.closest("[data-habit-list-tab]");
    if(tab){habitListTab=tab.dataset.habitListTab;scheduleRender(0);return}
    const view=event.target.closest("[data-habit-cal-view]");
    if(view){habitCalendarView=view.dataset.habitCalView;scheduleRender(0);return}
    const layout=event.target.closest("[data-habit-cal-layout-toggle]");
    if(layout&&!layout.disabled){habitCalendarLayout=habitCalendarLayout==="board"?"timeline":"board";scheduleRender(0);return}
    if(event.target.closest("[data-habit-cal-prev]")){habitCursor=habitCalendarView==="month"?new Date(habitCursor.getFullYear(),habitCursor.getMonth()-1,1,12):addDays(habitCursor,habitCalendarView==="week"?-7:-1);scheduleRender(0);return}
    if(event.target.closest("[data-habit-cal-next]")){habitCursor=habitCalendarView==="month"?new Date(habitCursor.getFullYear(),habitCursor.getMonth()+1,1,12):addDays(habitCursor,habitCalendarView==="week"?7:1);scheduleRender(0);return}
    if(event.target.closest("[data-habit-cal-today]")){habitCursor=fromKey(todayKey());scheduleRender(0);return}
    const check=event.target.closest("[data-habit-complete]");
    if(check){event.preventDefault();event.stopPropagation();toggleHabit(check.dataset.habitComplete);return}
    const quick=event.target.closest("[data-habit-quick-add]");
    if(quick){event.preventDefault();event.stopPropagation();openHabitInline(quick,quick.dataset.habitQuickAdd||"");return}
    if(event.target.closest('[data-page="repeat"]'))scheduleRender(30)
  },true);
  document.addEventListener("onekan:state-changed",event=>{
    if(event.detail?.source!=="habit-workspace"&&$("#page-repeat")?.classList.contains("active"))scheduleRender(60)
  })
}
function init(){
  wire();
  if($("#page-repeat")?.classList.contains("active"))scheduleRender(0)
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
