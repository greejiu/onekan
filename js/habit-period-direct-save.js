import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const saveTimers = new Map();

function readInlinePeriod(input) {
  const form = input?.closest?.(".uw-inline-form");
  const item = form?.closest?.(".uw-item[data-uw-kind='habit'][data-id]");
  if (!form || !item) return null;

  const startInput = $(".uw-habit-start-date", form);
  const endInput = $(".uw-habit-end-date", form);
  const startDate = startInput?.value || "";
  const endDate = endInput?.value || "";

  if (endInput) {
    const invalid = Boolean(startDate && endDate && endDate < startDate);
    endInput.setCustomValidity(invalid ? "종료일은 시작일과 같거나 이후여야 해요." : "");
    if (invalid) {
      endInput.reportValidity();
      return null;
    }
  }

  return { habitId: item.dataset.id, startDate, endDate };
}

async function persistPeriod(period) {
  if (!period?.habitId) return;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;

  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;

  const cloud = data?.data && typeof data.data === "object" ? data.data : {};
  cloud.habitTemplates = Array.isArray(cloud.habitTemplates) ? cloud.habitTemplates : [];
  const habit = cloud.habitTemplates.find((item) => item.id === period.habitId);
  if (!habit) return;

  const oldStart = habit.startDate || "";
  const oldEnd = habit.endDate || "";
  if (oldStart === period.startDate && oldEnd === period.endDate) return;

  if (period.startDate) habit.startDate = period.startDate;
  else delete habit.startDate;

  if (period.endDate) habit.endDate = period.endDate;
  else delete habit.endDate;

  if (habit.recurrence && period.startDate) {
    habit.recurrence.anchorDate = period.startDate;
  }

  const { error: saveError } = await supabase
    .from("onekan_state")
    .upsert({ user_id: session.user.id, data: cloud }, { onConflict: "user_id" });
  if (saveError) throw saveError;

  document.dispatchEvent(new CustomEvent("onekan:state-changed", {
    detail: { source: "habit-period-direct-save" },
  }));
  $("#reloadCloudBtn")?.click();
}

function queueSave(input) {
  const period = readInlinePeriod(input);
  if (!period) return;

  clearTimeout(saveTimers.get(period.habitId));
  const timer = setTimeout(() => {
    saveTimers.delete(period.habitId);
    persistPeriod(period).catch((error) => {
      console.error("habit period direct save failed", error);
    });
  }, 120);
  saveTimers.set(period.habitId, timer);
}

document.addEventListener("change", (event) => {
  if (event.target.matches?.(".uw-habit-start-date,.uw-habit-end-date")) {
    queueSave(event.target);
  }
}, true);
