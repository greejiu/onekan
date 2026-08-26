import { supabase } from "./supabase.js";

const $ = (selector) => document.querySelector(selector);
const SLOT = 30;
const START_MINUTE = 6 * 60;
const END_MINUTE = 22 * 60;
const CALENDAR_ROW_HEIGHT = 42;
let timelineSelection = null;
let calendarObserver = null;

const pad = (value) => String(value).padStart(2, "0");
const minuteText = (minute) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

async function writeCloudState(mutator) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.eventGroups = Array.isArray(state.eventGroups) ? state.eventGroups : [];
  mutator(state);
  const { error: saveError } = await supabase.from("onekan_state").upsert({ user_id: session.user.id, data: state }, { onConflict: "user_id" });
  if (saveError) throw saveError;
  $("#reloadCloudBtn")?.click();
  return true;
}

function openTimelineEntry(surface, date, startMinute, endMinute) {
  document.querySelector(".calendar-timeline-inline-entry")?.remove();
  const form = document.createElement("form");
  form.className = `calendar-timeline-inline-entry${surface.day ? " day" : ""}`;
  form.style.top = `${((startMinute - START_MINUTE) / SLOT) * CALENDAR_ROW_HEIGHT + 2}px`;
  form.style.height = `${Math.max(34, ((endMinute - startMinute) / SLOT) * CALENDAR_ROW_HEIGHT - 4)}px`;
  form.innerHTML = `<input aria-label="일정 제목" placeholder="일정 입력" autocomplete="off" required />`;
  surface.container.appendChild(form);
  const input = form.querySelector("input");
  form.addEventListener("pointerdown", (event) => event.stopPropagation());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    const start = new Date(`${date}T${minuteText(startMinute)}:00`);
    const end = new Date(`${date}T${minuteText(endMinute)}:00`);
    try {
      await writeCloudState((state) => state.events.push({ id: crypto.randomUUID(), title, type: "schedule", groupId: state.eventGroups?.[0]?.id || "default", start: start.toISOString(), end: end.toISOString() }));
      form.remove();
    } catch (error) {
      console.error("달력 일정 저장 실패", error);
      window.alert("일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") form.remove();
  });
  input.addEventListener("blur", () => setTimeout(() => {
    if (form.isConnected && !input.value.trim()) form.remove();
  }, 0));
  requestAnimationFrame(() => input.focus());
}

function selectionSurface(target) {
  const dayLane = target.closest?.(".day-time-lane");
  if (dayLane) {
    const timeline = dayLane.closest(".day-timeline");
    return timeline ? { container: timeline, date: timeline.dataset.calendarDate, day: true } : null;
  }
  const multiLane = target.closest?.(".multi-plan-lane");
  if (multiLane) {
    const lane = multiLane.closest(".multi-day-lane");
    return lane ? { container: multiLane, date: lane.dataset.date || lane.dataset.calendarDate, day: false } : null;
  }
  return null;
}

function timelineIndex(surface, clientY) {
  const rect = surface.container.getBoundingClientRect();
  return Math.max(0, Math.min((END_MINUTE - START_MINUTE) / SLOT - 1, Math.floor((clientY - rect.top) / CALENDAR_ROW_HEIGHT)));
}

function paintTimelineSelection() {
  const selection = timelineSelection;
  if (!selection) return;
  selection.preview?.remove();
  const first = Math.min(selection.startIndex, selection.endIndex);
  const last = Math.max(selection.startIndex, selection.endIndex);
  const preview = document.createElement("div");
  preview.className = `calendar-timeline-selection${selection.surface.day ? " day" : ""}`;
  preview.style.top = `${first * CALENDAR_ROW_HEIGHT + 2}px`;
  preview.style.height = `${(last - first + 1) * CALENDAR_ROW_HEIGHT - 4}px`;
  selection.surface.container.appendChild(preview);
  selection.preview = preview;
}

function finishTimelineSelection(event) {
  const selection = timelineSelection;
  if (!selection || (event && event.pointerId !== selection.pointerId)) return;
  timelineSelection = null;
  selection.preview?.remove();
  const first = Math.min(selection.startIndex, selection.endIndex);
  const last = Math.max(selection.startIndex, selection.endIndex);
  openTimelineEntry(selection.surface, selection.surface.date, START_MINUTE + first * SLOT, START_MINUTE + (last + 1) * SLOT);
}

function bindTimelineSelection() {
  const body = $("#calendarBody");
  if (!body || body.dataset.timelineSelectionWired) return;
  body.dataset.timelineSelectionWired = "1";
  body.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".day-timed-event,.multi-entry,.calendar-timeline-inline-entry,button,input,select,textarea")) return;
    const surface = selectionSurface(event.target);
    if (!surface?.date) return;
    event.preventDefault();
    const index = timelineIndex(surface, event.clientY);
    timelineSelection = { pointerId: event.pointerId, surface, startIndex: index, endIndex: index, preview: null };
    surface.container.setPointerCapture?.(event.pointerId);
    paintTimelineSelection();
  });
  body.addEventListener("pointermove", (event) => {
    if (!timelineSelection || event.pointerId !== timelineSelection.pointerId) return;
    event.preventDefault();
    timelineSelection.endIndex = timelineIndex(timelineSelection.surface, event.clientY);
    paintTimelineSelection();
  });
  body.addEventListener("pointerup", finishTimelineSelection);
  body.addEventListener("pointercancel", () => {
    timelineSelection?.preview?.remove();
    timelineSelection = null;
  });
}

function timelineDateFor(element) {
  return element.closest(".day-timeline")?.dataset.calendarDate || element.closest(".multi-day-lane")?.dataset.date || element.closest(".multi-day-lane")?.dataset.calendarDate || null;
}

function bindCalendarResize() {
  const body = $("#calendarBody");
  if (!body || body.dataset.calendarResizeWired) return;
  body.dataset.calendarResizeWired = "1";
  body.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-calendar-resize]");
    if (!handle) return;
    const element = handle.closest("[data-context-kind][data-context-id][data-timeline-start]");
    const date = element && timelineDateFor(element);
    if (!element || !date) return;
    event.preventDefault();
    event.stopPropagation();
    const edge = handle.dataset.calendarResize;
    const originalStart = Number(element.dataset.timelineStart);
    const originalEnd = Number(element.dataset.timelineEnd);
    const startY = event.clientY;
    const originalTop = Number.parseFloat(element.style.top || "0") || 0;
    const isMulti = element.classList.contains("multi-entry");
    let nextStart = originalStart;
    let nextEnd = originalEnd;
    const wasDraggable = element.draggable;
    element.draggable = false;
    element.classList.add("resizing");
    handle.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      const slots = Math.round((moveEvent.clientY - startY) / CALENDAR_ROW_HEIGHT);
      if (edge === "top") nextStart = Math.max(START_MINUTE, Math.min(originalEnd - SLOT, originalStart + slots * SLOT));
      else nextEnd = Math.min(END_MINUTE, Math.max(originalStart + SLOT, originalEnd + slots * SLOT));
      const duration = nextEnd - nextStart;
      element.style.height = `${Math.max(isMulti ? 29 : 34, (duration / SLOT) * CALENDAR_ROW_HEIGHT - (isMulti ? 4 : 6))}px`;
      if (edge === "top") {
        const offset = ((nextStart - originalStart) / SLOT) * CALENDAR_ROW_HEIGHT;
        if (isMulti) element.style.top = `${originalTop + offset}px`;
        else element.style.transform = `translateY(${offset}px)`;
      }
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      element.classList.remove("resizing");
      element.draggable = wasDraggable;
    };
    const cancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== event.pointerId) return;
      cleanup();
      renderCalendar();
    };
    const finish = async (finishEvent) => {
      if (finishEvent.pointerId !== event.pointerId) return;
      cleanup();
      try {
        const start = new Date(`${date}T${minuteText(nextStart)}:00`);
        const end = new Date(`${date}T${minuteText(nextEnd)}:00`);
        await writeCloudState((state) => {
          if (element.dataset.contextKind === "event") {
            const item = state.events.find((entry) => entry.id === element.dataset.contextId);
            if (item) { item.start = start.toISOString(); item.end = end.toISOString(); }
          } else if (element.dataset.contextKind === "task") {
            const item = state.tasks.find((entry) => entry.id === element.dataset.contextId);
            if (item) { item.date = date; item.notionStart = start.toISOString(); item.notionEnd = end.toISOString(); }
          }
        });
      } catch (error) {
        console.error("타임라인 시간 조절 실패", error);
        window.alert("시간을 변경하지 못했어요.");
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
  });
}

function observeCalendar() {
  const body = $("#calendarBody");
  if (!body || calendarObserver) return;
  calendarObserver = new MutationObserver(() => {
    bindTimelineSelection();
    bindCalendarResize();
  });
  calendarObserver.observe(body, { childList: true, subtree: true });
}

function init() {
  bindTimelineSelection();
  bindCalendarResize();
  observeCalendar();
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) init();
