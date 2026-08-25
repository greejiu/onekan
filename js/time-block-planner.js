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
let pendingEditor = null;

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
  if (!Array.isArray(state.timeBlockTemplates)) {
    state.timeBlockTemplates = DEFAULT_TEMPLATES.map((item) => ({ ...item }));
  }
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

async function writeState(mutator, options = {}) {
  const current = await readState();
  if (!current) return;
  mutator(current.state);
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: current.user.id, data: current.state }, { onConflict: "user_id" });
  if (error) throw error;
  pendingEditor = options.pendingEditor || null;
  $("#reloadCloudBtn")?.click();
  scheduleRender();
}

async function ensureDefaultsAndMigrate() {
  const current = await readState();
  if (!current) return;
  const state = current.state;
  let changed = false;

  if (!Array.isArray(state.timeBlockTemplates) || !state.timeBlockTemplates.length) {
    state.timeBlockTemplates = DEFAULT_TEMPLATES.map((item) => ({ ...item }));
    changed = true;
  }

  const templates = [...state.timeBlockTemplates].sort((a, b) => Number(a.startMinute) - Number(b.startMinute));
  for (const task of state.tasks) {
    if (task.timeBlockTemplateId) continue;
    const oldBlock = state.timeBlocks.find((block) => block.taskId === task.id && Number.isFinite(Number(block.startMinute)));
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
    .upsert({ user_id: current.user.id, data: state }, { onConflict: "user_id" });
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

  const header = $(".card-header", card);
  let actions = $("#timeBlockBoardActions", card);
  if (!actions) {
    actions = document.createElement("div");
    actions.id = "timeBlockBoardActions";
    actions.className = "time-block-board-actions";
    actions.innerHTML = `
      <button class="ghost-btn time-block-top-add" id="timeBlockTopAddBtn" type="button" aria-label="할일 추가" title="할일 추가">＋</button>
    `;
    const oldRight = $(".header-inline", header) || $(".card-meta", header);
    if (oldRight) oldRight.replaceWith(actions);
    else header?.appendChild(actions);
  }

  if (!$("#dailyBlockBoard", card)) {
    const board = document.createElement("div");
    board.id = "dailyBlockBoard";
    board.className = "daily-block-board";
    header?.insertAdjacentElement("afterend", board);
  }

  if (!$("#timeBlockQuickAdd", card)) {
    const quick = document.createElement("form");
    quick.id = "timeBlockQuickAdd";
    quick.className = "time-block-quick-add";
    quick.innerHTML = `
      <input id="timeBlockQuickAddInput" placeholder="할일 입력 후 Enter" aria-label="새 할일" />
      <button class="ghost-btn" type="button" id="timeBlockQuickAddClose" aria-label="닫기">×</button>
    `;
    $("#dailyBlockBoard", card)?.insertAdjacentElement("beforebegin", quick);
  }

  wireShell(card);
  return $("#dailyBlockBoard", card);
}

function wireShell(card) {
  const addButton = $("#timeBlockTopAddBtn", card);
  const form = $("#timeBlockQuickAdd", card);
  const input = $("#timeBlockQuickAddInput", card);
  const close = $("#timeBlockQuickAddClose", card);
  if (!addButton || !form || !input || !close || form.dataset.wired === "1") return;
  form.dataset.wired = "1";

  addButton.addEventListener("click", () => {
    form.classList.add("open");
    input.value = "";
    requestAnimationFrame(() => input.focus());
  });

  close.addEventListener("click", () => {
    input.value = "";
    form.classList.remove("open");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
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
        });
      }, { pendingEditor: { type: "quickAdd" } });
      input.value = "";
    } catch (error) {
      console.error(error);
      window.alert("할일을 추가하지 못했어요.");
    } finally {
      input.disabled = false;
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      input.value = "";
      form.classList.remove("open");
    }
  });
}

function taskMarkup(task) {
  return `
    <div class="daily-block-task${task.done ? " done" : ""}" draggable="${task.done ? "false" : "true"}" data-task-id="${task.id}" data-context-kind="task" data-context-id="${task.id}">
      <button class="daily-block-check${task.done ? " checked" : ""}" type="button" data-block-check="${task.id}" aria-label="완료">${task.done ? "✓" : ""}</button>
      <span class="daily-block-task-title" data-inline-edit-task="${task.id}" tabindex="0">${esc(task.title)}</span>
    </div>`;
}

function rowMarkup(template, tasks, isCurrent) {
  const title = String(template.title || "").trim();
  const contents = tasks.length
    ? tasks.map(taskMarkup).join("")
    : '<div class="daily-block-empty">—</div>';
  return `
    <section class="daily-block-row${isCurrent ? " current" : ""}" data-template-id="${template.id}">
      <div class="daily-block-time-cell">
        <div class="daily-block-time">${minuteText(template.startMinute)}–${minuteText(template.endMinute)}</div>
        ${title ? `<div class="daily-block-name">${esc(title)}</div>` : ""}
        ${isCurrent ? '<span class="daily-block-now">지금</span>' : ""}
      </div>
      <div class="daily-block-list-cell" data-block-drop="${template.id}">${contents}</div>
    </section>`;
}

function unassignedMarkup(tasks) {
  if (!tasks.length) return "";
  return `
    <section class="daily-block-row unassigned" data-template-id="">
      <div class="daily-block-time-cell"><div class="daily-block-time">미배치</div></div>
      <div class="daily-block-list-cell" data-block-drop="">${tasks.map(taskMarkup).join("")}</div>
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

    const unassigned = todayTasks
      .filter((task) => !task.timeBlockTemplateId)
      .sort((a, b) => Number(a.done) - Number(b.done));

    board.innerHTML = `
      <div class="daily-block-table">
        ${unassignedMarkup(unassigned)}
        ${templates.map((template) => {
          const tasks = todayTasks
            .filter((task) => task.timeBlockTemplateId === template.id)
            .sort((a, b) => Number(a.done) - Number(b.done));
          const isCurrent = nowMinute >= Number(template.startMinute) && nowMinute < Number(template.endMinute);
          return rowMarkup(template, tasks, isCurrent);
        }).join("")}
      </div>`;
    wireBoard(board);
    restorePendingEditor();
  } catch (error) {
    console.error("시간블럭 표시 실패", error);
    board.innerHTML = '<div class="daily-block-empty-state">시간블럭을 불러오지 못했어요.</div>';
  } finally {
    rendering = false;
  }
}

function restorePendingEditor() {
  const pending = pendingEditor;
  pendingEditor = null;
  if (!pending) return;

  if (pending.type === "quickAdd") {
    const form = $("#timeBlockQuickAdd");
    const input = $("#timeBlockQuickAddInput");
    form?.classList.add("open");
    requestAnimationFrame(() => input?.focus());
    return;
  }

  if (pending.type === "nextInBlock") {
    requestAnimationFrame(() => openNewTaskInput(pending.templateId));
  }
}

function wireBoard(board) {
  $$(".daily-block-task[draggable='true']", board).forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      if (event.target.closest("input")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData("text/task-id", row.dataset.taskId);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
  });

  $$("[data-block-drop]", board).forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      if (![...event.dataTransfer.types].includes("text/task-id")) return;
      event.preventDefault();
      zone.closest(".daily-block-row")?.classList.add("over");
    });
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget)) zone.closest(".daily-block-row")?.classList.remove("over");
    });
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      zone.closest(".daily-block-row")?.classList.remove("over");
      const taskId = event.dataTransfer.getData("text/task-id");
      if (!taskId) return;
      const templateId = zone.dataset.blockDrop || "";
      try {
        await writeState((state) => {
          const task = state.tasks.find((item) => item.id === taskId);
          if (!task) return;
          task.date = appDayKey();
          if (templateId) task.timeBlockTemplateId = templateId;
          else delete task.timeBlockTemplateId;
        });
      } catch (error) {
        console.error(error);
        window.alert("할일을 옮기지 못했어요.");
      }
    });
  });

  $$("[data-block-check]", board).forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
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

  $$("[data-inline-edit-task]", board).forEach((title) => {
    title.addEventListener("click", () => openInlineEditor(title));
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        openInlineEditor(title);
      }
    });
  });
}

function openInlineEditor(titleElement) {
  if (!titleElement?.isConnected || titleElement.querySelector("input")) return;
  const row = titleElement.closest(".daily-block-task");
  const zone = titleElement.closest("[data-block-drop]");
  const taskId = row?.dataset.taskId;
  const templateId = zone?.dataset.blockDrop || "";
  if (!taskId) return;

  const oldTitle = titleElement.textContent.trim();
  row.draggable = false;
  const input = document.createElement("input");
  input.className = "daily-block-inline-input";
  input.value = oldTitle;
  titleElement.textContent = "";
  titleElement.appendChild(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = async (createNext) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (!value) {
      titleElement.textContent = oldTitle;
      row.draggable = true;
      return;
    }
    try {
      await writeState((state) => {
        const task = state.tasks.find((item) => item.id === taskId);
        if (task) task.title = value;
      }, createNext ? { pendingEditor: { type: "nextInBlock", templateId } } : {});
    } catch (error) {
      console.error(error);
      window.alert("할일을 수정하지 못했어요.");
      titleElement.textContent = oldTitle;
      row.draggable = true;
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finished = true;
      titleElement.textContent = oldTitle;
      row.draggable = true;
    }
  });
  input.addEventListener("blur", () => finish(false), { once: true });
}

function openNewTaskInput(templateId = "") {
  const board = $("#dailyBlockBoard");
  if (!board) return;
  const selector = templateId
    ? `[data-block-drop="${CSS.escape(templateId)}"]`
    : '[data-block-drop=""]';
  let zone = $(selector, board);

  if (!zone && !templateId) {
    const table = $(".daily-block-table", board);
    if (!table) return;
    const section = document.createElement("section");
    section.className = "daily-block-row unassigned";
    section.dataset.templateId = "";
    section.innerHTML = '<div class="daily-block-time-cell"><div class="daily-block-time">미배치</div></div><div class="daily-block-list-cell" data-block-drop=""></div>';
    table.prepend(section);
    zone = $("[data-block-drop='']", section);
  }
  if (!zone || $(".daily-block-new-task", zone)) return;

  $(".daily-block-empty", zone)?.remove();
  const wrapper = document.createElement("div");
  wrapper.className = "daily-block-new-task";
  wrapper.innerHTML = '<span class="daily-block-new-dot">＋</span><input class="daily-block-inline-input" placeholder="다음 할일" aria-label="새 할일" />';
  zone.appendChild(wrapper);
  const input = $("input", wrapper);
  input.focus();

  let saving = false;
  const saveNew = async (continueNext) => {
    if (saving) return;
    const title = input.value.trim();
    if (!title) {
      if (!continueNext) wrapper.remove();
      return;
    }
    saving = true;
    try {
      await writeState((state) => {
        const task = {
          id: crypto.randomUUID(),
          title,
          done: false,
          date: appDayKey(),
        };
        if (templateId) task.timeBlockTemplateId = templateId;
        state.tasks.push(task);
      }, continueNext ? { pendingEditor: { type: "nextInBlock", templateId } } : {});
    } catch (error) {
      console.error(error);
      window.alert("할일을 추가하지 못했어요.");
      saving = false;
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveNew(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      wrapper.remove();
    }
  });
  input.addEventListener("blur", () => saveNew(false), { once: true });
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
    .time-block-board-actions{display:flex;align-items:center;margin-left:auto}
    .time-block-top-add{width:30px;height:30px;min-height:30px;padding:0!important;display:inline-flex;align-items:center;justify-content:center;font-size:20px;line-height:1}
    .time-block-quick-add{display:none;grid-template-columns:minmax(0,1fr) 32px;gap:6px;padding:8px 12px;border-bottom:1px solid var(--line,#d2d7df)}
    .time-block-quick-add.open{display:grid}
    .time-block-quick-add input{min-width:0;height:34px;padding:6px 9px;border:1px solid var(--line-strong,#b8c0cb);border-radius:7px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:13px}
    .daily-block-board{padding:0 12px 12px}
    .daily-block-table{border:1px solid var(--line-strong,#b8c0cb);border-radius:9px;overflow:hidden;background:var(--panel,#fff)}
    .daily-block-row{display:grid;grid-template-columns:128px minmax(0,1fr);min-height:46px;border-bottom:1px solid var(--line,#d2d7df);transition:background .12s ease}
    .daily-block-row:last-child{border-bottom:0}
    .daily-block-row.current{background:var(--accent-soft,#eef2f6)}
    .daily-block-row.over{background:var(--hover,#f3f5f7);box-shadow:inset 0 0 0 1px var(--accent,#30343b)}
    .daily-block-time-cell{position:relative;padding:8px 10px;border-right:1px solid var(--line,#d2d7df);display:flex;flex-direction:column;justify-content:center;min-width:0}
    .daily-block-time{font-size:12px;font-weight:700;color:var(--text,#1f2328);white-space:nowrap}
    .daily-block-name{margin-top:2px;font-size:11px;color:var(--muted,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .daily-block-now{position:absolute;right:7px;top:7px;font-size:9px;padding:1px 4px;border:1px solid var(--line-strong,#b8c0cb);border-radius:999px;color:var(--muted,#6b7280);background:#fff}
    .daily-block-list-cell{min-height:46px;padding:5px 7px;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0}
    .daily-block-empty{font-size:12px;color:var(--muted,#6b7280);padding:4px 5px}
    .daily-block-task{display:grid;grid-template-columns:24px minmax(0,1fr);align-items:center;gap:5px;min-height:31px;padding:1px 4px;border-radius:6px;cursor:grab}
    .daily-block-task:hover{background:var(--hover,#f3f5f7)}
    .daily-block-task.dragging{opacity:.45}
    .daily-block-task.done{cursor:default}
    .daily-block-task.done .daily-block-task-title{text-decoration:line-through;color:var(--muted,#6b7280)}
    .daily-block-check{width:22px;height:22px;padding:0;border:1px solid var(--line-strong,#b8c0cb);border-radius:5px;background:transparent;color:var(--text,#1f2328);cursor:pointer}
    .daily-block-check.checked{background:var(--accent-soft,#eef2f6)}
    .daily-block-task-title{display:block;min-width:0;padding:4px 3px;border-radius:5px;font-size:13px;line-height:1.35;overflow-wrap:anywhere;cursor:text}
    .daily-block-task-title:focus-visible{outline:1px solid var(--line-strong,#b8c0cb);outline-offset:1px}
    .daily-block-inline-input{width:100%;min-width:0;height:28px;padding:3px 6px;border:1px solid var(--line-strong,#b8c0cb);border-radius:6px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:13px;outline:none}
    .daily-block-inline-input:focus{border-color:var(--accent,#30343b)}
    .daily-block-new-task{display:grid;grid-template-columns:24px minmax(0,1fr);align-items:center;gap:5px;padding:1px 4px}
    .daily-block-new-dot{font-size:15px;color:var(--muted,#6b7280);text-align:center}
    .daily-block-row.unassigned .daily-block-time{color:var(--muted,#6b7280)}
    .daily-block-empty-state{padding:24px 12px;text-align:center;color:var(--muted,#6b7280);font-size:13px}
    .time-block-setting-row{display:grid;grid-template-columns:minmax(140px,1fr) 110px auto 110px auto;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid var(--line,#d2d7df)}
    .time-block-setting-row input{min-width:0}
    .time-block-setting-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:10px}
    @media(max-width:620px){
      .daily-block-row{grid-template-columns:96px minmax(0,1fr)}
      .daily-block-time-cell{padding:7px 7px}
      .daily-block-time{font-size:11px}
      .daily-block-name{font-size:10px}
      .daily-block-now{display:none}
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