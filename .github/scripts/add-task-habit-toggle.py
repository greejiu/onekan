from pathlib import Path

context = Path('js/context-menu.js')
text = context.read_text()

old = '''function showMenu(x, y, target, state) {
  currentTarget = target;
  const menu = $("#globalContextMenu");
  $$('[data-context-schedule]', menu).forEach((element) => element.classList.toggle("hidden", !schedulable(target.kind)));
  menu.querySelector('[data-context-action="duplicate"]')?.classList.toggle("hidden", !duplicable(target.kind));
  menu.querySelector('[data-context-action="session-time"]')?.classList.toggle("hidden", target.kind !== "session");
  renderGroupChoices(state, target);'''
new = '''function showMenu(x, y, target, state) {
  currentTarget = target;
  const menu = $("#globalContextMenu");
  const item = getItem(state, target);
  const habitToggle = menu.querySelector('[data-context-action="toggle-habit"]');
  const canToggleHabit = target.kind === "task" && (item?.isHabit || (item?.recurrence?.frequency && item.recurrence.frequency !== "none"));
  habitToggle?.classList.toggle("hidden", !canToggleHabit);
  if (habitToggle && canToggleHabit) habitToggle.textContent = item?.isHabit ? "할일로 만들기" : "습관으로 만들기";
  $$('[data-context-schedule]', menu).forEach((element) => element.classList.toggle("hidden", !schedulable(target.kind)));
  menu.querySelector('[data-context-action="duplicate"]')?.classList.toggle("hidden", !duplicable(target.kind));
  menu.querySelector('[data-context-action="session-time"]')?.classList.toggle("hidden", target.kind !== "session");
  renderGroupChoices(state, target);'''
if old not in text:
    raise SystemExit('showMenu token not found')
text = text.replace(old, new, 1)

old = '''async function changeTargetGroup(groupId) {
  const target = currentTarget;
  hideMenu();
  if (!target || !groupable(target.kind) || !groupId) return;
  try {
    await writeState((state) => {
      if (!state.eventGroups?.some((group) => group.id === groupId)) return;
      const item = getItem(state, target);
      if (item) item.groupId = groupId;
    });
  } catch (error) {
    console.error(error);
    showToast("영역을 변경하지 못했어요.");
  }
}

function ensureUI() {'''
new = '''async function changeTargetGroup(groupId) {
  const target = currentTarget;
  hideMenu();
  if (!target || !groupable(target.kind) || !groupId) return;
  try {
    await writeState((state) => {
      if (!state.eventGroups?.some((group) => group.id === groupId)) return;
      const item = getItem(state, target);
      if (item) item.groupId = groupId;
    });
  } catch (error) {
    console.error(error);
    showToast("영역을 변경하지 못했어요.");
  }
}

async function toggleHabitTarget() {
  const target = currentTarget;
  hideMenu();
  if (!target || target.kind !== "task") return;
  let becameHabit = false;
  let didChange = false;
  try {
    const changed = await writeState((state) => {
      const task = state.tasks.find((item) => item.id === target.id);
      if (!task) return;
      const recurring = task.recurrence?.frequency && task.recurrence.frequency !== "none";
      if (!task.isHabit && !recurring) return;
      task.isHabit = !task.isHabit;
      becameHabit = task.isHabit;
      didChange = true;
    });
    if (!changed || !didChange) return;
    document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "task-habit-toggle" } }));
    showToast(becameHabit ? "습관으로 바꿨어요." : "반복 할일로 바꿨어요.");
  } catch (error) {
    console.error(error);
    showToast("종류를 변경하지 못했어요.");
  }
}

function ensureUI() {'''
if old not in text:
    raise SystemExit('changeTargetGroup token not found')
text = text.replace(old, new, 1)

old = '''  menu.innerHTML = `
    <button type="button" role="menuitem" data-context-action="duplicate">복제</button>'''
new = '''  menu.innerHTML = `
    <button type="button" role="menuitem" class="hidden" data-context-action="toggle-habit">습관으로 만들기</button>
    <button type="button" role="menuitem" data-context-action="duplicate">복제</button>'''
if old not in text:
    raise SystemExit('menu markup token not found')
text = text.replace(old, new, 1)

old = '''    if (action === "today") moveTarget(0);
    else if (action === "tomorrow") moveTarget(1);
    else if (action === "duplicate") duplicateTarget();'''
new = '''    if (action === "today") moveTarget(0);
    else if (action === "tomorrow") moveTarget(1);
    else if (action === "toggle-habit") toggleHabitTarget();
    else if (action === "duplicate") duplicateTarget();'''
if old not in text:
    raise SystemExit('menu click token not found')
text = text.replace(old, new, 1)
context.write_text(text)

repeat = Path('js/repeat-overview.js')
text = repeat.read_text()
text = text.replace('.onekan-repeat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}', '.onekan-repeat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}', 1)
text = text.replace('@media(max-width:760px){.onekan-repeat-grid{grid-template-columns:1fr}.onekan-repeat-row{min-height:56px}}', '@media(max-width:1080px){.onekan-repeat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}\n    @media(max-width:760px){.onekan-repeat-grid{grid-template-columns:1fr}.onekan-repeat-row{min-height:56px}}', 1)

old = '''  return `<div class="onekan-repeat-row" style="--repeat-group:${groupColor(state, item)}">
    <span class="onekan-repeat-dot" aria-hidden="true"></span>
    <div class="onekan-repeat-main">
      <strong>${esc(item.title || "이름 없음")}</strong>
      <div class="onekan-repeat-meta"><span>${esc(recurrenceLabel(item.recurrence, baseDate))}</span><span>·</span><span class="next">${esc(nextText)}</span></div>
    </div>
    <span class="onekan-repeat-kind">${kind === "task" ? "할일" : "일정"}</span>
  </div>`;'''
new = '''  const kindLabel = kind === "task" ? (item.isHabit ? "습관" : "할일") : "일정";
  return `<div class="onekan-repeat-row" data-context-kind="${kind}" data-context-id="${esc(item.id)}" style="--repeat-group:${groupColor(state, item)}">
    <span class="onekan-repeat-dot" aria-hidden="true"></span>
    <div class="onekan-repeat-main">
      <strong>${esc(item.title || "이름 없음")}</strong>
      <div class="onekan-repeat-meta"><span>${esc(recurrenceLabel(item.recurrence, baseDate))}</span><span>·</span><span class="next">${esc(nextText)}</span></div>
    </div>
    <span class="onekan-repeat-kind">${kindLabel}</span>
  </div>`;'''
if old not in text:
    raise SystemExit('repeat row token not found')
text = text.replace(old, new, 1)

old = '''    const tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter((item) => item.recurrence?.frequency && item.recurrence.frequency !== "none").sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));
    const events = (Array.isArray(state.events) ? state.events : []).filter((item) => item.recurrence?.frequency && item.recurrence.frequency !== "none").sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));
    host.innerHTML = sectionMarkup(state, "반복 할일", tasks, "task") + sectionMarkup(state, "반복 일정", events, "event");'''
new = '''    const recurringTasks = (Array.isArray(state.tasks) ? state.tasks : []).filter((item) => item.recurrence?.frequency && item.recurrence.frequency !== "none").sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));
    const tasks = recurringTasks.filter((item) => !item.isHabit);
    const habits = recurringTasks.filter((item) => item.isHabit);
    const events = (Array.isArray(state.events) ? state.events : []).filter((item) => item.recurrence?.frequency && item.recurrence.frequency !== "none").sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));
    host.innerHTML = sectionMarkup(state, "반복 할일", tasks, "task") + sectionMarkup(state, "습관", habits, "task") + sectionMarkup(state, "반복 일정", events, "event");'''
if old not in text:
    raise SystemExit('repeat render token not found')
text = text.replace(old, new, 1)
repeat.write_text(text)

index = Path('index.html')
text = index.read_text()
if './js/context-menu.js?v=22' not in text:
    raise SystemExit('context cache token not found')
if './js/repeat-overview.js?v=1' not in text:
    raise SystemExit('repeat cache token not found')
text = text.replace('./js/context-menu.js?v=22', './js/context-menu.js?v=23', 1)
text = text.replace('./js/repeat-overview.js?v=1', './js/repeat-overview.js?v=2', 1)
index.write_text(text)
