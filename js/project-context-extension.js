import { onekanStateStore, supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";
import { applyProjectStatus, normalizeProjectStatus as normalizeStatus, restartStatusForProject } from "./project-status-automation.js?v=3";

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
let periodAnchor = null;

function projectIdFromElement(element) {
  const row = element?.closest?.('[data-context-kind="project"][data-context-id], [data-project-status-id], .project-row[data-project-id]');
  if (!row) return null;
  return row.dataset.contextId || row.dataset.projectStatusId || row.dataset.projectId || null;
}

function normalizeState(value) {
  const state = value && typeof value === "object" ? value : {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.directionGoals = Array.isArray(state.directionGoals) ? state.directionGoals : [];
  return state;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const stored = await onekanStateStore.read({ userId: session.user.id });
  return { user: session.user, state: normalizeState(stored) };
}

async function writeState(mutator, source) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  await onekanStateStore.mutate((latest) => {
    const state = normalizeState(latest);
    mutator(state);
    return state;
  }, { userId: session.user.id, source: source });
  $("#reloadCloudBtn")?.click();
  return true;
}

function installStyle() {
  if ($("#onekanProjectContextExtensionStyle")) return;
  const style = document.createElement("style");
  style.id = "onekanProjectContextExtensionStyle";
  style.textContent = `
    #globalContextMenu [data-project-context-action],#globalContextMenu [data-project-lifecycle-action]{display:flex;align-items:center;justify-content:space-between}
    #globalContextMenu .onekan-project-context-list{margin:3px 0;padding:3px;border-top:1px solid var(--line,#d2d7df);border-bottom:1px solid var(--line,#d2d7df);max-height:min(260px,55vh);overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
    #globalContextMenu .onekan-project-context-list button{display:grid;grid-template-columns:12px minmax(0,1fr) 16px;align-items:center;gap:7px;padding-left:7px}
    #globalContextMenu .onekan-project-context-list.hidden,#globalContextMenu [data-project-context-action].hidden,#globalContextMenu [data-project-lifecycle-action].hidden{display:none}
    #onekanProjectEditor label:has(#onekanProjectGoal),#onekanProjectEditor label:has(#onekanProjectStatus){display:none}
    .onekan-project-period-pop{position:fixed;z-index:12020;width:min(310px,calc(100vw - 24px));padding:10px;border:1px solid var(--line,#d2d7df);border-radius:12px;background:var(--surface,#fff);box-shadow:0 12px 34px #0002;display:grid;gap:9px}
    .onekan-project-period-pop[hidden]{display:none!important}
    .onekan-project-period-pop strong{font-size:11px}
    .onekan-project-period-pop label{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:8px;color:var(--muted,#6d737d);font-size:10px}
    .onekan-project-period-pop input{width:100%;height:34px;padding:0 8px;border:1px solid var(--line,#d2d7df);border-radius:8px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:11px}
    .onekan-project-period-pop small{color:var(--muted,#6d737d);font-size:9px;line-height:1.4}
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
  let lifecycleButton = $("[data-project-lifecycle-action]", menu);
  if (!goalButton) {
    goalButton = document.createElement("button");
    goalButton.type = "button";
    goalButton.className = "hidden";
    goalButton.dataset.projectContextAction = "goal";
    goalButton.innerHTML = `목표 연결 <span class="context-menu-arrow">›</span>`;
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
    lifecycleButton = document.createElement("button");
    lifecycleButton.type = "button";
    lifecycleButton.className = "hidden";
    const deleteButton = $("[data-context-action='delete']", menu);
    menu.insertBefore(goalButton, deleteButton);
    menu.insertBefore(goalList, deleteButton);
    menu.insertBefore(statusButton, deleteButton);
    menu.insertBefore(statusList, deleteButton);
    menu.insertBefore(lifecycleButton, deleteButton);
  }
  return { menu, goalButton, goalList, statusButton, statusList, lifecycleButton };
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
  parts.lifecycleButton.classList.add("hidden");
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
    populateProjectExtensions(parts, current.state, id);
  } catch (error) {
    console.error("프로젝트 메뉴 확장 실패", error);
    hideExtensions();
  }
}

function populateProjectExtensions(parts, currentState, projectId) {
  const project = currentState?.projects?.find((item) => item.id === projectId && (item.kind === "project" || !item.kind));
  if (!project) return hideExtensions();
  const selectedGoalId = project.goalId || "";
  const goals = Array.isArray(currentState.directionGoals) ? currentState.directionGoals : [];
  parts.goalButton.classList.remove("hidden");
  parts.statusButton.classList.remove("hidden");
  parts.lifecycleButton.classList.remove("hidden");
  parts.goalButton.innerHTML = `목표 연결 <span class="context-menu-arrow">›</span>`;
  parts.goalList.innerHTML = `<button type="button" data-project-goal-id="" role="menuitemradio" aria-checked="${!selectedGoalId}"><span></span><span>목표 없음</span>${!selectedGoalId ? '<span class="context-group-check">✓</span>' : '<span></span>'}</button>${goals.map((goal) => `<button type="button" data-project-goal-id="${esc(goal.id)}" role="menuitemradio" aria-checked="${goal.id === selectedGoalId}"><span class="context-group-dot" style="--group-color:#8fa9c4"></span><span>${esc(goal.title || "이름 없는 목표")}</span>${goal.id === selectedGoalId ? '<span class="context-group-check">✓</span>' : '<span></span>'}</button>`).join("")}`;
  const selectedStatus = normalizeStatus(project.status);
  parts.lifecycleButton.dataset.projectLifecycleAction = ["done", "archived"].includes(selectedStatus) ? "restart" : "archive";
  parts.lifecycleButton.textContent = ["done", "archived"].includes(selectedStatus) ? "다시 시작하기" : "보관하기";
  parts.statusList.innerHTML = STATUSES.map((status) => `<button type="button" data-project-status-id="${status.id}" role="menuitemradio" aria-checked="${status.id === selectedStatus}"><span></span><span>${status.label}</span>${status.id === selectedStatus ? '<span class="context-group-check">✓</span>' : '<span></span>'}</button>`).join("");
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
      applyProjectStatus(project, statusId);
    }, "project-status-context");
    $("#globalContextMenu")?.classList.remove("open");
  } catch (error) {
    console.error("프로젝트 상태 변경 실패", error);
    showToast("상태를 변경하지 못했어요.");
  }
}

async function changeLifecycle(action) {
  const id = activeProjectId;
  if (!id || !["archive", "restart"].includes(action)) return;
  try {
    await writeState((state) => {
      const project = state.projects.find((item) => item.id === id && (item.kind === "project" || !item.kind));
      if (!project) return;
      applyProjectStatus(project, action === "archive" ? "archived" : restartStatusForProject(state, id));
    }, `project-${action}-context`);
    $("#globalContextMenu")?.classList.remove("open");
    showToast(action === "archive" ? "프로젝트를 보관했어요." : "프로젝트를 다시 시작했어요.");
  } catch (error) {
    console.error("프로젝트 보관/재시작 실패", error);
    showToast("프로젝트 상태를 변경하지 못했어요.");
  }
}

function ensurePeriodPopover() {
  let panel = $("#onekanProjectPeriodPop");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "onekanProjectPeriodPop";
  panel.className = "onekan-project-period-pop";
  panel.hidden = true;
  panel.innerHTML = `<strong>프로젝트 기간</strong><label><span>시작일</span><input id="onekanProjectPeriodPopStart" type="date"></label><label><span>종료일</span><input id="onekanProjectPeriodPopEnd" type="date"></label><small>날짜를 고르면 바로 저장돼요.</small>`;
  document.body.appendChild(panel);
  $("#onekanProjectPeriodPopStart", panel)?.addEventListener("change", savePeriodFromPopover);
  $("#onekanProjectPeriodPopEnd", panel)?.addEventListener("change", savePeriodFromPopover);
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.addEventListener("click", (event) => event.stopPropagation());
  return panel;
}

function positionPeriodPopover(anchor, panel) {
  const rect = anchor.getBoundingClientRect();
  panel.hidden = false;
  panel.style.visibility = "hidden";
  panel.style.left = "12px";
  panel.style.top = `${Math.min(innerHeight - 12, rect.bottom + 6)}px`;
  requestAnimationFrame(() => {
    if (panel.hidden) return;
    const box = panel.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.right - box.width, innerWidth - box.width - 12));
    const below = rect.bottom + 6;
    const above = rect.top - box.height - 6;
    const top = below + box.height <= innerHeight - 12 ? below : Math.max(12, above);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.visibility = "";
  });
}

function closePeriodPopover() {
  const panel = $("#onekanProjectPeriodPop");
  if (panel) panel.hidden = true;
  periodAnchor = null;
}

async function openPeriodPopover(projectId, anchor) {
  activeProjectId = projectId;
  periodAnchor = anchor;
  const panel = ensurePeriodPopover();
  try {
    const current = await readState();
    const project = current?.state.projects.find((item) => item.id === projectId && (item.kind === "project" || !item.kind));
    if (!project || projectId !== activeProjectId) return;
    const start = /^\d{4}-\d{2}-\d{2}$/.test(project.startDate || "") ? project.startDate : "";
    const end = /^\d{4}-\d{2}-\d{2}$/.test(project.endDate || "") ? project.endDate : "";
    $("#onekanProjectPeriodPopStart", panel).value = start;
    $("#onekanProjectPeriodPopEnd", panel).value = end;
    $("#onekanProjectPeriodPopEnd", panel).min = start;
    positionPeriodPopover(anchor, panel);
  } catch (error) {
    console.error("프로젝트 기간 열기 실패", error);
    showToast("기간을 불러오지 못했어요.");
  }
}

async function savePeriodFromPopover() {
  const id = activeProjectId;
  const panel = $("#onekanProjectPeriodPop");
  const startDate = $("#onekanProjectPeriodPopStart", panel)?.value || null;
  const endDate = $("#onekanProjectPeriodPopEnd", panel)?.value || null;
  if (!id) return;
  if (startDate && endDate && endDate < startDate) {
    showToast("종료일은 시작일보다 뒤여야 해요.");
    $("#onekanProjectPeriodPopEnd", panel).value = "";
    return;
  }
  try {
    await writeState((state) => {
      const project = state.projects.find((item) => item.id === id && (item.kind === "project" || !item.kind));
      if (!project) return;
      project.startDate = startDate;
      project.endDate = endDate;
      project.updatedAt = new Date().toISOString();
    }, "project-period-popover");
    if (panel) $("#onekanProjectPeriodPopEnd", panel).min = startDate || "";
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

  document.addEventListener("onekan:context-menu-opened", (event) => {
    const target = event.detail?.target;
    if (target?.kind !== "project") {
      activeProjectId = null;
      hideExtensions();
      return;
    }
    activeProjectId = target.id;
    populateProjectExtensions(parts, event.detail?.state, target.id);
  });

  document.addEventListener("contextmenu", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    activeProjectId = projectIdFromElement(element);
    if (!activeProjectId) hideExtensions();
    else setTimeout(renderProjectExtensions, 0);
  }, true);

  document.addEventListener("pointerdown", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest?.("#globalContextMenu,#onekanProjectPeriodPop")) return;
    if (!element?.closest?.("[data-project-period]")) closePeriodPopover();
    activeProjectId = projectIdFromElement(element) || activeProjectId;
  }, true);

  document.addEventListener("click", (event) => {
    const periodButton = event.target.closest?.("[data-project-period]");
    if (!periodButton) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const id = periodButton.dataset.projectPeriod;
    const panel = ensurePeriodPopover();
    if (!panel.hidden && activeProjectId === id && periodAnchor === periodButton) {
      closePeriodPopover();
      return;
    }
    openPeriodPopover(id, periodButton);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePeriodPopover();
  });
  window.addEventListener("resize", closePeriodPopover);
  document.addEventListener("scroll", (event) => {
    if (event.target instanceof Element && event.target.closest("#onekanProjectPeriodPop")) return;
    closePeriodPopover();
  }, true);

  parts.menu.addEventListener("click", (event) => {
    const lifecycle = event.target.closest("[data-project-lifecycle-action]");
    if (lifecycle) {
      event.preventDefault();
      event.stopPropagation();
      changeLifecycle(lifecycle.dataset.projectLifecycleAction);
      return;
    }
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
  ensurePeriodPopover();
  if (wire()) return;
  if (!wired && attempt < 30) setTimeout(() => init(attempt + 1), 120);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init(), { once: true });
else init();

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user && !wired) setTimeout(() => init(), 0);
});
