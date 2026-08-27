import { supabase } from "./supabase.js";

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const pad=n=>String(n).padStart(2,"0");
const todayKey=()=>{const d=new Date();d.setHours(d.getHours()-3);return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const pending=[];

function installStyle(){
  if($("#uwTaskInputControlStyle"))return;
  const style=document.createElement("style");
  style.id="uwTaskInputControlStyle";
  style.textContent=`
    .uw-inline-form.uw-task-compact-input{position:relative;overflow:visible!important;display:flex;align-items:center;gap:5px}
    .uw-inline-form.uw-task-compact-input>input[type="text"]{min-width:0;flex:1}
    .uw-task-input-tools{display:flex;align-items:center;gap:3px;flex:none;margin-left:auto}
    .uw-task-input-tool{display:inline-grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer}
    .uw-task-input-tool:hover,.uw-task-input-tool.active,.uw-task-input-tool[aria-expanded="true"]{background:var(--accent-soft);color:var(--accent)}
    .uw-task-input-tool svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .uw-task-date-native{position:absolute!important;right:38px!important;top:100%!important;width:1px!important;height:1px!important;min-width:1px!important;padding:0!important;border:0!important;opacity:0!important;pointer-events:none!important}
    .uw-task-repeat-pop{position:absolute;z-index:80;top:calc(100% + 6px);right:0;width:min(330px,calc(100vw - 34px));padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--surface,#fff);box-shadow:0 12px 34px #0002;display:grid;gap:8px}
    .uw-task-repeat-pop[hidden]{display:none!important}
    .uw-task-repeat-pop>.uw-repeat-select{width:100%}
    .uw-task-repeat-pop .uw-repeat-custom{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .uw-task-repeat-pop .uw-repeat-custom[hidden],.uw-task-repeat-pop .uw-repeat-weekdays[hidden],.uw-task-repeat-pop .uw-repeat-interval[hidden]{display:none!important}
    .uw-task-repeat-pop .uw-repeat-until{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:4px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}
    .uw-task-repeat-pop .uw-repeat-until input{min-height:32px}
    @media(max-width:600px){.uw-task-input-tool{width:34px;height:34px}.uw-task-repeat-pop{position:fixed;left:12px;right:12px;top:auto;bottom:14px;width:auto}}
  `;
  document.head.appendChild(style)
}

function repeatMarkup(){
  return `<select class="uw-repeat-select" aria-label="반복"><option value="none">반복 없음</option><option value="daily">매일</option><option value="weekly">매주</option><option value="monthly">매월</option><option value="custom">사용자 정의</option></select><div class="uw-repeat-custom" hidden><select class="uw-repeat-custom-type" aria-label="사용자 정의 반복 방식"><option value="days">일마다</option><option value="weekdays">요일마다</option><option value="weeks">주마다</option><option value="months">달마다</option></select><label class="uw-repeat-interval"><input type="number" min="1" max="365" value="1" aria-label="반복 간격"><span class="uw-repeat-unit">주마다</span></label><div class="uw-repeat-weekdays" hidden>${["일","월","화","수","목","금","토"].map((label,day)=>`<label><input type="checkbox" value="${day}"><span>${label}</span></label>`).join("")}</div></div><label class="uw-repeat-until"><span>반복 종료</span><input type="date" value="" aria-label="반복 종료일"></label>`
}

function wireRepeat(panel,baseDate){
  const select=$(".uw-repeat-select",panel),custom=$(".uw-repeat-custom",panel),type=$(".uw-repeat-custom-type",panel),interval=$(".uw-repeat-interval",panel),weekdays=$(".uw-repeat-weekdays",panel),unit=$(".uw-repeat-unit",panel);
  if(!select||!custom)return;
  const refresh=()=>{
    const open=select.value==="custom",mode=type?.value||"weeks";
    custom.hidden=!open;
    if(weekdays)weekdays.hidden=!open||mode!=="weekdays";
    if(interval)interval.hidden=!open||mode==="weekdays";
    if(unit)unit.textContent=mode==="days"?"일마다":mode==="weeks"?"주마다":"달마다";
    if(open&&mode==="weekdays"&&!$("input:checked",weekdays)&&baseDate){
      const day=new Date(`${baseDate}T12:00:00`).getDay();
      const input=$(`input[value="${day}"]`,weekdays);if(input)input.checked=true
    }
    panel.dispatchEvent(new CustomEvent("uw-repeat-refresh",{bubbles:true}))
  };
  select.addEventListener("change",refresh);type?.addEventListener("change",refresh);refresh()
}

function icons(){
  const wrap=document.createElement("div");wrap.className="uw-task-input-tools";
  wrap.innerHTML=`<button class="uw-task-input-tool uw-task-date-button" type="button" aria-label="날짜 변경" title="날짜 변경"><svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path></svg></button><button class="uw-task-input-tool uw-task-repeat-button" type="button" aria-label="반복 설정" title="반복 설정" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M17 2.8 20.5 6 17 9.2"></path><path d="M3.5 10V8.5A2.5 2.5 0 0 1 6 6h14"></path><path d="m7 21.2-3.5-3.2L7 14.8"></path><path d="M20.5 14v1.5A2.5 2.5 0 0 1 18 18H4"></path></svg></button>`;
  return wrap
}

function repeatSnapshot(form,date){
  const select=$(".uw-repeat-select",form),value=select?.value||"none";
  if(value==="none"||!date)return null;
  const until=$(".uw-repeat-until input",form)?.value||null;
  const base=new Date(`${date}T12:00:00`);
  if(value!=="custom")return{frequency:value,interval:1,until,...(value==="weekly"?{weekdays:[base.getDay()]}:{}),...(value==="monthly"?{dayOfMonth:base.getDate()}:{})};
  const type=$(".uw-repeat-custom-type",form)?.value||"days",interval=Math.max(1,+$(".uw-repeat-interval input",form)?.value||1);
  if(type==="days")return{frequency:"daily",interval,until};
  if(type==="weekdays"){const days=$$(".uw-repeat-weekdays input:checked",form).map(x=>+x.value);return{frequency:"weekly",interval:1,weekdays:days.length?days:[base.getDay()],until}}
  if(type==="weeks")return{frequency:"weekly",interval,weekdays:[base.getDay()],until};
  return{frequency:"monthly",interval,dayOfMonth:base.getDate(),until}
}

async function cloud(){
  const {data:{session}}=await supabase.auth.getSession();if(!session?.user)return null;
  const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",session.user.id).maybeSingle();if(error)throw error;
  return{user:session.user,state:data?.data&&typeof data.data==="object"?data.data:{}}
}

async function applyPending(op){
  const loaded=await cloud();if(!loaded)return false;
  const current=loaded.state;current.tasks=Array.isArray(current.tasks)?current.tasks:[];current.timeBlocks=Array.isArray(current.timeBlocks)?current.timeBlocks:[];
  let task=op.editId?current.tasks.find(x=>x.id===op.editId):current.tasks.filter(x=>x.title===op.title&&new Date(x.createdAt||0).getTime()>=op.startedAt-1500).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
  if(!task)return false;
  const oldDate=task.date||"";
  task.date=op.date||null;
  if(op.recurrence)task.recurrence=op.recurrence;else delete task.recurrence;
  if(task.notionStart){
    if(op.date){
      const oldStart=new Date(task.notionStart),oldEnd=new Date(task.notionEnd||task.notionStart),duration=Math.max(30*60000,oldEnd-oldStart);
      const start=new Date(`${op.date}T${pad(oldStart.getHours())}:${pad(oldStart.getMinutes())}:00`);
      task.notionStart=start.toISOString();task.notionEnd=new Date(start.getTime()+duration).toISOString()
    }else{delete task.notionStart;delete task.notionEnd}
  }
  if(op.date)current.timeBlocks.filter(x=>x.taskId===task.id).forEach(x=>x.date=op.date);else current.timeBlocks=current.timeBlocks.filter(x=>x.taskId!==task.id);
  if(oldDate===op.date&&JSON.stringify(task.recurrence||null)===JSON.stringify(op.recurrence||null))return true;
  const {error}=await supabase.from("onekan_state").upsert({user_id:loaded.user.id,data:current},{onConflict:"user_id"});if(error)throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed",{detail:{source:"task-input-controls"}}));
  return true
}

async function flushPending(){
  for(let i=pending.length-1;i>=0;i--){
    const op=pending[i];if(Date.now()-op.startedAt>7000){pending.splice(i,1);continue}
    try{if(await applyPending(op))pending.splice(i,1)}catch(error){console.error("할일 날짜·반복 반영 실패",error)}
  }
}

function arm(form){
  if(form.dataset.uwPatchArmed==="1")return;
  const date=form.dataset.uwTaskSelectedDate||"",initial=form.dataset.uwTaskInitialDate||"";
  if(date===initial)return;
  const title=$("input[type=text]",form)?.value.trim();if(!title)return;
  form.dataset.uwPatchArmed="1";
  pending.push({editId:form.dataset.uwTaskEditId||"",title,date,recurrence:repeatSnapshot(form,date),startedAt:Date.now()});
  setTimeout(flushPending,900)
}

function decorate(form,removedTask=null){
  if(form.dataset.uwTaskCompact==="1")return;
  const title=$("input[type=text]",form);if(!title||title.placeholder!=="할일 입력")return;
  form.dataset.uwTaskCompact="1";form.classList.add("uw-task-compact-input");
  const initial=removedTask?.dataset.date??form.closest("[data-date]")?.dataset.date??"";
  form.dataset.uwTaskInitialDate=initial;form.dataset.uwTaskSelectedDate=initial;
  if(removedTask?.dataset.id)form.dataset.uwTaskEditId=removedTask.dataset.id;
  const tools=icons(),dateButton=$(".uw-task-date-button",tools),repeatButton=$(".uw-task-repeat-button",tools);
  const dateInput=document.createElement("input");dateInput.type="date";dateInput.className="uw-task-date-native";dateInput.value=initial;
  const panel=document.createElement("div");panel.className="uw-task-repeat-pop";panel.hidden=true;
  const existing=[$(".uw-repeat-select",form),$(".uw-repeat-custom",form),$(".uw-repeat-until",form)].filter(Boolean);
  if(existing.length)existing.forEach(node=>panel.appendChild(node));else{panel.innerHTML=repeatMarkup();wireRepeat(panel,initial||todayKey())}
  form.append(tools,dateInput,panel);
  const updateState=()=>{
    const date=form.dataset.uwTaskSelectedDate||"";
    dateButton.classList.toggle("active",!!date);dateButton.title=date?`날짜: ${date}`:"날짜 변경";
    const active=$(".uw-repeat-select",form)?.value!=="none";repeatButton.classList.toggle("active",active)
  };
  dateButton.addEventListener("click",()=>{dateInput.value=form.dataset.uwTaskSelectedDate||"";try{dateInput.showPicker()}catch{dateInput.click()}});
  dateInput.addEventListener("change",()=>{form.dataset.uwTaskSelectedDate=dateInput.value||"";updateState()});
  repeatButton.addEventListener("click",()=>{
    if(!form.dataset.uwTaskSelectedDate){const d=todayKey();form.dataset.uwTaskSelectedDate=d;dateInput.value=d}
    panel.hidden=!panel.hidden;repeatButton.setAttribute("aria-expanded",String(!panel.hidden));updateState()
  });
  panel.addEventListener("change",updateState);panel.addEventListener("uw-repeat-refresh",updateState);
  form.addEventListener("submit",()=>arm(form),true);
  form.addEventListener("focusout",()=>setTimeout(()=>{if(!form.contains(document.activeElement))arm(form)},20));
  updateState()
}

function init(){
  installStyle();
  const observer=new MutationObserver(records=>records.forEach(record=>{
    const removed=[...record.removedNodes].find(node=>node.nodeType===1&&node.matches?.('.uw-item[data-uw-kind="task"]'))||null;
    record.addedNodes.forEach(node=>{
      if(node.nodeType!==1)return;
      if(node.matches?.(".uw-inline-form"))decorate(node,removed);
      $$(".uw-inline-form",node).forEach(form=>decorate(form,null))
    })
  }));
  observer.observe(document.body,{childList:true,subtree:true});
  $$(".uw-inline-form").forEach(form=>decorate(form));
  document.addEventListener("onekan:state-changed",event=>{if(event.detail?.source==="unified"&&pending.length)setTimeout(flushPending,40)})
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
