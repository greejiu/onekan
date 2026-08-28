import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assignTimeBlockOccurrence,
  clearTimeBlockAssignmentsForBlock,
  clearTimeBlockDateOverride,
  effectiveTimeBlockTemplatesForDate,
  ensureTimeBlockV2State,
  setTimeBlockDateOverride,
  setTimeBlockTemplatesForDate,
  timeBlockAssignmentsForDate,
  timeBlockTemplatesForDate,
} from '../js/time-block-v2.js';

const state = {
  timeBlockTemplates: [
    { id: 'focus', title: '집중', startMinute: 540, endMinute: 660 },
  ],
};
ensureTimeBlockV2State(state);

assert.equal(timeBlockTemplatesForDate(state, '2026-08-27')[0].startMinute, 540);
setTimeBlockTemplatesForDate(state, [
  { id: 'focus', title: '집중', startMinute: 600, endMinute: 720 },
], '2026-08-28');
assert.equal(timeBlockTemplatesForDate(state, '2026-08-27')[0].startMinute, 540, 'past template must stay unchanged');
assert.equal(timeBlockTemplatesForDate(state, '2026-08-28')[0].startMinute, 600, 'base edit must apply from effective date');

setTimeBlockTemplatesForDate(state, [], '2026-08-29');
assert.equal(timeBlockTemplatesForDate(state, '2026-08-28').length, 1, 'base delete must preserve prior date');
assert.equal(timeBlockTemplatesForDate(state, '2026-08-29').length, 0, 'base delete must remove block from effective date onward');

const day = '2026-08-30';
setTimeBlockDateOverride(state, day, 'day-extra', {
  title: '외출 준비',
  startMinute: 840,
  endMinute: 900,
  created: true,
  hidden: false,
});
assert.equal(effectiveTimeBlockTemplatesForDate(state, day).some(item => item.id === 'day-extra'), true, 'date-created block should exist on that date');
assignTimeBlockOccurrence(state, day, 'task:t1:2026-08-30', 'day-extra');
assert.equal(timeBlockAssignmentsForDate(state, day)['task:t1:2026-08-30']?.blockId, 'day-extra');
clearTimeBlockAssignmentsForBlock(state, day, 'day-extra');
clearTimeBlockDateOverride(state, day, 'day-extra');
assert.equal(effectiveTimeBlockTemplatesForDate(state, day).some(item => item.id === 'day-extra'), false, 'date-created delete must remove block');
assert.equal(timeBlockAssignmentsForDate(state, day)['task:t1:2026-08-30'], undefined, 'date-created delete must clear that date assignment');

const unified = fs.readFileSync('js/unified-workspace.js', 'utf8');
assert.match(unified, /data-uw-time-block-menu/);
assert.match(unified, /오늘만 수정/);
assert.match(unified, /기본 블럭 수정/);
assert.match(unified, /오늘만 숨기기/);
assert.match(unified, /기본 블럭 삭제/);
assert.match(unified, /data-uw-time-block-action=\\"day-delete\\"/);
assert.match(unified, /uw-time-block-v2-today-badge/);
assert.match(unified, /setTimeBlockTemplatesForDate\(next,validation\.templates,date\)/);
assert.match(unified, /clearTimeBlockDateOverride\(next,date,id\)/);
assert.doesNotMatch(unified, /data-uw-time-block-edit data-date=/);

const css = fs.readFileSync('css/unified-workspace.css', 'utf8');
assert.match(css, /Time block V2 header menu/);
assert.match(css, /\.uw-time-block-v2-menu-button/);
assert.match(css, /\.uw-time-block-v2-today-badge/);

const index = fs.readFileSync('index.html', 'utf8');
assert.match(index, /unified-workspace\.css\?v=34/);
assert.match(index, /unified-workspace\.js\?v=40/);

console.log('time block V2 menu regression: ok');
