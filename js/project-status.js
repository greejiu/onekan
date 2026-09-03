import { supabase } from "./supabase.js";
import { showToast } from "./ui-feedback.js";
import { applyProjectStatus, projectTaskStats, restartStatusForProject } from "./project-status-automation.js?v=3";

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
const $$ = (selector, root = document) => [...(root?.querySelectorAll?.(selector) || [])];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const DEFAULT_GROUP_LABEL = "기본";
const DEFAULT_GROUP_COLOR = "#8fa9c4";
const STATUSES = [
  { id: "before", label: "시작 전" },
  { id: "doing", label: "진행 중" },
  { id: "done", label: "완료" },
  { id: "archived", label: "보관" },
];
const SHELF_STATUSES = [
  { id: "doing", label: "달리는 중", description: "진행 중" },
  { id: "before", label: "준비 중", description: "시작 전" },
  { id: "done", label: "완주함", description: "완료" },
  { id: "archived", label: "쉬는 중", description: "보관" },
];

let user = null;
let state = null;
let rendering = false;
let renderTimer = null;
let activeFilter = sessionStorage.getItem("onekan-project-filter") || "all";
let editingProjectId = null;

function normalizeStatus(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["before", "시작 전", "시작전", "todo", "planned"].includes(raw)) return "before";
  if (["done", "완료", "달성", "complete", "completed"].includes(raw)) return "done";
  if (["archived", "보관", "closed", "archive"].includes(raw)) return "archived";
  if (["doing", "진행 중", "진행중", "하는 중", "하는중", "active", "in progress", "진행"].includes(raw)) return "doing";
  return "doing";
}

function isProject(item) {
  return !!item && (item.kind === "project" || !item.kind);
}

function groupsOf(current = state) {
  const groups = Array.isArray(current?.eventGroups) && current.eventGroups.length
    ? [...current.eventGroups]
    : [{ id: "default", name: DEFAULT_GROUP_LABEL, color: DEFAULT_GROUP_COLOR }];
  return groups;
}

function goalsOf(current = state) {
  return Array.isArray(current?.directionGoals) ? current.directionGoals : [];
}

function defaultGroupId(current = state) {
  return groupsOf(current)[0]?.id || "default";
}

function projectGroupId(project, current = state) {
  const groups = groupsOf(current);
  return groups.some((group) => group.id === project?.groupId) ? project.groupId : (groups[0]?.id || "default");
}

function projectGroupColor(project, current = state) {
  const groups = groupsOf(current);
  const groupId = projectGroupId(project, current);
  const color = groups.find((group) => group.id === groupId)?.color || DEFAULT_GROUP_COLOR;
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_GROUP_COLOR;
}

function ensureWritableStructure(current) {
  current.projects = Array.isArray(current.projects) ? current.projects : [];
  current.tasks = Array.isArray(current.tasks) ? current.tasks : [];
  current.directionGoals = Array.isArray(current.directionGoals) ? current.directionGoals : [];
  current.eventGroups = Array.isArray(current.eventGroups) && current.eventGroups.length
    ? current.eventGroups
    : [{ id: "default", name: DEFAULT_GROUP_LABEL, color: DEFAULT_GROUP_COLOR }];
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) return null;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  state = data?.data && typeof data.data === "object" ? data.data : {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.directionGoals = Array.isArray(state.directionGoals) ? state.directionGoals : [];
  state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length ? state.eventGroups : [{ id: "default", name: DEFAULT_GROUP_LABEL, color: DEFAULT_GROUP_COLOR }];
  return state;
}

async function writeState(mutator, source = "project-status") {
  await readState();
  if (!state || !user) return false;
  ensureWritableStructure(state);
  mutator(state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source } }));
  $("#reloadCloudBtn")?.click();
  scheduleRender(100);
  return true;
}

function installStyle() {
  if ($("#onekanProjectStatusStyle")) return;
  const style = document.createElement("style");
  style.id = "onekanProjectStatusStyle";
  style.textContent = `
    #page-projects{--project-line:var(--line,#d2d7df)}
    .onekan-project-shell{display:grid;gap:14px;min-width:0}
    .onekan-project-toolbar{display:flex;align-items:center;gap:10px;min-width:0}
    .onekan-project-filter{height:34px;min-width:116px;padding:0 30px 0 12px;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:999px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px;font-weight:700;cursor:pointer}
    .onekan-project-toolbar-add{height:34px;padding:0 12px;border:1px solid var(--line,#d2d7df);border-radius:9px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:11px;font-weight:700;cursor:pointer}
    .onekan-project-toolbar-add:hover{background:var(--panel-soft,#f4f5f6)}
    .onekan-project-board-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:stretch}
    .onekan-project-board{display:grid;grid-template-rows:auto 1fr;min-height:260px;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:15px;background:#fff;overflow:hidden;transition:border-color .15s,box-shadow .15s}
    .onekan-project-board.is-drop,.onekan-project-group.is-drop{border-color:var(--accent,#8fa9c4);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#8fa9c4) 13%,transparent)}
    .onekan-project-board-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 13px 8px}
    .onekan-project-board-head strong{font-size:13px}
    .onekan-project-count{display:inline-grid;place-items:center;min-width:22px;height:20px;padding:0 6px;border-radius:999px;background:var(--panel-soft,#f4f5f6);color:var(--muted,#6d737d);font-size:9px;font-weight:700}
    .onekan-project-bookshelf{display:grid;gap:26px;padding:4px 0 18px}
    .onekan-project-shelf{min-width:0}
    .onekan-project-shelf-head{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:0 4px;border:0;background:transparent;color:var(--text,#1f2328);font:inherit;text-align:left;cursor:pointer}
    .onekan-project-shelf-chevron{display:grid;place-items:center;width:18px;color:var(--muted,#6d737d);font-size:12px;transition:transform .16s ease}
    .onekan-project-shelf.is-collapsed .onekan-project-shelf-chevron{transform:rotate(-90deg)}
    .onekan-project-shelf-head strong{font-size:15px}
    .onekan-project-shelf-description{color:var(--muted,#6d737d);font-size:10px}
    .onekan-project-shelf-count{margin-left:auto;color:var(--muted,#6d737d);font-size:10px;font-weight:700}
    .onekan-project-shelf-stage{position:relative;min-height:224px;padding:18px 18px 27px;border-radius:16px 16px 5px 5px;background:linear-gradient(180deg,color-mix(in srgb,var(--panel-soft,#f4f5f6) 72%,#fff),#fff 72%)}
    .onekan-project-shelf-stage::after{content:"";position:absolute;right:0;bottom:8px;left:0;height:10px;border:1px solid color-mix(in srgb,var(--line-strong,#b8c0cb) 78%,#fff);border-radius:2px 2px 6px 6px;background:linear-gradient(180deg,#fff,color-mix(in srgb,var(--line,#d2d7df) 38%,#fff));box-shadow:0 5px 9px rgba(45,40,53,.09)}
    .onekan-project-shelf.is-collapsed .onekan-project-shelf-stage{min-height:18px;padding:0;background:transparent}
    .onekan-project-shelf.is-collapsed .onekan-project-shelf-stage>*{display:none}
    .onekan-project-books{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,140px));align-items:end;gap:18px 15px;min-height:178px}
    .onekan-project-book{position:relative;display:grid;grid-template-rows:auto 1fr auto auto;width:100%;aspect-ratio:3/4;padding:16px 13px 13px 18px;overflow:hidden;border:1px solid color-mix(in srgb,var(--book-color,#8fa9c4) 64%,#5e5a65);border-radius:5px 9px 8px 5px;background:linear-gradient(105deg,color-mix(in srgb,var(--book-color,#8fa9c4) 78%,#fff) 0 8%,color-mix(in srgb,var(--book-color,#8fa9c4) 58%,#fff) 8% 94%,color-mix(in srgb,var(--book-color,#8fa9c4) 42%,#fff) 94%);box-shadow:3px 4px 0 color-mix(in srgb,var(--book-color,#8fa9c4) 24%,#fff),0 7px 12px rgba(45,40,53,.12);color:color-mix(in srgb,var(--book-color,#8fa9c4) 28%,#24212a);font:inherit;text-align:left;cursor:pointer;transform:translateY(0);transition:transform .16s ease,box-shadow .16s ease}
    .onekan-project-book::before{content:"";position:absolute;top:0;bottom:0;left:8px;width:1px;background:color-mix(in srgb,var(--book-color,#8fa9c4) 55%,#fff);box-shadow:2px 0 0 rgba(255,255,255,.32)}
    .onekan-project-book:hover,.onekan-project-book:focus-visible{transform:translateY(-4px);box-shadow:4px 7px 0 color-mix(in srgb,var(--book-color,#8fa9c4) 24%,#fff),0 11px 17px rgba(45,40,53,.15);outline:none}
    .onekan-project-book:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#8fa9c4) 28%,transparent),4px 7px 0 color-mix(in srgb,var(--book-color,#8fa9c4) 24%,#fff),0 11px 17px rgba(45,40,53,.15)}
    .onekan-project-book-area{overflow:hidden;color:color-mix(in srgb,var(--book-color,#8fa9c4) 43%,#38333d);font-size:9px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}
    .onekan-project-book-title{display:-webkit-box;align-self:start;margin-top:14px;overflow:hidden;font-size:14px;font-weight:700;line-height:1.42;-webkit-box-orient:vertical;-webkit-line-clamp:3}
    .onekan-project-book-stats{display:flex;justify-content:space-between;gap:5px;margin-top:10px;font-size:9px;font-weight:700}
    .onekan-project-book-progress{height:4px;margin-top:7px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.58)}
    .onekan-project-book-progress>span{display:block;width:var(--book-progress,0%);height:100%;border-radius:inherit;background:color-mix(in srgb,var(--book-color,#8fa9c4) 76%,#39333f)}
    .onekan-project-book.is-done::after{content:"";position:absolute;top:-1px;right:14px;width:12px;height:27px;background:#f08b91;clip-path:polygon(0 0,100% 0,100% 100%,50% 76%,0 100%);box-shadow:0 1px 2px #0002}
    .onekan-project-book.is-archived{filter:saturate(.38);opacity:.72}
    .onekan-project-shelf-empty{display:grid;place-items:center;min-height:178px;color:var(--muted,#6d737d);font-size:10px}
    .onekan-project-list{display:grid;align-content:start;gap:2px;padding:0 10px 11px;min-height:190px}
    .onekan-project-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;min-height:38px;padding:7px 8px;border:1px solid color-mix(in srgb,var(--uw-group,#8fa9c4) 45%,#fff);border-radius:8px;background:color-mix(in srgb,var(--uw-group,#8fa9c4) 16%,#fff);cursor:grab;user-select:none}
    .onekan-project-row:hover{background:color-mix(in srgb,var(--uw-group,#8fa9c4) 23%,#fff)}
    .onekan-project-row.dragging{opacity:.45}
    .onekan-project-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:400;cursor:pointer}
    .onekan-project-row-actions{display:flex;align-items:center;justify-content:flex-end;gap:5px;min-width:0}
    .onekan-project-suggestion{height:25px;padding:0 8px;border:1px solid color-mix(in srgb,var(--accent,#8fa9c4) 50%,#fff);border-radius:999px;background:#fff;color:var(--accent,#6f8195);font:inherit;font-size:9px;font-weight:700;white-space:nowrap;cursor:pointer}
    .onekan-project-suggestion:hover{background:color-mix(in srgb,var(--accent,#8fa9c4) 10%,#fff)}
    .onekan-project-period{display:flex;align-items:center;gap:6px;color:var(--muted,#6d737d);font-size:9px;white-space:nowrap}
    .onekan-project-period button{display:grid;place-items:center;width:25px;height:25px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
    .onekan-project-period button:hover{background:#fff}
    .onekan-project-period button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .onekan-project-add{justify-self:start;margin:3px 5px 0;padding:7px 4px;border:0;background:transparent;color:var(--muted,#6d737d);font:inherit;font-size:11px;cursor:pointer}
    .onekan-project-add:hover{color:var(--text,#1f2328)}
    .onekan-project-empty{padding:10px 8px;color:var(--muted,#6d737d);font-size:10px}
    .onekan-project-group-view{min-height:440px;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:15px;background:#fff;padding:18px 16px 20px}
    .onekan-project-groups{display:grid;gap:5px}
    .onekan-project-group{border:1.5px solid transparent;border-radius:10px;padding:4px 7px 7px;transition:border-color .15s,box-shadow .15s}
    .onekan-project-group-head{display:flex;align-items:center;gap:6px;min-height:30px;padding:0 2px;cursor:pointer}
    .onekan-project-group-chevron{width:14px;color:var(--text,#1f2328);font-size:11px}
    .onekan-project-group-dot{width:8px;height:8px;border-radius:50%;background:var(--project-group,#8fa9c4)}
    .onekan-project-group-head strong{font-size:12px}
    .onekan-project-group-head small{margin-left:auto;color:var(--muted,#6d737d);font-size:9px}
    .onekan-project-group-body{display:grid;gap:1px;padding-left:24px}
    .onekan-project-group.collapsed .onekan-project-group-body{display:none}
    .onekan-project-group-add{margin-top:12px;padding:7px 6px;border:0;background:transparent;color:var(--text,#1f2328);font:inherit;font-size:11px;cursor:pointer}
    .onekan-project-group-add:hover{text-decoration:underline}
    .onekan-project-dialog{width:min(430px,calc(100vw - 28px));padding:0;border:1.5px solid var(--line-strong,#b8c0cb);border-radius:14px;background:#fff;color:var(--text,#1f2328);box-shadow:0 20px 60px rgba(15,23,42,.18)}
    .onekan-project-dialog::backdrop{background:rgba(15,23,42,.2)}
    .onekan-project-dialog form{display:grid;gap:13px;padding:18px}
    .onekan-project-dialog h3{margin:0;font-size:16px}
    .onekan-project-fields{display:grid;gap:10px}
    .onekan-project-fields label{display:grid;gap:5px;color:var(--muted,#6d737d);font-size:10px}
    .onekan-project-fields input,.onekan-project-fields select{width:100%;height:36px;padding:0 10px;border:1px solid var(--project-line);border-radius:8px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:12px}
    .onekan-project-date-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .onekan-project-dialog-actions{display:flex;justify-content:flex-end;gap:7px}
    @media(max-width:800px){.onekan-project-board-grid{grid-template-columns:1fr}.onekan-project-board{min-height:220px}.onekan-project-group-view{min-height:360px;padding:13px 10px}.onekan-project-row{grid-template-columns:minmax(0,1fr);gap:2px}.onekan-project-row-actions{justify-content:flex-start}.onekan-project-period{justify-content:flex-start}.onekan-project-date-row{grid-template-columns:1fr}.onekan-project-bookshelf{gap:20px}.onekan-project-shelf-stage{padding:14px 12px 24px}.onekan-project-books{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:14px 10px}.onekan-project-book{max-width:136px;padding:13px 10px 11px 15px}.onekan-project-book-title{margin-top:10px;font-size:12px}}
  `;
  document.head.appendChild(style);
}

function projectDates(project) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(project?.startDate || "") ? project.startDate : null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(project?.endDate || "") ? project.endDate : /^\d{4}-\d{2}-\d{2}$/.test(project?.deadline || "") ? project.deadline : null;
  return { start, end };
}

function shortDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${year.slice(2)}.${month}.${day}`;
}

function periodText(project) {
  const { start, end } = projectDates(project);
  if (start && end) return `${shortDate(start)} ~ ${shortDate(end)}`;
  if (start) return `${shortDate(start)} ~`;
  if (end) return `~ ${shortDate(end)}`;
  return "기간 없음";
}

function projectRow(project) {
  const status = normalizeStatus(project.status);
  const stats = projectTaskStats(state, project.id);
  const suggestion = status === "doing" && stats.total > 0 && stats.incomplete === 0
    ? `<button class="onekan-project-suggestion" type="button" data-project-suggestion="complete" data-project-suggestion-id="${esc(project.id)}">완료할까요?</button>`
    : "";
  return `<div class="onekan-project-row" style="--uw-group:${esc(projectGroupColor(project))}" draggable="true" data-project-status-id="${esc(project.id)}" data-context-kind="project" data-context-id="${esc(project.id)}">
    <span class="onekan-project-title" data-project-edit="${esc(project.id)}">${esc(project.title || "이름 없는 프로젝트")}</span>
    <span class="onekan-project-row-actions">${suggestion}<span class="onekan-project-period"><span>${esc(periodText(project))}</span><button type="button" data-project-period="${esc(project.id)}" aria-label="기간 수정" title="기간 수정"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path></svg></button></span></span>
  </div>`;
}

function projectGroup(project) {
  const groupId = projectGroupId(project);
  return groupsOf().find((group) => group.id === groupId) || { id: groupId, name: DEFAULT_GROUP_LABEL, color: DEFAULT_GROUP_COLOR };
}

function projectBook(project) {
  const status = normalizeStatus(project.status);
  const group = projectGroup(project);
  const stats = projectTaskStats(state, project.id);
  const progress = status === "done" ? 100 : (stats.total ? Math.round((stats.done / stats.total) * 100) : 0);
  const title = project.title || "이름 없는 프로젝트";
  return `<button class="onekan-project-book${status === "done" ? " is-done" : ""}${status === "archived" ? " is-archived" : ""}" style="--book-color:${esc(projectGroupColor(project))};--book-progress:${progress}%" type="button" data-project-edit="${esc(project.id)}" data-context-kind="project" data-context-id="${esc(project.id)}" aria-label="${esc(title)} · ${esc(group.name || DEFAULT_GROUP_LABEL)} · 완료 ${stats.done}/${stats.total}">
    <span class="onekan-project-book-area">${esc(group.name || DEFAULT_GROUP_LABEL)}</span>
    <span class="onekan-project-book-title">${esc(title)}</span>
    <span class="onekan-project-book-stats"><span>완료 ${stats.done}/${stats.total}</span><span>${progress}%</span></span>
    <span class="onekan-project-book-progress" aria-hidden="true"><span></span></span>
  </button>`;
}

function filteredProjects(current = state) {
  return (current?.projects || []).filter(isProject);
}

function bookshelfSection(status, projects) {
  const items = projects.filter((project) => normalizeStatus(project.status) === status.id);
  const collapsed = localStorage.getItem(`onekan-project-shelf-${status.id}`) === "0";
  return `<section class="onekan-project-shelf${collapsed ? " is-collapsed" : ""}" data-project-shelf="${status.id}">
    <button class="onekan-project-shelf-head" type="button" data-project-shelf-toggle="${status.id}" aria-expanded="${String(!collapsed)}"><span class="onekan-project-shelf-chevron">⌄</span><strong>${esc(status.label)}</strong><span class="onekan-project-shelf-description">${esc(status.description)}</span><span class="onekan-project-shelf-count">${items.length}권</span></button>
    <div class="onekan-project-shelf-stage"><div class="onekan-project-books">${items.length ? items.map(projectBook).join("") : '<div class="onekan-project-shelf-empty">아직 놓인 책이 없어요.</div>'}</div></div>
  </section>`;
}

function groupBlock(group, projects, statusId) {
  const items = projects.filter((project) => normalizeStatus(project.status) === statusId && projectGroupId(project) === group.id);
  const collapsed = sessionStorage.getItem(`onekan-project-group-${group.id}`) === "0";
  return `<section class="onekan-project-group${collapsed ? " collapsed" : ""}" data-project-group-drop="${esc(group.id)}" style="--project-group:${esc(group.color || DEFAULT_GROUP_COLOR)}">
    <div class="onekan-project-group-head" data-project-group-toggle="${esc(group.id)}"><span class="onekan-project-group-chevron">${collapsed ? "▶" : "▼"}</span><span class="onekan-project-group-dot"></span><strong>${esc(group.name || DEFAULT_GROUP_LABEL)}</strong><small>${items.length}개</small></div>
    <div class="onekan-project-group-body">${items.map(projectRow).join("")}<button class="onekan-project-add" type="button" data-project-add-group="${esc(group.id)}">＋ 프로젝트 추가</button></div>
  </section>`;
}

function renderMarkup() {
  const projects = filteredProjects();
  const filterOptions = [{ id: "all", label: "전체" }, ...STATUSES].map((item) => `<option value="${item.id}"${item.id === activeFilter ? " selected" : ""}>${esc(item.label)}</option>`).join("");
  const toolbar = `<div class="onekan-project-toolbar"><select class="onekan-project-filter" id="onekanProjectFilter" aria-label="프로젝트 상태 보기">${filterOptions}</select><button class="onekan-project-toolbar-add" type="button" data-project-add-status="before">＋ 프로젝트</button></div>`;
  if (activeFilter === "all") {
    return `${toolbar}<div class="onekan-project-bookshelf">${SHELF_STATUSES.map((status) => bookshelfSection(status, projects)).join("")}</div>`;
  }
  const groups = groupsOf().filter((group) => projects.some((project) => normalizeStatus(project.status) === activeFilter && projectGroupId(project) === group.id));
  const groupsMarkup = groups.length ? groups.map((group) => groupBlock(group, projects, activeFilter)).join("") : '<div class="onekan-project-empty">이 상태의 프로젝트가 없어요.</div>';
  return `${toolbar}<section class="onekan-project-group-view"><div class="onekan-project-groups">${groupsMarkup}</div></section>`;
}

function ensureDialog() {
  let dialog = $("#onekanProjectEditor");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "onekanProjectEditor";
  dialog.className = "onekan-project-dialog";
  dialog.innerHTML = `<form method="dialog" id="onekanProjectForm">
    <h3 id="onekanProjectDialogTitle">프로젝트</h3>
    <div class="onekan-project-fields">
      <label>이름<input id="onekanProjectTitle" maxlength="120" autocomplete="off" required /></label>
      <label>상태<select id="onekanProjectStatus">${STATUSES.map((status) => `<option value="${status.id}">${status.label}</option>`).join("")}</select></label>
      <label>목표<select id="onekanProjectGoal"></select></label>
      <label>영역<select id="onekanProjectGroup"></select></label>
      <div class="onekan-project-date-row"><label>시작일<input id="onekanProjectStart" type="date" /></label><label>종료일<input id="onekanProjectEnd" type="date" /></label></div>
    </div>
    <div class="onekan-project-dialog-actions"><button class="soft-btn" id="onekanProjectCancel" type="button">취소</button><button class="primary-btn" id="onekanProjectSave" type="button">저장</button></div>
  </form>`;
  document.body.appendChild(dialog);
  $("#onekanProjectCancel", dialog).addEventListener("click", () => dialog.close());
  $("#onekanProjectSave", dialog).addEventListener("click", saveEditor);
  dialog.addEventListener("close", () => { editingProjectId = null; });
  return dialog;
}

function fillGroupSelect(selectedId) {
  const select = $("#onekanProjectGroup");
  if (!select) return;
  const groups = groupsOf();
  select.innerHTML = groups.map((group) => `<option value="${esc(group.id)}"${group.id === selectedId ? " selected" : ""}>${esc(group.name || DEFAULT_GROUP_LABEL)}</option>`).join("");
}

function fillGoalSelect(selectedId) {
  const select = $("#onekanProjectGoal");
  if (!select) return;
  const goals = goalsOf();
  const selectedExists = goals.some((goal) => goal.id === selectedId);
  select.innerHTML = `<option value="">목표 없음</option>${goals.map((goal) => `<option value="${esc(goal.id)}"${goal.id === selectedId ? " selected" : ""}>${esc(goal.title || "이름 없는 목표")}</option>`).join("")}`;
  select.value = selectedExists ? selectedId : "";
}

async function openEditor({ projectId = null, status = "before", groupId = null, goalId = null, focusPeriod = false } = {}) {
  await readState();
  const dialog = ensureDialog();
  editingProjectId = projectId;
  const project = projectId ? filteredProjects().find((item) => item.id === projectId) : null;
  $("#onekanProjectDialogTitle", dialog).textContent = project ? "프로젝트 수정" : "프로젝트 추가";
  $("#onekanProjectTitle", dialog).value = project?.title || "";
  $("#onekanProjectStatus", dialog).value = project ? normalizeStatus(project.status) : status;
  fillGoalSelect(project?.goalId || goalId || "");
  fillGroupSelect(project ? projectGroupId(project) : (groupId || defaultGroupId()));
  const dates = projectDates(project);
  $("#onekanProjectStart", dialog).value = dates.start || "";
  $("#onekanProjectEnd", dialog).value = dates.end || "";
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => (focusPeriod ? $("#onekanProjectStart", dialog) : $("#onekanProjectTitle", dialog))?.focus());
}

async function saveEditor() {
  const dialog = $("#onekanProjectEditor");
  const title = $("#onekanProjectTitle", dialog)?.value.trim();
  if (!title) return $("#onekanProjectTitle", dialog)?.focus();
  const status = $("#onekanProjectStatus", dialog)?.value || "doing";
  const goalId = $("#onekanProjectGoal", dialog)?.value || null;
  const groupId = $("#onekanProjectGroup", dialog)?.value || defaultGroupId();
  const startDate = $("#onekanProjectStart", dialog)?.value || null;
  const endDate = $("#onekanProjectEnd", dialog)?.value || null;
  if (startDate && endDate && endDate < startDate) return showToast("종료일은 시작일보다 뒤여야 해요.");
  const id = editingProjectId;
  try {
    await writeState((current) => {
      const validGoalId = goalId && current.directionGoals.some((goal) => goal.id === goalId) ? goalId : null;
      if (id) {
        const project = current.projects.find((item) => item.id === id && isProject(item));
        if (!project) return;
        project.title = title;
        project.status = status;
        project.goalId = validGoalId;
        project.groupId = groupId;
        delete project.projectGroupId;
        project.startDate = startDate;
        project.endDate = endDate;
        project.updatedAt = new Date().toISOString();
      } else {
        current.projects.push({ id: uid(), kind: "project", title, status: "before", goalId: validGoalId, groupId, startDate, endDate, createdAt: new Date().toISOString() });
      }
    }, id ? "project-edit" : "project-add");
    dialog.close();
  } catch (error) {
    console.error("프로젝트 저장 실패", error);
    showToast("프로젝트를 저장하지 못했어요.");
  }
}

async function moveProject(projectId, { status = null, groupId = null } = {}) {
  if (!projectId) return;
  try {
    await writeState((current) => {
      const project = current.projects.find((item) => item.id === projectId && isProject(item));
      if (!project) return;
      if (status) {
        const nextStatus = normalizeStatus(project.status) === "archived" && status !== "archived"
          ? restartStatusForProject(current, project.id)
          : status;
        applyProjectStatus(project, nextStatus);
      }
      if (groupId) {
        project.groupId = groupId;
        delete project.projectGroupId;
      }
      project.updatedAt = new Date().toISOString();
    }, "project-drag");
  } catch (error) {
    console.error("프로젝트 이동 실패", error);
    showToast("프로젝트를 이동하지 못했어요.");
  }
}

async function applySuggestion(projectId, action) {
  if (!projectId || action !== "complete") return;
  try {
    await writeState((current) => {
      const project = current.projects.find((item) => item.id === projectId && isProject(item));
      if (!project) return;
      applyProjectStatus(project, "done");
    }, `project-${action}-suggestion`);
    showToast("프로젝트를 완료했어요.");
  } catch (error) {
    console.error("프로젝트 제안 적용 실패", error);
    showToast("프로젝트 상태를 변경하지 못했어요.");
  }
}

function clearDropState() {
  $$(".onekan-project-board.is-drop,.onekan-project-group.is-drop").forEach((node) => node.classList.remove("is-drop"));
}

function wireRoot(root) {
  if (root.dataset.projectStatusWired) return;
  root.dataset.projectStatusWired = "1";
  root.addEventListener("change", (event) => {
    const filter = event.target.closest("#onekanProjectFilter");
    if (!filter) return;
    activeFilter = filter.value || "all";
    sessionStorage.setItem("onekan-project-filter", activeFilter);
    render();
  });
  root.addEventListener("click", (event) => {
    const suggestion = event.target.closest("[data-project-suggestion][data-project-suggestion-id]");
    if (suggestion) return applySuggestion(suggestion.dataset.projectSuggestionId, suggestion.dataset.projectSuggestion);
    const addStatus = event.target.closest("[data-project-add-status]");
    if (addStatus) return openEditor({ status: addStatus.dataset.projectAddStatus || "before", groupId: defaultGroupId() });
    const addGroupProject = event.target.closest("[data-project-add-group]");
    if (addGroupProject) return openEditor({ status: "before", groupId: addGroupProject.dataset.projectAddGroup });
    const period = event.target.closest("[data-project-period]");
    if (period) return openEditor({ projectId: period.dataset.projectPeriod, focusPeriod: true });
    const edit = event.target.closest("[data-project-edit]");
    if (edit) return openEditor({ projectId: edit.dataset.projectEdit });
    const shelfToggle = event.target.closest("[data-project-shelf-toggle]");
    if (shelfToggle) {
      const id = shelfToggle.dataset.projectShelfToggle;
      const shelf = shelfToggle.closest(".onekan-project-shelf");
      const collapsed = !shelf.classList.contains("is-collapsed");
      localStorage.setItem(`onekan-project-shelf-${id}`, collapsed ? "0" : "1");
      shelf.classList.toggle("is-collapsed", collapsed);
      shelfToggle.setAttribute("aria-expanded", String(!collapsed));
      return;
    }
    const toggle = event.target.closest("[data-project-group-toggle]");
    if (toggle) {
      const id = toggle.dataset.projectGroupToggle;
      const group = toggle.closest(".onekan-project-group");
      const collapsed = !group.classList.contains("collapsed");
      sessionStorage.setItem(`onekan-project-group-${id}`, collapsed ? "0" : "1");
      group.classList.toggle("collapsed", collapsed);
      $(".onekan-project-group-chevron", group).textContent = collapsed ? "▶" : "▼";
    }
  });
  root.addEventListener("dragstart", (event) => {
    const row = event.target.closest("[data-project-status-id]");
    if (!row) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/onekan-project-id", row.dataset.projectStatusId);
    window.__onekanSuppressItemClickUntil = Date.now() + 700;
    row.classList.add("dragging");
  });
  root.addEventListener("dragend", (event) => {
    window.__onekanSuppressItemClickUntil = Date.now() + 700;
    event.target.closest("[data-project-status-id]")?.classList.remove("dragging");
    clearDropState();
  });
  root.addEventListener("dragover", (event) => {
    if (!Array.from(event.dataTransfer.types).includes("text/onekan-project-id")) return;
    const target = event.target.closest("[data-project-status-drop],[data-project-group-drop]");
    if (!target) return;
    event.preventDefault();
    clearDropState();
    target.classList.add("is-drop");
  });
  root.addEventListener("dragleave", (event) => {
    const target = event.target.closest("[data-project-status-drop],[data-project-group-drop]");
    if (target && !target.contains(event.relatedTarget)) target.classList.remove("is-drop");
  });
  root.addEventListener("drop", async (event) => {
    const projectId = event.dataTransfer.getData("text/onekan-project-id");
    const target = event.target.closest("[data-project-status-drop],[data-project-group-drop]");
    if (!projectId || !target) return;
    event.preventDefault();
    window.__onekanSuppressItemClickUntil = Date.now() + 700;
    clearDropState();
    if (target.dataset.projectStatusDrop) await moveProject(projectId, { status: target.dataset.projectStatusDrop });
    else if (target.dataset.projectGroupDrop) await moveProject(projectId, { status: activeFilter === "all" ? null : activeFilter, groupId: target.dataset.projectGroupDrop });
  });
}

async function render() {
  const page = $("#page-projects");
  const root = $("#projectStatusRoot");
  if (!page || !root || !page.classList.contains("active") || rendering) return;
  rendering = true;
  try {
    installStyle();
    if (!STATUSES.some((status) => status.id === activeFilter) && activeFilter !== "all") activeFilter = "all";
    root.innerHTML = '<div class="onekan-project-empty">불러오는 중...</div>';
    const current = await readState();
    if (!current) {
      root.innerHTML = '<div class="onekan-project-empty">로그인 후 프로젝트를 확인할 수 있어요.</div>';
      return;
    }
    root.innerHTML = `<div class="onekan-project-shell">${renderMarkup()}</div>`;
    wireRoot(root);
  } catch (error) {
    console.error("프로젝트 현황 렌더링 실패", error);
    root.innerHTML = '<div class="onekan-project-empty">프로젝트를 불러오지 못했어요.</div>';
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 60) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, delay);
}

function init() {
  installStyle();
  ensureDialog();
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-page="projects"]')) scheduleRender(30);
  });
  document.addEventListener("onekan:state-changed", (event) => {
    if (event.detail?.source === "app-render") return;
    if ($("#page-projects")?.classList.contains("active")) scheduleRender(100);
  });
  document.addEventListener("onekan:add-project", (event) => {
    const goalId = event.detail?.goalId || null;
    openEditor({ goalId, status: "before" });
  });
  if ($("#page-projects")?.classList.contains("active")) scheduleRender(0);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
