from pathlib import Path

ROOT = Path('.')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

app_path = ROOT / 'js/app.js'
text = app_path.read_text(encoding='utf-8')

text = replace_once(
    text,
    'timer: { mode: "pomodoro", running: false, paused: false, taskId: null, title: null, startedAt: null, accumulatedMs: 0, durationMs: 25 * 60 * 1000 },',
    'timer: { mode: "pomodoro", running: false, paused: false, taskId: null, habitId: null, title: null, startedAt: null, accumulatedMs: 0, durationMs: 25 * 60 * 1000 },',
    'default timer habit id',
)

marker = '''function taskCompletedOn(task, dateKey) {
  return task.recurrence?.frequency ? Boolean(task.recurrenceDone?.[dateKey]) : Boolean(task.done);
}
'''
addition = marker + '''
function habitOccursOnDate(habit, targetKey) {
  if (!habit || !targetKey) return false;
  if (habit.startDate && targetKey < habit.startDate) return false;
  if (habit.endDate && targetKey > habit.endDate) return false;
  if (!habit.recurrence?.frequency) return true;
  const baseDate = habit.startDate || habit.recurrence.anchorDate;
  if (!baseDate) return true;
  return recurringOnDate({ ...habit, date: baseDate }, targetKey);
}

function trackingSourceFromValue(value) {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 0) {
    const task = state.tasks.find((item) => item.id === value);
    return task ? { kind: "task", item: task } : null;
  }
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === "task") {
    const item = state.tasks.find((task) => task.id === id);
    return item ? { kind, item } : null;
  }
  if (kind === "habit") {
    const item = state.habitTemplates.find((habit) => habit.id === id);
    return item ? { kind, item } : null;
  }
  return null;
}
'''
text = replace_once(text, marker, addition, 'tracking source helpers')

old_finish = '''  const task = state.tasks.find((item) => item.id === timer.taskId);
  if (duration >= 1000) {
    const groupId = task?.groupId || state.eventGroups[0]?.id || "default";
    state.sessions.push({ id: uid(), taskId: timer.taskId || null, groupId, title: task?.title || timer.title || "집중 기록", start: new Date(Date.now() - duration).toISOString(), end: new Date().toISOString(), durationMs: duration, timerMode: mode });
  }
  const durationMs = timerDurationMs();
  state.timer = { mode, running: false, paused: false, taskId: null, title: null, startedAt: null, accumulatedMs: 0, durationMs };'''
new_finish = '''  const task = state.tasks.find((item) => item.id === timer.taskId);
  const habit = state.habitTemplates.find((item) => item.id === timer.habitId);
  const source = task || habit;
  if (duration >= 1000) {
    const groupId = source?.groupId || state.eventGroups[0]?.id || "default";
    state.sessions.push({ id: uid(), taskId: timer.taskId || null, habitId: timer.habitId || null, groupId, title: source?.title || timer.title || "집중 기록", start: new Date(Date.now() - duration).toISOString(), end: new Date().toISOString(), durationMs: duration, timerMode: mode });
  }
  const durationMs = timerDurationMs();
  state.timer = { mode, running: false, paused: false, taskId: null, habitId: null, title: null, startedAt: null, accumulatedMs: 0, durationMs };'''
text = replace_once(text, old_finish, new_finish, 'finish timer habit source')

old_tracking = '''function renderTracking() {
  const select = $("#timerTaskSelect");
  const custom = $("#timerCustomTitle");
  const previous = select.value;
  const previousCustom = custom?.value || "";
  const dayKey = appDayKey();
  const activeTasks = state.tasks.filter((task) => recurringOnDate(task, dayKey) && !taskCompletedOn(task, dayKey));
  select.innerHTML = '<option value="">오늘 할일 선택 (선택 안 해도 됨)</option>' + activeTasks.map((task) => `<option value="${task.id}">${esc(task.title)}</option>`).join("");
  if (activeTasks.some((task) => task.id === previous)) select.value = previous;
  if (state.timer.taskId) select.value = state.timer.taskId;
  if (custom) custom.value = state.timer.running ? (state.timer.taskId ? "" : (state.timer.title || "")) : previousCustom;
  const task = state.tasks.find((item) => item.id === state.timer.taskId);
  const directTitle = custom?.value.trim() || "";
  $("#timerTaskLabel").textContent = task?.title || state.timer.title || directTitle || "할일을 선택하거나 직접 기록 이름을 써도 돼요.";
  updateTimerUI();
  renderSessions();
}'''
new_tracking = '''function renderTracking() {
  const select = $("#timerTaskSelect");
  const custom = $("#timerCustomTitle");
  const previous = select.value;
  const previousCustom = custom?.value || "";
  const dayKey = appDayKey();
  const activeTasks = state.tasks.filter((task) => recurringOnDate(task, dayKey) && !taskCompletedOn(task, dayKey));
  const activeHabits = state.habitTemplates.filter((habit) => habitOccursOnDate(habit, dayKey));
  const taskOptions = activeTasks.map((task) => `<option value="task:${task.id}">${esc(task.title)}</option>`).join("");
  const habitOptions = activeHabits.map((habit) => `<option value="habit:${habit.id}">${esc(habit.title)}</option>`).join("");
  select.innerHTML = '<option value="">할일·습관 선택 (선택 안 해도 됨)</option>' + (taskOptions ? `<optgroup label="할일">${taskOptions}</optgroup>` : "") + (habitOptions ? `<optgroup label="습관">${habitOptions}</optgroup>` : "");
  if (trackingSourceFromValue(previous)) select.value = previous;
  if (state.timer.taskId) select.value = `task:${state.timer.taskId}`;
  else if (state.timer.habitId) select.value = `habit:${state.timer.habitId}`;
  const timerHasSource = Boolean(state.timer.taskId || state.timer.habitId);
  if (custom) custom.value = state.timer.running ? (timerHasSource ? "" : (state.timer.title || "")) : previousCustom;
  const source = state.timer.taskId
    ? state.tasks.find((item) => item.id === state.timer.taskId)
    : state.timer.habitId
      ? state.habitTemplates.find((item) => item.id === state.timer.habitId)
      : null;
  const directTitle = custom?.value.trim() || "";
  $("#timerTaskLabel").textContent = source?.title || state.timer.title || directTitle || "할일·습관을 선택하거나 직접 기록 이름을 써도 돼요.";
  updateTimerUI();
  renderSessions();
}'''
text = replace_once(text, old_tracking, new_tracking, 'render tracking habits')

old_start = '''  $("#timerStart").addEventListener("click", () => {
    const taskId = $("#timerTaskSelect").value || null;
    const task = taskId ? state.tasks.find((item) => item.id === taskId) : null;
    const customTitle = $("#timerCustomTitle")?.value.trim() || "";
    const title = task?.title || customTitle;
    if (!title) return window.alert("할일을 선택하거나 기록 이름을 입력해 주세요.");
    state.timer = { mode: timerMode(), running: true, paused: false, taskId, title, startedAt: Date.now(), accumulatedMs: 0, durationMs: timerDurationMs() };
    save();
    renderTracking();
    startTicker();
  });'''
new_start = '''  $("#timerStart").addEventListener("click", () => {
    const source = trackingSourceFromValue($("#timerTaskSelect").value);
    const taskId = source?.kind === "task" ? source.item.id : null;
    const habitId = source?.kind === "habit" ? source.item.id : null;
    const customTitle = $("#timerCustomTitle")?.value.trim() || "";
    const title = source?.item.title || customTitle;
    if (!title) return window.alert("할일·습관을 선택하거나 기록 이름을 입력해 주세요.");
    state.timer = { mode: timerMode(), running: true, paused: false, taskId, habitId, title, startedAt: Date.now(), accumulatedMs: 0, durationMs: timerDurationMs() };
    save();
    renderTracking();
    startTicker();
  });'''
text = replace_once(text, old_start, new_start, 'timer start habits')

old_change = '''  $("#timerTaskSelect").addEventListener("change", () => {
    const task = state.tasks.find((item) => item.id === $("#timerTaskSelect").value);
    if (task && $("#timerCustomTitle")) $("#timerCustomTitle").value = "";
    $("#timerTaskLabel").textContent = task?.title || $("#timerCustomTitle")?.value.trim() || "할일을 선택하거나 직접 기록 이름을 써도 돼요.";
  });
  $("#timerCustomTitle")?.addEventListener("input", (event) => {
    if (event.target.value.trim()) $("#timerTaskSelect").value = "";
    $("#timerTaskLabel").textContent = event.target.value.trim() || "할일을 선택하거나 직접 기록 이름을 써도 돼요.";
  });'''
new_change = '''  $("#timerTaskSelect").addEventListener("change", () => {
    const source = trackingSourceFromValue($("#timerTaskSelect").value);
    if (source && $("#timerCustomTitle")) $("#timerCustomTitle").value = "";
    $("#timerTaskLabel").textContent = source?.item.title || $("#timerCustomTitle")?.value.trim() || "할일·습관을 선택하거나 직접 기록 이름을 써도 돼요.";
  });
  $("#timerCustomTitle")?.addEventListener("input", (event) => {
    if (event.target.value.trim()) $("#timerTaskSelect").value = "";
    $("#timerTaskLabel").textContent = event.target.value.trim() || "할일·습관을 선택하거나 직접 기록 이름을 써도 돼요.";
  });'''
text = replace_once(text, old_change, new_change, 'timer select change habits')

app_path.write_text(text, encoding='utf-8')

index_path = ROOT / 'index.html'
index = index_path.read_text(encoding='utf-8')
index = replace_once(index, 'js/app.js?v=33', 'js/app.js?v=34', 'app cache version')
index_path.write_text(index, encoding='utf-8')

print('Added habits to tracking selector')
