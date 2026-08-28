import { supabase } from "./supabase.js";
import { confirmAction, showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => crypto.randomUUID();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

let state = null;
let user = null;
let activeAddGroupId = null;
let activeEditItemId = null;
let renderTimer = null;
let rendering = false;
let draggedItemId = null;
let touchDrag = null;
let touchHoldTimer = null;

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

async function writeState(mutator) {
  await readState();
  if (!state || !user) return;
  mutator(state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management-items" } }));
  $("#reloadCloudBtn")?.click();
  scheduleRender(80);
}

function ensureStyle() {
  if ($('link[data-onekan-management-items-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/management-items.css?v=2";
  link.dataset.onekanManagementItemsStyle = "1";
  document.head.appendChild(link);
}

function ensureContextMenu() {
  if ($("#managementItemContext")) return;
  const menu = document.createElement("div");
  menu.id = "managementItemContext";
  menu.className = "management-context management-item-context";
  document.body.appendChild(menu);
}

function itemFormMarkup(groupId, item = null) {
  const editing = Boolean(item);
  return `<form class="management-item-form" data-management-item-form data-group-id="${esc(groupId)}"${editing ? ` data-item-id="${esc(item.id)}"` : ""} autocomplete="off">
    <input type="text" maxlength="100" value="${esc(item?.title || "")}" placeholder="관리 항목 입력" aria-label="관리 항목 이름" required>
    <button class="primary-btn" type="submit">${editing ? "저장" : "추가"}</button>
    <button class="soft-btn" data-management-item-cancel type="button">취소</button>
  </form>`;
}

function itemMarkup(item) {
  if (activeEditItemId === item.id) return itemFormMarkup(item.groupId, item);
  return `<div class="management-item" draggable="true" data-management-item-id="${esc(item.id)}" data-management-item-group-id="${esc(item.groupId)}">
    <button class="management-item-title" data-management-item-edit="${esc(item.id)}" type="button">${esc(item.title)}</button>
  </div>`;
}

async function renderItems() {
  if (rendering || !$("#page-management")) return;
  rendering = true;
  try {
    await readState();
    if (!state) return;
    $$("#page-management .management-group").forEach((groupEl) => {
      const groupId = groupEl.dataset.managementGroupId;
      const sectionId = groupEl.closest(".management-section-detail")?.dataset.managementSectionId || "";
      const body = $(".management-group-body", groupEl);
      if (!groupId || !body) return;
      const items = state.managementItems.filter((item) => item.groupId === groupId && (!item.sectionId || item.sectionId === sectionId));
      const signature = JSON.stringify({
        groupId,
        items: items.map((item) => [item.id, item.title]),
        adding: activeAddGroupId === groupId,
        editing: activeEditItemId,
      });
      if (body.dataset.managementItemsSignature === signature) return;
      body.dataset.managementItemsSignature = signature;
      body.innerHTML = `<div class="management-item-list">${items.map(itemMarkup).join("")}</div>${activeAddGroupId === groupId ? itemFormMarkup(groupId) : `<button class="management-item-add" data-management-item-add="${esc(groupId)}" type="button">항목 추가하기&nbsp; ＋</button>`}`;
      const focus = body.querySelector(".management-item-form input");
      if (focus) requestAnimationFrame(() => { focus.focus(); if (activeEditItemId) focus.select(); });
    });
  } catch (error) {
    console.error("management items render failed", error);
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 40) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderItems, delay);
}

function closeContext() {
  $("#managementItemContext")?.classList.remove("open");
}

function openItemContext(itemId, x, y) {
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const menu = $("#managementItemContext");
  menu.dataset.itemId = itemId;
  menu.innerHTML = '<button data-management-item-action="edit" type="button">수정</button><button data-management-item-action="move" type="button">그룹 이동</button><button class="danger" data-management-item-action="delete" type="button">삭제</button>';
  menu.style.left = `${Math.max(8, Math.min(innerWidth - 170, x))}px`;
  menu.style.top = `${Math.max(8, Math.min(innerHeight - 132, y))}px`;
  menu.classList.add("open");
}

function openMoveContext(itemId, x, y) {
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const groups = state.managementGroups.filter((group) => group.sectionId === item.sectionId);
  const menu = $("#managementItemContext");
  menu.dataset.itemId = itemId;
  menu.innerHTML = `<strong class="management-context-label">그룹 이동</strong>${groups.map((group) => `<button data-management-item-move-group="${esc(group.id)}" type="button"${group.id === item.groupId ? " disabled" : ""}>${esc(group.name)}</button>`).join("")}`;
  menu.style.left = `${Math.max(8, Math.min(innerWidth - 180, x))}px`;
  menu.style.top = `${Math.max(8, Math.min(innerHeight - Math.min(260, 44 + groups.length * 34), y))}px`;
  menu.classList.add("open");
}

async function deleteItem(itemId) {
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const confirmed = await confirmAction({ title: `‘${item.title}’ 항목을 삭제할까요?`, message: "아직 실행 기록 기능을 붙이기 전이라 항목만 삭제돼요.", confirmLabel: "삭제" });
  if (!confirmed) return;
  await writeState((current) => {
    current.managementItems = current.managementItems.filter((entry) => entry.id !== itemId);
  });
}

function clearDropTargets() {
  $$("#page-management .management-group.management-drop-target").forEach((group) => group.classList.remove("management-drop-target"));
}

function markDropTarget(groupEl) {
  clearDropTargets();
  groupEl?.classList.add("management-drop-target");
}

async function moveItemToGroup(itemId, groupId) {
  if (!itemId || !groupId) return;
  await readState();
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  const group = state?.managementGroups.find((entry) => entry.id === groupId);
  if (!item || !group || item.groupId === group.id) return;
  if (item.sectionId && item.sectionId !== group.sectionId) {
    showToast("현재는 같은 섹션 안에서만 드래그 이동할 수 있어요.");
    return;
  }
  await writeState((current) => {
    const targetItem = current.managementItems.find((entry) => entry.id === itemId);
    const targetGroup = current.managementGroups.find((entry) => entry.id === groupId);
    if (!targetItem || !targetGroup) return;
    targetItem.groupId = targetGroup.id;
    targetItem.sectionId = targetGroup.sectionId;
  });
}

function groupFromPoint(x, y) {
  const target = document.elementFromPoint(x, y);
  return target?.closest?.("#page-management .management-group") || null;
}

function resetTouchDrag() {
  clearTimeout(touchHoldTimer);
  touchHoldTimer = null;
  clearDropTargets();
  if (touchDrag?.itemEl) touchDrag.itemEl.classList.remove("management-item-dragging", "management-touch-dragging");
  touchDrag = null;
}

function wireDragEvents() {
  document.addEventListener("dragstart", (event) => {
    const item = event.target.closest?.("#page-management .management-item[data-management-item-id]");
    if (!item) return;
    draggedItemId = item.dataset.managementItemId || null;
    if (!draggedItemId) return;
    item.classList.add("management-item-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedItemId);
  });

  document.addEventListener("dragend", (event) => {
    event.target.closest?.(".management-item")?.classList.remove("management-item-dragging");
    draggedItemId = null;
    clearDropTargets();
  });

  document.addEventListener("dragover", (event) => {
    if (!draggedItemId) return;
    const group = event.target.closest?.("#page-management .management-group");
    if (!group) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    markDropTarget(group);
  });

  document.addEventListener("drop", async (event) => {
    if (!draggedItemId) return;
    const group = event.target.closest?.("#page-management .management-group");
    if (!group) return;
    event.preventDefault();
    const itemId = draggedItemId || event.dataTransfer.getData("text/plain");
    const groupId = group.dataset.managementGroupId || "";
    draggedItemId = null;
    clearDropTargets();
    await moveItemToGroup(itemId, groupId);
  });

  document.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    const itemEl = event.target.closest?.("#page-management .management-item[data-management-item-id]");
    if (!itemEl) return;
    const touch = event.touches[0];
    resetTouchDrag();
    touchDrag = {
      itemId: itemEl.dataset.managementItemId,
      itemEl,
      startX: touch.clientX,
      startY: touch.clientY,
      x: touch.clientX,
      y: touch.clientY,
      active: false,
    };
    touchHoldTimer = setTimeout(() => {
      if (!touchDrag) return;
      touchDrag.active = true;
      touchDrag.itemEl.classList.add("management-item-dragging", "management-touch-dragging");
      markDropTarget(groupFromPoint(touchDrag.x, touchDrag.y));
      if (navigator.vibrate) navigator.vibrate(20);
    }, 420);
  }, { passive: true });

  document.addEventListener("touchmove", (event) => {
    if (!touchDrag || event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchDrag.x = touch.clientX;
    touchDrag.y = touch.clientY;
    if (!touchDrag.active) {
      const moved = Math.hypot(touch.clientX - touchDrag.startX, touch.clientY - touchDrag.startY);
      if (moved > 8) resetTouchDrag();
      return;
    }
    event.preventDefault();
    markDropTarget(groupFromPoint(touch.clientX, touch.clientY));
  }, { passive: false });

  document.addEventListener("touchend", async () => {
    if (!touchDrag) return;
    const current = touchDrag;
    const group = current.active ? groupFromPoint(current.x, current.y) : null;
    const groupId = group?.dataset.managementGroupId || "";
    resetTouchDrag();
    if (current.active && groupId) await moveItemToGroup(current.itemId, groupId);
  }, { passive: true });

  document.addEventListener("touchcancel", resetTouchDrag, { passive: true });
}

function wireEvents() {
  document.addEventListener("click", async (event) => {
    if (!event.target.closest("#managementItemContext")) closeContext();

    const add = event.target.closest("[data-management-item-add]");
    if (add) {
      activeEditItemId = null;
      activeAddGroupId = add.dataset.managementItemAdd;
      scheduleRender(0);
      return;
    }

    const edit = event.target.closest("[data-management-item-edit]");
    if (edit) {
      activeAddGroupId = null;
      activeEditItemId = edit.dataset.managementItemEdit;
      scheduleRender(0);
      return;
    }

    if (event.target.closest("[data-management-item-cancel]")) {
      activeAddGroupId = null;
      activeEditItemId = null;
      scheduleRender(0);
      return;
    }

    const action = event.target.closest("[data-management-item-action]");
    if (action) {
      const menu = $("#managementItemContext");
      const itemId = menu?.dataset.itemId || "";
      const rect = action.getBoundingClientRect();
      const name = action.dataset.managementItemAction;
      closeContext();
      if (name === "edit") {
        activeAddGroupId = null;
        activeEditItemId = itemId;
        scheduleRender(0);
      } else if (name === "move") {
        openMoveContext(itemId, rect.left, rect.bottom + 4);
      } else if (name === "delete") {
        await deleteItem(itemId);
      }
      return;
    }

    const move = event.target.closest("[data-management-item-move-group]");
    if (move) {
      const menu = $("#managementItemContext");
      const itemId = menu?.dataset.itemId || "";
      const groupId = move.dataset.managementItemMoveGroup;
      closeContext();
      await moveItemToGroup(itemId, groupId);
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-management-item-form]");
    if (!form) return;
    event.preventDefault();
    const input = $("input[type=text]", form);
    const title = input?.value.trim() || "";
    if (!title) return;
    const groupId = form.dataset.groupId;
    const itemId = form.dataset.itemId || "";
    const group = state?.managementGroups.find((entry) => entry.id === groupId);
    if (!group) return;
    const duplicate = state.managementItems.some((entry) => entry.groupId === groupId && entry.id !== itemId && entry.title.trim().toLowerCase() === title.toLowerCase());
    if (duplicate) {
      showToast("같은 그룹에 같은 이름의 관리 항목이 있어요.");
      input?.focus();
      return;
    }
    await writeState((current) => {
      if (itemId) {
        const item = current.managementItems.find((entry) => entry.id === itemId);
        if (item) item.title = title;
        return;
      }
      current.managementItems.push({ id: `management-item-${uid()}`, title, sectionId: group.sectionId, groupId, createdAt: new Date().toISOString() });
    });
    activeAddGroupId = null;
    activeEditItemId = null;
  });

  document.addEventListener("contextmenu", (event) => {
    const item = event.target.closest("[data-management-item-id]");
    if (!item || !item.closest("#page-management")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openItemContext(item.dataset.managementItemId, event.clientX, event.clientY);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !event.target.closest(".management-item-form")) return;
    event.preventDefault();
    activeAddGroupId = null;
    activeEditItemId = null;
    scheduleRender(0);
  });
}

ensureStyle();
ensureContextMenu();
wireEvents();
wireDragEvents();
const observer = new MutationObserver(() => scheduleRender(30));
observer.observe(document.body, { childList: true, subtree: true });
document.addEventListener("onekan:state-changed", (event) => {
  if (event.detail?.source !== "management-items") scheduleRender(60);
});
supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  if (user) scheduleRender(100);
});
scheduleRender(120);
