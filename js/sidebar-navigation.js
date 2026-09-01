const STORAGE_KEY = "onekan-sidebar-sections-v1";
const PROJECT_TAB_KEY = "onekan-project-direction-tab";

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const $$ = (selector, root = document) => [...(root?.querySelectorAll?.(selector) || [])];

function readSectionState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeSectionState() {
  const state = {};
  $$("[data-sidebar-section]").forEach((section) => {
    state[section.dataset.sidebarSection] = !section.classList.contains("is-collapsed");
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function applySectionState() {
  const state = readSectionState();
  $$("[data-sidebar-section]").forEach((section) => {
    const expanded = state[section.dataset.sidebarSection] !== false;
    section.classList.toggle("is-collapsed", !expanded);
    $(".nav-section-toggle", section)?.setAttribute("aria-expanded", String(expanded));
  });
}

function activeProjectTab() {
  const stored = sessionStorage.getItem(PROJECT_TAB_KEY) || "project";
  return ["project", "goal", "identity"].includes(stored) ? stored : "project";
}

function syncProjectNavigation(tab = activeProjectTab()) {
  $$('[data-sidebar-project-tab]').forEach((button) => {
    button.classList.toggle("active", button.dataset.sidebarProjectTab === tab);
  });
}

function selectProjectTab(tab) {
  if (!["project", "goal", "identity"].includes(tab)) return;
  sessionStorage.setItem(PROJECT_TAB_KEY, tab);
  syncProjectNavigation(tab);
  requestAnimationFrame(() => {
    $(`[data-project-direction-tab="${tab}"]`)?.click();
    syncProjectNavigation(tab);
  });
}

function bindNavigation() {
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest?.(".nav-section-toggle");
    if (toggle) {
      const section = toggle.closest("[data-sidebar-section]");
      const collapsed = !section.classList.contains("is-collapsed");
      section.classList.toggle("is-collapsed", collapsed);
      toggle.setAttribute("aria-expanded", String(!collapsed));
      writeSectionState();
      return;
    }

    const projectLink = event.target.closest?.("[data-sidebar-project-tab]");
    if (projectLink) {
      selectProjectTab(projectLink.dataset.sidebarProjectTab);
      return;
    }

    const projectTab = event.target.closest?.("[data-project-direction-tab]");
    if (projectTab) {
      syncProjectNavigation(projectTab.dataset.projectDirectionTab);
      return;
    }

    if (event.target.closest?.('[data-go="projects"]')) {
      setTimeout(() => syncProjectNavigation(), 0);
    }
  });

  document.addEventListener("onekan:state-changed", () => {
    if ($("#page-projects.active")) syncProjectNavigation();
  });
}

function keepHabitLabel() {
  const label = $('.nav-item[data-page="repeat"] .nav-label');
  if (label && label.textContent !== "습관") label.textContent = "습관";
}

function init() {
  applySectionState();
  bindNavigation();
  keepHabitLabel();
  syncProjectNavigation();

  const nav = $(".sidebar .nav");
  if (nav) {
    new MutationObserver(() => {
      keepHabitLabel();
      applySectionState();
    }).observe(nav, { childList: true, subtree: true });
  }
}

init();
