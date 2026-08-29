import fs from 'node:fs';
function replaceRequired(text,before,after,label){if(!text.includes(before))throw new Error(`missing target: ${label}`);return text.replace(before,after)}

let index=fs.readFileSync('index.html','utf8');
index=replaceRequired(index,'<div class="page-head"><div><h1 class="page-title">할일</h1></div><div class="seg uw-task-mode-controls" aria-label="할일 보기"><button data-uw-task-mode="list" type="button">목록</button><button class="active" data-uw-task-mode="calendar" type="button">캘린더</button></div></div>','<div class="page-head"><div><h1 class="page-title">할일</h1></div><div class="seg uw-task-mode-controls" aria-label="할일 보기"><button class="active" data-uw-task-mode="calendar" type="button">캘린더</button><button data-uw-task-mode="list" type="button">목록</button></div></div>','task mode order');
index=replaceRequired(index,'./js/unified-workspace.js?v=70','./js/unified-workspace.js?v=71','unified cache');
fs.writeFileSync('index.html',index);

let source=fs.readFileSync('js/unified-workspace.js','utf8');
const visibleStart=source.indexOf('function visibleTasks(tab){');
const visibleEnd=source.indexOf('function renderTasks(){',visibleStart);
if(visibleStart<0||visibleEnd<0)throw new Error('visibleTasks block not found');
const visibleReplacement=`function taskListDate(task){
  if(task.done){
    if(task.completedDate)return task.completedDate;
    if(task.completedAt){const completed=new Date(task.completedAt);if(!Number.isNaN(completed.getTime()))return key(completed)}
  }
  return task._occurrenceDate||task.date||""
}
function visibleTasks(tab){
  const today=todayKey(),tasks=state.tasks.filter(task=>!task.isHabit);
  let rows=[];
  if(tab==="done")rows=tasks.filter(task=>task.done);
  else if(tab==="someday")rows=tasks.filter(task=>!task.done&&!task.date);
  else if(tab==="upcoming")rows=tasks.filter(task=>!task.done&&task.date&&task.date>=today);
  else rows=[...tasks];
  return rows.sort((a,b)=>{
    const ad=taskListDate(a),bd=taskListDate(b);
    if(tab==="upcoming")return String(ad||"9999").localeCompare(String(bd||"9999"))||String(a.title||"").localeCompare(String(b.title||""),"ko");
    return String(bd||"").localeCompare(String(ad||""))||String(a.title||"").localeCompare(String(b.title||""),"ko")
  })
}
`;
source=source.slice(0,visibleStart)+visibleReplacement+source.slice(visibleEnd);
source=replaceRequired(source,'function taskRowsForDate(k){return taskOccurrencesForDate(k).sort((a,b)=>+taskDoneOn(a,k)-+taskDoneOn(b,k)||String(a.notionStart||"").localeCompare(String(b.notionStart||""))||String(a.title).localeCompare(String(b.title),"ko"))}','function taskRowsForDate(k){return taskOccurrencesForDate(k).filter(task=>!task.isHabit).sort((a,b)=>+taskDoneOn(a,k)-+taskDoneOn(b,k)||String(a.notionStart||"").localeCompare(String(b.notionStart||""))||String(a.title).localeCompare(String(b.title),"ko"))}','task calendar habit filter');
source=replaceRequired(source,'${[["all","전체"],["today","오늘"],["upcoming","예정"],["someday","언젠가"],["done","완료"]].map(([id,label])=>','${[["all","전체"],["upcoming","예정"],["someday","언젠가"],["done","완료"]].map(([id,label])=>','task list tabs');

const renderStart=source.indexOf('function renderTasksV2(){');
const renderEnd=source.indexOf('function taskBoard',renderStart);
if(renderStart<0||renderEnd<0)throw new Error('renderTasksV2 block end not found');
const currentBlock=source.slice(renderStart,renderEnd);
const funcEnd=currentBlock.indexOf('\nfunction taskMonthBoard');
if(funcEnd<0)throw new Error('task render boundary not found');
const beforeRender=currentBlock.slice(0,currentBlock.indexOf('function renderTasksV2(){'));
const afterRender=currentBlock.slice(funcEnd);
const renderReplacement=`function taskDateGroups(rows,tab){
  if(tab==="someday")return[];
  const groups=new Map();
  for(const task of rows){const date=taskListDate(task);if(!date)continue;if(!groups.has(date))groups.set(date,[]);groups.get(date).push(task)}
  const dates=[...groups.keys()].sort((a,b)=>tab==="upcoming"?a.localeCompare(b):b.localeCompare(a));
  return dates.map(date=>({date,rows:groups.get(date)}))
}
function renderTasksV2(){
  const root=$("#tasksPageList");
  if(!root)return;
  $$('[data-uw-task-mode]').forEach(button=>button.classList.toggle("active",button.dataset.uwTaskMode===taskPageMode));
  renderTaskSubnav();
  if(taskPageMode==="list"){
    const rows=visibleTasks(taskListTab);
    if(taskListTab==="someday"){
      const grouped=state.eventGroups.map(groupInfo=>({groupInfo,rows:rows.filter(task=>group(task).id===groupInfo.id)})).filter(entry=>entry.rows.length);
      const add=`<div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="" data-uw-someday-drop>\${taskListInput("")}</div>`;
      root.innerHTML=add+(grouped.length?`<div class="uw-task-grouped-list">\${grouped.map(({groupInfo,rows:groupRows})=>`<section class="uw-task-group-section" style="--uw-group:\${groupInfo.color}"><div class="uw-task-group-heading"><span class="uw-task-group-dot"></span><strong>\${esc(groupInfo.name)}</strong></div><div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="" data-group-id="\${groupInfo.id}" data-uw-someday-drop>\${taskListMarkup(groupRows,"")}</div></section>`).join("")}</div>`:'<div class="empty">언젠가 할일이 없어요.</div>');
      return
    }
    const groups=taskDateGroups(rows,taskListTab),undated=taskListTab==="all"?rows.filter(task=>!taskListDate(task)):[];
    const add=taskListTab==="all"?`<div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="">\${taskListInput("")}</div>`:"";
    const dated=groups.map(({date,rows:groupRows})=>`<section class="uw-date-group"><div class="uw-date-label"><span>\${dayLabel(fromKey(date),true)}</span></div><div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="\${date}" data-task-drop-date="\${date}">\${taskListMarkup(groupRows,date)}</div></section>`).join("");
    const someday=undated.length?`<section class="uw-date-group"><div class="uw-date-label"><span>언젠가</span></div><div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="" data-uw-someday-drop>\${taskListMarkup(undated,"")}</div></section>`:"";
    root.innerHTML=add+(dated||someday?`<div class="uw-task-grouped-list">\${dated}\${someday}</div>`:'<div class="empty">표시할 할일이 없어요.</div>');
    return
  }
  const layout=taskCalendarView==="month"?"board":taskCalendarLayout;
  root.innerHTML=`<section class="uw-task-calendar-shell">\${taskCalendarNav()}\${taskCalendarView==="month"?taskMonthBoard():layout==="timeline"?taskTimeline():taskBoard()}</section>`
}
`;
source=source.slice(0,renderStart)+renderReplacement+afterRender+source.slice(renderEnd);
fs.writeFileSync('js/unified-workspace.js',source);
