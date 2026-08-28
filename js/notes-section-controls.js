import { supabase } from "./supabase.js";
import { confirmAction, showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);

if (!window.__onekanNotesSectionControlsInstalled) {
  window.__onekanNotesSectionControlsInstalled = true;

  const style = document.createElement("style");
  style.dataset.onekanNotesSectionControls = "1";
  style.textContent = `
    .notes-page-tools:has(.notes-global-add-slot.open){grid-template-columns:minmax(0,1fr)!important}
    .notes-page-tools:has(.notes-global-add-slot.open) .notes-section-manager{grid-column:1/-1;justify-content:flex-end}
    .notes-page-tools .notes-composer{min-width:0}
    .notes-page-tools .notes-composer>*{min-width:0}
    .notes-section-board-head h2{min-width:0;flex:1}
    .notes-section-title-input{width:100%;min-width:0;height:32px;padding:4px 8px;border:1px solid var(--accent,#8fa9c4);border-radius:8px;background:var(--surface,#fff);color:var(--text,#272522);font:inherit;font-size:15px;font-weight:800;outline:none}
    @media(max-width:900px){.notes-page-tools{grid-template-columns:1fr!important}.notes-page-tools .notes-section-manager{grid-column:1/-1;justify-content:stretch}.notes-page-tools .notes-section-form{width:100%}}
  `;
  document.head.appendChild(style);

  async function readState() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;
    const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
    if (error) throw error;
    const state = data?.data && typeof data.data === "object" ? data.data : {};
    state.notes = Array.isArray(state.notes) ? state.notes : [];
    state.noteSections = Array.isArray(state.noteSections) ? state.noteSections : [];
    return { user: session.user, state };
  }

  async function writeState(mutator) {
    const loaded = await readState();
    if (!loaded) return false;
    mutator(loaded.state);
    const { error } = await supabase.from("onekan_state").upsert({ user_id: loaded.user.id, data: loaded.state }, { onConflict: "user_id" });
    if (error) throw error;
    document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "notes-section-controls" } }));
    $("#reloadCloudBtn")?.click();
    return true;
  }

  function positionMenu(menu, x, y) {
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.classList.add("open");
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  }

  async function startSectionEdit(board, sectionId) {
    const heading = $(".notes-section-board-head h2", board);
    if (!heading || $(".notes-section-title-input", board)) return;

    let loaded;
    try {
      loaded = await readState();
    } catch (error) {
      console.error(error);
      showToast("섹션 정보를 불러오지 못했어요.");
      return;
    }
    const section = loaded?.state.noteSections.find((item) => item.id === sectionId);
    if (!section) return;

    const original = section.name;
    const input = document.createElement("input");
    input.className = "notes-section-title-input";
    input.value = original;
    input.maxLength = 40;
    input.setAttribute("aria-label", "섹션 이름 수정");
    heading.hidden = true;
    heading.after(input);

    let finished = false;
    const restore = (name = original) => {
      if (heading.isConnected) {
        heading.textContent = name;
        heading.hidden = false;
      }
      input.remove();
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      restore();
    };
    const commit = async () => {
      if (finished) return;
      const name = input.value.trim();
      if (!name || name === original) {
        finished = true;
        restore();
        return;
      }
      finished = true;
      try {
        const latest = await readState();
        if (!latest) return restore();
        if (latest.state.noteSections.some((item) => item.id !== sectionId && item.name.trim() === name)) {
          showToast("같은 이름의 섹션이 이미 있어요.");
          restore();
          return;
        }
        restore(name);
        await writeState((state) => {
          const target = state.noteSections.find((item) => item.id === sectionId);
          if (target) target.name = name;
        });
        showToast("섹션 이름을 수정했어요.", { tone: "success" });
      } catch (error) {
        console.error(error);
        restore();
        showToast("섹션 이름을 수정하지 못했어요.");
      }
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", commit);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  async function deleteSection(sectionId) {
    let loaded;
    try {
      loaded = await readState();
    } catch (error) {
      console.error(error);
      showToast("섹션 정보를 불러오지 못했어요.");
      return;
    }
    if (!loaded) return;
    const sections = loaded.state.noteSections;
    const section = sections.find((item) => item.id === sectionId);
    if (!section) return;
    if (sections.length <= 1) {
      showToast("마지막 섹션은 삭제할 수 없어요.");
      return;
    }

    const fallback = sections.find((item) => item.id !== sectionId);
    const count = loaded.state.notes.filter((note) => note.sectionId === sectionId).length;
    const confirmed = await confirmAction({
      title: `‘${section.name}’ 섹션을 삭제할까요?`,
      message: count
        ? `이 섹션의 메모 ${count}개는 ‘${fallback.name}’ 섹션으로 이동해요.`
        : "섹션만 삭제돼요.",
      confirmLabel: "삭제",
    });
    if (!confirmed) return;

    try {
      await writeState((state) => {
        const remaining = state.noteSections.filter((item) => item.id !== sectionId);
        if (!remaining.length) return;
        const destinationId = remaining[0].id;
        state.noteSections = remaining;
        state.notes.forEach((note) => {
          if (note.sectionId === sectionId) note.sectionId = destinationId;
        });
      });
      showToast("섹션을 삭제했어요.", { tone: "success" });
    } catch (error) {
      console.error(error);
      showToast("섹션을 삭제하지 못했어요.");
    }
  }

  async function showSectionMenu(board, x, y) {
    const sectionId = board?.dataset.sectionId;
    const menu = $("#uwContext");
    if (!sectionId || !menu) return;

    try {
      const loaded = await readState();
      if (!loaded?.state.noteSections.some((item) => item.id === sectionId)) return;
    } catch (error) {
      console.error(error);
      return;
    }

    menu.innerHTML = '<button data-note-section-action="edit">수정</button><button class="danger" data-note-section-action="delete">삭제</button>';
    positionMenu(menu, x, y);
    menu.onclick = async (event) => {
      const action = event.target.closest("[data-note-section-action]")?.dataset.noteSectionAction;
      if (!action) return;
      menu.classList.remove("open");
      if (action === "edit") await startSectionEdit(board, sectionId);
      if (action === "delete") await deleteSection(sectionId);
    };
  }

  document.addEventListener("contextmenu", (event) => {
    const header = event.target.closest?.(".notes-section-board-head");
    if (!header || event.target.closest("button,input,select,textarea,a")) return;
    const board = header.closest(".notes-section-board[data-section-id]");
    if (!board) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showSectionMenu(board, event.clientX, event.clientY);
  }, true);
}
