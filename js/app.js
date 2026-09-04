import { onekanStateStore } from "./supabase.js?v=1";
import { threeWayMerge } from "./state-store.js?v=1";
import { setupAuth } from "./auth.js?v=3";
import { confirmAction, showToast, playCheckSound } from "./ui-feedback.js";
import { completeRepeatingTask, normalizeCompletionRepeats, undoRepeatingTaskCompletion } from "./repeat-after-completion.js?v=1";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const uid = () => crypto.randomUUID();
const pad = (n) => String(n).padStart(2, "0");
const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '\"': "&quot;" }[c]));
const DEFAULT_EVENT_GROUPS = [
  { id: "default", name: "기본", color: "#8fa9c4" },
];
const DEFAULT_WEATHER_LOCATION = { name: "양양", latitude: 38.0754, longitude: 128.6191 };

function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayDate(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return date;
}

function appDayKey(now = new Date()) {
  return localDateKey(appDayDate(now));
}

function recurringOnDate(item, targetKey) {
  if (!item?.date) return false;
  const recurrence = item.recurrence;
  if (recurrence?.completionBased) return item.date === targetKey;
  if (!recurrence?.frequency) return item.date === targetKey;
  if (targetKey < item.date || (recurrence.until && targetKey > recurrence.until)) return false;
  const first = new Date(`${item.date}T12:00:00`);
  const target = new Date(`${targetKey}T12:00:00`);
  const diff = Math.round((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / 86400000);
  const interval = Math.max(1, Number(recurrence.interval || 1));
  if (recurrence.frequency === "daily") return diff % interval === 0;
  if (recurrence.frequency === "weekly") {
    const weekdays = Array.isArray(recurrence.weekdays) && recurrence.weekdays.length ? recurrence.weekdays : [first.getDay()];
    return Math.floor(diff / 7) % interval === 0 && weekdays.includes(target.getDay());
  }
  if (recurrence.frequency === "monthly") {
    const months = (target.getFullYear() - first.getFullYear()) * 12 + target.getMonth() - first.getMonth();
    const wanted = Math.min(Number(recurrence.dayOfMonth || first.getDate()), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
    return months >= 0 && months % interval === 0 && target.getDate() === wanted;
  }
  return item.date === targetKey;
}

function taskCompletedOn(task, dateKey) {
  if (task.recurrence?.completionBased) return Boolean(task.done);
  return task.recurrence?.frequency ? Boolean(task.recurrenceDone?.[dateKey]) : Boolean(task.done);
}

function habitOccursOnDate(habit, targetKey) {
  if (window.__ONEKAN_DAILY_FOCUS_MODE__) return false;
  if (!habit || !targetKey) return false;
  if (habit.startDate && targetKey < habit.startDate) return false;
  if (habit.endDate && targetKey > habit.endDate) return false;
  if (!habit.recurrence?.frequency) return true;
  const baseDate = habit.startDate || habit.recurrence.anchorDate;
  if (!baseDate) return true;
  return recurringOnDate({ ...habit, date: baseDate }, targetKey);
}

function trackingSourceFromValue(value) {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 0) {
    const task = state.tasks.find((item) => item.id === value);
    return task ? { kind: "task", item: task } : null;
  }
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === "task") {
    const item = state.tasks.find((task) => task.id === id);
    return item ? { kind, item } : null;
  }
  if (kind === "habit") {
    const item = state.habitTemplates.find((habit) => habit.id === id);
    return item ? { kind, item } : null;
  }
  return null;
}

function fmtDate(date) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(date);
}

function fmtDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}시간 ${minutes}분`;
  if (hours) return `${hours}시간`;
  return `${minutes}분`;
}

function defaultState() {
  const normalized = {
    tasks: [],
    habitTemplates: [],
    habitDays: {},
    timeBlocks: [],
    events: [],
    eventGroups: DEFAULT_EVENT_GROUPS.map((group) => ({ ...group })),
    notes: [],
    dailyNotes: [],
    expenses: [],
    sessions: [],
    timer: { mode: "pomodoro", running: false, paused: false, taskId: null, habitId: null, title: null, startedAt: null, accumulatedMs: 0, durationMs: 25 * 60 * 1000 },
    projects: [],
    ui: {
      sidebarCollapsed: false,
      themeColor: "#8fa9c4",
      timelineRange: { start: 360, end: 1320 },
      timelineColors: { task: "#d8d8d5", habit: "#b9d9c3" },
      homeDashboard: { heroDday: null, secondaryDdays: [], weatherLocation: { ...DEFAULT_WEATHER_LOCATION } },
      showSessionsOnTimeline: true,
      calendarFilters: {
        month: { schedule: true, task: false },
        week: { schedule: true, task: true },
        three: { schedule: true, task: true },
        day: { schedule: true, task: true },
      },
    },
  };
  const defaultGroupId = normalized.eventGroups[0]?.id || "default";
  normalized.tasks = normalized.tasks.map((task) => ({ ...task, groupId: task.groupId || defaultGroupId }));
  normalized.events = normalized.events.map((event) => ({ ...event, groupId: event.groupId || defaultGroupId }));
  return normalized;
}

function normalizeState(raw) {
  const base = defaultState();
  const state = raw && typeof raw === "object" ? raw : {};
  const savedCalendarFilters = state.ui?.calendarFilters || {};
  const normalized = {
    ...base,
    ...state,
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    habitTemplates: Array.isArray(state.habitTemplates) ? state.habitTemplates : [],
    habitDays: state.habitDays && typeof state.habitDays === "object" ? state.habitDays : {},
    timeBlocks: Array.isArray(state.timeBlocks) ? state.timeBlocks : [],
    events: Array.isArray(state.events) ? state.events : [],
    eventGroups: Array.isArray(state.eventGroups) && state.eventGroups.length ? state.eventGroups : base.eventGroups,
    notes: Array.isArray(state.notes) ? state.notes : [],
    dailyNotes: Array.isArray(state.dailyNotes) ? state.dailyNotes : [],
    expenses: Array.isArray(state.expenses) ? state.expenses : [],
    sessions: Array.isArray(state.sessions) ? state.sessions : [],
    timer: { ...base.timer, ...(state.timer || {}) },
    projects: Array.isArray(state.projects) ? state.projects : [],
    ui: {
      ...base.ui,
      ...(state.ui || {}),
      themeColor: state.ui?.themeColor || base.ui.themeColor,
      timelineRange: { ...base.ui.timelineRange, ...(state.ui?.timelineRange || {}) },
      timelineColors: { ...base.ui.timelineColors, ...(state.ui?.timelineColors || {}) },
      homeDashboard: {
        ...base.ui.homeDashboard,
        ...(state.ui?.homeDashboard || {}),
        secondaryDdays: Array.isArray(state.ui?.homeDashboard?.secondaryDdays) ? state.ui.homeDashboard.secondaryDdays.slice(0, 3) : [],
        weatherLocation: normalizeWeatherLocation(state.ui?.homeDashboard?.weatherLocation),
      },
      showSessionsOnTimeline: state.ui?.showSessionsOnTimeline !== false,
      calendarFilters: {
        month: { ...base.ui.calendarFilters.month, ...(savedCalendarFilters.month || {}) },
        week: { ...base.ui.calendarFilters.week, ...(savedCalendarFilters.week || {}) },
        three: { ...base.ui.calendarFilters.three, ...(savedCalendarFilters.three || {}) },
        day: { ...base.ui.calendarFilters.day, ...(savedCalendarFilters.day || {}) },
      },
    },
  };

  const normalizedSessionGroupId = normalized.eventGroups[0]?.id || "default";
  normalized.sessions = normalized.sessions.map((session) => ({ ...session, groupId: session.groupId || normalizedSessionGroupId }));

  // 이전 시간블럭 템플릿을 새 타임라인 블록으로 한 번만 옮긴다.
  // 기본 상태를 만드는 동안에는 아직 state/SLOT가 준비되지 않았으므로,
  // 저장된 데이터를 정규화한 다음에만 이 변환을 실행한다.
  const templates = Array.isArray(state.timeBlockTemplates) ? state.timeBlockTemplates : [];
  for (const task of normalized.tasks) {
    if (!task.timeBlockTemplateId || !task.date) continue;
    const template = templates.find((item) => item.id === task.timeBlockTemplateId);
    if (!template) continue;
    const startMinute = Number(template.startMinute);
    if (!Number.isFinite(startMinute)) continue;
    const duration = Math.max(SLOT, Number(template.endMinute) - startMinute || SLOT);
    let block = normalized.timeBlocks.find((item) => item.taskId === task.id && item.date === task.date);
    if (!block) {
      block = { id: `legacy-${task.id}-${task.date}`, taskId: task.id, sourceTitle: task.title, detail: task.title, date: task.date };
      normalized.timeBlocks.push(block);
    }
    block.startMinute = startMinute;
    block.duration = duration;
    delete task.timeBlockTemplateId;
  }
  normalizeCompletionRepeats(normalized);
  delete normalized.homeMemo;
  delete normalized.homeMemoBoard;
  return normalized;
}

let currentUser = null;
let loadedUserId = null;
let state = defaultState();
let lastSavedState = defaultState();
let saveChain = Promise.resolve();
let tickHandle = null;
let timerFinishing = false;
let editingSessionId = null;
let calView = "month";
let calDayMode = "list";
let calCursor = new Date();
let calendarRangeSelection = null;
let suppressCalendarCellClickUntil = 0;

const START_MIN = 6 * 60;
const END_MIN = 22 * 60;
const SLOT = 30;

function setSyncStatus(text, isError = false) {
  for (const id of ["#syncStatus", "#mobileSyncStatus"]) {
    const el = $(id);
    if (!el) continue;
    el.textContent = text;
    el.style.color = isError ? "var(--danger)" : "";
  }
}

async function loadStateFromCloud(user) {
  setSyncStatus("불러오는 중...");
  try {
    const stored = await onekanStateStore.read({ userId: user.id });
    state = normalizeState(stored);
    lastSavedState = JSON.parse(JSON.stringify(state));
  } catch (error) {
    console.error(error);
    setSyncStatus("불러오기 실패", true);
    throw error;
  }

  ensureHabitDay();
  loadedUserId = user.id;
  setSyncStatus("저장됨");
}

function save() {
  if (!currentUser) return Promise.resolve();
  const userId = currentUser.id;
  const snapshot = JSON.parse(JSON.stringify(state));
  setSyncStatus("저장 중...");
  saveChain = saveChain.then(async () => {
    const baseState = JSON.parse(JSON.stringify(lastSavedState));
    await onekanStateStore.mutate((remote) => threeWayMerge(baseState, snapshot, remote), { userId, source: "app" });
    lastSavedState = snapshot;
    setSyncStatus("저장됨");
  }).catch((error) => {
    console.error(error);
    setSyncStatus("저장 실패", true);
  });
  return saveChain;
}

function ensureHabitDay() {
  if (window.__ONEKAN_DAILY_FOCUS_MODE__) return;
  const dayKey = appDayKey();
  state.habitDays ||= {};
  state.habitDays[dayKey] ||= {};
  for (const habit of state.habitTemplates) {
    if (!(habit.id in state.habitDays[dayKey])) state.habitDays[dayKey][habit.id] = false;
  }
}

function applySidebar() {
  $("#app-section").classList.toggle("sidebar-collapsed", !!state.ui.sidebarCollapsed);
}

function goPage(name) {
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === `page-${name}`));
  $$(".nav-item[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === name));
  $("#app-section").classList.remove("mobile-nav-open");
  if (name === "calendar" && !document.querySelector('script[src*="unified-workspace.js"]')) renderCalendar();
  if (name === "tracking") renderTracking();
  if (name === "projects" && !document.querySelector('script[src*="work-management.js"]')) renderProjects();
  if (name === "settings") renderSettings();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function sortIncompleteFirst(items, doneFn) {
  return [...items].sort((a, b) => Number(doneFn(a)) - Number(doneFn(b)));
}

function renderTasks() {
  const dayKey = appDayKey();
  const list = $("#taskList");
  if (!list) return;
  list.innerHTML = "";
  const todayTasks = sortIncompleteFirst(state.tasks.filter((task) => task.date === dayKey), (task) => task.done);
  if (!todayTasks.length) list.innerHTML = '<div class="empty">오늘 할일이 없어요.</div>';

  for (const task of todayTasks) {
    const row = document.createElement("div");
    row.className = `row${task.done ? " done" : ""}`;
    row.draggable = !task.done;
    row.dataset.id = task.id;
    row.dataset.contextKind = "task";
    row.dataset.contextId = task.id;
    row.innerHTML = `<button class="check ${task.done ? "checked" : ""}" type="button" aria-label="완료">${task.done ? "✓" : ""}</button><span class="row-title">${esc(task.title)}</span>`;

    row.querySelector(".check").addEventListener("click", () => {
      if (task.recurrence?.frequency) completeRepeatingTask(state, task, new Date());
      else if (task.done && task.repeatRule) undoRepeatingTaskCompletion(state, task);
      else { task.done = !task.done; task.completedAt = task.done ? new Date().toISOString() : null; }
      save();
      renderHome();
      renderTracking();
      renderCalendar();
    });

    const title = row.querySelector(".row-title");
    title.addEventListener("click", () => {
      const input = document.createElement("input");
      input.className = "row-title-input";
      input.value = task.title;
      title.replaceWith(input);
      input.focus();
      input.select();
      const oldTitle = task.title;
      const commit = () => {
        const value = input.value.trim();
        if (value) {
          task.title = value;
          for (const block of state.timeBlocks.filter((item) => item.taskId === task.id && item.sourceTitle === oldTitle)) block.sourceTitle = value;
        }
        save();
        renderHome();
        renderTracking();
        renderCalendar();
      };
      input.addEventListener("blur", commit, { once: true });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") input.blur();
        if (event.key === "Escape") { input.value = task.title; input.blur(); }
      });
    });

    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/task-id", task.id);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    list.appendChild(row);
  }
}

function addTask() {
  const input = $("#newTaskInput");
  if (!input) return;
  const title = input.value.trim();
  if (!title) return;
  state.tasks.push({ id: uid(), title, done: false, date: appDayKey(), groupId: state.eventGroups[0]?.id || "default" });
  input.value = "";
  save();
  renderHome();
  renderTracking();
  renderCalendar();
}

function minuteLabel(minute) {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

function clampStart(minute, duration = 30) {
  return Math.max(START_MIN, Math.min(minute, END_MIN - duration));
}

function renderHabits() {
  ensureHabitDay();
  const dayKey = appDayKey();
  const checks = state.habitDays[dayKey];
  const list = $("#habitList");
  if (!list) return;
  list.innerHTML = "";
  const sorted = sortIncompleteFirst(state.habitTemplates, (habit) => !!checks[habit.id]);
  if (!sorted.length) list.innerHTML = '<div class="empty">설정에서 습관을 추가해 주세요.</div>';
  for (const habit of sorted) {
    const done = !!checks[habit.id];
    const row = document.createElement("div");
    row.className = `row${done ? " done" : ""}`;
    row.dataset.contextKind = "habit";
    row.dataset.contextId = habit.id;
    row.innerHTML = `<button class="check ${done ? "checked" : ""}" type="button" aria-label="습관 완료">${done ? "✓" : ""}</button><span class="row-title" style="cursor:default">${esc(habit.title)}</span>`;
    row.querySelector(".check").addEventListener("click", () => {
      checks[habit.id] = !checks[habit.id];
      save();
      renderHabits();
      renderDashboard();
    });
    list.appendChild(row);
  }
}

function renderUpcoming() {
  const now = new Date();
  const dayKey = appDayKey();
  const events = state.events
    .filter((event) => new Date(event.start) >= now)
    .map((event) => ({ ...event, upcomingKind: "event", when: new Date(event.start) }));
  const tasks = state.tasks
    .filter((task) => !task.done && task.date && task.date > dayKey)
    .map((task) => ({ ...task, upcomingKind: "task", when: new Date(`${task.date}T12:00:00`) }));
  const items = [...events, ...tasks].sort((a, b) => a.when - b.when).slice(0, 8);
  const container = $("#upcomingList");
  const groups = new Map();
  const firstUpcomingDate = new Date(`${dayKey}T12:00:00`);
  for (let offset = 1; offset <= 7; offset += 1) {
    const date = new Date(firstUpcomingDate);
    date.setDate(date.getDate() + offset);
    groups.set(localDateKey(date), []);
  }
  for (const item of items) {
    const key = localDateKey(item.when);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  container.innerHTML = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, groupItems]) => {
    const date = new Date(`${key}T12:00:00`);
    const label = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(date);
    const rows = groupItems.map((item) => {
      const isTask = item.upcomingKind === "task";
      const time = isTask || item.allDay ? "" : new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(item.when);
      const control = isTask
        ? `<button class="calendar-check" type="button" data-calendar-check="task" data-calendar-id="${item.id}" aria-label="할일 완료"></button>`
        : `<span class="calendar-event-dot" aria-hidden="true" style="--event-color:${safeColor(eventGroupFor(item).color)}"></span>`;
      return `<div class="row editable-row upcoming-row ${isTask ? "task" : "schedule"}" draggable="${isTask}" data-context-kind="${item.upcomingKind}" data-context-id="${item.id}" data-upcoming-task-id="${isTask ? item.id : ""}">${control}<span class="row-title" style="cursor:default">${esc(item.title)}</span>${time ? `<span class="card-meta">${time}</span>` : ""}</div>`;
    }).join("");
    return `<section class="upcoming-date-group${groupItems.length ? "" : " empty-date"}" data-upcoming-date="${key}"><div class="upcoming-date-heading"><strong>${label}</strong></div>${rows || '<div class="upcoming-date-empty">비어 있음</div>'}</section>`;
  }).join("");
  bindCalendarChecks(container);
}

function todayFocusMs() {
  const dayKey = appDayKey();
  return state.sessions.filter((session) => session.end && appDayKey(new Date(session.end)) === dayKey).reduce((sum, session) => sum + Number(session.durationMs || 0), 0);
}

function normalizedStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["done", "complete", "completed", "achieved", "완료", "달성", "완주함"].includes(status)) return "done";
  if (["archived", "archive", "closed", "보관", "쉬는 중", "쉬는중"].includes(status)) return "archived";
  return status;
}

function ddayDate(item) {
  const value = item?.endDate || item?.deadline || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function ddayCandidates() {
  const projects = (Array.isArray(state.projects) ? state.projects : [])
    .filter((item) => (item?.kind === "project" || !item?.kind) && ddayDate(item) && !["done", "archived"].includes(normalizedStatus(item.status)))
    .map((item) => ({ kind: "project", id: item.id, title: item.title || "이름 없는 프로젝트", date: ddayDate(item) }));
  const goals = (Array.isArray(state.directionGoals) ? state.directionGoals : [])
    .filter((item) => ddayDate(item) && !["done", "archived"].includes(normalizedStatus(item.status)))
    .map((item) => ({ kind: "goal", id: item.id, title: item.title || "이름 없는 목표", date: ddayDate(item) }));
  return [...projects, ...goals].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "ko"));
}

function ddayDistance(dateKey) {
  const today = appDayDate();
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
}

function ddayText(dateKey) {
  const distance = ddayDistance(dateKey);
  if (distance === 0) return "D-DAY";
  return distance > 0 ? `D-${distance}` : `D+${Math.abs(distance)}`;
}

function renderHomeDdays() {
  const candidates = ddayCandidates();
  const savedHero = state.ui?.homeDashboard?.heroDday;
  const hero = savedHero && candidates.find((item) => item.kind === savedHero.kind && item.id === savedHero.id) || null;
  const savedSecondary = Array.isArray(state.ui?.homeDashboard?.secondaryDdays) ? state.ui.homeDashboard.secondaryDdays : [];
  const secondary = savedSecondary.map((saved) => candidates.find((item) => item.kind === saved?.kind && item.id === saved?.id))
    .filter((item) => item && item !== hero).slice(0, 3);
  const count = $("#homeDdayCount");
  const title = $("#homeDdayTitle");
  const list = $("#homeDdayList");
  if (!count || !title || !list) return;
  if (!hero) {
    count.textContent = "—";
    title.textContent = candidates.length ? "대표 D-day를 선택하세요" : "등록된 기한이 없어요";
    list.innerHTML = candidates.length
      ? '<span class="home-dday-empty">우클릭해서 대표 1개·보조 3개를 선택할 수 있어요.</span>'
      : '<span class="home-dday-empty">프로젝트나 목표에 마감일을 추가해 보세요.</span>';
    return;
  }
  count.textContent = ddayText(hero.date);
  title.textContent = hero.title;
  list.innerHTML = secondary.map((item) => `<span class="home-dday-chip" title="${esc(item.title)} · ${item.date}">${esc(item.title)} <strong>${ddayText(item.date)}</strong></span>`).join("");
}

function renderDashboard() {
  const dayKey = appDayKey();
  const tasks = state.tasks.filter((task) => recurringOnDate(task, dayKey));
  const completedTasks = tasks.filter((task) => taskCompletedOn(task, dayKey)).length;
  const taskProgress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;
  ensureHabitDay();
  const checks = state.habitDays[dayKey];
  const completedHabits = state.habitTemplates.filter((habit) => checks[habit.id]).length;
  if ($("#dashTasks")) $("#dashTasks").textContent = `${completedTasks} / ${tasks.length}`;
  if ($("#dashHabits")) $("#dashHabits").textContent = `${completedHabits} / ${state.habitTemplates.length}`;
  if ($("#dashFocus")) $("#dashFocus").textContent = fmtDuration(todayFocusMs());
  if ($("#homeProgressLabel")) $("#homeProgressLabel").textContent = `${taskProgress}%`;
  if ($("#homeCompletionLabel")) $("#homeCompletionLabel").textContent = `오늘 ${completedTasks} / ${tasks.length} 완료`;
  if ($("#homeProgress")) {
    $("#homeProgress").style.setProperty("--progress-offset", String(182.21 * (1 - taskProgress / 100)));
    $("#homeProgress").setAttribute("aria-label", `오늘 할일 ${completedTasks}/${tasks.length} 완료`);
  }
  renderHomeDdays();
}

function renderHome() {
  $("#todayLabel").textContent = fmtDate(appDayDate());
  if (document.querySelector('script[src*="unified-workspace.js"]')) {
    renderDashboard();
    return;
  }
  renderTasks();
  renderHabits();
  renderUpcoming();
  renderDashboard();
}

function timeText(date) {
  return date ? new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "";
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#8fa9c4";
}

function normalizeWeatherLocation(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { ...DEFAULT_WEATHER_LOCATION };
  }
  return { name: String(value?.name || "설정 지역").slice(0, 60), latitude, longitude };
}

function eventGroupFor(item) {
  return state.eventGroups.find((group) => group.id === item.groupId)
    || state.eventGroups.find((group) => group.name === item.category)
    || state.eventGroups[0]
    || DEFAULT_EVENT_GROUPS[0];
}

function eventGroupOptions(selectedId = "") {
  return state.eventGroups.map((group) => `<option value="${esc(group.id)}"${group.id === selectedId ? " selected" : ""}>${esc(group.name)}</option>`).join("");
}

function refreshEventGroupInputs() {
  for (const selector of ["#timelineEventGroup", "#manualSessionGroup"]) {
    const select = $(selector);
    if (!select) continue;
    const previous = select.value;
    select.innerHTML = eventGroupOptions(previous);
    if (state.eventGroups.some((group) => group.id === previous)) select.value = previous;
  }
}

function orderedDateRange(a, b = a) {
  return a <= b ? [a, b] : [b, a];
}

function closeCalendarCellComposer() {
  $(".calendar-cell-composer")?.remove();
  $$(".has-calendar-composer").forEach((element) => element.classList.remove("has-calendar-composer"));
}

function calendarCellDate(element) {
  return element?.dataset.calendarDate || element?.dataset.featureCalendarDate || element?.dataset.date || null;
}

function openCalendarCellComposer(host, firstDate, lastDate = firstDate) {
  if (!host || !firstDate) return;
  const [startDate, endDate] = orderedDateRange(firstDate, lastDate);
  const isRange = startDate !== endDate;
  closeCalendarCellComposer();
  host.classList.add("has-calendar-composer");
  const form = document.createElement("form");
  form.className = "calendar-cell-composer";
  form.innerHTML = `<input data-cell-entry-title aria-label="일정 제목" placeholder="${isRange ? "기간 일정 입력" : "일정 입력"}" autocomplete="off" required />`;
  host.appendChild(form);
  form.addEventListener("mousedown", (event) => event.stopPropagation());
  form.addEventListener("pointerdown", (event) => event.stopPropagation());
  form.addEventListener("click", (event) => event.stopPropagation());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = form.querySelector("[data-cell-entry-title]").value.trim();
    if (!title) return;
    const defaultGroupId = state.eventGroups[0]?.id || "default";
    state.events.push({ id: uid(), title, type: "schedule", allDay: true, groupId: defaultGroupId, start: new Date(`${startDate}T12:00:00`).toISOString(), end: new Date(`${endDate}T12:00:00`).toISOString() });
    save();
    closeCalendarCellComposer();
    renderHome();
    renderCalendar();
  });
  const input = form.querySelector("[data-cell-entry-title]");
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCalendarCellComposer();
  });
  input.addEventListener("blur", () => setTimeout(() => {
    if (form.isConnected && !input.value.trim()) closeCalendarCellComposer();
  }, 0));
  requestAnimationFrame(() => input.focus());
}

function calendarFiltersForView(view = calView) {
  return { schedule: true, task: false };
}

function updateCalendarFilterUI() {
  const filters = calendarFiltersForView();
  $$("#calendarTypeFilter [data-calendar-type]").forEach((button) => {
    const active = !!filters[button.dataset.calendarType];
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function calendarEntryMarkup(item) {
  const kind = item.kind === "event" ? "event" : "task";
  const group = item.type === "schedule" ? eventGroupFor(item) : null;
  const control = item.type === "schedule"
    ? `<span class="calendar-event-dot" aria-hidden="true" style="--event-color:${safeColor(group.color)}"></span>`
    : `<button class="calendar-check${item.done ? " checked" : ""}" type="button" data-calendar-check="task" data-calendar-id="${item.id}" aria-label="할일 완료">${item.done ? "✓" : ""}</button>`;
  const style = group ? ` style="--event-color:${safeColor(group.color)}"` : "";
  return `<div class="cal-event ${item.type === "schedule" ? "schedule" : "task"}${item.type === "task" && item.done ? " done" : ""}"${style} data-calendar-kind="${kind}" data-calendar-id="${item.id}" data-context-kind="${kind}" data-context-id="${item.id}">
    ${control}
    <span class="cal-event-title">${esc(item.title)}</span>
  </div>`;
}

function calendarListEntryMarkup(item) {
  const kind = item.kind === "event" ? "event" : "task";
  const group = item.type === "schedule" ? eventGroupFor(item) : null;
  const control = item.type === "schedule"
    ? `<span class="calendar-event-dot" aria-hidden="true" style="--event-color:${safeColor(group.color)}"></span>`
    : `<button class="calendar-check${item.done ? " checked" : ""}" type="button" data-calendar-check="task" data-calendar-id="${item.id}" aria-label="할일 완료">${item.done ? "✓" : ""}</button>`;
  return `<div class="row editable-row${item.type === "task" && item.done ? " done" : ""}" data-calendar-kind="${kind}" data-calendar-id="${item.id}" data-context-kind="${kind}" data-context-id="${item.id}">
    ${control}
    ${item.type === "schedule" ? `<span class="pill">${esc(group.name)}</span>` : ""}
    <span class="row-title" style="cursor:default">${esc(item.title)}</span>
    ${item.startDate ? `<span class="card-meta">${timeText(item.startDate)}</span>` : ""}
  </div>`;
}

function bindCalendarChecks(root = $("#calendarBody")) {
  $$("[data-calendar-check]", root).forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  const item = state.tasks.find((entry) => entry.id === button.dataset.calendarId);
    if (!item) return;
    item.done = !item.done;
    item.completedAt = item.done ? new Date().toISOString() : null;
    save();
    renderCalendar();
    renderHome();
    renderTracking();
  }));
}

function eventsForDate(date) {
  const key = localDateKey(date);
  const filters = calendarFiltersForView();
  const events = state.events
    .filter((event) => {
      const startKey = localDateKey(new Date(event.start));
      const endKey = event.allDay && event.end ? localDateKey(new Date(event.end)) : startKey;
      const [first, last] = orderedDateRange(startKey, endKey);
      return key >= first && key <= last;
    })
    .map((event) => ({ ...event, kind: "event", type: "schedule", startDate: event.allDay ? null : new Date(event.start), endDate: event.allDay || !event.end ? null : new Date(event.end) }));
  const tasks = state.tasks
    .filter((task) => task.date === key)
    .map((task) => ({
      id: task.id,
      title: task.title,
      type: "task",
      kind: "task",
      startDate: task.notionStart && task.notionEnd ? new Date(task.notionStart) : null,
      endDate: task.notionStart && task.notionEnd ? new Date(task.notionEnd) : null,
      done: task.done,
    }));
  const rank = (item) => item.type === "schedule" ? 0 : 1;
  return [...events, ...tasks]
    .filter((item) => item.type === "schedule" ? filters.schedule : filters.task)
    .sort((a, b) => rank(a) - rank(b) || ((a.startDate?.getTime() || Infinity) - (b.startDate?.getTime() || Infinity)) || a.title.localeCompare(b.title, "ko"));
}

function calendarTimelineDuration(item) {
  if (!item.startDate || !item.endDate) return SLOT;
  return Math.max(SLOT, Math.round((item.endDate - item.startDate) / 60000 / SLOT) * SLOT);
}

function updateDayModeVisibility() {
  calDayMode = "list";
  $("#dayModeSeg")?.classList.remove("show");
  updateCalendarFilterUI();
}

function renderDayTimeline(date) {
  const items = eventsForDate(date);
  const untimed = items.filter((item) => !item.startDate);
  const timed = items.filter((item) => item.startDate);
  let html = "";
  if (untimed.length) html += `<div class="untimed-box"><div class="untimed-title">시간 미정</div>${untimed.map(calendarEntryMarkup).join("")}</div>`;
  html += `<div class="day-timeline" id="dayTimeline" data-calendar-date="${localDateKey(date)}" data-feature-calendar-date="${localDateKey(date)}">`;
  for (let minute = START_MIN; minute < END_MIN; minute += SLOT) html += `<div class="day-time-row" data-minute="${minute}"><div class="day-time-label">${minuteLabel(minute)}</div><div class="day-time-lane"></div></div>`;
  html += "</div>";
  $("#calendarBody").innerHTML = html;
  const timeline = $("#dayTimeline");
  for (const item of timed) {
    const minute = item.startDate.getHours() * 60 + item.startDate.getMinutes();
    if (minute < START_MIN || minute >= END_MIN) continue;
    const slotMinute = Math.floor(minute / SLOT) * SLOT;
    const index = (slotMinute - START_MIN) / SLOT;
    const row = timeline.children[index];
    if (!row) continue;
    const element = document.createElement("div");
    const kind = item.kind === "event" ? "event" : "task";
    element.className = `day-timed-event planned-entry${item.type === "schedule" ? " schedule" : " task"}${item.type === "task" && item.done ? " done" : ""}`;
    element.dataset.calendarKind = kind;
    element.dataset.calendarId = item.id;
    element.dataset.contextKind = kind;
    element.dataset.contextId = item.id;
    const duration = Math.min(calendarTimelineDuration(item), END_MIN - minute);
    element.dataset.timelineStart = String(minute);
    element.dataset.timelineEnd = String(Math.min(END_MIN, minute + duration));
    element.style.height = `${Math.max(34, (duration / SLOT) * 42 - 6)}px`;
    const group = item.type === "schedule" ? eventGroupFor(item) : null;
    if (group) element.style.setProperty("--event-color", safeColor(group.color));
    const control = item.type === "schedule"
      ? `<span class="calendar-event-dot" aria-hidden="true" style="--event-color:${safeColor(group.color)}"></span>`
      : `<button class="calendar-check${item.done ? " checked" : ""}" type="button" data-calendar-check="task" data-calendar-id="${item.id}" aria-label="할일 완료">${item.done ? "✓" : ""}</button>`;
    element.innerHTML = `<button class="calendar-resize-handle top" data-calendar-resize="top" type="button" aria-label="시작 시간 조절"></button><div class="day-timed-main">${control}<strong>${esc(item.title)}</strong></div><small>${item.type === "schedule" ? `${esc(group.name)} · ` : ""}${timeText(item.startDate)}</small><button class="calendar-resize-handle bottom" data-calendar-resize="bottom" type="button" aria-label="종료 시간 조절"></button>`;
    row.querySelector(".day-time-lane").appendChild(element);
  }
  for (const session of sessionsForDate(date)) {
    const start = new Date(session.start);
    const minute = start.getHours() * 60 + start.getMinutes();
    if (minute < START_MIN || minute >= END_MIN) continue;
    const slotMinute = Math.floor(minute / SLOT) * SLOT;
    const row = timeline.children[(slotMinute - START_MIN) / SLOT];
    if (!row) continue;
    const element = document.createElement("div");
    element.className = "day-timed-event actual-session";
    element.style.height = `${Math.max(34, (Number(session.durationMs || 0) / 60000 / SLOT) * 42)}px`;
    element.dataset.contextKind = "session";
    element.dataset.contextId = session.id;
    element.innerHTML = `<strong>${esc(session.title || "시간 기록")}</strong><small>실제 · ${timeText(start)}</small>`;
    row.querySelector(".day-time-lane").appendChild(element);
  }
  bindCalendarChecks();
}

function sessionsForDate(date) {
  const key = localDateKey(date);
  return state.sessions
    .filter((session) => session.start && session.end && localDateKey(new Date(session.start)) === key)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function renderMultiDayList(startDate, count) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + count - 1);
  $("#calTitle").textContent = `${start.getMonth() + 1}.${start.getDate()} – ${end.getMonth() + 1}.${end.getDate()}`;
  let html = '<div class="multi-day-list">';
  for (let index = 0; index < count; index++) {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const items = eventsForDate(date);
    html += `<section class="multi-day-list-section" data-calendar-date="${localDateKey(date)}" data-feature-calendar-date="${localDateKey(date)}"><h3>${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}</h3>${items.length ? items.map(calendarListEntryMarkup).join("") : '<div class="empty">항목이 없어요.</div>'}</section>`;
  }
  $("#calendarBody").innerHTML = `${html}</div>`;
  bindCalendarChecks();
}

function renderMultiDayTimeline(startDate, count) {
  const start = new Date(startDate);
  if (count === 7) start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + count - 1);
  $("#calTitle").textContent = `${start.getMonth() + 1}.${start.getDate()} – ${end.getMonth() + 1}.${end.getDate()}`;
  let html = `<div class="multi-timeline" style="--day-count:${count}"><div class="multi-time-head"></div>`;
  for (let index = 0; index < count; index++) {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const untimed = eventsForDate(date).filter((item) => !item.startDate);
    html += `<div class="multi-day-head"><strong>${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}</strong><small>계획 · 실제</small>${untimed.length ? `<div class="multi-day-all-day">${untimed.map(calendarEntryMarkup).join("")}</div>` : ""}</div>`;
  }
  html += '<div class="multi-time-axis">';
  for (let minute = START_MIN; minute < END_MIN; minute += SLOT) html += `<div>${minute % 60 === 0 ? minuteLabel(minute) : ""}</div>`;
  html += '</div>';
  for (let index = 0; index < count; index++) {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    html += `<div class="multi-day-lane" data-date="${localDateKey(date)}" data-calendar-date="${localDateKey(date)}" data-feature-calendar-date="${localDateKey(date)}"><div class="multi-plan-lane"></div><div class="multi-actual-lane"></div></div>`;
  }
  $("#calendarBody").innerHTML = `${html}</div>`;
  $$(".multi-day-lane", $("#calendarBody")).forEach((lane, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const planned = eventsForDate(date).filter((item) => item.startDate);
    for (const item of planned) {
      const minute = item.startDate.getHours() * 60 + item.startDate.getMinutes();
      if (minute < START_MIN || minute >= END_MIN) continue;
      const element = document.createElement("div");
      element.className = `multi-entry planned ${item.type}${item.type === "task" && item.done ? " done" : ""}`;
      element.style.top = `${((minute - START_MIN) / SLOT) * 42 + 2}px`;
      element.dataset.calendarKind = item.kind;
      element.dataset.calendarId = item.id;
      element.dataset.contextKind = item.kind;
      element.dataset.contextId = item.id;
      const duration = Math.min(calendarTimelineDuration(item), END_MIN - minute);
      element.dataset.timelineStart = String(minute);
      element.dataset.timelineEnd = String(Math.min(END_MIN, minute + duration));
      element.style.height = `${Math.max(29, (duration / SLOT) * 42 - 4)}px`;
      if (item.type === "task") {
        element.innerHTML = `<button class="calendar-resize-handle top" data-calendar-resize="top" type="button" aria-label="시작 시간 조절"></button><button class="calendar-check task-type-check${item.done ? " checked" : ""}" type="button" data-calendar-check="task" data-calendar-id="${item.id}" aria-label="할일 완료">${item.done ? "✓" : ""}</button><strong>${esc(item.title)}</strong><button class="calendar-resize-handle bottom" data-calendar-resize="bottom" type="button" aria-label="종료 시간 조절"></button>`;
      } else {
        const group = eventGroupFor(item);
        element.style.setProperty("--event-color", safeColor(group.color));
        element.innerHTML = `<button class="calendar-resize-handle top" data-calendar-resize="top" type="button" aria-label="시작 시간 조절"></button><span class="calendar-event-dot" aria-hidden="true" style="--event-color:${safeColor(group.color)}"></span><strong>${esc(item.title)}</strong><button class="calendar-resize-handle bottom" data-calendar-resize="bottom" type="button" aria-label="종료 시간 조절"></button>`;
      }
      lane.querySelector(".multi-plan-lane").appendChild(element);
    }
    for (const session of sessionsForDate(date)) {
      const startTime = new Date(session.start);
      const minute = startTime.getHours() * 60 + startTime.getMinutes();
      if (minute < START_MIN || minute >= END_MIN) continue;
      const element = document.createElement("div");
      element.className = "multi-entry actual";
      element.style.top = `${((minute - START_MIN) / SLOT) * 42 + 2}px`;
      element.style.height = `${Math.max(30, (Number(session.durationMs || 0) / 60000 / SLOT) * 42)}px`;
      element.dataset.contextKind = "session";
      element.dataset.contextId = session.id;
      element.textContent = session.title || "시간 기록";
      lane.querySelector(".multi-actual-lane").appendChild(element);
    }
  });
  bindCalendarChecks();
}

function renderCalendar() {
  if (document.querySelector('script[src*="unified-workspace.js"]')) return;
  const body = $("#calendarBody");
  const now = new Date();
  const timelineColors = state.ui?.timelineColors || defaultState().ui.timelineColors;
  document.documentElement.style.setProperty("--timeline-task-color", safeColor(timelineColors.task));
  document.documentElement.style.setProperty("--timeline-habit-color", safeColor(timelineColors.habit));
  updateDayModeVisibility();

  if (calView === "month") {
    const year = calCursor.getFullYear();
    const month = calCursor.getMonth();
    $("#calTitle").textContent = `${year}년 ${month + 1}월`;
    const first = new Date(year, month, 1);
    const startDay = first.getDay();
    const days = new Date(year, month + 1, 0).getDate();
    let html = '<div class="calendar-grid">' + ["일", "월", "화", "수", "목", "금", "토"].map((item) => `<div class="dow">${item}</div>`).join("");
    for (let index = 0; index < startDay; index++) html += '<div class="day-cell"></div>';
    for (let day = 1; day <= days; day++) {
      const date = new Date(year, month, day);
      const isToday = date.toDateString() === now.toDateString();
      const items = eventsForDate(date);
      html += `<div class="day-cell ${isToday ? "today" : ""}" data-calendar-date="${localDateKey(date)}"><div class="day-num">${day}</div>${items.slice(0, 5).map(calendarEntryMarkup).join("")}</div>`;
    }
    html += "</div>";
    body.innerHTML = html;
    bindCalendarChecks(body);
    return;
  }

  if (calView === "week" && calDayMode === "list") {
    const start = new Date(calCursor);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    $("#calTitle").textContent = `${start.getMonth() + 1}.${start.getDate()} – ${end.getMonth() + 1}.${end.getDate()}`;
    let html = '<div class="week-grid">';
    for (let index = 0; index < 7; index++) {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      html += `<div class="week-col" data-calendar-date="${localDateKey(date)}"><div class="week-date">${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}</div>${eventsForDate(date).map(calendarEntryMarkup).join("")}</div>`;
    }
    html += "</div>";
    body.innerHTML = html;
    bindCalendarChecks(body);
    return;
  }

  if (calView === "week" && calDayMode === "timeline") {
    renderMultiDayTimeline(calCursor, 7);
    return;
  }

  if (calView === "three") {
    if (calDayMode === "timeline") renderMultiDayTimeline(calCursor, 3);
    else renderMultiDayList(calCursor, 3);
    return;
  }

  $("#calTitle").textContent = fmtDate(calCursor);
  const items = eventsForDate(calCursor);
  if (calDayMode === "timeline") renderDayTimeline(calCursor);
  else {
    body.innerHTML = `<div class="day-list" data-calendar-date="${localDateKey(calCursor)}">${items.length ? items.map(calendarListEntryMarkup).join("") : '<div class="empty">선택한 항목이 없어요.</div>'}</div>`;
    bindCalendarChecks(body);
  }
}

function currentTimerElapsed() {
  const timer = state.timer;
  if (!timer?.running) return 0;
  return Number(timer.accumulatedMs || 0) + (timer.paused ? 0 : Math.max(0, Date.now() - Number(timer.startedAt || Date.now())));
}

function timerDurationMs() {
  return Math.max(60 * 1000, Number(state.timer?.durationMs || 25 * 60 * 1000));
}

function timerMode() {
  return state.timer?.mode === "stopwatch" ? "stopwatch" : "pomodoro";
}

function timerClockText(milliseconds, roundUp = true) {
  const seconds = Math.max(0, roundUp ? Math.ceil(milliseconds / 1000) : Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

function setTimerMode(mode) {
  if (state.timer.running) return;
  state.timer.mode = mode === "stopwatch" ? "stopwatch" : "pomodoro";
  state.timer.accumulatedMs = 0;
  state.timer.startedAt = null;
  save();
  updateTimerUI();
}

function adjustTimerMinutes(delta) {
  if (state.timer.running) return;
  const minutes = Math.max(1, Math.min(180, Math.round(timerDurationMs() / 60000) + delta));
  state.timer.durationMs = minutes * 60 * 1000;
  save();
  updateTimerUI();
}

function finishTimer(automatic = false) {
  if (timerFinishing || !state.timer.running) return;
  timerFinishing = true;
  const timer = state.timer;
  const mode = timerMode();
  const duration = mode === "pomodoro" ? Math.min(currentTimerElapsed(), timerDurationMs()) : currentTimerElapsed();
  const task = state.tasks.find((item) => item.id === timer.taskId);
  const habit = state.habitTemplates.find((item) => item.id === timer.habitId);
  const source = task || habit;
  if (duration >= 1000) {
    const groupId = source?.groupId || state.eventGroups[0]?.id || "default";
    state.sessions.push({ id: uid(), taskId: timer.taskId || null, habitId: timer.habitId || null, groupId, title: source?.title || timer.title || "집중 기록", start: new Date(Date.now() - duration).toISOString(), end: new Date().toISOString(), durationMs: duration, timerMode: mode });
  }
  const durationMs = timerDurationMs();
  state.timer = { mode, running: false, paused: false, taskId: null, habitId: null, title: null, startedAt: null, accumulatedMs: 0, durationMs };
  save();
  renderTracking();
  renderDashboard();
  if (automatic) showToast("집중 시간이 끝났어요. 기록에 저장했어요!", { tone: "success" });
  timerFinishing = false;
}

function updateTimerUI() {
  const timer = state.timer;
  const mode = timerMode();
  const duration = timerDurationMs();
  const elapsed = currentTimerElapsed();
  const remaining = timer.running ? Math.max(0, duration - elapsed) : duration;
  $("#timerClock").textContent = mode === "stopwatch" ? timerClockText(elapsed, false) : timerClockText(remaining);
  $("#timerCircle")?.style.setProperty("--timer-progress", mode === "stopwatch" ? "0%" : `${Math.max(0, Math.min(100, (elapsed / duration) * 100))}%`);
  $("#timerCircle")?.classList.toggle("stopwatch-mode", mode === "stopwatch");
  $(".timer-minute-controls")?.classList.toggle("hidden", mode === "stopwatch");
  $("#timerStatus").textContent = timer.running ? (timer.paused ? "잠시 쉬는 중" : mode === "stopwatch" ? "시간을 재는 중" : "집중하는 중") : mode === "stopwatch" ? "스톱워치 준비" : "집중 준비";
  $("#timerStart").disabled = timer.running;
  $("#timerStart").textContent = timer.running ? (mode === "stopwatch" ? "측정 중" : "집중 중") : (mode === "stopwatch" ? "측정 시작" : "집중 시작");
  $("#timerPause").disabled = !timer.running;
  $("#timerPause").textContent = timer.paused ? "계속" : "일시정지";
  $("#timerStop").disabled = !timer.running;
  $("#timerMinusMinute").disabled = timer.running;
  $("#timerPlusMinute").disabled = timer.running;
  $("#timerTaskSelect").disabled = timer.running;
  if ($("#timerCustomTitle")) $("#timerCustomTitle").disabled = timer.running;
  $("#timerTaskSelect").disabled = timer.running;
  $$('[data-timer-mode]').forEach((button) => {
    const active = button.dataset.timerMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = timer.running;
  });
  $("#trackingTodayTotal").textContent = `오늘 ${fmtDuration(todayFocusMs())}`;
  if ($("#dashFocus")) $("#dashFocus").textContent = fmtDuration(todayFocusMs());
  if (mode === "pomodoro" && timer.running && !timer.paused && remaining <= 0) finishTimer(true);
}

function startTicker() {
  clearInterval(tickHandle);
  tickHandle = setInterval(updateTimerUI, 1000);
}

function sessionPeriod(session) {
  const start = new Date(session.start || session.end);
  const end = new Date(session.end || session.start);
  const date = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(start);
  const time = (value) => `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  return `${date} · ${time(start)}–${time(end)}`;
}

function renderSessions() {
  const dayKey = appDayKey();
  const today = state.sessions.filter((session) => session.end && appDayKey(new Date(session.end)) === dayKey).sort((a, b) => new Date(b.end) - new Date(a.end));
  const past = state.sessions.filter((session) => session.end && appDayKey(new Date(session.end)) < dayKey).sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 50);
  const rowMarkup = (session) => { const group = eventGroupFor(session); return `<div class="history-row editable-row" data-context-kind="session" data-context-id="${session.id}"><div><div class="history-name">${esc(session.title)}</div><div class="history-meta"><span aria-hidden="true" style="display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:50%;background:${safeColor(group.color)}"></span>${esc(group.name)} · ${sessionPeriod(session)}</div></div><div class="history-time">${fmtDuration(session.durationMs)}</div></div>`; };
  const make = (items) => items.length ? items.map(rowMarkup).join("") : '<div class="empty">아직 기록이 없어요.</div>';
  const makePast = (items) => {
    if (!items.length) return '<div class="empty">아직 기록이 없어요.</div>';
    const groups = new Map();
    for (const session of items) {
      const key = localDateKey(appDayDate(new Date(session.end || session.start)));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(session);
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([key, sessions]) => {
      const date = new Date(`${key}T12:00:00`);
      const label = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(date);
      return `<section class="tracking-date-group" data-tracking-date="${key}"><div class="tracking-date-heading"><strong>${label}</strong></div><div class="tracking-date-records">${sessions.map(rowMarkup).join("")}</div></section>`;
    }).join("");
  };
  $("#todaySessions").innerHTML = make(today);
  $("#allSessions").innerHTML = makePast(past);
  $("#trackingTodayTotal").textContent = `오늘 ${fmtDuration(todayFocusMs())}`;
}

function ensureManualSessionDialog() {
  let dialog = $("#manualSessionDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "manualSessionDialog";
  dialog.className = "manual-session-dialog";
  dialog.innerHTML = `
    <form id="manualSessionForm">
      <div class="manual-session-head"><strong id="manualSessionDialogTitle">시간 기록 추가</strong><button class="uw-icon-btn" data-close-session type="button" aria-label="닫기">×</button></div>
      <label><span>기록 이름</span><input id="manualSessionTitle" type="text" required maxlength="80" placeholder="무엇을 했나요?"></label>
      <label><span>영역</span><select id="manualSessionGroup" required></select></label>
      <label><span>날짜</span><input id="manualSessionDate" type="date" required></label>
      <div class="manual-session-times">
        <label><span>시작</span><input id="manualSessionStart" type="time" required></label>
        <label><span>종료</span><input id="manualSessionEnd" type="time" required></label>
      </div>
      <div class="manual-session-error" id="manualSessionError" role="alert"></div>
      <div class="manual-session-actions"><button class="soft-btn" data-close-session type="button">취소</button><button class="primary-btn" type="submit">기록 저장</button></div>
    </form>`;
  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close-session]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  $("#manualSessionForm", dialog).addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#manualSessionTitle", dialog).value.trim();
    const groupId = $("#manualSessionGroup", dialog).value || state.eventGroups[0]?.id || "default";
    const date = $("#manualSessionDate", dialog).value;
    const startValue = $("#manualSessionStart", dialog).value;
    const endValue = $("#manualSessionEnd", dialog).value;
    const error = $("#manualSessionError", dialog);
    const start = new Date(`${date}T${startValue}:00`);
    const end = new Date(`${date}T${endValue}:00`);
    if (!title || !date || !startValue || !endValue || !Number.isFinite(+start) || !Number.isFinite(+end)) {
      error.textContent = "이름·날짜·시간을 모두 입력해 주세요.";
      return;
    }
    if (end <= start) {
      error.textContent = "종료 시간은 시작 시간보다 뒤여야 해요.";
      return;
    }
    if (editingSessionId) {
      const session = state.sessions.find((item) => item.id === editingSessionId);
      if (!session) {
        error.textContent = "수정할 기록을 찾지 못했어요.";
        return;
      }
      session.title = title;
      session.groupId = groupId;
      session.start = start.toISOString();
      session.end = end.toISOString();
      session.durationMs = end - start;
    } else {
      state.sessions.push({
        id: uid(),
        taskId: null,
        groupId,
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        durationMs: end - start,
        timerMode: "manual"
      });
    }
    editingSessionId = null;
    await save();
    dialog.close();
    renderTracking();
    renderDashboard();
  });
  return dialog;
}

function openManualSession(defaultOffset = 0) {
  editingSessionId = null;
  const dialog = ensureManualSessionDialog();
  $("#manualSessionDialogTitle", dialog).textContent = "시간 기록 추가";
  const date = appDayDate();
  date.setDate(date.getDate() + defaultOffset);
  const now = new Date();
  let endMinute = defaultOffset === 0 ? now.getHours() * 60 + now.getMinutes() : 18 * 60;
  endMinute = Math.min(23 * 60 + 55, Math.max(30, Math.round(endMinute / 5) * 5));
  const startMinute = Math.max(0, endMinute - 30);
  const timeValue = (minute) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  $("#manualSessionTitle", dialog).value = "";
  $("#manualSessionGroup", dialog).innerHTML = eventGroupOptions(state.eventGroups[0]?.id || "default");
  $("#manualSessionGroup", dialog).value = state.eventGroups[0]?.id || "default";
  $("#manualSessionDate", dialog).value = localDateKey(date);
  $("#manualSessionStart", dialog).value = timeValue(startMinute);
  $("#manualSessionEnd", dialog).value = timeValue(endMinute);
  $("#manualSessionError", dialog).textContent = "";
  dialog.showModal();
  requestAnimationFrame(() => $("#manualSessionTitle", dialog).focus());
}

function openSessionEditor(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return showToast("수정할 기록을 찾지 못했어요.");
  editingSessionId = sessionId;
  const dialog = ensureManualSessionDialog();
  const start = new Date(session.start || session.end);
  const end = new Date(session.end || session.start);
  const timeValue = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  $("#manualSessionDialogTitle", dialog).textContent = "기록 변경";
  $("#manualSessionTitle", dialog).value = session.title || "";
  $("#manualSessionGroup", dialog).innerHTML = eventGroupOptions(session.groupId || state.eventGroups[0]?.id || "default");
  $("#manualSessionGroup", dialog).value = session.groupId || state.eventGroups[0]?.id || "default";
  $("#manualSessionDate", dialog).value = localDateKey(start);
  $("#manualSessionStart", dialog).value = timeValue(start);
  $("#manualSessionEnd", dialog).value = timeValue(end);
  $("#manualSessionError", dialog).textContent = "";
  dialog.showModal();
  requestAnimationFrame(() => $("#manualSessionStart", dialog).focus());
}

function renderTracking() {
  const select = $("#timerTaskSelect");
  const custom = $("#timerCustomTitle");
  const previous = select.value;
  const previousCustom = custom?.value || "";
  const dayKey = appDayKey();
  const activeTasks = state.tasks.filter((task) => recurringOnDate(task, dayKey) && !taskCompletedOn(task, dayKey));
  const activeHabits = state.habitTemplates.filter((habit) =>
    habitOccursOnDate(habit, dayKey) &&
    !Boolean(state.habitDays?.[dayKey]?.[habit.id]) &&
    !Boolean(state.habitOverrides?.[dayKey]?.[habit.id]?.hidden)
  );
  const taskOptions = activeTasks.map((task) => `<option value="task:${task.id}">${esc(task.title)}</option>`).join("");
  const habitOptions = activeHabits.map((habit) => `<option value="habit:${habit.id}">${esc(habit.title)}</option>`).join("");
  select.innerHTML = '<option value="">할일·습관 선택 (선택 안 해도 됨)</option>' + (taskOptions ? `<optgroup label="할일">${taskOptions}</optgroup>` : "") + (habitOptions ? `<optgroup label="습관">${habitOptions}</optgroup>` : "");
  if (trackingSourceFromValue(previous)) select.value = previous;
  if (state.timer.taskId) select.value = `task:${state.timer.taskId}`;
  else if (state.timer.habitId) select.value = `habit:${state.timer.habitId}`;
  const timerHasSource = Boolean(state.timer.taskId || state.timer.habitId);
  if (custom) custom.value = state.timer.running ? (timerHasSource ? "" : (state.timer.title || "")) : previousCustom;
  const source = state.timer.taskId
    ? state.tasks.find((item) => item.id === state.timer.taskId)
    : state.timer.habitId
      ? state.habitTemplates.find((item) => item.id === state.timer.habitId)
      : null;
  const directTitle = custom?.value.trim() || "";
  $("#timerTaskLabel").textContent = source?.title || state.timer.title || directTitle || "할일·습관을 선택하거나 직접 기록 이름을 써도 돼요.";
  updateTimerUI();
  renderSessions();
}

function renderProjects() {
  if (document.querySelector('script[src*="work-management.js"]')) return;
  const statuses = ["목표", "작업", "보류", "완료"];
  $("#projectSections").innerHTML = statuses.map((status) => {
    const projects = state.projects.filter((project) => project.status === status);
    return `<section class="section-card project-status-drop" data-project-status="${status}"><div class="section-head"><span>${status}</span><span class="card-meta">${projects.length}</span></div><div class="project-list">${projects.length ? projects.map((project) => `<div class="project-row editable-row" draggable="true" data-project-id="${project.id}" data-context-kind="project" data-context-id="${project.id}"><div><strong>${esc(project.title)}</strong><div class="project-meta">${esc(project.category || "")}</div></div><div><div class="progress"><i style="width:${Math.max(0, Math.min(100, Number(project.progress || 0)))}%"></i></div><div class="project-meta">${Math.max(0, Math.min(100, Number(project.progress || 0)))}%</div></div><span class="pill">${project.deadline ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(`${project.deadline}T12:00:00`)) : "기한 없음"}</span></div>`).join("") : '<div class="empty">작업이 없어요.</div>'}</div></section>`;
  }).join("");
}

const GROUP_DRAG_MOUSE_DISTANCE = 6;
const GROUP_DRAG_TOUCH_SCROLL_DISTANCE = 10;
const GROUP_DRAG_TOUCH_HOLD_MS = 450;

function wireEventGroupDrag(groupList) {
  if (!groupList || groupList.dataset.eventGroupDragInstalled) return;
  groupList.dataset.eventGroupDragInstalled = "1";
  let gesture = null;

  const clearGesture = () => {
    if (!gesture) return;
    clearTimeout(gesture.timer);
    gesture.row?.classList.remove("dragging");
    try { gesture.handle?.releasePointerCapture?.(gesture.pointerId); } catch {}
    gesture = null;
  };

  const activate = () => {
    if (!gesture || gesture.active || !gesture.row?.isConnected) return;
    gesture.active = true;
    gesture.row.classList.add("dragging");
    try { gesture.handle.setPointerCapture?.(gesture.pointerId); } catch {}
  };

  groupList.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-event-group-drag]");
    if (!handle || !event.isPrimary || event.button > 0) return;
    const row = handle.closest("[data-event-group-id]");
    if (!row) return;
    clearGesture();
    gesture = {
      handle,
      row,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
      moved: false,
      coarse: event.pointerType !== "mouse" || matchMedia("(hover:none),(pointer:coarse)").matches,
      timer: null,
    };
    if (gesture.coarse) gesture.timer = setTimeout(activate, GROUP_DRAG_TOUCH_HOLD_MS);
  });

  document.addEventListener("pointermove", (event) => {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
    if (!current.active) {
      if (current.coarse && distance > GROUP_DRAG_TOUCH_SCROLL_DISTANCE) { clearGesture(); return; }
      if (!current.coarse && distance >= GROUP_DRAG_MOUSE_DISTANCE) activate();
      if (!current.active) return;
    }
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".event-group-row");
    if (!target || target === current.row || target.parentElement !== groupList) return;
    const before = [...groupList.querySelectorAll("[data-event-group-id]")].map((row) => row.dataset.eventGroupId).join("|");
    const rect = target.getBoundingClientRect();
    groupList.insertBefore(current.row, event.clientY > rect.top + rect.height / 2 ? target.nextSibling : target);
    const after = [...groupList.querySelectorAll("[data-event-group-id]")].map((row) => row.dataset.eventGroupId).join("|");
    if (before !== after) current.moved = true;
  }, { passive: false });

  const finishGesture = async (event) => {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    const changed = current.active && current.moved;
    const ids = changed ? [...groupList.querySelectorAll("[data-event-group-id]")].map((row) => row.dataset.eventGroupId) : [];
    clearGesture();
    if (!changed) return;
    const byId = new Map(state.eventGroups.map((group) => [group.id, group]));
    state.eventGroups = ids.map((id) => byId.get(id)).filter(Boolean);
    await save();
    refreshEventGroupInputs();
    renderCalendar();
    renderSettings();
  };
  document.addEventListener("pointerup", finishGesture);
  document.addEventListener("pointercancel", clearGesture);
}

function renderSettings() {
  const container = $("#habitTemplateList");
  if (container) {
    container.innerHTML = state.habitTemplates.map((habit) => `<div class="template-row"><span>${esc(habit.title)}</span><button class="ghost-btn danger-text" data-del-habit="${habit.id}" type="button">삭제</button></div>`).join("");
    container.querySelectorAll("[data-del-habit]").forEach((button) => button.addEventListener("click", async () => {
      const id = button.dataset.delHabit;
      const habit = state.habitTemplates.find((item) => item.id === id);
      const confirmed = await confirmAction({ title: "습관을 삭제할까요?", message: `‘${habit?.title || "선택한 습관"}’의 과거 완료 기록도 함께 삭제돼요.\n삭제한 내용은 되돌릴 수 없어요.` });
      if (!confirmed) return;
      state.habitTemplates = state.habitTemplates.filter((item) => item.id !== id);
      Object.values(state.habitDays || {}).forEach((day) => { if (day && typeof day === "object") delete day[id]; });
      Object.values(state.habitOverrides || {}).forEach((day) => { if (day && typeof day === "object") delete day[id]; });
      await save();
      renderSettings();
      renderHome();
    }));
  }

  const timelineColors = state.ui?.timelineColors || defaultState().ui.timelineColors;
  if ($("#timelineTaskColor")) $("#timelineTaskColor").value = safeColor(timelineColors.task);
  if ($("#timelineHabitColor")) $("#timelineHabitColor").value = safeColor(timelineColors.habit);
  const weatherLocation = normalizeWeatherLocation(state.ui?.homeDashboard?.weatherLocation);
  const weatherQuery = $("#homeWeatherLocationQuery");
  if (weatherQuery && document.activeElement !== weatherQuery) weatherQuery.value = weatherLocation.name;
  if ($("#homeWeatherLocationStatus")) $("#homeWeatherLocationStatus").textContent = `현재 지역 · ${weatherLocation.name}`;

  const groupList = $("#eventGroupList");
  if (groupList) {
    const protectedGroupId = state.eventGroups.find((group) => group.id === "default")?.id || state.eventGroups[0]?.id;
    groupList.innerHTML = state.eventGroups.map((group) => `<div class="event-group-row" data-event-group-id="${esc(group.id)}">
      <button class="event-group-drag-handle" type="button" data-event-group-drag aria-label="${esc(group.name)} 순서 이동" title="끌어서 순서 변경">⠿</button>
      <input type="color" value="${safeColor(group.color)}" aria-label="${esc(group.name)} 색" data-event-group-color />
      <input value="${esc(group.name)}" aria-label="영역 이름" data-event-group-name />
      <button class="ghost-btn danger-text" type="button" data-event-group-delete${group.id === protectedGroupId ? " disabled" : ""}>삭제</button>
    </div>`).join("");
    groupList.querySelectorAll("[data-event-group-name], [data-event-group-color]").forEach((input) => input.addEventListener("change", () => {
      const row = input.closest("[data-event-group-id]");
      const group = state.eventGroups.find((item) => item.id === row?.dataset.eventGroupId);
      if (!group) return;
      group.name = row.querySelector("[data-event-group-name]").value.trim() || group.name;
      group.color = safeColor(row.querySelector("[data-event-group-color]").value);
      save();
      refreshEventGroupInputs();
      renderCalendar();
    }));
    wireEventGroupDrag(groupList);
    groupList.querySelectorAll("[data-event-group-delete]").forEach((button) => button.addEventListener("click", async () => {
      const id = button.closest("[data-event-group-id]")?.dataset.eventGroupId;
      const fallbackGroup = state.eventGroups.find((group) => group.id === "default") || state.eventGroups[0];
      if (!id || id === fallbackGroup?.id) return;
      const target = state.eventGroups.find((group) => group.id === id);
      const confirmed = await confirmAction({ title: "영역을 삭제할까요?", message: `‘${target?.name || "선택한 영역"}’의 항목은 기본 영역으로 이동해요.` });
      if (!confirmed) return;
      state.events.forEach((event) => { if (event.groupId === id) event.groupId = fallbackGroup.id; });
      state.tasks.forEach((task) => { if (task.groupId === id) task.groupId = fallbackGroup.id; });
      state.projects.forEach((project) => { if (project.groupId === id) project.groupId = fallbackGroup.id; });
      state.sessions.forEach((session) => { if (session.groupId === id) session.groupId = fallbackGroup.id; });
      state.eventGroups = state.eventGroups.filter((group) => group.id !== id);
      await save();
      renderSettings();
      renderCalendar();
    }));
  }
  refreshEventGroupInputs();
}

async function searchWeatherLocations() {
  const input = $("#homeWeatherLocationQuery");
  const button = $("#homeWeatherLocationSearch");
  const results = $("#homeWeatherLocationResults");
  const queryText = input?.value.trim() || "";
  if (!input || !button || !results) return;
  if (queryText.length < 2) return showToast("지역 이름을 두 글자 이상 입력해 주세요.");
  button.disabled = true;
  button.textContent = "검색 중…";
  results.hidden = false;
  results.innerHTML = '<div class="weather-location-empty">지역을 찾는 중이에요.</div>';
  try {
    const query = new URLSearchParams({ name: queryText, count: "8", language: "ko", format: "json" });
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${query}`);
    if (!response.ok) throw new Error(`geocoding ${response.status}`);
    const data = await response.json();
    const locations = Array.isArray(data.results) ? data.results.filter((item) => Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude))) : [];
    results.innerHTML = locations.length ? locations.map((item) => {
      const details = [item.admin1, item.country].filter(Boolean).join(" · ");
      return `<button type="button" data-weather-location-name="${esc(item.name)}" data-weather-location-latitude="${Number(item.latitude)}" data-weather-location-longitude="${Number(item.longitude)}"><strong>${esc(item.name)}</strong>${details ? `<small>${esc(details)}</small>` : ""}</button>`;
    }).join("") : '<div class="weather-location-empty">검색 결과가 없어요. 시·군·구 이름으로 다시 검색해 보세요.</div>';
  } catch (error) {
    console.error(error);
    results.innerHTML = '<div class="weather-location-empty">지역을 검색하지 못했어요. 잠시 후 다시 시도해 주세요.</div>';
  } finally {
    button.disabled = false;
    button.textContent = "검색";
  }
}

function addHabit() {
  const input = $("#newHabitInput");
  const title = input.value.trim();
  if (!title) return;
  state.habitTemplates.push({ id: uid(), title });
  input.value = "";
  ensureHabitDay();
  save();
  renderSettings();
  renderHome();
}

function renderAll() {
  ensureHabitDay();
  applySidebar();
  renderHome();
  renderCalendar();
  renderTracking();
  renderSettings();
  const sharedState = JSON.parse(JSON.stringify(state));
  window.__ONEKAN_APP_STATE__ = sharedState;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "app-render", state: sharedState } }));
}

async function initializeForUser(user) {
  currentUser = user;
  if (loadedUserId === user.id) return;
  await loadStateFromCloud(user);
  renderAll();
  startTicker();
}

async function resetForLogout() {
  currentUser = null;
  loadedUserId = null;
  state = defaultState();
  lastSavedState = defaultState();
  clearInterval(tickHandle);
}

function calendarInputHost(target) {
  return target.closest?.(".day-cell[data-calendar-date], .week-col[data-calendar-date], .multi-day-list-section[data-calendar-date], .day-list[data-calendar-date]") || null;
}

function clearCalendarRangeHighlight() {
  $$("#calendarBody .calendar-range-selected").forEach((cell) => cell.classList.remove("calendar-range-selected"));
}

function paintCalendarRange(startDate, endDate) {
  const [first, last] = orderedDateRange(startDate, endDate);
  $$("#calendarBody .day-cell[data-calendar-date]").forEach((cell) => {
    const key = cell.dataset.calendarDate;
    cell.classList.toggle("calendar-range-selected", key >= first && key <= last);
  });
}

function bindCalendarDirectEntry() {
  const body = $("#calendarBody");
  body.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.target.closest(".cal-event,button,input,select,a,.calendar-cell-composer")) return;
    const cell = event.target.closest(".day-cell[data-calendar-date]");
    if (!cell) return;
    closeCalendarCellComposer();
    calendarRangeSelection = { start: cell.dataset.calendarDate, end: cell.dataset.calendarDate, host: cell };
    paintCalendarRange(calendarRangeSelection.start, calendarRangeSelection.end);
    event.preventDefault();
  });
  body.addEventListener("mouseover", (event) => {
    if (!calendarRangeSelection) return;
    const cell = event.target.closest(".day-cell[data-calendar-date]");
    if (!cell) return;
    calendarRangeSelection.end = cell.dataset.calendarDate;
    paintCalendarRange(calendarRangeSelection.start, calendarRangeSelection.end);
  });
  document.addEventListener("mouseup", () => {
    if (!calendarRangeSelection) return;
    const selection = calendarRangeSelection;
    calendarRangeSelection = null;
    clearCalendarRangeHighlight();
    suppressCalendarCellClickUntil = Date.now() + 350;
    openCalendarCellComposer(selection.host, selection.start, selection.end);
  });
  body.addEventListener("click", (event) => {
    if (Date.now() < suppressCalendarCellClickUntil || event.target.closest(".cal-event,.day-timed-event,.row,button,input,select,a,.calendar-cell-composer")) return;
    const host = calendarInputHost(event.target);
    const date = calendarCellDate(host);
    if (host && date) openCalendarCellComposer(host, date);
  });
}

function bindUI() {
  $$(".nav-item[data-page]").forEach((button) => button.addEventListener("click", () => goPage(button.dataset.page)));
  $$('[data-go]').forEach((button) => button.addEventListener("click", () => goPage(button.dataset.go)));
  $("#collapseBtn").addEventListener("click", () => {
    if (innerWidth <= 900) {
      $("#app-section").classList.toggle("mobile-nav-open");
      return;
    }
    state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
    save();
    applySidebar();
  });
  $("#mobileMenuBtn").addEventListener("click", () => $("#app-section").classList.toggle("mobile-nav-open"));
  bindCalendarDirectEntry();
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".more")) $$(".menu.open").forEach((menu) => menu.classList.remove("open"));
  });

  $("#addTaskBtn")?.addEventListener("click", addTask);
  $("#newTaskInput")?.addEventListener("keydown", (event) => { if (event.key === "Enter") addTask(); });
  $("#addTimeBlockBtn")?.addEventListener("click", () => {
    const now = new Date();
    let minute = now.getHours() * 60 + now.getMinutes();
    minute = Math.ceil(minute / SLOT) * SLOT;
    document.dispatchEvent(new CustomEvent("onekan:open-home-timeline-input", { detail: { startMinute: clampStart(minute, 30), duration: 30 } }));
  });
  $$("#calendarTypeFilter [data-calendar-type]").forEach((button) => button.addEventListener("click", () => {
    const type = button.dataset.calendarType;
    state.ui.calendarFilters ||= defaultState().ui.calendarFilters;
    state.ui.calendarFilters[calView] ||= { ...defaultState().ui.calendarFilters[calView] };
    state.ui.calendarFilters[calView][type] = !state.ui.calendarFilters[calView][type];
    save();
    renderCalendar();
  }));

  $$("#calendarViewSeg button").forEach((button) => button.addEventListener("click", () => {
    calView = button.dataset.view;
    $$("#calendarViewSeg button").forEach((item) => item.classList.toggle("active", item === button));
    renderCalendar();
  }));
  $$("#dayModeSeg button").forEach((button) => button.addEventListener("click", () => {
    calDayMode = button.dataset.dayMode;
    $$("#dayModeSeg button").forEach((item) => item.classList.toggle("active", item === button));
    renderCalendar();
  }));
  $("#calPrev").addEventListener("click", () => {
    if (calView === "month") calCursor.setMonth(calCursor.getMonth() - 1);
    else if (calView === "week") calCursor.setDate(calCursor.getDate() - 7);
    else if (calView === "three") calCursor.setDate(calCursor.getDate() - 3);
    else calCursor.setDate(calCursor.getDate() - 1);
    renderCalendar();
  });
  $("#calNext").addEventListener("click", () => {
    if (calView === "month") calCursor.setMonth(calCursor.getMonth() + 1);
    else if (calView === "week") calCursor.setDate(calCursor.getDate() + 7);
    else if (calView === "three") calCursor.setDate(calCursor.getDate() + 3);
    else calCursor.setDate(calCursor.getDate() + 1);
    renderCalendar();
  });
  $("#calToday").addEventListener("click", () => {
    calCursor = new Date();
    renderCalendar();
  });

  $("#timerStart").addEventListener("click", () => {
    const source = trackingSourceFromValue($("#timerTaskSelect").value);
    const taskId = source?.kind === "task" ? source.item.id : null;
    const habitId = source?.kind === "habit" ? source.item.id : null;
    const customTitle = $("#timerCustomTitle")?.value.trim() || "";
    const title = source?.item.title || customTitle;
    if (!title) return showToast("할일·습관을 선택하거나 기록 이름을 입력해 주세요.");
    state.timer = { mode: timerMode(), running: true, paused: false, taskId, habitId, title, startedAt: Date.now(), accumulatedMs: 0, durationMs: timerDurationMs() };
    save();
    renderTracking();
    startTicker();
  });
  $("#timerPause").addEventListener("click", () => {
    const timer = state.timer;
    if (!timer.running) return;
    if (timer.paused) {
      timer.paused = false;
      timer.startedAt = Date.now();
    } else {
      timer.accumulatedMs += Date.now() - timer.startedAt;
      timer.paused = true;
      timer.startedAt = null;
    }
    save();
    renderTracking();
  });
  $("#timerStop").addEventListener("click", () => {
    finishTimer(false);
  });
  $$("[data-add-session]").forEach((button) => button.addEventListener("click", () => openManualSession(Number(button.dataset.defaultOffset || 0))));
  document.addEventListener("onekan:edit-session", (event) => openSessionEditor(event.detail?.id));
  $("#timerMinusMinute").addEventListener("click", () => adjustTimerMinutes(-1));
  $("#timerPlusMinute").addEventListener("click", () => adjustTimerMinutes(1));
  $$('[data-timer-mode]').forEach((button) => button.addEventListener("click", () => setTimerMode(button.dataset.timerMode)));
  $("#timerTaskSelect").addEventListener("change", () => {
    const source = trackingSourceFromValue($("#timerTaskSelect").value);
    if (source && $("#timerCustomTitle")) $("#timerCustomTitle").value = "";
    $("#timerTaskLabel").textContent = source?.item.title || $("#timerCustomTitle")?.value.trim() || "할일·습관을 선택하거나 직접 기록 이름을 써도 돼요.";
  });
  $("#timerCustomTitle")?.addEventListener("input", (event) => {
    if (event.target.value.trim()) $("#timerTaskSelect").value = "";
    $("#timerTaskLabel").textContent = event.target.value.trim() || "할일·습관을 선택하거나 직접 기록 이름을 써도 돼요.";
  });

  for (const [selector, key] of [["#timelineTaskColor", "task"], ["#timelineHabitColor", "habit"]]) {
    $(selector)?.addEventListener("change", (event) => {
      state.ui.timelineColors ||= { ...defaultState().ui.timelineColors };
      state.ui.timelineColors[key] = safeColor(event.target.value);
      save();
      renderCalendar();
    });
  }
  $("#addEventGroupBtn").addEventListener("click", () => {
    const name = $("#newEventGroupName").value.trim();
    if (!name) return;
    state.eventGroups.push({ id: uid(), name, color: safeColor($("#newEventGroupColor").value) });
    $("#newEventGroupName").value = "";
    save();
    renderSettings();
  });
  $("#homeWeatherLocationSearch")?.addEventListener("click", searchWeatherLocations);
  $("#homeWeatherLocationQuery")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchWeatherLocations();
    }
  });
  $("#homeWeatherLocationResults")?.addEventListener("click", async (event) => {
    const option = event.target.closest("[data-weather-location-name]");
    if (!option) return;
    const location = normalizeWeatherLocation({ name: option.dataset.weatherLocationName, latitude: option.dataset.weatherLocationLatitude, longitude: option.dataset.weatherLocationLongitude });
    state.ui.homeDashboard ||= { heroDday: null, secondaryDdays: [] };
    state.ui.homeDashboard.weatherLocation = location;
    await save();
    $("#homeWeatherLocationResults").hidden = true;
    renderSettings();
    document.dispatchEvent(new CustomEvent("onekan:weather-location-changed", { detail: { location } }));
    showToast(`날씨 지역을 ${location.name}(으)로 바꿨어요.`);
  });
  $("#reloadCloudBtn").addEventListener("click", async () => {
    if (!currentUser) return;
    await loadStateFromCloud(currentUser);
    renderAll();
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && currentUser && !state.timer.running) {
      try {
        await saveChain;
        await loadStateFromCloud(currentUser);
        renderAll();
      } catch (error) {
        console.error(error);
      }
    }
  });
}

bindUI();
setupAuth({ onLogin: initializeForUser, onLogout: resetForLogout });
