import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("css/unified-workspace.css", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const controls = fs.readFileSync("js/task-input-controls.js", "utf8");

assert.match(css, /\.uw-time-exact-lane \.uw-inline-form,\.uw-time-block-plan-rail \.uw-inline-form\{pointer-events:auto\}/, "timeline edit forms must remain clickable inside pointer-blocked layers");
assert.match(controls, /dateButton\.addEventListener\("click"[\s\S]*?dateInput\.showPicker\(\)/, "the timeline date icon must open its native picker");
assert.match(controls, /repeatButton\.addEventListener\("click"[\s\S]*?panel\.hidden=!panel\.hidden/, "the timeline repeat icon must toggle its settings panel");
assert.match(index, /unified-workspace\.css\?v=\d+/, "the pointer-event fix must refresh the stylesheet cache");

console.log("timeline inline tools regression: ok");
