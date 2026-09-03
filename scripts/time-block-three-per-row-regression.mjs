import assert from "node:assert/strict";
import fs from "node:fs";
import { findFirstAvailableTimeBlockSlot, TIME_BLOCK_AUTO_SLOT_MINUTES } from "../js/time-block-v2.js";

const blocks = [
  { id: "short", startMinute: 1050, endMinute: 1080 },
  { id: "hour", startMinute: 1080, endMinute: 1140 },
  { id: "next", startMinute: 1140, endMinute: 1170 },
];
const timed = (token, time, duration = 10) => ({ token, timed: true, time, duration });

assert.equal(TIME_BLOCK_AUTO_SLOT_MINUTES, 10, "automatic entries must use real 10-minute durations");
assert.deepEqual(findFirstAvailableTimeBlockSlot(blocks, {}, [], "hour"), { blockId: "hour", startMinute: 1080, duration: 10 });
assert.equal(findFirstAvailableTimeBlockSlot(blocks, {}, [timed("a", 1080)], "hour").startMinute, 1090, "the second card must store +10 minutes");
assert.equal(findFirstAvailableTimeBlockSlot(blocks, {}, [timed("a", 1080), timed("b", 1090)], "hour").startMinute, 1100, "the third card must store +20 minutes");
assert.equal(findFirstAvailableTimeBlockSlot(blocks, {}, [timed("a", 1080), timed("b", 1090), timed("c", 1100)], "hour").startMinute, 1110, "the fourth card must start the next 30-minute row");
assert.equal(findFirstAvailableTimeBlockSlot(blocks, {}, [timed("a", 1080, 30)], "hour").startMinute, 1110, "an existing 30-minute entry must occupy all three positions in its row");
assert.equal(findFirstAvailableTimeBlockSlot([{ id: "row", startMinute: 1080, endMinute: 1110 }], {}, [timed("a", 1080), timed("b", 1090), timed("c", 1100)], "row"), null, "a selected 30-minute row must reject a fourth card instead of relocating it");

const fullHour = [1080, 1090, 1100, 1110, 1120, 1130].map((minute, index) => timed(String(index), minute));
assert.deepEqual(findFirstAvailableTimeBlockSlot(blocks, {}, fullHour, "hour"), { blockId: "next", startMinute: 1140, duration: 10 }, "a 60-minute block must hold six 10-minute entries before continuing");
assert.equal(findFirstAvailableTimeBlockSlot([{ id: "hour", startMinute: 1080, endMinute: 1140 }], {}, fullHour, "hour"), null, "a full final block must reject another automatic entry");
assert.equal(findFirstAvailableTimeBlockSlot(blocks, {}, [timed("long", 1080, 60)], "hour").startMinute, 1140, "an existing 60-minute entry must fill the entire hour block");
assert.deepEqual(findFirstAvailableTimeBlockSlot(blocks, {}, [timed("a", 1080, 10)], "hour", "", 30), { blockId: "hour", startMinute: 1090, duration: 30 }, "moving a 30-minute entry must preserve its duration and require 30 contiguous minutes");

const legacyAssignments = {
  oldA: { blockId: "hour", afterAnchor: "block-start", order: 1 },
  oldB: { blockId: "hour", afterAnchor: "block-start", order: 2 },
};
const legacyOccurrences = [{ token: "oldA", timed: false }, { token: "oldB", timed: false }];
assert.equal(findFirstAvailableTimeBlockSlot(blocks, legacyAssignments, legacyOccurrences, "hour").startMinute, 1100, "legacy untimed assignments must reserve 10-minute positions");
assert.equal(findFirstAvailableTimeBlockSlot(blocks, legacyAssignments, legacyOccurrences, "hour", "oldA").startMinute, 1090, "moving an existing assignment must release its own reserved position");

const workspace = fs.readFileSync("js/unified-workspace.js", "utf8");
const css = fs.readFileSync("css/unified-workspace.css", "utf8");
const index = fs.readFileSync("index.html", "utf8");
assert.match(workspace, /taskDuration=slot\.duration;assignedAutomatically=true/, "new tasks without a time must persist the automatic 10-minute slot");
assert.match(workspace, /function automaticTimelineRowSlot\(/, "manual timeline drops must use a row-limited placement helper");
assert.match(workspace, /saveAutomaticTimelineRowChange\(g\.kind,g\.id/, "untimed manual timeline drops must stay in the selected row");
assert.match(workspace, /exactTimeItem&&exactTimeItem\.closest\("\.uw-timeline"\)===timeline[\s\S]*?dropType:usesRowSlots\?"time-row":"time"/, "dropping over an existing card must target its timeline row before time-block reordering");
assert.match(workspace, /g\.start===null\|\|g\.duration===TIME_BLOCK_AUTO_SLOT_MINUTES/, "existing 10-minute cards must keep using row capacity rules when dragged");
assert.match(workspace, /이 30분 줄은 이미 할 일 3개로 꽉 찼어요/, "a full selected row must reject another manual drop");
assert.match(workspace, /saveAutomaticTimeBlockChange\(g\.kind,g\.id[^\n]*g\.duration\)/, "moving an existing timed entry to a block must preserve its duration");
assert.match(workspace, /function plannedDuration\([^)]*\).*duration===TIME_BLOCK_AUTO_SLOT_MINUTES\|\|duration===15/s, "10- and legacy 15-minute durations must survive rendering");
assert.match(workspace, /function timelineDisplayMinute\(/, "10-minute cards must share their containing 30-minute visual row");
assert.match(workspace, /entry\._columns=3/, "a 30-minute timeline row must render three lanes");
assert.match(css, /\.uw-time-block-v2-list\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, "desktop block lists must have three columns");
assert.match(css, /@media\(max-width:700px\)\{\.uw-time-block-v2-list\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\}/, "mobile block lists must preserve the three positions");
assert.match(css, /\.uw-time-entry\[data-duration="10"\] \.uw-resize-handle/, "10-minute entries must not expose resize handles");
assert.match(index, /unified-workspace\.js\?v=104/);
assert.match(index, /unified-workspace\.css\?v=69/);
assert.match(workspace, /time-block-v2\.js\?v=6/);

console.log("time block three-per-row regression: ok");
