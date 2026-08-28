import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TIME_BLOCK_START_ANCHOR,
  assignTimeBlockOccurrence,
  clearTimeBlockAssignment,
  ensureTimeBlockV2State,
  setTimeBlockAssignment,
  timeBlockAssignment,
  timeBlockAssignmentsForDate,
  timeBlockOccurrenceToken,
} from "../js/time-block-v2.js";

const state = {};
assert.equal(ensureTimeBlockV2State(state), true);
assert.deepEqual(state.timeBlockAssignments, {});

const task = { id: "task-1" };
const recurringTask = { id: "task-2", _occurrenceSource: "2026-08-21" };
const taskToken = timeBlockOccurrenceToken("task", task, "2026-08-28");
const recurringToken = timeBlockOccurrenceToken("task", recurringTask, "2026-08-28");
assert.equal(taskToken, "task:task-1:2026-08-28");
assert.equal(recurringToken, "task:task-2:2026-08-21");

assert.equal(assignTimeBlockOccurrence(state, "2026-08-28", taskToken, "focus"), true);
assert.deepEqual(timeBlockAssignment(state, "2026-08-28", taskToken), {
  blockId: "focus",
  afterAnchor: TIME_BLOCK_START_ANCHOR,
  order: 1,
});

const secondToken = "habit:habit-1:2026-08-28";
assignTimeBlockOccurrence(state, "2026-08-28", secondToken, "focus");
assert.equal(timeBlockAssignment(state, "2026-08-28", secondToken).order, 2);

const anchor = "event:event-1:2026-08-28";
const thirdToken = "task:task-3:2026-08-28";
const fourthToken = "task:task-4:2026-08-28";
assignTimeBlockOccurrence(state, "2026-08-28", thirdToken, "focus", anchor);
assignTimeBlockOccurrence(state, "2026-08-28", fourthToken, "focus", anchor);
assert.equal(timeBlockAssignment(state, "2026-08-28", thirdToken).order, 1);
assert.equal(timeBlockAssignment(state, "2026-08-28", fourthToken).order, 2);
assert.equal(timeBlockAssignment(state, "2026-08-28", fourthToken).afterAnchor, anchor);

setTimeBlockAssignment(state, "2026-08-29", taskToken, { blockId: "morning", afterAnchor: "block-start", order: 7 });
assert.equal(timeBlockAssignment(state, "2026-08-28", taskToken).blockId, "focus");
assert.equal(timeBlockAssignment(state, "2026-08-29", taskToken).blockId, "morning");
assert.equal(timeBlockAssignmentsForDate(state, "2026-08-29")[taskToken].order, 7);

assert.equal(clearTimeBlockAssignment(state, "2026-08-28", taskToken), true);
assert.equal(timeBlockAssignment(state, "2026-08-28", taskToken), null);
assert.equal(timeBlockAssignment(state, "2026-08-29", taskToken).blockId, "morning");

const unified = fs.readFileSync(new URL("../js/unified-workspace.js", import.meta.url), "utf8");
for (const needle of [
  'timeBlockTemplatesForDate(state,k)',
  'timeBlockAssignmentsForDate(state,k)',
  'function timeBlockV2TemplateForMinute',
  'Number(minute)>=Number(template.startMinute)&&Number(minute)<Number(template.endMinute)',
  'data-uw-time-block-picker',
  'assignTimeBlockOccurrence(s,date,token,blockId,TIME_BLOCK_START_ANCHOR)',
  '<strong>타임블럭 없음</strong>',
]) {
  assert.ok(unified.includes(needle), `unified source check failed: ${needle}`);
}

const css = fs.readFileSync(new URL("../css/unified-workspace.css", import.meta.url), "utf8");
assert.ok(css.includes("/* Time block V2 list */"));

console.log("time block V2 stage 2 regression: ok");
