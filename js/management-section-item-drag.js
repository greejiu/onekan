import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let state = null;
let user = null;
let drag = null;
let holdTimer = null;
let renderTimer = null;
let pendingMove = null;

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  const next = data?.data && typeof data.data === "object" ? data.data : {};
  next.managementSections = Array.isArray(next.managementSections) ? next.managementSections : [];
  next.managementGroups = Array.isArray(next.managementGroups) ? next.managementGroups : [];
  next.managementItems = Array.isArray(next.managementItems) ? next.managementItems : [];
  state = next;
  return state;
}

async function saveState() {
  if (!state || !user) return;
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management-section-item-drag" } }));
}

function ensureMenu() {
  if ($("#managementSectionMoveMenu")) return;
  const menu = document.createElement("div");
  menu.id = "managementSectionMoveMenu";
  menu.className = "management-context";
  document.body.appendChild(menu);
}

function closeMenu() {
  $("#managementSectionMoveMenu")?.classList.remove("open");
  pendingMove = null;
}

function clearTargets() {
  $$("#page-management .management-section-board.management-section-drop-target").forEach((card) => card.classList.remove("management-section-drop-target"));
}

function targetSectionAt(x, y) {
  const node = document.elementFromPoint(x, y);
  return node?.closest?.("#page-management .management-section-board[data-management-section-id]") || null;
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

async function decorateOverview() {
  const page = $("#page-management");
  if (!page || !$(".management-section-board-grid", page)) return;
  try {
    await readState();
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

function scheduleDecorate(delay = 40) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(decorateOverview, delay);
}

async function moveItemToGroup(itemId, sectionId, groupId) {
  await readState();
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  const group = state?.managementGroups.find((entry) => entry.id === groupId && entry.sectionId === sectionId);
  if (!item || !group) return;
  item.sectionId = sectionId;
  item.groupId = groupId;
  await saveState();
  showToast(`‘${item.title}’ 항목을 이동했어요.`);
  scheduleDecorate(120);
}

function openGroupChooser(itemId, sectionId, groups, x, y) {
  ensureMenu();
  const menu = $("#managementSectionMoveMenu");
  pendingMove = { itemId, sectionId };
  menu.innerHTML = `<strong class="management-context-label">어느 그룹으로 옮길까요?</strong>${groups.map((group) => `<button data-management-section-move-group="${group.id}" type="button">${String(group.name ?? "")}</button>`).join("")}`;
  menu.style.left = `${Math.max(8, Math.min(innerWidth - 210, x))}px`;
  menu.style.top = `${Math.max(8, Math.min(innerHeight - Math.min(300, 48 + groups.length * 36), y))}px`;
  menu.classList.add("open");
}

async function handleSectionDrop(itemId, targetSectionId, x, y) {
  await readState();
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  if (!item || !targetSectionId || item.sectionId === targetSectionId) return;
  const groups = state.managementGroups.filter((group) => group.sectionId === targetSectionId);
  if (!groups.length) {
    showToast("이 섹션에 그룹을 먼저 만들어 주세요.");
    return;
  }
  if (groups.length === 1) {
    await moveItemToGroup(itemId, targetSectionId, groups[0].id);
    return;
  }
  openGroupChooser(itemId, targetSectionId, groups, x, y);
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
  closeMenu();
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
  if (event.pointerType === "touch") {
    holdTimer = setTimeout(beginActiveDrag, 420);
  }
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
    await handleSectionDrop(current.itemId, sectionId, event.clientX, event.clientY);
  } catch (error) {
    console.error("management cross-section move failed", error);
    showToast("섹션 이동 중 오류가 났어요.");
  }
}, true);

document.addEventListener("pointercancel", (event) => {
  if (drag && event.pointerId === drag.pointerId) resetDrag();
}, true);

document.addEventListener("click", async (event) => {
  const choice = event.target.closest?.("[data-management-section-move-group]");
  if (choice && pendingMove) {
    const move = pendingMove;
    const groupId = choice.dataset.managementSectionMoveGroup || "";
    closeMenu();
    try {
      await moveItemToGroup(move.itemId, move.sectionId, groupId);
    } catch (error) {
      console.error("management group choice move failed", error);
      showToast("항목 이동 중 오류가 났어요.");
    }
    return;
  }
  if (!event.target.closest?.("#managementSectionMoveMenu")) closeMenu();
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

ensureMenu();
const observer = new MutationObserver(() => scheduleDecorate(30));
const pageObserverTarget = $("#page-management") || document.body;
observer.observe(pageObserverTarget, { childList: true, subtree: true });
document.addEventListener("onekan:state-changed", () => scheduleDecorate(70));
supabase.auth.onAuthStateChange(() => scheduleDecorate(100));
scheduleDecorate(100);
