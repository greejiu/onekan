import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (n) => String(n).padStart(2, "0");

let currentTarget = null;
let longPressTimer = null;
let longPressStart = null;
let suppressClickUntil = 0;

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayDate(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return date;
}

function relativeDayKey(offset = 0) {
  const date = appDayDate();
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length ? state.eventGroups : [{ id: "default", name: "기본", color: "#8fa9c4" }];
  state.timeBlocks = Array.isArray(state.timeBlocks) ? state.timeBlocks : [];
  state.habitTemplates = Array.isArray(state.habitTemplates) ? state.habitTemplates : [];
  state.habitDays = state.habitDays && typeof state.habitDays === "object" ? state.habitDays : {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  return { user: session.user, state };
}

async function writeState(mutator) {
  const current = await readState();
  if (!current) return false;
  mutator(current.state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: current.user.id, data: current.state }, { onConflict: "user_id" });
  if (error) throw error;
  $("#reloadCloudBtn")?.click();
  return true;
}

function getItem(state, target) {
  if (!target) return null;
  if (target.kind === "task") return state.tasks.find((item) => item.id === target.id);
  if (target.kind === "event") return state.events.find((item) => item.id === target.id);
  if (target.kind === "timeBlock") return state.timeBlocks.find((item) => item.id === target.id);
  if (target.kind === "habit") return state.habitTemplates.find((item) => item.id === target.id);
  if (target.kind === "project") return state.projects.find((item) => item.id === target.id);
  if (target.kind === "session") return state.sessions.find((item) => item.id === target.id);
  return null;
}

function elementIndex(element, selector) {
  return $$(selector).indexOf(element);
}

function resolveDirect(element) {
  const explicit = element.closest("[data-context-kind][data-context-id]");
  if (explicit) return { kind: explicit.dataset.contextKind, id: explicit.dataset.contextId };

  const feature = element.closest("[data-feature-kind][data-feature-id]");
  if (feature) return { kind: feature.dataset.featureKind === "event" ? "event" : "task", id: feature.dataset.featureId };

  const todayTask = element.closest("#taskList .row[data-id]");
  if (todayTask) return { kind: "task", id: todayTask.dataset.id };

  const somedayTask = element.closest("#featureSomedayList .row[data-task-id]");
  if (somedayTask) return { kind: "task", id: somedayTask.dataset.taskId };

  const block = element.closest(".time-block[data-block-id]");
  if (block) return { kind: "timeBlock", id: block.dataset.blockId };

  const project = element.closest(".project-row[data-project-id]");
  if (project) return { kind: "project", id: project.dataset.projectId };

  return null;
}

function resolveByPosition(element, state) {
  const habitRow = element.closest("#habitList .row");
  if (habitRow) {
    const checks = state.habitDays[relativeDayKey(0)] || {};
    const habits = [...state.habitTemplates].sort((a, b) => Number(!!checks[a.id]) - Number(!!checks[b.id]));
    const item = habits[elementIndex(habitRow, "#habitList .row")];
    return item ? { kind: "habit", id: item.id } : null;
  }

  const templateRow = element.closest("#habitTemplateList .template-row");
  if (templateRow) {
    const item = state.habitTemplates[elementIndex(templateRow, "#habitTemplateList .template-row")];
    return item ? { kind: "habit", id: item.id } : null;
  }

  const upcomingRow = element.closest("#upcomingList .row");
  if (upcomingRow) {
    const now = new Date();
    const events = state.events.filter((item) => new Date(item.start) >= now).sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 5);
    const item = events[elementIndex(upcomingRow, "#upcomingList .row")];
    return item ? { kind: "event", id: item.id } : null;
  }

  const todaySession = element.closest("#todaySessions .history-row");
  if (todaySession) {
    const dayKey = relativeDayKey(0);
    const sessions = state.sessions.filter((item) => item.end && localDateKey(appDayDate(new Date(item.end))) === dayKey).sort((a, b) => new Date(b.end) - new Date(a.end));
    const item = sessions[elementIndex(todaySession, "#todaySessions .history-row")];
    return item ? { kind: "session", id: item.id } : null;
  }

  const allSession = element.closest("#allSessions .history-row");
  if (allSession) {
    const sessions = [...state.sessions].sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 50);
    const item = sessions[elementIndex(allSession, "#allSessions .history-row")];
    return item ? { kind: "session", id: item.id } : null;
  }

  return null;
}

function isSupportedSurface(element) {
  return !!element.closest([
    "[data-context-kind][data-context-id]",
    "#taskList .row[data-id]",
    "#featureSomedayList .row[data-task-id]",
    ".time-block[data-block-id]",
    "#habitList .row",
    "#habitTemplateList .template-row",
    "#upcomingList .row",
    "#calendarBody .cal-event",
    "#calendarBody .day-timed-event",
    "#calendarBody .day-list .row",
    ".project-row[data-project-id]",
    "#todaySessions .history-row",
    "#allSessions .history-row",
  ].join(","));
}

function schedulable(kind) {
  return ["task", "event", "timeBlock"].includes(kind);
}

function duplicable(kind) {
  return ["task", "event", "timeBlock", "habit", "project"].includes(kind);
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hideMenu() {
  $("#globalContextMenu")?.classList.remove("open");
  currentTarget = null;
}

function groupable(kind) {
  return kind === "task" || kind === "event" || kind === "project" || kind === "session";
}

function renderGroupChoices(state, target) {
  const menu = $("#globalContextMenu");
  const groupButton = menu?.querySelector('[data-context-action="groups"]');
  const groupList = $("#contextGroupList");
  const groups = Array.isArray(state?.eventGroups) ? state.eventGroups : [];
  const available = groupable(target.kind) && groups.length > 0;
  groupButton?.classList.toggle("hidden", !available);
  groupList?.classList.add("hidden");
  if (!available || !groupList) {
    if (groupList) groupList.innerHTML = "";
    return;
  }
  const selectedId = getItem(state, target)?.groupId || groups[0]?.id;
  groupList.innerHTML = groups.map((group) => `<button type="button" role="menuitemradio" aria-checked="${group.id === selectedId}" data-context-group-id="${escapeAttr(group.id)}"><span class="context-group-dot" style="--group-color:${escapeAttr(group.color || "#8fa9c4")}"></span><span>${escapeAttr(group.name)}</span>${group.id === selectedId ? '<span class="context-group-check">✓</span>' : ""}</button>`).join("");
}

function showMenu(x, y, target, state) {
  currentTarget = target;
  const menu = $("#globalContextMenu");
  $$('[data-context-schedule]', menu).forEach((element) => element.classList.toggle("hidden", !schedulable(target.kind)));
  menu.querySelector('[data-context-action="duplicate"]')?.classList.toggle("hidden", !duplicable(target.kind));
  menu.querySelector('[data-context-action="session-time"]')?.classList.toggle("hidden", target.kind !== "session");
  renderGroupChoices(state, target);
  menu.classList.add("open");
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
}

function moveEventToDate(item, targetDate) {
  if (!item?.start) return;
  const start = new Date(item.start);
  const oldEnd = item.end ? new Date(item.end) : null;
  const duration = oldEnd && oldEnd > start ? oldEnd - start : 30 * 60000;
  const [year, month, day] = targetDate.split("-").map(Number);
  start.setFullYear(year, month - 1, day);
  item.start = start.toISOString();
  if (item.end) item.end = new Date(start.getTime() + duration).toISOString();
}

async function moveTarget(offset) {
  const target = currentTarget;
  hideMenu();
  if (!target || !schedulable(target.kind)) return;
  const targetDate = relativeDayKey(offset);
  try {
    await writeState((state) => {
      if (target.kind === "task") {
        const task = state.tasks.find((item) => item.id === target.id);
        if (task) task.date = targetDate;
      } else if (target.kind === "event") {
        moveEventToDate(state.events.find((item) => item.id === target.id), targetDate);
      } else if (target.kind === "timeBlock") {
        const block = state.timeBlocks.find((item) => item.id === target.id);
        if (block) block.date = targetDate;
      }
    });
  } catch (error) {
    console.error(error);
    window.alert("날짜를 변경하지 못했어요.");
  }
}

function editableTitleElement(root) {
  return root.querySelector([
    ".cal-event-title",
    ".workspace-task-title",
    ".habit-matrix-title",
    ".row-title",
    ".history-name",
    ".time-block-main strong",
    ".habit-time-main strong",
    ".day-timed-main strong",
    ".multi-entry strong",
    ".project-row strong",
    ".template-row > span",
  ].join(",")) || root.querySelector("strong");
}

function itemTitle(target, item) {
  if (target.kind === "timeBlock") return item.detail || item.sourceTitle || "시간 계획";
  return item.title || "";
}

function applyInlineTitle(state, target, value, root) {
  const item = getItem(state, target);
  if (!item) return;
  if (target.kind === "timeBlock") {
    item.detail = value;
    return;
  }
  const oldTitle = item.title;
  item.title = value;
  if (target.kind === "task") {
    state.timeBlocks.forEach((block) => {
      if (block.taskId !== item.id) return;
      if (block.sourceTitle === oldTitle) block.sourceTitle = value;
      if (root.dataset.blockId === block.id) block.detail = value;
    });
  }
}

function startInlineEdit(root, target, state) {
  const item = getItem(state, target);
  const titleElement = editableTitleElement(root);
  if (!item || !titleElement || root.querySelector(".context-inline-edit")) return;
  const original = itemTitle(target, item);
  const input = document.createElement("input");
  input.className = "context-inline-edit";
  input.value = original;
  input.setAttribute("aria-label", "제목 수정");
  const wasDraggable = root.draggable;
  root.draggable = false;
  titleElement.replaceWith(input);
  let finished = false;
  const restore = (value = original) => {
    if (!input.isConnected) return;
    titleElement.textContent = value;
    input.replaceWith(titleElement);
    root.draggable = wasDraggable;
  };
  const commit = async () => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (!value || value === original) return restore();
    restore(value);
    try {
      await writeState((latest) => applyInlineTitle(latest, target, value, root));
    } catch (error) {
      console.error(error);
      window.alert("수정하지 못했어요.");
      titleElement.textContent = original;
    }
  };
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    if (event.key === "Escape") { event.preventDefault(); finished = true; restore(); }
  });
  input.addEventListener("blur", commit);
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

async function deleteTarget() {
  const target = currentTarget;
  hideMenu();
  if (!target) return;
  try {
    await writeState((state) => {
      if (target.kind === "task") {
        state.tasks = state.tasks.filter((item) => item.id !== target.id);
        state.timeBlocks = state.timeBlocks.filter((item) => item.taskId !== target.id);
      } else if (target.kind === "event") {
        state.events = state.events.filter((item) => item.id !== target.id);
      } else if (target.kind === "timeBlock") {
        state.timeBlocks = state.timeBlocks.filter((item) => item.id !== target.id);
      } else if (target.kind === "habit") {
        state.habitTemplates = state.habitTemplates.filter((item) => item.id !== target.id);
        for (const day of Object.values(state.habitDays)) if (day && typeof day === "object") delete day[target.id];
      } else if (target.kind === "project") {
        const removed = state.projects.find((item) => item.id === target.id);
        state.projects = state.projects.filter((item) => item.id !== target.id);
        state.tasks.forEach((task) => { if (task.projectId === target.id) delete task.projectId; if (task.goalId === target.id) delete task.goalId; });
        if (removed?.kind === "goal") state.projects.forEach((item) => { if (item.goalId === target.id) item.goalId = null; });
      } else if (target.kind === "session") {
        state.sessions = state.sessions.filter((item) => item.id !== target.id);
      }
    });
  } catch (error) {
    console.error(error);
    window.alert("삭제하지 못했어요.");
  }
}

async function duplicateTarget() {
  const target = currentTarget;
  hideMenu();
  if (!target || !duplicable(target.kind)) return;
  try {
    await writeState((state) => {
      const item = getItem(state, target);
      if (!item) return;
      const copy = { ...item, id: newId() };
      if (target.kind === "task") {
        copy.title = `${item.title} 복사`;
        copy.done = false;
        copy.completedAt = null;
      } else if (target.kind === "event") {
        copy.title = `${item.title} 복사`;
      } else if (target.kind === "timeBlock") {
        copy.detail = `${item.detail || item.sourceTitle || "시간 계획"} 복사`;
        copy.taskId = null;
        copy.sourceTitle = copy.detail;
      } else if (target.kind === "habit") {
        copy.title = `${item.title} 복사`;
      } else if (target.kind === "project") {
        copy.title = `${item.title} 복사`;
      }
      const collection = target.kind === "task" ? state.tasks
        : target.kind === "event" ? state.events
        : target.kind === "timeBlock" ? state.timeBlocks
        : target.kind === "habit" ? state.habitTemplates
        : state.projects;
      const index = collection.findIndex((entry) => entry.id === target.id);
      collection.splice(index >= 0 ? index + 1 : collection.length, 0, copy);
    });
  } catch (error) {
    console.error(error);
    window.alert("복제하지 못했어요.");
  }
}

async function changeTargetGroup(groupId) {
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
    window.alert("영역을 변경하지 못했어요.");
  }
}

function ensureUI() {
  if ($("#globalContextMenu")) return;

  const menu = document.createElement("div");
  menu.id = "globalContextMenu";
  menu.className = "global-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-context-action="duplicate">복제</button>
    <button type="button" role="menuitem" data-context-action="groups">영역 <span class="context-menu-arrow">›</span></button>
    <div class="context-group-list hidden" id="contextGroupList" role="group"></div>
    <button type="button" role="menuitem" class="hidden" data-context-action="session-time">기록 변경</button>
    <button type="button" role="menuitem" class="danger" data-context-action="delete">삭제</button>`;
  document.body.appendChild(menu);

  const style = document.createElement("style");
  style.id = "globalContextMenuStyle";
  style.textContent = `
    .global-context-menu{position:fixed;z-index:10000;display:none;min-width:154px;padding:5px;background:#fff;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:9px;box-shadow:0 10px 28px rgba(15,23,42,.16)}
    .global-context-menu.open{display:block}
    .global-context-menu button{display:block;width:100%;min-height:36px;padding:7px 10px;border:0;border-radius:6px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px;text-align:left;cursor:pointer}
    .global-context-menu button:hover,.global-context-menu button:focus-visible{background:var(--hover,#f3f5f7);outline:none}
    .global-context-menu button.danger{color:var(--danger,#c84a4a)}
    .global-context-menu [data-context-action="groups"]{display:flex;align-items:center;justify-content:space-between}
    .context-menu-arrow{font-size:18px;line-height:1}
    .context-group-list{margin:3px 0;padding:3px;border-top:1px solid var(--line,#d2d7df);border-bottom:1px solid var(--line,#d2d7df);max-height:min(260px,55vh);overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;scrollbar-gutter:stable}
    .context-group-list button{display:grid;grid-template-columns:12px minmax(0,1fr) 16px;align-items:center;gap:7px;padding-left:7px}
    .context-group-dot{width:9px;height:9px;border-radius:3px;background:var(--group-color,#8fa9c4)}
    .context-group-check{text-align:right;color:var(--accent,#7666a8)}
    [data-context-kind][data-context-id] :is(.row-title,.cal-event-title,.workspace-task-title,.habit-matrix-title,.history-name,strong){cursor:text}
    .context-inline-edit{display:block;width:100%;min-width:0;height:24px;margin:-3px 0;padding:2px 5px;border:1.5px solid var(--accent,#7666a8);border-radius:5px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:inherit;line-height:1.25;outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--accent,#7666a8) 12%,transparent)}
    .time-block .context-inline-edit,.multi-entry .context-inline-edit{height:18px;margin:0;padding:0 4px;font-size:10px}
    .global-context-divider{height:1px;background:var(--line,#d2d7df);margin:4px 2px}
    .global-context-menu .hidden{display:none}
    @media (pointer:coarse){[data-context-kind][data-context-id]{-webkit-touch-callout:none}}
  `;
  document.head.appendChild(style);

  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-context-action]");
    if (!button) return;
    const action = button.dataset.contextAction;
    if (action === "today") moveTarget(0);
    else if (action === "tomorrow") moveTarget(1);
    else if (action === "duplicate") duplicateTarget();
    else if (action === "session-time") { const target = currentTarget; hideMenu(); if (target?.kind === "session") document.dispatchEvent(new CustomEvent("onekan:edit-session", { detail: { id: target.id } })); }
    else if (action === "groups") {
      $("#contextGroupList")?.classList.toggle("hidden");
      const rect = menu.getBoundingClientRect();
      const currentTop = Number.parseFloat(menu.style.top) || 8;
      menu.style.top = `${Math.max(8, Math.min(currentTop, innerHeight - rect.height - 8))}px`;
    }
    else if (action === "delete") deleteTarget();
  });
  menu.addEventListener("click", (event) => {
    const groupButton = event.target.closest("[data-context-group-id]");
    if (groupButton) changeTargetGroup(groupButton.dataset.contextGroupId);
  });

}

function installListeners() {
  if (document.documentElement.dataset.contextMenuWired) return;
  document.documentElement.dataset.contextMenuWired = "1";

  document.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || Date.now() >= suppressClickUntil || !isSupportedSurface(element)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("contextmenu", async (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element.closest("input,textarea,select,[contenteditable='true']") || !isSupportedSurface(element)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const current = await readState();
      if (!current) return;
      const target = resolveDirect(element) || resolveByPosition(element, current.state);
      if (!target) return;
      showMenu(event.clientX, event.clientY, target, current.state);
    } catch (error) {
      console.error("오른쪽 클릭 메뉴 연결 실패", error);
    }
  }, true);

  document.addEventListener("click", async (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    if (Date.now() < suppressClickUntil && isSupportedSurface(element)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (element.closest("button,input,textarea,select,a,summary,[contenteditable='true']")) return;
    const editable = element.closest([
      "[data-context-kind][data-context-id]",
      "#tasksPageList .workspace-task[data-context-kind='task']",
      "#habitHistory .habit-matrix-row[data-context-kind='habit']",
      "#habitTemplateList .template-row",
      "#habitList .row",
      "#upcomingList .row",
      "#calendarBody .cal-event",
      "#calendarBody .day-timed-event",
      "#calendarBody .day-list .row",
      "#calendarBody .multi-entry[data-context-kind]",
      ".project-row[data-project-id]",
      "#todaySessions .history-row",
      "#allSessions .history-row",
    ].join(","));
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    try {
      const current = await readState();
      const target = resolveDirect(editable) || resolveByPosition(editable, current?.state);
      if (!target) return;
      startInlineEdit(editable, target, current.state);
    } catch (error) {
      console.error("클릭 수정 연결 실패", error);
    }
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.("#globalContextMenu")) hideMenu();
    if (event.pointerType === "mouse") return;
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element.closest("button,input,textarea,select,a,[contenteditable='true']") || !isSupportedSurface(element)) return;
    clearTimeout(longPressTimer);
    const press = { x: event.clientX, y: event.clientY, element };
    longPressStart = press;
    longPressTimer = setTimeout(async () => {
      try {
        const current = await readState();
        const target = resolveDirect(press.element) || resolveByPosition(press.element, current?.state);
        if (!target) return;
        suppressClickUntil = Date.now() + 800;
        showMenu(press.x, press.y, target, current.state);
        navigator.vibrate?.(12);
      } catch (error) {
        console.error("길게 누르기 메뉴 연결 실패", error);
      } finally {
        longPressTimer = null;
        longPressStart = null;
      }
    }, 550);
  }, true);
  document.addEventListener("pointermove", (event) => {
    if (!longPressStart) return;
    if (Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 10) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressStart = null;
    }
  }, true);
  const cancelLongPress = () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  };
  document.addEventListener("pointerup", cancelLongPress, true);
  document.addEventListener("pointercancel", cancelLongPress, true);
  document.addEventListener("scroll", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("#globalContextMenu")) return;
    hideMenu();
  }, true);
  window.addEventListener("resize", hideMenu);
  window.addEventListener("blur", hideMenu);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideMenu(); });
}

function init() {
  ensureUI();
  installListeners();
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
  else hideMenu();
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) init();
