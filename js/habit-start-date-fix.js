import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

if (!window.__onekanHabitStartDateFixInstalled) {
  window.__onekanHabitStartDateFixInstalled = true;

  let habitsById = new Map();
  let refreshTimer = null;
  let renderTimer = null;
  let pendingPeriodEdit = null;

  const style = document.createElement("style");
  style.dataset.onekanHabitStartDateFix = "1";
  style.textContent = `
    .uw-habit-day-check.habit-range-inactive {
      border-color: var(--line, #ddd) !important;
      background: var(--panel-soft, #f7f6f4) !important;
      color: transparent !important;
      opacity: .42;
      cursor: default !important;
      pointer-events: none !important;
    }
    .uw-habit-outside-range {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  function isInsideRange(habit, date) {
    if (!habit || !date) return false;
    if (habit.startDate && date < habit.startDate) return false;
    if (habit.endDate && date > habit.endDate) return false;
    return true;
  }

  async function refreshState() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        habitsById = new Map();
        return;
      }
      const { data, error } = await supabase
        .from("onekan_state")
        .select("data")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) throw error;
      const habits = Array.isArray(data?.data?.habitTemplates) ? data.data.habitTemplates : [];
      habitsById = new Map(habits.map((habit) => [habit.id, habit]));
      scheduleEnforce(0);
    } catch (error) {
      console.error("habit period refresh failed", error);
    }
  }

  function scheduleRefresh(delay = 80) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshState, delay);
  }

  function enforceHabitRanges() {
    for (const row of $$(".uw-habit-week-row")) {
      const habitId = $(".uw-habit-name[data-id]", row)?.dataset.id;
      const habit = habitsById.get(habitId);
      if (!habit) continue;

      for (const check of $$(".uw-habit-day-check[data-date]", row)) {
        const date = check.dataset.date;
        const active = isInsideRange(habit, date);
        check.classList.toggle("habit-range-inactive", !active);
        if (!active) {
          check.disabled = true;
          check.classList.remove("checked");
          check.textContent = "";
          check.removeAttribute("data-uw-habit-check");
          check.setAttribute("aria-label", habit.startDate && date < habit.startDate ? "습관 시작일 이전" : "습관 종료일 이후");
        }
      }
    }

    for (const item of $$(".uw-item[data-uw-kind='habit'][data-id][data-date]")) {
      if (item.closest(".uw-habit-week-row")) continue;
      const habit = habitsById.get(item.dataset.id);
      if (!habit) continue;
      item.classList.toggle("uw-habit-outside-range", !isInsideRange(habit, item.dataset.date));
    }
  }

  function scheduleEnforce(delay = 25) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(enforceHabitRanges, delay);
  }

  function markPeriodEdit(input) {
    const form = input.closest(".uw-inline-form");
    if (!form) return;
    pendingPeriodEdit = { form, at: Date.now() };
  }

  function resolvePeriodScopeIfNeeded() {
    const dialog = $("#uwHabitScopeDialog");
    if (!dialog?.open || !pendingPeriodEdit) return;
    if (!pendingPeriodEdit.form?.isConnected || Date.now() - pendingPeriodEdit.at > 30000) {
      pendingPeriodEdit = null;
      return;
    }

    const message = $("#uwHabitScopeMessage", dialog);
    if (message && !message.dataset.periodNotice) {
      message.dataset.periodNotice = "1";
      message.textContent = "습관 시작일·종료일은 전체 습관에 적용돼요.";
    }

    const allButton = dialog.querySelector('[data-uw-habit-scope="all"]');
    if (!allButton) return;
    pendingPeriodEdit = null;
    requestAnimationFrame(() => allButton.click());
  }

  document.addEventListener("input", (event) => {
    if (event.target.matches?.(".uw-habit-start-date,.uw-habit-end-date")) markPeriodEdit(event.target);
  }, true);

  document.addEventListener("change", (event) => {
    if (event.target.matches?.(".uw-habit-start-date,.uw-habit-end-date")) markPeriodEdit(event.target);
  }, true);

  document.addEventListener("onekan:state-changed", () => scheduleRefresh(100));
  supabase.auth.onAuthStateChange(() => scheduleRefresh(120));

  const observer = new MutationObserver(() => {
    resolvePeriodScopeIfNeeded();
    scheduleEnforce();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });

  scheduleRefresh(0);
}
