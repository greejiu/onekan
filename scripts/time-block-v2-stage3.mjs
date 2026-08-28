import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TIME_BLOCK_START_ANCHOR,
  assignTimeBlockOccurrence,
  clearTimeBlockAssignmentsForBlock,
  effectiveTimeBlockTemplatesForDate,
  ensureTimeBlockV2State,
  hiddenTimeBlockTemplatesForDate,
  setTimeBlockDateOverride,
  timeBlockAssignmentsForDate,
  timeBlockDateOverridesForDate,
  timeBlockTemplatesForDate,
  validateTimeBlockTemplates,
} from '../js/time-block-v2.js';

const state = {
  timeBlockTemplates: [
    { id: 'morning', title: '아침', startMinute: 360, endMinute: 540 },
    { id: 'focus', title: '집중', startMinute: 540, endMinute: 660 },
  ],
};
ensureTimeBlockV2State(state);
assert.deepEqual(state.timeBlockOverrides, {});

assignTimeBlockOccurrence(state, '2026-08-28', 'task:a:2026-08-28', 'focus', TIME_BLOCK_START_ANCHOR);
assignTimeBlockOccurrence(state, '2026-08-28', 'habit:b:2026-08-28', 'morning', TIME_BLOCK_START_ANCHOR);

setTimeBlockDateOverride(state, '2026-08-28', 'focus', {
  title: '늦은 집중', startMinute: 600, endMinute: 720, created: false, hidden: false,
});
let today = effectiveTimeBlockTemplatesForDate(state, '2026-08-28');
let tomorrow = effectiveTimeBlockTemplatesForDate(state, '2026-08-29');
assert.equal(today.find(x => x.id === 'focus').startMinute, 600, 'date override edits only selected date');
assert.equal(tomorrow.find(x => x.id === 'focus').startMinute, 540, 'next date keeps base template');
assert.equal(timeBlockTemplatesForDate(state, '2026-08-28').find(x => x.id === 'focus').startMinute, 540, 'base version is untouched');

setTimeBlockDateOverride(state, '2026-08-28', 'focus', {
  title: '늦은 집중', startMinute: 600, endMinute: 720, created: false, hidden: true,
});
today = effectiveTimeBlockTemplatesForDate(state, '2026-08-28');
assert.equal(today.some(x => x.id === 'focus'), false, 'hidden block is absent from effective layout');
assert.equal(timeBlockAssignmentsForDate(state, '2026-08-28')['task:a:2026-08-28'].blockId, 'focus', 'hide preserves assignment');
assert.equal(hiddenTimeBlockTemplatesForDate(state, '2026-08-28')[0].id, 'focus', 'hidden block is recoverable');

const hidden = hiddenTimeBlockTemplatesForDate(state, '2026-08-28').find(x => x.id === 'focus');
setTimeBlockDateOverride(state, '2026-08-28', 'focus', {
  title: hidden.title, startMinute: hidden.startMinute, endMinute: hidden.endMinute, created: false, hidden: false,
});
assert.equal(effectiveTimeBlockTemplatesForDate(state, '2026-08-28').some(x => x.id === 'focus'), true, 'restore makes hidden block effective again');
assert.equal(timeBlockAssignmentsForDate(state, '2026-08-28')['task:a:2026-08-28'].blockId, 'focus', 'restored block keeps original assignment');

setTimeBlockDateOverride(state, '2026-08-28', 'day-extra', {
  title: '외출', startMinute: 780, endMinute: 900, created: true, hidden: false,
});
assert.equal(effectiveTimeBlockTemplatesForDate(state, '2026-08-28').some(x => x.id === 'day-extra'), true, 'date-created block exists on selected date');
assert.equal(effectiveTimeBlockTemplatesForDate(state, '2026-08-29').some(x => x.id === 'day-extra'), false, 'date-created block does not leak to other dates');
assert.equal(timeBlockDateOverridesForDate(state, '2026-08-28')['day-extra'].created, true);

assignTimeBlockOccurrence(state, '2026-08-28', 'task:c:2026-08-28', 'focus', TIME_BLOCK_START_ANCHOR);
clearTimeBlockAssignmentsForBlock(state, '2026-08-28', 'focus');
const assignments = timeBlockAssignmentsForDate(state, '2026-08-28');
assert.equal(assignments['task:a:2026-08-28'], undefined, 'empty removes matching block assignment');
assert.equal(assignments['task:c:2026-08-28'], undefined, 'empty removes all matching block assignments');
assert.equal(assignments['habit:b:2026-08-28'].blockId, 'morning', 'empty preserves other block assignments');

const overlap = validateTimeBlockTemplates([
  { id: 'a', startMinute: 540, endMinute: 660 },
  { id: 'b', startMinute: 600, endMinute: 720 },
]);
assert.equal(overlap.ok, false, 'overlap remains invalid for date overrides');

const source = fs.readFileSync(new URL('../js/unified-workspace.js', import.meta.url), 'utf8');
for (const needle of [
  'effectiveTimeBlockTemplatesForDate(state,k)',
  'hiddenTimeBlockTemplatesForDate(state,k)',
  'data-uw-time-block-add',
  'data-uw-time-block-edit',
  'data-uw-time-block-hide',
  'data-uw-time-block-restore',
  'data-uw-time-block-empty',
  'clearTimeBlockAssignmentsForBlock(next,date,id)',
  'id="uwTimeBlockDayDialog"',
]) assert.ok(source.includes(needle), `source check failed: ${needle}`);

console.log('time block V2 stage 3 regression passed');
