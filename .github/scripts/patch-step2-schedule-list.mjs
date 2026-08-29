import fs from 'node:fs';

function replaceRequired(text,before,after,label){if(!text.includes(before))throw new Error(`missing target: ${label}`);return text.replace(before,after)}

let index=fs.readFileSync('index.html','utf8');
index=replaceRequired(index,'<div class="page-head"><div><h1 class="page-title">일정</h1></div><div class="seg uw-task-mode-controls" aria-label="일정 보기"><button data-uw-schedule-mode="list" type="button">목록</button><button class="active" data-uw-schedule-mode="calendar" type="button">캘린더</button></div></div>','<div class="page-head"><div><h1 class="page-title">일정</h1></div><div class="seg uw-task-mode-controls" aria-label="일정 보기"><button class="active" data-uw-schedule-mode="calendar" type="button">캘린더</button><button data-uw-schedule-mode="list" type="button">목록</button></div></div>','schedule mode order');
index=replaceRequired(index,'./js/unified-workspace.js?v=69','./js/unified-workspace.js?v=70','unified cache');
fs.writeFileSync('index.html',index);

let source=fs.readFileSync('js/unified-workspace.js','utf8');
source=replaceRequired(source,'let schedulePageMode="calendar",scheduleCalendarLayout="board";','let schedulePageMode="calendar",scheduleCalendarLayout="board",scheduleListTab="all";','schedule list state');

const start=source.indexOf('function renderScheduleSubnav(){');
const end=source.indexOf('function scheduleMonthBoard(){',start);
if(start<0||end<0)throw new Error('schedule list function block not found');
const replacement=`function renderScheduleSubnav(){
  const nav=$("#calendarViewSeg");
  if(!nav)return;
  if(schedulePageMode==="list"){
    nav.innerHTML=\`<div class="uw-task-list-tabs"><div class="seg">\${[["all","전체"],["upcoming","예정"],["someday","언젠가"],["done","완료"]].map(([id,label])=>\`<button class="\${scheduleListTab===id?"active":""}" data-schedule-list-tab="\${id}" type="button">\${label}</button>\`).join("")}</div></div>\`;
    return
  }
  const month=calendarView==="month";
  const label=month?"월은 보드 보기":scheduleCalendarLayout==="board"?"타임라인으로 보기":"보드로 보기";
  nav.innerHTML=\`<div class="uw-task-calendar-tabs"><div class="seg">\${[["month","월"],["week","주"],["day","일"]].map(([id,text])=>\`<button class="\${calendarView===id?"active":""}" data-schedule-cal-view="\${id}" type="button">\${text}</button>\`).join("")}</div><button class="uw-layout-toggle" data-schedule-cal-layout-toggle type="button"\${month?' disabled title="월 보기는 보드로 고정돼요"':""}>\${label}</button></div>\`
}
function eventDoneAt(event,now=new Date()){
  if(!event?.start)return false;
  if(event.allDay){const endKey=key(new Date(event.end||event.start));return endKey<todayKey()}
  const end=new Date(event.end||event.start);
  return !Number.isNaN(end.getTime())&&end<=now
}
function scheduleListRows(tab){
  if(tab==="someday")return[];
  const today=todayKey(),dateSet=new Set();
  for(const event of state.events){if(!event?.start)continue;const start=key(new Date(event.start));if(!Number.isNaN(new Date(event.start).getTime()))dateSet.add(start)}
  for(let offset=-365;offset<=370;offset++){const date=key(addDays(fromKey(today),offset));if(schedules(date).length)dateSet.add(date)}
  const seen=new Set(),rows=[];
  for(const date of dateSet){
    for(const event of schedules(date)){
      const source=event._occurrenceSource||date,token=\`\${event.id}:\${source}:\${date}\`;
      if(seen.has(token))continue;seen.add(token);
      const done=eventDoneAt(event);
      if(tab==="upcoming"&&(done||date<today))continue;
      if(tab==="done"&&!done)continue;
      rows.push({date,item:event,done})
    }
  }
  return rows
}
function scheduleList(){
  if(scheduleListTab==="someday")return '<div class="uw-schedule-list"><div class="empty">날짜 없는 일정이 없어요.</div></div>';
  const rows=scheduleListRows(scheduleListTab),groups=new Map();
  rows.forEach(row=>{if(!groups.has(row.date))groups.set(row.date,[]);groups.get(row.date).push(row.item)});
  const dates=[...groups.keys()].sort((a,b)=>scheduleListTab==="upcoming"?a.localeCompare(b):b.localeCompare(a));
  if(!dates.length)return '<div class="uw-schedule-list"><div class="empty">표시할 일정이 없어요.</div></div>';
  const canAdd=scheduleListTab==="all"||scheduleListTab==="upcoming";
  return\`<div class="uw-schedule-list">\${dates.map(date=>{const items=groups.get(date).sort((a,b)=>new Date(a.start)-new Date(b.start));return\`<section class="uw-date-group"><div class="uw-date-label"><span>\${dayLabel(fromKey(date),true)}</span></div><div class="uw-list uw-task-main-list" data-uw-add-kind="event" data-date="\${date}" data-task-drop-date="\${date}">\${items.map(event=>itemMarkup("event",event,date)).join("")}\${canAdd?scheduleInput(date):""}</div></section>\`}).join("")}</div>\`
}
`;
source=source.slice(0,start)+replacement+source.slice(end);

const oldWire='const mode=e.target.closest("[data-uw-schedule-mode]"),view=e.target.closest("[data-schedule-cal-view]"),layout=e.target.closest("[data-schedule-cal-layout-toggle]"),prev=e.target.closest("#calPrev"),today=e.target.closest("#calToday"),next=e.target.closest("#calNext");\n    if(!mode&&!view&&!layout&&!prev&&!today&&!next)return;\n    e.preventDefault();e.stopImmediatePropagation();\n    if(mode)schedulePageMode=mode.dataset.uwScheduleMode;';
const newWire='const mode=e.target.closest("[data-uw-schedule-mode]"),listTab=e.target.closest("[data-schedule-list-tab]"),view=e.target.closest("[data-schedule-cal-view]"),layout=e.target.closest("[data-schedule-cal-layout-toggle]"),prev=e.target.closest("#calPrev"),today=e.target.closest("#calToday"),next=e.target.closest("#calNext");\n    if(!mode&&!listTab&&!view&&!layout&&!prev&&!today&&!next)return;\n    e.preventDefault();e.stopImmediatePropagation();\n    if(mode)schedulePageMode=mode.dataset.uwScheduleMode;\n    if(listTab)scheduleListTab=listTab.dataset.scheduleListTab;';
source=replaceRequired(source,oldWire,newWire,'schedule list tab click');
fs.writeFileSync('js/unified-workspace.js',source);
