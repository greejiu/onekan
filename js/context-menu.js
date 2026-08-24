import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (n) => String(n).padStart(2, "0");

let state = null;
let currentTarget = null;
let observer = null;
let annotateTimer = null;

function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayDate(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return date;
}

function todayKey() {
  return localDateKey(appDayDate());
}

function tomorrowKey() {
  const date = appDayDate();
  date.setDate(date.getDate() + 1);
  return localDateKey(date);
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.timeBlocks = Array.isArray(state.timeBlocks) ? state.timeBlocks : [];
  return { user: session.user, state };
}

async function writeState(mutator) {
  const current = await readState();
  if (!current) return;
  mutator(current.state);
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: current.user.id, data: current.state }, { onConflict: "user_id" });
  if (error) throw error;
  state = current.state;
  $("#reloadCloudBtn")?.click();
  scheduleAnnotate();
}

function shiftEventToDate(item, targetDate) {
  if (!item?.start || !targetDate) return;
  const start = new Date(item.start);
  const end = item.end ? new Date(item.end) : null;
  const duration = end && end > start ? end - start : null;
  const [year, month, day] = targetDate.split("-").map(Number);
  start.setFullYear(year, month - 1, day);
  item.start = start.toISOString();
  if (duration !== null) item.end = new Date(start.getTime() + duration).toISOString();
}

async function moveTarget(targetDate) {
  const target = currentTarget;
  hideMenu();
  if (!target) return;
  try {
    await writeState((next) => {
      if (target.kind === "task") {
        const task = next.tasks.find((item) => item.id === target.id);
        if (!task) return;
        task.date = targetDate;
        next.timeBlocks.forEach((block) => {
          if (block.taskId === task.id) block.date = targetDate;
        });
        return;
      }
      if (target.kind === "event") {
        shiftEventToDate(next.events.find((item) => item.id === target.id), targetDate);
        return;
      }
      if (target.kind === "timeBlock") {
        const block = next.timeBlocks.find((item) => item.id === target.id);
        if (block) block.date = targetDate;
      }
    });
  } catch (error) {
    console.error(error);
    window.alert("날짜를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
}

async function deleteTarget() {
  const target = currentTarget;
  hideMenu();
  if (!target) return;
  try {
    await writeState((next) => {
      if (target.kind === "task") {
        next.tasks = next.tasks.filter((item) => item.id !== target.id);
        next.timeBlocks = next.timeBlocks.filter((block) => block.taskId !== target.id);
        return;
      }
      if (target.kind === "event") {
        next.events = next.events.filter((item) => item.id !== target.id);
        return;
      }
      if (target.kind === "timeBlock") {
        next.timeBlocks = next.timeBlocks.filter((item) => item.id !== target.id);
      }
    });
  } catch (error) {
    console.error(error);
    window.alert("삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
}

function ensureMenu() {
  if ($("#globalContextMenu")) return;
  const menu = document.createElement("div");
  menu.id = "globalContextMenu";
  menu.className = "global-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-context-action="today">오늘하기</button>
    <button type="button" role="menuitem" data-context-action="tomorrow">내일하기</button>
    <div class="global-context-divider"></div>
    <button type="button" role="menuitem" class="danger" data-context-action="delete">삭제하기</button>`;
  document.body.appendChild(menu);

  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-context-action]");
    if (!button) return;
    const action = button.dataset.contextAction;
    if (action === "today") moveTarget(todayKey());
    if (action === "tomorrow") moveTarget(tomorrowKey());
    if (action === "delete") deleteTarget();
  });

  const style = document.createElement("style");
  style.id = "globalContextMenuStyle";
  style.textContent = `
    .global-context-menu{position:fixed;z-index:10000;display:none;min-width:148px;padding:5px;background:#fff;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:9px;box-shadow:0 10px 28px rgba(15,23,42,.16)}
    .global-context-menu.open{display:block}
    .global-context-menu button{display:block;width:100%;min-height:34px;padding:7px 10px;border:0;border-radius:6px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px;text-align:left;cursor:pointer}
    .global-context-menu button:hover,.global-context-menu button:focus-visible{background:var(--hover,#f3f5f7);outline:none}
    .global-context-menu button.danger{color:var(--danger,#c84a4a)}
    .global-context-divider{height:1px;background:var(--line,#d2d7df);margin:4px 2px}
  `;
  document.head.appendChild(style);
}

function hideMenu() {
  $("#globalContextMenu")?.classList.remove("open");
  currentTarget = null;
}

function showMenu(x, y, target) {
  ensureMenu();
  currentTarget = target;
  const menu = $("#globalContextMenu");
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add("open");
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function targetFromElement(element) {
  if (!(element instanceof Element)) return null;

  const explicit = element.closest("[data-context-kind][data-context-id]");
  if (explicit) return { kind: explicit.dataset.contextKind, id: explicit.dataset.contextId };

  const feature = element.closest("[data-feature-kind][data-feature-id]");
  if (feature) return { kind: feature.dataset.featureKind, id: feature.dataset.featureId };

  const todayTask = element.closest("#taskList .row[data-id]");
  if (todayTask) return { kind: "task", id: todayTask.dataset.id };

  const somedayTask = element.closest("#featureSomedayList .row[data-task-id]");
  if (somedayTask) return { kind: "task", id: somedayTask.dataset.taskId };

  const block = element.closest(".time-block[data-block-id]");
  if (block) return { kind: "timeBlock", id: block.dataset.blockId };

  const timedEvent = element.closest(".day-timed-event[data-feature-id]");
  if (timedEvent) return { kind: "event", id: timedEvent.dataset.featureId };

  return null;
}

function annotateUpcoming() {
  if (!state) return;
  const rows = $$("#upcomingList .row");
  if (!rows.length) return;
  const now = new Date();
  const events = state.events
    .filter((event) => new Date(event.start) >= now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, rows.length);
  rows.forEach((row, index) => {
    const item = events[index];
    if (!item) return;
    row.dataset.contextKind = "event";
    row.dataset.contextId = item.id;
  });
}

function annotateKnownRows() {
  $$("#taskList .row[data-id]").forEach((row) => {
    row.dataset.contextKind = "task";
    row.dataset.contextId = row.dataset.id;
  });
  $$("#featureSomedayList .row[data-task-id]").forEach((row) => {
    row.dataset.contextKind = "task";
    row.dataset.contextId = row.dataset.taskId;
  });
  $$(".time-block[data-block-id]").forEach((block) => {
    block.dataset.contextKind = "timeBlock";
    block.dataset.contextId = block.dataset.blockId;
  });
  annotateUpcoming();
}

function scheduleAnnotate() {
  clearTimeout(annotateTimer);
  annotateTimer = setTimeout(async () => {
    try {
      if (!state) await readState();
      annotateKnownRows();
    } catch (error) {
      console.error("오른쪽 클릭 메뉴 연결 실패", error);
    }
  }, 80);
}

function installListeners() {
  if (document.documentElement.dataset.contextMenuWired) return;
  document.documentElement.dataset.contextMenuWired = "1";

  document.addEventListener("contextmenu", (event) => {
    if (event.target.closest?.("input,textarea,select,[contenteditable='true']")) return;
    const target = targetFromElement(event.target);
    if (!target) return;
    event.preventDefault();
    showMenu(event.clientX, event.clientY, target);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.("#globalContextMenu")) hideMenu();
  });
  document.addEventListener("scroll", hideMenu, true);
  window.addEventListener("resize", hideMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideMenu();
  });
}

function observeApp() {
  if (observer) return;
  const app = $("#app-section");
  if (!app) return;
  observer = new MutationObserver(scheduleAnnotate);
  observer.observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-feature-kind", "data-feature-id"] });
}

async function init() {
  ensureMenu();
  installListeners();
  observeApp();
  try { await readState(); } catch (error) { console.error(error); }
  scheduleAnnotate();
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
  else {
    state = null;
    hideMenu();
  }
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) await init();
