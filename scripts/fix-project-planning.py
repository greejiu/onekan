from pathlib import Path

wm_path = Path('js/work-management.js')
wm = wm_path.read_text()
old = 'convertButton.textContent = kind === "goal" ? "프로젝트으로 전환" : "목표로 전환";'
new = 'convertButton.textContent = kind === "goal" ? "프로젝트로 전환" : "목표로 전환";'
if wm.count(old) != 1:
    raise SystemExit(f'conversion label count: {wm.count(old)}')
wm_path.write_text(wm.replace(old, new, 1))

plan_path = Path('js/project-planning.js')
plan = plan_path.read_text()
old_decl = 'let reading = false;\n'
new_decl = 'let reading = false;\nconst openProjects = new Set();\n'
if plan.count(old_decl) != 1:
    raise SystemExit(f'open state declaration count: {plan.count(old_decl)}')
plan = plan.replace(old_decl, new_decl, 1)
old_open = '  details.open = wasOpen;\n  details.innerHTML = `'
new_open = '  details.open = wasOpen || openProjects.has(project.id);\n  details.addEventListener("toggle", () => { if (details.open) openProjects.add(project.id); else openProjects.delete(project.id); });\n  details.innerHTML = `'
if plan.count(old_open) != 1:
    raise SystemExit(f'open state binding count: {plan.count(old_open)}')
plan = plan.replace(old_open, new_open, 1)
plan_path.write_text(plan)

print('polished project planning labels and open state')
