import assert from "node:assert/strict";
import fs from "node:fs";
import { findFirstAvailableTimeBlockSlot, TIME_BLOCK_AUTO_SLOT_MINUTES } from "../js/time-block-v2.js";

const blocks = [
  { id: "short", startMinute: 1050, endMinute: 1080 },
  { id: "hour", startMinute: 1080, endMinute: 1140 },
  { id: "next", startMinute: 1140, endMinute: 1170 },
];
const timed = (token, time, duration = 15) => ({ token, timed: true, time, duration });

assert.equal(TIME_BLOCK_AUTO_SLOT_MINUTES, 15, "automatic time-block entries must use real 15-minute durations");
assert.deepEqual(findFirstAvailableTimeBlockSlot(blocks, {}, [], "hour"), { blockId: "hour", startMinute: 1080, duration: 15 });
assert.equal(findFirstAvailableTimeBlockSlot(blocks, {}, [timed("a", 1080)], "hour").startMinute, 1095, "the second card must store +15 minutes");
assert.equal(findFirstAvailableTimeBlockSlot(blocks, {}, [timed("a", 1080), timed("b", 1095)], "hour").startMinute, 1110, "the third card must start the next 30-minute row");
assert.equal(findFirstAvailableTimeBlockSlot(blocks, {}, [timed("a", 1080, 30)], "hour").startMinute, 1110, "existing 30-minute entries must occupy both quarter-hour positions");

const fullHour = [1080, 1095, 1110, 1125].map((minute, index) => timed(String(index), minute));
assert.deepEqual(findFirstAvailableTimeBlockSlot(blocks, {}, fullHour, "hour"), { blockId: "next", startMinute: 1140, duration: 15 }, "a 60-minute block must hold four entries before continuing to the next block");
assert.equal(findFirstAvailableTimeBlockSlot([{ id: "hour", startMinute: 1080, endMinute: 1140 }], {}, fullHour, "hour"), null, "a full final block must reject another automatic entry");

const legacyAssignments = {
  oldA: { blockId: "hour", afterAnchor: "block-start", order: 1 },
  oldB: { blockId: "hour", afterAnchor: "block-start", order: 2 },
};
const legacyOccurrences = [{ token: "oldA", timed: false }, { token: "oldB", timed: false }];
assert.equal(findFirstAvailableTimeBlockSlot(blocks, legacyAssignments, legacyOccurrences, "hour").startMinute, 1110, "legacy untimed assignments must reserve positions without being migrated");
assert.equal(findFirstAvailableTimeBlockSlot(blocks, legacyAssignments, legacyOccurrences, "hour", "oldA").startMinute, 1095, "moving an existing assignment must release its own reserved position");

const workspace = fs.readFileSync("js/unified-workspace.js", "utf8");
const css = fs.readFileSync("css/unified-workspace.css", "utf8");
const index = fs.readFileSync("index.html", "utf8");
assert.match(workspace, /taskDuration=slot\.duration;assignedAutomatically=true/, "new tasks added without a time must persist the automatic 15-minute slot");
assert.match(workspace, /saveAutomaticTimeBlockChange\(g\.kind,g\.id/, "untimed drag-to-block must use automatic placement");
assert.match(workspace, /function plannedDuration\([^)]*\).*TIME_BLOCK_AUTO_SLOT_MINUTES/s, "15-minute durations must survive state rendering");
assert.match(workspace, /quarterHour=Number\(x\.duration\)===TIME_BLOCK_AUTO_SLOT_MINUTES/, "quarter-hour timeline cards must be identifiable and non-resizable");
assert.match(css, /\.uw-time-block-v2-list\{grid-auto-flow:row\}/, "desktop time-block cards must fill left, right, then the next row");
assert.match(css, /\.uw-time-entry\[data-duration="15"\] \.uw-resize-handle\{display:none!important\}/, "15-minute entries must not expose resize handles");
assert.match(index, /unified-workspace\.js\?v=101/);
assert.match(index, /unified-workspace\.css\?v=67/);
assert.match(workspace, /time-block-v2\.js\?v=5/);

console.log("time block two-per-slot regression: ok");
