import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const DEFAULT_GROUP_ID = "goal-section-inbox";
const DEFAULT_COLOR = "#8fa9c4";
const STATUSES = [
  { id: "before", label: "시작 전", color: "#9aa9b7" },
  { id: "doing", label: "하는 중", color: "#88b49a" },
  { id: "done", label: "달성", color: "#a69ab8" },
  { id: "archived", label: "보관", color: "#aaa59d" },
];

let timer = null;
let rendering = false;

function ensureStyle() {
  if ($('style[data-goal-group-board-style]')) return;
  const style = document.createElement("style");
  style.dataset.goalGroupBoardStyle = "1";
  style.textContent = `
    #page-goals .ok-goal-v2-toolbar-right{display:none!important}
    #page-goals .ok-goal-group-stack{display:grid;gap:14px}
    #page-goals .ok-goal-group-block{display:grid;gap:8px;padding:11px;border:1px solid var(--line);border-radius:14px;background:#fff}
    #page-goals .ok-goal-group-head{display:flex;align-items:center;gap:7px;min-height:28px;padding:0 2px}
    #page-goals .ok-goal-group-dot{width:9px;height:9px;flex:0 0 9px;border-radius:50%;background:var(--ok-section,#8fa9c4)}
    #page-goals .ok-goal-group-head strong{font-size:13px}
    #page-goals .ok-goal-group-head small{margin-left:auto;color:var(--muted);font-size:9px}
    #page-goals .ok-goal-board-v2.ok-goal-fixed-status-board{grid-template-columns:repeat(4,minmax(190px,1fr));min-width:800px}
    #page-goals .ok-goal-group-block .ok-goal-column{min-height:250px;padding:8px}
    #page-goals .ok-goal-group-block .ok-goal-column-list{min-height:165px}
    #page-goals .ok-goal-group-block .ok-goal-section-badge{display:none}
    #page-goals .ok-goal-board-empty{padding:28px;border:1px dashed var(--line);border-radius:12px;color:var(--muted);font-size:11px;text-align:center}
    @media(max-width:700px){
      #page-goals .ok-goal-group-stack{gap:10px}
      #page-goals .ok-goal-group-block{padding:9px}
      #page-goals .ok-goal-board-v2.ok-goal-fixed-status-board{grid-template-columns:repeat(4,minmax(235px,78vw));min-width:max-content}
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

function statusBoard(state, group, goals) {
  const columns = STATUSES.map((status) => {
    const items = goals.filter((goal) => goal.status === status.id);
    return `<section class="ok-goal-column" style="--ok-status-color:${status.color}" data-goal-v2-status="${status.id}" data-goal-v2-group-id="${esc(group.id)}">
      <div class="ok-goal-column-head"><span></span><strong>${status.label}</strong><small>${items.length}</small></div>
      <div class="ok-goal-column-list">${items.length ? items.map((goal) => goalCard(state, goal, group)).join("") : '<div class="ok-goal-column-empty">여기에 목표가 표시돼요.</div>'}</div>
    </section>`;
  }).join("");
  return `<div class="ok-goal-board-scroll"><div class="ok-goal-board-v2 ok-goal-fixed-status-board" style="--ok-goal-columns:4">${columns}</div></div>`;
}

function relabelUi() {
  const page = $("#page-goals");
  if (!page) return;
  const toolbar = $(".ok-goal-v2-toolbar", page);
  const label = $("label[for='okGoalSectionSelect']", toolbar);
  if (label) label.textContent = "그룹";
  const manage = $("#okGoalSectionManage", toolbar);
  if (manage) manage.textContent = "그룹 관리";
  $(".ok-goal-v2-toolbar-right", toolbar)?.remove();

  const manager = $("#okGoalSectionManager", page);
  const managerTitle = $(".ok-goal-section-manager-head strong", manager);
  if (managerTitle) managerTitle.textContent = "그룹 관리";
  const managerHint = $(".ok-goal-section-manager-head small", manager);
  if (managerHint) managerHint.textContent = "목표를 분류할 그룹과 색상을 정해요.";
  manager?.querySelectorAll(".ok-goal-section-name").forEach((input) => input.setAttribute("aria-label", "그룹 이름"));
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

async function render() {
  if (rendering) return;
  const page = $("#page-goals");
  const root = $("#goalSections", page);
  const select = $("#okGoalSectionSelect", page);
  if (!page || !root || !select) return;
  rendering = true;
  try {
    ensureStyle();
    relabelUi();
    const state = await readState();
    if (!state) return;
    const groups = groupsOf(state);
    const goals = state.projects.filter((item) => item?.kind === "goal");
    const selected = select.value || "all";

    if (selected === "all") {
      const blocks = groups.map((group) => {
        const groupGoals = goals.filter((goal) => goal.goalSectionId === group.id);
        return `<section class="ok-goal-group-block" style="--ok-section:${esc(group.color || DEFAULT_COLOR)}" data-goal-v2-group-block="${esc(group.id)}">
          <div class="ok-goal-group-head"><span class="ok-goal-group-dot"></span><strong>${esc(group.name || "미분류")}</strong><small>${groupGoals.length}개</small></div>
          ${statusBoard(state, group, groupGoals)}
        </section>`;
      }).join("");
      root.innerHTML = blocks ? `<div class="ok-goal-group-stack">${blocks}</div>` : '<div class="ok-goal-board-empty">아직 그룹이 없어요.</div>';
    } else {
      const group = groups.find((item) => item.id === selected) || groups[0];
      if (!group) root.innerHTML = '<div class="ok-goal-board-empty">아직 그룹이 없어요.</div>';
      else root.innerHTML = statusBoard(state, group, goals.filter((goal) => goal.goalSectionId === group.id));
    }
    root.dataset.goalGroupView = "1";
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

  page.addEventListener("change", (event) => {
    if (event.target.id === "okGoalSectionSelect") schedule(40);
  });
  page.addEventListener("click", () => setTimeout(relabelUi, 0));
  $(".nav-item[data-page='goals']")?.addEventListener("click", () => schedule(220));
  document.addEventListener("onekan:state-changed", () => schedule(230));

  const observer = new MutationObserver(() => {
    relabelUi();
    if (!$(".ok-goal-group-stack", root) && !$(".ok-goal-fixed-status-board", root)) schedule(60);
  });
  observer.observe(root, { childList: true, subtree: false });

  window.addEventListener("load", () => schedule(260), { once: true });
  schedule(260);
}

wire();
