import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TIME_BLOCK_START_ANCHOR,
  buildTimeBlockTimelinePlanRows,
} from '../js/time-block-v2.js';

const templates = [
  { id: 'morning', title: '아침', startMinute: 360, endMinute: 540 },
  { id: 'focus', title: '집중', startMinute: 540, endMinute: 720 },
];
const assignments = {
  'task:a:2026-08-28': { blockId: 'focus', afterAnchor: TIME_BLOCK_START_ANCHOR, order: 1 },
  'task:b:2026-08-28': { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 1 },
  'habit:c:2026-08-28': { blockId: 'focus', afterAnchor: 'event:call:2026-08-28', order: 2 },
  'task:d:2026-08-28': { blockId: 'focus', afterAnchor: 'event:missing:2026-08-28', order: 1 },
  'task:hidden:2026-08-28': { blockId: 'removed', afterAnchor: TIME_BLOCK_START_ANCHOR, order: 1 },
};
const occurrences = [
  { token: 'event:call:2026-08-28', timed: true, time: 570 },
  { token: 'event:outside:2026-08-28', timed: true, time: 800 },
  ...Object.keys(assignments).map(token => ({ token, timed: false, time: null })),
];
const rows = buildTimeBlockTimelinePlanRows(templates, assignments, occurrences);
assert.equal(rows.length, 4, 'assignments to missing blocks must not project');
assert.deepEqual(rows.find(row => row.token === 'task:a:2026-08-28'), {
  token: 'task:a:2026-08-28', blockId: 'focus', afterAnchor: TIME_BLOCK_START_ANCHOR, anchorMinute: 540, order: 1,
});
assert.equal(rows.find(row => row.token === 'task:b:2026-08-28')?.anchorMinute, 570, 'exact anchor time should drive projection');
assert.equal(rows.find(row => row.token === 'habit:c:2026-08-28')?.order, 2, 'same-anchor order must be preserved');
assert.equal(rows.find(row => row.token === 'task:d:2026-08-28')?.afterAnchor, TIME_BLOCK_START_ANCHOR, 'missing anchor must fall back to block start');
assert.equal(rows.find(row => row.token === 'task:d:2026-08-28')?.anchorMinute, 540);

const unified = fs.readFileSync('js/unified-workspace.js', 'utf8');
assert.match(unified, /buildTimeBlockTimelinePlanRows/);
assert.match(unified, /function timeBlockV2TimelineProjection/);
assert.match(unified, /uw-time-block-plan-rail/);
assert.match(unified, /projection\.projectedTokens\.has\(timeBlockV2EntryToken\(entry,k\)\)/, 'projected untimed items should leave all-day panel');
assert.match(unified, /uw-time-exact-lane/);
assert.match(unified, /projection\.height/);

const css = fs.readFileSync('css/unified-workspace.css', 'utf8');
assert.match(css, /Time block V2 timeline projection/);
assert.match(css, /\.uw-time-block-plan-group::before/);
assert.match(css, /\.uw-has-time-block-plan \.uw-time-exact-lane/);

const index = fs.readFileSync('index.html', 'utf8');
assert.match(index, /unified-workspace\.css\?v=35/);
assert.match(index, /unified-workspace\.js\?v=41/);

console.log('time block V2 timeline regression: ok');
