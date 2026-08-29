from pathlib import Path

# 1) Make the task context-menu wording explicit: add vs change project.
context = Path('js/context-menu.js')
text = context.read_text()
old = '''  const selectedId = item?.projectId || "";\n  const normalize = (value) => {'''
new = '''  const selectedId = item?.projectId || "";\n  if (button) button.innerHTML = `${selectedId ? "프로젝트 변경" : "프로젝트 추가"} <span class="context-menu-arrow">›</span>`;\n  const normalize = (value) => {'''
if old not in text:
    raise SystemExit('context project label marker not found')
text = text.replace(old, new, 1)
context.write_text(text)

# 2) In project planning, use the same task date/time fields as the rest of Onekan.
plan = Path('js/project-plan.js')
text = plan.read_text()

old_css = '''    .onekan-plan-add-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin:4px 3px 0}\n    .onekan-plan-add-form input{height:34px;padding:0 9px;border:1px solid var(--line,#d2d7df);border-radius:7px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px;outline:none}\n'''
new_css = '''    .onekan-plan-add-form{display:grid;grid-template-columns:minmax(0,1fr) 132px 92px auto;gap:7px;margin:4px 3px 0}\n    .onekan-plan-add-form input{height:34px;min-width:0;padding:0 9px;border:1px solid var(--line,#d2d7df);border-radius:7px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px;outline:none}\n'''
if old_css not in text:
    raise SystemExit('plan add form css marker not found')
text = text.replace(old_css, new_css, 1)

old_mobile = '''    @media(max-width:700px){.onekan-plan-card{min-height:360px}.onekan-plan-top{grid-template-columns:1fr}.onekan-plan-period{justify-content:flex-end;padding:4px 10px 8px}.onekan-plan-task{grid-template-columns:24px minmax(0,1fr)}.onekan-plan-task-meta{grid-column:2}.onekan-plan-date-row{grid-template-columns:1fr}}\n'''
new_mobile = '''    @media(max-width:700px){.onekan-plan-card{min-height:360px}.onekan-plan-top{grid-template-columns:1fr}.onekan-plan-period{justify-content:flex-end;padding:4px 10px 8px}.onekan-plan-task{grid-template-columns:24px minmax(0,1fr)}.onekan-plan-task-meta{grid-column:2}.onekan-plan-date-row{grid-template-columns:1fr}.onekan-plan-add-form{grid-template-columns:minmax(0,1fr) 1fr}.onekan-plan-add-form input[type="text"]{grid-column:1/-1}}\n'''
if old_mobile not in text:
    raise SystemExit('plan mobile css marker not found')
text = text.replace(old_mobile, new_mobile, 1)

old_markup = '''function addFormMarkup() {\n  return `<form class="onekan-plan-add-form" data-plan-add-form><input maxlength="120" autocomplete="off" placeholder="할일 입력" aria-label="프로젝트 할일 입력"><button type="submit">추가</button></form>`;\n}\n'''
new_markup = '''function addFormMarkup() {\n  return `<form class="onekan-plan-add-form" data-plan-add-form><input class="onekan-plan-add-title" type="text" maxlength="120" autocomplete="off" placeholder="할일 입력" aria-label="프로젝트 할일 입력"><input class="onekan-plan-add-date" type="date" aria-label="할일 날짜"><input class="onekan-plan-add-time" type="time" aria-label="할일 시간"><button type="submit">추가</button></form>`;\n}\n'''
if old_markup not in text:
    raise SystemExit('plan add markup marker not found')
text = text.replace(old_markup, new_markup, 1)

old_add = '''async function addTask(title) {\n  const value = String(title || "").trim();\n  if (!value || !selectedProjectId) return;\n  try {\n    await writeState((current) => {\n      current.tasks = Array.isArray(current.tasks) ? current.tasks : [];\n      const groupId = current.eventGroups?.[0]?.id || "default";\n      current.tasks.push({ id: uid(), title: value, date: null, done: false, groupId, projectId: selectedProjectId, createdAt: new Date().toISOString() });\n    }, "project-plan-task-add");\n'''
new_add = '''async function addTask(title, dateValue = "", timeValue = "") {\n  const value = String(title || "").trim();\n  const taskDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(dateValue || "") ? dateValue : null;\n  const taskTime = /^\\d{2}:\\d{2}$/.test(timeValue || "") ? timeValue : "";\n  if (!value || !selectedProjectId) return;\n  if (taskTime && !taskDate) return showToast("시간을 정하려면 날짜도 함께 선택해 주세요.");\n  try {\n    await writeState((current) => {\n      current.tasks = Array.isArray(current.tasks) ? current.tasks : [];\n      const groupId = current.eventGroups?.[0]?.id || "default";\n      const task = { id: uid(), title: value, date: taskDate, done: false, groupId, projectId: selectedProjectId, createdAt: new Date().toISOString() };\n      if (taskDate && taskTime) {\n        const start = new Date(`${taskDate}T${taskTime}:00`);\n        task.notionStart = start.toISOString();\n        task.notionEnd = new Date(start.getTime() + 30 * 60000).toISOString();\n      }\n      current.tasks.push(task);\n    }, "project-plan-task-add");\n'''
if old_add not in text:
    raise SystemExit('plan addTask marker not found')
text = text.replace(old_add, new_add, 1)

old_submit = '''    const input = $("input", form);\n    addTask(input?.value);\n'''
new_submit = '''    const titleInput = $(".onekan-plan-add-title", form);\n    const dateInput = $(".onekan-plan-add-date", form);\n    const timeInput = $(".onekan-plan-add-time", form);\n    addTask(titleInput?.value, dateInput?.value, timeInput?.value);\n'''
if old_submit not in text:
    raise SystemExit('plan submit marker not found')
text = text.replace(old_submit, new_submit, 1)

old_focus = '''      requestAnimationFrame(() => $("[data-plan-add-form] input", root)?.focus());\n'''
new_focus = '''      requestAnimationFrame(() => $("[data-plan-add-form] .onekan-plan-add-title", root)?.focus());\n'''
if old_focus not in text:
    raise SystemExit('plan focus marker not found')
text = text.replace(old_focus, new_focus, 1)

plan.write_text(text)

# 3) Cache bumps.
index = Path('index.html')
text = index.read_text()
if './js/context-menu.js?v=24' not in text:
    raise SystemExit('context-menu cache marker not found')
if './js/project-plan.js?v=1' not in text:
    raise SystemExit('project-plan cache marker not found')
text = text.replace('./js/context-menu.js?v=24', './js/context-menu.js?v=25', 1)
text = text.replace('./js/project-plan.js?v=1', './js/project-plan.js?v=2', 1)
index.write_text(text)
