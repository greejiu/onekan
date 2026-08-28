import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const VALID_UNITS = new Set(["day", "week", "month", "year"]);

let state = null;
let user = null;
let openItemId = null;
let openKind = null;
let renderTimer = null;
let rendering = false;

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

async function writeState(mutator) {
  await readState();
  if (!state || !user) return false;
  mutator(state);
  const { error } = await supabase
    .from("onekan_state")
    .upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management-schedule" } }));
  $("#reloadCloudBtn")?.click();
  scheduleRender(80);
  return true;
}

function ensureStyle() {
  if ($('link[data-onekan-management-schedule-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/management-item-schedule.css?v=1";
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

function scheduleMarkup(item) {
  const date = item.nextDate || "";
  const time = date ? (item.nextTime || "") : "";
  const repeat = normalizeRepeat(item.repeat);
  const meta = [
    date ? `<span class="management-schedule-meta-date">${esc(dateLabel(date, time))}</span>` : "",
    repeat ? `<span class="management-schedule-meta-repeat">↻ ${esc(repeatLabel(repeat))}</span>` : "",
  ].filter(Boolean).join("");

  return `<div class="management-schedule-tools" data-management-schedule-owner="${esc(item.id)}">
      <button class="management-schedule-tool${date ? " active" : ""}" data-management-schedule-tool="date" data-item-id="${esc(item.id)}" type="button" title="다음 예정일" aria-label="다음 예정일">${calendarIcon()}</button>
      <button class="management-schedule-tool management-repeat-tool${repeat ? " active" : ""}" data-management-schedule-tool="repeat" data-item-id="${esc(item.id)}" type="button" title="반복 설정" aria-label="반복 설정">↻</button>
    </div>
    <div class="management-schedule-meta" data-management-schedule-meta="${esc(item.id)}"${meta ? "" : " hidden"}>${meta}</div>`;
}

function decorateItem(itemEl, item) {
  const current = itemEl.querySelector('[data-management-schedule-owner]')?.dataset.managementScheduleOwner;
  const signature = JSON.stringify([item.nextDate || "", item.nextTime || "", normalizeRepeat(item.repeat)]);
  if (current === item.id && itemEl.dataset.managementScheduleSignature === signature) return;

  itemEl.querySelectorAll(".management-schedule-tools,.management-schedule-meta").forEach((node) => node.remove());
  itemEl.insertAdjacentHTML("beforeend", scheduleMarkup(item));
  itemEl.dataset.managementScheduleSignature = signature;
}

async function renderSchedule() {
  if (rendering || !$("#page-management")) return;
  rendering = true;
  try {
    await readState();
    if (!state) return;
    const byId = new Map(state.managementItems.map((item) => [item.id, item]));
    $$("#page-management .management-item[data-management-item-id]").forEach((itemEl) => {
      const item = byId.get(itemEl.dataset.managementItemId);
      if (item) decorateItem(itemEl, item);
    });
  } catch (error) {
    console.error("management schedule render failed", error);
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 35) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderSchedule, delay);
}

function closePopover() {
  const pop = $("#managementSchedulePopover");
  if (pop) pop.hidden = true;
  openItemId = null;
  openKind = null;
}

function positionPopover(button, pop) {
  const rect = button.getBoundingClientRect();
  const width = Math.min(320, innerWidth - 16);
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.right - width))}px`;
  pop.style.top = `${Math.min(innerHeight - 190, rect.bottom + 7)}px`;
}

function datePanel(item) {
  return `<form class="management-schedule-form" data-management-date-form data-item-id="${esc(item.id)}">
    <div class="management-schedule-pop-head"><strong>다음 예정</strong><button type="button" data-management-schedule-close aria-label="닫기">×</button></div>
    <label><span>날짜</span><input name="date" type="date" value="${esc(item.nextDate || "")}"></label>
    <label><span>시간 <small>선택</small></span><input name="time" type="time" step="1800" value="${esc(item.nextTime || "")}"${item.nextDate ? "" : " disabled"}></label>
    <small class="management-schedule-help">시간을 비우면 하루종일 관리 항목으로 사용할 수 있어요.</small>
    <div class="management-schedule-actions"><button class="ghost-btn danger-text" data-management-date-clear type="button">날짜 지우기</button><span></span><button class="primary-btn" type="submit">저장</button></div>
  </form>`;
}

function repeatPanel(item) {
  const repeat = normalizeRepeat(item.repeat) || { interval: 1, unit: "month" };
  return `<form class="management-schedule-form" data-management-repeat-form data-item-id="${esc(item.id)}">
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
    <div class="management-schedule-actions"><button class="ghost-btn danger-text" data-management-repeat-clear type="button">반복 없음</button><span></span><button class="primary-btn" type="submit">저장</button></div>
  </form>`;
}

async function openPopover(button, itemId, kind) {
  await readState();
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  const pop = $("#managementSchedulePopover");
  if (!item || !pop) return;
  openItemId = itemId;
  openKind = kind;
  pop.innerHTML = kind === "repeat" ? repeatPanel(item) : datePanel(item);
  pop.hidden = false;
  positionPopover(button, pop);
  requestAnimationFrame(() => pop.querySelector("input,select")?.focus());
}

async function saveDate(form) {
  const itemId = form.dataset.itemId || "";
  const date = form.elements.date?.value || "";
  const time = date ? (form.elements.time?.value || "") : "";
  await writeState((current) => {
    const item = current.managementItems.find((entry) => entry.id === itemId);
    if (!item) return;
    item.nextDate = date;
    item.nextTime = time;
  });
  closePopover();
}

async function saveRepeat(form) {
  const itemId = form.dataset.itemId || "";
  const interval = Math.max(1, Math.min(999, Number.parseInt(form.elements.interval?.value, 10) || 1));
  const unit = VALID_UNITS.has(form.elements.unit?.value) ? form.elements.unit.value : "month";
  await writeState((current) => {
    const item = current.managementItems.find((entry) => entry.id === itemId);
    if (!item) return;
    item.repeat = { interval, unit, basis: "completion" };
  });
  closePopover();
}

function wireEvents() {
  document.addEventListener("click", async (event) => {
    const tool = event.target.closest("[data-management-schedule-tool]");
    if (tool) {
      event.preventDefault();
      event.stopPropagation();
      const itemId = tool.dataset.itemId || "";
      const kind = tool.dataset.managementScheduleTool || "date";
      if (openItemId === itemId && openKind === kind && !$("#managementSchedulePopover")?.hidden) {
        closePopover();
      } else {
        try { await openPopover(tool, itemId, kind); }
        catch (error) { console.error("management schedule open failed", error); showToast("설정을 여는 중 오류가 났어요."); }
      }
      return;
    }

    if (event.target.closest("[data-management-schedule-close]")) {
      closePopover();
      return;
    }

    const dateClear = event.target.closest("[data-management-date-clear]");
    if (dateClear) {
      const form = dateClear.closest("[data-management-date-form]");
      const itemId = form?.dataset.itemId || "";
      await writeState((current) => {
        const item = current.managementItems.find((entry) => entry.id === itemId);
        if (!item) return;
        item.nextDate = "";
        item.nextTime = "";
      });
      closePopover();
      return;
    }

    const repeatClear = event.target.closest("[data-management-repeat-clear]");
    if (repeatClear) {
      const form = repeatClear.closest("[data-management-repeat-form]");
      const itemId = form?.dataset.itemId || "";
      await writeState((current) => {
        const item = current.managementItems.find((entry) => entry.id === itemId);
        if (item) item.repeat = null;
      });
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

  document.addEventListener("submit", async (event) => {
    const dateForm = event.target.closest("[data-management-date-form]");
    if (dateForm) {
      event.preventDefault();
      try { await saveDate(dateForm); }
      catch (error) { console.error("management date save failed", error); showToast("날짜 저장 중 오류가 났어요."); }
      return;
    }
    const repeatForm = event.target.closest("[data-management-repeat-form]");
    if (repeatForm) {
      event.preventDefault();
      try { await saveRepeat(repeatForm); }
      catch (error) { console.error("management repeat save failed", error); showToast("반복 저장 중 오류가 났어요."); }
    }
  });

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
const observer = new MutationObserver(() => scheduleRender(30));
observer.observe(document.body, { childList: true, subtree: true });
document.addEventListener("onekan:state-changed", (event) => {
  if (event.detail?.source !== "management-schedule") scheduleRender(60);
});
supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  if (user) scheduleRender(100);
});
scheduleRender(120);
