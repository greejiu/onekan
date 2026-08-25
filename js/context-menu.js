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

function timeValue(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function minuteText(minute) {
  const value = Math.max(0, Number(minute) || 0);
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function minuteFromText(text) {
  const [hour, minute] = String(text || "").split(":").map(Number);
  return Math.max(0, (hour || 0) * 60 + (minute || 0));
}

function datetimeLocalValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${localDateKey(date)}T${timeValue(date)}`;
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

function hideMenu() {
  $("#globalContextMenu")?.classList.remove("open");
  currentTarget = null;
}

function showMenu(x, y, target) {
  currentTarget = target;
  const menu = $("#globalContextMenu");
  $$('[data-context-schedule]', menu).forEach((element) => element.classList.toggle("hidden", !schedulable(target.kind)));
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

function field(label, control) {
  return `<div class="field"><label>${label}</label>${control}</div>`;
}

function editorFields(target, item, state) {
  if (target.kind === "task") {
    return field("할일", `<input id="contextEditTitle" required value="${escapeAttr(item.title)}">`) +
      field("날짜", `<input id="contextEditDate" type="date" value="${escapeAttr(item.date || "")}">`);
  }
  if (target.kind === "event") {
    const start = new Date(item.start);
    const end = item.end ? new Date(item.end) : new Date(start.getTime() + 30 * 60000);
    const groups = Array.isArray(state?.eventGroups) ? state.eventGroups : [];
    const groupOptions = groups.map((group) => `<option value="${escapeAttr(group.id)}"${group.id === item.groupId ? " selected" : ""}>${escapeAttr(group.name)}</option>`).join("");
    return field("일정", `<input id="contextEditTitle" required value="${escapeAttr(item.title)}">`) +
      field("날짜", `<input id="contextEditDate" type="date" required value="${localDateKey(start)}">`) +
      field("시작", `<input id="contextEditStart" type="time" required value="${timeValue(start)}">`) +
      field("종료", `<input id="contextEditEnd" type="time" required value="${timeValue(end)}">`) +
      field("그룹", `<select id="contextEditGroup">${groupOptions}</select>`);
  }
  if (target.kind === "timeBlock") {
    return field("시간 계획", `<input id="contextEditTitle" required value="${escapeAttr(item.detail || item.sourceTitle || "시간 계획")}">`) +
      field("날짜", `<input id="contextEditDate" type="date" required value="${escapeAttr(item.date || relativeDayKey(0))}">`) +
      field("시작", `<input id="contextEditStart" type="time" step="1800" required value="${minuteText(item.startMinute)}">`) +
      field("길이", `<select id="contextEditDuration"><option value="30">30분</option><option value="60">1시간</option><option value="90">1시간 30분</option><option value="120">2시간</option><option value="180">3시간</option><option value="240">4시간</option></select>`);
  }
  if (target.kind === "habit") {
    return field("습관", `<input id="contextEditTitle" required value="${escapeAttr(item.title)}">`);
  }
  if (target.kind === "project") {
    return field("제목", `<input id="contextEditTitle" required value="${escapeAttr(item.title)}">`) +
      field("구분", `<select id="contextEditStatus"><option>목표</option><option>작업</option><option>보류</option><option>완료</option></select>`) +
      field("카테고리", `<input id="contextEditCategory" value="${escapeAttr(item.category || "")}">`) +
      field("진행률", `<input id="contextEditProgress" type="number" min="0" max="100" value="${Number(item.progress || 0)}">`) +
      field("마감일", `<input id="contextEditDeadline" type="date" value="${escapeAttr(item.deadline || "")}">`);
  }
  if (target.kind === "session") {
    return field("기록 이름", `<input id="contextEditTitle" required value="${escapeAttr(item.title || "집중 기록")}">`) +
      field("시작", `<input id="contextEditSessionStart" type="datetime-local" required value="${datetimeLocalValue(item.start)}">`) +
      field("종료", `<input id="contextEditSessionEnd" type="datetime-local" required value="${datetimeLocalValue(item.end)}">`);
  }
  return "";
}

async function openEditor() {
  const target = currentTarget;
  hideMenu();
  if (!target) return;
  try {
    const current = await readState();
    const item = getItem(current?.state, target);
    if (!item) return;
    currentTarget = target;
    $("#contextEditFields").innerHTML = editorFields(target, item, current.state);
    if (target.kind === "timeBlock") $("#contextEditDuration").value = String(item.duration || 30);
    if (target.kind === "project") $("#contextEditStatus").value = item.status || "작업";
    $("#contextEditDialog").showModal();
    setTimeout(() => $("#contextEditFields input")?.focus(), 0);
  } catch (error) {
    console.error(error);
    window.alert("항목을 불러오지 못했어요.");
  }
}

async function saveEditor() {
  const target = currentTarget;
  if (!target) return;
  try {
    await writeState((state) => {
      const item = getItem(state, target);
      if (!item) return;
      const title = $("#contextEditTitle")?.value.trim();
      if (title) {
        if (target.kind === "timeBlock") item.detail = title;
        else item.title = title;
      }

      if (target.kind === "task") {
        item.date = $("#contextEditDate").value || null;
      } else if (target.kind === "event") {
        const date = $("#contextEditDate").value;
        const start = new Date(`${date}T${$("#contextEditStart").value}:00`);
        let end = new Date(`${date}T${$("#contextEditEnd").value}:00`);
        if (!(end > start)) end = new Date(start.getTime() + 30 * 60000);
        item.start = start.toISOString();
        item.end = end.toISOString();
        item.groupId = $("#contextEditGroup")?.value || state.eventGroups?.[0]?.id || "default";
      } else if (target.kind === "timeBlock") {
        item.date = $("#contextEditDate").value || relativeDayKey(0);
        item.startMinute = minuteFromText($("#contextEditStart").value);
        item.duration = Number($("#contextEditDuration").value || 30);
      } else if (target.kind === "project") {
        item.status = $("#contextEditStatus").value;
        item.category = $("#contextEditCategory").value.trim();
        item.progress = Math.max(0, Math.min(100, Number($("#contextEditProgress").value || 0)));
        item.deadline = $("#contextEditDeadline").value || null;
      } else if (target.kind === "session") {
        const start = new Date($("#contextEditSessionStart").value);
        const end = new Date($("#contextEditSessionEnd").value);
        if (!(end > start)) throw new Error("INVALID_SESSION_RANGE");
        item.start = start.toISOString();
        item.end = end.toISOString();
        item.durationMs = end - start;
      }
    });
    $("#contextEditDialog").close();
    currentTarget = null;
  } catch (error) {
    console.error(error);
    window.alert(error?.message === "INVALID_SESSION_RANGE" ? "종료 시간은 시작 시간보다 뒤여야 해요." : "수정하지 못했어요.");
  }
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
        state.projects = state.projects.filter((item) => item.id !== target.id);
      } else if (target.kind === "session") {
        state.sessions = state.sessions.filter((item) => item.id !== target.id);
      }
    });
  } catch (error) {
    console.error(error);
    window.alert("삭제하지 못했어요.");
  }
}

function ensureUI() {
  if ($("#globalContextMenu")) return;

  const menu = document.createElement("div");
  menu.id = "globalContextMenu";
  menu.className = "global-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" class="danger" data-context-action="delete">삭제하기</button>`;
  document.body.appendChild(menu);

  const dialog = document.createElement("dialog");
  dialog.id = "contextEditDialog";
  dialog.className = "app-dialog";
  dialog.innerHTML = `<form method="dialog" id="contextEditForm"><h3>수정하기</h3><div id="contextEditFields"></div><div class="dialog-actions"><button class="soft-btn" type="button" id="contextEditCancel">취소</button><button class="primary-btn" type="submit">저장</button></div></form>`;
  document.body.appendChild(dialog);

  const style = document.createElement("style");
  style.id = "globalContextMenuStyle";
  style.textContent = `
    .global-context-menu{position:fixed;z-index:10000;display:none;min-width:154px;padding:5px;background:#fff;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:9px;box-shadow:0 10px 28px rgba(15,23,42,.16)}
    .global-context-menu.open{display:block}
    .global-context-menu button{display:block;width:100%;min-height:36px;padding:7px 10px;border:0;border-radius:6px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px;text-align:left;cursor:pointer}
    .global-context-menu button:hover,.global-context-menu button:focus-visible{background:var(--hover,#f3f5f7);outline:none}
    .global-context-menu button.danger{color:var(--danger,#c84a4a)}
    .global-context-divider{height:1px;background:var(--line,#d2d7df);margin:4px 2px}
    .global-context-menu .hidden{display:none}
    #contextEditFields{display:grid;gap:2px}
  `;
  document.head.appendChild(style);

  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-context-action]");
    if (!button) return;
    const action = button.dataset.contextAction;
    if (action === "today") moveTarget(0);
    else if (action === "tomorrow") moveTarget(1);
    else if (action === "edit") openEditor();
    else if (action === "delete") deleteTarget();
  });

  $("#contextEditCancel").addEventListener("click", () => {
    $("#contextEditDialog").close();
    currentTarget = null;
  });
  $("#contextEditForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveEditor();
  });
}

function installListeners() {
  if (document.documentElement.dataset.contextMenuWired) return;
  document.documentElement.dataset.contextMenuWired = "1";

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
      showMenu(event.clientX, event.clientY, target);
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
      "#tasksPageList .workspace-task[data-context-kind='task']",
      "#habitManageList .habit-manage-row[data-context-kind='habit']",
      "#habitList .row",
      "#upcomingList .row",
      "#calendarBody .cal-event",
      "#calendarBody .day-timed-event",
      "#calendarBody .day-list .row",
      ".project-row[data-project-id]",
      "#todaySessions .history-row",
      "#allSessions .history-row",
    ].join(","));
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const current = await readState();
      const target = resolveDirect(editable) || resolveByPosition(editable, current?.state);
      if (!target) return;
      currentTarget = target;
      await openEditor();
    } catch (error) {
      console.error("클릭 수정 연결 실패", error);
    }
  });

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
        showMenu(press.x, press.y, target);
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
  document.addEventListener("scroll", hideMenu, true);
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
