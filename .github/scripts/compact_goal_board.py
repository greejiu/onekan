from pathlib import Path

board = Path('js/goal-board-v2.js')
text = board.read_text()

text = text.replace(
    'let selectedSection = sessionStorage.getItem("onekan-goal-section") || "all";\nlet showArchived = sessionStorage.getItem("onekan-goal-archive") === "1";',
    'let selectedSection = sessionStorage.getItem("onekan-goal-section") || "all";\nlet showDone = sessionStorage.getItem("onekan-goal-done") === "1";\nlet showArchived = sessionStorage.getItem("onekan-goal-archive") === "1";',
    1,
)
text = text.replace('./css/goal-board-v2.css?v=2', './css/goal-board-v2.css?v=3', 1)

old_card = '''    <div class="ok-goal-card-meta">
      <span class="ok-goal-section-badge">${esc(section.name || "미분류")}</span>
      ${deadline ? `<span class="ok-goal-deadline${deadline.overdue ? " overdue" : ""}">${esc(deadline.text)}</span>` : ""}
    </div>
    <div class="ok-goal-progress">
      <small>${projects.length ? `프로젝트 ${done}/${projects.length} 완료` : "연결된 프로젝트 없음"}</small>
      ${projects.length ? `<div class="ok-goal-progress-track"><div class="ok-goal-progress-value" style="width:${percent}%"></div></div>` : ""}
    </div>'''
new_card = '''    <div class="ok-goal-card-meta">
      <span class="ok-goal-section-badge">${esc(section.name || "미분류")}</span>
      ${deadline ? `<span class="ok-goal-deadline${deadline.overdue ? " overdue" : ""}">${esc(deadline.text)}</span>` : ""}
      ${projects.length ? `<span class="ok-goal-progress-text">프로젝트 ${done}/${projects.length}</span>` : ""}
    </div>
    ${projects.length ? `<div class="ok-goal-progress-track"><div class="ok-goal-progress-value" style="width:${percent}%"></div></div>` : ""}'''
if old_card not in text:
    raise SystemExit('goal card block not found')
text = text.replace(old_card, new_card, 1)

old_toolbar = '<div class="ok-goal-v2-toolbar-right"><button class="ok-goal-v2-archive-toggle" id="okGoalArchiveToggle" type="button"></button></div>'
new_toolbar = '<div class="ok-goal-v2-toolbar-right"><button class="ok-goal-v2-done-toggle" id="okGoalDoneToggle" type="button"></button><button class="ok-goal-v2-archive-toggle" id="okGoalArchiveToggle" type="button"></button></div>'
if old_toolbar not in text:
    raise SystemExit('toolbar block not found')
text = text.replace(old_toolbar, new_toolbar, 1)

listener_marker = '''    $("#okGoalArchiveToggle", toolbar)?.addEventListener("click", () => {
      showArchived = !showArchived;
      sessionStorage.setItem("onekan-goal-archive", showArchived ? "1" : "0");
      renderBoard();
    });'''
listener_replacement = '''    $("#okGoalDoneToggle", toolbar)?.addEventListener("click", () => {
      showDone = !showDone;
      sessionStorage.setItem("onekan-goal-done", showDone ? "1" : "0");
      renderBoard();
    });
    $("#okGoalArchiveToggle", toolbar)?.addEventListener("click", () => {
      showArchived = !showArchived;
      sessionStorage.setItem("onekan-goal-archive", showArchived ? "1" : "0");
      renderBoard();
    });'''
if listener_marker not in text:
    raise SystemExit('archive listener block not found')
text = text.replace(listener_marker, listener_replacement, 1)

archive_render = '''  const archiveButton = $("#okGoalArchiveToggle", toolbar);
  if (archiveButton) {
    archiveButton.textContent = showArchived ? "보관 숨기기" : "보관 보기";
    archiveButton.classList.toggle("active", showArchived);
  }'''
toggle_render = '''  const doneButton = $("#okGoalDoneToggle", toolbar);
  if (doneButton) {
    doneButton.textContent = showDone ? "달성 숨기기" : "달성 보기";
    doneButton.classList.toggle("active", showDone);
  }
  const archiveButton = $("#okGoalArchiveToggle", toolbar);
  if (archiveButton) {
    archiveButton.textContent = showArchived ? "보관 숨기기" : "보관 보기";
    archiveButton.classList.toggle("active", showArchived);
  }'''
if archive_render not in text:
    raise SystemExit('archive render block not found')
text = text.replace(archive_render, toggle_render, 1)

old_defs = '  const defs = showArchived ? [...statusDefs, archivedDef] : statusDefs;'
new_defs = '  const defs = [statusDefs[0], statusDefs[1], ...(showDone ? [statusDefs[2]] : []), ...(showArchived ? [archivedDef] : [])];'
if old_defs not in text:
    raise SystemExit('status defs line not found')
text = text.replace(old_defs, new_defs, 1)

old_root = '  root.innerHTML = `<div class="ok-goal-board-scroll"><div class="ok-goal-board-v2" style="--ok-goal-columns:${defs.length}">${columns}</div></div>`;'
new_root = '  const focusClass = !showDone && !showArchived ? " focus-layout" : "";\n  root.innerHTML = `<div class="ok-goal-board-scroll"><div class="ok-goal-board-v2${focusClass}" style="--ok-goal-columns:${defs.length}">${columns}</div></div>`;'
if old_root not in text:
    raise SystemExit('board root line not found')
text = text.replace(old_root, new_root, 1)
board.write_text(text)

quick = Path('js/goal-quick-add.js')
qtext = quick.read_text()
qtext = qtext.replace('const VALID_STATUSES = new Set(["before", "doing", "done"]);', 'const VALID_STATUSES = new Set(["before", "doing"]);', 1)
quick.write_text(qtext)

css = Path('css/goal-board-v2.css')
ctext = css.read_text()
additions = '''
/* Focus layout: active work gets the space, completed states stay optional. */
#page-goals .ok-goal-v2-done-toggle{min-height:34px;padding:5px 10px;border:1px solid var(--line);border-radius:9px;background:var(--panel-soft);color:var(--muted);font:inherit;font-size:11px;cursor:pointer}
#page-goals .ok-goal-v2-done-toggle.active{background:#fff;color:var(--text);font-weight:700}
#page-goals .ok-goal-board-v2.focus-layout{grid-template-columns:minmax(220px,1fr) minmax(360px,2fr);min-width:700px}
#page-goals .ok-goal-card{gap:5px;padding:9px 10px 8px 13px}
#page-goals .ok-goal-card-title{line-height:1.35}
#page-goals .ok-goal-card-meta{gap:5px}
#page-goals .ok-goal-progress-text{margin-left:auto;color:var(--muted);font-size:9px;white-space:nowrap}
#page-goals .ok-goal-progress-track{height:3px}
@media(max-width:700px){#page-goals .ok-goal-v2-done-toggle,#page-goals .ok-goal-v2-archive-toggle{flex:1;width:auto;min-height:38px}#page-goals .ok-goal-board-v2.focus-layout{grid-template-columns:minmax(230px,64vw) minmax(280px,88vw);min-width:max-content}}
'''
if 'Focus layout: active work gets the space' not in ctext:
    ctext += additions
css.write_text(ctext)

loader = Path('js/interaction-fixes.js')
ltext = loader.read_text()
ltext = ltext.replace('import "./goal-board-v2.js?v=2";', 'import "./goal-board-v2.js?v=3";', 1)
ltext = ltext.replace('import "./goal-quick-add.js?v=1";', 'import "./goal-quick-add.js?v=2";', 1)
loader.write_text(ltext)

index = Path('index.html')
itext = index.read_text()
itext = itext.replace('./js/interaction-fixes.js?v=21', './js/interaction-fixes.js?v=22', 1)
index.write_text(itext)
