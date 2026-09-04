import { onekanStateStore, supabase } from "./supabase.js?v=1";

const ROW_SELECTOR = ".uw-list .uw-item[data-id], .uw-all-day-list .uw-item[data-id]";
const BOOKMARK_CLASS = "onekan-project-bookmark";
const PROJECT_BOOK_SELECTOR = ".onekan-project-book[data-project-edit][data-context-kind='project']";
const MOBILE_QUERY = "(max-width: 700px)";

let appState = emptyState();
let activeButton = null;
let decorateQueued = false;
let refreshTimer = 0;
let activeProjectBook = null;
let activeProjectId = null;
let contextProjectId = null;
let allowProjectEditClick = false;
let openRequestId = 0;
let sheetDrag = null;

function emptyState() {
  return { tasks: [], habitTemplates: [], habitDays: {}, projects: [], directionGoals: [], identities: [], eventGroups: [] };
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    tasks: array(source.tasks),
    habitTemplates: array(source.habitTemplates),
    habitDays: object(source.habitDays),
    projects: array(source.projects),
    directionGoals: array(source.directionGoals),
    identities: array(source.identities),
    eventGroups: array(source.eventGroups),
  };
}

function byId(items, id) {
  const key = String(id || "");
  return items.find((item) => String(item?.id || "") === key) || null;
}

function itemForRow(row) {
  const id = row?.dataset?.id;
  return byId(appState.tasks, id) || byId(appState.habitTemplates, id);
}

function connectionForItem(item) {
  if (!item?.projectId) return null;
  const project = byId(appState.projects, item.projectId);
  if (!project) return null;
  const goal = project.goalId ? byId(appState.directionGoals, project.goalId) : null;
  const identity = goal?.identityId ? byId(appState.identities, goal.identityId) : null;
  return { project, goal, identity };
}

function label(item, fallback) {
  const value = item?.title || item?.text || item?.name;
  return String(value || fallback);
}

function bookmarkIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.75c0-.97.78-1.75 1.75-1.75h6.5C16.22 3 17 3.78 17 4.75V21l-5-3.2L7 21V4.75Z"></path></svg>`;
}

function makeBookmark(row, connection) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BOOKMARK_CLASS;
  button.setAttribute("aria-label", "연결 정보 보기");
  button.setAttribute("aria-expanded", "false");
  button.dataset.itemId = String(row.dataset.id || "");
  button.dataset.projectId = String(connection.project.id || "");
  button.innerHTML = bookmarkIcon();
  return button;
}

function decorateRows() {
  document.querySelectorAll(ROW_SELECTOR).forEach((row) => {
    if (row.classList.contains("uw-time-entry")) return;
    const connection = connectionForItem(itemForRow(row));
    const existing = row.querySelector(`:scope > .${BOOKMARK_CLASS}`);
    if (!connection) {
      if (existing === activeButton) closePopover();
      existing?.remove();
      return;
    }
    if (existing) {
      existing.dataset.itemId = String(row.dataset.id || "");
      existing.dataset.projectId = String(connection.project.id || "");
      return;
    }
    row.append(makeBookmark(row, connection));
  });
}

function scheduleDecorate() {
  if (decorateQueued) return;
  decorateQueued = true;
  requestAnimationFrame(() => {
    decorateQueued = false;
    decorateRows();
  });
}

function popover() {
  let node = document.getElementById("onekanProjectBookmarkPopover");
  if (node) return node;
  node = document.createElement("aside");
  node.id = "onekanProjectBookmarkPopover";
  node.className = "onekan-project-popover";
  node.setAttribute("role", "dialog");
  node.setAttribute("aria-label", "프로젝트 연결 정보");
  node.hidden = true;
  node.innerHTML = `
    <div class="onekan-project-popover-title">연결 정보</div>
    <dl class="onekan-project-chain">
      <div><dt>프로젝트</dt><dd data-chain-project></dd></div>
      <div><dt>목표</dt><dd data-chain-goal></dd></div>
      <div><dt>정체성</dt><dd data-chain-identity></dd></div>
    </dl>`;
  document.body.append(node);
  return node;
}

function positionPopover(button, node) {
  const gap = 7;
  const edge = 10;
  const anchor = button.getBoundingClientRect();
  node.style.left = `${edge}px`;
  node.style.top = `${edge}px`;
  node.hidden = false;
  const box = node.getBoundingClientRect();
  let left = anchor.right - box.width;
  left = Math.max(edge, Math.min(left, window.innerWidth - box.width - edge));
  let top = anchor.bottom + gap;
  if (top + box.height > window.innerHeight - edge) top = anchor.top - box.height - gap;
  top = Math.max(edge, Math.min(top, window.innerHeight - box.height - edge));
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

function closePopover() {
  const node = document.getElementById("onekanProjectBookmarkPopover");
  if (node) node.hidden = true;
  if (activeButton) activeButton.setAttribute("aria-expanded", "false");
  activeButton = null;
}

function openPopover(button) {
  const item = byId(appState.tasks, button.dataset.itemId) || byId(appState.habitTemplates, button.dataset.itemId);
  const connection = connectionForItem(item);
  if (!connection) {
    closePopover();
    scheduleDecorate();
    return;
  }
  const node = popover();
  node.querySelector("[data-chain-project]").textContent = label(connection.project, "이름 없는 프로젝트");
  node.querySelector("[data-chain-goal]").textContent = label(connection.goal, "연결 없음");
  node.querySelector("[data-chain-identity]").textContent = label(connection.identity, "연결 없음");
  if (activeButton && activeButton !== button) activeButton.setAttribute("aria-expanded", "false");
  activeButton = button;
  button.setAttribute("aria-expanded", "true");
  positionPopover(button, node);
}

function projectLayer() {
  let layer = document.getElementById("onekanProjectLinkedLayer");
  if (layer) return layer;
  layer = document.createElement("div");
  layer.id = "onekanProjectLinkedLayer";
  layer.className = "onekan-project-linked-layer";
  layer.hidden = true;
  layer.innerHTML = `
    <button class="onekan-project-linked-backdrop" type="button" data-project-linked-close aria-label="연결 항목 닫기"></button>
    <section class="onekan-project-linked-panel" role="dialog" aria-modal="true" aria-labelledby="onekanProjectLinkedTitle">
      <div class="onekan-project-linked-drag-zone" data-project-linked-drag aria-hidden="true"><span></span></div>
      <header class="onekan-project-linked-head">
        <div class="onekan-project-linked-heading">
          <span class="onekan-project-linked-kicker">PROJECT</span>
          <h2 id="onekanProjectLinkedTitle">프로젝트</h2>
          <p data-project-linked-meta></p>
        </div>
        <button class="onekan-project-linked-close" type="button" data-project-linked-close aria-label="닫기">×</button>
      </header>
      <div class="onekan-project-linked-scroll" data-project-linked-body></div>
    </section>`;
  document.body.append(layer);
  return layer;
}

function projectPanel() {
  return projectLayer().querySelector(".onekan-project-linked-panel");
}

function todayKey() {
  const date = new Date();
  date.setHours(date.getHours() - 3);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function projectStatusLabel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["before", "시작 전", "시작전", "todo", "planned"].includes(raw)) return "시작 전";
  if (["done", "완료", "달성", "complete", "completed"].includes(raw)) return "완료";
  if (["archived", "보관", "closed", "archive"].includes(raw)) return "보관";
  return "진행 중";
}

function projectGroupName(project) {
  return byId(appState.eventGroups, project?.groupId)?.name || "기본";
}

function taskDateLabel(task) {
  const value = task?.date || task?.completedDate || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return task?.done ? "완료" : "날짜 없음";
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일${task?.done ? " · 완료" : ""}`;
}

function repeatLabel(item) {
  const recurrence = item?.recurrence || item?.repeatRule || null;
  if (!recurrence?.frequency || recurrence.frequency === "none") return "반복";
  const interval = Math.max(1, Number(recurrence.interval || 1));
  if (recurrence.frequency === "daily") return interval === 1 ? "매일" : `${interval}일마다`;
  if (recurrence.frequency === "weekly") return interval === 1 ? "매주" : `${interval}주마다`;
  if (recurrence.frequency === "monthly") return interval === 1 ? "매월" : `${interval}개월마다`;
  return "반복";
}

function habitTodayLabel(item) {
  const today = todayKey();
  const checks = object(appState.habitDays?.[today]);
  if (Object.prototype.hasOwnProperty.call(checks, item?.id)) return checks[item.id] ? "오늘 완료" : "오늘 미완료";
  if (item?.date === today) return item?.done ? "오늘 완료" : "오늘 예정";
  return "";
}

function linkedItems(projectId) {
  const taskRows = appState.tasks.filter((item) => item?.projectId === projectId && !item?.isHabit);
  const taskHabits = appState.tasks.filter((item) => item?.projectId === projectId && item?.isHabit);
  const seen = new Set(taskHabits.map((item) => String(item?.id || "")));
  const legacyHabits = appState.habitTemplates.filter((item) => item?.projectId === projectId && !seen.has(String(item?.id || "")));
  const tasks = [...taskRows].sort((a, b) => Number(Boolean(a?.done)) - Number(Boolean(b?.done)) || String(a?.date || "9999-99-99").localeCompare(String(b?.date || "9999-99-99")) || label(a, "").localeCompare(label(b, ""), "ko"));
  const habits = [...taskHabits, ...legacyHabits].sort((a, b) => label(a, "").localeCompare(label(b, ""), "ko"));
  return { tasks, habits };
}

function linkedTaskMarkup(task) {
  const done = Boolean(task?.done);
  return `<div class="onekan-project-linked-item${done ? " is-done" : ""}">
    <span class="onekan-project-linked-check" aria-hidden="true">${done ? "✓" : ""}</span>
    <span class="onekan-project-linked-copy"><strong>${escapeHtml(label(task, "이름 없는 할일"))}</strong><small>${escapeHtml(taskDateLabel(task))}</small></span>
  </div>`;
}

function linkedHabitMarkup(habit) {
  const today = habitTodayLabel(habit);
  const repeat = repeatLabel(habit);
  return `<div class="onekan-project-linked-item is-habit">
    <span class="onekan-project-linked-repeat" aria-hidden="true">↻</span>
    <span class="onekan-project-linked-copy"><strong>${escapeHtml(label(habit, "이름 없는 습관"))}</strong><small>${escapeHtml([repeat, today].filter(Boolean).join(" · "))}</small></span>
  </div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function renderProjectLinked(projectId) {
  const layer = projectLayer();
  const body = layer.querySelector("[data-project-linked-body]");
  const title = layer.querySelector("#onekanProjectLinkedTitle");
  const meta = layer.querySelector("[data-project-linked-meta]");
  const project = byId(appState.projects, projectId);
  if (!project) {
    title.textContent = "프로젝트";
    meta.textContent = "";
    body.innerHTML = '<div class="onekan-project-linked-empty"><strong>프로젝트를 찾지 못했어요.</strong><span>목록을 새로고침한 뒤 다시 열어주세요.</span></div>';
    return;
  }

  const { tasks, habits } = linkedItems(projectId);
  title.textContent = label(project, "이름 없는 프로젝트");
  meta.textContent = `${projectGroupName(project)} · ${projectStatusLabel(project.status)}`;
  if (!tasks.length && !habits.length) {
    body.innerHTML = '<div class="onekan-project-linked-empty"><strong>아직 연결된 할일이나 습관이 없어요.</strong><span>할일·습관에서 프로젝트를 연결하면 여기에 자동으로 보여요.</span></div>';
    return;
  }

  body.innerHTML = `${tasks.length ? `<section class="onekan-project-linked-section"><div class="onekan-project-linked-section-head"><strong>할일</strong><span>${tasks.length}</span></div><div class="onekan-project-linked-list">${tasks.map(linkedTaskMarkup).join("")}</div></section>` : ""}${habits.length ? `<section class="onekan-project-linked-section"><div class="onekan-project-linked-section-head"><strong>습관</strong><span>${habits.length}</span></div><div class="onekan-project-linked-list">${habits.map(linkedHabitMarkup).join("")}</div></section>` : ""}`;
}

function positionProjectPanel(anchor) {
  const panel = projectPanel();
  panel.style.removeProperty("left");
  panel.style.removeProperty("top");
  panel.style.removeProperty("right");
  panel.style.removeProperty("bottom");
  panel.style.removeProperty("--onekan-sheet-drag");
  if (matchMedia(MOBILE_QUERY).matches || !anchor?.isConnected) return;

  const gap = 12;
  const edge = 12;
  const rect = anchor.getBoundingClientRect();
  panel.style.visibility = "hidden";
  panel.style.left = `${edge}px`;
  panel.style.top = `${edge}px`;
  requestAnimationFrame(() => {
    if (projectLayer().hidden || activeProjectBook !== anchor) return;
    const box = panel.getBoundingClientRect();
    let left = rect.right + gap;
    if (left + box.width > window.innerWidth - edge) left = rect.left - box.width - gap;
    if (left < edge) left = Math.max(edge, Math.min(rect.left, window.innerWidth - box.width - edge));
    let top = Math.max(edge, Math.min(rect.top, window.innerHeight - box.height - edge));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.visibility = "";
  });
}

function closeProjectLinked({ restoreFocus = true } = {}) {
  const layer = document.getElementById("onekanProjectLinkedLayer");
  if (layer) layer.hidden = true;
  const panel = layer?.querySelector(".onekan-project-linked-panel");
  if (panel) {
    panel.style.removeProperty("transform");
    panel.style.removeProperty("transition");
    panel.style.removeProperty("--onekan-sheet-drag");
  }
  if (activeProjectBook) activeProjectBook.setAttribute("aria-expanded", "false");
  const restore = activeProjectBook;
  activeProjectBook = null;
  activeProjectId = null;
  openRequestId += 1;
  if (restoreFocus && restore?.isConnected) requestAnimationFrame(() => restore.focus({ preventScroll: true }));
}

async function loadState() {
  const { data: authData } = await supabase.auth.getSession();
  const user = authData?.session?.user;
  if (!user) {
    appState = emptyState();
    return false;
  }
  const stored = await onekanStateStore.read({ userId: user.id });
  appState = normalizeState(stored);
  return true;
}

async function openProjectLinked(projectId, anchor) {
  if (!projectId || !anchor) return;
  const requestId = ++openRequestId;
  closePopover();
  if (activeProjectBook && activeProjectBook !== anchor) activeProjectBook.setAttribute("aria-expanded", "false");
  activeProjectBook = anchor;
  activeProjectId = projectId;
  anchor.setAttribute("aria-expanded", "true");
  const layer = projectLayer();
  const body = layer.querySelector("[data-project-linked-body]");
  layer.hidden = false;
  body.innerHTML = '<div class="onekan-project-linked-loading">연결된 항목을 불러오는 중…</div>';
  positionProjectPanel(anchor);
  try {
    await loadState();
    if (requestId !== openRequestId || activeProjectId !== projectId) return;
    renderProjectLinked(projectId);
    positionProjectPanel(anchor);
    requestAnimationFrame(() => layer.querySelector("[data-project-linked-close]")?.focus({ preventScroll: true }));
  } catch (error) {
    console.warn("프로젝트 연결 항목을 불러오지 못했습니다.", error);
    if (requestId !== openRequestId || activeProjectId !== projectId) return;
    body.innerHTML = '<div class="onekan-project-linked-empty"><strong>연결 항목을 불러오지 못했어요.</strong><span>잠시 후 다시 열어주세요.</span></div>';
  }
}

function ensureProjectEditAction() {
  const menu = document.getElementById("globalContextMenu");
  if (!menu) return null;
  let button = menu.querySelector("[data-project-quick-edit]");
  if (button) return button;
  button = document.createElement("button");
  button.type = "button";
  button.className = "hidden";
  button.dataset.projectQuickEdit = "1";
  button.setAttribute("role", "menuitem");
  button.textContent = "프로젝트 수정";
  menu.prepend(button);
  return button;
}

function projectEditElement(projectId) {
  const escaped = CSS.escape(String(projectId || ""));
  const contextual = document.querySelector(`[data-context-kind="project"][data-context-id="${escaped}"]`);
  if (contextual?.matches?.("[data-project-edit]")) return contextual;
  return contextual?.querySelector?.("[data-project-edit]") || document.querySelector(`[data-project-edit="${escaped}"]`);
}

function openProjectEditor(projectId) {
  const edit = projectEditElement(projectId);
  if (!edit) return;
  document.getElementById("globalContextMenu")?.classList.remove("open");
  closeProjectLinked({ restoreFocus: false });
  allowProjectEditClick = true;
  try {
    edit.click();
  } finally {
    allowProjectEditClick = false;
  }
}

function beginSheetDrag(event) {
  if (!matchMedia(MOBILE_QUERY).matches || !activeProjectId) return;
  const panel = projectPanel();
  sheetDrag = { pointerId: event.pointerId, startY: event.clientY, delta: 0 };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  panel.style.transition = "none";
}

function moveSheetDrag(event) {
  if (!sheetDrag || event.pointerId !== sheetDrag.pointerId) return;
  const delta = Math.max(0, event.clientY - sheetDrag.startY);
  sheetDrag.delta = delta;
  projectPanel().style.setProperty("--onekan-sheet-drag", `${Math.round(delta)}px`);
}

function endSheetDrag(event) {
  if (!sheetDrag || event.pointerId !== sheetDrag.pointerId) return;
  const { delta } = sheetDrag;
  sheetDrag = null;
  const panel = projectPanel();
  panel.style.transition = "transform .18s ease";
  if (delta >= 80) {
    panel.style.setProperty("--onekan-sheet-drag", "100dvh");
    window.setTimeout(() => closeProjectLinked(), 160);
  } else {
    panel.style.setProperty("--onekan-sheet-drag", "0px");
    window.setTimeout(() => panel.style.removeProperty("transition"), 200);
  }
}

async function refreshState() {
  window.clearTimeout(refreshTimer);
  try {
    const loaded = await loadState();
    if (!loaded) {
      closePopover();
      closeProjectLinked({ restoreFocus: false });
      scheduleDecorate();
      return;
    }
    closePopover();
    if (activeProjectId) renderProjectLinked(activeProjectId);
    scheduleDecorate();
  } catch (error) {
    console.warn("프로젝트 북마크 정보를 불러오지 못했습니다.", error);
  }
}

function queueRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshState, 80);
}

function init() {
  popover();
  const layer = projectLayer();
  ensureProjectEditAction();

  document.addEventListener("click", (event) => {
    const book = event.target.closest?.(PROJECT_BOOK_SELECTOR);
    if (book && !allowProjectEditClick) {
      event.preventDefault();
      event.stopPropagation();
      openProjectLinked(book.dataset.projectEdit, book);
      return;
    }

    const button = event.target.closest?.(`.${BOOKMARK_CLASS}`);
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      if (button === activeButton) closePopover();
      else openPopover(button);
      return;
    }

    if (event.target.closest?.("[data-project-linked-close]")) {
      event.preventDefault();
      closeProjectLinked();
      return;
    }

    const quickEdit = event.target.closest?.("[data-project-quick-edit]");
    if (quickEdit && contextProjectId) {
      event.preventDefault();
      event.stopPropagation();
      openProjectEditor(contextProjectId);
      return;
    }

    if (!event.target.closest?.("#onekanProjectBookmarkPopover")) closePopover();
  }, true);

  document.addEventListener("onekan:context-menu-opened", (event) => {
    const button = ensureProjectEditAction();
    const target = event.detail?.target;
    contextProjectId = target?.kind === "project" ? String(target.id || "") : null;
    button?.classList.toggle("hidden", !contextProjectId);
  });

  document.addEventListener("contextmenu", (event) => {
    const project = event.target.closest?.("[data-context-kind='project'][data-context-id]");
    if (!project) contextProjectId = null;
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!projectLayer().hidden) closeProjectLinked();
    else closePopover();
  });

  const dragZone = layer.querySelector("[data-project-linked-drag]");
  dragZone?.addEventListener("pointerdown", beginSheetDrag);
  dragZone?.addEventListener("pointermove", moveSheetDrag);
  dragZone?.addEventListener("pointerup", endSheetDrag);
  dragZone?.addEventListener("pointercancel", endSheetDrag);

  window.addEventListener("resize", () => {
    closePopover();
    if (activeProjectBook && !projectLayer().hidden) positionProjectPanel(activeProjectBook);
  }, { passive: true });
  window.addEventListener("scroll", closePopover, { passive: true, capture: true });
  document.addEventListener("onekan:state-changed", queueRefresh);
  supabase.auth.onAuthStateChange(() => queueRefresh());
  new MutationObserver(() => {
    scheduleDecorate();
    ensureProjectEditAction();
    if (activeProjectBook && !activeProjectBook.isConnected) closeProjectLinked({ restoreFocus: false });
  }).observe(document.body, { childList: true, subtree: true });
  refreshState();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
