from pathlib import Path

plan = Path('js/project-plan.js')
text = plan.read_text()
old = '.sort((a, b) => Number(!!a.done) - Number(!!b.done) || String(a.date || "9999-99-99").localeCompare(String(b.date || "9999-99-99")) || String(a.title || "").localeCompare(String(b.title || ""), "ko"));'
new = '.sort((a, b) => String(a.date || "9999-99-99").localeCompare(String(b.date || "9999-99-99")) || String(a.title || "").localeCompare(String(b.title || ""), "ko"));'
if old not in text:
    raise SystemExit('project plan sort marker not found')
plan.write_text(text.replace(old, new, 1))

index = Path('index.html')
html = index.read_text()
old_v = './js/project-plan.js?v=3'
new_v = './js/project-plan.js?v=4'
if old_v not in html:
    raise SystemExit('project-plan cache marker not found')
index.write_text(html.replace(old_v, new_v, 1))
