import { supabase } from "./supabase.js";

const ROW_SELECTOR = ".uw-list .uw-item[data-id], .uw-all-day-list .uw-item[data-id]";
const BOOKMARK_CLASS = "onekan-project-bookmark";

let appState = emptyState();
let activeButton = null;
let decorateQueued = false;
let refreshTimer = 0;

function emptyState() {
  return { tasks: [], habitTemplates: [], projects: [], directionGoals: [], identities: [] };
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    tasks: array(source.tasks),
    habitTemplates: array(source.habitTemplates),
    projects: array(source.projects),
    directionGoals: array(source.directionGoals),
    identities: array(source.identities),
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

async function refreshState() {
  window.clearTimeout(refreshTimer);
  try {
    const { data: authData } = await supabase.auth.getSession();
    const user = authData?.session?.user;
    if (!user) {
      appState = emptyState();
      closePopover();
      scheduleDecorate();
      return;
    }
    const { data, error } = await supabase
      .from("onekan_state")
      .select("data")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    appState = normalizeState(data?.data);
    closePopover();
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
  document.addEventListener("click", (event) => {
    const button = event.target.closest(`.${BOOKMARK_CLASS}`);
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      if (button === activeButton) closePopover();
      else openPopover(button);
      return;
    }
    if (!event.target.closest("#onekanProjectBookmarkPopover")) closePopover();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopover();
  });
  window.addEventListener("resize", closePopover, { passive: true });
  window.addEventListener("scroll", closePopover, { passive: true, capture: true });
  window.addEventListener("onekan:state-changed", queueRefresh);
  supabase.auth.onAuthStateChange(() => queueRefresh());
  new MutationObserver(scheduleDecorate).observe(document.body, { childList: true, subtree: true });
  refreshState();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
