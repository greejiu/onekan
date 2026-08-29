import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const VALID_UNITS = new Set(["day", "week", "month", "year"]);

let state = null;
let user = null;
let openKind = null;
let openSourceForm = null;
let renderTimer = null;
let rendering = false;
let pendingSave = null;

function normalizeRepeat(value) {
  if (!value || typeof value !== "object") return null;
  const unit = VALID_UNITS.has(value.unit) ? value.unit : null;
  const interval = Math.max(1, Math.min(999, Number.parseInt(value.interval, 10) || 1));
  if (!unit) return null;
  return { interval, unit, basis: "completion" };
}

function normalizeState(raw) {
  const next = raw && typeof raw === "object" ? raw : {};
  next.managementItems = Array.isArray(next.managementItems) ? next.managementItems : [];
  next.managementItems = next.managementItems.map((item) => ({
    ...item,
    nextDate: /^\d{4}-\d{2}-\d{2}$/.test(item?.nextDate || "") ? item.nextDate : "",
    nextTime: /^\d{2}:\d{2}$/.test(item?.nextTime || "") ? item.nextTime : "",
    repeat: normalizeRepeat(item?.repeat),
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
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  state = normalizeState(data?.data);
  return state;
}

async function persistState(nextState) {
  if (!user) return;
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: user.id, data: nextState }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management-schedule" } }));
  scheduleRender(80);
}

function ensureStyle() {
  if ($('link[data-onekan-management-schedule-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/management-item-schedule.css?v=2";
  link.dataset.onekanManagementScheduleStyle = "1";
  document.head.appendChild(link);
}

function ensurePopover() {
  if ($("#managementSchedulePopover")) return;
  const pop = document.createElement("div");
  pop.id = "managementSchedulePopover";
  pop.className = "management-schedule-popover";
  pop.hidden = true;
  document.body.appendChild(pop);
}

function unitLabel(unit) {
  return ({ day: "일", week: "주", month: "개월", year: "년" })[unit] || "";
}

function repeatLabel(repeat) {
  const normalized = normalizeRepeat(repeat);
  if (!normalized) return "";
  return `${normalized.interval}${unitLabel(normalized.unit)}마다`;
}

function dateLabel(date, time = "") {
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  const now = new Date();
  const yearText = year !== now.getFullYear() ? `${year}.` : "";
  const base = `${yearText}${month}.${day}`;
  return time ? `${base} ${time}` : base;
}

function calendarIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path></svg>';
}

function metaMarkup(item) {
  const date = item.nextDate || "";
  const time = date ? (item.nextTime || "") : "";
  const repeat = normalizeRepeat(item.repeat);
  const meta = [
    date ? `<span class="management-schedule-meta-date">${esc(dateLabel(date, time))}</span>` : "",
    repeat ? `<span class="management-schedule-meta-repeat">↻ ${esc(repeatLabel(repeat))}</span>` : "",
  ].filter(Boolean).join("");
  return `<div class="management-schedule-meta" data-management-schedule-meta="${esc(item.id)}"${meta ? "" : " hidden"}>${meta}</div>`;
}

function decorateItem(itemEl, item) {
  const signature = JSON.stringify([item.nextDate || "", item.nextTime || "", normalizeRepeat(item.repeat)]);
  if (itemEl.dataset.managementScheduleSignature === signature && itemEl.querySelector(".management-schedule-meta")) {
    itemEl.querySelectorAll(".management-schedule-tools").forEach((node) => node.remove());
    return;
  }
  itemEl.querySelectorAll(".management-schedule-tools,.management-schedule-meta").forEach((node) => node.remove());
  itemEl.insertAdjacentHTML("beforeend", metaMarkup(item));
  itemEl.dataset.managementScheduleSignature = signature;
}

function hiddenInput(name, value = "") {
  return `<input type="hidden" name="${name}" value="${esc(value)}">`;
}

function repeatFromForm(form) {
  const unit = form.elements.managementRepeatUnit?.value || "";
  if (!VALID_UNITS.has(unit)) return null;
  const interval = Math.max(1, Math.min(999, Number.parseInt(form.elements.managementRepeatInterval?.value, 10) || 1));
  return { interval, unit, basis: "completion" };
}

function draftFromForm(form) {
  const date = form.elements.managementNextDate?.value || "";
  return {
    nextDate: date,
    nextTime: date ? (form.elements.managementNextTime?.value || "") : "",
    repeat: repeatFromForm(form),
  };
}

function updateFormTools(form) {
  const draft = draftFromForm(form);
  const dateButton = form.querySelector('[data-management-schedule-tool="date"]');
  const repeatButton = form.querySelector('[data-management-schedule-tool="repeat"]');
  dateButton?.classList.toggle("active", Boolean(draft.nextDate));
  repeatButton?.classList.toggle("active", Boolean(draft.repeat));
  if (dateButton) dateButton.title = draft.nextDate ? `다음 예정 ${dateLabel(draft.nextDate, draft.nextTime)}` : "다음 예정일";
  if (repeatButton) repeatButton.title = draft.repeat ? `반복 ${repeatLabel(draft.repeat)}` : "반복 설정";
}

function decorateForm(form, item = null) {
  if (form.dataset.managementScheduleReady === "1") {
    updateFormTools(form);
    return;
  }
  const titleInput = form.querySelector('input[type="text"]');
  if (!titleInput) return;

  form.insertAdjacentHTML("beforeend", [
    hiddenInput("managementNextDate", item?.nextDate || ""),
    hiddenInput("managementNextTime", item?.nextTime || ""),
    hiddenInput("managementRepeatInterval", item?.repeat?.interval || ""),
    hiddenInput("managementRepeatUnit", item?.repeat?.unit || ""),
  ].join(""));

  const wrap = document.createElement("div");
  wrap.className = "management-item-input-wrap";
  titleInput.parentNode.insertBefore(wrap, titleInput);
  wrap.appendChild(titleInput);
  wrap.insertAdjacentHTML("beforeend", `
    <div class="management-input-schedule-tools" aria-label="관리 일정 설정">
      <button class="management-schedule-tool" data-management-schedule-tool="date" type="button" aria-label="다음 예정일">${calendarIcon()}</button>
      <button class="management-schedule-tool management-repeat-tool" data-management-schedule-tool="repeat" type="button" aria-label="반복 설정">↻</button>
    </div>`);

  form.classList.add("has-management-schedule-input");
  form.dataset.managementScheduleReady = "1";
  updateFormTools(form);
}

async function renderSchedule({ refresh = false } = {}) {
  if (rendering || !$("#page-management")) return;
  rendering = true;
  try {
    if (refresh || !state) await readState();
    if (!state) return;
    const byId = new Map(state.managementItems.map((item) => [item.id, item]));

    $$("#page-management .management-item[data-management-item-id]").forEach((itemEl) => {
      const item = byId.get(itemEl.dataset.managementItemId);
      if (item) decorateItem(itemEl, item);
    });

    $$("#page-management [data-management-item-form]").forEach((form) => {
      const item = form.dataset.itemId ? byId.get(form.dataset.itemId) : null;
      decorateForm(form, item || null);
    });
  } catch (error) {
    console.error("management schedule render failed", error);
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 35, refresh = false) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderSchedule({ refresh }), delay);
}

function closePopover() {
  const pop = $("#managementSchedulePopover");
  if (pop) pop.hidden = true;
  openKind = null;
  openSourceForm = null;
}

function positionPopover(button, pop) {
  const rect = button.getBoundingClientRect();
  const width = Math.min(320, innerWidth - 16);
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.right - width))}px`;
  pop.style.top = `${Math.max(8, Math.min(innerHeight - 190, rect.bottom + 7))}px`;
}

function datePanel(draft) {
  return `<form class="management-schedule-form" data-management-date-form>
    <div class="management-schedule-pop-head"><strong>다음 예정</strong><button type="button" data-management-schedule-close aria-label="닫기">×</button></div>
    <label><span>날짜</span><input name="date" type="date" value="${esc(draft.nextDate || "")}"></label>
    <label><span>시간 <small>선택</small></span><input name="time" type="time" step="1800" value="${esc(draft.nextTime || "")}"${draft.nextDate ? "" : " disabled"}></label>
    <small class="management-schedule-help">시간을 비우면 하루종일 관리 항목으로 사용할 수 있어요.</small>
    <div class="management-schedule-actions"><button class="ghost-btn danger-text" data-management-date-clear type="button">날짜 지우기</button><span></span><button class="primary-btn" type="submit">적용</button></div>
  </form>`;
}

function repeatPanel(draft) {
  const repeat = normalizeRepeat(draft.repeat) || { interval: 1, unit: "month" };
  return `<form class="management-schedule-form" data-management-repeat-form>
    <div class="management-schedule-pop-head"><strong>반복</strong><button type="button" data-management-schedule-close aria-label="닫기">×</button></div>
    <div class="management-repeat-fields">
      <input name="interval" type="number" min="1" max="999" inputmode="numeric" value="${repeat.interval}" aria-label="반복 간격">
      <select name="unit" aria-label="반복 단위">
        <option value="day"${repeat.unit === "day" ? " selected" : ""}>일마다</option>
        <option value="week"${repeat.unit === "week" ? " selected" : ""}>주마다</option>
        <option value="month"${repeat.unit === "month" ? " selected" : ""}>개월마다</option>
        <option value="year"${repeat.unit === "year" ? " selected" : ""}>년마다</option>
      </select>
    </div>
    <small class="management-schedule-help">체크한 실제 날짜를 기준으로 다음 예정일을 잡아요.</small>
    <div class="management-schedule-actions"><button class="ghost-btn danger-text" data-management-repeat-clear type="button">반복 없음</button><span></span><button class="primary-btn" type="submit">적용</button></div>
  </form>`;
}

function openPopover(button, kind) {
  const sourceForm = button.closest("[data-management-item-form]");
  const pop = $("#managementSchedulePopover");
  if (!sourceForm || !pop) return;
  if (openSourceForm === sourceForm && openKind === kind && !pop.hidden) {
    closePopover();
    return;
  }
  openSourceForm = sourceForm;
  openKind = kind;
  const draft = draftFromForm(sourceForm);
  pop.innerHTML = kind === "repeat" ? repeatPanel(draft) : datePanel(draft);
  pop.hidden = false;
  positionPopover(button, pop);
  requestAnimationFrame(() => pop.querySelector("input,select")?.focus());
}

function setDateDraft(date, time = "") {
  if (!openSourceForm?.isConnected) return;
  openSourceForm.elements.managementNextDate.value = date || "";
  openSourceForm.elements.managementNextTime.value = date ? (time || "") : "";
  openSourceForm.dataset.managementScheduleDirty = "1";
  updateFormTools(openSourceForm);
}

function setRepeatDraft(repeat) {
  if (!openSourceForm?.isConnected) return;
  const normalized = normalizeRepeat(repeat);
  openSourceForm.elements.managementRepeatInterval.value = normalized?.interval || "";
  openSourceForm.elements.managementRepeatUnit.value = normalized?.unit || "";
  openSourceForm.dataset.managementScheduleDirty = "1";
  updateFormTools(openSourceForm);
}

async function applyPendingSave() {
  const pending = pendingSave;
  pendingSave = null;
  if (!pending || Date.now() - pending.capturedAt > 5000) return;

  try {
    await readState();
    if (!state || !user) return;
    let item = pending.itemId ? state.managementItems.find((entry) => entry.id === pending.itemId) : null;
    if (!item) {
      const candidates = state.managementItems.filter((entry) => entry.groupId === pending.groupId && String(entry.title || "").trim() === pending.title);
      item = candidates.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
    }
    if (!item) return;

    item.nextDate = pending.nextDate;
    item.nextTime = pending.nextDate ? pending.nextTime : "";
    item.repeat = pending.repeat;
    await persistState(state);
  } catch (error) {
    console.error("management schedule staged save failed", error);
    showToast("날짜·반복 설정 저장 중 오류가 났어요.");
  }
}

function captureMainFormSubmit(event) {
  const form = event.target.closest?.("[data-management-item-form]");
  if (!form || form.dataset.managementScheduleDirty !== "1") return;
  const draft = draftFromForm(form);
  const title = form.querySelector('input[type="text"]')?.value.trim() || "";
  if (!title) return;
  pendingSave = {
    itemId: form.dataset.itemId || "",
    groupId: form.dataset.groupId || "",
    title,
    nextDate: draft.nextDate,
    nextTime: draft.nextTime,
    repeat: draft.repeat,
    capturedAt: Date.now(),
  };
}

function wireEvents() {
  document.addEventListener("click", (event) => {
    const tool = event.target.closest("[data-management-schedule-tool]");
    if (tool) {
      event.preventDefault();
      event.stopPropagation();
      openPopover(tool, tool.dataset.managementScheduleTool || "date");
      return;
    }

    if (event.target.closest("[data-management-schedule-close]")) {
      closePopover();
      return;
    }

    const dateClear = event.target.closest("[data-management-date-clear]");
    if (dateClear) {
      setDateDraft("", "");
      closePopover();
      return;
    }

    const repeatClear = event.target.closest("[data-management-repeat-clear]");
    if (repeatClear) {
      setRepeatDraft(null);
      closePopover();
      return;
    }

    const pop = $("#managementSchedulePopover");
    if (pop && !pop.hidden && !event.target.closest("#managementSchedulePopover")) closePopover();
  });

  document.addEventListener("change", (event) => {
    if (!event.target.matches('#managementSchedulePopover input[name="date"]')) return;
    const form = event.target.closest("[data-management-date-form]");
    const time = form?.elements.time;
    if (!time) return;
    time.disabled = !event.target.value;
    if (!event.target.value) time.value = "";
  });

  document.addEventListener("submit", (event) => {
    const dateForm = event.target.closest("[data-management-date-form]");
    if (dateForm) {
      event.preventDefault();
      const date = dateForm.elements.date?.value || "";
      const time = date ? (dateForm.elements.time?.value || "") : "";
      setDateDraft(date, time);
      closePopover();
      return;
    }

    const repeatForm = event.target.closest("[data-management-repeat-form]");
    if (repeatForm) {
      event.preventDefault();
      const interval = Math.max(1, Math.min(999, Number.parseInt(repeatForm.elements.interval?.value, 10) || 1));
      const unit = VALID_UNITS.has(repeatForm.elements.unit?.value) ? repeatForm.elements.unit.value : "month";
      setRepeatDraft({ interval, unit, basis: "completion" });
      closePopover();
    }
  });

  document.addEventListener("submit", captureMainFormSubmit, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.closest("#managementSchedulePopover")) {
      event.preventDefault();
      closePopover();
    }
  });

  addEventListener("resize", closePopover);
  addEventListener("scroll", closePopover, true);
}

ensureStyle();
ensurePopover();
wireEvents();
const managementPage = $("#page-management");
if (managementPage) {
  const observer = new MutationObserver(() => scheduleRender(30, false));
  observer.observe(managementPage, { childList: true, subtree: true });
}
document.addEventListener("onekan:state-changed", (event) => {
  if (event.detail?.source === "management-items" && pendingSave) {
    void applyPendingSave();
    return;
  }
  if (event.detail?.source !== "management-schedule") scheduleRender(60, true);
});
supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  if (user) scheduleRender(100, true);
});
scheduleRender(120, true);
