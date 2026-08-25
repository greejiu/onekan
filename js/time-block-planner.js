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

let boardObserver = null;
let renderTimer = null;
let rendering = false;

function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayKey(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return localDateKey(date);
}

function minuteText(minute) {
  const value = Math.max(0, Math.min(1439, Number(minute) || 0));
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function timeToMinute(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}

function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.timeBlocks = Array.isArray(state.timeBlocks) ? state.timeBlocks : [];
  if (!Array.isArray(state.timeBlockTemplates)) state.timeBlockTemplates = DEFAULT_TEMPLATES.map((item) => ({ ...item }));
  return state;
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
  return { user: session.user, state: normalizeState(data?.data) };
}

async function writeState(mutator) {
  const current = await readState();
  if (!current) return;
  mutator(current.state);
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: current.user.id, data: current.state }, { onConflict: "user_id" });
  if (error) throw error;
  $("#reloadCloudBtn")?.click();
  scheduleRender();
}

async function ensureDefaultsAndMigrate() {
  const current = await readState();
  if (!current) return;
  const raw = current.state;
  let changed = false;

  if (!Array.isArray(raw.timeBlockTemplates)) {
    raw.timeBlockTemplates = DEFAULT_TEMPLATES.map((item) => ({ ...item }));
    changed = true;
  }

  const templates = [...raw.timeBlockTemplates].sort((a, b) => Number(a.startMinute) - Number(b.startMinute));
  for (const task of raw.tasks) {
    if (task.timeBlockTemplateId) continue;
    const oldBlock = raw.timeBlocks.find((block) => block.taskId === task.id && Number.isFinite(Number(block.startMinute)));
    if (!oldBlock) continue;
    const minute = Number(oldBlock.startMinute);
    const template = templates.find((item) => minute >= Number(item.startMinute) && minute < Number(item.endMinute));
    if (!template) continue;
    task.timeBlockTemplateId = template.id;
    changed = true;
  }

  if (!changed) return;
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: current.user.id, data: raw }, { onConflict: "user_id" });
  if (error) throw error;
  $("#reloadCloudBtn")?.click();
}

function ensureBoardShell() {
  const grid = $("#timeGrid");
  const card = grid?.closest(".card");
  if (!card) return null;

  card.classList.add("time-block-planner-card");
  const title = $(".card-title", card);
  if (title) title.textContent = "오늘의 시간블럭";
  const meta = $(".card-header .card-meta", card);
  if (meta) meta.textContent = "할일을 끌어 넣기";

  if (!$("#dailyBlockBoard", card)) {
    const board = document.createElement("div");
    board.id = "dailyBlockBoard";
    board.className = "daily-block-board";
    $(".card-header", card)?.insertAdjacentElement("afterend", board);
  }
  return $("#dailyBlockBoard", card);
}

function blockMarkup(template, tasks, isCurrent) {
  const title = String(template.title || "").trim();
  const taskRows = tasks.length ? tasks.map((task) => `
    <div class="daily-block-task${task.done ? " done" : ""}" draggable="${task.done ? "false" : "true"}" data-task-id="${task.id}" data-context-kind="task" data-context-id="${task.id}">
      <button class="daily-block-check${task.done ? " checked" : ""}" type="button" data-block-check="${task.id}" aria-label="완료">${task.done ? "✓" : ""}</button>
      <span class="daily-block-task-title">${esc(task.title)}</span>
      <button class="daily-block-unassign" type="button" data-unassign-task="${task.id}" title="이 시간블럭에서 빼기" aria-label="시간블럭에서 빼기">×</button>
    </div>`).join("") : '<div class="daily-block-empty">할일을 끌어오거나 아래에서 추가</div>';

  return `
    <section class="daily-block${isCurrent ? " current" : ""}" data-template-id="${template.id}">
      <div class="daily-block-head">
        <div>
          <div class="daily-block-time">${minuteText(template.startMinute)}–${minuteText(template.endMinute)}</div>
          ${title ? `<div class="daily-block-name">${esc(title)}</div>` : ""}
        </div>
        ${isCurrent ? '<span class="daily-block-now">지금</span>' : ""}
      </div>
      <div class="daily-block-drop" data-block-drop="${template.id}">${taskRows}</div>
      <form class="daily-block-add" data-block-add="${template.id}">
        <input aria-label="이 시간블럭에 할일 추가" placeholder="할일 추가" />
        <button class="ghost-btn" type="submit">추가</button>
      </form>
    </section>`;
}

async function renderBoard() {
  const board = ensureBoardShell();
  if (!board || rendering) return;
  rendering = true;
  try {
    const current = await readState();
    if (!current) return;
    const state = current.state;
    const templates = [...state.timeBlockTemplates].sort((a, b) => Number(a.startMinute) - Number(b.startMinute));
    const dayKey = appDayKey();
    const todayTasks = state.tasks.filter((task) => task.date === dayKey);
    const now = new Date();
    const nowMinute = now.getHours() * 60 + now.getMinutes();

    if (!templates.length) {
      board.innerHTML = '<div class="daily-block-empty-state">설정에서 나의 시간블럭을 추가해 주세요.</div>';
      return;
    }

    const splitAt = Math.ceil(templates.length / 2);
    const renderColumn = (items) => items.map((template) => {
      const tasks = todayTasks
        .filter((task) => task.timeBlockTemplateId === template.id)
        .sort((a, b) => Number(a.done) - Number(b.done));
      const isCurrent = nowMinute >= Number(template.startMinute) && nowMinute < Number(template.endMinute);
      return blockMarkup(template, tasks, isCurrent);
    }).join("");

    board.innerHTML = `<div class="daily-block-columns"><div class="daily-block-column">${renderColumn(templates.slice(0, splitAt))}</div><div class="daily-block-column">${renderColumn(templates.slice(splitAt))}</div></div>`;
    wireBoard(board);
  } catch (error) {
    console.error("시간블럭 표시 실패", error);
    board.innerHTML = '<div class="daily-block-empty-state">시간블럭을 불러오지 못했어요.</div>';
  } finally {
    rendering = false;
  }
}

function wireBoard(board) {
  $$(".daily-block-task[draggable='true']", board).forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/task-id", row.dataset.taskId);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
  });

  $$("[data-block-drop]", board).forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes("text/task-id")) return;
      event.preventDefault();
      zone.closest(".daily-block")?.classList.add("over");
    });
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget)) zone.closest(".daily-block")?.classList.remove("over");
    });
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      zone.closest(".daily-block")?.classList.remove("over");
      const taskId = event.dataTransfer.getData("text/task-id");
      const templateId = zone.dataset.blockDrop;
      if (!taskId || !templateId) return;
      try {
        await writeState((state) => {
          const task = state.tasks.find((item) => item.id === taskId);
          if (!task) return;
          task.date = appDayKey();
          task.timeBlockTemplateId = templateId;
        });
      } catch (error) {
        console.error(error);
        window.alert("할일을 시간블럭으로 옮기지 못했어요.");
      }
    });
  });

  $$("[data-block-check]", board).forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await writeState((state) => {
          const task = state.tasks.find((item) => item.id === button.dataset.blockCheck);
          if (task) task.done = !task.done;
        });
      } catch (error) {
        console.error(error);
      }
    });
  });

  $$("[data-unassign-task]", board).forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await writeState((state) => {
          const task = state.tasks.find((item) => item.id === button.dataset.unassignTask);
          if (task) delete task.timeBlockTemplateId;
        });
      } catch (error) {
        console.error(error);
      }
    });
  });

  $$("[data-block-add]", board).forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("input", form);
      const title = input.value.trim();
      if (!title) return;
      input.disabled = true;
      try {
        await writeState((state) => {
          state.tasks.push({
            id: crypto.randomUUID(),
            title,
            done: false,
            date: appDayKey(),
            timeBlockTemplateId: form.dataset.blockAdd,
          });
        });
        input.value = "";
      } catch (error) {
        console.error(error);
        window.alert("할일을 추가하지 못했어요.");
      } finally {
        input.disabled = false;
      }
    });
  });
}

function ensureSettingsSection() {
  const wrap = $("#page-settings .settings-wrap");
  if (!wrap) return null;
  let section = $("#timeBlockSettingsSection");
  if (section) return section;

  section = document.createElement("section");
  section.id = "timeBlockSettingsSection";
  section.className = "setting-section";
  section.innerHTML = `
    <h3>나의 시간블럭</h3>
    <div class="setting-desc">하루의 큰 틀을 정해두고, 오늘 할일을 각 블럭 안에 넣어 사용합니다. 이름은 비워도 돼요.</div>
    <div id="timeBlockTemplateList"></div>
    <div class="time-block-setting-actions">
      <button class="soft-btn" id="addTimeBlockTemplateBtn" type="button">+ 시간블럭</button>
      <button class="primary-btn" id="saveTimeBlockTemplatesBtn" type="button">저장</button>
    </div>`;
  wrap.prepend(section);

  $("#addTimeBlockTemplateBtn", section).addEventListener("click", addTemplateRow);
  $("#saveTimeBlockTemplatesBtn", section).addEventListener("click", saveTemplateRows);
  return section;
}

function templateRowMarkup(template) {
  return `
    <div class="time-block-setting-row" data-template-row data-template-id="${template.id}">
      <input class="time-block-setting-name" data-template-title value="${esc(template.title || "")}" placeholder="블럭 이름 (선택)" />
      <input type="time" data-template-start value="${minuteText(template.startMinute)}" aria-label="시작 시간" />
      <span>–</span>
      <input type="time" data-template-end value="${minuteText(template.endMinute)}" aria-label="종료 시간" />
      <button class="ghost-btn danger-text" type="button" data-template-delete>삭제</button>
    </div>`;
}

async function renderSettings() {
  const section = ensureSettingsSection();
  if (!section) return;
  try {
    const current = await readState();
    if (!current) return;
    const templates = [...current.state.timeBlockTemplates].sort((a, b) => Number(a.startMinute) - Number(b.startMinute));
    const list = $("#timeBlockTemplateList", section);
    list.innerHTML = templates.map(templateRowMarkup).join("");
    wireTemplateDelete(list);
  } catch (error) {
    console.error("시간블럭 설정 표시 실패", error);
  }
}

function wireTemplateDelete(root) {
  $$('[data-template-delete]', root).forEach((button) => {
    button.addEventListener("click", () => button.closest("[data-template-row]")?.remove());
  });
}

function addTemplateRow() {
  const list = $("#timeBlockTemplateList");
  if (!list) return;
  const rows = $$('[data-template-row]', list);
  let startMinute = 360;
  if (rows.length) {
    const lastEnd = timeToMinute($("[data-template-end]", rows[rows.length - 1])?.value);
    if (lastEnd !== null) startMinute = Math.min(1380, lastEnd);
  }
  const endMinute = Math.min(1439, startMinute + 60);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = templateRowMarkup({ id: crypto.randomUUID(), title: "", startMinute, endMinute });
  const row = wrapper.firstElementChild;
  list.appendChild(row);
  wireTemplateDelete(row);
  $("[data-template-title]", row)?.focus();
}

async function saveTemplateRows() {
  const rows = $$("#timeBlockTemplateList [data-template-row]");
  const templates = [];
  for (const row of rows) {
    const startMinute = timeToMinute($("[data-template-start]", row)?.value);
    const endMinute = timeToMinute($("[data-template-end]", row)?.value);
    if (startMinute === null || endMinute === null || endMinute <= startMinute) {
      window.alert("시간블럭의 시작/종료 시간을 확인해 주세요.");
      return;
    }
    templates.push({
      id: row.dataset.templateId || crypto.randomUUID(),
      title: $("[data-template-title]", row)?.value.trim() || "",
      startMinute,
      endMinute,
    });
  }
  templates.sort((a, b) => a.startMinute - b.startMinute);

  const button = $("#saveTimeBlockTemplatesBtn");
  if (button) button.disabled = true;
  try {
    await writeState((state) => {
      const validIds = new Set(templates.map((item) => item.id));
      state.timeBlockTemplates = templates;
      state.tasks.forEach((task) => {
        if (task.timeBlockTemplateId && !validIds.has(task.timeBlockTemplateId)) delete task.timeBlockTemplateId;
      });
    });
    await renderSettings();
  } catch (error) {
    console.error(error);
    window.alert("시간블럭 설정을 저장하지 못했어요.");
  } finally {
    if (button) button.disabled = false;
  }
}

function injectStyle() {
  if ($("#timeBlockPlannerStyles")) return;
  const style = document.createElement("style");
  style.id = "timeBlockPlannerStyles";
  style.textContent = `
    .time-block-planner-card .time-note,.time-block-planner-card .time-wrap,.time-block-planner-card #addTimeBlockBtn{display:none!important}
    .daily-block-board{padding:12px}
    .daily-block-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:start}
    .daily-block-column{display:grid;gap:10px;min-width:0}
    .daily-block{border:1px solid var(--line-strong,#b8c0cb);border-radius:10px;background:var(--panel,#fff);overflow:hidden;transition:border-color .15s ease,background .15s ease}
    .daily-block.current{border-color:var(--accent,#30343b)}
    .daily-block.over{background:var(--accent-soft,#eef2f6);border-color:var(--accent,#30343b)}
    .daily-block-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:10px 11px 8px;border-bottom:1px solid var(--line,#d2d7df)}
    .daily-block-time{font-size:12px;font-weight:700;color:var(--muted,#6b7280)}
    .daily-block-name{margin-top:2px;font-size:14px;font-weight:700;color:var(--text,#1f2328)}
    .daily-block-now{font-size:11px;padding:2px 6px;border:1px solid var(--line-strong,#b8c0cb);border-radius:999px;color:var(--text,#1f2328)}
    .daily-block-drop{min-height:42px;padding:6px 8px;display:grid;gap:4px}
    .daily-block-empty{font-size:12px;color:var(--muted,#6b7280);padding:5px 3px}
    .daily-block-task{display:grid;grid-template-columns:26px minmax(0,1fr) 26px;align-items:center;gap:4px;min-height:34px;padding:2px 4px;border-radius:7px}
    .daily-block-task:hover{background:var(--hover,#f3f5f7)}
    .daily-block-task.dragging{opacity:.5}
    .daily-block-task.done .daily-block-task-title{text-decoration:line-through;color:var(--muted,#6b7280)}
    .daily-block-check,.daily-block-unassign{width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:var(--muted,#6b7280);cursor:pointer}
    .daily-block-check{border:1px solid var(--line-strong,#b8c0cb)}
    .daily-block-check.checked{color:var(--text,#1f2328);background:var(--accent-soft,#eef2f6)}
    .daily-block-unassign:hover,.daily-block-check:hover{background:var(--hover,#f3f5f7)}
    .daily-block-task-title{font-size:13px;min-width:0;overflow-wrap:anywhere}
    .daily-block-add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;padding:7px 8px 9px;border-top:1px solid var(--line,#d2d7df)}
    .daily-block-add input{min-width:0;height:32px;padding:5px 8px;border:1px solid var(--line,#d2d7df);border-radius:7px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px}
    .daily-block-empty-state{padding:24px 12px;text-align:center;color:var(--muted,#6b7280);font-size:13px}
    .time-block-setting-row{display:grid;grid-template-columns:minmax(140px,1fr) 110px auto 110px auto;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid var(--line,#d2d7df)}
    .time-block-setting-row input{min-width:0}
    .time-block-setting-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:10px}
    @media(max-width:720px){
      .daily-block-columns{grid-template-columns:minmax(0,1fr)}
      .time-block-setting-row{grid-template-columns:minmax(0,1fr) 1fr auto 1fr}
      .time-block-setting-row [data-template-delete]{grid-column:1/-1;justify-self:end}
    }
  `;
  document.head.appendChild(style);
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderBoard();
    renderSettings();
  }, 80);
}

function observeBaseRenders() {
  if (boardObserver) return;
  const home = $("#page-home");
  if (!home) return;
  boardObserver = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.target.closest?.("#timeGrid,#taskList"))) scheduleRender();
  });
  boardObserver.observe(home, { childList: true, subtree: true });
}

async function init() {
  injectStyle();
  ensureBoardShell();
  ensureSettingsSection();
  observeBaseRenders();
  try { await ensureDefaultsAndMigrate(); } catch (error) { console.error("시간블럭 초기화 실패", error); }
  scheduleRender();
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) init();
