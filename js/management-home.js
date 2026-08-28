import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(2, "0");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const DEFAULT_MANAGEMENT_COLOR = "#c8b7dc";
const VALID_REPEAT_UNITS = new Set(["day", "week", "month", "year"]);

let state = null;
let user = null;
let renderTimer = null;
let rendering = false;

function appDateKey(date = new Date()) {
  const value = new Date(date);
  value.setHours(value.getHours() - 3);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function normalizeRepeat(value) {
  if (!value || typeof value !== "object" || !VALID_REPEAT_UNITS.has(value.unit)) return null;
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
  next.ui = next.ui && typeof next.ui === "object" ? next.ui : {};
  next.ui.timelineColors = next.ui.timelineColors && typeof next.ui.timelineColors === "object" ? next.ui.timelineColors : {};
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
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management-home" } }));
  scheduleRender(90);
  return true;
}

function managementColor() {
  const value = state?.ui?.timelineColors?.management;
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : DEFAULT_MANAGEMENT_COLOR;
}

function applyManagementColor() {
  document.documentElement.style.setProperty("--timeline-management-color", managementColor());
}

function ensureStyle() {
  if ($('link[data-onekan-management-home-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/management-home.css?v=1";
  link.dataset.onekanManagementHomeStyle = "1";
  document.head.appendChild(link);
}

function ensureColorSetting() {
  const wrap = $("#page-settings .timeline-color-settings");
  if (!wrap) return;
  let input = $("#timelineManagementColor", wrap);
  if (!input) {
    const label = document.createElement("label");
    label.dataset.managementColorSetting = "1";
    label.innerHTML = `<span>관리</span><input id="timelineManagementColor" type="color" value="${managementColor()}" />`;
    wrap.appendChild(label);
    input = $("#timelineManagementColor", label);
  }
  if (input && document.activeElement !== input) input.value = managementColor();
}

function parseDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function dateKeyFromParts(year, monthIndex, day) {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function addRepeatDate(baseKey, repeatValue) {
  const repeat = normalizeRepeat(repeatValue);
  const parts = parseDateKey(baseKey);
  if (!repeat || !parts) return "";

  if (repeat.unit === "day" || repeat.unit === "week") {
    const date = new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0);
    date.setDate(date.getDate() + repeat.interval * (repeat.unit === "week" ? 7 : 1));
    return dateKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate());
  }

  if (repeat.unit === "month") {
    const totalMonths = parts.year * 12 + (parts.month - 1) + repeat.interval;
    const targetYear = Math.floor(totalMonths / 12);
    const targetMonth = totalMonths % 12;
    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    return dateKeyFromParts(targetYear, targetMonth, Math.min(parts.day, lastDay));
  }

  const targetYear = parts.year + repeat.interval;
  const targetMonth = parts.month - 1;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return dateKeyFromParts(targetYear, targetMonth, Math.min(parts.day, lastDay));
}

function historyRowsFor(itemId) {
  return (state?.managementHistory || [])
    .filter((entry) => entry?.itemId === itemId && entry?.completedDate)
    .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")));
}

function historyForDate(itemId, date) {
  return historyRowsFor(itemId).filter((entry) => entry.completedDate === date).at(-1) || null;
}

function latestHistory(itemId) {
  return historyRowsFor(itemId).at(-1) || null;
}

function entryForDay(item, date) {
  const history = historyForDate(item.id, date);
  if (history) {
    const latest = latestHistory(item.id);
    return {
      item,
      done: true,
      history,
      canUndo: latest?.id === history.id,
      time: history.completedTime || history.scheduledTime || item.nextTime || "",
    };
  }

  if (!item.nextDate) return null;
  const today = appDateKey();
  const pending = item.nextDate === date || (date === today && item.nextDate < today);
  if (!pending) return null;
  return { item, done: false, history: null, canUndo: true, time: item.nextTime || "" };
}

function minuteFromTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function checkMarkup(entry, date) {
  const disabled = entry.done && !entry.canUndo;
  const title = disabled ? ' title="과거 기록은 관리 탭에서 수정할 수 있어요."' : "";
  return `<button class="uw-check management-home-check${entry.done ? " checked" : ""}" style="--uw-check-color:var(--timeline-management-color)" data-management-home-check data-item-id="${esc(entry.item.id)}" data-date="${esc(date)}" type="button"${disabled ? " disabled" : ""}${title}>${entry.done ? "✓" : ""}</button>`;
}

function listItemMarkup(entry, date, showTime = false) {
  const time = showTime && entry.time ? `<span class="uw-item-time">${esc(entry.time)}</span>` : "";
  return `<div class="uw-item uw-management management-home-item${entry.done ? " done" : ""}" data-management-home-item data-item-id="${esc(entry.item.id)}" data-date="${esc(date)}">${checkMarkup(entry, date)}<span class="uw-item-title">${esc(entry.item.title)}</span>${time}</div>`;
}

function timelineItemMarkup(entry, date, minute, startMinute) {
  const top = ((minute - startMinute) / 30) * 20 + 1;
  return `<div class="uw-time-entry uw-item uw-management management-home-item${entry.done ? " done" : ""}" style="top:${top}px;height:18px;left:1px;width:calc(100% - 2px);right:auto" data-management-home-item data-item-id="${esc(entry.item.id)}" data-date="${esc(date)}" data-time="${minute}" data-duration="30">${checkMarkup(entry, date)}<span class="uw-item-title">${esc(entry.item.title)}</span></div>`;
}

function findListBlock(day, minute) {
  for (const section of $$(".uw-time-block-v2-section[data-time-block-id]", day)) {
    const label = $(".uw-time-block-v2-head strong", section)?.textContent || "";
    const match = /(\d{2}):(\d{2})\s*[–-]\s*(\d{2}):(\d{2})/.exec(label);
    if (!match) continue;
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    if (minute >= start && minute < end) return $(".uw-time-block-v2-list", section);
  }
  return null;
}

function ensureOutsideList(day) {
  const existing = $(".uw-time-block-v2-section.outside-time .uw-list", day);
  if (existing) return existing;
  let section = $("[data-management-home-outside]", day);
  if (!section) {
    section = document.createElement("section");
    section.className = "uw-time-block-v2-section outside-time management-home-outside";
    section.dataset.managementHomeOutside = "1";
    section.innerHTML = '<div class="uw-time-block-v2-head"><strong>블럭 밖 시간</strong></div><div class="uw-list uw-time-block-v2-list"></div>';
    const firstBlock = $(".uw-time-block-v2-section[data-time-block-id]", day);
    if (firstBlock) firstBlock.before(section);
    else day.appendChild(section);
  }
  return $(".uw-list", section);
}

function removePlaceholders(target) {
  if (!target) return;
  $$(":scope > .uw-empty-hit, :scope > .uw-time-block-v2-empty", target).forEach((node) => node.remove());
}

function decorateListDay(day, entries, date) {
  const unassigned = $("[data-uw-time-block-unassigned]", day);
  for (const entry of entries) {
    const minute = minuteFromTime(entry.time);
    let target = null;
    if (minute === null) {
      target = unassigned;
    } else {
      target = findListBlock(day, minute) || ensureOutsideList(day);
    }
    if (!target) continue;
    removePlaceholders(target);
    target.insertAdjacentHTML("beforeend", listItemMarkup(entry, date, minute !== null));
  }
}

function decorateTimelineDay(day, entries, date) {
  const allDay = $(".uw-all-day-list", day);
  const exactLane = $(".uw-time-exact-lane", day);
  const startMinute = Number(state?.ui?.timelineRange?.start) || 360;
  const endMinute = Number(state?.ui?.timelineRange?.end) || 1320;

  for (const entry of entries) {
    const minute = minuteFromTime(entry.time);
    if (minute !== null && minute >= startMinute && minute < endMinute && exactLane) {
      exactLane.insertAdjacentHTML("beforeend", timelineItemMarkup(entry, date, minute, startMinute));
      continue;
    }
    if (!allDay) continue;
    removePlaceholders(allDay);
    allDay.insertAdjacentHTML("beforeend", listItemMarkup(entry, date, minute !== null));
  }
}

function signatureFor(entries) {
  return JSON.stringify(entries.map((entry) => [
    entry.item.id,
    entry.item.title,
    entry.item.nextDate || "",
    entry.item.nextTime || "",
    entry.done,
    entry.history?.id || "",
    entry.canUndo,
  ]));
}

async function renderHomeManagement() {
  if (rendering || !$("#page-home")) return;
  rendering = true;
  try {
    await readState();
    if (!state) return;
    applyManagementColor();
    ensureColorSetting();

    for (const day of $$("#page-home .home-timeline-card .uw-day[data-date]")) {
      const date = day.dataset.date || "";
      const entries = state.managementItems.map((item) => entryForDay(item, date)).filter(Boolean);
      const signature = signatureFor(entries);
      const existing = $$('[data-management-home-item]', day);
      if (day.dataset.managementHomeSignature === signature && (entries.length === 0 || existing.length === entries.length)) continue;

      existing.forEach((node) => node.remove());
      $$('[data-management-home-outside]', day).forEach((node) => node.remove());
      day.dataset.managementHomeSignature = signature;
      if (!entries.length) continue;

      if (day.classList.contains("uw-list-day")) decorateListDay(day, entries, date);
      else decorateTimelineDay(day, entries, date);
    }
  } catch (error) {
    console.error("management home render failed", error);
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 45) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderHomeManagement, delay);
}

async function toggleManagement(itemId, viewDate) {
  const actualDate = appDateKey();
  const now = new Date();
  const completedTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  let checked = false;

  await writeState((current) => {
    current.managementHistory = Array.isArray(current.managementHistory) ? current.managementHistory : [];
    const item = current.managementItems.find((entry) => entry.id === itemId);
    if (!item) return;

    const rows = current.managementHistory
      .filter((entry) => entry.itemId === itemId && entry.completedDate)
      .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")));
    const onViewDate = rows.filter((entry) => entry.completedDate === viewDate).at(-1) || null;

    if (onViewDate) {
      const latest = rows.at(-1);
      if (latest?.id !== onViewDate.id) return;
      current.managementHistory = current.managementHistory.filter((entry) => entry.id !== onViewDate.id);
      item.nextDate = onViewDate.previousNextDate || "";
      item.nextTime = onViewDate.previousNextTime || "";
      const remaining = current.managementHistory
        .filter((entry) => entry.itemId === itemId)
        .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")));
      item.lastCompletedAt = remaining.at(-1)?.completedAt || null;
      return;
    }

    checked = true;
    const repeat = normalizeRepeat(item.repeat);
    const previousNextDate = item.nextDate || "";
    const previousNextTime = item.nextTime || "";
    const nextDateAfter = repeat ? addRepeatDate(actualDate, repeat) : "";
    const nextTimeAfter = repeat ? previousNextTime : "";
    const historyId = `management-history-${crypto.randomUUID()}`;

    current.managementHistory.push({
      id: historyId,
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
    });

    item.lastCompletedAt = now.toISOString();
    item.nextDate = nextDateAfter;
    item.nextTime = nextTimeAfter;
  });

  if (checked && viewDate !== actualDate) showToast(`실행 기록은 실제 체크한 ${actualDate}로 저장했어요.`);
}

function wireEvents() {
  document.addEventListener("click", async (event) => {
    const check = event.target.closest("[data-management-home-check]");
    if (!check || check.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await toggleManagement(check.dataset.itemId || "", check.dataset.date || appDateKey());
    } catch (error) {
      console.error("management check failed", error);
      showToast("관리 기록을 저장하는 중 오류가 났어요.");
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target.id !== "timelineManagementColor") return;
    if (/^#[0-9a-f]{6}$/i.test(event.target.value)) {
      document.documentElement.style.setProperty("--timeline-management-color", event.target.value);
    }
  });

  document.addEventListener("change", async (event) => {
    if (event.target.id !== "timelineManagementColor") return;
    const color = event.target.value;
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    try {
      await writeState((current) => {
        current.ui ||= {};
        current.ui.timelineColors ||= {};
        current.ui.timelineColors.management = color;
      });
    } catch (error) {
      console.error("management color save failed", error);
      showToast("관리 체크 색상 저장 중 오류가 났어요.");
    }
  });
}

ensureStyle();
wireEvents();
const homeRoot = $("#page-home");
if (homeRoot) {
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === "childList" && !mutation.target.closest?.("[data-management-home-item]"))) scheduleRender(35);
  });
  observer.observe(homeRoot, { childList: true, subtree: true });
}
const settingsRoot = $("#page-settings");
if (settingsRoot) {
  const settingsObserver = new MutationObserver(() => ensureColorSetting());
  settingsObserver.observe(settingsRoot, { childList: true, subtree: true });
}
document.addEventListener("onekan:state-changed", (event) => {
  if (event.detail?.source !== "management-home") scheduleRender(80);
});
supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  if (user) scheduleRender(100);
});
scheduleRender(140);
