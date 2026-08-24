import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const pad = (n) => String(n).padStart(2, "0");
let historyObserver = null;
let historyTimer = null;
let renderingHistory = false;

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayDate(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return date;
}

function appDayKey(now = new Date()) {
  return localDateKey(appDayDate(now));
}

function relativeAppDayKey(offset = 0) {
  const date = appDayDate();
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function minuteText(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fmtDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}시간 ${minutes}분`;
  if (hours) return `${hours}시간`;
  return `${minutes}분`;
}

function logicalSessionKey(session) {
  const raw = session?.end || session?.start;
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  return appDayKey(date);
}

function groupLabel(key) {
  if (key === relativeAppDayKey(0)) return "오늘";
  if (key === relativeAppDayKey(-1)) return "어제";
  const [year, month, day] = key.split("-").map(Number);
  return `${year}/${month}/${day}`;
}

function defaultTimes() {
  const end = new Date();
  end.setSeconds(0, 0);
  end.setMinutes(Math.ceil(end.getMinutes() / 5) * 5);
  const start = new Date(end.getTime() - 30 * 60 * 1000);
  return { start: minuteText(start), end: minuteText(end) };
}

async function readSessions() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.data?.sessions) ? data.data.sessions : [];
}

async function addSession({ title, date, startTime, endTime }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("로그인이 필요합니다.");

  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error("시간을 확인해 주세요.");
  if (end <= start) throw new Error("종료 시간은 시작 시간보다 뒤여야 해요.");

  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;

  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  state.sessions.push({
    id: crypto.randomUUID(),
    taskId: null,
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    durationMs: end.getTime() - start.getTime(),
    manual: true,
  });

  const { error: saveError } = await supabase
    .from("onekan_state")
    .upsert({ user_id: session.user.id, data: state }, { onConflict: "user_id" });
  if (saveError) throw saveError;

  $("#reloadCloudBtn")?.click();
  scheduleHistoryRender();
}

function ensureDialog() {
  if ($("#manualTimeEntryDialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "manualTimeEntryDialog";
  dialog.className = "app-dialog";
  dialog.innerHTML = `
    <form method="dialog" id="manualTimeEntryForm">
      <h3>시간 기록 추가</h3>
      <div class="field"><label>기록명</label><input id="manualTimeTitle" placeholder="무엇을 했나요?" required /></div>
      <div class="field"><label>날짜</label><input id="manualTimeDate" type="date" required /></div>
      <div class="field"><label>시작</label><input id="manualTimeStart" type="time" required /></div>
      <div class="field"><label>종료</label><input id="manualTimeEnd" type="time" required /></div>
      <div class="dialog-actions"><button class="soft-btn" id="manualTimeCancel" type="button">취소</button><button class="primary-btn" type="submit">기록 추가</button></div>
    </form>`;
  document.body.appendChild(dialog);

  $("#manualTimeCancel", dialog).addEventListener("click", () => dialog.close());
  $("#manualTimeEntryForm", dialog).addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#manualTimeTitle", dialog).value.trim();
    const date = $("#manualTimeDate", dialog).value;
    const startTime = $("#manualTimeStart", dialog).value;
    const endTime = $("#manualTimeEnd", dialog).value;
    if (!title || !date || !startTime || !endTime) return;

    const submit = dialog.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await addSession({ title, date, startTime, endTime });
      dialog.close();
    } catch (error) {
      console.error(error);
      window.alert(error?.message || "기록을 추가하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      submit.disabled = false;
    }
  });
}

function openDialog() {
  ensureDialog();
  const dialog = $("#manualTimeEntryDialog");
  const times = defaultTimes();
  $("#manualTimeTitle", dialog).value = "";
  $("#manualTimeDate", dialog).value = appDayKey();
  $("#manualTimeStart", dialog).value = times.start;
  $("#manualTimeEnd", dialog).value = times.end;
  dialog.showModal();
  setTimeout(() => $("#manualTimeTitle", dialog)?.focus(), 0);
}

function injectStyle() {
  if ($("#trackingHistoryStyles")) return;
  const style = document.createElement("style");
  style.id = "trackingHistoryStyles";
  style.textContent = `
    #page-tracking .timer-panel{grid-template-columns:minmax(0,1fr)!important}
    #page-tracking .tracking-today-card-hidden{display:none!important}
    #page-tracking .tracking-history-card .card-header{align-items:center}
    #page-tracking .tracking-history-group{padding:4px 0 14px}
    #page-tracking .tracking-history-group + .tracking-history-group{border-top:1px solid var(--line);padding-top:16px}
    #page-tracking .tracking-history-date{font-size:13px;font-weight:700;color:var(--text);margin:0 0 7px}
    #page-tracking .tracking-history-group .history-row{padding:9px 2px}
    #page-tracking .tracking-history-group .history-row + .history-row{border-top:1px solid var(--line)}
  `;
  document.head.appendChild(style);
}

function simplifyTrackingLayout() {
  const todayBody = $("#todaySessions");
  const todayCard = todayBody?.closest(".card");
  if (todayCard) todayCard.classList.add("tracking-today-card-hidden");

  $("#addTodayTimeRecordBtn")?.remove();

  const allBody = $("#allSessions");
  const allCard = allBody?.closest(".card");
  if (allCard) allCard.classList.add("tracking-history-card");

  const allHeader = allCard?.querySelector(".card-header");
  if (allHeader && !$("#addPastTimeRecordBtn")) {
    const existingMeta = allHeader.querySelector(".card-meta");
    const actions = document.createElement("div");
    actions.className = "header-inline";
    if (existingMeta) actions.appendChild(existingMeta);
    const button = document.createElement("button");
    button.id = "addPastTimeRecordBtn";
    button.className = "ghost-btn";
    button.type = "button";
    button.textContent = "+ 기록 추가";
    button.addEventListener("click", openDialog);
    actions.appendChild(button);
    allHeader.appendChild(actions);
  }
}

async function renderGroupedHistory() {
  const container = $("#allSessions");
  if (!container || renderingHistory) return;
  renderingHistory = true;
  try {
    const sessions = (await readSessions())
      .filter((session) => session?.end || session?.start)
      .sort((a, b) => new Date(b.end || b.start) - new Date(a.end || a.start));

    if (!sessions.length) {
      container.innerHTML = '<div class="empty">아직 기록이 없어요.</div>';
      return;
    }

    const groups = new Map();
    for (const session of sessions) {
      const key = logicalSessionKey(session);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(session);
    }

    container.innerHTML = [...groups.entries()].map(([key, items]) => `
      <section class="tracking-history-group" data-history-date="${key}">
        <div class="tracking-history-date">${groupLabel(key)}</div>
        ${items.map((session) => {
          const end = new Date(session.end || session.start);
          const time = Number.isFinite(end.getTime()) ? minuteText(end) : "";
          return `<div class="history-row" data-context-kind="session" data-context-id="${session.id}"><div><div class="history-name">${String(session.title || "기록").replace(/[&<>\"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#039;"}[char]))}</div><div class="history-meta">${time}</div></div><div class="history-time">${fmtDuration(session.durationMs)}</div></div>`;
        }).join("")}
      </section>`).join("");
  } catch (error) {
    console.error("시간 기록 그룹화 실패", error);
  } finally {
    renderingHistory = false;
  }
}

function scheduleHistoryRender() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    simplifyTrackingLayout();
    renderGroupedHistory();
  }, 90);
}

function observeHistory() {
  if (historyObserver) return;
  const container = $("#allSessions");
  if (!container) return;
  historyObserver = new MutationObserver(() => {
    if (!renderingHistory) scheduleHistoryRender();
  });
  historyObserver.observe(container, { childList: true, subtree: true });
}

function init() {
  ensureDialog();
  injectStyle();
  simplifyTrackingLayout();
  observeHistory();
  scheduleHistoryRender();
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
