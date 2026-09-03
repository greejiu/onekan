import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const html = read("index.html");
const app = read("js/app.js");
const unified = read("js/unified-workspace.js");

assert.match(html, /app\.js\?v=\d+[\s\S]*unified-workspace\.js\?v=\d+/, "app.js must load before unified workspace");
assert.doesNotMatch(html, /id="blockEditor"|id="saveBlockBtn"|id="deleteBlockBtn"/, "legacy block editor markup must stay removed");

for (const token of [
  /function renderTimeGrid\(/,
  /function openBlockEditor\(/,
  /function hasBlockConflict\(/,
  /function wireTimelineResize\(/,
  /function fillBlockStartOptions\(/,
  /editingBlockId/,
  /#blockEditor/,
]) {
  assert.doesNotMatch(app, token, "legacy app timeline token must stay removed: " + token);
}

assert.match(unified, /function renderPlanner\(\)\{const card=\$\("\.home-timeline-card"\);[\s\S]*?card\.innerHTML=/, "unified workspace must own the home planner surface");
assert.match(unified, /const plannerDropAt=\(/, "unified workspace must own planner drop behavior");
assert.match(unified, /data-uw-resize=/, "unified workspace must own timeline resize controls");
assert.doesNotMatch(unified, /#blockEditor|openBlockEditor\(/, "unified workspace must not depend on the removed editor");

console.log("app legacy timeline removal regression: ok");
