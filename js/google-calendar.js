import { supabase } from "./supabase.js?v=1";
import { confirmAction, showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const pad = (value) => String(value).padStart(2, "0");
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromKey = (value) => new Date(`${value}T12:00:00`);
const addDays = (date, amount) => { const next = new Date(date); next.setDate(next.getDate() + amount); return next; };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

let initialized = false;
let connected = false;
let loadingStatus = false;
let email = "";
let calendars = [];
let eventsByDate = new Map();
let coveredRanges = [];
let pendingStart = "";
let pendingEnd = "";
let pendingTimer = null;

function eyeIcon(open) {
  return open
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.7"></circle></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a14 14 0 0 1-2.3 3M6.2 7.2C3.8 9 2.5 12 2.5 12s3.5 6 9.5 6a10 10 0 0 0 3.1-.5M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg>';
}

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(data?.error || error.message || "요청에 실패했어요.");
  if (data?.error) throw new Error(data.error);
  return data ?? {};
}

function dispatchChanged() {
  document.dispatchEvent(new CustomEvent("onekan:google-calendar-changed"));
}

function renderSettings(message = "") {
  const status = $("#googleCalendarStatus");
  const account = $("#googleCalendarAccount");
  const connect = $("#connectGoogleCalendar");
  const disconnect = $("#disconnectGoogleCalendar");
  const list = $("#googleCalendarList");
  if (!status || !account || !connect || !disconnect || !list) return;

  status.textContent = message || (loadingStatus ? "연결 상태 확인 중…" : connected ? "연결됨" : "연결되지 않음");
  status.classList.toggle("connected", connected);
  account.textContent = connected ? email : "각 사용자가 자신의 Google 계정을 연결할 수 있어요.";
  connect.hidden = connected;
  disconnect.hidden = !connected;
  list.hidden = !connected;
  list.innerHTML = calendars.map((calendar) => `
    <div class="google-calendar-row" data-google-calendar-id="${esc(calendar.id)}">
      <span class="google-calendar-color" style="--google-calendar-color:${esc(calendar.backgroundColor)}" aria-hidden="true"></span>
      <span class="google-calendar-name">${esc(calendar.summary)}${calendar.primary ? '<small>기본</small>' : ""}</span>
      <button class="google-calendar-eye" data-google-calendar-visible type="button" aria-pressed="${calendar.visible}" aria-label="${esc(calendar.summary)} ${calendar.visible ? "숨기기" : "표시하기"}" title="${calendar.visible ? "숨기기" : "표시하기"}">${eyeIcon(calendar.visible)}</button>
    </div>`).join("");
}

function clearEvents() {
  eventsByDate = new Map();
  coveredRanges = [];
  pendingStart = "";
  pendingEnd = "";
  clearTimeout(pendingTimer);
  pendingTimer = null;
}

function rangeCovered(start, end) {
  return coveredRanges.some((range) => range.start <= start && range.end >= end);
}

function normalizeExternalEvent(raw) {
  const allDay = Boolean(raw.allDay);
  let startDate;
  let endDate;
  let start;
  let end;
  if (allDay) {
    startDate = String(raw.start);
    const exclusiveEnd = String(raw.end || raw.start);
    endDate = dateKey(addDays(fromKey(exclusiveEnd), -1));
    if (endDate < startDate) endDate = startDate;
    start = new Date(`${startDate}T12:00:00`).toISOString();
    end = new Date(`${endDate}T12:00:00`).toISOString();
  } else {
    const startTime = new Date(String(raw.start));
    const endTime = new Date(String(raw.end || raw.start));
    if (Number.isNaN(startTime.getTime())) return null;
    startDate = dateKey(startTime);
    endDate = dateKey(new Date(Math.max(startTime.getTime(), endTime.getTime() - 1)));
    start = startTime.toISOString();
    end = Number.isNaN(endTime.getTime()) ? start : endTime.toISOString();
  }
  return {
    id: String(raw.id),
    title: String(raw.title || "제목 없는 일정"),
    description: String(raw.description || ""),
    location: String(raw.location || ""),
    allDay,
    start,
    end,
    startDate,
    endDate,
    source: "google",
    external: true,
    _externalGoogle: true,
    externalColor: /^#[0-9a-f]{6}$/i.test(String(raw.color || "")) ? String(raw.color) : "#7986cb",
    htmlLink: String(raw.htmlLink || ""),
    calendarId: String(raw.calendarId || ""),
    calendarName: String(raw.calendarName || "Google 캘린더"),
  };
}

function replaceRange(start, end, rawEvents) {
  for (let cursor = fromKey(start); dateKey(cursor) <= end; cursor = addDays(cursor, 1)) eventsByDate.delete(dateKey(cursor));
  for (const raw of rawEvents) {
    const event = normalizeExternalEvent(raw);
    if (!event) continue;
    for (let cursor = fromKey(event.startDate); dateKey(cursor) <= event.endDate; cursor = addDays(cursor, 1)) {
      const key = dateKey(cursor);
      if (key < start || key > end) continue;
      if (!eventsByDate.has(key)) eventsByDate.set(key, []);
      if (event.allDay) {
        eventsByDate.get(key).push(event);
      } else {
        const dayStart = new Date(`${key}T00:00:00`);
        const nextDay = addDays(dayStart, 1);
        const clippedStart = new Date(Math.max(new Date(event.start).getTime(), dayStart.getTime()));
        const clippedEnd = new Date(Math.min(new Date(event.end).getTime(), nextDay.getTime()));
        eventsByDate.get(key).push({ ...event, start: clippedStart.toISOString(), end: clippedEnd.toISOString() });
      }
    }
  }
  for (const rows of eventsByDate.values()) rows.sort((a, b) => Number(a.allDay) - Number(b.allDay) || new Date(a.start) - new Date(b.start));
  coveredRanges.push({ start, end });
}

async function fetchPendingRange() {
  pendingTimer = null;
  const start = pendingStart;
  const end = pendingEnd;
  pendingStart = "";
  pendingEnd = "";
  if (!connected || !start || !end || rangeCovered(start, end)) return;
  try {
    const timeMin = new Date(`${start}T00:00:00`).toISOString();
    const timeMax = new Date(`${dateKey(addDays(fromKey(end), 1))}T00:00:00`).toISOString();
    const payload = await invoke("google-calendar", { action: "events", timeMin, timeMax });
    replaceRange(start, end, payload.events ?? []);
    dispatchChanged();
  } catch (error) {
    console.error("Google 캘린더 일정 불러오기 실패", error);
    renderSettings("일정을 불러오지 못했어요.");
  }
}

export function ensureGoogleCalendarRange(start, end = start) {
  if (!connected || !start || !end || rangeCovered(start, end)) return;
  pendingStart = pendingStart && pendingStart < start ? pendingStart : start;
  pendingEnd = pendingEnd && pendingEnd > end ? pendingEnd : end;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(fetchPendingRange, 30);
}

export function googleCalendarEventsForDate(value) {
  return connected ? [...(eventsByDate.get(value) ?? [])] : [];
}

export function isGoogleCalendarEvent(item) {
  return Boolean(item?._externalGoogle || item?.source === "google");
}

async function loadStatus() {
  if (loadingStatus) return;
  loadingStatus = true;
  let statusMessage = "";
  renderSettings();
  try {
    const payload = await invoke("google-calendar", { action: "status" });
    connected = Boolean(payload.connected);
    email = String(payload.email || "");
    calendars = Array.isArray(payload.calendars) ? payload.calendars : [];
    if (connected) {
      const today = dateKey(new Date());
      ensureGoogleCalendarRange(today, dateKey(addDays(fromKey(today), 7)));
    }
    dispatchChanged();
  } catch (error) {
    connected = false;
    statusMessage = "Google 연동 기능을 준비 중이에요.";
    console.warn("Google 캘린더 상태 확인 실패", error);
  } finally {
    loadingStatus = false;
    renderSettings(statusMessage);
  }
}

function handleReturnMessage() {
  const url = new URL(location.href);
  const result = url.searchParams.get("google_calendar");
  if (!result) return;
  const detail = url.searchParams.get("google_calendar_message") || "";
  url.searchParams.delete("google_calendar");
  url.searchParams.delete("google_calendar_message");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  showToast(result === "connected" ? "Google 캘린더를 연결했어요." : detail || "Google 캘린더를 연결하지 못했어요.");
}

function wireSettings() {
  $("#connectGoogleCalendar")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Google로 이동 중…";
    try {
      const payload = await invoke("google-calendar-auth", { action: "start" });
      if (!payload.authUrl) throw new Error("Google 연결 주소를 받지 못했어요.");
      location.assign(payload.authUrl);
    } catch (error) {
      showToast(error.message || "Google 캘린더 연결을 시작하지 못했어요.");
      button.disabled = false;
      button.textContent = "Google 캘린더 연결";
    }
  });

  $("#disconnectGoogleCalendar")?.addEventListener("click", async (event) => {
    const confirmed = await confirmAction({
      title: "Google 캘린더 연결을 해제할까요?",
      message: "오늘한칸에서만 일정이 사라지고 Google 캘린더 원본은 그대로 남아요.",
    });
    if (!confirmed) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await invoke("google-calendar", { action: "disconnect" });
      connected = false;
      email = "";
      calendars = [];
      clearEvents();
      renderSettings();
      dispatchChanged();
      showToast("Google 캘린더 연결을 해제했어요.");
    } catch (error) {
      showToast(error.message || "연결을 해제하지 못했어요.");
    } finally {
      button.disabled = false;
    }
  });

  $("#googleCalendarList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-google-calendar-visible]");
    if (!button) return;
    const row = button.closest("[data-google-calendar-id]");
    const calendar = calendars.find((item) => item.id === row?.dataset.googleCalendarId);
    if (!calendar) return;
    button.disabled = true;
    try {
      const payload = await invoke("google-calendar", {
        action: "set-calendar-visibility",
        calendarId: calendar.id,
        visible: !calendar.visible,
      });
      calendars = payload.calendars ?? calendars;
      clearEvents();
      renderSettings();
      const today = dateKey(new Date());
      ensureGoogleCalendarRange(today, dateKey(addDays(fromKey(today), 7)));
      dispatchChanged();
    } catch (error) {
      showToast(error.message || "캘린더 표시 설정을 바꾸지 못했어요.");
      button.disabled = false;
    }
  });

  document.addEventListener("click", (event) => {
    const item = event.target.closest("[data-google-calendar-event]");
    if (!item) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const href = item.dataset.googleCalendarUrl;
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  }, true);
}

export async function initGoogleCalendar() {
  if (initialized) return;
  initialized = true;
  handleReturnMessage();
  wireSettings();
  await loadStatus();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT" || !session) {
    connected = false;
    email = "";
    calendars = [];
    clearEvents();
    renderSettings();
    dispatchChanged();
    return;
  }
  if (initialized && event === "SIGNED_IN") {
    clearEvents();
    loadStatus();
  }
});
