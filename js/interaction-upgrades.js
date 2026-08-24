import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (n) => String(n).padStart(2, "0");
const SLOT = 30;
const START_MIN = 6 * 60;
const END_MIN = 22 * 60;

let cloudState = null;
let currentUser = null;
let selectedBlockId = null;
let timelineObserver = null;
let arrangeTimer = null;
let quickAddDate = null;

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

function clampMinute(minute, duration = SLOT) {
  const rounded = Math.round(Number(minute) / SLOT) * SLOT;
  return Math.max(START_MIN, Math.min(rounded, END_MIN - duration));
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user || null;
  if (!currentUser) return null;

  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) throw error;
  cloudState = data?.data && typeof data.data === "object" ? data.data : {};
  cloudState.tasks = Array.isArray(cloudState.tasks) ? cloudState.tasks : [];
  cloudState.events = Array.isArray(cloudState.events) ? cloudState.events : [];
  cloudState.timeBlocks = Array.isArray(cloudState.timeBlocks) ? cloudState.timeBlocks : [];
  return cloudState;
}

async function writeState(mutator) {
  const state = await readState();
  if (!state || !currentUser) return false;
  mutator(state);

  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: currentUser.id, data: state }, { onConflict: "user_id" });

  if (error) throw error;
  cloudState = state;

  const reload = $("#reloadCloudBtn");
  if (reload) reload.click();
  scheduleArrange();
  return true;
}

function injectStyles() {
  if ($("#interactionUpgradeStyles")) return;
  const style = document.createElement("style");
  style.id = "interactionUpgradeStyles";
  style.textContent = `
    .overlap-time-selection {
      position: absolute;
      left: 61px;
      right: 8px;
      z-index: 8;
      pointer-events: none;
      border: 1.5px dashed #77818c;
      border-radius: 7px;
      background: rgba(71, 85, 105, .10);
    }
    .quick-add-type {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 12px;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: #f5f7f9;
    }
    .quick-add-type button {
      min-height: 36px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }
    .quick-add-type button.active {
      background: #fff;
      color: var(--text);
      box-shadow: 0 1px 2px rgba(15, 23, 42, .08);
      font-weight: 650;
    }
    .day-cell[data-feature-calendar-date],
    .week-col[data-feature-calendar-date] {
      cursor: pointer;
    }
    .day-cell[data-feature-calendar-date]:hover,
    .week-col[data-feature-calendar-date]:hover {
      background: #fafbfc;
    }
    .calendar-click-hint {
      color: var(--muted);
      font-size: 11px;
      margin-left: 8px;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

function makeGroups(items, getStart, getEnd) {
  const sorted = [...items].sort((a, b) => getStart(a) - getStart(b) || getEnd(a) - getEnd(b));
  const groups = [];
  let group = [];
  let maxEnd = -Infinity;

  for (const item of sorted) {
    const start = getStart(item);
    const end = getEnd(item);
    if (group.length && start >= maxEnd) {
      groups.push(group);
      group = [];
      maxEnd = -Infinity;
    }
    group.push(item);
    maxEnd = Math.max(maxEnd, end);
  }
  if (group.length) groups.push(group);
  return groups;
}

function assignLanes(group, getStart, getEnd) {
  const laneEnds = [];
  return group.map((item) => {
    const start = getStart(item);
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(getEnd(item));
    } else {
      laneEnds[lane] = getEnd(item);
    }
    return { item, lane, laneCount: 0 };
  }).map((entry) => ({ ...entry, laneCount: laneEnds.length }));
}

function arrangeHomeOverlaps() {
  const grid = $("#timeGrid");
  if (!grid || !cloudState?.timeBlocks) return;
  const dayKey = appDayKey();
  const visible = cloudState.timeBlocks.filter((block) => block.date === dayKey);

  $$(".time-block", grid).forEach((element) => {
    element.style.left = "";
    element.style.right = "";
    element.style.width = "";
    element.style.zIndex = "";
  });

  const groups = makeGroups(
    visible,
    (block) => Number(block.startMinute || 0),
    (block) => Number(block.startMinute || 0) + Number(block.duration || SLOT),
  );

  for (const group of groups) {
    const lanes = assignLanes(
      group,
      (block) => Number(block.startMinute || 0),
      (block) => Number(block.startMinute || 0) + Number(block.duration || SLOT),
    );
    for (const { item, lane, laneCount } of lanes) {
      if (laneCount <= 1) continue;
      const element = grid.querySelector(`.time-block[data-block-id="${CSS.escape(item.id)}"]`);
      if (!element) continue;
      const width = 96 / laneCount;
      element.style.left = `${2 + width * lane}%`;
      element.style.right = "auto";
      element.style.width = `${Math.max(18, width - 1)}%`;
      element.style.zIndex = String(10 + lane);
    }
  }
}

function arrangeCalendarOverlaps() {
  const timeline = $("#calendarBody .day-timeline");
  if (!timeline || !cloudState?.events) return;

  const elements = $$(".day-timed-event[data-feature-id]", timeline);
  const items = elements.map((element) => {
    const event = cloudState.events.find((entry) => entry.id === element.dataset.featureId);
    if (!event?.start) return null;
    const start = new Date(event.start);
    const end = event.end ? new Date(event.end) : new Date(start.getTime() + SLOT * 60000);
    return { event, element, start: start.getTime(), end: Math.max(end.getTime(), start.getTime() + SLOT * 60000) };
  }).filter(Boolean);

  for (const { element } of items) {
    element.style.left = "";
    element.style.right = "";
    element.style.width = "";
    element.style.zIndex = "";
  }

  const groups = makeGroups(items, (item) => item.start, (item) => item.end);
  for (const group of groups) {
    const lanes = assignLanes(group, (item) => item.start, (item) => item.end);
    for (const { item, lane, laneCount } of lanes) {
      if (laneCount <= 1) continue;
      const width = 96 / laneCount;
      item.element.style.left = `${2 + width * lane}%`;
      item.element.style.right = "auto";
      item.element.style.width = `${Math.max(18, width - 1)}%`;
      item.element.style.zIndex = String(10 + lane);
    }
  }
}

async function arrangeAll() {
  try {
    await readState();
    arrangeHomeOverlaps();
    arrangeCalendarOverlaps();
  } catch (error) {
    console.error("겹치는 시간 배치 실패", error);
  }
}

function scheduleArrange() {
  clearTimeout(arrangeTimer);
  arrangeTimer = setTimeout(arrangeAll, 80);
}

function wireTimeGridOverlap() {
  const grid = $("#timeGrid");
  if (!grid || grid.dataset.overlapWired) return;
  grid.dataset.overlapWired = "true";

  grid.addEventListener("drop", async (event) => {
    const blockId = event.dataTransfer?.getData("text/time-block-id");
    const taskId = event.dataTransfer?.getData("text/task-id");
    if (!blockId && !taskId) return;

    const slot = event.target.closest(".time-slot");
    if (!slot) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const minute = clampMinute(Number(slot.dataset.minute), SLOT);
    try {
      await writeState((state) => {
        if (blockId) {
          const block = state.timeBlocks.find((item) => item.id === blockId);
          if (block) {
            block.startMinute = clampMinute(minute, Number(block.duration || SLOT));
            block.date = appDayKey();
          }
          return;
        }

        const task = state.tasks.find((item) => item.id === taskId);
        if (!task) return;
        if (!task.date) task.date = appDayKey();
        state.timeBlocks.push({
          id: crypto.randomUUID(),
          taskId: task.id,
          sourceTitle: task.title,
          detail: task.title,
          startMinute: minute,
          duration: SLOT,
          date: appDayKey(),
        });
      });
    } catch (error) {
      console.error(error);
      window.alert("시간 계획을 저장하지 못했어요.");
    }
  }, true);

  let selecting = false;
  let startIndex = 0;
  let currentIndex = 0;
  let preview = null;

  const rows = () => $$(".time-slot", grid);
  const rowHeight = () => rows()[0]?.getBoundingClientRect().height || 42;
  const pointIndex = (clientY) => {
    const rect = grid.getBoundingClientRect();
    const index = Math.floor((clientY - rect.top) / rowHeight());
    return Math.max(0, Math.min(rows().length - 1, index));
  };
  const paint = () => {
    preview?.remove();
    const first = Math.min(startIndex, currentIndex);
    const last = Math.max(startIndex, currentIndex);
    preview = document.createElement("div");
    preview.className = "overlap-time-selection";
    preview.style.top = `${first * rowHeight() + 2}px`;
    preview.style.height = `${(last - first + 1) * rowHeight() - 4}px`;
    grid.appendChild(preview);
  };
  const clear = () => {
    selecting = false;
    preview?.remove();
    preview = null;
  };

  grid.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.target.closest(".time-block")) return;
    const slot = event.target.closest(".time-slot");
    if (!slot) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selecting = true;
    startIndex = currentIndex = pointIndex(event.clientY);
    paint();
  }, true);

  document.addEventListener("mousemove", (event) => {
    if (!selecting) return;
    currentIndex = pointIndex(event.clientY);
    paint();
  });

  document.addEventListener("mouseup", async () => {
    if (!selecting) return;
    const first = Math.min(startIndex, currentIndex);
    const last = Math.max(startIndex, currentIndex);
    const startMinute = START_MIN + first * SLOT;
    const duration = Math.min(240, (last - first + 1) * SLOT);
    clear();

    try {
      await writeState((state) => {
        state.timeBlocks.push({
          id: crypto.randomUUID(),
          taskId: null,
          sourceTitle: "직접 추가",
          detail: "새 시간 계획",
          startMinute,
          duration,
          date: appDayKey(),
        });
      });
    } catch (error) {
      console.error(error);
      window.alert("시간 계획을 저장하지 못했어요.");
    }
  });
}

function wireTimeBlockEditorOverlap() {
  if (document.documentElement.dataset.overlapEditorWired) return;
  document.documentElement.dataset.overlapEditorWired = "true";

  document.addEventListener("click", (event) => {
    const block = event.target.closest(".time-block[data-block-id]");
    if (block) selectedBlockId = block.dataset.blockId;
  }, true);

  const saveButton = $("#saveBlockBtn");
  if (saveButton && !saveButton.dataset.overlapWired) {
    saveButton.dataset.overlapWired = "true";
    saveButton.addEventListener("click", async (event) => {
      if (!selectedBlockId) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const detail = $("#blockDetail")?.value.trim() || "시간 계획";
      const startMinute = Number($("#blockStart")?.value);
      const duration = Number($("#blockDuration")?.value || SLOT);

      try {
        await writeState((state) => {
          const block = state.timeBlocks.find((item) => item.id === selectedBlockId);
          if (!block) return;
          block.detail = detail;
          block.startMinute = clampMinute(startMinute, duration);
          block.duration = duration;
        });
        $("#blockEditor")?.classList.remove("open");
      } catch (error) {
        console.error(error);
        window.alert("시간 계획을 저장하지 못했어요.");
      }
    }, true);
  }

  const addButton = $("#addTimeBlockBtn");
  if (addButton && !addButton.dataset.overlapWired) {
    addButton.dataset.overlapWired = "true";
    addButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const now = new Date();
      let minute = Math.ceil((now.getHours() * 60 + now.getMinutes()) / SLOT) * SLOT;
      minute = clampMinute(minute, SLOT);

      try {
        await writeState((state) => {
          state.timeBlocks.push({
            id: crypto.randomUUID(),
            taskId: null,
            sourceTitle: "직접 추가",
            detail: "새 시간 계획",
            startMinute: minute,
            duration: SLOT,
            date: appDayKey(),
          });
        });
      } catch (error) {
        console.error(error);
        window.alert("시간 계획을 저장하지 못했어요.");
      }
    }, true);
  }
}

function ensureQuickAddDialog() {
  if ($("#calendarQuickAddDialog")) return;

  const dialog = document.createElement("dialog");
  dialog.id = "calendarQuickAddDialog";
  dialog.className = "app-dialog";
  dialog.innerHTML = `
    <form method="dialog" id="calendarQuickAddForm">
      <h3>이 날짜에 추가</h3>
      <div class="quick-add-type" role="group" aria-label="추가할 항목 종류">
        <button type="button" class="active" data-quick-type="event">일정</button>
        <button type="button" data-quick-type="task">할일</button>
      </div>
      <div class="field"><label>제목</label><input id="calendarQuickTitle" required /></div>
      <div class="field"><label>날짜</label><input id="calendarQuickDate" type="date" required /></div>
      <div class="field" id="calendarQuickTimeField"><label>시간</label><input id="calendarQuickTime" type="time" value="09:00" required /></div>
      <div class="dialog-actions">
        <button class="soft-btn" type="button" id="calendarQuickCancel">취소</button>
        <button class="primary-btn" type="submit">추가</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);

  let type = "event";
  const setType = (next) => {
    type = next;
    $$("[data-quick-type]", dialog).forEach((button) => button.classList.toggle("active", button.dataset.quickType === type));
    $("#calendarQuickTimeField", dialog).classList.toggle("hidden", type === "task");
    $("#calendarQuickTime", dialog).required = type === "event";
  };

  $$("[data-quick-type]", dialog).forEach((button) => button.addEventListener("click", () => setType(button.dataset.quickType)));
  $("#calendarQuickCancel", dialog).addEventListener("click", () => dialog.close());

  $("#calendarQuickAddForm", dialog).addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#calendarQuickTitle", dialog).value.trim();
    const date = $("#calendarQuickDate", dialog).value;
    const time = $("#calendarQuickTime", dialog).value || "09:00";
    if (!title || !date) return;

    try {
      await writeState((state) => {
        if (type === "task") {
          state.tasks.push({ id: crypto.randomUUID(), title, done: false, date });
          return;
        }

        const start = new Date(`${date}T${time}:00`);
        const end = new Date(start.getTime() + SLOT * 60000);
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
      window.alert("항목을 저장하지 못했어요.");
    }
  });

  dialog.addEventListener("close", () => {
    type = "event";
    setType("event");
  });
}

function openQuickAdd(dateKey) {
  ensureQuickAddDialog();
  const dialog = $("#calendarQuickAddDialog");
  quickAddDate = dateKey;
  $("#calendarQuickTitle", dialog).value = "";
  $("#calendarQuickDate", dialog).value = quickAddDate;
  dialog.showModal();
  setTimeout(() => $("#calendarQuickTitle", dialog).focus(), 0);
}

function wireCalendarDateClick() {
  const body = $("#calendarBody");
  if (!body || body.dataset.quickAddWired) return;
  body.dataset.quickAddWired = "true";

  body.addEventListener("click", (event) => {
    if (event.target.closest(".cal-event, .day-timed-event, .row, button, input, select, a")) return;
    const cell = event.target.closest(".day-cell[data-feature-calendar-date], .week-col[data-feature-calendar-date]");
    if (!cell) return;
    openQuickAdd(cell.dataset.featureCalendarDate);
  });
}

function addCalendarHint() {
  const toolbar = $(".calendar-toolbar");
  if (!toolbar || toolbar.querySelector(".calendar-click-hint")) return;
  const hint = document.createElement("span");
  hint.className = "calendar-click-hint";
  hint.textContent = "날짜 칸을 클릭해 바로 추가";
  toolbar.querySelector("strong")?.after(hint);
}

function observeTimelines() {
  const targets = [$("#timeGrid"), $("#calendarBody")].filter(Boolean);
  if (!targets.length || timelineObserver) return;

  timelineObserver = new MutationObserver(() => {
    wireTimeGridOverlap();
    wireTimeBlockEditorOverlap();
    wireCalendarDateClick();
    addCalendarHint();
    scheduleArrange();
  });
  targets.forEach((target) => timelineObserver.observe(target, { childList: true, subtree: true, attributes: true }));
}

async function init() {
  injectStyles();
  ensureQuickAddDialog();
  wireTimeGridOverlap();
  wireTimeBlockEditorOverlap();
  wireCalendarDateClick();
  addCalendarHint();
  observeTimelines();
  try { await readState(); } catch (error) { console.error(error); }
  scheduleArrange();
}

supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  if (currentUser) setTimeout(init, 0);
  else cloudState = null;
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) {
  currentUser = session.user;
  await init();
}
