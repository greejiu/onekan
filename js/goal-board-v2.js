import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const DEFAULT_SECTION_ID = "goal-section-inbox";
const DEFAULT_SECTION_COLOR = "#8fa9c4";
const SECTION_PALETTE = ["#8fa9c4", "#9fbf9f", "#d7b48b", "#ad9fc4", "#d7a7b6", "#8fbfc1", "#e1c66f", "#a7a7a2"];
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
let pendingSectionColor = SECTION_PALETTE[0];

function ensureCss() {
  if ($('link[data-goal-board-v2-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/goal-board-v2.css?v=2";
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

async function saveState(source = "goal-board-v2-sections") {
  if (!state || !user) return;
  ensureGoalStructure(state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source } }));
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

function paletteMarkup(selected, attr) {
  return `<div class="ok-goal-section-palette">${SECTION_PALETTE.map((color) => `<button class="ok-goal-color-swatch${color.toLowerCase() === String(selected || "").toLowerCase() ? " active" : ""}" style="--ok-swatch:${color}" type="button" ${attr}="${color}" aria-label="${color} 색상"></button>`).join("")}</div>`;
}

function ensureSectionDeleteDialog() {
  let dialog = $("#okGoalSectionDeleteDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "okGoalSectionDeleteDialog";
  dialog.className = "ok-goal-section-delete-dialog";
  dialog.innerHTML = `<form method="dialog">
    <h3>섹션 삭제</h3>
    <p><strong id="okGoalDeleteSectionName"></strong> 섹션을 삭제합니다.</p>
    <label id="okGoalDeleteMoveField"><span>안의 목표 이동</span><select id="okGoalDeleteMoveTarget"></select></label>
    <small id="okGoalDeleteSummary"></small>
    <div class="ok-goal-section-delete-actions"><button class="soft-btn" value="cancel" type="submit">취소</button><button class="soft-btn danger-text" id="okGoalDeleteConfirm" type="button">삭제</button></div>
  </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

function ensureToolbar() {
  const page = $("#page-goals");
  if (!page) return null;
  let toolbar = $(".ok-goal-v2-toolbar", page);
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.className = "ok-goal-v2-toolbar";
    toolbar.innerHTML = `<div class="ok-goal-v2-toolbar-left"><label for="okGoalSectionSelect">섹션</label><select class="ok-goal-v2-section-select" id="okGoalSectionSelect"></select><button class="ok-goal-v2-section-manage" id="okGoalSectionManage" type="button">섹션 관리</button></div><div class="ok-goal-v2-toolbar-right"><button class="ok-goal-v2-archive-toggle" id="okGoalArchiveToggle" type="button"></button></div>`;
    const oldTabs = $("#goalStatusTabs", page);
    if (oldTabs) oldTabs.before(toolbar);
    else $(".page-head", page)?.after(toolbar);

    const manager = document.createElement("section");
    manager.className = "ok-goal-section-manager";
    manager.id = "okGoalSectionManager";
    manager.hidden = true;
    toolbar.after(manager);

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
  ensureSectionDeleteDialog();
  return toolbar;
}

function setManagerMessage(text = "", danger = false) {
  const node = $("#okGoalSectionManagerMessage");
  if (!node) return;
  node.textContent = text;
  node.classList.toggle("danger", danger);
}

function renderSectionManager() {
  const manager = $("#okGoalSectionManager");
  if (!manager || !state) return;
  const rows = sections().map((section) => `<div class="ok-goal-section-row" data-goal-section-row="${esc(section.id)}" data-section-color="${esc(section.color || DEFAULT_SECTION_COLOR)}">
    <div class="ok-goal-section-row-top">
      <input class="ok-goal-section-name" type="text" maxlength="40" value="${esc(section.name || "")}" ${section.system ? "disabled" : ""} aria-label="섹션 이름" />
      <div class="ok-goal-section-row-actions">
        ${section.system ? '<span class="ok-goal-system-badge">기본</span>' : `<button class="ok-goal-section-save" data-goal-section-save="${esc(section.id)}" type="button">저장</button><button class="ok-goal-section-delete" data-goal-section-delete="${esc(section.id)}" type="button">삭제</button>`}
      </div>
    </div>
    ${paletteMarkup(section.color || DEFAULT_SECTION_COLOR, "data-goal-section-color")}
    ${section.system ? `<button class="ok-goal-section-save system-color" data-goal-section-save="${esc(section.id)}" type="button">색상 저장</button>` : ""}
  </div>`).join("");

  manager.innerHTML = `<div class="ok-goal-section-manager-head"><div><strong>섹션 관리</strong><small>목표를 분류할 섹션과 색상을 정해요.</small></div><button id="okGoalSectionManagerClose" type="button" aria-label="닫기">×</button></div>
    <div class="ok-goal-section-list">${rows}</div>
    <div class="ok-goal-section-add">
      <div class="ok-goal-section-add-top"><input id="okGoalSectionNewName" type="text" maxlength="40" placeholder="새 섹션 이름" aria-label="새 섹션 이름" /><button id="okGoalSectionAddBtn" type="button">추가</button></div>
      ${paletteMarkup(pendingSectionColor, "data-goal-section-new-color")}
    </div>
    <p class="ok-goal-section-manager-message" id="okGoalSectionManagerMessage" aria-live="polite"></p>`;
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

async function addSection() {
  const input = $("#okGoalSectionNewName");
  const name = input?.value.trim() || "";
  if (!name) {
    setManagerMessage("섹션 이름을 입력해 주세요.", true);
    input?.focus();
    return;
  }
  if (sections().some((section) => String(section.name).trim().toLowerCase() === name.toLowerCase())) {
    setManagerMessage("같은 이름의 섹션이 이미 있어요.", true);
    input?.focus();
    return;
  }
  const maxOrder = Math.max(0, ...sections().map((section) => Number(section.order || 0)));
  state.goalSections.push({ id: `goal-section-${crypto.randomUUID()}`, name, color: pendingSectionColor, order: maxOrder + 1 });
  await saveState();
  pendingSectionColor = SECTION_PALETTE[(state.goalSections.length - 1) % SECTION_PALETTE.length];
  renderBoard();
  renderSectionManager();
  setManagerMessage(`‘${name}’ 섹션을 추가했어요.`);
}

async function saveSection(sectionId, row) {
  const section = state.goalSections.find((entry) => entry.id === sectionId);
  if (!section || !row) return;
  const nameInput = $(".ok-goal-section-name", row);
  const nextName = section.system ? section.name : nameInput?.value.trim() || "";
  if (!nextName) {
    setManagerMessage("섹션 이름은 비워둘 수 없어요.", true);
    nameInput?.focus();
    return;
  }
  if (!section.system && sections().some((entry) => entry.id !== sectionId && String(entry.name).trim().toLowerCase() === nextName.toLowerCase())) {
    setManagerMessage("같은 이름의 섹션이 이미 있어요.", true);
    nameInput?.focus();
    return;
  }
  section.name = nextName;
  section.color = row.dataset.sectionColor || section.color || DEFAULT_SECTION_COLOR;
  await saveState();
  renderBoard();
  renderSectionManager();
  setManagerMessage(`‘${section.name}’ 섹션을 저장했어요.`);
}

function openDeleteDialog(sectionId) {
  const section = state.goalSections.find((entry) => entry.id === sectionId && !entry.system);
  if (!section) return;
  const dialog = ensureSectionDeleteDialog();
  const goals = (state.projects || []).filter((item) => item?.kind === "goal" && item.goalSectionId === sectionId);
  const destinations = sections().filter((entry) => entry.id !== sectionId);
  $("#okGoalDeleteSectionName", dialog).textContent = section.name;
  $("#okGoalDeleteSummary", dialog).textContent = goals.length ? `목표 ${goals.length}개가 선택한 섹션으로 이동합니다.` : "이 섹션에는 목표가 없어요.";
  const select = $("#okGoalDeleteMoveTarget", dialog);
  select.innerHTML = destinations.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join("");
  select.value = destinations.some((entry) => entry.id === DEFAULT_SECTION_ID) ? DEFAULT_SECTION_ID : destinations[0]?.id || "";
  $("#okGoalDeleteMoveField", dialog).hidden = goals.length === 0;
  $("#okGoalDeleteConfirm", dialog).dataset.sectionId = sectionId;
  dialog.showModal();
}

async function confirmDeleteSection(sectionId) {
  const section = state.goalSections.find((entry) => entry.id === sectionId && !entry.system);
  if (!section) return;
  const dialog = $("#okGoalSectionDeleteDialog");
  const targetId = $("#okGoalDeleteMoveTarget", dialog)?.value || DEFAULT_SECTION_ID;
  (state.projects || []).forEach((item) => {
    if (item?.kind === "goal" && item.goalSectionId === sectionId) item.goalSectionId = targetId;
  });
  state.goalSections = state.goalSections.filter((entry) => entry.id !== sectionId);
  if (selectedSection === sectionId) {
    selectedSection = targetId || "all";
    sessionStorage.setItem("onekan-goal-section", selectedSection);
  }
  await saveState();
  dialog?.close();
  renderBoard();
  renderSectionManager();
  setManagerMessage(`‘${section.name}’ 섹션을 삭제했어요.`);
}

async function renderV2() {
  if (rendering) return;
  rendering = true;
  try {
    await readState();
    ensureToolbar();
    renderBoard();
    renderSectionManager();
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
    if (String(event.detail?.source || "").startsWith("goal-board-v2")) return;
    scheduleRender(140);
  });

  const page = $("#page-goals");
  page?.addEventListener("click", async (event) => {
    const manage = event.target.closest("#okGoalSectionManage");
    if (manage) {
      const manager = $("#okGoalSectionManager");
      manager.hidden = !manager.hidden;
      manage.classList.toggle("active", !manager.hidden);
      if (!manager.hidden) renderSectionManager();
      return;
    }
    if (event.target.closest("#okGoalSectionManagerClose")) {
      const manager = $("#okGoalSectionManager");
      manager.hidden = true;
      $("#okGoalSectionManage")?.classList.remove("active");
      return;
    }
    const newColor = event.target.closest("[data-goal-section-new-color]");
    if (newColor) {
      pendingSectionColor = newColor.dataset.goalSectionNewColor;
      newColor.parentElement.querySelectorAll(".ok-goal-color-swatch").forEach((swatch) => swatch.classList.toggle("active", swatch === newColor));
      return;
    }
    const sectionColor = event.target.closest("[data-goal-section-color]");
    if (sectionColor) {
      const row = sectionColor.closest("[data-goal-section-row]");
      if (!row) return;
      row.dataset.sectionColor = sectionColor.dataset.goalSectionColor;
      sectionColor.parentElement.querySelectorAll(".ok-goal-color-swatch").forEach((swatch) => swatch.classList.toggle("active", swatch === sectionColor));
      return;
    }
    if (event.target.closest("#okGoalSectionAddBtn")) {
      await addSection();
      return;
    }
    const save = event.target.closest("[data-goal-section-save]");
    if (save) {
      await saveSection(save.dataset.goalSectionSave, save.closest("[data-goal-section-row]"));
      return;
    }
    const remove = event.target.closest("[data-goal-section-delete]");
    if (remove) openDeleteDialog(remove.dataset.goalSectionDelete);
  });

  page?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.target.id === "okGoalSectionNewName") {
      event.preventDefault();
      $("#okGoalSectionAddBtn")?.click();
      return;
    }
    const row = event.target.closest?.("[data-goal-section-row]");
    if (row && event.target.classList.contains("ok-goal-section-name")) {
      event.preventDefault();
      $("[data-goal-section-save]", row)?.click();
    }
  });

  $("#okGoalSectionDeleteDialog")?.addEventListener("click", async (event) => {
    const confirm = event.target.closest("#okGoalDeleteConfirm");
    if (!confirm?.dataset.sectionId) return;
    await confirmDeleteSection(confirm.dataset.sectionId);
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
