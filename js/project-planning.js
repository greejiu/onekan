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
    current.timeBlocks = Array.isArray(current.timeBlocks) ? current.timeBlocks : [];
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

function planRow(plan) {
  const done = Boolean(plan.done);
  return `<div class="uw-project-plan-row${done ? " done" : ""}" data-project-plan-row="${plan.id}">
    <button class="uw-project-plan-check${done ? " checked" : ""}" data-project-plan-toggle="${plan.id}" type="button" aria-label="${done ? "완료 취소" : "완료"}">${done ? "✓" : ""}</button>
    <input class="uw-project-plan-title" data-project-plan-title="${plan.id}" value="${esc(plan.title)}" aria-label="계획 제목" />
    <div class="uw-project-plan-date-wrap"><input class="uw-project-plan-date" data-project-plan-date="${plan.id}" type="date" value="${esc(plan.date || "")}" aria-label="계획 날짜" /><small>${plan.date ? "" : "언젠가"}</small></div>
    <button class="uw-project-plan-delete" data-project-plan-delete="${plan.id}" type="button" aria-label="계획 삭제">×</button>
  </div>`;
}

function decorateGoalLabel(row, project) {
  const meta = $(".uw-work-row-main small", row);
  if (!meta || meta.dataset.projectGoalDecorated) return;
  meta.dataset.projectGoalDecorated = "1";
  if (!project.goalId) return;
  const goal = state.projects.find((item) => item.id === project.goalId && item.kind === "goal");
  if (goal) meta.textContent += ` · 목표 ${goal.title}`;
}

function decoratePlanSummary(row, project) {
  const meta = $(".uw-work-row-main small", row);
  if (!meta) return;
  $(".uw-project-plan-summary", meta)?.remove();
  const plans = plansFor(project.id);
  if (!plans.length) return;
  const complete = plans.filter((plan) => plan.done).length;
  const summary = document.createElement("span");
  summary.className = "uw-project-plan-summary";
  summary.textContent = ` · 계획 ${complete}/${plans.length}`;
  meta.appendChild(summary);
}

function renderCards() {
  if (!state) return;
  $$("#projectSections .uw-work-row[data-work-id]").forEach((row) => {
    $$(".uw-project-plans", row).forEach((element) => element.remove());
    const project = projectFor(row.dataset.workId);
    if (!project) return;
    decorateGoalLabel(row, project);
    decoratePlanSummary(row, project);
  });
}

function ensureExistingTaskPicker(editor) {
  let box = $("#projectExistingTaskLink", editor);
  if (!box) {
    box = document.createElement("div");
    box.id = "projectExistingTaskLink";
    box.className = "uw-existing-link-box";
    box.innerHTML = '<select id="projectExistingTaskSelect" aria-label="기존 할일 선택"></select><button id="projectExistingTaskLinkBtn" type="button">기존 할일 연결</button>';
    editor.appendChild(box);
  }
  if (!$("#existingLinkPickerStyle")) {
    const style = document.createElement("style");
    style.id = "existingLinkPickerStyle";
    style.textContent = '.uw-existing-link-box{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;margin-top:7px;padding-top:8px;border-top:1px dashed var(--line)}.uw-existing-link-box select{min-width:0;height:32px;padding:4px 7px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);font:inherit;font-size:10px}.uw-existing-link-box button{min-height:32px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--accent-dark);font:inherit;font-size:10px;cursor:pointer}.uw-existing-link-box button:disabled{opacity:.45;cursor:default}@media(max-width:700px){.uw-existing-link-box{grid-template-columns:1fr}.uw-existing-link-box select,.uw-existing-link-box button{height:36px;font-size:12px}}';
    document.head.appendChild(style);
  }
  return box;
}

function renderDialogPlans() {
  const dialog = $("#projectDialog");
  const editor = $("#projectPlanEditor");
  if (!dialog || !editor) return;

  const kind = $("#projectKind")?.value;
  const projectId = $("#projectId")?.value || "";
  const project = kind === "project" && projectId ? projectFor(projectId) : null;
  editor.hidden = !dialog.open || !project;
  if (!project || !dialog.open) return;

  const plans = plansFor(project.id);
  const complete = plans.filter((plan) => plan.done).length;
  const group = state.eventGroups.find((item) => item.id === project.groupId) || state.eventGroups[0];
  editor.style.setProperty("--uw-group", group?.color || "#8fa9c4");

  const progress = $("#projectPlanProgress");
  if (progress) progress.textContent = plans.length ? `${complete}/${plans.length} 완료` : "아직 계획 없음";
  const list = $("#projectPlanList");
  if (list) list.innerHTML = plans.length ? plans.map(planRow).join("") : '<div class="uw-project-plan-empty">프로젝트를 실행할 만큼 작게 나눠보세요.</div>';

  const picker = ensureExistingTaskPicker(editor);
  const available = [...state.tasks]
    .filter((task) => !task.projectId && task.projectPlan !== true && task.recurrenceOn !== true)
    .sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")) || String(a.title || "").localeCompare(String(b.title || ""), "ko"));
  const select = $("#projectExistingTaskSelect", picker);
  const button = $("#projectExistingTaskLinkBtn", picker);
  if (select) select.innerHTML = available.length ? '<option value="">기존 할일 선택…</option>' + available.map((task) => `<option value="${task.id}">${esc(task.title)} · ${task.date ? esc(task.date) : "언젠가"}${task.done ? " · 완료" : ""}</option>`).join("") : '<option value="">연결할 할일이 없어요</option>';
  if (button) button.disabled = !available.length;
}

function render() {
  renderCards();
  renderDialogPlans();
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

async function addPlan() {
  const projectId = $("#projectId")?.value || "";
  const titleInput = $("#projectPlanNewTitle");
  const dateInput = $("#projectPlanNewDate");
  const title = titleInput?.value.trim() || "";
  const date = dateInput?.value || null;
  if (!title || !projectId) return;

  const button = $("#projectPlanAddBtn");
  if (button) button.disabled = true;
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
    if (titleInput) titleInput.value = "";
    if (dateInput) dateInput.value = "";
    titleInput?.focus({ preventScroll: true });
  } finally {
    if (button) button.disabled = false;
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
    const task = current.tasks.find((item) => item.id === id && item.projectPlan === true);
    if (!task) return;
    if (task.projectPlanLinkedExisting) {
      delete task.projectId;
      delete task.projectPlan;
      delete task.projectPlanLinkedExisting;
      return;
    }
    current.tasks = current.tasks.filter((item) => item.id !== id);
    current.timeBlocks = Array.isArray(current.timeBlocks) ? current.timeBlocks.filter((block) => block.taskId !== id) : [];
  });
}

function wireUI() {
  if (document.documentElement.dataset.projectPlanningWired) return;
  document.documentElement.dataset.projectPlanningWired = "1";

  document.addEventListener("click", async (event) => {
    const add = event.target.closest?.("#projectPlanAddBtn");
    if (add) {
      event.preventDefault();
      event.stopPropagation();
      try { await addPlan(); } catch (error) { console.error("프로젝트 계획 추가 실패", error); }
      return;
    }

    const linkExisting = event.target.closest?.("#projectExistingTaskLinkBtn");
    if (linkExisting) {
      event.preventDefault();
      event.stopPropagation();
      const projectId = $("#projectKind")?.value === "project" ? $("#projectId")?.value : "";
      const taskId = $("#projectExistingTaskSelect")?.value || "";
      if (!projectId || !taskId) return;
      linkExisting.disabled = true;
      try {
        await writeState((current) => {
          const project = current.projects.find((item) => item.id === projectId && item.kind === "project");
          const task = current.tasks.find((item) => item.id === taskId && !item.projectId && item.projectPlan !== true && item.recurrenceOn !== true);
          if (!project || !task) return;
          task.projectId = projectId;
          task.projectPlan = true;
          task.projectPlanLinkedExisting = true;
        });
      } finally {
        linkExisting.disabled = false;
      }
      return;
    }

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
      return;
    }
    if (event.target.matches?.("#projectPlanNewTitle") && event.key === "Enter") {
      event.preventDefault();
      $("#projectPlanAddBtn")?.click();
    }
  }, true);

  document.addEventListener("onekan:state-changed", (event) => {
    if (event.detail?.source !== "project-planning") scheduleRender(30);
  });
  $("#reloadCloudBtn")?.addEventListener("click", () => scheduleRender(80));

  const root = $("#projectSections");
  if (root) new MutationObserver(() => scheduleRender(10)).observe(root, { childList: true, subtree: true });

  const dialog = $("#projectDialog");
  if (dialog) new MutationObserver(() => scheduleRender(0)).observe(dialog, { attributes: true, attributeFilter: ["open"] });
}

wireUI();
await refresh();
