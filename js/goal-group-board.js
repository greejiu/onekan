import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const $$ = (selector, root = document) => [...(root?.querySelectorAll?.(selector) || [])];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const DEFAULT_GROUP_ID = "goal-section-inbox";
const DEFAULT_COLOR = "#8fa9c4";
const FILTERS = [
  { id: "all", label: "전체", status: "doing" },
  { id: "before", label: "시작 전", status: "before" },
  { id: "doing", label: "하는 중", status: "doing" },
  { id: "done", label: "완료", status: "done" },
  { id: "archived", label: "보관", status: "archived" },
];

let timer = null;
let rendering = false;
let activeFilter = sessionStorage.getItem("onekan-goal-filter") || "all";

function ensureStyle() {
  if ($('style[data-goal-group-board-style]')) return;
  const style = document.createElement("style");
  style.dataset.goalGroupBoardStyle = "1";
  style.textContent = `
    #page-goals .ok-goal-v2-toolbar{justify-content:flex-end}
    #page-goals .ok-goal-v2-toolbar-left>label,
    #page-goals #okGoalSectionSelect,
    #page-goals .ok-goal-v2-toolbar-right{display:none!important}
    #page-goals #okGoalSectionManage{margin-left:auto}
    #page-goals #goalStatusTabs{display:flex!important;gap:4px;margin:0 0 12px;padding:3px;width:max-content;max-width:100%;overflow-x:auto}
    #page-goals #goalStatusTabs button{white-space:nowrap}
    #page-goals .ok-goal-group-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;align-items:start}
    #page-goals .ok-goal-group-board{display:grid;gap:8px;padding:10px;border:1px solid var(--line);border-radius:14px;background:#fff;min-width:0}
    #page-goals .ok-goal-group-head{display:flex;align-items:center;gap:7px;min-height:28px;padding:0 2px}
    #page-goals .ok-goal-group-dot{width:9px;height:9px;flex:0 0 9px;border-radius:50%;background:var(--ok-section,#8fa9c4)}
    #page-goals .ok-goal-group-head strong{font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #page-goals .ok-goal-group-head small{margin-left:auto;color:var(--muted);font-size:9px;white-space:nowrap}
    #page-goals .ok-goal-group-board .ok-goal-column{min-height:150px;padding:7px;border-radius:10px}
    #page-goals .ok-goal-group-board .ok-goal-column-head{display:none}
    #page-goals .ok-goal-group-board .ok-goal-column-list{min-height:92px;gap:6px}
    #page-goals .ok-goal-group-board .ok-goal-section-badge{display:none}
    #page-goals .ok-goal-group-board .ok-goal-column-empty{min-height:72px;display:grid;place-items:center}
    #page-goals .ok-goal-board-empty{padding:28px;border:1px dashed var(--line);border-radius:12px;color:var(--muted);font-size:11px;text-align:center}
    #page-goals #goalStatusTabs button.ok-goal-tab-drop{outline:2px solid var(--accent,#8fa9c4);outline-offset:1px}
    @media(max-width:700px){
      #page-goals .ok-goal-group-grid{grid-template-columns:1fr;gap:9px}
      #page-goals .ok-goal-group-board{padding:9px}
      #page-goals #goalStatusTabs{width:100%}
    }
  `;
  document.head.appendChild(style);
}

function appDateKey() {
  const date = new Date();
  date.setHours(date.getHours() - 3);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function deadlineMeta(deadline) {
  if (!deadline) return null;
  const today = new Date(`${appDateKey()}T00:00:00`);
  const due = new Date(`${deadline}T00:00:00`);
  const diff = Math.round((due - today) / 86400000);
  const short = String(deadline).replace(/^\d{4}-/, "").replace("-", ".");
  if (diff < 0) return { text: `${short} · ${Math.abs(diff)}일 지남`, overdue: true };
  if (diff === 0) return { text: `${short} · 오늘`, overdue: false };
  return { text: `${short} · ${diff}일 남음`, overdue: false };
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.goalSections = Array.isArray(state.goalSections) && state.goalSections.length
    ? state.goalSections
    : [{ id: DEFAULT_GROUP_ID, name: "미분류", color: DEFAULT_COLOR, system: true, order: 0 }];
  return state;
}

function groupsOf(state) {
  return [...state.goalSections].sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.name || "").localeCompare(String(b.name || ""), "ko"));
}

function linkedProjects(state, goalId) {
  return state.projects.filter((item) => item?.kind === "project" && item.goalId === goalId);
}

function goalCard(state, goal, group) {
  const projects = linkedProjects(state, goal.id);
  const done = projects.filter((project) => project.status === "done").length;
  const percent = projects.length ? Math.round((done / projects.length) * 100) : 0;
  const deadline = deadlineMeta(goal.deadline);
  return `<article class="ok-goal-card" style="--ok-section:${esc(group.color || DEFAULT_COLOR)}" data-goal-v2-id="${esc(goal.id)}">
    <strong class="ok-goal-card-title">${esc(goal.title || "이름 없는 목표")}</strong>
    <div class="ok-goal-card-meta">
      <span class="ok-goal-section-badge">${esc(group.name || "미분류")}</span>
      ${deadline ? `<span class="ok-goal-deadline${deadline.overdue ? " overdue" : ""}">${esc(deadline.text)}</span>` : ""}
      ${projects.length ? `<span class="ok-goal-progress-text">프로젝트 ${done}/${projects.length}</span>` : ""}
    </div>
    ${projects.length ? `<div class="ok-goal-progress-track"><div class="ok-goal-progress-value" style="width:${percent}%"></div></div>` : ""}
  </article>`;
}

function currentStatus() {
  return FILTERS.find((item) => item.id === activeFilter)?.status || "doing";
}

function renderTabs() {
  const tabs = $("#goalStatusTabs", $("#page-goals"));
  if (!tabs) return;
  if (!FILTERS.some((item) => item.id === activeFilter)) activeFilter = "all";
  tabs.innerHTML = FILTERS.map((item) => `<button class="${item.id === activeFilter ? "active" : ""}" data-goal-board-filter="${item.id}" data-goal-board-status="${item.status}" type="button">${item.label}</button>`).join("");
  tabs.setAttribute("aria-label", "목표 상태 보기");
}

function relabelUi() {
  const page = $("#page-goals");
  if (!page) return;
  const toolbar = $(".ok-goal-v2-toolbar", page);
  const select = $("#okGoalSectionSelect", toolbar);
  if (select) select.value = "all";
  const manage = $("#okGoalSectionManage", toolbar);
  if (manage) manage.textContent = "그룹 관리";
  $(".ok-goal-v2-toolbar-right", toolbar)?.remove();

  const manager = $("#okGoalSectionManager", page);
  const managerTitle = $(".ok-goal-section-manager-head strong", manager);
  if (managerTitle) managerTitle.textContent = "그룹 관리";
  const managerHint = $(".ok-goal-section-manager-head small", manager);
  if (managerHint) managerHint.textContent = "목표를 분류할 그룹과 색상을 정해요.";
  $$(".ok-goal-section-name", manager).forEach((input) => input.setAttribute("aria-label", "그룹 이름"));
  const newName = $("#okGoalSectionNewName", manager);
  if (newName) {
    newName.placeholder = "새 그룹 이름";
    newName.setAttribute("aria-label", "새 그룹 이름");
  }

  const dialog = $("#okGoalSectionDeleteDialog");
  const title = $("h3", dialog);
  if (title) title.textContent = "그룹 삭제";
  const paragraph = $("p", dialog);
  if (paragraph) {
    [...paragraph.childNodes].forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) node.textContent = node.textContent.replace("섹션", "그룹");
    });
  }
  const summary = $("#okGoalDeleteSummary", dialog);
  if (summary) summary.textContent = summary.textContent.replaceAll("섹션", "그룹");
}

function groupBoard(state, group, goals, status) {
  const items = goals.filter((goal) => goal.goalSectionId === group.id && goal.status === status);
  return `<section class="ok-goal-group-board" style="--ok-section:${esc(group.color || DEFAULT_COLOR)}" data-goal-v2-group-block="${esc(group.id)}">
    <div class="ok-goal-group-head"><span class="ok-goal-group-dot"></span><strong>${esc(group.name || "미분류")}</strong><small>${items.length}개</small></div>
    <section class="ok-goal-column" data-goal-v2-status="${status}" data-goal-v2-group-id="${esc(group.id)}">
      <div class="ok-goal-column-head"><strong>${esc(FILTERS.find((item) => item.status === status && item.id !== "all")?.label || "하는 중")}</strong><small>${items.length}</small></div>
      <div class="ok-goal-column-list">${items.length ? items.map((goal) => goalCard(state, goal, group)).join("") : '<div class="ok-goal-column-empty">아직 목표가 없어요.</div>'}</div>
    </section>
  </section>`;
}

async function render() {
  if (rendering) return;
  const page = $("#page-goals");
  const root = $("#goalSections", page);
  if (!page || !root) return;
  rendering = true;
  try {
    ensureStyle();
    renderTabs();
    relabelUi();
    const state = await readState();
    if (!state) return;
    const groups = groupsOf(state);
    const goals = state.projects.filter((item) => item?.kind === "goal");
    const status = currentStatus();
    const boards = groups.map((group) => groupBoard(state, group, goals, status)).join("");
    root.innerHTML = boards ? `<div class="ok-goal-group-grid" data-goal-group-view="${esc(activeFilter)}">${boards}</div>` : '<div class="ok-goal-board-empty">아직 그룹이 없어요.</div>';
    root.dataset.goalGroupView = "1";
    renderTabs();
    relabelUi();
  } catch (error) {
    console.error("목표 그룹 보기 렌더링 실패", error);
  } finally {
    rendering = false;
  }
}

function schedule(delay = 80) {
  clearTimeout(timer);
  timer = setTimeout(render, delay);
}

function wire() {
  if (document.documentElement.dataset.goalGroupBoardWired) return;
  document.documentElement.dataset.goalGroupBoardWired = "1";
  ensureStyle();
  const page = $("#page-goals");
  const root = $("#goalSections", page);
  if (!page || !root) return;

  page.addEventListener("click", (event) => {
    const filter = event.target.closest?.("[data-goal-board-filter]");
    if (filter) {
      activeFilter = filter.dataset.goalBoardFilter || "all";
      sessionStorage.setItem("onekan-goal-filter", activeFilter);
      schedule(0);
      return;
    }
    setTimeout(relabelUi, 0);
  });
  $(".nav-item[data-page='goals']")?.addEventListener("click", () => schedule(220));
  document.addEventListener("onekan:state-changed", () => schedule(220));

  const observer = new MutationObserver(() => {
    relabelUi();
    if (!$(".ok-goal-group-grid", root)) schedule(60);
  });
  observer.observe(root, { childList: true, subtree: false });

  window.addEventListener("load", () => schedule(260), { once: true });
  schedule(260);
}

wire();
