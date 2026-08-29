import { supabase } from "./supabase.js";
import { confirmAction, showToast } from "./ui-feedback.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const pad = (value) => String(value).padStart(2, "0");
const SYSTEM_SECTION_ID = "management-section-repeat";
const SYSTEM_GROUP_ID = `management-flat-${SYSTEM_SECTION_ID}`;

let state = null;
let user = null;
let renderTimer = null;
let rendering = false;
let createBasis = sessionStorage.getItem("onekan-repeat-create-basis") === "completion" ? "completion" : "schedule";
let editingCompletionId = null;

function dateKey(date = new Date()) {
  const value = new Date(date);
  value.setHours(value.getHours() - 3);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function compactDate(value) {
  const date = parseDate(value);
  if (!date) return "";
  const today = new Date();
  return `${date.getFullYear() === today.getFullYear() ? "" : `${date.getFullYear()}.`}${date.getMonth() + 1}.${date.getDate()}`;
}

function normalizeState(raw) {
  const next = raw && typeof raw === "object" ? raw : {};
  next.habitTemplates = Array.isArray(next.habitTemplates) ? next.habitTemplates : [];
  next.habitDays = next.habitDays && typeof next.habitDays === "object" ? next.habitDays : {};
  next.eventGroups = Array.isArray(next.eventGroups) ? next.eventGroups : [];
  next.managementSections = Array.isArray(next.managementSections) ? next.managementSections : [];
  next.managementGroups = Array.isArray(next.managementGroups) ? next.managementGroups : [];
  next.managementItems = Array.isArray(next.managementItems) ? next.managementItems : [];
  next.managementHistory = Array.isArray(next.managementHistory) ? next.managementHistory : [];
  next.ui = next.ui && typeof next.ui === "object" ? next.ui : {};
  next.ui.timelineColors = next.ui.timelineColors && typeof next.ui.timelineColors === "object" ? next.ui.timelineColors : {};
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
  if (!state || !user) return false;
  mutator(state);
  const { error } = await supabase.from("onekan_state").upsert({ user_id: user.id, data: state }, { onConflict: "user_id" });
  if (error) throw error;
  document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source: "repeat-hub" } }));
  scheduleRender(50, false);
  return true;
}

function ensureStyle() {
  if ($('link[data-onekan-repeat-hub-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/repeat-hub.css?v=2";
  link.dataset.onekanRepeatHubStyle = "1";
  document.head.appendChild(link);
}

function ensureRepeatPage() {
  const main = $("main.main");
  if (!main) return null;
  let page = $("#page-repeat");
  if (!page) {
    page = document.createElement("section");
    page.className = "page repeat-page";
    page.id = "page-repeat";
    const habits = $("#page-habits");
    if (habits) main.insertBefore(page, habits);
    else main.appendChild(page);
  }
  if (page.dataset.repeatUnifiedReady !== "1") {
    page.dataset.repeatUnifiedReady = "1";
    page.innerHTML = `
      <div class="page-head repeat-page-head">
        <div><h1 class="page-title">반복</h1><div class="page-sub">정해진 일정대로 하거나, 마지막 완료일을 기준으로 다음 일을 잡아요.</div></div>
      </div>
      <section class="repeat-create-card">
        <div class="repeat-create-head">
          <strong>새 반복</strong>
          <div class="repeat-basis-seg" aria-label="반복 기준">
            <button data-repeat-create-basis="schedule" type="button">정해진 일정대로</button>
            <button data-repeat-create-basis="completion" type="button">완료한 날부터</button>
          </div>
        </div>
        <div id="repeatScheduleFormHost" class="repeat-form-host"></div>
        <div id="repeatCompletionFormHost" class="repeat-form-host" hidden>
          <form id="repeatCompletionForm" class="repeat-completion-form" autocomplete="off">
            <input id="repeatCompletionTitle" type="text" maxlength="100" placeholder="새 반복" aria-label="반복 이름" required>
            <label class="repeat-compact-field"><span>영역</span><select id="repeatCompletionGroup" aria-label="반복 영역"></select></label>
            <label class="repeat-compact-field"><span>첫 예정</span><input id="repeatCompletionDate" type="date" required></label>
            <div class="repeat-after-fields" aria-label="완료 후 반복 간격">
              <span>완료 후</span><input id="repeatCompletionInterval" type="number" min="1" max="999" value="1" inputmode="numeric" aria-label="반복 간격">
              <select id="repeatCompletionUnit" aria-label="반복 단위"><option value="day">일</option><option value="week" selected>주</option><option value="month">개월</option><option value="year">년</option></select>
            </div>
            <div class="repeat-completion-actions">
              <button class="soft-btn danger-text" id="repeatCompletionDelete" type="button" hidden>삭제</button>
              <button class="soft-btn" id="repeatCompletionCancel" type="button" hidden>취소</button>
              <button class="primary-btn" id="repeatCompletionSubmit" type="submit">추가</button>
            </div>
          </form>
          <small class="repeat-form-help">완료 체크한 실제 날짜에서 간격을 다시 계산해요. 하위 할일도 붙일 수 있어요.</small>
        </div>
      </section>
      <div class="repeat-overview" id="repeatOverview"></div>`;
  }
  return page;
}

function adoptHabitForm() {
  const host = $("#repeatScheduleFormHost");
  const form = $("#habitPageForm");
  if (!host || !form) return;
  if (form.parentElement !== host) host.appendChild(form);
  form.classList.add("repeat-schedule-form");
  const title = $("#habitPageTitle", form);
  if (title) {
    title.placeholder = "새 반복";
    title.setAttribute("aria-label", "새 반복");
  }
  const periodButton = $("#habitPagePeriodButton", form);
  if (periodButton) {
    periodButton.title = "반복 기간 설정";
    periodButton.setAttribute("aria-label", "반복 기간 설정");
  }
}

function hideLegacyPages() {
  const habits = $("#page-habits");
  const management = $("#page-management");
  if (habits) habits.hidden = true;
  if (management) management.hidden = true;
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

function applyUnifiedColor() {
  const color = state?.ui?.timelineColors?.habit;
  if (/^#[0-9a-f]{6}$/i.test(color || "")) document.documentElement.style.setProperty("--timeline-management-color", color);
  $$(".timeline-color-settings [data-management-color-setting]").forEach((node) => node.remove());
}

function recurringOnDate(item, targetKey) {
  if (!item?.date) return false;
  const recurrence = item.recurrence;
  if (!recurrence?.frequency) return item.date === targetKey;
  if (targetKey < item.date || (recurrence.until && targetKey > recurrence.until)) return false;
  const first = new Date(`${item.date}T12:00:00`);
  const target = new Date(`${targetKey}T12:00:00`);
  const diff = Math.round((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / 86400000);
  const interval = Math.max(1, Number(recurrence.interval || 1));
  if (recurrence.frequency === "daily") return diff % interval === 0;
  if (recurrence.frequency === "weekly") {
    const weekdays = Array.isArray(recurrence.weekdays) && recurrence.weekdays.length ? recurrence.weekdays : [first.getDay()];
    return Math.floor(diff / 7) % interval === 0 && weekdays.includes(target.getDay());
  }
  if (recurrence.frequency === "monthly") {
    const months = (target.getFullYear() - first.getFullYear()) * 12 + target.getMonth() - first.getMonth();
    const wanted = Math.min(Number(recurrence.dayOfMonth || first.getDate()), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
    return months >= 0 && months % interval === 0 && target.getDate() === wanted;
  }
  return item.date === targetKey;
}

function habitOccurs(habit, targetKey) {
  if (habit.startDate && targetKey < habit.startDate) return false;
  if (habit.endDate && targetKey > habit.endDate) return false;
  if (!habit.recurrence?.frequency) return true;
  const baseDate = habit.startDate || habit.recurrence.anchorDate;
  if (!baseDate) return true;
  return recurringOnDate({ ...habit, date: baseDate }, targetKey);
}

function recurrenceLabel(recurrence) {
  const value = recurrence && typeof recurrence === "object" ? recurrence : null;
  if (!value?.frequency) return "매일";
  const interval = Math.max(1, Number(value.interval || 1));
  if (value.frequency === "daily") return interval === 1 ? "매일" : `${interval}일마다`;
  if (value.frequency === "weekly") {
    const names = ["일", "월", "화", "수", "목", "금", "토"];
    const picked = Array.isArray(value.weekdays) ? value.weekdays.map((day) => names[day]).filter(Boolean).join("·") : "";
    if (picked) return `${picked}요일`;
    return interval === 1 ? "매주" : `${interval}주마다`;
  }
  if (value.frequency === "monthly") return interval === 1 ? "매월" : `${interval}개월마다`;
  return "정해진 일정";
}

function completionRepeatLabel(repeat) {
  if (!repeat?.unit) return "완료 기준";
  const interval = Math.max(1, Number(repeat.interval || 1));
  const unit = ({ day: "일", week: "주", month: "개월", year: "년" })[repeat.unit] || "일";
  return `완료 후 ${interval}${unit}`;
}

function lastHabitCompletion(habitId) {
  const keys = Object.keys(state?.habitDays || {}).filter((key) => Boolean(state.habitDays[key]?.[habitId])).sort();
  return keys.at(-1) || "";
}

function nextHabitDate(habit) {
  const todayKey = dateKey();
  const doneToday = Boolean(state?.habitDays?.[todayKey]?.[habit.id]);
  const start = parseDate(todayKey) || new Date();
  for (let offset = doneToday ? 1 : 0; offset <= 3660; offset += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    if (habitOccurs(habit, key)) return key;
    if (habit.endDate && key > habit.endDate) break;
  }
  return "";
}

function latestManagementCompletion(itemId) {
  return (state?.managementHistory || [])
    .filter((entry) => entry?.itemId === itemId && entry?.completedDate)
    .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")))
    .at(-1)?.completedDate || "";
}

function checklistProgress(item) {
  const steps = Array.isArray(item?.checklist) ? item.checklist.filter((step) => step?.title) : [];
  const progress = item?.checklistProgress && typeof item.checklistProgress === "object" ? item.checklistProgress : {};
  const done = steps.filter((step) => Boolean(progress[step.id])).length;
  return { done, total: steps.length };
}

function areaNameForCompletion(item) {
  const group = state?.eventGroups?.find((entry) => entry.id === item.repeatGroupId);
  if (group) return group.name;
  return state?.managementSections?.find((entry) => entry.id === item.sectionId)?.name || "";
}

function rows() {
  const groups = new Map((state?.eventGroups || []).map((group) => [group.id, group]));
  const habits = (state?.habitTemplates || []).map((habit) => {
    const last = lastHabitCompletion(habit.id);
    const next = nextHabitDate(habit);
    return {
      id: habit.id,
      kind: "schedule",
      title: habit.title || "이름 없는 반복",
      area: groups.get(habit.groupId)?.name || "",
      rule: recurrenceLabel(habit.recurrence),
      last,
      next,
      progress: { done: 0, total: 0 },
    };
  });
  const completion = (state?.managementItems || [])
    .filter((item) => !item.hiddenFromRepeat)
    .map((item) => ({
      id: item.id,
      kind: "completion",
      title: item.title || "이름 없는 반복",
      area: areaNameForCompletion(item),
      rule: completionRepeatLabel(item.repeat),
      last: latestManagementCompletion(item.id) || String(item.lastCompletedAt || "").slice(0, 10),
      next: item.nextDate || "",
      progress: checklistProgress(item),
    }));
  return [...habits, ...completion].sort((a, b) => a.title.localeCompare(b.title, "ko"));
}

function rowMarkup(row) {
  const area = row.area ? `<span class="repeat-row-area">${esc(row.area)}</span>` : "";
  const last = row.last ? `<span>마지막 완료 ${esc(compactDate(row.last))}</span>` : '<span>아직 완료 기록 없음</span>';
  const next = row.next ? `<span>다음 ${esc(compactDate(row.next))}</span>` : "";
  const progress = row.progress.total ? `<span class="repeat-row-progress">${row.progress.done}/${row.progress.total}</span>` : "";
  const context = row.kind === "schedule" ? ` data-context-kind="habit" data-context-id="${esc(row.id)}"` : "";
  const checklist = row.kind === "completion" ? `<button class="repeat-row-tool" data-management-checklist-edit="${esc(row.id)}" type="button">${row.progress.total ? `하위 할일 ${row.progress.total}` : "하위 할일 +"}</button>` : "";
  return `<article class="repeat-row" data-repeat-kind="${row.kind}" data-repeat-id="${esc(row.id)}"${context}>
    <button class="repeat-row-main" data-repeat-edit="${row.kind}" data-repeat-edit-id="${esc(row.id)}" type="button">
      <strong>${esc(row.title)}</strong>
      <small>${area}<span class="repeat-row-rule">${esc(row.rule)}</span>${last}${next}${progress}</small>
    </button>
    <div class="repeat-row-actions">${checklist}<button class="repeat-row-more" data-repeat-edit="${row.kind}" data-repeat-edit-id="${esc(row.id)}" type="button" aria-label="${esc(row.title)} 수정">⋯</button></div>
  </article>`;
}

function renderOverview() {
  const root = $("#repeatOverview");
  if (!root || !state) return;
  const list = rows();
  root.innerHTML = `
    <div class="repeat-overview-head"><div><strong>반복하는 것들</strong><small>습관·관리 구분 없이 반복 방식만 달라요.</small></div><span>${list.length}개</span></div>
    ${list.length ? `<div class="repeat-row-list">${list.map(rowMarkup).join("")}</div>` : '<div class="repeat-empty"><strong>아직 반복 항목이 없어요.</strong><span>위에서 첫 반복을 만들어보세요.</span></div>'}`;
}

function renderBasis() {
  $$('[data-repeat-create-basis]').forEach((button) => button.classList.toggle("active", button.dataset.repeatCreateBasis === createBasis));
  const scheduleHost = $("#repeatScheduleFormHost");
  const completionHost = $("#repeatCompletionFormHost");
  if (scheduleHost) scheduleHost.hidden = createBasis !== "schedule";
  if (completionHost) completionHost.hidden = createBasis !== "completion";
}

function groupOptions(selected = "") {
  const groups = state?.eventGroups || [];
  return groups.map((group) => `<option value="${esc(group.id)}"${group.id === selected ? " selected" : ""}>${esc(group.name)}</option>`).join("");
}

function renderCompletionForm() {
  const group = $("#repeatCompletionGroup");
  if (!group || !state) return;
  const item = editingCompletionId ? state.managementItems.find((entry) => entry.id === editingCompletionId) : null;
  const selected = item?.repeatGroupId || state.eventGroups?.[0]?.id || "";
  group.innerHTML = groupOptions(selected);
  if (selected) group.value = selected;
  if (!item && !$("#repeatCompletionDate")?.value) $("#repeatCompletionDate").value = dateKey();
}

function resetCompletionForm() {
  editingCompletionId = null;
  const form = $("#repeatCompletionForm");
  form?.reset();
  const date = $("#repeatCompletionDate");
  const interval = $("#repeatCompletionInterval");
  const unit = $("#repeatCompletionUnit");
  if (date) date.value = dateKey();
  if (interval) interval.value = "1";
  if (unit) unit.value = "week";
  $("#repeatCompletionSubmit") && ($("#repeatCompletionSubmit").textContent = "추가");
  $("#repeatCompletionCancel") && ($("#repeatCompletionCancel").hidden = true);
  $("#repeatCompletionDelete") && ($("#repeatCompletionDelete").hidden = true);
  renderCompletionForm();
}

function beginCompletionEdit(itemId) {
  const item = state?.managementItems.find((entry) => entry.id === itemId);
  if (!item) return;
  editingCompletionId = itemId;
  createBasis = "completion";
  sessionStorage.setItem("onekan-repeat-create-basis", createBasis);
  renderBasis();
  const title = $("#repeatCompletionTitle");
  const group = $("#repeatCompletionGroup");
  const date = $("#repeatCompletionDate");
  const interval = $("#repeatCompletionInterval");
  const unit = $("#repeatCompletionUnit");
  if (title) title.value = item.title || "";
  if (group) {
    group.innerHTML = groupOptions(item.repeatGroupId || state.eventGroups?.[0]?.id || "");
    group.value = item.repeatGroupId || state.eventGroups?.[0]?.id || "";
  }
  if (date) date.value = item.nextDate || dateKey();
  if (interval) interval.value = String(Math.max(1, Number(item.repeat?.interval || 1)));
  if (unit) unit.value = item.repeat?.unit || "week";
  $("#repeatCompletionSubmit") && ($("#repeatCompletionSubmit").textContent = "저장");
  $("#repeatCompletionCancel") && ($("#repeatCompletionCancel").hidden = false);
  $("#repeatCompletionDelete") && ($("#repeatCompletionDelete").hidden = false);
  title?.focus();
  title?.select();
}

function ensureCompletionInfrastructure(current) {
  let section = current.managementSections.find((entry) => entry.id === SYSTEM_SECTION_ID);
  if (!section) {
    section = { id: SYSTEM_SECTION_ID, name: "반복", system: true, hidden: true, createdAt: new Date().toISOString() };
    current.managementSections.push(section);
  }
  let group = current.managementGroups.find((entry) => entry.id === SYSTEM_GROUP_ID);
  if (!group) {
    group = { id: SYSTEM_GROUP_ID, sectionId: SYSTEM_SECTION_ID, name: "기본", system: true, hidden: true, createdAt: new Date().toISOString() };
    current.managementGroups.push(group);
  }
  return { section, group };
}

async function saveCompletionForm() {
  const title = $("#repeatCompletionTitle")?.value.trim() || "";
  const repeatGroupId = $("#repeatCompletionGroup")?.value || state?.eventGroups?.[0]?.id || "";
  const nextDate = $("#repeatCompletionDate")?.value || dateKey();
  const interval = Math.max(1, Math.min(999, Number.parseInt($("#repeatCompletionInterval")?.value || "1", 10) || 1));
  const unit = $("#repeatCompletionUnit")?.value || "week";
  if (!title) return;
  const editingId = editingCompletionId;
  await writeState((current) => {
    const { section, group } = ensureCompletionInfrastructure(current);
    if (editingId) {
      const item = current.managementItems.find((entry) => entry.id === editingId);
      if (!item) return;
      item.title = title;
      item.repeatGroupId = repeatGroupId;
      item.nextDate = nextDate;
      item.repeat = { interval, unit, basis: "completion" };
      return;
    }
    current.managementItems.push({
      id: `management-item-${crypto.randomUUID()}`,
      title,
      sectionId: section.id,
      groupId: group.id,
      repeatGroupId,
      nextDate,
      nextTime: "",
      repeat: { interval, unit, basis: "completion" },
      checklist: [],
      checklistProgress: {},
      createdAt: new Date().toISOString(),
    });
  });
  showToast(editingId ? "반복 항목을 저장했어요." : "반복 항목을 추가했어요.");
  resetCompletionForm();
}

async function deleteCompletion() {
  const item = state?.managementItems.find((entry) => entry.id === editingCompletionId);
  if (!item) return;
  const confirmed = await confirmAction({ title: `‘${item.title}’ 반복을 삭제할까요?`, message: "이 반복의 완료 기록도 함께 삭제돼요.", confirmLabel: "삭제" });
  if (!confirmed) return;
  const itemId = item.id;
  await writeState((current) => {
    current.managementItems = current.managementItems.filter((entry) => entry.id !== itemId);
    current.managementHistory = current.managementHistory.filter((entry) => entry.itemId !== itemId);
  });
  resetCompletionForm();
}

function openHabitEdit(button) {
  const row = button.closest('[data-context-kind="habit"]');
  if (!row) return;
  const rect = button.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: Math.max(8, rect.left), clientY: Math.min(innerHeight - 8, rect.bottom + 4) }));
}

function setNavActive() {
  const nav = $(".sidebar .nav");
  if (!nav) return;
  $$(".nav-item", nav).forEach((button) => button.classList.toggle("active", button.dataset.page === "repeat"));
}

function openRepeat() {
  const page = ensureRepeatPage();
  if (!page) return;
  ensureNavigation();
  hideLegacyPages();
  $$("main.main > .page").forEach((entry) => entry.classList.remove("active"));
  page.classList.add("active");
  page.hidden = false;
  setNavActive();
  scheduleRender(0, true);
}

async function renderHub({ refresh = false } = {}) {
  if (rendering) return;
  rendering = true;
  try {
    ensureStyle();
    ensureRepeatPage();
    adoptHabitForm();
    ensureNavigation();
    hideLegacyPages();
    if (refresh || !state) await readState();
    if (!state) return;
    applyUnifiedColor();
    renderBasis();
    renderCompletionForm();
    renderOverview();
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
  document.addEventListener("click", async (event) => {
    const navButton = event.target.closest?.('.sidebar .nav [data-page="repeat"], .sidebar .nav [data-page="habits"], .sidebar .nav [data-page="management"]');
    if (navButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openRepeat();
      return;
    }

    const basis = event.target.closest?.("[data-repeat-create-basis]");
    if (basis) {
      createBasis = basis.dataset.repeatCreateBasis === "completion" ? "completion" : "schedule";
      sessionStorage.setItem("onekan-repeat-create-basis", createBasis);
      if (createBasis !== "completion") resetCompletionForm();
      renderBasis();
      if (createBasis === "schedule") requestAnimationFrame(() => $("#habitPageTitle")?.focus());
      else requestAnimationFrame(() => $("#repeatCompletionTitle")?.focus());
      return;
    }

    const edit = event.target.closest?.("[data-repeat-edit]");
    if (edit) {
      event.preventDefault();
      event.stopPropagation();
      if (edit.dataset.repeatEdit === "completion") beginCompletionEdit(edit.dataset.repeatEditId || "");
      else openHabitEdit(edit);
      return;
    }

    if (event.target.closest?.("#repeatCompletionCancel")) {
      resetCompletionForm();
      return;
    }

    if (event.target.closest?.("#repeatCompletionDelete")) {
      try { await deleteCompletion(); }
      catch (error) { console.error("repeat delete failed", error); showToast("반복 항목 삭제 중 오류가 났어요."); }
      return;
    }
  }, true);

  document.addEventListener("submit", async (event) => {
    if (!event.target.matches?.("#repeatCompletionForm")) return;
    event.preventDefault();
    try { await saveCompletionForm(); }
    catch (error) { console.error("repeat completion save failed", error); showToast("반복 항목 저장 중 오류가 났어요."); }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "timelineHabitColor" && /^#[0-9a-f]{6}$/i.test(event.target.value)) {
      document.documentElement.style.setProperty("--timeline-management-color", event.target.value);
    }
  });
}

ensureStyle();
ensureRepeatPage();
adoptHabitForm();
ensureNavigation();
hideLegacyPages();
wireEvents();

const sidebarNav = $(".sidebar .nav");
if (sidebarNav) {
  const observer = new MutationObserver(() => ensureNavigation());
  observer.observe(sidebarNav, { childList: true, subtree: false });
}

const settingsPage = $("#page-settings");
if (settingsPage) {
  const observer = new MutationObserver(() => applyUnifiedColor());
  observer.observe(settingsPage, { childList: true, subtree: true });
}

document.addEventListener("onekan:state-changed", () => scheduleRender(70, true));
supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null;
  if (user) scheduleRender(100, true);
});

scheduleRender(120, true);
