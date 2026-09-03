import { supabase } from "./supabase.js";
import {
  completeRepeatingTask,
  normalizeCompletionRepeats,
  undoRepeatingTaskCompletion,
} from "./repeat-after-completion.js?v=1";

const BOOK = ".onekan-project-book[data-project-edit][data-context-kind='project']";
const LAYER = "#onekanProjectLinkedLayer";
const BODY = "[data-project-linked-body]";
const WRAPPER = "[data-project-popup-planning-root]";
const pad = (value) => String(value).padStart(2, "0");
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[char]));

let user = null;
let state = null;
let activeProjectId = null;
let renderTimer = 0;
let rendering = false;

function todayKey() {
  const date = new Date();
  date.setHours(date.getHours() - 3);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalize(value) {
  const next = value && typeof value === "object" ? value : {};
  next.tasks = Array.isArray(next.tasks) ? next.tasks : [];
  next.habitTemplates = Array.isArray(next.habitTemplates) ? next.habitTemplates : [];
  next.habitDays = next.habitDays && typeof next.habitDays === "object" ? next.habitDays : {};
  next.projects = Array.isArray(next.projects) ? next.projects : [];
  next.eventGroups = Array.isArray(next.eventGroups) && next.eventGroups.length
    ? next.eventGroups
    : [{ id: "default", name: "기본", color: "#8fa9c4" }];
  next.timeBlocks = Array.isArray(next.timeBlocks) ? next.timeBlocks : [];
  next.taskOverrides = next.taskOverrides && typeof next.taskOverrides === "object" ? next.taskOverrides : {};
  normalizeCompletionRepeats(next);
  return next;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return state = normalize({});
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = normalize(data?.data);
  return state;
}

async function writeState(mutator, source) {
  const current = await readState();
  if (!user) return false;
  mutator(current);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: current }, { onConflict: "user_id" });
  if (error) throw error;
  state = current;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source } }));
  document.querySelector("#reloadCloudBtn")?.click();
  scheduleRender(20);
  return true;
}

function label(item, fallback = "이름 없는 할일") {
  return String(item?.title || item?.text || item?.name || fallback);
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

function taskDateLabel(task) {
  const value = task?.date || task?.completedDate || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return task?.done ? "완료" : "날짜 없음";
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일${task?.done ? " · 완료" : ""}`;
}

function repeatLabel(item) {
  const rule = item?.recurrence || item?.repeatRule;
  if (!rule?.frequency || rule.frequency === "none") return "습관";
  const interval = Math.max(1, Number(rule.interval || 1));
  if (rule.frequency === "daily") return interval === 1 ? "매일" : `${interval}일마다`;
  if (rule.frequency === "weekly") return interval === 1 ? "매주" : `${interval}주마다`;
  if (rule.frequency === "monthly") return interval === 1 ? "매월" : `${interval}개월마다`;
  return "습관";
}

function seriesId(item) {
  return String(item?.repeatSeriesId || item?.id || "");
}

function currentHabit(rows) {
  return [...rows].sort((a, b) =>
    Number(Boolean(a?.done)) - Number(Boolean(b?.done))
    || String(a?.date || "9999-99-99").localeCompare(String(b?.date || "9999-99-99"))
  )[0] || null;
}

function linkedItems(projectId) {
  const tasks = state.tasks
    .filter((item) => item?.projectId === projectId && !item?.isHabit)
    .sort((a, b) =>
      Number(Boolean(a?.done)) - Number(Boolean(b?.done))
      || String(a?.date || "9999-99-99").localeCompare(String(b?.date || "9999-99-99"))
      || label(a, "").localeCompare(label(b, ""), "ko")
    );

  const rows = state.tasks.filter((item) => item?.projectId === projectId && item?.isHabit);
  const grouped = new Map();
  rows.forEach((item) => {
    const id = seriesId(item);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(item);
  });

  const habits = [...grouped.entries()].map(([id, items]) => ({ kind: "task", id, rows: items, item: currentHabit(items) }));
  const taskIds = new Set(rows.map((item) => String(item?.id || "")));
  const taskSeries = new Set(habits.map((entry) => entry.id));
  state.habitTemplates
    .filter((item) => item?.projectId === projectId)
    .forEach((item) => {
      const id = String(item?.id || "");
      if (!taskIds.has(id) && !taskSeries.has(id)) habits.push({ kind: "legacy", id, rows: [], item });
    });
  habits.sort((a, b) => label(a.item, "").localeCompare(label(b.item, ""), "ko"));
  return { tasks, habits };
}

function habitDoneToday(entry) {
  const today = todayKey();
  if (entry.kind === "legacy") return Boolean(state.habitDays?.[today]?.[entry.item.id]);
  return entry.rows.some((row) => Boolean(row?.done) && completionDate(row) === today);
}

function checkButton(kind, id, done) {
  const text = kind === "habit" ? (done ? "오늘 완료 취소" : "오늘 완료") : (done ? "완료 취소" : "완료");
  return `<button class="project-popup-check${done ? " checked" : ""}" type="button" data-project-popup-toggle-${kind}="${esc(id)}" aria-pressed="${done}" aria-label="${text}">${done ? "✓" : ""}</button>`;
}

function taskMarkup(task) {
  const done = Boolean(task?.done);
  return `<div class="onekan-project-linked-item project-popup-item${done ? " is-done" : ""}">
    ${checkButton("task", task.id, done)}
    <span class="onekan-project-linked-copy"><strong>${esc(label(task))}</strong><small>${esc(taskDateLabel(task))}</small></span>
  </div>`;
}

function habitMarkup(entry) {
  const done = habitDoneToday(entry);
  return `<div class="onekan-project-linked-item project-popup-item is-habit${done ? " is-done-today" : ""}">
    ${checkButton("habit", entry.id, done)}
    <span class="onekan-project-linked-copy"><strong><span class="project-popup-repeat" aria-hidden="true">↻</span>${esc(label(entry.item, "이름 없는 습관"))}</strong><small>${esc(`${repeatLabel(entry.item)} · ${done ? "오늘 완료" : "오늘 미완료"}`)}</small></span>
  </div>`;
}

function addForm(kind) {
  if (kind === "task") return `<form class="project-popup-add-form" data-project-popup-add-form="task" hidden>
    <input type="text" maxlength="120" autocomplete="off" placeholder="할일 이름" aria-label="할일 이름" required />
    <button type="submit">추가</button>
  </form>`;
  return `<form class="project-popup-add-form project-popup-habit-form" data-project-popup-add-form="habit" hidden>
    <input type="text" maxlength="120" autocomplete="off" placeholder="습관 이름" aria-label="습관 이름" required />
    <select aria-label="습관 반복 주기"><option value="daily">매일</option><option value="weekly">매주</option><option value="monthly">매월</option></select>
    <button type="submit">추가</button>
  </form>`;
}

function section(kind, rows) {
  const habit = kind === "habit";
  const name = habit ? "습관" : "할일";
  const list = rows.length
    ? rows.map(habit ? habitMarkup : taskMarkup).join("")
    : `<div class="project-popup-section-empty">연결된 ${name}이 없어요.</div>`;
  return `<section class="onekan-project-linked-section project-popup-section">
    <div class="onekan-project-linked-section-head project-popup-section-head">
      <strong>${name}</strong><span>${rows.length}</span>
      <button class="project-popup-add-trigger" type="button" data-project-popup-add="${kind}" aria-expanded="false">＋ ${name}</button>
    </div>
    ${addForm(kind)}
    <div class="onekan-project-linked-list">${list}</div>
  </section>`;
}

function render() {
  const layer = document.querySelector(LAYER);
  const body = layer?.querySelector(BODY);
  if (!layer || layer.hidden || !body || !activeProjectId || !state || rendering) return;
  if (!state.projects.some((project) => String(project?.id || "") === activeProjectId)) return;
  const { tasks, habits } = linkedItems(activeProjectId);

  rendering = true;
  try {
    body.innerHTML = `<div class="project-popup-planning-root" data-project-popup-planning-root>
      ${section("task", tasks)}
      ${section("habit", habits)}
      <p class="project-popup-footnote">여기서 추가하면 이 프로젝트에 자동으로 연결돼요. 날짜·시간·세부 반복 설정은 기존 할일·습관 화면에서 바꿀 수 있어요.</p>
    </div>`;
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 0) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    const layer = document.querySelector(LAYER);
    if (!layer || layer.hidden) return;
    activeProjectId ||= document.querySelector(`${BOOK}[aria-expanded="true"]`)?.dataset?.projectEdit || null;
    if (!activeProjectId) return;
    try {
      await readState();
      render();
    } catch (error) {
      console.warn("프로젝트 연결 항목 관리 화면을 불러오지 못했습니다.", error);
    }
  }, delay);
}

async function addTask(projectId, title) {
  await writeState((current) => {
    const project = current.projects.find((item) => String(item?.id || "") === projectId);
    if (!project) return;
    current.tasks.push({
      id: uid(), title, date: null, done: false, projectId,
      groupId: project.groupId || current.eventGroups[0]?.id || "default",
      createdAt: new Date().toISOString(),
    });
  }, "project-popup-add-task");
}

async function addHabit(projectId, title, frequency) {
  const today = todayKey();
  const date = new Date(`${today}T12:00:00`);
  await writeState((current) => {
    const project = current.projects.find((item) => String(item?.id || "") === projectId);
    if (!project) return;
    const recurrence = { frequency, interval: 1, completionBased: true };
    if (frequency === "weekly") recurrence.weekdays = [date.getDay()];
    if (frequency === "monthly") recurrence.dayOfMonth = date.getDate();
    const id = uid();
    current.tasks.push({
      id, repeatSeriesId: id, title, date: today, done: false, isHabit: true, projectId,
      groupId: project.groupId || current.eventGroups[0]?.id || "default",
      recurrence, recurrenceDone: {}, createdAt: new Date().toISOString(),
    });
  }, "project-popup-add-habit");
}

function markDone(task) {
  task.done = true;
  task.completedAt = new Date().toISOString();
  task.completedDate = todayKey();
}

function clearDone(task) {
  task.done = false;
  task.completedAt = null;
  delete task.completedDate;
}

async function toggleTask(taskId) {
  await writeState((current) => {
    const task = current.tasks.find((item) => String(item?.id || "") === String(taskId || ""));
    if (!task) return;
    if (task.done) {
      if (!undoRepeatingTaskCompletion(current, task)) clearDone(task);
    } else if (!completeRepeatingTask(current, task, new Date())) {
      markDone(task);
    }
  }, "project-popup-toggle-task");
}

async function toggleHabit(id) {
  const today = todayKey();
  await writeState((current) => {
    const rows = current.tasks.filter((item) => item?.isHabit && seriesId(item) === id);
    if (rows.length) {
      const completed = rows.find((row) => Boolean(row?.done) && completionDate(row) === today);
      if (completed) {
        if (!undoRepeatingTaskCompletion(current, completed)) clearDone(completed);
        return;
      }
      const task = currentHabit(rows);
      if (task && !completeRepeatingTask(current, task, new Date())) markDone(task);
      return;
    }

    const legacy = current.habitTemplates.find((item) => String(item?.id || "") === id);
    if (!legacy) return;
    current.habitDays[today] = current.habitDays[today] && typeof current.habitDays[today] === "object" ? current.habitDays[today] : {};
    current.habitDays[today][legacy.id] = !Boolean(current.habitDays[today][legacy.id]);
  }, "project-popup-toggle-habit");
}

function toggleAddForm(button) {
  const form = button.closest("section")?.querySelector(`[data-project-popup-add-form="${button.dataset.projectPopupAdd}"]`);
  if (!form) return;
  const open = form.hidden;
  document.querySelectorAll("[data-project-popup-add-form]").forEach((node) => { if (node !== form) node.hidden = true; });
  document.querySelectorAll("[data-project-popup-add]").forEach((node) => { if (node !== button) node.setAttribute("aria-expanded", "false"); });
  form.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  if (open) requestAnimationFrame(() => form.querySelector("input")?.focus());
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const book = event.target.closest?.(BOOK);
    if (book) {
      activeProjectId = String(book.dataset.projectEdit || "");
      scheduleRender(70);
      return;
    }

    const add = event.target.closest?.("[data-project-popup-add]");
    if (add) {
      event.preventDefault();
      event.stopPropagation();
      toggleAddForm(add);
      return;
    }

    const task = event.target.closest?.("[data-project-popup-toggle-task]");
    if (task) {
      event.preventDefault();
      event.stopPropagation();
      task.disabled = true;
      toggleTask(task.dataset.projectPopupToggleTask).catch(console.error).finally(() => { task.disabled = false; });
      return;
    }

    const habit = event.target.closest?.("[data-project-popup-toggle-habit]");
    if (habit) {
      event.preventDefault();
      event.stopPropagation();
      habit.disabled = true;
      toggleHabit(habit.dataset.projectPopupToggleHabit).catch(console.error).finally(() => { habit.disabled = false; });
      return;
    }

    if (event.target.closest?.("[data-project-linked-close]")) activeProjectId = null;
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target.closest?.("[data-project-popup-add-form]");
    if (!form || !activeProjectId) return;
    event.preventDefault();
    const input = form.querySelector("input");
    const title = input?.value.trim() || "";
    if (!title) return input?.focus();
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    const action = form.dataset.projectPopupAddForm === "habit"
      ? addHabit(activeProjectId, title, form.querySelector("select")?.value || "daily")
      : addTask(activeProjectId, title);
    action.then(() => {
      form.reset();
      form.hidden = true;
    }).catch(console.error).finally(() => {
      if (submit) submit.disabled = false;
    });
  }, true);

  document.addEventListener("onekan:state-changed", (event) => {
    if (String(event.detail?.source || "").startsWith("project-popup-")) return;
    if (!document.querySelector(LAYER)?.hidden) scheduleRender(80);
  });
}

function installStyle() {
  if (document.querySelector('link[data-project-popup-planning-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/project-popup-planning.css?v=1";
  link.dataset.projectPopupPlanningStyle = "1";
  document.head.appendChild(link);
}

function observePopup() {
  new MutationObserver(() => {
    if (rendering) return;
    const layer = document.querySelector(LAYER);
    const body = layer?.querySelector(BODY);
    if (!layer || layer.hidden || !body || body.querySelector(WRAPPER)) return;
    scheduleRender(20);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}

function init() {
  installStyle();
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
