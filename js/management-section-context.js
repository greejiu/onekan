import { supabase } from "./supabase.js";
import { confirmAction, showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

let state = null;
let user = null;
let activeSectionId = "";
let editBox = null;

function normalizeState(raw) {
  const next = raw && typeof raw === "object" ? raw : {};
  next.managementSections = Array.isArray(next.managementSections) ? next.managementSections : [];
  next.managementGroups = Array.isArray(next.managementGroups) ? next.managementGroups : [];
  next.managementItems = Array.isArray(next.managementItems) ? next.managementItems : [];
  next.managementHistory = Array.isArray(next.managementHistory) ? next.managementHistory : [];
  next.managementLogs = Array.isArray(next.managementLogs) ? next.managementLogs : [];
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

async function saveState(source = "management-section-context") {
  if (!state || !user) return;
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source } }));
}

function ensureMenu() {
  if ($("#managementSectionContext")) return;
  const menu = document.createElement("div");
  menu.id = "managementSectionContext";
  menu.className = "management-context management-section-context";
  document.body.appendChild(menu);

  const style = document.createElement("style");
  style.dataset.managementSectionContextStyle = "1";
  style.textContent = `
    #page-management [data-management-section-context]{cursor:context-menu}
    .management-section-edit-box{position:fixed;z-index:1301;display:flex;gap:6px;align-items:center;padding:8px;border:1px solid var(--line,#e4e0d9);border-radius:12px;background:var(--panel,#fff);box-shadow:0 12px 30px rgba(30,30,28,.14)}
    .management-section-edit-box input{width:190px;max-width:55vw;height:34px;box-sizing:border-box;padding:0 9px;border:1px solid var(--line,#ddd8d1);border-radius:9px;background:var(--panel,#fff);color:inherit;font:inherit}
    .management-section-edit-box button{height:34px;padding:0 10px;border-radius:9px}
  `;
  document.head.appendChild(style);
}

function closeMenu() {
  $("#managementSectionContext")?.classList.remove("open");
}

function closeEditBox() {
  editBox?.remove();
  editBox = null;
}

function sectionIdFromTitle(target) {
  return target?.closest?.("[data-management-section-id]")?.dataset.managementSectionId || "";
}

function openMenu(sectionId, x, y) {
  const menu = $("#managementSectionContext");
  if (!menu) return;
  activeSectionId = sectionId;
  menu.innerHTML = '<button data-management-section-action="edit" type="button">수정</button><button class="danger" data-management-section-action="delete" type="button">삭제</button>';
  menu.style.left = `${Math.max(8, Math.min(innerWidth - 170, x))}px`;
  menu.style.top = `${Math.max(8, Math.min(innerHeight - 100, y))}px`;
  menu.classList.add("open");
}

function findSectionTitle(sectionId) {
  const nodes = [...document.querySelectorAll("#page-management [data-management-section-context]")];
  return nodes.find((node) => sectionIdFromTitle(node) === sectionId) || null;
}

function openEditBox(section, anchor) {
  closeEditBox();
  const rect = anchor?.getBoundingClientRect?.() || { left: 16, bottom: 70 };
  const box = document.createElement("form");
  box.className = "management-section-edit-box";
  box.dataset.managementSectionEditBox = section.id;
  box.innerHTML = `<input type="text" maxlength="40" value="${esc(section.name)}" aria-label="섹션 이름"><button class="primary-btn" type="submit">저장</button><button class="soft-btn" data-management-section-edit-cancel type="button">취소</button>`;
  document.body.appendChild(box);
  editBox = box;
  const boxWidth = Math.min(320, innerWidth - 16);
  box.style.left = `${Math.max(8, Math.min(innerWidth - boxWidth - 8, rect.left))}px`;
  box.style.top = `${Math.max(8, Math.min(innerHeight - 58, rect.bottom + 6))}px`;
  requestAnimationFrame(() => {
    const input = box.querySelector("input");
    input?.focus();
    input?.select();
  });
}

async function editSection(sectionId) {
  await readState();
  const section = state?.managementSections.find((entry) => entry.id === sectionId);
  if (!section) return;
  openEditBox(section, findSectionTitle(sectionId));
}

async function deleteSection(sectionId) {
  await readState();
  const section = state?.managementSections.find((entry) => entry.id === sectionId);
  if (!section) return;

  const groups = state.managementGroups.filter((entry) => entry.sectionId === sectionId);
  const groupIds = new Set(groups.map((entry) => entry.id));
  const items = state.managementItems.filter((entry) => entry.sectionId === sectionId || groupIds.has(entry.groupId));
  const itemIds = new Set(items.map((entry) => entry.id));
  const historyCount = state.managementHistory.filter((entry) => itemIds.has(entry.itemId)).length;
  const details = [];
  if (groups.length) details.push(`그룹 ${groups.length}개`);
  if (items.length) details.push(`항목 ${items.length}개`);
  if (historyCount) details.push(`실행 기록 ${historyCount}개`);

  const confirmed = await confirmAction({
    title: `‘${section.name}’ 섹션을 삭제할까요?`,
    message: details.length ? `${details.join(" · ")}도 함께 삭제돼요.` : "섹션을 삭제해요.",
    confirmLabel: "삭제",
  });
  if (!confirmed) return;

  state.managementSections = state.managementSections.filter((entry) => entry.id !== sectionId);
  state.managementGroups = state.managementGroups.filter((entry) => entry.sectionId !== sectionId);
  state.managementItems = state.managementItems.filter((entry) => !itemIds.has(entry.id));
  state.managementHistory = state.managementHistory.filter((entry) => !itemIds.has(entry.itemId));
  state.managementLogs = state.managementLogs.filter((entry) => !itemIds.has(entry.itemId) && entry.sectionId !== sectionId);
  await saveState();
  closeEditBox();
  showToast("관리 섹션을 삭제했어요.");
}

function decorateTitles() {
  document.querySelectorAll("#page-management .management-section-board-head > strong, #page-management .management-section-detail-title > strong").forEach((node) => {
    node.dataset.managementSectionContext = "1";
  });
}

document.addEventListener("contextmenu", (event) => {
  const title = event.target.closest?.("#page-management [data-management-section-context]");
  if (!title) return;
  const sectionId = sectionIdFromTitle(title);
  if (!sectionId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeEditBox();
  openMenu(sectionId, event.clientX, event.clientY);
}, true);

document.addEventListener("click", async (event) => {
  const action = event.target.closest?.("[data-management-section-action]");
  if (action) {
    event.preventDefault();
    event.stopPropagation();
    const sectionId = activeSectionId;
    const kind = action.dataset.managementSectionAction;
    closeMenu();
    try {
      if (kind === "edit") await editSection(sectionId);
      if (kind === "delete") await deleteSection(sectionId);
    } catch (error) {
      console.error("management section action failed", error);
      showToast("섹션 처리 중 오류가 났어요.");
    }
    return;
  }
  if (event.target.closest?.("[data-management-section-edit-cancel]")) {
    closeEditBox();
    return;
  }
  if (!event.target.closest?.("#managementSectionContext")) closeMenu();
  if (editBox && !event.target.closest?.(".management-section-edit-box") && !event.target.closest?.("[data-management-section-context]")) closeEditBox();
});

document.addEventListener("submit", async (event) => {
  const box = event.target.closest?.("[data-management-section-edit-box]");
  if (!box) return;
  event.preventDefault();
  const sectionId = box.dataset.managementSectionEditBox || "";
  const input = box.querySelector("input");
  const name = input?.value.trim() || "";
  if (!name) return;
  try {
    await readState();
    const duplicate = state?.managementSections.some((entry) => entry.id !== sectionId && entry.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      showToast("같은 이름의 관리 섹션이 이미 있어요.");
      input?.focus();
      return;
    }
    const section = state?.managementSections.find((entry) => entry.id === sectionId);
    if (!section) return;
    section.name = name;
    await saveState();
    closeEditBox();
    showToast("섹션 이름을 수정했어요.");
  } catch (error) {
    console.error("management section edit failed", error);
    showToast("섹션 수정 중 오류가 났어요.");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeMenu();
  closeEditBox();
});

const observer = new MutationObserver(decorateTitles);
const attach = () => {
  const page = $("#page-management");
  if (!page) return setTimeout(attach, 100);
  observer.observe(page, { childList: true, subtree: true });
  decorateTitles();
};

ensureMenu();
attach();
document.addEventListener("onekan:state-changed", () => setTimeout(decorateTitles, 80));
