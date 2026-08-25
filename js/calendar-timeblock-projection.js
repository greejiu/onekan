import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const START_MIN = 6 * 60;
const END_MIN = 22 * 60;
const SLOT = 30;
const ROW_HEIGHT = 42;
const DEFAULT_TEMPLATES = [
  { id: "tb-0609", title: "오전일과", startMinute: 360, endMinute: 540 },
  { id: "tb-0911", title: "작업 1", startMinute: 540, endMinute: 660 },
  { id: "tb-1112", title: "", startMinute: 660, endMinute: 720 },
  { id: "tb-1214", title: "", startMinute: 720, endMinute: 840 },
  { id: "tb-1415", title: "", startMinute: 840, endMinute: 900 },
  { id: "tb-1517", title: "", startMinute: 900, endMinute: 1020 },
  { id: "tb-1719", title: "", startMinute: 1020, endMinute: 1140 },
  { id: "tb-1921", title: "", startMinute: 1140, endMinute: 1260 },
  { id: "tb-2122", title: "", startMinute: 1260, endMinute: 1320 },
];

let observer = null;
let renderTimer = null;
let rendering = false;

function scheduleRender(delay = 100) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderProjection, delay);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function resolveTimelineDate(timeline) {
  const explicit = timeline?.dataset.featureCalendarDate;
  if (explicit) return explicit;
  const title = $("#calTitle")?.textContent || "";
  const match = title.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!match) return null;
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  if (!Array.isArray(state.timeBlockTemplates) || !state.timeBlockTemplates.length) {
    state.timeBlockTemplates = DEFAULT_TEMPLATES.map((item) => ({ ...item }));
  }
  return { user: session.user, state };
}

async function writeState(mutator) {
  const current = await readState();
  if (!current) return;
  mutator(current.state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: current.user.id, data: current.state }, { onConflict: "user_id" });
  if (error) throw error;
  $("#reloadCloudBtn")?.click();
  scheduleRender(160);
}

function minuteText(minute) {
  const value = Math.max(0, Number(minute) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}

function eventOverlapsMinute(event, targetDate, minute) {
  if (!event?.start) return false;
  const start = new Date(event.start);
  if (dateKey(start) !== targetDate) return false;
  const end = event.end ? new Date(event.end) : new Date(start.getTime() + SLOT * 60000);
  const startMinute = start.getHours() * 60 + start.getMinutes();
  const endMinute = end.getHours() * 60 + end.getMinutes();
  return minute >= startMinute && minute < endMinute;
}

function hideAssignedUntimedTasks(assignedIds) {
  const box = $("#calendarBody .untimed-box");
  if (!box) return;
  $$(".cal-event", box).forEach((element) => {
    const id = element.dataset.featureId || element.dataset.contextId;
    element.classList.toggle("calendar-timeblock-hidden-untimed", !!id && assignedIds.has(id));
  });
  const items = $$(".cal-event", box);
  box.classList.toggle("calendar-timeblock-empty-untimed", !!items.length && items.every((element) => element.classList.contains("calendar-timeblock-hidden-untimed")));
}

function projectionMarkup(template, tasks) {
  const title = String(template.title || "").trim();
  return `
    <div class="calendar-timeblock-head">
      <span class="calendar-timeblock-time">${minuteText(template.startMinute)}</span>
      ${title ? `<strong>${esc(title)}</strong>` : ""}
    </div>
    <div class="calendar-timeblock-task-list">
      ${tasks.map((task) => `
        <div class="calendar-timeblock-task${task.done ? " done" : ""}" data-context-kind="task" data-context-id="${task.id}">
          <button type="button" class="calendar-timeblock-check${task.done ? " checked" : ""}" data-calendar-task-check="${task.id}" aria-label="완료">${task.done ? "✓" : ""}</button>
          <span>${esc(task.title)}</span>
        </div>`).join("")}
    </div>`;
}

function wireProjection(root) {
  $$('[data-calendar-task-check]', root).forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      button.disabled = true;
      try {
        await writeState((state) => {
          const task = state.tasks.find((item) => item.id === button.dataset.calendarTaskCheck);
          if (task) task.done = !task.done;
        });
      } catch (error) {
        console.error("달력 시간블럭 할일 완료 처리 실패", error);
        button.disabled = false;
      }
    });
  });
}

async function renderProjection() {
  if (rendering) return;
  const timeline = $("#calendarBody .day-timeline");
  if (!timeline) return;
  const targetDate = resolveTimelineDate(timeline);
  if (!targetDate) {
    scheduleRender(180);
    return;
  }

  rendering = true;
  try {
    const current = await readState();
    if (!current) return;
    const { state } = current;
    const templateMap = new Map(state.timeBlockTemplates.map((template) => [template.id, template]));
    const assignedTasks = state.tasks.filter((task) => task.date === targetDate && task.timeBlockTemplateId && templateMap.has(task.timeBlockTemplateId));
    const assignedIds = new Set(assignedTasks.map((task) => task.id));

    $$(".calendar-timeblock-projection", timeline).forEach((element) => element.remove());
    hideAssignedUntimedTasks(assignedIds);

    const groups = new Map();
    for (const task of assignedTasks) {
      const template = templateMap.get(task.timeBlockTemplateId);
      const startMinute = Number(template?.startMinute);
      if (!template || !Number.isFinite(startMinute) || startMinute < START_MIN || startMinute >= END_MIN) continue;
      if (!groups.has(template.id)) groups.set(template.id, { template, tasks: [] });
      groups.get(template.id).tasks.push(task);
    }

    const laneWidth = Math.max(0, timeline.getBoundingClientRect().width - 62);
    [...groups.values()]
      .sort((a, b) => Number(a.template.startMinute) - Number(b.template.startMinute))
      .forEach(({ template, tasks }) => {
        tasks.sort((a, b) => Number(a.done) - Number(b.done));
        const startMinute = Number(template.startMinute);
        const top = ((startMinute - START_MIN) / SLOT) * ROW_HEIGHT + 3;
        const overlapsSchedule = state.events.some((event) => eventOverlapsMinute(event, targetDate, startMinute));
        const element = document.createElement("section");
        element.className = `calendar-timeblock-projection${overlapsSchedule ? " with-schedule" : ""}`;
        element.dataset.timeBlockTemplateId = template.id;
        element.style.top = `${top}px`;
        if (overlapsSchedule && laneWidth > 0) element.style.left = `${62 + Math.round(laneWidth * 0.56)}px`;
        element.innerHTML = projectionMarkup(template, tasks);
        timeline.appendChild(element);
        wireProjection(element);
      });
  } catch (error) {
    console.error("달력 시간블럭 표시 실패", error);
  } finally {
    rendering = false;
  }
}

function injectStyle() {
  if ($("#calendarTimeBlockProjectionStyles")) return;
  const style = document.createElement("style");
  style.id = "calendarTimeBlockProjectionStyles";
  style.textContent = `
    #calendarBody .calendar-timeblock-hidden-untimed{display:none!important}
    #calendarBody .untimed-box.calendar-timeblock-empty-untimed{display:none!important}
    #calendarBody .calendar-timeblock-projection{position:absolute;left:69px;right:10px;z-index:4;min-height:34px;padding:5px 7px;border:1px solid var(--line-strong,#b8c0cb);border-left:3px solid var(--accent,#30343b);border-radius:7px;background:rgba(248,249,251,.97);box-shadow:0 1px 2px rgba(15,23,42,.05)}
    #calendarBody .calendar-timeblock-head{display:flex;align-items:center;gap:6px;min-width:0;margin-bottom:2px;font-size:10px;color:var(--muted,#6b7280)}
    #calendarBody .calendar-timeblock-head strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text,#1f2328);font-size:11px}
    #calendarBody .calendar-timeblock-time{font-variant-numeric:tabular-nums;white-space:nowrap}
    #calendarBody .calendar-timeblock-task-list{display:flex;flex-direction:column;gap:1px}
    #calendarBody .calendar-timeblock-task{display:grid;grid-template-columns:18px minmax(0,1fr);align-items:center;gap:5px;min-height:22px;padding:1px 2px;border-radius:4px;font-size:11px;line-height:1.3}
    #calendarBody .calendar-timeblock-task:hover{background:var(--hover,#f3f5f7)}
    #calendarBody .calendar-timeblock-task.done span{text-decoration:line-through;color:var(--muted,#6b7280)}
    #calendarBody .calendar-timeblock-check{width:16px;height:16px;padding:0;border:1px solid var(--line-strong,#b8c0cb);border-radius:4px;background:#fff;color:var(--text,#1f2328);font-size:10px;cursor:pointer}
    #calendarBody .calendar-timeblock-check.checked{background:var(--accent-soft,#eef2f6)}
    @media(max-width:700px){#calendarBody .calendar-timeblock-projection.with-schedule{left:58%!important}}
  `;
  document.head.appendChild(style);
}

function isOwnMutation(mutation) {
  if (mutation.target.closest?.(".calendar-timeblock-projection")) return true;
  if (mutation.type !== "childList") return false;
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes].filter((node) => node.nodeType === Node.ELEMENT_NODE);
  return !!nodes.length && nodes.every((node) => node.matches?.(".calendar-timeblock-projection") || node.closest?.(".calendar-timeblock-projection"));
}

function observeCalendar() {
  if (observer) return;
  const body = $("#calendarBody");
  if (!body) return;
  observer = new MutationObserver((mutations) => {
    if (mutations.length && mutations.every(isOwnMutation)) return;
    scheduleRender();
  });
  observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-feature-calendar-date", "data-feature-id", "data-feature-kind"] });
}

function init() {
  injectStyle();
  observeCalendar();
  $("#reloadCloudBtn")?.addEventListener("click", () => scheduleRender(160));
  scheduleRender(160);
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) init();
