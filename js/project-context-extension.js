import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));

const STATUSES = [
  { id: "before", label: "시작 전" },
  { id: "doing", label: "진행 중" },
  { id: "done", label: "완료" },
  { id: "archived", label: "보관" },
];

let activeProjectId = null;
let observer = null;
let wired = false;

function normalizeStatus(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["before", "시작 전", "시작전", "todo", "planned"].includes(raw)) return "before";
  if (["done", "완료", "달성", "complete", "completed"].includes(raw)) return "done";
  if (["archived", "보관", "closed", "archive"].includes(raw)) return "archived";
  return "doing";
}

function projectIdFromElement(element) {
  const row = element?.closest?.('[data-context-kind="project"][data-context-id], [data-project-status-id], .project-row[data-project-id]');
  if (!row) return null;
  return row.dataset.contextId || row.dataset.projectStatusId || row.dataset.projectId || null;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.directionGoals = Array.isArray(state.directionGoals) ? state.directionGoals : [];
  return { user: session.user, state };
}

async function writeState(mutator, source) {
  const current = await readState();
  if (!current) return false;
  mutator(current.state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: current.user.id, data: current.state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source } }));
  $("#reloadCloudBtn")?.click();
  return true;
}

function installStyle() {
  if ($("#onekanProjectContextExtensionStyle")) return;
  const style = document.createElement("style");
  style.id = "onekanProjectContextExtensionStyle";
  style.textContent = `
    #globalContextMenu [data-project-context-action]{display:flex;align-items:center;justify-content:space-between}
    #globalContextMenu .onekan-project-context-list{margin:3px 0;padding:3px;border-top:1px solid var(--line,#d2d7df);border-bottom:1px solid var(--line,#d2d7df);max-height:min(260px,55vh);overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
    #globalContextMenu .onekan-project-context-list button{display:grid;grid-template-columns:12px minmax(0,1fr) 16px;align-items:center;gap:7px;padding-left:7px}
    #globalContextMenu .onekan-project-context-list.hidden,#globalContextMenu [data-project-context-action].hidden{display:none}
    #onekanProjectEditor label:has(#onekanProjectGoal),#onekanProjectEditor label:has(#onekanProjectStatus){display:none}
    .onekan-project-period-only-dialog{width:min(390px,calc(100vw - 28px));padding:0;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:14px;background:#fff;color:var(--text,#1f2328);box-shadow:0 20px 60px rgba(15,23,42,.18)}
    .onekan-project-period-only-dialog::backdrop{background:rgba(15,23,42,.2)}
    .onekan-project-period-only-dialog form{display:grid;gap:14px;padding:18px}
    .onekan-project-period-only-dialog h3{margin:0;font-size:15px}
    .onekan-project-period-only-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .onekan-project-period-only-fields label{display:grid;gap:5px;color:var(--muted,#6d737d);font-size:10px}
    .onekan-project-period-only-fields input{width:100%;height:36px;padding:0 9px;border:1px solid var(--line,#d2d7df);border-radius:8px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px}
    .onekan-project-period-only-actions{display:flex;justify-content:flex-end;gap:7px}
    @media(max-width:560px){.onekan-project-period-only-fields{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function ensureMenuExtensions() {
  const menu = $("#globalContextMenu");
  if (!menu) return null;
  let goalButton = $("[data-project-context-action='goal']", menu);
  let goalList = $("#onekanProjectGoalContextList", menu);
  let statusButton = $("[data-project-context-action='status']", menu);
  let statusList = $("#onekanProjectStatusContextList", menu);
  if (!goalButton) {
    goalButton = document.createElement("button");
    goalButton.type = "button";
    goalButton.className = "hidden";
    goalButton.dataset.projectContextAction = "goal";
    goalButton.innerHTML = `목표 <span class="context-menu-arrow">›</span>`;
    goalList = document.createElement("div");
    goalList.id = "onekanProjectGoalContextList";
    goalList.className = "onekan-project-context-list hidden";
    statusButton = document.createElement("button");
    statusButton.type = "button";
    statusButton.className = "hidden";
    statusButton.dataset.projectContextAction = "status";
    statusButton.innerHTML = `상태 <span class="context-menu-arrow">›</span>`;
    statusList = document.createElement("div");
    statusList.id = "onekanProjectStatusContextList";
    statusList.className = "onekan-project-context-list hidden";
    const deleteButton = $("[data-context-action='delete']", menu);
    menu.insertBefore(goalButton, deleteButton);
    menu.insertBefore(goalList, deleteButton);
    menu.insertBefore(statusButton, deleteButton);
    menu.insertBefore(statusList, deleteButton);
  }
  return { menu, goalButton, goalList, statusButton, statusList };
}

function hideExtensionLists(parts = ensureMenuExtensions()) {
  if (!parts) return;
  parts.goalList.classList.add("hidden");
  parts.statusList.classList.add("hidden");
}

function hideExtensions() {
  const parts = ensureMenuExtensions();
  if (!parts) return;
  parts.goalButton.classList.add("hidden");
  parts.statusButton.classList.add("hidden");
  hideExtensionLists(parts);
}

function clampMenu(menu) {
  requestAnimationFrame(() => {
    if (!menu?.classList.contains("open")) return;
    const rect = menu.getBoundingClientRect();
    const currentTop = Number.parseFloat(menu.style.top) || 8;
    menu.style.top = `${Math.max(8, Math.min(currentTop, innerHeight - rect.height - 8))}px`;
  });
}

async function renderProjectExtensions() {
  const id = activeProjectId;
  const parts = ensureMenuExtensions();
  if (!id || !parts || !parts.menu.classList.contains("open")) return hideExtensions();
  try {
    const current = await readState();
    if (!current || id !== activeProjectId) return;
    const project = current.state.projects.find((item) => item.id === id && (item.kind === "project" || !item.kind));
    if (!project) return hideExtensions();
    const selectedGoalId = project.goalId || "";
    const goals = current.state.directionGoals;
    parts.goalButton.classList.remove("hidden");
    parts.statusButton.classList.remove("hidden");
    parts.goalButton.innerHTML = `${selectedGoalId ? "목표 변경" : "목표 추가"} <span class="context-menu-arrow">›</span>`;
    parts.goalList.innerHTML = `<button type="button" data-project-goal-id="" role="menuitemradio" aria-checked="${!selectedGoalId}"><span></span><span>목표 없음</span>${!selectedGoalId ? '<span class="context-group-check">✓</span>' : '<span></span>'}</button>${goals.map((goal) => `<button type="button" data-project-goal-id="${esc(goal.id)}" role="menuitemradio" aria-checked="${goal.id === selectedGoalId}"><span class="context-group-dot" style="--group-color:#8fa9c4"></span><span>${esc(goal.title || "이름 없는 목표")}</span>${goal.id === selectedGoalId ? '<span class="context-group-check">✓</span>' : '<span></span>'}</button>`).join("")}`;
    const selectedStatus = normalizeStatus(project.status);
    parts.statusList.innerHTML = STATUSES.map((status) => `<button type="button" data-project-status-id="${status.id}" role="menuitemradio" aria-checked="${status.id === selectedStatus}"><span></span><span>${status.label}</span>${status.id === selectedStatus ? '<span class="context-group-check">✓</span>' : '<span></span>'}</button>`).join("");
  } catch (error) {
    console.error("프로젝트 메뉴 확장 실패", error);
    hideExtensions();
  }
}

async function changeGoal(goalId) {
  const id = activeProjectId;
  if (!id) return;
  try {
    await writeState((state) => {
      const project = state.projects.find((item) => item.id === id && (item.kind === "project" || !item.kind));
      if (!project) return;
      const valid = goalId && state.directionGoals.some((goal) => goal.id === goalId);
      project.goalId = valid ? goalId : null;
      project.updatedAt = new Date().toISOString();
    }, "project-goal-context");
    $("#globalContextMenu")?.classList.remove("open");
  } catch (error) {
    console.error("프로젝트 목표 변경 실패", error);
    showToast("목표를 변경하지 못했어요.");
  }
}

async function changeStatus(statusId) {
  const id = activeProjectId;
  if (!id || !STATUSES.some((status) => status.id === statusId)) return;
  try {
    await writeState((state) => {
      const project = state.projects.find((item) => item.id === id && (item.kind === "project" || !item.kind));
      if (!project) return;
      project.status = statusId;
      project.updatedAt = new Date().toISOString();
    }, "project-status-context");
    $("#globalContextMenu")?.classList.remove("open");
  } catch (error) {
    console.error("프로젝트 상태 변경 실패", error);
    showToast("상태를 변경하지 못했어요.");
  }
}

function ensurePeriodDialog() {
  let dialog = $("#onekanProjectPeriodOnlyDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "onekanProjectPeriodOnlyDialog";
  dialog.className = "onekan-project-period-only-dialog";
  dialog.innerHTML = `<form method="dialog"><h3>프로젝트 기간</h3><div class="onekan-project-period-only-fields"><label>시작일<input id="onekanProjectPeriodOnlyStart" type="date"></label><label>종료일<input id="onekanProjectPeriodOnlyEnd" type="date"></label></div><div class="onekan-project-period-only-actions"><button class="soft-btn" value="cancel" type="submit">취소</button><button class="primary-btn" id="onekanProjectPeriodOnlySave" type="button">저장</button></div></form>`;
  document.body.appendChild(dialog);
  $("#onekanProjectPeriodOnlySave", dialog)?.addEventListener("click", savePeriodOnly);
  return dialog;
}

async function openPeriodOnly(projectId) {
  activeProjectId = projectId;
  try {
    const current = await readState();
    const project = current?.state.projects.find((item) => item.id === projectId && (item.kind === "project" || !item.kind));
    if (!project) return;
    const dialog = ensurePeriodDialog();
    $("#onekanProjectPeriodOnlyStart", dialog).value = /^\d{4}-\d{2}-\d{2}$/.test(project.startDate || "") ? project.startDate : "";
    $("#onekanProjectPeriodOnlyEnd", dialog).value = /^\d{4}-\d{2}-\d{2}$/.test(project.endDate || "") ? project.endDate : "";
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => $("#onekanProjectPeriodOnlyStart", dialog)?.focus());
  } catch (error) {
    console.error("프로젝트 기간 열기 실패", error);
    showToast("기간을 불러오지 못했어요.");
  }
}

async function savePeriodOnly() {
  const id = activeProjectId;
  const dialog = $("#onekanProjectPeriodOnlyDialog");
  const startDate = $("#onekanProjectPeriodOnlyStart", dialog)?.value || null;
  const endDate = $("#onekanProjectPeriodOnlyEnd", dialog)?.value || null;
  if (!id) return;
  if (startDate && endDate && endDate < startDate) return showToast("종료일은 시작일보다 뒤여야 해요.");
  try {
    await writeState((state) => {
      const project = state.projects.find((item) => item.id === id && (item.kind === "project" || !item.kind));
      if (!project) return;
      project.startDate = startDate;
      project.endDate = endDate;
      project.updatedAt = new Date().toISOString();
    }, "project-period-context");
    dialog?.close();
  } catch (error) {
    console.error("프로젝트 기간 저장 실패", error);
    showToast("기간을 저장하지 못했어요.");
  }
}

function wire() {
  if (wired) return;
  const parts = ensureMenuExtensions();
  if (!parts) return;
  wired = true;
  observer = new MutationObserver(() => {
    if (parts.menu.classList.contains("open")) renderProjectExtensions();
    else hideExtensionLists(parts);
  });
  observer.observe(parts.menu, { attributes: true, attributeFilter: ["class"] });

  document.addEventListener("contextmenu", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    activeProjectId = projectIdFromElement(element);
    if (!activeProjectId) hideExtensions();
    else setTimeout(renderProjectExtensions, 0);
  }, true);

  document.addEventListener("pointerdown", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest?.("#globalContextMenu")) return;
    activeProjectId = projectIdFromElement(element);
  }, true);

  document.addEventListener("click", (event) => {
    const periodButton = event.target.closest?.("[data-project-period]");
    if (!periodButton) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openPeriodOnly(periodButton.dataset.projectPeriod);
  }, true);

  parts.menu.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-project-context-action]");
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      $("#contextGroupList")?.classList.add("hidden");
      $("#contextProjectList")?.classList.add("hidden");
      if (toggle.dataset.projectContextAction === "goal") {
        parts.statusList.classList.add("hidden");
        parts.goalList.classList.toggle("hidden");
      } else {
        parts.goalList.classList.add("hidden");
        parts.statusList.classList.toggle("hidden");
      }
      clampMenu(parts.menu);
      return;
    }
    const goal = event.target.closest("[data-project-goal-id]");
    if (goal) {
      event.preventDefault();
      event.stopPropagation();
      changeGoal(goal.dataset.projectGoalId || "");
      return;
    }
    const status = event.target.closest("[data-project-status-id]");
    if (status && status.closest("#onekanProjectStatusContextList")) {
      event.preventDefault();
      event.stopPropagation();
      changeStatus(status.dataset.projectStatusId);
    }
  });
}

function init(attempt = 0) {
  installStyle();
  ensurePeriodDialog();
  if (wire()) return;
  if (!wired && attempt < 30) setTimeout(() => init(attempt + 1), 120);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init(), { once: true });
else init();
