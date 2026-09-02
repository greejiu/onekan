const $ = (selector, root = document) => root?.querySelector?.(selector) || null;

const SIDE_ITEMS = [
  { key: "home", label: "집", selector: '.sidebar .nav [data-page="home"]' },
  { key: "calendar", label: "캘린더", selector: '.sidebar .nav [data-page="calendar"]' },
  { key: "projects", label: "프로젝트", selector: '.sidebar .nav [data-sidebar-project-tab="project"]' },
  { key: "tracking", label: "시간추적", selector: '.sidebar .nav [data-page="tracking"]' },
  { key: "records", label: "기록", selector: '.sidebar .nav [data-page="records"]' },
  { key: "reports", label: "리포트", selector: '.sidebar .nav [data-page="reports"]' },
  { key: "tags", label: "태그", selector: '.sidebar .nav [data-page="tags"]' },
];

const PAGE_SECTIONS = {
  home: "home",
  calendar: "calendar",
  tasks: "calendar",
  repeat: "calendar",
  habits: "calendar",
  projects: "projects",
  plan: "projects",
  management: "projects",
  tracking: "tracking",
  records: "records",
  reports: "reports",
  tags: "tags",
};

let currentHomeView = "list";
let syncFrame = 0;

function currentPage() {
  const page = $(".main > .page.active");
  return page?.id?.replace(/^page-/, "") || "home";
}

function clickOriginal(selector) {
  const target = $(selector);
  if (!target) return;
  target.click();
  window.setTimeout(scheduleSync, 40);
}

function makeButton(className, label, attributes = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  Object.entries(attributes).forEach(([name, value]) => button.setAttribute(name, value));
  return button;
}

function buildSideIndex(app) {
  let nav = $(".journal-side-index", app);
  if (nav) return nav;

  nav = document.createElement("nav");
  nav.className = "journal-side-index";
  nav.setAttribute("aria-label", "주요 인덱스 메뉴");

  SIDE_ITEMS.forEach((item) => {
    const button = makeButton("journal-side-tab", "", {
      "data-journal-section": item.key,
      "aria-label": item.label,
    });
    const label = document.createElement("span");
    label.textContent = item.label;
    button.appendChild(label);
    button.addEventListener("click", () => clickOriginal(item.selector));
    nav.appendChild(button);
  });

  app.appendChild(nav);
  return nav;
}

function homeTabs() {
  return [
    {
      key: "list",
      label: "목록",
      action: () => {
        currentHomeView = "list";
        clickOriginal('[data-uw-home-mode="list"]');
      },
    },
    {
      key: "timeline",
      label: "타임라인",
      action: () => {
        currentHomeView = "timeline";
        clickOriginal('[data-uw-home-mode="timeline"]');
      },
    },
    {
      key: "memo",
      label: "메모",
      action: () => {
        currentHomeView = "memo";
        const editor = $("#homeMemoCard .uw-home-memo-editor");
        editor?.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => editor?.focus(), 220);
        scheduleSync();
      },
    },
  ];
}

function calendarTabs(page) {
  return [
    { key: "calendar", label: "일정", active: page === "calendar", action: () => clickOriginal('.sidebar .nav [data-page="calendar"]') },
    { key: "tasks", label: "할일", active: page === "tasks", action: () => clickOriginal('.sidebar .nav [data-page="tasks"]') },
    { key: "repeat", label: "습관", active: page === "repeat" || page === "habits", action: () => clickOriginal('.sidebar .nav [data-page="repeat"]') },
  ];
}

function projectTabs(page) {
  const stored = sessionStorage.getItem("onekan-project-direction-tab") || "project";
  return [
    { key: "project", label: "프로젝트", active: page === "projects" && stored === "project", action: () => clickOriginal('.sidebar .nav [data-sidebar-project-tab="project"]') },
    { key: "goal", label: "목표", active: page === "projects" && stored === "goal", action: () => clickOriginal('.sidebar .nav [data-sidebar-project-tab="goal"]') },
    { key: "identity", label: "정체성", active: page === "projects" && stored === "identity", action: () => clickOriginal('.sidebar .nav [data-sidebar-project-tab="identity"]') },
    { key: "plan", label: "계획 세우기", active: page === "plan", action: () => clickOriginal('.sidebar .nav [data-page="plan"]') },
  ];
}

function tabsForPage(page) {
  const section = PAGE_SECTIONS[page];
  if (section === "home") return homeTabs().map((tab) => ({ ...tab, active: tab.key === currentHomeView }));
  if (section === "calendar") return calendarTabs(page);
  if (section === "projects") return projectTabs(page);
  return [];
}

function renderTopIndex(main, page) {
  let nav = $(".journal-top-index", main);
  if (!nav) {
    nav = document.createElement("nav");
    nav.className = "journal-top-index";
    nav.setAttribute("aria-label", "현재 메뉴 보기");
    main.prepend(nav);
  }

  nav.replaceChildren();
  tabsForPage(page).forEach((tab) => {
    const button = makeButton(`journal-top-tab${tab.active ? " is-active" : ""}`, tab.label, {
      "data-journal-top-tab": tab.key,
      "aria-current": tab.active ? "page" : "false",
    });
    button.addEventListener("click", tab.action);
    nav.appendChild(button);
  });
}

function syncIndexes() {
  syncFrame = 0;
  const app = $("#app-section");
  const main = $(".main", app);
  if (!app || !main) return;

  const page = currentPage();
  const section = PAGE_SECTIONS[page] || "";
  $(".journal-side-index", app)?.querySelectorAll(".journal-side-tab").forEach((button) => {
    const active = button.dataset.journalSection === section;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  if (page === "home" && currentHomeView !== "memo") {
    const activeMode = $('[data-uw-home-mode].active')?.dataset.uwHomeMode;
    if (activeMode === "list" || activeMode === "timeline") currentHomeView = activeMode;
  }

  renderTopIndex(main, page);
}

function scheduleSync() {
  if (syncFrame) return;
  syncFrame = requestAnimationFrame(syncIndexes);
}

function init() {
  const app = $("#app-section");
  const main = $(".main", app);
  if (!app || !main) return;

  document.body.classList.add("bullet-journal-ui");
  buildSideIndex(app);
  renderTopIndex(main, currentPage());
  syncIndexes();

  document.addEventListener("click", (event) => {
    const mode = event.target.closest?.("[data-uw-home-mode]")?.dataset.uwHomeMode;
    if (mode === "list" || mode === "timeline") currentHomeView = mode;
    window.setTimeout(scheduleSync, 0);
  });
  document.addEventListener("onekan:state-changed", scheduleSync);

  new MutationObserver(scheduleSync).observe(main, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });
}

init();
