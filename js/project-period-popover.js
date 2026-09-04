import { onekanStateStore } from "./supabase.js?v=1";
import { showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root?.querySelector?.(selector) || null;
let activeProjectId = null;
let activeAnchor = null;

async function readState() {
  const state = await onekanStateStore.read();
  if (!state) return null;
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  return state;
}

async function savePeriod(startDate, endDate) {
  const id = activeProjectId;
  if (!id) return;
  await onekanStateStore.mutate((current) => {
    current.projects = Array.isArray(current.projects) ? current.projects : [];
    const project = current.projects.find((item) => item.id === id && (item.kind === "project" || !item.kind));
    if (!project) return current;
    project.startDate = startDate || null;
    project.endDate = endDate || null;
    project.updatedAt = new Date().toISOString();
    return current;
  }, { source: "project-period-popover" });
}

function installStyle() {
  if ($("#onekanProjectPeriodPopoverStyle")) return;
  const style = document.createElement("style");
  style.id = "onekanProjectPeriodPopoverStyle";
  style.textContent = `
    .onekan-project-period-quick{position:fixed;z-index:13000;width:min(300px,calc(100vw - 24px));padding:10px;border:1px solid var(--line,#d2d7df);border-radius:12px;background:var(--surface,#fff);box-shadow:0 12px 34px rgba(15,23,42,.14);display:grid;gap:8px}
    .onekan-project-period-quick[hidden]{display:none!important}
    .onekan-project-period-quick strong{font-size:11px}
    .onekan-project-period-quick label{display:grid;grid-template-columns:46px minmax(0,1fr);align-items:center;gap:8px;color:var(--muted,#6d737d);font-size:10px}
    .onekan-project-period-quick input{width:100%;height:34px;min-width:0;padding:0 8px;border:1px solid var(--line,#d2d7df);border-radius:8px;background:#fff;color:var(--text,#1f2328);font:inherit;font-size:11px}
    .onekan-project-period-quick small{color:var(--muted,#6d737d);font-size:9px;line-height:1.4}
  `;
  document.head.appendChild(style);
}

function ensurePanel() {
  let panel = $("#onekanProjectPeriodQuick");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "onekanProjectPeriodQuick";
  panel.className = "onekan-project-period-quick";
  panel.hidden = true;
  panel.innerHTML = `<strong>프로젝트 기간</strong><label><span>시작일</span><input id="onekanProjectPeriodQuickStart" type="date" aria-label="프로젝트 시작일"></label><label><span>종료일</span><input id="onekanProjectPeriodQuickEnd" type="date" aria-label="프로젝트 종료일"></label><small>날짜를 선택하면 바로 저장돼요.</small>`;
  document.body.appendChild(panel);
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.addEventListener("click", (event) => event.stopPropagation());
  panel.addEventListener("change", async (event) => {
    if (!event.target.matches("input[type='date']")) return;
    const start = $("#onekanProjectPeriodQuickStart", panel)?.value || "";
    const end = $("#onekanProjectPeriodQuickEnd", panel)?.value || "";
    if (start && end && end < start) {
      showToast("종료일은 시작일보다 뒤여야 해요.");
      $("#onekanProjectPeriodQuickEnd", panel).value = "";
      return;
    }
    $("#onekanProjectPeriodQuickEnd", panel).min = start;
    try {
      await savePeriod(start, end);
    } catch (error) {
      console.error("프로젝트 기간 저장 실패", error);
      showToast("기간을 저장하지 못했어요.");
    }
  });
  return panel;
}

function closePanel() {
  const panel = $("#onekanProjectPeriodQuick");
  if (panel) panel.hidden = true;
  activeAnchor = null;
}

function positionPanel(anchor, panel) {
  const rect = anchor.getBoundingClientRect();
  panel.hidden = false;
  panel.style.visibility = "hidden";
  requestAnimationFrame(() => {
    if (panel.hidden) return;
    const box = panel.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.right - box.width, innerWidth - box.width - 12));
    const below = rect.bottom + 6;
    const above = rect.top - box.height - 6;
    const top = below + box.height <= innerHeight - 12 ? below : Math.max(12, above);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.visibility = "";
  });
}

async function openPanel(projectId, anchor) {
  const panel = ensurePanel();
  activeProjectId = projectId;
  activeAnchor = anchor;
  try {
    const current = await readState();
    const project = current?.projects.find((item) => item.id === projectId && (item.kind === "project" || !item.kind));
    if (!project || activeProjectId !== projectId) return;
    const start = /^\d{4}-\d{2}-\d{2}$/.test(project.startDate || "") ? project.startDate : "";
    const end = /^\d{4}-\d{2}-\d{2}$/.test(project.endDate || "") ? project.endDate : "";
    $("#onekanProjectPeriodQuickStart", panel).value = start;
    $("#onekanProjectPeriodQuickEnd", panel).value = end;
    $("#onekanProjectPeriodQuickEnd", panel).min = start;
    positionPanel(anchor, panel);
  } catch (error) {
    console.error("프로젝트 기간 불러오기 실패", error);
    showToast("기간을 불러오지 못했어요.");
  }
}

function init() {
  installStyle();
  ensurePanel();

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-project-period]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const id = button.dataset.projectPeriod;
    const panel = ensurePanel();
    if (!panel.hidden && activeProjectId === id && activeAnchor === button) return closePanel();
    openPanel(id, button);
  }, true);

  document.addEventListener("pointerdown", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest("#onekanProjectPeriodQuick,[data-project-period]")) return;
    closePanel();
  }, true);

  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePanel(); });
  window.addEventListener("resize", closePanel);
  document.addEventListener("scroll", (event) => {
    if (event.target instanceof Element && event.target.closest("#onekanProjectPeriodQuick")) return;
    closePanel();
  }, true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
