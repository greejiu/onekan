import fs from 'node:fs';

function replaceRequired(text,before,after,label){
  if(!text.includes(before))throw new Error(`missing target: ${label}`);
  return text.replace(before,after)
}

let index=fs.readFileSync('index.html','utf8');
index=replaceRequired(index,'./js/unified-workspace.js?v=71','./js/unified-workspace.js?v=72','unified cache');
index=replaceRequired(index,'./js/repeat-overview.js?v=5','./js/repeat-overview.js?v=6','habit cache');
index=replaceRequired(index,'  <script type="module" src="./js/repeat-overview.js?v=6"></script>','  <script type="module" src="./js/repeat-overview.js?v=6"></script>\n  <script type="module" src="./js/manual-list-order.js?v=1"></script>','manual order script');
fs.writeFileSync('index.html',index);

let unified=fs.readFileSync('js/unified-workspace.js','utf8');
unified=replaceRequired(unified,'function groupStyle(item){return `--uw-group:${group(item).color}`}','function groupStyle(item){return `--uw-group:${group(item).color}`}\nfunction manualOrderValue(item){const value=Number(item?.manualOrder);return Number.isFinite(value)?value:1000000000}','manual order helper');

const itemStart=unified.indexOf('function itemMarkup(kind,item,k,compact=false){');
const itemEnd=unified.indexOf('function findAddHost',itemStart);
if(itemStart<0||itemEnd<0)throw new Error('itemMarkup block not found');
const itemMarkup=`function itemMarkup(kind,item,k,compact=false,manual=false){
  const done=itemDoneOn(kind,item,k);
  const time=kind==="event"&&!item.allDay?timeOf(item.start):"";
  const repeat=recurrenceLabel(item,kind);
  const occurrence=(kind==="task"||kind==="event")&&item._occurrenceSource?\` data-occurrence-source="\${item._occurrenceSource}"\`:"";
  const manualAttrs=manual?\` data-manual-row data-manual-kind="\${kind}" data-manual-id="\${esc(item.id)}"\`:"";
  const move=manual?'<button class="onekan-manual-handle" data-manual-sort-handle type="button" aria-label="순서 변경">⠿</button>':'<button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button>';
  return\`<div class="uw-item uw-\${kind}\${done?" done":""}\${compact?" compact":""}" style="\${groupStyle(item)}" data-uw-kind="\${kind}" data-id="\${item.id}" data-date="\${k}"\${occurrence}\${manualAttrs} draggable="false">\${checkMarkup(kind,item,k)}<span class="uw-item-title">\${esc(item.title)}</span>\${repeat?\`<span class="uw-repeat-badge">↻ \${repeat}</span>\`:""}\${time?\`<span class="uw-item-time">\${time}</span>\`:""}\${move}<button class="uw-select-circle" type="button" aria-label="선택"></button></div>\`
}
`;
unified=unified.slice(0,itemStart)+itemMarkup+unified.slice(itemEnd);

unified=replaceRequired(unified,'function taskListMarkup(tasks,k,compact=false){return tasks.map(task=>{const date=Object.prototype.hasOwnProperty.call(task,"_occurrenceDate")?task._occurrenceDate||"":task.date||k;return itemMarkup("task",task,date,compact)}).join("")}','function taskListMarkup(tasks,k,compact=false,manual=false){return tasks.map(task=>{const date=Object.prototype.hasOwnProperty.call(task,"_occurrenceDate")?task._occurrenceDate||"":task.date||k;return itemMarkup("task",task,date,compact,manual)}).join("")}','task list markup manual flag');
unified=replaceRequired(unified,'if(tab==="upcoming")return String(ad||"9999").localeCompare(String(bd||"9999"))||String(a.title||"").localeCompare(String(b.title||""),"ko");','if(tab==="upcoming")return String(ad||"9999").localeCompare(String(bd||"9999"))||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko");','task upcoming manual sort');
unified=replaceRequired(unified,'return String(bd||"").localeCompare(String(ad||""))||String(a.title||"").localeCompare(String(b.title||""),"ko")','return String(bd||"").localeCompare(String(ad||""))||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko")','task default manual sort');

const taskRenderStart=unified.indexOf('function renderTasksV2(){');
const taskRenderEnd=unified.indexOf('function wireTaskViewControls(){',taskRenderStart);
if(taskRenderStart<0||taskRenderEnd<0)throw new Error('task render block not found');
let taskRender=unified.slice(taskRenderStart,taskRenderEnd);
taskRender=taskRender.replaceAll('data-uw-someday-drop>${taskListMarkup(groupRows,"")}', 'data-uw-someday-drop data-manual-list>${taskListMarkup(groupRows,"",false,true)}');
taskRender=taskRender.replaceAll('data-task-drop-date="${date}">${taskListMarkup(groupRows,date)}', 'data-task-drop-date="${date}" data-manual-list>${taskListMarkup(groupRows,date,false,true)}');
taskRender=taskRender.replaceAll('data-uw-someday-drop>${taskListMarkup(undated,"")}', 'data-uw-someday-drop data-manual-list>${taskListMarkup(undated,"",false,true)}');
unified=unified.slice(0,taskRenderStart)+taskRender+unified.slice(taskRenderEnd);

unified=replaceRequired(unified,'const items=groups.get(date).sort((a,b)=>new Date(a.start)-new Date(b.start));','const items=groups.get(date).sort((a,b)=>manualOrderValue(a)-manualOrderValue(b)||new Date(a.start)-new Date(b.start)||String(a.title||"").localeCompare(String(b.title||""),"ko"));','schedule manual sort');
unified=replaceRequired(unified,'data-task-drop-date="${date}">${items.map(event=>itemMarkup("event",event,date)).join("")}${canAdd?scheduleInput(date):""}','data-task-drop-date="${date}" data-manual-list>${items.map(event=>itemMarkup("event",event,date,false,true)).join("")}${canAdd?scheduleInput(date):""}','schedule manual list markup');
fs.writeFileSync('js/unified-workspace.js',unified);

let habit=fs.readFileSync('js/repeat-overview.js','utf8');
habit=replaceRequired(habit,'function group(task){return state.eventGroups.find(item=>item.id===task.groupId)||state.eventGroups[0]}','function group(task){return state.eventGroups.find(item=>item.id===task.groupId)||state.eventGroups[0]}\nfunction manualOrderValue(item){const value=Number(item?.manualOrder);return Number.isFinite(value)?value:1000000000}','habit manual helper');
habit=replaceRequired(habit,'.habit-item{--habit-area:var(--accent);display:grid;grid-template-columns:24px 9px minmax(0,1fr) auto;gap:7px;align-items:center;min-height:42px;padding:6px 5px;border-bottom:1px solid var(--line)}','.habit-item{--habit-area:var(--accent);display:grid;grid-template-columns:24px 9px minmax(0,1fr) auto 24px;gap:7px;align-items:center;min-height:42px;padding:6px 5px;border-bottom:1px solid var(--line)}','habit row columns');
habit=replaceRequired(habit,'function itemMarkup(task,{compact=false}={}){','function itemMarkup(task,{compact=false,manual=false}={}){','habit item options');
habit=replaceRequired(habit,'  return `<div class="habit-item uw-item uw-task${task.done?" done":""}${compact?" habit-compact":""}" style="--habit-area:${esc(area?.color||"#8fa9c4")};--uw-group:${esc(area?.color||"#8fa9c4")}" data-context-kind="task" data-context-id="${esc(task.id)}" data-habit-item="1" data-uw-kind="task" data-id="${esc(task.id)}">','  const manualAttrs=manual?` data-manual-row data-manual-kind="task" data-manual-id="${esc(task.id)}"`:"";\n  return `<div class="habit-item uw-item uw-task${task.done?" done":""}${compact?" habit-compact":""}" style="--habit-area:${esc(area?.color||"#8fa9c4")};--uw-group:${esc(area?.color||"#8fa9c4")}" data-context-kind="task" data-context-id="${esc(task.id)}" data-habit-item="1" data-uw-kind="task" data-id="${esc(task.id)}"${manualAttrs}>','habit row manual attrs');
habit=replaceRequired(habit,'    <span class="habit-meta">${repeat?`<span class="habit-repeat">↻ ${esc(repeat)}</span>`:""}${project?`<span>${esc(project)}</span>`:""}</span>\n  </div>`','    <span class="habit-meta">${repeat?`<span class="habit-repeat">↻ ${esc(repeat)}</span>`:""}${project?`<span>${esc(project)}</span>`:""}</span>\n    ${manual?\'<button class="onekan-manual-handle" data-manual-sort-handle type="button" aria-label="순서 변경">⠿</button>\':""}\n  </div>`','habit manual handle');
habit=replaceRequired(habit,'if(tab==="upcoming")return String(ad||"9999").localeCompare(String(bd||"9999"))||String(a.title||"").localeCompare(String(b.title||""),"ko");','if(tab==="upcoming")return String(ad||"9999").localeCompare(String(bd||"9999"))||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko");','habit upcoming manual sort');
habit=replaceRequired(habit,'return String(bd||"").localeCompare(String(ad||""))||String(a.title||"").localeCompare(String(b.title||""),"ko")','return String(bd||"").localeCompare(String(ad||""))||manualOrderValue(a)-manualOrderValue(b)||String(a.title||"").localeCompare(String(b.title||""),"ko")','habit default manual sort');
habit=habit.replaceAll('<div class="habit-list">${areaRows.map(task=>itemMarkup(task)).join("")}</div>','<div class="habit-list" data-manual-list>${areaRows.map(task=>itemMarkup(task,{manual:true})).join("")}</div>');
habit=habit.replaceAll('<div class="habit-list">${groups.get(date).map(task=>itemMarkup(task)).join("")}</div>','<div class="habit-list" data-manual-list>${groups.get(date).map(task=>itemMarkup(task,{manual:true})).join("")}</div>');
habit=habit.replaceAll('<div class="habit-list">${undated.map(task=>itemMarkup(task)).join("")}</div>','<div class="habit-list" data-manual-list>${undated.map(task=>itemMarkup(task,{manual:true})).join("")}</div>');
fs.writeFileSync('js/repeat-overview.js',habit);
