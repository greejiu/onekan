import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const $$ = (selector, root = document) => [...(root?.querySelectorAll?.(selector) || [])];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let state = null;
let user = null;
let rendering = false;
let renderTimer = null;
let selectedProjectId = sessionStorage.getItem("onekan-plan-project") || "";

function normalizeStatus(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["before", "시작 전", "시작전", "todo", "planned"].includes(raw)) return "before";
  if (["done", "완료", "달성", "complete", "completed"].includes(raw)) return "done";
  if (["archived", "보관", "closed", "archive"].includes(raw)) return "archived";
  return "doing";
}

function isProject(item) {
  return !!item && (item.kind === "project" || !item.kind);
}

function activeProjects(current = state) {
  return (current?.projects || [])
    .filter((item) => isProject(item) && normalizeStatus(item.status) === "doing")
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = data?.data && typeof data.data === "object" ? data.data : {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length ? state.eventGroups : [{ id: "default", name: "기본", color: "#8fa9c4" }];
  return state;
}

async function writeState(mutator, source = "project-plan") {
  await readState();
  if (!state || !user) return false;
  mutator(state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source } }));
  $("#reloadCloudBtn")?.click();
  scheduleRender(100);
  return true;
}

function installStyle() {
  if ($("#onekanProjectPlanStyle")) return;
  const style = document.createElement("style");
  style.id = "onekanProjectPlanStyle";
  style.textContent = `
    #page-plan{--plan-line:var(--line-strong,#b8c0cb)}
    .onekan-plan-shell{display:grid;gap:12px;min-width:0}
    .onekan-plan-card{min-height:440px;border:1.5px solid var(--plan-line);border-radius:15px;background:#fff;overflow:hidden}
    .onekan-plan-top{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;border-bottom:1px solid var(--line,#d2d7df)}
    .onekan-plan-project-select{width:100%;height:38px;padding:0 34px 0 12px;border:0;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px;font-weight:700;outline:none;cursor:pointer}
    .onekan-plan-period{display:flex;align-items:center;gap:7px;padding:0 10px;color:var(--muted,#6d737d);font-size:10px;white-space:nowrap}
    .onekan-plan-period button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer}
    .onekan-plan-period button:hover{background:var(--panel-soft,#f4f5f6)}
    .onekan-plan-body{display:grid;align-content:start;gap:2px;padding:20px 12px 24px;min-height:390px}
    .onekan-plan-task{display:grid;grid-template-columns:24px minmax(0,1fr) auto auto;align-items:center;gap:6px;min-height:36px;padding:5px 7px;border-radius:8px;cursor:grab;user-select:none}
    .onekan-plan-task:hover{background:var(--panel-soft,#f6f7f8)}
    .onekan-plan-task.done{opacity:.52}
    .onekan-plan-task.done strong{text-decoration:line-through}
    .onekan-plan-task.dragging{opacity:.42}
    .onekan-plan-check{display:grid;place-items:center;width:18px;height:18px;padding:0;border:1.5px solid var(--line-strong,#aeb6c1);border-radius:4px;background:#fff;color:var(--text,#1f2328);font-size:11px;cursor:pointer}
    .onekan-plan-check.checked{background:var(--panel-soft,#eef1f3)}
    .onekan-plan-task strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;cursor:text}
    .onekan-plan-task-meta{color:var(--muted,#6d737d);font-size:9px;white-space:nowrap}
    .onekan-plan-task-date{position:relative;display:flex;align-items:center;gap:5px;color:var(--muted,#6d737d);font-size:9px;white-space:nowrap}
    .onekan-plan-task-date-button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--muted,#6d737d);cursor:pointer}
    .onekan-plan-task-date-button:hover,.onekan-plan-task-date-button.active{background:var(--panel-soft,#f4f5f6);color:var(--accent,#8fa9c4)}
    .onekan-plan-task-date-button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .onekan-plan-task-date-input{position:absolute!important;right:0;top:100%;width:1px!important;height:1px!important;min-width:1px!important;padding:0!important;border:0!important;opacity:0!important;pointer-events:none!important}
    .onekan-plan-add{justify-self:start;margin:5px 3px 0;padding:7px 4px;border:0;background:transparent;color:var(--muted,#6d737d);font:inherit;font-size:11px;cursor:pointer}
    .onekan-plan-add:hover{color:var(--text,#1f2328)}
    .onekan-plan-add-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin:4px 3px 0}
    .onekan-plan-add-form input{height:34px;min-width:0;padding:0 9px;border:1px solid var(--line,#d2d7df);border-radius:7px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px;outline:none}
    .onekan-plan-add-form input:focus{border-color:var(--accent,#8fa9c4);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent,#8fa9c4) 12%,transparent)}
    .onekan-plan-add-form button{height:34px;padding:0 10px;border:1px solid var(--line,#d2d7df);border-radius:7px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:11px;cursor:pointer}
    .onekan-plan-empty{padding:26px 10px;color:var(--muted,#6d737d);font-size:11px;text-align:center}
    .onekan-plan-dialog{width:min(390px,calc(100vw - 28px));padding:0;border:1.5px solid var(--plan-line);border-radius:14px;background:#fff;color:var(--text,#1f2328);box-shadow:0 20px 60px rgba(15,23,42,.18)}
    .onekan-plan-dialog::backdrop{background:rgba(15,23,42,.2)}
    .onekan-plan-dialog form{display:grid;gap:12px;padding:18px}
    .onekan-plan-dialog h3{margin:0;font-size:15px}
    .onekan-plan-date-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .onekan-plan-date-row label{display:grid;gap:5px;color:var(--muted,#6d737d);font-size:10px}
    .onekan-plan-date-row input{height:36px;padding:0 9px;border:1px solid var(--line,#d2d7df);border-radius:8px;font:inherit;font-size:12px}
    .onekan-plan-dialog-actions{display:flex;justify-content:flex-end;gap:7px}
    @media(max-width:700px){.onekan-plan-card{min-height:360px}.onekan-plan-top{grid-template-columns:1fr}.onekan-plan-period{justify-content:flex-end;padding:4px 10px 8px}.onekan-plan-task{grid-template-columns:24px minmax(0,1fr) auto}.onekan-plan-task-meta{display:none}.onekan-plan-task-date{grid-column:3}.onekan-plan-date-row{grid-template-columns:1fr}.onekan-plan-add-form{grid-template-columns:minmax(0,1fr) auto}}
  `;
  document.head.appendChild(style);
}

function projectDates(project) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(project?.startDate || "") ? project.startDate : null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(project?.endDate || "") ? project.endDate : /^\d{4}-\d{2}-\d{2}$/.test(project?.deadline || "") ? project.deadline : null;
  return { start, end };
}

function shortDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${year.slice(2)}.${month}.${day}`;
}

function projectPeriod(project) {
  const { start, end } = projectDates(project);
  if (start && end) return `${shortDate(start)} ~ ${shortDate(end)}`;
  if (start) return `${shortDate(start)} ~`;
  if (end) return `~ ${shortDate(end)}`;
  return "기간 없음";
}

function taskMeta(task) {
  if (!task.notionStart) return "";
  const date = new Date(task.notionStart);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function taskRow(task) {
  const meta = taskMeta(task);
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(task.date || "") ? task.date : "";
  return `<div class="onekan-plan-task${task.done ? " done" : ""}" draggable="${!task.done}" data-plan-task-id="${esc(task.id)}" data-task-id="${esc(task.id)}" data-context-kind="task" data-context-id="${esc(task.id)}">
    <button class="onekan-plan-check${task.done ? " checked" : ""}" data-plan-task-check="${esc(task.id)}" type="button" aria-label="완료 전환">${task.done ? "✓" : ""}</button>
    <strong>${esc(task.title || "이름 없는 할일")}</strong>
    ${meta ? `<span class="onekan-plan-task-meta">${esc(meta)}</span>` : ""}
    <span class="onekan-plan-task-date">${dateValue ? `<span>${esc(dateValue)}</span>` : ""}<button class="onekan-plan-task-date-button${dateValue ? " active" : ""}" data-plan-task-date-button="${esc(task.id)}" type="button" aria-label="날짜 설정" title="${dateValue ? `날짜: ${esc(dateValue)}` : "날짜 설정"}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path></svg></button><input class="onekan-plan-task-date-input" data-plan-task-date-input="${esc(task.id)}" type="date" value="${esc(dateValue)}" aria-label="할일 날짜"></span>
  </div>`;
}

function ensurePeriodDialog() {
  let dialog = $("#onekanPlanPeriodDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "onekanPlanPeriodDialog";
  dialog.className = "onekan-plan-dialog";
  dialog.innerHTML = `<form method="dialog" id="onekanPlanPeriodForm"><h3>프로젝트 기간</h3><div class="onekan-plan-date-row"><label>시작일<input id="onekanPlanProjectStart" type="date"></label><label>종료일<input id="onekanPlanProjectEnd" type="date"></label></div><div class="onekan-plan-dialog-actions"><button class="soft-btn" value="cancel" type="submit">취소</button><button class="primary-btn" id="onekanPlanPeriodSave" type="button">저장</button></div></form>`;
  document.body.appendChild(dialog);
  $("#onekanPlanPeriodSave", dialog)?.addEventListener("click", saveProjectPeriod);
  return dialog;
}

async function openProjectPeriod() {
  await readState();
  const project = activeProjects().find((item) => item.id === selectedProjectId);
  if (!project) return;
  const dialog = ensurePeriodDialog();
  const dates = projectDates(project);
  $("#onekanPlanProjectStart", dialog).value = dates.start || "";
  $("#onekanPlanProjectEnd", dialog).value = dates.end || "";
  dialog.showModal();
}

async function saveProjectPeriod() {
  const dialog = $("#onekanPlanPeriodDialog");
  const startDate = $("#onekanPlanProjectStart", dialog)?.value || null;
  const endDate = $("#onekanPlanProjectEnd", dialog)?.value || null;
  if (startDate && endDate && endDate < startDate) return showToast("종료일은 시작일보다 뒤여야 해요.");
  const id = selectedProjectId;
  try {
    await writeState((current) => {
      const project = current.projects.find((item) => item.id === id && isProject(item));
      if (!project) return;
      project.startDate = startDate;
      project.endDate = endDate;
      project.updatedAt = new Date().toISOString();
    }, "project-plan-period");
    dialog.close();
  } catch (error) {
    console.error("프로젝트 기간 저장 실패", error);
    showToast("프로젝트 기간을 저장하지 못했어요.");
  }
}

function addFormMarkup() {
  return `<form class="onekan-plan-add-form" data-plan-add-form><input class="onekan-plan-add-title" type="text" maxlength="120" autocomplete="off" placeholder="할일 입력" aria-label="프로젝트 할일 입력"><button type="submit">추가</button></form>`;
}

function renderMarkup() {
  const projects = activeProjects();
  if (!projects.length) return '<div class="onekan-plan-empty">진행 중인 프로젝트가 없어요. 프로젝트 현황에서 먼저 진행 중 프로젝트를 만들어 주세요.</div>';
  if (!projects.some((project) => project.id === selectedProjectId)) selectedProjectId = projects[0].id;
  sessionStorage.setItem("onekan-plan-project", selectedProjectId);
  const project = projects.find((item) => item.id === selectedProjectId);
  const options = projects.map((item) => `<option value="${esc(item.id)}"${item.id === selectedProjectId ? " selected" : ""}>${esc(item.title || "이름 없는 프로젝트")}</option>`).join("");
  const tasks = state.tasks
    .filter((task) => task.projectId === selectedProjectId)
    .sort((a, b) => Number(!!a.done) - Number(!!b.done) || String(a.date || "9999-99-99").localeCompare(String(b.date || "9999-99-99")) || String(a.title || "").localeCompare(String(b.title || ""), "ko"));
  return `<section class="onekan-plan-card"><div class="onekan-plan-top"><select class="onekan-plan-project-select" id="onekanPlanProjectSelect" aria-label="진행 중 프로젝트 선택"><option disabled>프로젝트 선택</option>${options}</select><div class="onekan-plan-period"><span>${esc(projectPeriod(project))}</span><button type="button" data-plan-period aria-label="프로젝트 기간 수정" title="프로젝트 기간 수정">▣</button></div></div><div class="onekan-plan-body" id="onekanPlanTaskList">${tasks.length ? tasks.map(taskRow).join("") : '<div class="onekan-plan-empty">이 프로젝트에 연결된 할일이 아직 없어요.</div>'}<button class="onekan-plan-add" data-plan-add type="button">＋ 할일 추가</button></div></section>`;
}

async function addTask(title) {
  const value = String(title || "").trim();
  if (!value || !selectedProjectId) return;
  try {
    await writeState((current) => {
      current.tasks = Array.isArray(current.tasks) ? current.tasks : [];
      const groupId = current.eventGroups?.[0]?.id || "default";
      current.tasks.push({ id: uid(), title: value, date: null, done: false, groupId, projectId: selectedProjectId, createdAt: new Date().toISOString() });
    }, "project-plan-task-add");
  } catch (error) {
    console.error("프로젝트 할일 추가 실패", error);
    showToast("할일을 추가하지 못했어요.");
  }
}

async function setTaskDate(taskId, dateValue) {
  const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue || "") ? dateValue : null;
  try {
    await writeState((current) => {
      const task = current.tasks.find((item) => item.id === taskId);
      if (!task) return;
      const oldStart = task.notionStart ? new Date(task.notionStart) : null;
      const oldEnd = task.notionEnd ? new Date(task.notionEnd) : null;
      const duration = oldStart && oldEnd && oldEnd > oldStart ? oldEnd - oldStart : 30 * 60000;
      task.date = nextDate;
      if (!nextDate) {
        delete task.notionStart;
        delete task.notionEnd;
        return;
      }
      if (oldStart && !Number.isNaN(oldStart.getTime())) {
        const hh = String(oldStart.getHours()).padStart(2, "0");
        const mm = String(oldStart.getMinutes()).padStart(2, "0");
        const start = new Date(`${nextDate}T${hh}:${mm}:00`);
        task.notionStart = start.toISOString();
        task.notionEnd = new Date(start.getTime() + duration).toISOString();
      }
    }, "project-plan-task-date");
  } catch (error) {
    console.error("프로젝트 할일 날짜 변경 실패", error);
    showToast("날짜를 변경하지 못했어요.");
  }
}

async function toggleTask(taskId) {
  try {
    await writeState((current) => {
      const task = current.tasks.find((item) => item.id === taskId);
      if (!task) return;
      task.done = !task.done;
      task.completedAt = task.done ? new Date().toISOString() : null;
    }, "project-plan-task-check");
  } catch (error) {
    console.error("프로젝트 할일 완료 변경 실패", error);
    showToast("완료 상태를 변경하지 못했어요.");
  }
}

function wireRoot(root) {
  if (root.dataset.projectPlanWired) return;
  root.dataset.projectPlanWired = "1";
  root.addEventListener("change", (event) => {
    const select = event.target.closest("#onekanPlanProjectSelect");
    if (!select) return;
    selectedProjectId = select.value || "";
    sessionStorage.setItem("onekan-plan-project", selectedProjectId);
    render();
  });
  root.addEventListener("click", (event) => {
    const check = event.target.closest("[data-plan-task-check]");
    if (check) return toggleTask(check.dataset.planTaskCheck);
    const dateButton = event.target.closest("[data-plan-task-date-button]");
    if (dateButton) {
      event.preventDefault();
      event.stopPropagation();
      const input = root.querySelector(`[data-plan-task-date-input="${CSS.escape(dateButton.dataset.planTaskDateButton)}"]`);
      if (input) { try { input.showPicker(); } catch { input.click(); } }
      return;
    }
    if (event.target.closest("[data-plan-period]")) return openProjectPeriod();
    const add = event.target.closest("[data-plan-add]");
    if (add) {
      add.replaceWith(document.createRange().createContextualFragment(addFormMarkup()));
      requestAnimationFrame(() => $("[data-plan-add-form] .onekan-plan-add-title", root)?.focus());
    }
  });
  root.addEventListener("change", (event) => {
    const input = event.target.closest("[data-plan-task-date-input]");
    if (!input) return;
    event.stopPropagation();
    setTaskDate(input.dataset.planTaskDateInput, input.value || "");
  });
  root.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-plan-add-form]");
    if (!form) return;
    event.preventDefault();
    const titleInput = $(".onekan-plan-add-title", form);
    addTask(titleInput?.value);
  });
  root.addEventListener("dragstart", (event) => {
    const row = event.target.closest("[data-plan-task-id]");
    if (!row || row.getAttribute("draggable") !== "true") return;
    const id = row.dataset.planTaskId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/task-id", id);
    window.__onekanSuppressItemClickUntil = Date.now() + 700;
    row.classList.add("dragging");
  });
  root.addEventListener("dragend", (event) => {
    window.__onekanSuppressItemClickUntil = Date.now() + 700;
    event.target.closest("[data-plan-task-id]")?.classList.remove("dragging");
  });
}

async function render() {
  const page = $("#page-plan");
  const root = $("#projectPlanRoot");
  if (!page || !root || !page.classList.contains("active") || rendering) return;
  rendering = true;
  try {
    installStyle();
    root.innerHTML = '<div class="onekan-plan-empty">불러오는 중...</div>';
    const current = await readState();
    if (!current) {
      root.innerHTML = '<div class="onekan-plan-empty">로그인 후 계획을 확인할 수 있어요.</div>';
      return;
    }
    root.innerHTML = `<div class="onekan-plan-shell">${renderMarkup()}</div>`;
    wireRoot(root);
  } catch (error) {
    console.error("계획 세우기 렌더링 실패", error);
    root.innerHTML = '<div class="onekan-plan-empty">계획을 불러오지 못했어요.</div>';
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 70) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, delay);
}

function init() {
  installStyle();
  ensurePeriodDialog();
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-page="plan"]')) scheduleRender(30);
  });
  document.addEventListener("onekan:state-changed", () => {
    if ($("#page-plan")?.classList.contains("active")) scheduleRender(110);
  });
  if ($("#page-plan")?.classList.contains("active")) scheduleRender(0);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();