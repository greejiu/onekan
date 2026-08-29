import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const DEFAULT_SECTION_ID = "goal-section-inbox";
const DEFAULT_SECTION_COLOR = "#8fa9c4";
const statusDefs = [
  { id: "before", label: "시작 전", color: "#9aa9b7" },
  { id: "doing", label: "진행 중", color: "#88b49a" },
  { id: "done", label: "달성", color: "#a69ab8" },
];
const archivedDef = { id: "archived", label: "보관", color: "#aaa59d" };

let state = null;
let user = null;
let selectedSection = sessionStorage.getItem("onekan-goal-section") || "all";
let showArchived = sessionStorage.getItem("onekan-goal-archive") === "1";
let rendering = false;
let renderTimer = null;

function ensureCss() {
  if ($('link[data-goal-board-v2-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/goal-board-v2.css?v=1";
  link.dataset.goalBoardV2Css = "1";
  document.head.appendChild(link);
}

function appDateKey() {
  const date = new Date();
  date.setHours(date.getHours() - 3);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sectionIdForLegacyGroup(groupId) {
  return `goal-section-${String(groupId || "default").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function ensureGoalStructure(current) {
  let changed = false;
  current.projects = Array.isArray(current.projects) ? current.projects : [];
  current.eventGroups = Array.isArray(current.eventGroups) ? current.eventGroups : [];
  const goals = current.projects.filter((item) => item?.kind === "goal");

  if (!Array.isArray(current.goalSections) || !current.goalSections.length) {
    current.goalSections = [{ id: DEFAULT_SECTION_ID, name: "미분류", color: DEFAULT_SECTION_COLOR, system: true, order: 0 }];
    const usedGroupIds = new Set(goals.map((goal) => goal.groupId).filter(Boolean));
    current.eventGroups.forEach((group, index) => {
      if (!usedGroupIds.has(group.id)) return;
      if (!group?.name || group.name.trim() === "기본") return;
      current.goalSections.push({
        id: sectionIdForLegacyGroup(group.id),
        name: group.name.trim(),
        color: group.color || DEFAULT_SECTION_COLOR,
        sourceGroupId: group.id,
        order: current.goalSections.length || index + 1,
      });
    });
    changed = true;
  }

  if (!current.goalSections.some((section) => section.id === DEFAULT_SECTION_ID)) {
    current.goalSections.unshift({ id: DEFAULT_SECTION_ID, name: "미분류", color: DEFAULT_SECTION_COLOR, system: true, order: -1 });
    changed = true;
  }

  const validSectionIds = new Set(current.goalSections.map((section) => section.id));
  for (const goal of goals) {
    if (goal.status === "closed") {
      goal.status = "archived";
      changed = true;
    }
    if (!["before", "doing", "done", "archived"].includes(goal.status)) {
      goal.status = "doing";
      changed = true;
    }
    if (!validSectionIds.has(goal.goalSectionId)) {
      const mapped = current.goalSections.find((section) => section.sourceGroupId && section.sourceGroupId === goal.groupId);
      goal.goalSectionId = mapped?.id || DEFAULT_SECTION_ID;
      changed = true;
    }
  }
  return changed;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = data?.data && typeof data.data === "object" ? data.data : {};
  const changed = ensureGoalStructure(state);
  if (changed) {
    const { error: saveError } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
    if (saveError) throw saveError;
    document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "goal-board-v2-migrate" } }));
  }
  return state;
}

function sections() {
  return [...(state?.goalSections || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.name || "").localeCompare(String(b.name || ""), "ko"));
}

function sectionOf(goal) {
  return sections().find((section) => section.id === goal.goalSectionId) || sections().find((section) => section.id === DEFAULT_SECTION_ID) || { id: DEFAULT_SECTION_ID, name: "미분류", color: DEFAULT_SECTION_COLOR };
}

function linkedProjects(goalId) {
  return (state?.projects || []).filter((item) => item?.kind === "project" && item.goalId === goalId);
}

function deadlineMeta(deadline) {
  if (!deadline) return null;
  const today = appDateKey();
  const a = new Date(`${today}T00:00:00`);
  const b = new Date(`${deadline}T00:00:00`);
  const diff = Math.round((b - a) / 86400000);
  const short = deadline.replace(/^\d{4}-/, "").replace("-", ".");
  if (diff < 0) return { text: `${short} · ${Math.abs(diff)}일 지남`, overdue: true };
  if (diff === 0) return { text: `${short} · 오늘`, overdue: false };
  return { text: `${short} · ${diff}일 남음`, overdue: false };
}

function goalCard(goal) {
  const section = sectionOf(goal);
  const projects = linkedProjects(goal.id);
  const done = projects.filter((project) => project.status === "done").length;
  const percent = projects.length ? Math.round((done / projects.length) * 100) : 0;
  const deadline = deadlineMeta(goal.deadline);
  return `<article class="ok-goal-card" style="--ok-section:${esc(section.color || DEFAULT_SECTION_COLOR)}" data-goal-v2-id="${esc(goal.id)}">
    <strong class="ok-goal-card-title">${esc(goal.title || "이름 없는 목표")}</strong>
    <div class="ok-goal-card-meta">
      <span class="ok-goal-section-badge">${esc(section.name || "미분류")}</span>
      ${deadline ? `<span class="ok-goal-deadline${deadline.overdue ? " overdue" : ""}">${esc(deadline.text)}</span>` : ""}
    </div>
    <div class="ok-goal-progress">
      <small>${projects.length ? `프로젝트 ${done}/${projects.length} 완료` : "연결된 프로젝트 없음"}</small>
      ${projects.length ? `<div class="ok-goal-progress-track"><div class="ok-goal-progress-value" style="width:${percent}%"></div></div>` : ""}
    </div>
  </article>`;
}

function ensureToolbar() {
  const page = $("#page-goals");
  if (!page) return null;
  let toolbar = $(".ok-goal-v2-toolbar", page);
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.className = "ok-goal-v2-toolbar";
    toolbar.innerHTML = `<div class="ok-goal-v2-toolbar-left"><label for="okGoalSectionSelect">섹션</label><select class="ok-goal-v2-section-select" id="okGoalSectionSelect"></select></div><button class="ok-goal-v2-archive-toggle" id="okGoalArchiveToggle" type="button"></button>`;
    const oldTabs = $("#goalStatusTabs", page);
    if (oldTabs) oldTabs.before(toolbar);
    else $(".page-head", page)?.after(toolbar);

    $("#okGoalSectionSelect", toolbar)?.addEventListener("change", (event) => {
      selectedSection = event.currentTarget.value || "all";
      sessionStorage.setItem("onekan-goal-section", selectedSection);
      renderBoard();
    });
    $("#okGoalArchiveToggle", toolbar)?.addEventListener("click", () => {
      showArchived = !showArchived;
      sessionStorage.setItem("onekan-goal-archive", showArchived ? "1" : "0");
      renderBoard();
    });
  }
  return toolbar;
}

function renderBoard() {
  const root = $("#goalSections");
  if (!root || !state) return;
  const toolbar = ensureToolbar();
  const allSections = sections();
  if (selectedSection !== "all" && !allSections.some((section) => section.id === selectedSection)) selectedSection = "all";

  const select = $("#okGoalSectionSelect", toolbar);
  if (select) {
    select.innerHTML = `<option value="all">전체</option>${allSections.map((section) => `<option value="${esc(section.id)}">${esc(section.name)}</option>`).join("")}`;
    select.value = selectedSection;
  }
  const archiveButton = $("#okGoalArchiveToggle", toolbar);
  if (archiveButton) {
    archiveButton.textContent = showArchived ? "보관 숨기기" : "보관 보기";
    archiveButton.classList.toggle("active", showArchived);
  }

  let goals = (state.projects || []).filter((item) => item?.kind === "goal");
  if (selectedSection !== "all") goals = goals.filter((goal) => goal.goalSectionId === selectedSection);
  const defs = showArchived ? [...statusDefs, archivedDef] : statusDefs;
  const columns = defs.map((definition) => {
    const items = goals.filter((goal) => goal.status === definition.id);
    return `<section class="ok-goal-column" style="--ok-status-color:${definition.color}" data-goal-v2-status="${definition.id}">
      <div class="ok-goal-column-head"><span></span><strong>${definition.label}</strong><small>${items.length}</small></div>
      <div class="ok-goal-column-list">${items.length ? items.map(goalCard).join("") : '<div class="ok-goal-column-empty">여기에 목표가 표시돼요.</div>'}</div>
    </section>`;
  }).join("");
  root.innerHTML = `<div class="ok-goal-board-scroll"><div class="ok-goal-board-v2" style="--ok-goal-columns:${defs.length}">${columns}</div></div>`;
}

async function renderV2() {
  if (rendering) return;
  rendering = true;
  try {
    await readState();
    ensureToolbar();
    renderBoard();
  } catch (error) {
    console.error("목표 현황 v2 렌더링 실패", error);
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 80) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderV2, delay);
}

function wire() {
  if (document.documentElement.dataset.goalBoardV2Wired) return;
  document.documentElement.dataset.goalBoardV2Wired = "1";
  ensureCss();

  $(".nav-item[data-page='goals']")?.addEventListener("click", () => scheduleRender(120));
  document.addEventListener("onekan:state-changed", (event) => {
    if (event.detail?.source === "goal-board-v2-migrate") return;
    scheduleRender(140);
  });

  const root = $("#goalSections");
  if (root) {
    const observer = new MutationObserver(() => {
      if (rendering) return;
      if (!$(".ok-goal-board-v2", root)) scheduleRender(30);
    });
    observer.observe(root, { childList: true });
  }

  window.addEventListener("load", () => scheduleRender(180), { once: true });
}

wire();
const { data: { session } } = await supabase.auth.getSession();
if (session?.user) scheduleRender(60);
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) scheduleRender(80);
});
