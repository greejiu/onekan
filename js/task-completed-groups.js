import "./task-input-controls.js?v=3";
import { onekanStateStore } from "./supabase.js?v=1";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(2, "0");

let decorating = false;
let timer = null;
let requestToken = 0;

function localDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(key, amount) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateHeading(key) {
  if (!key) return "날짜 없음";
  const today = todayKey();
  if (key === today) return "오늘";
  if (key === addDays(today, -1)) return "어제";
  const date = new Date(`${key}T12:00:00`);
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(date);
}

function installStyle() {
  if ($("#taskCompletedGroupStyle")) return;
  const style = document.createElement("style");
  style.id = "taskCompletedGroupStyle";
  style.textContent = `
    .uw-task-completed-groups{display:grid;gap:14px}
    .uw-task-completed-day{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--surface,#fff)}
    .uw-task-completed-day-head{display:flex;align-items:center;gap:8px;min-height:38px;padding:8px 12px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--accent) 6%,#fff)}
    .uw-task-completed-day-head strong{font-size:12px}
    .uw-task-completed-day-list{display:block}
    .uw-task-completed-day-list>.uw-item:last-child{border-bottom:0}
  `;
  document.head.appendChild(style);
}

async function readTasks() {
  const stored = await onekanStateStore.read();
  return Array.isArray(stored?.tasks) ? stored.tasks : [];
}

function completedSortTime(task) {
  if (task?.completedAt) {
    const value = new Date(task.completedAt).getTime();
    if (Number.isFinite(value)) return value;
  }
  if (task?.date) {
    const value = new Date(`${task.date}T12:00:00`).getTime();
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function completedGroupKey(task) {
  return localDateKey(task?.completedAt) || task?.date || "";
}

async function decorateCompletedTasks() {
  if (decorating) return;
  const root = $("#tasksPageList");
  const doneActive = $("#taskPageTabs [data-task-tab=\"done\"].active");
  if (!root || !doneActive) return;

  const sourceList = $(":scope > .uw-list.uw-task-main-list", root);
  if (!sourceList) return;
  const rows = $$(".uw-item[data-uw-kind=\"task\"][data-id]", sourceList);
  if (!rows.length) return;

  const token = ++requestToken;
  let tasks;
  try {
    tasks = await readTasks();
  } catch (error) {
    console.error("완료 할일 날짜 영역화 실패", error);
    return;
  }
  if (token !== requestToken || !$("#taskPageTabs [data-task-tab=\"done\"].active")) return;

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const sortedRows = rows
    .map((node) => ({ node, task: byId.get(node.dataset.id) }))
    .sort((a, b) => completedSortTime(b.task) - completedSortTime(a.task) || String(a.task?.title || "").localeCompare(String(b.task?.title || ""), "ko"));

  const groups = new Map();
  for (const entry of sortedRows) {
    const key = completedGroupKey(entry.task);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry.node);
  }

  decorating = true;
  try {
    const wrapper = document.createElement("div");
    wrapper.className = "uw-task-completed-groups";
    for (const [key, nodes] of groups) {
      const section = document.createElement("section");
      section.className = "uw-task-completed-day";
      const head = document.createElement("div");
      head.className = "uw-task-completed-day-head";
      const title = document.createElement("strong");
      title.textContent = dateHeading(key);
      head.appendChild(title);
      const list = document.createElement("div");
      list.className = "uw-list uw-task-main-list uw-task-completed-day-list";
      for (const node of nodes) list.appendChild(node);
      section.append(head, list);
      wrapper.appendChild(section);
    }
    root.replaceChildren(wrapper);
  } finally {
    decorating = false;
  }
}

function scheduleDecorate(delay = 25) {
  clearTimeout(timer);
  timer = setTimeout(() => decorateCompletedTasks(), delay);
}

function init() {
  installStyle();
  const tasksRoot = $("#tasksPageList");
  const tabsRoot = $("#taskPageTabs");
  if (tasksRoot) new MutationObserver(() => { if (!decorating) scheduleDecorate(); }).observe(tasksRoot, { childList: true, subtree: false });
  if (tabsRoot) new MutationObserver(() => scheduleDecorate()).observe(tabsRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  document.addEventListener("onekan:state-changed", () => scheduleDecorate(80));
  document.addEventListener("click", (event) => {
    if (event.target.closest("#taskPageTabs [data-task-tab=\"done\"]")) scheduleDecorate(80);
  }, true);
  scheduleDecorate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
