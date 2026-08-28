import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => crypto.randomUUID();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const safeColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#8fa9c4";

if (!window.__onekanNotesInteractionsV2Installed) {
  window.__onekanNotesInteractionsV2Installed = true;

  const DRAG_MOUSE_DISTANCE = 6;
  const TOUCH_SCROLL_DISTANCE = 10;
  const TOUCH_HOLD_MS = 450;
  let gesture = null;
  let suppressClickUntil = 0;

  function coarsePointer() {
    return matchMedia("(hover:none),(pointer:coarse)").matches;
  }

  async function readState() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;
    const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
    if (error) throw error;
    const state = data?.data && typeof data.data === "object" ? data.data : {};
    state.notes = Array.isArray(state.notes) ? state.notes : [];
    state.noteSections = Array.isArray(state.noteSections) ? state.noteSections : [];
    state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length ? state.eventGroups : [{ id: "default", name: "기본", color: "#8fa9c4" }];
    return { user: session.user, state };
  }

  async function writeState(mutator) {
    const loaded = await readState();
    if (!loaded) return false;
    mutator(loaded.state);
    const { error } = await supabase.from("onekan_state").upsert({ user_id: loaded.user.id, data: loaded.state }, { onConflict: "user_id" });
    if (error) throw error;
    document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "notes-interactions" } }));
    $("#reloadCloudBtn")?.click();
    return true;
  }

  function defaultGroupId() {
    return $("#noteGroup option")?.value || "default";
  }

  function hiddenAction(noteItem, selector) {
    $(selector, noteItem)?.click();
  }

  function positionMenu(menu, x, y) {
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.classList.add("open");
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  }

  async function showNoteMenu(noteItem, x, y) {
    const menu = $("#uwContext");
    if (!menu) return;
    const noteId = noteItem.dataset.noteId;
    const loaded = await readState();
    const note = loaded?.state.notes.find((item) => item.id === noteId);
    if (!note) return;
    menu.innerHTML = '<button data-note-context="task">할일 만들기</button><button data-note-context="event">일정 만들기</button><button data-note-context="group">영역</button><button class="danger" data-note-context="delete">삭제</button>';
    positionMenu(menu, x, y);
    menu.onclick = async (event) => {
      const action = event.target.closest("[data-note-context]")?.dataset.noteContext;
      if (!action) return;
      if (action === "task") {
        menu.classList.remove("open");
        hiddenAction(noteItem, "[data-note-to-task]");
        return;
      }
      if (action === "event") {
        menu.classList.remove("open");
        hiddenAction(noteItem, "[data-note-to-event]");
        return;
      }
      if (action === "delete") {
        menu.classList.remove("open");
        hiddenAction(noteItem, "[data-note-delete]");
        return;
      }
      if (action !== "group") return;
      const groups = loaded.state.eventGroups;
      menu.innerHTML = '<button data-note-context-back>← 돌아가기</button>' + groups.map((group) => `<button data-note-group-choice="${esc(group.id)}"><span class="context-group-dot" style="--group-color:${safeColor(group.color)}"></span><span>${esc(group.name)}</span>${group.id === note.groupId ? '<span class="context-group-check">✓</span>' : ""}</button>`).join("");
      positionMenu(menu, x, y);
      menu.onclick = async (groupEvent) => {
        if (groupEvent.target.closest("[data-note-context-back]")) {
          showNoteMenu(noteItem, x, y);
          return;
        }
        const groupId = groupEvent.target.closest("[data-note-group-choice]")?.dataset.noteGroupChoice;
        if (!groupId) return;
        menu.classList.remove("open");
        try {
          await writeState((state) => {
            const target = state.notes.find((item) => item.id === noteId);
            if (target && state.eventGroups.some((group) => group.id === groupId)) target.groupId = groupId;
          });
        } catch (error) {
          console.error(error);
          showToast("영역을 바꾸지 못했어요.");
        }
      };
    };
  }

  function startInlineEdit(noteItem) {
    const title = $(".note-title", noteItem);
    if (!title || $(".note-title-input", noteItem)) return;
    const noteId = noteItem.dataset.noteId;
    const original = title.textContent.trim();
    const input = document.createElement("input");
    input.className = "note-title-input";
    input.value = original;
    input.setAttribute("aria-label", "메모 수정");
    title.replaceWith(input);
    let finished = false;
    const restore = (value = original) => {
      if (!input.isConnected) return;
      title.textContent = value;
      input.replaceWith(title);
    };
    const commit = async () => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (!value || value === original) return restore();
      restore(value);
      try {
        await writeState((state) => {
          const note = state.notes.find((item) => item.id === noteId);
          if (note) note.title = value;
        });
      } catch (error) {
        console.error(error);
        title.textContent = original;
        showToast("메모를 수정하지 못했어요.");
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      if (event.key === "Escape") { event.preventDefault(); finished = true; restore(); }
    });
    input.addEventListener("blur", commit);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  function clearDropTargets() {
    $$(".notes-drop-target").forEach((element) => element.classList.remove("notes-drop-target"));
  }

  function clearGesture(g, restore = true) {
    clearTimeout(g?.timer);
    g?.preview?.remove();
    if (restore) g?.item?.classList.remove("notes-dragging");
    clearDropTargets();
    gesture = null;
  }

  function activateGesture(g) {
    if (!g || g.active) return;
    g.active = true;
    g.item.classList.add("notes-dragging");
    const preview = document.createElement("div");
    preview.className = "notes-drag-preview";
    preview.textContent = $(".note-title", g.item)?.textContent.trim() || "메모";
    document.body.appendChild(preview);
    g.preview = preview;
  }

  function updateGestureTarget(g, x, y) {
    clearDropTargets();
    const pointed = document.elementFromPoint(x, y);
    const area = pointed?.closest?.(".notes-area-group[data-group-id]");
    const board = pointed?.closest?.(".notes-section-board[data-section-id]");
    g.targetSectionId = board?.dataset.sectionId || null;
    g.targetGroupId = area?.dataset.groupId || (board ? defaultGroupId() : null);
    (area || board)?.classList.add("notes-drop-target");
  }

  async function finishGesture(g) {
    if (!g.active) {
      clearGesture(g);
      return;
    }
    suppressClickUntil = Date.now() + 350;
    const sectionId = g.targetSectionId;
    const groupId = g.targetGroupId;
    const noteId = g.item.dataset.noteId;
    clearGesture(g);
    if (!sectionId || !groupId) return;
    try {
      await writeState((state) => {
        const note = state.notes.find((item) => item.id === noteId);
        if (!note) return;
        if (state.noteSections.some((section) => section.id === sectionId)) note.sectionId = sectionId;
        if (state.eventGroups.some((group) => group.id === groupId)) note.groupId = groupId;
      });
    } catch (error) {
      console.error(error);
      showToast("메모를 이동하지 못했어요.");
    }
  }

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest?.("[data-note-board-add]");
    if (!form) return;
    event.preventDefault();
    const input = $("input", form);
    const title = input?.value.trim() || "";
    if (!title) return;
    const sectionId = form.dataset.sectionId;
    const groupId = defaultGroupId();
    input.disabled = true;
    try {
      await writeState((state) => {
        const safeSectionId = state.noteSections.some((section) => section.id === sectionId) ? sectionId : state.noteSections[0]?.id;
        const safeGroupId = state.eventGroups.some((group) => group.id === groupId) ? groupId : state.eventGroups[0]?.id || "default";
        if (!safeSectionId) return;
        state.notes.push({ id: uid(), title, sectionId: safeSectionId, groupId: safeGroupId, createdAt: new Date().toISOString() });
      });
      input.value = "";
      showToast("메모를 저장했어요.");
    } catch (error) {
      console.error(error);
      showToast("메모 저장에 실패했어요.");
    } finally {
      input.disabled = false;
      requestAnimationFrame(() => input.focus());
    }
  }, true);

  document.addEventListener("click", (event) => {
    if (Date.now() < suppressClickUntil && event.target.closest(".note-item")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const noteItem = event.target.closest?.(".note-item[data-note-id]");
    if (!noteItem || event.target.closest("button,input,select,textarea,a")) return;
    if (coarsePointer()) {
      const rect = noteItem.getBoundingClientRect();
      showNoteMenu(noteItem, Math.min(rect.left + 18, innerWidth - 180), Math.min(rect.bottom + 6, innerHeight - 180));
      return;
    }
    if (event.target.closest(".note-title")) startInlineEdit(noteItem);
  }, true);

  document.addEventListener("contextmenu", (event) => {
    const noteItem = event.target.closest?.(".note-item[data-note-id]");
    if (!noteItem) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showNoteMenu(noteItem, event.clientX, event.clientY);
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button > 0) return;
    const item = event.target.closest?.(".note-item[data-note-id]");
    if (!item || event.target.closest("button,input,select,textarea,a,[contenteditable=true]")) return;
    const coarse = coarsePointer() || event.pointerType === "touch";
    const g = { pointerId: event.pointerId, item, x: event.clientX, y: event.clientY, coarse, active: false, targetSectionId: null, targetGroupId: null, timer: null, preview: null };
    gesture = g;
    if (coarse) g.timer = setTimeout(() => activateGesture(g), TOUCH_HOLD_MS);
  }, true);

  document.addEventListener("pointermove", (event) => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const distance = Math.hypot(event.clientX - g.x, event.clientY - g.y);
    if (!g.active) {
      if (g.coarse && distance > TOUCH_SCROLL_DISTANCE) {
        clearGesture(g);
        return;
      }
      if (!g.coarse && distance >= DRAG_MOUSE_DISTANCE) activateGesture(g);
      if (!g.active) return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (g.preview) {
      g.preview.style.left = `${Math.min(innerWidth - 292, Math.max(8, event.clientX + 12))}px`;
      g.preview.style.top = `${Math.min(innerHeight - 50, Math.max(8, event.clientY + 12))}px`;
    }
    updateGestureTarget(g, event.clientX, event.clientY);
  }, true);

  document.addEventListener("pointerup", (event) => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    finishGesture(g);
  }, true);

  document.addEventListener("pointercancel", (event) => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    clearGesture(g);
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#uwContext")) $("#uwContext")?.classList.remove("open");
  });
}
