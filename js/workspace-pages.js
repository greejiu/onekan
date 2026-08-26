import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(2, "0");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const appDayKey = () => { const date = new Date(); date.setHours(date.getHours() - 3); return dateKey(date); };
const minuteText = (minute) => `${pad(Math.floor(Number(minute) / 60))}:${pad(Number(minute) % 60)}`;
const minuteFromTime = (value) => {
  if (!value) return null;
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
};

let state = null;
let user = null;
let taskTab = "all";

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  user = session.user;
  state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.habitTemplates = Array.isArray(state.habitTemplates) ? state.habitTemplates : [];
  state.habitDays = state.habitDays && typeof state.habitDays === "object" ? state.habitDays : {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  return state;
}

async function writeState(mutator) {
  await readState();
  if (!user || !state) return;
  mutator(state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  $("#reloadCloudBtn")?.click();
  await renderAll();
}

function taskDateLabel(task) {
  if (!task.date) return "언젠가";
  if (task.date === appDayKey()) return "오늘";
  return task.date;
}

function visibleTasks() {
  const today = appDayKey();
  return state.tasks.filter((task) => {
    if (taskTab === "today") return !task.done && task.date === today;
    if (taskTab === "upcoming") return !task.done && task.date && task.date > today;
    if (taskTab === "someday") return !task.done && !task.date;
    if (taskTab === "done") return task.done;
    return true;
  }).sort((a, b) => Number(a.done) - Number(b.done) || String(a.date || "9999").localeCompare(String(b.date || "9999")) || String(a.title).localeCompare(String(b.title), "ko"));
}

function taskDetails(task) {
  const details = task.details || task.content || "";
  if (!details) return "";
  return `<details class="task-details"><summary>상세 내용</summary><div>${esc(details)}</div></details>`;
}

function renderTasksPage() {
  if (!state || !$("#tasksPageList")) return;
  $$('[data-task-tab]').forEach((button) => button.classList.toggle("active", button.dataset.taskTab === taskTab));
  const tasks = visibleTasks();
  $("#tasksPageList").innerHTML = tasks.length ? tasks.map((task) => `<article class="workspace-task${task.done ? " done" : ""}" draggable="${!task.done}" data-task-id="${esc(task.id)}" data-context-kind="task" data-context-id="${esc(task.id)}">
    <button class="check ${task.done ? "checked" : ""}" type="button" data-workspace-task-check="${esc(task.id)}">${task.done ? "✓" : ""}</button>
    <div class="workspace-task-main"><div class="workspace-task-title">${esc(task.title)}</div>${taskDetails(task)}</div>
    <span class="pill">${esc(taskDateLabel(task))}</span>
  </article>`).join("") : '<div class="empty">이 목록에는 할일이 없어요.</div>';
}

function lastSevenDays() {
  const days = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    days.push({ key: dateKey(date), label: `${date.getMonth() + 1}/${date.getDate()}`, weekday: ["일", "월", "화", "수", "목", "금", "토"][date.getDay()] });
  }
  return days;
}

function renderHabitsPage() {
  if (!state || !$("#habitHistory")) return;
  const days = lastSevenDays();
  const head = `<div class="habit-matrix-head"><span>습관</span>${days.map((day) => `<span>${day.weekday}<small>${day.label}</small></span>`).join("")}</div>`;
  const rows = state.habitTemplates.map((habit) => `<div class="habit-matrix-row"><strong class="habit-matrix-title" data-context-kind="habit" data-context-id="${esc(habit.id)}" title="클릭하여 수정">${esc(habit.title)}</strong>${days.map((day) => {
    const done = Boolean(state.habitDays[day.key]?.[habit.id]);
    return `<button class="habit-day-check${done ? " checked" : ""}" data-habit-id="${esc(habit.id)}" data-habit-day="${day.key}" type="button" aria-label="${esc(habit.title)} ${day.key}">${done ? "✓" : ""}</button>`;
  }).join("")}</div>`).join("");
  $("#habitHistory").innerHTML = state.habitTemplates.length ? `<div class="habit-matrix">${head}${rows}</div>` : '<div class="empty">아직 습관이 없어요. 첫 습관을 추가해 보세요.</div>';
}

function completedDate(task) {
  return task.completedAt || task.updatedAt || (task.date ? `${task.date}T12:00:00` : null);
}

function renderActivity() {
  if (!state || !$("#activitySummary")) return;
  const completed = state.tasks.filter((task) => task.done).sort((a, b) => new Date(completedDate(b) || 0) - new Date(completedDate(a) || 0));
  const activeProjects = state.projects.filter((project) => project.status !== "완료");
  const average = activeProjects.length ? Math.round(activeProjects.reduce((sum, project) => sum + Math.max(0, Math.min(100, Number(project.progress || 0))), 0) / activeProjects.length) : 0;
  $("#activitySummary").innerHTML = `<div class="metric"><div class="metric-label">완료한 할일</div><div class="metric-value">${completed.length}개</div></div><div class="metric"><div class="metric-label">진행 중인 작업</div><div class="metric-value">${activeProjects.length}개</div></div><div class="metric"><div class="metric-label">평균 진행률</div><div class="metric-value">${average}%</div></div>`;
  $("#completedTaskHistory").innerHTML = completed.length ? completed.slice(0, 50).map((task) => `<div class="activity-row"><span>✓ ${esc(task.title)}</span><time>${esc(completedDate(task)?.slice(0, 10) || "날짜 없음")}</time></div>`).join("") : '<div class="empty">완료한 할일이 아직 없어요.</div>';
  $("#projectProgressHistory").innerHTML = state.projects.length ? [...state.projects].sort((a, b) => Number(b.progress || 0) - Number(a.progress || 0)).map((project) => `<div class="activity-project"><div><strong>${esc(project.title)}</strong><span>${esc(project.status || "작업")}</span></div><div class="progress"><i style="width:${Math.max(0, Math.min(100, Number(project.progress || 0)))}%"></i></div><small>${Math.max(0, Math.min(100, Number(project.progress || 0)))}%</small></div>`).join("") : '<div class="empty">등록된 작업이 없어요.</div>';
}

async function renderAll() {
  await readState();
  renderTasksPage();
  renderHabitsPage();
  renderActivity();
  wireDynamicDragSources();
}

async function moveTask(taskId, destination) {
  const isDateDestination = /^\d{4}-\d{2}-\d{2}$/.test(destination);
  await writeState((current) => {
    const task = current.tasks.find((item) => item.id === taskId);
    if (!task) return;
    task.date = destination === "today" ? appDayKey() : destination === "someday" ? null : isDateDestination ? destination : task.date;
    if (destination !== "today") delete task.timeBlockTemplateId;
  });
}

function wireDropZone(element, destination) {
  if (!element || element.dataset.workspaceDropWired) return;
  element.dataset.workspaceDropWired = "1";
  element.dataset.dropDestination = destination;
  element.addEventListener("dragover", (event) => {
    if (!Array.from(event.dataTransfer.types).includes("text/task-id")) return;
    event.preventDefault();
    element.classList.add("workspace-drop-active");
  });
  element.addEventListener("dragleave", (event) => { if (!element.contains(event.relatedTarget)) element.classList.remove("workspace-drop-active"); });
  element.addEventListener("drop", async (event) => {
    const id = event.dataTransfer.getData("text/task-id");
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove("workspace-drop-active");
    await moveTask(id, destination);
  });
}

function wireDynamicDragSources() {
  $$('[data-task-id], [data-upcoming-task-id]').forEach((element) => {
    if (element.dataset.workspaceDragWired) return;
    const id = element.dataset.taskId || element.dataset.upcomingTaskId;
    if (!id) return;
    element.dataset.workspaceDragWired = "1";
    element.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/task-id", id);
      element.classList.add("dragging");
    });
    element.addEventListener("dragend", () => element.classList.remove("dragging"));
  });
  wireDropZone($("#dailyBlockBoard") || $("#homeLeftColumn"), "today");
  wireDropZone($("#featureSomedayCard") || $("#somedayHomeSlot"), "someday");
  $$('[data-upcoming-date]').forEach((group) => wireDropZone(group, group.dataset.upcomingDate));
  wireTaskTabDrops();
  wireProjectDrag();
}

function wireTaskTabDrops() {
  const destinations = { today: "today", someday: "someday", done: "done" };
  $$('[data-task-tab]').forEach((button) => {
    const destination = destinations[button.dataset.taskTab];
    if (!destination || button.dataset.taskDropWired) return;
    button.dataset.taskDropWired = "1";
    button.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer.types).includes("text/task-id")) return;
      event.preventDefault();
      button.classList.add("workspace-drop-active");
    });
    button.addEventListener("dragleave", () => button.classList.remove("workspace-drop-active"));
    button.addEventListener("drop", async (event) => {
      const id = event.dataTransfer.getData("text/task-id");
      if (!id) return;
      event.preventDefault();
      button.classList.remove("workspace-drop-active");
      if (destination === "done") {
        await writeState((current) => {
          const task = current.tasks.find((item) => item.id === id);
          if (task) { task.done = true; task.completedAt = new Date().toISOString(); }
        });
      } else await moveTask(id, destination);
      taskTab = button.dataset.taskTab;
      renderTasksPage();
    });
  });
}

function wireProjectDrag() {
  $$('.project-row[draggable="true"]').forEach((row) => {
    if (row.dataset.projectDragWired) return;
    row.dataset.projectDragWired = "1";
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/project-id", row.dataset.projectId);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
  });
  $$('.project-status-drop').forEach((section) => {
    if (section.dataset.projectDropWired) return;
    section.dataset.projectDropWired = "1";
    section.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer.types).includes("text/project-id")) return;
      event.preventDefault();
      section.classList.add("workspace-drop-active");
    });
    section.addEventListener("dragleave", (event) => { if (!section.contains(event.relatedTarget)) section.classList.remove("workspace-drop-active"); });
    section.addEventListener("drop", async (event) => {
      const id = event.dataTransfer.getData("text/project-id");
      if (!id) return;
      event.preventDefault();
      section.classList.remove("workspace-drop-active");
      await writeState((current) => {
        const project = current.projects.find((item) => item.id === id);
        if (!project) return;
        project.status = section.dataset.projectStatus;
        if (project.status === "완료") project.progress = 100;
      });
    });
  });
}

function wireUI() {
  $$('[data-task-tab]').forEach((button) => button.addEventListener("click", () => { taskTab = button.dataset.taskTab; renderTasksPage(); wireDynamicDragSources(); }));
  $("#tasksPageAdd")?.addEventListener("click", async () => {
    const title = window.prompt("언젠가 할일을 입력해 주세요.");
    if (!title?.trim()) return;
    await writeState((current) => current.tasks.push({ id: crypto.randomUUID(), title: title.trim(), date: null, done: false, createdAt: new Date().toISOString() }));
  });
  $("#habitsPageAdd")?.addEventListener("click", () => $("#habitPageTitle")?.focus());
  $("#habitPageForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#habitPageTitle")?.value.trim();
    if (!title) return;
    const startMinute = minuteFromTime($("#habitPageTime")?.value);
    const duration = Number($("#habitPageDuration")?.value || 30);
    await writeState((current) => {
      const habit = { id: crypto.randomUUID(), title };
      if (startMinute !== null) {
        habit.startMinute = Math.max(360, Math.min(1320 - duration, Math.round(startMinute / 30) * 30));
        habit.duration = duration;
      }
      current.habitTemplates.push(habit);
    });
    $("#habitPageTitle").value = "";
    $("#habitPageTime").value = "";
    $("#habitPageDuration").value = "30";
  });
  document.addEventListener("click", async (event) => {
    const taskCheck = event.target.closest("[data-workspace-task-check]");
    if (taskCheck) {
      await writeState((current) => {
        const task = current.tasks.find((item) => item.id === taskCheck.dataset.workspaceTaskCheck);
        if (!task) return;
        task.done = !task.done;
        task.completedAt = task.done ? new Date().toISOString() : null;
      });
      return;
    }
    const habitCheck = event.target.closest("[data-habit-id][data-habit-day]");
    if (habitCheck) {
      await writeState((current) => {
        current.habitDays[habitCheck.dataset.habitDay] ||= {};
        current.habitDays[habitCheck.dataset.habitDay][habitCheck.dataset.habitId] = !current.habitDays[habitCheck.dataset.habitDay][habitCheck.dataset.habitId];
      });
    }
  });
  $$('.nav-item[data-page]').forEach((button) => button.addEventListener("click", () => setTimeout(renderAll, 0)));
  $("#reloadCloudBtn")?.addEventListener("click", () => setTimeout(renderAll, 80));
  const observer = new MutationObserver(() => wireDynamicDragSources());
  observer.observe($("#page-home"), { subtree: true, childList: true });
}

async function init(session) {
  if (!session?.user || document.documentElement.dataset.workspacePagesWired) return;
  document.documentElement.dataset.workspacePagesWired = "1";
  wireUI();
  await renderAll();
}

supabase.auth.onAuthStateChange((_event, session) => { if (session?.user) setTimeout(() => init(session), 0); });
const { data: { session } } = await supabase.auth.getSession();
if (session?.user) await init(session);
