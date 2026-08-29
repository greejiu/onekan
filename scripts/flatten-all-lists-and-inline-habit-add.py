from pathlib import Path
import re

root = Path('.')
unified_path = root / 'js/unified-workspace.js'
habit_path = root / 'js/repeat-overview.js'
index_path = root / 'index.html'

unified = unified_path.read_text()
habit = habit_path.read_text()
index = index_path.read_text()

# 1) Shared item markup: allow flat "all" lists to show a date label without changing the item's drag date.
old = 'function itemMarkup(kind,item,k,compact=false,manual=false){'
new = 'function itemMarkup(kind,item,k,compact=false,manual=false,listDateLabel=""){' 
assert old in unified, 'shared itemMarkup signature not found'
unified = unified.replace(old, new, 1)

old = '  const repeat=recurrenceLabel(item,kind);\n'
new = '  const repeat=recurrenceLabel(item,kind);\n  const listDate=listDateLabel?String(listDateLabel):"";\n'
assert old in unified, 'shared repeat line not found'
unified = unified.replace(old, new, 1)

old = '<span class="uw-item-title">${esc(item.title)}</span>${repeat?'
new = '<span class="uw-item-title">${esc(item.title)}</span>${listDate?`<span class="uw-item-time">${esc(listDate)}</span>`:""}${repeat?'
assert old in unified, 'shared title markup not found'
unified = unified.replace(old, new, 1)

# 2) Schedule ALL: flat list, date-descending, no date group headings.
schedule_re = re.compile(r'function scheduleList\(\)\{.*?\n\}\nfunction scheduleMonthBoard', re.S)
match = schedule_re.search(unified)
assert match, 'scheduleList function not found'
schedule_new = '''function scheduleList(){
  if(scheduleListTab==="someday")return '<div class="uw-schedule-list"><div class="empty">날짜 없는 일정이 없어요.</div></div>';
  const rows=scheduleListRows(scheduleListTab);
  if(!rows.length)return '<div class="uw-schedule-list"><div class="empty">표시할 일정이 없어요.</div></div>';
  if(scheduleListTab==="all"){
    const ordered=[...rows].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||manualOrderValue(a.item)-manualOrderValue(b.item)||new Date(a.item.start)-new Date(b.item.start)||String(a.item.title||"").localeCompare(String(b.item.title||""),"ko"));
    return `<div class="uw-schedule-list"><div class="uw-list uw-task-main-list uw-flat-all-list">${ordered.map(row=>itemMarkup("event",row.item,row.date,false,false,dayLabel(fromKey(row.date)))).join("")}</div></div>`
  }
  const groups=new Map();
  rows.forEach(row=>{if(!groups.has(row.date))groups.set(row.date,[]);groups.get(row.date).push(row.item)});
  const dates=[...groups.keys()].sort((a,b)=>scheduleListTab==="upcoming"?a.localeCompare(b):b.localeCompare(a));
  const canAdd=scheduleListTab==="upcoming";
  return`<div class="uw-schedule-list">${dates.map(date=>{const items=groups.get(date).sort((a,b)=>manualOrderValue(a)-manualOrderValue(b)||new Date(a.start)-new Date(b.start)||String(a.title||"").localeCompare(String(b.title||""),"ko"));return`<section class="uw-date-group"><div class="uw-date-label"><span>${dayLabel(fromKey(date),true)}</span></div><div class="uw-list uw-task-main-list" data-uw-add-kind="event" data-date="${date}" data-task-drop-date="${date}" data-manual-list>${items.map(event=>itemMarkup("event",event,date,false,true)).join("")}${canAdd?scheduleInput(date):""}</div></section>`}).join("")}</div>`
}
function scheduleMonthBoard'''
unified = unified[:match.start()] + schedule_new + unified[match.end():]

# 3) Task list helper: optional flat-list date label.
old = 'function taskListMarkup(tasks,k,compact=false,manual=false){return tasks.map(task=>{const date=Object.prototype.hasOwnProperty.call(task,"_occurrenceDate")?task._occurrenceDate||"":task.date||k;return itemMarkup("task",task,date,compact,manual)}).join("")}'
new = 'function taskListMarkup(tasks,k,compact=false,manual=false,showListDate=false){return tasks.map(task=>{const date=Object.prototype.hasOwnProperty.call(task,"_occurrenceDate")?task._occurrenceDate||"":task.date||k;const listDate=showListDate?(taskListDate(task)?dayLabel(fromKey(taskListDate(task))):"언젠가"):"";return itemMarkup("task",task,date,compact,manual,listDate)}).join("")}'
assert old in unified, 'taskListMarkup not found'
unified = unified.replace(old, new, 1)

# 4) Task ALL: flat list, include undated items at the bottom. Other tabs retain current grouping.
old = '    const rows=visibleTasks(taskListTab);\n    if(taskListTab==="someday"){'
new = '''    const rows=visibleTasks(taskListTab);
    if(taskListTab==="all"){
      const add=`<div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="">${taskListInput("")}</div>`;
      root.innerHTML=add+(rows.length?`<div class="uw-list uw-task-main-list uw-flat-all-list">${taskListMarkup(rows,"",false,false,true)}</div>`:'<div class="empty">표시할 할일이 없어요.</div>');
      return
    }
    if(taskListTab==="someday"){'''
assert old in unified, 'task all insertion point not found'
unified = unified.replace(old, new, 1)

# 5) Habit item markup: optional flat-list date label.
old = 'function itemMarkup(task,{compact=false,manual=false,date=""}={}){\n  const area=group(task),repeat=repeatLabel(task),project=projectName(task),rowDate=date||displayDate(task)||"";'
new = 'function itemMarkup(task,{compact=false,manual=false,date="",dateLabel=""}={}){\n  const area=group(task),repeat=repeatLabel(task),project=projectName(task),rowDate=date||displayDate(task)||"",listDate=dateLabel?String(dateLabel):"";'
assert old in habit, 'habit itemMarkup header not found'
habit = habit.replace(old, new, 1)

old = '    <span class="uw-item-title">${esc(task.title||"이름 없는 습관")}</span>\n    ${compact?"":`${repeat?'
new = '    <span class="uw-item-title">${esc(task.title||"이름 없는 습관")}</span>\n    ${listDate?`<span class="uw-item-time">${esc(listDate)}</span>`:""}\n    ${compact?"":`${repeat?'
assert old in habit, 'habit title markup not found'
habit = habit.replace(old, new, 1)

# 6) Habit ALL: flat list, date-descending, undated last. Other tabs retain grouping.
old = 'function listMarkup(){\n  const rows=listHabits(habitListTab);\n  if(habitListTab==="someday"){'
new = '''function listMarkup(){
  const rows=listHabits(habitListTab);
  if(habitListTab==="all"){
    const add=`<div class="uw-list uw-task-main-list" data-date="${todayKey()}">${quickAdd(todayKey())}</div>`;
    return add+(rows.length?`<div class="uw-list uw-task-main-list uw-flat-all-list">${rows.map(task=>{const date=displayDate(task);return itemMarkup(task,{date,dateLabel:date?dayLabel(fromKey(date)):"언젠가"})}).join("")}</div>`:'<div class="empty">표시할 습관이 없어요.</div>')
  }
  if(habitListTab==="someday"){'''
assert old in habit, 'habit all insertion point not found'
habit = habit.replace(old, new, 1)

# 7) Replace prompt-based habit quick-add with the same inline form interaction used by task/schedule surfaces.
insert_at = 'async function toggleHabit(id){'
assert insert_at in habit, 'toggleHabit insertion point not found'
inline_fn = '''function openHabitInline(button,dateValue=""){
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

'''
habit = habit.replace(insert_at, inline_fn + insert_at, 1)

old = '    if(quick){event.preventDefault();const title=window.prompt("습관 이름");if(title)addHabit(title,quick.dataset.habitQuickAdd||null);return}'
new = '    if(quick){event.preventDefault();event.stopPropagation();openHabitInline(quick,quick.dataset.habitQuickAdd||"");return}'
assert old in habit, 'prompt quick-add handler not found'
habit = habit.replace(old, new, 1)

# 8) Cache bust updated modules.
assert './js/unified-workspace.js?v=73' in index, 'unified version marker not found'
assert './js/repeat-overview.js?v=7' in index, 'habit version marker not found'
index = index.replace('./js/unified-workspace.js?v=73', './js/unified-workspace.js?v=74', 1)
index = index.replace('./js/repeat-overview.js?v=7', './js/repeat-overview.js?v=8', 1)

# Safety checks before writing.
assert 'window.prompt("습관 이름")' not in habit
assert 'if(scheduleListTab==="all")' in unified
assert 'if(taskListTab==="all")' in unified
assert 'if(habitListTab==="all")' in habit
assert 'openHabitInline' in habit

unified_path.write_text(unified)
habit_path.write_text(habit)
index_path.write_text(index)
print('flattened all lists and replaced habit prompt with inline input')
