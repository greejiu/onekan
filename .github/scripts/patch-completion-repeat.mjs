import fs from "node:fs";

function read(path){return fs.readFileSync(path,"utf8")}
function write(path,text){fs.writeFileSync(path,text)}
function replaceOnce(text,search,replacement,label){
  const index=text.indexOf(search);
  if(index<0)throw new Error(`missing pattern: ${label}`);
  if(text.indexOf(search,index+search.length)>=0)throw new Error(`pattern not unique: ${label}`);
  return text.slice(0,index)+replacement+text.slice(index+search.length);
}
function replaceRegex(text,regex,replacement,label){
  if(!regex.test(text))throw new Error(`missing regex: ${label}`);
  regex.lastIndex=0;
  return text.replace(regex,replacement);
}

let unified=read("js/unified-workspace.js");
unified=replaceOnce(unified,
  '} from "./time-block-v2.js?v=4";\n',
  '} from "./time-block-v2.js?v=4";\nimport { completeRepeatingTask, normalizeCompletionRepeats, undoRepeatingTaskCompletion } from "./repeat-after-completion.js?v=1";\n',
  "unified repeat helper import");
unified=replaceOnce(unified,
  '  s.tasks.forEach(x=>x.groupId||=gid);\n  s.events.forEach(x=>x.groupId||=gid);\n  s.habitTemplates.forEach(x=>x.groupId||=gid);\n  return s\n',
  '  s.tasks.forEach(x=>x.groupId||=gid);\n  s.events.forEach(x=>x.groupId||=gid);\n  s.habitTemplates.forEach(x=>x.groupId||=gid);\n  normalizeCompletionRepeats(s);\n  return s\n',
  "unified normalize completion repeats");
unified=replaceRegex(unified,
  /function taskDoneOn\(item,date\)\{[\s\S]*?\n\}/,
  'function taskDoneOn(item,date){\n  if(item.recurrence?.completionBased)return !!item.done;\n  const occurrenceDate=item._occurrenceSource||date;\n  return item.recurrence?.frequency?!!item.recurrenceDone?.[occurrenceDate]:!!item.done\n}',
  "unified taskDoneOn");
unified=replaceRegex(unified,
  /function taskOccurrencesForDate\(date,source=state\)\{[\s\S]*?(?=\nfunction somedayTaskOccurrences)/,
  'function taskOccurrencesForDate(date,source=state){const rows=[];for(const task of source.tasks){if(task.recurrence?.completionBased){if(task.date===date)rows.push(task);continue}if(!task.recurrence?.frequency){if(task.date===date)rows.push(task);continue}const added=new Set();if(task.date&&recurrenceOn(task,task.date,date)){const override=taskOverride(source,date,task.id);if(!override?.hidden&&(!override||!Object.prototype.hasOwnProperty.call(override,"date")||override.date===date)){rows.push(effectiveTaskOccurrence(task,date,override));added.add(date)}}for(const [sourceDate,byTask] of Object.entries(source.taskOverrides||{})){const override=byTask?.[task.id];if(!added.has(sourceDate)&&override&&!override.hidden&&Object.prototype.hasOwnProperty.call(override,"date")&&override.date===date)rows.push(effectiveTaskOccurrence(task,sourceDate,override))}}return rows}',
  "unified task occurrences");
unified=replaceRegex(unified,
  /function somedayTaskOccurrences\(source=state\)\{[\s\S]*?(?=\nfunction )/,
  'function somedayTaskOccurrences(source=state){const rows=source.tasks.filter(task=>!task.done&&!task.date&&(!task.recurrence?.frequency||task.recurrence?.completionBased));for(const task of source.tasks.filter(item=>item.recurrence?.frequency&&!item.recurrence?.completionBased))for(const [sourceDate,byTask] of Object.entries(source.taskOverrides||{})){const override=byTask?.[task.id];if(override&&!override.hidden&&Object.prototype.hasOwnProperty.call(override,"date")&&override.date===null)rows.push(effectiveTaskOccurrence(task,sourceDate,override))}return rows}',
  "unified someday tasks");
unified=unified.replace('if(tab==="done")rows=state.tasks.filter(task=>!task.recurrence?.frequency&&task.done);','if(tab==="done")rows=state.tasks.filter(task=>task.done);');
unified=replaceRegex(unified,
  /  \}else\{\n    rows=state\.tasks\.filter\(task=>!task\.done&&!task\.recurrence\?\.frequency\);[\s\S]*?\n  \}\n  return rows\.sort/,
  '  }else{\n    rows=state.tasks.filter(task=>!task.done)\n  }\n  return rows.sort',
  "unified all task list");
unified=unified.replace('return(source?.tasks||[]).filter(task=>!task.done&&task.date&&task.date<today&&!task.recurrence?.frequency)', 'return(source?.tasks||[]).filter(task=>!task.done&&task.date&&task.date<today)');
unified=replaceOnce(unified,
  'if(t.recurrence?.frequency){const occurrence=check.dataset.occurrenceSource||check.dataset.date;t.recurrenceDone||={};const next=!t.recurrenceDone[occurrence];if(next)freezeTaskOccurrence(s,t,occurrence);t.recurrenceDone[occurrence]=next}else{t.done=!t.done;t.completedAt=t.done?new Date().toISOString():null}',
  'if(t.recurrence?.frequency){completeRepeatingTask(s,t,new Date())}else if(t.done&&t.repeatRule){undoRepeatingTaskCompletion(s,t)}else{t.done=!t.done;t.completedAt=t.done?new Date().toISOString():null}',
  "unified task check");
unified=unified.replace('const taskScope=old&&kind==="task"&&old.recurrence?.frequency?await askTaskScope(old,sourceDate||old.date):null;', 'const taskScope=old&&kind==="task"&&old.recurrence?.frequency&&!old.recurrence?.completionBased?await askTaskScope(old,sourceDate||old.date):null;');
unified=unified.replace('if(old&&kind==="task"&&old.recurrence?.frequency&&!taskScope){saving=false;scheduleRender(0);return}', 'if(old&&kind==="task"&&old.recurrence?.frequency&&!old.recurrence?.completionBased&&!taskScope){saving=false;scheduleRender(0);return}');
unified=unified.replace('if(recurrence)target.recurrence=recurrence;else delete target.recurrence;', 'if(recurrence){if(kind==="task")recurrence.completionBased=true;target.recurrence=recurrence}else delete target.recurrence;');
unified=unified.replace('const recurrence=recurrenceFromEditor(form,taskDate);\n        if(recurrence)task.recurrence=recurrence;', 'const recurrence=recurrenceFromEditor(form,taskDate);\n        if(recurrence){recurrence.completionBased=true;task.recurrence=recurrence}');
unified=unified.replace('if(task?.recurrence?.frequency){const date=record.occurrenceSource||record.date||task.date,scope=await askTaskScope(task,date,"delete");', 'if(task?.recurrence?.frequency&&!task.recurrence?.completionBased){const date=record.occurrenceSource||record.date||task.date,scope=await askTaskScope(task,date,"delete");');
unified=unified.replace('if(!task.recurrence?.frequency)return"all";\n    return await askTaskScope(task,sourceDate)', 'if(!task.recurrence?.frequency||task.recurrence?.completionBased)return"all";\n    return await askTaskScope(task,sourceDate)');
unified=unified.replaceAll('if(task.recurrence?.frequency){\n      const sourceDate=', 'if(task.recurrence?.frequency&&!task.recurrence?.completionBased){\n      const sourceDate=');
unified=unified.replace('if(task.recurrence?.frequency&&!scope)scope=await askTaskScope(task,sourceDate);', 'if(task.recurrence?.frequency&&!task.recurrence?.completionBased&&!scope)scope=await askTaskScope(task,sourceDate);');
unified=unified.replace('if(task.recurrence?.frequency&&scope==="all"&&!date){showToast(', 'if(task.recurrence?.frequency&&!task.recurrence?.completionBased&&scope==="all"&&!date){showToast(');
unified=replaceOnce(unified,
  'if(name==="duplicate"){await write(current=>records.forEach(record=>{const list=record.kind==="event"?current.events:record.kind==="habit"?current.habitTemplates:current.tasks;const item=list.find(value=>value.id===record.id);if(item)list.push({...item,id:uid(),title:`${item.title} 복사`,done:false,completedAt:null})}))}',
  'if(name==="duplicate"){await write(current=>records.forEach(record=>{const list=record.kind==="event"?current.events:record.kind==="habit"?current.habitTemplates:current.tasks;const item=list.find(value=>value.id===record.id);if(item){const copy={...item,id:uid(),title:`${item.title} 복사`,done:false,completedAt:null};if(record.kind==="task"){delete copy.repeatSeriesId;delete copy.repeatRule;delete copy.repeatScheduledDate;delete copy.repeatGeneratedNextId;delete copy.completedDate;if(copy.recurrence?.frequency){copy.recurrence={...copy.recurrence,completionBased:true};copy.recurrenceDone={}}}list.push(copy)}}))}',
  "unified duplicate series reset");
// Completion-based task badges describe the new rule instead of a fixed calendar recurrence.
unified=replaceOnce(unified,
  'function recurrenceLabel(item,kind=""){\n  const recurrence=item.recurrence,frequency=recurrence?.frequency,interval=Math.max(1,+recurrence?.interval||1);\n  if(kind==="habit"&&(!frequency||frequency==="none"))return"매일";',
  'function recurrenceLabel(item,kind=""){\n  const recurrence=item.recurrence,frequency=recurrence?.frequency,interval=Math.max(1,+recurrence?.interval||1);\n  if(kind==="task"&&frequency){if(frequency==="daily")return interval===1?"완료 후 1일":`완료 후 ${interval}일`;if(frequency==="weekly"){const weekdays=Array.isArray(recurrence.weekdays)?recurrence.weekdays:[];if(weekdays.length>1)return"완료 후 다음 지정 요일";return interval===1?"완료 후 1주":`완료 후 ${interval}주`}if(frequency==="monthly")return interval===1?"완료 후 1개월":`완료 후 ${interval}개월`}\n  if(kind==="habit"&&(!frequency||frequency==="none"))return"매일";',
  "unified completion badge");
write("js/unified-workspace.js",unified);

let app=read("js/app.js");
app=replaceOnce(app,
  'import { confirmAction, showToast } from "./ui-feedback.js";\n',
  'import { confirmAction, showToast } from "./ui-feedback.js";\nimport { completeRepeatingTask, normalizeCompletionRepeats, undoRepeatingTaskCompletion } from "./repeat-after-completion.js?v=1";\n',
  "app repeat helper import");
app=replaceOnce(app,
  '  const recurrence = item.recurrence;\n  if (!recurrence?.frequency) return item.date === targetKey;',
  '  const recurrence = item.recurrence;\n  if (recurrence?.completionBased) return item.date === targetKey;\n  if (!recurrence?.frequency) return item.date === targetKey;',
  "app recurring current only");
app=replaceOnce(app,
  'function taskCompletedOn(task, dateKey) {\n  return task.recurrence?.frequency ? Boolean(task.recurrenceDone?.[dateKey]) : Boolean(task.done);\n}',
  'function taskCompletedOn(task, dateKey) {\n  if (task.recurrence?.completionBased) return Boolean(task.done);\n  return task.recurrence?.frequency ? Boolean(task.recurrenceDone?.[dateKey]) : Boolean(task.done);\n}',
  "app task complete state");
app=replaceOnce(app,
  '  return normalized;\n}\n\nlet currentUser',
  '  normalizeCompletionRepeats(normalized);\n  return normalized;\n}\n\nlet currentUser',
  "app normalize completion repeats");
app=replaceOnce(app,
  '    row.querySelector(".check").addEventListener("click", () => {\n      task.done = !task.done;\n      task.completedAt = task.done ? new Date().toISOString() : null;\n      save();',
  '    row.querySelector(".check").addEventListener("click", () => {\n      if (task.recurrence?.frequency) completeRepeatingTask(state, task, new Date());\n      else if (task.done && task.repeatRule) undoRepeatingTaskCompletion(state, task);\n      else { task.done = !task.done; task.completedAt = task.done ? new Date().toISOString() : null; }\n      save();',
  "app task check helper");
write("js/app.js",app);

let plan=read("js/project-plan.js");
plan=replaceOnce(plan,
  'import { showToast } from "./ui-feedback.js";\n',
  'import { showToast } from "./ui-feedback.js";\nimport { completeRepeatingTask, normalizeCompletionRepeats, undoRepeatingTaskCompletion } from "./repeat-after-completion.js?v=1";\n',
  "plan repeat helper import");
plan=replaceOnce(plan,
  '  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];\n  state.eventGroups',
  '  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];\n  normalizeCompletionRepeats(state);\n  state.eventGroups',
  "plan normalize completion repeats");
plan=replaceOnce(plan,
  '      task.done = !task.done;\n      task.completedAt = task.done ? new Date().toISOString() : null;',
  '      if (task.recurrence?.frequency) completeRepeatingTask(current, task, new Date());\n      else if (task.done && task.repeatRule) undoRepeatingTaskCompletion(current, task);\n      else { task.done = !task.done; task.completedAt = task.done ? new Date().toISOString() : null; }',
  "plan task completion");
write("js/project-plan.js",plan);

let repeat=read("js/repeat-overview.js");
repeat=replaceOnce(repeat,
  'function shortDate(value) {',
  'function completionRepeatLabel(recurrence) {\n  const frequency = recurrence?.frequency;\n  const interval = Math.max(1, Number(recurrence?.interval || 1));\n  if (frequency === "daily") return interval === 1 ? "완료 후 1일" : `완료 후 ${interval}일`;\n  if (frequency === "weekly") {\n    const weekdays = Array.isArray(recurrence.weekdays) ? recurrence.weekdays : [];\n    if (weekdays.length > 1) return "완료 후 다음 지정 요일";\n    return interval === 1 ? "완료 후 1주" : `완료 후 ${interval}주`;\n  }\n  if (frequency === "monthly") return interval === 1 ? "완료 후 1개월" : `완료 후 ${interval}개월`;\n  return "완료 후 반복";\n}\n\nfunction shortDate(value) {',
  "repeat completion label helper");
repeat=replaceRegex(repeat,
  /function rowMarkup\(state, item, kind\) \{[\s\S]*?\n\}/,
  'function rowMarkup(state, item, kind) {\n  const baseDate = kind === "task" ? item.date : key(new Date(item.start));\n  const next = kind === "task" ? item.date : nextOccurrence(item.recurrence, baseDate);\n  const ended = item.recurrence?.until && item.recurrence.until < todayKey();\n  const nextText = ended ? "종료됨" : next ? `${kind === "task" ? "예정" : "다음"} ${shortDate(next)}` : "다음 일정 없음";\n  const kindLabel = kind === "task" ? (item.isHabit ? "습관" : "할일") : "일정";\n  const repeatText = kind === "task" ? completionRepeatLabel(item.recurrence) : recurrenceLabel(item.recurrence, baseDate);\n  return `<div class="onekan-repeat-row" data-context-kind="${kind}" data-context-id="${esc(item.id)}" style="--repeat-group:${groupColor(state, item)}">\n    <span class="onekan-repeat-dot" aria-hidden="true"></span>\n    <div class="onekan-repeat-main">\n      <strong>${esc(item.title || "이름 없음")}</strong>\n      <div class="onekan-repeat-meta"><span>${esc(repeatText)}</span><span>·</span><span class="next">${esc(nextText)}</span></div>\n    </div>\n    <span class="onekan-repeat-kind">${kindLabel}</span>\n  </div>`;\n}',
  "repeat row markup");
write("js/repeat-overview.js",repeat);

let controls=read("js/task-input-controls.js");
controls=controls.replace('    .uw-task-repeat-pop .uw-repeat-until input{min-height:32px}\n', '    .uw-task-repeat-pop .uw-repeat-until input{min-height:32px}\n    .uw-task-repeat-note{margin:0;padding:7px 8px;border-radius:8px;background:var(--panel-soft);color:var(--muted);font-size:10px;line-height:1.45}\n');
controls=controls.replace('  const existing=[$(".uw-repeat-select",form),$(".uw-repeat-custom",form),$(".uw-repeat-until",form)].filter(Boolean);', '  const existing=[$(".uw-repeat-select",form),$(".uw-repeat-custom",form),$(".uw-repeat-weekdays",form),$(".uw-repeat-until",form)].filter(Boolean);');
controls=replaceOnce(controls,
  '  if(existing.length)existing.forEach(node=>panel.appendChild(node));else{panel.innerHTML=repeatMarkup();wireRepeat(panel,initial||todayKey())}\n  form.append(tools,dateInput,panel);',
  '  if(existing.length)existing.forEach(node=>panel.appendChild(node));else{panel.innerHTML=repeatMarkup();wireRepeat(panel,initial||todayKey())}\n  if(entryKind==="task"&&!$(".uw-task-repeat-note",panel)){const note=document.createElement("p");note.className="uw-task-repeat-note";note.textContent="완료한 날을 기준으로 다음 예정일이 자동으로 만들어져요.";panel.appendChild(note)}\n  form.append(tools,dateInput,panel);',
  "task repeat explanation");
write("js/task-input-controls.js",controls);

let interaction=read("js/interaction-fixes.js");
interaction=interaction.replace('"./task-input-controls.js?v=4"','"./task-input-controls.js?v=5"');
write("js/interaction-fixes.js",interaction);

const habitHistory=`import { supabase } from "./supabase.js";\nimport { normalizeCompletionRepeats } from "./repeat-after-completion.js?v=1";\n\nconst $=(selector,root=document)=>root.querySelector(selector);\nconst pad=(value)=>String(value).padStart(2,"0");\nconst key=(date)=>\`${'${date.getFullYear()}'}-${'${pad(date.getMonth()+1)}'}-${'${pad(date.getDate())}'}\`;\nconst fromKey=(value)=>new Date(\`${'${value}'}T12:00:00\`);\nconst esc=(value)=>String(value??"").replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[character]));\nconst todayKey=()=>{const date=new Date();date.setHours(date.getHours()-3);return key(date)};\n\nlet activeHabitId=null;\nlet activeTask=null;\nlet activeSeries=[];\nlet cursor=new Date();\nlet longPressTimer=null;\nlet longPressPoint=null;\n\nasync function readSeries(id){\n  const {data:{session}}=await supabase.auth.getSession();\n  if(!session?.user)return null;\n  const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",session.user.id).maybeSingle();\n  if(error)throw error;\n  const state=data?.data&&typeof data.data==="object"?data.data:{};\n  state.tasks=Array.isArray(state.tasks)?state.tasks:[];\n  normalizeCompletionRepeats(state);\n  const target=state.tasks.find((task)=>task.id===id&&task.isHabit);\n  if(!target)return null;\n  const seriesId=target.repeatSeriesId||target.id;\n  const series=state.tasks.filter((task)=>task.isHabit&&(task.repeatSeriesId||task.id)===seriesId);\n  return {target,series};\n}\n\nfunction installStyle(){\n  if($("#habitHistoryViewStyle"))return;\n  const style=document.createElement("style");style.id="habitHistoryViewStyle";style.textContent=\`\n    .habit-history-overlay{position:fixed;inset:0;z-index:12000;display:none;place-items:center;padding:18px;background:rgba(21,27,36,.28);backdrop-filter:blur(2px)}\n    .habit-history-overlay.open{display:grid}.habit-history-panel{width:min(480px,100%);max-height:min(760px,90vh);overflow:auto;border:1px solid var(--line);border-radius:16px;background:var(--panel,#fff);box-shadow:0 22px 70px rgba(15,23,42,.22)}\n    .habit-history-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;padding:18px 18px 12px;border-bottom:1px solid var(--line)}.habit-history-title{display:grid;gap:4px;min-width:0}.habit-history-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px}.habit-history-title span{color:var(--muted);font-size:11px}\n    .habit-history-close,.habit-history-nav button{border:0;background:transparent;color:var(--text);cursor:pointer}.habit-history-close{width:32px;height:32px;border-radius:8px;font-size:20px}.habit-history-close:hover,.habit-history-nav button:hover{background:var(--panel-soft)}\n    .habit-history-summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:14px 18px}.habit-history-summary strong{font-size:22px}.habit-history-summary span{color:var(--muted);font-size:11px}.habit-history-summary b{font-size:12px;color:var(--accent-dark)}\n    .habit-history-nav{display:grid;grid-template-columns:36px minmax(0,1fr) 36px;align-items:center;margin:0 18px 12px}.habit-history-nav button{height:34px;border-radius:8px;font-size:20px}.habit-history-nav strong{text-align:center;font-size:13px}\n    .habit-history-weekdays,.habit-history-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.habit-history-weekdays{padding:0 18px;color:var(--muted);font-size:10px;text-align:center}.habit-history-weekdays span{padding:6px 0}.habit-history-grid{gap:5px;padding:0 18px 18px}\n    .habit-history-day{position:relative;display:grid;place-items:center;aspect-ratio:1;border:1px solid transparent;border-radius:10px;color:var(--muted);font-size:11px}.habit-history-day.scheduled{border-color:var(--line);color:var(--text);background:var(--panel-soft)}.habit-history-day.completed{border-color:color-mix(in srgb,var(--accent) 65%,var(--line));background:color-mix(in srgb,var(--accent) 15%,#fff);color:var(--accent-dark);font-weight:700}.habit-history-day.future{opacity:.45}.habit-history-day.today{box-shadow:inset 0 0 0 1.5px var(--accent)}.habit-history-check{position:absolute;right:5px;bottom:3px;font-size:10px;font-weight:800}.habit-history-blank{aspect-ratio:1}.habit-history-note{padding:0 18px 18px;color:var(--muted);font-size:10px;line-height:1.5}#globalContextMenu [data-habit-history-action].hidden{display:none}\n    @media(max-width:520px){.habit-history-overlay{padding:8px;align-items:end}.habit-history-panel{max-height:88vh;border-radius:16px 16px 0 0}.habit-history-head{padding-top:16px}}\n  \`;document.head.appendChild(style)\n}\n\nfunction ensureOverlay(){\n  if($("#habitHistoryOverlay"))return;const overlay=document.createElement("div");overlay.id="habitHistoryOverlay";overlay.className="habit-history-overlay";overlay.innerHTML=\`<section class="habit-history-panel" role="dialog" aria-modal="true" aria-labelledby="habitHistoryTitle"><div class="habit-history-head"><div class="habit-history-title"><strong id="habitHistoryTitle">습관 기록</strong><span>실제로 완료한 날을 월별로 확인해요.</span></div><button class="habit-history-close" type="button" aria-label="기록 보기 닫기">×</button></div><div class="habit-history-summary"><strong id="habitHistoryCount">0회</strong><span>이번 달 완료</span><b id="habitHistoryNext">다음 예정 없음</b></div><div class="habit-history-nav"><button type="button" data-habit-history-prev aria-label="이전 달">‹</button><strong id="habitHistoryMonth"></strong><button type="button" data-habit-history-next aria-label="다음 달">›</button></div><div class="habit-history-weekdays"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div><div class="habit-history-grid" id="habitHistoryGrid"></div><div class="habit-history-note">다음 예정일은 마지막 완료일을 기준으로 계산돼요.</div></section>\`;document.body.appendChild(overlay);overlay.addEventListener("click",(event)=>{if(event.target===overlay||event.target.closest(".habit-history-close"))closeOverlay();if(event.target.closest("[data-habit-history-prev]")){cursor.setMonth(cursor.getMonth()-1);renderCalendar()}if(event.target.closest("[data-habit-history-next]")){cursor.setMonth(cursor.getMonth()+1);renderCalendar()}})\n}\nfunction closeOverlay(){$("#habitHistoryOverlay")?.classList.remove("open")}\nfunction completionDates(){const dates=new Set();for(const task of activeSeries){for(const [date,done] of Object.entries(task.recurrenceDone||{}))if(done===true)dates.add(date);if(task.done){if(task.completedDate)dates.add(task.completedDate);else if(task.completedAt)dates.add(key(new Date(task.completedAt)));else if(task.date)dates.add(task.date)}}return dates}\nfunction activeNextDate(){const active=activeSeries.find((task)=>task.recurrence?.frequency&&!task.done);return active?.date||null}\nfunction shortDate(value){if(!value)return"";const date=fromKey(value);return \`${'${date.getMonth()+1}'}/${'${date.getDate()}'}\`}\nfunction renderCalendar(){\n  if(!activeTask)return;const year=cursor.getFullYear(),month=cursor.getMonth(),first=new Date(year,month,1,12),lastDay=new Date(year,month+1,0,12).getDate(),today=todayKey(),doneDates=completionDates(),nextDate=activeNextDate();let completed=0,html="";for(let i=0;i<first.getDay();i+=1)html+='<div class="habit-history-blank" aria-hidden="true"></div>';for(let day=1;day<=lastDay;day+=1){const date=new Date(year,month,day,12),dateKey=key(date),done=doneDates.has(dateKey),scheduled=dateKey===nextDate,future=dateKey>today;if(done)completed+=1;const classes=["habit-history-day"];if(scheduled)classes.push("scheduled");if(done)classes.push("completed");if(future)classes.push("future");if(dateKey===today)classes.push("today");const label=\`${'${year}'}년 ${'${month+1}'}월 ${'${day}'}일${'${done?", 완료":scheduled?", 다음 예정":""}'}\`;html+=\`<div class="${'${classes.join(" ")}'}" aria-label="${'${esc(label)}'}"><span>${'${day}'}</span>${'${done?\'<span class="habit-history-check">✓</span>\':""}'}</div>\`}$("#habitHistoryTitle").textContent=activeTask.title||"습관 기록";$("#habitHistoryMonth").textContent=\`${'${year}'}년 ${'${month+1}'}월\`;$("#habitHistoryCount").textContent=\`${'${completed}'}회\`;$("#habitHistoryNext").textContent=nextDate?\`다음 ${'${shortDate(nextDate)}'}\`:"반복 종료";$("#habitHistoryGrid").innerHTML=html\n}\nasync function openHistory(id){try{const result=await readSeries(id);if(!result)return;activeTask=result.target;activeSeries=result.series;cursor=new Date();cursor.setDate(1);renderCalendar();$("#habitHistoryOverlay")?.classList.add("open")}catch(error){console.error("habit history load failed",error)}}\nfunction habitIdFromElement(element){const row=element?.closest?.('.onekan-repeat-row[data-context-kind="task"][data-context-id]');if(!row)return null;return row.querySelector(".onekan-repeat-kind")?.textContent?.trim()==="습관"?row.dataset.contextId:null}\nfunction syncMenuButton(id){const menu=$("#globalContextMenu");if(!menu)return;let button=menu.querySelector("[data-habit-history-action]");if(!button){button=document.createElement("button");button.type="button";button.setAttribute("role","menuitem");button.setAttribute("data-habit-history-action","1");button.textContent="기록 보기";const toggle=menu.querySelector('[data-context-action="toggle-habit"]'),duplicate=menu.querySelector('[data-context-action="duplicate"]');if(toggle)toggle.insertAdjacentElement("afterend",button);else if(duplicate)menu.insertBefore(button,duplicate);else menu.prepend(button)}activeHabitId=id||null;button.classList.toggle("hidden",!activeHabitId);if(activeHabitId)button.dataset.habitId=activeHabitId;else delete button.dataset.habitId}\nfunction installContextBridge(){document.addEventListener("contextmenu",(event)=>{const element=event.target instanceof Element?event.target:null;const id=habitIdFromElement(element);setTimeout(()=>syncMenuButton(id),0)},true);document.addEventListener("pointerdown",(event)=>{if(event.pointerType==="mouse")return;const element=event.target instanceof Element?event.target:null,id=habitIdFromElement(element);clearTimeout(longPressTimer);longPressPoint=id?{id,x:event.clientX,y:event.clientY}:null;if(!longPressPoint)return;longPressTimer=setTimeout(()=>syncMenuButton(longPressPoint?.id||null),590)},true);document.addEventListener("pointermove",(event)=>{if(!longPressPoint)return;if(Math.hypot(event.clientX-longPressPoint.x,event.clientY-longPressPoint.y)>10){clearTimeout(longPressTimer);longPressTimer=null;longPressPoint=null}},true);const cancel=()=>{clearTimeout(longPressTimer);longPressTimer=null;longPressPoint=null};document.addEventListener("pointerup",cancel,true);document.addEventListener("pointercancel",cancel,true);document.addEventListener("click",(event)=>{const button=event.target.closest?.("[data-habit-history-action]");if(!button)return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();const id=button.dataset.habitId||activeHabitId;$("#globalContextMenu")?.classList.remove("open");if(id)openHistory(id)},true);document.addEventListener("keydown",(event)=>{if(event.key==="Escape"&&$("#habitHistoryOverlay")?.classList.contains("open"))closeOverlay()})}\nfunction init(){installStyle();ensureOverlay();installContextBridge()}\nif(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();\n`;
write("js/habit-history-view.js",habitHistory);

let index=read("index.html");
index=index.replace('./css/style.css?v=21','./css/style.css?v=21');
index=index.replace('./js/interaction-fixes.js?v=36','./js/interaction-fixes.js?v=37');
index=index.replace('./js/app.js?v=41','./js/app.js?v=42');
index=index.replace('./js/unified-workspace.js?v=68','./js/unified-workspace.js?v=69');
index=index.replace('./js/repeat-overview.js?v=2','./js/repeat-overview.js?v=3');
index=index.replace('./js/project-plan.js?v=4','./js/project-plan.js?v=5');
index=index.replace('./js/habit-history-view.js?v=1','./js/habit-history-view.js?v=2');
write("index.html",index);
