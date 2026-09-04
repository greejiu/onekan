import { onekanStateStore } from "./supabase.js?v=1";

if (!window.__onekanTaskAreaListInstalled) {
  window.__onekanTaskAreaListInstalled = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character]));
  const pad = (value) => String(value).padStart(2, "0");
  const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const todayKey = () => {
    const date = new Date();
    date.setHours(date.getHours() - 3);
    return dateKey(date);
  };
  const manualOrderValue = (item) => {
    const value = Number(item?.manualOrder);
    return Number.isFinite(value) ? value : 1000000000;
  };

  let rendering = false;
  let renderTimer = null;

  function areaTab() {
    return $('#taskPageTabs [data-task-tab="someday"]');
  }

  function areaTabActive() {
    const button = areaTab();
    return Boolean(button?.classList.contains("active"));
  }

  function listModeActive() {
    return Boolean(document.querySelector('[data-uw-task-mode="list"].active'));
  }

  function pageActive() {
    return Boolean(document.querySelector('#page-tasks.active'));
  }

  function relabelTab() {
    const button = areaTab();
    if (!button) return;
    if (button.textContent !== "영역별") button.textContent = "영역별";
    button.setAttribute("aria-label", "미완료 할일을 영역별로 보기");
  }

  function dateLabel(value) {
    if (!value) return "날짜 없음";
    if (value === todayKey()) return "오늘";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getMonth() + 1}.${date.getDate()}`;
  }

  function recurrenceLabel(task) {
    const recurrence = task?.recurrence || task?.repeatRule;
    if (!recurrence?.frequency || recurrence.frequency === "none") return "";
    return "반복";
  }

  function itemMarkup(task, area) {
    const date = task.date || "";
    const repeat = recurrenceLabel(task);
    return `<div class="uw-item uw-task" style="--uw-group:${esc(area?.color || "#8fa9c4")}" data-context-kind="task" data-context-id="${esc(task.id)}" data-uw-kind="task" data-id="${esc(task.id)}" data-date="${esc(date)}" data-manual-row data-manual-kind="task" data-manual-id="${esc(task.id)}" draggable="false">
      <button class="uw-check" style="--uw-check-color:var(--timeline-task-color)" data-uw-check="task" data-id="${esc(task.id)}" data-date="${esc(date)}" type="button" aria-label="완료"></button>
      <span class="uw-item-title">${esc(task.title || "이름 없는 할일")}</span>
      ${repeat ? `<span class="uw-repeat-badge" title="${repeat}" aria-label="${repeat}">↻</span>` : ""}
      <span class="uw-item-time">${esc(dateLabel(date))}</span>
      <button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button>
      <button class="uw-select-circle" type="button" aria-label="선택"></button>
    </div>`;
  }

  async function readState() {
    const state = await onekanStateStore.read();
    if (!state) return null;
    state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
    state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length
      ? state.eventGroups
      : [{ id: "default", name: "기본", color: "#8fa9c4" }];
    return state;
  }

  async function renderAreaList() {
    relabelTab();
    const root = $("#tasksPageList");
    if (!root || !pageActive() || !listModeActive() || !areaTabActive()) return;
    if (root.querySelector("[data-onekan-task-area-view]")) return;
    if (rendering) return;
    rendering = true;
    try {
      const state = await readState();
      if (!state || !areaTabActive() || !listModeActive()) return;

      const groups = state.eventGroups;
      const defaultGroup = groups[0];
      const groupFor = (task) => groups.find((group) => group.id === task.groupId) || defaultGroup;
      const tasks = state.tasks
        .filter((task) => !task.isHabit && !task.done)
        .sort((a, b) => {
          const ag = groups.findIndex((group) => group.id === groupFor(a)?.id);
          const bg = groups.findIndex((group) => group.id === groupFor(b)?.id);
          return ag - bg
            || manualOrderValue(a) - manualOrderValue(b)
            || String(a.date || "9999").localeCompare(String(b.date || "9999"))
            || String(a.title || "").localeCompare(String(b.title || ""), "ko");
        });

      const grouped = groups
        .map((area) => ({ area, rows: tasks.filter((task) => groupFor(task)?.id === area.id) }))
        .filter((entry) => entry.rows.length);

      const add = '<div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date=""><button class="uw-empty-hit uw-task-inline-add" data-uw-add-kind="task" data-date="" type="button" aria-label="할일 입력">＋ 할일 입력</button></div>';
      const body = grouped.length
        ? `<div class="uw-task-grouped-list" data-onekan-task-area-view>${grouped.map(({ area, rows }) => `<section class="uw-task-group-section" style="--uw-group:${esc(area.color || "#8fa9c4")}"><div class="uw-task-group-heading"><span class="uw-task-group-dot"></span><strong>${esc(area.name || "기본")}</strong></div><div class="uw-list uw-task-main-list" data-uw-add-kind="task" data-date="" data-group-id="${esc(area.id)}" data-manual-list>${rows.map((task) => itemMarkup(task, area)).join("")}</div></section>`).join("")}</div>`
        : '<div class="empty" data-onekan-task-area-view>미완료 할일이 없어요.</div>';

      root.innerHTML = add + body;
    } catch (error) {
      console.error("할일 영역별 보기 연결 실패", error);
    } finally {
      rendering = false;
    }
  }

  function scheduleAreaRender(delay = 0) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderAreaList(), delay);
  }

  const nav = $("#taskPageTabs");
  if (nav) {
    new MutationObserver(() => {
      relabelTab();
      if (areaTabActive()) scheduleAreaRender(0);
    }).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  const root = $("#tasksPageList");
  if (root) {
    new MutationObserver(() => {
      relabelTab();
      if (areaTabActive() && !root.querySelector("[data-onekan-task-area-view]")) scheduleAreaRender(0);
    }).observe(root, { childList: true, subtree: false });
  }

  document.addEventListener("onekan:state-changed", () => {
    if (areaTabActive()) scheduleAreaRender(220);
  });

  document.addEventListener("click", () => {
    setTimeout(() => {
      relabelTab();
      if (areaTabActive()) scheduleAreaRender(0);
    }, 0);
  }, true);

  relabelTab();
  scheduleAreaRender(120);
}
