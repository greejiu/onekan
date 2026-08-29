from pathlib import Path
import re

management = Path('js/management.js')
text = management.read_text()
text = text.replace('./css/management.css?v=3', './css/management.css?v=4', 1)
text = text.replace(
    '          <small class="management-section-board-meta">${groupCount ? `${groupCount}개 그룹` : "그룹 없음"} · ${itemCount}개 항목</small>',
    '          <small class="management-section-board-meta">${itemCount}개 항목</small>',
    1,
)
replacement = '''function renderSection(section) {
  const root = $("#managementContent");
  if (!root) return;
  root.innerHTML = `
    <section class="management-section-detail" data-management-section-id="${esc(section.id)}">
      <div class="management-section-detail-title">
        <strong>${esc(section.name)}</strong>
      </div>
      <div class="management-section-items-body" data-management-section-items="${esc(section.id)}"></div>
    </section>`;
}'''
text, count = re.subn(r'function renderSection\(section\) \{.*?^\}', replacement, text, count=1, flags=re.S | re.M)
if count != 1:
    raise SystemExit('renderSection replacement failed')
management.write_text(text)

Path('js/management-items.js').write_text('''import { supabase } from "./supabase.js";
import { confirmAction, showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => crypto.randomUUID();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

let state = null;
let user = null;
let activeAddSectionId = null;
let activeEditItemId = null;
let renderTimer = null;
let rendering = false;

function normalizeState(raw) {
  const next = raw && typeof raw === "object" ? raw : {};
  next.managementSections = Array.isArray(next.managementSections) ? next.managementSections : [];
  next.managementGroups = Array.isArray(next.managementGroups) ? next.managementGroups : [];
  next.managementItems = Array.isArray(next.managementItems) ? next.managementItems : [];
  next.managementHistory = Array.isArray(next.managementHistory) ? next.managementHistory : [];
  return next;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) {
    state = null;
    return null;
  }
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = normalizeState(data?.data);
  return state;
}

async function writeState(mutator) {
  await readState();
  if (!state || !user) return;
  mutator(state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "management-items" } }));
  scheduleRender(80, false);
}

function flatGroupId(sectionId) {
  return `management-flat-${sectionId}`;
}

function ensureFlatGroup(current, sectionId) {
  const id = flatGroupId(sectionId);
  let group = current.managementGroups.find((entry) => entry.id === id);
  if (!group) {
    group = {
      id,
      sectionId,
      name: "기본",
      system: true,
      hidden: true,
      createdAt: new Date().toISOString(),
    };
    current.managementGroups.push(group);
  }
  return group;
}

function ensureStyle() {
  if ($('link[data-onekan-management-items-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/management-items.css?v=3";
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

function itemFormMarkup(sectionId, item = null) {
  const editing = Boolean(item);
  const groupId = item?.groupId || flatGroupId(sectionId);
  return `<form class="management-item-form" data-management-item-form data-section-id="${esc(sectionId)}" data-group-id="${esc(groupId)}"${editing ? ` data-item-id="${esc(item.id)}"` : ""} autocomplete="off">
    <input type="text" maxlength="100" value="${esc(item?.title || "")}" placeholder="관리 항목 입력" aria-label="관리 항목 이름" required>
    <button class="primary-btn" type="submit">${editing ? "저장" : "추가"}</button>
    <button class="soft-btn" data-management-item-cancel type="button">취소</button>
  </form>`;
}

function itemMarkup(item) {
  if (activeEditItemId === item.id) return itemFormMarkup(item.sectionId || "", item);
  return `<div class="management-item" data-management-item-id="${esc(item.id)}" data-management-item-section-id="${esc(item.sectionId || "")}">
    <button class="management-item-title" data-management-item-edit="${esc(item.id)}" type="button">${esc(item.title)}</button>
  </div>`;
}

async function renderItems({ refresh = false } = {}) {
  if (rendering || !$("#page-management")) return;
  rendering = true;
  try {
    if (refresh || !state) await readState();
    if (!state) return;
    $$("#page-management .management-section-items-body[data-management-section-items]").forEach((body) => {
      const sectionId = body.dataset.managementSectionItems || "";
      if (!sectionId) return;
      const items = state.managementItems.filter((item) => item.sectionId === sectionId);
      const signature = JSON.stringify({
        sectionId,
        items: items.map((item) => [item.id, item.title, item.groupId]),
        adding: activeAddSectionId === sectionId,
        editing: activeEditItemId,
      });
      if (body.dataset.managementItemsSignature === signature) return;
      body.dataset.managementItemsSignature = signature;
      body.innerHTML = `<div class="management-item-list">${items.map(itemMarkup).join("")}</div>${activeAddSectionId === sectionId ? itemFormMarkup(sectionId) : `<button class="management-item-add" data-management-item-add-section="${esc(sectionId)}" type="button">관리 항목 추가&nbsp; ＋</button>`}`;
      const focus = body.querySelector(".management-item-form input[type=text]");
      if (focus) requestAnimationFrame(() => { focus.focus(); if (activeEditItemId) focus.select(); });
    });
  } catch (error) {
    console.error("management items render failed", error);
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 40, refresh = false) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderItems({ refresh }), delay);
}

function closeContext() {
  $("#managementItemContext")?.classList.remove("open");
}

function openItemContext(itemId, x, y) {
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const menu = $("#managementItemContext");
  menu.dataset.itemId = itemId;
  menu.innerHTML = '<button data-management-item-action="edit" type="button">수정</button><button class="danger" data-management-item-action="delete" type="button">삭제</button>';
  menu.style.left = `${Math.max(8, Math.min(innerWidth - 170, x))}px`;
  menu.style.top = `${Math.max(8, Math.min(innerHeight - 100, y))}px`;
  menu.classList.add("open");
}

async function deleteItem(itemId) {
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const confirmed = await confirmAction({
    title: `‘${item.title}’ 항목을 삭제할까요?`,
    message: "항목과 이 항목의 실행 기록도 함께 삭제돼요.",
    confirmLabel: "삭제",
  });
  if (!confirmed) return;
  await writeState((current) => {
    current.managementItems = current.managementItems.filter((entry) => entry.id !== itemId);
    current.managementHistory = current.managementHistory.filter((entry) => entry.itemId !== itemId);
  });
}

function wireEvents() {
  document.addEventListener("click", async (event) => {
    if (!event.target.closest("#managementItemContext")) closeContext();

    const add = event.target.closest("[data-management-item-add-section]");
    if (add) {
      activeEditItemId = null;
      activeAddSectionId = add.dataset.managementItemAddSection || null;
      scheduleRender(0);
      return;
    }

    const edit = event.target.closest("[data-management-item-edit]");
    if (edit) {
      activeAddSectionId = null;
      activeEditItemId = edit.dataset.managementItemEdit;
      scheduleRender(0);
      return;
    }

    if (event.target.closest("[data-management-item-cancel]")) {
      activeAddSectionId = null;
      activeEditItemId = null;
      scheduleRender(0);
      return;
    }

    const action = event.target.closest("[data-management-item-action]");
    if (action) {
      const menu = $("#managementItemContext");
      const itemId = menu?.dataset.itemId || "";
      const name = action.dataset.managementItemAction;
      closeContext();
      if (name === "edit") {
        activeAddSectionId = null;
        activeEditItemId = itemId;
        scheduleRender(0);
      } else if (name === "delete") {
        await deleteItem(itemId);
      }
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-management-item-form]");
    if (!form) return;
    event.preventDefault();
    const input = $("input[type=text]", form);
    const title = input?.value.trim() || "";
    const sectionId = form.dataset.sectionId || "";
    const itemId = form.dataset.itemId || "";
    if (!title || !sectionId) return;
    if (!state?.managementSections.some((entry) => entry.id === sectionId)) return;
    const duplicate = state.managementItems.some((entry) => entry.sectionId === sectionId && entry.id !== itemId && String(entry.title || "").trim().toLowerCase() === title.toLowerCase());
    if (duplicate) {
      showToast("이 섹션에 같은 이름의 관리 항목이 있어요.");
      input?.focus();
      return;
    }
    await writeState((current) => {
      if (itemId) {
        const item = current.managementItems.find((entry) => entry.id === itemId);
        if (item) item.title = title;
        return;
      }
      const group = ensureFlatGroup(current, sectionId);
      current.managementItems.push({
        id: `management-item-${uid()}`,
        title,
        sectionId,
        groupId: group.id,
        createdAt: new Date().toISOString(),
      });
    });
    activeAddSectionId = null;
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
    activeAddSectionId = null;
    activeEditItemId = null;
    scheduleRender(0);
  });
}

ensureStyle();
ensureContextMenu();
wireEvents();
const managementPage = $("#page-management");
if (managementPage) {
  const observer = new MutationObserver(() => scheduleRender(30, false));
  observer.observe(managementPage, { childList: true, subtree: true });
}
document.addEventListener("onekan:state-changed", (event) => {
  if (event.detail?.source !== "management-items") scheduleRender(60, true);
});
supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  if (user) scheduleRender(100, true);
});
scheduleRender(120, true);
''')

Path('js/management-section-item-drag.js').write_text('''import { supabase } from "./supabase.js";
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
''')

css = Path('css/management.css')
css.write_text(css.read_text() + '\n.management-section-items-body{min-height:96px;padding:4px 4px 12px}\n')

item_css = Path('css/management-items.css')
text = item_css.read_text()
text = text.replace(
    '@media(hover:hover) and (pointer:fine){.management-item:hover .management-item-title{cursor:grab}.management-item:hover .management-item-title:active{cursor:grabbing}}',
    '@media(hover:hover) and (pointer:fine){.management-item:hover .management-item-title{cursor:text}}',
)
item_css.write_text(text + '\n.management-section-items-body .management-item-list:empty::before{content:"아직 관리 항목이 없어요.";display:block;padding:10px;color:var(--muted,#858078);font-size:13px}\n')

loader = Path('js/interaction-fixes.js')
text = loader.read_text()
for old, new in [
    ('import "./management.js?v=4";', 'import "./management.js?v=5";'),
    ('import "./management-items.js?v=4";', 'import "./management-items.js?v=5";'),
    ('import "./management-section-item-drag.js?v=2";', 'import "./management-section-item-drag.js?v=3";'),
]:
    if old not in text:
        raise SystemExit(f'loader pattern missing: {old}')
    text = text.replace(old, new, 1)
text = text.replace('import "./management-item-drag-fix.js?v=4";\n', '', 1)
loader.write_text(text)

index = Path('index.html')
text = index.read_text()
if './js/interaction-fixes.js?v=27' not in text:
    raise SystemExit('interaction-fixes v27 not found')
index.write_text(text.replace('./js/interaction-fixes.js?v=27', './js/interaction-fixes.js?v=28', 1))
