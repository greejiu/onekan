import { onekanStateStore, supabase } from "./supabase.js?v=1";

const VALID_STATUSES = new Set(["before", "doing", "done", "archived"]);

export function normalizeProjectStatus(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["before", "시작 전", "시작전", "todo", "planned"].includes(raw)) return "before";
  if (["done", "완료", "달성", "complete", "completed"].includes(raw)) return "done";
  if (["archived", "보관", "closed", "archive"].includes(raw)) return "archived";
  return "doing";
}

export function normalizeGoalStatus(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["doing", "진행 중", "진행중", "active", "in progress"].includes(raw)) return "doing";
  if (["done", "달성", "완료", "complete", "completed"].includes(raw)) return "done";
  if (["archived", "보관", "closed", "archive"].includes(raw)) return "archived";
  return "before";
}

export function isRecurringProjectTask(task) {
  const frequency = task?.recurrence?.frequency || task?.repeatRule?.frequency || "";
  return Boolean(task?.isHabit || (frequency && frequency !== "none"));
}

export function projectTaskStats(current, projectId) {
  const tasks = (Array.isArray(current?.tasks) ? current.tasks : [])
    .filter((task) => task?.projectId === projectId && !isRecurringProjectTask(task));
  const incomplete = tasks.filter((task) => !task.done);
  return { total: tasks.length, done: tasks.length - incomplete.length, incomplete: incomplete.length };
}

export function restartStatusForProject(current, projectId) {
  return projectTaskStats(current, projectId).incomplete > 0 ? "doing" : "before";
}

export function applyProjectStatus(project, nextStatus) {
  if (!project) return;
  const status = VALID_STATUSES.has(nextStatus) ? nextStatus : normalizeProjectStatus(nextStatus);
  const previous = normalizeProjectStatus(project.status);
  const now = new Date().toISOString();
  project.status = status;
  project.updatedAt = now;
  if (status === "doing" && previous === "before") project.startedAt = project.startedAt || now;
  if (status === "done" && previous !== "done") project.completedAt = project.completedAt || now;
  if (["before", "doing"].includes(status)) delete project.completedAt;
  if (status === "archived") project.archivedAt = project.archivedAt || now;
  else delete project.archivedAt;
}

export function promoteProjectsWithTasks(current) {
  current.projects = Array.isArray(current.projects) ? current.projects : [];
  current.tasks = Array.isArray(current.tasks) ? current.tasks : [];
  const promoted = [];
  current.projects.forEach((project) => {
    if (!project || (project.kind && project.kind !== "project")) return;
    if (normalizeProjectStatus(project.status) !== "before") return;
    if (projectTaskStats(current, project.id).total === 0) return;
    applyProjectStatus(project, "doing");
    promoted.push(project.id);
  });
  return promoted;
}

export function goalProjectStats(current, goalId) {
  const projects = (Array.isArray(current?.projects) ? current.projects : [])
    .filter((project) => project && (!project.kind || project.kind === "project") && project.goalId === goalId)
    .filter((project) => normalizeProjectStatus(project.status) !== "archived");
  const done = projects.filter((project) => normalizeProjectStatus(project.status) === "done").length;
  const unfinished = projects.length - done;
  return { total: projects.length, done, unfinished, allDone: projects.length > 0 && unfinished === 0 };
}

export function restartStatusForGoal(current, goalId) {
  return goalProjectStats(current, goalId).total > 0 ? "doing" : "before";
}

export function applyGoalStatus(goal, nextStatus) {
  if (!goal) return;
  const status = VALID_STATUSES.has(nextStatus) ? nextStatus : normalizeGoalStatus(nextStatus);
  const previous = normalizeGoalStatus(goal.status);
  const now = new Date().toISOString();
  goal.status = status;
  goal.updatedAt = now;
  if (status === "doing" && previous === "before") goal.startedAt = goal.startedAt || now;
  if (status === "done" && previous !== "done") goal.completedAt = goal.completedAt || now;
  if (["before", "doing"].includes(status)) delete goal.completedAt;
  if (status === "archived") goal.archivedAt = goal.archivedAt || now;
  else delete goal.archivedAt;
}

export function reconcileGoalStatuses(current) {
  current.directionGoals = Array.isArray(current.directionGoals) ? current.directionGoals : [];
  current.projects = Array.isArray(current.projects) ? current.projects : [];
  const changed = [];
  current.directionGoals.forEach((goal) => {
    if (!goal) return;
    const status = normalizeGoalStatus(goal.status);
    if (["done", "archived"].includes(status)) return;
    const nextStatus = restartStatusForGoal(current, goal.id);
    if (status === nextStatus) return;
    applyGoalStatus(goal, nextStatus);
    changed.push(goal.id);
  });
  return changed;
}

let syncing = false;
let timer = null;

async function reconcile() {
  if (syncing) return;
  syncing = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const userId = session.user.id;
    const snapshot = await onekanStateStore.read({ userId });
    const probe = snapshot && typeof snapshot === "object" ? JSON.parse(JSON.stringify(snapshot)) : {};
    const promotedProjects = promoteProjectsWithTasks(probe);
    const changedGoals = reconcileGoalStatuses(probe);
    if (!promotedProjects.length && !changedGoals.length) return;
    await onekanStateStore.mutate((current) => {
      promoteProjectsWithTasks(current);
      reconcileGoalStatuses(current);
      return current;
    }, { userId, source: "project-status-automation" });
    document.querySelector("#reloadCloudBtn")?.click();
  } catch (error) {
    console.error("프로젝트 상태 자동 변경 실패", error);
  } finally {
    syncing = false;
  }
}

function schedule(delay = 80) {
  clearTimeout(timer);
  timer = setTimeout(reconcile, delay);
}

document.addEventListener("onekan:state-changed", (event) => {
  if (event.detail?.source === "project-status-automation") return;
  schedule();
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => schedule(0), { once: true });
else schedule(0);
