import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const pad = (n) => String(n).padStart(2, "0");
const START_MIN = 6 * 60;
const END_MIN = 22 * 60;
const SLOT = 30;

let cloudState = null;
let observer = null;
let enhanceTimer = null;

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayKey(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return localDateKey(date);
}

function minuteText(minute) {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

async function readCloudState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  cloudState = state;
  return { user: session.user, state };
}

async function writeCloudState(mutator) {
  const current = await readCloudState();
  if (!current) return false;
  mutator(current.state);
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: current.user.id, data: current.state }, { onConflict: "user_id" });
  if (error) throw error;
  cloudState = current.state;
  const reload = $("#reloadCloudBtn");
  if (reload) reload.click();
  return true;
}

function activeCalendarDate() {
  const dated = $("#calendarBody [data-feature-calendar-date]");
  return dated?.dataset.featureCalendarDate || appDayKey();
}

function wireCalendarTaskButton() {
  const button = $("#calendarAddTaskBtn");
  const dialog = $("#calendarTaskDialog");
  if (!button || !dialog || button.dataset.wired) return;
  button.dataset.wired = "true";

  button.addEventListener("click", () => {
    $("#calendarTaskTitle").value = "";
    $("#calendarTaskDate").value = activeCalendarDate();
    dialog.showModal();
  });

  $("#cancelCalendarTaskBtn").addEventListener("click", () => dialog.close());
  $("#calendarTaskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#calendarTaskTitle").value.trim();
    const date = $("#calendarTaskDate").value;
    if (!title || !date) return;
    try {
      await writeCloudState((state) => {
        state.tasks.push({ id: crypto.randomUUID(), title, done: false, date });
      });
      dialog.close();
    } catch (error) {
      console.error(error);
      window.alert("할일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  });
}

function openRangeDialog(dateKey, startMinute, endMinute) {
  const dialog = $("#timelineEventDialog");
  if (!dialog) return;
  $("#timelineEventTitle").value = "";
  $("#timelineEventDate").value = dateKey || appDayKey();
  $("#timelineEventStart").value = minuteText(startMinute);
  $("#timelineEventEnd").value = minuteText(Math.min(END_MIN, endMinute));
  dialog.showModal();
  setTimeout(() => $("#timelineEventTitle").focus(), 0);
}

function wireTimelineEventDialog() {
  const dialog = $("#timelineEventDialog");
  const form = $("#timelineEventForm");
  if (!dialog || !form || form.dataset.wired) return;
  form.dataset.wired = "true";

  $("#cancelTimelineEventBtn").addEventListener("click", () => dialog.close());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#timelineEventTitle").value.trim();
    const date = $("#timelineEventDate").value;
    const startText = $("#timelineEventStart").value;
    const endText = $("#timelineEventEnd").value;
    if (!title || !date || !startText || !endText) return;

    const start = new Date(`${date}T${startText}:00`);
    const end = new Date(`${date}T${endText}:00`);
    if (!(end > start)) {
      window.alert("종료 시간은 시작 시간보다 뒤여야 해요.");
      return;
    }

    try {
      await writeCloudState((state) => {
        state.events.push({
          id: crypto.randomUUID(),
          title,
          type: "schedule",
          start: start.toISOString(),
          end: end.toISOString(),
        });
      });
      dialog.close();
    } catch (error) {
      console.error(error);
      window.alert("일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  });
}

function applyEventHeights(timeline) {
  if (!cloudState?.events || !timeline) return;
  timeline.querySelectorAll(".day-timed-event[data-feature-id]").forEach((element) => {
    const event = cloudState.events.find((item) => item.id === element.dataset.featureId);
    if (!event?.start || !event?.end) return;
    const start = new Date(event.start);
    const end = new Date(event.end);
    const minutes = Math.max(SLOT, Math.round((end - start) / 60000));
    element.style.height = `${Math.max(34, (minutes / SLOT) * 42 - 6)}px`;
  });
}

function wireDayTimeline() {
  const timeline = $("#calendarBody .day-timeline");
  if (!timeline) return;
  applyEventHeights(timeline);
  if (timeline.dataset.rangeDragWired) return;
  timeline.dataset.rangeDragWired = "true";

  if (!timeline.previousElementSibling?.classList.contains("timeline-drag-hint")) {
    const hint = document.createElement("div");
    hint.className = "timeline-drag-hint";
    hint.textContent = "빈 시간을 위아래로 드래그하면 일정이 추가돼요.";
    timeline.before(hint);
  }

  let dragging = false;
  let anchorIndex = 0;
  let currentIndex = 0;
  let preview = null;

  const rowHeight = () => timeline.querySelector(".day-time-row")?.getBoundingClientRect().height || 42;
  const pointIndex = (clientY) => {
    const rect = timeline.getBoundingClientRect();
    const index = Math.floor((clientY - rect.top) / rowHeight());
    return Math.max(0, Math.min(timeline.children.length - 1, index));
  };
  const paint = () => {
    preview?.remove();
    const startIndex = Math.min(anchorIndex, currentIndex);
    const endIndex = Math.max(anchorIndex, currentIndex);
    preview = document.createElement("div");
    preview.className = "calendar-range-selection";
    preview.style.top = `${startIndex * rowHeight() + 2}px`;
    preview.style.height = `${(endIndex - startIndex + 1) * rowHeight() - 4}px`;
    timeline.appendChild(preview);
  };
  const clear = () => {
    dragging = false;
    preview?.remove();
    preview = null;
  };

  timeline.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".day-timed-event")) return;
    dragging = true;
    anchorIndex = currentIndex = pointIndex(event.clientY);
    paint();
    timeline.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  timeline.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    currentIndex = pointIndex(event.clientY);
    paint();
  });
  timeline.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    const startIndex = Math.min(anchorIndex, currentIndex);
    const endIndex = Math.max(anchorIndex, currentIndex);
    const startMinute = START_MIN + startIndex * SLOT;
    const endMinute = Math.min(END_MIN, START_MIN + (endIndex + 1) * SLOT);
    const dateKey = timeline.dataset.featureCalendarDate || activeCalendarDate();
    clear();
    timeline.releasePointerCapture?.(event.pointerId);
    openRangeDialog(dateKey, startMinute, endMinute);
  });
  timeline.addEventListener("pointercancel", clear);
}

function scheduleEnhance() {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(async () => {
    if (!cloudState) {
      try { await readCloudState(); } catch (error) { console.error(error); }
    }
    wireDayTimeline();
  }, 90);
}

function observeCalendar() {
  const body = $("#calendarBody");
  if (!body || observer) return;
  observer = new MutationObserver(scheduleEnhance);
  observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-feature-id", "data-feature-calendar-date"] });
  scheduleEnhance();
}

async function init() {
  wireCalendarTaskButton();
  wireTimelineEventDialog();
  observeCalendar();
  try { await readCloudState(); } catch (error) { console.error(error); }
  scheduleEnhance();
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
  else cloudState = null;
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) await init();
