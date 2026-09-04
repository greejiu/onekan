import fs from "node:fs";

function mustReplace(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`pattern not found: ${label}`);
  return source.replace(pattern, replacement);
}

const taskPath = "js/task-area-list.js";
let task = fs.readFileSync(taskPath, "utf8");
task = mustReplace(
  task,
  /^import \{ supabase \} from "\.\/supabase\.js";/m,
  'import { onekanStateStore } from "./supabase.js";',
  "task area import",
);
task = mustReplace(
  task,
  /  async function readState\(\) \{[\s\S]*?\n  \}\n\n  async function renderAreaList\(\) \{/,
  `  async function readState() {\n    const state = await onekanStateStore.read();\n    if (!state) return null;\n    state.tasks = Array.isArray(state.tasks) ? state.tasks : [];\n    state.eventGroups = Array.isArray(state.eventGroups) && state.eventGroups.length\n      ? state.eventGroups\n      : [{ id: "default", name: "기본", color: "#8fa9c4" }];\n    return state;\n  }\n\n  async function renderAreaList() {`,
  "task area readState",
);
fs.writeFileSync(taskPath, task);

const habitPath = "js/habit-area-list.js";
let habit = fs.readFileSync(habitPath, "utf8");
habit = mustReplace(
  habit,
  /^import \{ supabase \} from "\.\/supabase\.js";/m,
  'import { onekanStateStore } from "./supabase.js";',
  "habit area import",
);
habit = mustReplace(
  habit,
  /    const request = \+\+renderRequest;[\s\S]*?\n    const tasks = /,
  `    const request = ++renderRequest;\n    const state = await onekanStateStore.read();\n    if (!state || request !== renderRequest || !shouldRenderAreaView()) return;\n\n    const tasks = `,
  "habit area state read",
);
fs.writeFileSync(habitPath, habit);

const regression = [
  'import assert from "node:assert/strict";',
  'import fs from "node:fs";',
  '',
  'const task = fs.readFileSync("js/task-area-list.js", "utf8");',
  'const habit = fs.readFileSync("js/habit-area-list.js", "utf8");',
  '',
  'for (const [label, source] of [["task", task], ["habit", habit]]) {',
  '  assert.match(source, /import \\{ onekanStateStore \\} from "\\.\\/supabase\\.js";/, `${label} area list should import the shared state store`);',
  '  assert.match(source, /onekanStateStore\\.read\\(\\)/, `${label} area list should read through the shared state store`);',
  '  assert.doesNotMatch(source, /supabase\\.from\\(["\'\"]onekan_state["\'\"]\\)/, `${label} area list should not query oneKan state directly`);',
  '  assert.doesNotMatch(source, /supabase\\.auth\\.getSession\\(\\)/, `${label} area list should let the shared state store resolve the session`);',
  '}',
  '',
  'console.log("area list direct state-store regression: ok");',
  '',
].join("\n");
fs.writeFileSync("scripts/area-lists-state-store-regression.mjs", regression);

console.log("area list state-store migration applied");
