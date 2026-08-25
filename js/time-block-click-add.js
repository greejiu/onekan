import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const pad = (n) => String(n).padStart(2, "0");
const DEFAULT_TEMPLATES = [
  { id: "tb-0609", title: "오전일과", startMinute: 360, endMinute: 540 },
  { id: "tb-0911", title: "작업 1", startMinute: 540, endMinute: 660 },
  { id: "tb-1112", title: "", startMinute: 660, endMinute: 720 },
  { id: "tb-1214", title: "", startMinute: 720, endMinute: 840 },
  { id: "tb-1415", title: "", startMinute: 840, endMinute: 900 },
  { id: "tb-1517", title: "", startMinute: 900, endMinute: 1020 },
  { id: "tb-1719", title: "", startMinute: 1020, endMinute: 1140 },
  { id: "tb-1921", title: "", startMinute: 1140, endMinute: 1260 },
  { id: "tb-2122", title: "", startMinute: 1260, endMinute: 1320 },
];

function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayKey(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return localDateKey(date);
}

async function saveTask(title, templateId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;

  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;

  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  if (!Array.isArray(state.timeBlockTemplates) || !state.timeBlockTemplates.length) {
    state.timeBlockTemplates = DEFAULT_TEMPLATES.map((item) => ({ ...item }));
  }

  const task = {
    id: crypto.randomUUID(),
    title,
    done: false,
    date: appDayKey(),
  };
  if (templateId) task.timeBlockTemplateId = templateId;
  state.tasks.push(task);

  const { error: saveError } = await supabase
    .from("onekan_state")
    .upsert({ user_id: session.user.id, data: state }, { onConflict: "user_id" });
  if (saveError) throw saveError;

  $("#reloadCloudBtn")?.click();
  return true;
}

function findZone(templateId) {
  const board = $("#dailyBlockBoard");
  if (!board) return null;
  if (!templateId) return $(".daily-block-row.unassigned [data-block-drop='']", board);
  return $(`[data-block-drop="${CSS.escape(templateId)}"]`, board);
}

function focusExistingEditor(zone) {
  const input = $(".daily-block-click-new-task input, .daily-block-new-task input", zone);
  if (!input) return false;
  input.focus();
  return true;
}

function queueNext(templateId) {
  [180, 480, 900].forEach((delay) => {
    setTimeout(() => {
      const zone = findZone(templateId);
      if (!zone) return;
      if (focusExistingEditor(zone)) return;
      openEditor(zone, templateId);
    }, delay);
  });
}

function openEditor(zone, templateId = "") {
  if (!zone?.isConnected) return;
  if (focusExistingEditor(zone)) return;

  $(".daily-block-empty", zone)?.remove();

  const wrapper = document.createElement("div");
  wrapper.className = "daily-block-new-task daily-block-click-new-task";
  wrapper.innerHTML = '<span class="daily-block-new-dot">＋</span><input class="daily-block-inline-input" placeholder="할일 입력" aria-label="새 할일" />';
  zone.appendChild(wrapper);

  const input = $("input", wrapper);
  input.focus();

  let finished = false;
  const finish = async (continueNext) => {
    if (finished) return;
    const title = input.value.trim();
    if (!title) {
      if (!continueNext) wrapper.remove();
      return;
    }

    finished = true;
    input.disabled = true;
    try {
      await saveTask(title, templateId);
      wrapper.remove();
      if (continueNext) queueNext(templateId);
    } catch (error) {
      console.error("시간블럭 할일 추가 실패", error);
      finished = false;
      input.disabled = false;
      window.alert("할일을 추가하지 못했어요.");
      input.focus();
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finished = true;
      wrapper.remove();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!finished && !wrapper.contains(document.activeElement)) finish(false);
    }, 0);
  }, { once: true });
}

function installClickAdd() {
  if (document.documentElement.dataset.timeBlockClickAddWired === "1") return;
  document.documentElement.dataset.timeBlockClickAddWired = "1";

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest("#dailyBlockBoard .daily-block-row");
    if (!row) return;
    if (target.closest(".daily-block-task,button,input,textarea,select,[contenteditable='true']")) return;

    const zone = $("[data-block-drop]", row);
    if (!zone) return;
    const templateId = zone.dataset.blockDrop || "";
    openEditor(zone, templateId);
  });

  if (!$("#timeBlockClickAddStyles")) {
    const style = document.createElement("style");
    style.id = "timeBlockClickAddStyles";
    style.textContent = `
      #dailyBlockBoard .daily-block-list-cell{cursor:text}
      #dailyBlockBoard .daily-block-time-cell{cursor:text}
      #dailyBlockBoard .daily-block-task{cursor:grab}
      #dailyBlockBoard .daily-block-task.done{cursor:default}
    `;
    document.head.appendChild(style);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installClickAdd, { once: true });
} else {
  installClickAdd();
}
