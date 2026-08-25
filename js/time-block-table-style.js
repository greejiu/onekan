const $ = (selector, root = document) => root.querySelector(selector);

let homeObserver = null;
let applyTimer = null;

function applyHomeLayout() {
  const taskCard = $("#taskList")?.closest(".card");
  if (taskCard) taskCard.classList.add("home-task-card-removed");

  const plannerCard = $("#timeGrid")?.closest(".card");
  const somedayCard = $("#featureSomedayCard");

  if (plannerCard) {
    plannerCard.classList.remove("span-2", "home-timeblock-full");
    plannerCard.classList.add("home-timeblock-left");
  }

  if (somedayCard) {
    somedayCard.classList.add("home-someday-right");
  }

  const unassignedLabel = $("#dailyBlockBoard .daily-block-row.unassigned .daily-block-time");
  if (unassignedLabel && unassignedLabel.textContent !== "하루종일") {
    unassignedLabel.textContent = "하루종일";
  }
}

function scheduleApply() {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(applyHomeLayout, 30);
}

function observeHome() {
  if (homeObserver) return;
  const home = $("#page-home");
  if (!home) return;
  homeObserver = new MutationObserver(scheduleApply);
  homeObserver.observe(home, { childList: true, subtree: true });
}

function injectTableStyle() {
  if ($("#timeBlockFlatTableStyles")) return;
  const style = document.createElement("style");
  style.id = "timeBlockFlatTableStyles";
  style.textContent = `
    #page-home .home-task-card-removed{display:none!important}
    #page-home .home-timeblock-left{grid-column:auto!important}
    #page-home .home-someday-right{grid-column:auto!important}
    #dailyBlockBoard{padding:0 12px 12px!important}
    #dailyBlockBoard .daily-block-table{
      width:100%!important;
      border:0!important;
      border-top:1px solid var(--line-strong,#b8c0cb)!important;
      border-bottom:1px solid var(--line-strong,#b8c0cb)!important;
      border-radius:0!important;
      overflow:visible!important;
      background:transparent!important;
      box-shadow:none!important;
    }
    #dailyBlockBoard .daily-block-row{
      display:grid!important;
      grid-template-columns:128px minmax(0,1fr)!important;
      min-height:44px!important;
      border:0!important;
      border-bottom:1px solid var(--line,#d2d7df)!important;
      border-radius:0!important;
      background:transparent;
      box-shadow:none!important;
    }
    #dailyBlockBoard .daily-block-row:last-child{border-bottom:0!important}
    #dailyBlockBoard .daily-block-row.current{background:var(--accent-soft,#eef2f6)!important}
    #dailyBlockBoard .daily-block-row.over{background:var(--hover,#f3f5f7)!important;box-shadow:none!important}
    #dailyBlockBoard .daily-block-time-cell{
      padding:8px 10px!important;
      border:0!important;
      border-right:1px solid var(--line,#d2d7df)!important;
      border-radius:0!important;
      background:transparent!important;
    }
    #dailyBlockBoard .daily-block-list-cell{
      min-height:44px!important;
      padding:5px 8px!important;
      border:0!important;
      border-radius:0!important;
      background:transparent!important;
    }
    #dailyBlockBoard .daily-block-task{
      border:0!important;
      border-radius:0!important;
      box-shadow:none!important;
      background:transparent!important;
    }
    #dailyBlockBoard .daily-block-task:hover{background:var(--hover,#f3f5f7)!important}
    #dailyBlockBoard .daily-block-empty{font-size:0!important;min-height:24px;padding:0!important}
    #dailyBlockBoard .daily-block-empty::after{content:"할일 0개";font-size:11px;color:var(--muted,#787774)}
    @media(max-width:720px){
      #page-home .home-timeblock-left,#page-home .home-someday-right{grid-column:1/-1!important}
    }
    @media(max-width:620px){
      #dailyBlockBoard .daily-block-row{grid-template-columns:96px minmax(0,1fr)!important}
    }
  `;
  document.head.appendChild(style);
}

function init() {
  injectTableStyle();
  observeHome();
  scheduleApply();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
