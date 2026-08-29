import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const TABS = [
  { id: "project", label: "프로젝트", title: "프로젝트" },
  { id: "goal", label: "목표", title: "목표" },
  { id: "identity", label: "정체성", title: "정체성" },
];

const GOAL_STATUSES = [
  { id: "before", label: "시작 전" },
  { id: "doing", label: "진행 중" },
  { id: "done", label: "완료" },
  { id: "archived", label: "보관" },
];

let activeTab = sessionStorage.getItem("onekan-project-direction-tab") || "project";
if (!TABS.some((tab) => tab.id === activeTab)) activeTab = "project";
let goalState = null;
let goalUser = null;
let editingGoalId = null;
let editingIdentityId = null;
let goalRendering = false;
let identityRendering = false;
let draggedDirection = null;

function normalizeGoalStatus(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["before", "시작 전", "시작전", "todo", "planned"].includes(raw)) return "before";
  if (["done", "완료", "complete", "completed"].includes(raw)) return "done";
  if (["archived", "보관", "closed", "archive"].includes(raw)) return "archived";
  return "doing";
}

function isProject(item) {
  return !!item && (item.kind === "project" || !item.kind);
}

function installStyle() {
  if ($("#onekanProjectDirectionTabsStyle")) return;
  const style = document.createElement("style");
  style.id = "onekanProjectDirectionTabsStyle";
  style.textContent = `
    #page-projects .page-head{display:flex;align-items:center;justify-content:space-between;gap:14px}
    .onekan-project-direction-tabs{display:inline-flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--line,#d2d7df);border-radius:10px;background:var(--panel-soft,#f4f5f6)}
    .onekan-project-direction-tabs button{min-height:29px;padding:4px 10px;border:0;border-radius:7px;background:transparent;color:var(--muted,#6d737d);font:inherit;font-size:11px;cursor:pointer}
    .onekan-project-direction-tabs button.active{background:#fff;color:var(--text,#1f2328);font-weight:700;box-shadow:0 1px 3px #0001}
    .onekan-project-direction-placeholder{display:grid;place-items:center;min-height:360px;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:15px;background:#fff;color:var(--muted,#6d737d);font-size:11px;text-align:center}
    .onekan-goal-shell{display:grid;gap:12px}
    .onekan-goal-toolbar{display:flex;justify-content:flex-end}
    .onekan-goal-add{height:34px;padding:0 12px;border:1px solid var(--line,#d2d7df);border-radius:9px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:11px;font-weight:700;cursor:pointer}
    .onekan-goal-add:hover{background:var(--panel-soft,#f4f5f6)}
    .onekan-goal-list{display:grid;align-content:start;min-height:360px;padding:8px 10px 12px;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:15px;background:#fff}
    .onekan-goal-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;min-height:52px;padding:7px 8px;border-bottom:1px solid var(--line,#e1e4e8);cursor:grab;user-select:none}
    .onekan-goal-row:active{cursor:grabbing}
    .onekan-goal-row.onekan-direction-dragging{opacity:.42}
    .onekan-goal-row:last-child{border-bottom:0}
    .onekan-goal-main{display:grid;gap:3px;min-width:0}
    .onekan-goal-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;color:var(--text,#1f2328);font:inherit;font-size:12px;font-weight:650;text-align:left;cursor:pointer}
    .onekan-goal-title:hover{text-decoration:underline}
    .onekan-goal-projects,.onekan-goal-identity{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted,#6d737d);font-size:9px}
    .onekan-goal-identity{color:var(--accent,#8fa9c4)}
    .onekan-goal-status{display:inline-flex;align-items:center;min-height:24px;padding:0 8px;border-radius:999px;background:var(--panel-soft,#f4f5f6);color:var(--muted,#6d737d);font-size:9px;font-weight:700;white-space:nowrap}
    .onekan-goal-period{display:flex;align-items:center;gap:5px;color:var(--muted,#6d737d);font-size:9px;white-space:nowrap}
    .onekan-goal-period button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer}
    .onekan-goal-period button:hover{background:var(--panel-soft,#f4f5f6);color:var(--accent,#8fa9c4)}
    .onekan-goal-period svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .onekan-goal-empty{display:grid;place-items:center;min-height:300px;color:var(--muted,#6d737d);font-size:11px;text-align:center}
    .onekan-identity-shell{display:grid;gap:12px}
    .onekan-identity-toolbar{display:flex;justify-content:flex-end}
    .onekan-identity-add{height:34px;padding:0 12px;border:1px solid var(--line,#d2d7df);border-radius:9px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:11px;font-weight:700;cursor:pointer}
    .onekan-identity-add:hover{background:var(--panel-soft,#f4f5f6)}
    .onekan-identity-list{display:grid;align-content:start;gap:8px;min-height:360px;padding:10px;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:15px;background:#fff}
    .onekan-identity-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;min-height:68px;padding:10px 11px;border:1px solid var(--line,#d2d7df);border-radius:10px;background:var(--panel-soft,#f7f8f9);cursor:grab;user-select:none}
    .onekan-identity-row:active{cursor:grabbing}
    .onekan-identity-row.onekan-direction-dragging{opacity:.42}
    .onekan-identity-main{display:grid;gap:5px;min-width:0}
    .onekan-identity-title{min-width:0;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;color:var(--text,#1f2328);font:inherit;font-size:13px;font-weight:500;text-align:left;cursor:pointer}
    .onekan-identity-title:hover{text-decoration:underline}
    .onekan-identity-goals{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted,#6d737d);font-size:9px}
    .onekan-identity-goal-add{height:30px;padding:0 9px;border:1px solid var(--line,#d2d7df);border-radius:8px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:10px;cursor:pointer}
    .onekan-identity-goal-add:hover{border-color:var(--accent,#8fa9c4);color:var(--accent,#8fa9c4)}
    .onekan-identity-empty{display:grid;place-items:center;min-height:320px;padding:24px;color:var(--muted,#6d737d);font-size:11px;line-height:1.7;text-align:center}
    .onekan-goal-dialog{width:min(430px,calc(100vw - 28px));padding:0;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:14px;background:#fff;color:var(--text,#1f2328);box-shadow:0 20px 60px rgba(15,23,42,.18)}
    .onekan-goal-dialog::backdrop{background:rgba(15,23,42,.2)}
    .onekan-goal-dialog form{display:grid;gap:12px;padding:18px}
    .onekan-goal-dialog h3{margin:0;font-size:15px}
    .onekan-goal-fields{display:grid;gap:9px}
    .onekan-goal-fields label{display:grid;gap:5px;color:var(--muted,#6d737d);font-size:10px}
    .onekan-goal-fields input,.onekan-goal-fields select{width:100%;height:36px;padding:0 9px;border:1px solid var(--line,#d2d7df);border-radius:8px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px;outline:none}
    .onekan-goal-date-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .onekan-goal-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px}
    .onekan-goal-delete{margin-right:auto;color:#a33}
    @media(max-width:700px){#page-projects .page-head{align-items:flex-start;flex-direction:column}.onekan-project-direction-tabs{align-self:stretch}.onekan-project-direction-tabs button{flex:1}.onekan-goal-row{grid-template-columns:minmax(0,1fr) auto}.onekan-goal-period{grid-column:1/-1;justify-content:flex-end}.onekan-goal-date-row{grid-template-columns:1fr}.onekan-identity-row{grid-template-columns:minmax(0,1fr)}.onekan-identity-goal-add{justify-self:start}}
  `;
  document.head.appendChild(style);
}

function ensureUi() {
  const page = $("#page-projects");
  const head = $(".page-head", page);
  const root = $("#projectStatusRoot", page);
  if (!page || !head || !root) return null;

  let tabs = $("#onekanProjectDirectionTabs", page);
  if (!tabs) {
    tabs = document.createElement("div");
    tabs.id = "onekanProjectDirectionTabs";
    tabs.className = "onekan-project-direction-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "프로젝트 방향 보기");
    tabs.innerHTML = TABS.map((tab) => `<button type="button" role="tab" data-project-direction-tab="${tab.id}">${tab.label}</button>`).join("");
    head.appendChild(tabs);
  }

  let secondary = $("#onekanProjectDirectionSecondary", page);
  if (!secondary) {
    secondary = document.createElement("div");
    secondary.id = "onekanProjectDirectionSecondary";
    root.insertAdjacentElement("afterend", secondary);
  }

  return { page, head, root, tabs, secondary };
}

async function readGoalState() {
  const { data: { session } } = await supabase.auth.getSession();
  goalUser = session?.user || null;
  if (!goalUser) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", goalUser.id).maybeSingle();
  if (error) throw error;
  goalState = data?.data && typeof data.data === "object" ? data.data : {};
  goalState.directionGoals = Array.isArray(goalState.directionGoals) ? goalState.directionGoals : [];
  goalState.identities = Array.isArray(goalState.identities) ? goalState.identities : [];
  goalState.projects = Array.isArray(goalState.projects) ? goalState.projects : [];
  return goalState;
}

async function writeGoalState(mutator, source = "direction-goals") {
  await readGoalState();
  if (!goalUser || !goalState) return false;
  goalState.directionGoals = Array.isArray(goalState.directionGoals) ? goalState.directionGoals : [];
  goalState.identities = Array.isArray(goalState.identities) ? goalState.identities : [];
  goalState.projects = Array.isArray(goalState.projects) ? goalState.projects : [];
  mutator(goalState);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: goalUser.id, data: goalState }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source } }));
  $("#reloadCloudBtn")?.click();
  return true;
}

function shortDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
  const [year, month, day] = value.split("-");
  return `${year.slice(2)}.${month}.${day}`;
}

function goalPeriod(goal) {
  const start = shortDate(goal?.startDate);
  const end = shortDate(goal?.endDate);
  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start} ~`;
  if (end) return `~ ${end}`;
  return "기간 없음";
}

function statusLabel(value) {
  const id = normalizeGoalStatus(value);
  return GOAL_STATUSES.find((item) => item.id === id)?.label || "진행 중";
}

function linkedProjectText(goalId, projects) {
  const linked = (projects || []).filter((project) => isProject(project) && project.goalId === goalId);
  if (!linked.length) return "연결된 프로젝트 없음";
  const names = linked.slice(0, 3).map((project) => project.title || "이름 없는 프로젝트");
  const more = linked.length > 3 ? ` 외 ${linked.length - 3}개` : "";
  return `프로젝트 ${linked.length}개 · ${names.join(", ")}${more}`;
}

function identityName(identityId, identities = []) {
  return identities.find((identity) => identity.id === identityId)?.title || "";
}

function linkedGoalText(identityId, goals = []) {
  const linked = goals.filter((goal) => goal.identityId === identityId);
  if (!linked.length) return "연결된 목표 없음";
  const names = linked.slice(0, 3).map((goal) => goal.title || "이름 없는 목표");
  const more = linked.length > 3 ? ` 외 ${linked.length - 3}개` : "";
  return `목표 ${linked.length}개 · ${names.join(", ")}${more}`;
}

function manualOrder(a, b, fallback) {
  const aOrder = Number(a?.sortOrder);
  const bOrder = Number(b?.sortOrder);
  const aHasOrder = Number.isFinite(aOrder);
  const bHasOrder = Number.isFinite(bOrder);
  if (aHasOrder && bHasOrder && aOrder !== bOrder) return aOrder - bOrder;
  if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
  return fallback(a, b);
}

function identityRows(identities, goals = []) {
  return [...identities]
    .sort((a, b) => manualOrder(a, b, (left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")) || String(left.title || "").localeCompare(String(right.title || ""), "ko")))
    .map((identity) => `<div class="onekan-identity-row" draggable="true" data-direction-kind="identity" data-direction-id="${esc(identity.id)}" data-context-kind="identity" data-context-id="${esc(identity.id)}"><div class="onekan-identity-main"><span class="onekan-identity-title">${esc(identity.title || "이름 없는 정체성")}</span><span class="onekan-identity-goals">${esc(linkedGoalText(identity.id, goals))}</span></div><button class="onekan-identity-goal-add" type="button" data-identity-goal-add="${esc(identity.id)}">목표 연결</button></div>`)
    .join("");
}

function goalRows(goals, projects = [], identities = []) {
  const statusOrder = new Map(GOAL_STATUSES.map((item, index) => [item.id, index]));
  return [...goals]
    .sort((a, b) => manualOrder(a, b, (left, right) => (statusOrder.get(normalizeGoalStatus(left.status)) ?? 9) - (statusOrder.get(normalizeGoalStatus(right.status)) ?? 9) || String(left.startDate || "9999-99-99").localeCompare(String(right.startDate || "9999-99-99")) || String(left.title || "").localeCompare(String(right.title || ""), "ko")))
    .map((goal) => {
      const identity = identityName(goal.identityId, identities);
      return `<div class="onekan-goal-row" draggable="true" data-direction-kind="goal" data-direction-id="${esc(goal.id)}" data-context-kind="goal" data-context-id="${esc(goal.id)}"><div class="onekan-goal-main"><span class="onekan-goal-title">${esc(goal.title || "이름 없는 목표")}</span>${identity ? `<span class="onekan-goal-identity">정체성 · ${esc(identity)}</span>` : ""}<span class="onekan-goal-projects">${esc(linkedProjectText(goal.id, projects))}</span></div><span class="onekan-goal-status">${esc(statusLabel(goal.status))}</span><span class="onekan-goal-period"><span>${esc(goalPeriod(goal))}</span><button type="button" data-goal-period="${esc(goal.id)}" aria-label="목표 기간 수정" title="목표 기간 수정"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path></svg></button></span></div>`;
    })
    .join("");
}

function fillGoalIdentitySelect(selectedId = "") {
  const select = $("#onekanGoalIdentity");
  if (!select) return;
  const identities = goalState?.identities || [];
  const validSelected = identities.some((identity) => identity.id === selectedId) ? selectedId : "";
  select.innerHTML = `<option value="">정체성 없음</option>${identities.map((identity) => `<option value="${esc(identity.id)}"${identity.id === validSelected ? " selected" : ""}>${esc(identity.title || "이름 없는 정체성")}</option>`).join("")}`;
  select.value = validSelected;
}

function ensureGoalDialog() {
  let dialog = $("#onekanGoalEditor");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "onekanGoalEditor";
  dialog.className = "onekan-goal-dialog";
  dialog.innerHTML = `<form method="dialog" id="onekanGoalForm"><h3 id="onekanGoalDialogTitle">목표 추가</h3><div class="onekan-goal-fields"><label>목표<input id="onekanGoalTitle" maxlength="120" autocomplete="off" placeholder="예: 디자인 분야 취업하기"></label><label>정체성<select id="onekanGoalIdentity"></select></label><label>상태<select id="onekanGoalStatus">${GOAL_STATUSES.map((item) => `<option value="${item.id}">${item.label}</option>`).join("")}</select></label><div class="onekan-goal-date-row"><label>시작일<input id="onekanGoalStart" type="date"></label><label>종료일<input id="onekanGoalEnd" type="date"></label></div></div><div class="onekan-goal-actions"><button class="ghost-btn onekan-goal-delete" id="onekanGoalDelete" type="button" hidden>삭제</button><button class="soft-btn" value="cancel" type="submit">취소</button><button class="primary-btn" id="onekanGoalSave" type="button">저장</button></div></form>`;
  document.body.appendChild(dialog);
  $("#onekanGoalSave", dialog)?.addEventListener("click", saveGoal);
  $("#onekanGoalDelete", dialog)?.addEventListener("click", deleteGoal);
  return dialog;
}

async function openGoalEditor(goalId = null, preselectedIdentityId = null) {
  try {
    await readGoalState();
    const dialog = ensureGoalDialog();
    const goal = goalId ? goalState?.directionGoals?.find((item) => item.id === goalId) : null;
    editingGoalId = goal?.id || null;
    $("#onekanGoalDialogTitle", dialog).textContent = editingGoalId ? "목표 수정" : "목표 추가";
    $("#onekanGoalTitle", dialog).value = goal?.title || "";
    fillGoalIdentitySelect(goal?.identityId || preselectedIdentityId || "");
    $("#onekanGoalStatus", dialog).value = normalizeGoalStatus(goal?.status || "doing");
    $("#onekanGoalStart", dialog).value = /^\d{4}-\d{2}-\d{2}$/.test(goal?.startDate || "") ? goal.startDate : "";
    $("#onekanGoalEnd", dialog).value = /^\d{4}-\d{2}-\d{2}$/.test(goal?.endDate || "") ? goal.endDate : "";
    $("#onekanGoalDelete", dialog).hidden = !editingGoalId;
    dialog.showModal();
    requestAnimationFrame(() => $("#onekanGoalTitle", dialog)?.focus());
  } catch (error) {
    console.error("목표 열기 실패", error);
    showToast("목표를 불러오지 못했어요.");
  }
}

async function saveGoal() {
  const dialog = $("#onekanGoalEditor");
  const title = $("#onekanGoalTitle", dialog)?.value.trim() || "";
  const identityId = $("#onekanGoalIdentity", dialog)?.value || null;
  const status = normalizeGoalStatus($("#onekanGoalStatus", dialog)?.value || "doing");
  const startDate = $("#onekanGoalStart", dialog)?.value || null;
  const endDate = $("#onekanGoalEnd", dialog)?.value || null;
  if (!title) return showToast("목표 이름을 입력해 주세요.");
  if (startDate && endDate && endDate < startDate) return showToast("종료일은 시작일보다 뒤여야 해요.");
  const id = editingGoalId;
  try {
    await writeGoalState((current) => {
      current.directionGoals = Array.isArray(current.directionGoals) ? current.directionGoals : [];
      current.identities = Array.isArray(current.identities) ? current.identities : [];
      const validIdentityId = identityId && current.identities.some((identity) => identity.id === identityId) ? identityId : null;
      if (id) {
        const goal = current.directionGoals.find((item) => item.id === id);
        if (!goal) return;
        goal.title = title;
        goal.identityId = validIdentityId;
        goal.status = status;
        goal.startDate = startDate;
        goal.endDate = endDate;
        goal.updatedAt = new Date().toISOString();
      } else {
        current.directionGoals.push({ id: uid(), title, identityId: validIdentityId, status, startDate, endDate, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
    });
    dialog?.close();
    editingGoalId = null;
    await renderGoalView();
  } catch (error) {
    console.error("목표 저장 실패", error);
    showToast("목표를 저장하지 못했어요.");
  }
}

async function deleteGoal() {
  if (!editingGoalId) return;
  const id = editingGoalId;
  try {
    await writeGoalState((current) => {
      current.directionGoals = (current.directionGoals || []).filter((item) => item.id !== id);
      (current.projects || []).forEach((project) => {
        if (isProject(project) && project.goalId === id) project.goalId = null;
      });
    }, "direction-goal-delete");
    $("#onekanGoalEditor")?.close();
    editingGoalId = null;
    await renderGoalView();
  } catch (error) {
    console.error("목표 삭제 실패", error);
    showToast("목표를 삭제하지 못했어요.");
  }
}

function ensureIdentityDialog() {
  let dialog = $("#onekanIdentityEditor");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "onekanIdentityEditor";
  dialog.className = "onekan-goal-dialog onekan-identity-dialog";
  dialog.innerHTML = `<form method="dialog" id="onekanIdentityForm"><h3 id="onekanIdentityDialogTitle">정체성 추가</h3><div class="onekan-goal-fields"><label>정체성 문장<input id="onekanIdentityTitle" maxlength="160" autocomplete="off" placeholder="예: 나는 꾸준히 배우고 결과물을 만드는 사람이다"></label></div><div class="onekan-goal-actions"><button class="ghost-btn onekan-goal-delete" id="onekanIdentityDelete" type="button" hidden>삭제</button><button class="soft-btn" value="cancel" type="submit">취소</button><button class="primary-btn" id="onekanIdentitySave" type="button">저장</button></div></form>`;
  document.body.appendChild(dialog);
  $("#onekanIdentitySave", dialog)?.addEventListener("click", saveIdentity);
  $("#onekanIdentityDelete", dialog)?.addEventListener("click", deleteIdentity);
  return dialog;
}

async function openIdentityEditor(identityId = null) {
  try {
    await readGoalState();
    const dialog = ensureIdentityDialog();
    const identity = identityId ? goalState?.identities?.find((item) => item.id === identityId) : null;
    editingIdentityId = identity?.id || null;
    $("#onekanIdentityDialogTitle", dialog).textContent = editingIdentityId ? "정체성 수정" : "정체성 추가";
    $("#onekanIdentityTitle", dialog).value = identity?.title || "";
    $("#onekanIdentityDelete", dialog).hidden = !editingIdentityId;
    dialog.showModal();
    requestAnimationFrame(() => $("#onekanIdentityTitle", dialog)?.focus());
  } catch (error) {
    console.error("정체성 열기 실패", error);
    showToast("정체성을 불러오지 못했어요.");
  }
}

async function saveIdentity() {
  const dialog = $("#onekanIdentityEditor");
  const title = $("#onekanIdentityTitle", dialog)?.value.trim() || "";
  if (!title) return showToast("정체성 문장을 입력해 주세요.");
  const id = editingIdentityId;
  try {
    await writeGoalState((current) => {
      current.identities = Array.isArray(current.identities) ? current.identities : [];
      if (id) {
        const identity = current.identities.find((item) => item.id === id);
        if (!identity) return;
        identity.title = title;
        identity.updatedAt = new Date().toISOString();
      } else {
        current.identities.push({ id: uid(), title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
    }, "direction-identities");
    dialog?.close();
    editingIdentityId = null;
    await renderIdentityView();
  } catch (error) {
    console.error("정체성 저장 실패", error);
    showToast("정체성을 저장하지 못했어요.");
  }
}

async function deleteIdentity() {
  if (!editingIdentityId) return;
  const id = editingIdentityId;
  try {
    await writeGoalState((current) => {
      current.identities = (current.identities || []).filter((item) => item.id !== id);
      (current.directionGoals || []).forEach((goal) => {
        if (goal.identityId === id) goal.identityId = null;
      });
    }, "direction-identity-delete");
    $("#onekanIdentityEditor")?.close();
    editingIdentityId = null;
    await renderIdentityView();
  } catch (error) {
    console.error("정체성 삭제 실패", error);
    showToast("정체성을 삭제하지 못했어요.");
  }
}

async function renderIdentityView() {
  const ui = ensureUi();
  if (!ui || activeTab !== "identity" || identityRendering) return;
  identityRendering = true;
  try {
    ui.secondary.hidden = false;
    ui.secondary.innerHTML = `<div class="onekan-identity-shell"><div class="onekan-identity-toolbar"><button class="onekan-identity-add" type="button" data-identity-add>＋ 정체성 추가</button></div><div class="onekan-identity-list"><div class="onekan-identity-empty">불러오는 중...</div></div></div>`;
    const current = await readGoalState();
    const list = $(".onekan-identity-list", ui.secondary);
    if (!current) {
      list.innerHTML = `<div class="onekan-identity-empty">로그인 후 정체성을 관리할 수 있어요.</div>`;
      return;
    }
    const identities = current.identities || [];
    list.innerHTML = identities.length ? identityRows(identities, current.directionGoals || []) : `<div class="onekan-identity-empty">아직 정체성이 없어요.<br>“나는 어떤 사람으로 살아가고 싶은가?”를 한 문장으로 적어 보세요.</div>`;
  } catch (error) {
    console.error("정체성 렌더링 실패", error);
    const list = $(".onekan-identity-list", ui.secondary);
    if (list) list.innerHTML = `<div class="onekan-identity-empty">정체성을 불러오지 못했어요.</div>`;
  } finally {
    identityRendering = false;
  }
}

async function renderGoalView() {
  const ui = ensureUi();
  if (!ui || activeTab !== "goal" || goalRendering) return;
  goalRendering = true;
  try {
    ui.secondary.hidden = false;
    ui.secondary.innerHTML = `<div class="onekan-goal-shell"><div class="onekan-goal-toolbar"><button class="onekan-goal-add" type="button" data-goal-add>＋ 목표 추가</button></div><div class="onekan-goal-list"><div class="onekan-goal-empty">불러오는 중...</div></div></div>`;
    const current = await readGoalState();
    const list = $(".onekan-goal-list", ui.secondary);
    if (!current) {
      list.innerHTML = `<div class="onekan-goal-empty">로그인 후 목표를 관리할 수 있어요.</div>`;
      return;
    }
    const goals = current.directionGoals || [];
    list.innerHTML = goals.length ? goalRows(goals, current.projects || [], current.identities || []) : `<div class="onekan-goal-empty">아직 목표가 없어요.<br>지금 이루고 싶은 것부터 하나만 만들어 보세요.</div>`;
  } catch (error) {
    console.error("목표 렌더링 실패", error);
    const list = $(".onekan-goal-list", ui.secondary);
    if (list) list.innerHTML = `<div class="onekan-goal-empty">목표를 불러오지 못했어요.</div>`;
  } finally {
    goalRendering = false;
  }
}

function render() {
  installStyle();
  const ui = ensureUi();
  if (!ui) return;
  const tab = TABS.find((item) => item.id === activeTab) || TABS[0];
  const title = $(".page-title", ui.page);
  if (title) title.textContent = tab.title;

  ui.tabs.querySelectorAll("[data-project-direction-tab]").forEach((button) => {
    const isActive = button.dataset.projectDirectionTab === activeTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  ui.root.hidden = activeTab !== "project";
  if (activeTab === "project") {
    ui.secondary.innerHTML = "";
    ui.secondary.hidden = true;
  } else if (activeTab === "goal") {
    renderGoalView();
  } else {
    renderIdentityView();
  }
}

async function persistDirectionOrder(kind) {
  const selector = kind === "goal" ? ".onekan-goal-list" : ".onekan-identity-list";
  const ids = [...document.querySelectorAll(`${selector} [data-direction-kind="${kind}"]`)].map((row) => row.dataset.directionId);
  if (!ids.length) return;
  const collectionName = kind === "goal" ? "directionGoals" : "identities";
  try {
    await writeGoalState((state) => {
      const byId = new Map(ids.map((id, index) => [id, (index + 1) * 10]));
      state[collectionName].forEach((item) => {
        if (byId.has(item.id)) item.sortOrder = byId.get(item.id);
      });
    }, "direction-order");
  } catch (error) {
    console.error("방향 목록 순서 저장 실패", error);
    showToast("순서를 저장하지 못했어요.");
    render();
  }
}

function wireDirectionDrag() {
  document.addEventListener("dragstart", (event) => {
    const row = event.target.closest?.("[data-direction-kind][data-direction-id]");
    if (!row || !row.closest("#onekanProjectDirectionSecondary")) return;
    draggedDirection = { kind: row.dataset.directionKind, id: row.dataset.directionId };
    row.classList.add("onekan-direction-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedDirection.id);
    }
  });
  document.addEventListener("dragover", (event) => {
    if (!draggedDirection) return;
    const row = event.target.closest?.(`[data-direction-kind="${draggedDirection.kind}"][data-direction-id]`);
    if (!row || row.dataset.directionId === draggedDirection.id) return;
    const moving = document.querySelector(`[data-direction-kind="${draggedDirection.kind}"][data-direction-id="${CSS.escape(draggedDirection.id)}"]`);
    if (!moving || moving.parentElement !== row.parentElement) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    row.parentElement.insertBefore(moving, event.clientY < rect.top + rect.height / 2 ? row : row.nextSibling);
  });
  document.addEventListener("drop", (event) => {
    if (!draggedDirection) return;
    event.preventDefault();
    persistDirectionOrder(draggedDirection.kind);
  });
  document.addEventListener("dragend", () => {
    document.querySelectorAll(".onekan-direction-dragging").forEach((row) => row.classList.remove("onekan-direction-dragging"));
    draggedDirection = null;
  });
}

function init() {
  installStyle();
  ensureGoalDialog();
  ensureIdentityDialog();
  render();
  wireDirectionDrag();
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-project-direction-tab]");
    if (button) {
      activeTab = button.dataset.projectDirectionTab || "project";
      sessionStorage.setItem("onekan-project-direction-tab", activeTab);
      render();
      return;
    }
    if (event.target.closest('[data-page="projects"]')) {
      setTimeout(render, 0);
      return;
    }
    if (event.target.closest("[data-goal-add]")) {
      openGoalEditor();
      return;
    }
    if (event.target.closest("[data-identity-add]")) {
      openIdentityEditor();
      return;
    }
    const identityGoalAdd = event.target.closest("[data-identity-goal-add]");
    if (identityGoalAdd) {
      const row = identityGoalAdd.closest("[data-context-kind='identity']");
      const rect = identityGoalAdd.getBoundingClientRect();
      row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom + 4 }));
      return;
    }
    const period = event.target.closest("[data-goal-period]");
    if (period) openGoalEditor(period.dataset.goalPeriod);
  });
  document.addEventListener("onekan:state-changed", (event) => {
    if (activeTab === "goal" && event.detail?.source !== "direction-goals") setTimeout(renderGoalView, 80);
    if (activeTab === "identity" && !String(event.detail?.source || "").startsWith("direction-identit")) setTimeout(renderIdentityView, 80);
  });
}

init();