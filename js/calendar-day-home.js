import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (n) => String(n).padStart(2, "0");

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

let renderTimer = null;
let rendering = false;
let wired = false;
let pendingNewTask = null;

function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayKey(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return localDateKey(date);
}

function selectedDateKey() {
  const text = $("#calTitle")?.textContent || "";
  const match = text.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!match) return null;
  return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
}

function isDayView() {
  return $("#calendarViewSeg [data-view='day']")?.classList.contains("active") === true;
}

function minuteText(minute) {
  const value = Math.max(0, Math.min(1439, Number(minute) || 0));
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
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

  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  if (!Array.isArray(state.timeBlockTemplates) || !state.timeBlockTemplates.length) {
    state.timeBlockTemplates = DEFAULT_TEMPLATES.map((item) => ({ ...item }));
  }
  return { user: session.user, state };
}

async function writeState(mutator, options = {}) {
  const current = await readState();
  if (!current) return;
  mutator(current.state);
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: current.user.id, data: current.state }, { onConflict: "user_id" });
  if (error) throw error;
  pendingNewTask = options.pendingNewTask || null;
  $("#reloadCloudBtn")?.click();
  scheduleRender(160);
}

function taskMarkup(task) {
  return `
    <div class="calendar-day-block-task${task.done ? " done" : ""}" draggable="${task.done ? "false" : "true"}" data-calendar-day-task="${task.id}" data-context-kind="task" data-context-id="${task.id}">
      <button class="calendar-day-block-check${task.done ? " checked" : ""}" type="button" data-calendar-day-check="${task.id}" aria-label="완료">${task.done ? "✓" : ""}</button>
      <span class="calendar-day-block-title" data-calendar-day-edit="${task.id}" tabindex="0">${esc(task.title)}</span>
    </div>`;
}

function blockTable(state, dateKey) {
  const templates = [...state.timeBlockTemplates].sort((a, b) => Number(a.startMinute) - Number(b.startMinute));
  const tasks = state.tasks.filter((task) => task.date === dateKey);
  const unassigned = tasks
    .filter((task) => !task.timeBlockTemplateId)
    .sort((a, b) => Number(a.done) - Number(b.done));

  const today = dateKey === appDayKey();
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const rows = [];

  rows.push(`
    <section class="calendar-day-block-row unassigned" data-calendar-day-template="">
      <div class="calendar-day-time-cell"><div class="calendar-day-time">하루종일</div></div>
      <div class="calendar-day-list-cell" data-calendar-day-drop="">${unassigned.length ? unassigned.map(taskMarkup).join("") : '<div class="calendar-day-empty"></div>'}</div>
    </section>`);

  for (const template of templates) {
    const blockTasks = tasks
      .filter((task) => task.timeBlockTemplateId === template.id)
      .sort((a, b) => Number(a.done) - Number(b.done));
    const current = today && nowMinute >= Number(template.startMinute) && nowMinute < Number(template.endMinute);
    const title = String(template.title || "").trim();

    rows.push(`
      <section class="calendar-day-block-row${current ? " current" : ""}" data-calendar-day-template="${template.id}">
        <div class="calendar-day-time-cell">
          <div class="calendar-day-time">${minuteText(template.startMinute)}–${minuteText(template.endMinute)}</div>
          ${title ? `<div class="calendar-day-block-name">${esc(title)}</div>` : ""}
          ${current ? '<span class="calendar-day-now">지금</span>' : ""}
        </div>
        <div class="calendar-day-list-cell" data-calendar-day-drop="${template.id}">${blockTasks.length ? blockTasks.map(taskMarkup).join("") : '<div class="calendar-day-empty"></div>'}</div>
      </section>`);
  }

  return `<div class="calendar-day-block-table">${rows.join("")}</div>`;
}

function shellMarkup(state, dateKey) {
  return `
    <article class="card calendar-day-timeblock-card">
      <div class="card-header">
        <div class="card-title">오늘의 시간블럭</div>
        <button class="ghost-btn calendar-day-top-add" type="button" data-calendar-day-top-add aria-label="할일 추가" title="할일 추가">＋</button>
      </div>
      <form class="calendar-day-quick-add" data-calendar-day-quick-form>
        <input data-calendar-day-quick-input placeholder="할일 입력 후 Enter" aria-label="새 할일" />
        <button class="ghost-btn" type="button" data-calendar-day-quick-close aria-label="닫기">×</button>
      </form>
      <div class="calendar-day-board">${blockTable(state, dateKey)}</div>
    </article>`;
}

function scheduleRender(delay = 40) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderDayBlock, delay);
}

async function renderDayBlock() {
  if (!isDayView() || rendering) return;
  const dateKey = selectedDateKey();
  const body = $("#calendarBody");
  if (!dateKey || !body) return;

  rendering = true;
  try {
    const current = await readState();
    if (!current) return;
    body.innerHTML = shellMarkup(current.state, dateKey);
    wireSurface(body, dateKey);
    restorePendingInput(body, dateKey);
  } catch (error) {
    console.error("달력 일 시간블럭 표시 실패", error);
    body.innerHTML = '<div class="empty" style="padding:20px">시간블럭을 불러오지 못했어요.</div>';
  } finally {
    rendering = false;
  }
}

function openInlineNew(zone, dateKey, templateId = "") {
  if (!zone || $(".calendar-day-new-task", zone)) return;
  $(".calendar-day-empty", zone)?.remove();

  const row = document.createElement("div");
  row.className = "calendar-day-new-task";
  row.innerHTML = '<span>＋</span><input class="calendar-day-inline-input" placeholder="할일 입력" aria-label="새 할일" />';
  zone.appendChild(row);

  const input = $("input", row);
  input.focus();
  let saving = false;

  const save = async (continueNext) => {
    if (saving) return;
    const title = input.value.trim();
    if (!title) {
      if (!continueNext) row.remove();
      return;
    }

    saving = true;
    try {
      await writeState((state) => {
        const task = { id: crypto.randomUUID(), title, done: false, date: dateKey };
        if (templateId) task.timeBlockTemplateId = templateId;
        state.tasks.push(task);
      }, continueNext ? { pendingNewTask: { dateKey, templateId } } : {});
    } catch (error) {
      console.error("달력 일 시간블럭 할일 추가 실패", error);
      saving = false;
      window.alert("할일을 추가하지 못했어요.");
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      save(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      row.remove();
    }
  });
  input.addEventListener("blur", () => setTimeout(() => {
    if (!saving && row.isConnected) save(false);
  }, 0), { once: true });
}

function restorePendingInput(body, dateKey) {
  const pending = pendingNewTask;
  pendingNewTask = null;
  if (!pending || pending.dateKey !== dateKey) return;
  requestAnimationFrame(() => {
    const selector = `[data-calendar-day-drop="${CSS.escape(pending.templateId || "")}"]`;
    openInlineNew($(selector, body), dateKey, pending.templateId || "");
  });
}

function openInlineEdit(title, dateKey) {
  if (!title || title.querySelector("input")) return;
  const taskId = title.dataset.calendarDayEdit;
  const zone = title.closest("[data-calendar-day-drop]");
  const templateId = zone?.dataset.calendarDayDrop || "";
  const oldTitle = title.textContent.trim();

  const input = document.createElement("input");
  input.className = "calendar-day-inline-input";
  input.value = oldTitle;
  title.textContent = "";
  title.appendChild(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = async (createNext) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (!value) {
      scheduleRender();
      return;
    }
    try {
      await writeState((state) => {
        const task = state.tasks.find((item) => item.id === taskId);
        if (task) task.title = value;
      }, createNext ? { pendingNewTask: { dateKey, templateId } } : {});
    } catch (error) {
      console.error("달력 일 시간블럭 할일 수정 실패", error);
      scheduleRender();
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finished = true;
      scheduleRender();
    }
  });
  input.addEventListener("blur", () => finish(false), { once: true });
}

function wireSurface(body, dateKey) {
  $$('[data-calendar-day-check]', body).forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await writeState((state) => {
          const task = state.tasks.find((item) => item.id === button.dataset.calendarDayCheck);
          if (task) task.done = !task.done;
        });
      } catch (error) {
        console.error("달력 일 시간블럭 완료 처리 실패", error);
      }
    });
  });

  $$('[data-calendar-day-edit]', body).forEach((title) => {
    title.addEventListener("click", () => openInlineEdit(title, dateKey));
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        openInlineEdit(title, dateKey);
      }
    });
  });

  $$('[data-calendar-day-task][draggable="true"]', body).forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/task-id", row.dataset.calendarDayTask);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
  });

  $$('[data-calendar-day-drop]', body).forEach((zone) => {
    const templateId = zone.dataset.calendarDayDrop || "";

    zone.addEventListener("click", (event) => {
      if (event.target.closest(".calendar-day-block-task,button,input,textarea,select,[contenteditable='true']")) return;
      openInlineNew(zone, dateKey, templateId);
    });

    zone.addEventListener("dragover", (event) => {
      if (![...event.dataTransfer.types].includes("text/task-id")) return;
      event.preventDefault();
      zone.closest(".calendar-day-block-row")?.classList.add("over");
    });

    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget)) zone.closest(".calendar-day-block-row")?.classList.remove("over");
    });

    zone.addEventListener("drop", async (event) => {
      const taskId = event.dataTransfer.getData("text/task-id");
      if (!taskId) return;
      event.preventDefault();
      zone.closest(".calendar-day-block-row")?.classList.remove("over");
      try {
        await writeState((state) => {
          const task = state.tasks.find((item) => item.id === taskId);
          if (!task) return;
          task.date = dateKey;
          if (templateId) task.timeBlockTemplateId = templateId;
          else delete task.timeBlockTemplateId;
        });
      } catch (error) {
        console.error("달력 일 시간블럭 이동 실패", error);
        window.alert("할일을 옮기지 못했어요.");
      }
    });
  });

  const quickForm = $("[data-calendar-day-quick-form]", body);
  const quickInput = $("[data-calendar-day-quick-input]", body);

  $("[data-calendar-day-top-add]", body)?.addEventListener("click", () => {
    quickForm?.classList.add("open");
    if (quickInput) {
      quickInput.value = "";
      requestAnimationFrame(() => quickInput.focus());
    }
  });

  $("[data-calendar-day-quick-close]", body)?.addEventListener("click", () => {
    if (quickInput) quickInput.value = "";
    quickForm?.classList.remove("open");
  });

  quickForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = quickInput?.value.trim();
    if (!title) return;
    try {
      await writeState((state) => {
        state.tasks.push({ id: crypto.randomUUID(), title, done: false, date: dateKey });
      });
    } catch (error) {
      console.error("달력 일 시간블럭 빠른 추가 실패", error);
      window.alert("할일을 추가하지 못했어요.");
    }
  });
}

function injectStyle() {
  if ($("#calendarDayBlockStyles")) return;
  const style = document.createElement("style");
  style.id = "calendarDayBlockStyles";
  style.textContent = `
    #dayModeSeg{display:none!important}
    #calendarBody .calendar-day-timeblock-card{margin:14px;min-width:0}
    #calendarBody .calendar-day-board{padding:0 12px 12px}
    #calendarBody .calendar-day-block-table{width:100%;border-top:1px solid var(--line-strong,#b8c0cb);border-bottom:1px solid var(--line-strong,#b8c0cb)}
    #calendarBody .calendar-day-block-row{display:grid;grid-template-columns:128px minmax(0,1fr);min-height:44px;border-bottom:1px solid var(--line,#d2d7df);background:transparent}
    #calendarBody .calendar-day-block-row:last-child{border-bottom:0}
    #calendarBody .calendar-day-block-row.current{background:var(--accent-soft,#eef2f6)}
    #calendarBody .calendar-day-block-row.over{background:var(--hover,#f3f5f7)}
    #calendarBody .calendar-day-time-cell{padding:8px 10px;border-right:1px solid var(--line,#d2d7df)}
    #calendarBody .calendar-day-time{font-size:12px;font-weight:650;font-variant-numeric:tabular-nums}
    #calendarBody .calendar-day-block-name{margin-top:2px;font-size:10px;color:var(--muted,#6b7280)}
    #calendarBody .calendar-day-now{display:inline-block;margin-top:3px;font-size:9px;color:var(--muted,#6b7280)}
    #calendarBody .calendar-day-list-cell{min-height:44px;padding:5px 8px;display:flex;flex-direction:column;justify-content:center;gap:2px;cursor:text}
    #calendarBody .calendar-day-block-task{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:center;gap:6px;min-height:28px;padding:2px 3px;cursor:grab}
    #calendarBody .calendar-day-block-task:hover{background:var(--hover,#f3f5f7)}
    #calendarBody .calendar-day-block-task.done{cursor:default}
    #calendarBody .calendar-day-block-task.done .calendar-day-block-title{text-decoration:line-through;color:var(--muted,#6b7280)}
    #calendarBody .calendar-day-block-task.dragging{opacity:.45}
    #calendarBody .calendar-day-block-check{width:18px;height:18px;padding:0;border:1px solid var(--line-strong,#b8c0cb);border-radius:4px;background:#fff;color:var(--text,#1f2328);cursor:pointer}
    #calendarBody .calendar-day-block-check.checked{background:var(--accent-soft,#eef2f6)}
    #calendarBody .calendar-day-block-title{font-size:13px;cursor:text;min-width:0;word-break:break-word}
    #calendarBody .calendar-day-inline-input{width:100%;min-width:0;height:28px;border:1px solid var(--line-strong,#b8c0cb);border-radius:5px;padding:3px 6px;background:#fff;color:var(--text,#1f2328)}
    #calendarBody .calendar-day-new-task{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:center;gap:5px;min-height:28px;color:var(--muted,#6b7280)}
    #calendarBody .calendar-day-empty{min-height:24px}
    #calendarBody .calendar-day-top-add{width:30px;height:30px;min-height:30px;padding:0;font-size:20px}
    #calendarBody .calendar-day-quick-add{display:none;gap:6px;padding:0 12px 9px}
    #calendarBody .calendar-day-quick-add.open{display:flex}
    #calendarBody .calendar-day-quick-add input{flex:1;min-width:0;height:34px;border:1px solid var(--line,#d2d7df);border-radius:7px;padding:5px 8px;background:#fff;color:var(--text,#1f2328)}
    @media(max-width:620px){
      #calendarBody .calendar-day-timeblock-card{margin:8px}
      #calendarBody .calendar-day-block-row{grid-template-columns:96px minmax(0,1fr)}
    }
  `;
  document.head.appendChild(style);
}

function wireGlobal() {
  if (wired) return;
  wired = true;
  injectStyle();

  $$("#calendarViewSeg button").forEach((button) => {
    button.addEventListener("click", () => scheduleRender(80));
  });
  $("#calPrev")?.addEventListener("click", () => scheduleRender(80));
  $("#calNext")?.addEventListener("click", () => scheduleRender(80));
  $$(".nav-item[data-page='calendar'],[data-go='calendar']").forEach((button) => {
    button.addEventListener("click", () => scheduleRender(100));
  });
  $("#reloadCloudBtn")?.addEventListener("click", () => scheduleRender(160));
}

function init() {
  wireGlobal();
  scheduleRender(120);
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) init();
