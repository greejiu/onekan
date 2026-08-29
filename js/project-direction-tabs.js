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
let goalRendering = false;

function normalizeGoalStatus(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["before", "시작 전", "시작전", "todo", "planned"].includes(raw)) return "before";
  if (["done", "완료", "complete", "completed"].includes(raw)) return "done";
  if (["archived", "보관", "closed", "archive"].includes(raw)) return "archived";
  return "doing";
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
    .onekan-goal-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;min-height:46px;padding:7px 8px;border-bottom:1px solid var(--line,#e1e4e8)}
    .onekan-goal-row:last-child{border-bottom:0}
    .onekan-goal-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;color:var(--text,#1f2328);font:inherit;font-size:12px;font-weight:650;text-align:left;cursor:pointer}
    .onekan-goal-title:hover{text-decoration:underline}
    .onekan-goal-status{display:inline-flex;align-items:center;min-height:24px;padding:0 8px;border-radius:999px;background:var(--panel-soft,#f4f5f6);color:var(--muted,#6d737d);font-size:9px;font-weight:700;white-space:nowrap}
    .onekan-goal-period{display:flex;align-items:center;gap:5px;color:var(--muted,#6d737d);font-size:9px;white-space:nowrap}
    .onekan-goal-period button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer}
    .onekan-goal-period button:hover{background:var(--panel-soft,#f4f5f6);color:var(--accent,#8fa9c4)}
    .onekan-goal-period svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .onekan-goal-empty{display:grid;place-items:center;min-height:300px;color:var(--muted,#6d737d);font-size:11px;text-align:center}
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
    @media(max-width:700px){#page-projects .page-head{align-items:flex-start;flex-direction:column}.onekan-project-direction-tabs{align-self:stretch}.onekan-project-direction-tabs button{flex:1}.onekan-goal-row{grid-template-columns:minmax(0,1fr) auto}.onekan-goal-period{grid-column:1/-1;justify-content:flex-end}.onekan-goal-date-row{grid-template-columns:1fr}}
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
  return goalState;
}

async function writeGoalState(mutator, source = "direction-goals") {
  await readGoalState();
  if (!goalUser || !goalState) return false;
  goalState.directionGoals = Array.isArray(goalState.directionGoals) ? goalState.directionGoals : [];
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

function goalRows(goals) {
  const statusOrder = new Map(GOAL_STATUSES.map((item, index) => [item.id, index]));
  return [...goals]
    .sort((a, b) => (statusOrder.get(normalizeGoalStatus(a.status)) ?? 9) - (statusOrder.get(normalizeGoalStatus(b.status)) ?? 9) || String(a.startDate || "9999-99-99").localeCompare(String(b.startDate || "9999-99-99")) || String(a.title || "").localeCompare(String(b.title || ""), "ko"))
    .map((goal) => `<div class="onekan-goal-row" data-goal-id="${esc(goal.id)}"><button class="onekan-goal-title" type="button" data-goal-edit="${esc(goal.id)}">${esc(goal.title || "이름 없는 목표")}</button><span class="onekan-goal-status">${esc(statusLabel(goal.status))}</span><span class="onekan-goal-period"><span>${esc(goalPeriod(goal))}</span><button type="button" data-goal-period="${esc(goal.id)}" aria-label="목표 기간 수정" title="목표 기간 수정"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path></svg></button></span></div>`)
    .join("");
}

function ensureGoalDialog() {
  let dialog = $("#onekanGoalEditor");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "onekanGoalEditor";
  dialog.className = "onekan-goal-dialog";
  dialog.innerHTML = `<form method="dialog" id="onekanGoalForm"><h3 id="onekanGoalDialogTitle">목표 추가</h3><div class="onekan-goal-fields"><label>목표<input id="onekanGoalTitle" maxlength="120" autocomplete="off" placeholder="예: 디자인 분야 취업하기"></label><label>상태<select id="onekanGoalStatus">${GOAL_STATUSES.map((item) => `<option value="${item.id}">${item.label}</option>`).join("")}</select></label><div class="onekan-goal-date-row"><label>시작일<input id="onekanGoalStart" type="date"></label><label>종료일<input id="onekanGoalEnd" type="date"></label></div></div><div class="onekan-goal-actions"><button class="ghost-btn onekan-goal-delete" id="onekanGoalDelete" type="button" hidden>삭제</button><button class="soft-btn" value="cancel" type="submit">취소</button><button class="primary-btn" id="onekanGoalSave" type="button">저장</button></div></form>`;
  document.body.appendChild(dialog);
  $("#onekanGoalSave", dialog)?.addEventListener("click", saveGoal);
  $("#onekanGoalDelete", dialog)?.addEventListener("click", deleteGoal);
  return dialog;
}

async function openGoalEditor(goalId = null) {
  try {
    await readGoalState();
    const dialog = ensureGoalDialog();
    const goal = goalId ? goalState?.directionGoals?.find((item) => item.id === goalId) : null;
    editingGoalId = goal?.id || null;
    $("#onekanGoalDialogTitle", dialog).textContent = editingGoalId ? "목표 수정" : "목표 추가";
    $("#onekanGoalTitle", dialog).value = goal?.title || "";
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
  const status = normalizeGoalStatus($("#onekanGoalStatus", dialog)?.value || "doing");
  const startDate = $("#onekanGoalStart", dialog)?.value || null;
  const endDate = $("#onekanGoalEnd", dialog)?.value || null;
  if (!title) return showToast("목표 이름을 입력해 주세요.");
  if (startDate && endDate && endDate < startDate) return showToast("종료일은 시작일보다 뒤여야 해요.");
  const id = editingGoalId;
  try {
    await writeGoalState((current) => {
      current.directionGoals = Array.isArray(current.directionGoals) ? current.directionGoals : [];
      if (id) {
        const goal = current.directionGoals.find((item) => item.id === id);
        if (!goal) return;
        goal.title = title;
        goal.status = status;
        goal.startDate = startDate;
        goal.endDate = endDate;
        goal.updatedAt = new Date().toISOString();
      } else {
        current.directionGoals.push({ id: uid(), title, status, startDate, endDate, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
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
    }, "direction-goal-delete");
    $("#onekanGoalEditor")?.close();
    editingGoalId = null;
    await renderGoalView();
  } catch (error) {
    console.error("목표 삭제 실패", error);
    showToast("목표를 삭제하지 못했어요.");
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
    list.innerHTML = goals.length ? goalRows(goals) : `<div class="onekan-goal-empty">아직 목표가 없어요.<br>지금 이루고 싶은 것부터 하나만 만들어 보세요.</div>`;
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
    ui.secondary.hidden = false;
    ui.secondary.innerHTML = `<div class="onekan-project-direction-placeholder">정체성은 목표 연결 다음 단계에서 붙일게요.</div>`;
  }
}

function init() {
  installStyle();
  ensureGoalDialog();
  render();
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
    const edit = event.target.closest("[data-goal-edit]");
    if (edit) {
      openGoalEditor(edit.dataset.goalEdit);
      return;
    }
    const period = event.target.closest("[data-goal-period]");
    if (period) openGoalEditor(period.dataset.goalPeriod);
  });
  document.addEventListener("onekan:state-changed", (event) => {
    if (activeTab === "goal" && event.detail?.source !== "direction-goals") setTimeout(renderGoalView, 80);
  });
}

init();
