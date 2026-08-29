import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const pad = (value) => String(value).padStart(2, "0");
const key = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromKey = (value) => new Date(`${value}T12:00:00`);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
const todayKey = () => { const date = new Date(); date.setHours(date.getHours() - 3); return key(date); };

let activeHabitId = null;
let activeTask = null;
let cursor = new Date();
let longPressTimer = null;
let longPressPoint = null;

function dayDistance(first, last) {
  const a = fromKey(first), b = fromKey(last);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

function occursOn(task, targetDate) {
  const baseDate = task?.date;
  const recurrence = task?.recurrence;
  if (!baseDate || !recurrence?.frequency || recurrence.frequency === "none") return false;
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

async function readTask(id) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  return tasks.find((task) => task.id === id && task.isHabit) || null;
}

function installStyle() {
  if ($("#habitHistoryViewStyle")) return;
  const style = document.createElement("style");
  style.id = "habitHistoryViewStyle";
  style.textContent = `
    .habit-history-overlay{position:fixed;inset:0;z-index:12000;display:none;place-items:center;padding:18px;background:rgba(21,27,36,.28);backdrop-filter:blur(2px)}
    .habit-history-overlay.open{display:grid}
    .habit-history-panel{width:min(480px,100%);max-height:min(760px,90vh);overflow:auto;border:1px solid var(--line);border-radius:16px;background:var(--panel,#fff);box-shadow:0 22px 70px rgba(15,23,42,.22)}
    .habit-history-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;padding:18px 18px 12px;border-bottom:1px solid var(--line)}
    .habit-history-title{display:grid;gap:4px;min-width:0}.habit-history-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px}.habit-history-title span{color:var(--muted);font-size:11px}
    .habit-history-close,.habit-history-nav button{border:0;background:transparent;color:var(--text);cursor:pointer}
    .habit-history-close{width:32px;height:32px;border-radius:8px;font-size:20px}.habit-history-close:hover,.habit-history-nav button:hover{background:var(--panel-soft)}
    .habit-history-summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:14px 18px}
    .habit-history-summary strong{font-size:22px}.habit-history-summary span{color:var(--muted);font-size:11px}.habit-history-summary b{font-size:12px;color:var(--accent-dark)}
    .habit-history-nav{display:grid;grid-template-columns:36px minmax(0,1fr) 36px;align-items:center;margin:0 18px 12px}.habit-history-nav button{height:34px;border-radius:8px;font-size:20px}.habit-history-nav strong{text-align:center;font-size:13px}
    .habit-history-weekdays,.habit-history-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.habit-history-weekdays{padding:0 18px;color:var(--muted);font-size:10px;text-align:center}.habit-history-weekdays span{padding:6px 0}
    .habit-history-grid{gap:5px;padding:0 18px 18px}
    .habit-history-day{position:relative;display:grid;place-items:center;aspect-ratio:1;border:1px solid transparent;border-radius:10px;color:var(--muted);font-size:11px}
    .habit-history-day.scheduled{border-color:var(--line);color:var(--text);background:var(--panel-soft)}
    .habit-history-day.completed{border-color:color-mix(in srgb,var(--accent) 65%,var(--line));background:color-mix(in srgb,var(--accent) 15%,#fff);color:var(--accent-dark);font-weight:700}
    .habit-history-day.future{opacity:.45}.habit-history-day.today{box-shadow:inset 0 0 0 1.5px var(--accent)}
    .habit-history-check{position:absolute;right:5px;bottom:3px;font-size:10px;font-weight:800}
    .habit-history-blank{aspect-ratio:1}
    .habit-history-note{padding:0 18px 18px;color:var(--muted);font-size:10px;line-height:1.5}
    #globalContextMenu [data-habit-history-action].hidden{display:none}
    @media(max-width:520px){.habit-history-overlay{padding:8px;align-items:end}.habit-history-panel{max-height:88vh;border-radius:16px 16px 0 0}.habit-history-head{padding-top:16px}}
  `;
  document.head.appendChild(style);
}

function ensureOverlay() {
  if ($("#habitHistoryOverlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "habitHistoryOverlay";
  overlay.className = "habit-history-overlay";
  overlay.innerHTML = `
    <section class="habit-history-panel" role="dialog" aria-modal="true" aria-labelledby="habitHistoryTitle">
      <div class="habit-history-head">
        <div class="habit-history-title"><strong id="habitHistoryTitle">습관 기록</strong><span>완료한 날을 월별로 확인해요.</span></div>
        <button class="habit-history-close" type="button" aria-label="기록 보기 닫기">×</button>
      </div>
      <div class="habit-history-summary"><strong id="habitHistoryCount">0/0</strong><span>완료</span><b id="habitHistoryRate">0%</b></div>
      <div class="habit-history-nav"><button type="button" data-habit-history-prev aria-label="이전 달">‹</button><strong id="habitHistoryMonth"></strong><button type="button" data-habit-history-next aria-label="다음 달">›</button></div>
      <div class="habit-history-weekdays"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>
      <div class="habit-history-grid" id="habitHistoryGrid"></div>
      <div class="habit-history-note">체크율은 해당 달에 예정된 날짜 중 오늘까지 완료한 비율이에요.</div>
    </section>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".habit-history-close")) closeOverlay();
    if (event.target.closest("[data-habit-history-prev]")) { cursor.setMonth(cursor.getMonth() - 1); renderCalendar(); }
    if (event.target.closest("[data-habit-history-next]")) { cursor.setMonth(cursor.getMonth() + 1); renderCalendar(); }
  });
}

function closeOverlay() {
  $("#habitHistoryOverlay")?.classList.remove("open");
}

function renderCalendar() {
  if (!activeTask) return;
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1, 12);
  const lastDay = new Date(year, month + 1, 0, 12).getDate();
  const today = todayKey();
  const todayDate = fromKey(today);
  const isFutureMonth = year > todayDate.getFullYear() || (year === todayDate.getFullYear() && month > todayDate.getMonth());
  const isCurrentMonth = year === todayDate.getFullYear() && month === todayDate.getMonth();
  let expected = 0;
  let completed = 0;
  let html = "";

  for (let i = 0; i < first.getDay(); i += 1) html += '<div class="habit-history-blank" aria-hidden="true"></div>';
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, month, day, 12);
    const dateKey = key(date);
    const scheduled = occursOn(activeTask, dateKey);
    const done = Boolean(activeTask.recurrenceDone?.[dateKey]);
    const future = dateKey > today;
    if (scheduled && !future) expected += 1;
    if (scheduled && !future && done) completed += 1;
    const classes = ["habit-history-day"];
    if (scheduled) classes.push("scheduled");
    if (done) classes.push("completed");
    if (future) classes.push("future");
    if (dateKey === today) classes.push("today");
    const label = `${year}년 ${month + 1}월 ${day}일${scheduled ? done ? ", 완료" : ", 예정" : ""}`;
    html += `<div class="${classes.join(" ")}" aria-label="${esc(label)}"><span>${day}</span>${done ? '<span class="habit-history-check">✓</span>' : ""}</div>`;
  }

  const rate = expected ? Math.round((completed / expected) * 100) : 0;
  $("#habitHistoryTitle").textContent = activeTask.title || "습관 기록";
  $("#habitHistoryMonth").textContent = `${year}년 ${month + 1}월`;
  $("#habitHistoryCount").textContent = `${completed}/${expected}`;
  $("#habitHistoryRate").textContent = `${rate}%`;
  $("#habitHistoryGrid").innerHTML = html;
  const note = $(".habit-history-note");
  if (note) note.textContent = isFutureMonth ? "미래 달은 예정 날짜만 흐리게 보여요." : isCurrentMonth ? "체크율은 이번 달 예정 날짜 중 오늘까지 완료한 비율이에요." : "체크율은 이 달에 예정된 날짜 중 완료한 비율이에요.";
}

async function openHistory(id) {
  try {
    const task = await readTask(id);
    if (!task) return;
    activeTask = task;
    cursor = new Date();
    cursor.setDate(1);
    renderCalendar();
    $("#habitHistoryOverlay")?.classList.add("open");
  } catch (error) {
    console.error("habit history load failed", error);
  }
}

function habitIdFromElement(element) {
  const row = element?.closest?.('.onekan-repeat-row[data-context-kind="task"][data-context-id]');
  if (!row) return null;
  return row.querySelector(".onekan-repeat-kind")?.textContent?.trim() === "습관" ? row.dataset.contextId : null;
}

function syncMenuButton(id) {
  const menu = $("#globalContextMenu");
  if (!menu) return;
  let button = menu.querySelector("[data-habit-history-action]");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("data-habit-history-action", "1");
    button.textContent = "기록 보기";
    const toggle = menu.querySelector('[data-context-action="toggle-habit"]');
    const duplicate = menu.querySelector('[data-context-action="duplicate"]');
    if (toggle) toggle.insertAdjacentElement("afterend", button);
    else if (duplicate) menu.insertBefore(button, duplicate);
    else menu.prepend(button);
  }
  activeHabitId = id || null;
  button.classList.toggle("hidden", !activeHabitId);
  if (activeHabitId) button.dataset.habitId = activeHabitId;
  else delete button.dataset.habitId;
}

function installContextBridge() {
  document.addEventListener("contextmenu", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const id = habitIdFromElement(element);
    setTimeout(() => syncMenuButton(id), 0);
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    const element = event.target instanceof Element ? event.target : null;
    const id = habitIdFromElement(element);
    clearTimeout(longPressTimer);
    longPressPoint = id ? { id, x: event.clientX, y: event.clientY } : null;
    if (!longPressPoint) return;
    longPressTimer = setTimeout(() => syncMenuButton(longPressPoint?.id || null), 590);
  }, true);
  document.addEventListener("pointermove", (event) => {
    if (!longPressPoint) return;
    if (Math.hypot(event.clientX - longPressPoint.x, event.clientY - longPressPoint.y) > 10) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressPoint = null;
    }
  }, true);
  const cancelLongPress = () => { clearTimeout(longPressTimer); longPressTimer = null; longPressPoint = null; };
  document.addEventListener("pointerup", cancelLongPress, true);
  document.addEventListener("pointercancel", cancelLongPress, true);

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-habit-history-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const id = button.dataset.habitId || activeHabitId;
    $("#globalContextMenu")?.classList.remove("open");
    if (id) openHistory(id);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#habitHistoryOverlay")?.classList.contains("open")) closeOverlay();
  });
}

function init() {
  installStyle();
  ensureOverlay();
  installContextBridge();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
