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

let state=null;
let user=null;
let rendering=false;
let renderTimer=null;
let habitMode="calendar";
let habitListTab="all";
let habitCalendarView="month";
let habitCursor=fromKey(todayKey());

function installStyle(){
  if($("#habitWorkspaceStyle"))return;
  const style=document.createElement("style");
  style.id="habitWorkspaceStyle";
  style.textContent=`
    #page-repeat .onekan-repeat-intro{display:none}
    .habit-workspace{display:grid;gap:12px}
    .habit-subnav{display:flex;justify-content:flex-end;min-height:34px}
    .habit-calendar-nav{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center}
    .habit-calendar-nav>strong{text-align:center;font-size:13px}
    .habit-calendar-nav>div{display:flex;align-items:center;gap:5px}
    .habit-today{height:30px;padding:0 9px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);font:inherit;font-size:10px;cursor:pointer}
    .habit-month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border:1px solid var(--line);border-radius:13px;overflow:hidden;background:#fff}
    .habit-dow{padding:8px 4px;border-bottom:1px solid var(--line);color:var(--muted);font-size:9px;text-align:center}
    .habit-month-cell{min-height:112px;padding:6px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:#fff}
    .habit-month-cell:nth-child(7n){border-right:0}.habit-month-cell.outside{background:var(--panel-soft);opacity:.58}.habit-month-cell.today{box-shadow:inset 0 0 0 1.5px var(--accent)}
    .habit-day-number{display:block;margin:0 0 5px;color:var(--muted);font-size:9px}
    .habit-calendar-items{display:grid;gap:3px}.habit-calendar-more{color:var(--muted);font-size:9px}
    .habit-week-grid{display:grid;grid-template-columns:repeat(7,minmax(150px,1fr));gap:8px;overflow:auto;padding-bottom:4px}
    .habit-board-day{min-height:230px;padding:10px;border:1px solid var(--line);border-radius:12px;background:#fff}.habit-board-day.today{border-color:var(--accent)}
    .habit-board-day h3{margin:0 0 8px;font-size:11px}
    .habit-day-board{min-height:260px;padding:12px;border:1px solid var(--line);border-radius:12px;background:#fff}
    .habit-list-groups{display:grid;gap:12px}.habit-date-group,.habit-area-group{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:#fff}
    .habit-group-heading{display:flex;align-items:center;gap:7px;padding:9px 11px;border-bottom:1px solid var(--line);font-size:10px;color:var(--muted)}
    .habit-group-heading strong{color:var(--text);font-size:11px}
    .habit-area-dot{width:8px;height:8px;border-radius:50%;background:var(--habit-area,var(--accent))}
    .habit-list{display:grid;padding:3px 9px 9px}
    .habit-item{--habit-area:var(--accent);display:grid;grid-template-columns:24px 9px minmax(0,1fr) auto;gap:7px;align-items:center;min-height:42px;padding:6px 5px;border-bottom:1px solid var(--line)}
    .habit-item:last-child{border-bottom:0}.habit-item.done{opacity:.55}.habit-item.done .habit-title{text-decoration:line-through}
    .habit-check{display:grid;place-items:center;width:18px;height:18px;padding:0;border:1.5px solid var(--line-strong);border-radius:5px;background:#fff;color:var(--text);font-size:10px;cursor:pointer}
    .habit-check.checked{background:var(--panel-soft)}
    .habit-dot{width:7px;height:7px;border-radius:50%;background:var(--habit-area)}
    .habit-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600}
    .habit-meta{display:flex;gap:6px;align-items:center;color:var(--muted);font-size:9px;white-space:nowrap}
    .habit-repeat{padding:2px 5px;border-radius:999px;background:var(--panel-soft)}
    .habit-compact{grid-template-columns:18px 7px minmax(0,1fr);min-height:29px;padding:3px;border-bottom:0;border-radius:6px}.habit-compact .habit-meta{display:none}.habit-compact .habit-check{width:15px;height:15px;font-size:8px}.habit-compact .habit-title{font-size:9px}
    .habit-add-form{display:grid;grid-template-columns:minmax(0,1fr) 132px auto;gap:6px;padding:8px;border:1px solid var(--line);border-radius:11px;background:#fff}
    .habit-add-form input{height:34px;min-width:0;padding:0 9px;border:1px solid var(--line);border-radius:8px;background:#fff;font:inherit;font-size:11px}
    .habit-add-form button{height:34px;padding:0 11px;border:1px solid var(--line);border-radius:8px;background:#fff;font:inherit;font-size:10px;cursor:pointer}
    .habit-cell-add{width:24px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer}.habit-cell-add:hover{background:var(--panel-soft)}
    .habit-empty{padding:24px 10px;color:var(--muted);font-size:11px;text-align:center}
    @media(max-width:760px){
      .habit-month-cell{min-height:78px;padding:4px}.habit-compact{grid-template-columns:14px minmax(0,1fr)}.habit-compact .habit-dot{display:none}.habit-compact .habit-check{width:13px;height:13px}.habit-compact .habit-title{font-size:8px}
      .habit-add-form{grid-template-columns:minmax(0,1fr) auto}.habit-add-form input[type=date]{grid-column:1/-1;grid-row:2}.habit-week-grid{grid-template-columns:repeat(7,minmax(130px,1fr))}
    }
  `;
  document.head.appendChild(style)
}

async function readState(){
  const {data:{session}}=await supabase.auth.getSession();
  user=session?.user||null;
  if(!user)return null;
  const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();
  if(error)throw error;
  state=data?.data&&typeof data.data==="object"?data.data:{};
  state.tasks=Array.isArray(state.tasks)?state.tasks:[];
  state.eventGroups=Array.isArray(state.eventGroups)&&state.eventGroups.length?state.eventGroups:[{id:"default",name:"기본",color:"#8fa9c4"}];
  state.projects=Array.isArray(state.projects)?state.projects:[];
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
    .sort((a,b)=>Number(a.done)-Number(b.done)||String(a.title||"").localeCompare(String(b.title||""),"ko"))
}
function listHabits(tab){
  const today=todayKey();
  let rows=allHabits();
  if(tab==="upcoming")rows=rows.filter(task=>!task.done&&task.date&&task.date>=today);
  else if(tab==="someday")rows=rows.filter(task=>!task.done&&!task.date);
  else if(tab==="done")rows=rows.filter(task=>task.done);
  return [...rows].sort((a,b)=>{
    const ad=displayDate(a),bd=displayDate(b);
    if(tab==="upcoming")return String(ad||"9999").localeCompare(String(bd||"9999"))||String(a.title||"").localeCompare(String(b.title||""),"ko");
    return String(bd||"").localeCompare(String(ad||""))||String(a.title||"").localeCompare(String(b.title||""),"ko")
  })
}
function projectName(task){return state.projects.find(project=>project.id===task.projectId)?.title||""}

function itemMarkup(task,{compact=false}={}){
  const area=group(task),repeat=repeatLabel(task),project=projectName(task);
  return `<div class="habit-item uw-item uw-task${task.done?" done":""}${compact?" habit-compact":""}" style="--habit-area:${esc(area?.color||"#8fa9c4")};--uw-group:${esc(area?.color||"#8fa9c4")}" data-context-kind="task" data-context-id="${esc(task.id)}" data-habit-item="1" data-uw-kind="task" data-id="${esc(task.id)}">
    <button class="habit-check${task.done?" checked":""}" data-habit-complete="${esc(task.id)}" type="button" aria-label="${task.done?"완료 취소":"완료"}">${task.done?"✓":""}</button>
    <span class="habit-dot" aria-hidden="true"></span>
    <span class="habit-title uw-item-title">${esc(task.title||"이름 없는 습관")}</span>
    <span class="habit-meta">${repeat?`<span class="habit-repeat">↻ ${esc(repeat)}</span>`:""}${project?`<span>${esc(project)}</span>`:""}</span>
  </div>`
}
function addForm(dateValue="",allowDate=true){
  return `<form class="habit-add-form" data-habit-add-form><input type="text" name="title" maxlength="120" autocomplete="off" placeholder="습관 입력" aria-label="습관 이름">${allowDate?`<input type="date" name="date" value="${esc(dateValue)}" aria-label="습관 예정일">`:""}<button type="submit">추가</button></form>`
}

function listMarkup(){
  const rows=listHabits(habitListTab);
  if(habitListTab==="someday"){
    const grouped=state.eventGroups.map(area=>({area,rows:rows.filter(task=>group(task).id===area.id)})).filter(entry=>entry.rows.length);
    return `<div class="habit-workspace">${addForm("",false)}<div class="habit-list-groups">${grouped.map(({area,rows:areaRows})=>`<section class="habit-area-group" style="--habit-area:${esc(area.color)}"><div class="habit-group-heading"><span class="habit-area-dot"></span><strong>${esc(area.name)}</strong></div><div class="habit-list">${areaRows.map(task=>itemMarkup(task)).join("")}</div></section>`).join("")||'<div class="habit-empty">언젠가 습관이 없어요.</div>'}</div></div>`
  }
  const groups=new Map();
  for(const task of rows){const date=displayDate(task);if(!date)continue;if(!groups.has(date))groups.set(date,[]);groups.get(date).push(task)}
  const dates=[...groups.keys()].sort((a,b)=>habitListTab==="upcoming"?a.localeCompare(b):b.localeCompare(a));
  const undated=habitListTab==="all"?rows.filter(task=>!displayDate(task)):[];
  const dated=dates.map(date=>`<section class="habit-date-group"><div class="habit-group-heading"><strong>${new Intl.DateTimeFormat("ko-KR",{month:"long",day:"numeric",weekday:"short"}).format(fromKey(date))}</strong></div><div class="habit-list">${groups.get(date).map(task=>itemMarkup(task)).join("")}</div></section>`).join("");
  const someday=undated.length?`<section class="habit-date-group"><div class="habit-group-heading"><strong>언젠가</strong></div><div class="habit-list">${undated.map(task=>itemMarkup(task)).join("")}</div></section>`:"";
  const canAdd=habitListTab==="all"||habitListTab==="upcoming";
  return `<div class="habit-workspace">${canAdd?addForm(todayKey(),true):""}<div class="habit-list-groups">${dated}${someday}${!dated&&!someday?'<div class="habit-empty">표시할 습관이 없어요.</div>':""}</div></div>`
}

function calendarTitle(){
  if(habitCalendarView==="month")return`${habitCursor.getFullYear()}년 ${habitCursor.getMonth()+1}월`;
  if(habitCalendarView==="week"){const start=addDays(habitCursor,-habitCursor.getDay());const end=addDays(start,6);return`${start.getMonth()+1}/${start.getDate()} – ${end.getMonth()+1}/${end.getDate()}`}
  return new Intl.DateTimeFormat("ko-KR",{month:"long",day:"numeric",weekday:"short"}).format(habitCursor)
}
function calendarNav(){
  return `<div class="habit-calendar-nav"><button class="uw-icon-btn" data-habit-cal-prev type="button" aria-label="이전 기간">‹</button><strong>${esc(calendarTitle())}</strong><div><button class="habit-today" data-habit-cal-today type="button">오늘</button><button class="uw-icon-btn" data-habit-cal-next type="button" aria-label="다음 기간">›</button></div></div>`
}
function monthCalendar(){
  const year=habitCursor.getFullYear(),month=habitCursor.getMonth(),first=new Date(year,month,1,12),start=addDays(first,-first.getDay());
  return `<div class="habit-month-grid">${["일","월","화","수","목","금","토"].map(label=>`<div class="habit-dow">${label}</div>`).join("")}${Array.from({length:42},(_,index)=>{
    const date=addDays(start,index),dateKey=key(date),rows=habitsForDate(dateKey);
    return `<section class="habit-month-cell${date.getMonth()!==month?" outside":""}${dateKey===todayKey()?" today":""}" data-habit-date="${dateKey}"><span class="habit-day-number">${date.getDate()}</span><div class="habit-calendar-items">${rows.slice(0,4).map(task=>itemMarkup(task,{compact:true})).join("")}${rows.length>4?`<span class="habit-calendar-more">+${rows.length-4}</span>`:""}<button class="habit-cell-add" data-habit-quick-add="${dateKey}" type="button" aria-label="${dateKey} 습관 추가">＋</button></div></section>`
  }).join("")}</div>`
}
function weekCalendar(){
  const start=addDays(habitCursor,-habitCursor.getDay());
  return `<div class="habit-week-grid">${Array.from({length:7},(_,index)=>{const date=addDays(start,index),dateKey=key(date),rows=habitsForDate(dateKey);return`<section class="habit-board-day${dateKey===todayKey()?" today":""}"><h3>${new Intl.DateTimeFormat("ko-KR",{month:"numeric",day:"numeric",weekday:"short"}).format(date)}</h3><div class="habit-list">${rows.map(task=>itemMarkup(task)).join("")}</div><button class="habit-cell-add" data-habit-quick-add="${dateKey}" type="button">＋</button></section>`}).join("")}</div>`
}
function dayCalendar(){
  const date=key(habitCursor),rows=habitsForDate(date);
  return `<section class="habit-day-board"><div class="habit-list">${rows.map(task=>itemMarkup(task)).join("")||'<div class="habit-empty">이 날의 습관이 없어요.</div>'}</div>${addForm(date,true)}</section>`
}
function calendarMarkup(){
  return `<div class="habit-workspace">${calendarNav()}${habitCalendarView==="month"?monthCalendar():habitCalendarView==="week"?weekCalendar():dayCalendar()}</div>`
}
function renderSubnav(){
  const nav=$("#habitPageSubnav");
  if(!nav)return;
  if(habitMode==="list"){
    nav.innerHTML=`<div class="habit-subnav"><div class="seg">${[["all","전체"],["upcoming","예정"],["someday","언젠가"],["done","완료"]].map(([id,label])=>`<button class="${habitListTab===id?"active":""}" data-habit-list-tab="${id}" type="button">${label}</button>`).join("")}</div></div>`;
  }else{
    nav.innerHTML=`<div class="habit-subnav"><div class="seg">${[["month","월"],["week","주"],["day","일"]].map(([id,label])=>`<button class="${habitCalendarView===id?"active":""}" data-habit-cal-view="${id}" type="button">${label}</button>`).join("")}</div></div>`;
  }
}
async function render(){
  const page=$("#page-repeat"),host=$("#repeatOverviewBody");
  if(!page||!host||!page.classList.contains("active")||rendering)return;
  rendering=true;
  try{
    await readState();
    if(!state){host.innerHTML='<div class="habit-empty">로그인 후 습관을 확인할 수 있어요.</div>';return}
    document.querySelectorAll("[data-habit-mode]").forEach(button=>button.classList.toggle("active",button.dataset.habitMode===habitMode));
    renderSubnav();
    host.innerHTML=habitMode==="calendar"?calendarMarkup():listMarkup();
  }catch(error){
    console.error("habit workspace render failed",error);
    host.innerHTML='<div class="habit-empty">습관을 불러오지 못했어요.</div>';
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
    if(event.target.closest("[data-habit-cal-prev]")){habitCursor=habitCalendarView==="month"?new Date(habitCursor.getFullYear(),habitCursor.getMonth()-1,1,12):addDays(habitCursor,habitCalendarView==="week"?-7:-1);scheduleRender(0);return}
    if(event.target.closest("[data-habit-cal-next]")){habitCursor=habitCalendarView==="month"?new Date(habitCursor.getFullYear(),habitCursor.getMonth()+1,1,12):addDays(habitCursor,habitCalendarView==="week"?7:1);scheduleRender(0);return}
    if(event.target.closest("[data-habit-cal-today]")){habitCursor=fromKey(todayKey());scheduleRender(0);return}
    const check=event.target.closest("[data-habit-complete]");
    if(check){event.preventDefault();event.stopPropagation();toggleHabit(check.dataset.habitComplete);return}
    const quick=event.target.closest("[data-habit-quick-add]");
    if(quick){event.preventDefault();const title=window.prompt("습관 이름");if(title)addHabit(title,quick.dataset.habitQuickAdd);return}
    if(event.target.closest('[data-page="repeat"]'))scheduleRender(30)
  },true);
  document.addEventListener("submit",event=>{
    const form=event.target.closest("[data-habit-add-form]");
    if(!form)return;
    event.preventDefault();
    const data=new FormData(form);
    addHabit(data.get("title"),data.get("date")||null)
  },true);
  document.addEventListener("onekan:state-changed",event=>{
    if(event.detail?.source!=="habit-workspace"&&$("#page-repeat")?.classList.contains("active"))scheduleRender(60)
  })
}
function init(){
  installStyle();
  wire();
  if($("#page-repeat")?.classList.contains("active"))scheduleRender(0)
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
