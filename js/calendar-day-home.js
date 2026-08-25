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

function appDayFromDate(date) {
  const shifted = new Date(date);
  shifted.setHours(shifted.getHours() - 3);
  return localDateKey(shifted);
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  state.habitTemplates = Array.isArray(state.habitTemplates) ? state.habitTemplates : [];
  state.habitDays = state.habitDays && typeof state.habitDays === "object" ? state.habitDays : {};
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
  scheduleRender(180);
}

function taskMarkup(task) {
  return `
    <div class="calendar-home-task${task.done ? " done" : ""}" draggable="${task.done ? "false" : "true"}" data-calendar-home-task="${task.id}" data-context-kind="task" data-context-id="${task.id}">
      <button class="calendar-home-check${task.done ? " checked" : ""}" type="button" data-calendar-home-check="${task.id}" aria-label="완료">${task.done ? "✓" : ""}</button>
      <span class="calendar-home-task-title" data-calendar-home-edit="${task.id}" tabindex="0">${esc(task.title)}</span>
    </div>`;
}

function timeBlockTable(state, dateKey) {
  const templates = [...state.timeBlockTemplates].sort((a, b) => Number(a.startMinute) - Number(b.startMinute));
  const tasks = state.tasks.filter((task) => task.date === dateKey);
  const unassigned = tasks.filter((task) => !task.timeBlockTemplateId).sort((a, b) => Number(a.done) - Number(b.done));
  const now = new Date();
  const today = dateKey === appDayKey();
  const nowMinute = now.getHours() * 60 + now.getMinutes();

  const rows = [];
  rows.push(`
    <section class="calendar-home-block-row unassigned" data-calendar-home-template="">
      <div class="calendar-home-time-cell"><div class="calendar-home-time">${today ? "오늘 할일" : "할일"}</div></div>
      <div class="calendar-home-list-cell" data-calendar-home-drop="">${unassigned.length ? unassigned.map(taskMarkup).join("") : '<div class="calendar-home-empty"></div>'}</div>
    </section>`);

  for (const template of templates) {
    const blockTasks = tasks.filter((task) => task.timeBlockTemplateId === template.id).sort((a, b) => Number(a.done) - Number(b.done));
    const current = today && nowMinute >= Number(template.startMinute) && nowMinute < Number(template.endMinute);
    const title = String(template.title || "").trim();
    rows.push(`
      <section class="calendar-home-block-row${current ? " current" : ""}" data-calendar-home-template="${template.id}">
        <div class="calendar-home-time-cell">
          <div class="calendar-home-time">${minuteText(template.startMinute)}–${minuteText(template.endMinute)}</div>
          ${title ? `<div class="calendar-home-block-name">${esc(title)}</div>` : ""}
          ${current ? '<span class="calendar-home-now">지금</span>' : ""}
        </div>
        <div class="calendar-home-list-cell" data-calendar-home-drop="${template.id}">${blockTasks.length ? blockTasks.map(taskMarkup).join("") : '<div class="calendar-home-empty"></div>'}</div>
      </section>`);
  }
  return `<div class="calendar-home-block-table">${rows.join("")}</div>`;
}

function somedayMarkup(state) {
  const tasks = state.tasks.filter((task) => !task.date).sort((a, b) => Number(a.done) - Number(b.done));
  if (!tasks.length) return '<div class="empty">언젠가 할일이 없어요.</div>';
  return tasks.map((task) => `
    <div class="calendar-home-someday row${task.done ? " done" : ""}" draggable="${task.done ? "false" : "true"}" data-calendar-home-task="${task.id}" data-context-kind="task" data-context-id="${task.id}">
      <button class="check ${task.done ? "checked" : ""}" type="button" data-calendar-home-check="${task.id}">${task.done ? "✓" : ""}</button>
      <span class="row-title">${esc(task.title)}</span>
    </div>`).join("");
}

function habitsMarkup(state, dateKey) {
  const checks = state.habitDays[dateKey] || {};
  const habits = [...state.habitTemplates].sort((a, b) => Number(!!checks[a.id]) - Number(!!checks[b.id]));
  if (!habits.length) return '<div class="empty">설정에서 습관을 추가해 주세요.</div>';
  return habits.map((habit) => {
    const done = !!checks[habit.id];
    return `<div class="row${done ? " done" : ""}" data-context-kind="habit" data-context-id="${habit.id}">
      <button class="check ${done ? "checked" : ""}" type="button" data-calendar-habit-check="${habit.id}">${done ? "✓" : ""}</button>
      <span class="row-title" style="cursor:default">${esc(habit.title)}</span>
    </div>`;
  }).join("");
}

function upcomingMarkup(state, dateKey) {
  const start = new Date(`${dateKey}T00:00:00`);
  const items = state.events.filter((event) => new Date(event.start) >= start).sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 5);
  if (!items.length) return '<div class="empty">다가오는 일정이 없어요.</div>';
  return items.map((event) => {
    const date = new Date(event.start);
    const when = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
    return `<div class="row" data-context-kind="event" data-context-id="${event.id}"><span class="pill">일정</span><span class="row-title" style="cursor:default">${esc(event.title)}</span><span class="card-meta">${when}</span></div>`;
  }).join("");
}

function focusMinutes(state, dateKey) {
  const ms = state.sessions.filter((session) => session.end && appDayFromDate(new Date(session.end)) === dateKey).reduce((sum, session) => sum + Number(session.durationMs || 0), 0);
  const total = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours && minutes) return `${hours}시간 ${minutes}분`;
  if (hours) return `${hours}시간`;
  return `${minutes}분`;
}

function dashboardMarkup(state, dateKey) {
  const tasks = state.tasks.filter((task) => task.date === dateKey);
  const taskDone = tasks.filter((task) => task.done).length;
  const checks = state.habitDays[dateKey] || {};
  const habitDone = state.habitTemplates.filter((habit) => checks[habit.id]).length;
  return `<div class="dash-row">
    <div class="metric"><div class="metric-label">완료한 할일</div><div class="metric-value">${taskDone} / ${tasks.length}</div></div>
    <div class="metric"><div class="metric-label">완료한 습관</div><div class="metric-value">${habitDone} / ${state.habitTemplates.length}</div></div>
    <div class="metric"><div class="metric-label">집중 시간</div><div class="metric-value">${focusMinutes(state, dateKey)}</div></div>
  </div>`;
}

function shellMarkup(state, dateKey) {
  return `<div class="calendar-home-grid">
    <article class="card calendar-home-timeblock-card">
      <div class="card-header"><div class="card-title">시간블럭</div><button class="ghost-btn calendar-home-top-add" type="button" data-calendar-home-top-add aria-label="할일 추가">＋</button></div>
      <form class="calendar-home-quick-add" data-calendar-home-quick-form><input data-calendar-home-quick-input placeholder="할일 입력 후 Enter" aria-label="새 할일"><button class="ghost-btn" type="button" data-calendar-home-quick-close>×</button></form>
      <div class="calendar-home-board">${timeBlockTable(state, dateKey)}</div>
    </article>

    <article class="card calendar-home-someday-card">
      <div class="card-header"><div class="card-title">언젠가 할일</div></div>
      <div class="card-body"><div class="list" data-calendar-home-someday-list>${somedayMarkup(state)}</div></div>
      <div class="card-footer"><div class="add-row"><input data-calendar-home-someday-input placeholder="언젠가 할일 추가"><button class="soft-btn" type="button" data-calendar-home-someday-add>추가</button></div></div>
    </article>

    <article class="card">
      <div class="card-header"><div class="card-title">습관</div><div class="card-meta">미완료 → 완료</div></div>
      <div class="card-body"><div class="list">${habitsMarkup(state, dateKey)}</div></div>
    </article>

    <article class="card">
      <div class="card-header"><div class="card-title">다가오는 일정</div></div>
      <div class="card-body">${upcomingMarkup(state, dateKey)}</div>
    </article>

    <article class="card span-2 calendar-home-dashboard">
      <div class="card-header"><div class="card-title">대시보드</div><div class="card-meta">이 날의 기록</div></div>
      <div class="card-body">${dashboardMarkup(state, dateKey)}</div>
    </article>
  </div>`;
}

function scheduleRender(delay = 40) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderDayHome, delay);
}

async function renderDayHome() {
  if (!isDayView() || rendering) return;
  const dateKey = selectedDateKey();
  const body = $("#calendarBody");
  if (!dateKey || !body) return;
  rendering = true;
  try {
    const current = await readState();
    if (!current) return;
    body.innerHTML = shellMarkup(current.state, dateKey);
    $("#dayModeSeg")?.classList.remove("show");
    wireSurface(body, dateKey);
  } catch (error) {
    console.error("달력 일 화면 표시 실패", error);
    body.innerHTML = '<div class="empty" style="padding:20px">일 화면을 불러오지 못했어요.</div>';
  } finally {
    rendering = false;
  }
}

function openInlineNew(zone, dateKey, templateId = "") {
  if (!zone || $(".calendar-home-new-task", zone)) return;
  $(".calendar-home-empty", zone)?.remove();
  const row = document.createElement("div");
  row.className = "calendar-home-new-task";
  row.innerHTML = '<span>＋</span><input class="calendar-home-inline-input" placeholder="할일 입력" aria-label="새 할일">';
  zone.appendChild(row);
  const input = $("input", row);
  input.focus();
  let saving = false;
  const save = async (continueNext) => {
    if (saving) return;
    const title = input.value.trim();
    if (!title) { if (!continueNext) row.remove(); return; }
    saving = true;
    try {
      await writeState((state) => {
        const task = { id: crypto.randomUUID(), title, done: false, date: dateKey };
        if (templateId) task.timeBlockTemplateId = templateId;
        state.tasks.push(task);
      });
      if (continueNext) setTimeout(() => {
        const next = $(`[data-calendar-home-drop="${CSS.escape(templateId)}"]`, $("#calendarBody"));
        openInlineNew(next, dateKey, templateId);
      }, 220);
    } catch (error) {
      console.error(error);
      window.alert("할일을 추가하지 못했어요.");
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); save(true); }
    if (event.key === "Escape") { event.preventDefault(); row.remove(); }
  });
  input.addEventListener("blur", () => setTimeout(() => { if (!saving && row.isConnected) save(false); }, 0), { once: true });
}

function openInlineEdit(title, dateKey) {
  if (!title || title.querySelector("input")) return;
  const taskId = title.dataset.calendarHomeEdit;
  const zone = title.closest("[data-calendar-home-drop]");
  const templateId = zone?.dataset.calendarHomeDrop || "";
  const old = title.textContent.trim();
  const input = document.createElement("input");
  input.className = "calendar-home-inline-input";
  input.value = old;
  title.textContent = "";
  title.appendChild(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async (next) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (!value) { scheduleRender(); return; }
    try {
      await writeState((state) => {
        const task = state.tasks.find((item) => item.id === taskId);
        if (task) task.title = value;
      });
      if (next) setTimeout(() => {
        const nextZone = $(`[data-calendar-home-drop="${CSS.escape(templateId)}"]`, $("#calendarBody"));
        openInlineNew(nextZone, dateKey, templateId);
      }, 220);
    } catch (error) {
      console.error(error);
      scheduleRender();
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); finish(true); }
    if (event.key === "Escape") { event.preventDefault(); finished = true; scheduleRender(); }
  });
  input.addEventListener("blur", () => finish(false), { once: true });
}

function wireSurface(body, dateKey) {
  $$('[data-calendar-home-check]', body).forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    await writeState((state) => {
      const task = state.tasks.find((item) => item.id === button.dataset.calendarHomeCheck);
      if (task) task.done = !task.done;
    });
  }));

  $$('[data-calendar-habit-check]', body).forEach((button) => button.addEventListener("click", async () => {
    await writeState((state) => {
      state.habitDays ||= {};
      state.habitDays[dateKey] ||= {};
      const id = button.dataset.calendarHabitCheck;
      state.habitDays[dateKey][id] = !state.habitDays[dateKey][id];
    });
  }));

  $$('[data-calendar-home-edit]', body).forEach((title) => {
    title.addEventListener("click", () => openInlineEdit(title, dateKey));
    title.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); openInlineEdit(title, dateKey); } });
  });

  $$('[data-calendar-home-task][draggable="true"]', body).forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/task-id", row.dataset.calendarHomeTask);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
  });

  $$('[data-calendar-home-drop]', body).forEach((zone) => {
    const templateId = zone.dataset.calendarHomeDrop || "";
    zone.addEventListener("click", (event) => {
      if (event.target.closest(".calendar-home-task,button,input,textarea,select")) return;
      openInlineNew(zone, dateKey, templateId);
    });
    zone.addEventListener("dragover", (event) => { if ([...event.dataTransfer.types].includes("text/task-id")) event.preventDefault(); });
    zone.addEventListener("drop", async (event) => {
      const taskId = event.dataTransfer.getData("text/task-id");
      if (!taskId) return;
      event.preventDefault();
      await writeState((state) => {
        const task = state.tasks.find((item) => item.id === taskId);
        if (!task) return;
        task.date = dateKey;
        if (templateId) task.timeBlockTemplateId = templateId;
        else delete task.timeBlockTemplateId;
      });
    });
  });

  const somedayList = $("[data-calendar-home-someday-list]", body);
  if (somedayList) {
    somedayList.addEventListener("dragover", (event) => { if ([...event.dataTransfer.types].includes("text/task-id")) event.preventDefault(); });
    somedayList.addEventListener("drop", async (event) => {
      const taskId = event.dataTransfer.getData("text/task-id");
      if (!taskId) return;
      event.preventDefault();
      await writeState((state) => {
        const task = state.tasks.find((item) => item.id === taskId);
        if (!task) return;
        task.date = null;
        delete task.timeBlockTemplateId;
      });
    });
  }

  const quickForm = $("[data-calendar-home-quick-form]", body);
  const quickInput = $("[data-calendar-home-quick-input]", body);
  $("[data-calendar-home-top-add]", body)?.addEventListener("click", () => { quickForm?.classList.add("open"); if (quickInput) { quickInput.value = ""; quickInput.focus(); } });
  $("[data-calendar-home-quick-close]", body)?.addEventListener("click", () => quickForm?.classList.remove("open"));
  quickForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = quickInput?.value.trim();
    if (!title) return;
    await writeState((state) => state.tasks.push({ id: crypto.randomUUID(), title, done: false, date: dateKey }));
  });

  const somedayInput = $("[data-calendar-home-someday-input]", body);
  const addSomeday = async () => {
    const title = somedayInput?.value.trim();
    if (!title) return;
    somedayInput.value = "";
    await writeState((state) => state.tasks.push({ id: crypto.randomUUID(), title, done: false, date: null }));
  };
  $("[data-calendar-home-someday-add]", body)?.addEventListener("click", addSomeday);
  somedayInput?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addSomeday(); } });
}

function injectStyle() {
  if ($("#calendarDayHomeStyles")) return;
  const style = document.createElement("style");
  style.id = "calendarDayHomeStyles";
  style.textContent = `
    #dayModeSeg{display:none!important}
    #calendarBody .calendar-home-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;padding:14px;align-items:start;background:var(--bg,#fff)}
    #calendarBody .calendar-home-timeblock-card{min-width:0}
    #calendarBody .calendar-home-board{padding:0 12px 12px}
    #calendarBody .calendar-home-block-table{width:100%;border-top:1px solid var(--line-strong,#b8c0cb);border-bottom:1px solid var(--line-strong,#b8c0cb)}
    #calendarBody .calendar-home-block-row{display:grid;grid-template-columns:128px minmax(0,1fr);min-height:44px;border-bottom:1px solid var(--line,#d2d7df)}
    #calendarBody .calendar-home-block-row:last-child{border-bottom:0}
    #calendarBody .calendar-home-block-row.current{background:var(--accent-soft,#eef2f6)}
    #calendarBody .calendar-home-time-cell{padding:8px 10px;border-right:1px solid var(--line,#d2d7df)}
    #calendarBody .calendar-home-time{font-size:12px;font-weight:650;font-variant-numeric:tabular-nums}
    #calendarBody .calendar-home-block-name{margin-top:2px;font-size:10px;color:var(--muted,#6b7280)}
    #calendarBody .calendar-home-now{display:inline-block;margin-top:3px;font-size:9px;color:var(--muted,#6b7280)}
    #calendarBody .calendar-home-list-cell{min-height:44px;padding:5px 8px;display:flex;flex-direction:column;justify-content:center;gap:2px;cursor:text}
    #calendarBody .calendar-home-task{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:center;gap:6px;min-height:28px;padding:2px 3px;cursor:grab}
    #calendarBody .calendar-home-task:hover{background:var(--hover,#f3f5f7)}
    #calendarBody .calendar-home-task.done{cursor:default}
    #calendarBody .calendar-home-task.done .calendar-home-task-title{text-decoration:line-through;color:var(--muted,#6b7280)}
    #calendarBody .calendar-home-check{width:18px;height:18px;padding:0;border:1px solid var(--line-strong,#b8c0cb);border-radius:4px;background:#fff;cursor:pointer}
    #calendarBody .calendar-home-check.checked{background:var(--accent-soft,#eef2f6)}
    #calendarBody .calendar-home-task-title{font-size:13px;cursor:text;min-width:0;word-break:break-word}
    #calendarBody .calendar-home-inline-input{width:100%;min-width:0;height:28px;border:1px solid var(--line-strong,#b8c0cb);border-radius:5px;padding:3px 6px;background:#fff;color:var(--text,#1f2328)}
    #calendarBody .calendar-home-new-task{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:center;gap:5px;min-height:28px;color:var(--muted,#6b7280)}
    #calendarBody .calendar-home-empty{min-height:24px}
    #calendarBody .calendar-home-top-add{width:30px;height:30px;min-height:30px;padding:0;font-size:20px}
    #calendarBody .calendar-home-quick-add{display:none;gap:6px;padding:0 12px 9px}
    #calendarBody .calendar-home-quick-add.open{display:flex}
    #calendarBody .calendar-home-quick-add input{flex:1;min-width:0;height:34px;border:1px solid var(--line,#d2d7df);border-radius:7px;padding:5px 8px}
    #calendarBody .calendar-home-someday.dragging,#calendarBody .calendar-home-task.dragging{opacity:.45}
    #calendarBody .calendar-home-dashboard{grid-column:1/-1}
    @media(max-width:800px){#calendarBody .calendar-home-grid{grid-template-columns:1fr}#calendarBody .calendar-home-dashboard{grid-column:auto}}
    @media(max-width:620px){#calendarBody .calendar-home-block-row{grid-template-columns:96px minmax(0,1fr)}#calendarBody .calendar-home-grid{padding:8px;gap:10px}}
  `;
  document.head.appendChild(style);
}

function wireGlobal() {
  if (wired) return;
  wired = true;
  injectStyle();

  $$("#calendarViewSeg button").forEach((button) => button.addEventListener("click", () => scheduleRender(80)));
  $("#calPrev")?.addEventListener("click", () => scheduleRender(80));
  $("#calNext")?.addEventListener("click", () => scheduleRender(80));
  $$(".nav-item[data-page='calendar'],[data-go='calendar']").forEach((button) => button.addEventListener("click", () => scheduleRender(100)));
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
