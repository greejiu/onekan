import { onekanStateStore, supabase } from "./supabase.js?v=1";
import { confirmAction, showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (n) => String(n).padStart(2, "0");

let currentTarget = null;
let longPressTimer = null;
let longPressStart = null;
let suppressClickUntil = 0;

function itemClickSuppressed() {
  return Date.now() < suppressClickUntil || Date.now() < Number(window.__onekanSuppressItemClickUntil || 0);
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayDate(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return date;
}

function relativeDayKey(offset = 0) {
  const date = appDayDate();
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function normalizeState(value) {
  const state = value && typeof value === "object" ? value : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length ? state.eventGroups : [{ id: "default", name: "기본", color: "#8fa9c4" }];
  state.timeBlocks = Array.isArray(state.timeBlocks) ? state.timeBlocks : [];
  state.habitTemplates = Array.isArray(state.habitTemplates) ? state.habitTemplates : [];
  state.habitDays = state.habitDays && typeof state.habitDays === "object" ? state.habitDays : {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.directionGoals = Array.isArray(state.directionGoals) ? state.directionGoals : [];
  state.identities = Array.isArray(state.identities) ? state.identities : [];
  state.projectGroups = Array.isArray(state.projectGroups) ? state.projectGroups : [];
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  state.ui = state.ui && typeof state.ui === "object" ? state.ui : {};
  state.ui.homeDashboard = state.ui.homeDashboard && typeof state.ui.homeDashboard === "object" ? state.ui.homeDashboard : {};
  state.ui.homeDashboard.secondaryDdays = Array.isArray(state.ui.homeDashboard.secondaryDdays) ? state.ui.homeDashboard.secondaryDdays.slice(0, 3) : [];
  return state;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const stored = await onekanStateStore.read({ userId: session.user.id });
  return { user: session.user, state: normalizeState(stored) };
}

async function writeState(mutator, source = "context-menu") {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  await onekanStateStore.mutate((latest) => {
    const state = normalizeState(latest);
    mutator(state);
    return state;
  }, { userId: session.user.id, source: source });
  $("#reloadCloudBtn")?.click();
  return true;
}

function getItem(state, target) {
  if (!target) return null;
  if (target.kind === "task") return state.tasks.find((item) => item.id === target.id);
  if (target.kind === "event") return state.events.find((item) => item.id === target.id);
  if (target.kind === "timeBlock") return state.timeBlocks.find((item) => item.id === target.id);
  if (target.kind === "habit") return state.habitTemplates.find((item) => item.id === target.id);
  if (target.kind === "project") return state.projects.find((item) => item.id === target.id);
  if (target.kind === "goal") return state.directionGoals.find((item) => item.id === target.id);
  if (target.kind === "identity") return state.identities.find((item) => item.id === target.id);
  if (target.kind === "session") return state.sessions.find((item) => item.id === target.id);
  return null;
}

function elementIndex(element, selector) {
  return $$(selector).indexOf(element);
}

function resolveDirect(element) {
  const explicit = element.closest("[data-context-kind][data-context-id]");
  if (explicit) return { kind: explicit.dataset.contextKind, id: explicit.dataset.contextId };

  const homeDday = element.closest(".home-dashboard-dday");
  if (homeDday) return { kind: "homeDday", id: "hero" };

  const feature = element.closest("[data-feature-kind][data-feature-id]");
  if (feature) return { kind: feature.dataset.featureKind === "event" ? "event" : "task", id: feature.dataset.featureId };

  // unified-workspace의 집/할일/일정 보기에 표시되는 기존 할일도
  // 같은 전역 우클릭 메뉴를 사용한다.
  const unifiedTask = element.closest('[data-uw-kind="task"][data-id]');
  if (unifiedTask) return { kind: "task", id: unifiedTask.dataset.id };

  const todayTask = element.closest("#taskList .row[data-id]");
  if (todayTask) return { kind: "task", id: todayTask.dataset.id };

  const somedayTask = element.closest("#featureSomedayList .row[data-task-id]");
  if (somedayTask) return { kind: "task", id: somedayTask.dataset.taskId };

  const block = element.closest(".time-block[data-block-id]");
  if (block) return { kind: "timeBlock", id: block.dataset.blockId };

  const project = element.closest(".project-row[data-project-id]");
  if (project) return { kind: "project", id: project.dataset.projectId };

  return null;
}

function resolveByPosition(element, state) {
  const habitRow = element.closest("#habitList .row");
  if (habitRow) {
    const checks = state.habitDays[relativeDayKey(0)] || {};
    const habits = [...state.habitTemplates].sort((a, b) => Number(!!checks[a.id]) - Number(!!checks[b.id]));
    const item = habits[elementIndex(habitRow, "#habitList .row")];
    return item ? { kind: "habit", id: item.id } : null;
  }

  const templateRow = element.closest("#habitTemplateList .template-row");
  if (templateRow) {
    const item = state.habitTemplates[elementIndex(templateRow, "#habitTemplateList .template-row")];
    return item ? { kind: "habit", id: item.id } : null;
  }

  const upcomingRow = element.closest("#upcomingList .row");
  if (upcomingRow) {
    const now = new Date();
    const events = state.events.filter((item) => new Date(item.start) >= now).sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 5);
    const item = events[elementIndex(upcomingRow, "#upcomingList .row")];
    return item ? { kind: "event", id: item.id } : null;
  }

  const todaySession = element.closest("#todaySessions .history-row");
  if (todaySession) {
    const dayKey = relativeDayKey(0);
    const sessions = state.sessions.filter((item) => item.end && localDateKey(appDayDate(new Date(item.end))) === dayKey).sort((a, b) => new Date(b.end) - new Date(a.end));
    const item = sessions[elementIndex(todaySession, "#todaySessions .history-row")];
    return item ? { kind: "session", id: item.id } : null;
  }

  const allSession = element.closest("#allSessions .history-row");
  if (allSession) {
    const sessions = [...state.sessions].sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 50);
    const item = sessions[elementIndex(allSession, "#allSessions .history-row")];
    return item ? { kind: "session", id: item.id } : null;
  }

  return null;
}

function isSupportedSurface(element) {
  return !!element.closest([
    "[data-context-kind][data-context-id]",
    '[data-uw-kind="task"][data-id]',
    "#taskList .row[data-id]",
    "#featureSomedayList .row[data-task-id]",
    ".time-block[data-block-id]",
    "#habitList .row",
    "#habitTemplateList .template-row",
    "#upcomingList .row",
    "#calendarBody .cal-event",
    "#calendarBody .day-timed-event",
    "#calendarBody .day-list .row",
    ".project-row[data-project-id]",
    "#todaySessions .history-row",
    "#allSessions .history-row",
    ".home-dashboard-dday",
  ].join(","));
}

function schedulable(kind) {
  return ["task", "event", "timeBlock"].includes(kind);
}

function duplicable(kind) {
  return ["task", "event", "timeBlock", "habit", "project", "goal", "identity"].includes(kind);
}

function targetDdayDate(item) {
  const value = item?.endDate || item?.deadline || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function activeDdayItem(item) {
  const status = String(item?.status || "").trim().toLowerCase();
  return !["done", "complete", "completed", "achieved", "완료", "달성", "완주함", "archived", "archive", "closed", "보관", "쉬는 중", "쉬는중"].includes(status);
}

function contextDdayText(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const today = appDayDate();
  const distance = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (distance === 0) return "D-DAY";
  return distance > 0 ? `D-${distance}` : `D+${Math.abs(distance)}`;
}

function validSecondaryDdays(state) {
  const hero = state.ui?.homeDashboard?.heroDday;
  const savedItems = Array.isArray(state.ui?.homeDashboard?.secondaryDdays) ? state.ui.homeDashboard.secondaryDdays : [];
  const seen = new Set();
  return savedItems.filter((saved) => {
    if (!["project", "goal"].includes(saved?.kind) || !saved.id) return false;
    if (hero?.kind === saved.kind && hero?.id === saved.id) return false;
    const key = `${saved.kind}:${saved.id}`;
    if (seen.has(key)) return false;
    const collection = saved.kind === "project" ? state.projects : state.directionGoals;
    const item = (collection || []).find((entry) => entry.id === saved.id);
    if (!item || !targetDdayDate(item) || !activeDdayItem(item)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function taskSubtasks(task) {
  if (!Array.isArray(task?.subtasks)) return [];
  return task.subtasks
    .filter((step) => step && typeof step === "object" && String(step.title || "").trim())
    .map((step) => ({ id: String(step.id || ""), title: String(step.title || "").trim() }));
}

function hideMenu() {
  $("#globalContextMenu")?.classList.remove("open");
  currentTarget = null;
}

function groupable(kind) {
  return kind === "task" || kind === "event" || kind === "project" || kind === "session";
}

function renderGroupChoices(state, target) {
  const menu = $("#globalContextMenu");
  const groupButton = menu?.querySelector('[data-context-action="groups"]');
  const groupList = $("#contextGroupList");
  const item = getItem(state, target);
  const groups = Array.isArray(state?.eventGroups) ? state.eventGroups : [];
  const available = groupable(target.kind) && groups.length > 0;
  if (groupButton) {
    groupButton.classList.toggle("hidden", !available);
    groupButton.innerHTML = `영역 <span class="context-menu-arrow">›</span>`;
  }
  groupList?.classList.add("hidden");
  if (!available || !groupList) {
    if (groupList) groupList.innerHTML = "";
    return;
  }
  const selectedId = item?.groupId || groups[0]?.id;
  groupList.innerHTML = groups.map((group) => `<button type="button" role="menuitemradio" aria-checked="${group.id === selectedId}" data-context-group-id="${escapeAttr(group.id)}"><span class="context-group-dot" style="--group-color:${escapeAttr(group.color || "#8fa9c4")}"></span><span>${escapeAttr(group.name)}</span>${group.id === selectedId ? '<span class="context-group-check">✓</span>' : ""}</button>`).join("");
}

function renderProjectChoices(state, target) {
  const menu = $("#globalContextMenu");
  const button = menu?.querySelector('[data-context-action="projects"]');
  const list = $("#contextProjectList");
  const item = getItem(state, target);
  const available = target.kind === "task" || target.kind === "session";
  button?.classList.toggle("hidden", !available);
  list?.classList.add("hidden");
  if (!available || !list) {
    if (list) list.innerHTML = "";
    return;
  }
  const selectedId = item?.projectId || "";
  if (button) button.innerHTML = `프로젝트 연결 <span class="context-menu-arrow">›</span>`;
  const normalize = (value) => {
    const raw = String(value ?? "").trim().toLowerCase();
    if (["done", "완료", "달성", "complete", "completed"].includes(raw)) return "done";
    if (["archived", "보관", "closed", "archive"].includes(raw)) return "archived";
    if (["before", "시작 전", "시작전", "todo", "planned"].includes(raw)) return "before";
    return "doing";
  };
  const projects = (state.projects || []).filter((project) => (project?.kind === "project" || !project?.kind) && (normalize(project.status) === "doing" || project.id === selectedId)).sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ko"));
  list.innerHTML = `<button type="button" role="menuitemradio" aria-checked="${!selectedId}" data-context-project-id=""><span></span><span>프로젝트 없음</span>${!selectedId ? '<span class="context-group-check">✓</span>' : '<span></span>'}</button>${projects.map((project) => {
    const group = state.eventGroups?.find((entry) => entry.id === project.groupId);
    return `<button type="button" role="menuitemradio" aria-checked="${project.id === selectedId}" data-context-project-id="${escapeAttr(project.id)}"><span class="context-group-dot" style="--group-color:${escapeAttr(group?.color || "#8fa9c4")}"></span><span>${escapeAttr(project.title || "이름 없는 프로젝트")}</span>${project.id === selectedId ? '<span class="context-group-check">✓</span>' : '<span></span>'}</button>`;
  }).join("")}`;
}

function renderDdayChoices(state, target) {
  const menu = $("#globalContextMenu");
  const button = menu?.querySelector('[data-context-action="ddays"]');
  const list = $("#contextDdayList");
  const available = target.kind === "homeDday";
  button?.classList.toggle("hidden", !available);
  list?.classList.add("hidden");
  if (!available || !list) {
    if (list) list.innerHTML = "";
    return;
  }
  const projects = (state.projects || [])
    .filter((item) => (item?.kind === "project" || !item?.kind) && targetDdayDate(item) && activeDdayItem(item))
    .map((item) => ({ kind: "project", id: item.id, title: item.title || "이름 없는 프로젝트", date: targetDdayDate(item), label: "프로젝트" }));
  const goals = (state.directionGoals || [])
    .filter((item) => targetDdayDate(item) && activeDdayItem(item))
    .map((item) => ({ kind: "goal", id: item.id, title: item.title || "이름 없는 목표", date: targetDdayDate(item), label: "목표" }));
  const choices = [...projects, ...goals].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "ko"));
  const selected = state.ui?.homeDashboard?.heroDday;
  const secondary = validSecondaryDdays(state);
  if (button) button.innerHTML = `D-day 바꾸기 <span class="context-menu-arrow">›</span>`;
  list.innerHTML = choices.length ? choices.map((item) => {
    const isHero = selected?.kind === item.kind && selected?.id === item.id;
    const isSecondary = secondary.some((saved) => saved?.kind === item.kind && saved?.id === item.id);
    const secondaryFull = secondary.length >= 3 && !isSecondary;
    return `<div class="context-dday-row"><span class="context-dday-copy"><strong><small class="context-dday-kind">${item.label}</small>${escapeAttr(item.title)}</strong><small>${item.date} · ${contextDdayText(item.date)}</small></span><button class="context-dday-role${isHero ? " selected" : ""}" type="button" aria-pressed="${isHero}" data-context-dday-hero-kind="${item.kind}" data-context-dday-hero-id="${escapeAttr(item.id)}">${isHero ? "★ 대표" : "☆ 대표"}</button><button class="context-dday-role${isSecondary ? " selected" : ""}" type="button" aria-pressed="${isSecondary}" data-context-dday-secondary-kind="${item.kind}" data-context-dday-secondary-id="${escapeAttr(item.id)}"${isHero || secondaryFull ? " disabled" : ""}>${isSecondary ? "✓ 보조" : "+ 보조"}</button></div>`;
  }).join("") : '<div class="context-dday-empty">종료일이 있는 진행 중 프로젝트나 목표가 없어요.</div>';
}

function showMenu(x, y, target, state) {
  currentTarget = target;
  const menu = $("#globalContextMenu");
  const item = getItem(state, target);
  const habitToggle = menu.querySelector('[data-context-action="toggle-habit"]');
  const canToggleHabit = target.kind === "task" && (item?.isHabit || (item?.recurrence?.frequency && item.recurrence.frequency !== "none"));
  habitToggle?.classList.toggle("hidden", !canToggleHabit);
  if (habitToggle && canToggleHabit) habitToggle.textContent = item?.isHabit ? "할일로 만들기" : "습관으로 만들기";
  const subtasksButton = menu.querySelector('[data-context-action="subtasks"]');
  const canManageSubtasks = target.kind === "task" && item && !item.done;
  const subtaskCount = canManageSubtasks ? taskSubtasks(item).length : 0;
  subtasksButton?.classList.toggle("hidden", !canManageSubtasks);
  if (subtasksButton && canManageSubtasks) subtasksButton.textContent = subtaskCount ? `하위 할일 관리 (${subtaskCount})` : "＋ 하위 할일 추가";
  $$('[data-context-schedule]', menu).forEach((element) => element.classList.toggle("hidden", !schedulable(target.kind)));
  menu.querySelector('[data-context-action="duplicate"]')?.classList.toggle("hidden", !duplicable(target.kind));
  const heroDday = menu.querySelector('[data-context-action="hero-dday"]');
  const canBeHeroDday = ["project", "goal"].includes(target.kind) && Boolean(targetDdayDate(item));
  const selectedHero = state.ui?.homeDashboard?.heroDday;
  const isHeroDday = canBeHeroDday && selectedHero?.kind === target.kind && selectedHero?.id === target.id;
  heroDday?.classList.toggle("hidden", !canBeHeroDday);
  if (heroDday) heroDday.textContent = isHeroDday ? "대표 D-day 해제" : "⭐ 대표 D-day로 설정";
  const secondaryDday = menu.querySelector('[data-context-action="secondary-dday"]');
  const selectedSecondary = Array.isArray(state.ui?.homeDashboard?.secondaryDdays) ? state.ui.homeDashboard.secondaryDdays : [];
  const isSecondaryDday = canBeHeroDday && selectedSecondary.some((saved) => saved?.kind === target.kind && saved?.id === target.id);
  secondaryDday?.classList.toggle("hidden", !canBeHeroDday || isHeroDday);
  if (secondaryDday) secondaryDday.textContent = isSecondaryDday ? "보조 D-day에서 제거" : "＋ 보조 D-day에 추가";
  menu.querySelector('[data-context-action="session-time"]')?.classList.toggle("hidden", target.kind !== "session");
  menu.querySelector('[data-context-action="delete"]')?.classList.toggle("hidden", target.kind === "homeDday");
  renderGroupChoices(state, target);
  renderProjectChoices(state, target);
  renderDdayChoices(state, target);
  menu.classList.toggle("dday-context-open", target.kind === "homeDday");
  menu.classList.add("open");
  document.dispatchEvent(new CustomEvent("onekan:context-menu-opened", { detail: { target, state } }));
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
}

async function toggleHeroDday() {
  const target = currentTarget;
  hideMenu();
  if (!target || !["project", "goal"].includes(target.kind)) return;
  try {
    let selected = false;
    await writeState((state) => {
      const item = getItem(state, target);
      if (!targetDdayDate(item)) return;
      state.ui = state.ui && typeof state.ui === "object" ? state.ui : {};
      state.ui.homeDashboard = state.ui.homeDashboard && typeof state.ui.homeDashboard === "object" ? state.ui.homeDashboard : {};
      const current = state.ui.homeDashboard.heroDday;
      selected = current?.kind !== target.kind || current?.id !== target.id;
      state.ui.homeDashboard.heroDday = selected ? { kind: target.kind, id: target.id } : null;
      state.ui.homeDashboard.secondaryDdays = (Array.isArray(state.ui.homeDashboard.secondaryDdays) ? state.ui.homeDashboard.secondaryDdays : [])
        .filter((saved) => saved?.kind !== target.kind || saved?.id !== target.id).slice(0, 3);
    });
    showToast(selected ? "대표 D-day로 설정했어요." : "대표 D-day 설정을 해제했어요.");
  } catch (error) {
    console.error(error);
    showToast("대표 D-day를 변경하지 못했어요.");
  }
}

async function changeHomeDdayHero(kind, id) {
  hideMenu();
  if (!["project", "goal"].includes(kind) || !id) return;
  try {
    await writeState((state) => {
      const collection = kind === "project" ? state.projects : state.directionGoals;
      const item = (collection || []).find((entry) => entry.id === id);
      if (!item || !targetDdayDate(item) || !activeDdayItem(item)) return;
      state.ui = state.ui && typeof state.ui === "object" ? state.ui : {};
      state.ui.homeDashboard = state.ui.homeDashboard && typeof state.ui.homeDashboard === "object" ? state.ui.homeDashboard : {};
      state.ui.homeDashboard.heroDday = { kind, id };
      state.ui.homeDashboard.secondaryDdays = (Array.isArray(state.ui.homeDashboard.secondaryDdays) ? state.ui.homeDashboard.secondaryDdays : [])
        .filter((saved) => saved?.kind !== kind || saved?.id !== id).slice(0, 3);
    });
    showToast("대표 D-day를 바꿨어요.");
  } catch (error) {
    console.error(error);
    showToast("D-day를 변경하지 못했어요.");
  }
}

async function toggleHomeDdaySecondary(kind, id) {
  hideMenu();
  if (!["project", "goal"].includes(kind) || !id) return;
  let outcome = "";
  try {
    await writeState((state) => {
      const collection = kind === "project" ? state.projects : state.directionGoals;
      const item = (collection || []).find((entry) => entry.id === id);
      if (!item || !targetDdayDate(item) || !activeDdayItem(item)) return;
      state.ui = state.ui && typeof state.ui === "object" ? state.ui : {};
      state.ui.homeDashboard = state.ui.homeDashboard && typeof state.ui.homeDashboard === "object" ? state.ui.homeDashboard : {};
      const hero = state.ui.homeDashboard.heroDday;
      if (hero?.kind === kind && hero?.id === id) {
        outcome = "hero";
        return;
      }
      const secondary = validSecondaryDdays(state);
      const index = secondary.findIndex((saved) => saved?.kind === kind && saved?.id === id);
      if (index >= 0) {
        secondary.splice(index, 1);
        outcome = "removed";
      } else if (secondary.length >= 3) {
        outcome = "full";
      } else {
        secondary.push({ kind, id });
        outcome = "added";
      }
      state.ui.homeDashboard.secondaryDdays = secondary.slice(0, 3);
    });
    if (outcome === "full") showToast("보조 D-day는 3개까지 선택할 수 있어요.");
    else if (outcome === "hero") showToast("대표 D-day는 보조에 중복해서 넣을 수 없어요.");
    else showToast(outcome === "removed" ? "보조 D-day에서 제거했어요." : "보조 D-day에 추가했어요.");
  } catch (error) {
    console.error(error);
    showToast("보조 D-day를 변경하지 못했어요.");
  }
}

function moveEventToDate(item, targetDate) {
  if (!item?.start) return;
  const start = new Date(item.start);
  const oldEnd = item.end ? new Date(item.end) : null;
  const duration = oldEnd && oldEnd > start ? oldEnd - start : 30 * 60000;
  const [year, month, day] = targetDate.split("-").map(Number);
  start.setFullYear(year, month - 1, day);
  item.start = start.toISOString();
  if (item.end) item.end = new Date(start.getTime() + duration).toISOString();
}

async function moveTarget(offset) {
  const target = currentTarget;
  hideMenu();
  if (!target || !schedulable(target.kind)) return;
  const targetDate = relativeDayKey(offset);
  try {
    await writeState((state) => {
      if (target.kind === "task") {
        const task = state.tasks.find((item) => item.id === target.id);
        if (task) task.date = targetDate;
      } else if (target.kind === "event") {
        moveEventToDate(state.events.find((item) => item.id === target.id), targetDate);
      } else if (target.kind === "timeBlock") {
        const block = state.timeBlocks.find((item) => item.id === target.id);
        if (block) block.date = targetDate;
      }
    });
  } catch (error) {
    console.error(error);
    showToast("날짜를 변경하지 못했어요.");
  }
}

function editableTitleElement(root) {
  return root.querySelector([
    ".cal-event-title",
    ".workspace-task-title",
    ".habit-matrix-title",
    ".row-title",
    ".history-name",
    ".time-block-main strong",
    ".habit-time-main strong",
    ".day-timed-main strong",
    ".multi-entry strong",
    ".project-row strong",
    ".onekan-project-title",
    ".onekan-goal-title",
    ".onekan-identity-title",
    ".template-row > span",
  ].join(",")) || root.querySelector("strong");
}

function itemTitle(target, item) {
  if (target.kind === "timeBlock") return item.detail || item.sourceTitle || "시간 계획";
  return item.title || "";
}

function applyInlineTitle(state, target, value, root) {
  const item = getItem(state, target);
  if (!item) return;
  if (target.kind === "timeBlock") {
    item.detail = value;
    return;
  }
  const oldTitle = item.title;
  item.title = value;
  if (target.kind === "task") {
    state.timeBlocks.forEach((block) => {
      if (block.taskId !== item.id) return;
      if (block.sourceTitle === oldTitle) block.sourceTitle = value;
      if (root.dataset.blockId === block.id) block.detail = value;
    });
  }
}

function startInlineEdit(root, target, state) {
  const item = getItem(state, target);
  const titleElement = editableTitleElement(root);
  if (!item || !titleElement || root.querySelector(".context-inline-edit")) return;
  const original = itemTitle(target, item);
  const input = document.createElement("input");
  input.className = "context-inline-edit";
  input.value = original;
  input.setAttribute("aria-label", "제목 수정");
  const wasDraggable = root.draggable;
  root.draggable = false;
  titleElement.replaceWith(input);
  let finished = false;
  const restore = (value = original) => {
    if (!input.isConnected) return;
    titleElement.textContent = value;
    input.replaceWith(titleElement);
    root.draggable = wasDraggable;
  };
  const commit = async () => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (!value || value === original) return restore();
    restore(value);
    try {
      await writeState((latest) => applyInlineTitle(latest, target, value, root));
    } catch (error) {
      console.error(error);
      showToast("수정하지 못했어요.");
      titleElement.textContent = original;
    }
  };
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    if (event.key === "Escape") { event.preventDefault(); finished = true; restore(); }
  });
  input.addEventListener("blur", commit);
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

async function deleteTarget() {
  const target = currentTarget;
  hideMenu();
  if (!target) return;
  try {
    const loaded = await readState();
    const item = loaded ? getItem(loaded.state, target) : null;
    const labels = { task: "할일", event: "일정", timeBlock: "시간 계획", habit: "습관", project: "프로젝트", goal: "목표", identity: "정체성", session: "시간 기록" };
    const label = labels[target.kind] || "항목";
    const title = item?.title || item?.detail || item?.sourceTitle || "선택한 항목";
    const confirmed = await confirmAction({ title: `${label}을 삭제할까요?`, message: `‘${title}’\n삭제한 내용은 되돌릴 수 없어요.` });
    if (!confirmed) return;
    await writeState((state) => {
      if (target.kind === "task") {
        state.tasks = state.tasks.filter((item) => item.id !== target.id);
        state.timeBlocks = state.timeBlocks.filter((item) => item.taskId !== target.id);
      } else if (target.kind === "event") {
        state.events = state.events.filter((item) => item.id !== target.id);
      } else if (target.kind === "timeBlock") {
        state.timeBlocks = state.timeBlocks.filter((item) => item.id !== target.id);
      } else if (target.kind === "habit") {
        state.habitTemplates = state.habitTemplates.filter((item) => item.id !== target.id);
        for (const day of Object.values(state.habitDays)) if (day && typeof day === "object") delete day[target.id];
      } else if (target.kind === "project") {
        const removed = state.projects.find((item) => item.id === target.id);
        state.projects = state.projects.filter((item) => item.id !== target.id);
        state.tasks.forEach((task) => { if (task.projectId === target.id) delete task.projectId; if (task.goalId === target.id) delete task.goalId; });
        if (removed?.kind === "goal") state.projects.forEach((item) => { if (item.goalId === target.id) item.goalId = null; });
      } else if (target.kind === "goal") {
        state.directionGoals = state.directionGoals.filter((item) => item.id !== target.id);
        state.projects.forEach((project) => { if (project.goalId === target.id) project.goalId = null; });
      } else if (target.kind === "identity") {
        state.identities = state.identities.filter((item) => item.id !== target.id);
        state.directionGoals.forEach((goal) => { if (goal.identityId === target.id) goal.identityId = null; });
      } else if (target.kind === "session") {
        state.sessions = state.sessions.filter((item) => item.id !== target.id);
      }
    });
  } catch (error) {
    console.error(error);
    showToast("삭제하지 못했어요.");
  }
}

async function duplicateTarget() {
  const target = currentTarget;
  hideMenu();
  if (!target || !duplicable(target.kind)) return;
  try {
    await writeState((state) => {
      const item = getItem(state, target);
      if (!item) return;
      const copy = { ...item, id: newId() };
      if (target.kind === "task") {
        copy.title = `${item.title} 복사`;
        copy.done = false;
        copy.completedAt = null;
      } else if (target.kind === "event") {
        copy.title = `${item.title} 복사`;
      } else if (target.kind === "timeBlock") {
        copy.detail = `${item.detail || item.sourceTitle || "시간 계획"} 복사`;
        copy.taskId = null;
        copy.sourceTitle = copy.detail;
      } else if (target.kind === "habit") {
        copy.title = `${item.title} 복사`;
      } else if (target.kind === "project" || target.kind === "goal" || target.kind === "identity") {
        copy.title = `${item.title} 복사`;
      }
      const collection = target.kind === "task" ? state.tasks
        : target.kind === "event" ? state.events
        : target.kind === "timeBlock" ? state.timeBlocks
        : target.kind === "habit" ? state.habitTemplates
        : target.kind === "goal" ? state.directionGoals
        : target.kind === "identity" ? state.identities
        : state.projects;
      const index = collection.findIndex((entry) => entry.id === target.id);
      collection.splice(index >= 0 ? index + 1 : collection.length, 0, copy);
    });
  } catch (error) {
    console.error(error);
    showToast("복제하지 못했어요.");
  }
}

async function changeTargetGroup(groupId) {
  const target = currentTarget;
  hideMenu();
  if (!target || !groupable(target.kind) || !groupId) return;
  try {
    await writeState((state) => {
      const item = getItem(state, target);
      if (!item) return;
      if (!state.eventGroups?.some((group) => group.id === groupId)) return;
      item.groupId = groupId;
      if (target.kind === "project") delete item.projectGroupId;
    });
  } catch (error) {
    console.error(error);
    showToast(target.kind === "project" ? "그룹을 변경하지 못했어요." : "영역을 변경하지 못했어요.");
  }
}

async function changeTargetProject(projectId) {
  const target = currentTarget;
  hideMenu();
  if (!target || !["task", "session"].includes(target.kind)) return;
  try {
    await writeState((state) => {
      const item = getItem(state, target);
      if (!item) return;
      if (projectId && !state.projects.some((project) => project.id === projectId)) return;
      if (projectId) item.projectId = projectId;
      else delete item.projectId;
    });
  } catch (error) {
    console.error(error);
    showToast("프로젝트를 연결하지 못했어요.");
  }
}

async function toggleHabitTarget() {
  const target = currentTarget;
  hideMenu();
  if (!target || target.kind !== "task") return;
  let becameHabit = false;
  let didChange = false;
  try {
    const changed = await writeState((state) => {
      const task = state.tasks.find((item) => item.id === target.id);
      if (!task) return;
      const recurring = task.recurrence?.frequency && task.recurrence.frequency !== "none";
      if (!task.isHabit && !recurring) return;
      task.isHabit = !task.isHabit;
      becameHabit = task.isHabit;
      didChange = true;
    }, "task-habit-toggle");
    if (!changed || !didChange) return;
    showToast(becameHabit ? "습관으로 바꿨어요." : "반복 할일로 바꿨어요.");
  } catch (error) {
    console.error(error);
    showToast("종류를 변경하지 못했어요.");
  }
}

function createSubtaskEditorRow(step = {}) {
  const row = document.createElement("div");
  row.className = "context-subtask-row";
  row.dataset.contextSubtaskRow = "1";
  row.dataset.subtaskId = String(step.id || "");

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 120;
  input.value = String(step.title || "");
  input.placeholder = "작은 행동 입력";
  input.setAttribute("aria-label", "하위 할일");

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "context-subtask-remove";
  remove.dataset.contextSubtaskRemove = "1";
  remove.setAttribute("aria-label", "하위 할일 삭제");
  remove.textContent = "×";

  row.append(input, remove);
  return row;
}

function addSubtaskEditorRow(step = {}, { focus = false } = {}) {
  const list = $("#contextSubtaskList");
  if (!list) return;
  const row = createSubtaskEditorRow(step);
  list.appendChild(row);
  if (focus) requestAnimationFrame(() => $("input", row)?.focus());
}

async function openSubtaskDialog() {
  const target = currentTarget;
  hideMenu();
  if (!target || target.kind !== "task") return;
  try {
    const loaded = await readState();
    const task = loaded ? getItem(loaded.state, target) : null;
    if (!task || task.done) return;
    const dialog = $("#contextSubtaskDialog");
    const form = $("#contextSubtaskForm");
    const list = $("#contextSubtaskList");
    if (!dialog || !form || !list) return;
    form.dataset.taskId = task.id;
    $("#contextSubtaskTaskTitle").textContent = task.title || "이름 없는 할일";
    list.replaceChildren();
    const steps = taskSubtasks(task);
    if (steps.length) steps.forEach((step) => addSubtaskEditorRow(step));
    else addSubtaskEditorRow();
    dialog.showModal();
    requestAnimationFrame(() => $("input", list)?.focus());
  } catch (error) {
    console.error(error);
    showToast("하위 할일을 불러오지 못했어요.");
  }
}

async function saveTaskSubtasks(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const taskId = form.dataset.taskId || "";
  const saveButton = $("[data-context-subtask-save]", form);
  const rows = $$("[data-context-subtask-row]", form)
    .map((row) => ({ id: row.dataset.subtaskId || "", title: $("input", row)?.value.trim() || "" }))
    .filter((step) => step.title);
  if (!taskId) return;
  if (saveButton) saveButton.disabled = true;
  try {
    await writeState((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task || task.done) return;
      task.subtasks = rows.map((step) => ({ id: step.id || `focus-subtask-${newId()}`, title: step.title }));
      const validIds = new Set(task.subtasks.map((step) => step.id));
      const progress = task.subtaskProgress && typeof task.subtaskProgress === "object" ? task.subtaskProgress : {};
      task.subtaskProgress = Object.fromEntries(Object.entries(progress).filter(([id]) => validIds.has(id)));
    });
    $("#contextSubtaskDialog")?.close();
    showToast(rows.length ? "하위 할일을 저장했어요." : "하위 할일을 모두 비웠어요.");
  } catch (error) {
    console.error(error);
    showToast("하위 할일을 저장하지 못했어요.");
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

function ensureUI() {
  if ($("#globalContextMenu")) return;

  const menu = document.createElement("div");
  menu.id = "globalContextMenu";
  menu.className = "global-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" class="hidden" data-context-action="toggle-habit">습관으로 만들기</button>
    <button type="button" role="menuitem" class="hidden" data-context-action="subtasks">＋ 하위 할일 추가</button>
    <button type="button" role="menuitem" data-context-action="duplicate">복제</button>
    <button type="button" role="menuitem" class="hidden" data-context-action="hero-dday">⭐ 대표 D-day로 설정</button>
    <button type="button" role="menuitem" class="hidden" data-context-action="secondary-dday">＋ 보조 D-day에 추가</button>
    <button type="button" role="menuitem" class="hidden" data-context-action="ddays">D-day 바꾸기 <span class="context-menu-arrow">›</span></button>
    <div class="context-dday-list context-group-list hidden" id="contextDdayList" role="group"></div>
    <button type="button" role="menuitem" data-context-action="groups">영역 <span class="context-menu-arrow">›</span></button>
    <div class="context-group-list hidden" id="contextGroupList" role="group"></div>
    <button type="button" role="menuitem" class="hidden" data-context-action="projects">프로젝트 <span class="context-menu-arrow">›</span></button>
    <div class="context-group-list hidden" id="contextProjectList" role="group"></div>
    <button type="button" role="menuitem" class="hidden" data-context-action="session-time">기록 변경</button>
    <button type="button" role="menuitem" class="danger" data-context-action="delete">삭제</button>`;
  document.body.appendChild(menu);

  const subtaskDialog = document.createElement("dialog");
  subtaskDialog.id = "contextSubtaskDialog";
  subtaskDialog.className = "context-subtask-dialog";
  subtaskDialog.setAttribute("aria-labelledby", "contextSubtaskTitle");
  subtaskDialog.innerHTML = `
    <form id="contextSubtaskForm" method="dialog" autocomplete="off">
      <div class="context-subtask-head">
        <div>
          <div class="context-subtask-eyebrow">하위 할일</div>
          <h2 id="contextSubtaskTitle">작은 행동으로 나누기</h2>
          <p id="contextSubtaskTaskTitle"></p>
        </div>
        <button type="button" class="context-subtask-close" data-context-subtask-cancel aria-label="닫기">×</button>
      </div>
      <div class="context-subtask-list" id="contextSubtaskList"></div>
      <button type="button" class="context-subtask-add" data-context-subtask-add>＋ 항목 추가</button>
      <div class="context-subtask-actions">
        <button type="button" class="context-subtask-cancel" data-context-subtask-cancel>취소</button>
        <button type="submit" class="context-subtask-save" data-context-subtask-save>저장</button>
      </div>
    </form>`;
  document.body.appendChild(subtaskDialog);

  const style = document.createElement("style");
  style.id = "globalContextMenuStyle";
  style.textContent = `
    .global-context-menu{position:fixed;z-index:10000;display:none;min-width:154px;padding:5px;background:#fff;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:9px;box-shadow:0 10px 28px rgba(15,23,42,.16)}
    .global-context-menu.open{display:block}
    .global-context-menu button{display:block;width:100%;min-height:36px;padding:7px 10px;border:0;border-radius:6px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px;text-align:left;cursor:pointer}
    .global-context-menu button:hover,.global-context-menu button:focus-visible{background:var(--hover,#f3f5f7);outline:none}
    .global-context-menu button.danger{color:var(--danger,#c84a4a)}
    .global-context-menu [data-context-action="groups"],.global-context-menu [data-context-action="projects"],.global-context-menu [data-context-action="ddays"]{display:flex;align-items:center;justify-content:space-between}
    .global-context-menu.dday-context-open{min-width:min(290px,calc(100vw - 16px))}
    .context-menu-arrow{font-size:18px;line-height:1}
    .context-group-list{margin:3px 0;padding:3px;border-top:1px solid var(--line,#d2d7df);border-bottom:1px solid var(--line,#d2d7df);max-height:min(260px,55vh);overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;scrollbar-gutter:stable}
    #contextGroupList button,#contextProjectList button{display:grid;grid-template-columns:12px minmax(0,1fr) 16px;align-items:center;gap:7px;padding-left:7px}
    .context-group-dot{width:9px;height:9px;border-radius:3px;background:var(--group-color,#8fa9c4)}
    .context-group-check{text-align:right;color:var(--accent,#7666a8)}
    .context-dday-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:6px;padding:5px 4px;border-radius:7px}
    .context-dday-row:hover{background:var(--hover,#f3f5f7)}
    .context-dday-kind{display:inline-block;margin-right:5px;padding:2px 5px;border-radius:999px;background:var(--panel-soft,#f3f5f7);color:var(--muted,#6b7280);font-size:9px;font-weight:600;vertical-align:1px}
    .context-dday-copy{display:grid;gap:2px;min-width:0}
    .context-dday-copy strong,.context-dday-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .context-dday-copy strong{font-size:12px}.context-dday-copy small{color:var(--muted,#6b7280);font-size:10px;font-weight:400}
    .context-dday-row .context-dday-role{display:block;width:auto;min-height:28px;padding:4px 7px;border:1px solid var(--line,#d2d7df);border-radius:999px;background:#fff;color:var(--muted,#6b7280);font-size:10px;text-align:center;white-space:nowrap}
    .context-dday-row .context-dday-role.selected{border-color:var(--accent,#7666a8);background:var(--accent-soft,#f0eafa);color:var(--accent-dark,#684789)}
    .context-dday-row .context-dday-role:disabled{opacity:.38;cursor:not-allowed}
    .context-dday-empty{padding:10px 7px;color:var(--muted,#6b7280);font-size:11px;line-height:1.5}
    [data-context-kind][data-context-id] :is(.row-title,.cal-event-title,.workspace-task-title,.habit-matrix-title,.history-name,strong){cursor:text}
    .context-inline-edit{display:block;width:100%;min-width:0;height:24px;margin:-3px 0;padding:2px 5px;border:1.5px solid var(--accent,#7666a8);border-radius:5px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:inherit;line-height:1.25;outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--accent,#7666a8) 12%,transparent)}
    .time-block .context-inline-edit,.multi-entry .context-inline-edit{height:18px;margin:0;padding:0 4px;font-size:10px}
    .global-context-divider{height:1px;background:var(--line,#d2d7df);margin:4px 2px}
    .global-context-menu .hidden{display:none}
    .context-subtask-dialog{width:min(480px,calc(100vw - 28px));max-height:min(680px,calc(100dvh - 40px));padding:0;border:1px solid var(--line,#d2d7df);border-radius:18px;background:var(--card,#fff);color:var(--text,#1f2328);box-shadow:0 22px 60px rgba(15,23,42,.24);overflow:hidden}
    .context-subtask-dialog::backdrop{background:rgba(35,30,42,.28);backdrop-filter:blur(2px)}
    .context-subtask-dialog form{display:grid;gap:16px;max-height:min(680px,calc(100dvh - 40px));padding:22px;overflow-y:auto}
    .context-subtask-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
    .context-subtask-eyebrow{margin-bottom:5px;color:var(--accent,#7666a8);font-size:11px;font-weight:700;letter-spacing:.08em}
    .context-subtask-head h2{margin:0;font-size:19px;line-height:1.3}
    .context-subtask-head p{max-width:360px;margin:6px 0 0;color:var(--muted,#6b7280);font-size:12px;line-height:1.45;overflow-wrap:anywhere}
    .context-subtask-close{flex:0 0 auto;width:34px;height:34px;padding:0;border:0;border-radius:50%;background:var(--panel-soft,#f3f5f7);color:var(--muted,#6b7280);font:inherit;font-size:22px;line-height:1;cursor:pointer}
    .context-subtask-list{display:grid;gap:8px}
    .context-subtask-row{display:grid;grid-template-columns:minmax(0,1fr) 38px;gap:7px;align-items:center}
    .context-subtask-row input{width:100%;min-width:0;height:42px;padding:0 12px;border:1px solid var(--line,#d2d7df);border-radius:10px;background:var(--card,#fff);color:var(--text,#1f2328);font:inherit;font-size:13px;outline:none}
    .context-subtask-row input:focus{border-color:var(--accent,#7666a8);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#7666a8) 12%,transparent)}
    .context-subtask-remove{width:38px;height:38px;padding:0;border:0;border-radius:9px;background:transparent;color:var(--muted,#6b7280);font:inherit;font-size:19px;cursor:pointer}
    .context-subtask-remove:hover,.context-subtask-remove:focus-visible{background:var(--panel-soft,#f3f5f7);color:var(--danger,#c84a4a);outline:none}
    .context-subtask-add{justify-self:start;padding:7px 3px;border:0;background:transparent;color:var(--accent-dark,#684789);font:inherit;font-size:12px;font-weight:700;cursor:pointer}
    .context-subtask-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:2px}
    .context-subtask-actions button{min-width:72px;height:40px;padding:0 15px;border-radius:10px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
    .context-subtask-cancel{border:1px solid var(--line,#d2d7df);background:var(--card,#fff);color:var(--muted,#6b7280)}
    .context-subtask-save{border:1px solid var(--accent,#7666a8);background:var(--accent,#7666a8);color:#fff}
    .context-subtask-save:disabled{opacity:.55;cursor:wait}
    @media (pointer:coarse){[data-context-kind][data-context-id]{-webkit-touch-callout:none}}
    @media (max-width:560px){.context-subtask-dialog form{padding:18px 16px}.context-subtask-row{grid-template-columns:minmax(0,1fr) 42px}.context-subtask-row input{height:46px}.context-subtask-remove{width:42px;height:42px}.context-subtask-actions button{height:44px}}
  `;
  document.head.appendChild(style);

  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-context-action]");
    if (!button) return;
    const action = button.dataset.contextAction;
    if (action === "today") moveTarget(0);
    else if (action === "tomorrow") moveTarget(1);
    else if (action === "toggle-habit") toggleHabitTarget();
    else if (action === "subtasks") openSubtaskDialog();
    else if (action === "duplicate") duplicateTarget();
    else if (action === "hero-dday") toggleHeroDday();
    else if (action === "secondary-dday") toggleHomeDdaySecondary(currentTarget?.kind || "", currentTarget?.id || "");
    else if (action === "ddays") {
      $("#contextGroupList")?.classList.add("hidden");
      $("#contextProjectList")?.classList.add("hidden");
      $("#contextDdayList")?.classList.toggle("hidden");
      const rect = menu.getBoundingClientRect();
      const currentTop = Number.parseFloat(menu.style.top) || 8;
      menu.style.top = `${Math.max(8, Math.min(currentTop, innerHeight - rect.height - 8))}px`;
    }
    else if (action === "session-time") { const target = currentTarget; hideMenu(); if (target?.kind === "session") document.dispatchEvent(new CustomEvent("onekan:edit-session", { detail: { id: target.id } })); }
    else if (action === "groups") {
      $("#contextProjectList")?.classList.add("hidden");
      $("#contextGroupList")?.classList.toggle("hidden");
      const rect = menu.getBoundingClientRect();
      const currentTop = Number.parseFloat(menu.style.top) || 8;
      menu.style.top = `${Math.max(8, Math.min(currentTop, innerHeight - rect.height - 8))}px`;
    }
    else if (action === "projects") {
      $("#contextGroupList")?.classList.add("hidden");
      $("#contextProjectList")?.classList.toggle("hidden");
      const rect = menu.getBoundingClientRect();
      const currentTop = Number.parseFloat(menu.style.top) || 8;
      menu.style.top = `${Math.max(8, Math.min(currentTop, innerHeight - rect.height - 8))}px`;
    }
    else if (action === "delete") deleteTarget();
  });
  menu.addEventListener("click", (event) => {
    const groupButton = event.target.closest("[data-context-group-id]");
    if (groupButton) return changeTargetGroup(groupButton.dataset.contextGroupId);
    const projectButton = event.target.closest("[data-context-project-id]");
    if (projectButton) return changeTargetProject(projectButton.dataset.contextProjectId || "");
    const heroButton = event.target.closest("[data-context-dday-hero-kind][data-context-dday-hero-id]");
    if (heroButton) return changeHomeDdayHero(heroButton.dataset.contextDdayHeroKind || "", heroButton.dataset.contextDdayHeroId || "");
    const secondaryButton = event.target.closest("[data-context-dday-secondary-kind][data-context-dday-secondary-id]");
    if (secondaryButton) toggleHomeDdaySecondary(secondaryButton.dataset.contextDdaySecondaryKind || "", secondaryButton.dataset.contextDdaySecondaryId || "");
  });

  subtaskDialog.addEventListener("click", (event) => {
    if (event.target === subtaskDialog) subtaskDialog.close();
    if (event.target.closest("[data-context-subtask-cancel]")) subtaskDialog.close();
    if (event.target.closest("[data-context-subtask-add]")) addSubtaskEditorRow({}, { focus: true });
    const remove = event.target.closest("[data-context-subtask-remove]");
    if (remove) {
      remove.closest("[data-context-subtask-row]")?.remove();
      if (!$("[data-context-subtask-row]", subtaskDialog)) addSubtaskEditorRow({}, { focus: true });
    }
  });
  subtaskDialog.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.target.matches(".context-subtask-row input")) return;
    event.preventDefault();
    const row = event.target.closest("[data-context-subtask-row]");
    const nextInput = row?.nextElementSibling?.querySelector("input");
    if (nextInput) nextInput.focus();
    else addSubtaskEditorRow({}, { focus: true });
  });
  $("#contextSubtaskForm")?.addEventListener("submit", saveTaskSubtasks);
  subtaskDialog.addEventListener("close", () => {
    const form = $("#contextSubtaskForm");
    if (form) delete form.dataset.taskId;
  });

}

function installListeners() {
  if (document.documentElement.dataset.contextMenuWired) return;
  document.documentElement.dataset.contextMenuWired = "1";

  document.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || !itemClickSuppressed() || !isSupportedSurface(element)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("contextmenu", async (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element.closest("input,textarea,select,[contenteditable='true']") || !isSupportedSurface(element)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const current = await readState();
      if (!current) return;
      const target = resolveDirect(element) || resolveByPosition(element, current.state);
      if (!target) return;
      showMenu(event.clientX, event.clientY, target, current.state);
    } catch (error) {
      console.error("오른쪽 클릭 메뉴 연결 실패", error);
    }
  }, true);

  document.addEventListener("click", async (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    if (itemClickSuppressed() && isSupportedSurface(element)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (element.closest("button,input,textarea,select,a,summary,[contenteditable='true']")) return;
    const editable = element.closest([
      "[data-context-kind][data-context-id]",
      "#tasksPageList .workspace-task[data-context-kind='task']",
      "#habitHistory .habit-matrix-row[data-context-kind='habit']",
      "#habitTemplateList .template-row",
      "#habitList .row",
      "#upcomingList .row",
      "#calendarBody .cal-event",
      "#calendarBody .day-timed-event",
      "#calendarBody .day-list .row",
      "#calendarBody .multi-entry[data-context-kind]",
      ".project-row[data-project-id]",
      "#todaySessions .history-row",
      "#allSessions .history-row",
    ].join(","));
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    try {
      const current = await readState();
      const target = resolveDirect(editable) || resolveByPosition(editable, current?.state);
      if (!target) return;
      startInlineEdit(editable, target, current.state);
    } catch (error) {
      console.error("클릭 수정 연결 실패", error);
    }
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.("#globalContextMenu")) hideMenu();
    if (event.pointerType === "mouse") return;
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element.closest("button,input,textarea,select,a,[contenteditable='true']") || !isSupportedSurface(element)) return;
    clearTimeout(longPressTimer);
    const press = { x: event.clientX, y: event.clientY, element };
    longPressStart = press;
    longPressTimer = setTimeout(async () => {
      try {
        if (press.element.closest(".uw-drag-ready,.uw-dragging")) return;
        const current = await readState();
        const target = resolveDirect(press.element) || resolveByPosition(press.element, current?.state);
        if (!target) return;
        suppressClickUntil = Date.now() + 800;
        showMenu(press.x, press.y, target, current.state);
        navigator.vibrate?.(12);
      } catch (error) {
        console.error("길게 누르기 메뉴 연결 실패", error);
      } finally {
        longPressTimer = null;
        longPressStart = null;
      }
    }, 550);
  }, true);
  document.addEventListener("pointermove", (event) => {
    if (!longPressStart) return;
    if (Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 10) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressStart = null;
    }
  }, true);
  const cancelLongPress = () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  };
  document.addEventListener("pointerup", cancelLongPress, true);
  document.addEventListener("pointercancel", cancelLongPress, true);
  document.addEventListener("scroll", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("#globalContextMenu")) return;
    hideMenu();
  }, true);
  window.addEventListener("resize", hideMenu);
  window.addEventListener("blur", hideMenu);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideMenu(); });
}

function init() {
  ensureUI();
  installListeners();
}

init();

supabase.auth.onAuthStateChange((_event, session) => {
  if (!session?.user) hideMenu();
});
