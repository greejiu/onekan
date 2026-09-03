import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('js/unified-workspace.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const match = source.match(/function timeBlockV2ItemMarkup\([\s\S]*?\n}\n(?=function timeBlockV2ManualGroup)/);

assert.ok(match, 'time-block item renderer must exist');
assert.doesNotMatch(match[0], /\blistDate\b/, 'time-block renderer must not reference list-only state');

const render = new Function('entry', 'date', 'assignment', `
  const SLOT = 30;
  const TIME_BLOCK_AUTO_SLOT_MINUTES = 10;
  const TIME_BLOCK_START_ANCHOR = '__start__';
  const plannedDuration = (value, fallback = SLOT) => Number(value) === TIME_BLOCK_AUTO_SLOT_MINUTES || Number(value) === 15 ? Number(value) : Math.max(SLOT, Number(value) || fallback);
  const esc = value => String(value ?? '');
  const groupStyle = () => '';
  const checkMarkup = () => '<button></button>';
  const itemDoneOn = () => false;
  const recurrenceLabel = () => '';
  const timeBlockV2MinuteText = minute => String(minute);
  const timeBlockV2EntryToken = item => item.item.id;
  const timeBlockV2Assignable = item => !item.timed && (item.kind === 'task' || item.kind === 'habit');
  ${match[0]}
  return timeBlockV2ItemMarkup(entry, date, [], assignment);
`);

for (const entry of [
  { kind:'task', item:{ id:'task-1', title:'할일' }, timed:false },
  { kind:'habit', item:{ id:'habit-1', title:'습관' }, timed:false },
  { kind:'task', item:{ id:'task-2', title:'10분 할일' }, timed:true, time:550, duration:10 },
  { kind:'event', item:{ id:'event-1', title:'일정' }, timed:true, time:540, duration:60 },
]) {
  const html = render(entry, '2026-08-29', null);
  assert.match(html, new RegExp(entry.item.title));
  assert.match(html, /uw-time-block-v2-item/);
  assert.match(html, /uw-move-handle/, 'time-block cards must expose the shared move handle');
}

assert.match(index, /unified-workspace\.js\?v=102/);
console.log('unified render smoke: ok');
