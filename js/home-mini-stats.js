import { supabase } from "./supabase.js";

const TARGET_ACTIVITY = "치즈 사냥놀이";
const MAX_PROJECT_ROWS = 3;
let refreshTimer = 0;

function pad(value) {
  return String(value).padStart(2, "0");
}

function appDayKey(date = new Date()) {
  const shifted = new Date(date);
  shifted.setHours(shifted.getHours() - 3);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

function label(item, fallback = "이름 없음") {
  return String(item?.title || item?.name || item?.text || fallback).trim();
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
  const minutes = Math.max(0, Math.floor(Number(milliseconds || 0) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}시간 ${rest}분`;
  if (hours) return `${hours}시간`;
  return `${minutes}분`;
}

function arraysFromState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    sessions: Array.isArray(state.sessions) ? state.sessions : [],
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    habits: Array.isArray(state.habitTemplates) ? state.habitTemplates : [],
    projects: Array.isArray(state.projects) ? state.projects : [],
  };
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

function todaySessions(state) {
  const today = appDayKey();
  return state.sessions.filter((session) => {
    const stamp = session?.end || session?.start;
    if (!stamp) return false;
    const date = new Date(stamp);
    return Number.isFinite(+date) && appDayKey(date) === today;
  });
}

function buildStats(raw) {
  const state = arraysFromState(raw);
  const sessions = todaySessions(state);
  let activityTotal = 0;
  let unlinkedTotal = 0;
  const projectTotals = new Map();

  for (const session of sessions) {
    const source = sessionSource(state, session);
    const sourceTitle = label(source, "");
    const sessionTitle = label(session, "");
    const duration = durationMs(session);

    if (sourceTitle === TARGET_ACTIVITY || sessionTitle === TARGET_ACTIVITY || sourceTitle.includes(TARGET_ACTIVITY) || sessionTitle.includes(TARGET_ACTIVITY)) {
      activityTotal += duration;
    }

    const projectId = session?.projectId || source?.projectId || null;
    const project = projectId
      ? state.projects.find((item) => String(item?.id) === String(projectId))
      : null;
    if (!project) {
      unlinkedTotal += duration;
      continue;
    }
    const key = String(project.id);
    const current = projectTotals.get(key) || { id: key, title: label(project, "이름 없는 프로젝트"), duration: 0 };
    current.duration += duration;
    projectTotals.set(key, current);
  }

  const projects = [...projectTotals.values()].sort((a, b) => b.duration - a.duration);
  const linkedTotal = projects.reduce((sum, item) => sum + item.duration, 0);
  const allTotal = sessions.reduce((sum, session) => sum + durationMs(session), 0);

  return { activityTotal, projects, linkedTotal, unlinkedTotal, allTotal };
}

function injectStyles() {
  if (document.getElementById("onekanHomeMiniStatsStyles")) return;
  const style = document.createElement("style");
  style.id = "onekanHomeMiniStatsStyles";
  style.textContent = `
    .uw-home-memo-card.uw-home-memo-with-stats{
      display:grid;
      grid-template-columns:minmax(0,1.35fr) minmax(280px,.85fr);
      grid-template-rows:auto 1fr;
      min-height:190px;
      overflow:hidden;
    }
    .uw-home-memo-with-stats>.uw-home-memo-header{
      grid-column:1;
      grid-row:1;
      min-width:0;
    }
    .uw-home-memo-with-stats>.uw-home-memo-body{
      grid-column:1;
      grid-row:2;
      min-width:0;
      overflow:hidden;
    }
    .uw-home-mini-stats{
      grid-column:2;
      grid-row:1 / span 2;
      min-width:0;
      width:100%;
      box-sizing:border-box;
      overflow:hidden;
      padding:16px 18px;
      border-left:1px solid var(--line,#e7e5e0);
      background:color-mix(in srgb,var(--uw-memo-card-color,#fff) 92%,#f7f8fa);
      color:var(--text,#2f3033);
    }
    .uw-home-mini-stats *{box-sizing:border-box;min-width:0}
    .uw-home-mini-kicker{
      color:var(--muted,#8a8d91);
      font-size:11px;
      font-weight:700;
      line-height:1.2;
    }
    .uw-home-mini-activity{
      display:grid;
      grid-template-columns:minmax(0,1fr) auto;
      gap:10px;
      align-items:end;
      margin-top:7px;
    }
    .uw-home-mini-activity-name{
      overflow:hidden;
      font-size:13px;
      font-weight:750;
      line-height:1.35;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .uw-home-mini-activity-value{
      flex:none;
      color:var(--accent-dark,var(--accent,#7893af));
      font-size:19px;
      font-weight:800;
      line-height:1;
      white-space:nowrap;
    }
    .uw-home-mini-divider{
      height:1px;
      margin:13px 0 11px;
      background:var(--line,#e7e5e0);
    }
    .uw-home-mini-section-head{
      display:flex;
      gap:10px;
      align-items:center;
      justify-content:space-between;
      width:100%;
      margin-bottom:8px;
      font-size:11px;
      line-height:1.3;
    }
    .uw-home-mini-section-head>span:first-child{
      overflow:hidden;
      font-weight:750;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .uw-home-mini-total{
      flex:none;
      color:var(--muted,#8a8d91);
      font-weight:650;
      white-space:nowrap;
    }
    .uw-home-mini-projects{
      display:grid;
      gap:7px;
      width:100%;
      overflow:hidden;
    }
    .uw-home-mini-project{
      display:grid;
      grid-template-columns:minmax(0,1fr) auto;
      gap:2px 10px;
      align-items:center;
      width:100%;
      overflow:hidden;
    }
    .uw-home-mini-project-name{
      overflow:hidden;
      font-size:11px;
      line-height:1.25;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .uw-home-mini-project-value{
      color:var(--muted,#8a8d91);
      font-size:10px;
      font-weight:700;
      line-height:1.25;
      white-space:nowrap;
    }
    .uw-home-mini-bar{
      grid-column:1 / -1;
      width:100%;
      height:5px;
      overflow:hidden;
      border-radius:999px;
      background:color-mix(in srgb,var(--line,#e7e5e0) 76%,transparent);
    }
    .uw-home-mini-bar>i{
      display:block;
      height:100%;
      max-width:100%;
      border-radius:inherit;
      background:var(--accent,#8fa9c4);
    }
    .uw-home-mini-empty,
    .uw-home-mini-unlinked{
      overflow:hidden;
      color:var(--muted,#8a8d91);
      font-size:10px;
      line-height:1.35;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .uw-home-mini-unlinked{margin-top:8px}
    #page-tracking .timer-mode-toggle,
    #page-tracking .timer-minute-controls{
      display:none!important;
    }
    @media(max-width:900px){
      .uw-home-memo-card.uw-home-memo-with-stats{
        grid-template-columns:minmax(0,1fr) minmax(250px,.9fr);
      }
    }
    @media(max-width:700px){
      .uw-home-memo-card.uw-home-memo-with-stats{
        display:grid;
        grid-template-columns:minmax(0,1fr);
        grid-template-rows:auto auto auto;
        min-height:0;
      }
      .uw-home-memo-with-stats>.uw-home-memo-header{grid-column:1;grid-row:1}
      .uw-home-memo-with-stats>.uw-home-memo-body{grid-column:1;grid-row:2}
      .uw-home-mini-stats{
        grid-column:1;
        grid-row:3;
        padding:13px 14px 15px;
        border-top:1px solid var(--line,#e7e5e0);
        border-left:0;
      }
    }
  `;
  document.head.appendChild(style);
}

function ensurePanel() {
  injectStyles();
  const card = document.getElementById("homeMemoCard");
  if (!card) return null;
  card.classList.add("uw-home-memo-with-stats");
  let panel = card.querySelector(".uw-home-mini-stats");
  if (panel) return panel;
  panel = document.createElement("aside");
  panel.className = "uw-home-mini-stats";
  panel.setAttribute("aria-label", "오늘 미니 통계");
  card.appendChild(panel);
  return panel;
}

function renderStats(raw) {
  const panel = ensurePanel();
  if (!panel) return;
  const stats = buildStats(raw);
  const rows = stats.projects.slice(0, MAX_PROJECT_ROWS);
  const projectMarkup = rows.length
    ? rows.map((project) => {
        const ratio = stats.linkedTotal > 0 ? Math.max(4, Math.min(100, project.duration / stats.linkedTotal * 100)) : 0;
        return `
          <div class="uw-home-mini-project" title="${project.title.replace(/"/g, "&quot;")}">
            <span class="uw-home-mini-project-name">${project.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>
            <span class="uw-home-mini-project-value">${formatDuration(project.duration)}</span>
            <span class="uw-home-mini-bar" aria-hidden="true"><i style="width:${ratio.toFixed(2)}%"></i></span>
          </div>`;
      }).join("")
    : '<div class="uw-home-mini-empty">아직 프로젝트에 연결된 시간 기록이 없어요.</div>';

  panel.innerHTML = `
    <div class="uw-home-mini-kicker">오늘</div>
    <div class="uw-home-mini-activity">
      <span class="uw-home-mini-activity-name">${TARGET_ACTIVITY}</span>
      <strong class="uw-home-mini-activity-value">${formatDuration(stats.activityTotal)}</strong>
    </div>
    <div class="uw-home-mini-divider"></div>
    <div class="uw-home-mini-section-head">
      <span>프로젝트별 시간</span>
      <span class="uw-home-mini-total">전체 ${formatDuration(stats.allTotal)}</span>
    </div>
    <div class="uw-home-mini-projects">${projectMarkup}</div>
    ${stats.unlinkedTotal > 0 ? `<div class="uw-home-mini-unlinked">프로젝트 미연결 ${formatDuration(stats.unlinkedTotal)}</div>` : ""}
  `;
}

async function refreshStats() {
  window.clearTimeout(refreshTimer);
  try {
    const { data: authData } = await supabase.auth.getSession();
    const user = authData?.session?.user;
    if (!user) {
      renderStats({});
      return;
    }
    const { data, error } = await supabase
      .from("onekan_state")
      .select("data")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    renderStats(data?.data || {});
  } catch (error) {
    console.warn("오늘 미니 통계를 불러오지 못했습니다.", error);
    renderStats({});
  }
}

function queueRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshStats, 90);
}

function enforceStopwatchOnly() {
  injectStyles();
  const stopwatch = document.querySelector('[data-timer-mode="stopwatch"]');
  const pomodoro = document.querySelector('[data-timer-mode="pomodoro"]');
  if (!stopwatch || !pomodoro) return;
  if (pomodoro.classList.contains("active") && !stopwatch.disabled) stopwatch.click();
}

function init() {
  ensurePanel();
  enforceStopwatchOnly();
  queueRefresh();
  document.addEventListener("onekan:state-changed", () => {
    enforceStopwatchOnly();
    queueRefresh();
  });
  supabase.auth.onAuthStateChange(() => {
    window.setTimeout(enforceStopwatchOnly, 0);
    queueRefresh();
  });
  window.setTimeout(enforceStopwatchOnly, 120);
  window.setTimeout(enforceStopwatchOnly, 500);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
