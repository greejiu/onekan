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

assert.match(
  html,
  /app\.js\?v=\d+[\s\S]*unified-workspace\.js\?v=\d+/,
  "app.js must stay before unified-workspace.js while the legacy fallback still exists",
);

assert.match(
  app,
  /if \(document\.querySelector\('script\[src\*="unified-workspace\.js"\]'\)\) \{\s*renderDashboard\(\);\s*return;\s*\}\s*renderTasks\(\);\s*renderTimeGrid\(\);/,
  "renderHome must bypass the legacy time grid whenever unified workspace is present",
);

assert.match(app, /function renderTimeGrid\(\)/, "legacy renderTimeGrid should remain until its whole subsystem is removed together");
assert.match(app, /function openBlockEditor\(/, "legacy block editor helper should remain until the subsystem is removed together");
assert.match(html, /id="blockEditor"/, "legacy block editor markup should remain until app.js listeners are removed together");

assert.match(
  unified,
  /function renderPlanner\(\)\{const card=\$\("\.home-timeline-card"\);[\s\S]*?card\.innerHTML=`<div class="uw-home-planner">/,
  "unified workspace must own and replace the home planner card contents",
);
assert.match(unified, /const plannerDropAt=\(/, "unified workspace must own planner drop behavior");
assert.match(unified, /data-uw-resize=/, "unified workspace must own timeline resize controls");
assert.doesNotMatch(unified, /#blockEditor|openBlockEditor\(/, "unified workspace must not depend on the legacy block editor");
assert.doesNotMatch(unified, /#timeGrid/, "unified workspace must not depend on the legacy #timeGrid node");

const jsDir = path.join(root, "js");
for (const name of fs.readdirSync(jsDir).filter((name) => name.endsWith(".js") && name !== "app.js")) {
  const source = fs.readFileSync(path.join(jsDir, name), "utf8");
  assert.doesNotMatch(source, /\brenderTimeGrid\s*\(/, `${name} must not call the app.js legacy renderTimeGrid`);
  assert.doesNotMatch(source, /\bopenBlockEditor\s*\(/, `${name} must not call the app.js legacy block editor`);
  assert.doesNotMatch(source, /\bhasBlockConflict\s*\(/, `${name} must not call the app.js legacy conflict checker`);
}

console.log("app legacy timeline audit regression: ok");
