import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let state = null;
let userId = null;
let renderTimer = null;
let reading = false;

async function readState() {
  if (reading) return state;
  reading = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    userId = session?.user?.id || null;
    if (!userId) return null;
    const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    const current = data?.data && typeof data.data === "object" ? data.data : {};
    current.tasks = Array.isArray(current.tasks) ? current.tasks : [];
    current.projects = Array.isArray(current.projects) ? current.projects : [];
    current.eventGroups = Array.isArray(current.eventGroups) && current.eventGroups.length ? current.eventGroups : [{ id: "default", name: "기본", color: "#8fa9c4" }];
    state = current;
    return state;
  } finally {
    reading = false;
  }
}

async function writeState(mutator) {
  const current = await readState();
  if (!current || !userId) return;
  mutator(current);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: userId, data: current }, { onConflict: "user_id" });
  if (error) throw error;
  state = current;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "project-planning" } }));
  $("#reloadCloudBtn")?.click();
  scheduleRender(20);
}

function projectFor(id) {
  return state?.projects.find((item) => item.id === id && item.kind === "project") || null;
}

function plansFor(projectId) {
  return (state?.tasks || []).filter((task) => task.projectId === projectId && task.projectPlan === true)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

function planSignature(project, plans) {
  return JSON.stringify([
    project.id,
    project.goalId || "",
    ...plans.map((plan) => [plan.id, plan.title, plan.date || "", Boolean(plan.done), plan.completedAt || ""]),
  ]);
}

function planRow(plan) {
  const done = Boolean(plan.done);
  return `<div class="uw-project-plan-row${done ? " done" : ""}" data-project-plan-row="${plan.id}">
    <button class="uw-project-plan-check${done ? " checked" : ""}" data-project-plan-toggle="${plan.id}" type="button" aria-label="${done ? "완료 취소" : "완료"}">${done ? "✓" : ""}</button>
    <input class="uw-project-plan-title" data-project-plan-title="${plan.id}" value="${esc(plan.title)}" aria-label="계획 제목" />
    <div class="uw-project-plan-date-wrap"><input class="uw-project-plan-date" data-project-plan-date="${plan.id}" type="date" value="${esc(plan.date || "")}" aria-label="계획 날짜" /><small>${plan.date ? "" : "언젠가"}</small></div>
    <button class="uw-project-plan-delete" data-project-plan-delete="${plan.id}" type="button" aria-label="계획 삭제">×</button>
  </div>`;
}

function decorateProjectRow(row, project) {
  const plans = plansFor(project.id);
  const signature = planSignature(project, plans);
  const existing = $(".uw-project-plans", row);
  if (existing?.dataset.planSignature === signature) return;
  const wasOpen = existing?.open || false;
  existing?.remove();

  const complete = plans.filter((plan) => plan.done).length;
  const details = document.createElement("details");
  details.className = "uw-project-plans";
  details.dataset.projectId = project.id;
  details.dataset.planSignature = signature;
  details.open = wasOpen;
  details.innerHTML = `
    <summary><span>${plans.length ? "계획" : "계획 세우기"}</span><small>${plans.length ? `${complete}/${plans.length}` : ""}</small><span class="uw-project-plan-chevron" aria-hidden="true">⌄</span></summary>
    <div class="uw-project-plan-body">
      <div class="uw-project-plan-list">${plans.length ? plans.map(planRow).join("") : '<div class="uw-project-plan-empty">계획을 실행할 만큼 작게 나눠보세요.</div>'}</div>
      <form class="uw-project-plan-add" data-project-plan-add="${project.id}">
        <input class="uw-project-plan-new-title" type="text" maxlength="120" autocomplete="off" placeholder="예: 50~54쪽 읽고 따라 그리기" aria-label="새 계획" required />
        <div class="uw-project-plan-new-date"><input type="date" aria-label="계획 날짜" /><small>날짜 없으면 언젠가</small></div>
        <button type="submit">추가</button>
      </form>
    </div>`;
  row.appendChild(details);
}

function decorateGoalLabel(row, project) {
  const meta = $(".uw-work-row-main small", row);
  if (!meta || meta.dataset.projectGoalDecorated) return;
  meta.dataset.projectGoalDecorated = "1";
  if (!project.goalId) return;
  const goal = state.projects.find((item) => item.id === project.goalId && item.kind === "goal");
  if (goal) meta.textContent += ` · 목표 ${goal.title}`;
}

function render() {
  if (!state) return;
  $$("#projectSections .uw-work-row[data-work-id]").forEach((row) => {
    const project = projectFor(row.dataset.workId);
    if (!project) return;
    decorateGoalLabel(row, project);
    decorateProjectRow(row, project);
  });
}

async function refresh() {
  try {
    await readState();
    render();
  } catch (error) {
    console.error("프로젝트 계획 불러오기 실패", error);
  }
}

function scheduleRender(delay = 40) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(refresh, delay);
}

async function addPlan(form) {
  const projectId = form.dataset.projectPlanAdd;
  const title = $(".uw-project-plan-new-title", form)?.value.trim() || "";
  const date = $(".uw-project-plan-new-date input", form)?.value || null;
  if (!title || !projectId) return;
  const submit = $("button[type=submit]", form);
  if (submit) submit.disabled = true;
  try {
    await writeState((current) => {
      const project = current.projects.find((item) => item.id === projectId && item.kind === "project");
      if (!project) return;
      current.tasks.push({
        id: uid(),
        title,
        date: date || null,
        done: false,
        completedAt: null,
        groupId: project.groupId || current.eventGroups[0]?.id || "default",
        projectId,
        projectPlan: true,
        createdAt: new Date().toISOString(),
      });
    });
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function togglePlan(id) {
  await writeState((current) => {
    const task = current.tasks.find((item) => item.id === id && item.projectPlan === true);
    if (!task) return;
    task.done = !task.done;
    task.completedAt = task.done ? new Date().toISOString() : null;
  });
}

async function updatePlanTitle(id, value) {
  const title = value.trim();
  if (!title) return scheduleRender(0);
  await writeState((current) => {
    const task = current.tasks.find((item) => item.id === id && item.projectPlan === true);
    if (task) task.title = title;
  });
}

async function updatePlanDate(id, value) {
  await writeState((current) => {
    const task = current.tasks.find((item) => item.id === id && item.projectPlan === true);
    if (task) task.date = value || null;
  });
}

async function deletePlan(id) {
  await writeState((current) => {
    current.tasks = current.tasks.filter((item) => !(item.id === id && item.projectPlan === true));
    current.timeBlocks = Array.isArray(current.timeBlocks) ? current.timeBlocks.filter((block) => block.taskId !== id) : [];
  });
}

function wireUI() {
  if (document.documentElement.dataset.projectPlanningWired) return;
  document.documentElement.dataset.projectPlanningWired = "1";

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest?.("[data-project-plan-add]");
    if (!form) return;
    event.preventDefault();
    event.stopPropagation();
    try { await addPlan(form); } catch (error) { console.error("프로젝트 계획 추가 실패", error); }
  }, true);

  document.addEventListener("click", async (event) => {
    const toggle = event.target.closest?.("[data-project-plan-toggle]");
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      await togglePlan(toggle.dataset.projectPlanToggle);
      return;
    }
    const remove = event.target.closest?.("[data-project-plan-delete]");
    if (remove) {
      event.preventDefault();
      event.stopPropagation();
      await deletePlan(remove.dataset.projectPlanDelete);
    }
  }, true);

  document.addEventListener("change", async (event) => {
    const title = event.target.closest?.("[data-project-plan-title]");
    if (title) {
      await updatePlanTitle(title.dataset.projectPlanTitle, title.value);
      return;
    }
    const date = event.target.closest?.("[data-project-plan-date]");
    if (date) await updatePlanDate(date.dataset.projectPlanDate, date.value);
  }, true);

  document.addEventListener("keydown", (event) => {
    const title = event.target.closest?.("[data-project-plan-title]");
    if (title && event.key === "Enter") {
      event.preventDefault();
      title.blur();
    }
  }, true);

  document.addEventListener("onekan:state-changed", (event) => {
    if (event.detail?.source !== "project-planning") scheduleRender(30);
  });
  $("#reloadCloudBtn")?.addEventListener("click", () => scheduleRender(80));

  const root = $("#projectSections");
  if (root) new MutationObserver(() => scheduleRender(10)).observe(root, { childList: true, subtree: true });
}

wireUI();
await refresh();
