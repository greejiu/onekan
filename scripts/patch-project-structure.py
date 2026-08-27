from pathlib import Path
import re

ROOT = Path('.')

def must_replace(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

# index.html: rename work -> project, add parent goal field, load project planning module, bump caches.
index_path = ROOT / 'index.html'
index = index_path.read_text()
index = index.replace('작업', '프로젝트')
index = must_replace(
    index,
    '<div class="field"><label>그룹</label><select id="projectGroup"></select></div>\n      <div class="field"><label>시작일</label><input id="projectStartDate" type="date" /></div>',
    '<div class="field"><label>그룹</label><select id="projectGroup"></select></div>\n      <div class="field" id="projectGoalField"><label>상위 목표</label><select id="projectGoal"><option value="">연결 안 함</option></select></div>\n      <div class="field"><label>시작일</label><input id="projectStartDate" type="date" /></div>',
    'project goal field',
)
index = must_replace(index, './css/unified-workspace.css?v=25', './css/unified-workspace.css?v=26', 'css cache')
index = must_replace(index, './js/work-management.js?v=8', './js/work-management.js?v=9', 'work management cache')
index = must_replace(index, './js/work-status-inline-add.js?v=2', './js/work-status-inline-add.js?v=3', 'work inline cache')
index = must_replace(
    index,
    '<script type="module" src="./js/work-management.js?v=9"></script>\n  <script type="module" src="./js/work-status-inline-add.js?v=3"></script>',
    '<script type="module" src="./js/work-management.js?v=9"></script>\n  <script type="module" src="./js/project-planning.js?v=1"></script>\n  <script type="module" src="./js/work-status-inline-add.js?v=3"></script>',
    'project planning module load',
)
index_path.write_text(index)

# work-management.js: preserve new goal/project-plan relations and expose parent goal in project dialog.
wm_path = ROOT / 'js/work-management.js'
wm = wm_path.read_text()
old_cleanup = '''  for (const item of current.projects) delete item.goalId;\nfor (const task of current.tasks) {\n  delete task.projectId;\n  delete task.goalId;\n}\n'''
new_cleanup = '''  const validGoalIds = new Set(current.projects.filter((item) => item.kind === "goal").map((item) => item.id));\n  const validProjectIds = new Set(current.projects.filter((item) => item.kind === "project").map((item) => item.id));\n  for (const item of current.projects) {\n    if (item.kind === "goal") delete item.goalId;\n    else if (item.goalId && !validGoalIds.has(item.goalId)) delete item.goalId;\n  }\n  for (const task of current.tasks) {\n    if (task.projectId && !validProjectIds.has(task.projectId)) {\n      delete task.projectId;\n      if (task.projectPlan) delete task.projectPlan;\n    }\n    delete task.goalId;\n  }\n'''
wm = must_replace(wm, old_cleanup, new_cleanup, 'relation migration')
wm = must_replace(
    wm,
    '''function fillDialogOptions() {\n  $("#projectGroup").innerHTML = state.eventGroups.map((group) => `<option value="${group.id}">${esc(group.name)}</option>`).join("");\n}\n''',
    '''function fillDialogOptions() {\n  $("#projectGroup").innerHTML = state.eventGroups.map((group) => `<option value="${group.id}">${esc(group.name)}</option>`).join("");\n  const goalSelect = $("#projectGoal");\n  if (goalSelect) goalSelect.innerHTML = '<option value="">연결 안 함</option>' + state.projects.filter((item) => item.kind === "goal").map((goal) => `<option value="${goal.id}">${esc(goal.title)}</option>`).join("");\n}\n''',
    'dialog goal options',
)
wm = must_replace(
    wm,
    '''  $("#projectGroup").value = item?.groupId || state.eventGroups[0]?.id || "default";\n  $("#projectStartDate").value = item?.startDate || todayKey();''',
    '''  $("#projectGroup").value = item?.groupId || state.eventGroups[0]?.id || "default";\n  const goalField = $("#projectGoalField");\n  const goalSelect = $("#projectGoal");\n  if (goalField) goalField.hidden = kind !== "project";\n  if (goalSelect) goalSelect.value = kind === "project" ? (item?.goalId || "") : "";\n  $("#projectStartDate").value = item?.startDate || todayKey();''',
    'dialog goal selection',
)
old_convert = '''      const oldKind = item.kind;\n      item.kind = nextKind;\n      delete item.goalId;\n      if (oldKind === "project" && nextKind === "goal") {\n        current.tasks.forEach((task) => {\n          if (task.projectId !== id) return;\n          delete task.projectId;\n          task.goalId = id;\n        });\n      } else if (oldKind === "goal" && nextKind === "project") {\n        current.tasks.forEach((task) => {\n          if (task.goalId !== id) return;\n          delete task.goalId;\n          task.projectId = id;\n        });\n        current.projects.forEach((project) => { if (project.goalId === id) delete project.goalId; });\n      }'''
new_convert = '''      const oldKind = item.kind;\n      item.kind = nextKind;\n      if (nextKind === "goal") {\n        delete item.goalId;\n        current.tasks.forEach((task) => {\n          if (task.projectId !== id) return;\n          delete task.projectId;\n          if (task.projectPlan) delete task.projectPlan;\n        });\n      } else {\n        delete item.goalId;\n      }\n      if (oldKind === "goal" && nextKind === "project") {\n        current.projects.forEach((project) => { if (project.goalId === id) delete project.goalId; });\n      }'''
wm = must_replace(wm, old_convert, new_convert, 'goal project conversion')
wm = must_replace(
    wm,
    '''      item.deadline = $("#projectDeadline").value || "";\n      delete item.goalId;\n      if (item.status === "done")''',
    '''      item.deadline = $("#projectDeadline").value || "";\n      const selectedGoalId = $("#projectGoal")?.value || "";\n      if (kind === "project" && selectedGoalId) item.goalId = selectedGoalId;\n      else delete item.goalId;\n      if (item.status === "done")''',
    'save parent goal',
)
wm = wm.replace('작업', '프로젝트')
wm_path.write_text(wm)

# Quick-add module user-facing terminology.
quick_path = ROOT / 'js/work-status-inline-add.js'
quick = quick_path.read_text().replace('작업', '프로젝트')
quick_path.write_text(quick)

# Project planning styles.
css_path = ROOT / 'css/unified-workspace.css'
css = css_path.read_text()
marker = '/* Project planning bridge */'
if marker not in css:
    css += '''\n\n/* Project planning bridge */\n.uw-project-plans{margin:8px 0 0 17px;border-top:1px dashed color-mix(in srgb,var(--uw-group) 28%,var(--line));padding-top:6px}\n.uw-project-plans>summary{display:flex;align-items:center;gap:7px;min-height:28px;width:100%;list-style:none;color:var(--muted);font-size:10px;cursor:pointer;user-select:none}\n.uw-project-plans>summary::-webkit-details-marker{display:none}\n.uw-project-plans>summary>span:first-child{color:var(--text);font-weight:700}\n.uw-project-plans>summary small{display:inline-grid;place-items:center;min-width:26px;height:20px;padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--uw-group) 14%,#fff);color:var(--text);font-size:9px}\n.uw-project-plan-chevron{margin-left:auto;transition:transform .15s ease}.uw-project-plans[open] .uw-project-plan-chevron{transform:rotate(180deg)}\n.uw-project-plan-body{display:grid;gap:7px;padding:7px 0 2px}\n.uw-project-plan-list{display:grid;gap:5px}.uw-project-plan-empty{padding:8px;border-radius:8px;background:var(--soft);color:var(--muted);font-size:10px}\n.uw-project-plan-row{display:grid;grid-template-columns:22px minmax(0,1fr) 24px;gap:5px;align-items:center;padding:6px;border:1px solid var(--line);border-radius:9px;background:#fff}\n.uw-project-plan-row.done{opacity:.55}.uw-project-plan-row.done .uw-project-plan-title{text-decoration:line-through}\n.uw-project-plan-check{display:inline-grid;place-items:center;width:20px;height:20px;padding:0;border:1.5px solid var(--uw-group);border-radius:6px;background:#fff;color:#fff;font-size:10px;cursor:pointer}.uw-project-plan-check.checked{background:var(--uw-group)}\n.uw-project-plan-title{min-width:0;width:100%;height:28px;padding:3px 5px;border:0;border-radius:6px;background:transparent;color:var(--text);font:inherit;font-size:10px;outline:none}.uw-project-plan-title:focus{background:var(--soft);box-shadow:inset 0 0 0 1px var(--accent)}\n.uw-project-plan-date-wrap{grid-column:2/3;display:flex;align-items:center;gap:6px;min-width:0}.uw-project-plan-date{width:132px;max-width:100%;height:28px;padding:2px 5px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--muted);font-size:9px}.uw-project-plan-date-wrap small{color:var(--muted);font-size:9px;white-space:nowrap}\n.uw-project-plan-delete{grid-column:3;grid-row:1/3;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:16px;cursor:pointer}.uw-project-plan-delete:hover{background:var(--soft);color:var(--danger)}\n.uw-project-plan-add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;padding:7px;border-radius:9px;background:var(--soft)}.uw-project-plan-new-title{grid-column:1/-1;min-width:0;height:31px;padding:5px 7px;border:1px solid var(--line);border-radius:7px;background:#fff;font:inherit;font-size:10px}.uw-project-plan-new-date{display:flex;align-items:center;gap:6px;min-width:0}.uw-project-plan-new-date input{width:132px;max-width:100%;height:30px;padding:3px 5px;border:1px solid var(--line);border-radius:7px;background:#fff;font-size:9px}.uw-project-plan-new-date small{color:var(--muted);font-size:9px;white-space:nowrap}.uw-project-plan-add>button{min-height:30px;padding:4px 10px;border:0;border-radius:7px;background:var(--accent);color:#fff;font-size:10px;cursor:pointer}\n@media(max-width:700px){.uw-project-plans{margin-left:0}.uw-project-plan-row{padding:7px}.uw-project-plan-title{height:32px;font-size:12px}.uw-project-plan-date{height:32px}.uw-project-plan-add{grid-template-columns:1fr}.uw-project-plan-add>button{grid-column:1}.uw-project-plan-new-date{flex-wrap:wrap}}\n'''
css_path.write_text(css)

print('patched project structure and planning UI')
