import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let currentUser = null;
let dragged = null;
let busy = false;

async function readState() {
  if (!currentUser) return null;
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  return state;
}

async function writeState(mutator) {
  if (!currentUser || busy) return;
  busy = true;
  try {
    const state = await readState();
    if (!state) return;
    mutator(state);
    const { error } = await supabase
      .from("onekan_state")
      .upsert({ user_id: currentUser.id, data: state }, { onConflict: "user_id" });
    if (error) throw error;

    // 기존 기능처럼 전체 페이지를 새로고침하지 않고 현재 달력 화면에서만 다시 읽는다.
    const reload = $("#reloadCloudBtn");
    if (reload) {
      reload.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  } finally {
    busy = false;
  }
}

function moveEventDate(eventItem, dateKey) {
  if (!eventItem?.start || !dateKey) return;
  const start = new Date(eventItem.start);
  const [year, month, day] = dateKey.split("-").map(Number);

  const oldStart = new Date(start);
  start.setFullYear(year, month - 1, day);
  eventItem.start = start.toISOString();

  if (eventItem.end) {
    const end = new Date(eventItem.end);
    const duration = end.getTime() - oldStart.getTime();
    eventItem.end = new Date(start.getTime() + Math.max(0, duration)).toISOString();
  }
}

function calendarDropTarget(target) {
  return target.closest(
    "#calendarBody [data-feature-calendar-date], #calendarBody .day-cell, #calendarBody .week-col, #calendarBody .day-list, #calendarBody .day-timeline"
  );
}

function targetDateKey(target) {
  const direct = target?.dataset?.featureCalendarDate;
  if (direct) return direct;

  const child = target?.querySelector?.("[data-feature-calendar-date]");
  if (child?.dataset?.featureCalendarDate) return child.dataset.featureCalendarDate;

  const datedParent = target?.closest?.("[data-feature-calendar-date]");
  return datedParent?.dataset?.featureCalendarDate || null;
}

function setDraggedFromElement(element) {
  const kind = element?.dataset?.featureKind;
  const id = element?.dataset?.featureId;
  if ((kind === "task" || kind === "event") && id) dragged = { kind, id };
}

function clearDropHighlights() {
  $$("#calendarBody .feature-calendar-drop-active").forEach((el) => el.classList.remove("feature-calendar-drop-active"));
}

function bindCalendarDragGuard() {
  if (document.documentElement.dataset.calendarDragStayWired) return;
  document.documentElement.dataset.calendarDragStayWired = "1";

  // 달력 항목 드래그 시작을 한 방식으로 통일한다.
  document.addEventListener("dragstart", (event) => {
    const entry = event.target.closest("#calendarBody [data-feature-kind][data-feature-id]");
    if (!entry) return;
    setDraggedFromElement(entry);
    if (!dragged) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(dragged.kind === "task" ? "text/task-id" : "text/event-id", dragged.id);
  }, true);

  document.addEventListener("dragover", (event) => {
    if (!dragged) return;
    const target = calendarDropTarget(event.target);
    if (!target) return;
    const dateKey = targetDateKey(target);
    if (!dateKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    target.classList.add("feature-calendar-drop-active");
  }, true);

  document.addEventListener("dragleave", (event) => {
    const target = calendarDropTarget(event.target);
    if (target) target.classList.remove("feature-calendar-drop-active");
  }, true);

  // 기존 features.js의 drop → window.location.reload() 흐름보다 먼저 처리한다.
  document.addEventListener("drop", async (event) => {
    const target = calendarDropTarget(event.target);
    if (!target) return;

    const taskId = event.dataTransfer.getData("text/task-id");
    const eventId = event.dataTransfer.getData("text/event-id");
    const kind = taskId ? "task" : eventId ? "event" : dragged?.kind;
    const id = taskId || eventId || dragged?.id;
    const dateKey = targetDateKey(target);
    if (!kind || !id || !dateKey) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    clearDropHighlights();

    try {
      await writeState((state) => {
        if (kind === "task") {
          const task = state.tasks.find((item) => item.id === id);
          if (task) task.date = dateKey;
          return;
        }
        const item = state.events.find((entry) => entry.id === id);
        if (item) moveEventDate(item, dateKey);
      });
    } catch (error) {
      console.error(error);
      window.alert("날짜를 옮기지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      dragged = null;
    }
  }, true);

  document.addEventListener("dragend", () => {
    dragged = null;
    clearDropHighlights();
  }, true);
}

async function init(session) {
  currentUser = session?.user || null;
  if (!currentUser) return;
  bindCalendarDragGuard();
}

supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  if (currentUser) setTimeout(() => init(session), 0);
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) await init(session);
