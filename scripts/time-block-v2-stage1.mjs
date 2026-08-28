import assert from "node:assert/strict";
import {
  ensureTimeBlockV2State,
  setTimeBlockTemplatesForDate,
  timeBlockTemplatesForDate,
  upsertTimeBlockTemplateVersion,
  validateTimeBlockTemplates,
} from "../js/time-block-v2.js";

const legacy = {
  timeBlockTemplates: [
    { id: "morning", title: "아침", startMinute: 360, endMinute: 540 },
    { id: "focus", title: "집중", startMinute: 540, endMinute: 660 },
  ],
};

assert.equal(ensureTimeBlockV2State(legacy), true);
assert.equal(legacy.timeBlockSystemVersion, 2);
assert.equal(legacy.timeBlockTemplateVersions.length, 2);
assert.deepEqual(timeBlockTemplatesForDate(legacy, "2026-08-27").map((item) => item.id), ["morning", "focus"]);

upsertTimeBlockTemplateVersion(legacy, {
  id: "focus", title: "집중", startMinute: 600, endMinute: 720,
}, "2026-09-01");
assert.equal(timeBlockTemplatesForDate(legacy, "2026-08-31").find((item) => item.id === "focus").startMinute, 540);
assert.equal(timeBlockTemplatesForDate(legacy, "2026-09-01").find((item) => item.id === "focus").startMinute, 600);

setTimeBlockTemplatesForDate(legacy, [
  { id: "morning", title: "아침", startMinute: 420, endMinute: 540 },
  { id: "focus", title: "집중", startMinute: 540, endMinute: 660 },
], "2026-08-28");
assert.equal(timeBlockTemplatesForDate(legacy, "2026-08-27").find((item) => item.id === "morning").startMinute, 360);
assert.equal(timeBlockTemplatesForDate(legacy, "2026-08-28").find((item) => item.id === "morning").startMinute, 420);

const morningCountBefore = legacy.timeBlockTemplateVersions.filter((item) => item.id === "morning").length;
setTimeBlockTemplatesForDate(legacy, [
  { id: "morning", title: "아침 변경", startMinute: 430, endMinute: 540 },
  { id: "focus", title: "집중", startMinute: 540, endMinute: 660 },
], "2026-08-28");
const morningVersions = legacy.timeBlockTemplateVersions.filter((item) => item.id === "morning");
assert.equal(morningVersions.length, morningCountBefore);
assert.equal(morningVersions.filter((item) => item.effectiveFrom === "2026-08-28").length, 1);
assert.equal(timeBlockTemplatesForDate(legacy, "2026-08-28").find((item) => item.id === "morning").title, "아침 변경");

setTimeBlockTemplatesForDate(legacy, [
  { id: "morning", title: "아침 변경", startMinute: 430, endMinute: 540 },
], "2026-08-29");
assert.equal(timeBlockTemplatesForDate(legacy, "2026-08-28").some((item) => item.id === "focus"), true);
assert.equal(timeBlockTemplatesForDate(legacy, "2026-08-29").some((item) => item.id === "focus"), false);
assert.equal(timeBlockTemplatesForDate(legacy, "2026-09-01").some((item) => item.id === "focus"), true, "a later pre-existing version can become active again");

const valid = validateTimeBlockTemplates([
  { id: "a", title: "", startMinute: 360, endMinute: 540 },
  { id: "b", title: "", startMinute: 540, endMinute: 660 },
]);
assert.equal(valid.ok, true);
const overlap = validateTimeBlockTemplates([
  { id: "a", title: "", startMinute: 360, endMinute: 540 },
  { id: "b", title: "", startMinute: 500, endMinute: 660 },
]);
assert.equal(overlap.ok, false);

console.log("time block V2 stage 1 regression: ok");
