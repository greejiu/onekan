import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (n) => String(n).padStart(2, "0");

let contextTarget = null;
let stateCache = null;

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayDate(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return date;
}

function relativeDayKey(offset) {
  const date = appDayDate();
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function timeValue(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function datetimeLocalValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${localDateKey(date)}T${timeValue(date)}`;
}

function minuteText(minute) {
  const value = Math.max(0, Number(minute) || 0);
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function minuteFromText(text) {
  const [hour, minute] = String(text || "").split(":").map(Number);
  return Math.max(0, (hour || 0) * 60 + (minute || 0));
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
  stateCache = state;
  return { user: session.user, state };
}

async function writeState(mutator) {
  const current = await readState();
  if (!current) return false;
  mutator(current.state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: current.user.id, data: current.state }, { onConflict: "user_id" });
  if (error) throw error;
  stateCache = current.state;
  $("#reloadCloudBtn")?.click();
  return true;
}

function indexOfElement(element, selector, root) {
  return $$(selector, root).indexOf(element);
}

function resolveDirect(element) {
  const taskToday = element.closest("#taskList .row[data-id]");
  if (taskToday) return { kind: "task", id: taskToday.dataset.id };

  const taskSomeday = element.closest("#featureSomedayList .row[data-task-id]");
  if (taskSomeday) return { kind: "task", id: taskSomeday.dataset.taskId };

  const block = element.closest(".time-block[data-block-id]");
  if (block) return { kind: "timeBlock", id: block.dataset.blockId };

  const project = element.closest(".project-row[data-project-id]");
  if (project) return { kind: "project", id: project.dataset.projectId };

  const calendar = element.closest("#calendarBody [data-feature-id][data-feature-kind]");
  if (calendar) return { kind: calendar.dataset.featureKind === "event" ? "event" : "task", id: calendar.dataset.featureId };

  return null;
}

function resolveByPosition(element, state) {
  const habitRow = element.closest("#habitList .row");
  if (habitRow) {
    const dayKey = relativeDayKey(0);
    const checks = state.habitDays[dayKey] || {};
    const habits = [...state.habitTemplates].sort((a, b) => Number(!!checks[a.id]) - Number(!!checks[b.id]));
    const index = indexOfElement(habitRow, "#habitList .row", document);
    return habits[index] ? { kind: "habit", id: habits[index].id } : null;
  }

  const templateRow = element.closest("#habitTemplateList .template-row");
  if (templateRow) {
    const index = indexOfElement(templateRow, "#habitTemplateList .template-row", document);
    return state.habitTemplates[index] ? { kind: "habit", id: state.habitTemplates[index].id } : null;
  }

  const upcomingRow = element.closest("#upcomingList .row");
  if (upcomingRow) {
    const now = new Date();
    const events = state.events.filter((item) => new Date(item.start) >= now).sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 5);
    const index = indexOfElement(upcomingRow, "#upcomingList .row", document);
    return events[index] ? { kind: "event", id: events[index].id } : null;
  }

  const todaySession = element.closest("#todaySessions .history-row");
  if (todaySession) {
    const dayKey = relativeDayKey(0);
    const sessions = state.sessions.filter((item) => item.end && localDateKey(appDayDate(new Date(item.end))) === dayKey).sort((a, b) => new Date(b.end) - new Date(a.end));
    const index = indexOfElement(todaySession, "#todaySessions .history-row", document);
    return sessions[index] ? { kind: "session", id: sessions[index].id } : null;
  }

  const allSession = element.closest("#allSessions .history-row");
  if (allSession) {
    const sessions = [...state.sessions].sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 50);
    const index = indexOfElement(allSession, "#allSessions .history-row", document);
    return sessions[index] ? { kind: "session", id: sessions[index].id } : null;
  }

  return null;
}

function isActionableSurface(element) {
  return !!element.closest([
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

function closeMenu() {
  $("#universalContextMenu")?.classList.remove("open");
  contextTarget = null;
}

function openMenu(x, y, target) {
  contextTarget = target;
  const menu = $("#universalContextMenu");
  const scheduleButtons = $$('[data-context-schedule]', menu);
  scheduleButtons.forEach((button) => button.classList.toggle("hidden", !schedulable(target.kind)));
  menu.classList.add("open");
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function moveEventToDate(item, dateKey) {
  if (!item?.start) return;
  const start = new Date(item.start);
  const oldEnd = item.end ? new Date(item.end) : null;
  const duration = oldEnd && oldEnd > start ? oldEnd - start : 30 * 60000;
  const [year, month, day] = dateKey.split("-").map(Number);
  start.setFullYear(year, month - 1, day);
  item.start = start.toISOString();
  if (item.end) item.end = new Date(start.getTime() + duration).toISOString();
}

async function scheduleTarget(offset) {
  if (!contextTarget || !schedulable(contextTarget.kind)) return;
  const target = contextTarget;
  closeMenu();
  const dateKey = relativeDayKey(offset);
  try {
    await writeState((state) => {
      if (target.kind === "task") {
        const item = state.tasks.find((entry) => entry.id === target.id);
        if (item) item.date = dateKey;
      } else if (target.kind === "event") {
        moveEventToDate(state.events.find((entry) => entry.id === target.id), dateKey);
      } else if (target.kind === "timeBlock") {
        const item = state.timeBlocks.find((entry) => entry.id === target.id);
        if (item) item.date = dateKey;
      }
    });
  } catch (error) {
    console.error(error);
    window.alert("날짜를 바꾸지 못했어요.");
  }
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

function field(label, control) {
  return `<div class="field"><label>${label}</label>${control}</div>`;
}

function buildEditor(target, item) {
  if (target.kind === "task") {
    return field("할일", `<input id="universalEditTitle" required value="${escapeAttr(item.title)}">`) +
      field("날짜", `<input id="universalEditDate" type="date" value="${escapeAttr(item.date || "")}">`);
  }
  if (target.kind === "event") {
    const start = new Date(item.start);
    const end = item.end ? new Date(item.end) : new Date(start.getTime() + 30 * 60000);
    return field("일정", `<input id="universalEditTitle" required value="${escapeAttr(item.title)}">`) +
      field("날짜", `<input id="universalEditDate" type="date" required value="${localDateKey(start)}">`) +
      field("시작", `<input id="universalEditStartTime" type="time" required value="${timeValue(start)}">`) +
      field("종료", `<input id="universalEditEndTime" type="time" required value="${timeValue(end)}">`);
  }
  if (target.kind === "timeBlock") {
    return field("시간 계획", `<input id="universalEditTitle" required value="${escapeAttr(item.detail || item.sourceTitle || "시간 계획")}">`) +
      field("날짜", `<input id="universalEditDate" type="date" required value="${escapeAttr(item.date || relativeDayKey(0))}">`) +
      field("시작", `<input id="universalEditStartTime" type="time" step="1800" required value="${minuteText(item.startMinute)}">`) +
      field("길이", `<select id="universalEditDuration"><option value="30">30분</option><option value="60">1시간</option><option value="90">1시간 30분</option><option value="120">2시간</option><option value="180">3시간</option><option value="240">4시간</option></select>`);
  }
  if (target.kind === "habit") {
    return field("습관", `<input id="universalEditTitle" required value="${escapeAttr(item.title)}">`);
  }
  if (target.kind === "project") {
    return field("제목", `<input id="universalEditTitle" required value="${escapeAttr(item.title)}">`) +
      field("구분", `<select id="universalEditStatus"><option>목표</option><option>작업</option><option>보류</option><option>완료</option></select>`) +
      field("카테고리", `<input id="universalEditCategory" value="${escapeAttr(item.category || "")}">`) +
      field("진행률", `<input id="universalEditProgress" type="number" min="0" max="100" value="${Number(item.progress || 0)}">`) +
      field("마감일", `<input id="universalEditDeadline" type="date" value="${escapeAttr(item.deadline || "")}">`);
  }
  if (target.kind === "session") {
    return field("기록 이름", `<input id="universalEditTitle" required value="${escapeAttr(item.title || "집중 기록")}">`) +
      field("시작", `<input id="universalEditSessionStart" type="datetime-local" required value="${datetimeLocalValue(item.start)}">`) +
      field("종료", `<input id="universalEditSessionEnd" type="datetime-local" required value="${datetimeLocalValue(item.end)}">`);
  }
  return "";
}

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

async function openEditor() {
  const target = contextTarget;
  closeMenu();
  if (!target) return;
  try {
    const current = await readState();
    const item = getItem(current?.state, target);
    if (!item) return;
    contextTarget = target;
    const dialog = $("#universalEditDialog");
    $("#universalEditFields").innerHTML = buildEditor(target, item);
    $("#universalEditHeading").textContent = "수정하기";
    if (target.kind === "timeBlock") $("#universalEditDuration").value = String(item.duration || 30);
    if (target.kind === "project") $("#universalEditStatus").value = item.status || "작업";
    dialog.showModal();
    setTimeout(() => $("#universalEditFields input")?.focus(), 0);
  } catch (error) {
    console.error(error);
    window.alert("항목을 불러오지 못했어요.");
  }
}

async function saveEditor() {
  const target = contextTarget;
  if (!target) return;
  try {
    await writeState((state) => {
      const item = getItem(state, target);
      if (!item) return;
      const title = $("#universalEditTitle")?.value.trim();
      if (title) {
        if (target.kind === "timeBlock") item.detail = title;
        else item.title = title;
      }

      if (target.kind === "task") {
        item.date = $("#universalEditDate").value || null;
      } else if (target.kind === "event") {
        const date = $("#universalEditDate").value;
        const startText = $("#universalEditStartTime").value;
        const endText = $("#universalEditEndTime").value;
        const start = new Date(`${date}T${startText}:00`);
        let end = new Date(`${date}T${endText}:00`);
        if (!(end > start)) end = new Date(start.getTime() + 30 * 60000);
        item.start = start.toISOString();
        item.end = end.toISOString();
      } else if (target.kind === "timeBlock") {
        item.date = $("#universalEditDate").value || relativeDayKey(0);
        item.startMinute = minuteFromText($("#universalEditStartTime").value);
        item.duration = Number($("#universalEditDuration").value || 30);
      } else if (target.kind === "project") {
        item.status = $("#universalEditStatus").value;
        item.category = $("#universalEditCategory").value.trim();
        item.progress = Math.max(0, Math.min(100, Number($("#universalEditProgress").value || 0)));
        item.deadline = $("#universalEditDeadline").value || null;
      } else if (target.kind === "session") {
        const start = new Date($("#universalEditSessionStart").value);
        const end = new Date($("#universalEditSessionEnd").value);
        if (!(end > start)) throw new Error("INVALID_SESSION_RANGE");
        item.start = start.toISOString();
        item.end = end.toISOString();
        item.durationMs = end - start;
      }
    });
    $("#universalEditDialog")?.close();
    contextTarget = null;
  } catch (error) {
    console.error(error);
    window.alert(error?.message === "INVALID_SESSION_RANGE" ? "종료 시간은 시작 시간보다 뒤여야 해요." : "수정하지 못했어요.");
  }
}

async function deleteTarget() {
  const target = contextTarget;
  closeMenu();
  if (!target) return;
  if (!window.confirm("이 항목을 삭제할까요?")) return;
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

function injectUI() {
  if ($("#universalContextMenu")) return;
  const style = document.createElement("style");
  style.textContent = `
    #universalContextMenu{position:fixed;z-index:500;display:none;min-width:158px;padding:5px;background:#fff;border:1px solid var(--line-strong,#b8c0cb);border-radius:9px;box-shadow:0 10px 30px rgba(15,23,42,.15)}
    #universalContextMenu.open{display:block}
    #universalContextMenu button{display:block;width:100%;min-height:36px;padding:7px 10px;border:0;border-radius:6px;background:#fff;color:var(--text,#1f2328);text-align:left;cursor:pointer}
    #universalContextMenu button:hover{background:var(--hover,#f3f5f7)}
    #universalContextMenu button.danger{color:var(--danger,#c84a4a)}
    #universalContextMenu .separator{height:1px;margin:4px 2px;background:var(--line,#d2d7df)}
    #universalContextMenu .hidden{display:none}
    #universalEditFields{display:grid;gap:2px}
    .row,.cal-event,.day-timed-event,.time-block,.project-row,.history-row,.template-row{user-select:none}
  `;
  document.head.appendChild(style);

  const menu = document.createElement("div");
  menu.id = "universalContextMenu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" data-context-schedule data-action="today">오늘 하기</button>
    <button type="button" data-context-schedule data-action="tomorrow">내일 하기</button>
    <div class="separator" data-context-schedule></div>
    <button type="button" data-action="edit">수정하기</button>
    <button type="button" class="danger" data-action="delete">삭제하기</button>`;
  document.body.appendChild(menu);

  const dialog = document.createElement("dialog");
  dialog.id = "universalEditDialog";
  dialog.className = "app-dialog";
  dialog.innerHTML = `<form method="dialog" id="universalEditForm"><h3 id="universalEditHeading">수정하기</h3><div id="universalEditFields"></div><div class="dialog-actions"><button class="soft-btn" type="button" id="universalEditCancel">취소</button><button class="primary-btn" type="submit">저장</button></div></form>`;
  document.body.appendChild(dialog);

  menu.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "today") scheduleTarget(0);
    else if (button.dataset.action === "tomorrow") scheduleTarget(1);
    else if (button.dataset.action === "edit") openEditor();
    else if (button.dataset.action === "delete") deleteTarget();
  });

  $("#universalEditCancel").addEventListener("click", () => {
    $("#universalEditDialog").close();
    contextTarget = null;
  });
  $("#universalEditForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveEditor();
  });
}

function installListeners() {
  if (document.documentElement.dataset.universalActionsWired) return;
  document.documentElement.dataset.universalActionsWired = "1";

  document.addEventListener("contextmenu", async (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || !isActionableSurface(element)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const current = await readState();
      if (!current) return;
      const target = resolveDirect(element) || resolveByPosition(element, current.state);
      if (!target) return;
      openMenu(event.clientX, event.clientY, target);
    } catch (error) {
      console.error(error);
    }
  }, true);

  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("#universalContextMenu")) closeMenu();
  }, true);
  window.addEventListener("blur", closeMenu);
  window.addEventListener("scroll", closeMenu, true);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
}

function init() {
  injectUI();
  installListeners();
}

init();
