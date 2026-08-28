import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

if (!window.__onekanHabitStartDateFixInstalled) {
  window.__onekanHabitStartDateFixInstalled = true;

  let habitsById = new Map();
  let refreshTimer = null;
  let renderTimer = null;
  let pendingPeriodEdit = null;
  let pendingPeriodCommit = null;
  let pendingNewHabitPeriod = null;
  let commitRunning = false;
  let cleanupRunning = false;

  const style = document.createElement("style");
  style.dataset.onekanHabitStartDateFix = "3";
  style.textContent = `
    .uw-habit-day-check.habit-range-inactive {
      border-color: var(--line, #ddd) !important;
      background: var(--panel-soft, #f7f6f4) !important;
      color: transparent !important;
      opacity: .42;
      cursor: default !important;
      pointer-events: none !important;
    }
    .uw-habit-outside-range,
    .uw-habit-week-row.habit-range-hidden {
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

  function normalizeCloud(cloud) {
    const state = cloud && typeof cloud === "object" ? cloud : {};
    state.habitTemplates = Array.isArray(state.habitTemplates) ? state.habitTemplates : [];
    state.habitDays = state.habitDays && typeof state.habitDays === "object" ? state.habitDays : {};
    return state;
  }

  function cleanAutomaticFalseRecords(cloud) {
    const state = normalizeCloud(cloud);
    const byId = new Map(state.habitTemplates.map((habit) => [habit.id, habit]));
    let changed = false;

    for (const [date, values] of Object.entries(state.habitDays)) {
      if (!values || typeof values !== "object") continue;
      for (const [habitId, value] of Object.entries(values)) {
        if (value !== false) continue;
        const habit = byId.get(habitId);
        if (!habit || isInsideRange(habit, date)) continue;
        delete values[habitId];
        changed = true;
      }
      if (Object.keys(values).length === 0) {
        delete state.habitDays[date];
        changed = true;
      }
    }
    return changed;
  }

  async function loadCloudState() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;
    const { data, error } = await supabase
      .from("onekan_state")
      .select("data")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) throw error;
    return { user: session.user, cloud: normalizeCloud(data?.data) };
  }

  async function saveCloud(loaded, source = "habit-period-fix") {
    const { error } = await supabase
      .from("onekan_state")
      .upsert({ user_id: loaded.user.id, data: loaded.cloud }, { onConflict: "user_id" });
    if (error) throw error;
    habitsById = new Map(loaded.cloud.habitTemplates.map((habit) => [habit.id, habit]));
    document.dispatchEvent(new CustomEvent("onekan:state-changed", { detail: { source } }));
    $("#reloadCloudBtn")?.click();
    scheduleEnforce(100);
  }

  async function refreshState() {
    if (cleanupRunning) return;
    try {
      const loaded = await loadCloudState();
      if (!loaded) {
        habitsById = new Map();
        return;
      }
      habitsById = new Map(loaded.cloud.habitTemplates.map((habit) => [habit.id, habit]));
      if (cleanAutomaticFalseRecords(loaded.cloud)) {
        cleanupRunning = true;
        await saveCloud(loaded, "habit-range-cleanup");
      }
      scheduleEnforce(0);
    } catch (error) {
      console.error("habit period refresh failed", error);
    } finally {
      cleanupRunning = false;
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

      let hasVisibleOccurrence = false;
      for (const check of $$(".uw-habit-day-check[data-date]", row)) {
        const date = check.dataset.date;
        const active = isInsideRange(habit, date);
        if (active) hasVisibleOccurrence = true;
        check.classList.toggle("habit-range-inactive", !active);
        if (!active) {
          check.disabled = true;
          check.classList.remove("checked");
          check.textContent = "";
          check.removeAttribute("data-uw-habit-check");
          check.setAttribute("aria-label", habit.startDate && date < habit.startDate ? "습관 시작일 이전" : "습관 종료일 이후");
        }
      }
      row.classList.toggle("habit-range-hidden", !hasVisibleOccurrence);
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

  function inlineHabitPeriod(form) {
    const item = form?.closest?.(".uw-item[data-uw-kind='habit'][data-id]");
    if (!item) return null;
    return {
      form,
      habitId: item.dataset.id,
      startDate: $(".uw-habit-start-date", form)?.value || "",
      endDate: $(".uw-habit-end-date", form)?.value || "",
      at: Date.now(),
    };
  }

  function periodChanged(period) {
    if (!period) return false;
    const old = habitsById.get(period.habitId);
    if (!old) return false;
    return period.startDate !== (old.startDate || "") || period.endDate !== (old.endDate || "");
  }

  function markPeriodEdit(input) {
    const period = inlineHabitPeriod(input.closest(".uw-inline-form"));
    if (!period) return;
    pendingPeriodEdit = period;
  }

  function queuePeriodCommit(period) {
    if (!period || !periodChanged(period)) return;
    pendingPeriodCommit = {
      habitId: period.habitId,
      startDate: period.startDate,
      endDate: period.endDate,
      at: Date.now(),
    };
  }

  function resolvePeriodScopeIfNeeded() {
    const dialog = $("#uwHabitScopeDialog");
    if (!dialog?.open || !pendingPeriodEdit) return;
    if (!pendingPeriodEdit.form?.isConnected || Date.now() - pendingPeriodEdit.at > 30000) return;

    const message = $("#uwHabitScopeMessage", dialog);
    if (message) message.textContent = "습관 시작일·종료일은 전체 습관에 적용돼요.";

    const allButton = dialog.querySelector('[data-uw-habit-scope="all"]');
    if (allButton) requestAnimationFrame(() => allButton.click());
  }

  async function persistPendingPeriods() {
    if (commitRunning || (!pendingPeriodCommit && !pendingNewHabitPeriod)) return;
    commitRunning = true;
    const editCommit = pendingPeriodCommit;
    const newCommit = pendingNewHabitPeriod;
    pendingPeriodCommit = null;
    pendingNewHabitPeriod = null;

    try {
      const loaded = await loadCloudState();
      if (!loaded) return;
      let changed = false;

      if (editCommit) {
        const habit = loaded.cloud.habitTemplates.find((item) => item.id === editCommit.habitId);
        if (habit) {
          if (editCommit.startDate) habit.startDate = editCommit.startDate;
          else delete habit.startDate;
          if (editCommit.endDate) habit.endDate = editCommit.endDate;
          else delete habit.endDate;
          if (habit.recurrence && editCommit.startDate) habit.recurrence.anchorDate = editCommit.startDate;
          changed = true;
        }
      }

      if (newCommit) {
        const created = loaded.cloud.habitTemplates
          .filter((habit) => !newCommit.beforeIds.has(habit.id))
          .at(-1);
        if (created) {
          created.startDate = newCommit.startDate;
          if (newCommit.endDate) created.endDate = newCommit.endDate;
          else delete created.endDate;
          if (created.recurrence) created.recurrence.anchorDate = newCommit.startDate;
          changed = true;
        }
      }

      if (cleanAutomaticFalseRecords(loaded.cloud)) changed = true;
      if (!changed) return;
      await saveCloud(loaded);
    } catch (error) {
      console.error("habit period persist failed", error);
    } finally {
      commitRunning = false;
      pendingPeriodEdit = null;
    }
  }

  document.addEventListener("input", (event) => {
    if (event.target.matches?.(".uw-habit-start-date,.uw-habit-end-date")) markPeriodEdit(event.target);
  }, true);

  document.addEventListener("change", (event) => {
    if (event.target.matches?.(".uw-habit-start-date,.uw-habit-end-date")) markPeriodEdit(event.target);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.closest?.(".uw-inline-form")) {
      pendingPeriodEdit = null;
      pendingPeriodCommit = null;
    }
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form?.matches?.(".uw-inline-form")) {
      const period = inlineHabitPeriod(form);
      if (periodChanged(period)) {
        pendingPeriodEdit = period;
        queuePeriodCommit(period);
      }
      return;
    }

    if (form?.id === "habitPageForm") {
      const startDate = $("#habitPageStartDate")?.value || "";
      if (!startDate) return;
      pendingNewHabitPeriod = {
        startDate,
        endDate: $("#habitPageEndDate")?.value || "",
        beforeIds: new Set(habitsById.keys()),
        at: Date.now(),
      };
    }
  }, true);

  document.addEventListener("onekan:state-changed", (event) => {
    if (event.detail?.source !== "habit-range-cleanup" && event.detail?.source !== "habit-period-fix") {
      scheduleRefresh(100);
    }
    if ((pendingPeriodCommit || pendingNewHabitPeriod) && event.detail?.source !== "habit-period-fix") {
      setTimeout(persistPendingPeriods, 140);
    }
  });
  supabase.auth.onAuthStateChange(() => scheduleRefresh(120));

  const observer = new MutationObserver(() => {
    resolvePeriodScopeIfNeeded();
    if (pendingPeriodEdit && !pendingPeriodEdit.form?.isConnected && Date.now() - pendingPeriodEdit.at < 30000) {
      queuePeriodCommit(pendingPeriodEdit);
      if (pendingPeriodCommit) setTimeout(persistPendingPeriods, 120);
    }
    scheduleEnforce();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });

  scheduleRefresh(0);
}
