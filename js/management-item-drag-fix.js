import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let drag = null;
let suppressClickUntil = 0;
let renderTimer = null;

function isFinePointer(event) {
  return event.pointerType === "mouse" || event.pointerType === "pen" || matchMedia("(hover:hover) and (pointer:fine)").matches;
}

function clearTargets() {
  $$("#page-management .management-group.management-drop-target").forEach((group) => group.classList.remove("management-drop-target"));
}

function targetGroupAt(x, y) {
  const node = document.elementFromPoint(x, y);
  return node?.closest?.("#page-management .management-group") || null;
}

function markTarget(group) {
  clearTargets();
  group?.classList.add("management-drop-target");
}

function resetDrag() {
  if (drag?.itemEl) drag.itemEl.classList.remove("management-item-dragging");
  clearTargets();
  drag = null;
}

async function moveItem(itemId, groupId) {
  if (!itemId || !groupId) return;
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.managementItems = Array.isArray(state.managementItems) ? state.managementItems : [];
  state.managementGroups = Array.isArray(state.managementGroups) ? state.managementGroups : [];

  const item = state.managementItems.find((entry) => entry.id === itemId);
  const group = state.managementGroups.find((entry) => entry.id === groupId);
  if (!item || !group || item.groupId === group.id) return;
  if (item.sectionId && item.sectionId !== group.sectionId) {
    showToast("현재는 같은 섹션 안에서만 드래그 이동할 수 있어요.");
    return;
  }

  item.groupId = group.id;
  item.sectionId = group.sectionId;

  const { error: saveError } = await supabase
    .from("onekan_state")
    .upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (saveError) throw saveError;

  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management-item-drag-fix" } }));
  $("#reloadCloudBtn")?.click();
}

function disableNativeDragging() {
  $$("#page-management .management-item[draggable]").forEach((item) => item.removeAttribute("draggable"));
}

function scheduleDisable() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(disableNativeDragging, 20);
}

document.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0 || !isFinePointer(event)) return;
  if (event.target.closest?.("[data-management-schedule-tool],.management-schedule-popover,[data-management-history-open],.management-history-popover")) return;
  const itemEl = event.target.closest?.("#page-management .management-item[data-management-item-id]");
  if (!itemEl || event.target.closest("input,select,textarea")) return;

  drag = {
    pointerId: event.pointerId,
    itemId: itemEl.dataset.managementItemId || "",
    itemEl,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    active: false,
  };
}, true);

document.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX;
  drag.y = event.clientY;

  if (!drag.active) {
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance < 6) return;
    drag.active = true;
    drag.itemEl.classList.add("management-item-dragging");
    try { drag.itemEl.setPointerCapture(event.pointerId); } catch {}
  }

  event.preventDefault();
  markTarget(targetGroupAt(event.clientX, event.clientY));
}, true);

document.addEventListener("pointerup", async (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const current = drag;
  const group = current.active ? targetGroupAt(event.clientX, event.clientY) : null;
  const groupId = group?.dataset.managementGroupId || "";

  if (current.active) {
    event.preventDefault();
    event.stopPropagation();
    suppressClickUntil = Date.now() + 450;
  }

  resetDrag();

  if (current.active && groupId) {
    try {
      await moveItem(current.itemId, groupId);
    } catch (error) {
      console.error("management item drag move failed", error);
      showToast("항목 이동 중 오류가 났어요.");
    }
  }
}, true);

document.addEventListener("pointercancel", (event) => {
  if (drag && event.pointerId === drag.pointerId) resetDrag();
}, true);

document.addEventListener("click", (event) => {
  if (Date.now() > suppressClickUntil) return;
  if (!event.target.closest?.("#page-management .management-item")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

const observer = new MutationObserver(scheduleDisable);
observer.observe(document.body, { childList: true, subtree: true });
document.addEventListener("onekan:state-changed", scheduleDisable);
scheduleDisable();
