import { supabase } from "./supabase.js";

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const SLOT=30, START=360, END=1320;
const pad=n=>String(n).padStart(2,"0");
let user=null,state=null,selectedBlockId=null,observer=null,arrangeTimer=null;

function dateKey(d=new Date()){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function todayKey(){const d=new Date();d.setHours(d.getHours()-3);return dateKey(d);}
function clampMinute(minute,duration=SLOT){
  minute=Math.round(Number(minute)/SLOT)*SLOT;
  return Math.max(START,Math.min(minute,END-duration));
}

async function readState(){
  const {data:{session}}=await supabase.auth.getSession();
  user=session?.user||null;
  if(!user)return null;
  const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();
  if(error)throw error;
  state=data?.data&&typeof data.data==="object"?data.data:{};
  state.tasks=Array.isArray(state.tasks)?state.tasks:[];
  state.events=Array.isArray(state.events)?state.events:[];
  state.timeBlocks=Array.isArray(state.timeBlocks)?state.timeBlocks:[];
  state.habitTemplates=Array.isArray(state.habitTemplates)?state.habitTemplates:[];
  return state;
}
async function writeState(mutator){
  const s=await readState();
  if(!s||!user)return;
  mutator(s);
  const {error}=await supabase.from("onekan_state").upsert({user_id:user.id,data:s},{onConflict:"user_id"});
  if(error)throw error;
  state=s;
  $("#reloadCloudBtn")?.click();
  scheduleArrange();
}

function injectStyle(){
  if($("#interactionUpgradeStyles"))return;
  const style=document.createElement("style");
  style.id="interactionUpgradeStyles";
  style.textContent=`
    .overlap-time-selection{position:absolute;left:61px;right:8px;z-index:8;pointer-events:none;border:1.5px dashed #77818c;border-radius:7px;background:rgba(71,85,105,.10)}
    .quick-add-type{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;padding:3px;border:1px solid var(--line);border-radius:9px;background:#f5f7f9}
    .quick-add-type button{min-height:36px;border:0;border-radius:7px;background:transparent;color:var(--muted);cursor:pointer}
    .quick-add-type button.active{background:#fff;color:var(--text);box-shadow:0 1px 2px rgba(15,23,42,.08);font-weight:650}
    .day-cell[data-feature-calendar-date],.week-col[data-feature-calendar-date]{cursor:pointer}
    .day-cell[data-feature-calendar-date]:hover,.week-col[data-feature-calendar-date]:hover{background:#fafbfc}
  `;
  document.head.appendChild(style);
}

function overlapGroups(items,start,end){
  const sorted=[...items].sort((a,b)=>start(a)-start(b)||end(a)-end(b)),groups=[];
  let group=[],maxEnd=-Infinity;
  for(const item of sorted){
    if(group.length&&start(item)>=maxEnd){groups.push(group);group=[];maxEnd=-Infinity;}
    group.push(item);maxEnd=Math.max(maxEnd,end(item));
  }
  if(group.length)groups.push(group);
  return groups;
}
function lanes(group,start,end){
  const ends=[],result=[];
  for(const item of group){
    let lane=ends.findIndex(v=>v<=start(item));
    if(lane<0){lane=ends.length;ends.push(end(item));}else ends[lane]=end(item);
    result.push({item,lane});
  }
  return result.map(x=>({...x,count:ends.length}));
}
function placeInLanes(entries,getElement){
  for(const {item,lane,count} of entries){
    if(count<=1)continue;
    const el=getElement(item); if(!el)continue;
    const width=96/count;
    el.style.left=`${2+width*lane}%`;
    el.style.right="auto";
    el.style.width=`${Math.max(18,width-1)}%`;
    el.style.zIndex=String(10+lane);
  }
}
function arrangeHome(){
  const grid=$("#timeGrid"); if(!grid||!state)return;
  $$(".time-block",grid).forEach(el=>{el.style.left="";el.style.right="";el.style.width="";el.style.zIndex="";});
  const blocks=state.timeBlocks.filter(b=>b.date===todayKey()).map(item=>({item,element:grid.querySelector(`.time-block[data-block-id="${CSS.escape(item.id)}"]`)}));
  const habits=state.habitTemplates.filter(h=>Number.isFinite(Number(h.startMinute))).map(item=>({item,element:grid.querySelector(`.time-block[data-habit-id="${CSS.escape(item.id)}"]`)}));
  const entries=[...blocks,...habits].filter(entry=>entry.element);
  for(const group of overlapGroups(entries,x=>+x.item.startMinute||0,x=>(+x.item.startMinute||0)+(+x.item.duration||SLOT))){
    placeInLanes(lanes(group,x=>+x.item.startMinute||0,x=>(+x.item.startMinute||0)+(+x.item.duration||SLOT)),x=>x.element);
  }
}
function arrangeCalendar(){
  const timeline=$("#calendarBody .day-timeline"); if(!timeline||!state)return;
  const items=$$(".day-timed-event[data-feature-id]",timeline).map(el=>{
    const e=state.events.find(x=>x.id===el.dataset.featureId); if(!e?.start)return null;
    const start=new Date(e.start).getTime(),end=e.end?new Date(e.end).getTime():start+SLOT*60000;
    return {el,start,end:Math.max(end,start+SLOT*60000)};
  }).filter(Boolean);
  items.forEach(x=>{x.el.style.left="";x.el.style.right="";x.el.style.width="";x.el.style.zIndex="";});
  for(const group of overlapGroups(items,x=>x.start,x=>x.end)){
    placeInLanes(lanes(group,x=>x.start,x=>x.end),x=>x.el);
  }
}
async function arrangeAll(){
  try{await readState();arrangeHome();arrangeCalendar();}catch(e){console.error("시간 겹침 배치 실패",e);}
}
function scheduleArrange(){clearTimeout(arrangeTimer);arrangeTimer=setTimeout(arrangeAll,100);}

function wireTimeGrid(){
  const grid=$("#timeGrid"); if(!grid||grid.dataset.overlapWired)return;
  grid.dataset.overlapWired="1";

  grid.addEventListener("drop",async e=>{
    const blockId=e.dataTransfer?.getData("text/time-block-id");
    const taskId=e.dataTransfer?.getData("text/task-id");
    if(!blockId&&!taskId)return;
    const slot=e.target.closest(".time-slot"); if(!slot)return;
    e.preventDefault();e.stopImmediatePropagation();
    const minute=clampMinute(+slot.dataset.minute);
    try{
      await writeState(s=>{
        if(blockId){
          const b=s.timeBlocks.find(x=>x.id===blockId);
          if(b){b.startMinute=clampMinute(minute,+b.duration||SLOT);b.date=todayKey();}
          return;
        }
        const task=s.tasks.find(x=>x.id===taskId); if(!task)return;
        task.date=todayKey();
        s.timeBlocks.push({id:crypto.randomUUID(),taskId:task.id,sourceTitle:task.title,detail:task.title,startMinute:minute,duration:SLOT,date:todayKey()});
      });
    }catch(err){console.error(err);alert("시간 계획을 저장하지 못했어요.");}
  },true);

  let selecting=false,a=0,b=0,preview=null,selectionPointerId=null;
  const rows=()=>$$('.time-slot',grid);
  const rowH=()=>rows()[0]?.getBoundingClientRect().height||20;
  const indexAt=y=>Math.max(0,Math.min(rows().length-1,Math.floor((y-grid.getBoundingClientRect().top)/rowH())));
  const paint=()=>{
    preview?.remove();
    const first=Math.min(a,b),last=Math.max(a,b);
    preview=document.createElement("div");preview.className="overlap-time-selection";
    preview.style.top=`${first*rowH()+2}px`;preview.style.height=`${(last-first+1)*rowH()-4}px`;
    grid.appendChild(preview);
  };
  const clear=()=>{selecting=false;selectionPointerId=null;preview?.remove();preview=null;};

  grid.addEventListener("pointerdown",e=>{
    if((e.pointerType==="mouse"&&e.button!==0)||e.target.closest(".time-block")||!e.target.closest(".time-slot"))return;
    e.preventDefault();e.stopImmediatePropagation();selecting=true;selectionPointerId=e.pointerId;a=b=indexAt(e.clientY);grid.setPointerCapture?.(e.pointerId);paint();
  },true);
  document.addEventListener("pointermove",e=>{if(selecting&&e.pointerId===selectionPointerId){e.preventDefault();b=indexAt(e.clientY);paint();}});
  document.addEventListener("pointerup",async e=>{
    if(!selecting||e.pointerId!==selectionPointerId)return;
    const first=Math.min(a,b),last=Math.max(a,b),startMinute=START+first*SLOT,duration=Math.min(240,(last-first+1)*SLOT);
    clear();
    const blockId=crypto.randomUUID();
    try{
      await writeState(s=>s.timeBlocks.push({id:blockId,taskId:null,sourceTitle:"직접 추가",detail:"새 시간 계획",startMinute,duration,date:todayKey()}));
      setTimeout(()=>document.querySelector(`.time-block[data-block-id="${CSS.escape(blockId)}"]`)?.click(),180);
    }
    catch(err){console.error(err);alert("시간 계획을 저장하지 못했어요.");}
  });
  document.addEventListener("pointercancel",e=>{if(selecting&&e.pointerId===selectionPointerId)clear();});
}

function wireBlockEditor(){
  if(document.documentElement.dataset.overlapEditorWired)return;
  document.documentElement.dataset.overlapEditorWired="1";
  document.addEventListener("click",e=>{
    const block=e.target.closest(".time-block[data-block-id]");
    if(block)selectedBlockId=block.dataset.blockId;
  },true);

  $("#saveBlockBtn")?.addEventListener("click",async e=>{
    if(!selectedBlockId)return;
    e.preventDefault();e.stopImmediatePropagation();
    const detail=$("#blockDetail")?.value.trim()||"시간 계획",duration=+$("#blockDuration")?.value||SLOT,start=+$("#blockStart")?.value;
    try{
      await writeState(s=>{
        const b=s.timeBlocks.find(x=>x.id===selectedBlockId);if(!b)return;
        b.detail=detail;b.startMinute=clampMinute(start,duration);b.duration=duration;
      });
      $("#blockEditor")?.classList.remove("open");
    }catch(err){console.error(err);alert("시간 계획을 저장하지 못했어요.");}
  },true);

  $("#addTimeBlockBtn")?.addEventListener("click",async e=>{
    e.preventDefault();e.stopImmediatePropagation();
    const now=new Date(),minute=clampMinute(Math.ceil((now.getHours()*60+now.getMinutes())/SLOT)*SLOT);
    try{await writeState(s=>s.timeBlocks.push({id:crypto.randomUUID(),taskId:null,sourceTitle:"직접 추가",detail:"새 시간 계획",startMinute:minute,duration:SLOT,date:todayKey()}));}
    catch(err){console.error(err);alert("시간 계획을 저장하지 못했어요.");}
  },true);
}

function calendarDropDate(target){
  return target.closest?.("[data-feature-calendar-date]")?.dataset.featureCalendarDate||null;
}
function wireCalendarSources(){
  $$("#calendarBody [data-calendar-kind][data-calendar-id]").forEach(element=>{
    if(element.dataset.nativeCalendarDragWired)return;
    element.dataset.nativeCalendarDragWired="1";
    element.draggable=true;
    element.addEventListener("dragstart",event=>{
      const kind=element.dataset.calendarKind,id=element.dataset.calendarId;
      if(!kind||!id)return;
      event.dataTransfer.effectAllowed="move";
      event.dataTransfer.setData(kind==="event"?"text/event-id":"text/task-id",id);
      element.classList.add("dragging");
    });
    element.addEventListener("dragend",()=>element.classList.remove("dragging"));
  });
}
function wireCalendarDragStay(){
  if(document.documentElement.dataset.calendarDragStayWired)return;
  document.documentElement.dataset.calendarDragStayWired="1";

  document.addEventListener("dragover",e=>{
    if(!e.target.closest?.("#calendarBody"))return;
    const types=Array.from(e.dataTransfer?.types||[]);
    if(!types.includes("text/task-id")&&!types.includes("text/event-id"))return;
    if(!calendarDropDate(e.target))return;
    e.preventDefault();
  },true);

  document.addEventListener("drop",async e=>{
    if(!e.target.closest?.("#calendarBody"))return;
    const taskId=e.dataTransfer?.getData("text/task-id");
    const eventId=e.dataTransfer?.getData("text/event-id");
    if(!taskId&&!eventId)return;
    const targetDate=calendarDropDate(e.target);
    if(!targetDate)return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    try{
      await writeState(s=>{
        if(taskId){
          const task=s.tasks.find(x=>x.id===taskId);
          if(task)task.date=targetDate;
          return;
        }
        const item=s.events.find(x=>x.id===eventId);
        if(!item?.start)return;
        const oldStart=new Date(item.start);
        const oldEnd=item.end?new Date(item.end):null;
        const duration=oldEnd&&oldEnd>oldStart?oldEnd-oldStart:SLOT*60000;
        const [y,m,d]=targetDate.split("-").map(Number);
        oldStart.setFullYear(y,m-1,d);
        item.start=oldStart.toISOString();
        if(item.end)item.end=new Date(oldStart.getTime()+duration).toISOString();
      });
    }catch(err){
      console.error(err);
      alert("날짜를 이동하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  },true);
}

function observe(){
  if(observer)return;
  const time=$("#timeGrid"),cal=$("#calendarBody");
  observer=new MutationObserver(()=>{wireTimeGrid();wireBlockEditor();wireCalendarSources();wireCalendarDragStay();scheduleArrange();});
  if(time)observer.observe(time,{childList:true,subtree:true});
  if(cal)observer.observe(cal,{childList:true,subtree:true,attributes:true,attributeFilter:["data-feature-id","data-feature-calendar-date"]});
}
async function init(){
  injectStyle();wireTimeGrid();wireBlockEditor();wireCalendarSources();wireCalendarDragStay();observe();
  try{await readState();}catch(e){console.error(e);}
  scheduleArrange();
}

supabase.auth.onAuthStateChange((_event,session)=>{
  user=session?.user||null;
  if(user)setTimeout(init,0);else state=null;
});
const {data:{session}}=await supabase.auth.getSession();
if(session?.user){user=session.user;await init();}
