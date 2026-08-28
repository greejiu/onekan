import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TIME_BLOCK_START_ANCHOR,
  placeTimeBlockOccurrence,
  buildTimeBlockTimelinePlanRows,
} from '../js/time-block-v2.js';

const date = '2026-08-28';
const state = {
  timeBlockSystemVersion: 2,
  timeBlockTemplateVersions: [],
  timeBlockOverrides: {},
  timeBlockAssignments: {
    [date]: {
      'task:a:2026-08-28': { blockId: 'focus', afterAnchor: TIME_BLOCK_START_ANCHOR, order: 1 },
      'task:b:2026-08-28': { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 1 },
      'task:c:2026-08-28': { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 2 },
    },
  },
};

assert.equal(placeTimeBlockOccurrence(state, date, 'task:c:2026-08-28', 'focus', 'event:call:2026-08-28', 1), true);
assert.deepEqual(state.timeBlockAssignments[date]['task:c:2026-08-28'], { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 1 });
assert.deepEqual(state.timeBlockAssignments[date]['task:b:2026-08-28'], { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 2 });

placeTimeBlockOccurrence(state, date, 'task:a:2026-08-28', 'focus', 'event:call:2026-08-28', 2);
assert.deepEqual(state.timeBlockAssignments[date]['task:c:2026-08-28'], { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 1 });
assert.deepEqual(state.timeBlockAssignments[date]['task:a:2026-08-28'], { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 2 });
assert.deepEqual(state.timeBlockAssignments[date]['task:b:2026-08-28'], { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 3 });

placeTimeBlockOccurrence(state, date, 'task:b:2026-08-28', 'evening', TIME_BLOCK_START_ANCHOR, 1);
assert.deepEqual(state.timeBlockAssignments[date]['task:b:2026-08-28'], { blockId: 'evening', afterAnchor: TIME_BLOCK_START_ANCHOR, order: 1 });
assert.deepEqual(state.timeBlockAssignments[date]['task:c:2026-08-28'], { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 1 });
assert.deepEqual(state.timeBlockAssignments[date]['task:a:2026-08-28'], { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 2 });

const rows = buildTimeBlockTimelinePlanRows(
  [
    { id: 'focus', startMinute: 540, endMinute: 660 },
    { id: 'evening', startMinute: 1080, endMinute: 1200 },
  ],
  state.timeBlockAssignments[date],
  [
    { token: 'event:call:2026-08-28', timed: true, time: 570 },
    { token: 'task:a:2026-08-28', timed: false },
    { token: 'task:b:2026-08-28', timed: false },
    { token: 'task:c:2026-08-28', timed: false },
  ],
);
assert.equal(rows.find(row => row.token === 'task:c:2026-08-28')?.anchorMinute, 570);
assert.equal(rows.find(row => row.token === 'task:a:2026-08-28')?.order, 2);
assert.equal(rows.find(row => row.token === 'task:b:2026-08-28')?.anchorMinute, 1080);

const unified = fs.readFileSync('js/unified-workspace.js', 'utf8');
assert.doesNotMatch(unified, /data-uw-time-block-picker/, 'time block select picker should be removed');
assert.doesNotMatch(unified, /uw-time-block-picker/, 'picker markup/function should be gone');
assert.match(unified, /data-uw-time-block-drag/, 'untimed plan items need a dedicated drag handle');
assert.match(unified, /data-time-block-anchor/, 'exact-time rows need semantic anchor metadata');
assert.match(unified, /data-time-block-after-anchor/, 'manual plan rows need anchor metadata');
assert.match(unified, /mode===?"time-block-plan"|mode==="time-block-plan"/, 'planner drag must have its own gesture mode');
assert.match(unified, /uw-time-block-drop-before/, 'dragging above a row needs an insertion indicator');
assert.match(unified, /uw-time-block-drop-after/, 'dragging below a row needs an insertion indicator');
assert.match(unified, /uw-time-block-drop-bottom/, 'blank block area should show a bottom insertion indicator');
assert.match(unified, /placeTimeBlockOccurrence\(next,g\.date,g\.token,g\.nextBlockId,g\.nextAfterAnchor,g\.nextOrder\)/, 'drop must persist afterAnchor + order');
assert.match(unified, /clearTimeBlockAssignment\(next,g\.date,g\.token\)/, 'dropping on all-day must remove planning assignment');
assert.match(unified, /!item\.classList\.contains\("uw-time-block-v2-item"\)/, 'planner list titles must not invoke generic time moving');
assert.match(unified, /time-block-v2\.js\?v=4/, 'module cache should be bumped');

const css = fs.readFileSync('css/unified-workspace.css', 'utf8');
assert.match(css, /Time block V2 stage 5: direct planning drag/, 'stage 5 CSS should be present');
assert.match(css, /\.uw-time-block-drag-handle/, 'drag handle styling should exist');
assert.match(css, /\.uw-time-block-v2-item\.uw-time-block-drop-before::before/, 'before insertion line styling should exist');
assert.match(css, /\.uw-time-block-v2-item\.uw-time-block-drop-after::after/, 'after insertion line styling should exist');

const index = fs.readFileSync('index.html', 'utf8');
assert.match(index, /unified-workspace\.css\?v=36/, 'CSS cache should be bumped');
assert.match(index, /unified-workspace\.js\?v=43/, 'JS cache should be bumped');

console.log('time block drag stage 5 regression: ok');
