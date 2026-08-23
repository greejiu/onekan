import { supabase } from "./supabase.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const pad = (n) => String(n).padStart(2, "0");
const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[c]));
const uid = () => crypto.randomUUID();

let currentUser = null;
let cloudState = null;
let featureView = "month";
let featureCursor = new Date();
let movingItem = null;
let calendarObserver = null;
let calendarEnhanceTimer = null;
let injected = false;

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

async function waitForAppSaved(timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = $("#syncStatus")?.textContent || "";
    if (!text || text === "저장됨" || text.includes("실패")) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

async function refreshCloudState() {
  if (!currentUser) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", currentUser.id).maybeSingle();
  if (error) {
    console.error("기능 확장 데이터 읽기 실패", error);
    return null;
  }
  cloudState = data?.data && typeof data.data === "object" ? data.data : {};
  cloudState.tasks = Array.isArray(cloudState.tasks) ? cloudState.tasks : [];
  cloudState.events = Array.isArray(cloudState.events) ? cloudState.events : [];
  cloudState.timeBlocks = Array.isArray(cloudState.timeBlocks) ? cloudState.timeBlocks : [];
  return cloudState;
}

async function mutateCloud(mutator, { reload = true } = {}) {
  if (!currentUser) return;
  await waitForAppSaved();
  const latest = await refreshCloudState();
  if (!latest) return;
  mutator(latest);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: currentUser.id, data: latest }, { onConflict: "user_id" });
  if (error) {
    console.error("기능 확장 데이터 저장 실패", error);
    window.alert("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    return;
  }
  cloudState = latest;
  if (reload) window.location.reload();
}

function ensureMoveDialog() {
  if ($("#featureMoveDialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "featureMoveDialog";
  dialog.className = "app-dialog";
  dialog.innerHTML = `
    <form method="dialog" id="featureMoveForm">
      <h3 id="featureMoveTitle">날짜 옮기기</h3>
      <div class="field"><label>옮길 날짜</label><input id="featureMoveDate" type="date" required /></div>
      <div class="dialog-actions feature-dialog-actions">
        <button class="ghost-btn" id="featureSomedayBtn" type="button">언젠가로</button>
        <span class="feature-dialog-spacer"></span>
        <button class="soft-btn" id="featureMoveCancel" type="button">취소</button>
        <button class="primary-btn" type="submit">옮기기</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);

  $("#featureMoveCancel").addEventListener("click", () => dialog.close());
  $("#featureSomedayBtn").addEventListener("click", async () => {
    if (movingItem?.kind !== "task") return;
    const id = movingItem.id;
    dialog.close();
    await mutateCloud((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (task) task.date = null;
    });
  });
  $("#featureMoveForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!movingItem) return;
    const dateKey = $("#featureMoveDate").value;
    if (!dateKey) return;
    const { kind, id } = movingItem;
    dialog.close();
    await moveItemToDate(kind, id, dateKey);
  });
}

async function openMoveDialog(kind, id) {
  ensureMoveDialog();
  if (!cloudState) await refreshCloudState();
  const dialog = $("#featureMoveDialog");
  movingItem = { kind, id };
  if (kind === "task") {
    const task = cloudState?.tasks?.find((item) => item.id === id);
    if (!task) return;
    $("#featureMoveTitle").textContent = `날짜 옮기기 · ${task.title}`;
    $("#featureMoveDate").value = task.date || appDayKey();
    $("#featureSomedayBtn").classList.remove("hidden");
  } else {
    const item = cloudState?.events?.find((event) => event.id === id);
    if (!item) return;
    $("#featureMoveTitle").textContent = `날짜 옮기기 · ${item.title}`;
    $("#featureMoveDate").value = localDateKey(new Date(item.start));
    $("#featureSomedayBtn").classList.add("hidden");
  }
  dialog.showModal();
}

async function moveItemToDate(kind, id, dateKey) {
  await mutateCloud((state) => {
    if (kind === "task") {
      const task = state.tasks.find((item) => item.id === id);
      if (task) task.date = dateKey || null;
      return;
    }
    const item = state.events.find((event) => event.id === id);
    if (!item || !dateKey) return;
    const date = new Date(item.start);
    const [year, month, day] = dateKey.split("-").map(Number);
    date.setFullYear(year, month - 1, day);
    item.start = date.toISOString();
  });
}

function injectHomeFeatures() {
  if (injected) return;
  const habitList = $("#habitList");
  const upcoming = $("#upcomingList");
  const dashboard = $("#dashTasks")?.closest(".card");
  if (!habitList || !upcoming || !dashboard) return;

  const habitCard = habitList.closest(".card");
  if (!habitCard.querySelector("[data-feature-home-habit]")) {
    const footer = document.createElement("div");
    footer.className = "card-footer";
    footer.dataset.featureHomeHabit = "true";
    footer.innerHTML = `<div class="add-row"><input id="featureHabitInput" placeholder="습관 바로 추가" /><button class="soft-btn" id="featureAddHabit" type="button">추가</button></div>`;
    habitCard.appendChild(footer);
    const add = () => {
      const value = $("#featureHabitInput").value.trim();
      if (!value) return;
      const settingsInput = $("#newHabitInput");
      if (!settingsInput) return;
      settingsInput.value = value;
      $("#addHabitBtn")?.click();
      $("#featureHabitInput").value = "";
    };
    $("#featureAddHabit").addEventListener("click", add);
    $("#featureHabitInput").addEventListener("keydown", (event) => { if (event.key === "Enter") add(); });
  }

  if (!$("#featureSomedayCard")) {
    const card = document.createElement("article");
    card.id = "featureSomedayCard";
    card.className = "card";
    card.innerHTML = `
      <div class="card-header"><div class="card-title">언젠가 할일</div><div class="card-meta">오늘 목록으로 끌어오기</div></div>
      <div class="card-body"><div class="list feature-task-drop" id="featureSomedayList"></div></div>
      <div class="card-footer"><div class="add-row"><input id="featureSomedayInput" placeholder="언젠가 할일 추가" /><button class="soft-btn" id="featureAddSomeday" type="button">추가</button></div></div>`;
    habitCard.after(card);
    dashboard.classList.remove("span-2");
    $("#featureAddSomeday").addEventListener("click", addSomedayTask);
    $("#featureSomedayInput").addEventListener("keydown", (event) => { if (event.key === "Enter") addSomedayTask(); });
    wireHomeDropTargets();
  }
  injected = true;
}

async function addSomedayTask() {
  const input = $("#featureSomedayInput");
  const title = input?.value.trim();
  if (!title) return;
  input.value = "";
  await mutateCloud((state) => {
    state.tasks.push({ id: uid(), title, done: false, date: null });
  });
}

function renderSomedayTasks() {
  const list = $("#featureSomedayList");
  if (!list || !cloudState) return;
  const tasks = [...cloudState.tasks.filter((task) => !task.date)].sort((a, b) => Number(!!a.done) - Number(!!b.done));
  if (!tasks.length) {
    list.innerHTML = '<div class="empty">언젠가 할일이 없어요.</div>';
    return;
  }
  list.innerHTML = "";
  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = `row${task.done ? " done" : ""}`;
    row.draggable = true;
    row.dataset.taskId = task.id;
    row.innerHTML = `<button class="check ${task.done ? "checked" : ""}" type="button">${task.done ? "✓" : ""}</button><span class="row-title" style="cursor:default">${esc(task.title)}</span><button class="more" type="button">···</button><div class="menu"><button data-action="today" type="button">오늘로 옮기기</button><button data-action="date" type="button">날짜 선택</button><button class="danger" data-action="delete" type="button">삭제</button></div>`;
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/task-id", task.id);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.querySelector(".check").addEventListener("click", async () => {
      await mutateCloud((state) => {
        const target = state.tasks.find((item) => item.id === task.id);
        if (target) target.done = !target.done;
      });
    });
    const menu = row.querySelector(".menu");
    row.querySelector(".more").addEventListener("click", (event) => {
      event.stopPropagation();
      $$(".menu.open").forEach((other) => other !== menu && other.classList.remove("open"));
      menu.classList.toggle("open");
    });
    menu.querySelector('[data-action="today"]').addEventListener("click", () => moveItemToDate("task", task.id, appDayKey()));
    menu.querySelector('[data-action="date"]').addEventListener("click", () => openMoveDialog("task", task.id));
    menu.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      await mutateCloud((state) => {
        state.tasks = state.tasks.filter((item) => item.id !== task.id);
        state.timeBlocks = state.timeBlocks.filter((block) => block.taskId !== task.id);
      });
    });
    list.appendChild(row);
  }
}

function wireHomeDropTargets() {
  const todayList = $("#taskList");
  const somedayList = $("#featureSomedayList");
  const wire = (element, targetDate) => {
    if (!element || element.dataset.featureDropWired) return;
    element.dataset.featureDropWired = "true";
    element.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer.types).includes("text/task-id")) return;
      event.preventDefault();
      element.classList.add("feature-drop-active");
    });
    element.addEventListener("dragleave", () => element.classList.remove("feature-drop-active"));
    element.addEventListener("drop", async (event) => {
      const id = event.dataTransfer.getData("text/task-id");
      if (!id) return;
      event.preventDefault();
      element.classList.remove("feature-drop-active");
      await moveItemToDate("task", id, targetDate);
    });
  };
  wire(todayList, appDayKey());
  wire(somedayList, null);

  if ($("#timeGrid") && !$("#timeGrid").dataset.featureSomedayTimeWired) {
    $("#timeGrid").dataset.featureSomedayTimeWired = "true";
    $("#timeGrid").addEventListener("drop", async (event) => {
      const id = event.dataTransfer.getData("text/task-id");
      if (!id || !cloudState?.tasks?.some((task) => task.id === id && !task.date)) return;
      setTimeout(async () => {
        await waitForAppSaved();
        await mutateCloud((state) => {
          const task = state.tasks.find((item) => item.id === id);
          if (task) task.date = appDayKey();
        });
      }, 80);
    });
  }
}

function itemsForDate(state, dateKey) {
  const events = state.events
    .filter((item) => localDateKey(new Date(item.start)) === dateKey)
    .map((item) => ({ kind: "event", id: item.id, title: item.title, startDate: new Date(item.start) }));
  const tasks = state.tasks
    .filter((item) => item.date === dateKey)
    .map((item) => ({ kind: "task", id: item.id, title: item.title, startDate: null }));
  return [...events, ...tasks].sort((a, b) => {
    const rankA = a.kind === "event" ? 0 : 1;
    const rankB = b.kind === "event" ? 0 : 1;
    return rankA - rankB || ((a.startDate?.getTime() || Infinity) - (b.startDate?.getTime() || Infinity)) || a.title.localeCompare(b.title, "ko");
  });
}

function attachCalendarEntry(element, item) {
  if (!element || !item) return;
  element.draggable = true;
  element.dataset.featureKind = item.kind;
  element.dataset.featureId = item.id;
  element.title = "드래그해서 날짜 이동 · 클릭하면 날짜 선택";
  if (element.dataset.featureEntryWired) return;
  element.dataset.featureEntryWired = "true";
  element.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(item.kind === "task" ? "text/task-id" : "text/event-id", item.id);
    element.classList.add("feature-dragging");
  });
  element.addEventListener("dragend", () => element.classList.remove("feature-dragging"));
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    openMoveDialog(item.kind, item.id);
  });
}

function attachCalendarDropTarget(element, dateKey) {
  if (!element) return;
  element.dataset.featureCalendarDate = dateKey;
  if (element.dataset.featureCalendarDropWired) return;
  element.dataset.featureCalendarDropWired = "true";
  element.addEventListener("dragover", (event) => {
    const types = Array.from(event.dataTransfer.types);
    if (!types.includes("text/task-id") && !types.includes("text/event-id")) return;
    event.preventDefault();
    element.classList.add("feature-calendar-drop-active");
  });
  element.addEventListener("dragleave", () => element.classList.remove("feature-calendar-drop-active"));
  element.addEventListener("drop", async (event) => {
    const taskId = event.dataTransfer.getData("text/task-id");
    const eventId = event.dataTransfer.getData("text/event-id");
    if (!taskId && !eventId) return;
    event.preventDefault();
    element.classList.remove("feature-calendar-drop-active");
    if (taskId) await moveItemToDate("task", taskId, dateKey);
    else await moveItemToDate("event", eventId, dateKey);
  });
}

async function enhanceCalendar() {
  if (!currentUser || !$("#calendarBody")) return;
  await waitForAppSaved(1000);
  const state = await refreshCloudState();
  if (!state) return;

  if (featureView === "month") {
    const year = featureCursor.getFullYear();
    const month = featureCursor.getMonth();
    $$("#calendarBody .day-cell").forEach((cell) => {
      const dayText = cell.querySelector(".day-num")?.textContent;
      if (!dayText) return;
      const dateKey = localDateKey(new Date(year, month, Number(dayText)));
      const items = itemsForDate(state, dateKey).slice(0, 5);
      attachCalendarDropTarget(cell, dateKey);
      [...cell.querySelectorAll(".cal-event")].forEach((element, index) => attachCalendarEntry(element, items[index]));
    });
    return;
  }

  if (featureView === "week") {
    const start = new Date(featureCursor);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    $$("#calendarBody .week-col").forEach((column, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      const dateKey = localDateKey(date);
      const items = itemsForDate(state, dateKey);
      attachCalendarDropTarget(column, dateKey);
      [...column.querySelectorAll(".cal-event")].forEach((element, itemIndex) => attachCalendarEntry(element, items[itemIndex]));
    });
    return;
  }

  const dateKey = localDateKey(featureCursor);
  const items = itemsForDate(state, dateKey);
  const dayList = $("#calendarBody .day-list");
  if (dayList) {
    attachCalendarDropTarget(dayList, dateKey);
    [...dayList.querySelectorAll(".row")].forEach((element, index) => attachCalendarEntry(element, items[index]));
    return;
  }

  const untimedTasks = items.filter((item) => item.kind === "task");
  const timedEvents = items.filter((item) => item.kind === "event");
  const untimedBox = $("#calendarBody .untimed-box");
  const timeline = $("#calendarBody .day-timeline");
  attachCalendarDropTarget(untimedBox, dateKey);
  attachCalendarDropTarget(timeline, dateKey);
  [...(untimedBox?.querySelectorAll(".cal-event") || [])].forEach((element, index) => attachCalendarEntry(element, untimedTasks[index]));
  [...(timeline?.querySelectorAll(".day-timed-event") || [])].forEach((element, index) => attachCalendarEntry(element, timedEvents[index]));
}

function scheduleCalendarEnhance() {
  clearTimeout(calendarEnhanceTimer);
  calendarEnhanceTimer = setTimeout(() => enhanceCalendar(), 60);
}

function wireCalendarNavigation() {
  $$("#calendarViewSeg button").forEach((button) => {
    if (button.dataset.featureViewWired) return;
    button.dataset.featureViewWired = "true";
    button.addEventListener("click", () => {
      featureView = button.dataset.view;
      scheduleCalendarEnhance();
    });
  });
  const prev = $("#calPrev");
  const next = $("#calNext");
  if (prev && !prev.dataset.featureNavWired) {
    prev.dataset.featureNavWired = "true";
    prev.addEventListener("click", () => {
      if (featureView === "month") featureCursor.setMonth(featureCursor.getMonth() - 1);
      else if (featureView === "week") featureCursor.setDate(featureCursor.getDate() - 7);
      else featureCursor.setDate(featureCursor.getDate() - 1);
      scheduleCalendarEnhance();
    });
  }
  if (next && !next.dataset.featureNavWired) {
    next.dataset.featureNavWired = "true";
    next.addEventListener("click", () => {
      if (featureView === "month") featureCursor.setMonth(featureCursor.getMonth() + 1);
      else if (featureView === "week") featureCursor.setDate(featureCursor.getDate() + 7);
      else featureCursor.setDate(featureCursor.getDate() + 1);
      scheduleCalendarEnhance();
    });
  }

  if (!calendarObserver && $("#calendarBody")) {
    calendarObserver = new MutationObserver(scheduleCalendarEnhance);
    calendarObserver.observe($("#calendarBody"), { childList: true, subtree: true });
  }
}

async function initializeFeatures(user) {
  currentUser = user;
  injectHomeFeatures();
  ensureMoveDialog();
  wireCalendarNavigation();
  await refreshCloudState();
  renderSomedayTasks();
  wireHomeDropTargets();
  scheduleCalendarEnhance();
}

function resetFeatures() {
  currentUser = null;
  cloudState = null;
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".more")) $$("#featureSomedayCard .menu.open").forEach((menu) => menu.classList.remove("open"));
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(() => initializeFeatures(session.user), 0);
  else resetFeatures();
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) await initializeFeatures(session.user);
