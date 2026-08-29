const pad = (value) => String(value).padStart(2, "0");

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromKey(value) {
  return new Date(`${value}T12:00:00`);
}

function addDays(value, amount) {
  const date = fromKey(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function addMonthsClamped(value, amount) {
  const source = fromKey(value);
  const wantedDay = source.getDate();
  const target = new Date(source.getFullYear(), source.getMonth() + amount, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(wantedDay, lastDay));
  return dateKey(target);
}

export function completionDateKey(now = new Date()) {
  const date = new Date(now);
  date.setHours(date.getHours() - 3);
  return dateKey(date);
}

export function nextRepeatDateFromCompletion(recurrence, completedDate) {
  if (!recurrence?.frequency || !completedDate) return null;
  const interval = Math.max(1, Number(recurrence.interval || 1));
  let next = null;

  if (recurrence.frequency === "daily") {
    next = addDays(completedDate, interval);
  } else if (recurrence.frequency === "weekly") {
    const weekdays = Array.isArray(recurrence.weekdays)
      ? [...new Set(recurrence.weekdays.map(Number).filter((day) => day >= 0 && day <= 6))]
      : [];
    if (weekdays.length > 1) {
      const allowed = new Set(weekdays);
      let candidate = addDays(completedDate, (interval - 1) * 7 + 1);
      for (let offset = 0; offset < 14; offset += 1) {
        if (allowed.has(fromKey(candidate).getDay())) {
          next = candidate;
          break;
        }
        candidate = addDays(candidate, 1);
      }
    } else {
      next = addDays(completedDate, interval * 7);
    }
  } else if (recurrence.frequency === "monthly") {
    next = addMonthsClamped(completedDate, interval);
  }

  if (!next) return null;
  if (recurrence.until && next > recurrence.until) return null;
  return next;
}

function shiftTaskClock(task, targetDate) {
  if (!targetDate || !task?.notionStart) return;
  const start = new Date(task.notionStart);
  if (Number.isNaN(start.getTime())) return;
  const end = task.notionEnd ? new Date(task.notionEnd) : null;
  const duration = end && !Number.isNaN(end.getTime()) ? Math.max(0, end.getTime() - start.getTime()) : null;
  const shifted = new Date(`${targetDate}T${pad(start.getHours())}:${pad(start.getMinutes())}:00`);
  task.notionStart = shifted.toISOString();
  if (duration !== null) task.notionEnd = new Date(shifted.getTime() + duration).toISOString();
}

export function normalizeCompletionRepeats(state) {
  if (!state || !Array.isArray(state.tasks)) return state;

  for (const task of state.tasks) {
    if (!task?.recurrence?.frequency) continue;
    task.repeatSeriesId ||= task.id;
    if (task.recurrence.completionBased === true) continue;

    task.recurrence = { ...task.recurrence, completionBased: true };
    const completedDates = Object.entries(task.recurrenceDone || {})
      .filter(([, done]) => done === true)
      .map(([date]) => date)
      .sort();
    if (!completedDates.length) continue;

    const latest = completedDates[completedDates.length - 1];
    const nextDate = nextRepeatDateFromCompletion(task.recurrence, latest);
    if (nextDate) {
      task.date = nextDate;
      task.done = false;
      task.completedAt = null;
      shiftTaskClock(task, nextDate);
      continue;
    }

    task.repeatRule = { ...task.recurrence };
    task.repeatScheduledDate = task.date || latest;
    task.completedDate = latest;
    task.date = latest;
    task.done = true;
    task.completedAt ||= new Date(`${latest}T12:00:00`).toISOString();
    delete task.recurrence;
  }
  return state;
}

export function completeRepeatingTask(state, task, completedAt = new Date()) {
  if (!state || !task?.recurrence?.frequency) return false;
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const completedDate = completionDateKey(completedAt);
  const completedIso = completedAt instanceof Date ? completedAt.toISOString() : new Date(completedAt).toISOString();
  const rule = { ...task.recurrence, completionBased: true };
  const seriesId = task.repeatSeriesId || task.id;
  const scheduledDate = task.date || completedDate;
  const nextDate = nextRepeatDateFromCompletion(rule, completedDate);

  task.repeatSeriesId = seriesId;
  task.repeatRule = rule;
  task.repeatScheduledDate = scheduledDate;
  task.completedDate = completedDate;
  task.done = true;
  task.completedAt = completedIso;
  task.date = completedDate;
  shiftTaskClock(task, completedDate);
  delete task.recurrence;

  if (!nextDate) {
    delete task.repeatGeneratedNextId;
    return true;
  }

  const nextId = crypto.randomUUID();
  const nextTask = {
    ...task,
    id: nextId,
    date: nextDate,
    done: false,
    completedAt: null,
    createdAt: completedIso,
    recurrence: rule,
    recurrenceDone: {},
    repeatSeriesId: seriesId,
  };
  delete nextTask.repeatRule;
  delete nextTask.repeatScheduledDate;
  delete nextTask.repeatGeneratedNextId;
  delete nextTask.completedDate;
  shiftTaskClock(nextTask, nextDate);

  state.tasks.push(nextTask);
  task.repeatGeneratedNextId = nextId;
  return true;
}

export function undoRepeatingTaskCompletion(state, task) {
  if (!state || !task?.done || !task.repeatRule?.frequency) return false;
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const nextId = task.repeatGeneratedNextId || null;
  const nextTask = nextId ? state.tasks.find((item) => item.id === nextId) : null;
  if (nextTask?.done) return false;

  if (nextId) {
    state.tasks = state.tasks.filter((item) => item.id !== nextId);
    if (Array.isArray(state.timeBlocks)) state.timeBlocks = state.timeBlocks.filter((item) => item.taskId !== nextId);
    Object.values(state.taskOverrides || {}).forEach((day) => {
      if (day && typeof day === "object") delete day[nextId];
    });
  }

  task.recurrence = { ...task.repeatRule, completionBased: true };
  task.date = task.repeatScheduledDate || task.completedDate || task.date;
  task.done = false;
  task.completedAt = null;
  shiftTaskClock(task, task.date);
  delete task.completedDate;
  delete task.repeatRule;
  delete task.repeatScheduledDate;
  delete task.repeatGeneratedNextId;
  return true;
}
