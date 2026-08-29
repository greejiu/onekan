import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const DEFAULT_SECTION_ID = "goal-section-inbox";
const VALID_STATUSES = new Set(["before", "doing"]);
let saving = false;

function ensureCss() {
  if ($('link[data-goal-quick-add-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/goal-quick-add.css?v=1";
  link.dataset.goalQuickAddCss = "1";
  document.head.appendChild(link);
}

function closeQuickForms() {
  $$(".ok-goal-quick-form", $("#goalSections") || document).forEach((form) => {
    const column = form.closest(".ok-goal-column");
    form.remove();
    $(".ok-goal-quick-add", column)?.removeAttribute("hidden");
  });
}

function currentSectionId() {
  return $("#okGoalSectionSelect")?.value || "all";
}

function sectionOptions(state, selected) {
  const sections = Array.isArray(state.goalSections) ? [...state.goalSections] : [];
  sections.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  return sections.map((section) => `<option value="${esc(section.id)}"${section.id === selected ? " selected" : ""}>${esc(section.name || "미분류")}</option>`).join("");
}

async function getState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.goalSections = Array.isArray(state.goalSections) && state.goalSections.length
    ? state.goalSections
    : [{ id: DEFAULT_SECTION_ID, name: "미분류", color: "#8fa9c4", system: true, order: 0 }];
  state.eventGroups = Array.isArray(state.eventGroups) ? state.eventGroups : [];
  return { session, state };
}

async function openQuickForm(button) {
  const column = button.closest(".ok-goal-column");
  if (!column) return;
  const status = column.dataset.goalV2Status;
  const contextualSection = column.dataset.goalV2GroupId || "";
  if (!VALID_STATUSES.has(status)) return;
  closeQuickForms();

  let loaded;
  try {
    loaded = await getState();
  } catch (error) {
    console.error("목표 빠른 추가 준비 실패", error);
    showToast?.("목표 추가 준비에 실패했어요.");
    return;
  }
  if (!loaded) return;

  const selected = currentSectionId();
  const savedQuickSection = sessionStorage.getItem("onekan-goal-quick-section") || DEFAULT_SECTION_ID;
  const defaultSection = selected !== "all"
    ? selected
    : loaded.state.goalSections.some((section) => section.id === contextualSection)
      ? contextualSection
      : loaded.state.goalSections.some((section) => section.id === savedQuickSection)
        ? savedQuickSection
        : DEFAULT_SECTION_ID;

  const form = document.createElement("div");
  form.className = "ok-goal-quick-form";
  form.dataset.goalQuickStatus = status;
  form.dataset.goalQuickSection = defaultSection;
  form.innerHTML = `<input class="ok-goal-quick-title" type="text" maxlength="120" autocomplete="off" placeholder="새 목표" aria-label="새 목표 제목" />
    ${selected === "all" && !contextualSection ? `<select class="ok-goal-quick-section" aria-label="목표 그룹">${sectionOptions(loaded.state, defaultSection)}</select>` : ""}
    <div class="ok-goal-quick-actions"><button class="ok-goal-quick-cancel" type="button">취소</button><button class="ok-goal-quick-save" type="button">추가</button></div>
    <small class="ok-goal-quick-message" aria-live="polite"></small>`;
  button.before(form);
  button.hidden = true;
  $(".ok-goal-quick-title", form)?.focus({ preventScroll: true });
}

function setFormMessage(form, text) {
  const node = $(".ok-goal-quick-message", form);
  if (node) node.textContent = text || "";
}

async function saveQuickForm(form) {
  if (saving || !form) return;
  const title = $(".ok-goal-quick-title", form)?.value.trim() || "";
  if (!title) {
    setFormMessage(form, "목표 이름을 입력해 주세요.");
    $(".ok-goal-quick-title", form)?.focus();
    return;
  }
  const status = form.dataset.goalQuickStatus;
  if (!VALID_STATUSES.has(status)) return;

  saving = true;
  $(".ok-goal-quick-save", form)?.setAttribute("disabled", "");
  try {
    const loaded = await getState();
    if (!loaded) return;
    const { session, state } = loaded;
    const fixedSection = currentSectionId();
    let sectionId = fixedSection !== "all"
      ? fixedSection
      : (form.dataset.goalQuickSection || $(".ok-goal-quick-section", form)?.value || DEFAULT_SECTION_ID);
    if (!state.goalSections.some((section) => section.id === sectionId)) sectionId = DEFAULT_SECTION_ID;
    const section = state.goalSections.find((entry) => entry.id === sectionId);
    const fallbackGroupId = state.eventGroups[0]?.id || "default";

    const now = new Date().toISOString();
    const goal = {
      id: crypto.randomUUID(),
      kind: "goal",
      title,
      status,
      goalSectionId: sectionId,
      groupId: section?.sourceGroupId || fallbackGroupId,
      goalTerm: "short",
      startDate: "",
      deadline: "",
      createdAt: now,
    };
    state.projects.push(goal);

    const { error } = await supabase.from("onekan_state").upsert({ user_id: session.user.id, data: state }, { onConflict: "user_id" });
    if (error) throw error;
    sessionStorage.setItem("onekan-goal-quick-section", sectionId);
    document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "goal-quick-add" } }));
    closeQuickForms();
    showToast?.(`‘${title}’ 목표를 추가했어요.`);
  } catch (error) {
    console.error("목표 빠른 추가 실패", error);
    setFormMessage(form, "저장하지 못했어요. 다시 시도해 주세요.");
  } finally {
    saving = false;
    $(".ok-goal-quick-save", form)?.removeAttribute("disabled");
  }
}

function decorateColumns() {
  const root = $("#goalSections");
  if (!root) return;
  $$(".ok-goal-column[data-goal-v2-status]", root).forEach((column) => {
    const status = column.dataset.goalV2Status;
    if (!VALID_STATUSES.has(status)) return;
    if ($(".ok-goal-quick-add", column)) return;
    const button = document.createElement("button");
    button.className = "ok-goal-quick-add";
    button.type = "button";
    button.textContent = "+ 목표 추가";
    $(".ok-goal-column-list", column)?.after(button);
  });
}

function wire() {
  if (document.documentElement.dataset.goalQuickAddWired) return;
  document.documentElement.dataset.goalQuickAddWired = "1";
  ensureCss();

  const page = $("#page-goals");
  if (!page) return;
  page.addEventListener("click", async (event) => {
    const add = event.target.closest(".ok-goal-quick-add");
    if (add) {
      await openQuickForm(add);
      return;
    }
    const cancel = event.target.closest(".ok-goal-quick-cancel");
    if (cancel) {
      closeQuickForms();
      return;
    }
    const save = event.target.closest(".ok-goal-quick-save");
    if (save) await saveQuickForm(save.closest(".ok-goal-quick-form"));
  });

  page.addEventListener("keydown", async (event) => {
    const form = event.target.closest?.(".ok-goal-quick-form");
    if (!form) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeQuickForms();
      return;
    }
    if (event.key === "Enter" && event.target.classList.contains("ok-goal-quick-title")) {
      event.preventDefault();
      await saveQuickForm(form);
    }
  });

  const root = $("#goalSections");
  if (root) {
    const observer = new MutationObserver(() => requestAnimationFrame(decorateColumns));
    observer.observe(root, { childList: true, subtree: true });
  }
  $(".nav-item[data-page='goals']")?.addEventListener("click", () => setTimeout(decorateColumns, 160));
  document.addEventListener("onekan:state-changed", () => setTimeout(decorateColumns, 180));
  setTimeout(decorateColumns, 160);
}

wire();
