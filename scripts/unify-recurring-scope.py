from pathlib import Path

ROOT = Path('.')
app = ROOT / 'js/unified-workspace.js'
index = ROOT / 'index.html'
text = app.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    text = text.replace(old, new, 1)

# 1) Persist event occurrence overrides alongside task/habit overrides.
replace_once(
'''  s.habitOverrides=s.habitOverrides&&typeof s.habitOverrides==="object"?s.habitOverrides:{};
  s.taskOverrides=s.taskOverrides&&typeof s.taskOverrides==="object"?s.taskOverrides:{};''',
'''  s.habitOverrides=s.habitOverrides&&typeof s.habitOverrides==="object"?s.habitOverrides:{};
  s.taskOverrides=s.taskOverrides&&typeof s.taskOverrides==="object"?s.taskOverrides:{};
  s.eventOverrides=s.eventOverrides&&typeof s.eventOverrides==="object"?s.eventOverrides:{};''',
'normalize event overrides'
)

# 2) Add event occurrence helpers.
event_on_date = '''function eventOnDate(eventItem,date){
  const start=key(new Date(eventItem.start)),end=eventItem.allDay&&eventItem.end?key(new Date(eventItem.end)):start;
  if(!eventItem.recurrence?.frequency)return date>=start&&date<=end;
  const span=Math.max(0,dayDistance(start,end));
  for(let offset=0;offset<=span;offset++){
    const occurrenceStart=key(addDays(fromKey(date),-offset));
    if(recurrenceOn(eventItem,start,occurrenceStart))return true
  }
  return false
}
'''
event_helpers = event_on_date + '''function eventOverride(source,date,id,create=false){if(!source||!date||!id)return null;if(create){source.eventOverrides||={};source.eventOverrides[date]||={};source.eventOverrides[date][id]||={}}return source.eventOverrides?.[date]?.[id]||null}
function cleanEventOverride(source,date,id){const value=source.eventOverrides?.[date]?.[id];if(value&&Object.keys(value).length===0)delete source.eventOverrides[date][id];if(source.eventOverrides?.[date]&&Object.keys(source.eventOverrides[date]).length===0)delete source.eventOverrides[date]}
function eventOccurrenceSourceForDate(event,date){
  if(!event?.recurrence?.frequency)return null;
  const start=key(new Date(event.start)),end=event.allDay&&event.end?key(new Date(event.end)):start,span=Math.max(0,dayDistance(start,end));
  for(let offset=0;offset<=span;offset++){
    const sourceDate=key(addDays(fromKey(date),-offset));
    if(recurrenceOn(event,start,sourceDate))return sourceDate
  }
  return null
}
function eventOccurrenceCoversDate(event,date){const start=key(new Date(event.start)),end=event.allDay&&event.end?key(new Date(event.end)):start;return date>=start&&date<=end}
function effectiveEventOccurrence(event,sourceDate,override=null){
  const targetDate=override&&Object.prototype.hasOwnProperty.call(override,"date")?override.date:sourceDate;
  const masterStart=new Date(event.start),masterEnd=new Date(event.end||event.start);
  const allDay=override&&Object.prototype.hasOwnProperty.call(override,"allDay")?Boolean(override.allDay):Boolean(event.allDay);
  const item={...event,title:override?.title??event.title,allDay,_occurrenceSource:sourceDate,_occurrenceDate:targetDate};
  if(allDay){
    const masterStartKey=key(masterStart),masterEndKey=event.allDay&&event.end?key(masterEnd):masterStartKey,span=Math.max(0,dayDistance(masterStartKey,masterEndKey));
    item.start=new Date(`${targetDate}T12:00:00`).toISOString();
    item.end=new Date(`${key(addDays(fromKey(targetDate),span))}T12:00:00`).toISOString();
    return item
  }
  const startMinute=override&&Object.prototype.hasOwnProperty.call(override,"startMinute")?Number(override.startMinute):masterStart.getHours()*60+masterStart.getMinutes();
  const duration=override&&Number.isFinite(Number(override.duration))?Math.max(SLOT,Number(override.duration)):Math.max(SLOT,Math.round((masterEnd-masterStart)/60000/SLOT)*SLOT);
  const start=new Date(`${targetDate}T${pad(Math.floor(startMinute/60))}:${pad(startMinute%60)}:00`);
  item.start=start.toISOString();item.end=new Date(start.getTime()+duration*60000).toISOString();
  return item
}
function eventOccurrencesForDate(date,source=state){
  const rows=[];
  for(const event of source.events){
    if(!event.recurrence?.frequency){if(eventOnDate(event,date))rows.push(event);continue}
    const normalSource=eventOccurrenceSourceForDate(event,date);
    if(normalSource){
      const override=eventOverride(source,normalSource,event.id);
      if(!override?.hidden){const item=effectiveEventOccurrence(event,normalSource,override);if(eventOccurrenceCoversDate(item,date))rows.push(item)}
    }
    for(const [sourceDate,byEvent] of Object.entries(source.eventOverrides||{})){
      if(sourceDate===normalSource)continue;
      const override=byEvent?.[event.id];
      if(!override||override.hidden||!Object.prototype.hasOwnProperty.call(override,"date"))continue;
      const item=effectiveEventOccurrence(event,sourceDate,override);
      if(eventOccurrenceCoversDate(item,date))rows.push(item)
    }
  }
  return rows
}
'''
replace_once(event_on_date, event_helpers, 'event override helpers')

# 3) Use effective event occurrences everywhere schedules are rendered.
replace_once(
'  const events=state.events.filter(event=>eventOnDate(event,k)).map(event=>({kind:"event",item:event,timed:!event.allDay,time:event.allDay?null:new Date(event.start).getHours()*60+new Date(event.start).getMinutes(),duration:event.allDay?null:Math.max(SLOT,Math.round((new Date(event.end||event.start)-new Date(event.start))/60000/SLOT)*SLOT)}));',
'  const events=eventOccurrencesForDate(k).map(event=>({kind:"event",item:event,timed:!event.allDay,time:event.allDay?null:new Date(event.start).getHours()*60+new Date(event.start).getMinutes(),duration:event.allDay?null:Math.max(SLOT,Math.round((new Date(event.end||event.start)-new Date(event.start))/60000/SLOT)*SLOT)}));',
'planner event occurrences'
)
replace_once(
'function schedules(k){return state.events.filter(e=>eventOnDate(e,k)).sort((a,b)=>new Date(a.start)-new Date(b.start))}',
'function schedules(k){return eventOccurrencesForDate(k).sort((a,b)=>new Date(a.start)-new Date(b.start))}',
'schedule event occurrences'
)

# Event and task occurrence source must travel through list/timeline DOM records.
old_occ = 'const occurrence=kind==="task"&&item._occurrenceSource?` data-occurrence-source="${item._occurrenceSource}"`:"";'
if text.count(old_occ) < 1:
    raise SystemExit('item occurrence source marker not found')
text = text.replace(old_occ, 'const occurrence=(kind==="task"||kind==="event")&&item._occurrenceSource?` data-occurrence-source="${item._occurrenceSource}"`:"";')
old_timed_occ = '${x.kind==="task"&&x.item._occurrenceSource?` data-occurrence-source="${x.item._occurrenceSource}"`:""}'
if old_timed_occ not in text:
    raise SystemExit('timed occurrence source marker not found')
text = text.replace(old_timed_occ, '${(x.kind==="task"||x.kind==="event")&&x.item._occurrenceSource?` data-occurrence-source="${x.item._occurrenceSource}"`:""}')

# 4) Show an existing event occurrence override when editing that occurrence.
replace_once(
'''  const sourceDate=occurrenceSource||date;
  const displayTitle=old&&kind==="habit"&&date?(habitOverride(state,date,old.id)?.title||old.title):old&&kind==="task"&&old.recurrence?.frequency&&sourceDate?(taskOverride(state,sourceDate,old.id)?.title||old.title):old?.title;''',
'''  const sourceDate=occurrenceSource||date;
  const eventEditItem=old&&kind==="event"&&old.recurrence?.frequency&&sourceDate?effectiveEventOccurrence(old,sourceDate,eventOverride(state,sourceDate,old.id)):old;
  const displayTitle=old&&kind==="habit"&&date?(habitOverride(state,date,old.id)?.title||old.title):old&&kind==="task"&&old.recurrence?.frequency&&sourceDate?(taskOverride(state,sourceDate,old.id)?.title||old.title):old&&kind==="event"?eventEditItem?.title:old?.title;''',
'event edit display item'
)
replace_once(
'${withTime?`<input type="time" value="${old&&kind==="event"&&!old.allDay?timeOf(old.start):time!==null?`${pad(Math.floor(time/60))}:${pad(time%60)}`:""}" aria-label="시간">`:""}',
'${withTime?`<input type="time" value="${eventEditItem&&kind==="event"&&!eventEditItem.allDay?timeOf(eventEditItem.start):time!==null?`${pad(Math.floor(time/60))}:${pad(time%60)}`:""}" aria-label="시간">`:""}',
'event edit time value'
)

# Add recurring event scope to inline edits.
replace_once(
'''    const existingTaskOverride=old&&kind==="task"&&old.recurrence?.frequency&&sourceDate?taskOverride(state,sourceDate,old.id):null;
    const taskScope=old&&kind==="task"&&old.recurrence?.frequency?(existingTaskOverride?"day":await askTaskScope(old,sourceDate||old.date)):null;
    if(old&&kind==="task"&&old.recurrence?.frequency&&!taskScope){saving=false;scheduleRender(0);return}''',
'''    const existingTaskOverride=old&&kind==="task"&&old.recurrence?.frequency&&sourceDate?taskOverride(state,sourceDate,old.id):null;
    const taskScope=old&&kind==="task"&&old.recurrence?.frequency?(existingTaskOverride?"day":await askTaskScope(old,sourceDate||old.date)):null;
    if(old&&kind==="task"&&old.recurrence?.frequency&&!taskScope){saving=false;scheduleRender(0);return}
    const existingEventOverride=old&&kind==="event"&&old.recurrence?.frequency&&sourceDate?eventOverride(state,sourceDate,old.id):null;
    const eventScope=old&&kind==="event"&&old.recurrence?.frequency?(existingEventOverride?"day":await askEventScope("change",old,sourceDate||key(new Date(old.start)))):null;
    if(old&&kind==="event"&&old.recurrence?.frequency&&!eventScope){saving=false;scheduleRender(0);return}''',
'event inline scope'
)
replace_once(
'''        if(kind==="task"&&target.recurrence?.frequency&&taskScope==="day"){
          const override=taskOverride(current,sourceDate||target.date,target.id,true);''',
'''        if(kind==="event"&&target.recurrence?.frequency&&eventScope==="day"){
          const occurrenceDate=sourceDate||key(new Date(target.start)),override=eventOverride(current,occurrenceDate,target.id,true);
          override.title=value;
          if(withTime){
            if(timeValue){const[hour,minute]=timeValue.split(":").map(Number);override.startMinute=hour*60+minute;override.duration=duration;override.allDay=false}
            else{override.allDay=true;delete override.startMinute;delete override.duration}
          }
          return
        }
        if(kind==="task"&&target.recurrence?.frequency&&taskScope==="day"){
          const override=taskOverride(current,sourceDate||target.date,target.id,true);''',
'event day inline edit'
)

# 5) One shared wording across schedule/task/habit recurring scope dialogs.
old_scope = '''function installActionUI(){if($("#uwSelectionBar"))return;document.body.insertAdjacentHTML("beforeend",'<div class="uw-selection-bar" id="uwSelectionBar"><button data-uw-action="edit">수정</button><button data-uw-action="duplicate">복제</button><button data-uw-action="group">영역</button><button data-uw-action="convert">전환</button><button class="danger" data-uw-action="delete">삭제</button><button data-uw-action="cancel">취소</button></div><div class="uw-context" id="uwContext"></div><dialog class="app-dialog uw-habit-scope-dialog" id="uwHabitScopeDialog"><div class="uw-scope-body"><h3 id="uwHabitScopeTitle">습관 변경</h3><p id="uwHabitScopeMessage"></p><div class="dialog-actions"><button class="soft-btn" data-uw-habit-scope="cancel" type="button">취소</button><button class="soft-btn" data-uw-habit-scope="day" type="button">이 날만</button><button class="primary-btn" data-uw-habit-scope="all" type="button">전체 반복</button></div></div></dialog>')}
function askHabitScope(mode,habit,date){const dialog=$("#uwHabitScopeDialog");if(!dialog)return Promise.resolve(null);$("#uwHabitScopeTitle").textContent=mode==="delete"?"습관 삭제":"습관 변경";$("#uwHabitScopeMessage").textContent=mode==="delete"?`${dayLabel(fromKey(date),true)}의 ‘${habit?.title||"습관"}’을 어떻게 삭제할까요?`:`${dayLabel(fromKey(date),true)}의 ‘${habit?.title||"습관"}’ 변경 범위를 선택해 주세요.`;const dayButton=dialog.querySelector('[data-uw-habit-scope="day"]'),allButton=dialog.querySelector('[data-uw-habit-scope="all"]');dayButton.textContent=mode==="delete"?"이 날만 숨기기":"이 날만 변경";allButton.textContent=mode==="delete"?"습관 전체 삭제":"전체 반복 변경";dialog.showModal();return new Promise(resolve=>{habitScopeResolve=resolve})}
function askTaskScope(task,date){const dialog=$("#uwHabitScopeDialog");if(!dialog)return Promise.resolve(null);$("#uwHabitScopeTitle").textContent="반복 할일 변경";$("#uwHabitScopeMessage").textContent=`${dayLabel(fromKey(date),true)}의 ‘${task?.title||"할일"}’을 어떻게 변경할까요?`;const dayButton=dialog.querySelector('[data-uw-habit-scope="day"]'),allButton=dialog.querySelector('[data-uw-habit-scope="all"]');dayButton.textContent="이 할일만 수정";allButton.textContent="모든 반복 할일 수정";dialog.showModal();return new Promise(resolve=>{habitScopeResolve=resolve})}'''
new_scope = '''function installActionUI(){if($("#uwSelectionBar"))return;document.body.insertAdjacentHTML("beforeend",'<div class="uw-selection-bar" id="uwSelectionBar"><button data-uw-action="edit">수정</button><button data-uw-action="duplicate">복제</button><button data-uw-action="group">영역</button><button data-uw-action="convert">전환</button><button class="danger" data-uw-action="delete">삭제</button><button data-uw-action="cancel">취소</button></div><div class="uw-context" id="uwContext"></div><dialog class="app-dialog uw-habit-scope-dialog" id="uwHabitScopeDialog"><div class="uw-scope-body"><h3 id="uwHabitScopeTitle">반복 항목 변경</h3><p id="uwHabitScopeMessage"></p><div class="dialog-actions"><button class="soft-btn" data-uw-habit-scope="cancel" type="button">취소</button><button class="soft-btn" data-uw-habit-scope="day" type="button">이 날만 변경</button><button class="primary-btn" data-uw-habit-scope="all" type="button">전체 변경</button></div></div></dialog>')}
function askRecurringScope(mode,label,item,date){const dialog=$("#uwHabitScopeDialog");if(!dialog)return Promise.resolve(null);const deleting=mode==="delete";$("#uwHabitScopeTitle").textContent=`반복 ${label} ${deleting?"삭제":"변경"}`;$("#uwHabitScopeMessage").textContent=`${dayLabel(fromKey(date),true)}의 ‘${item?.title||label}’ ${deleting?"삭제":"변경"} 범위를 선택해 주세요.`;const dayButton=dialog.querySelector('[data-uw-habit-scope="day"]'),allButton=dialog.querySelector('[data-uw-habit-scope="all"]');dayButton.textContent=deleting?"이 날만 삭제":"이 날만 변경";allButton.textContent=deleting?"전체 삭제":"전체 변경";dialog.showModal();return new Promise(resolve=>{habitScopeResolve=resolve})}
function askHabitScope(mode,habit,date){return askRecurringScope(mode,"습관",habit,date)}
function askTaskScope(task,date,mode="change"){return askRecurringScope(mode,"할일",task,date)}
function askEventScope(mode,event,date){return askRecurringScope(mode,"일정",event,date)}'''
replace_once(old_scope, new_scope, 'unified recurring scope dialog')

# 6) Scope deletion for recurring habits, tasks and events; existing overrides do not re-ask.
old_delete_prep = '''  if(name==="delete"){
    const habitRecords=records.filter(record=>record.kind==="habit"),otherRecords=records.filter(record=>record.kind!=="habit"),decisions=[];
    for(const record of habitRecords){const habit=state.habitTemplates.find(item=>item.id===record.id);if(!habit)continue;const scope=await askHabitScope("delete",habit,record.date||todayKey());if(scope)decisions.push({...record,date:record.date||todayKey(),scope})}
    if(decisions.length)await write(current=>decisions.forEach(record=>{if(record.scope==="day"){habitOverride(current,record.date,record.id,true).hidden=true;return}current.habitTemplates=current.habitTemplates.filter(item=>item.id!==record.id);Object.values(current.habitDays).forEach(day=>delete day[record.id]);Object.values(current.habitOverrides||{}).forEach(day=>delete day[record.id])}));
    records=otherRecords;
    if(!records.length){clearSelection();return}
  }'''
new_delete_prep = '''  if(name==="delete"){
    const decisions=[],otherRecords=[];
    for(const record of records){
      if(record.kind==="habit"){
        const habit=state.habitTemplates.find(item=>item.id===record.id);if(!habit)continue;
        const date=record.date||todayKey(),existing=habitOverride(state,date,record.id),scope=existing?"day":await askHabitScope("delete",habit,date);
        if(scope)decisions.push({...record,date,scope});
        continue
      }
      if(record.kind==="task"){
        const task=state.tasks.find(item=>item.id===record.id);
        if(task?.recurrence?.frequency){const date=record.occurrenceSource||record.date||task.date,existing=taskOverride(state,date,record.id),scope=existing?"day":await askTaskScope(task,date,"delete");if(scope)decisions.push({...record,date,scope});continue}
      }
      if(record.kind==="event"){
        const event=state.events.find(item=>item.id===record.id);
        if(event?.recurrence?.frequency){const date=record.occurrenceSource||record.date||key(new Date(event.start)),existing=eventOverride(state,date,record.id),scope=existing?"day":await askEventScope("delete",event,date);if(scope)decisions.push({...record,date,scope});continue}
      }
      otherRecords.push(record)
    }
    if(decisions.length)await write(current=>decisions.forEach(record=>{
      if(record.kind==="habit"){
        if(record.scope==="day"){habitOverride(current,record.date,record.id,true).hidden=true;return}
        current.habitTemplates=current.habitTemplates.filter(item=>item.id!==record.id);Object.values(current.habitDays).forEach(day=>delete day[record.id]);Object.values(current.habitOverrides||{}).forEach(day=>delete day[record.id]);return
      }
      if(record.kind==="task"){
        if(record.scope==="day"){taskOverride(current,record.date,record.id,true).hidden=true;return}
        current.tasks=current.tasks.filter(item=>item.id!==record.id);current.timeBlocks=current.timeBlocks.filter(item=>item.taskId!==record.id);Object.values(current.taskOverrides||{}).forEach(day=>delete day[record.id]);return
      }
      if(record.kind==="event"){
        if(record.scope==="day"){eventOverride(current,record.date,record.id,true).hidden=true;return}
        current.events=current.events.filter(item=>item.id!==record.id);Object.values(current.eventOverrides||{}).forEach(day=>delete day[record.id])
      }
    }));
    records=otherRecords;
    if(!records.length){clearSelection();return}
  }'''
replace_once(old_delete_prep, new_delete_prep, 'recurring delete scopes')

# 7) Timed recurring event changes use occurrence override; resize on a fresh occurrence asks scope.
replace_once(
'''  await write(current=>{const start=new Date(`${date}T${pad(Math.floor(startMinute/60))}:${pad(startMinute%60)}:00`);const event=current.events.find(item=>item.id===id);if(!event)return;event.start=start.toISOString();event.end=new Date(start.getTime()+duration*60000).toISOString();event.allDay=false})
}''',
'''  const event=state?.events.find(item=>item.id===id);
  if(!event)return;
  if(event.recurrence?.frequency){
    const sourceDate=occurrenceSource||date||key(new Date(event.start)),existing=eventOverride(state,sourceDate,id),movedDate=(date||null)!==(sourceDate||null),scope=existing||movedDate?"day":await askEventScope("change",event,sourceDate);
    if(!scope)return;
    await write(current=>{const target=current.events.find(item=>item.id===id);if(!target)return;if(scope==="day"){const override=eventOverride(current,sourceDate,id,true);override.date=date;override.startMinute=startMinute;override.duration=duration;override.allDay=false;return}const baseDate=key(new Date(target.start)),start=new Date(`${baseDate}T${pad(Math.floor(startMinute/60))}:${pad(startMinute%60)}:00`);target.start=start.toISOString();target.end=new Date(start.getTime()+duration*60000).toISOString();target.allDay=false});
    return
  }
  await write(current=>{const start=new Date(`${date}T${pad(Math.floor(startMinute/60))}:${pad(startMinute%60)}:00`);const target=current.events.find(item=>item.id===id);if(!target)return;target.start=start.toISOString();target.end=new Date(start.getTime()+duration*60000).toISOString();target.allDay=false})
}''',
'timed recurring event changes'
)

# 8) Untimed recurring event changes use occurrence override.
replace_once(
'''  await write(s=>{const event=s.events.find(x=>x.id===id);if(!event)return;const noon=new Date(`${date}T12:00:00`);event.start=noon.toISOString();event.end=noon.toISOString();event.allDay=true})
}
async function saveDateOnlyChange''',
'''  const event=state?.events.find(item=>item.id===id);
  if(!event)return;
  if(event.recurrence?.frequency){
    const sourceDate=occurrenceSource||date||key(new Date(event.start)),existing=eventOverride(state,sourceDate,id),movedDate=(date||null)!==(sourceDate||null),scope=existing||movedDate?"day":await askEventScope("change",event,sourceDate);
    if(!scope)return;
    await write(current=>{const target=current.events.find(item=>item.id===id);if(!target)return;if(scope==="day"){const override=eventOverride(current,sourceDate,id,true);override.date=date;override.allDay=true;delete override.startMinute;delete override.duration;return}const baseDate=key(new Date(target.start)),noon=new Date(`${baseDate}T12:00:00`);target.start=noon.toISOString();target.end=noon.toISOString();target.allDay=true});
    return
  }
  await write(s=>{const target=s.events.find(x=>x.id===id);if(!target)return;const noon=new Date(`${date}T12:00:00`);target.start=noon.toISOString();target.end=noon.toISOString();target.allDay=true})
}
async function saveDateOnlyChange''',
'untimed recurring event changes'
)

# 9) Date-only moves for recurring events become occurrence overrides rather than moving the series.
old_date_event = '''    const event=s.events.find(x=>x.id===id);
    if(!event)return;
    const oldStart=new Date(event.start);
    const oldEnd=new Date(event.end||event.start);
    const duration=Math.max(0,oldEnd-oldStart);
    const clock=event.allDay?"12:00:00":`${pad(oldStart.getHours())}:${pad(oldStart.getMinutes())}:00`;
    const start=new Date(`${date}T${clock}`);
    event.start=start.toISOString();
    event.end=new Date(start.getTime()+duration).toISOString();'''
new_date_event = '''    const event=s.events.find(x=>x.id===id);
    if(!event)return;
    if(event.recurrence?.frequency){eventOverride(s,occurrenceSource||key(new Date(event.start)),id,true).date=date;return}
    const oldStart=new Date(event.start);
    const oldEnd=new Date(event.end||event.start);
    const duration=Math.max(0,oldEnd-oldStart);
    const clock=event.allDay?"12:00:00":`${pad(oldStart.getHours())}:${pad(oldStart.getMinutes())}:00`;
    const start=new Date(`${date}T${clock}`);
    event.start=start.toISOString();
    event.end=new Date(start.getTime()+duration).toISOString();'''
replace_once(old_date_event, new_date_event, 'date move recurring event override')

app.write_text(text, encoding='utf-8')

html = index.read_text(encoding='utf-8')
old_version = 'js/unified-workspace.js?v=33'
new_version = 'js/unified-workspace.js?v=34'
if html.count(old_version) != 1:
    raise SystemExit(f'cache version: expected 1 occurrence, got {html.count(old_version)}')
index.write_text(html.replace(old_version, new_version, 1), encoding='utf-8')
print('Unified recurring scope UX for events, tasks and habits')
