import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const sidebar = read("js/sidebar-navigation.js");
const popup = read("js/project-popup-planning.js");
const css = read("css/project-popup-planning.css");

assert.match(sidebar, /removePlanNavigation/);
assert.match(sidebar, /\.sidebar \.nav-item\[data-page="plan"\]/);
assert.match(sidebar, /project-popup-planning\.js\?v=1/);

assert.match(popup, /section\("task"/);
assert.match(popup, /section\("habit"/);
assert.match(popup, /data-project-popup-add=/);
assert.match(popup, /data-project-popup-add-form/);
assert.match(popup, /projectId,/);
assert.match(popup, /isHabit:\s*true/);
assert.match(popup, /data-project-popup-toggle-task/);
assert.match(popup, /data-project-popup-toggle-habit/);
assert.match(popup, /completeRepeatingTask/);
assert.match(popup, /undoRepeatingTaskCompletion/);
assert.match(popup, /habitDays\[today\]/);
assert.match(popup, /↻/);
assert.match(popup, /data-project-linked-body/);
assert.match(popup, /data-project-popup-planning-root/);
assert.doesNotMatch(popup, /#page-home/);

assert.match(css, /\.project-popup-check/);
assert.match(css, /\.project-popup-add-form/);
assert.match(css, /@media \(max-width: 700px\)/);

console.log("project popup planning regression: ok");
