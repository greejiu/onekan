const PROJECT_TAB_KEY = "onekan-project-direction-tab";

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const $$ = (selector, root = document) => [...(root?.querySelectorAll?.(selector) || [])];

const ICONS = {
  home: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 10.8 12 3l9 7.8"></path><path d="M5.5 9.8V21h13V9.8"></path><path d="M9.5 21v-6h5v6"></path></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path></svg>',
  task: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"></path></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 7h-9a6 6 0 0 0-5.7 4.1"></path><path d="m17 4 3 3-3 3"></path><path d="M4 17h9a6 6 0 0 0 5.7-4.1"></path><path d="m7 20-3-3 3-3"></path></svg>',
  project: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 7.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><path d="M3 7.5V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1.5"></path></svg>',
  goal: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="4.2"></circle><circle cx="12" cy="12" r="1"></circle></svg>',
  identity: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="7.5" r="3.5"></circle><path d="M5 21c.5-4.2 3-6.5 7-6.5s6.5 2.3 7 6.5"></path></svg>',
  tracking: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3.5 2"></path></svg>',
  records: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 3.5h11a2 2 0 0 1 2 2V21H7a2 2 0 0 1-2-2z"></path><path d="M18 18H8a3 3 0 0 0-3 3M9 8h5M9 12h5"></path></svg>',
  reports: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 20v-6M10 20V9M15 20V5M20 20V2"></path></svg>',
  tags: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 11V5.5a2 2 0 0 1 2-2H11l9.5 9.5-7.5 7.5z"></path><circle cx="7.5" cy="7.5" r="1"></circle></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"></path></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"></path><path d="M14 8l4 4-4 4M18 12H9"></path></svg>'
};

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

function iconKeyForButton(button) {
  if (button.id === "logout-button") return "logout";
  if (button.dataset.sidebarProjectTab) return button.dataset.sidebarProjectTab === "project" ? "project" : button.dataset.sidebarProjectTab;

  return ({
    home: "home",
    calendar: "calendar",
    tasks: "task",
    repeat: "repeat",
    tracking: "tracking",
    records: "records",
    reports: "reports",
    tags: "tags",
    settings: "settings"
  })[button.dataset.page] || null;
}

function decorateIcons() {
  $$(".sidebar .nav-item").forEach((button) => {
    const icon = $(".nav-icon", button);
    const key = iconKeyForButton(button);
    if (!icon || !key || !ICONS[key] || icon.dataset.onekanIcon === key) return;
    icon.innerHTML = ICONS[key];
    icon.dataset.onekanIcon = key;
  });
}

function makeStaticSectionHeadings() {
  $$(".nav-section-toggle").forEach((toggle) => {
    const label = $(".nav-section-label", toggle)?.textContent?.trim();
    if (!label) return;
    const heading = document.createElement("div");
    heading.className = "nav-section-heading";
    heading.textContent = label;
    heading.setAttribute("aria-hidden", "true");
    toggle.replaceWith(heading);
  });

  $$("[data-sidebar-section]").forEach((section) => {
    section.classList.remove("is-collapsed");
  });

  try {
    localStorage.removeItem("onekan-sidebar-sections-v1");
  } catch {
    // Storage can be blocked; the sidebar still remains expanded.
  }
}

function ensureUtilityDivider() {
  const tracking = $('.sidebar .nav > .nav-item[data-page="tracking"]');
  if (!tracking || tracking.previousElementSibling?.classList.contains("nav-section-divider")) return;
  const divider = document.createElement("div");
  divider.className = "nav-section-divider";
  divider.setAttribute("aria-hidden", "true");
  tracking.before(divider);
}

function keepHabitLabel() {
  const label = $('.nav-item[data-page="repeat"] .nav-label');
  if (label && label.textContent !== "습관") label.textContent = "습관";
}

function decorateSidebar() {
  makeStaticSectionHeadings();
  ensureUtilityDivider();
  keepHabitLabel();
  decorateIcons();
}

function bindNavigation() {
  document.addEventListener("click", (event) => {
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

function init() {
  decorateSidebar();
  bindNavigation();
  syncProjectNavigation();

  const nav = $(".sidebar .nav");
  if (nav) {
    new MutationObserver(() => {
      decorateSidebar();
      if ($("#page-projects.active")) syncProjectNavigation();
    }).observe(nav, { childList: true, subtree: true });
  }

  import("./project-popup-planning.js?v=1").catch((error) => {
    console.error("프로젝트 연결 항목 관리 화면을 불러오지 못했어요.", error);
  });
}

init();
