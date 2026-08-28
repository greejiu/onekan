import { supabase } from "./supabase.js";
import { confirmAction, showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(2, "0");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const VALID_UNITS = new Set(["day", "week", "month", "year"]);

let state = null;
let user = null;
let openItemId = null;
let renderTimer = null;
let rendering = false;
let pageObserver = null;

function dateKey(date = new Date()) {
  const value = new Date(date);
  value.setHours(value.getHours() - 3);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function nowTime() {
  const date = new Date();
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeRepeat(value) {
  if (!value || typeof value !== "object" || !VALID_UNITS.has(value.unit)) return null;
  return {
    interval: Math.max(1, Math.min(999, Number.parseInt(value.interval, 10) || 1)),
    unit: value.unit,
    basis: "completion",
  };
}

function normalizeState(raw) {
  const next = raw && typeof raw === "object" ? raw : {};
  next.managementItems = Array.isArray(next.managementItems) ? next.managementItems : [];
  next.managementHistory = Array.isArray(next.managementHistory) ? next.managementHistory : [];
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
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management-history" } }));
  scheduleRender(70);
  return true;
}

function ensureStyle() {
  if ($('link[data-onekan-management-history-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/management-history.css?v=2";
  link.dataset.onekanManagementHistoryStyle = "1";
  document.head.appendChild(link);
}

function ensurePopover() {
  if ($("#managementHistoryPopover")) return;
  const popover = document.createElement("div");
  popover.id = "managementHistoryPopover";
  popover.className = "management-history-popover";
  popover.hidden = true;
  document.body.appendChild(popover);
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function addRepeatDate(baseKey, repeatValue) {
  const repeat = normalizeRepeat(repeatValue);
  const parts = parseDate(baseKey);
  if (!repeat || !parts) return "";

  if (repeat.unit === "day" || repeat.unit === "week") {
    const date = new Date(parts.year, parts.month - 1, parts.day, 12);
    date.setDate(date.getDate() + repeat.interval * (repeat.unit === "week" ? 7 : 1));
    return dateKey(date);
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

function historySortValue(entry) {
  const date = entry?.completedDate || "";
  const time = /^\d{2}:\d{2}$/.test(entry?.completedTime || "") ? entry.completedTime : "12:00";
  return `${date}T${time}|${entry?.completedAt || ""}`;
}

function rowsFor(itemId, source = state) {
  return (source?.managementHistory || [])
    .filter((entry) => entry?.itemId === itemId && /^\d{4}-\d{2}-\d{2}$/.test(entry?.completedDate || ""))
    .sort((a, b) => historySortValue(a).localeCompare(historySortValue(b)));
}

function displayDate(value) {
  const parts = parseDate(value);
  if (!parts) return "";
  const currentYear = new Date().getFullYear();
  return `${parts.year === currentYear ? "" : `${parts.year}.`}${parts.month}.${parts.day}`;
}

function fullDisplayDate(value) {
  const parts = parseDate(value);
  if (!parts) return "";
  return `${parts.year}.${pad(parts.month)}.${pad(parts.day)}`;
}

function repeatSummary(value) {
  const repeat = normalizeRepeat(value);
  if (!repeat) return "";
  if (repeat.unit === "day") return `${repeat.interval}일마다`;
  if (repeat.unit === "week") return `${repeat.interval}주마다`;
  if (repeat.unit === "month") return repeat.interval === 1 ? "매월" : `${repeat.interval}개월마다`;
  return repeat.interval === 1 ? "매년" : `${repeat.interval}년마다`;
}

function dueSummary(value) {
  const targetParts = parseDate(value);
  const todayParts = parseDate(dateKey());
  if (!targetParts || !todayParts) return "";
  const target = new Date(targetParts.year, targetParts.month - 1, targetParts.day, 12);
  const today = new Date(todayParts.year, todayParts.month - 1, todayParts.day, 12);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "오늘";
  if (diff > 0) return `${diff}일 남음`;
  return `${Math.abs(diff)}일 지남`;
}

function relativeDate(value) {
  const parts = parseDate(value);
  if (!parts) return "";
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const target = new Date(parts.year, parts.month - 1, parts.day, 12);
  const diff = Math.round((today - target) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  if (diff > 1) return `${diff}일 전`;
  return "";
}

function summaryMarkup(item) {
  const latest = rowsFor(item.id).at(-1) || null;
  const parts = [];
  const repeat = repeatSummary(item.repeat);
  if (repeat) parts.push(repeat);
  parts.push(latest ? `마지막 완료 ${fullDisplayDate(latest.completedDate)}` : "아직 완료 기록 없음");
  if (item.nextDate) {
    parts.push(`다음 예정 ${fullDisplayDate(item.nextDate)}`);
    const due = dueSummary(item.nextDate);
    if (due) parts.push(due);
  }
  return `<button class="management-history-summary" data-management-history-open="${esc(item.id)}" type="button">${esc(parts.join(" · "))}</button>`;
}

function decorateItem(itemEl, item) {
  const latest = rowsFor(item.id).at(-1) || null;
  const signature = JSON.stringify([latest?.id || "", latest?.completedDate || "", latest?.completedTime || "", item.nextDate || "", normalizeRepeat(item.repeat)]);
  if (itemEl.dataset.managementHistorySignature === signature && itemEl.querySelector(".management-history-summary")) return;
  itemEl.querySelectorAll(".management-history-summary").forEach((node) => node.remove());
  itemEl.insertAdjacentHTML("beforeend", summaryMarkup(item));
  itemEl.dataset.managementHistorySignature = signature;
}

async function renderHistoryDecorations() {
  const page = $("#page-management");
  if (rendering || !page) return;
  rendering = true;
  try {
    await readState();
    if (!state) return;
    const byId = new Map(state.managementItems.map((item) => [item.id, item]));
    $$(".management-item[data-management-item-id]", page).forEach((itemEl) => {
      const item = byId.get(itemEl.dataset.managementItemId);
      if (item) decorateItem(itemEl, item);
    });
    if (openItemId && $("#managementHistoryPopover")?.hidden === false) renderPopover(openItemId);
  } catch (error) {
    console.error("management history render failed", error);
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 35) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderHistoryDecorations, delay);
}

function positionPopover(anchor, popover) {
  if (!anchor || !popover) return;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(360, innerWidth - 16);
  popover.style.width = `${width}px`;
  popover.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left))}px`;
  popover.style.top = `${Math.max(8, Math.min(innerHeight - 430, rect.bottom + 7))}px`;
}

function historyRowMarkup(entry) {
  const time = entry.completedTime ? ` ${entry.completedTime}` : "";
  return `<div class="management-history-row">
    <div><strong>${esc(displayDate(entry.completedDate))}</strong><span>${esc(time)}</span>${entry.scheduledDate && entry.scheduledDate !== entry.completedDate ? `<small>예정 ${esc(displayDate(entry.scheduledDate))}</small>` : ""}</div>
    <button class="management-history-delete" data-management-history-delete="${esc(entry.id)}" type="button" aria-label="기록 삭제">×</button>
  </div>`;
}

function renderPopover(itemId, anchor = null) {
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  const popover = $("#managementHistoryPopover");
  if (!item || !popover) return;
  const rows = rowsFor(itemId).slice(-8).reverse();
  const today = dateKey();
  const latest = rowsFor(itemId).at(-1) || null;
  popover.dataset.itemId = itemId;
  popover.innerHTML = `
    <div class="management-history-head">
      <div><strong>${esc(item.title)}</strong><small>${latest ? `마지막 ${esc(displayDate(latest.completedDate))}${relativeDate(latest.completedDate) ? ` · ${esc(relativeDate(latest.completedDate))}` : ""}` : "아직 기록이 없어요."}</small></div>
      <button data-management-history-close type="button" aria-label="닫기">×</button>
    </div>
    <button class="primary-btn management-history-now" data-management-history-now="${esc(itemId)}" type="button">지금 기록</button>
    <form class="management-history-add-form" data-management-history-form="${esc(itemId)}">
      <label><span>한 날짜</span><input name="date" type="date" value="${today}" max="${today}" required></label>
      <label><span>시간 <small>선택</small></span><input name="time" type="time" value="${nowTime()}"></label>
      <button class="soft-btn" type="submit">날짜로 기록</button>
    </form>
    <div class="management-history-list-head"><strong>최근 기록</strong><span>${rowsFor(itemId).length ? `${rowsFor(itemId).length}회` : ""}</span></div>
    <div class="management-history-list">${rows.length ? rows.map(historyRowMarkup).join("") : '<div class="management-history-empty">기록하면 여기에 날짜가 쌓여요.</div>'}</div>`;
  popover.hidden = false;
  const target = anchor || $(`[data-management-history-open="${CSS.escape(itemId)}"]`);
  positionPopover(target, popover);
}

function closePopover() {
  const popover = $("#managementHistoryPopover");
  if (popover) popover.hidden = true;
  openItemId = null;
}

function recomputeItemFromLatest(current, item, deletedEntry = null) {
  const rows = rowsFor(item.id, current);
  const latest = rows.at(-1) || null;
  const repeat = normalizeRepeat(item.repeat);

  if (latest) {
    item.lastCompletedAt = latest.completedAt || null;
    item.nextDate = repeat ? addRepeatDate(latest.completedDate, repeat) : "";
    if (!repeat) item.nextTime = "";
    return;
  }

  item.lastCompletedAt = null;
  item.nextDate = deletedEntry?.previousNextDate || "";
  item.nextTime = item.nextDate ? (deletedEntry?.previousNextTime || item.nextTime || "") : "";
}

function addHistoryRecord(current, itemId, completedDate, completedTime) {
  current.managementHistory = Array.isArray(current.managementHistory) ? current.managementHistory : [];
  const item = current.managementItems.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, reason: "missing" };
  if (current.managementHistory.some((entry) => entry.itemId === itemId && entry.completedDate === completedDate)) {
    return { ok: false, reason: "duplicate" };
  }

  const previousNextDate = item.nextDate || "";
  const previousNextTime = item.nextTime || "";
  const repeat = normalizeRepeat(item.repeat);
  const nextDateAfter = repeat ? addRepeatDate(completedDate, repeat) : "";
  const nextTimeAfter = repeat ? previousNextTime : "";
  const safeTime = /^\d{2}:\d{2}$/.test(completedTime || "") ? completedTime : "";
  const stamp = new Date(`${completedDate}T${safeTime || "12:00"}:00`);

  current.managementHistory.push({
    id: `management-history-${crypto.randomUUID()}`,
    itemId,
    title: item.title,
    completedAt: Number.isNaN(stamp.getTime()) ? new Date().toISOString() : stamp.toISOString(),
    completedDate,
    completedTime: safeTime,
    scheduledDate: previousNextDate,
    scheduledTime: previousNextTime,
    previousNextDate,
    previousNextTime,
    nextDateAfter,
    nextTimeAfter,
    source: "management",
  });

  recomputeItemFromLatest(current, item);
  return { ok: true };
}

async function createRecord(itemId, completedDate, completedTime) {
  if (!itemId || !completedDate) return;
  let result = { ok: false, reason: "missing" };
  await writeState((current) => {
    result = addHistoryRecord(current, itemId, completedDate, completedTime);
  });
  if (!result.ok && result.reason === "duplicate") {
    showToast("그 날짜에는 이미 기록이 있어요.");
    return;
  }
  if (result.ok) showToast("관리 기록을 남겼어요.");
}

async function deleteRecord(historyId) {
  const entry = state?.managementHistory.find((row) => row.id === historyId);
  if (!entry) return;
  const confirmed = await confirmAction({
    title: "이 관리 기록을 삭제할까요?",
    message: `${displayDate(entry.completedDate)} 기록을 삭제하고 다음 예정일을 다시 계산해요.`,
    confirmLabel: "기록 삭제",
  });
  if (!confirmed) return;

  await writeState((current) => {
    const target = current.managementHistory.find((row) => row.id === historyId);
    if (!target) return;
    current.managementHistory = current.managementHistory.filter((row) => row.id !== historyId);
    const item = current.managementItems.find((row) => row.id === target.itemId);
    if (item) recomputeItemFromLatest(current, item, target);
  });
  showToast("관리 기록을 삭제했어요.");
}

function wireEvents() {
  document.addEventListener("click", async (event) => {
    const open = event.target.closest?.("[data-management-history-open]");
    if (open) {
      event.preventDefault();
      event.stopPropagation();
      const itemId = open.dataset.managementHistoryOpen || "";
      if (openItemId === itemId && $("#managementHistoryPopover")?.hidden === false) {
        closePopover();
        return;
      }
      try {
        await readState();
        openItemId = itemId;
        renderPopover(itemId, open);
      } catch (error) {
        console.error("management history open failed", error);
      }
      return;
    }

    if (event.target.closest?.("[data-management-history-close]")) {
      closePopover();
      return;
    }

    const now = event.target.closest?.("[data-management-history-now]");
    if (now) {
      event.preventDefault();
      try {
        await createRecord(now.dataset.managementHistoryNow || "", dateKey(), nowTime());
      } catch (error) {
        console.error("management history save failed", error);
        showToast("관리 기록 저장 중 오류가 났어요.");
      }
      return;
    }

    const remove = event.target.closest?.("[data-management-history-delete]");
    if (remove) {
      event.preventDefault();
      try {
        await deleteRecord(remove.dataset.managementHistoryDelete || "");
      } catch (error) {
        console.error("management history delete failed", error);
        showToast("관리 기록 삭제 중 오류가 났어요.");
      }
      return;
    }

    const popover = $("#managementHistoryPopover");
    if (popover && !popover.hidden && !event.target.closest?.("#managementHistoryPopover")) closePopover();
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest?.("[data-management-history-form]");
    if (!form) return;
    event.preventDefault();
    const itemId = form.dataset.managementHistoryForm || "";
    const completedDate = form.elements.date?.value || "";
    const completedTime = form.elements.time?.value || "";
    if (!completedDate) return;
    if (completedDate > dateKey()) {
      showToast("미래 날짜는 실행 기록으로 남길 수 없어요.");
      return;
    }
    try {
      await createRecord(itemId, completedDate, completedTime);
    } catch (error) {
      console.error("management history backdate failed", error);
      showToast("관리 기록 저장 중 오류가 났어요.");
    }
  });

  window.addEventListener("resize", () => {
    if (!openItemId || $("#managementHistoryPopover")?.hidden !== false) return;
    const anchor = $(`[data-management-history-open="${CSS.escape(openItemId)}"]`);
    positionPopover(anchor, $("#managementHistoryPopover"));
  }, { passive: true });
}

function attachPageObserver() {
  const page = $("#page-management");
  if (!page) {
    setTimeout(attachPageObserver, 120);
    return;
  }
  if (!pageObserver) {
    pageObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" && !mutation.target.closest?.(".management-history-popover"))) scheduleRender(25);
    });
    pageObserver.observe(page, { childList: true, subtree: true });
  }
  scheduleRender(20);
}

ensureStyle();
ensurePopover();
wireEvents();
attachPageObserver();
document.addEventListener("onekan:state-changed", (event) => {
  if (event.detail?.source !== "management-history") scheduleRender(55);
});
supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  if (user) scheduleRender(100);
});
