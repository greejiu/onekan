import { supabase } from "./supabase.js";

const VALID_STATUSES = new Set(["before", "doing", "done", "archived"]);

export function normalizeProjectStatus(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["before", "시작 전", "시작전", "todo", "planned"].includes(raw)) return "before";
  if (["done", "완료", "달성", "complete", "completed"].includes(raw)) return "done";
  if (["archived", "보관", "closed", "archive"].includes(raw)) return "archived";
  return "doing";
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

let syncing = false;
let timer = null;

async function reconcile() {
  if (syncing) return;
  syncing = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
    if (error) throw error;
    const current = data?.data && typeof data.data === "object" ? data.data : {};
    if (!promoteProjectsWithTasks(current).length) return;
    const { error: saveError } = await supabase.from("onekan_state").upsert({ user_id: session.user.id, data: current }, { onConflict: "user_id" });
    if (saveError) throw saveError;
    document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "project-status-automation" } }));
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
