import { supabase } from "./supabase.js";

const $ = (selector, root = document) => root.querySelector(selector);
const pad = (n) => String(n).padStart(2, "0");

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function appDayKey(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return localDateKey(date);
}

function minuteText(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultTimes() {
  const end = new Date();
  end.setSeconds(0, 0);
  end.setMinutes(Math.ceil(end.getMinutes() / 5) * 5);
  const start = new Date(end.getTime() - 30 * 60 * 1000);
  return { start: minuteText(start), end: minuteText(end) };
}

async function addSession({ title, date, startTime, endTime }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("로그인이 필요합니다.");

  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error("시간을 확인해 주세요.");
  if (end <= start) throw new Error("종료 시간은 시작 시간보다 뒤여야 해요.");

  const { data, error } = await supabase
    .from("onekan_state")
    .select("data")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;

  const state = data?.data && typeof data.data === "object" ? data.data : {};
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  state.sessions.push({
    id: crypto.randomUUID(),
    taskId: null,
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    durationMs: end.getTime() - start.getTime(),
    manual: true,
  });

  const { error: saveError } = await supabase
    .from("onekan_state")
    .upsert({ user_id: session.user.id, data: state }, { onConflict: "user_id" });
  if (saveError) throw saveError;

  $("#reloadCloudBtn")?.click();
}

function ensureDialog() {
  if ($("#manualTimeEntryDialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "manualTimeEntryDialog";
  dialog.className = "app-dialog";
  dialog.innerHTML = `
    <form method="dialog" id="manualTimeEntryForm">
      <h3>시간 기록 추가</h3>
      <div class="field"><label>기록명</label><input id="manualTimeTitle" placeholder="무엇을 했나요?" required /></div>
      <div class="field"><label>날짜</label><input id="manualTimeDate" type="date" required /></div>
      <div class="field"><label>시작</label><input id="manualTimeStart" type="time" required /></div>
      <div class="field"><label>종료</label><input id="manualTimeEnd" type="time" required /></div>
      <div class="dialog-actions"><button class="soft-btn" id="manualTimeCancel" type="button">취소</button><button class="primary-btn" type="submit">기록 추가</button></div>
    </form>`;
  document.body.appendChild(dialog);

  $("#manualTimeCancel", dialog).addEventListener("click", () => dialog.close());
  $("#manualTimeEntryForm", dialog).addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("#manualTimeTitle", dialog).value.trim();
    const date = $("#manualTimeDate", dialog).value;
    const startTime = $("#manualTimeStart", dialog).value;
    const endTime = $("#manualTimeEnd", dialog).value;
    if (!title || !date || !startTime || !endTime) return;

    const submit = dialog.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await addSession({ title, date, startTime, endTime });
      dialog.close();
    } catch (error) {
      console.error(error);
      window.alert(error?.message || "기록을 추가하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      submit.disabled = false;
    }
  });
}

function openDialog(source = "today") {
  ensureDialog();
  const dialog = $("#manualTimeEntryDialog");
  const times = defaultTimes();
  $("#manualTimeTitle", dialog).value = "";
  $("#manualTimeDate", dialog).value = source === "today" ? appDayKey() : localDateKey();
  $("#manualTimeStart", dialog).value = times.start;
  $("#manualTimeEnd", dialog).value = times.end;
  dialog.showModal();
  setTimeout(() => $("#manualTimeTitle", dialog)?.focus(), 0);
}

function injectButtons() {
  const todayBody = $("#todaySessions");
  const allBody = $("#allSessions");
  const todayHeader = todayBody?.closest(".card")?.querySelector(".card-header");
  const allHeader = allBody?.closest(".card")?.querySelector(".card-header");

  if (todayHeader && !$("#addTodayTimeRecordBtn")) {
    const button = document.createElement("button");
    button.id = "addTodayTimeRecordBtn";
    button.className = "ghost-btn";
    button.type = "button";
    button.textContent = "+ 기록 추가";
    button.addEventListener("click", () => openDialog("today"));
    todayHeader.appendChild(button);
  }

  if (allHeader && !$("#addPastTimeRecordBtn")) {
    const existingMeta = allHeader.querySelector(".card-meta");
    const actions = document.createElement("div");
    actions.className = "header-inline";
    if (existingMeta) actions.appendChild(existingMeta);
    const button = document.createElement("button");
    button.id = "addPastTimeRecordBtn";
    button.className = "ghost-btn";
    button.type = "button";
    button.textContent = "+ 기록 추가";
    button.addEventListener("click", () => openDialog("past"));
    actions.appendChild(button);
    allHeader.appendChild(actions);
  }
}

function init() {
  ensureDialog();
  injectButtons();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
