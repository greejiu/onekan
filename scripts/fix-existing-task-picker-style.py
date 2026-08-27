from pathlib import Path

path = Path('js/project-planning.js')
text = path.read_text()
old = '''function ensureExistingTaskPicker(editor) {\n  let box = $("#projectExistingTaskLink", editor);\n  if (!box) {\n    box = document.createElement("div");\n    box.id = "projectExistingTaskLink";\n    box.className = "uw-existing-link-box";\n    box.innerHTML = '<select id="projectExistingTaskSelect" aria-label="기존 할일 선택"></select><button id="projectExistingTaskLinkBtn" type="button">기존 할일 연결</button>';\n    editor.appendChild(box);\n  }\n  return box;\n}'''
new = '''function ensureExistingTaskPicker(editor) {\n  let box = $("#projectExistingTaskLink", editor);\n  if (!box) {\n    box = document.createElement("div");\n    box.id = "projectExistingTaskLink";\n    box.className = "uw-existing-link-box";\n    box.innerHTML = '<select id="projectExistingTaskSelect" aria-label="기존 할일 선택"></select><button id="projectExistingTaskLinkBtn" type="button">기존 할일 연결</button>';\n    editor.appendChild(box);\n  }\n  if (!$("#existingLinkPickerStyle")) {\n    const style = document.createElement("style");\n    style.id = "existingLinkPickerStyle";\n    style.textContent = '.uw-existing-link-box{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;margin-top:7px;padding-top:8px;border-top:1px dashed var(--line)}.uw-existing-link-box select{min-width:0;height:32px;padding:4px 7px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);font:inherit;font-size:10px}.uw-existing-link-box button{min-height:32px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--accent-dark);font:inherit;font-size:10px;cursor:pointer}.uw-existing-link-box button:disabled{opacity:.45;cursor:default}@media(max-width:700px){.uw-existing-link-box{grid-template-columns:1fr}.uw-existing-link-box select,.uw-existing-link-box button{height:36px;font-size:12px}}';\n    document.head.appendChild(style);\n  }\n  return box;\n}'''
if text.count(old) != 1:
    raise SystemExit(f'picker helper occurrence: {text.count(old)}')
path.write_text(text.replace(old, new, 1))

index = Path('index.html')
html = index.read_text()
if html.count('js/project-planning.js?v=3') != 1:
    raise SystemExit('expected project planning cache v3')
index.write_text(html.replace('js/project-planning.js?v=3', 'js/project-planning.js?v=4', 1))
