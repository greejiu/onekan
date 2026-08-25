import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SLOT = 30;
const START = 6 * 60;
const END = 22 * 60;
const pad = (n) => String(n).padStart(2, "0");

let drag = null;
let suppressClick = false;
let observer = null;
let prepareTimer = null;

function minuteText(minute) {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

function clampMinute(minute, duration = SLOT) {
  minute = Math.round(Number(minute) / SLOT) * SLOT;
  return Math.max(START, Math.min(minute, END - duration));
}

async function updateCloud(mutator) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.events = Array.isArray(state.events) ? state.events : [];
  mutator(state);
  const { error: saveError } = await supabase.from("onekan_state").upsert({ user_id: session.user.id, data: state }, { onConflict: "user_id" });
  if (saveError) throw saveError;
  $("#reloadCloudBtn")?.click();
}

function getRows(timeline) {
  return $$(".day-time-row", timeline);
}

function rowHeight(timeline) {
  return getRows(timeline)[0]?.getBoundingClientRect().height || 42;
}

function indexAt(timeline, clientY) {
  const rows = getRows(timeline);
  if (!rows.length) return 0;
  const rect = timeline.getBoundingClientRect();
  const index = Math.floor((clientY - rect.top) / rowHeight(timeline));
  return Math.max(0, Math.min(rows.length - 1, index));
}

function clearPreview(target = drag) {
  target?.preview?.remove();
  if (target?.element?.isConnected) {
    target.element.style.transform = "";
    target.element.classList.remove("day-event-moving");
  }
}

function paintCreatePreview() {
  if (!drag || drag.type !== "create" || !drag.timeline?.isConnected) return;
  drag.preview?.remove();
  const first = Math.min(drag.startIndex, drag.currentIndex);
  const last = Math.max(drag.startIndex, drag.currentIndex);
  const preview = document.createElement("div");
  preview.className = "day-unified-selection";
  preview.style.top = `${first * rowHeight(drag.timeline) + 2}px`;
  preview.style.height = `${(last - first + 1) * rowHeight(drag.timeline) - 4}px`;
  drag.timeline.appendChild(preview);
  drag.preview = preview;
}

function openRangeDialog(dateKey, startMinute, endMinute) {
  const dialog = $("#timelineEventDialog");
  if (!dialog) return;
  $("#timelineEventTitle").value = "";
  $("#timelineEventDate").value = dateKey;
  $("#timelineEventStart").value = minuteText(startMinute);
  $("#timelineEventEnd").value = minuteText(Math.min(END, endMinute));
  dialog.showModal();
  setTimeout(() => $("#timelineEventTitle")?.focus(), 0);
}

function currentTimelineDate(timeline) {
  return timeline?.dataset.featureCalendarDate || $("#timelineEventDate")?.value || "";
}

function prepareTimeline() {
  const timeline = $("#calendarBody .day-timeline");
  if (!timeline) return;
  timeline.dataset.unifiedDayDrag = "true";

  $$(".day-timed-event", timeline).forEach((element) => {
    if (element.getAttribute("draggable") !== "false") element.setAttribute("draggable", "false");
    element.title = "드래그해서 시간 이동";
  });

  const oldHint = timeline.previousElementSibling;
  if (oldHint?.classList.contains("timeline-drag-hint")) {
    oldHint.textContent = "빈 시간을 드래그해 일정 추가 · 기존 일정은 위아래로 드래그해 시간 이동";
  }
}

function schedulePrepare() {
  clearTimeout(prepareTimer);
  prepareTimer = setTimeout(prepareTimeline, 30);
}

function installListeners() {
  if (document.documentElement.dataset.unifiedDayDragWired) return;
  document.documentElement.dataset.unifiedDayDragWired = "1";

  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const timeline = target?.closest("#calendarBody .day-timeline");
    if (!timeline || event.button !== 0 || !getRows(timeline).length) return;

    const eventEl = target.closest(".day-timed-event[data-feature-id]");
    const index = indexAt(timeline, event.clientY);

    if (eventEl) {
      drag = {
        type: "move",
        timeline,
        element: eventEl,
        eventId: eventEl.dataset.featureId,
        pointerId: event.pointerId,
        startIndex: index,
        currentIndex: index,
        startY: event.clientY,
        moved: false,
      };
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (!target.closest(".day-time-row,.day-time-lane")) return;
    drag = {
      type: "create",
      timeline,
      pointerId: event.pointerId,
      startIndex: index,
      currentIndex: index,
      preview: null,
    };
    paintCreatePreview();
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId || !drag.timeline?.isConnected) return;
    drag.currentIndex = indexAt(drag.timeline, event.clientY);

    if (drag.type === "create") {
      paintCreatePreview();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const movedPx = Math.abs(event.clientY - drag.startY);
    if (movedPx < 4 && !drag.moved) return;
    drag.moved = true;
    const delta = drag.currentIndex - drag.startIndex;
    if (drag.element?.isConnected) {
      drag.element.classList.add("day-event-moving");
      drag.element.style.transform = `translateY(${delta * rowHeight(drag.timeline)}px)`;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("pointerup", async (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;

    if (current.type === "create") {
      const first = Math.min(current.startIndex, current.currentIndex);
      const last = Math.max(current.startIndex, current.currentIndex);
      current.preview?.remove();
      const dateKey = currentTimelineDate(current.timeline);
      if (dateKey) openRangeDialog(dateKey, START + first * SLOT, START + (last + 1) * SLOT);
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    clearPreview(current);
    if (!current.moved) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 120);

    const targetMinute = START + current.currentIndex * SLOT;
    try {
      await updateCloud((state) => {
        const item = state.events.find((entry) => entry.id === current.eventId);
        if (!item?.start) return;
        const start = new Date(item.start);
        const oldEnd = item.end ? new Date(item.end) : null;
        const durationMs = oldEnd && oldEnd > start ? oldEnd - start : SLOT * 60000;
        const durationMin = Math.max(SLOT, Math.round(durationMs / 60000));
        const nextMinute = clampMinute(targetMinute, durationMin);
        start.setHours(Math.floor(nextMinute / 60), nextMinute % 60, 0, 0);
        item.start = start.toISOString();
        item.end = new Date(start.getTime() + durationMs).toISOString();
      });
    } catch (error) {
      console.error(error);
      window.alert("일정 시간을 옮기지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("pointercancel", () => {
    clearPreview();
    drag = null;
  }, true);

  document.addEventListener("click", (event) => {
    if (!suppressClick) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".day-timed-event")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function observeTimeline() {
  if (observer) return;
  const body = $("#calendarBody");
  if (!body) return;
  observer = new MutationObserver(schedulePrepare);
  observer.observe(body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-feature-id", "data-feature-calendar-date"],
  });
}

function injectStyle() {
  if ($("#unifiedDayDragStyles")) return;
  const style = document.createElement("style");
  style.id = "unifiedDayDragStyles";
  style.textContent = `
    .day-unified-selection{position:absolute;left:62px;right:8px;z-index:20;pointer-events:none;border:1.5px dashed #77818c;border-radius:7px;background:rgba(71,85,105,.10)}
    .day-event-moving{opacity:.72;box-shadow:0 4px 14px rgba(15,23,42,.12);cursor:grabbing!important}
    #calendarBody .day-timed-event{cursor:grab;touch-action:none;user-select:none}
    #calendarBody .day-time-lane{touch-action:none}
  `;
  document.head.appendChild(style);
}

function init() {
  injectStyle();
  installListeners();
  observeTimeline();
  schedulePrepare();
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) init();

import("./context-menu.js?v=2").catch((error) => console.error("오른쪽 클릭 메뉴 로드 실패", error));
import("./manual-time-entry.js?v=2").catch((error) => console.error("직접 시간 기록 기능 로드 실패", error));
import("./time-block-planner.js?v=2").catch((error) => console.error("시간블럭 기능 로드 실패", error));
import("./time-block-table-style.js?v=2").catch((error) => console.error("시간블럭 표 스타일 로드 실패", error));
