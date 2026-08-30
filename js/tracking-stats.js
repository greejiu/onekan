import { supabase } from "./supabase.js";

const GROUP_LABELS = {
  project: "프로젝트",
  item: "할일·습관",
  area: "영역",
};

const PERIOD_LABELS = {
  today: "오늘",
  week: "이번 주",
  month: "이번 달",
};

const viewState = {
  home: { group: "project", period: "today" },
  tracking: { group: "project", period: "today" },
};

let refreshTimer = 0;
let latestRawState = null;

const pad = (value) => String(value).padStart(2, "0");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
}[character]));

function appDate(value = new Date()) {
  const date = new Date(value);
  date.setHours(date.getHours() - 3);
  return date;
}

function dateKey(value = new Date()) {
  const date = appDate(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizedState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    sessions: Array.isArray(state.sessions) ? state.sessions : [],
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    habits: Array.isArray(state.habitTemplates) ? state.habitTemplates : [],
    projects: Array.isArray(state.projects) ? state.projects : [],
    groups: Array.isArray(state.eventGroups) ? state.eventGroups : [],
  };
}

function durationMs(session) {
  const stored = Number(session?.durationMs || 0);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const start = new Date(session?.start || 0);
  const end = new Date(session?.end || 0);
  const calculated = end - start;
  return Number.isFinite(calculated) && calculated > 0 ? calculated : 0;
}

function formatDuration(milliseconds) {
  const rawMinutes = Number(milliseconds || 0) / 60000;
  if (milliseconds > 0 && rawMinutes < 1) return "<1분";
  const minutes = Math.max(0, Math.floor(rawMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}시간 ${rest}분`;
  if (hours) return `${hours}시간`;
  return `${minutes}분`;
}

function sessionSource(state, session) {
  if (session?.taskId) {
    const task = state.tasks.find((item) => String(item?.id) === String(session.taskId));
    if (task) return task;
  }
  if (session?.habitId) {
    const habit = state.habits.find((item) => String(item?.id) === String(session.habitId));
    if (habit) return habit;
  }
  return null;
}

function inPeriod(session, period) {
  const stamp = session?.start || session?.end;
  if (!stamp) return false;
  const sessionDate = appDate(stamp);
  if (Number.isNaN(sessionDate.getTime())) return false;
  const now = appDate(new Date());

  if (period === "today") return dateKey(stamp) === dateKey(new Date());

  if (period === "month") {
    return sessionDate.getFullYear() === now.getFullYear() && sessionDate.getMonth() === now.getMonth();
  }

  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return sessionDate >= monday && sessionDate < nextMonday;
}

function projectLabel(state, session, source) {
  const projectId = session?.projectId || source?.projectId || null;
  if (!projectId) return "프로젝트 미연결";
  const project = state.projects.find((item) => String(item?.id) === String(projectId));
  return String(project?.title || project?.name || "이름 없는 프로젝트").trim();
}

function itemLabel(session, source) {
  const title = String(source?.title || source?.name || session?.title || "직접 기록").trim();
  return title || "직접 기록";
}

function areaLabel(state, session, source) {
  const groupId = session?.groupId || source?.groupId || null;
  if (!groupId) return "영역 없음";
  const group = state.groups.find((item) => String(item?.id) === String(groupId));
  return String(group?.name || "영역 없음").trim();
}

function aggregate(raw, groupMode, period) {
  const state = normalizedState(raw);
  const totals = new Map();
  let total = 0;

  for (const session of state.sessions) {
    if (!inPeriod(session, period)) continue;
    const duration = durationMs(session);
    if (duration <= 0) continue;
    const source = sessionSource(state, session);
    let name = "";
    if (groupMode === "project") name = projectLabel(state, session, source);
    else if (groupMode === "area") name = areaLabel(state, session, source);
    else name = itemLabel(session, source);

    const key = name || "이름 없음";
    totals.set(key, (totals.get(key) || 0) + duration);
    total += duration;
  }

  const rows = [...totals.entries()]
    .map(([name, duration]) => ({ name, duration }))
    .sort((a, b) => b.duration - a.duration || a.name.localeCompare(b.name, "ko"));

  return { rows, total };
}

function groupButtons(context) {
  return `
    <div class="uw-stats-seg" aria-label="통계 기준">
      ${Object.entries(GROUP_LABELS).map(([value, label]) => `
        <button type="button" data-onekan-stats-group="${value}" data-stats-context="${context}" class="${viewState[context].group === value ? "active" : ""}" aria-pressed="${viewState[context].group === value}">${label}</button>
      `).join("")}
    </div>`;
}

function periodButtons(context) {
  return `
    <div class="uw-stats-seg" aria-label="통계 기간">
      ${Object.entries(PERIOD_LABELS).map(([value, label]) => `
        <button type="button" data-onekan-stats-period="${value}" data-stats-context="${context}" class="${viewState[context].period === value ? "active" : ""}" aria-pressed="${viewState[context].period === value}">${label}</button>
      `).join("")}
    </div>`;
}

function rowsMarkup(rows, total, limit = Infinity) {
  const visible = rows.slice(0, limit);
  if (!visible.length) return '<div class="uw-stats-empty">이 기간에는 아직 시간 기록이 없어요.</div>';

  return visible.map((row) => {
    const ratio = total > 0 ? Math.max(3, Math.min(100, row.duration / total * 100)) : 0;
    return `
      <div class="uw-stat-row" title="${esc(row.name)} · ${esc(formatDuration(row.duration))}">
        <span class="uw-stat-name">${esc(row.name)}</span>
        <span class="uw-stat-duration">${esc(formatDuration(row.duration))}</span>
        <span class="uw-stat-bar" aria-hidden="true"><i style="width:${ratio.toFixed(2)}%"></i></span>
      </div>`;
  }).join("");
}

function ensureHomePanel() {
  const card = document.getElementById("homeMemoCard");
  if (!card) return null;
  card.classList.add("uw-home-stats-ready");
  let panel = card.querySelector(".uw-home-mini-stats");
  if (!panel) {
    panel = document.createElement("aside");
    panel.className = "uw-home-mini-stats";
    panel.setAttribute("aria-label", "오늘 시간 통계");
    card.appendChild(panel);
  }

  const editor = card.querySelector(".uw-home-memo-editor");
  if (editor && !card.dataset.statsFocusBound) {
    card.dataset.statsFocusBound = "1";
    const syncFocusClass = () => card.classList.toggle("uw-memo-editor-focused", document.activeElement === editor);
    editor.addEventListener("focus", syncFocusClass);
    editor.addEventListener("blur", () => requestAnimationFrame(syncFocusClass));
    syncFocusClass();
  }
  return panel;
}

function ensureTrackingPanel() {
  const page = document.getElementById("page-tracking");
  const timerPanel = page?.querySelector(".timer-panel");
  if (!page || !timerPanel) return null;
  let card = page.querySelector(".uw-tracking-stats-card");
  if (card) return card;

  card = document.createElement("article");
  card.className = "card uw-tracking-stats-card";
  const gap = page.querySelector(".section-gap");
  if (gap) page.insertBefore(card, gap);
  else timerPanel.insertAdjacentElement("afterend", card);
  return card;
}

function renderHome(raw) {
  const panel = ensureHomePanel();
  if (!panel) return;
  const { group, period } = viewState.home;
  const stats = aggregate(raw, group, period);
  panel.innerHTML = `
    <div class="uw-stats-head">
      <span class="uw-stats-title">오늘 시간 통계</span>
      <span class="uw-stats-total">총 ${esc(formatDuration(stats.total))}</span>
    </div>
    <div class="uw-stats-controls">${groupButtons("home")}</div>
    <div class="uw-stats-list">${rowsMarkup(stats.rows, stats.total, 4)}</div>
  `;
}

function renderTracking(raw) {
  const card = ensureTrackingPanel();
  if (!card) return;
  const { group, period } = viewState.tracking;
  const stats = aggregate(raw, group, period);
  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">기록 통계</div>
      <div class="card-meta">${esc(PERIOD_LABELS[period])} · 총 ${esc(formatDuration(stats.total))}</div>
    </div>
    <div class="card-body">
      <div class="uw-tracking-stats-toolbar">
        <div class="uw-stats-controls">${periodButtons("tracking")}</div>
        <div class="uw-stats-controls">${groupButtons("tracking")}</div>
      </div>
      <div class="uw-stats-list">${rowsMarkup(stats.rows, stats.total)}</div>
    </div>
  `;
}

function renderAll(raw = latestRawState || {}) {
  latestRawState = raw || {};
  renderHome(latestRawState);
  renderTracking(latestRawState);
}

async function refresh() {
  window.clearTimeout(refreshTimer);
  try {
    const { data: authData } = await supabase.auth.getSession();
    const user = authData?.session?.user;
    if (!user) {
      renderAll({});
      return;
    }
    const { data, error } = await supabase
      .from("onekan_state")
      .select("data")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    renderAll(data?.data || {});
  } catch (error) {
    console.warn("시간 통계를 불러오지 못했습니다.", error);
    renderAll({});
  }
}

function queueRefresh(delay = 80) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refresh, delay);
}

document.addEventListener("click", (event) => {
  const groupButton = event.target.closest("[data-onekan-stats-group]");
  if (groupButton) {
    const context = groupButton.dataset.statsContext;
    const value = groupButton.dataset.onekanStatsGroup;
    if (viewState[context] && GROUP_LABELS[value]) {
      viewState[context].group = value;
      renderAll();
    }
    return;
  }

  const periodButton = event.target.closest("[data-onekan-stats-period]");
  if (periodButton) {
    const context = periodButton.dataset.statsContext;
    const value = periodButton.dataset.onekanStatsPeriod;
    if (viewState[context] && PERIOD_LABELS[value]) {
      viewState[context].period = value;
      renderAll();
    }
  }
});

document.addEventListener("onekan:state-changed", () => queueRefresh());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") queueRefresh(0);
});

supabase.auth.onAuthStateChange(() => queueRefresh(0));

function init() {
  ensureHomePanel();
  ensureTrackingPanel();
  queueRefresh(0);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
