const $ = (selector, root = document) => root?.querySelector?.(selector) || null;

const TABS = [
  { id: "project", label: "프로젝트", title: "프로젝트 현황" },
  { id: "goal", label: "목표", title: "목표" },
  { id: "identity", label: "정체성", title: "정체성" },
];

let activeTab = sessionStorage.getItem("onekan-project-direction-tab") || "project";
if (!TABS.some((tab) => tab.id === activeTab)) activeTab = "project";

function installStyle() {
  if ($("#onekanProjectDirectionTabsStyle")) return;
  const style = document.createElement("style");
  style.id = "onekanProjectDirectionTabsStyle";
  style.textContent = `
    #page-projects .page-head{display:flex;align-items:center;justify-content:space-between;gap:14px}
    .onekan-project-direction-tabs{display:inline-flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--line,#d2d7df);border-radius:10px;background:var(--panel-soft,#f4f5f6)}
    .onekan-project-direction-tabs button{min-height:29px;padding:4px 10px;border:0;border-radius:7px;background:transparent;color:var(--muted,#6d737d);font:inherit;font-size:11px;cursor:pointer}
    .onekan-project-direction-tabs button.active{background:#fff;color:var(--text,#1f2328);font-weight:700;box-shadow:0 1px 3px #0001}
    .onekan-project-direction-placeholder{display:grid;place-items:center;min-height:360px;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:15px;background:#fff;color:var(--muted,#6d737d);font-size:11px;text-align:center}
    @media(max-width:700px){#page-projects .page-head{align-items:flex-start;flex-direction:column}.onekan-project-direction-tabs{align-self:stretch}.onekan-project-direction-tabs button{flex:1}}
  `;
  document.head.appendChild(style);
}

function ensureUi() {
  const page = $("#page-projects");
  const head = $(".page-head", page);
  const root = $("#projectStatusRoot", page);
  if (!page || !head || !root) return null;

  let tabs = $("#onekanProjectDirectionTabs", page);
  if (!tabs) {
    tabs = document.createElement("div");
    tabs.id = "onekanProjectDirectionTabs";
    tabs.className = "onekan-project-direction-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "프로젝트 방향 보기");
    tabs.innerHTML = TABS.map((tab) => `<button type="button" role="tab" data-project-direction-tab="${tab.id}">${tab.label}</button>`).join("");
    head.appendChild(tabs);
  }

  let secondary = $("#onekanProjectDirectionSecondary", page);
  if (!secondary) {
    secondary = document.createElement("div");
    secondary.id = "onekanProjectDirectionSecondary";
    root.insertAdjacentElement("afterend", secondary);
  }

  return { page, head, root, tabs, secondary };
}

function render() {
  installStyle();
  const ui = ensureUi();
  if (!ui) return;
  const tab = TABS.find((item) => item.id === activeTab) || TABS[0];
  const title = $(".page-title", ui.page);
  if (title) title.textContent = tab.title;

  ui.tabs.querySelectorAll("[data-project-direction-tab]").forEach((button) => {
    const isActive = button.dataset.projectDirectionTab === activeTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  ui.root.hidden = activeTab !== "project";
  if (activeTab === "project") {
    ui.secondary.innerHTML = "";
    ui.secondary.hidden = true;
  } else {
    ui.secondary.hidden = false;
    const label = activeTab === "goal" ? "목표" : "정체성";
    ui.secondary.innerHTML = `<div class="onekan-project-direction-placeholder">${label}는 다음 단계에서 하나씩 연결할게요.</div>`;
  }
}

function init() {
  installStyle();
  render();
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-project-direction-tab]");
    if (!button) return;
    activeTab = button.dataset.projectDirectionTab || "project";
    sessionStorage.setItem("onekan-project-direction-tab", activeTab);
    render();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-page="projects"]')) setTimeout(render, 0);
  });
}

init();
