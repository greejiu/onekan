from pathlib import Path

js_path = Path('js/unified-workspace.js')
index_path = Path('index.html')
js = js_path.read_text()
index = index_path.read_text()

old = '''function upcomingKeys(){return Array.from({length:7},(_,i)=>key(addDays(fromKey(todayKey()),i+1)))}
function renderUpcoming(){const root=$("#upcomingList");if(!root)return;const groups=upcomingKeys().map(date=>({date,rows:[...schedules(date).map(item=>({kind:"event",item})),...taskOccurrencesForDate(date).filter(task=>!taskDoneOn(task,date)).map(item=>({kind:"task",item}))]})).filter(group=>group.rows.length);root.innerHTML=groups.length?groups.map(({date,rows})=>`<div class="uw-date-group"><div class="uw-date-label"><span>${dayLabel(fromKey(date),true)}</span></div><div class="uw-list" data-uw-add-kind="task" data-date="${date}">${rows.map(x=>itemMarkup(x.kind,x.item,date)).join("")}</div></div>`).join(""):'<div class="empty">앞으로 7일간 일정이 없어요.</div>'}
'''

new = '''function upcomingKeys(){return Array.from({length:7},(_,i)=>key(addDays(fromKey(todayKey()),i+1)))}
function upcomingTasksForDate(date){
  const rows=taskOccurrencesForDate(date).filter(task=>!task.isHabit&&!taskDoneOn(task,date));
  const seen=new Set(rows.map(task=>`${task.id}:${task._occurrenceSource||date}`));
  for(const task of state.tasks){
    if(task.isHabit||task.done||task.date!==date)continue;
    const token=`${task.id}:${task._occurrenceSource||date}`;
    if(seen.has(token))continue;
    seen.add(token);rows.push(task)
  }
  return rows.sort((a,b)=>{
    const at=a.notionStart?new Date(a.notionStart).getTime():Infinity,bt=b.notionStart?new Date(b.notionStart).getTime():Infinity;
    return at-bt||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko")
  })
}
function renderUpcoming(){
  const root=$("#upcomingList");if(!root)return;
  const groups=upcomingKeys().map(date=>({date,rows:[...schedules(date).map(item=>({kind:"event",item})),...upcomingTasksForDate(date).map(item=>({kind:"task",item}))]})).filter(group=>group.rows.length);
  root.innerHTML=groups.length?groups.map(({date,rows})=>`<div class="uw-date-group"><div class="uw-date-label"><span>${dayLabel(fromKey(date),true)}</span></div><div class="uw-list" data-uw-add-kind="task" data-date="${date}">${rows.map(x=>itemMarkup(x.kind,x.item,date)).join("")}</div></div>`).join(""):'<div class="empty">앞으로 7일간 일정과 할일이 없어요.</div>'
}
'''

assert old in js, 'renderUpcoming target not found'
js = js.replace(old, new, 1)
assert 'unified-workspace.js?v=82' in index, 'unified workspace js cache target not found'
index = index.replace('unified-workspace.js?v=82', 'unified-workspace.js?v=83', 1)

js_path.write_text(js)
index_path.write_text(index)
