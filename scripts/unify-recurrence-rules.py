from pathlib import Path

ROOT = Path('.')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)


def replace_between(text, start, end, new, label):
    a = text.find(start)
    if a < 0:
        raise SystemExit(f'{label}: start not found')
    b = text.find(end, a)
    if b < 0:
        raise SystemExit(f'{label}: end not found')
    return text[:a] + new + text[b:]

# ---- unified-workspace.js ----
path = ROOT / 'js/unified-workspace.js'
text = path.read_text()

new_label = '''function recurrenceLabel(item){
  const recurrence=item.recurrence,frequency=recurrence?.frequency,interval=Math.max(1,+recurrence?.interval||1);
  if(frequency==="daily")return interval===1?"매일":`${interval}일마다`;
  if(frequency==="weekly"){
    const weekdays=Array.isArray(recurrence.weekdays)?[...recurrence.weekdays].sort((a,b)=>a-b):[];
    if(interval===1&&weekdays.join(",")==="1,2,3,4,5")return"평일";
    const names=weekdays.map(day=>["일","월","화","수","목","금","토"][day]).join("·");
    if(names)return interval===1?`${names}요일`:`${interval}주마다 · ${names}요일`;
    return interval===1?"매주":`${interval}주마다`
  }
  if(frequency==="monthly")return interval===1?"매월":`${interval}개월마다`;
  return""
}
'''
text = replace_between(text, 'function recurrenceLabel(item){', 'function eventOnDate', new_label, 'recurrence label')

text = replace_once(text,
'''function habitActiveOn(habit,date){if(!habit||!date)return false;if(habit.startDate&&date<habit.startDate)return false;if(habit.endDate&&date>habit.endDate)return false;return true}\n''',
'''function habitActiveOn(habit,date){if(!habit||!date)return false;if(habit.startDate&&date<habit.startDate)return false;if(habit.endDate&&date>habit.endDate)return false;return true}\nfunction habitOccursOn(habit,date,source=state){if(!habit||!date)return false;const recorded=Object.prototype.hasOwnProperty.call(source?.habitDays?.[date]||{},habit.id);if(recorded)return true;if(!habitActiveOn(habit,date))return false;if(!habit.recurrence?.frequency)return true;const base=habit.startDate||habit.recurrence.anchorDate||date;return recurrenceOn(habit,base,date)}\n''',
'habit occurrence helper')

text = replace_once(text,
'''  const habits=state.habitTemplates.flatMap(habit=>{if(!habitActiveOn(habit,k))return[];const override=habitOverride(state,k,habit.id)||{};if(override.hidden)return[];const start=Object.prototype.hasOwnProperty.call(override,"startMinute")?override.startMinute:habit.startMinute;''',
'''  const habits=state.habitTemplates.flatMap(habit=>{if(!habitOccursOn(habit,k))return[];const override=habitOverride(state,k,habit.id)||{};if(override.hidden)return[];const start=Object.prototype.hasOwnProperty.call(override,"startMinute")?override.startMinute:habit.startMinute;''',
'habit daily recurrence')

text = text.replace('days.some(day=>habitActiveOn(h,key(day)))', 'days.some(day=>habitOccursOn(h,key(day)))')
text = text.replace('const date=key(day),active=habitActiveOn(h,date),done=active&&!!state.habitDays[date]?.[h.id];', 'const date=key(day),active=habitOccursOn(h,date),done=active&&!!state.habitDays[date]?.[h.id];')

new_editor = '''function recurrenceEditorMarkup(old,frequency,allowNone=true,includeUntil=true){
  const recurrence=old?.recurrence||{},resolved=recurrence.frequency||frequency||(allowNone?"none":"daily"),interval=Math.max(1,+recurrence.interval||1),weekdays=Array.isArray(recurrence.weekdays)?[...recurrence.weekdays].sort((a,b)=>a-b):[];
  const weekdayPreset=resolved==="weekly"&&interval===1&&weekdays.join(",")==="1,2,3,4,5";
  const custom=(resolved==="daily"&&interval>1)||(resolved==="weekly"&&interval>1)||resolved==="monthly";
  const mode=custom?"custom":weekdayPreset?"weekdays":resolved==="weekly"?"weekly":resolved==="daily"?"daily":allowNone?"none":"daily";
  const type=resolved==="monthly"?"months":resolved==="weekly"?"weeks":"days";
  const showWeekdays=mode==="weekly"||(mode==="custom"&&type==="weeks");
  return`<select class="uw-repeat-select" aria-label="반복">${allowNone?`<option value="none"${mode==="none"?" selected":""}>반복 없음</option>`:""}<option value="daily"${mode==="daily"?" selected":""}>매일</option><option value="weekdays"${mode==="weekdays"?" selected":""}>평일</option><option value="weekly"${mode==="weekly"?" selected":""}>매주</option><option value="custom"${mode==="custom"?" selected":""}>사용자 지정</option></select><div class="uw-repeat-custom"${mode==="custom"?"":" hidden"}><select class="uw-repeat-custom-type" aria-label="사용자 지정 반복 방식"><option value="days"${type==="days"?" selected":""}>일</option><option value="weeks"${type==="weeks"?" selected":""}>주</option><option value="months"${type==="months"?" selected":""}>개월</option></select><label class="uw-repeat-interval"><input type="number" min="1" max="365" value="${interval}" aria-label="반복 간격"><span class="uw-repeat-unit"></span></label></div><div class="uw-repeat-weekdays"${showWeekdays?"":" hidden"}>${["일","월","화","수","목","금","토"].map((label,day)=>`<label><input type="checkbox" value="${day}"${weekdays.includes(day)?" checked":""}><span>${label}</span></label>`).join("")}</div>${includeUntil?`<label class="uw-repeat-until"><span>반복 종료</span><input type="date" value="${recurrence.until||""}" aria-label="반복 종료일"></label>`:""}`
}
function wireRecurrenceEditor(form,baseDate){
  const select=$(".uw-repeat-select",form),custom=$(".uw-repeat-custom",form),type=$(".uw-repeat-custom-type",form),interval=$(".uw-repeat-interval",form),weekdays=$(".uw-repeat-weekdays",form),unit=$(".uw-repeat-unit",form);
  if(!select)return;
  const refresh=()=>{const mode=select.value,customMode=type?.value||"days",open=mode==="custom",showWeekdays=mode==="weekly"||(open&&customMode==="weeks");if(custom)custom.hidden=!open;if(weekdays)weekdays.hidden=!showWeekdays;if(interval)interval.hidden=!open;if(unit)unit.textContent=customMode==="days"?"일마다":customMode==="weeks"?"주마다":"개월마다";if(showWeekdays&&weekdays&&!$("input:checked",weekdays)&&baseDate){const day=fromKey(baseDate).getDay();const input=$(`input[value="${day}"]`,weekdays);if(input)input.checked=true}form.dispatchEvent(new CustomEvent("uw-repeat-refresh",{bubbles:true}))};
  select.addEventListener("change",refresh);type?.addEventListener("change",refresh);refresh()
}
function recurrenceFromEditor(root,baseDate,{includeUntil=true}={}){
  const value=$(".uw-repeat-select",root)?.value||"none";
  if(value==="none"||!baseDate)return null;
  const base=fromKey(baseDate),until=includeUntil?($(".uw-repeat-until input",root)?.value||null):null;
  if(value==="daily")return{frequency:"daily",interval:1,...(until?{until}:{})};
  if(value==="weekdays")return{frequency:"weekly",interval:1,weekdays:[1,2,3,4,5],...(until?{until}:{})};
  const selected=()=>{const values=$$(".uw-repeat-weekdays input:checked",root).map(input=>+input.value);return values.length?values:[base.getDay()]};
  if(value==="weekly")return{frequency:"weekly",interval:1,weekdays:selected(),...(until?{until}:{})};
  const type=$(".uw-repeat-custom-type",root)?.value||"days",interval=Math.max(1,+$(".uw-repeat-interval input",root)?.value||1);
  if(type==="days")return{frequency:"daily",interval,...(until?{until}:{})};
  if(type==="weeks")return{frequency:"weekly",interval,weekdays:selected(),...(until?{until}:{})};
  return{frequency:"monthly",interval,dayOfMonth:base.getDate(),...(until?{until}:{})}
}
'''
text = replace_between(text, 'function recurrenceEditorMarkup(', 'function openInline', new_editor, 'recurrence editor')

text = replace_once(text,
'''  const canRepeat=(kind==="event"||kind==="task")&&!!(date||(old&&kind==="event"?key(new Date(old.start)):old?.date));\n  const frequency=old?.recurrence?.frequency||"none";''',
'''  const repeatBase=date||(old&&kind==="event"?key(new Date(old.start)):old&&kind==="habit"?(old.startDate||date||todayKey()):old?.date);\n  const canRepeat=(kind==="event"||kind==="task"||kind==="habit")&&!!repeatBase;\n  const frequency=old?.recurrence?.frequency||(kind==="habit"?"daily":"none");''',
'open inline repeat base')

text = replace_once(text,
'''${old&&kind==="habit"?`<div class="uw-habit-range-inline" title="모든 습관에 적용되는 기간"><label><span>시작</span><input class="uw-habit-start-date" type="date" value="${esc(old.startDate||"")}" aria-label="습관 시작일"></label><label><span>종료</span><input class="uw-habit-end-date" type="date" value="${esc(old.endDate||"")}" aria-label="습관 종료일"></label></div>`:""}${canRepeat?recurrenceEditorMarkup(old,frequency):""}`;''',
'''${old&&kind==="habit"?`<div class="uw-habit-range-inline" title="모든 습관에 적용되는 기간"><label><span>시작</span><input class="uw-habit-start-date" type="date" value="${esc(old.startDate||"")}" aria-label="습관 시작일"></label><label><span>종료</span><input class="uw-habit-end-date" type="date" value="${esc(old.endDate||"")}" aria-label="습관 종료일"></label></div>`:""}${canRepeat?recurrenceEditorMarkup(old,frequency,kind!=="habit",kind!=="habit"):""}`;''',
'inline recurrence markup options')

old_local = '''  const recurrenceBase=date||(old&&kind==="event"?key(new Date(old.start)):old?.date);\n  wireRecurrenceEditor(form,recurrenceBase);\n  let saving=false,cancelled=false;\n  const recurrenceFor=baseDate=>{\n    const value=$(".uw-repeat-select",form)?.value||"none";\n    if(value==="none"||!baseDate)return null;\n    const base=fromKey(baseDate);\n    const until=$(".uw-repeat-until input",form)?.value||null;\n    if(value!=="custom")return{frequency:value,interval:1,until,...(value==="weekly"?{weekdays:[base.getDay()]}:{}),...(value==="monthly"?{dayOfMonth:base.getDate()}:{})};\n    const type=$(".uw-repeat-custom-type",form)?.value||"days",interval=Math.max(1,+$(".uw-repeat-interval input",form)?.value||1);\n    if(type==="days")return{frequency:"daily",interval,until};\n    if(type==="weekdays"){const selected=$$(".uw-repeat-weekdays input:checked",form).map(input=>+input.value);return{frequency:"weekly",interval:1,weekdays:selected.length?selected:[base.getDay()],until}}\n    if(type==="weeks")return{frequency:"weekly",interval,weekdays:[base.getDay()],until};\n    return{frequency:"monthly",interval,dayOfMonth:base.getDate(),until}\n  };'''
new_local = '''  const recurrenceBase=repeatBase;\n  wireRecurrenceEditor(form,recurrenceBase);\n  let saving=false,cancelled=false;'''
text = replace_once(text, old_local, new_local, 'remove local recurrence parser')

text = replace_once(text,
'''          if(habitScope==="day")habitOverride(current,editDate,target.id,true).title=value;\n          else{target.title=value;if(habitStartDate)target.startDate=habitStartDate;else delete target.startDate;if(habitEndDate)target.endDate=habitEndDate;else delete target.endDate;const override=habitOverride(current,editDate,target.id);if(override){delete override.title;cleanHabitOverride(current,editDate,target.id)}}''',
'''          if(habitScope==="day")habitOverride(current,editDate,target.id,true).title=value;\n          else{target.title=value;if(habitStartDate)target.startDate=habitStartDate;else delete target.startDate;if(habitEndDate)target.endDate=habitEndDate;else delete target.endDate;const base=habitStartDate||target.startDate||editDate;const recurrence=recurrenceFromEditor(form,base,{includeUntil:false});if(recurrence){recurrence.anchorDate=base;target.recurrence=recurrence}else delete target.recurrence;const override=habitOverride(current,editDate,target.id);if(override){delete override.title;cleanHabitOverride(current,editDate,target.id)}}''',
'habit edit recurrence save')

text = text.replace('const recurrence=recurrenceFor(dateChanged&&selectedDate?selectedDate:baseDate);', 'const recurrence=recurrenceFromEditor(form,dateChanged&&selectedDate?selectedDate:baseDate);')
text = text.replace('const recurrence=recurrenceFor(eventDate);', 'const recurrence=recurrenceFromEditor(form,eventDate);')
text = text.replace('const recurrence=recurrenceFor(taskDate);', 'const recurrence=recurrenceFromEditor(form,taskDate);')

new_habit_form = '''function wireHabitForm(){
  const form=$("#habitPageForm");if(!form||form.dataset.uwBound)return;form.dataset.uwBound="1";
  const startInput=$("#habitPageStartDate"),endInput=$("#habitPageEndDate");if(startInput&&!startInput.value)startInput.value=todayKey();endInput?.addEventListener("input",()=>endInput.setCustomValidity(""));
  let control=$("#habitPageRepeatControl");
  const installRepeat=()=>{
    if(!control){control=document.createElement("div");control.id="habitPageRepeatControl";control.className="uw-habit-repeat-control";const groupField=$("#habitPageGroup")?.closest("label");(groupField||$("#habitPageTitle"))?.after(control)}
    control.innerHTML=`<button class="uw-habit-repeat-button active" id="habitPageRepeatButton" type="button" aria-expanded="false" title="반복 설정">↻ <span>매일</span></button><div class="uw-habit-repeat-pop" id="habitPageRepeatPanel" hidden>${recurrenceEditorMarkup({recurrence:{frequency:"daily",interval:1}},"daily",false,false)}</div>`;
    const panel=$("#habitPageRepeatPanel"),button=$("#habitPageRepeatButton");wireRecurrenceEditor(panel,startInput?.value||todayKey());
    const refreshLabel=()=>{const recurrence=recurrenceFromEditor(panel,startInput?.value||todayKey(),{includeUntil:false});const label=recurrenceLabel({recurrence})||"매일";$("span",button).textContent=label;button.classList.toggle("active",!!recurrence)};
    button.addEventListener("click",()=>{panel.hidden=!panel.hidden;button.setAttribute("aria-expanded",String(!panel.hidden))});panel.addEventListener("change",refreshLabel);panel.addEventListener("uw-repeat-refresh",refreshLabel);refreshLabel()
  };
  installRepeat();
  form.addEventListener("submit",async event=>{event.preventDefault();const title=$("#habitPageTitle")?.value.trim(),time=$("#habitPageTime")?.value||"",duration=Math.max(SLOT,+$("#habitPageDuration")?.value||SLOT),groupId=$("#habitPageGroup")?.value||state?.eventGroups?.[0]?.id||"default",startDate=startInput?.value||todayKey(),endDate=endInput?.value||"",panel=$("#habitPageRepeatPanel"),button=form.querySelector('button[type="submit"]');if(!title)return;if(endDate&&endDate<startDate){endInput?.setCustomValidity("종료일은 시작일과 같거나 이후여야 해요.");endInput?.reportValidity();return}const original=button.dataset.defaultLabel||button.textContent;button.dataset.defaultLabel=original;button.disabled=true;button.textContent="추가 중…";try{await write(current=>{const habit={id:uid(),title,duration,groupId,startDate};if(endDate)habit.endDate=endDate;const recurrence=recurrenceFromEditor(panel,startDate,{includeUntil:false})||{frequency:"daily",interval:1};recurrence.anchorDate=startDate;habit.recurrence=recurrence;if(time){const[hour,minute]=time.split(":").map(Number);habit.startMinute=hour*60+minute}current.habitTemplates.push(habit)});form.reset();$("#habitPageGroup").value=groupId;if(startInput)startInput.value=todayKey();if(endInput)endInput.value="";installRepeat()}catch(error){console.error("습관 추가 실패",error);button.textContent="다시 시도"}finally{button.disabled=false;if(button.textContent!=="다시 시도")button.textContent=original}})
}'''
text = replace_between(text, 'function wireHabitForm(){', 'function wireOverdueActions', new_habit_form + '\n', 'habit form repeat UI')
path.write_text(text)

# ---- task-input-controls.js ----
path = ROOT / 'js/task-input-controls.js'
text = path.read_text()
new_repeat_markup = '''function repeatMarkup(){
  return `<select class="uw-repeat-select" aria-label="반복"><option value="none">반복 없음</option><option value="daily">매일</option><option value="weekdays">평일</option><option value="weekly">매주</option><option value="custom">사용자 지정</option></select><div class="uw-repeat-custom" hidden><select class="uw-repeat-custom-type" aria-label="사용자 지정 반복 방식"><option value="days">일</option><option value="weeks">주</option><option value="months">개월</option></select><label class="uw-repeat-interval"><input type="number" min="1" max="365" value="1" aria-label="반복 간격"><span class="uw-repeat-unit">일마다</span></label></div><div class="uw-repeat-weekdays" hidden>${["일","월","화","수","목","금","토"].map((label,day)=>`<label><input type="checkbox" value="${day}"><span>${label}</span></label>`).join("")}</div><label class="uw-repeat-until"><span>반복 종료</span><input type="date" value="" aria-label="반복 종료일"></label>`
}

'''
text = replace_between(text, 'function repeatMarkup(){', 'function wireRepeat', new_repeat_markup, 'compact repeat markup')
new_wire = '''function wireRepeat(panel,baseDate){
  const select=$(".uw-repeat-select",panel),custom=$(".uw-repeat-custom",panel),type=$(".uw-repeat-custom-type",panel),interval=$(".uw-repeat-interval",panel),weekdays=$(".uw-repeat-weekdays",panel),unit=$(".uw-repeat-unit",panel);
  if(!select)return;
  const refresh=()=>{const mode=select.value,customMode=type?.value||"days",open=mode==="custom",showWeekdays=mode==="weekly"||(open&&customMode==="weeks");if(custom)custom.hidden=!open;if(weekdays)weekdays.hidden=!showWeekdays;if(interval)interval.hidden=!open;if(unit)unit.textContent=customMode==="days"?"일마다":customMode==="weeks"?"주마다":"개월마다";if(showWeekdays&&weekdays&&!$("input:checked",weekdays)&&baseDate){const day=new Date(`${baseDate}T12:00:00`).getDay();const input=$(`input[value="${day}"]`,weekdays);if(input)input.checked=true}panel.dispatchEvent(new CustomEvent("uw-repeat-refresh",{bubbles:true}))};
  select.addEventListener("change",refresh);type?.addEventListener("change",refresh);refresh()
}

'''
text = replace_between(text, 'function wireRepeat(panel,baseDate){', 'function icons()', new_wire, 'compact repeat wire')
path.write_text(text)

# ---- task-completed-groups.js import cache ----
path = ROOT / 'js/task-completed-groups.js'
text = path.read_text()
text = replace_once(text, 'import "./task-input-controls.js?v=2";', 'import "./task-input-controls.js?v=3";', 'task input cache')
path.write_text(text)

# ---- css ----
path = ROOT / 'css/unified-workspace.css'
text = path.read_text()
text += '''\n/* Shared recurrence controls */\n.uw-repeat-weekdays{display:flex;align-items:center;gap:4px;flex-wrap:wrap}.uw-repeat-weekdays[hidden]{display:none!important}.uw-repeat-weekdays label{position:relative}.uw-repeat-weekdays input{position:absolute;opacity:0;pointer-events:none}.uw-repeat-weekdays span{display:inline-grid;place-items:center;min-width:28px;height:28px;padding:0 5px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--muted);font-size:10px;cursor:pointer}.uw-repeat-weekdays input:checked+span{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-dark);font-weight:700}.uw-habit-repeat-control{position:relative;display:inline-flex;align-items:center}.uw-habit-repeat-button{height:32px;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--muted);font:inherit;font-size:10px;cursor:pointer;white-space:nowrap}.uw-habit-repeat-button.active,.uw-habit-repeat-button[aria-expanded="true"]{border-color:color-mix(in srgb,var(--accent) 55%,var(--line));background:var(--accent-soft);color:var(--accent-dark)}.uw-habit-repeat-pop{position:absolute;z-index:90;top:calc(100% + 6px);left:0;width:min(330px,calc(100vw - 30px));display:grid;gap:8px;padding:10px;border:1px solid var(--line);border-radius:12px;background:#fff;box-shadow:0 12px 34px #0002}.uw-habit-repeat-pop[hidden]{display:none!important}.uw-habit-repeat-pop .uw-repeat-select{width:100%}.uw-habit-repeat-pop .uw-repeat-custom{display:flex;align-items:center;gap:6px}.uw-habit-repeat-pop .uw-repeat-custom[hidden],.uw-habit-repeat-pop .uw-repeat-interval[hidden]{display:none!important}.uw-habit-repeat-pop .uw-repeat-custom select,.uw-habit-repeat-pop .uw-repeat-interval input{min-height:32px}.uw-inline-form>.uw-repeat-weekdays{flex:1 0 100%}@media(max-width:600px){.uw-habit-repeat-control{position:static}.uw-habit-repeat-pop{position:fixed;right:12px;bottom:14px;left:12px;top:auto;width:auto}.uw-repeat-weekdays span{min-width:32px;height:32px;font-size:11px}}\n'''
path.write_text(text)

# ---- index cache bumps ----
path = ROOT / 'index.html'
text = path.read_text()
text = replace_once(text, 'css/unified-workspace.css?v=29', 'css/unified-workspace.css?v=30', 'css cache')
text = replace_once(text, 'js/unified-workspace.js?v=30', 'js/unified-workspace.js?v=31', 'unified cache')
text = replace_once(text, 'js/task-completed-groups.js?v=3', 'js/task-completed-groups.js?v=4', 'task completed cache')
path.write_text(text)

print('unified recurrence rules patched')
