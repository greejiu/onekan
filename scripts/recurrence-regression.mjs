import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = 'js/unified-workspace.js';
const original = fs.readFileSync(sourcePath, 'utf8');

function requireSource(fragment, label) {
  assert.ok(original.includes(fragment), `source check failed: ${label}`);
}

// Shared scope wording and override-no-reprompt guards.
requireSource('dayButton.textContent=deleting?"이 날만 삭제":"이 날만 변경"', 'shared day wording');
requireSource('allButton.textContent=deleting?"전체 삭제":"전체 변경"', 'shared all wording');
requireSource('existingHabitOverride?"day":await askHabitScope("change"', 'habit edit override skips scope prompt');
requireSource('existingTaskOverride?"day":await askTaskScope(', 'task edit override skips scope prompt');
requireSource('existingEventOverride?"day":await askEventScope("change"', 'event edit override skips scope prompt');
requireSource('existing=habitOverride(state,date,record.id),scope=existing?"day":await askHabitScope("delete"', 'habit delete override skips scope prompt');
requireSource('existing=taskOverride(state,date,record.id),scope=existing?"day":await askTaskScope(task,date,"delete")', 'task delete override skips scope prompt');
requireSource('existing=eventOverride(state,date,record.id),scope=existing?"day":await askEventScope("delete"', 'event delete override skips scope prompt');
requireSource('habitOverride(current,record.date,record.id,true).hidden=true', 'habit one-day delete uses hidden override');
requireSource('taskOverride(current,record.date,record.id,true).hidden=true', 'task one-day delete uses hidden override');
requireSource('eventOverride(current,record.date,record.id,true).hidden=true', 'event one-day delete uses hidden override');

// Editing an entire recurring event must not silently re-anchor the series to the clicked occurrence.
requireSource('const eventDate=old.recurrence?.frequency&&!dateChanged?key(new Date(target.start)):(selectedDate||key(new Date(target.start)));', 'whole recurring event edit preserves series start date');

// Evaluate the actual production recurrence helpers in a VM. Browser-only startup is trimmed.
let executable = original.replace(/^import[^\n]*\n/, '');
const initIndex = executable.indexOf('async function init(){');
assert.ok(initIndex > 0, 'could not find init cutoff');
executable = executable.slice(0, initIndex);
executable += `\nglobalThis.__api={normalize,recurrenceOn,recurrenceLabel,eventOverride,eventOccurrencesForDate,habitOverride,habitOccursOn,taskOverride,taskOccurrencesForDate,itemsForDay};\nglobalThis.__setState=(value)=>{state=normalize(value);return state};\nglobalThis.__getState=()=>state;`;

const context = vm.createContext({
  console,
  Date,
  Intl,
  Map,
  Set,
  Math,
  Object,
  Array,
  String,
  Number,
  Boolean,
  JSON,
  RegExp,
  Promise,
  crypto: { randomUUID: () => 'test-id' },
  setTimeout,
  clearTimeout,
});
vm.runInContext(executable, context, { filename: sourcePath });
const api = context.__api;

const blankState = () => ({
  tasks: [], events: [], habitTemplates: [], habitDays: {}, habitOverrides: {}, taskOverrides: {}, eventOverrides: {}, timeBlocks: [], sessions: [],
  eventGroups: [{ id: 'default', name: '기본', color: '#888888' }], ui: {}
});

// Core recurrence patterns shared by schedule/task/habit.
assert.equal(api.recurrenceOn({ recurrence: { frequency: 'daily', interval: 2 } }, '2026-08-24', '2026-08-26'), true, '2-day recurrence should occur');
assert.equal(api.recurrenceOn({ recurrence: { frequency: 'daily', interval: 2 } }, '2026-08-24', '2026-08-25'), false, '2-day recurrence should skip intervening day');
assert.equal(api.recurrenceOn({ recurrence: { frequency: 'weekly', interval: 1, weekdays: [1,3,5] } }, '2026-08-24', '2026-08-26'), true, 'Mon/Wed/Fri recurrence should include Wednesday');
assert.equal(api.recurrenceOn({ recurrence: { frequency: 'weekly', interval: 1, weekdays: [1,3,5] } }, '2026-08-24', '2026-08-27'), false, 'Mon/Wed/Fri recurrence should exclude Thursday');
assert.equal(api.recurrenceOn({ recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 31 } }, '2026-08-31', '2026-09-30'), true, 'monthly recurrence should clamp to month end');
assert.equal(api.recurrenceOn({ recurrence: { frequency: 'daily', interval: 1, until: '2026-08-26' } }, '2026-08-24', '2026-08-27'), false, 'until date should stop recurrence');

// Task occurrence + per-day override.
let state = blankState();
state.tasks.push({ id: 'task-1', title: '반복 할일', date: '2026-08-24', groupId: 'default', done: false, recurrence: { frequency: 'weekly', interval: 1, weekdays: [1,3,5] } });
context.__setState(state);
assert.equal(api.taskOccurrencesForDate('2026-08-26').length, 1, 'task Wednesday occurrence');
api.taskOverride(context.__getState(), '2026-08-26', 'task-1', true).title = '수요일만 변경';
assert.equal(api.taskOccurrencesForDate('2026-08-26')[0].title, '수요일만 변경', 'task one-day title override');
assert.equal(api.taskOccurrencesForDate('2026-08-28')[0].title, '반복 할일', 'task override must not leak to other dates');
api.taskOverride(context.__getState(), '2026-08-26', 'task-1', true).hidden = true;
assert.equal(api.taskOccurrencesForDate('2026-08-26').length, 0, 'task one-day delete hides only occurrence');
assert.equal(api.taskOccurrencesForDate('2026-08-28').length, 1, 'task series survives one-day delete');

// Habit recurrence + hidden/title override as rendered by itemsForDay.
state = blankState();
state.habitTemplates.push({ id: 'habit-1', title: '반복 습관', startDate: '2026-08-24', groupId: 'default', recurrence: { frequency: 'weekly', interval: 1, weekdays: [1,3,5], anchorDate: '2026-08-24' } });
context.__setState(state);
assert.equal(api.habitOccursOn(context.__getState().habitTemplates[0], '2026-08-26'), true, 'habit Wednesday occurrence');
assert.equal(api.habitOccursOn(context.__getState().habitTemplates[0], '2026-08-27'), false, 'habit Thursday skipped');
api.habitOverride(context.__getState(), '2026-08-26', 'habit-1', true).title = '수요일만 습관 변경';
assert.equal(api.itemsForDay('2026-08-26').find(x => x.kind === 'habit').item.title, '수요일만 습관 변경', 'habit one-day title override');
api.habitOverride(context.__getState(), '2026-08-26', 'habit-1', true).hidden = true;
assert.equal(api.itemsForDay('2026-08-26').some(x => x.kind === 'habit'), false, 'habit one-day delete hides occurrence');
assert.equal(api.itemsForDay('2026-08-28').some(x => x.kind === 'habit'), true, 'habit series survives one-day delete');

// Event occurrence + per-day override, move, and delete.
state = blankState();
state.events.push({
  id: 'event-1', title: '반복 일정', groupId: 'default', allDay: false,
  start: '2026-08-24T09:00:00.000Z', end: '2026-08-24T10:00:00.000Z',
  recurrence: { frequency: 'weekly', interval: 1, weekdays: [1,3,5] }
});
context.__setState(state);
assert.equal(api.eventOccurrencesForDate('2026-08-26').length, 1, 'event Wednesday occurrence');
api.eventOverride(context.__getState(), '2026-08-26', 'event-1', true).title = '수요일만 일정 변경';
assert.equal(api.eventOccurrencesForDate('2026-08-26')[0].title, '수요일만 일정 변경', 'event one-day title override');
assert.equal(api.eventOccurrencesForDate('2026-08-28')[0].title, '반복 일정', 'event override must not leak');
const eventOv = api.eventOverride(context.__getState(), '2026-08-26', 'event-1', true);
eventOv.date = '2026-08-27';
assert.equal(api.eventOccurrencesForDate('2026-08-26').length, 0, 'moved event disappears from original date');
assert.equal(api.eventOccurrencesForDate('2026-08-27').length, 1, 'moved event appears on target date');
eventOv.hidden = true;
assert.equal(api.eventOccurrencesForDate('2026-08-27').length, 0, 'event one-day delete hides moved occurrence');
assert.equal(api.eventOccurrencesForDate('2026-08-28').length, 1, 'event series survives one-day delete');

console.log('PASS recurrence regression: schedule/task/habit recurrence + per-day overrides + shared scope UX');
