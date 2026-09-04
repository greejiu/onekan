import { onekanStateStore } from "./supabase.js";
import { normalizeCompletionRepeats } from "./repeat-after-completion.js?v=1";

const $=(selector,root=document)=>root.querySelector(selector);
const pad=(value)=>String(value).padStart(2,"0");
const key=(date)=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
const fromKey=(value)=>new Date(`${value}T12:00:00`);
const esc=(value)=>String(value??"").replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[character]));
const todayKey=()=>{const date=new Date();date.setHours(date.getHours()-3);return key(date)};

let activeHabitId=null;
let activeTask=null;
let activeSeries=[];
let cursor=new Date();
let longPressTimer=null;
let longPressPoint=null;

async function readSeries(id){
  const state=await onekanStateStore.read();
  if(!state)return null;
  state.tasks=Array.isArray(state.tasks)?state.tasks:[];
  normalizeCompletionRepeats(state);
  const target=state.tasks.find((task)=>task.id===id&&task.isHabit);
  if(!target)return null;
  const seriesId=target.repeatSeriesId||target.id;
  const series=state.tasks.filter((task)=>task.isHabit&&(task.repeatSeriesId||task.id)===seriesId);
  return {target,series};
}

function installStyle(){
  if($("#habitHistoryViewStyle"))return;
  const style=document.createElement("style");style.id="habitHistoryViewStyle";style.textContent=`
    .habit-history-overlay{position:fixed;inset:0;z-index:12000;display:none;place-items:center;padding:18px;background:rgba(21,27,36,.28);backdrop-filter:blur(2px)}
    .habit-history-overlay.open{display:grid}.habit-history-panel{width:min(480px,100%);max-height:min(760px,90vh);overflow:auto;border:1px solid var(--line);border-radius:16px;background:var(--panel,#fff);box-shadow:0 22px 70px rgba(15,23,42,.22)}
    .habit-history-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;padding:18px 18px 12px;border-bottom:1px solid var(--line)}.habit-history-title{display:grid;gap:4px;min-width:0}.habit-history-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px}.habit-history-title span{color:var(--muted);font-size:11px}
    .habit-history-close,.habit-history-nav button{border:0;background:transparent;color:var(--text);cursor:pointer}.habit-history-close{width:32px;height:32px;border-radius:8px;font-size:20px}.habit-history-close:hover,.habit-history-nav button:hover{background:var(--panel-soft)}
    .habit-history-summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:14px 18px}.habit-history-summary strong{font-size:22px}.habit-history-summary span{color:var(--muted);font-size:11px}.habit-history-summary b{font-size:12px;color:var(--accent-dark)}
    .habit-history-nav{display:grid;grid-template-columns:36px minmax(0,1fr) 36px;align-items:center;margin:0 18px 12px}.habit-history-nav button{height:34px;border-radius:8px;font-size:20px}.habit-history-nav strong{text-align:center;font-size:13px}
    .habit-history-weekdays,.habit-history-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.habit-history-weekdays{padding:0 18px;color:var(--muted);font-size:10px;text-align:center}.habit-history-weekdays span{padding:6px 0}.habit-history-grid{gap:5px;padding:0 18px 18px}
    .habit-history-day{position:relative;display:grid;place-items:center;aspect-ratio:1;border:1px solid transparent;border-radius:10px;color:var(--muted);font-size:11px}.habit-history-day.scheduled{border-color:var(--line);color:var(--text);background:var(--panel-soft)}.habit-history-day.completed{border-color:color-mix(in srgb,var(--accent) 65%,var(--line));background:color-mix(in srgb,var(--accent) 15%,#fff);color:var(--accent-dark);font-weight:700}.habit-history-day.future{opacity:.45}.habit-history-day.today{box-shadow:inset 0 0 0 1.5px var(--accent)}.habit-history-check{position:absolute;right:5px;bottom:3px;font-size:10px;font-weight:800}.habit-history-blank{aspect-ratio:1}.habit-history-note{padding:0 18px 18px;color:var(--muted);font-size:10px;line-height:1.5}#globalContextMenu [data-habit-history-action].hidden{display:none}
    @media(max-width:520px){.habit-history-overlay{padding:8px;align-items:end}.habit-history-panel{max-height:88vh;border-radius:16px 16px 0 0}.habit-history-head{padding-top:16px}}
  `;document.head.appendChild(style)
}

function ensureOverlay(){
  if($("#habitHistoryOverlay"))return;const overlay=document.createElement("div");overlay.id="habitHistoryOverlay";overlay.className="habit-history-overlay";overlay.innerHTML=`<section class="habit-history-panel" role="dialog" aria-modal="true" aria-labelledby="habitHistoryTitle"><div class="habit-history-head"><div class="habit-history-title"><strong id="habitHistoryTitle">습관 기록</strong><span>실제로 완료한 날을 월별로 확인해요.</span></div><button class="habit-history-close" type="button" aria-label="기록 보기 닫기">×</button></div><div class="habit-history-summary"><strong id="habitHistoryCount">0회</strong><span>이번 달 완료</span><b id="habitHistoryNext">다음 예정 없음</b></div><div class="habit-history-nav"><button type="button" data-habit-history-prev aria-label="이전 달">‹</button><strong id="habitHistoryMonth"></strong><button type="button" data-habit-history-next aria-label="다음 달">›</button></div><div class="habit-history-weekdays"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div><div class="habit-history-grid" id="habitHistoryGrid"></div><div class="habit-history-note">다음 예정일은 마지막 완료일을 기준으로 계산돼요.</div></section>`;document.body.appendChild(overlay);overlay.addEventListener("click",(event)=>{if(event.target===overlay||event.target.closest(".habit-history-close"))closeOverlay();if(event.target.closest("[data-habit-history-prev]")){cursor.setMonth(cursor.getMonth()-1);renderCalendar()}if(event.target.closest("[data-habit-history-next]")){cursor.setMonth(cursor.getMonth()+1);renderCalendar()}})
}
function closeOverlay(){$("#habitHistoryOverlay")?.classList.remove("open")}
function completionDates(){const dates=new Set();for(const task of activeSeries){for(const [date,done] of Object.entries(task.recurrenceDone||{}))if(done===true)dates.add(date);if(task.done){if(task.completedDate)dates.add(task.completedDate);else if(task.completedAt)dates.add(key(new Date(task.completedAt)));else if(task.date)dates.add(task.date)}}return dates}
function activeNextDate(){const active=activeSeries.find((task)=>task.recurrence?.frequency&&!task.done);return active?.date||null}
function shortDate(value){if(!value)return"";const date=fromKey(value);return `${date.getMonth()+1}/${date.getDate()}`}
function renderCalendar(){
  if(!activeTask)return;const year=cursor.getFullYear(),month=cursor.getMonth(),first=new Date(year,month,1,12),lastDay=new Date(year,month+1,0,12).getDate(),today=todayKey(),doneDates=completionDates(),nextDate=activeNextDate();let completed=0,html="";for(let i=0;i<first.getDay();i+=1)html+='<div class="habit-history-blank" aria-hidden="true"></div>';for(let day=1;day<=lastDay;day+=1){const date=new Date(year,month,day,12),dateKey=key(date),done=doneDates.has(dateKey),scheduled=dateKey===nextDate,future=dateKey>today;if(done)completed+=1;const classes=["habit-history-day"];if(scheduled)classes.push("scheduled");if(done)classes.push("completed");if(future)classes.push("future");if(dateKey===today)classes.push("today");const label=`${year}년 ${month+1}월 ${day}일${done?", 완료":scheduled?", 다음 예정":""}`;html+=`<div class="${classes.join(" ")}" aria-label="${esc(label)}"><span>${day}</span>${done?'<span class="habit-history-check">✓</span>':""}</div>`}$("#habitHistoryTitle").textContent=activeTask.title||"습관 기록";$("#habitHistoryMonth").textContent=`${year}년 ${month+1}월`;$("#habitHistoryCount").textContent=`${completed}회`;$("#habitHistoryNext").textContent=nextDate?`다음 ${shortDate(nextDate)}`:"반복 종료";$("#habitHistoryGrid").innerHTML=html
}
async function openHistory(id){try{const result=await readSeries(id);if(!result)return;activeTask=result.target;activeSeries=result.series;cursor=new Date();cursor.setDate(1);renderCalendar();$("#habitHistoryOverlay")?.classList.add("open")}catch(error){console.error("habit history load failed",error)}}
function habitIdFromElement(element){const row=element?.closest?.('[data-habit-item="1"][data-context-kind="task"][data-context-id],.onekan-repeat-row[data-context-kind="task"][data-context-id]');if(!row)return null;if(row.dataset.habitItem==="1")return row.dataset.contextId;return row.querySelector(".onekan-repeat-kind")?.textContent?.trim()==="습관"?row.dataset.contextId:null}
function syncMenuButton(id){const menu=$("#globalContextMenu");if(!menu)return;let button=menu.querySelector("[data-habit-history-action]");if(!button){button=document.createElement("button");button.type="button";button.setAttribute("role","menuitem");button.setAttribute("data-habit-history-action","1");button.textContent="기록 보기";const toggle=menu.querySelector('[data-context-action="toggle-habit"]'),duplicate=menu.querySelector('[data-context-action="duplicate"]');if(toggle)toggle.insertAdjacentElement("afterend",button);else if(duplicate)menu.insertBefore(button,duplicate);else menu.prepend(button)}activeHabitId=id||null;button.classList.toggle("hidden",!activeHabitId);if(activeHabitId)button.dataset.habitId=activeHabitId;else delete button.dataset.habitId}
function installContextBridge(){document.addEventListener("contextmenu",(event)=>{const element=event.target instanceof Element?event.target:null;const id=habitIdFromElement(element);setTimeout(()=>syncMenuButton(id),0)},true);document.addEventListener("pointerdown",(event)=>{if(event.pointerType==="mouse")return;const element=event.target instanceof Element?event.target:null,id=habitIdFromElement(element);clearTimeout(longPressTimer);longPressPoint=id?{id,x:event.clientX,y:event.clientY}:null;if(!longPressPoint)return;longPressTimer=setTimeout(()=>syncMenuButton(longPressPoint?.id||null),590)},true);document.addEventListener("pointermove",(event)=>{if(!longPressPoint)return;if(Math.hypot(event.clientX-longPressPoint.x,event.clientY-longPressPoint.y)>10){clearTimeout(longPressTimer);longPressTimer=null;longPressPoint=null}},true);const cancel=()=>{clearTimeout(longPressTimer);longPressTimer=null;longPressPoint=null};document.addEventListener("pointerup",cancel,true);document.addEventListener("pointercancel",cancel,true);document.addEventListener("click",(event)=>{const button=event.target.closest?.("[data-habit-history-action]");if(!button)return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();const id=button.dataset.habitId||activeHabitId;$("#globalContextMenu")?.classList.remove("open");if(id)openHistory(id)},true);document.addEventListener("keydown",(event)=>{if(event.key==="Escape"&&$("#habitHistoryOverlay")?.classList.contains("open"))closeOverlay()})}
function init(){installStyle();ensureOverlay();installContextBridge()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
