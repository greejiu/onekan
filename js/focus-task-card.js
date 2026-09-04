import { onekanStateStore, supabase } from "./supabase.js";
import { showToast, playCheckSound } from "./ui-feedback.js";
// 시간 통계·백업 관리 모듈은 원래 홈 메모 카드를 통해 불러와졌다.
// 메모 카드를 없애면서 이 카드가 대신 그 역할을 이어받는다.
import "./tracking-stats-loader.js?v=4";

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
}[character]));
const pad = (value) => String(value).padStart(2, "0");

function appDateKey(date = new Date()) {
  const value = new Date(date);
  value.setHours(value.getHours() - 3);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

let state = null;
let user = null;
let rendering = false;
let renderTimer = null;
let pickerOpen = false;

function normalizeSubtasks(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((step) => step && typeof step === "object" && String(step.title || "").trim())
    .map((step) => ({ id: String(step.id || `focus-subtask-${crypto.randomUUID()}`), title: String(step.title || "").trim() }));
}

function normalizeState(raw) {
  const next = raw && typeof raw === "object" ? raw : {};
  next.tasks = Array.isArray(next.tasks) ? next.tasks : [];
  next.tasks = next.tasks.map((task) => ({
    ...task,
    subtasks: normalizeSubtasks(task.subtasks),
    subtaskProgress: task?.subtaskProgress && typeof task.subtaskProgress === "object" ? task.subtaskProgress : {},
  }));
  next.eventGroups = Array.isArray(next.eventGroups) && next.eventGroups.length
    ? next.eventGroups
    : [{ id: "default", name: "기본", color: "#8fa9c4" }];
  next.focusTaskId = typeof next.focusTaskId === "string" ? next.focusTaskId : null;
  next.focusTaskDate = typeof next.focusTaskDate === "string" ? next.focusTaskDate : null;
  return next;
}

async function resolveUser() {
  const { data } = await supabase.auth.getSession();
  user = data?.session?.user || null;
  return user;
}

async function readState() {
  await resolveUser();
  if (!user) {
    state = null;
    return null;
  }
  const stored = await onekanStateStore.read({ userId: user.id });
  state = normalizeState(stored);
  return state;
}

async function writeState(mutator) {
  await resolveUser();
  if (!user) return false;
  const committed = await onekanStateStore.mutate((current) => {
    const next = normalizeState(current);
    mutator(next);
    return next;
  }, { userId: user.id, source: "focus-task-card" });
  if (!committed) {
    state = null;
    return false;
  }
  state = normalizeState(committed);
  scheduleRender(60, false);
  return true;
}

function todayTasks() {
  if (!state) return [];
  const key = appDateKey();
  return state.tasks
    .filter((task) => task.date === key && !task.done)
    .sort((a, b) => Number(a.manualOrder || Number.MAX_SAFE_INTEGER) - Number(b.manualOrder || Number.MAX_SAFE_INTEGER) || String(a.title || "").localeCompare(String(b.title || ""), "ko"));
}

function minuteOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function minuteLabel(minute) {
  const value = Math.max(0, Math.min(1439, Number(minute) || 0));
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function relativeMinutes(minutes) {
  const value = Math.max(0, Math.round(minutes));
  if (value < 60) return `${value}분 후`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}시간 ${rest}분 후` : `${hours}시간 후`;
}

function taskTimeWindows(task, dateKey = appDateKey()) {
  const windows = [];
  if (task?.notionStart && task.date === dateKey) {
    const startDate = new Date(task.notionStart);
    const endDate = new Date(task.notionEnd || task.notionStart);
    if (!Number.isNaN(startDate.getTime())) {
      const start = minuteOfDay(startDate);
      const end = Number.isNaN(endDate.getTime()) ? start + 30 : Math.max(start + 1, minuteOfDay(endDate));
      windows.push({ start, end });
    }
  }
  for (const block of Array.isArray(state?.timeBlocks) ? state.timeBlocks : []) {
    if (block.taskId !== task?.id || block.date !== dateKey || !Number.isFinite(Number(block.startMinute))) continue;
    const start = Number(block.startMinute);
    windows.push({ start, end: start + Math.max(1, Number(block.duration) || 30) });
  }
  const unique = new Map(windows.map((window) => [`${window.start}:${window.end}`, window]));
  return [...unique.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}

function selectionForTask(task, nowMinute, manual = false) {
  const windows = taskTimeWindows(task);
  const current = windows.find((window) => window.start <= nowMinute && nowMinute < window.end);
  if (current) return { task, mode: "current", timing: current, manual };
  const next = windows.find((window) => window.start > nowMinute);
  if (next) return { task, mode: "next", timing: next, manual };
  const previous = [...windows].reverse().find((window) => window.end <= nowMinute);
  if (previous) return { task, mode: "past", timing: previous, manual };
  return { task, mode: "today", timing: null, manual };
}

function manualFocusTask() {
  if (!state?.focusTaskId || state.focusTaskDate !== appDateKey()) return null;
  const task = state.tasks.find((item) => item.id === state.focusTaskId);
  if (!task || task.done || task.date !== appDateKey()) return null;
  return task;
}

function automaticTaskSelection(now = new Date()) {
  const tasks = todayTasks();
  if (!tasks.length) return null;
  const nowMinute = minuteOfDay(now);
  const manual = manualFocusTask();
  if (manual) return selectionForTask(manual, nowMinute, true);
  const timed = tasks.flatMap((task) => taskTimeWindows(task).map((timing) => ({ task, timing })));
  const current = timed
    .filter(({ timing }) => timing.start <= nowMinute && nowMinute < timing.end)
    .sort((a, b) => b.timing.start - a.timing.start)[0];
  if (current) return { ...current, mode: "current", manual: false };
  const next = timed
    .filter(({ timing }) => timing.start > nowMinute)
    .sort((a, b) => a.timing.start - b.timing.start)[0];
  if (next) return { ...next, mode: "next", manual: false };
  const previous = timed
    .filter(({ timing }) => timing.end <= nowMinute)
    .sort((a, b) => b.timing.end - a.timing.end)[0];
  if (previous) return { ...previous, mode: "past", manual: false };
  return { task: tasks[0], mode: "today", timing: null, manual: false };
}

function selectionHeading(selection) {
  return selection?.mode === "next" ? "다음 할 일" : "지금 할 일";
}

function selectionMetaMarkup(selection, now = new Date()) {
  const timing = selection?.timing;
  if (!timing) return `<span class="focus-task-time-badge">시간 없음</span><span class="focus-task-state">오늘</span>`;
  if (selection.mode === "next") {
    return `<span class="focus-task-time-badge">${minuteLabel(timing.start)} 시작 · ${relativeMinutes(timing.start - minuteOfDay(now))}</span><span class="focus-task-state">예정</span>`;
  }
  const stateLabel = selection.mode === "current" ? "진행 중" : "예정 시간 지남";
  return `<span class="focus-task-time-badge">${minuteLabel(timing.start)}–${minuteLabel(timing.end)}</span><span class="focus-task-state${selection.mode === "past" ? " late" : ""}">${stateLabel}</span>`;
}

function pickRowMarkup(task) {
  return `<button class="focus-task-pick" type="button" data-focus-task-pick="${esc(task.id)}"><span class="focus-task-pick-dot" aria-hidden="true"></span><span class="focus-task-pick-title">${esc(task.title || "이름 없는 할일")}</span></button>`;
}

function pickerMarkup() {
  const tasks = todayTasks();
  const body = tasks.length
    ? `<div class="focus-task-picker-list">${tasks.map(pickRowMarkup).join("")}</div>`
    : `<div class="focus-task-empty">오늘 할일이 아직 없어요. 하나 추가해서 작게 나눠볼까요?</div>`;
  return `
    <div class="focus-task-picker">
      ${tasks.length ? `<div class="focus-task-picker-head"><span>지금 할 일을 직접 선택할 수 있어요.</span><button type="button" data-focus-task-auto>자동 선택</button></div>` : ""}
      ${body}
      <form class="focus-task-add-form" data-focus-task-add-form autocomplete="off">
        <input type="text" maxlength="120" placeholder="새 할일 추가" aria-label="새 할일 추가">
        <button class="soft-btn" type="submit">추가</button>
      </form>
    </div>`;
}

function subtaskRowMarkup(task, step, checked) {
  return `
    <div class="focus-subtask-row${checked ? " checked" : ""}">
      <button class="focus-subtask-check${checked ? " checked" : ""}" type="button" data-focus-subtask-toggle="${esc(step.id)}" data-task-id="${esc(task.id)}" aria-label="하위 할일 완료">${checked ? "✓" : ""}</button>
      <span class="focus-subtask-title">${esc(step.title)}</span>
      <button class="focus-subtask-remove" type="button" data-focus-subtask-remove="${esc(step.id)}" data-task-id="${esc(task.id)}" aria-label="하위 할일 삭제">×</button>
    </div>`;
}

function activeMarkup(selection) {
  const task = selection.task;
  const steps = normalizeSubtasks(task.subtasks);
  const progress = task.subtaskProgress && typeof task.subtaskProgress === "object" ? task.subtaskProgress : {};
  const doneCount = steps.filter((step) => Boolean(progress[step.id])).length;
  const rows = steps.length
    ? steps.map((step) => subtaskRowMarkup(task, step, Boolean(progress[step.id]))).join("")
    : `<div class="focus-subtask-empty">아직 작은 행동이 없어요. 바로 시작할 수 있을 만큼 작게 나눠보세요.</div>`;
  return `
    <div class="focus-task-active">
      <div class="focus-task-meta">${selectionMetaMarkup(selection)}</div>
      <div class="focus-task-active-head">
        <div class="focus-task-active-title">${esc(task.title || "이름 없는 할일")}</div>
        <button class="focus-task-change-btn" type="button" data-focus-task-clear>다른 할일로 바꾸기</button>
      </div>
      <div class="focus-subtask-label">작은 행동</div>
      <div class="focus-subtask-list">${rows}</div>
      <form class="focus-subtask-add-form" data-focus-subtask-add-form data-task-id="${esc(task.id)}" autocomplete="off">
        <input type="text" maxlength="120" placeholder="작은 행동 추가" aria-label="새 작은 행동">
        <button class="soft-btn" type="submit">추가</button>
      </form>
      ${steps.length ? `<div class="focus-task-progress">${doneCount}/${steps.length} 완료</div>` : ""}
    </div>`;
}

async function render({ refresh = false } = {}) {
  if (rendering) return;
  rendering = true;
  try {
    const body = $("#focusTaskBody");
    if (!body) return;
    if (refresh || !state) await readState();
    if (!state) {
      body.innerHTML = `<div class="focus-task-empty">로그인하면 오늘 할일을 쪼갤 수 있어요.</div>`;
      return;
    }
    const selection = automaticTaskSelection();
    const title = $("#focusTaskCardTitle");
    if (title) title.textContent = pickerOpen ? "할 일 선택" : selectionHeading(selection);
    body.innerHTML = selection && !pickerOpen ? activeMarkup(selection) : pickerMarkup();
  } catch (error) {
    console.error("focus task card render failed", error);
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 60, refresh = false) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render({ refresh }), delay);
}

async function toggleSubtask(taskId, stepId) {
  let completedAll = false;
  let turnedOn = false;
  await writeState((current) => {
    const task = current.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const steps = normalizeSubtasks(task.subtasks);
    if (!steps.some((step) => step.id === stepId)) return;
    const progress = task.subtaskProgress && typeof task.subtaskProgress === "object" ? { ...task.subtaskProgress } : {};
    turnedOn = !progress[stepId];
    if (turnedOn) progress[stepId] = true;
    else delete progress[stepId];
    task.subtaskProgress = progress;
    const allDone = steps.length > 0 && steps.every((step) => Boolean(progress[step.id]));
    if (turnedOn && allDone) {
      completedAll = true;
      task.done = true;
      task.completedAt = new Date().toISOString();
      current.focusTaskId = null;
      current.focusTaskDate = null;
    }
  });
  if (completedAll) {
    playCheckSound("complete");
    showToast("할일을 완료했어요. 다음엔 뭐 할까요?", { tone: "success" });
  } else if (turnedOn) {
    playCheckSound("check");
  }
}

function wireEvents() {
  document.addEventListener("click", async (event) => {
    const pick = event.target.closest?.("[data-focus-task-pick]");
    if (pick) {
      const id = pick.dataset.focusTaskPick || "";
      try {
        await writeState((current) => { current.focusTaskId = id; current.focusTaskDate = appDateKey(); });
        pickerOpen = false;
      } catch (error) {
        console.error("focus task pick failed", error);
        showToast("할일을 선택하지 못했어요.");
      }
      return;
    }

    const clear = event.target.closest?.("[data-focus-task-clear]");
    if (clear) {
      pickerOpen = true;
      scheduleRender(0, false);
      return;
    }

    const automatic = event.target.closest?.("[data-focus-task-auto]");
    if (automatic) {
      try {
        await writeState((current) => { current.focusTaskId = null; current.focusTaskDate = null; });
        pickerOpen = false;
      } catch (error) {
        console.error("focus task automatic selection failed", error);
        showToast("자동 선택으로 바꾸지 못했어요.");
      }
      return;
    }

    const toggle = event.target.closest?.("[data-focus-subtask-toggle]");
    if (toggle) {
      event.preventDefault();
      try {
        await toggleSubtask(toggle.dataset.taskId || "", toggle.dataset.focusSubtaskToggle || "");
      } catch (error) {
        console.error("focus subtask toggle failed", error);
        showToast("작은 행동 저장 중 오류가 났어요.");
      }
      return;
    }

    const remove = event.target.closest?.("[data-focus-subtask-remove]");
    if (remove) {
      const taskId = remove.dataset.taskId || "";
      const stepId = remove.dataset.focusSubtaskRemove || "";
      try {
        await writeState((current) => {
          const task = current.tasks.find((item) => item.id === taskId);
          if (!task) return;
          task.subtasks = normalizeSubtasks(task.subtasks).filter((step) => step.id !== stepId);
          const validIds = new Set(task.subtasks.map((step) => step.id));
          const progress = task.subtaskProgress && typeof task.subtaskProgress === "object" ? task.subtaskProgress : {};
          task.subtaskProgress = Object.fromEntries(Object.entries(progress).filter(([id]) => validIds.has(id)));
        });
      } catch (error) {
        console.error("focus subtask remove failed", error);
        showToast("작은 행동 삭제 중 오류가 났어요.");
      }
    }
  }, true);

  document.addEventListener("submit", async (event) => {
    const addTaskForm = event.target.closest?.("[data-focus-task-add-form]");
    if (addTaskForm) {
      event.preventDefault();
      const input = $("input", addTaskForm);
      const title = input?.value.trim() || "";
      if (!title) return;
      try {
        const newId = `task-${crypto.randomUUID()}`;
        await writeState((current) => {
          const groupId = current.eventGroups[0]?.id || "default";
          current.tasks.push({ id: newId, title, date: appDateKey(), done: false, groupId, subtasks: [], subtaskProgress: {} });
          current.focusTaskId = newId;
          current.focusTaskDate = appDateKey();
        });
        pickerOpen = false;
        if (input) input.value = "";
      } catch (error) {
        console.error("focus task add failed", error);
        showToast("할일을 추가하지 못했어요.");
      }
      return;
    }

    const addSubtaskForm = event.target.closest?.("[data-focus-subtask-add-form]");
    if (addSubtaskForm) {
      event.preventDefault();
      const input = $("input", addSubtaskForm);
      const title = input?.value.trim() || "";
      if (!title) return;
      const taskId = addSubtaskForm.dataset.taskId || "";
      try {
        await writeState((current) => {
          const task = current.tasks.find((item) => item.id === taskId);
          if (!task) return;
          task.subtasks = [...normalizeSubtasks(task.subtasks), { id: `focus-subtask-${crypto.randomUUID()}`, title }];
        });
        if (input) input.value = "";
      } catch (error) {
        console.error("focus subtask add failed", error);
        showToast("작은 행동 추가 중 오류가 났어요.");
      }
    }
  });
}

wireEvents();

document.addEventListener("onekan:state-changed", (event) => {
  if (event.detail?.source === "focus-task-card") return;
  scheduleRender(90, true);
});

supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  state = null;
  scheduleRender(80, true);
});

scheduleRender(120, true);
setInterval(() => scheduleRender(0, false), 60000);
