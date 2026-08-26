import { supabase } from "./supabase.js";
import { setupAuth } from "./auth.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const uid = () => crypto.randomUUID();
const pad = (n) => String(n).padStart(2, "0");
const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '\"': "&quot;" }[c]));
const DEFAULT_EVENT_GROUPS = [
  { id: "default", name: "기본", color: "#8fa9c4" },
  { id: "notion-clover", name: "♣", color: "#8eb69b" },
  { id: "notion-star", name: "⭐", color: "#d9aa69" },
  { id: "notion-life", name: "할일", color: "#c594a8" },
  { id: "notion-design", name: "디자인", color: "#a38cc1" },
  { id: "notion-study", name: "공부", color: "#789bc2" },
];

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
  return {
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
    timer: { mode: "pomodoro", running: false, paused: false, taskId: null, startedAt: null, accumulatedMs: 0, durationMs: 25 * 60 * 1000 },
    projects: [],
    ui: {
      sidebarCollapsed: false,
      calendarFilters: {
        month: { schedule: true, task: false },
        week: { schedule: true, task: true },
        three: { schedule: true, task: true },
        day: { schedule: false, task: true },
      },
    },
  };
}

function normalizeState(raw) {
  const base = defaultState();
  const state = raw && typeof raw === "object" ? raw : {};
  const savedCalendarFilters = state.ui?.calendarFilters || {};
  return {
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
      calendarFilters: {
        month: { ...base.ui.calendarFilters.month, ...(savedCalendarFilters.month || {}) },
        week: { ...base.ui.calendarFilters.week, ...(savedCalendarFilters.week || {}) },
        three: { ...base.ui.calendarFilters.three, ...(savedCalendarFilters.three || {}) },
        day: { ...base.ui.calendarFilters.day, ...(savedCalendarFilters.day || {}) },
      },
    },
  };
}

let currentUser = null;
let loadedUserId = null;
let state = defaultState();
let saveChain = Promise.resolve();
let tickHandle = null;
let timerFinishing = false;
let editingBlockId = null;
let calView = "month";
let calDayMode = "timeline";
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
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) {
    console.error(error);
    setSyncStatus("불러오기 실패", true);
    throw error;
  }

  if (!data) {
    state = defaultState();
    const { error: insertError } = await supabase.from("onekan_state").insert({ user_id: user.id, data: state });
    if (insertError) throw insertError;
  } else {
    state = normalizeState(data.data);
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
    const { error } = await supabase.from("onekan_state").upsert({ user_id: userId, data: snapshot }, { onConflict: "user_id" });
    if (error) throw error;
    setSyncStatus("저장됨");
  }).catch((error) => {
    console.error(error);
    setSyncStatus("저장 실패", true);
  });
  return saveChain;
}

function ensureHabitDay() {
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
  if (name === "calendar") renderCalendar();
  if (name === "tracking") renderTracking();
  if (name === "projects") renderProjects();
  if (name === "settings") renderSettings();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function sortIncompleteFirst(items, doneFn) {
  return [...items].sort((a, b) => Number(doneFn(a)) - Number(doneFn(b)));
}

function renderTasks() {
  const dayKey = appDayKey();
  const list = $("#taskList");
  list.innerHTML = "";
  const todayTasks = sortIncompleteFirst(state.tasks.filter((task) => task.date === dayKey), (task) => task.done);
  if (!todayTasks.length) list.innerHTML = '<div class="empty">오늘 할일이 없어요.</div>';

  for (const task of todayTasks) {
    const row = document.createElement("div");
    row.className = `row${task.done ? " done" : ""}`;
    row.draggable = !task.done;
    row.dataset.id = task.id;
    row.innerHTML = `<button class="check ${task.done ? "checked" : ""}" type="button" aria-label="완료">${task.done ? "✓" : ""}</button><span class="row-title">${esc(task.title)}</span>`;

    row.querySelector(".check").addEventListener("click", () => {
      task.done = !task.done;
      task.completedAt = task.done ? new Date().toISOString() : null;
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
  const title = input.value.trim();
  if (!title) return;
  state.tasks.push({ id: uid(), title, done: false, date: appDayKey() });
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

function hasBlockConflict(startMinute, duration, excludeId = null) {
  const end = startMinute + duration;
  const dayKey = appDayKey();
  return state.timeBlocks.some((block) => block.date === dayKey && block.id !== excludeId && startMinute < block.startMinute + block.duration && end > block.startMinute);
}

function addDirectTimeBlock(startMinute, duration = 30) {
  const dayKey = appDayKey();
  startMinute = clampStart(startMinute, duration);
  if (hasBlockConflict(startMinute, duration)) return window.alert("이미 시간 계획이 있는 구간이에요. 다른 시간을 골라 주세요.");
  const block = { id: uid(), taskId: null, sourceTitle: "직접 추가", detail: "새 시간 계획", startMinute, duration, date: dayKey };
  state.timeBlocks.push(block);
  save();
  renderTimeGrid();
  requestAnimationFrame(() => {
    const element = document.querySelector(`.time-block[data-block-id="${block.id}"]`);
    if (element) openBlockEditor(block, element);
  });
}

function renderTimeGrid() {
  const grid = $("#timeGrid");
  grid.innerHTML = "";
  let selecting = false;
  let selectStart = null;
  let selectEnd = null;
  let selectionEl = null;

  const clearSelection = () => {
    selecting = false;
    selectStart = selectEnd = null;
    selectionEl?.remove();
    selectionEl = null;
  };

  const paintSelection = () => {
    if (selectStart === null || selectEnd === null) return;
    selectionEl?.remove();
    const start = Math.min(selectStart, selectEnd);
    const end = Math.max(selectStart, selectEnd);
    const index = (start - START_MIN) / SLOT;
    const slot = grid.children[index];
    if (!slot) return;
    selectionEl = document.createElement("div");
    selectionEl.className = "time-selection";
    selectionEl.style.height = `${((end - start) / SLOT + 1) * 42 - 4}px`;
    slot.querySelector(".drop-zone").appendChild(selectionEl);
  };

  for (let minute = START_MIN; minute < END_MIN; minute += SLOT) {
    const slot = document.createElement("div");
    slot.className = "time-slot";
    slot.dataset.minute = minute;
    slot.innerHTML = `<div class="time-label">${minuteLabel(minute)}</div><div class="drop-zone" tabindex="0" aria-label="${minuteLabel(minute)} 시간 계획 칸"></div>`;
    const dropZone = slot.querySelector(".drop-zone");

    dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("over"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("over");
      const blockId = event.dataTransfer.getData("text/time-block-id");
      if (blockId) {
        const block = state.timeBlocks.find((item) => item.id === blockId);
        if (!block) return;
        const next = clampStart(minute, block.duration);
        if (hasBlockConflict(next, block.duration, block.id)) return window.alert("이미 시간 계획이 있는 구간이에요.");
        block.startMinute = next;
        block.date = appDayKey();
        save();
        renderTimeGrid();
        return;
      }

      const taskId = event.dataTransfer.getData("text/task-id");
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) return;
      if (hasBlockConflict(minute, 30)) return window.alert("이미 시간 계획이 있는 구간이에요.");
      state.timeBlocks.push({ id: uid(), taskId, sourceTitle: task.title, detail: task.title, startMinute: minute, duration: 30, date: appDayKey() });
      save();
      renderTimeGrid();
    });

    dropZone.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.target.closest(".time-block")) return;
      selecting = true;
      selectStart = minute;
      selectEnd = minute;
      paintSelection();
      event.preventDefault();
    });
    dropZone.addEventListener("mouseenter", () => {
      if (selecting) { selectEnd = minute; paintSelection(); }
    });
    grid.appendChild(slot);
  }

  const finishSelection = () => {
    if (!selecting) return;
    const start = Math.min(selectStart, selectEnd);
    const end = Math.max(selectStart, selectEnd);
    const duration = end - start + SLOT;
    clearSelection();
    addDirectTimeBlock(start, Math.min(duration, 240));
  };
  grid.onmouseup = finishSelection;
  grid.onmouseleave = (event) => { if (selecting && !(event.buttons & 1)) finishSelection(); };

  const dayKey = appDayKey();
  for (const block of state.timeBlocks.filter((item) => item.date === dayKey)) {
    const index = (block.startMinute - START_MIN) / SLOT;
    if (index < 0) continue;
    const slot = grid.children[index];
    if (!slot) continue;
    const dropZone = slot.querySelector(".drop-zone");
    const element = document.createElement("div");
    element.className = "time-block";
    element.dataset.blockId = block.id;
    element.draggable = true;
    element.style.height = `${Math.max(36, (block.duration / SLOT) * 42 - 6)}px`;
    element.innerHTML = `<strong>${esc(block.detail)}</strong><small>${minuteLabel(block.startMinute)} · ${block.duration}분</small>`;
    element.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/time-block-id", block.id); element.classList.add("dragging"); });
    element.addEventListener("dragend", () => element.classList.remove("dragging"));
    element.addEventListener("click", (event) => { event.stopPropagation(); openBlockEditor(block, element); });
    dropZone.appendChild(element);
  }
}

function fillBlockStartOptions() {
  const select = $("#blockStart");
  if (select.options.length) return;
  for (let minute = START_MIN; minute < END_MIN; minute += SLOT) {
    const option = document.createElement("option");
    option.value = String(minute);
    option.textContent = minuteLabel(minute);
    select.appendChild(option);
  }
}

function openBlockEditor(block, element) {
  editingBlockId = block.id;
  fillBlockStartOptions();
  $("#blockSource").value = block.taskId ? block.sourceTitle : "직접 추가";
  $("#blockDetail").value = block.detail;
  $("#blockStart").value = String(block.startMinute);
  $("#blockDuration").value = String(block.duration);
  const pop = $("#blockEditor");
  const rect = element.getBoundingClientRect();
  pop.style.left = `${Math.min(innerWidth - 280, Math.max(12, rect.left))}px`;
  pop.style.top = `${Math.min(innerHeight - 330, rect.bottom + 6)}px`;
  pop.classList.add("open");
  setTimeout(() => $("#blockDetail").focus(), 0);
}

function renderHabits() {
  ensureHabitDay();
  const dayKey = appDayKey();
  const checks = state.habitDays[dayKey];
  const list = $("#habitList");
  list.innerHTML = "";
  const sorted = sortIncompleteFirst(state.habitTemplates, (habit) => !!checks[habit.id]);
  if (!sorted.length) list.innerHTML = '<div class="empty">설정에서 습관을 추가해 주세요.</div>';
  for (const habit of sorted) {
    const done = !!checks[habit.id];
    const row = document.createElement("div");
    row.className = `row${done ? " done" : ""}`;
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

function renderDashboard() {
  const dayKey = appDayKey();
  const tasks = state.tasks.filter((task) => task.date === dayKey);
  const completedTasks = tasks.filter((task) => task.done).length;
  const taskProgress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;
  ensureHabitDay();
  const checks = state.habitDays[dayKey];
  const completedHabits = state.habitTemplates.filter((habit) => checks[habit.id]).length;
  if ($("#dashTasks")) $("#dashTasks").textContent = `${completedTasks} / ${tasks.length}`;
  if ($("#dashHabits")) $("#dashHabits").textContent = `${completedHabits} / ${state.habitTemplates.length}`;
  if ($("#dashFocus")) $("#dashFocus").textContent = fmtDuration(todayFocusMs());
  if ($("#homeProgressLabel")) $("#homeProgressLabel").textContent = `${taskProgress}%`;
  if ($("#homeProgress")) {
    $("#homeProgress").style.setProperty("--progress-offset", String(131.95 * (1 - taskProgress / 100)));
    $("#homeProgress").setAttribute("aria-label", `오늘 할일 ${completedTasks}/${tasks.length} 완료`);
  }
}

function renderHome() {
  $("#todayLabel").textContent = fmtDate(appDayDate());
  renderTasks();
  renderTimeGrid();
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
  for (const selector of ["#timelineEventGroup"]) {
    const select = $(selector);
    if (!select) continue;
    const previous = select.value;
    select.innerHTML = eventGroupOptions(previous);
    if (state.eventGroups.some((group) => group.id === previous)) select.value = previous;
  }
}

function calendarDateLabel(dateKey) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${dateKey}T12:00:00`));
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
  const rect = host.getBoundingClientRect();
  if (rect.left + 290 > innerWidth) form.classList.add("align-right");
  form.innerHTML = `
    <div class="calendar-cell-composer-head">
      <span class="${isRange ? "calendar-cell-range-note" : ""}">${isRange ? `${calendarDateLabel(startDate)} – ${calendarDateLabel(endDate)}` : calendarDateLabel(startDate)}</span>
      <button class="calendar-cell-composer-close" type="button" aria-label="닫기">×</button>
    </div>
    ${isRange ? "" : `<div class="quick-add-type"><button class="active" type="button" data-cell-entry-type="schedule">일정</button><button type="button" data-cell-entry-type="task">할일</button></div>`}
    <input data-cell-entry-title aria-label="제목" placeholder="${isRange ? "여행이나 여러 날 일정" : "일정 제목"}" required />
    <div class="calendar-cell-event-options">
      <select data-cell-entry-group aria-label="일정 그룹">${eventGroupOptions(state.eventGroups[0]?.id)}</select>
      ${isRange ? "" : '<input data-cell-entry-time type="time" value="09:00" aria-label="일정 시간" />'}
    </div>
    ${isRange ? "" : '<label class="calendar-cell-all-day"><input data-cell-entry-all-day type="checkbox" /> 종일</label>'}
    <button class="primary-btn" type="submit">추가</button>`;
  host.appendChild(form);
  let entryType = "schedule";
  const updateType = () => {
    const isTask = entryType === "task";
    form.querySelector("[data-cell-entry-title]").placeholder = isTask ? "할일 제목" : "일정 제목";
    form.querySelector(".calendar-cell-event-options")?.classList.toggle("hidden", isTask);
    form.querySelector(".calendar-cell-all-day")?.classList.toggle("hidden", isTask);
    form.querySelectorAll("[data-cell-entry-type]").forEach((button) => button.classList.toggle("active", button.dataset.cellEntryType === entryType));
  };
  form.querySelectorAll("[data-cell-entry-type]").forEach((button) => button.addEventListener("click", () => {
    entryType = button.dataset.cellEntryType;
    updateType();
    form.querySelector("[data-cell-entry-title]").focus();
  }));
  form.querySelector(".calendar-cell-composer-close").addEventListener("click", closeCalendarCellComposer);
  form.addEventListener("mousedown", (event) => event.stopPropagation());
  form.addEventListener("click", (event) => event.stopPropagation());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = form.querySelector("[data-cell-entry-title]").value.trim();
    if (!title) return;
    if (entryType === "task" && !isRange) {
      state.tasks.push({ id: uid(), title, done: false, date: startDate });
    } else {
      const allDay = isRange || form.querySelector("[data-cell-entry-all-day]")?.checked;
      if (allDay) {
        state.events.push({ id: uid(), title, type: "schedule", allDay: true, groupId: form.querySelector("[data-cell-entry-group]").value || state.eventGroups[0]?.id, start: new Date(`${startDate}T12:00:00`).toISOString(), end: new Date(`${endDate}T12:00:00`).toISOString() });
      } else {
        const time = form.querySelector("[data-cell-entry-time]")?.value || "09:00";
        const start = new Date(`${startDate}T${time}:00`);
        state.events.push({ id: uid(), title, type: "schedule", groupId: form.querySelector("[data-cell-entry-group]").value || state.eventGroups[0]?.id, start: start.toISOString(), end: new Date(start.getTime() + SLOT * 60000).toISOString() });
      }
    }
    save();
    closeCalendarCellComposer();
    renderHome();
    renderCalendar();
  });
  requestAnimationFrame(() => form.querySelector("[data-cell-entry-title]").focus());
}

function calendarFiltersForView(view = calView) {
  const defaults = defaultState().ui.calendarFilters[view];
  return { ...defaults, ...(state.ui.calendarFilters?.[view] || {}) };
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
    .map((event) => ({ ...event, kind: "event", type: "schedule", startDate: event.allDay ? null : new Date(event.start) }));
  const tasks = state.tasks
    .filter((task) => task.date === key)
    .map((task) => ({
      id: task.id,
      title: task.title,
      type: "task",
      kind: "task",
      startDate: task.notionStart && task.notionEnd ? new Date(task.notionStart) : null,
      done: task.done,
    }));
  const rank = (item) => item.type === "schedule" ? 0 : 1;
  return [...events, ...tasks]
    .filter((item) => item.type === "schedule" ? filters.schedule : filters.task)
    .sort((a, b) => rank(a) - rank(b) || ((a.startDate?.getTime() || Infinity) - (b.startDate?.getTime() || Infinity)) || a.title.localeCompare(b.title, "ko"));
}

function updateDayModeVisibility() {
  $("#dayModeSeg").classList.toggle("show", calView !== "month");
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
    const group = item.type === "schedule" ? eventGroupFor(item) : null;
    if (group) element.style.setProperty("--event-color", safeColor(group.color));
    const control = item.type === "schedule"
      ? `<span class="calendar-event-dot" aria-hidden="true" style="--event-color:${safeColor(group.color)}"></span>`
      : `<button class="calendar-check${item.done ? " checked" : ""}" type="button" data-calendar-check="task" data-calendar-id="${item.id}" aria-label="할일 완료">${item.done ? "✓" : ""}</button>`;
    element.innerHTML = `<div class="day-timed-main">${control}<strong>${esc(item.title)}</strong></div><small>${item.type === "schedule" ? `${esc(group.name)} · ` : ""}${timeText(item.startDate)}</small>`;
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
      element.className = `multi-entry planned ${item.type}`;
      element.style.top = `${((minute - START_MIN) / SLOT) * 42 + 2}px`;
      element.dataset.calendarKind = item.kind;
      element.dataset.calendarId = item.id;
      element.dataset.contextKind = item.kind;
      element.dataset.contextId = item.id;
      element.textContent = item.title;
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
  const body = $("#calendarBody");
  const now = new Date();
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
  if (duration >= 1000) {
    state.sessions.push({ id: uid(), taskId: timer.taskId, title: task?.title || "집중 기록", start: new Date(Date.now() - duration).toISOString(), end: new Date().toISOString(), durationMs: duration, timerMode: mode });
  }
  const durationMs = timerDurationMs();
  state.timer = { mode, running: false, paused: false, taskId: null, startedAt: null, accumulatedMs: 0, durationMs };
  save();
  renderTracking();
  renderDashboard();
  if (automatic) window.alert("집중 시간이 끝났어요. 기록에 저장했어요!");
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

function renderSessions() {
  const dayKey = appDayKey();
  const today = state.sessions.filter((session) => session.end && appDayKey(new Date(session.end)) === dayKey).sort((a, b) => new Date(b.end) - new Date(a.end));
  const all = [...state.sessions].sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 50);
  const make = (items) => items.length ? items.map((session) => `<div class="history-row editable-row" data-context-kind="session" data-context-id="${session.id}"><div><div class="history-name">${esc(session.title)}</div><div class="history-meta">${new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(session.end))}</div></div><div class="history-time">${fmtDuration(session.durationMs)}</div></div>`).join("") : '<div class="empty">아직 기록이 없어요.</div>';
  $("#todaySessions").innerHTML = make(today);
  $("#allSessions").innerHTML = make(all);
  $("#trackingTodayTotal").textContent = `오늘 ${fmtDuration(todayFocusMs())}`;
}

function renderTracking() {
  const select = $("#timerTaskSelect");
  const previous = select.value;
  const dayKey = appDayKey();
  const activeTasks = state.tasks.filter((task) => !task.done && task.date === dayKey);
  select.innerHTML = '<option value="">오늘 할일 선택</option>' + activeTasks.map((task) => `<option value="${task.id}">${esc(task.title)}</option>`).join("");
  if (activeTasks.some((task) => task.id === previous)) select.value = previous;
  if (state.timer.taskId) select.value = state.timer.taskId;
  const task = state.tasks.find((item) => item.id === state.timer.taskId);
  $("#timerTaskLabel").textContent = task ? task.title : "할일을 고르고 시작하세요.";
  updateTimerUI();
  renderSessions();
}

function renderProjects() {
  const statuses = ["목표", "작업", "보류", "완료"];
  $("#projectSections").innerHTML = statuses.map((status) => {
    const projects = state.projects.filter((project) => project.status === status);
    return `<section class="section-card project-status-drop" data-project-status="${status}"><div class="section-head"><span>${status}</span><span class="card-meta">${projects.length}</span></div><div class="project-list">${projects.length ? projects.map((project) => `<div class="project-row editable-row" draggable="true" data-project-id="${project.id}" data-context-kind="project" data-context-id="${project.id}"><div><strong>${esc(project.title)}</strong><div class="project-meta">${esc(project.category || "")}</div></div><div><div class="progress"><i style="width:${Math.max(0, Math.min(100, Number(project.progress || 0)))}%"></i></div><div class="project-meta">${Math.max(0, Math.min(100, Number(project.progress || 0)))}%</div></div><span class="pill">${project.deadline ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(`${project.deadline}T12:00:00`)) : "기한 없음"}</span></div>`).join("") : '<div class="empty">작업이 없어요.</div>'}</div></section>`;
  }).join("");
}

function renderSettings() {
  const container = $("#habitTemplateList");
  container.innerHTML = state.habitTemplates.map((habit) => `<div class="template-row"><span>${esc(habit.title)}</span><button class="ghost-btn danger-text" data-del-habit="${habit.id}" type="button">삭제</button></div>`).join("");
  container.querySelectorAll("[data-del-habit]").forEach((button) => button.addEventListener("click", () => {
    state.habitTemplates = state.habitTemplates.filter((habit) => habit.id !== button.dataset.delHabit);
    save();
    renderSettings();
    renderHome();
  }));

  const groupList = $("#eventGroupList");
  if (groupList) {
    groupList.innerHTML = state.eventGroups.map((group, index) => `<div class="event-group-row" data-event-group-id="${esc(group.id)}">
      <input type="color" value="${safeColor(group.color)}" aria-label="${esc(group.name)} 색" data-event-group-color />
      <input value="${esc(group.name)}" aria-label="일정 그룹 이름" data-event-group-name />
      <button class="ghost-btn danger-text" type="button" data-event-group-delete${index === 0 ? " disabled" : ""}>삭제</button>
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
    groupList.querySelectorAll("[data-event-group-delete]").forEach((button) => button.addEventListener("click", () => {
      const id = button.closest("[data-event-group-id]")?.dataset.eventGroupId;
      if (!id || id === state.eventGroups[0]?.id) return;
      state.events.forEach((event) => { if (event.groupId === id) event.groupId = state.eventGroups[0].id; });
      state.eventGroups = state.eventGroups.filter((group) => group.id !== id);
      save();
      renderSettings();
      renderCalendar();
    }));
  }
  refreshEventGroupInputs();
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
  renderProjects();
  renderSettings();
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
    if (!event.target.closest("#blockEditor") && !event.target.closest(".time-block")) $("#blockEditor").classList.remove("open");
  });

  $("#addTaskBtn").addEventListener("click", addTask);
  $("#newTaskInput").addEventListener("keydown", (event) => { if (event.key === "Enter") addTask(); });
  $("#addTimeBlockBtn").addEventListener("click", () => {
    const now = new Date();
    let minute = now.getHours() * 60 + now.getMinutes();
    minute = Math.ceil(minute / SLOT) * SLOT;
    addDirectTimeBlock(clampStart(minute, 30), 30);
  });
  $("#saveBlockBtn").addEventListener("click", () => {
    const block = state.timeBlocks.find((item) => item.id === editingBlockId);
    if (!block) return;
    const nextStart = Number($("#blockStart").value);
    const nextDuration = Number($("#blockDuration").value);
    if (hasBlockConflict(nextStart, nextDuration, block.id)) return window.alert("이미 시간 계획이 있는 구간이에요. 다른 시간을 골라 주세요.");
    block.detail = $("#blockDetail").value.trim() || block.sourceTitle || "시간 계획";
    block.startMinute = nextStart;
    block.duration = nextDuration;
    save();
    $("#blockEditor").classList.remove("open");
    renderTimeGrid();
  });
  $("#deleteBlockBtn").addEventListener("click", () => {
    state.timeBlocks = state.timeBlocks.filter((item) => item.id !== editingBlockId);
    save();
    $("#blockEditor").classList.remove("open");
    renderTimeGrid();
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
    const taskId = $("#timerTaskSelect").value;
    if (!taskId) return window.alert("먼저 할일을 골라 주세요.");
    state.timer = { mode: timerMode(), running: true, paused: false, taskId, startedAt: Date.now(), accumulatedMs: 0, durationMs: timerDurationMs() };
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
  $("#timerMinusMinute").addEventListener("click", () => adjustTimerMinutes(-1));
  $("#timerPlusMinute").addEventListener("click", () => adjustTimerMinutes(1));
  $$('[data-timer-mode]').forEach((button) => button.addEventListener("click", () => setTimerMode(button.dataset.timerMode)));
  $("#timerTaskSelect").addEventListener("change", () => {
    const task = state.tasks.find((item) => item.id === $("#timerTaskSelect").value);
    $("#timerTaskLabel").textContent = task ? task.title : "할일을 고르고 시작하세요.";
  });

  $("#addHabitBtn").addEventListener("click", addHabit);
  $("#newHabitInput").addEventListener("keydown", (event) => { if (event.key === "Enter") addHabit(); });
  $("#addEventGroupBtn").addEventListener("click", () => {
    const name = $("#newEventGroupName").value.trim();
    if (!name) return;
    state.eventGroups.push({ id: uid(), name, color: safeColor($("#newEventGroupColor").value) });
    $("#newEventGroupName").value = "";
    save();
    renderSettings();
  });
  $("#reloadCloudBtn").addEventListener("click", async () => {
    if (!currentUser) return;
    await loadStateFromCloud(currentUser);
    renderAll();
  });

  const projectDialog = $("#projectDialog");
  $("#addProjectBtn").addEventListener("click", () => {
    $("#projectTitle").value = "";
    $("#projectStatus").value = "작업";
    $("#projectCategory").value = "";
    $("#projectProgress").value = "0";
    $("#projectDeadline").value = "";
    projectDialog.showModal();
  });
  $("#cancelProjectBtn").addEventListener("click", () => projectDialog.close());
  $("#projectForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("#projectTitle").value.trim();
    if (!title) return;
    state.projects.push({
      id: uid(),
      title,
      status: $("#projectStatus").value,
      category: $("#projectCategory").value.trim(),
      progress: Math.max(0, Math.min(100, Number($("#projectProgress").value || 0))),
      deadline: $("#projectDeadline").value || null,
    });
    save();
    projectDialog.close();
    renderProjects();
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
