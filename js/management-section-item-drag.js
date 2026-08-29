import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let state = null;
let user = null;
let drag = null;
let holdTimer = null;
let renderTimer = null;

function flatGroupId(sectionId) {
  return `management-flat-${sectionId}`;
}

function normalizeState(raw) {
  const next = raw && typeof raw === "object" ? raw : {};
  next.managementSections = Array.isArray(next.managementSections) ? next.managementSections : [];
  next.managementGroups = Array.isArray(next.managementGroups) ? next.managementGroups : [];
  next.managementItems = Array.isArray(next.managementItems) ? next.managementItems : [];
  return next;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = normalizeState(data?.data);
  return state;
}

function ensureFlatGroup(sectionId) {
  const id = flatGroupId(sectionId);
  let group = state.managementGroups.find((entry) => entry.id === id);
  if (!group) {
    group = { id, sectionId, name: "기본", system: true, hidden: true, createdAt: new Date().toISOString() };
    state.managementGroups.push(group);
  }
  return group;
}

async function saveState() {
  if (!state || !user) return;
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management-section-item-drag" } }));
}

function clearTargets() {
  $$("#page-management .management-section-board.management-section-drop-target").forEach((card) => card.classList.remove("management-section-drop-target"));
}

function targetSectionAt(x, y) {
  return document.elementFromPoint(x, y)?.closest?.("#page-management .management-section-board[data-management-section-id]") || null;
}

function markTarget(card) {
  clearTargets();
  card?.classList.add("management-section-drop-target");
}

function resetDrag() {
  clearTimeout(holdTimer);
  holdTimer = null;
  if (drag?.itemEl) drag.itemEl.classList.remove("management-section-item-dragging");
  clearTargets();
  drag = null;
}

async function decorateOverview({ refresh = false } = {}) {
  const page = $("#page-management");
  if (!page || !$(".management-section-board-grid", page)) return;
  try {
    if (refresh || !state) await readState();
    if (!state) return;
    $$(".management-section-board[data-management-section-id]", page).forEach((card) => {
      const sectionId = card.dataset.managementSectionId || "";
      const items = state.managementItems.filter((item) => item.sectionId === sectionId).slice(0, 5);
      $$(".management-section-board-item", card).forEach((node, index) => {
        const item = items[index];
        if (!item) {
          delete node.dataset.managementOverviewItemId;
          return;
        }
        node.dataset.managementOverviewItemId = item.id;
        node.title = "다른 섹션으로 드래그해서 이동";
      });
    });
  } catch (error) {
    console.error("management section item drag decoration failed", error);
  }
}

function scheduleDecorate(delay = 40, refresh = false) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => decorateOverview({ refresh }), delay);
}

async function moveItem(itemId, sectionId) {
  await readState();
  if (!state || !state.managementSections.some((entry) => entry.id === sectionId)) return;
  const item = state.managementItems.find((entry) => entry.id === itemId);
  if (!item || item.sectionId === sectionId) return;
  const group = ensureFlatGroup(sectionId);
  item.sectionId = sectionId;
  item.groupId = group.id;
  await saveState();
  showToast(`‘${item.title}’ 항목을 이동했어요.`);
  scheduleDecorate(100, false);
}

function beginActiveDrag() {
  if (!drag || drag.active) return;
  drag.active = true;
  drag.itemEl.classList.add("management-section-item-dragging");
  try { drag.itemEl.setPointerCapture(drag.pointerId); } catch {}
  markTarget(targetSectionAt(drag.x, drag.y));
  if (navigator.vibrate && drag.pointerType === "touch") navigator.vibrate(20);
}

document.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  const itemEl = event.target.closest?.("#page-management .management-section-board-item[data-management-overview-item-id]");
  if (!itemEl) return;
  drag = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    itemId: itemEl.dataset.managementOverviewItemId || "",
    itemEl,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    active: false,
  };
  if (event.pointerType === "touch") holdTimer = setTimeout(beginActiveDrag, 420);
}, true);

document.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX;
  drag.y = event.clientY;
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.active) {
    if (drag.pointerType === "touch") {
      if (distance > 8) resetDrag();
      return;
    }
    if (distance < 6) return;
    beginActiveDrag();
  }
  if (!drag?.active) return;
  if (event.cancelable) event.preventDefault();
  markTarget(targetSectionAt(event.clientX, event.clientY));
}, true);

document.addEventListener("pointerup", async (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const current = drag;
  const card = current.active ? targetSectionAt(event.clientX, event.clientY) : null;
  const sectionId = card?.dataset.managementSectionId || "";
  if (current.active && event.cancelable) event.preventDefault();
  resetDrag();
  if (!current.active || !sectionId) return;
  try {
    await moveItem(current.itemId, sectionId);
  } catch (error) {
    console.error("management cross-section move failed", error);
    showToast("섹션 이동 중 오류가 났어요.");
  }
}, true);

document.addEventListener("pointercancel", (event) => {
  if (drag && event.pointerId === drag.pointerId) resetDrag();
}, true);

const style = document.createElement("style");
style.dataset.managementSectionItemDrag = "1";
style.textContent = `
#page-management .management-section-board-item[data-management-overview-item-id]{cursor:grab;user-select:none}
#page-management .management-section-board-item[data-management-overview-item-id]:active{cursor:grabbing}
#page-management .management-section-board-item.management-section-item-dragging{opacity:.45}
#page-management .management-section-board.management-section-drop-target{outline:2px solid color-mix(in srgb,var(--accent,#7c75d8) 75%,transparent);outline-offset:2px;background:color-mix(in srgb,var(--surface,#fff) 90%,var(--accent,#7c75d8) 10%)}
`;
document.head.appendChild(style);

const managementPage = $("#page-management");
if (managementPage) {
  const observer = new MutationObserver(() => scheduleDecorate(30, false));
  observer.observe(managementPage, { childList: true, subtree: true });
}
document.addEventListener("onekan:state-changed", () => scheduleDecorate(70, true));
supabase.auth.onAuthStateChange(() => scheduleDecorate(100, true));
scheduleDecorate(100, true);
