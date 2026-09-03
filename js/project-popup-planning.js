import { supabase } from "./supabase.js";
import {
  completeRepeatingTask,
  normalizeCompletionRepeats,
  undoRepeatingTaskCompletion,
} from "./repeat-after-completion.js?v=1";

const PROJECT_BOOK_SELECTOR = ".onekan-project-book[data-project-edit][data-context-kind='project']";
const LAYER_SELECTOR = "#onekanProjectLinkedLayer";
const BODY_SELECTOR = "[data-project-linked-body]";
const ROOT_MARKER = "projectPopupPlanningRoot";

let user = null;
let appState = null;
let activeProjectId = null;
let renderTimer = 0;
let rendering = false;
let mutationObserver = null;

const pad = (value) => String(value).padStart(2, "0");
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
}[char]));

function todayKey() {
  const date = new Date();
  date.setHours(date.getHours() - 3);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeState(value) {
  const state = value && typeof value === "object" ? value : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.habitTemplates = Array.isArray(state.habitTemplates) ? state.habitTemplates : [];
  state.habitDays = state.habitDays && typeof state.habitDays === "object" ? state.habitDays : {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length
    ? state.eventGroups
    : [{ id: "default", name: "기본", color: "#8fa9c4" }];
  state.timeBlocks = Array.isArray(state.timeBlocks) ? state.timeBlocks : [];
  state.taskOverrides = state.taskOverrides && typeof state.taskOverrides === "object" ? state.taskOverrides : {};
  normalizeCompletionRepeats(state);
  return state;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) {
    appState = normalizeState({});
    return null;
  }
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  appState = normalizeState(data?.data);
  return appState;
}

async function writeState(mutator, source) {
  const current = await readState();
  if (!current || !user) return false;
  mutator(current);
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: user.id, data: current }, { onConflict: "user_id" });
  if (error) throw error;
  appState = current;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source } }));
  document.querySelector("#reloadCloudBtn")?.click();
  scheduleRender(20);
  return true;
}

function projectById(projectId) {
  return appState?.projects?.find((project) => String(project?.id || "") === String(projectId || "")) || null;
}

function taskLabel(task, fallback = "이름 없는 할일") {
  return String(task?.title || task?.text || task?.name || fallback);
}

function completionDate(task) {
  if (task?.completedDate) return task.completedDate;
  if (task?.completedAt) {
    const date = new Date(task.completedAt);
    if (!Number.isNaN(date.getTime())) {
      date.setHours(date.getHours() - 3);
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
  }
  return task?.done ? task?.date || "" : "";
}

function repeatLabel(item) {
  const recurrence = item?.recurrence || item?.repeatRule || null;
  if (!recurrence?.frequency || recurrence.frequency === "none") return "";
  const interval = Math.max(1, Number(recurrence.interval || 1));
  if (recurrence.frequency === "daily") return interval === 1 ? "매일" : `${interval}일마다`;
  if (recurrence.frequency === "weekly") return interval === 1 ? "매주" : `${interval}주마다`;
  if (recurrence.frequency === "monthly") return interval === 1 ? "매월" : `${interval}개월마다`;
  return "반복";
}

function taskDateLabel(task) {
  const value = task?.date || task?.completedDate || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return task?.done ? "완료" : "날짜 없음";
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일${task?.done ? " · 완료" : ""}`;
}

function habitSeriesId(item) {
  return String(item?.repeatSeriesId || item?.id || "");
}

function currentHabitFromRows(rows) {
  return [...rows].sort((a, b) => {
    if (Boolean(a?.done) !== Boolean(b?.done)) return Number(Boolean(a?.done)) - Number(Boolean(b?.done));
    return String(a?.date || "9999-99-99").localeCompare(String(b?.date || "9999-99-99"));
  })[0] || null;
}

function habitTodayDone(entry) {
  const today = todayKey();
  if (entry.kind === "legacy") {
    return Boolean(appState?.habitDays?.[today]?.[entry.item.id]);
  }
  return entry.rows.some((row) => Boolean(row?.done) && completionDate(row) === today);
}

function habitTodayText(entry) {
  return habitTodayDone(entry) ? "오늘 완료" : "오늘 미완료";
}

function linkedItems(projectId) {
  const plainTasks = appState.tasks
    .filter((item) => item?.projectId === projectId && !item?.isHabit)
    .sort((a, b) =>
      Number(Boolean(a?.done)) - Number(Boolean(b?.done))
      || String(a?.date || "9999-99-99").localeCompare(String(b?.date || "9999-99-99"))
      || taskLabel(a, "").localeCompare(taskLabel(b, ""), "ko")
    );

  const habitRows = appState.tasks.filter((item) => item?.projectId === projectId && item?.isHabit);
  const groups = new Map();
  for (const item of habitRows) {
    const seriesId = habitSeriesId(item);
    if (!groups.has(seriesId)) groups.set(seriesId, []);
    groups.get(seriesId).push(item);
  }

  const habits = [...groups.entries()].map(([seriesId, rows]) => ({
    kind: "task",
    seriesId,
    rows,
    item: currentHabitFromRows(rows),
  }));

  const taskIds = new Set(habitRows.map((item) => String(item?.id || "")));
  const taskSeries = new Set(habits.map((entry) => entry.seriesId));
  for (const item of appState.habitTemplates.filter((habit) => habit?.projectId === projectId)) {
    const id = String(item?.id || "");
    if (taskIds.has(id) || taskSeries.has(id)) continue;
    habits.push({ kind: "legacy", seriesId: id, rows: [], item });
  }

  habits.sort((a, b) => taskLabel(a.item, "").localeCompare(taskLabel(b.item, ""), "ko"));
  return { tasks: plainTasks, habits };
}

function taskCheckMarkup(task) {
  const done = Boolean(task?.done);
  return `<button class="project-popup-check${done ? " checked" : ""}" type="button" data-project-popup-toggle-task="${esc(task.id)}" aria-pressed="${done}" aria-label="${done ? "완료 취소" : "완료"}">${done ? "✓" : ""}</button>`;
}

function habitCheckMarkup(entry) {
  const done = habitTodayDone(entry);
  return `<button class="project-popup-check${done ? " checked" : ""}" type="button" data-project-popup-toggle-habit="${esc(entry.seriesId)}" aria-pressed="${done}" aria-label="${done ? "오늘 완료 취소" : "오늘 완료"}">${done ? "✓" : ""}</button>`;
}

function taskMarkup(task) {
  const done = Boolean(task?.done);
  return `<div class="onekan-project-linked-item project-popup-item${done ? " is-done" : ""}" data-project-popup-task="${esc(task.id)}">
    ${taskCheckMarkup(task)}
    <span class="onekan-project-linked-copy"><strong>${esc(taskLabel(task))}</strong><small>${esc(taskDateLabel(task))}</small></span>
  </div>`;
}

function habitMarkup(entry) {
  const done = habitTodayDone(entry);
  const repeat = repeatLabel(entry.item) || "습관";
  return `<div class="onekan-project-linked-item project-popup-item is-habit${done ? " is-done-today" : ""}" data-project-popup-habit="${esc(entry.seriesId)}">
    ${habitCheckMarkup(entry)}
    <span class="onekan-project-linked-copy"><strong><span class="project-popup-repeat" aria-hidden="true">↻</span>${esc(taskLabel(entry.item, "이름 없는 습관"))}</strong><small>${esc(`${repeat} · ${habitTodayText(entry)}`)}</small></span>
  </div>`;
}

function addFormMarkup(kind) {
  if (kind === "task") {
    return `<form class="project-popup-add-form" data-project-popup-add-form="task" hidden>
      <input type="text" maxlength="120" autocomplete="off" placeholder="할일 이름" aria-label="할일 이름" required />
      <button type="submit">추가</button>
    </form>`;
  }
  return `<form class="project-popup-add-form project-popup-habit-form" data-project-popup-add-form="habit" hidden>
    <input type="text" maxlength="120" autocomplete="off" placeholder="습관 이름" aria-label="습관 이름" required />
    <select aria-label="습관 반복 주기">
      <option value="daily">매일</option>
      <option value="weekly">매주</option>
      <option value="monthly">매월</option>
    </select>
    <button type="submit">추가</button>
  </form>`;
}

function sectionMarkup(kind, rows) {
  const isHabit = kind === "habit";
  const title = isHabit ? "습관" : "할일";
  const list = rows.length
    ? rows.map(isHabit ? habitMarkup : taskMarkup).join("")
    : `<div class="project-popup-section-empty">${isHabit ? "연결된 습관이 없어요." : "연결된 할일이 없어요."}</div>`;
  return `<section class="onekan-project-linked-section project-popup-section">
    <div class="onekan-project-linked-section-head project-popup-section-head">
      <strong>${title}</strong><span>${rows.length}</span>
      <button class="project-popup-add-trigger" type="button" data-project-popup-add="${kind}" aria-expanded="false">＋ ${title}</button>
    </div>
    ${addFormMarkup(kind)}
    <div class="onekan-project-linked-list">${list}</div>
  </section>`;
}

function renderProjectPopup() {
  const layer = document.querySelector(LAYER_SELECTOR);
  const body = layer?.querySelector(BODY_SELECTOR);
  if (!layer || layer.hidden || !body || !activeProjectId || !appState || rendering) return;

  const project = projectById(activeProjectId);
  if (!project) return;
  const { tasks, habits } = linkedItems(activeProjectId);

  rendering = true;
  try {
    body.dataset[ROOT_MARKER] = "1";
    body.innerHTML = `${sectionMarkup("task", tasks)}${sectionMarkup("habit", habits)}
      <p class="project-popup-footnote">여기서 추가하면 이 프로젝트에 자동으로 연결돼요. 날짜·시간·세부 반복 설정은 기존 할일·습관 화면에서 바꿀 수 있어요.</p>`;
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 0) {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(async () => {
    const layer = document.querySelector(LAYER_SELECTOR);
    if (!layer || layer.hidden) return;
    activeProjectId ||= document.querySelector(`${PROJECT_BOOK_SELECTOR}[aria-expanded="true"]`)?.dataset?.projectEdit || null;
    if (!activeProjectId) return;
    try {
      await readState();
      renderProjectPopup();
    } catch (error) {
      console.warn("프로젝트 연결 항목 관리 화면을 불러오지 못했습니다.", error);
    }
  }, delay);
}

async function addTask(projectId, title) {
  await writeState((state) => {
    const project = state.projects.find((item) => item?.id === projectId);
    if (!project) return;
    state.tasks.push({
      id: uid(),
      title,
      date: null,
      done: false,
      projectId,
      groupId: project.groupId || state.eventGroups?.[0]?.id || "default",
      createdAt: new Date().toISOString(),
    });
  }, "project-popup-add-task");
}

async function addHabit(projectId, title, frequency) {
  const today = todayKey();
  const date = new Date(`${today}T12:00:00`);
  await writeState((state) => {
    const project = state.projects.find((item) => item?.id === projectId);
    if (!project) return;
    const recurrence = { frequency, interval: 1, completionBased: true };
    if (frequency === "weekly") recurrence.weekdays = [date.getDay()];
    if (frequency === "monthly") recurrence.dayOfMonth = date.getDate();
    const id = uid();
    state.tasks.push({
      id,
      repeatSeriesId: id,
      title,
      date: today,
      done: false,
      isHabit: true,
      projectId,
      groupId: project.groupId || state.eventGroups?.[0]?.id || "default",
      recurrence,
      recurrenceDone: {},
      createdAt: new Date().toISOString(),
    });
  }, "project-popup-add-habit");
}

function clearSimpleCompletion(task) {
  task.done = false;
  task.completedAt = null;
  delete task.completedDate;
}

function setSimpleCompletion(task) {
  const now = new Date();
  task.done = true;
  task.completedAt = now.toISOString();
  task.completedDate = todayKey();
}

async function toggleTask(taskId) {
  await writeState((state) => {
    const task = state.tasks.find((item) => item?.id === taskId);
    if (!task) return;
    if (task.done) {
      if (!undoRepeatingTaskCompletion(state, task)) clearSimpleCompletion(task);
      return;
    }
    if (!completeRepeatingTask(state, task, new Date())) setSimpleCompletion(task);
  }, "project-popup-toggle-task");
}

function completedHabitToday(rows, today) {
  return rows.find((row) => Boolean(row?.done) && completionDate(row) === today) || null;
}

async function toggleHabit(seriesId) {
  const today = todayKey();
  await writeState((state) => {
    const taskRows = state.tasks.filter((item) => item?.isHabit && habitSeriesId(item) === seriesId);
    if (taskRows.length) {
      const completed = completedHabitToday(taskRows, today);
      if (completed) {
        if (!undoRepeatingTaskCompletion(state, completed)) clearSimpleCompletion(completed);
        return;
      }
      const current = currentHabitFromRows(taskRows);
      if (!current) return;
      if (!completeRepeatingTask(state, current, new Date())) setSimpleCompletion(current);
      return;
    }

    const legacy = state.habitTemplates.find((item) => String(item?.id || "") === seriesId);
    if (!legacy) return;
    state.habitDays[today] = state.habitDays[today] && typeof state.habitDays[today] === "object" ? state.habitDays[today] : {};
    state.habitDays[today][legacy.id] = !Boolean(state.habitDays[today][legacy.id]);
  }, "project-popup-toggle-habit");
}

function closeAddForms(except = null) {
  document.querySelectorAll("[data-project-popup-add-form]").forEach((form) => {
    if (form === except) return;
    form.hidden = true;
  });
  document.querySelectorAll("[data-project-popup-add]").forEach((button) => {
    const form = button.closest("section")?.querySelector("[data-project-popup-add-form]");
    if (form !== except) button.setAttribute("aria-expanded", "false");
  });
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const book = event.target.closest?.(PROJECT_BOOK_SELECTOR);
    if (book) {
      activeProjectId = String(book.dataset.projectEdit || "");
      scheduleRender(80);
      return;
    }

    const trigger = event.target.closest?.("[data-project-popup-add]");
    if (trigger) {
      event.preventDefault();
      event.stopPropagation();
      const section = trigger.closest("section");
      const form = section?.querySelector(`[data-project-popup-add-form="${trigger.dataset.projectPopupAdd}"]`);
      if (!form) return;
      const willOpen = form.hidden;
      closeAddForms(willOpen ? form : null);
      form.hidden = !willOpen;
      trigger.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) requestAnimationFrame(() => form.querySelector("input")?.focus());
      return;
    }

    const taskToggle = event.target.closest?.("[data-project-popup-toggle-task]");
    if (taskToggle) {
      event.preventDefault();
      event.stopPropagation();
      taskToggle.disabled = true;
      toggleTask(taskToggle.dataset.projectPopupToggleTask).catch((error) => {
        console.error("프로젝트 팝업 할일 완료 처리 실패", error);
      }).finally(() => { taskToggle.disabled = false; });
      return;
    }

    const habitToggle = event.target.closest?.("[data-project-popup-toggle-habit]");
    if (habitToggle) {
      event.preventDefault();
      event.stopPropagation();
      habitToggle.disabled = true;
      toggleHabit(habitToggle.dataset.projectPopupToggleHabit).catch((error) => {
        console.error("프로젝트 팝업 습관 완료 처리 실패", error);
      }).finally(() => { habitToggle.disabled = false; });
    }
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target.closest?.("[data-project-popup-add-form]");
    if (!form || !activeProjectId) return;
    event.preventDefault();
    const input = form.querySelector("input");
    const title = input?.value.trim() || "";
    if (!title) return input?.focus();
    const kind = form.dataset.projectPopupAddForm;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    const action = kind === "habit"
      ? addHabit(activeProjectId, title, form.querySelector("select")?.value || "daily")
      : addTask(activeProjectId, title);
    action.then(() => {
      form.reset();
      form.hidden = true;
      form.closest("section")?.querySelector("[data-project-popup-add]")?.setAttribute("aria-expanded", "false");
    }).catch((error) => {
      console.error("프로젝트 팝업 항목 추가 실패", error);
    }).finally(() => {
      if (submit) submit.disabled = false;
    });
  }, true);

  document.addEventListener("onekan:state-changed", (event) => {
    if (String(event.detail?.source || "").startsWith("project-popup-")) return;
    if (!document.querySelector(LAYER_SELECTOR)?.hidden) scheduleRender(90);
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-project-linked-close]")) activeProjectId = null;
  }, true);
}

function installStylesheet() {
  if (document.querySelector('link[data-project-popup-planning-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/project-popup-planning.css?v=1";
  link.dataset.projectPopupPlanningStyle = "1";
  document.head.appendChild(link);
}

function observePopup() {
  mutationObserver?.disconnect();
  mutationObserver = new MutationObserver((mutations) => {
    if (rendering) return;
    const layer = document.querySelector(LAYER_SELECTOR);
    if (!layer || layer.hidden) return;
    const body = layer.querySelector(BODY_SELECTOR);
    if (!body) return;
    const needsEnhancement = body.dataset[ROOT_MARKER] !== "1"
      || mutations.some((mutation) => mutation.target === body && mutation.type === "childList");
    if (needsEnhancement) scheduleRender(20);
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}

function init() {
  installStylesheet();
  bindEvents();
  observePopup();
  supabase.auth.onAuthStateChange(() => {
    activeProjectId = null;
    readState().catch(() => {});
  });
  readState().catch((error) => console.warn("프로젝트 팝업 상태를 준비하지 못했습니다.", error));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
