import { supabase } from "./supabase.js";
import { setupAuth } from "./auth.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const uid = () => crypto.randomUUID();
const pad = (n) => String(n).padStart(2, "0");
const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '\"': "&quot;" }[c]));

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
    sessions: [],
    timer: { running: false, paused: false, taskId: null, startedAt: null, accumulatedMs: 0 },
    projects: [],
    ui: { sidebarCollapsed: false },
  };
}

function normalizeState(raw) {
  const base = defaultState();
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    ...base,
    ...state,
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    habitTemplates: Array.isArray(state.habitTemplates) ? state.habitTemplates : [],
    habitDays: state.habitDays && typeof state.habitDays === "object" ? state.habitDays : {},
    timeBlocks: Array.isArray(state.timeBlocks) ? state.timeBlocks : [],
    events: Array.isArray(state.events) ? state.events : [],
    sessions: Array.isArray(state.sessions) ? state.sessions : [],
    timer: { ...base.timer, ...(state.timer || {}) },
    projects: Array.isArray(state.projects) ? state.projects : [],
    ui: { ...base.ui, ...(state.ui || {}) },
  };
}

let currentUser = null;
let loadedUserId = null;
let state = defaultState();
let saveChain = Promise.resolve();
let tickHandle = null;
let editingBlockId = null;
let calView = "month";
let calDayMode = "timeline";
let calCursor = new Date();

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
    row.innerHTML = `<button class="check ${task.done ? "checked" : ""}" type="button" aria-label="완료">${task.done ? "✓" : ""}</button><span class="row-title">${esc(task.title)}</span><button class="more" type="button">···</button><div class="menu"><button class="danger" type="button">삭제</button></div>`;

    row.querySelector(".check").addEventListener("click", () => {
      task.done = !task.done;
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

    const more = row.querySelector(".more");
    const menu = row.querySelector(".menu");
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      $$(".menu.open").forEach((openMenu) => openMenu !== menu && openMenu.classList.remove("open"));
      menu.classList.toggle("open");
    });
    menu.querySelector(".danger").addEventListener("click", () => {
      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      state.timeBlocks = state.timeBlocks.filter((block) => block.taskId !== task.id);
      save();
      renderAll();
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
  const events = state.events
    .filter((event) => new Date(event.start) >= now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 5);
  const container = $("#upcomingList");
  if (!events.length) {
    container.innerHTML = '<div class="empty">다가오는 일정이 없어요.</div>';
    return;
  }
  container.innerHTML = events.map((event) => {
    const date = new Date(event.start);
    const when = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
    return `<div class="row"><span class="pill">일정</span><span class="row-title" style="cursor:default">${esc(event.title)}</span><span class="card-meta">${when}</span></div>`;
  }).join("");
}

function todayFocusMs() {
  const dayKey = appDayKey();
  return state.sessions.filter((session) => session.end && appDayKey(new Date(session.end)) === dayKey).reduce((sum, session) => sum + Number(session.durationMs || 0), 0);
}

function renderDashboard() {
  const dayKey = appDayKey();
  const tasks = state.tasks.filter((task) => task.date === dayKey);
  const completedTasks = tasks.filter((task) => task.done).length;
  ensureHabitDay();
  const checks = state.habitDays[dayKey];
  const completedHabits = state.habitTemplates.filter((habit) => checks[habit.id]).length;
  $("#dashTasks").textContent = `${completedTasks} / ${tasks.length}`;
  $("#dashHabits").textContent = `${completedHabits} / ${state.habitTemplates.length}`;
  $("#dashFocus").textContent = fmtDuration(todayFocusMs());
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

function eventsForDate(date) {
  const key = localDateKey(date);
  const events = state.events
    .filter((event) => localDateKey(new Date(event.start)) === key)
    .map((event) => ({ ...event, kind: "event", type: "schedule", startDate: new Date(event.start) }));
  const tasks = state.tasks
    .filter((task) => task.date === key)
    .map((task) => ({ id: task.id, title: task.title, type: "task", kind: "task", startDate: null, done: task.done }));
  const rank = (item) => item.type === "schedule" ? 0 : 1;
  return [...events, ...tasks].sort((a, b) => rank(a) - rank(b) || ((a.startDate?.getTime() || Infinity) - (b.startDate?.getTime() || Infinity)) || a.title.localeCompare(b.title, "ko"));
}

function updateDayModeVisibility() {
  $("#dayModeSeg").classList.toggle("show", calView === "day");
}

function renderDayTimeline(date) {
  const items = eventsForDate(date);
  const untimed = items.filter((item) => !item.startDate);
  const timed = items.filter((item) => item.startDate);
  let html = "";
  if (untimed.length) html += `<div class="untimed-box"><div class="untimed-title">시간 미정 할일</div>${untimed.map((item) => `<div class="cal-event">${esc(item.title)}</div>`).join("")}</div>`;
  html += '<div class="day-timeline" id="dayTimeline">';
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
    element.className = `day-timed-event${item.type === "schedule" ? " schedule" : ""}`;
    element.innerHTML = `<strong>${esc(item.title)}</strong><small>${item.type === "schedule" ? "일정" : "할일"} · ${timeText(item.startDate)}</small>`;
    row.querySelector(".day-time-lane").appendChild(element);
  }
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
      html += `<div class="day-cell ${isToday ? "today" : ""}"><div class="day-num">${day}</div>${items.slice(0, 5).map((item) => `<div class="cal-event ${item.type === "schedule" ? "schedule" : ""}">${item.type === "schedule" ? "• " : ""}${esc(item.title)}</div>`).join("")}</div>`;
    }
    html += "</div>";
    body.innerHTML = html;
    return;
  }

  if (calView === "week") {
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
      html += `<div class="week-col"><div class="week-date">${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}</div>${eventsForDate(date).map((item) => `<div class="cal-event ${item.type === "schedule" ? "schedule" : ""}">${esc(item.title)}</div>`).join("")}</div>`;
    }
    html += "</div>";
    body.innerHTML = html;
    return;
  }

  $("#calTitle").textContent = fmtDate(calCursor);
  const items = eventsForDate(calCursor);
  if (calDayMode === "timeline") renderDayTimeline(calCursor);
  else body.innerHTML = `<div class="day-list">${items.length ? items.map((item) => `<div class="row"><span class="pill">${item.type === "schedule" ? "일정" : "할일"}</span><span class="row-title" style="cursor:default">${esc(item.title)}</span>${item.startDate ? `<span class="card-meta">${timeText(item.startDate)}</span>` : ""}</div>`).join("") : '<div class="empty">이 날의 일정/할일이 없어요.</div>'}</div>`;
}

function currentTimerElapsed() {
  const timer = state.timer;
  if (!timer?.running) return 0;
  return Number(timer.accumulatedMs || 0) + (timer.paused ? 0 : Math.max(0, Date.now() - Number(timer.startedAt || Date.now())));
}

function updateTimerUI() {
  const milliseconds = currentTimerElapsed();
  const seconds = Math.floor(milliseconds / 1000);
  $("#timerClock").textContent = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  const timer = state.timer;
  $("#timerStart").disabled = timer.running && !timer.paused;
  $("#timerPause").disabled = !timer.running;
  $("#timerPause").textContent = timer.paused ? "계속" : "일시정지";
  $("#timerStop").disabled = !timer.running;
  $("#trackingTodayTotal").textContent = `오늘 ${fmtDuration(todayFocusMs())}`;
  $("#dashFocus").textContent = fmtDuration(todayFocusMs());
}

function startTicker() {
  clearInterval(tickHandle);
  tickHandle = setInterval(updateTimerUI, 1000);
}

function renderSessions() {
  const dayKey = appDayKey();
  const today = state.sessions.filter((session) => session.end && appDayKey(new Date(session.end)) === dayKey).sort((a, b) => new Date(b.end) - new Date(a.end));
  const all = [...state.sessions].sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 50);
  const make = (items) => items.length ? items.map((session) => `<div class="history-row"><div><div class="history-name">${esc(session.title)}</div><div class="history-meta">${new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(session.end))}</div></div><div class="history-time">${fmtDuration(session.durationMs)}</div></div>`).join("") : '<div class="empty">아직 기록이 없어요.</div>';
  $("#todaySessions").innerHTML = make(today);
  $("#allSessions").innerHTML = make(all);
  $("#trackingTodayTotal").textContent = `오늘 ${fmtDuration(todayFocusMs())}`;
}

function renderTracking() {
  const select = $("#timerTaskSelect");
  const previous = select.value;
  const activeTasks = state.tasks.filter((task) => !task.done);
  select.innerHTML = '<option value="">할일 선택</option>' + activeTasks.map((task) => `<option value="${task.id}">${esc(task.title)}</option>`).join("");
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
    return `<section class="section-card"><div class="section-head"><span>${status}</span><span class="card-meta">${projects.length}</span></div><div class="project-list">${projects.length ? projects.map((project) => `<div class="project-row" data-project-id="${project.id}"><div><strong>${esc(project.title)}</strong><div class="project-meta">${esc(project.category || "")}</div></div><div><div class="progress"><i style="width:${Math.max(0, Math.min(100, Number(project.progress || 0)))}%"></i></div><div class="project-meta">${Math.max(0, Math.min(100, Number(project.progress || 0)))}%</div></div><span class="pill">${project.deadline ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(`${project.deadline}T12:00:00`)) : "기한 없음"}</span></div>`).join("") : '<div class="empty">항목이 없어요.</div>'}</div></section>`;
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
    else calCursor.setDate(calCursor.getDate() - 1);
    renderCalendar();
  });
  $("#calNext").addEventListener("click", () => {
    if (calView === "month") calCursor.setMonth(calCursor.getMonth() + 1);
    else if (calView === "week") calCursor.setDate(calCursor.getDate() + 7);
    else calCursor.setDate(calCursor.getDate() + 1);
    renderCalendar();
  });

  const eventDialog = $("#eventDialog");
  $("#addEventBtn").addEventListener("click", () => {
    $("#eventTitle").value = "";
    $("#eventDate").value = localDateKey(calCursor);
    eventDialog.showModal();
  });
  $("#cancelEventBtn").addEventListener("click", () => eventDialog.close());
  $("#eventForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("#eventTitle").value.trim();
    const date = $("#eventDate").value;
    const time = $("#eventTime").value || "09:00";
    if (!title || !date) return;
    const start = new Date(`${date}T${time}:00`).toISOString();
    state.events.push({ id: uid(), title, type: "schedule", start });
    save();
    eventDialog.close();
    renderHome();
    renderCalendar();
  });

  $("#timerStart").addEventListener("click", () => {
    const taskId = $("#timerTaskSelect").value;
    if (!taskId) return window.alert("먼저 할일을 골라 주세요.");
    if (state.timer.running && state.timer.paused) {
      state.timer.paused = false;
      state.timer.startedAt = Date.now();
    } else {
      state.timer = { running: true, paused: false, taskId, startedAt: Date.now(), accumulatedMs: 0 };
    }
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
    const timer = state.timer;
    if (!timer.running) return;
    const duration = currentTimerElapsed();
    const task = state.tasks.find((item) => item.id === timer.taskId);
    state.sessions.push({ id: uid(), taskId: timer.taskId, title: task?.title || "할일", start: new Date(Date.now() - duration).toISOString(), end: new Date().toISOString(), durationMs: duration });
    state.timer = { running: false, paused: false, taskId: null, startedAt: null, accumulatedMs: 0 };
    save();
    renderTracking();
    renderDashboard();
  });

  $("#addHabitBtn").addEventListener("click", addHabit);
  $("#newHabitInput").addEventListener("keydown", (event) => { if (event.key === "Enter") addHabit(); });
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
