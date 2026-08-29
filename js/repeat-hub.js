import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

let state = null;
let user = null;
let renderTimer = null;
let rendering = false;

function ensureStyle() {
  if ($('link[data-onekan-repeat-hub-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/repeat-hub.css?v=1";
  link.dataset.onekanRepeatHubStyle = "1";
  document.head.appendChild(link);
}

function normalizeState(raw) {
  const next = raw && typeof raw === "object" ? raw : {};
  next.habitTemplates = Array.isArray(next.habitTemplates) ? next.habitTemplates : [];
  next.habitDays = next.habitDays && typeof next.habitDays === "object" ? next.habitDays : {};
  next.eventGroups = Array.isArray(next.eventGroups) ? next.eventGroups : [];
  next.managementSections = Array.isArray(next.managementSections) ? next.managementSections : [];
  next.managementItems = Array.isArray(next.managementItems) ? next.managementItems : [];
  return next;
}

async function readState() {
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  if (!user) {
    state = null;
    return null;
  }
  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  state = normalizeState(data?.data);
  return state;
}

function ensureRepeatPage() {
  const main = $("main.main");
  if (!main || $("#page-repeat")) return;
  const page = document.createElement("section");
  page.className = "page repeat-page";
  page.id = "page-repeat";
  page.innerHTML = `
    <div class="page-head repeat-page-head"><div><h1 class="page-title">반복</h1></div></div>
    <div class="repeat-subnav" data-repeat-subnav aria-label="반복 보기">
      <button class="active" data-repeat-view="all" type="button">전체</button>
      <button data-repeat-view="habits" type="button">습관</button>
      <button data-repeat-view="management" type="button">관리</button>
    </div>
    <div class="repeat-overview" id="repeatOverview"></div>`;
  const habits = $("#page-habits");
  if (habits) main.insertBefore(page, habits);
  else main.appendChild(page);
}

function tabsMarkup(active) {
  return `<div class="repeat-subnav" data-repeat-subnav aria-label="반복 보기">
    <button${active === "all" ? ' class="active"' : ""} data-repeat-view="all" type="button">전체</button>
    <button${active === "habits" ? ' class="active"' : ""} data-repeat-view="habits" type="button">습관</button>
    <button${active === "management" ? ' class="active"' : ""} data-repeat-view="management" type="button">관리</button>
  </div>`;
}

function ensureSubnav(page, active) {
  if (!page) return;
  const head = $(":scope > .page-head", page);
  if (!head) return;
  const title = $(".page-title", head);
  if (title) title.textContent = "반복";
  let nav = $(":scope > [data-repeat-subnav]", page);
  if (!nav) {
    head.insertAdjacentHTML("afterend", tabsMarkup(active));
    nav = $(":scope > [data-repeat-subnav]", page);
  }
  $$('[data-repeat-view]', nav).forEach((button) => button.classList.toggle("active", button.dataset.repeatView === active));
  page.classList.add("repeat-page");
}

function ensureNavigation() {
  const nav = $(".sidebar .nav");
  if (!nav) return;
  const habitButton = nav.querySelector('[data-page="habits"], [data-page="repeat"]');
  if (habitButton) {
    habitButton.dataset.page = "repeat";
    const label = $(".nav-label", habitButton);
    if (label) label.textContent = "반복";
    const icon = $(".nav-icon", habitButton);
    if (icon) icon.textContent = "↻";
  }
  nav.querySelectorAll('[data-page="management"]').forEach((button) => button.remove());
}

function recurrenceLabel(recurrence) {
  const value = recurrence && typeof recurrence === "object" ? recurrence : null;
  if (!value?.frequency) return "매일";
  const interval = Math.max(1, Number(value.interval || 1));
  if (value.frequency === "daily") return interval === 1 ? "매일" : `${interval}일마다`;
  if (value.frequency === "weekly") {
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    const picked = Array.isArray(value.weekdays) ? value.weekdays.map((day) => days[day]).filter(Boolean).join("·") : "";
    if (picked) return `${picked}요일`;
    return interval === 1 ? "매주" : `${interval}주마다`;
  }
  if (value.frequency === "monthly") return interval === 1 ? "매월" : `${interval}개월마다`;
  return "반복";
}

function managementRepeatLabel(repeat) {
  if (!repeat?.unit) return "반복 없음";
  const interval = Math.max(1, Number(repeat.interval || 1));
  if (repeat.unit === "day") return `${interval}일마다`;
  if (repeat.unit === "week") return `${interval}주마다`;
  if (repeat.unit === "month") return interval === 1 ? "매월" : `${interval}개월마다`;
  if (repeat.unit === "year") return interval === 1 ? "매년" : `${interval}년마다`;
  return "반복";
}

function habitRows() {
  const groups = new Map((state?.eventGroups || []).map((group) => [group.id, group]));
  return (state?.habitTemplates || []).map((habit) => ({
    id: habit.id,
    type: "habit",
    typeLabel: "습관",
    title: habit.title || "이름 없는 습관",
    group: groups.get(habit.groupId)?.name || "",
    meta: recurrenceLabel(habit.recurrence),
    subCount: 0,
  }));
}

function managementRows() {
  const sections = new Map((state?.managementSections || []).map((section) => [section.id, section]));
  return (state?.managementItems || []).map((item) => ({
    id: item.id,
    type: "management",
    typeLabel: "관리",
    title: item.title || "이름 없는 관리 항목",
    group: sections.get(item.sectionId)?.name || "",
    meta: item.nextDate ? `${managementRepeatLabel(item.repeat)} · 다음 ${item.nextDate}` : managementRepeatLabel(item.repeat),
    subCount: Array.isArray(item.checklist) ? item.checklist.length : 0,
  }));
}

function rowMarkup(row) {
  const checklist = row.subCount ? `<span class="repeat-row-checklist">${row.subCount}단계</span>` : "";
  const group = row.group ? `<span class="repeat-row-group">${esc(row.group)}</span>` : "";
  return `<button class="repeat-row" data-repeat-open="${row.type}" type="button">
    <span class="repeat-type repeat-type-${row.type}">${esc(row.typeLabel)}</span>
    <span class="repeat-row-main"><strong>${esc(row.title)}</strong><small>${group}<span>${esc(row.meta)}</span>${checklist}</small></span>
    <span class="repeat-row-arrow" aria-hidden="true">›</span>
  </button>`;
}

function renderOverview() {
  const root = $("#repeatOverview");
  if (!root || !state) return;
  const habits = habitRows();
  const management = managementRows();
  const rows = [...habits, ...management];
  root.innerHTML = `
    <div class="repeat-overview-head">
      <div><strong>반복하는 것들</strong><small>습관과 관리를 같은 규칙으로 보고, 필요한 차이만 유지해요.</small></div>
      <div class="repeat-overview-count"><span>습관 ${habits.length}</span><span>관리 ${management.length}</span></div>
    </div>
    ${rows.length ? `<div class="repeat-row-list">${rows.map(rowMarkup).join("")}</div>` : `
      <div class="repeat-empty"><strong>아직 반복 항목이 없어요.</strong><span>습관이나 관리 항목을 하나 만들어보세요.</span></div>`}
    <div class="repeat-quick-actions">
      <button class="soft-btn" data-repeat-view="habits" type="button">습관 추가</button>
      <button class="soft-btn" data-repeat-view="management" type="button">관리 항목 추가</button>
    </div>`;
}

function setNavActive() {
  const nav = $(".sidebar .nav");
  if (!nav) return;
  $$(".nav-item", nav).forEach((button) => button.classList.toggle("active", button.dataset.page === "repeat"));
}

function openView(view) {
  ensureRepeatPage();
  ensureNavigation();
  const repeatPage = $("#page-repeat");
  const habitsPage = $("#page-habits");
  const managementPage = $("#page-management");
  ensureSubnav(repeatPage, "all");
  ensureSubnav(habitsPage, "habits");
  ensureSubnav(managementPage, "management");

  const target = view === "management" ? managementPage : view === "habits" ? habitsPage : repeatPage;
  if (!target) return;
  $$("main.main > .page").forEach((page) => page.classList.remove("active"));
  target.classList.add("active");
  setNavActive();
  if (view === "all") scheduleRender(0, true);

  if (view === "habits") {
    requestAnimationFrame(() => $("#habitPageTitle")?.focus());
  }
}

async function renderHub({ refresh = false } = {}) {
  if (rendering) return;
  rendering = true;
  try {
    ensureStyle();
    ensureRepeatPage();
    ensureNavigation();
    ensureSubnav($("#page-repeat"), "all");
    ensureSubnav($("#page-habits"), "habits");
    ensureSubnav($("#page-management"), "management");
    if (refresh || !state) await readState();
    if (state) renderOverview();
  } catch (error) {
    console.error("repeat hub render failed", error);
  } finally {
    rendering = false;
  }
}

function scheduleRender(delay = 40, refresh = false) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderHub({ refresh }), delay);
}

function wireEvents() {
  document.addEventListener("click", (event) => {
    const navButton = event.target.closest?.('.sidebar .nav [data-page="repeat"], .sidebar .nav [data-page="habits"]');
    if (navButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openView("all");
      return;
    }

    const tab = event.target.closest?.("[data-repeat-view]");
    if (tab) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openView(tab.dataset.repeatView || "all");
      return;
    }

    const row = event.target.closest?.("[data-repeat-open]");
    if (row) {
      event.preventDefault();
      openView(row.dataset.repeatOpen === "management" ? "management" : "habits");
    }
  }, true);
}

ensureStyle();
ensureRepeatPage();
ensureNavigation();
wireEvents();

const sidebarNav = $(".sidebar .nav");
if (sidebarNav) {
  const observer = new MutationObserver(() => ensureNavigation());
  observer.observe(sidebarNav, { childList: true, subtree: false });
}

document.addEventListener("onekan:state-changed", () => {
  if ($("#page-repeat")?.classList.contains("active")) scheduleRender(70, true);
  else scheduleRender(70, false);
});

supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  if (user) scheduleRender(100, true);
});

scheduleRender(120, true);
