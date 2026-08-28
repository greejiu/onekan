import { supabase } from "./supabase.js";
import { confirmAction, showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => crypto.randomUUID();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const DEFAULT_SECTION = { id: "notes-default", name: "메모" };
const GROUP_MODE_KEY = "onekan_note_group_mode";

let currentUser = null;
let noteState = null;
let renderTimer = null;
let editingConversion = null;

function pad(value) {
  return String(value).padStart(2, "0");
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  state.notes = Array.isArray(state.notes) ? state.notes : [];
  state.noteSections = Array.isArray(state.noteSections) && state.noteSections.length
    ? state.noteSections
    : [{ ...DEFAULT_SECTION }];
  state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length
    ? state.eventGroups
    : [{ id: "default", name: "기본", color: "#8fa9c4" }];
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.ui = state.ui && typeof state.ui === "object" ? state.ui : {};

  const defaultSectionId = state.noteSections[0]?.id || DEFAULT_SECTION.id;
  const defaultGroupId = state.eventGroups[0]?.id || "default";
  state.notes = state.notes.map((note) => ({
    ...note,
    id: note.id || uid(),
    title: note.title || note.text || note.content || "",
    sectionId: note.sectionId || defaultSectionId,
    groupId: note.groupId || defaultGroupId,
    createdAt: note.createdAt || new Date().toISOString(),
  }));
  return state;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user || null;
  if (!currentUser) {
    noteState = null;
    return null;
  }
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) throw error;
  noteState = normalizeState(data?.data);
  return noteState;
}

async function writeState(mutator) {
  await readState();
  if (!noteState || !currentUser) return false;
  mutator(noteState);
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: currentUser.id, data: noteState }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "notes" } }));
  const reloadButton = $("#reloadCloudBtn");
  if (reloadButton) reloadButton.click();
  scheduleRender(120);
  return true;
}

function ensureNotesShell() {
  if (!$("link[data-onekan-notes-style]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./css/notes.css?v=1";
    link.dataset.onekanNotesStyle = "1";
    document.head.appendChild(link);
  }

  const nav = $(".sidebar .nav");
  if (nav && !nav.querySelector('[data-page="notes"]')) {
    const notesButton = document.createElement("button");
    notesButton.className = "nav-item";
    notesButton.type = "button";
    notesButton.dataset.page = "notes";
    notesButton.innerHTML = '<span class="nav-icon">✎</span><span class="nav-label">메모</span>';
    const goalsButton = nav.querySelector('[data-page="goals"]');
    nav.insertBefore(notesButton, goalsButton || null);
  }

  const main = $("main.main");
  if (main && !$("#page-notes")) {
    const page = document.createElement("section");
    page.className = "page notes-page";
    page.id = "page-notes";
    page.innerHTML = `
      <div class="page-head notes-page-head">
        <div>
          <h1 class="page-title">메모</h1>
          <div class="page-sub">생각을 먼저 적고, 필요할 때 할일이나 일정으로 바꿔요.</div>
        </div>
        <div class="seg notes-group-mode" aria-label="메모 그룹 보기">
          <button class="active" data-notes-group-mode="section" type="button">섹션별</button>
          <button data-notes-group-mode="area" type="button">영역별</button>
        </div>
      </div>

      <section class="card notes-composer-card">
        <form id="noteComposer" class="notes-composer" autocomplete="off">
          <input id="noteTitle" type="text" maxlength="240" placeholder="메모를 입력하세요" aria-label="메모 내용" required />
          <select id="noteSection" aria-label="메모 섹션"></select>
          <select id="noteGroup" aria-label="메모 영역"></select>
          <button class="primary-btn" type="submit">추가</button>
        </form>
        <div class="notes-composer-hint">Enter로 바로 저장 · 날짜를 정하지 않아도 괜찮아요.</div>
      </section>

      <section class="notes-section-manager">
        <form id="noteSectionForm" class="notes-section-form" autocomplete="off">
          <input id="noteSectionName" type="text" maxlength="40" placeholder="새 섹션 이름" aria-label="새 섹션 이름" />
          <button class="soft-btn" type="submit">＋ 섹션</button>
        </form>
      </section>

      <div id="notesList" class="notes-list"></div>

      <dialog id="noteConversionDialog" class="app-dialog notes-conversion-dialog">
        <form id="noteConversionForm">
          <div class="notes-dialog-head">
            <h3 id="noteConversionTitle">할일 만들기</h3>
            <button class="uw-icon-btn" data-note-conversion-close type="button" aria-label="닫기">×</button>
          </div>
          <div class="field"><label>내용</label><input id="noteConversionText" type="text" maxlength="240" required /></div>
          <div class="field"><label>영역</label><select id="noteConversionGroup"></select></div>
          <div class="field"><label id="noteConversionDateLabel">날짜 <small>비우면 언젠가 할일</small></label><input id="noteConversionDate" type="date" /></div>
          <div class="field" id="noteConversionTimeField" hidden><label>시간 <small>비우면 하루종일</small></label><input id="noteConversionTime" type="time" step="1800" /></div>
          <div class="notes-dialog-note" id="noteConversionHint"></div>
          <div class="dialog-actions">
            <button class="soft-btn" data-note-conversion-close type="button">취소</button>
            <button class="primary-btn" id="noteConversionSubmit" type="submit">만들기</button>
          </div>
        </form>
      </dialog>`;

    const habitsPage = $("#page-habits");
    if (habitsPage?.nextSibling) main.insertBefore(page, habitsPage.nextSibling);
    else main.appendChild(page);
  }
}

function groupOptions(selectedId = "") {
  const groups = noteState?.eventGroups || [];
  return groups.map((group) => `<option value="${esc(group.id)}"${group.id === selectedId ? " selected" : ""}>${esc(group.name)}</option>`).join("");
}

function sectionOptions(selectedId = "") {
  const sections = noteState?.noteSections || [DEFAULT_SECTION];
  return sections.map((section) => `<option value="${esc(section.id)}"${section.id === selectedId ? " selected" : ""}>${esc(section.name)}</option>`).join("");
}

function findSection(note) {
  return noteState.noteSections.find((section) => section.id === note.sectionId) || noteState.noteSections[0] || DEFAULT_SECTION;
}

function findGroup(note) {
  return noteState.eventGroups.find((group) => group.id === note.groupId) || noteState.eventGroups[0] || { id: "default", name: "기본", color: "#8fa9c4" };
}

function noteMeta(note) {
  const section = findSection(note);
  const group = findGroup(note);
  const created = new Date(note.createdAt || Date.now());
  const dateText = Number.isFinite(+created)
    ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(created)
    : "";
  return { section, group, dateText };
}

function noteMarkup(note) {
  const { section, group, dateText } = noteMeta(note);
  const taskConverted = Boolean(note.convertedTaskId);
  const eventConverted = Boolean(note.convertedEventId);
  return `
    <article class="note-item" data-note-id="${esc(note.id)}" style="--note-area:${esc(group.color || "#8fa9c4")}">
      <div class="note-item-main">
        <span class="note-area-dot" aria-hidden="true"></span>
        <div class="note-body">
          <div class="note-title">${esc(note.title)}</div>
          <div class="note-meta">
            <span>${esc(section.name)}</span><span>·</span><span>${esc(group.name)}</span>${dateText ? `<span>·</span><span>${esc(dateText)}</span>` : ""}
            ${taskConverted ? '<span class="note-converted-badge">✓ 할일 등록됨</span>' : ""}
            ${eventConverted ? '<span class="note-converted-badge">□ 일정 등록됨</span>' : ""}
          </div>
        </div>
      </div>
      <div class="note-actions">
        <button class="soft-btn note-action" data-note-to-task type="button">할일 만들기</button>
        <button class="soft-btn note-action" data-note-to-event type="button">일정 만들기</button>
        <button class="ghost-btn danger-text note-delete" data-note-delete type="button" aria-label="메모 삭제">삭제</button>
      </div>
    </article>`;
}

function currentGroupMode() {
  return localStorage.getItem(GROUP_MODE_KEY) === "area" ? "area" : "section";
}

function renderGroupedNotes() {
  const root = $("#notesList");
  if (!root || !noteState) return;
  const notes = [...noteState.notes].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  if (!notes.length) {
    root.innerHTML = '<div class="notes-empty"><strong>아직 메모가 없어요.</strong><span>정리하지 말고 먼저 한 줄 적어보세요.</span></div>';
    return;
  }

  const mode = currentGroupMode();
  const definitions = mode === "area" ? noteState.eventGroups : noteState.noteSections;
  const keyName = mode === "area" ? "groupId" : "sectionId";
  const grouped = new Map();
  for (const definition of definitions) grouped.set(definition.id, []);
  for (const note of notes) {
    const bucket = grouped.get(note[keyName]);
    if (bucket) bucket.push(note);
    else {
      if (!grouped.has("__other")) grouped.set("__other", []);
      grouped.get("__other").push(note);
    }
  }

  root.innerHTML = [...grouped.entries()]
    .filter(([, items]) => items.length)
    .map(([id, items]) => {
      const definition = definitions.find((item) => item.id === id);
      const label = definition?.name || "기타";
      return `<section class="notes-group"><div class="notes-group-head"><h2>${esc(label)}</h2><span>${items.length}</span></div><div class="notes-group-items">${items.map(noteMarkup).join("")}</div></section>`;
    })
    .join("");
}

function renderControls() {
  if (!noteState) return;
  const section = $("#noteSection");
  const group = $("#noteGroup");
  if (section) {
    const previous = section.value;
    section.innerHTML = sectionOptions(previous);
    if (noteState.noteSections.some((item) => item.id === previous)) section.value = previous;
  }
  if (group) {
    const previous = group.value;
    group.innerHTML = groupOptions(previous);
    if (noteState.eventGroups.some((item) => item.id === previous)) group.value = previous;
  }
  const mode = currentGroupMode();
  $$('[data-notes-group-mode]').forEach((button) => button.classList.toggle("active", button.dataset.notesGroupMode === mode));
}

async function renderNotes() {
  try {
    ensureNotesShell();
    await readState();
    if (!noteState) return;
    renderControls();
    renderGroupedNotes();
  } catch (error) {
    console.error("notes render failed", error);
  }
}

function scheduleRender(delay = 50) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderNotes, delay);
}

function openConversion(noteId, kind) {
  if (!noteState) return;
  const note = noteState.notes.find((item) => item.id === noteId);
  if (!note) return;
  editingConversion = { noteId, kind };
  const dialog = $("#noteConversionDialog");
  const isEvent = kind === "event";
  $("#noteConversionTitle").textContent = isEvent ? "일정 만들기" : "할일 만들기";
  $("#noteConversionText").value = note.title || "";
  $("#noteConversionGroup").innerHTML = groupOptions(note.groupId);
  $("#noteConversionGroup").value = note.groupId || noteState.eventGroups[0]?.id || "default";
  $("#noteConversionDate").value = isEvent ? localDateKey() : "";
  $("#noteConversionTime").value = "";
  $("#noteConversionTimeField").hidden = !isEvent;
  $("#noteConversionDate").required = isEvent;
  $("#noteConversionDateLabel").innerHTML = isEvent ? "날짜" : "날짜 <small>비우면 언젠가 할일</small>";
  $("#noteConversionHint").textContent = isEvent
    ? "시간을 비우면 하루종일 일정으로 등록돼요."
    : "날짜를 비우면 집의 ‘언젠가 할일’에 들어가요.";
  $("#noteConversionSubmit").textContent = isEvent ? "일정 만들기" : "할일 만들기";
  dialog.showModal();
  requestAnimationFrame(() => $("#noteConversionText").focus());
}

async function createFromNote(event) {
  event.preventDefault();
  if (!editingConversion) return;
  const { noteId, kind } = editingConversion;
  const title = $("#noteConversionText").value.trim();
  const groupId = $("#noteConversionGroup").value;
  const date = $("#noteConversionDate").value;
  const time = $("#noteConversionTime").value;
  if (!title) return showToast("내용을 입력해 주세요.");
  if (kind === "event" && !date) return showToast("일정 날짜를 골라 주세요.");

  let createdId = null;
  await writeState((state) => {
    const note = state.notes.find((item) => item.id === noteId);
    if (!note) return;
    createdId = uid();
    if (kind === "task") {
      state.tasks.push({
        id: createdId,
        title,
        date: date || null,
        done: false,
        groupId: groupId || state.eventGroups[0]?.id || "default",
        createdAt: new Date().toISOString(),
      });
      note.convertedTaskId = createdId;
      note.convertedTaskAt = new Date().toISOString();
    } else {
      const allDay = !time;
      const start = allDay ? new Date(`${date}T12:00:00`) : new Date(`${date}T${time}:00`);
      const end = allDay ? new Date(`${date}T12:00:00`) : new Date(start.getTime() + 60 * 60 * 1000);
      state.events.push({
        id: createdId,
        title,
        type: "schedule",
        groupId: groupId || state.eventGroups[0]?.id || "default",
        allDay,
        start: start.toISOString(),
        end: end.toISOString(),
        createdAt: new Date().toISOString(),
      });
      note.convertedEventId = createdId;
      note.convertedEventAt = new Date().toISOString();
    }
  });

  $("#noteConversionDialog").close();
  editingConversion = null;
  showToast(kind === "event" ? "일정으로 등록했어요." : date ? "할일로 등록했어요." : "언젠가 할일로 등록했어요.");
}

function bindNotesUI() {
  document.addEventListener("submit", async (event) => {
    if (event.target.id === "noteComposer") {
      event.preventDefault();
      const title = $("#noteTitle").value.trim();
      if (!title) return;
      const sectionId = $("#noteSection").value;
      const groupId = $("#noteGroup").value;
      try {
        await writeState((state) => {
          const safeSectionId = state.noteSections.some((item) => item.id === sectionId) ? sectionId : state.noteSections[0]?.id || DEFAULT_SECTION.id;
          const safeGroupId = state.eventGroups.some((item) => item.id === groupId) ? groupId : state.eventGroups[0]?.id || "default";
          state.notes.push({ id: uid(), title, sectionId: safeSectionId, groupId: safeGroupId, createdAt: new Date().toISOString() });
        });
        $("#noteTitle").value = "";
        $("#noteTitle").focus();
        showToast("메모를 저장했어요.");
      } catch (error) {
        console.error(error);
        showToast("메모 저장에 실패했어요.");
      }
      return;
    }

    if (event.target.id === "noteSectionForm") {
      event.preventDefault();
      const input = $("#noteSectionName");
      const name = input.value.trim();
      if (!name) return;
      try {
        let createdSectionId = null;
        await writeState((state) => {
          if (state.noteSections.some((section) => section.name.trim().toLowerCase() === name.toLowerCase())) return;
          createdSectionId = uid();
          state.noteSections.push({ id: createdSectionId, name });
        });
        input.value = "";
        if (createdSectionId) {
          await readState();
          renderControls();
          $("#noteSection").value = createdSectionId;
          showToast("섹션을 추가했어요.");
        } else {
          showToast("같은 이름의 섹션이 있어요.");
        }
      } catch (error) {
        console.error(error);
        showToast("섹션 추가에 실패했어요.");
      }
      return;
    }

    if (event.target.id === "noteConversionForm") {
      try {
        await createFromNote(event);
      } catch (error) {
        console.error(error);
        showToast("등록에 실패했어요.");
      }
    }
  });

  document.addEventListener("click", async (event) => {
    const modeButton = event.target.closest?.("[data-notes-group-mode]");
    if (modeButton) {
      localStorage.setItem(GROUP_MODE_KEY, modeButton.dataset.notesGroupMode === "area" ? "area" : "section");
      renderControls();
      renderGroupedNotes();
      return;
    }

    const noteItem = event.target.closest?.("[data-note-id]");
    const noteId = noteItem?.dataset.noteId;
    if (noteId && event.target.closest("[data-note-to-task]")) {
      openConversion(noteId, "task");
      return;
    }
    if (noteId && event.target.closest("[data-note-to-event]")) {
      openConversion(noteId, "event");
      return;
    }
    if (noteId && event.target.closest("[data-note-delete]")) {
      const note = noteState?.notes.find((item) => item.id === noteId);
      const confirmed = await confirmAction({ title: "메모를 삭제할까요?", message: `‘${note?.title || "선택한 메모"}’를 삭제해요.\n이미 만든 할일·일정은 그대로 남아요.` });
      if (!confirmed) return;
      try {
        await writeState((state) => { state.notes = state.notes.filter((item) => item.id !== noteId); });
        showToast("메모를 삭제했어요.");
      } catch (error) {
        console.error(error);
        showToast("메모 삭제에 실패했어요.");
      }
      return;
    }

    if (event.target.closest("[data-note-conversion-close]")) {
      $("#noteConversionDialog")?.close();
      editingConversion = null;
    }
  });

  document.addEventListener("onekan:state-changed", (event) => {
    if (event.detail?.source === "notes") return;
    scheduleRender(120);
  });

  supabase.auth.onAuthStateChange(() => scheduleRender(120));
}

if (!window.__onekanNotesInstalled) {
  window.__onekanNotesInstalled = true;
  ensureNotesShell();
  bindNotesUI();
  scheduleRender(0);
}
