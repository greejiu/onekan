from pathlib import Path

root = Path('.')

index_path = root / 'index.html'
index = index_path.read_text()
old = '''      <div class="field"><label>마감기한</label><input id="projectDeadline" type="date" /></div>\n      <div class="dialog-actions">'''
new = '''      <div class="field"><label>마감기한</label><input id="projectDeadline" type="date" /></div>\n      <section class="uw-project-plan-editor" id="projectPlanEditor" hidden>\n        <div class="uw-project-plan-editor-head"><strong>계획</strong><small id="projectPlanProgress"></small></div>\n        <div class="uw-project-plan-list" id="projectPlanList"></div>\n        <div class="uw-project-plan-add">\n          <input class="uw-project-plan-new-title" id="projectPlanNewTitle" type="text" maxlength="120" autocomplete="off" placeholder="예: 50~54쪽 읽고 따라 그리기" aria-label="새 계획" />\n          <div class="uw-project-plan-new-date"><input id="projectPlanNewDate" type="date" aria-label="계획 날짜" /><small>날짜 없으면 언젠가</small></div>\n          <button id="projectPlanAddBtn" type="button">추가</button>\n        </div>\n      </section>\n      <div class="dialog-actions">'''
if index.count(old) != 1:
    raise SystemExit(f'project dialog insertion point: {index.count(old)}')
index = index.replace(old, new, 1)
if 'css/unified-workspace.css?v=26' not in index:
    raise SystemExit('expected unified-workspace cache v26')
if 'js/project-planning.js?v=1' not in index:
    raise SystemExit('expected project-planning cache v1')
index = index.replace('css/unified-workspace.css?v=26', 'css/unified-workspace.css?v=27', 1)
index = index.replace('js/project-planning.js?v=1', 'js/project-planning.js?v=2', 1)
index_path.write_text(index)

css_path = root / 'css/unified-workspace.css'
css = css_path.read_text()
marker = '/* Project plans inside edit dialog */'
if marker not in css:
    css += '''\n\n/* Project plans inside edit dialog */\n.uw-project-plan-summary{color:var(--accent-dark);font-weight:700}\n.uw-project-plan-editor{display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line);--uw-group:#8fa9c4}\n.uw-project-plan-editor[hidden]{display:none!important}\n.uw-project-plan-editor-head{display:flex;align-items:center;justify-content:space-between;gap:8px}\n.uw-project-plan-editor-head strong{font-size:12px}\n.uw-project-plan-editor-head small{color:var(--muted);font-size:9px}\n.uw-project-plan-editor .uw-project-plan-list{max-height:280px;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}\n.uw-project-plan-editor .uw-project-plan-row{grid-template-columns:22px minmax(0,1fr) 24px}\n.uw-project-plan-editor .uw-project-plan-add{margin-top:2px}\n@media(max-width:700px){.uw-project-plan-editor .uw-project-plan-list{max-height:240px}.uw-project-plan-editor{margin-top:10px;padding-top:10px}}\n'''
css_path.write_text(css)
