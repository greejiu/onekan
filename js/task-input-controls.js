const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const pad=n=>String(n).padStart(2,"0");
const todayKey=()=>{const d=new Date();d.setHours(d.getHours()-3);return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};

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
    .uw-inline-form.uw-task-compact-input:has(.uw-task-repeat-pop:not([hidden])){z-index:12040!important;overflow:visible!important}
    .uw-time-block-v2-section:has(.uw-task-repeat-pop:not([hidden])){overflow:visible!important;position:relative;z-index:12030}
    .uw-task-repeat-pop{pointer-events:auto}
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
  return `<select class="uw-repeat-select" aria-label="반복"><option value="none">반복 없음</option><option value="daily">매일</option><option value="weekdays">평일</option><option value="weekly">매주</option><option value="custom">사용자 지정</option></select><div class="uw-repeat-custom" hidden><select class="uw-repeat-custom-type" aria-label="사용자 지정 반복 방식"><option value="days">일</option><option value="weeks">주</option><option value="months">개월</option></select><label class="uw-repeat-interval"><input type="number" min="1" max="365" value="1" aria-label="반복 간격"><span class="uw-repeat-unit">일마다</span></label></div><div class="uw-repeat-weekdays" hidden>${["일","월","화","수","목","금","토"].map((label,day)=>`<label><input type="checkbox" value="${day}"><span>${label}</span></label>`).join("")}</div><label class="uw-repeat-until"><span>반복 종료</span><input type="date" value="" aria-label="반복 종료일"></label>`
}

function wireRepeat(panel,baseDate){
  const select=$(".uw-repeat-select",panel),custom=$(".uw-repeat-custom",panel),type=$(".uw-repeat-custom-type",panel),interval=$(".uw-repeat-interval",panel),weekdays=$(".uw-repeat-weekdays",panel),unit=$(".uw-repeat-unit",panel);
  if(!select)return;
  const refresh=()=>{const mode=select.value,customMode=type?.value||"days",open=mode==="custom",showWeekdays=mode==="weekly"||(open&&customMode==="weeks");if(custom)custom.hidden=!open;if(weekdays)weekdays.hidden=!showWeekdays;if(interval)interval.hidden=!open;if(unit)unit.textContent=customMode==="days"?"일마다":customMode==="weeks"?"주마다":"개월마다";if(showWeekdays&&weekdays&&!$("input:checked",weekdays)&&baseDate){const day=new Date(`${baseDate}T12:00:00`).getDay();const input=$(`input[value="${day}"]`,weekdays);if(input)input.checked=true}panel.dispatchEvent(new CustomEvent("uw-repeat-refresh",{bubbles:true}))};
  select.addEventListener("change",refresh);type?.addEventListener("change",refresh);refresh()
}

function icons(){
  const wrap=document.createElement("div");wrap.className="uw-task-input-tools";
  wrap.innerHTML=`<button class="uw-task-input-tool uw-task-date-button" type="button" aria-label="날짜 변경" title="날짜 변경"><svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path></svg></button><button class="uw-task-input-tool uw-task-repeat-button" type="button" aria-label="반복 설정" title="반복 설정" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M17 2.8 20.5 6 17 9.2"></path><path d="M3.5 10V8.5A2.5 2.5 0 0 1 6 6h14"></path><path d="m7 21.2-3.5-3.2L7 14.8"></path><path d="M20.5 14v1.5A2.5 2.5 0 0 1 18 18H4"></path></svg></button>`;
  return wrap
}

function decorate(form,removedItem=null){
  if(form.dataset.uwTaskCompact==="1")return;
  const title=$("input[type=text]",form),entryKind=title?.placeholder==="일정 입력"?"event":title?.placeholder==="할일 입력"?"task":null;if(!entryKind)return;
  form.dataset.uwTaskCompact="1";form.classList.add("uw-task-compact-input");
  const initial=removedItem?.dataset.date??form.dataset.uwEntrySelectedDate??form.closest("[data-date]")?.dataset.date??"";
  form.dataset.uwTaskInitialDate=initial;form.dataset.uwTaskSelectedDate=initial;form.dataset.uwEntrySelectedDate=initial;
  if(removedItem?.dataset.id)form.dataset.uwTaskEditId=removedItem.dataset.id;
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
  dateInput.addEventListener("change",()=>{form.dataset.uwTaskSelectedDate=dateInput.value||"";form.dataset.uwEntrySelectedDate=dateInput.value||"";form.dataset.uwEntryDateChanged="1";updateState()});
  const positionRepeatPanel=()=>{
    if(panel.hidden)return;
    if(!form.closest(".uw-timeline,.uw-time-block-v2-section")){panel.removeAttribute("style");return}
    const rect=repeatButton.getBoundingClientRect(),width=Math.min(330,Math.max(240,window.innerWidth-24));
    const left=Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12));
    panel.style.position="fixed";panel.style.width=`${width}px`;panel.style.left=`${left}px`;panel.style.right="auto";panel.style.bottom="auto";panel.style.zIndex="12050";panel.style.visibility="hidden";
    panel.style.top=`${Math.min(window.innerHeight-12,rect.bottom+6)}px`;
    requestAnimationFrame(()=>{if(panel.hidden)return;const height=panel.getBoundingClientRect().height;const below=rect.bottom+6,above=rect.top-height-6;panel.style.top=`${below+height<=window.innerHeight-12?below:Math.max(12,above)}px`;panel.style.visibility=""})
  };
  repeatButton.addEventListener("click",()=>{
    if(!form.dataset.uwTaskSelectedDate){const d=todayKey();form.dataset.uwTaskSelectedDate=d;form.dataset.uwEntrySelectedDate=d;dateInput.value=d}
    panel.hidden=!panel.hidden;repeatButton.setAttribute("aria-expanded",String(!panel.hidden));updateState();
    if(!panel.hidden)positionRepeatPanel();else panel.removeAttribute("style")
  });
  panel.addEventListener("change",updateState);panel.addEventListener("uw-repeat-refresh",updateState);
  updateState()
}

function init(){
  installStyle();
  const observer=new MutationObserver(records=>records.forEach(record=>{
    const removed=[...record.removedNodes].find(node=>node.nodeType===1&&node.matches?.('.uw-item[data-uw-kind="task"],.uw-item[data-uw-kind="event"]'))||null;
    record.addedNodes.forEach(node=>{
      if(node.nodeType!==1)return;
      if(node.matches?.(".uw-inline-form"))decorate(node,removed);
      $$(".uw-inline-form",node).forEach(form=>decorate(form,null))
    })
  }));
  observer.observe(document.body,{childList:true,subtree:true});
  $$(".uw-inline-form").forEach(form=>decorate(form));
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
