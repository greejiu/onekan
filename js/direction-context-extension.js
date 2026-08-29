import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
let activeTarget = null;
let rendering = false;

function directionTarget(element) {
  const root = element?.closest?.("[data-context-kind][data-context-id]");
  if (!root || !["goal", "identity"].includes(root.dataset.contextKind)) return null;
  return { kind: root.dataset.contextKind, id: root.dataset.contextId };
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.directionGoals = Array.isArray(state.directionGoals) ? state.directionGoals : [];
  state.identities = Array.isArray(state.identities) ? state.identities : [];
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  return { user: session.user, state };
}

async function writeState(mutator) {
  const loaded = await readState();
  if (!loaded) return false;
  mutator(loaded.state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: loaded.user.id, data: loaded.state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "direction-context" } }));
  $("#reloadCloudBtn")?.click();
  return true;
}

function isProject(item) {
  return !!item && (item.kind === "project" || !item.kind);
}

function ensureParts() {
  const menu = $("#globalContextMenu");
  if (!menu) return null;
  let identityButton = $("[data-direction-context-action='identity']", menu);
  if (identityButton) {
    return {
      menu,
      identityButton,
      identityList: $("#onekanGoalIdentityContextList", menu),
      projectButton: $("[data-direction-context-action='projects']", menu),
      projectList: $("#onekanGoalProjectContextList", menu),
      goalButton: $("[data-direction-context-action='goals']", menu),
      goalList: $("#onekanIdentityGoalContextList", menu),
    };
  }

  const deleteButton = $("[data-context-action='delete']", menu);
  const makeButton = (action, label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hidden";
    button.dataset.directionContextAction = action;
    button.innerHTML = `${label} <span class="context-menu-arrow">›</span>`;
    button.setAttribute("role", "menuitem");
    return button;
  };
  const makeList = (id) => {
    const list = document.createElement("div");
    list.id = id;
    list.className = "onekan-direction-context-list hidden";
    list.setAttribute("role", "group");
    return list;
  };

  identityButton = makeButton("identity", "정체성 연결");
  const identityList = makeList("onekanGoalIdentityContextList");
  const projectButton = makeButton("projects", "프로젝트 연결");
  const projectList = makeList("onekanGoalProjectContextList");
  const goalButton = makeButton("goals", "목표 연결");
  const goalList = makeList("onekanIdentityGoalContextList");
  [identityButton, identityList, projectButton, projectList, goalButton, goalList].forEach((node) => menu.insertBefore(node, deleteButton));

  if (!$("#onekanDirectionContextStyle")) {
    const style = document.createElement("style");
    style.id = "onekanDirectionContextStyle";
    style.textContent = `
      .global-context-menu [data-direction-context-action]{align-items:center;justify-content:space-between}
      .global-context-menu [data-direction-context-action]:not(.hidden){display:flex}
      .onekan-direction-context-list{margin:3px 0;padding:3px;border-top:1px solid var(--line,#d2d7df);border-bottom:1px solid var(--line,#d2d7df);max-height:min(260px,55vh);overflow-y:auto;overscroll-behavior:contain}
      .onekan-direction-context-list button{display:grid;grid-template-columns:minmax(0,1fr) 18px;align-items:center;gap:8px}
      .onekan-direction-context-list .context-group-check{text-align:right;color:var(--accent,#7666a8)}
    `;
    document.head.appendChild(style);
  }
  return { menu, identityButton, identityList, projectButton, projectList, goalButton, goalList };
}

function hideDirectionParts(parts = ensureParts()) {
  if (!parts) return;
  [parts.identityButton, parts.projectButton, parts.goalButton].forEach((button) => button.classList.add("hidden"));
  [parts.identityList, parts.projectList, parts.goalList].forEach((list) => list.classList.add("hidden"));
}

function checks(selected) {
  return selected ? '<span class="context-group-check">✓</span>' : "<span></span>";
}

async function renderDirectionMenu() {
  if (rendering) return;
  const parts = ensureParts();
  if (!parts || !parts.menu.classList.contains("open") || !activeTarget) return hideDirectionParts(parts);
  rendering = true;
  try {
    const loaded = await readState();
    if (!loaded || !parts.menu.classList.contains("open")) return;
    const { state } = loaded;
    hideDirectionParts(parts);

    if (activeTarget.kind === "goal") {
      const goal = state.directionGoals.find((item) => item.id === activeTarget.id);
      if (!goal) return;
      parts.identityButton.classList.remove("hidden");
      parts.projectButton.classList.remove("hidden");
      parts.identityList.innerHTML = `<button type="button" data-connect-identity-id="" role="menuitemradio" aria-checked="${!goal.identityId}"><span>정체성 없음</span>${checks(!goal.identityId)}</button>${state.identities.map((identity) => {
        const selected = goal.identityId === identity.id;
        return `<button type="button" data-connect-identity-id="${esc(identity.id)}" role="menuitemradio" aria-checked="${selected}"><span>${esc(identity.title || "이름 없는 정체성")}</span>${checks(selected)}</button>`;
      }).join("")}`;
      const projects = state.projects.filter(isProject);
      parts.projectList.innerHTML = projects.length ? projects.map((project) => {
        const selected = project.goalId === goal.id;
        return `<button type="button" data-connect-project-id="${esc(project.id)}" role="menuitemcheckbox" aria-checked="${selected}"><span>${esc(project.title || "이름 없는 프로젝트")}</span>${checks(selected)}</button>`;
      }).join("") : '<button type="button" disabled><span>연결할 프로젝트가 없어요</span><span></span></button>';
    } else {
      const identity = state.identities.find((item) => item.id === activeTarget.id);
      if (!identity) return;
      parts.goalButton.classList.remove("hidden");
      parts.goalList.innerHTML = state.directionGoals.length ? state.directionGoals.map((goal) => {
        const selected = goal.identityId === identity.id;
        return `<button type="button" data-connect-goal-id="${esc(goal.id)}" role="menuitemcheckbox" aria-checked="${selected}"><span>${esc(goal.title || "이름 없는 목표")}</span>${checks(selected)}</button>`;
      }).join("") : '<button type="button" disabled><span>연결할 목표가 없어요</span><span></span></button>';
    }
  } catch (error) {
    console.error("방향 연결 메뉴 렌더링 실패", error);
    hideDirectionParts(parts);
  } finally {
    rendering = false;
  }
}

function closeOtherLists(parts, except) {
  $("#contextGroupList")?.classList.add("hidden");
  $("#contextProjectList")?.classList.add("hidden");
  $("#onekanProjectGoalContextList")?.classList.add("hidden");
  $("#onekanProjectStatusContextList")?.classList.add("hidden");
  [parts.identityList, parts.projectList, parts.goalList].forEach((list) => {
    if (list !== except) list.classList.add("hidden");
  });
}

function clampMenu(menu) {
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const top = Number.parseFloat(menu.style.top) || 8;
    menu.style.top = `${Math.max(8, Math.min(top, innerHeight - rect.height - 8))}px`;
  });
}

async function connectIdentity(identityId) {
  const target = activeTarget;
  if (target?.kind !== "goal") return;
  try {
    await writeState((state) => {
      const goal = state.directionGoals.find((item) => item.id === target.id);
      if (!goal) return;
      goal.identityId = identityId && state.identities.some((item) => item.id === identityId) ? identityId : null;
      goal.updatedAt = new Date().toISOString();
    });
    await renderDirectionMenu();
  } catch (error) {
    console.error(error);
    showToast("정체성을 연결하지 못했어요.");
  }
}

async function toggleProject(projectId) {
  const target = activeTarget;
  if (target?.kind !== "goal") return;
  try {
    await writeState((state) => {
      const project = state.projects.find((item) => item.id === projectId && isProject(item));
      if (!project) return;
      project.goalId = project.goalId === target.id ? null : target.id;
      project.updatedAt = new Date().toISOString();
    });
    await renderDirectionMenu();
  } catch (error) {
    console.error(error);
    showToast("프로젝트를 연결하지 못했어요.");
  }
}

async function toggleGoal(goalId) {
  const target = activeTarget;
  if (target?.kind !== "identity") return;
  try {
    await writeState((state) => {
      const goal = state.directionGoals.find((item) => item.id === goalId);
      if (!goal) return;
      goal.identityId = goal.identityId === target.id ? null : target.id;
      goal.updatedAt = new Date().toISOString();
    });
    await renderDirectionMenu();
  } catch (error) {
    console.error(error);
    showToast("목표를 연결하지 못했어요.");
  }
}

function installListeners() {
  document.addEventListener("contextmenu", (event) => {
    activeTarget = directionTarget(event.target);
  }, true);
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.("#globalContextMenu")) return;
    activeTarget = directionTarget(event.target);
  }, true);

  document.addEventListener("click", (event) => {
    const parts = ensureParts();
    if (!parts) return;
    const action = event.target.closest?.("[data-direction-context-action]");
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      const list = action.dataset.directionContextAction === "identity" ? parts.identityList
        : action.dataset.directionContextAction === "projects" ? parts.projectList
        : parts.goalList;
      const willOpen = list.classList.contains("hidden");
      closeOtherLists(parts, list);
      list.classList.toggle("hidden", !willOpen);
      clampMenu(parts.menu);
      return;
    }
    const identity = event.target.closest?.("[data-connect-identity-id]");
    if (identity) return connectIdentity(identity.dataset.connectIdentityId || "");
    const project = event.target.closest?.("[data-connect-project-id]");
    if (project) return toggleProject(project.dataset.connectProjectId);
    const goal = event.target.closest?.("[data-connect-goal-id]");
    if (goal) return toggleGoal(goal.dataset.connectGoalId);
  });

  const observer = new MutationObserver(() => {
    const menu = $("#globalContextMenu");
    if (menu?.classList.contains("open")) renderDirectionMenu();
    else hideDirectionParts();
  });
  const menu = $("#globalContextMenu");
  if (menu) observer.observe(menu, { attributes: true, attributeFilter: ["class"] });
}

function init() {
  if (document.documentElement.dataset.directionContextWired) return;
  document.documentElement.dataset.directionContextWired = "1";
  ensureParts();
  installListeners();
}

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) init();
supabase.auth.onAuthStateChange((_event, nextSession) => {
  if (nextSession?.user) init();
});
