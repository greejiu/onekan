import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const uid = () => crypto.randomUUID();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

let currentUser = null;
let managementState = null;
let selectedSectionId = "all";
let renderTimer = null;

function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  state.managementSections = Array.isArray(state.managementSections) ? state.managementSections : [];
  state.managementGroups = Array.isArray(state.managementGroups) ? state.managementGroups : [];
  state.managementItems = Array.isArray(state.managementItems) ? state.managementItems : [];
  state.managementLogs = Array.isArray(state.managementLogs) ? state.managementLogs : [];
  return state;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user || null;
  if (!currentUser) {
    managementState = null;
    return null;
  }
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) throw error;
  managementState = normalizeState(data?.data);
  return managementState;
}

async function writeState(mutator) {
  await readState();
  if (!managementState || !currentUser) return false;
  mutator(managementState);
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: currentUser.id, data: managementState }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management" } }));
  $("#reloadCloudBtn")?.click();
  scheduleRender(100);
  return true;
}

function ensureShell() {
  if (!$("link[data-onekan-management-style]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./css/management.css?v=1";
    link.dataset.onekanManagementStyle = "1";
    document.head.appendChild(link);
  }

  const nav = $(".sidebar .nav");
  if (nav && !nav.querySelector('[data-page="management"]')) {
    const button = document.createElement("button");
    button.className = "nav-item";
    button.type = "button";
    button.dataset.page = "management";
    button.innerHTML = '<span class="nav-icon">▦</span><span class="nav-label">관리</span>';
    const goals = nav.querySelector('[data-page="goals"]');
    nav.insertBefore(button, goals || null);
  }

  const main = $("main.main");
  if (main && !$("#page-management")) {
    const page = document.createElement("section");
    page.className = "page management-page";
    page.id = "page-management";
    page.innerHTML = `
      <div class="page-head management-page-head">
        <div><h1 class="page-title">관리</h1></div>
      </div>

      <div class="management-toolbar">
        <label class="management-section-picker">
          <span class="sr-only">관리 섹션 선택</span>
          <select id="managementSectionSelect" aria-label="관리 섹션 선택"></select>
        </label>

        <div class="management-section-create-wrap">
          <button class="soft-btn management-section-add-button" id="managementSectionAddButton" type="button">섹션 추가&nbsp; ＋</button>
          <form class="management-section-form" id="managementSectionForm" autocomplete="off" hidden>
            <input id="managementSectionName" type="text" maxlength="40" placeholder="새 섹션 이름" aria-label="새 관리 섹션 이름" />
            <button class="primary-btn" type="submit">추가</button>
            <button class="soft-btn" id="managementSectionCancel" type="button">취소</button>
          </form>
        </div>
      </div>

      <div id="managementContent" class="management-content"></div>`;

    const notesPage = $("#page-notes");
    if (notesPage?.nextSibling) main.insertBefore(page, notesPage.nextSibling);
    else main.appendChild(page);
  }
}

function sectionOptions() {
  const sections = managementState?.managementSections || [];
  return `<option value="all">전체</option>${sections.map((section) => `<option value="${esc(section.id)}">${esc(section.name)}</option>`).join("")}`;
}

function renderAllSections() {
  const root = $("#managementContent");
  const sections = managementState?.managementSections || [];
  if (!root) return;
  if (!sections.length) {
    root.innerHTML = `
      <div class="management-empty">
        <strong>아직 관리 섹션이 없어요.</strong>
        <span>예: 집안일, 치즈, 기기 관리처럼 큰 주제부터 만들어보세요.</span>
      </div>`;
    return;
  }
  root.innerHTML = `<div class="management-section-board-grid">${sections.map((section) => {
    const groupCount = managementState.managementGroups.filter((group) => group.sectionId === section.id).length;
    const itemCount = managementState.managementItems.filter((item) => item.sectionId === section.id).length;
    return `
      <section class="management-section-board" data-management-section-id="${esc(section.id)}">
        <div class="management-section-board-head">
          <strong>${esc(section.name)}</strong>
          <button class="management-board-open" data-management-open-section="${esc(section.id)}" type="button" aria-label="${esc(section.name)} 열기">›</button>
        </div>
        <div class="management-section-board-body">
          <span>${groupCount ? `${groupCount}개 그룹` : "그룹 없음"}</span>
          <small>${itemCount ? `${itemCount}개 항목` : "다음 단계에서 그룹과 항목을 추가해요."}</small>
        </div>
      </section>`;
  }).join("")}</div>`;
}

function renderSection(section) {
  const root = $("#managementContent");
  if (!root) return;
  root.innerHTML = `
    <section class="management-section-detail" data-management-section-id="${esc(section.id)}">
      <div class="management-section-detail-title"><strong>${esc(section.name)}</strong></div>
      <div class="management-section-placeholder">
        <span>섹션이 준비됐어요.</span>
        <small>다음 단계에서 이 안에 그룹을 만들고 관리 항목을 넣을게요.</small>
      </div>
    </section>`;
}

function renderControls() {
  const select = $("#managementSectionSelect");
  if (!select || !managementState) return;
  const valid = selectedSectionId === "all" || managementState.managementSections.some((section) => section.id === selectedSectionId);
  if (!valid) selectedSectionId = "all";
  select.innerHTML = sectionOptions();
  select.value = selectedSectionId;
}

function renderContent() {
  if (!managementState) return;
  if (selectedSectionId === "all") {
    renderAllSections();
    return;
  }
  const section = managementState.managementSections.find((item) => item.id === selectedSectionId);
  if (!section) {
    selectedSectionId = "all";
    renderControls();
    renderAllSections();
    return;
  }
  renderSection(section);
}

async function renderManagement() {
  try {
    ensureShell();
    await readState();
    if (!managementState) return;
    renderControls();
    renderContent();
  } catch (error) {
    console.error("management render failed", error);
  }
}

function scheduleRender(delay = 50) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderManagement, delay);
}

function openSectionForm() {
  const form = $("#managementSectionForm");
  const button = $("#managementSectionAddButton");
  const input = $("#managementSectionName");
  if (!form || !button || !input) return;
  form.hidden = false;
  button.hidden = true;
  input.value = "";
  requestAnimationFrame(() => input.focus());
}

function closeSectionForm() {
  const form = $("#managementSectionForm");
  const button = $("#managementSectionAddButton");
  if (form) form.hidden = true;
  if (button) button.hidden = false;
}

function wireEvents() {
  document.addEventListener("click", (event) => {
    if (event.target.closest("#managementSectionAddButton")) {
      openSectionForm();
      return;
    }
    if (event.target.closest("#managementSectionCancel")) {
      closeSectionForm();
      return;
    }
    const open = event.target.closest("[data-management-open-section]");
    if (open) {
      selectedSectionId = open.dataset.managementOpenSection || "all";
      renderControls();
      renderContent();
    }
  });

  document.addEventListener("change", (event) => {
    if (!event.target.matches("#managementSectionSelect")) return;
    selectedSectionId = event.target.value || "all";
    renderContent();
  });

  document.addEventListener("submit", async (event) => {
    if (!event.target.matches("#managementSectionForm")) return;
    event.preventDefault();
    const input = $("#managementSectionName");
    const name = input?.value.trim() || "";
    if (!name) return;
    if (managementState?.managementSections.some((section) => section.name.trim().toLowerCase() === name.toLowerCase())) {
      showToast("같은 이름의 관리 섹션이 이미 있어요.");
      input?.focus();
      return;
    }
    const id = `management-section-${uid()}`;
    await writeState((state) => {
      state.managementSections.push({ id, name, createdAt: new Date().toISOString() });
    });
    selectedSectionId = id;
    closeSectionForm();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.closest("#managementSectionForm")) {
      event.preventDefault();
      closeSectionForm();
    }
  });
}

ensureShell();
wireEvents();
document.addEventListener("onekan:state-changed", (event) => {
  if (event.detail?.source !== "management") scheduleRender(60);
});
supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  if (currentUser) scheduleRender(100);
});
renderManagement();
