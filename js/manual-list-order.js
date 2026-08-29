import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let drag = null;
let suppressClickUntil = 0;

function installStyle() {
  if ($("#onekanManualOrderStyle")) return;
  const style = document.createElement("style");
  style.id = "onekanManualOrderStyle";
  style.textContent = `
    .onekan-manual-handle{display:grid;place-items:center;width:24px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--muted);font:inherit;font-size:14px;line-height:1;cursor:grab;touch-action:none;user-select:none}
    .onekan-manual-handle:hover{background:var(--panel-soft);color:var(--text)}
    .onekan-manual-handle:active{cursor:grabbing}
    [data-manual-row].onekan-manual-dragging{position:relative;z-index:40;opacity:.52;background:var(--panel-soft,#f5f6f7)}
    [data-manual-list].onekan-manual-list-active{outline:1px solid color-mix(in srgb,var(--accent) 35%,transparent);outline-offset:-1px;border-radius:8px}
  `;
  document.head.appendChild(style);
}

async function persist(container) {
  const rows = $$(':scope > [data-manual-row]', container);
  if (!rows.length) return;
  const kind = rows[0].dataset.manualKind;
  if (!kind || rows.some((row) => row.dataset.manualKind !== kind)) return;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  const list = kind === "event" ? state.events : state.tasks;

  rows.forEach((row, index) => {
    const item = list.find((entry) => entry.id === row.dataset.manualId);
    if (item) item.manualOrder = (index + 1) * 1000;
  });

  const { error: saveError } = await supabase.from("onekan_state").upsert({ user_id: session.user.id, data: state }, { onConflict: "user_id" });
  if (saveError) throw saveError;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "manual-list-order" } }));
  $("#reloadCloudBtn")?.click();
}

function clearDrag() {
  if (!drag) return;
  drag.row.classList.remove("onekan-manual-dragging");
  drag.container.classList.remove("onekan-manual-list-active");
  drag = null;
}

function targetRowAt(x, y, container) {
  const element = document.elementFromPoint(x, y);
  const row = element?.closest?.("[data-manual-row]");
  return row && row.parentElement === container ? row : null;
}

function onPointerDown(event) {
  const handle = event.target.closest?.("[data-manual-sort-handle]");
  if (!handle || !event.isPrimary || event.button > 0) return;
  const row = handle.closest("[data-manual-row]");
  const container = row?.parentElement?.closest?.("[data-manual-list]");
  if (!row || !container || row.parentElement !== container) return;
  event.preventDefault();
  event.stopPropagation();
  try { handle.setPointerCapture(event.pointerId); } catch {}
  drag = { pointerId: event.pointerId, handle, row, container, moved: false, startX: event.clientX, startY: event.clientY };
  row.classList.add("onekan-manual-dragging");
  container.classList.add("onekan-manual-list-active");
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
  drag.moved = true;
  event.preventDefault();
  const target = targetRowAt(event.clientX, event.clientY, drag.container);
  if (!target || target === drag.row) return;
  const rect = target.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  drag.container.insertBefore(drag.row, before ? target : target.nextSibling);
}

async function onPointerEnd(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const current = drag;
  try { current.handle.releasePointerCapture(event.pointerId); } catch {}
  if (current.moved) {
    suppressClickUntil = Date.now() + 500;
    window.__onekanSuppressItemClickUntil = Math.max(Number(window.__onekanSuppressItemClickUntil || 0), suppressClickUntil);
  }
  clearDrag();
  if (!current.moved) return;
  try {
    await persist(current.container);
  } catch (error) {
    console.error("manual list order save failed", error);
    $("#reloadCloudBtn")?.click();
  }
}

function init() {
  installStyle();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
  document.addEventListener("pointerup", onPointerEnd, true);
  document.addEventListener("pointercancel", onPointerEnd, true);
  document.addEventListener("click", (event) => {
    if (Date.now() >= suppressClickUntil) return;
    if (event.target.closest?.("[data-manual-row]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
