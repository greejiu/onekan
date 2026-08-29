import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const VALID_TARGETS = new Set(["before", "doing", "done", "archived"]);
const MOUSE_THRESHOLD = 6;
const TOUCH_CANCEL_DISTANCE = 9;
const TOUCH_HOLD_MS = 420;

let drag = null;
let saving = false;

function ensureCss() {
  if ($('link[data-goal-status-drag-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/goal-status-drag.css?v=1";
  link.dataset.goalStatusDragCss = "1";
  document.head.appendChild(link);
}

function distanceFromStart(event) {
  if (!drag) return 0;
  return Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
}

function visibleTargetAt(x, y) {
  const element = document.elementFromPoint(x, y);
  const column = element?.closest?.("#page-goals .ok-goal-column[data-goal-v2-status]");
  if (!column) return null;
  const status = column.dataset.goalV2Status || "";
  if (!VALID_TARGETS.has(status)) return null;
  const targetGroupId = column.dataset.goalV2GroupId || "";
  if (drag?.groupId && targetGroupId && targetGroupId !== drag.groupId) return null;
  return column;
}

function clearTarget() {
  document.querySelectorAll("#page-goals .ok-goal-column.ok-goal-drag-over").forEach((column) => {
    column.classList.remove("ok-goal-drag-over");
  });
}

function updateGhost(x, y) {
  if (!drag?.ghost) return;
  drag.ghost.style.left = `${x + 12}px`;
  drag.ghost.style.top = `${y + 12}px`;
}

function beginDrag(event) {
  if (!drag || drag.started) return;
  drag.started = true;
  clearTimeout(drag.holdTimer);
  drag.card.classList.add("ok-goal-dragging");
  drag.card.setAttribute("aria-grabbed", "true");

  const rect = drag.card.getBoundingClientRect();
  const ghost = drag.card.cloneNode(true);
  ghost.classList.add("ok-goal-drag-ghost");
  ghost.classList.remove("ok-goal-dragging");
  ghost.style.width = `${rect.width}px`;
  ghost.removeAttribute("aria-grabbed");
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  updateGhost(event.clientX, event.clientY);

  try {
    drag.card.setPointerCapture?.(drag.pointerId);
  } catch (_) {}
}

function cleanupDrag() {
  if (!drag) return;
  clearTimeout(drag.holdTimer);
  drag.ghost?.remove();
  drag.card?.classList.remove("ok-goal-dragging", "ok-goal-longpress-ready");
  drag.card?.removeAttribute("aria-grabbed");
  clearTarget();
  drag = null;
}

async function moveGoal(goalId, nextStatus) {
  if (saving || !VALID_TARGETS.has(nextStatus)) return;
  saving = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data, error } = await supabase
      .from("onekan_state")
      .select("data")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) throw error;

    const state = data?.data && typeof data.data === "object" ? data.data : {};
    state.projects = Array.isArray(state.projects) ? state.projects : [];
    const goal = state.projects.find((item) => item?.kind === "goal" && item.id === goalId);
    if (!goal || goal.status === nextStatus) return;

    const previousStatus = goal.status;
    const now = new Date().toISOString();
    goal.status = nextStatus;
    goal.updatedAt = now;
    if (nextStatus === "done" && previousStatus !== "done") goal.completedAt = goal.completedAt || now;
    if (["before", "doing"].includes(nextStatus)) delete goal.completedAt;
    if (nextStatus === "archived") goal.archivedAt = now;
    else delete goal.archivedAt;

    const { error: saveError } = await supabase
      .from("onekan_state")
      .upsert({ user_id: session.user.id, data: state }, { onConflict: "user_id" });
    if (saveError) throw saveError;

    document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "goal-status-drag" } }));
    const labels = { before: "시작 전", doing: "하는 중", done: "달성", archived: "보관" };
    showToast?.(`‘${goal.title || "목표"}’을 ${labels[nextStatus]}으로 이동했어요.`);
  } catch (error) {
    console.error("목표 상태 이동 실패", error);
    showToast?.("목표를 이동하지 못했어요. 다시 시도해 주세요.");
  } finally {
    saving = false;
  }
}

function handlePointerDown(event) {
  if (!event.isPrimary || event.button !== 0 || saving) return;
  const card = event.target.closest?.("#page-goals .ok-goal-card[data-goal-v2-id]");
  if (!card) return;
  if (event.target.closest("button,input,select,textarea,a,[contenteditable='true']")) return;

  const column = card.closest(".ok-goal-column[data-goal-v2-status]");
  const sourceStatus = column?.dataset.goalV2Status || "";
  if (!VALID_TARGETS.has(sourceStatus)) return;

  cleanupDrag();
  drag = {
    card,
    goalId: card.dataset.goalV2Id,
    sourceStatus,
    groupId: column?.dataset.goalV2GroupId || "",
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    startX: event.clientX,
    startY: event.clientY,
    started: false,
    ghost: null,
    holdTimer: null,
  };

  if (event.pointerType === "touch" || event.pointerType === "pen") {
    drag.holdTimer = setTimeout(() => {
      if (!drag || drag.started) return;
      beginDrag({ clientX: drag.startX, clientY: drag.startY });
      drag.card.classList.add("ok-goal-longpress-ready");
    }, TOUCH_HOLD_MS);
  }
}

function handlePointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const distance = distanceFromStart(event);

  if (!drag.started) {
    if (drag.pointerType === "mouse") {
      if (distance < MOUSE_THRESHOLD) return;
      beginDrag(event);
    } else if (distance > TOUCH_CANCEL_DISTANCE) {
      cleanupDrag();
      return;
    } else {
      return;
    }
  }

  event.preventDefault();
  updateGhost(event.clientX, event.clientY);
  clearTarget();
  const target = visibleTargetAt(event.clientX, event.clientY);
  target?.classList.add("ok-goal-drag-over");
}

async function handlePointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.started) {
    cleanupDrag();
    return;
  }

  event.preventDefault();
  const target = visibleTargetAt(event.clientX, event.clientY);
  const nextStatus = target?.dataset.goalV2Status || "";
  const goalId = drag.goalId;
  const sourceStatus = drag.sourceStatus;
  cleanupDrag();
  if (!VALID_TARGETS.has(nextStatus) || nextStatus === sourceStatus) return;
  await moveGoal(goalId, nextStatus);
}

function wire() {
  if (document.documentElement.dataset.goalStatusDragWired) return;
  document.documentElement.dataset.goalStatusDragWired = "1";
  ensureCss();

  const page = $("#page-goals");
  if (!page) return;
  page.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointermove", handlePointerMove, { passive: false });
  window.addEventListener("pointerup", handlePointerUp, { passive: false });
  window.addEventListener("pointercancel", cleanupDrag);
  window.addEventListener("blur", cleanupDrag);
}

wire();
