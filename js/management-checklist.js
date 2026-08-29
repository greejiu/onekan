import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const pad = (value) => String(value).padStart(2, "0");
const VALID_REPEAT_UNITS = new Set(["day", "week", "month", "year"]);

let state = null;
let user = null;
let renderTimer = null;
let rendering = false;
let draftSteps = [];
let editingItemId = null;
let openHomeItemId = null;
let openHomeDate = null;

function appDateKey(date = new Date()) {
  const value = new Date(date);
  value.setHours(value.getHours() - 3);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function normalizeRepeat(value) {
  if (!value || typeof value !== "object" || !VALID_REPEAT_UNITS.has(value.unit)) return null;
  return { interval: Math.max(1, Math.min(999, Number.parseInt(value.interval, 10) || 1)), unit: value.unit, basis: "completion" };
}

function normalizeChecklist(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((step) => step && typeof step === "object" && String(step.title || "").trim())
    .map((step) => ({ id: String(step.id || `management-step-${crypto.randomUUID()}`), title: String(step.title || "").trim() }));
}

function normalizeState(raw) {
  const next = raw && typeof raw === "object" ? raw : {};
  next.managementItems = Array.isArray(next.managementItems) ? next.managementItems : [];
  next.managementHistory = Array.isArray(next.managementHistory) ? next.managementHistory : [];
  next.managementItems = next.managementItems.map((item) => ({
    ...item,
    checklist: normalizeChecklist(item.checklist),
    checklistProgress: item?.checklistProgress && typeof item.checklistProgress === "object" ? item.checklistProgress : {},
  }));
  return next;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) {
    state = null;
    return null;
  }
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = normalizeState(data?.data);
  return state;
}

async function writeState(mutator) {
  await readState();
  if (!state || !user) return false;
  mutator(state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management-checklist" } }));
  scheduleRender(70, false);
  return true;
}

function parseDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function addRepeatDate(baseKey, repeatValue) {
  const repeat = normalizeRepeat(repeatValue);
  const parts = parseDateKey(baseKey);
  if (!repeat || !parts) return "";
  if (repeat.unit === "day" || repeat.unit === "week") {
    const date = new Date(parts.year, parts.month - 1, parts.day, 12);
    date.setDate(date.getDate() + repeat.interval * (repeat.unit === "week" ? 7 : 1));
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  if (repeat.unit === "month") {
    const total = parts.year * 12 + parts.month - 1 + repeat.interval;
    const year = Math.floor(total / 12);
    const month = total % 12;
    const lastDay = new Date(year, month + 1, 0).getDate();
    return `${year}-${pad(month + 1)}-${pad(Math.min(parts.day, lastDay))}`;
  }
  const year = parts.year + repeat.interval;
  const month = parts.month - 1;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(parts.day, lastDay))}`;
}

function ensureStyle() {
  if ($('link[data-onekan-management-checklist-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/management-checklist.css?v=1";
  link.dataset.onekanManagementChecklistStyle = "1";
  document.head.appendChild(link);
}

function ensureDialog() {
  let dialog = $("#managementChecklistDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "managementChecklistDialog";
  dialog.className = "management-checklist-dialog";
  document.body.appendChild(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    editingItemId = null;
    draftSteps = [];
  });
  return dialog;
}

function ensureHomePopover() {
  let pop = $("#managementHomeChecklistPopover");
  if (pop) return pop;
  pop = document.createElement("div");
  pop.id = "managementHomeChecklistPopover";
  pop.className = "management-home-checklist-popover";
  pop.hidden = true;
  document.body.appendChild(pop);
  return pop;
}

function renderDialog() {
  const dialog = ensureDialog();
  const item = state?.managementItems.find((entry) => entry.id === editingItemId);
  if (!item) return;
  dialog.innerHTML = `
    <div class="management-checklist-dialog-inner">
      <div class="management-checklist-dialog-head">
        <div><strong>${esc(item.title)}</strong><small>하위 할일은 집에서 순서대로 체크할 수 있어요.</small></div>
        <button class="management-checklist-close" data-management-checklist-close type="button" aria-label="닫기">×</button>
      </div>
      <div class="management-checklist-dialog-body">
        <div class="management-checklist-rows">
          ${draftSteps.length ? draftSteps.map((step) => `
            <div class="management-checklist-row" data-management-checklist-row="${esc(step.id)}">
              <input type="text" maxlength="100" value="${esc(step.title)}" data-management-checklist-title="${esc(step.id)}" aria-label="하위 할일 이름">
              <button class="management-checklist-remove" data-management-checklist-remove="${esc(step.id)}" type="button" aria-label="하위 할일 삭제">×</button>
            </div>`).join("") : '<div class="management-checklist-empty">아직 하위 할일이 없어요.</div>'}
        </div>
        <form class="management-checklist-add-form" data-management-checklist-add-form autocomplete="off">
          <input type="text" maxlength="100" placeholder="하위 할일 추가" aria-label="새 하위 할일">
          <button class="soft-btn" type="submit">추가</button>
        </form>
      </div>
      <div class="management-checklist-dialog-actions">
        <button class="soft-btn" data-management-checklist-close type="button">취소</button>
        <button class="primary-btn" data-management-checklist-save type="button">저장</button>
      </div>
    </div>`;
}

function syncDraftTitles() {
  const dialog = $("#managementChecklistDialog");
  if (!dialog) return;
  for (const step of draftSteps) {
    const input = $(`[data-management-checklist-title="${CSS.escape(step.id)}"]`, dialog);
    if (input) step.title = input.value.trim();
  }
}

function openEditor(itemId) {
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  if (!item) return;
  editingItemId = itemId;
  draftSteps = normalizeChecklist(item.checklist).map((step) => ({ ...step }));
  renderDialog();
  const dialog = ensureDialog();
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => $("[data-management-checklist-add-form] input", dialog)?.focus());
}

function closeEditor() {
  const dialog = $("#managementChecklistDialog");
  if (dialog?.open) dialog.close();
}

function checklistDoneCount(item) {
  const progress = item?.checklistProgress && typeof item.checklistProgress === "object" ? item.checklistProgress : {};
  return normalizeChecklist(item?.checklist).filter((step) => Boolean(progress[step.id])).length;
}

function decorateManagementItems() {
  if (!state) return;
  const byId = new Map(state.managementItems.map((item) => [item.id, item]));
  for (const itemEl of $$("#page-management .management-item[data-management-item-id]")) {
    const item = byId.get(itemEl.dataset.managementItemId);
    if (!item) continue;
    const steps = normalizeChecklist(item.checklist);
    const signature = `${steps.length}:${steps.map((step) => `${step.id}:${step.title}`).join("|")}`;
    let button = $("[data-management-checklist-edit]", itemEl);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "management-checklist-edit";
      button.dataset.managementChecklistEdit = item.id;
      itemEl.appendChild(button);
    }
    if (button.dataset.signature !== signature) {
      button.dataset.signature = signature;
      button.textContent = steps.length ? `하위 할일 ${steps.length}` : "하위 할일 +";
      button.title = "하위 할일 편집";
    }
  }
}

function historyForDate(itemId, date) {
  return (state?.managementHistory || [])
    .filter((entry) => entry?.itemId === itemId && entry?.completedDate === date)
    .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")))
    .at(-1) || null;
}

function positionHomePopover(anchor) {
  const pop = ensureHomePopover();
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, innerWidth - 16);
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.right - width))}px`;
  const estimated = Math.min(340, pop.scrollHeight || 260);
  const below = rect.bottom + 6;
  pop.style.top = `${below + estimated < innerHeight ? below : Math.max(8, rect.top - estimated - 6)}px`;
}

function renderHomePopover() {
  const pop = ensureHomePopover();
  const item = state?.managementItems.find((entry) => entry.id === openHomeItemId);
  const steps = normalizeChecklist(item?.checklist);
  if (!item || !steps.length || !openHomeDate) {
    pop.hidden = true;
    return;
  }
  const progress = item.checklistProgress && typeof item.checklistProgress === "object" ? item.checklistProgress : {};
  const done = steps.filter((step) => Boolean(progress[step.id])).length;
  pop.innerHTML = `
    <div class="management-home-checklist-pop-head">
      <strong>${esc(item.title)}</strong>
      <button class="management-home-checklist-pop-close" data-management-home-checklist-close type="button" aria-label="닫기">×</button>
    </div>
    <div class="management-home-checklist-steps">
      ${steps.map((step) => {
        const checked = Boolean(progress[step.id]);
        return `<button class="management-home-checklist-step${checked ? " done" : ""}" data-management-home-checklist-step="${esc(step.id)}" data-item-id="${esc(item.id)}" data-date="${esc(openHomeDate)}" type="button"><span class="uw-check${checked ? " checked" : ""}" style="--uw-check-color:var(--timeline-management-color)">${checked ? "✓" : ""}</span><span>${esc(step.title)}</span></button>`;
      }).join("")}
    </div>
    <div class="management-home-checklist-pop-meta">${done}/${steps.length} 완료 · 마지막 항목을 체크하면 관리 항목이 완료돼요.</div>`;
  pop.hidden = false;
  const anchor = $(`#page-home [data-management-home-item][data-item-id="${CSS.escape(item.id)}"][data-date="${CSS.escape(openHomeDate)}"]`);
  if (anchor) positionHomePopover(anchor);
}

function openHomePopover(itemId, date) {
  openHomeItemId = itemId;
  openHomeDate = date;
  renderHomePopover();
}

function closeHomePopover() {
  openHomeItemId = null;
  openHomeDate = null;
  const pop = $("#managementHomeChecklistPopover");
  if (pop) pop.hidden = true;
}

function decorateHomeItems() {
  if (!state) return;
  const byId = new Map(state.managementItems.map((item) => [item.id, item]));
  for (const itemEl of $$("#page-home [data-management-home-item][data-item-id]")) {
    const item = byId.get(itemEl.dataset.itemId);
    const steps = normalizeChecklist(item?.checklist);
    const old = $("[data-management-home-checklist-open]", itemEl);
    if (!item || !steps.length || itemEl.classList.contains("done")) {
      old?.remove();
      continue;
    }
    const count = checklistDoneCount(item);
    const signature = `${count}/${steps.length}`;
    let button = old;
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "management-home-checklist-progress";
      button.dataset.managementHomeChecklistOpen = item.id;
      itemEl.appendChild(button);
    }
    button.dataset.date = itemEl.dataset.date || appDateKey();
    if (button.dataset.signature !== signature) {
      button.dataset.signature = signature;
      button.textContent = signature;
      button.title = "하위 할일 열기";
    }
    const parentCheck = $("[data-management-home-check]", itemEl);
    if (parentCheck) parentCheck.title = "하위 할일을 모두 체크하면 완료돼요.";
  }
  if (openHomeItemId) renderHomePopover();
}

async function renderDecorations({ refresh = false } = {}) {
  if (rendering) return;
  rendering = true;
  try {
    if (refresh || !state) await readState();
    if (!state) return;
    decorateManagementItems();
    decorateHomeItems();
  } catch (error) {
    console.error("management checklist render failed", error);
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 40, refresh = false) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderDecorations({ refresh }), delay);
}

async function saveChecklist() {
  syncDraftTitles();
  const cleaned = draftSteps.filter((step) => step.title.trim()).map((step) => ({ id: step.id, title: step.title.trim() }));
  const names = cleaned.map((step) => step.title.toLowerCase());
  if (new Set(names).size !== names.length) {
    showToast("같은 이름의 하위 할일이 있어요.");
    return;
  }
  const itemId = editingItemId;
  if (!itemId) return;
  await writeState((current) => {
    const item = current.managementItems.find((entry) => entry.id === itemId);
    if (!item) return;
    item.checklist = cleaned;
    const validIds = new Set(cleaned.map((step) => step.id));
    const progress = item.checklistProgress && typeof item.checklistProgress === "object" ? item.checklistProgress : {};
    item.checklistProgress = Object.fromEntries(Object.entries(progress).filter(([id, checked]) => validIds.has(id) && checked));
  });
  closeEditor();
}

async function toggleStep(itemId, stepId, viewDate) {
  const actualDate = appDateKey();
  const now = new Date();
  const completedTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  let completed = false;

  await writeState((current) => {
    current.managementHistory = Array.isArray(current.managementHistory) ? current.managementHistory : [];
    const item = current.managementItems.find((entry) => entry.id === itemId);
    if (!item) return;
    const steps = normalizeChecklist(item.checklist);
    if (!steps.some((step) => step.id === stepId)) return;
    if (current.managementHistory.some((entry) => entry.itemId === itemId && entry.completedDate === viewDate)) return;

    const previousProgress = item.checklistProgress && typeof item.checklistProgress === "object" ? { ...item.checklistProgress } : {};
    const progress = { ...previousProgress, [stepId]: !previousProgress[stepId] };
    if (!progress[stepId]) delete progress[stepId];
    const allDone = steps.length > 0 && steps.every((step) => Boolean(progress[step.id]));
    if (!allDone) {
      item.checklistProgress = progress;
      return;
    }

    completed = true;
    const repeat = normalizeRepeat(item.repeat);
    const previousNextDate = item.nextDate || "";
    const previousNextTime = item.nextTime || "";
    const nextDateAfter = repeat ? addRepeatDate(actualDate, repeat) : "";
    const nextTimeAfter = repeat ? previousNextTime : "";
    current.managementHistory.push({
      id: `management-history-${crypto.randomUUID()}`,
      itemId,
      title: item.title,
      completedAt: now.toISOString(),
      completedDate: actualDate,
      completedTime,
      scheduledDate: previousNextDate,
      scheduledTime: previousNextTime,
      previousNextDate,
      previousNextTime,
      nextDateAfter,
      nextTimeAfter,
      checklistProgressBeforeCompletion: previousProgress,
      checklistCompletedStepId: stepId,
    });
    item.lastCompletedAt = now.toISOString();
    item.nextDate = nextDateAfter;
    item.nextTime = nextTimeAfter;
    item.checklistProgress = {};
  });

  if (completed) {
    closeHomePopover();
    if (viewDate !== actualDate) showToast(`실행 기록은 실제 체크한 ${actualDate}로 저장했어요.`);
  } else {
    renderHomePopover();
  }
}

async function undoChecklistCompletion(itemId, viewDate) {
  let undone = false;
  await writeState((current) => {
    current.managementHistory = Array.isArray(current.managementHistory) ? current.managementHistory : [];
    const item = current.managementItems.find((entry) => entry.id === itemId);
    if (!item) return;
    const rows = current.managementHistory
      .filter((entry) => entry.itemId === itemId && entry.completedDate)
      .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")));
    const target = rows.filter((entry) => entry.completedDate === viewDate).at(-1) || null;
    if (!target || rows.at(-1)?.id !== target.id) return;
    current.managementHistory = current.managementHistory.filter((entry) => entry.id !== target.id);
    item.nextDate = target.previousNextDate || "";
    item.nextTime = target.previousNextTime || "";
    item.checklistProgress = target.checklistProgressBeforeCompletion && typeof target.checklistProgressBeforeCompletion === "object" ? { ...target.checklistProgressBeforeCompletion } : {};
    const remaining = current.managementHistory
      .filter((entry) => entry.itemId === itemId)
      .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")));
    item.lastCompletedAt = remaining.at(-1)?.completedAt || null;
    undone = true;
  });
  if (!undone) showToast("가장 최근 완료 기록만 되돌릴 수 있어요.");
}

function wireEvents() {
  document.addEventListener("click", async (event) => {
    const parentCheck = event.target.closest?.("[data-management-home-check]");
    if (parentCheck) {
      const itemId = parentCheck.dataset.itemId || "";
      const item = state?.managementItems.find((entry) => entry.id === itemId);
      const steps = normalizeChecklist(item?.checklist);
      if (steps.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const host = parentCheck.closest("[data-management-home-item]");
        const date = parentCheck.dataset.date || host?.dataset.date || appDateKey();
        if (host?.classList.contains("done") || historyForDate(itemId, date)) await undoChecklistCompletion(itemId, date);
        else openHomePopover(itemId, date);
        return;
      }
    }

    const edit = event.target.closest?.("[data-management-checklist-edit]");
    if (edit) {
      event.preventDefault();
      event.stopPropagation();
      openEditor(edit.dataset.managementChecklistEdit || "");
      return;
    }

    if (event.target.closest?.("[data-management-checklist-close]")) {
      closeEditor();
      return;
    }

    const remove = event.target.closest?.("[data-management-checklist-remove]");
    if (remove) {
      syncDraftTitles();
      draftSteps = draftSteps.filter((step) => step.id !== remove.dataset.managementChecklistRemove);
      renderDialog();
      return;
    }

    if (event.target.closest?.("[data-management-checklist-save]")) {
      try {
        await saveChecklist();
      } catch (error) {
        console.error("management checklist save failed", error);
        showToast("하위 할일 저장 중 오류가 났어요.");
      }
      return;
    }

    const homeOpen = event.target.closest?.("[data-management-home-checklist-open]");
    if (homeOpen) {
      event.preventDefault();
      event.stopPropagation();
      openHomePopover(homeOpen.dataset.managementHomeChecklistOpen || "", homeOpen.dataset.date || appDateKey());
      return;
    }

    if (event.target.closest?.("[data-management-home-checklist-close]")) {
      closeHomePopover();
      return;
    }

    const step = event.target.closest?.("[data-management-home-checklist-step]");
    if (step) {
      event.preventDefault();
      try {
        await toggleStep(step.dataset.itemId || "", step.dataset.managementHomeChecklistStep || "", step.dataset.date || appDateKey());
      } catch (error) {
        console.error("management checklist step failed", error);
        showToast("하위 할일 저장 중 오류가 났어요.");
      }
      return;
    }

    const pop = $("#managementHomeChecklistPopover");
    if (pop && !pop.hidden && !event.target.closest("#managementHomeChecklistPopover") && !event.target.closest("[data-management-home-checklist-open]") && !event.target.closest("[data-management-home-check]")) closeHomePopover();
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target.closest?.("[data-management-checklist-add-form]");
    if (!form) return;
    event.preventDefault();
    syncDraftTitles();
    const input = $("input[type=text]", form);
    const title = input?.value.trim() || "";
    if (!title) return;
    draftSteps.push({ id: `management-step-${crypto.randomUUID()}`, title });
    renderDialog();
    requestAnimationFrame(() => $("[data-management-checklist-add-form] input", $("#managementChecklistDialog"))?.focus());
  });

  window.addEventListener("resize", () => {
    if (openHomeItemId) renderHomePopover();
  });
}

ensureStyle();
ensureDialog();
ensureHomePopover();
wireEvents();
for (const root of [$("#page-management"), $("#page-home")].filter(Boolean)) {
  const observer = new MutationObserver(() => scheduleRender(35, false));
  observer.observe(root, { childList: true, subtree: true });
}
document.addEventListener("onekan:state-changed", (event) => {
  if (event.detail?.source !== "management-checklist") scheduleRender(70, true);
});
supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  if (user) scheduleRender(100, true);
});
scheduleRender(130, true);
