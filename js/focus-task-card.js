import { supabase } from "./supabase.js";
import { showToast, playCheckSound } from "./ui-feedback.js";
// 시간 통계·백업 관리 모듈은 원래 홈 메모 카드를 통해 불러와졌다.
// 메모 카드를 없애면서 이 카드가 대신 그 역할을 이어받는다.
import "./tracking-stats-loader.js?v=3";

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
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = normalizeState(data?.data);
  return state;
}

async function writeState(mutator) {
  await readState();
  if (!state || !user) return false;
  mutator(state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "focus-task-card" } }));
  scheduleRender(60, false);
  return true;
}

function todayTasks() {
  if (!state) return [];
  const key = appDateKey();
  return state.tasks
    .filter((task) => task.date === key && !task.done)
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));
}

function currentFocusTask() {
  if (!state?.focusTaskId) return null;
  const task = state.tasks.find((item) => item.id === state.focusTaskId);
  if (!task || task.done) return null;
  return task;
}

function pickRowMarkup(task) {
  return `<button class="focus-task-pick" type="button" data-focus-task-pick="${esc(task.id)}"><span class="focus-task-pick-dot" aria-hidden="true"></span><span class="focus-task-pick-title">${esc(task.title || "이름 없는 할일")}</span></button>`;
}

function pickerMarkup() {
  const tasks = todayTasks();
  const body = tasks.length
    ? `<div class="focus-task-picker-list">${tasks.map(pickRowMarkup).join("")}</div>`
    : `<div class="focus-task-empty">오늘 할일이 아직 없어요. 하나 추가해서 쪼개볼까요?</div>`;
  return `
    <div class="focus-task-picker">
      <div class="focus-task-empty">오늘 뭐부터 쪼개볼까요? 지금 집중할 할일 1개만 골라보세요.</div>
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

function activeMarkup(task) {
  const steps = normalizeSubtasks(task.subtasks);
  const progress = task.subtaskProgress && typeof task.subtaskProgress === "object" ? task.subtaskProgress : {};
  const doneCount = steps.filter((step) => Boolean(progress[step.id])).length;
  const rows = steps.length
    ? steps.map((step) => subtaskRowMarkup(task, step, Boolean(progress[step.id]))).join("")
    : `<div class="focus-subtask-empty">아직 하위 할일이 없어요. 작게 쪼개서 추가해보세요.</div>`;
  return `
    <div class="focus-task-active">
      <div class="focus-task-active-head">
        <div class="focus-task-active-title">${esc(task.title || "이름 없는 할일")}</div>
        <button class="focus-task-change-btn" type="button" data-focus-task-clear>다른 할일로 바꾸기</button>
      </div>
      <div class="focus-subtask-list">${rows}</div>
      <form class="focus-subtask-add-form" data-focus-subtask-add-form data-task-id="${esc(task.id)}" autocomplete="off">
        <input type="text" maxlength="120" placeholder="하위 할일 추가" aria-label="새 하위 할일">
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
    const task = currentFocusTask();
    body.innerHTML = task ? activeMarkup(task) : pickerMarkup();
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
        await writeState((current) => { current.focusTaskId = id; });
      } catch (error) {
        console.error("focus task pick failed", error);
        showToast("할일을 선택하지 못했어요.");
      }
      return;
    }

    const clear = event.target.closest?.("[data-focus-task-clear]");
    if (clear) {
      try {
        await writeState((current) => { current.focusTaskId = null; });
      } catch (error) {
        console.error("focus task clear failed", error);
        showToast("변경하지 못했어요.");
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
        showToast("하위 할일 저장 중 오류가 났어요.");
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
        showToast("하위 할일 삭제 중 오류가 났어요.");
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
        });
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
        showToast("하위 할일 추가 중 오류가 났어요.");
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
