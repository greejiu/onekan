import { onekanStateStore } from "./supabase.js?v=1";

if (!window.__onekanHabitAreaListInstalled) {
  window.__onekanHabitAreaListInstalled = true;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  const manualOrderValue = (item) => Number.isFinite(Number(item?.manualOrder)) ? Number(item.manualOrder) : 1000000000;

  function repeatLabel(task) {
    const recurrence = task?.recurrence || task?.repeatRule || null;
    if (!recurrence?.frequency || recurrence.frequency === "none") return "";
    const interval = Math.max(1, Number(recurrence.interval || 1));
    if (recurrence.frequency === "daily") return interval === 1 ? "완료 후 1일" : `완료 후 ${interval}일`;
    if (recurrence.frequency === "weekly") return interval === 1 ? "완료 후 1주" : `완료 후 ${interval}주`;
    if (recurrence.frequency === "monthly") return interval === 1 ? "완료 후 1개월" : `완료 후 ${interval}개월`;
    return "반복";
  }

  function dateLabel(value) {
    if (!value) return "";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", weekday: "short" }).format(date);
  }

  function itemMarkup(task, groupInfo, projects) {
    const repeat = repeatLabel(task);
    const project = projects.find((item) => item.id === task.projectId)?.title || "";
    const when = dateLabel(task.date);
    return `<div class="uw-item uw-task" style="--uw-group:${esc(groupInfo.color || "#8fa9c4")}" data-context-kind="task" data-context-id="${esc(task.id)}" data-habit-item="1" data-uw-kind="task" data-id="${esc(task.id)}" data-date="${esc(task.date || "")}" data-manual-row data-manual-kind="task" data-manual-id="${esc(task.id)}">
      <button class="uw-check" style="--uw-check-color:${esc(groupInfo.color || "#8fa9c4")}" data-habit-complete="${esc(task.id)}" type="button" aria-label="완료"></button>
      <span class="uw-event-dot" aria-hidden="true"></span>
      <span class="uw-item-title">${esc(task.title || "이름 없는 습관")}</span>
      ${when ? `<span class="uw-item-time">${esc(when)}</span>` : ""}
      ${repeat ? `<span class="uw-repeat-badge" title="${esc(repeat)}" aria-label="반복 · ${esc(repeat)}">↻</span>` : ""}
      ${project ? `<span class="uw-item-time">${esc(project)}</span>` : ""}
      <button class="uw-move-handle" type="button" aria-label="길게 눌러 이동">↕</button>
    </div>`;
  }

  function areaTab() {
    return document.querySelector('[data-habit-list-tab="someday"]');
  }

  function renameTab() {
    const tab = areaTab();
    if (!tab) return;
    if (tab.textContent !== "영역별") tab.textContent = "영역별";
    tab.setAttribute("aria-label", "미완료 습관을 영역별로 보기");
  }

  function shouldRenderAreaView() {
    const page = document.querySelector("#page-repeat");
    const listMode = document.querySelector('[data-habit-mode="list"]');
    const tab = areaTab();
    return Boolean(page?.classList.contains("active") && listMode?.classList.contains("active") && tab?.classList.contains("active"));
  }

  let renderRequest = 0;
  let scheduled = null;

  async function renderAreaView() {
    renameTab();
    if (!shouldRenderAreaView()) return;
    const host = document.querySelector("#repeatOverviewBody");
    if (!host) return;

    const request = ++renderRequest;
    const state = await onekanStateStore.read();
    if (!state || request !== renderRequest || !shouldRenderAreaView()) return;

    const tasks = (Array.isArray(state.tasks) ? state.tasks : [])
      .filter((task) => task?.isHabit && !task.done)
      .sort((a, b) => manualOrderValue(a) - manualOrderValue(b) || String(a.title || "").localeCompare(String(b.title || ""), "ko"));
    const groups = Array.isArray(state.eventGroups) && state.eventGroups.length
      ? state.eventGroups
      : [{ id: "default", name: "기본", color: "#8fa9c4" }];
    const projects = Array.isArray(state.projects) ? state.projects : [];
    const fallback = groups[0];
    const entries = groups.map((groupInfo) => ({
      groupInfo,
      rows: tasks.filter((task) => (groups.some((group) => group.id === task.groupId) ? task.groupId : fallback.id) === groupInfo.id),
    })).filter((entry) => entry.rows.length);

    host.innerHTML = entries.length
      ? `<div class="uw-task-grouped-list">${entries.map(({ groupInfo, rows }) => `<section class="uw-task-group-section" style="--uw-group:${esc(groupInfo.color || "#8fa9c4")}"><div class="uw-task-group-heading"><span class="uw-task-group-dot"></span><strong>${esc(groupInfo.name || "기본")}</strong></div><div class="uw-list uw-task-main-list" data-group-id="${esc(groupInfo.id)}" data-manual-list>${rows.map((task) => itemMarkup(task, groupInfo, projects)).join("")}</div></section>`).join("")}</div>`
      : '<div class="empty">미완료 습관이 없어요.</div>';
  }

  function scheduleRender(delay = 0) {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => renderAreaView(), delay);
  }

  const subnav = document.querySelector("#habitPageSubnav");
  if (subnav) {
    new MutationObserver(() => {
      renameTab();
      scheduleRender(0);
    }).observe(subnav, { childList: true, subtree: true });
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-habit-list-tab],[data-habit-mode],.nav-item[data-page="repeat"]')) scheduleRender(20);
  }, true);

  document.addEventListener("onekan:state-changed", () => scheduleRender(120));
  window.addEventListener("load", () => scheduleRender(250), { once: true });
  renameTab();
  scheduleRender(250);
}
