import { supabase } from "./supabase.js";

const $ = (selector) => document.querySelector(selector);

async function writeCloudState(mutator) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  const { data, error } = await supabase.from("onekan_state").select("data").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  mutator(state);
  const { error: saveError } = await supabase.from("onekan_state").upsert({ user_id: session.user.id, data: state }, { onConflict: "user_id" });
  if (saveError) throw saveError;
  $("#reloadCloudBtn")?.click();
  return true;
}

function wireTimelineEventDialog() {
  const dialog = $("#timelineEventDialog");
  const form = $("#timelineEventForm");
  if (!dialog || !form || form.dataset.timelineEventWired === "1") return;
  form.dataset.timelineEventWired = "1";

  $("#cancelTimelineEventBtn")?.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#timelineEventTitle").value.trim();
    const date = $("#timelineEventDate").value;
    const startText = $("#timelineEventStart").value;
    const endText = $("#timelineEventEnd").value;
    if (!title || !date || !startText || !endText) return;

    const start = new Date(`${date}T${startText}:00`);
    const end = new Date(`${date}T${endText}:00`);
    if (!(end > start)) {
      window.alert("종료 시간은 시작 시간보다 뒤여야 해요.");
      return;
    }

    try {
      await writeCloudState((state) => state.events.push({
        id: crypto.randomUUID(),
        title,
        type: "schedule",
        groupId: $("#timelineEventGroup")?.value || state.eventGroups?.[0]?.id || "default",
        start: start.toISOString(),
        end: end.toISOString(),
      }));
      dialog.close();
    } catch (error) {
      console.error("달력 일정 저장 실패", error);
      window.alert("일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  });
}

function init() {
  wireTimelineEventDialog();
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) setTimeout(init, 0);
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) init();
