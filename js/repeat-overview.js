import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const pad = (value) => String(value).padStart(2, "0");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
const key = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromKey = (value) => new Date(`${value}T12:00:00`);
const addDays = (date, amount) => { const next = new Date(date); next.setDate(next.getDate() + amount); return next; };
const todayKey = () => { const date = new Date(); date.setHours(date.getHours() - 3); return key(date); };

let renderTimer = null;
let rendering = false;

function installStyle() {
  if ($("#repeatOverviewStyle")) return;
  const style = document.createElement("style");
  style.id = "repeatOverviewStyle";
  style.textContent = `
    .onekan-repeat-intro{margin:-8px 0 18px;color:var(--muted);font-size:12px;line-height:1.55}
    .onekan-repeat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}
    .onekan-repeat-card{overflow:hidden}
    .onekan-repeat-card .card-header{border-bottom:1px solid var(--line)}
    .onekan-repeat-count{display:inline-grid;place-items:center;min-width:24px;height:22px;padding:0 7px;border-radius:999px;background:var(--panel-soft);color:var(--muted);font-size:10px;font-weight:700}
    .onekan-repeat-list{display:grid;padding:4px 10px 10px}
    .onekan-repeat-row{--repeat-group:var(--accent);display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:9px;align-items:center;min-height:52px;padding:9px 6px;border-bottom:1px solid var(--line)}
    .onekan-repeat-row:last-child{border-bottom:0}
    .onekan-repeat-dot{width:8px;height:8px;border-radius:50%;background:var(--repeat-group)}
    .onekan-repeat-main{min-width:0;display:grid;gap:3px}
    .onekan-repeat-main strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
    .onekan-repeat-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--muted);font-size:10px}
    .onekan-repeat-meta .next{color:var(--accent-dark)}
    .onekan-repeat-kind{padding:3px 6px;border-radius:999px;background:var(--panel-soft);color:var(--muted);font-size:9px;white-space:nowrap}
    .onekan-repeat-empty{padding:22px 8px;color:var(--muted);font-size:11px;text-align:center}
    @media(max-width:1080px){.onekan-repeat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:760px){.onekan-repeat-grid{grid-template-columns:1fr}.onekan-repeat-row{min-height:56px}}
  `;
  document.head.appendChild(style);
}

function dayDistance(first, last) {
  const a = fromKey(first), b = fromKey(last);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

function occursOn(recurrence, baseDate, targetDate) {
  if (!recurrence?.frequency || recurrence.frequency === "none" || !baseDate || !targetDate) return false;
  if (targetDate < baseDate || (recurrence.until && targetDate > recurrence.until)) return false;
  const interval = Math.max(1, Number(recurrence.interval || 1));
  const diff = dayDistance(baseDate, targetDate);
  if (recurrence.frequency === "daily") return diff % interval === 0;
  const base = fromKey(baseDate), target = fromKey(targetDate);
  if (recurrence.frequency === "weekly") {
    const weekdays = Array.isArray(recurrence.weekdays) && recurrence.weekdays.length ? recurrence.weekdays : [base.getDay()];
    return Math.floor(diff / 7) % interval === 0 && weekdays.includes(target.getDay());
  }
  if (recurrence.frequency === "monthly") {
    const months = (target.getFullYear() - base.getFullYear()) * 12 + target.getMonth() - base.getMonth();
    const wanted = Math.min(Number(recurrence.dayOfMonth || base.getDate()), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
    return months >= 0 && months % interval === 0 && target.getDate() === wanted;
  }
  return false;
}

function recurrenceLabel(recurrence, baseDate = "") {
  const frequency = recurrence?.frequency;
  const interval = Math.max(1, Number(recurrence?.interval || 1));
  if (frequency === "daily") return interval === 1 ? "매일" : `${interval}일마다`;
  if (frequency === "weekly") {
    const baseDay = baseDate ? fromKey(baseDate).getDay() : null;
    const weekdays = Array.isArray(recurrence.weekdays) && recurrence.weekdays.length ? [...recurrence.weekdays].sort((a, b) => a - b) : baseDay === null ? [] : [baseDay];
    if (interval === 1 && weekdays.join(",") === "1,2,3,4,5") return "평일";
    const names = weekdays.map((day) => ["일", "월", "화", "수", "목", "금", "토"][day]).join("·");
    if (names) return interval === 1 ? `${names}요일` : `${interval}주마다 · ${names}요일`;
    return interval === 1 ? "매주" : `${interval}주마다`;
  }
  if (frequency === "monthly") return interval === 1 ? "매월" : `${interval}개월마다`;
  return "반복";
}

function nextOccurrence(recurrence, baseDate, startDate = todayKey(), limit = 370) {
  if (!recurrence?.frequency || !baseDate) return null;
  const start = startDate < baseDate ? baseDate : startDate;
  for (let offset = 0; offset <= limit; offset += 1) {
    const candidate = key(addDays(fromKey(start), offset));
    if (occursOn(recurrence, baseDate, candidate)) return candidate;
  }
  return null;
}

function shortDate(value) {
  if (!value) return "";
  const date = fromKey(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function groupColor(state, item) {
  const groups = Array.isArray(state.eventGroups) ? state.eventGroups : [];
  return groups.find((group) => group.id === item.groupId)?.color || "var(--accent)";
}

function rowMarkup(state, item, kind) {
  const baseDate = kind === "task" ? item.date : key(new Date(item.start));
  const next = nextOccurrence(item.recurrence, baseDate);
  const ended = item.recurrence?.until && item.recurrence.until < todayKey();
  const nextText = ended ? "종료됨" : next ? `다음 ${shortDate(next)}` : "다음 일정 없음";
  const kindLabel = kind === "task" ? (item.isHabit ? "습관" : "할일") : "일정";
  return `<div class="onekan-repeat-row" data-context-kind="${kind}" data-context-id="${esc(item.id)}" style="--repeat-group:${groupColor(state, item)}">
    <span class="onekan-repeat-dot" aria-hidden="true"></span>
    <div class="onekan-repeat-main">
      <strong>${esc(item.title || "이름 없음")}</strong>
      <div class="onekan-repeat-meta"><span>${esc(recurrenceLabel(item.recurrence, baseDate))}</span><span>·</span><span class="next">${esc(nextText)}</span></div>
    </div>
    <span class="onekan-repeat-kind">${kindLabel}</span>
  </div>`;
}

function sectionMarkup(state, title, items, kind) {
  const rows = items.map((item) => rowMarkup(state, item, kind)).join("");
  return `<article class="card onekan-repeat-card">
    <div class="card-header"><div class="card-title">${esc(title)}</div><span class="onekan-repeat-count">${items.length}</span></div>
    <div class="onekan-repeat-list">${rows || `<div class="onekan-repeat-empty">아직 ${esc(title)}이 없어요.</div>`}</div>
  </article>`;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  return data?.data && typeof data.data === "object" ? data.data : {};
}

async function render() {
  const page = $("#page-repeat");
  const host = $("#repeatOverviewBody");
  if (!page || !host || !page.classList.contains("active") || rendering) return;
  rendering = true;
  try {
    host.innerHTML = '<div class="onekan-repeat-empty">불러오는 중...</div>';
    const state = await readState();
    if (!state) {
      host.innerHTML = '<div class="onekan-repeat-empty">로그인 후 반복 항목을 확인할 수 있어요.</div>';
      return;
    }
    const recurringTasks = (Array.isArray(state.tasks) ? state.tasks : []).filter((item) => item.recurrence?.frequency && item.recurrence.frequency !== "none").sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));
    const tasks = recurringTasks.filter((item) => !item.isHabit);
    const habits = recurringTasks.filter((item) => item.isHabit);
    const events = (Array.isArray(state.events) ? state.events : []).filter((item) => item.recurrence?.frequency && item.recurrence.frequency !== "none").sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));
    host.innerHTML = sectionMarkup(state, "반복 할일", tasks, "task") + sectionMarkup(state, "습관", habits, "task") + sectionMarkup(state, "반복 일정", events, "event");
  } catch (error) {
    console.error("repeat overview load failed", error);
    host.innerHTML = '<div class="onekan-repeat-empty">반복 항목을 불러오지 못했어요.</div>';
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 60) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, delay);
}

function init() {
  installStyle();
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-page="repeat"]')) scheduleRender(30);
  });
  document.addEventListener("onekan:state-changed", () => {
    if ($("#page-repeat")?.classList.contains("active")) scheduleRender(80);
  });
  const page = $("#page-repeat");
  if (page?.classList.contains("active")) scheduleRender(0);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
