import fs from 'node:fs';

const path = 'js/project-plan.js';
let src = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!src.includes(from)) throw new Error(`Missing patch target: ${label}`);
  src = src.replace(from, to);
}

replaceOnce(
`    .onekan-plan-task{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:6px;min-height:36px;padding:5px 7px;border-radius:8px;cursor:grab;user-select:none}\n`,
`    .onekan-plan-task{display:grid;grid-template-columns:24px minmax(0,1fr) auto auto;align-items:center;gap:6px;min-height:36px;padding:5px 7px;border-radius:8px;cursor:grab;user-select:none}\n`,
'plan task columns'
);

replaceOnce(
`    .onekan-plan-task-meta{color:var(--muted,#6d737d);font-size:9px;white-space:nowrap}\n`,
`    .onekan-plan-task-meta{color:var(--muted,#6d737d);font-size:9px;white-space:nowrap}\n    .onekan-plan-task-date{position:relative;display:flex;align-items:center;gap:5px;color:var(--muted,#6d737d);font-size:9px;white-space:nowrap}\n    .onekan-plan-task-date-button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--muted,#6d737d);cursor:pointer}\n    .onekan-plan-task-date-button:hover,.onekan-plan-task-date-button.active{background:var(--panel-soft,#f4f5f6);color:var(--accent,#8fa9c4)}\n    .onekan-plan-task-date-button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}\n    .onekan-plan-task-date-input{position:absolute!important;right:0;top:100%;width:1px!important;height:1px!important;min-width:1px!important;padding:0!important;border:0!important;opacity:0!important;pointer-events:none!important}\n`,
'plan date styles'
);

replaceOnce(
`    .onekan-plan-add-form{display:grid;grid-template-columns:minmax(0,1fr) 132px 92px auto;gap:7px;margin:4px 3px 0}\n`,
`    .onekan-plan-add-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin:4px 3px 0}\n`,
'add form columns'
);

replaceOnce(
`    @media(max-width:700px){.onekan-plan-card{min-height:360px}.onekan-plan-top{grid-template-columns:1fr}.onekan-plan-period{justify-content:flex-end;padding:4px 10px 8px}.onekan-plan-task{grid-template-columns:24px minmax(0,1fr)}.onekan-plan-task-meta{grid-column:2}.onekan-plan-date-row{grid-template-columns:1fr}.onekan-plan-add-form{grid-template-columns:minmax(0,1fr) 1fr}.onekan-plan-add-form input[type="text"]{grid-column:1/-1}}\n`,
`    @media(max-width:700px){.onekan-plan-card{min-height:360px}.onekan-plan-top{grid-template-columns:1fr}.onekan-plan-period{justify-content:flex-end;padding:4px 10px 8px}.onekan-plan-task{grid-template-columns:24px minmax(0,1fr) auto}.onekan-plan-task-meta{display:none}.onekan-plan-task-date{grid-column:3}.onekan-plan-date-row{grid-template-columns:1fr}.onekan-plan-add-form{grid-template-columns:minmax(0,1fr) auto}}\n`,
'mobile plan styles'
);

replaceOnce(
`function taskMeta(task) {\n  const parts = [];\n  if (task.date) parts.push(task.date);\n  if (task.notionStart) {\n    const date = new Date(task.notionStart);\n    parts.push(\`${'${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}' }\`);\n  }\n  return parts.join(" · ");\n}\n\nfunction taskRow(task) {\n  const meta = taskMeta(task);\n  return \`<div class="onekan-plan-task${'${task.done ? " done" : ""}'}" draggable="${'${!task.done}'}" data-plan-task-id="${'${esc(task.id)}'}" data-task-id="${'${esc(task.id)}'}" data-context-kind="task" data-context-id="${'${esc(task.id)}'}">\n    <button class="onekan-plan-check${'${task.done ? " checked" : ""}'}" data-plan-task-check="${'${esc(task.id)}'}" type="button" aria-label="완료 전환">${'${task.done ? "✓" : ""}'}</button>\n    <strong>${'${esc(task.title || "이름 없는 할일")}'}</strong>\n    ${'${meta ? `<span class="onekan-plan-task-meta">${esc(meta)}</span>` : ""}'}\n  </div>\`;\n}\n`,
`function taskMeta(task) {\n  if (!task.notionStart) return "";\n  const date = new Date(task.notionStart);\n  return \`${'${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}' }\`;\n}\n\nfunction taskRow(task) {\n  const meta = taskMeta(task);\n  const dateValue = /^\\d{4}-\\d{2}-\\d{2}$/.test(task.date || "") ? task.date : "";\n  return \`<div class="onekan-plan-task${'${task.done ? " done" : ""}'}" draggable="${'${!task.done}'}" data-plan-task-id="${'${esc(task.id)}'}" data-task-id="${'${esc(task.id)}'}" data-context-kind="task" data-context-id="${'${esc(task.id)}'}">\n    <button class="onekan-plan-check${'${task.done ? " checked" : ""}'}" data-plan-task-check="${'${esc(task.id)}'}" type="button" aria-label="완료 전환">${'${task.done ? "✓" : ""}'}</button>\n    <strong>${'${esc(task.title || "이름 없는 할일")}'}</strong>\n    ${'${meta ? `<span class="onekan-plan-task-meta">${esc(meta)}</span>` : ""}'}\n    <span class="onekan-plan-task-date">${'${dateValue ? `<span>${esc(dateValue)}</span>` : ""}'}<button class="onekan-plan-task-date-button${'${dateValue ? " active" : ""}'}" data-plan-task-date-button="${'${esc(task.id)}'}" type="button" aria-label="날짜 설정" title="${'${dateValue ? `날짜: ${esc(dateValue)}` : "날짜 설정"}'}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path></svg></button><input class="onekan-plan-task-date-input" data-plan-task-date-input="${'${esc(task.id)}'}" type="date" value="${'${esc(dateValue)}'}" aria-label="할일 날짜"></span>\n  </div>\`;\n}\n`,
'task row date control'
);

replaceOnce(
`function addFormMarkup() {\n  return \`<form class="onekan-plan-add-form" data-plan-add-form><input class="onekan-plan-add-title" type="text" maxlength="120" autocomplete="off" placeholder="할일 입력" aria-label="프로젝트 할일 입력"><input class="onekan-plan-add-date" type="date" aria-label="할일 날짜"><input class="onekan-plan-add-time" type="time" aria-label="할일 시간"><button type="submit">추가</button></form>\`;\n}\n`,
`function addFormMarkup() {\n  return \`<form class="onekan-plan-add-form" data-plan-add-form><input class="onekan-plan-add-title" type="text" maxlength="120" autocomplete="off" placeholder="할일 입력" aria-label="프로젝트 할일 입력"><button type="submit">추가</button></form>\`;\n}\n`,
'add form markup'
);

replaceOnce(
`async function addTask(title, dateValue = "", timeValue = "") {\n  const value = String(title || "").trim();\n  const taskDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(dateValue || "") ? dateValue : null;\n  const taskTime = /^\\d{2}:\\d{2}$/.test(timeValue || "") ? timeValue : "";\n  if (!value || !selectedProjectId) return;\n  if (taskTime && !taskDate) return showToast("시간을 정하려면 날짜도 함께 선택해 주세요.");\n  try {\n    await writeState((current) => {\n      current.tasks = Array.isArray(current.tasks) ? current.tasks : [];\n      const groupId = current.eventGroups?.[0]?.id || "default";\n      const task = { id: uid(), title: value, date: taskDate, done: false, groupId, projectId: selectedProjectId, createdAt: new Date().toISOString() };\n      if (taskDate && taskTime) {\n        const start = new Date(\`${'${taskDate}T${taskTime}:00'}\`);\n        task.notionStart = start.toISOString();\n        task.notionEnd = new Date(start.getTime() + 30 * 60000).toISOString();\n      }\n      current.tasks.push(task);\n    }, "project-plan-task-add");\n  } catch (error) {\n    console.error("프로젝트 할일 추가 실패", error);\n    showToast("할일을 추가하지 못했어요.");\n  }\n}\n`,
`async function addTask(title) {\n  const value = String(title || "").trim();\n  if (!value || !selectedProjectId) return;\n  try {\n    await writeState((current) => {\n      current.tasks = Array.isArray(current.tasks) ? current.tasks : [];\n      const groupId = current.eventGroups?.[0]?.id || "default";\n      current.tasks.push({ id: uid(), title: value, date: null, done: false, groupId, projectId: selectedProjectId, createdAt: new Date().toISOString() });\n    }, "project-plan-task-add");\n  } catch (error) {\n    console.error("프로젝트 할일 추가 실패", error);\n    showToast("할일을 추가하지 못했어요.");\n  }\n}\n\nasync function setTaskDate(taskId, dateValue) {\n  const nextDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(dateValue || "") ? dateValue : null;\n  try {\n    await writeState((current) => {\n      const task = current.tasks.find((item) => item.id === taskId);\n      if (!task) return;\n      const oldStart = task.notionStart ? new Date(task.notionStart) : null;\n      const oldEnd = task.notionEnd ? new Date(task.notionEnd) : null;\n      const duration = oldStart && oldEnd && oldEnd > oldStart ? oldEnd - oldStart : 30 * 60000;\n      task.date = nextDate;\n      if (!nextDate) {\n        delete task.notionStart;\n        delete task.notionEnd;\n        return;\n      }\n      if (oldStart && !Number.isNaN(oldStart.getTime())) {\n        const hh = String(oldStart.getHours()).padStart(2, "0");\n        const mm = String(oldStart.getMinutes()).padStart(2, "0");\n        const start = new Date(\`${'${nextDate}T${hh}:${mm}:00'}\`);\n        task.notionStart = start.toISOString();\n        task.notionEnd = new Date(start.getTime() + duration).toISOString();\n      }\n    }, "project-plan-task-date");\n  } catch (error) {\n    console.error("프로젝트 할일 날짜 변경 실패", error);\n    showToast("날짜를 변경하지 못했어요.");\n  }\n}\n`,
'add task and set date'
);

replaceOnce(
`    if (check) return toggleTask(check.dataset.planTaskCheck);\n    if (event.target.closest("[data-plan-period]")) return openProjectPeriod();\n`,
`    if (check) return toggleTask(check.dataset.planTaskCheck);\n    const dateButton = event.target.closest("[data-plan-task-date-button]");\n    if (dateButton) {\n      event.preventDefault();\n      event.stopPropagation();\n      const input = root.querySelector(\`[data-plan-task-date-input="${'${CSS.escape(dateButton.dataset.planTaskDateButton)}'}"]\`);\n      if (input) { try { input.showPicker(); } catch { input.click(); } }\n      return;\n    }\n    if (event.target.closest("[data-plan-period]")) return openProjectPeriod();\n`,
'click date button'
);

replaceOnce(
`  root.addEventListener("submit", (event) => {\n`,
`  root.addEventListener("change", (event) => {\n    const input = event.target.closest("[data-plan-task-date-input]");\n    if (!input) return;\n    event.stopPropagation();\n    setTaskDate(input.dataset.planTaskDateInput, input.value || "");\n  });\n  root.addEventListener("submit", (event) => {\n`,
'date input change listener'
);

replaceOnce(
`    const titleInput = $(".onekan-plan-add-title", form);\n    const dateInput = $(".onekan-plan-add-date", form);\n    const timeInput = $(".onekan-plan-add-time", form);\n    addTask(titleInput?.value, dateInput?.value, timeInput?.value);\n`,
`    const titleInput = $(".onekan-plan-add-title", form);\n    addTask(titleInput?.value);\n`,
'submit simplified add task'
);

fs.writeFileSync(path, src);

const indexPath = 'index.html';
let index = fs.readFileSync(indexPath, 'utf8');
if (!index.includes('./js/project-plan.js?v=2')) throw new Error('Missing project-plan cache target');
index = index.replace('./js/project-plan.js?v=2', './js/project-plan.js?v=3');
fs.writeFileSync(indexPath, index);
