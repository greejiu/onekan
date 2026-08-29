from pathlib import Path

path = Path('js/context-menu.js')
text = path.read_text()

marker = '''function showMenu(x, y, target, state) {
  currentTarget = target;'''
helper = '''function renderProjectChoices(state, target) {
  const menu = $("#globalContextMenu");
  const button = menu?.querySelector('[data-context-action="projects"]');
  const list = $("#contextProjectList");
  const item = getItem(state, target);
  const available = target.kind === "task";
  button?.classList.toggle("hidden", !available);
  list?.classList.add("hidden");
  if (!available || !list) {
    if (list) list.innerHTML = "";
    return;
  }
  const selectedId = item?.projectId || "";
  const normalize = (value) => {
    const raw = String(value ?? "").trim().toLowerCase();
    if (["done", "완료", "달성", "complete", "completed"].includes(raw)) return "done";
    if (["archived", "보관", "closed", "archive"].includes(raw)) return "archived";
    if (["before", "시작 전", "시작전", "todo", "planned"].includes(raw)) return "before";
    return "doing";
  };
  const projects = (state.projects || []).filter((project) => (project?.kind === "project" || !project?.kind) && (normalize(project.status) === "doing" || project.id === selectedId)).sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));
  list.innerHTML = `<button type="button" role="menuitemradio" aria-checked="${!selectedId}" data-context-project-id=""><span></span><span>프로젝트 없음</span>${!selectedId ? '<span class="context-group-check">✓</span>' : '<span></span>'}</button>${projects.map((project) => `<button type="button" role="menuitemradio" aria-checked="${project.id === selectedId}" data-context-project-id="${escapeAttr(project.id)}"><span class="context-group-dot" style="--group-color:#8fa9c4"></span><span>${escapeAttr(project.title || "이름 없는 프로젝트")}</span>${project.id === selectedId ? '<span class="context-group-check">✓</span>' : '<span></span>'}</button>`).join("")}`;
}

'''
if marker not in text:
    raise SystemExit('showMenu marker not found')
text = text.replace(marker, helper + marker, 1)

show_marker = '''  renderGroupChoices(state, target);
  menu.classList.add("open");'''
if show_marker not in text:
    raise SystemExit('render choices marker not found')
text = text.replace(show_marker, '''  renderGroupChoices(state, target);
  renderProjectChoices(state, target);
  menu.classList.add("open");''', 1)

change_marker = '''async function toggleHabitTarget() {'''
change_func = '''async function changeTargetProject(projectId) {
  const target = currentTarget;
  hideMenu();
  if (!target || target.kind !== "task") return;
  try {
    await writeState((state) => {
      const task = state.tasks.find((item) => item.id === target.id);
      if (!task) return;
      if (projectId) task.projectId = projectId;
      else delete task.projectId;
    });
  } catch (error) {
    console.error(error);
    showToast("프로젝트를 변경하지 못했어요.");
  }
}

'''
if change_marker not in text:
    raise SystemExit('toggle habit marker not found')
text = text.replace(change_marker, change_func + change_marker, 1)

menu_marker = '''    <button type="button" role="menuitem" data-context-action="groups">영역 <span class="context-menu-arrow">›</span></button>
    <div class="context-group-list hidden" id="contextGroupList" role="group"></div>
    <button type="button" role="menuitem" class="hidden" data-context-action="session-time">기록 변경</button>'''
menu_new = '''    <button type="button" role="menuitem" data-context-action="groups">영역 <span class="context-menu-arrow">›</span></button>
    <div class="context-group-list hidden" id="contextGroupList" role="group"></div>
    <button type="button" role="menuitem" class="hidden" data-context-action="projects">프로젝트 <span class="context-menu-arrow">›</span></button>
    <div class="context-group-list hidden" id="contextProjectList" role="group"></div>
    <button type="button" role="menuitem" class="hidden" data-context-action="session-time">기록 변경</button>'''
if menu_marker not in text:
    raise SystemExit('menu marker not found')
text = text.replace(menu_marker, menu_new, 1)

style_marker = '''    .global-context-menu [data-context-action="groups"]{display:flex;align-items:center;justify-content:space-between}'''
if style_marker not in text:
    raise SystemExit('style marker not found')
text = text.replace(style_marker, '''    .global-context-menu [data-context-action="groups"],.global-context-menu [data-context-action="projects"]{display:flex;align-items:center;justify-content:space-between}''', 1)

click_marker = '''    else if (action === "groups") {
      $("#contextGroupList")?.classList.toggle("hidden");
      const rect = menu.getBoundingClientRect();
      const currentTop = Number.parseFloat(menu.style.top) || 8;
      menu.style.top = `${Math.max(8, Math.min(currentTop, innerHeight - rect.height - 8))}px`;
    }
    else if (action === "delete") deleteTarget();'''
click_new = '''    else if (action === "groups") {
      $("#contextProjectList")?.classList.add("hidden");
      $("#contextGroupList")?.classList.toggle("hidden");
      const rect = menu.getBoundingClientRect();
      const currentTop = Number.parseFloat(menu.style.top) || 8;
      menu.style.top = `${Math.max(8, Math.min(currentTop, innerHeight - rect.height - 8))}px`;
    }
    else if (action === "projects") {
      $("#contextGroupList")?.classList.add("hidden");
      $("#contextProjectList")?.classList.toggle("hidden");
      const rect = menu.getBoundingClientRect();
      const currentTop = Number.parseFloat(menu.style.top) || 8;
      menu.style.top = `${Math.max(8, Math.min(currentTop, innerHeight - rect.height - 8))}px`;
    }
    else if (action === "delete") deleteTarget();'''
if click_marker not in text:
    raise SystemExit('menu action marker not found')
text = text.replace(click_marker, click_new, 1)

submenu_marker = '''  menu.addEventListener("click", (event) => {
    const groupButton = event.target.closest("[data-context-group-id]");
    if (groupButton) changeTargetGroup(groupButton.dataset.contextGroupId);
  });'''
submenu_new = '''  menu.addEventListener("click", (event) => {
    const groupButton = event.target.closest("[data-context-group-id]");
    if (groupButton) return changeTargetGroup(groupButton.dataset.contextGroupId);
    const projectButton = event.target.closest("[data-context-project-id]");
    if (projectButton) changeTargetProject(projectButton.dataset.contextProjectId || "");
  });'''
if submenu_marker not in text:
    raise SystemExit('submenu marker not found')
text = text.replace(submenu_marker, submenu_new, 1)
path.write_text(text)

index = Path('index.html')
index_text = index.read_text().replace('./js/context-menu.js?v=24', './js/context-menu.js?v=25')
index.write_text(index_text)
